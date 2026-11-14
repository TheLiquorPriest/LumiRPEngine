// The lore's tools as the host hands them to RPH (plan §6.8, Appendix A `ToolsPort`), the batch an
// indexing run is given by name (`index:batch`, the indexer's `given:`), and the lore a character's
// agent is given as its own (`index:known-to-self`, the character's `given:`). As with the engine's and the
// story's tools, code holds a tool's name, family, tier, lane and the shape of its arguments; its
// description and each argument's text are its file in `.tools/`, and every sentence of an answer is
// a line of `.prompts/lore-answers.md`. An answer is data plus those lines. The lore may not reach the
// engine's tool kit, so it reads the files through RPH's guidance and makes its answers here, in the
// kit's shape: data as JSON, then lines.
//
// `lore_index_write` keeps an indexing run's lines and answers with the next batch, so one run goes
// on batch after batch for as long as its own limits let it. What a run is asked to do is its
// definition's (`.agents/indexer.md`); nothing here starts one.

import type { Fields, Guidance, LinesPart } from "rp-harness";
import type { AgentRef, HostTool, JsonObject, JsonSchema, JsonValue, ToolContent, ToolCtx, ToolResult } from "rp-harness/contract";
import type { IndexedEntry, LoreBinding, LoreIndex, LoreIndexInput } from "./indexing";
import type { LoreAt } from "./lore";

/** The prompt part every lore answer, the batch, the readable index and the lore map's lines are worded by. */
export const LORE_ANSWERS = "lore-answers";

/** The name an agent is given the next batch by: a host's name, since RPH reads every `lore:` name as a lore entry. */
export const LORE_BATCH = "index:batch";

/** The name a character's agent is given the lore its character knows by: a host's name, for the same reason. */
export const LORE_KNOWN = "index:known-to-self";

/** The lore's lane, under which the user's Auto / Confirm / Never applies to its writes. */
export const LORE_LANE = "lore";

/** The answers' lines in force for the chat; undefined when the part is off, so every answer is given with no words. */
export async function loreLines(guidance: Guidance): Promise<LinesPart | undefined> {
  const part = await guidance.part(LORE_ANSWERS);
  return part?.format === "lines" ? part : undefined;
}

/** One line of the answers' part, filled; undefined when the part has no such line, or fills it with nothing. */
export function loreLine(lines: LinesPart | undefined, name: string, fields: Fields = {}): string | undefined {
  const text = lines?.line(name, fields);
  return text === undefined || text.trim() === "" ? undefined : text;
}

/** A binding as the lines show it. */
function bindingText(lines: LinesPart | undefined, b: LoreBinding): string {
  return loreLine(lines, "binding", { what: b.what, aspect: b.aspect }) ?? b.what;
}

/**
 * A list as a field the lines read: put in whole, joined, and a block on it shown once when it has
 * anything in it, rather than once for each item (the templates' own value under ".").
 */
export function listField(list: readonly string[]): { ".": string[] } {
  return { ".": [...list] };
}

/** An entry's fields as every line of the index and the batch reads them. */
export function entryFields(lines: LinesPart | undefined, e: IndexedEntry): Fields {
  return {
    id: e.id,
    title: e.title,
    source: e.source,
    keys: listField(e.keys),
    size: e.size,
    activation: listField(e.activation),
    kind: e.kind,
    line: e.line,
    defines: listField(e.defines.map((b) => bindingText(lines, b))),
    related: listField(e.related),
    indexed: e.indexed,
    stale: e.stale,
    revision: e.revision,
  };
}

/**
 * The next batch, as an indexing run is given it: a head line counting it and what is left, then each
 * entry's lines and its text. A line the part does not have is not shown; with nothing left, the part's
 * line that says so.
 */
export function batchText(lines: LinesPart | undefined, batch: { entries: readonly IndexedEntry[]; left: number }): string {
  if (batch.entries.length === 0) return loreLine(lines, "batch_none") ?? "";
  const out: string[] = [];
  const head = loreLine(lines, "batch_head", { count: batch.entries.length, left: batch.left });
  if (head !== undefined) out.push(head);
  for (const e of batch.entries) {
    const fields = { ...entryFields(lines, e), text: e.text };
    const parts = ["batch_entry", "batch_text"].flatMap((name) => loreLine(lines, name, fields) ?? []);
    if (parts.length > 0) out.push(parts.join("\n"));
  }
  return out.join("\n\n");
}

/** The `index:batch` block for a scope: the next batch of the chat's lore, worded by the lines in force. */
export async function loreBatchBlock(index: LoreIndex, at: LoreAt, guidance: Guidance): Promise<string> {
  return batchText(await loreLines(guidance), await index.batch(at));
}

/**
 * The `index:known-to-self` block for an agent: the lore bound as known to the character it plays
 * (`LoreIndex.knownTo`), each entry's line and its text, worded by the lines in force; the part's line
 * that says there is none, when none is. Nothing for an agent that plays no one in the chat's world.
 */
export async function loreKnownBlock(index: LoreIndex, at: LoreAt, agent: AgentRef, guidance: Guidance): Promise<string> {
  const known = agent.plays === undefined ? null : await index.knownTo(at, agent.plays);
  if (known === null) return "";
  const lines = await loreLines(guidance);
  if (known.length === 0) return loreLine(lines, "known_none") ?? "";
  const out: string[] = [];
  for (const e of known) {
    const fields = { id: e.id, title: e.title, source: e.source, keys: listField(e.keys), text: e.text };
    const parts = ["known_entry", "known_text"].flatMap((name) => loreLine(lines, name, fields) ?? []);
    if (parts.length > 0) out.push(parts.join("\n"));
  }
  return out.join("\n\n");
}

// ---------------------------------------------------------------- answers

/** An answer being made, in the shape of the engine's tools' answers: data as JSON, then lines of the answers' part. */
class Answer {
  readonly content: ToolContent[] = [];
  failed = false;

  constructor(readonly lines: LinesPart | undefined) {}

  data(value: JsonValue): this {
    this.content.push({ type: "text", text: JSON.stringify(value) });
    return this;
  }

  line(name: string, fields: Fields = {}): this {
    const text = loreLine(this.lines, name, fields);
    if (text !== undefined) this.content.push({ type: "text", text });
    return this;
  }

  text(text: string): this {
    if (text.trim() !== "") this.content.push({ type: "text", text });
    return this;
  }

  fail(): this {
    this.failed = true;
    return this;
  }

  result(): ToolResult {
    return { content: this.content, ...(this.failed ? { error: true as const } : {}) };
  }
}

/** A lore tool as code holds it: everything but its words. */
interface LoreToolSpec {
  name: string;
  family: string;
  tier: "read" | "write";
  lane?: string;
  properties: Record<string, JsonObject>;
  required: readonly string[];
  run(args: JsonObject, call: { at: LoreAt; ctx: ToolCtx; deps: LoreToolDeps; answer: Answer }): Promise<Answer>;
}

/** The schema with each argument's text where the tool's file gives one, by its path through properties and list items (`entries.kind`). */
function described(properties: Readonly<Record<string, JsonObject>>, required: readonly string[], said: Readonly<Record<string, unknown>>): JsonSchema {
  const walk = (schema: JsonObject, path: string): JsonObject => {
    const out: JsonObject = { ...schema };
    const text = said[path];
    if (typeof text === "string") out.description = text.trim();
    const props = schema.properties;
    if (typeof props === "object" && props !== null && !Array.isArray(props)) out.properties = Object.fromEntries(Object.entries(props).map(([name, inner]) => [name, walk(inner as JsonObject, `${path}.${name}`)]));
    const items = schema.items;
    if (typeof items === "object" && items !== null && !Array.isArray(items)) out.items = walk(items as JsonObject, path);
    return out;
  };
  return { type: "object", properties: Object.fromEntries(Object.entries(properties).map(([name, schema]) => [name, walk(schema, name)])), ...(required.length > 0 ? { required: [...required] } : {}) };
}

// ---------------------------------------------------------------- lore_index_write

const TEXT: JsonObject = { type: "string" };

/** Reads one entry a run handed back: its lines and the revision it read them from, or what of it cannot be read. */
function readInput(raw: unknown): { input: LoreIndexInput } | { needs: string[] } | { unreadable: string; value: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { unreadable: "entry", value: JSON.stringify(raw ?? null) };
  const given = raw as Record<string, unknown>;
  const text = (name: string): string | null => (typeof given[name] === "string" && (given[name] as string).trim() !== "" ? (given[name] as string).replace(/\s+/g, " ").trim() : null);
  const id = text("id");
  const kind = text("kind");
  const line = text("line");
  // A book entry's revision is Lumiverse's number, which a model may send as one.
  const revision = typeof given.revision === "number" && Number.isFinite(given.revision) ? String(given.revision) : text("revision");
  const needs = [...(id === null ? ["id"] : []), ...(revision === null ? ["revision"] : []), ...(kind === null ? ["kind"] : []), ...(line === null ? ["line"] : [])];
  if (id === null || revision === null || kind === null || line === null) return { needs };
  for (const name of ["defines", "related"]) if (given[name] !== undefined && !Array.isArray(given[name])) return { unreadable: name, value: JSON.stringify(given[name]) };
  const defines = ((given.defines as unknown[] | undefined) ?? []).flatMap((b): LoreBinding[] => {
    if (typeof b === "string" && b.trim() !== "") return [{ what: b.trim(), aspect: "" }];
    if (typeof b !== "object" || b === null) return [];
    const { what, aspect } = b as Record<string, unknown>;
    return typeof what === "string" && what.trim() !== "" ? [{ what: what.trim(), aspect: typeof aspect === "string" ? aspect.trim() : "" }] : [];
  });
  const related = ((given.related as unknown[] | undefined) ?? []).filter((r): r is string => typeof r === "string" && r.trim() !== "").map((r) => r.trim());
  return { input: { id, revision, kind, line, defines, related } };
}

export const LORE_INDEX_WRITE: LoreToolSpec = {
  name: "lore_index_write",
  family: "lore",
  tier: "write",
  lane: LORE_LANE,
  // Nothing is held back by the schema: an entry that cannot be read is answered in the answers' words.
  properties: { entries: { type: "array", items: { type: "object", properties: { id: TEXT, revision: TEXT, kind: TEXT, line: TEXT, defines: { type: "array", items: { type: "object", properties: { what: TEXT, aspect: TEXT } } }, related: { type: "array", items: TEXT } } } } },
  required: [],
  async run(args, { at, ctx, deps, answer }) {
    const list = args.entries;
    if (!Array.isArray(list) || list.length === 0) return answer.line("no_entries").fail();
    const inputs: { n: number; input: LoreIndexInput }[] = [];
    for (const [i, raw] of list.entries()) {
      const read = readInput(raw);
      const n = i + 1;
      if ("input" in read) inputs.push({ n, input: read.input });
      else if ("needs" in read) answer.line("needs", { n, fields: read.needs });
      else answer.line("unreadable", { n, field: read.unreadable, value: read.value });
    }
    const outcomes = await deps.index.write(at, inputs.map((i) => i.input), ctx.agent.definition);
    const kept: JsonObject[] = [];
    for (const [i, outcome] of outcomes.entries()) {
      if ("unknown" in outcome) answer.line("unknown_entry", { n: inputs[i]?.n ?? 0, id: outcome.id });
      else kept.push({ id: outcome.id, title: outcome.kept.title, kind: outcome.kept.kind, line: outcome.kept.line, defines: outcome.kept.defines.map((b) => ({ what: b.what, aspect: b.aspect })), related: outcome.kept.related });
    }
    const next = await deps.index.batch(at);
    answer.data({ kept, left: next.left });
    answer.line("kept", { count: kept.length, left: next.left });
    if (kept.length === 0) answer.fail();
    return answer.text(batchText(answer.lines, next));
  },
};

/** What the lore's tools are given by the host (the turn lane). */
export interface LoreToolDeps {
  index: LoreIndex;
  /** The guidance in force for the chat: each tool's words from its file, every answer's from `.prompts/lore-answers.md`. */
  guidance: Guidance;
}

export const LORE_TOOLS: readonly LoreToolSpec[] = [LORE_INDEX_WRITE];

/** The lore's tools for a chat, as RPH holds them. A tool whose file is not in force for the chat (switched off) is not offered. */
export async function loreTools(deps: LoreToolDeps): Promise<HostTool[]> {
  const lines = await loreLines(deps.guidance);
  const out: HostTool[] = [];
  for (const spec of LORE_TOOLS) {
    const file = await deps.guidance.tool(spec.name);
    if (file === undefined || file.format !== "template") continue;
    const said = file.header.arguments;
    out.push({
      name: spec.name,
      family: spec.family,
      tier: spec.tier,
      ...(spec.lane !== undefined ? { lane: spec.lane } : {}),
      description: file.render().text.trim(),
      parameters: described(spec.properties, spec.required, typeof said === "object" && said !== null && !Array.isArray(said) ? said : {}),
      async run(args: JsonValue, ctx: ToolCtx): Promise<ToolResult> {
        const given = typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
        const at: LoreAt = { user: ctx.scope.user, chat: ctx.scope.chat, ...(ctx.scope.turn !== undefined ? { turn: ctx.scope.turn } : {}) };
        return (await spec.run(given, { at, ctx, deps, answer: new Answer(lines) })).result();
      },
    });
  }
  return out;
}
