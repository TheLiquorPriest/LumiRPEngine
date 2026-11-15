// What the cast's tools are made of, the same kind of thing as the engine's and the story's (plan
// §6.8): a spec in code (name, family, tier, lane, the shape of the arguments, a worked call, what it
// runs) and the words in files (the description and each argument's text from `.tools/<name>.md`,
// every sentence of an answer from `.prompts/cast-answers.md`). An answer is data from the record
// plus those lines, made with the engine's own answer builder, so every lane answers in one shape.

import type { AgentRef, HostTool, JsonObject, JsonValue, Scope, ToolCtx, ToolResult, ToolTier } from "rp-harness/contract";
import type { NumberSettings, Setting } from "../app/setting-list";
import { calendarOf, formatClock, placeOffset } from "../engine/calendar";
import { placeOfEntity } from "../engine/scope";
import { described, Reply, type Writes } from "../iface/kit";
import { type GuidanceFiles, Lines, toolText } from "../iface/texts";
import { clockRecorded, type Store, type UserStore } from "../store";
import { castAt } from "./path";
import { type BaseVersion, type CastItem, CastRecord, type Character, chatLine } from "./record";
import type { BookReader } from "./secrets";
import type { SourceReader, SourceState } from "./sources";

/** Every fixed value of the cast's tools, each a setting with this default. */
export const CAST_DEFAULTS = Object.freeze({
  /** The most items of one part one `cast_query` answers with; the answer says how many more there are. */
  queryItems: 50,
  /**
   * How sure, from 0 to 1, a character is of a secret a perception says they now know: the
   * confidence of the holding written for it. 1, the confidence today's build gives a holding whose
   * confidence is unset (`src/shared/minds.ts:293`).
   */
  secretConfidence: 1,
  /** The most memories a character holds at top of mind (plan §7.4, Appendix D.1). */
  topOfMind: 9,
  /** Story days a memory stays short term, unless a dream settles it sooner (plan §7.4, Appendix D.1). */
  shortTermDays: 3,
  /** Story days in which a memory of weight 1, never recalled, falls to half its strength. Each point of weight doubles it; each recall adds as much again. */
  fadeDays: 3,
  /** The strength, from 0 to 1, under which a memory is faint, and is shown as its gist. */
  faintBelow: 0.25,
  /** The weight of a memory given none. */
  memoryWeight: 1,
  /** The highest weight a memory can have; weights run from 1. */
  weightMax: 5,
  /** What comes to mind for a scene, in tokens (plan §7.4, Appendix D.1). */
  comesToMindTokens: 2000,
  /** Characters per token, for a budget counted before a model sees the text, where the host gives no count of the harness's own (`CastViewInput.tokens`): RPH's default estimate. */
  charsPerToken: 3.2,
  /** The most memories one recall brings back; the answer says how many more touch the cue. */
  recallItems: 10,
});

export type CastSettings = { -readonly [K in keyof typeof CAST_DEFAULTS]: number };

/**
 * Each of the cast's settings as a config file writes it, under `cast:`, read at every level and
 * taken in by the host (the turn lane) for the chat a call is in, at each turn.
 */
export const CAST_SETTING_DEFS = {
  queryItems: { key: "cast.queryItems", default: CAST_DEFAULTS.queryItems, takes: { type: "whole", least: 1 }, perConnection: false, name: "Items a cast query gives", about: "The most items of one part one cast_query answers with; the answer says how many more there are.", effect: "turn" },
  secretConfidence: { key: "cast.secretConfidence", default: CAST_DEFAULTS.secretConfidence, takes: { type: "number", least: 0, most: 1 }, perConnection: false, name: "Sureness of a secret learned", about: "How sure, from 0 to 1, a character is of a secret a perception says they now know.", effect: "turn" },
  topOfMind: { key: "cast.topOfMind", default: CAST_DEFAULTS.topOfMind, takes: { type: "whole", least: 0 }, perConnection: false, name: "Top of mind", about: "The most memories a character holds at top of mind.", effect: "turn", row: "Top of mind" },
  shortTermDays: { key: "cast.shortTermDays", default: CAST_DEFAULTS.shortTermDays, takes: { type: "number", least: 0 }, perConnection: false, name: "Short-term memory", about: "Days of story time a memory stays short term, unless a dream settles it sooner.", effect: "turn", row: "Short-term memory" },
  // A memory that fades in no time at all would have no strength to measure.
  fadeDays: { key: "cast.fadeDays", default: CAST_DEFAULTS.fadeDays, takes: { type: "number", least: 1 }, perConnection: false, name: "Days a memory takes to fade", about: "Story days in which a memory of weight 1, never recalled, falls to half its strength; each point of weight doubles it, each recall adds as much again.", effect: "turn" },
  faintBelow: { key: "cast.faintBelow", default: CAST_DEFAULTS.faintBelow, takes: { type: "number", least: 0, most: 1 }, perConnection: false, name: "Faint below", about: "The strength, from 0 to 1, under which a memory is faint and shown as its gist.", effect: "turn" },
  memoryWeight: { key: "cast.memoryWeight", default: CAST_DEFAULTS.memoryWeight, takes: { type: "whole", least: 1 }, perConnection: false, name: "Weight of a memory given none", about: "The weight a memory has when it is written with none.", effect: "turn" },
  weightMax: { key: "cast.weightMax", default: CAST_DEFAULTS.weightMax, takes: { type: "whole", least: 1 }, perConnection: false, name: "Highest weight of a memory", about: "The highest weight a memory can have; weights run from 1.", effect: "turn" },
  comesToMindTokens: { key: "cast.comesToMindTokens", default: CAST_DEFAULTS.comesToMindTokens, takes: { type: "whole", least: 0 }, perConnection: false, name: "What comes to mind", about: "Tokens of a character's memories that come to mind for a scene.", effect: "turn", row: "What comes to mind" },
  charsPerToken: { key: "cast.charsPerToken", default: CAST_DEFAULTS.charsPerToken, takes: { type: "number", least: 1 }, perConnection: false, name: "Characters per token, for the cast", about: "Characters counted as one token in the cast's budgets, where the model gives no count of its own.", effect: "turn" },
  recallItems: { key: "cast.recallItems", default: CAST_DEFAULTS.recallItems, takes: { type: "whole", least: 1 }, perConnection: false, name: "Memories one recall brings back", about: "The most memories one recall brings back; the answer says how many more touch the cue.", effect: "turn" },
} as const satisfies NumberSettings<keyof CastSettings>;

/** Every setting the cast reads, as a config file writes it. */
export const CAST_SETTINGS: readonly Setting[] = Object.values(CAST_SETTING_DEFS);

/** The prompt part every answer's sentences come from. */
export const CAST_ANSWERS = "cast-answers";

/** What the cast's tools are given by the host (the turn lane). */
export interface CastDeps {
  /** The store: its database holds the cast; each call reads its scope's user. */
  store: Store;
  /** The application's write queue: every write goes through it. */
  writes: Writes;
  /** The guidance files in force for the chat: the tools' descriptions and the answers' lines. */
  files: GuidanceFiles;
  /** Reads a bound source live in Lumiverse. */
  sources: SourceReader;
  /** Reads a Lumiverse book entry's text live, for a secret its marks hold that the chat holds no fact of yet; without it, such a secret cannot be held. */
  books?: BookReader;
  /** Settings over `CAST_DEFAULTS`. */
  settings?: Partial<CastSettings>;
  /** Milliseconds since 1970, for a row's time; `Date.now` when absent. */
  now?: () => number;
}

/** One call of a cast tool. */
export interface CastCall {
  scope: Scope;
  agent: AgentRef;
  callId: string;
  signal: AbortSignal;
  tool: string;
  deps: CastDeps;
  settings: CastSettings;
  /** The answers' lines in force, for the words one line puts inside another (`wants_`). */
  lines: Lines;
  reply(): Reply;
}

/** A cast tool as code holds it: everything but its words. */
export interface CastToolSpec {
  name: string;
  family: string;
  tier: ToolTier;
  lane?: string;
  properties: Record<string, JsonObject>;
  required: readonly string[];
  /** A worked call, for the tests. */
  example: JsonObject;
  run(args: JsonObject, call: CastCall): Promise<Reply>;
}

/** The answers' lines in force for the chat; none when the part is switched off, so every answer is given with no words. */
export async function castLines(files: GuidanceFiles): Promise<Lines> {
  const text = await files.read("prompts", CAST_ANSWERS);
  return text === undefined ? Lines.none() : Lines.parse(text, `.prompts/${CAST_ANSWERS}.md`);
}

/** A cast tool as RPH holds it, or null when its file is not in force for the chat. */
export async function castHostTool(spec: CastToolSpec, lines: Lines, deps: CastDeps): Promise<HostTool | null> {
  const file = await deps.files.read("tools", spec.name);
  if (file === undefined) return null;
  const text = toolText(file, `.tools/${spec.name}.md`);
  const settings: CastSettings = { ...CAST_DEFAULTS, ...(deps.settings ?? {}) };
  return {
    name: spec.name,
    family: spec.family,
    tier: spec.tier,
    ...(spec.lane !== undefined ? { lane: spec.lane } : {}),
    description: text.description,
    parameters: described(spec.properties, spec.required, text),
    async run(args: JsonValue, ctx: ToolCtx): Promise<ToolResult> {
      const given = typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
      const call: CastCall = { scope: ctx.scope, agent: ctx.agent, callId: ctx.callId, signal: ctx.signal, tool: spec.name, deps, settings, lines, reply: () => new Reply(lines) };
      return (await spec.run(given, call)).result();
    },
  };
}

// ---------------------------------------------------------------- reading

/** Story time, where the chat keeps a clock: now, and a time as answers show it. */
export interface CastClock {
  /** Minutes since the world's epoch. */
  now: number;
  /** A time as answers show it; null while play has not set the clock (the blank world's, until a change moves it): a date nobody set is shown to nobody. */
  text(at: number): string | null;
}

/**
 * The chat's story time at a turn, or at its head, read as the story record reads it (`storyClock`): from the world the state is
 * played on, the blank one for a chat that names none, and a world attached later once the state is upgraded to it. Null for a
 * chat the store does not hold, or a state whose world it cannot find. Shown as the engine's own tools show a time, once the
 * clock is a recorded value (`clockRecorded`); its minutes count from the first, so memories are dated and fade all the same.
 */
export function castClock(store: Store, user: string, chat: string, turn: string | null): CastClock | null {
  const u = store.user(user);
  if (u.chat(chat) === null) return null;
  const folded = (turn === null ? u.headState(chat) : u.stateAt(turn)).state;
  const state = folded.world;
  const doc = store.env.worlds(state.revision);
  if (doc === undefined) return null;
  const world = store.env.registry.context(doc, state).world;
  const cal = calendarOf(world);
  const shown = clockRecorded(folded);
  return { now: state.clock, text: (at) => (shown ? formatClock(cal, at, placeOffset(world, at, placeOfEntity(state, world.pov))) : null) };
}

/** A row's date in story time as answers and views show it (`{ date }`), or nothing: it has none, or the clock shows none yet. */
export function datedAt(clock: CastClock | null, at: number | null): { date: string } | Record<string, never> {
  const text = at === null || clock === null ? null : clock.text(at);
  return text === null ? {} : { date: text };
}

/** What a call reads: the user's store, the chats whose characters it knows, the rows on its path, and story time. */
export interface CastReading {
  user: UserStore;
  /** The call's chat, then each chat it was branched from. */
  chats: string[];
  record: CastRecord;
  clock: CastClock | null;
}

/**
 * The cast a call reads: at its turn, or at the chat's head when it has none; a call made in a job reads what that job wrote at
 * once. A line says what is missing when the scope names a chat or a turn the store does not have.
 */
export function readingOr(call: CastCall, reply: Reply): CastReading | null {
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
  return {
    user,
    chats: chatLine(user, call.scope.chat),
    record: CastRecord.read(call.deps.store.db, call.scope.user, castAt(user, call.scope.chat, turn), call.agent.job ?? null),
    clock: castClock(call.deps.store, call.scope.user, call.scope.chat, turn),
  };
}

// ---------------------------------------------------------------- what answers show

/** A character as answers name it. */
export function whoView(character: Pick<Character, "id" | "name">): JsonObject {
  return { id: character.id, name: character.name };
}

/**
 * An item as it stands, as answers show it: its id, its fields, its date in story time, the message
 * of the turn that first wrote it and of the one that last did (null: this turn's reply, not saved
 * yet), and whether it was dropped. With `history`, every write of it on the path, oldest first.
 */
export function itemView(reading: CastReading, item: CastItem, history = false): JsonObject {
  const { record, clock } = reading;
  const out: JsonObject = { id: item.id, ...item.fields, ...datedAt(clock, item.at) };
  out.since = record.at.replyOf(item.opened);
  out.touched = record.at.replyOf(item.touched);
  if (item.dropped) out.dropped = true;
  if (history) out.history = item.rows.map((r) => ({ touched: record.at.replyOf(r.turn), by: r.by, wrote: r.value }));
  return out;
}

/** The base as answers show it: each part's text and version; with `history`, every version of each, oldest first. */
export function baseView(current: ReadonlyMap<string, BaseVersion>, all: readonly BaseVersion[] | null): JsonObject {
  const out: JsonObject = {};
  for (const [part, v] of current) {
    out[part] = all === null ? { text: v.text, version: v.version } : all.filter((x) => x.part === part).map((x) => ({ version: x.version, text: x.text, by: x.by }));
  }
  return out;
}

/** A source as answers show it: what it is, which side it defines, its title now, and whether it is gone or newer than the base. */
export function sourceView(s: SourceState): JsonObject {
  return {
    kind: s.kind,
    id: s.ref,
    ...(s.defines !== null ? { defines: s.defines } : {}),
    ...(s.title !== null ? { title: s.title } : { gone: true }),
    ...(s.newer ? { newer_than_base: true } : {}),
  };
}
