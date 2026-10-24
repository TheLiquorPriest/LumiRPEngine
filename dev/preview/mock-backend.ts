// A mock backend for the preview harness: answers every protocol request from fixtures, keeps
// a push counter, and pushes real snapshots and deltas (computed by diffing the view), so the
// frontend's delta/resync path runs exactly as against the real backend.

import { CLASS_TRAITS, type AccountView, type FinanceView, type JournalLine } from "../../src/shared/finance";
import { CLAIM_PRESETS } from "../../src/shared/claims";
import { readInferred } from "../../src/shared/inferred";
import type { DiagCall, DiagRecord } from "../../src/shared/diagnostics";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import { hasOwn, isRecord } from "../../src/shared/json";
import { applyPatch } from "../../src/shared/json-patch";
import type { MindsRunView } from "../../src/shared/minds";
import type { LoreBookEntryView, LorePinView } from "../../src/shared/protocol";
import type { BookLoreFields } from "../../src/shared/lore";
import type { DeltaOp, EditOp, FrontendToBackend, JobProposal, JobSummary, JobUpdate, LintIssue, LoreDrift, PresetCard, ResultBodies, StudioOfferView } from "../../src/shared/protocol";
import { AGENT_API } from "../../src/shared/protocol";
import type { UserSettings } from "../../src/shared/settings";
import type { GmView, StateView } from "../../src/shared/state-view";
import type { StudioOffer } from "../../src/shared/studio-bridge";
import type { WorldDoc, WorldIndex } from "../../src/shared/world";
import { hashJson } from "../../src/shared/hash";
import { compileMaps, mapLint, mapTemplate } from "../../src/shared/maps";
import { findPath, gridMinutes } from "../../src/shared/grid";
import { decodeMapView } from "../../src/packs/space/ui/view";
import { decodeFinanceView } from "../../src/packs/economy/ui/decode";
import { bookLoreProblem } from "../../src/backend/book-lore";
import { mapProposal, readMapAnswer, readMapRequest } from "../../src/backend/map-job";
import { macroReview, WORLD_COLLECTIONS } from "../../src/backend/worlds";
import type { StudioCase } from "./fixtures";
import { DECLINED_PURCHASE, extractionView, freshFixture, gmFixture, pausedFixture, portAlderMoney, settingsFixture, starterMap, stateFixture, studioOfferFixture, UPGRADE_PREVIEW, WORLDS, worldFixture } from "./fixtures";
import { combatFixture } from "./combat-fixture";
import { applyRoutineOp, previewRoutines, routineChangedFixture, routineGmFixture, type PreviewRoutines } from "./routines-fixture";
import { ROUTINE_PROPOSALS, routinePlayerFixture } from "./routines-player-fixture";
import { isWorldDoc, lintWorld, migrateWorld, previewSheet, previewSkills } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { formulaFunctions } from "../../src/engine/scope";
import { buildCharacter } from "../../src/engine/character";
import { initialState } from "../../src/engine/world-state";
import { ALL_PACKS } from "../../src/packs/index";
import { applyProfile, profileChoices, profileOf } from "../../src/shared/profiles/index";
import { modernSheetFixture } from "./profile-fixture";
import { STARTER_INFO } from "../../src/packs/starters/info";

// The real registry, so Build's formula functions and the Sheet Designer preview are the engine's own.
const REGISTRY = createRegistry(ALL_PACKS);

type Emit = (payload: unknown) => void;

export interface MockOptions {
  /** `fresh`: a new chat whose POV money no view has opened yet (the opening balances show); `combat`: a fight under way at the diner (the Encounter tab, the palette's Combat tab, the GM view's Fight); `sheet`: Play → You with the Modern profile's sheet. */
  scenario: "play" | "paused" | "not_world" | "fresh" | "combat" | "sheet";
  /** A starter template id: the map is that starter's in a new chat, as the engine builds it. */
  map?: string;
  /** A Port Alder party (`?money=`): Play's money is theirs and GM → Money everyone's, as the engine keeps them nine days in. */
  money?: string;
  /** What LumiRPEngine Studio has waiting (`?studio=`); nothing by default. */
  studio?: StudioCase;
  /** `?draft=elsewhere`: this long after Build first loads a draft, another window changes it (`changeDraftElsewhere`). */
  draftElsewhereMs?: number;
  /** `?activity=`: the engine mid-turn (`busy`), or its last turn failed (`failed`). */
  activity?: "busy" | "failed";
  closeDrawer(): void;
}

function diffOps(before: unknown, after: unknown, path: (string | number)[], out: DeltaOp[]): void {
  if (isRecord(before) && isRecord(after)) {
    for (const key of Object.keys(after)) {
      if (!(key in before)) out.push({ op: "set", path: [...path, key], value: after[key] as JsonValue });
      else diffOps(before[key], after[key], [...path, key], out);
    }
    for (const key of Object.keys(before)) if (!(key in after)) out.push({ op: "del", path: [...path, key] });
    return;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ op: "set", path, value: after as JsonValue });
}

function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch;
  const out: Record<string, unknown> = isRecord(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = mergePatch(out[key], value);
  }
  return out;
}

const REALISM_PRESETS: Record<string, Record<string, number>> = {
  story: { money: 1, gear: 1, vehicles: 1, castlife: 1, relationships: 1, space: 2, calendar: 2, weather: 1, sheets: 1 },
  grounded: { money: 2, gear: 2, vehicles: 2, castlife: 2, relationships: 2, space: 2, calendar: 3, weather: 2, sheets: 2 },
  simulation: { money: 4, gear: 4, vehicles: 4, castlife: 4, relationships: 4, space: 4, calendar: 4, weather: 3, sheets: 3 },
};

const PROPOSALS: JobProposal[] = [
  { id: "p1", collection: "entities", key: "npc_okafor", value: { id: "npc_okafor", kind: "npc", name: "Mr. Okafor", tier: "supporting", fields: {}, relations: [] }, source: "Lore: “Regulars of Rosie's”", confidence: 0.92 },
  { id: "p2", collection: "places", key: "library", value: { id: "library", name: "Maple Falls Library", parent: "maple", fields: {} }, source: "Lore: “Town map”", confidence: 0.81 },
  { id: "p3", collection: "schedules", key: "okafor_breakfast", value: { id: "okafor_breakfast", owner: "npc_okafor", target: "place", recurrence: { every: "day" }, slots: [{ start: "07:00", end: "08:00", value: "diner" }] }, source: "Lore: “Regulars of Rosie's”", confidence: 0.64, note: "Inferred from “every morning”" },
  { id: "p4", collection: "tracks", key: "secret_debt", value: { id: "secret_debt", kind: "secret", label: "Rosie's debt", start: "hidden", stages: { hidden: { label: "Hidden", next: [] } }, visibility: "secret" }, source: "Lore: “Rosie”", confidence: 0.41, note: "Low confidence: mentioned once" },
];

/** What "Index a World Info book" proposes for the preview's Town lore. */
const LORE_PROPOSALS: JobProposal[] = [
  { id: "l1", collection: "lore", key: "maple_falls_library", value: { id: "maple_falls_library", title: "Maple Falls Library", content: "The library on Elm Street keeps the town's newspapers back to 1902, and Mrs. Hale knows where every one is.", keys: ["library"], links: ["maple"], aliases: ["the library", "Elm Street library"], topics: ["Town places"], source: { kind: "book", bookId: "book-town", entryId: "e-library", hash: "h-library" } }, source: "e-library", confidence: 0.92, pack: "lore", index: { terms: ["maple falls library", "the library", "elm street library"], topics: [{ id: "town_places", label: "Town places" }] }, sourceNames: { "book-town/e-library": "Library" } },
  { id: "l2", collection: "lore", key: "okafor_family", value: { id: "okafor_family", title: "The Okafor family", content: "The Okafors have run the hardware store on Main for three generations.", keys: ["Okafor"], links: ["npc_rosie"], aliases: ["the Okafors"], topics: ["Families", "Town history"], source: { kind: "book", bookId: "book-town", entryId: "e-okafor", hash: "h-okafor" } }, source: "e-okafor", confidence: 0.78, pack: "lore", note: "dropped unknown link okafor_house", index: { terms: ["the okafor family", "the okafors"], topics: [{ id: "families", label: "Families" }, { id: "town_history", label: "Town history" }] }, sourceNames: { "book-town/e-okafor": "Okafors" } },
  { id: "l3", collection: "lore", key: "founders_day", value: { id: "founders_day", title: "Founders' Day", content: "Every June the town closes Main Street for a parade and a pie contest.", keys: [], links: [], topics: ["Town history"], source: { kind: "book", bookId: "book-town", entryId: "e-founders", hash: "h-founders" } }, source: "e-founders", confidence: 0.55, pack: "lore", index: { terms: ["founders' day"], topics: [{ id: "town_history", label: "Town history" }] }, sourceNames: { "book-town/e-founders": "Founders Day" } },
];

export class MockBackend {
  /** The chat's latest minds run (`lre.minds`): the preview runs it one mind at a time, and the third fails as a cut-off call does. */
  private mindsRun: MindsRunView | null = null;
  /** LRE's fields on the preview's World Info entries, by entry id (Build → Lore → World Info). */
  private readonly bookLore: Record<string, BookLoreFields> = {};
  private view: StateView | null = null;
  private rev = 0;
  private settings: UserSettings = settingsFixture();
  private world: WorldDoc = worldFixture();
  private draft: WorldDoc = worldFixture();
  /** The draft's write count, as the backend keeps it: 0 while the draft is the world. */
  private draftVersion = 0;
  /** The user's worlds as `lre.world list` reads them; a Studio install adds one or moves a head. */
  private worldList: WorldIndex[] = structuredClone(WORLDS);
  /** What each installed Studio offer became, as the bridge marks it. */
  private readonly studioInstalled = new Map<string, { worldId: string; revision: string }>();
  /** Whether `?draft=elsewhere`'s change is scheduled, and how many changes were made elsewhere. */
  private elsewhereScheduled = false;
  private elsewhereCount = 0;
  private jobs = 0;
  private gm: GmView = gmFixture();
  /** This chat's routine changes (GM → Routines), as the castlife slice keeps them. */
  private routines: PreviewRoutines = previewRoutines();
  /** The GM view and the routine changes as they were before each GM edit, by the edit's Undo chip. */
  private readonly beforeEdit = new Map<string, { gm: GmView; routines: PreviewRoutines }>();
  /** Kept jobs (`lre.job list`): an import a restart cut off after its first chunk. */
  private kept: JobSummary[] = [{ jobId: "job-kept", kind: "import_lore", worldId: WORLDS[0]?.id ?? "", status: "interrupted", progress: 0.5, message: "Interrupted by a restart. The 2 proposal(s) it made before it stopped are below; run it again for the rest.", result: { proposals: PROPOSALS.slice(0, 2) }, input: { bookIds: ["book-1"] }, at: Date.now() - 600_000 }];
  /** The active preset as the backend reads it: one section outlet placed, one unknown, and guidance blocks in each state. */
  private presetCard: PresetCard = {
    preset: { id: "preset-main", name: "Maple's preset" },
    outlets: [
      { outlet: "lre_scene", label: "Scene" },
      { outlet: "lre_extra", label: null },
    ],
    blocks: [
      { target: "narrator", name: "RPEngine · narrator", state: "read" },
      { target: "brief", name: "RPEngine · brief", state: "empty" },
      { target: "extract", name: "RPEngine · extract", state: "missing" },
      { target: "interpret", name: "RPEngine · interpret", state: "enabled" },
    ],
  };
  readonly log: FrontendToBackend[] = [];

  constructor(private readonly emit: Emit, private readonly options: MockOptions) {}

  /** Describe a map's proposal as the backend's job makes it, with a small grid map standing in for the helper's answer. */
  private mapProposals(input: JsonObject) {
    const request = readMapRequest(this.draft, input);
    const answer = readMapAnswer(this.draft, request, mapTemplate("grid", request.mapId, request.scope) as unknown as JsonValue);
    return answer.map === null ? [] : [mapProposal(request, { ...answer, map: answer.map })];
  }

  /** Replaces the view and pushes the change as a delta. */
  mutate(change: (view: StateView) => void, delayMs = 0): void {
    const apply = () => {
      if (!this.view) return;
      const before = structuredClone(this.view);
      change(this.view);
      const ops: DeltaOp[] = [];
      diffOps(before, this.view, [], ops);
      if (ops.length === 0) return;
      const base = this.rev;
      this.rev += 1;
      this.emit({ lre: 1, type: "lre.state.delta", chatId: this.view.chatId, base, rev: this.rev, ops });
    };
    if (delayMs > 0) setTimeout(apply, delayMs);
    else apply();
  }

  /** Pushes a delta with a wrong base, to show the resync path in the harness log. */
  pushStaleDelta(): void {
    if (!this.view) return;
    this.emit({ lre: 1, type: "lre.state.delta", chatId: this.view.chatId, base: this.rev + 5, rev: this.rev + 6, ops: [] });
  }

  /**
   * Another window (or an outside agent) changes the draft Build holds, as the backend announces it
   * (`lre.draft.changed`, DESIGN §23): Rosie's mood moves on and the world is renamed, so a form
   * holding edits over either shows Build's "changed elsewhere" notice.
   */
  changeDraftElsewhere(worldId: string = this.worldList[0]?.id ?? ""): void {
    this.elsewhereCount += 1;
    const rosie = this.draft.entities.npc_rosie;
    if (rosie) rosie.fields = { ...rosie.fields, mood: ["tense", "happy", "calm"][(this.elsewhereCount - 1) % 3] ?? "tense" };
    this.draft.name = this.elsewhereCount % 2 === 1 ? `${this.world.name}, Ohio` : this.world.name;
    this.draft = compileMaps(this.draft);
    // A write elsewhere counts one, as every write does.
    this.draftVersion += 1;
    this.emit({ lre: 1, type: "lre.draft.changed", worldId, version: this.draftVersion, stored: JSON.stringify(this.draft) !== JSON.stringify(this.world), base: this.worldList[0]?.head ?? null });
  }

  /** An offer as the backend reviews it (`Dispatcher.reviewOffer`): read as this engine reads it, linted, its macros listed, and what keeps it from installing. */
  private reviewOffer(offer: StudioOffer, hash: string): { view: StudioOfferView; world: WorldDoc | null } {
    const installed = this.studioInstalled.get(offer.offerId);
    const view: StudioOfferView = { offerId: offer.offerId, mode: offer.mode, name: isRecord(offer.doc) && typeof offer.doc.name === "string" ? offer.doc.name : "(unnamed)", createdAt: offer.createdAt, target: null, counts: {}, lint: [], errors: 0, macros: [], attachChatId: offer.attachChatId ?? null, blocked: null, installed: installed ?? null, headMoved: null, hash };
    if (!isWorldDoc(offer.doc)) return { view: { ...view, blocked: "It isn't an lre-world-v1 document." }, world: null };
    const world = migrateWorld(structuredClone(offer.doc));
    const lint = lintWorld(world, REGISTRY);
    const rank = { error: 0, warning: 1, info: 2 };
    view.lint = [...lint].sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 50);
    view.errors = lint.filter((i) => i.severity === "error").length;
    view.macros = macroReview(world);
    for (const [collection, items] of Object.entries(world)) {
      const count = hasOwn(WORLD_COLLECTIONS, collection) && isRecord(items) ? Object.keys(items).length : 0;
      if (count > 0) view.counts[collection] = count;
    }
    if (view.errors > 0) view.blocked = `It has ${view.errors} error${view.errors === 1 ? "" : "s"}; fix ${view.errors === 1 ? "it" : "them"} in LumiRPEngine Studio first.`;
    if (offer.mode === "revision" && offer.worldId !== undefined) {
      const index = this.worldList.find((w) => w.id === offer.worldId);
      view.target = { worldId: offer.worldId, name: index?.name ?? null };
      if (!index) view.blocked ??= "The world it's a revision of isn't one of your worlds.";
      else if (JSON.stringify(this.draft) !== JSON.stringify(this.world)) view.blocked ??= `Build has unsaved changes to “${index.name}”: commit or discard them first.`;
      if (index && offer.baseRevision !== index.head) view.headMoved = { base: offer.baseRevision ?? null, head: index.head };
    }
    return { view, world };
  }

  /** LumiRPEngine Studio's offer as the backend serves it (`Dispatcher.studio`): reviewed on `offer`, installed only on `install`. */
  private studio(reqId: string, message: Extract<FrontendToBackend, { type: "lre.studio" }>): void {
    const offer = studioOfferFixture(this.options.studio ?? "none", this.view?.chatId ?? "chat-1");
    if (!offer) {
      if (message.op === "offer") return this.result(reqId, "lre.studio", { offer: null, message: "LumiRPEngine Studio has no world waiting for you." });
      return this.error(reqId, "not_found", "LumiRPEngine Studio has no world waiting for you.");
    }
    const hash = hashJson(offer);
    const { view, world } = this.reviewOffer(offer, hash);
    if (message.op === "offer") return this.result(reqId, "lre.studio", { offer: view });
    const refuse = (code: string, text: string, lint?: LintIssue[]): void => void setTimeout(() => this.emit({ lre: 1, type: "lre.error", reqId, code, message: text, ...(lint ? { lint } : {}) }), 30);
    if (offer.offerId !== message.offerId || hash !== message.hash) return refuse("conflict", "LumiRPEngine Studio offers something else now; review it again.");
    if (view.installed) return refuse("conflict", "This offer is already installed.");
    if (view.blocked !== null || world === null) return refuse(view.errors > 0 ? "validation" : "conflict", view.blocked ?? "not an lre-world-v1 document", view.errors > 0 ? view.lint : undefined);
    if (view.headMoved && message.acceptMovedHead !== true) return refuse("conflict", "The world changed in Build since LumiRPEngine Studio took it; review the offer again and confirm to install anyway.");
    // The preview models one world, as `create` does: the installed one becomes it.
    const index = offer.mode === "revision" ? this.worldList.find((w) => w.id === offer.worldId) : undefined;
    const worldId = index?.id ?? `w-studio-${this.studioInstalled.size + 1}`;
    this.world = compileMaps({ ...world, id: worldId });
    this.draft = structuredClone(this.world);
    const revision = hashJson(this.world).slice(0, 32);
    if (index) {
      index.head = revision;
      index.revisions = [...index.revisions, revision];
    } else this.worldList = [...this.worldList, { id: worldId, name: this.world.name, head: revision, loreBookId: null, revisions: [revision] }];
    this.studioInstalled.set(offer.offerId, { worldId, revision });
    this.result(reqId, "lre.studio", { installed: { offerId: offer.offerId, mode: offer.mode, worldId, name: this.world.name, revision, attachChatId: offer.attachChatId ?? null }, lint: macroReview(this.world) });
    // A revision moves the head under no draft: the working copy takes the next version, and every Build is told after the reply.
    if (index) {
      this.draftVersion += 1;
      setTimeout(() => this.emit({ lre: 1, type: "lre.draft.changed", worldId, version: this.draftVersion, stored: false, base: revision }), 40);
    }
  }

  /**
   * Pay another way on the declined payment (`c-decline`), as the backend tries it (DESIGN §9.5):
   * savings, then a card, then checking, then cash; the first with room for it pays (a card up to
   * what's available on it, any other account up to what it holds). False when none has room.
   */
  private payAnotherWay(): boolean {
    const money = decodeFinanceView(this.view?.panels["economy.money"] ?? null);
    if (!money) return false;
    const cents = DECLINED_PURCHASE.cents;
    const tries: readonly ((a: AccountView) => boolean)[] = [(a) => a.class === "savings", (a) => CLASS_TRAITS[a.class].revolving, (a) => a.class === "checking", (a) => CLASS_TRAITS[a.class].cash];
    const source = tries.flatMap((is) => money.accounts.filter((a) => a.status === "open" && is(a))).find((a) => (a.available ?? a.cents) >= cents);
    if (!source) return false;
    const liability = CLASS_TRAITS[source.class].liability;
    this.mutate((view) => {
      const panel = decodeFinanceView(view.panels["economy.money"] ?? null);
      if (!panel) return;
      const line: JournalLine = { id: "preview:pay-another-way", at: view.hud?.clock.label ?? "", memo: DECLINED_PURCHASE.name, cents: -cents, account: source.name, accountId: source.id, kind: "purchase", category: null, counterparty: null, card: null, status: "posted" };
      const accounts = panel.accounts.map((a) => (a.id === source.id ? { ...a, cents: a.cents - cents, available: a.available === null ? null : a.available - cents, transactions: [line, ...a.transactions] } : a));
      // A total the level doesn't show stays unknown.
      const less = (total: number | null, by: number): number | null => (total === null ? null : total - by);
      const overview = panel.overview ? { ...panel.overview, netWorth: less(panel.overview.netWorth, cents), assets: less(panel.overview.assets, liability ? 0 : cents), liabilities: less(panel.overview.liabilities, liability ? -cents : 0) } : null;
      const cash = panel.cash !== null && "cents" in panel.cash && CLASS_TRAITS[source.class].cash ? { cents: panel.cash.cents - cents } : panel.cash;
      const paid: FinanceView = { ...panel, accounts, overview, cash, recent: [line, ...panel.recent] };
      view.panels["economy.money"] = paid as unknown as JsonValue;
    }, 60);
    return true;
  }

  private snapshot(): void {
    if (!this.view) return;
    this.rev += 1;
    this.emit({ lre: 1, type: "lre.state.snapshot", chatId: this.view.chatId, rev: this.rev, view: structuredClone(this.view) });
  }

  private result<K extends keyof ResultBodies>(reqId: string, request: K, body: ResultBodies[K]): void {
    setTimeout(() => this.emit({ lre: 1, type: "lre.result", reqId, request, body }), 30);
  }

  private error(reqId: string, code: string, message: string): void {
    setTimeout(() => this.emit({ lre: 1, type: "lre.error", reqId, code, message }), 30);
  }

  /** Applies a GM edit to the GM view and words it for the Journal; a string is why it was refused (nothing applied). */
  private applyEdit(ops: EditOp[]): string[] | string {
    const gm = structuredClone(this.gm);
    const routines = structuredClone(this.routines);
    const find = (id: string) => gm.entities.find((e) => e.id === id);
    const name = (id: string | null) => (id === null ? "nowhere" : (find(id)?.name ?? gm.places.find((p) => p.id === id)?.name ?? id));
    const lines: string[] = [];
    for (const op of ops) {
      if (op.op === "spawn") {
        const id = op.id ?? `${op.kind}:${gm.entities.length}`;
        gm.entities.push({ id, name: op.name, kind: op.kind, tier: op.tier ?? "background", agent: op.agent ?? false, pov: false, person: op.kind === "person", gone: false, spawned: true, visibility: "public", place: op.place ?? null, holder: null, claimed: false, fields: [], relations: [], levels: [], class: {}, tags: [], sheet: null, life: { state: "alive", label: "Alive", acts: true, everyone: true, aware: [], unaware: [] } });
        lines.push(`${op.name} is here`);
        continue;
      }
      if (op.op === "stage") {
        const track = gm.tracks.find((t) => t.id === op.track);
        if (!track) return `There's no track ${op.track}.`;
        track.stage = op.to;
        lines.push(`${track.label}: ${track.stages.find((s) => s.id === op.to)?.label ?? op.to}`);
        continue;
      }
      // No engine here to run a pack's effect: the preview notes it and changes nothing.
      if (op.op === "effect") {
        lines.push(`Ran ${op.effect.replace(/[._]/g, " ")}`);
        continue;
      }
      // Section settings shape only the prompt, which the preview doesn't build.
      if (op.op === "feed") {
        lines.push(`The ${op.section} section's settings changed`);
        continue;
      }
      const id = op.op === "link" || op.op === "unlink" ? op.from : op.op === "adjust" ? op.account : op.entity;
      const entity = find(id);
      if (!entity) return `${id} isn't in the world.`;
      switch (op.op) {
        case "set":
        case "add": {
          const field = entity.fields.find((f) => f.id === op.field);
          if (!field || field.derived) return `${entity.name} has no ${op.field} to change.`;
          const value = op.op === "set" ? op.value : Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, (typeof field.value === "number" ? field.value : 0) + op.delta));
          if (typeof value === "number" && (value < (field.min ?? -Infinity) || value > (field.max ?? Infinity))) return `${entity.name}'s ${field.label.toLowerCase()} must be between ${field.min ?? "…"} and ${field.max ?? "…"}.`;
          field.value = value;
          lines.push(`${entity.name}'s ${field.label.toLowerCase()}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
          break;
        }
        case "link":
        case "unlink":
          entity.relations = entity.relations.filter((r) => !(r.type === op.rel && r.to === op.to));
          if (op.op === "link") entity.relations.push({ type: op.rel, to: op.to, toName: name(op.to), ...(op.fields ? { fields: op.fields } : {}) });
          lines.push(`${entity.name} ${op.op === "link" ? "now" : "no longer"}: ${op.rel.replace(/_/g, " ")} ${name(op.to)}`);
          break;
        case "move":
        case "put":
          entity.holder = op.op === "put" ? op.into : null;
          if (op.op === "move") entity.place = op.to;
          lines.push(op.op === "move" ? `${entity.name} is at ${name(op.to)}` : op.into === null ? `${entity.name} was taken out` : `${entity.name} is in ${name(op.into)}`);
          break;
        case "adjust":
          entity.balance = (entity.balance ?? 0) + op.cents;
          for (const m of gm.money) for (const a of m.accounts) if (a.id === op.account) a.cents += op.cents;
          lines.push(`${entity.name}: correction ${op.cents > 0 ? "+" : ""}${(op.cents / 100).toFixed(2)}`);
          break;
        case "entity":
          if (op.tier !== undefined) entity.tier = op.tier;
          if (op.agent !== undefined) entity.agent = op.agent;
          for (const l of entity.levels) if (op.levels && l.domain in op.levels) l.override = op.levels[l.domain] ?? null;
          lines.push(`${entity.name}'s simulation changed`);
          break;
        case "classify":
          entity.class = op.class;
          entity.tags = op.tags;
          lines.push(`${entity.name}'s classification changed`);
          break;
        case "life": {
          const def = gm.lifeStates.find((s) => s.id === (op.to ?? entity.life.state));
          if (!def) return `There's no life state ${op.to ?? ""}.`;
          const told = (op.tell ?? []).map((t) => ({ id: t, name: name(t) }));
          entity.life = op.to !== undefined && op.to !== entity.life.state ? { state: def.id, label: def.label, acts: def.acts, everyone: false, aware: told, unaware: [] } : { ...entity.life, aware: [...entity.life.aware, ...told] };
          lines.push(`${entity.name}: ${def.label}`);
          break;
        }
        case "despawn":
        case "restore":
          entity.gone = op.op === "despawn";
          lines.push(`${entity.name} is ${entity.gone ? "gone" : "back"}`);
          break;
        case "mind_pin": {
          // As the minds pack's pin: the level they're held at, or back to going by their score.
          const c = gm.minds.characters.find((x) => x.entity === op.entity);
          if (c) c.fidelity = { ...c.fidelity, level: op.level ?? c.fidelity.level, pin: { ...c.fidelity.pin, gm: op.level } };
          lines.push(op.level === null ? `${entity.name}'s mind: unpinned` : `${entity.name}'s mind: pinned to ${op.level.charAt(0).toUpperCase()}${op.level.slice(1)}`);
          break;
        }
        case "routine_follow":
        case "routine_block":
        case "schedule_override":
          lines.push(applyRoutineOp(routines, op, entity.name, gm.minds.now));
          break;
      }
    }
    this.gm = gm;
    this.routines = routines;
    return lines;
  }

  receive(message: FrontendToBackend): void {
    this.log.push(message);
    const reqId = message.reqId;
    switch (message.type) {
      case "lre.hello":
        if (message.chatId === null) {
          this.result(reqId, "lre.hello", { accepted: true, agentApi: AGENT_API, requestMs: this.settings.timeouts.requestMs, canStop: true });
          return;
        }
        this.view = this.options.scenario === "paused" ? pausedFixture(message.chatId) : this.options.scenario === "fresh" ? freshFixture(message.chatId) : stateFixture(message.chatId);
        if (this.options.scenario === "not_world") this.view = { ...stateFixture(message.chatId), status: "not_world", hud: null, scene: null, chips: [], panels: {}, palette: null, controls: null };
        else if (this.options.map) this.view.panels["space.map"] = starterMap(this.options.map);
        const money = this.options.money && this.options.scenario !== "not_world" ? portAlderMoney(this.options.money) : null;
        if (money) {
          this.view.panels["economy.money"] = money.play;
          // The GM's money pages read entities, kinds and places too (a business's fields, Add a job's employers, a payee): all Port Alder's, with its money.
          this.gm = { ...this.gm, ...money.gm };
        }
        if (this.options.scenario === "combat") {
          const fight = combatFixture();
          this.view.panels["combat.encounter"] = fight.panel;
          this.view.packs.combat = 1;
          if (this.view.palette) this.view.palette = { ...this.view.palette, entries: [...fight.entries, ...this.view.palette.entries], ...(fight.encounter ? { encounter: fight.encounter } : {}) };
          this.gm = { ...this.gm, encounter: fight.gm };
        }
        // Play → You with the Modern profile's sheet, as the engine builds it.
        if (this.options.scenario === "sheet") this.view.panels["sheets.you"] = modernSheetFixture();
        this.result(reqId, "lre.hello", { accepted: true, agentApi: AGENT_API, requestMs: this.settings.timeouts.requestMs, canStop: true });
        setTimeout(() => this.snapshot(), 50);
        if (this.options.activity) setTimeout(() => this.activity(this.options.activity === "busy" ? { state: "running", label: "Asking 3 minds…", since: Date.now() - 12_000 } : { state: "failed", label: "Failed: Planning", since: Date.now() - 60_000 }), 80);
        return;
      case "lre.state.resync":
        this.result(reqId, "lre.state.resync", { accepted: true });
        setTimeout(() => this.snapshot(), 50);
        return;
      case "lre.chip": {
        const chip = this.view?.chips.find((c) => c.id === message.chip);
        if (!chip) return this.error(reqId, "not_found", "That chip has expired.");
        const undone = chip.kind === "fix" ? this.beforeEdit.get(chip.id) : undefined;
        if (undone) {
          this.gm = undone.gm;
          this.routines = undone.routines;
        }
        if (chip.kind === "decline" && message.choice === "other" && !this.payAnotherWay()) return this.error(reqId, "validation", "No other way to pay covers it.");
        this.result(reqId, "lre.chip", { applied: true, pending: false });
        this.mutate((view) => {
          view.chips = view.chips.filter((c) => c.id !== message.chip);
          if (chip.kind === "fix") view.journal = view.journal.filter((n) => !(n.kind === "fix" && n.text === chip.detail));
          if (chip.kind === "confirm" && message.choice === "confirm") view.journal.push({ kind: "note", messageId: chip.messageId, ref: null, text: `Confirmed: ${chip.label}` });
          if (chip.kind === "keep_report" && (message.choice === "keep" || message.choice === "discard")) {
            view.status = "idle";
            view.keepReport = [];
            view.journal.push({ kind: message.choice === "discard" ? "tombstoned" : "note", messageId: chip.messageId, ref: null, text: message.choice === "discard" ? "Discarded the turns after your edit." : "Kept the turns after your edit." });
          }
        }, 60);
        return;
      }
      case "lre.keep":
        this.result(reqId, "lre.keep", { pending: false });
        this.mutate((view) => {
          if (message.choice === "convert") {
            view.keepReport = view.keepReport.map((line) => ("marker" in line.ref || JSON.stringify(line.ref) !== JSON.stringify(message.refs[0]) ? line : { ...line, status: "converted" }));
            return;
          }
          view.status = "idle";
          view.chips = view.chips.filter((c) => c.kind !== "keep_report");
          view.keepReport = [];
          view.journal.push({ kind: message.choice === "discard" ? "tombstoned" : "note", messageId: message.messageId, ref: null, text: message.choice === "discard" ? "Discarded the turns after your edit." : "Kept the turns after your edit." });
        }, 60);
        return;
      case "lre.action":
        this.result(reqId, "lre.action", { messageId: `m-${Date.now()}` });
        this.mutate((view) => {
          view.status = "in_flight";
        }, 40);
        // The activity line through a turn's steps, as the backend pushes it.
        for (const [label, ms] of [["Planning…", 40], ["Reading your action…", 250], ["Asking 3 minds…", 450], ["Filling the prompt…", 700]] as const) setTimeout(() => this.activity({ state: "running", label, since: Date.now() - ms }), ms);
        setTimeout(() => this.activity(null), 900);
        this.mutate((view) => {
          view.status = "idle";
          if (view.hud) {
            view.hud.clock.minutes += 5;
            view.hud.clock.label = "Tue 07:47";
          }
          view.journal.push({ kind: "note", messageId: "m5", ref: null, text: `Action: ${message.action} ${JSON.stringify(message.params)}` });
        }, 900);
        return;
      case "lre.gm":
        return this.result(reqId, "lre.gm", structuredClone(this.gm));
      case "lre.character": {
        // The real builder: Build's from the draft; GM's from the preview world as a chat starts it,
        // with each entity's place, holder and relations as the GM fixture has them now, so edits show.
        if (message.scope === "build") {
          const built = buildCharacter(REGISTRY, migrateWorld(structuredClone(this.draft)), message.entity);
          return built ? this.result(reqId, "lre.character", built) : this.error(reqId, "not_found", "no such character");
        }
        const world = migrateWorld(structuredClone(this.world));
        const state = initialState(world, "preview", REGISTRY);
        for (const g of this.gm.entities) {
          const e = state.entities[g.id];
          if (!e) continue;
          if (g.place !== null) e.fields.place = g.place;
          e.relations = [...(g.holder ? [{ type: "in", to: g.holder }] : []), ...g.relations.filter((r) => r.type !== "in").map((r) => ({ type: r.type, to: r.to, ...(r.fields ? { fields: structuredClone(r.fields) } : {}) }))];
        }
        const built = buildCharacter(REGISTRY, world, message.entity, state);
        return built ? this.result(reqId, "lre.character", built) : this.error(reqId, "not_found", "no such character");
      }
      case "lre.edit": {
        const before = { gm: structuredClone(this.gm), routines: structuredClone(this.routines) };
        const lines = this.applyEdit(message.ops);
        if (typeof lines === "string") return this.error(reqId, "validation", lines);
        const seq = (before.gm.edits[0]?.seq ?? 0) + 1;
        const chip = `fix:m4:0:${seq}`;
        this.gm.edits.unshift({ messageId: "m4", seq, lines, undo: chip });
        this.beforeEdit.set(chip, before);
        this.result(reqId, "lre.edit", { pending: false });
        this.mutate((view) => {
          view.chips.push({ id: chip, kind: "fix", messageId: "m4", label: "GM edit", detail: lines.join(" · "), actions: [{ id: "undo", label: "Undo", style: "danger" }], expires: "next_send" });
          view.journal.push({ kind: "fix", messageId: "m4", ref: { in: "post", seq, index: 0 }, text: lines.join(" · ") });
        }, 40);
        return;
      }
      case "lre.fix":
        this.result(reqId, "lre.fix", { pending: false });
        this.mutate((view) => {
          if (!view.hud) return;
          // The clock's ✎: the pill reads the date and time set, as the backend's would.
          if ("time" in message) {
            view.hud.clock.label = message.time;
            if (view.hud.fixes.time) view.hud.fixes.time.value = message.time;
            return;
          }
          if (message.field === "cash" && typeof message.value === "number") view.hud.cash = { cents: message.value };
          const fix = Object.values(view.hud.fixes).find((f) => f?.type !== "time" && f?.entity === message.entity && f.field === message.field);
          if (fix) fix.value = message.value;
          if (message.field === "place") {
            const option = view.hud.fixes.place?.options?.find((o) => o.value === message.value);
            if (option) view.hud.place = { id: String(message.value), name: option.label };
          }
          if (message.field === "weather") {
            const option = view.hud.fixes.weather?.options?.find((o) => o.value === message.value);
            if (option) view.hud.weather = `${option.label}, 12 °C`;
          }
          // An empty scene type follows the place again (the diner's conversation).
          if (message.field === "scene" && view.scene && view.controls && typeof message.value === "string") {
            view.scene.sceneType = message.value || "conversation";
            view.controls.time.sceneType = view.scene.sceneType;
          }
        }, 40);
        return;
      case "lre.marker":
        if (message.kind === "migrate" && message.preview) {
          this.result(reqId, "lre.marker", { pending: false, preview: { lines: [{ text: `The chat moves to revision ${message.to.slice(0, 8)} of Maple Falls from the next turn.`, tone: "info" }], upgrade: structuredClone(UPGRADE_PREVIEW) } });
          return;
        }
        if (message.kind === "resolve" && message.preview) {
          const current = this.view?.controls?.realism.levels[message.domain] ?? 0;
          const lines: { text: string; tone: "freeze" | "promote" | "materialize" | "info" }[] =
            message.to < current
              ? [{ text: `“can_afford(pov, …)” in rule payday freezes at its current value`, tone: "freeze" }, { text: "Background characters keep their bands; balances stop updating", tone: "info" }]
              : [{ text: "Accounts and cards appear for principal characters", tone: "promote" }, { text: "Rosie and Dev get balances inside their current wealth bands when first shown", tone: "materialize" }];
          this.result(reqId, "lre.marker", { pending: false, preview: { lines } });
          return;
        }
        if (message.kind === "infer" && message.preview) {
          this.result(reqId, "lre.marker", { pending: false, preview: { lines: [{ text: "Typed attempts are read as checks this way from the next turn; earlier turns keep how theirs were read.", tone: "info" }] } });
          return;
        }
        this.result(reqId, "lre.marker", { pending: false });
        this.mutate((view) => {
          if (message.kind === "time" && message.control === "pause" && view.hud && view.controls) {
            view.hud.clock.paused = message.to === true;
            view.controls.time.paused = message.to === true;
          }
          if (message.kind === "time" && message.control === "scale" && view.controls && view.hud && typeof message.to === "number") {
            view.controls.time.scale = message.to;
            view.hud.clock.scale = message.to;
          }
          if (message.kind === "resolve" && view.controls && "all" in message.scope) view.controls.realism.levels[message.domain] = message.to;
          if (message.kind === "adjudicate" && view.controls) view.controls.adjudication = message.to;
          if (message.kind === "infer" && view.controls) view.controls.inferred = structuredClone(message.to);
          if (message.kind === "claims" && view.controls) view.controls.realism.claims = { ...message.to };
        }, 40);
        return;
      case "lre.view.open":
        // Opening a pack panel materializes the POV's detail there; for money that posts the opening
        // balances the panel already shows, so the view doesn't change.
        this.result(reqId, "lre.view.open", { materialized: message.panel !== "core.context", pending: false });
        return;
      case "lre.settings.get":
        this.result(reqId, "lre.settings.get", { settings: structuredClone(this.settings), extraction: extractionView(this.settings) });
        return;
      case "lre.settings.caveats":
        // A dry run takes a moment: the home badge and the Caveats page show they're checking.
        setTimeout(
          () =>
            this.result(reqId, "lre.settings.caveats", {
              caveats: [
                { code: "step_model_missing", message: "These name a model their connection doesn't list, so their calls may fail the turn: Scene brief (gpt-old on OpenRouter). Pick another in Settings → Steps and connections." },
                { code: "step_model_unchecked", message: "Their connections didn't answer within the Preset check timeout, so these weren't checked: Prose outline. Open Caveats again in a moment." },
                { code: "preset_json_ledger", message: "Your active preset “Default” has an enabled block “Caravan Ledger” that asks the narrator for JSON; replies will carry it. Turn it off in the preset if you don't want it." },
              ],
            }),
          900,
        );
        return;
      case "lre.settings.set": {
        const next = mergePatch(this.settings, message.patch) as UserSettings;
        const preset = next.realism.preset;
        const levels = REALISM_PRESETS[preset];
        if (isRecord(message.patch.realism) && message.patch.realism.preset && levels) next.realism.levels = { ...next.realism.levels, ...(levels as UserSettings["realism"]["levels"]) };
        // A named preset carries its own player claims, as the real settings store's do.
        if (isRecord(message.patch.realism) && message.patch.realism.preset && preset !== "custom") next.realism.claims = { ...CLAIM_PRESETS[preset] };
        // A merge patch drops a policy's null skills list; the store reads it back as every skill.
        next.inferred = readInferred(next.inferred);
        this.settings = next;
        this.result(reqId, "lre.settings.set", { settings: structuredClone(this.settings), extraction: extractionView(this.settings) });
        return;
      }
      case "lre.world":
        switch (message.op) {
          case "list":
            return this.result(reqId, "lre.world", { worlds: structuredClone(this.worldList) });
          case "get":
            return this.result(reqId, "lre.world", {
              world: structuredClone(this.world),
              lint: [],
              functions: formulaFunctions(REGISTRY),
              packKinds: {
                thing: { id: "thing", label: "Thing", pack: "space", fields: {} },
                person: { id: "person", label: "Person", extends: "thing", pack: "space", fields: {} },
                container: { id: "container", label: "Container", pack: "gear", fields: { capacity_l: { type: "number" }, stock: { type: "text" } } },
                vehicle: { id: "vehicle", label: "Vehicle", pack: "vehicles", fields: { fuel: { type: "number" } } },
                group: { id: "group", label: "Group", extends: "thing", pack: "relationships", fields: {} },
                faction: { id: "faction", label: "Faction", extends: "group", pack: "relationships", fields: {} },
                family: { id: "family", label: "Family", extends: "group", pack: "relationships", fields: {} },
                household: { id: "household", label: "Household", extends: "group", pack: "relationships", fields: {} },
                company: { id: "company", label: "Company", extends: "group", pack: "relationships", fields: {} },
              },
              packRelations: {
                in: { id: "in", label: "In", from: "*", to: "*", cardinality: "many_one", symmetric: false, fields: {}, pack: "space" },
                member_of: { id: "member_of", label: "Member of", from: "*", to: "group", cardinality: "many_many", symmetric: false, fields: { role: { type: "text", label: "Role" }, rank: { type: "number", label: "Rank" }, since: { type: "date", label: "Since" } }, pack: "relationships" },
                knows: { id: "knows", label: "Knows", from: "*", to: "*", cardinality: "many_many", symmetric: false, fields: {}, pack: "relationships" },
                parent_of: { id: "parent_of", label: "Parent of", from: "person", to: "person", cardinality: "many_many", symmetric: false, inverse: "child_of", fields: {}, pack: "relationships" },
                child_of: { id: "child_of", label: "Child of", from: "person", to: "person", cardinality: "many_many", symmetric: false, inverse: "parent_of", fields: {}, pack: "relationships" },
                sibling_of: { id: "sibling_of", label: "Sibling of", from: "person", to: "person", cardinality: "many_many", symmetric: true, fields: {}, pack: "relationships" },
                spouse_of: { id: "spouse_of", label: "Spouse of", from: "person", to: "person", cardinality: "many_many", symmetric: true, fields: {}, pack: "relationships" },
              },
            });
          case "lint":
            return this.result(reqId, "lre.world", {
              lint: [
                { severity: "error", path: "tables.economy.catalog", code: "band_order", message: "Paper towels: the price band's typical is below its minimum." },
                { severity: "warning", path: "tracks.q_raise.stages.orphan", code: "unreachable_stage", message: "Stage “Old idea” can't be reached from the start." },
                { severity: "warning", path: "entities.npc_rosie.fields.cash", code: "frozen_predicate", message: "A rule reads Rosie's cash, which freezes at Money 1 for principal characters." },
                { severity: "info", path: "sections.scene", code: "section_size", message: "Scene section averages 142 tokens (budget 600)." },
              ],
            });
          case "templates":
            return this.result(reqId, "lre.world", { templates: STARTER_INFO.map((info) => ({ ...info })) });
          case "create": {
            // The preview models one world: the created one becomes it, so Build opens under the new name.
            this.world = { ...structuredClone(this.world), id: "w-new", name: message.name };
            this.draft = structuredClone(this.world);
            return this.result(reqId, "lre.world", { world: structuredClone(this.world) });
          }
          case "commit":
            if (message.version !== undefined && message.version !== this.draftVersion) return this.error(reqId, "conflict", `the draft changed since you read it (it is at version ${this.draftVersion} now); review it and commit again`);
            this.world = structuredClone(this.draft);
            return this.result(reqId, "lre.world", { revision: `r${Date.now().toString(16)}`, lint: [] });
          case "export":
            return this.result(reqId, "lre.world", { file: this.world as unknown as JsonValue });
          case "import":
          case "delete":
          case "attach":
          case "upgrade":
            return this.result(reqId, "lre.world", {});
          case "sheet": {
            // As the backend does: the draft with the unsaved ruleset, read on the POV unless another entity is named, and the skills its sheet has.
            const world: WorldDoc = { ...structuredClone(this.draft), ruleset: isRecord(message.ruleset) ? (message.ruleset as unknown as WorldDoc["ruleset"]) : undefined };
            return this.result(reqId, "lre.world", { sheet: previewSheet(REGISTRY, world, message.entity), skills: previewSkills(REGISTRY, world) });
          }
        }
        return;
      case "lre.editor": {
        // As the backend does: Build's first draft load starts `?draft=elsewhere`'s clock.
        if (message.op === "get" && this.options.draftElsewhereMs !== undefined && !this.elsewhereScheduled) {
          this.elsewhereScheduled = true;
          setTimeout(() => this.changeDraftElsewhere(message.worldId), this.options.draftElsewhereMs);
        }
        // A write names the version it read; one over a change it hasn't loaded is refused.
        if (message.op !== "get" && message.version !== undefined && message.version !== this.draftVersion) return this.error(reqId, "conflict", `the draft changed since you read it (it is at version ${this.draftVersion} now); reload and retry`);
        const doc = this.draft as unknown as Record<string, Record<string, JsonValue>>;
        if (message.op === "discard") this.draft = structuredClone(this.world);
        else if (message.op === "put") (doc[message.collection] ??= {})[message.id] = message.value;
        else if (message.op === "remove") delete doc[message.collection]?.[message.id];
        // A draft patch (the Character page's save, batch edits) applies as the backend applies one.
        else if (message.op === "patch") this.draft = applyPatch(this.draft as unknown as JsonValue, message.ops) as unknown as WorldDoc;
        else if (message.op === "set" && message.part === "meta" && isRecord(message.value)) Object.assign(this.draft, message.value);
        else if (message.op === "set" && message.part === "tiers" && isRecord(message.value) && isRecord(message.value.tiers)) {
          this.draft.tiers = structuredClone(message.value.tiers) as unknown as WorldDoc["tiers"];
          if (typeof message.value.spawnTier === "string") this.draft.spawnTier = message.value.spawnTier;
          else delete this.draft.spawnTier;
        }
        // An empty ruleset is no ruleset, as the backend stores it.
        else if (message.op === "set" && message.part === "ruleset" && isRecord(message.value) && Object.keys(message.value).length === 0) delete this.draft.ruleset;
        else if (message.op === "set") (this.draft as unknown as Record<string, JsonValue>)[message.part] = message.value;
        // As the backend does: the profile's plan applied to the draft in one write.
        else if (message.op === "profile") {
          const profile = profileOf(message.profile);
          if (profile) this.draft = applyProfile(this.draft, profile, Object.fromEntries(REGISTRY.kinds), profileChoices(message.choices));
        }
        // As the backend does on every write: the map's places, grid and routes follow it.
        this.draft = compileMaps(this.draft);
        const stored = JSON.stringify(this.draft) !== JSON.stringify(this.world);
        if (!stored) this.draftVersion = 0;
        else if (message.op !== "get") this.draftVersion++;
        const cap = this.draft.packs.economy?.config.unpricedCap;
        const capLint = cap === undefined || (typeof cap === "number" && Number.isSafeInteger(cap) && cap > 0) ? [] : [{ severity: "warning" as const, path: "packs.economy.config.unpricedCap", code: "economy.unpriced_cap", message: "The narrated-price cap should be a whole number of cents above zero; narrated prices are capped at the default, $14.00." }];
        const claimCap = this.draft.packs.economy?.config.claimCap;
        const claimCapLint = claimCap === undefined || (typeof claimCap === "number" && Number.isSafeInteger(claimCap) && claimCap > 0) ? [] : [{ severity: "warning" as const, path: "packs.economy.config.claimCap", code: "economy.claim_cap", message: "The claim cap should be a whole number of cents above zero; a capped Make it real asks first above the default, $25.00." }];
        return this.result(reqId, "lre.editor", { draft: structuredClone(this.draft), base: this.worldList[0]?.head ?? null, stored, version: this.draftVersion, lint: [{ severity: "warning", path: "tracks.q_raise.stages.orphan", code: "unreachable_stage", message: "Stage “Old idea” can't be reached from the start." }, ...capLint, ...claimCapLint, ...mapLint(this.draft)] });
      }
      case "lre.ui":
        this.options.closeDrawer();
        return this.result(reqId, "lre.ui", { done: true });
      case "lre.map": {
        const map = this.options.map;
        if (message.op === "walk") {
          // No engine here: the preview walks the grid it draws, where the backend walks the real ground.
          const grid = map ? decodeMapView(starterMap(map, "knowledge"))?.scopes.find((s) => s.grid?.pov)?.grid : undefined;
          const path = grid?.pov ? findPath(grid, grid.pov, { x: message.x, y: message.y }) : null;
          return this.result(reqId, "lre.map", { walk: grid && path ? { minutes: gridMinutes(grid, path) } : { minutes: 0, disabled: "No way there from here." } });
        }
        this.result(reqId, "lre.map", { display: message.display });
        // The backend builds the map for the chat's display, so a pick rebuilds it.
        if (map) this.mutate((view) => void (view.panels["space.map"] = starterMap(map, message.display)));
        return;
      }
      case "lre.job": {
        if (message.op === "list") return this.result(reqId, "lre.job", { jobs: this.kept.filter((j) => j.worldId === message.worldId) });
        if (message.op === "dismiss") {
          this.kept = this.kept.filter((j) => j.jobId !== message.jobId);
          return this.result(reqId, "lre.job", { jobId: message.jobId });
        }
        if (message.op === "cancel") return this.result(reqId, "lre.job", { jobId: message.jobId });
        this.jobs += 1;
        const jobId = `job-${this.jobs}`;
        const kind = message.kind;
        // Propose routines' first pass stops after Rosie (Continue); the next reads the crew.
        const after = isRecord(message.input) && typeof message.input.after === "string";
        const proposals = kind === "describe_map" ? this.mapProposals(message.input) : kind === "index_book" || kind === "index_text" ? LORE_PROPOSALS : kind === "propose_routines" ? (after ? ROUTINE_PROPOSALS.filter((p) => p.owner === "diner_crew") : ROUTINE_PROPOSALS) : PROPOSALS;
        this.result(reqId, "lre.job", { jobId });
        const update = (status: JobUpdate["status"], progress: number, extra: Partial<JobUpdate> = {}) => this.emit({ lre: 1, type: "lre.job.update", jobId, kind, status, progress, ...extra });
        setTimeout(() => update("running", 0.35, { message: kind === "playtest" ? "Turn 2 of 5" : "Reading 14 entries…" }), 200);
        setTimeout(
          () =>
            update("done", 1, {
              message: "Finished",
              result:
                kind === "playtest"
                  ? { turns: [{ user: "I ask Rosie for a raise.", reply: "Rosie sets down the coffee pot. “After the rush,” she says.", notes: ["Check persuade: 9 vs 8 (success)", "+5 min"] }, { user: "I cover Mara's shift.", reply: "The afternoon blurs into orders and refills.", notes: ["Timelapse 6 h", "Payroll accrues"] }], lint: [{ severity: "warning", path: "rules.payday", code: "no_effect", message: "Rule payday never fired in 2 turns." }] }
                  : {
                      proposals,
                      ...(kind === "propose_routines" && !after ? { next: { after: "npc_rosie" } } : {}),
                    },
            }),
          1200,
        );
        return;
      }
      case "lre.lore": {
        if (message.op === "save") {
          // As the backend does: the latest reply (or the excerpt) becomes a draft entry with a chat source.
          const content = message.text ?? "Rosie sets down the coffee pot. “After the rush,” she says, and almost smiles.";
          const id = `lore_saved_${Object.keys(this.draft.lore).length + 1}`;
          this.draft.lore[id] = { id, title: "Rosie sets down the coffee pot", content, keys: [], links: [], source: { kind: "chat", chatId: message.chatId, messageId: "m-latest" } };
          return this.result(reqId, "lre.lore", { worldId: WORLDS[0]?.id ?? "", id });
        }
        // The preview's World Info: one book attached to the chat and one that isn't, and two that share a name, as a
        // book imported on its own and the copy a character's card brought; the first GM character and where they are have pins.
        if (message.op === "books")
          return this.result(reqId, "lre.lore", {
            books: [
              { id: "book_town", name: "Town lore", attached: true, character: false, added: 1792425242 },
              { id: "book_harbor", name: "Harbor notes", attached: false, character: false, added: 1792425242 },
              { id: "book_harbor_card", name: "Harbor notes", attached: false, character: true, added: 1792425595 },
              { id: "book_lost", name: "Lost cities", attached: false, character: false, added: 1792511630 },
            ],
          });
        // As the backend does: what Save would refuse the fields for.
        if (message.op === "check") return this.result(reqId, "lre.lore", { problem: bookLoreProblem(message.fields) });
        const entriesOf = (bookId: string): LoreBookEntryView[] =>
          (bookId === "book_town" ? [ { id: "e1", title: "Town notice", disabled: true, chars: 120 }, { id: "e2", title: "Harbor hours", disabled: false, chars: 300 } ] : []).map((e) => {
            const lore = this.bookLore[e.id];
            return lore ? { ...e, lore, disabled: lore.secret === true ? true : e.disabled } : e;
          });
        if (message.op === "entries") return this.result(reqId, "lre.lore", { entries: entriesOf(message.bookId) });
        if (message.op === "fields") {
          if (message.fields === null) delete this.bookLore[message.entryId];
          else this.bookLore[message.entryId] = structuredClone(message.fields);
          return this.result(reqId, "lre.lore", { entries: entriesOf(message.bookId) });
        }
        if (message.op === "pins") {
          const who = this.gm.minds.characters[0]?.entity;
          const place = this.gm.entities.find((e) => e.id === who)?.place ?? this.gm.places[0]?.id;
          const ledger: LorePinView = { key: "lore:rosies_diner", pin: { lore: "rosies_diner" }, title: "Rosie's Diner", source: "World lore", status: "ok", secret: false };
          const notice: LorePinView = { key: "book:book_town/e1", pin: { book: "book_town", entry: "e1" }, title: "Town notice", source: "Town lore", status: "off", secret: false };
          return this.result(reqId, "lre.lore", { pins: { characters: who ? { [who]: [ledger] } : {}, places: place ? { [place]: [notice] } : {}, steps: {} } });
        }
        // The preview's "Rosie's Diner" was indexed from Town lore, whose entry has changed since.
        const content = "Rosie's opens at six and closes at two since the new lunch place opened. The booths by the window go first; the counter is for regulars.";
        const drift: Record<string, LoreDrift> = this.draft.lore.rosies_diner?.source?.kind === "book" && this.draft.lore.rosies_diner.source.hash === "stale" ? { rosies_diner: { status: "changed", content, hash: "fresh" } } : {};
        return this.result(reqId, "lre.lore", { drift: message.id === undefined || message.id === "rosies_diner" ? drift : {} });
      }
      case "lre.minds": {
        if (message.op === "status") return this.result(reqId, "lre.minds", { run: this.mindsRun });
        const current = this.mindsRun;
        if (message.op === "cancel") {
          if (current?.status === "running" && current.runId === message.runId) {
            current.status = "cancelled";
            for (const e of current.entries) if (e.status === "waiting" || e.status === "thinking") e.status = "cancelled";
            current.message = "Cancelled before every mind was asked; nothing was recorded.";
            this.emit({ lre: 1, type: "lre.minds.update", chatId: message.chatId, run: structuredClone(current) });
          }
          return this.result(reqId, "lre.minds", { run: this.mindsRun });
        }
        if (current?.status === "running") return this.error(reqId, "conflict", "A minds run is already under way in this chat: wait for it, or cancel it.");
        const chosen = this.gm.minds.characters.filter((c) => (message.who ? message.who.includes(c.entity) : c.fidelity.level === "live" || c.fidelity.level === "near"));
        if (chosen.length === 0) return this.error(reqId, "invalid", "Nobody is Live or Near here to run.");
        const run: MindsRunView = { runId: `run_${this.rev}_${chosen.length}`, status: "running", startedAt: Date.now(), entries: chosen.map((c) => ({ entity: c.entity, name: c.name, level: c.fidelity.level, status: "waiting" })), message: null, pending: false, undo: null };
        this.mindsRun = run;
        const step = (i: number): void =>
          void setTimeout(() => {
            if (run.status !== "running") return;
            const last = run.entries[i - 1];
            if (last) {
              Object.assign(last, i === 3 ? { status: "failed", reason: "the answer was cut off at 900 tokens before it said anything", ms: 30_400, tokens: 900 } : { status: "recorded", ms: 4_200 + i * 310, tokens: 412, pinned: [{ title: "Rosie's Diner", tokens: 96, cut: false }] });
            }
            const next = run.entries[i];
            if (next) next.status = "thinking";
            else {
              run.status = run.entries.some((e) => e.status === "recorded") ? "done" : "failed";
              run.undo = run.status === "done" ? "fix:preview:minds-run" : null;
              if (run.status === "failed") run.message = "No mind came back, so nothing was recorded.";
            }
            this.emit({ lre: 1, type: "lre.minds.update", chatId: message.chatId, run: structuredClone(run) });
            if (next) step(i + 1);
          }, 900);
        step(0);
        return this.result(reqId, "lre.minds", { run: structuredClone(run) });
      }
      case "lre.studio":
        return this.studio(reqId, message);
      case "lre.preset": {
        // As the backend does: Add creates the missing guidance blocks (empty, switched off); every op answers with the card.
        if (message.op === "add") this.presetCard = { ...this.presetCard, blocks: this.presetCard.blocks.map((block) => (block.state === "missing" ? { ...block, state: "empty" } : block)) };
        return this.result(reqId, "lre.preset", { card: structuredClone(this.presetCard) });
      }
      case "lre.diag":
        if (message.op === "dismiss") this.activity(null);
        return this.result(reqId, "lre.diag", { records: message.op === "clear" ? [] : diagnosticsFixture(), activity: null });
      case "lre.routine": {
        // Cast's usual day: someone's day as the POV may know it.
        if (message.op === "day" && message.view === "player") return this.result(reqId, "lre.routine", { player: routinePlayerFixture(message.entity) });
        // GM → Routines reads everyone this chat changed, and one character's day as the GM reads it.
        if (message.op === "changed") return this.result(reqId, "lre.routine", { changed: routineChangedFixture(this.routines, this.gm) });
        if (message.view !== "gm") return this.result(reqId, "lre.routine", {});
        const gm = routineGmFixture(message.entity, this.routines, this.gm);
        return gm ? this.result(reqId, "lre.routine", { gm }) : this.error(reqId, "not_found", `${message.entity} isn't a character.`);
      }
    }
  }

  /** Pushes the chat's activity line (`lre.activity`). */
  private activity(activity: { state: "running" | "failed"; label: string; since: number } | null): void {
    const chatId = this.view?.chatId;
    if (chatId) this.emit({ lre: 1, type: "lre.activity", chatId, activity: activity ? { chatId, turn: "gen-preview", ...activity } : null });
  }
}

/** Two turns as the backend records them: the newer one's outline cut off at max tokens, the older one clean; and a slow view. */
function diagnosticsFixture(): DiagRecord[] {
  const t = Date.now() - 120_000;
  const call = (purpose: string, tokensOut: number, finishReason: string, ms: number): DiagCall => ({ purpose, via: "helper", connection: "active", model: "deepseek-v4-flash", tokensIn: 6200, tokensOut, finishReason, maxTokens: 2000, ms, ok: true });
  const step = (seq: number, turn: string, phase: DiagRecord["phase"], name: string, start: number, ms: number, more: Partial<DiagRecord> = {}): DiagRecord => ({ seq, kind: "step", level: "info", turn, phase, step: name, status: "ok", start: t + start, end: t + start + ms, ms, ...more });
  return [
    step(1, "gen-a1b2c3d4", "pre", "pre", 0, 4100, { calls: [call("interpret", 180, "stop", 2100), call("mind", 420, "stop", 3900), call("mind", 380, "stop", 3600), call("mind", 510, "stop", 4000)] }),
    step(2, "gen-a1b2c3d4", "plan", "plan", 4100, 90),
    step(3, "gen-a1b2c3d4", "prose", "prose", 4190, 5200, { status: "failed", level: "warn", calls: [call("outline", 2000, "length", 5200)], reason: "outline answer cut off at 2000 tokens (finish_reason length)", fix: "The model's answer was cut off at 2000 max tokens: raise Max tokens for outline in Settings → Steps and connections (a reasoning model spends tokens thinking first)." }),
    { seq: 4, kind: "sections", level: "info", turn: "gen-a1b2c3d4", phase: "sections", step: "sections", status: "ok", start: t + 9400, end: t + 9430, ms: 30, path: "normal turn, preset loom-1", reason: "4 of 6 section(s) filled, 4 of them at the preset's outlets", sections: [{ slot: "scene", outlet: "lre_scene", filled: true }, { slot: "people", outlet: "lre_people", filled: true }, { slot: "outcome", outlet: "lre_outcome", filled: true }, { slot: "minds", outlet: "lre_minds", filled: true }, { slot: "outline", outlet: "lre_outline", filled: false }, { slot: "montage", outlet: null, filled: false }] },
    step(5, "gen-a1b2c3d4", "read", "read", 31_000, 2600, { calls: [call("extract", 240, "stop", 2500)] }),
    { seq: 6, kind: "turn", level: "warn", turn: "gen-a1b2c3d4", phase: null, step: "turn", status: "failed", start: t, end: t + 34_000, ms: 34_000, reason: "step prose/prose failed" },
    { seq: 7, kind: "slow", level: "warn", turn: null, phase: "request", step: "state view", status: "ok", start: t + 40_000, end: t + 44_200, ms: 4200, reason: "state view took 4.2 s" },
    step(8, "gen-e5f6a7b8", "pre", "pre", 60_000, 2300, { calls: [call("interpret", 150, "stop", 2200)] }),
    step(9, "gen-e5f6a7b8", "plan", "plan", 62_300, 70),
    { seq: 10, kind: "turn", level: "info", turn: "gen-e5f6a7b8", phase: null, step: "turn", status: "ok", start: t + 60_000, end: t + 80_000, ms: 20_000 },
  ];
}
