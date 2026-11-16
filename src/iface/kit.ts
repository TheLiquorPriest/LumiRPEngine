// What every engine tool is made of (plan §6.8): a spec in code (its name, family, tier, lane, the
// shape of its arguments, a worked example and what it runs) and the words in files (its
// description and each argument's text from `.tools/<name>.md`; every sentence of its answers from
// `.prompts/engine-answers.md`). An answer is data from the store plus lines from that file.

import type { Database } from "bun:sqlite";
import type { AgentRef, ApprovalsPort, HostTool, JsonObject, JsonSchema, JsonValue, Scope, ToolContent, ToolCtx, ToolResult, ToolTier } from "rp-harness/contract";
import type { NumberSettings, Setting } from "../app/setting-list";
import type { MapConfig } from "../shared/map-config";
import type { UserStore } from "../store/store";
import type { FoldEnv } from "../store/fold";
import type { ChangeInput, Lane, StoreState } from "../store/types";
import { JoinedTurnError } from "../store/types";
import type { Part } from "../store/words";
import { saysUnreadable, ScopeError } from "./reading";
import type { Fields, GuidanceFiles, Lines, ToolText } from "./texts";

/** Every fixed value of the engine's tools, each a setting with this default. */
export const IFACE_DEFAULTS = Object.freeze({
  /** How many near matches an answer about a name that is not there lists. */
  nearMatches: 5,
  /** How far off in spelling a name may be and still be offered as a near match, as a part of the name's length (a quarter of it). */
  nearDistance: 0.25,
  /** How many levels below its point `world_query` shows when it names no depth. */
  queryDepth: 1,
  /** How many things `world_search` answers with at most. */
  searchHits: 10,
  /** How many things falling due in a span an answer lists at most, soonest first; how many more fall in the span is said, not listed. */
  dueItems: 50,
  /** The credit score the finance tables are read at for someone with no score recorded. */
  creditScoreAssumed: 700,
  /** The most operations one GM edit carries. */
  editOps: 64,
});

export type IfaceSettings = { -readonly [K in keyof typeof IFACE_DEFAULTS]: number };

/**
 * Each of the engine tools' settings as a config file writes it, under `engine:`, read at every level and
 * taken in by the host (the turn lane) for the chat a call is in, at each turn.
 */
export const IFACE_SETTING_DEFS = {
  nearMatches: { key: "engine.nearMatches", default: IFACE_DEFAULTS.nearMatches, takes: { type: "whole", least: 0 }, perConnection: false, name: "Near matches listed", about: "How many near matches an answer about a name that is not there lists.", effect: "turn" },
  nearDistance: { key: "engine.nearDistance", default: IFACE_DEFAULTS.nearDistance, takes: { type: "number", least: 0 }, perConnection: false, name: "Spelling distance of a near match", about: "How far off in spelling a name may be and still be offered as a near match, as a part of the name's length: 0.25 lets a quarter of its letters differ.", effect: "turn" },
  queryDepth: { key: "engine.queryDepth", default: IFACE_DEFAULTS.queryDepth, takes: { type: "whole", least: 0 }, perConnection: false, name: "Depth of a world query", about: "How many levels below its point world_query shows when it names no depth.", effect: "turn" },
  // A search that may give no hit at all would answer nothing whatever it was asked.
  searchHits: { key: "engine.searchHits", default: IFACE_DEFAULTS.searchHits, takes: { type: "whole", least: 1 }, perConnection: false, name: "Hits a world search gives", about: "The most things one world_search answers with.", effect: "turn" },
  dueItems: { key: "engine.dueItems", default: IFACE_DEFAULTS.dueItems, takes: { type: "whole", least: 0 }, perConnection: false, name: "Things falling due listed", about: "The most things falling due in a span an answer lists, soonest first; how many more fall in it is said.", effect: "turn" },
  creditScoreAssumed: { key: "engine.creditScoreAssumed", default: IFACE_DEFAULTS.creditScoreAssumed, takes: { type: "whole", least: 300, most: 850 }, perConnection: false, name: "Score assumed for someone with none", about: "The credit score the finance tables are read at for someone with no score recorded.", effect: "turn" },
  editOps: { key: "engine.editOps", default: IFACE_DEFAULTS.editOps, takes: { type: "whole", least: 1 }, perConnection: false, name: "Operations one GM edit carries", about: "The most operations one GM edit carries; an edit with more is refused naming this setting, and one already recorded is never held to it.", effect: "turn" },
} as const satisfies NumberSettings<keyof IfaceSettings>;

/** Every setting the engine's tools read, as a config file writes it. */
export const IFACE_SETTINGS: readonly Setting[] = Object.values(IFACE_SETTING_DEFS);

/** The application's one write queue (`App.writes`): every change the tools record goes through it. */
export interface Writes {
  run<T>(write: (db: Database) => T, label?: string): Promise<T>;
}

/** One thing a span of time brings due, as the store lists it (`src/store/due.ts`): data only, nothing applied. */
export interface DueItem {
  /** When, in minutes since the world's epoch. */
  at: number;
  /** What kind of thing falls due (a schedule, a routine, an arrival, a need, an effect ending, a future, a price, the weather). */
  kind: string;
  /** Where in the tree it falls: a tree ref. */
  where?: string;
  /** Who or what it concerns, by entity id. */
  who?: string[];
  /** The record it comes from, as the store names it. */
  what: JsonValue;
}

/** What a span brings due as far as the store lists it: the soonest, in time order, and how many more fall in the span. */
export interface DueListing {
  items: DueItem[];
  /** How many more fall in the span than are listed; null when more do, but the store could count them only by going through the span year by year. */
  more: number | null;
}

/** What time brings due (plan §6.4): the store's list (`src/store/due.ts`), for a span and a part of the tree, the soonest `most` in time order, the rest counted. It applies none of it. */
export interface DueList {
  due(state: StoreState, span: { from: number; to: number }, at: string | null, most: number): DueListing;
}

/** One thing found by words. */
export interface StateHit {
  /** Its tree ref. */
  ref: string;
  name: string;
  /** What it is: its kind's label, or "place". */
  what: string;
  /** Where it is, as a tree ref, when it is somewhere. */
  where?: string;
  /** What the words matched: its name, another name, its description, a note. */
  matched: string;
}

/** The search over a chat's state by words (plan §6.8 `world_search`). */
export interface StateSearch {
  search(state: StoreState, env: FoldEnv, words: string, opts: { kind?: SearchKind; limit: number }): StateHit[];
}

export const SEARCH_KINDS = ["person", "thing", "place", "group"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** A statement about a thing, as the `fact` operation gives it to the fact store (plan §6.6). */
export interface FactWrite {
  /** The tree ref of what it is about. */
  about: string;
  /** A key the agent chooses; the same key replaces. */
  key: string;
  /** The value in words. */
  value: string;
  /** The id of a standing fact this one replaces, whatever its key. */
  replaces?: string;
}

/** The fact store as the engine's tools hold it (the store's `factStore`): what records a fact, and what a thing's facts are now. */
export interface FactStore {
  /** The change that records `fact` (the store operation and its value). */
  change(fact: FactWrite): Pick<ChangeInput, "op" | "value">;
  /** The facts standing on `about` in this state, as data. */
  of(state: StoreState, about: string): JsonValue[];
}

/**
 * Placing on a map's squares (`src/iface/map/`): the events that put someone or something at a
 * square, beside someone, or in a zone; and `said`, the sentences the answer gives of it, worded
 * from the map's part: for one that stood on the map before, the way it went and the time that
 * took, and what does not add up where it now stands (a square in a wall, over something that
 * blocks, no way there). It is applied all the same.
 */
export interface GridMoves {
  place(input: { state: StoreState; env: FoldEnv; who: string; place: string; square?: [number, number]; near?: string; zone?: string }): { events: JsonObject[]; said?: string[] } | { problem: string; fields: Fields };
}

/** A place's map as the world state prints it (`src/iface/map/`): its text, or null for a place with no map. */
export interface MapView {
  text(input: { state: StoreState; env: FoldEnv; place: string }): string | null;
}

/** What the engine's tools are given by the host (the turn, `src/turn/`). */
export interface EngineDeps {
  /** The store's user API, for the scope's user. */
  store: UserStore;
  /** What the store folds with: the registry and the world documents by revision. */
  env: FoldEnv;
  /** The write queue: every change goes through it. */
  writes: Writes;
  /** The guidance files in force for the chat: tool descriptions and the answers' lines. */
  files: GuidanceFiles;
  /** The search `world_search` runs. */
  search: StateSearch;
  /** The user's Auto / Confirm / Never per lane; absent, every lane is Auto (Appendix D.1). */
  approvals?: ApprovalsPort;
  /** What time brings due, for an answer that lets time pass and for what a span of `world_query` lists. */
  due: DueList;
  /** Squares on a map, for the operations that name one. */
  grid: GridMoves;
  /** A place's map as text, for what `world_query` shows of a place. */
  map: MapView;
  /** Settings over `IFACE_DEFAULTS`. */
  settings?: Partial<IfaceSettings>;
  /** The map's settings for the chat (`map:` in its config), for the map tools; absent, their defaults. */
  mapSettings?: MapConfig;
  /** Milliseconds since 1970, for an approval's question; `Date.now` when absent. */
  now?: () => number;
}

// ---------------------------------------------------------------- answers

/** How a part of an answer came to be, for the live view and for the test that holds words to files. */
export type PartKind = "data" | "line" | "tree";

/** A report kept as data: the line's name and its fields beside its words, and the operation it is about (the field `n`), so the store can keep it with the change. */
export interface KeptReport {
  line: string;
  fields: Fields;
  words: string;
  n?: number;
}

/**
 * An answer being made: parts the model reads (data as JSON, the store's tree as it prints it, and
 * lines of the answers' file), reports (lines too), marks a rule can name, and details for the live
 * view. Nothing here holds a word of its own.
 */
export class Reply {
  readonly parts: ToolContent[] = [];
  readonly kinds: PartKind[] = [];
  readonly reports: string[] = [];
  /** Each report as data, in the order they were made. */
  readonly kept: KeptReport[] = [];
  readonly marks = new Set<string>();
  details: JsonObject = {};
  failed = false;

  constructor(private readonly lines: Lines) {}

  data(value: JsonValue): this {
    this.parts.push({ type: "text", text: JSON.stringify(value) });
    this.kinds.push("data");
    return this;
  }

  /** The store's tree as the tree's part words it; nothing when it words to nothing. */
  tree(text: string): this {
    if (text.trim() === "") return this;
    this.parts.push({ type: "text", text });
    this.kinds.push("tree");
    return this;
  }

  /** Whether the answers' file has a line called `name`. */
  says(name: string): boolean {
    return this.lines.has(name);
  }

  /** A line of the answers' file, filled; nothing when the file has no such line. */
  line(name: string, fields: Fields = {}): this {
    const text = this.lines.line(name, fields);
    if (text !== undefined && text.trim() !== "") {
      this.parts.push({ type: "text", text });
      this.kinds.push("line");
    }
    return this;
  }

  /** A report, as a line of the answers' file. */
  report(name: string, fields: Fields = {}): this {
    const text = this.lines.line(name, fields);
    if (text !== undefined && text.trim() !== "") {
      this.reports.push(text);
      this.kept.push({ line: name, fields, words: text, ...(typeof fields.n === "number" ? { n: fields.n } : {}) });
    }
    return this;
  }

  mark(mark: string): this {
    this.marks.add(mark);
    return this;
  }

  /** The call did not do what it was asked: the answer says why, in lines. */
  fail(): this {
    this.failed = true;
    return this;
  }

  /**
   * What a refusal carries as data (the `choices` a value was one of, or the `near` names a name was drawn from), kept in the
   * answer's details beside the sentence the model reads: for the Turn page, a rule and the next tool to build on.
   */
  refusedWith(data: JsonObject): this {
    this.details = { ...this.details, refused: data };
    return this;
  }

  result(): ToolResult {
    return {
      content: this.parts,
      ...(this.failed ? { error: true as const } : {}),
      ...(this.reports.length > 0 ? { reports: [...this.reports] } : {}),
      ...(this.marks.size > 0 ? { marks: [...this.marks] } : {}),
      details: { ...this.details, parts: this.kinds },
    };
  }
}

// ---------------------------------------------------------------- tool specs

/** One call of a tool: who calls, where, and what the call has to hand. */
export interface Call {
  scope: Scope;
  agent: AgentRef;
  callId: string;
  signal: AbortSignal;
  /** The tool's own name, as the approvals and the details name it. */
  tool: string;
  deps: EngineDeps;
  settings: IfaceSettings;
  lines: Lines;
  /** The words of the world's tree (the world state's part), for an answer that shows part of the tree. */
  tree: Part;
  reply(): Reply;
}

/** The words every answer is given in, read once for the list of tools: the answers' lines and the tree's part. */
export interface Words {
  lines: Lines;
  tree: Part;
}

/** A tool as code holds it: everything but its words. */
export interface ToolSpec {
  name: string;
  family: string;
  tier: ToolTier;
  /** For a tool all of whose writes go to one lane. `world_apply` names none: each operation says its own. */
  lane?: Lane;
  /** Its arguments' schemas, with no description: each argument's text is in the tool's file. */
  properties: Record<string, JsonObject>;
  required: readonly string[];
  /** A worked call, for the operation reference and the tests. */
  example: JsonObject;
  run(args: JsonObject, call: Call): Promise<Reply>;
}

/**
 * The schema with each argument's text where the tool's file gives one. A path names an argument
 * through properties and list items: `operations` is the list, `operations.to` a property of each
 * of its items.
 */
export function described(properties: Readonly<Record<string, JsonObject>>, required: readonly string[], text: ToolText): JsonSchema {
  const walk = (schema: JsonObject, path: string): JsonObject => {
    const out: JsonObject = { ...schema };
    const said = text.arguments[path];
    if (said !== undefined) out.description = said;
    const props = schema.properties;
    if (typeof props === "object" && props !== null && !Array.isArray(props)) {
      out.properties = Object.fromEntries(Object.entries(props).map(([name, inner]) => [name, walk(inner as JsonObject, `${path}.${name}`)]));
    }
    const items = schema.items;
    if (typeof items === "object" && items !== null && !Array.isArray(items)) out.items = walk(items as JsonObject, path);
    return out;
  };
  return {
    type: "object",
    properties: Object.fromEntries(Object.entries(properties).map(([name, schema]) => [name, walk(schema, name)])),
    ...(required.length > 0 ? { required: [...required] } : {}),
  };
}

/**
 * What a call's thrown error is answered as, for any area's tool: a fault in RPE's own code, said in the words of the
 * answers' file in force (the line `engine_fault`), handed to the store's own sink for the log and the live view (`turn`: the
 * turn the call belongs to, "" when none), and kept in the call's details (`fault`) so the Turn page shows it as a fault,
 * never as the agent's write refused.
 */
export function faultAnswer(lines: Lines, tool: string, error: unknown, failed: FoldEnv["failed"], turn: string): ToolResult {
  failed?.({ op: tool, error, turn, change: null });
  const reply = new Reply(lines).line("engine_fault", { tool }).fail();
  reply.details = { fault: { tool, error: error instanceof Error ? error.message : String(error), ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}) } };
  return reply.result();
}

/**
 * A tool as RPH holds it: its spec with its file's words, run with the call's context. A throw in its code is a fault, answered as
 * one (`faultAnswer`); a scope found unreadable while it ran (a turn joined to another in between) is told as the fact.
 */
export function hostTool(spec: ToolSpec, text: ToolText, words: Words, deps: EngineDeps): HostTool {
  const settings: IfaceSettings = { ...IFACE_DEFAULTS, ...(deps.settings ?? {}) };
  return {
    name: spec.name,
    family: spec.family,
    tier: spec.tier,
    ...(spec.lane !== undefined ? { lane: spec.lane } : {}),
    description: text.description,
    parameters: described(spec.properties, spec.required, text),
    async run(args: JsonValue, ctx: ToolCtx): Promise<ToolResult> {
      const given = typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
      const call: Call = { scope: ctx.scope, agent: ctx.agent, callId: ctx.callId, signal: ctx.signal, tool: spec.name, deps, settings, lines: words.lines, tree: words.tree, reply: () => new Reply(words.lines) };
      try {
        return (await spec.run(given, call)).result();
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        if (error instanceof ScopeError) return saysUnreadable(new Reply(words.lines), error.why).result();
        if (error instanceof JoinedTurnError) return saysUnreadable(new Reply(words.lines), { missing: "joined", id: error.turn, into: error.joined }).result();
        return faultAnswer(words.lines, spec.name, error, deps.env.failed, ctx.scope.turn ?? "");
      }
    },
  };
}

// ---------------------------------------------------------------- schema pieces

export const TEXT: JsonObject = { type: "string" };
export const NUMBER: JsonObject = { type: "number" };
export const WHOLE: JsonObject = { type: "integer" };
export const YES_NO: JsonObject = { type: "boolean" };
export const TEXTS: JsonObject = { type: "array", items: { type: "string" } };
export const OBJECT: JsonObject = { type: "object" };

export function oneOf(values: readonly string[]): JsonObject {
  return { type: "string", enum: [...values] };
}
