// What the story lane's tools are made of, the same kind of thing as the engine's (plan §6.8): a spec
// in code (name, family, tier, lane, the shape of the arguments, a worked call, what it runs) and the
// words in files (the description and each argument's text from `.tools/<name>.md`, every sentence of
// an answer from `.prompts/story-answers.md`). An answer is data from the record plus those lines,
// made with the engine's own answer builder, so both lanes answer in one shape.

import type { Database } from "bun:sqlite";
import type { AgentRef, HostTool, JsonObject, JsonValue, Scope, ToolCtx, ToolResult, ToolTier } from "rp-harness/contract";
import { calendarOf, clockOfStamp, formatClock, placeOffset } from "../engine/calendar";
import { placeOfEntity } from "../engine/scope";
import { resolveTarget, typedSpan } from "../engine/time";
import { described, Reply, type Writes } from "../iface/kit";
import { type GuidanceFiles, Lines, toolText } from "../iface/texts";
import { clockRecorded, type Store } from "../store";
import { storyAt } from "./path";
import { type Span, type StoryItem, StoryRecord } from "./record";

/** Every fixed value of the story tools, each a setting with this default. */
export const STORY_DEFAULTS = Object.freeze({
  /** The most items one `story_query` answers with; the answer says how many more match. */
  queryItems: 50,
});

export type StorySettings = { -readonly [K in keyof typeof STORY_DEFAULTS]: number };

/** The prompt part every answer's sentences come from. */
export const STORY_ANSWERS = "story-answers";

/**
 * The lore lane's (plan §9.3): an overlay, a note tied to the turn that the story has moved past part
 * of a lore entry, the entry itself untouched. It runs inside the story's queued write, on the same
 * database, so a call's writes stand or fall together. It answers with what it wrote, as data, or
 * with the entry it does not know and any near it.
 */
export type LoreOverlay = (db: Database, input: { user: string; chat: string; turn: string; entry: string; note: string; by: string | null; agent: string | null; job: string | null; ord: number }) => { written: JsonObject } | { unknown: string; near?: string[] };

/** What the story tools are given by the host (the turn lane). */
export interface StoryDeps {
  /** The store: its database holds the story record; each call reads its scope's user. */
  store: Store;
  /** The application's write queue: every write goes through it. */
  writes: Writes;
  /** The guidance files in force for the chat: the tools' descriptions and the answers' lines. */
  files: GuidanceFiles;
  /** The lore lane's overlay: what the story's `overlay` operation writes through. The live turn always gives it. */
  overlay: LoreOverlay;
  /** Settings over `STORY_DEFAULTS`. */
  settings?: Partial<StorySettings>;
  /** Milliseconds since 1970, for a row's time; `Date.now` when absent. */
  now?: () => number;
}

/** One call of a story tool. */
export interface StoryCall {
  scope: Scope;
  agent: AgentRef;
  callId: string;
  signal: AbortSignal;
  tool: string;
  deps: StoryDeps;
  settings: StorySettings;
  /** The answers' lines in force, for the words one line puts inside another (`wants_`). */
  lines: Lines;
  reply(): Reply;
}

/** A story tool as code holds it: everything but its words. */
export interface StoryToolSpec {
  name: string;
  family: string;
  tier: ToolTier;
  lane?: string;
  properties: Record<string, JsonObject>;
  required: readonly string[];
  /** A worked call, for the tests. */
  example: JsonObject;
  run(args: JsonObject, call: StoryCall): Promise<Reply>;
}

/** The answers' lines in force for the chat; none when the part is switched off, so every answer is given with no words. */
export async function storyLines(files: GuidanceFiles): Promise<Lines> {
  const text = await files.read("prompts", STORY_ANSWERS);
  return text === undefined ? Lines.none() : Lines.parse(text, `.prompts/${STORY_ANSWERS}.md`);
}

/** A story tool as RPH holds it, or null when its file is not in force for the chat. */
export async function storyHostTool(spec: StoryToolSpec, lines: Lines, deps: StoryDeps): Promise<HostTool | null> {
  const file = await deps.files.read("tools", spec.name);
  if (file === undefined) return null;
  const text = toolText(file, `.tools/${spec.name}.md`);
  const settings: StorySettings = { ...STORY_DEFAULTS, ...(deps.settings ?? {}) };
  return {
    name: spec.name,
    family: spec.family,
    tier: spec.tier,
    ...(spec.lane !== undefined ? { lane: spec.lane } : {}),
    description: text.description,
    parameters: described(spec.properties, spec.required, text),
    async run(args: JsonValue, ctx: ToolCtx): Promise<ToolResult> {
      const given = typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
      const call: StoryCall = { scope: ctx.scope, agent: ctx.agent, callId: ctx.callId, signal: ctx.signal, tool: spec.name, deps, settings, lines, reply: () => new Reply(lines) };
      return (await spec.run(given, call)).result();
    },
  };
}

// ---------------------------------------------------------------- reading

/** The record a call reads: at its turn, or at the chat's head when it has none. A line says what is missing when the scope names a chat or a turn the store does not have. */
export function recordOr(call: StoryCall, reply: Reply): StoryRecord | null {
  const user = call.deps.store.user(call.scope.user);
  if (user.chat(call.scope.chat) === null) {
    reply.line("no_chat", { id: call.scope.chat }).fail();
    return null;
  }
  const turn = call.scope.turn ?? null;
  if (turn !== null && user.turn(turn)?.chat !== call.scope.chat) {
    reply.line("no_turn", { id: turn }).fail();
    return null;
  }
  return StoryRecord.read(call.deps.store.db, call.scope.user, storyAt(user, call.scope.chat, turn));
}

/** Story time, where the chat keeps a clock: now, a time read as the engine reads one, and a time as answers show it. */
export interface StoryClock {
  /** Minutes since the world's epoch. */
  now: number;
  /** A date and time of day at the scene's place (`YYYY-MM-DD HH:MM`), or words for a span from now; null when it reads as neither. */
  read(said: string): number | null;
  /** A time as answers show it; null while play has not set the clock (the blank world's, until a change moves it): a date nobody set is shown to nobody. */
  text(at: number): string | null;
}

/**
 * The chat's story time at a turn, or at its head, read exactly as the engine's own tools read a time:
 * from the world the state is played on, the blank one for a chat that names none, and a world
 * attached later once the state is upgraded to it. Null for a chat the store does not hold, or a
 * state whose world it cannot find. A time is shown as text once the clock is a recorded value
 * (`clockRecorded`); its minutes count from the first, so what falls due falls due all the same.
 */
export function storyClock(store: Store, user: string, chat: string, turn: string | null): StoryClock | null {
  const u = store.user(user);
  if (u.chat(chat) === null) return null;
  const folded = (turn === null ? u.headState(chat) : u.stateAt(turn)).state;
  const state = folded.world;
  const doc = store.env.worlds(state.revision);
  if (doc === undefined) return null;
  const world = store.env.registry.context(doc, state).world;
  const cal = calendarOf(world);
  const offset = (at: number): number => placeOffset(world, at, placeOfEntity(state, world.pov));
  const shown = clockRecorded(folded);
  return {
    now: state.clock,
    read(said) {
      const text = said.trim();
      const stamp = clockOfStamp(cal, text);
      if (stamp !== null) return stamp - offset(stamp);
      const target = typedSpan(cal, state.clock, ` ${text} `);
      if (target === null) return null;
      if (target.type === "duration") return state.clock + target.minutes;
      const resolved = resolveTarget(store.env.registry, doc, state, target);
      return "code" in resolved ? null : resolved.to;
    },
    text: (at) => (shown ? formatClock(cal, at, offset(at)) : null),
  };
}

// ---------------------------------------------------------------- what answers show

/** A write's fields as answers show them: messages by number, a due time in story time (left out while the clock shows no date). */
export function valueView(record: StoryRecord, value: JsonObject, clock: StoryClock | null): JsonObject {
  const out: JsonObject = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === "first") out.from = record.numberOf(v);
    else if (key === "last") out.to = record.numberOf(v);
    else if (key === "message") out.message = record.numberOf(v);
    else if (key === "due" && typeof v === "number" && clock !== null) {
      const due = clock.text(v);
      if (due !== null) out.due = due;
    } else out[key] = v;
  }
  return out;
}

/**
 * An item as it stands, as answers show it: its id, its fields, where it lies in the chat, whether it
 * is closed or dropped, and the message of the turn that last touched it (null: this turn's reply,
 * not saved yet). With `history`, every write of it on the path, oldest first.
 */
export function itemView(record: StoryRecord, item: StoryItem, clock: StoryClock | null, spans: ReadonlyMap<string, Span>, history = false): JsonObject {
  const { first: _first, last: _last, message: _message, ...fields } = item.fields;
  const out: JsonObject = { id: item.id, ...valueView(record, fields, clock) };
  if (item.part === "beat") out.message = record.beatAt(item);
  else if (item.part === "record") out.message = record.at.replyOf(item.opened);
  else if (item.fields.message !== undefined) out.message = record.numberOf(item.fields.message);
  const span = spans.get(item.id);
  if (span !== undefined) {
    out.from = span.from;
    out.to = span.to;
  }
  if (item.closedBy !== null) out.closed = true;
  if (item.dropped) out.dropped = true;
  out.touched = record.at.replyOf(item.touched);
  if (history) out.history = item.rows.map((r) => ({ touched: record.at.replyOf(r.turn), by: r.by, wrote: valueView(record, r.value, clock) }));
  return out;
}

/** The spans of both timeline parts, by item id. */
export function allSpans(record: StoryRecord): Map<string, Span> {
  return new Map([...record.spans("chapter"), ...record.spans("scene")]);
}

/** The names an item involves: its `who`, a list or one name. */
export function namesOf(item: StoryItem): string[] {
  const who = item.fields.who;
  if (typeof who === "string") return [who];
  return Array.isArray(who) ? who.filter((w): w is string => typeof w === "string") : [];
}
