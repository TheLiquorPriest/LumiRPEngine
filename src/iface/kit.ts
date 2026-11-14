// What every engine tool is made of (plan §6.8): a spec in code (its name, family, tier, lane, the
// shape of its arguments, a worked example and what it runs) and the words in files (its
// description and each argument's text from `.tools/<name>.md`; every sentence of its answers from
// `.prompts/engine-answers.md`). An answer is data from the store plus lines from that file.

import type { Database } from "bun:sqlite";
import type { AgentRef, ApprovalsPort, HostTool, JsonObject, JsonSchema, JsonValue, Scope, ToolContent, ToolCtx, ToolResult, ToolTier } from "rp-harness/contract";
import type { UserStore } from "../store/store";
import type { FoldEnv } from "../store/fold";
import type { ChangeInput, Lane, StoreState } from "../store/types";
import type { Part } from "../store/words";
import type { Fields, GuidanceFiles, Lines, ToolText } from "./texts";

/** Every fixed value of the engine's tools, each a setting with this default. */
export const IFACE_DEFAULTS = Object.freeze({
  /** How many near matches an answer about a name that is not there lists. */
  nearMatches: 5,
  /** How many levels below its point `world_query` shows when it names no depth. */
  queryDepth: 1,
  /** How many things `world_search` answers with at most. */
  searchHits: 10,
});

export type IfaceSettings = { -readonly [K in keyof typeof IFACE_DEFAULTS]: number };

/** The application's one write queue (`App.writes`): every change the tools record goes through it. */
export interface Writes {
  run<T>(write: (db: Database) => T, label?: string): Promise<T>;
}

/** One thing a span of time brings due, as the state lane lists it: data only, nothing applied. */
export interface DueItem {
  /** When, in minutes since the world's epoch. */
  at: number;
  /** What kind of thing falls due (a schedule, a routine, an arrival, a need, an effect ending, a future, a price, the weather). */
  kind: string;
  /** Where in the tree it falls: a tree ref. */
  where?: string;
  /** Who or what it concerns, by entity id. */
  who?: string[];
  /** The record it comes from, as the state lane names it. */
  what: JsonValue;
}

/** What time brings due (plan §6.4): the state lane's list, for a span and a part of the tree. It applies none of it. */
export interface DueList {
  due(state: StoreState, span: { from: number; to: number }, at: string | null): DueItem[];
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

/** Placing on a map's squares (the grid lane's): the events that put someone or something at a square, beside someone, or in a zone. */
export interface GridMoves {
  place(input: { state: StoreState; env: FoldEnv; who: string; place: string; square?: [number, number]; near?: string; zone?: string }): { events: JsonObject[] } | { problem: string; fields: Fields };
}

/** A place's map as the world state prints it (the grid lane's): its text, or null for a place with no map. */
export interface MapView {
  text(input: { state: StoreState; env: FoldEnv; place: string }): string | null;
}

/** What the engine's tools are given by the host (the turn lane). */
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
  /** What time brings due; absent, an answer that lets time pass says that it is not listed. */
  due?: DueList;
  /** Squares on a map; absent, an operation that names a square is answered that there are none. */
  grid?: GridMoves;
  /** A place's map as text; absent, `world_query` answers that it has none to show. */
  map?: MapView;
  /** Settings over `IFACE_DEFAULTS`. */
  settings?: Partial<IfaceSettings>;
  /** Milliseconds since 1970, for an approval's question; `Date.now` when absent. */
  now?: () => number;
}

// ---------------------------------------------------------------- answers

/** How a part of an answer came to be, for the live view and for the test that holds words to files. */
export type PartKind = "data" | "line" | "tree";

/**
 * An answer being made: parts the model reads (data as JSON, the store's tree as it prints it, and
 * lines of the answers' file), reports (lines too), marks a rule can name, and details for the live
 * view. Nothing here holds a word of its own.
 */
export class Reply {
  readonly parts: ToolContent[] = [];
  readonly kinds: PartKind[] = [];
  readonly reports: string[] = [];
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
    if (text !== undefined && text.trim() !== "") this.reports.push(text);
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

/** A tool as RPH holds it: its spec with its file's words, run with the call's context. */
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
      return (await spec.run(given, call)).result();
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
