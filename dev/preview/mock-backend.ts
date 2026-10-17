// A mock backend for the preview harness: answers every protocol request from fixtures, keeps
// a push counter, and pushes real snapshots and deltas (computed by diffing the view), so the
// frontend's delta/resync path runs exactly as against the real backend.

import type { JsonValue } from "../../src/shared/json";
import { isRecord } from "../../src/shared/json";
import type { DeltaOp, EditOp, FrontendToBackend, JobProposal, JobSummary, JobUpdate, ResultBodies } from "../../src/shared/protocol";
import type { UserSettings } from "../../src/shared/settings";
import type { GmView, StateView } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { compileMaps, mapLint, mapTemplate } from "../../src/shared/maps";
import { mapProposal, readMapAnswer, readMapRequest } from "../../src/backend/map-job";
import { extractionView, freshFixture, gmFixture, pausedFixture, settingsFixture, starterMap, stateFixture, UPGRADE_PREVIEW, WORLDS, worldFixture } from "./fixtures";
import { previewSheet } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { formulaFunctions } from "../../src/engine/scope";
import { ALL_PACKS } from "../../src/packs/index";

// The real registry, so Build's formula functions and the Sheet Designer preview are the engine's own.
const REGISTRY = createRegistry(ALL_PACKS);

type Emit = (payload: unknown) => void;

export interface MockOptions {
  /** `fresh`: a new chat whose POV money no view has opened yet (the opening balances show). */
  scenario: "play" | "paused" | "not_world" | "fresh";
  /** A starter template id: the map is that starter's in a new chat, as the engine builds it. */
  map?: string;
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
  private view: StateView | null = null;
  private rev = 0;
  private settings: UserSettings = settingsFixture();
  private world: WorldDoc = worldFixture();
  private draft: WorldDoc = worldFixture();
  private jobs = 0;
  private gm: GmView = gmFixture();
  /** The GM view as it was before each GM edit, by the edit's Undo chip. */
  private readonly beforeEdit = new Map<string, GmView>();
  /** Kept jobs (`lre.job list`): an import a restart cut off after its first chunk. */
  private kept: JobSummary[] = [{ jobId: "job-kept", kind: "import_lore", worldId: WORLDS[0]?.id ?? "", status: "interrupted", progress: 0.5, message: "Interrupted by a restart. The 2 proposal(s) it made before it stopped are below; run it again for the rest.", result: { proposals: PROPOSALS.slice(0, 2) }, input: { bookIds: ["book-1"] }, at: Date.now() - 600_000 }];
  readonly log: FrontendToBackend[] = [];

  constructor(private readonly emit: Emit, private readonly options: MockOptions) {}

  /** Describe a map's proposal as the backend's job makes it, with a small grid map standing in for the helper's answer. */
  private mapProposals(input: unknown) {
    const request = readMapRequest(this.draft, isRecord(input) ? input : {});
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
    const find = (id: string) => gm.entities.find((e) => e.id === id);
    const name = (id: string | null) => (id === null ? "nowhere" : (find(id)?.name ?? gm.places.find((p) => p.id === id)?.name ?? id));
    const lines: string[] = [];
    for (const op of ops) {
      if (op.op === "spawn") {
        const id = op.id ?? `${op.kind}:${gm.entities.length}`;
        gm.entities.push({ id, name: op.name, kind: op.kind, tier: op.tier ?? "background", agent: op.agent ?? false, pov: false, gone: false, spawned: true, visibility: "public", place: op.place ?? null, holder: null, fields: [], relations: [], levels: [], sheet: null });
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
        case "despawn":
        case "restore":
          entity.gone = op.op === "despawn";
          lines.push(`${entity.name} is ${entity.gone ? "gone" : "back"}`);
          break;
      }
    }
    this.gm = gm;
    return lines;
  }

  receive(message: FrontendToBackend): void {
    this.log.push(message);
    const reqId = message.reqId;
    switch (message.type) {
      case "lre.hello":
        if (message.chatId === null) {
          this.result(reqId, "lre.hello", { accepted: true });
          return;
        }
        this.view = this.options.scenario === "paused" ? pausedFixture(message.chatId) : this.options.scenario === "fresh" ? freshFixture(message.chatId) : stateFixture(message.chatId);
        if (this.options.scenario === "not_world") this.view = { ...stateFixture(message.chatId), status: "not_world", hud: null, scene: null, chips: [], panels: {}, palette: null, controls: null };
        else if (this.options.map) this.view.panels["space.map"] = starterMap(this.options.map);
        this.result(reqId, "lre.hello", { accepted: true });
        setTimeout(() => this.snapshot(), 50);
        return;
      case "lre.state.resync":
        this.result(reqId, "lre.state.resync", { accepted: true });
        setTimeout(() => this.snapshot(), 50);
        return;
      case "lre.chip": {
        const chip = this.view?.chips.find((c) => c.id === message.chip);
        if (!chip) return this.error(reqId, "not_found", "That chip has expired.");
        const undone = chip.kind === "fix" ? this.beforeEdit.get(chip.id) : undefined;
        if (undone) this.gm = undone;
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
      case "lre.edit": {
        const before = structuredClone(this.gm);
        const lines = this.applyEdit(message.ops);
        if (typeof lines === "string") return this.error(reqId, "validation", lines);
        const seq = (before.edits[0]?.seq ?? 0) + 1;
        const chip = `fix:m4:0:${seq}`;
        this.gm.edits.unshift({ messageId: "m4", seq, lines });
        this.beforeEdit.set(chip, before);
        this.result(reqId, "lre.edit", { pending: false });
        this.mutate((view) => {
          view.chips.push({ id: chip, kind: "fix", messageId: "m4", label: "Corrected", detail: lines.join(" · "), actions: [{ id: "undo", label: "Undo", style: "danger" }], expires: "next_send" });
          view.journal.push({ kind: "fix", messageId: "m4", ref: { in: "post", seq, index: 0 }, text: lines.join(" · ") });
        }, 40);
        return;
      }
      case "lre.fix":
        this.result(reqId, "lre.fix", { pending: false });
        this.mutate((view) => {
          if (!view.hud) return;
          if (message.field === "cash" && typeof message.value === "number") view.hud.cash = { cents: message.value };
          const fix = Object.values(view.hud.fixes).find((f) => f?.entity === message.entity && f.field === message.field);
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
        }, 40);
        return;
      case "lre.view.open":
        // Opening a pack panel materializes the POV's detail there; for money that posts the opening
        // balances the panel already shows, so the view doesn't change.
        this.result(reqId, "lre.view.open", { materialized: message.panel !== "core.context", pending: false });
        return;
      case "lre.settings.get":
        this.result(reqId, "lre.settings.get", { settings: structuredClone(this.settings), extraction: extractionView(this.settings), caveats: [{ code: "preset_json_ledger", message: "Your active preset “Default” has an enabled block “Caravan Ledger” that asks the narrator for JSON; replies will carry it. Turn it off in the preset if you don't want it." }] });
        return;
      case "lre.settings.set": {
        const next = mergePatch(this.settings, message.patch) as UserSettings;
        const preset = next.realism.preset;
        const levels = REALISM_PRESETS[preset];
        if (isRecord(message.patch.realism) && message.patch.realism.preset && levels) next.realism.levels = { ...next.realism.levels, ...(levels as UserSettings["realism"]["levels"]) };
        this.settings = next;
        this.result(reqId, "lre.settings.set", { settings: structuredClone(this.settings), extraction: extractionView(this.settings), caveats: [] });
        return;
      }
      case "lre.world":
        switch (message.op) {
          case "list":
            return this.result(reqId, "lre.world", { worlds: structuredClone(WORLDS) });
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
          case "create":
            return this.result(reqId, "lre.world", { world: { ...structuredClone(this.world), id: "w-new", name: message.name } });
          case "commit":
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
            // As the backend does: the draft with the unsaved ruleset, read on the POV unless another entity is named.
            const world: WorldDoc = { ...structuredClone(this.draft), ruleset: isRecord(message.ruleset) ? (message.ruleset as unknown as WorldDoc["ruleset"]) : undefined };
            return this.result(reqId, "lre.world", { sheet: previewSheet(REGISTRY, world, message.entity) });
          }
        }
        return;
      case "lre.editor": {
        const doc = this.draft as unknown as Record<string, Record<string, JsonValue>>;
        if (message.op === "discard") this.draft = structuredClone(this.world);
        else if (message.op === "put") (doc[message.collection] ??= {})[message.id] = message.value;
        else if (message.op === "remove") delete doc[message.collection]?.[message.id];
        else if (message.op === "set" && message.part === "meta" && isRecord(message.value)) Object.assign(this.draft, message.value);
        else if (message.op === "set" && message.part === "tiers" && isRecord(message.value) && isRecord(message.value.tiers)) {
          this.draft.tiers = structuredClone(message.value.tiers) as unknown as WorldDoc["tiers"];
          if (typeof message.value.spawnTier === "string") this.draft.spawnTier = message.value.spawnTier;
          else delete this.draft.spawnTier;
        }
        // An empty ruleset is no ruleset, as the backend stores it.
        else if (message.op === "set" && message.part === "ruleset" && isRecord(message.value) && Object.keys(message.value).length === 0) delete this.draft.ruleset;
        else if (message.op === "set") (this.draft as unknown as Record<string, JsonValue>)[message.part] = message.value;
        // As the backend does on every write: the map's places, grid and routes follow it.
        this.draft = compileMaps(this.draft);
        const stored = JSON.stringify(this.draft) !== JSON.stringify(this.world);
        const cap = this.draft.packs.economy?.config.unpricedCap;
        const capLint = cap === undefined || (typeof cap === "number" && Number.isSafeInteger(cap) && cap > 0) ? [] : [{ severity: "warning" as const, path: "packs.economy.config.unpricedCap", code: "economy.unpriced_cap", message: "The narrated-price cap should be a whole number of cents above zero; narrated prices are capped at the default, $14.00." }];
        return this.result(reqId, "lre.editor", { draft: structuredClone(this.draft), base: WORLDS[0]?.head ?? null, stored, lint: [{ severity: "warning", path: "tracks.q_raise.stages.orphan", code: "unreachable_stage", message: "Stage “Old idea” can't be reached from the start." }, ...capLint, ...mapLint(this.draft)] });
      }
      case "lre.ui":
        this.options.closeDrawer();
        return this.result(reqId, "lre.ui", { done: true });
      case "lre.map":
        this.result(reqId, "lre.map", { display: message.display });
        this.mutate((view) => {
          view.mapDisplay = message.display;
        });
        return;
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
        const proposals = kind === "describe_map" ? this.mapProposals(message.input) : kind === "index_book" || kind === "index_text" ? LORE_PROPOSALS : PROPOSALS;
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
        // The preview's "Rosie's Diner" was indexed from Town lore, whose entry has changed since.
        const content = "Rosie's opens at six and closes at two since the new lunch place opened. The booths by the window go first; the counter is for regulars.";
        const drift = this.draft.lore.rosies_diner?.source?.kind === "book" && this.draft.lore.rosies_diner.source.hash === "stale" ? { rosies_diner: { status: "changed" as const, content, hash: "fresh" } } : {};
        return this.result(reqId, "lre.lore", { drift: message.id === undefined || message.id === "rosies_diner" ? drift : {} });
      }
    }
  }
}
