// A mock backend for the preview harness: answers every protocol request from fixtures, keeps
// a push counter, and pushes real snapshots and deltas (computed by diffing the view), so the
// frontend's delta/resync path runs exactly as against the real backend.

import { CLASS_TRAITS, type AccountView, type FinanceView, type JournalLine } from "../../src/shared/finance";
import { CLAIM_PRESETS } from "../../src/shared/claims";
import { readInferred } from "../../src/shared/inferred";
import type { DiagCall, DiagRecord } from "../../src/shared/diagnostics";
import { STEP_LABEL } from "../../src/shared/diagnostics";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import { isRecord } from "../../src/shared/json";
import { applyPatch } from "../../src/shared/json-patch";
import type { MindsRunView } from "../../src/shared/minds";
import type { AssistantProposal, AssistantProposalOp, AssistantRun, AssistantView, LoreBookEntryView, LorePinView, TraceRow, WorkspaceFileView } from "../../src/shared/protocol";
import { editedBookFields, OLD_SECRECY_FIELDS, withBookLoreFields, type BookLoreFields } from "../../src/shared/lore";
import { parseSecretMarks, unreadableMarks, wholeEntrySecret } from "../../src/shared/secret-marks";
import type { DeltaOp, EditOp, FrontendToBackend, JobProposal, JobSummary, JobUpdate, LoreDrift, PresetCard, ResultBodies } from "../../src/shared/protocol";
import { AGENT_API } from "../../src/shared/protocol";
import type { UserSettings } from "../../src/shared/settings";
import { agentSettingsOf, type AcceptanceState } from "../../src/shared/agent-settings";
import { blobHash, isLearnedPath, isWorkspacePath } from "../../src/shared/stores";
import type { GmView, StateView } from "../../src/shared/state-view";
import type { WorldDoc, WorldIndex } from "../../src/shared/world";
import { compileMaps, mapLint, mapTemplate } from "../../src/shared/maps";
import { findPath, gridMinutes } from "../../src/shared/grid";
import { decodeMapView } from "../../src/packs/space/ui/view";
import { decodeFinanceView } from "../../src/packs/economy/ui/decode";
import { MarkChangeError, markedContent } from "../../src/backend/book-lore";
import { mapProposal, readMapAnswer, readMapRequest } from "../../src/backend/map-job";
import { assistantFileChanges, assistantFixture, extractionView, freshFixture, gmFixture, OVERDRAWN_PURCHASE, pausedFixture, portAlderMoney, previewOpKey, settingsFixture, starterMap, stateFixture, UPGRADE_PREVIEW, workspaceFixture, WORLDS, worldFixture, type PreviewFileChange, type PreviewWorkspace } from "./fixtures";
import { combatFixture } from "./combat-fixture";
import { applyRoutineOp, chatRolesFixture, previewRoutines, routineChangedFixture, routineGmFixture, type PreviewRoutines } from "./routines-fixture";
import { ROUTINE_PROPOSALS, routinePlayerFixture } from "./routines-player-fixture";
import { migrateWorld, previewSheet, previewSkills } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { formulaFunctions } from "../../src/engine/scope";
import { buildCharacter } from "../../src/engine/character";
import { initialState } from "../../src/engine/world-state";
import { buildSections } from "../../src/backend/sections-build";
import { markWording } from "../../src/backend/prompts";
import { sectionsOf, sectionTokens } from "../../src/backend/book";
import { DEFAULT_SECTIONS } from "../../src/shared/sections";
import { unrevealedSecrets } from "../../src/engine/visibility";
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

/** What a GM edit's Undo restores: the GM view, the routine changes and the workspace as they were before it. */
interface EditSnapshot {
  gm: GmView;
  routines: PreviewRoutines;
  workspace: PreviewWorkspace;
}

/** What the GM assistant's running row and the activity line show while it answers, as the backend's `RUN_LABEL`. */
const ASSISTANT_LABEL = STEP_LABEL.assistant ?? "GM assistant";

/** The reply the preview's GM edits land on (`m4`): the turn a GM → Workspace write is credited to. */
const EDIT_TURN = 4;

/**
 * What an answer proposes for each kind of change you ask for, in Port Alder: the preview's stand-in
 * for its edit tools' dry runs. The tool call its trace shows, the operation (whose hash is the
 * change's key, as the writer's `opKey` makes it), and the change as the proposal shows it.
 */
const ASKED_CHANGES: { asks: RegExp; call: TraceRow; change: PreviewFileChange | { kind: "gm_edit"; op: Record<string, string | number> }; op: Omit<AssistantProposalOp, "key"> }[] = [
  { asks: /\b(move|put)/i, call: { tool: "gm_move", summary: "danny_okafor → bluebird_coffee", ms: 38 }, change: { kind: "gm_edit", op: { op: "move", entity: "danny_okafor", to: "bluebird_coffee" } }, op: { changeType: "gm_edit", lines: ["Danny Okafor is at Bluebird Coffee"], mode: "auto" } },
  { asks: /\bgive/i, call: { tool: "gm_adjust_money", summary: "marcus_delgado +4000", ms: 33 }, change: { kind: "gm_edit", op: { op: "adjust", account: "marcus_delgado_checking", cents: 4_000 } }, op: { changeType: "money_adjust", lines: ["Marcus Delgado: correction +40.00"], mode: "confirm" } },
  { asks: /\b(set|change)/i, call: { tool: "gm_set_stage", summary: "p_township_truck → fixed", ms: 29 }, change: { kind: "gm_edit", op: { op: "stage", track: "p_township_truck", to: "fixed" } }, op: { changeType: "stage", lines: ["The truck that won't start: It fires"], mode: "auto" } },
  { asks: /\bpin/i, call: { tool: "workspace_pin", summary: "lore-drafts/rusty-anchor.md", ms: 9 }, change: { kind: "ws_pin", path: "lore-drafts/rusty-anchor.md", pinned: true }, op: { changeType: "workspace", lines: ["workspace file lore-drafts/rusty-anchor.md pinned"], mode: "auto" } },
];

export class MockBackend {
  /** The chat's latest minds run (`lre.minds`): the preview runs it one mind at a time, and the third fails as a cut-off call does. */
  private mindsRun: MindsRunView | null = null;
  /** LRE's own fields on the preview's World Info entries, by entry id (Build → Lore → World Info). */
  private readonly bookLore: Record<string, BookLoreFields> = {};
  /** The preview's World Info entries' text, by entry id: Build's Make secret writes its marks into it, as the backend does into a book. */
  private readonly bookText: Record<string, string> = {
    e1: "The town council meets on the first Monday of each month, in the library basement.",
    e2: "The harbor opens at dawn and closes at dusk. {{// Secret (known to npc_dev): Dev keeps a spare key to the bait shop under the third crate.}}",
  };
  private view: StateView | null = null;
  private rev = 0;
  private settings: UserSettings = settingsFixture();
  /** Acceptance runs (`lre.acceptance`): the open one and the last closed. */
  private acceptance: AcceptanceState = { run: null, last: null };
  private world: WorldDoc = worldFixture();
  private draft: WorldDoc = worldFixture();
  /** The draft's write count, as the backend keeps it: 0 while the draft is the world. */
  private draftVersion = 0;
  /** The user's worlds as `lre.world list` reads them. */
  private worldList: WorldIndex[] = structuredClone(WORLDS);
  /** Whether `?draft=elsewhere`'s change is scheduled, and how many changes were made elsewhere. */
  private elsewhereScheduled = false;
  private elsewhereCount = 0;
  private jobs = 0;
  private gm: GmView = gmFixture();
  /** This chat's routine changes (GM → Routines), as the castlife slice keeps them. */
  private routines: PreviewRoutines = previewRoutines();
  /** This chat's workspace (GM → Workspace, the agents' workspace tools). */
  private workspace: PreviewWorkspace = workspaceFixture();
  /** This chat's thread with the GM assistant (`lre.assistant`). */
  private assistant: AssistantView = assistantFixture();
  /** What each proposed workspace change writes when it is applied, by its key: the backend keeps the operation on the stored proposal, and the view leaves it out. */
  private readonly proposedFiles = new Map<string, PreviewFileChange>(Object.entries(assistantFileChanges()));
  /** The answer under way's timers: its pushes as its calls spend tokens, and its landing. */
  private answering: ReturnType<typeof setTimeout>[] = [];
  /** The last number the preview gave a new message or proposal of the thread. */
  private assistantIds = 0;
  /** The GM view, the routine changes and the workspace as they were before each GM edit, by the edit's Undo chip. */
  private readonly beforeEdit = new Map<string, EditSnapshot>();
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

  /**
   * Pay another way on the payment the story put past the Visa's limit (`c-overdrawn`), as the backend tries it (DESIGN §9.5):
   * savings, then a card, then checking, then cash; the first with room for it pays (a card up to
   * what's available on it, any other account up to what it holds). False when none has room.
   */
  private payAnotherWay(): boolean {
    const money = decodeFinanceView(this.view?.panels["economy.money"] ?? null);
    if (!money) return false;
    const cents = OVERDRAWN_PURCHASE.cents;
    const tries: readonly ((a: AccountView) => boolean)[] = [(a) => a.class === "savings", (a) => CLASS_TRAITS[a.class].revolving, (a) => a.class === "checking", (a) => CLASS_TRAITS[a.class].cash];
    const source = tries.flatMap((is) => money.accounts.filter((a) => a.status === "open" && is(a))).find((a) => (a.available ?? a.cents) >= cents);
    if (!source) return false;
    const liability = CLASS_TRAITS[source.class].liability;
    this.mutate((view) => {
      const panel = decodeFinanceView(view.panels["economy.money"] ?? null);
      if (!panel) return;
      const line: JournalLine = { id: "preview:pay-another-way", at: view.hud?.clock.label ?? "", memo: OVERDRAWN_PURCHASE.name, cents: -cents, account: source.name, accountId: source.id, kind: "purchase", category: null, counterparty: null, card: null, status: "posted" };
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

  /** The GM view, the routine changes and the workspace as they stand: what a GM edit's Undo restores. */
  private editSnapshot(): EditSnapshot {
    return structuredClone({ gm: this.gm, routines: this.routines, workspace: this.workspace });
  }

  /**
   * Lands one GM edit as the backend records it, whatever made it (`lre.edit`, an applied proposal,
   * a GM → Workspace change): first in the GM view's edits with its Undo chip, `before` kept for that
   * Undo, and the chat's "GM edit" fix chip and Journal fix line pushed, with `also`'s change to the
   * view. Answers the chip.
   */
  private landEdit(before: EditSnapshot, lines: string[], also?: (view: StateView) => void): string {
    const seq = (before.gm.edits[0]?.seq ?? 0) + 1;
    const chip = `fix:m4:0:${seq}`;
    this.gm.edits.unshift({ messageId: "m4", seq, lines, undo: chip });
    this.beforeEdit.set(chip, before);
    this.mutate((view) => {
      view.chips.push({ id: chip, kind: "fix", messageId: "m4", label: "GM edit", detail: lines.join(" · "), actions: [{ id: "undo", label: "Undo", style: "danger" }], expires: "next_send" });
      also?.(view);
      view.journal.push({ kind: "fix", messageId: "m4", ref: { in: "post", seq, index: 0 }, text: lines.join(" · ") });
    }, 40);
    return chip;
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
          this.workspace = undone.workspace;
        }
        if (chip.id === "c-overdrawn" && message.choice === "other" && !this.payAnotherWay()) return this.error(reqId, "validation", "No other way to pay covers it.");
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
        return this.result(reqId, "lre.gm", { ...structuredClone(this.gm), routineRoles: chatRolesFixture(this.routines) });
      case "lre.sections": {
        // The real builder (`buildSections`) over the preview world as a chat starts it, people where
        // the GM fixture has them, and each section's settings as This chat → Sections shows them.
        const world = migrateWorld(structuredClone(this.world));
        const state = initialState(world, "preview", REGISTRY);
        for (const g of this.gm.entities) {
          const e = state.entities[g.id];
          if (e && g.place !== null) e.fields.place = g.place;
        }
        const rows = this.view?.controls?.sections ?? [];
        // The rows This chat → Sections lists, each from the preview world when it has it, else the shipped default.
        const own = new Map(sectionsOf(world).map((s) => [s.id, s]));
        world.sections = Object.fromEntries(rows.flatMap((row) => {
          const s = own.get(row.id) ?? DEFAULT_SECTIONS[row.id];
          if (!s) return [];
          const { enabled: _e, scope: _s, maxLines: _l, maxTokens: _t, include: _i, ...plain } = s;
          return [[s.id, { ...plain, ...(row.chat ?? row.world) }]];
        }));
        const settings = settingsFixture();
        // The narrator's knowledge as This chat → Knowledge shows it: the chat's own, else the world's, else the user's.
        const knowledge = this.view?.controls?.knowledge.narrator;
        const narrator = { chat: knowledge?.chat ?? null, view: knowledge?.chat ?? knowledge?.world ?? knowledge?.user ?? settings.narrator };
        const built = buildSections({ registry: REGISTRY, world, state, secrets: unrevealedSecrets(REGISTRY, world, state), narrator, wording: markWording(settings.prompts.texts), budget: settings.modelUse.tokens.sections, mindsBudget: settings.minds.tokens, texts: settings.prompts.texts, said: "", planned: { outcome: [], montage: [] }, outline: [], elapsed: null, hasEntry: () => true, cost: sectionTokens, seen: () => {}, warn: () => {} });
        return this.result(reqId, "lre.sections", { sections: built.sections.map((s) => ({ slot: s.slot, label: s.label, status: s.status, scope: s.scope, content: s.content, tokens: s.tokens, cut: s.cut, marked: s.marked, hints: s.hints })), budget: { sections: settings.modelUse.tokens.sections, used: built.used, minds: settings.minds.tokens } });
      }
      case "lre.chat.knowledge": {
        // The chat's own choices, as the backend keeps them in its metadata: a part given sets it, null follows again.
        const knowledge = this.view?.controls?.knowledge;
        if (!knowledge) return this.error(reqId, "not_world_chat", "not a world chat");
        const tracking = message.knowledge !== undefined ? message.knowledge : knowledge.tracking.chat;
        const narrator = message.narrator !== undefined ? message.narrator : knowledge.narrator.chat;
        this.result(reqId, "lre.chat.knowledge", { knowledge: tracking, narrator });
        this.mutate((view) => {
          const k = view.controls?.knowledge;
          if (!k) return;
          k.tracking.chat = tracking;
          k.narrator.chat = narrator ? { ...narrator } : null;
        }, 40);
        return;
      }
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
        const before = this.editSnapshot();
        const lines = this.applyEdit(message.ops);
        if (typeof lines === "string") return this.error(reqId, "validation", lines);
        const chip = this.landEdit(before, lines, (view) => {
          // A section's settings for this chat show on its row and in the preview, as the backend's view has them.
          for (const op of message.ops) {
            const row = op.op === "feed" ? view.controls?.sections.find((r) => r.id === op.section) : undefined;
            if (row && op.op === "feed") row.chat = op.to;
          }
        });
        this.result(reqId, "lre.edit", { pending: false, undo: chip });
        return;
      }
      case "lre.fix":
        this.result(reqId, "lre.fix", { pending: false });
        this.mutate((view) => {
          // Show a hint: one more of the row's earned hints open, kept with its Undo, as the backend's would be.
          if ("hint" in message) {
            const log = view.panels["story.quests"];
            const row = (isRecord(log) && Array.isArray(log.active) ? log.active : []).find((t) => isRecord(t) && t.id === message.hint);
            if (!isRecord(row)) return;
            row.opened = (typeof row.opened === "number" ? row.opened : 0) + 1;
            view.chips.push({ id: `fix:m4:0:hint${String(row.opened)}`, kind: "fix", messageId: "m4", label: `Opened a hint: ${String(row.label)}`, actions: [{ id: "undo", label: "Undo", style: "danger" }], expires: "next_send" });
            return;
          }
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
        // The agents' settings as the store reads them back (`agentSettingsOf`): a part reset to its default (null) reads as the default, not a missing key.
        next.agents = agentSettingsOf(next.agents);
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
        const entriesOf = (bookId: string): LoreBookEntryView[] =>
          (bookId === "book_town" ? [ { id: "e1", title: "Town notice", disabled: true }, { id: "e2", title: "Harbor hours", disabled: false } ] : []).map((e) => {
            // As the backend reads an entry: its own fields, and the marks its text holds.
            const content = this.bookText[e.id] ?? "";
            const lore = this.bookLore[e.id];
            const marks = parseSecretMarks(content).map((m) => ({ text: m.text, knownTo: m.knownTo, keptFrom: m.keptFrom }));
            const unreadable = unreadableMarks(content).map((u) => ({ raw: u.raw, problem: u.problem }));
            return { ...e, chars: content.length, ...(lore ? { lore } : {}), ...(marks.length > 0 ? { marks } : {}), ...(wholeEntrySecret(content) ? { whole: true as const } : {}), ...(unreadable.length > 0 ? { unreadable } : {}) };
          });
        if (message.op === "entries") return this.result(reqId, "lre.lore", { entries: entriesOf(message.bookId) });
        if (message.op === "fields") {
          const edit = message.fields;
          if (edit !== null && OLD_SECRECY_FIELDS.some((key) => key in edit)) return this.error(reqId, "bad_request", "an entry is made secret by a secret mark in its text, not by fields: use Make secret (the mark op)");
          const next = editedBookFields(this.bookLore[message.entryId] ?? null, edit);
          if (next) this.bookLore[message.entryId] = next;
          else delete this.bookLore[message.entryId];
          return this.result(reqId, "lre.lore", { entries: entriesOf(message.bookId) });
        }
        if (message.op === "mark") {
          const lore = this.bookLore[message.entryId] ?? null;
          try {
            this.bookText[message.entryId] = markedContent({ content: this.bookText[message.entryId] ?? "", extensions: withBookLoreFields({}, lore) }, message.change);
          } catch (error) {
            if (error instanceof MarkChangeError) return this.error(reqId, "bad_request", error.message);
            throw error;
          }
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
      case "lre.preset": {
        // As the backend does: Add creates the missing guidance blocks (empty, switched off); every op answers with the card.
        if (message.op === "add") this.presetCard = { ...this.presetCard, blocks: this.presetCard.blocks.map((block) => (block.state === "missing" ? { ...block, state: "empty" } : block)) };
        return this.result(reqId, "lre.preset", { card: structuredClone(this.presetCard) });
      }
      case "lre.diag":
        if (message.op === "dismiss") this.activity(null);
        // An agent call's text, as the backend answers a hash the chat's records keep.
        if (message.op === "text") return this.result(reqId, "lre.diag", { records: [], activity: null, text: message.hash === PREVIEW_AGENT_TEXT ? "system: You are the game master's assistant.\nuser: Who keeps the lighthouse?\nassistant: lore_search {\"query\": \"lighthouse keeper\"}\ntool: (2 entries)\nassistant: The keeper's log names Sam." : null });
        return this.result(reqId, "lre.diag", { records: message.op === "clear" ? [] : diagnosticsFixture(), activity: null });
      case "lre.acceptance": {
        // As the backend does: one run at a time, opened with a label and closed into the last run; the preview spends nothing.
        const view = (label: string, openedAt: number, closedAt: number | null) => ({ label, openedAt, closedAt, connections: this.settings.agents.acceptance.connections.map((c) => ({ id: c.id, spent: { tokensIn: 0, cachedIn: 0, tokensOut: 0, calls: 0, refused: 0, estimated: false }, reserved: { tokensIn: 0, tokensOut: 0 }, ceiling: { only: c.only, tokensIn: c.tokensIn, tokensOut: c.tokensOut } })) });
        if (message.op === "open") {
          if (this.acceptance.run) return this.error(reqId, "bad_request", "an acceptance run is open already: close it first");
          this.acceptance = { ...this.acceptance, run: view(message.label, Date.now(), null) };
        } else if (message.op === "close" && this.acceptance.run) this.acceptance = { run: null, last: { ...this.acceptance.run, closedAt: Date.now() } };
        this.emit({ lre: 1, type: "lre.acceptance.changed", state: structuredClone(this.acceptance) });
        return this.result(reqId, "lre.acceptance", structuredClone(this.acceptance));
      }
      case "lre.assistant": {
        // As the backend's `Assistant.request` does (R6a): every op answers the whole thread after it, and each but `get` pushes it to the chat's sessions too.
        const chatId = message.chatId;
        if (message.op === "get") return this.result(reqId, "lre.assistant", structuredClone(this.assistant));
        if (message.op === "send") {
          // One answer at a time: your message joins the thread and the answer starts, answered at once; its progress and its answer are pushed.
          const text = message.text.trim();
          if (text === "") return this.error(reqId, "bad_request", "Write a message for the assistant.");
          if (this.assistant.running) return this.error(reqId, "conflict", "The assistant is still answering your last message: wait for its answer, or Cancel it.");
          const startedAt = Date.now();
          const run: AssistantRun = { agentId: `agent_preview_${this.assistantIds}`, label: ASSISTANT_LABEL, tokens: { in: 0, out: 0 }, startedAt };
          this.assistant.thread.push({ id: this.nextAssistantId("am"), role: "user", text, at: startedAt });
          this.assistant.running = run;
          // The activity line shows its label and nothing else, as the backend's `agentWorking` does.
          this.activity({ state: "running", label: run.label, since: startedAt });
          // Its calls spend tokens: pushed as they are spent, then the answer lands.
          this.answering = ([[500, 6_100, 90], [1_100, 12_400, 230], [1_700, 18_900, 410]] as const).map(([ms, tokensIn, tokensOut]) =>
            setTimeout(() => {
              run.tokens = { in: tokensIn, out: tokensOut };
              this.pushAssistant(chatId);
            }, ms),
          );
          this.answering.push(setTimeout(() => this.landAnswer(chatId, text), 2_300));
        } else if (message.op === "cancel") {
          // The answer ends as cancelled, with what its calls spent so far, and proposes nothing.
          const run = this.assistant.running;
          if (run) {
            for (const timer of this.answering) clearTimeout(timer);
            this.answering = [];
            this.assistant.thread.push({ id: this.nextAssistantId("am"), role: "assistant", text: "", at: Date.now(), usage: { in: run.tokens.in, out: run.tokens.out, cached: 0 }, status: "cancelled" });
            this.assistant.running = null;
            this.activity(null);
          }
        } else if (message.op === "apply") {
          const refused = this.applyProposal(message.proposalId, message.keys);
          if (refused) return this.error(reqId, refused.code, refused.message);
        } else if (message.op === "reject") {
          const proposal = this.openProposal(message.proposalId);
          if ("code" in proposal) return this.error(reqId, proposal.code, proposal.message);
          proposal.status = "rejected";
        } else {
          // `clear` forgets the thread and its proposals, refused while an answer is under way.
          if (this.assistant.running) return this.error(reqId, "conflict", "The assistant is still answering: wait for its answer, or Cancel it, before you clear the conversation.");
          this.assistant = { thread: [], running: null, proposals: [] };
          this.proposedFiles.clear();
        }
        this.result(reqId, "lre.assistant", structuredClone(this.assistant));
        this.pushAssistant(chatId);
        return;
      }
      case "lre.workspace": {
        // As the backend's `workspaceRequest` does (R6a): the workspace at the chat's head, and your own change to it through the writer, as one GM edit with its Undo chip (never held: the preview runs no turn), or refused in plain words.
        if (message.op === "list") return this.result(reqId, "lre.workspace", { files: structuredClone(this.workspace.files) });
        if (message.op === "read") return this.result(reqId, "lre.workspace", { text: this.workspace.files.some((f) => f.path === message.path) ? (this.workspace.texts[message.path] ?? null) : null });
        // The preview plays no agent turn, so its main agent has no session, and nothing to roll back.
        if (message.op === "session") return this.result(reqId, "lre.workspace", { session: { summary: null, turns: 0, tokens: 0, rollback: "none" } });
        if (message.op === "rollback") return this.error(reqId, "validation", "The main agent's session has no compaction to roll back.");
        const change: PreviewFileChange = message.op === "write" ? { kind: "ws_write", path: message.path, text: message.text, ...(message.readers !== undefined ? { readers: message.readers } : {}) } : message.op === "delete" ? { kind: "ws_delete", path: message.path } : message.op === "move" ? { kind: "ws_move", from: message.from, to: message.to } : message.op === "readers" ? { kind: "ws_readers", path: message.path, readers: message.readers } : { kind: "ws_pin", path: message.path, pinned: message.pinned };
        const before = this.editSnapshot();
        // Your own write is the GM's, credited to the reply it lands on.
        const lines = this.changeWorkspace(change, { role: "gm", key: previewOpKey(change) });
        if (!Array.isArray(lines)) return this.error(reqId, "validation", lines.reason);
        const undo = this.landEdit(before, lines);
        return this.result(reqId, "lre.workspace", { files: structuredClone(this.workspace.files), pending: false, undo });
      }
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

  /** Pushes the chat's thread with the GM assistant (`lre.assistant.update`), as the backend's `push` does after each change. */
  private pushAssistant(chatId: string): void {
    this.emit({ lre: 1, type: "lre.assistant.update", chatId, view: structuredClone(this.assistant) });
  }

  /** The id the preview gives a new message (`am`) or proposal (`ap`) of the thread. */
  private nextAssistantId(prefix: "am" | "ap"): string {
    this.assistantIds += 1;
    return `${prefix}-preview-${this.assistantIds}`;
  }

  /** The open proposal `id`, or why not, as the backend's `openProposal` says it. */
  private openProposal(id: string): AssistantProposal | { code: string; message: string } {
    const proposal = this.assistant.proposals.find((p) => p.id === id);
    if (!proposal) return { code: "not_found", message: "There is no such proposal in this conversation." };
    if (proposal.status !== "open") return { code: "bad_request", message: `That proposal was ${proposal.status} already.` };
    return proposal;
  }

  /**
   * The answer under way lands, as the backend's `answer` lands it: its message with its trace and
   * usage, and, when you asked for a change, its proposal (`messageId` = the answer's), applied at
   * once when Settings → Agents → Assistant says so and none of its changes asks first.
   */
  private landAnswer(chatId: string, asked: string): void {
    const run = this.assistant.running;
    if (!run) return;
    this.answering = [];
    this.activity(null);
    const asks = ASKED_CHANGES.filter((c) => c.asks.test(asked));
    const ops = asks.map((c): AssistantProposalOp => ({ key: previewOpKey(c.change), ...structuredClone(c.op) }));
    // A workspace change keeps what it writes, for its Apply.
    for (const c of asks) if (c.change.kind !== "gm_edit") this.proposedFiles.set(previewOpKey(c.change), c.change);
    const id = this.nextAssistantId("am");
    const text = ops.length > 0 ? "I checked what you asked against the world as it stands: the change is below for you to apply." : "Danny Okafor is at Alder Automotive until five, and Marcus Delgado is at The Rusty Anchor after six. Ask me to change something and I'll check it first.";
    const trace: TraceRow[] = [{ tool: "people_find", summary: "“Danny”", ms: 44 }, { tool: "people_where", summary: "danny_okafor", ms: 36 }, ...asks.map((c) => ({ ...c.call }))];
    this.assistant.thread.push({ id, role: "assistant", text, at: Date.now(), trace, usage: { in: run.tokens.in, out: run.tokens.out, cached: Math.round(run.tokens.in * 0.8) }, status: "answered" });
    const proposal: AssistantProposal | null = ops.length > 0 ? { id: this.nextAssistantId("ap"), messageId: id, ops, status: "open" } : null;
    if (proposal) this.assistant.proposals.push(proposal);
    // One that asks first waits for Apply.
    if (proposal && this.settings.agents.assistant.apply === "at_once" && ops.every((o) => o.mode !== "confirm")) this.applyProposal(proposal.id, undefined);
    this.assistant.running = null;
    this.pushAssistant(chatId);
  }

  /**
   * Applies the open proposal `id`, all of it or the changes `keys` picks, as the backend's
   * `applyProposal` does: what landed as one GM edit (the preview's GM view is another world's, so
   * a change of Port Alder's is its lines alone; a workspace change changes the workspace), each op
   * `applied` or `refused` with why, the proposal `applied` with the edit's chip; one none of whose
   * changes landed stays open. Why not, as an error's code and words.
   */
  private applyProposal(id: string, keys: readonly string[] | undefined): { code: string; message: string } | null {
    const proposal = this.openProposal(id);
    if ("code" in proposal) return proposal;
    if (keys !== undefined && keys.some((k) => !proposal.ops.some((o) => o.key === k))) return { code: "bad_request", message: "Pick changes the proposal holds." };
    const picked = keys === undefined ? proposal.ops : proposal.ops.filter((o) => keys.includes(o.key));
    if (picked.length === 0) return { code: "bad_request", message: "Pick at least one change to apply." };
    const before = this.editSnapshot();
    const lines: string[] = [];
    const applied = new Set<string>();
    const refused = new Map<string, { code: string; reason: string }>();
    for (const o of picked) {
      const change = this.proposedFiles.get(o.key);
      const done = change ? this.changeWorkspace(change, { role: "assistant", key: o.key }) : o.lines;
      if (!Array.isArray(done)) refused.set(o.key, done);
      else {
        applied.add(o.key);
        lines.push(...o.lines);
      }
    }
    // Each change as this Apply left it: what an Apply before it refused is said again, or no more.
    proposal.ops = proposal.ops.map(({ applied: _before, refused: _was, ...o }): AssistantProposalOp => {
      if (applied.has(o.key)) return { ...o, applied: true };
      const no = refused.get(o.key);
      return no ? { ...o, refused: no } : o;
    });
    if (applied.size > 0) {
      proposal.status = "applied";
      proposal.chipId = this.landEdit(before, lines);
    }
    return null;
  }

  /**
   * A workspace change as the writer checks it and the engine makes it (`prepareFile`,
   * `workspaceOp`): a path that isn't one, a file that isn't there, a move into or out of the
   * learned area, or a change that changes nothing is refused, in plain words, and nothing changes;
   * else the files and their bodies change (listed by path, as the backend lists them), a file
   * written credited to `by` on the reply the preview's edits land on (a learned one, on none), read
   * with the readers the GM chose, else as it was, a new one by the GM alone (the preview's agent
   * writes are the assistant's, with everyone's knowledge). Answers the edit's lines.
   */
  private changeWorkspace(change: PreviewFileChange, by: { role: string; key: string }): string[] | { code: string; reason: string } {
    const ws = this.workspace;
    const notPath = (path: string) => (isWorkspacePath(path) ? null : { code: "bad_path", reason: `${path} isn't a workspace path: names of letters, digits, “.”, “_” and “-”, joined by /.` });
    const noFile = (path: string) => ({ code: "no_file", reason: `No workspace file ${path} here.` });
    const provenance = (path: string) => ({ role: by.role, ...(isLearnedPath(path) ? {} : { key: by.key }), turn: isLearnedPath(path) ? null : EDIT_TURN });
    switch (change.kind) {
      case "ws_write": {
        const wrong = notPath(change.path);
        if (wrong) return wrong;
        const file = ws.files.find((f) => f.path === change.path);
        const hash = blobHash(change.text);
        const readers = by.role === "gm" ? (change.readers ?? file?.readers ?? "gm") : "everyone";
        if (file?.hash === hash && file.readers === readers) return { code: "no_change", reason: "The file already holds that text." };
        const written: WorkspaceFileView = { path: change.path, hash, size: change.text.length, pinned: file?.pinned ?? false, readers, learned: isLearnedPath(change.path), provenance: provenance(change.path) };
        ws.files = [...ws.files.filter((f) => f !== file), written].sort((a, b) => (a.path < b.path ? -1 : 1));
        ws.texts[change.path] = change.text;
        return [`workspace file ${change.path} written`];
      }
      case "ws_delete": {
        const wrong = notPath(change.path);
        if (wrong) return wrong;
        if (!ws.files.some((f) => f.path === change.path)) return noFile(change.path);
        ws.files = ws.files.filter((f) => f.path !== change.path);
        delete ws.texts[change.path];
        return [`workspace file ${change.path} deleted`];
      }
      case "ws_move": {
        const wrong = notPath(change.from) ?? notPath(change.to);
        if (wrong) return wrong;
        const file = ws.files.find((f) => f.path === change.from);
        if (!file) return noFile(change.from);
        if (isLearnedPath(change.from) !== isLearnedPath(change.to)) return { code: "learned_move", reason: `${change.from} can't move to ${change.to}: files under learned/ stay there, and the others stay out of it. Write the file at its new path, then delete the old one.` };
        if (change.to === change.from) return { code: "no_change", reason: "The file is already there." };
        if (ws.files.some((f) => f.path === change.to)) return { code: "file_exists", reason: `There is a workspace file ${change.to} already.` };
        // Written at its new path, its pin and readers going with it, and removed from its old one.
        ws.files = [...ws.files.filter((f) => f !== file), { ...file, path: change.to, provenance: provenance(change.to) }].sort((a, b) => (a.path < b.path ? -1 : 1));
        ws.texts[change.to] = ws.texts[change.from] ?? "";
        delete ws.texts[change.from];
        return [`workspace file ${change.to} written`, `workspace file ${change.from} deleted`];
      }
      case "ws_pin": {
        const wrong = notPath(change.path);
        if (wrong) return wrong;
        const file = ws.files.find((f) => f.path === change.path);
        if (!file) return noFile(change.path);
        if (file.pinned === change.pinned) return { code: "no_change", reason: change.pinned ? "The file is pinned already." : "The file isn't pinned." };
        file.pinned = change.pinned;
        return [`workspace file ${change.path} ${change.pinned ? "pinned" : "unpinned"}`];
      }
      case "ws_readers": {
        const wrong = notPath(change.path);
        if (wrong) return wrong;
        const file = ws.files.find((f) => f.path === change.path);
        if (!file) return noFile(change.path);
        if (file.readers === change.readers) return { code: "no_change", reason: "The file is read with that knowledge already." };
        file.readers = change.readers;
        return [`workspace file ${change.path} read with ${change.readers === "pov" ? "the player character's" : change.readers === "everyone" ? "everyone's" : "the GM's"} knowledge`];
      }
    }
  }
}

/** The blob hash the preview's first agent record keeps as its text's; the failed one keeps none. */
const PREVIEW_AGENT_TEXT = "0123456789abcdef0123456789abcdef";

/** Two turns as the backend records them: the newer one's outline cut off at max tokens, the older one clean; a slow view; and two agent calls outside a turn. */
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
    { seq: 11, kind: "agent", level: "info", turn: null, phase: null, step: "gm", status: "ok", start: t + 90_000, end: t + 96_400, ms: 6400, agent: { role: "gm", connection: "active", model: "deepseek-v4-flash", usage: { in: 14_200, cachedIn: 11_900, out: 640, reasoningOut: 210, estimated: ["reasoningOut"] }, ms: 6400, outcome: "ok", tools: ["lore_search", "lore_read"], text: PREVIEW_AGENT_TEXT } },
    { seq: 12, kind: "agent", level: "warn", turn: null, phase: null, step: "gm", status: "failed", start: t + 100_000, end: t + 101_200, ms: 1200, reason: "429 rate limited", agent: { role: "gm", connection: "active", model: "deepseek-v4-flash", usage: null, ms: 1200, outcome: "failed", error: "429 rate limited" } },
  ];
}
