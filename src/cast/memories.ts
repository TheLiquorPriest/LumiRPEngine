// The character's own memory actions (plan §7.4): `recall`, `remember`, `reflect`, `dream`. Each acts
// for the character the calling agent plays (`AgentRef.plays`), on the call's turn, so a swipe takes
// back what it did. Every word of a memory is the character's agent's; code keeps the rows and does
// the arithmetic (`memory.ts`): recalling strengthens what it brings back, dreaming settles what is
// still short term into long term and raises or lowers the weights the character names. When the
// memory work runs, and what the character makes of anything, is guidance. The user's setting for
// the story lane is held by the harness's gate before a call runs.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { type Reply, TEXT, TEXTS, WHOLE, YES_NO } from "../iface/kit";
import { type CastCall, type CastClock, type CastReading, type CastSettings, type CastToolSpec, readingOr } from "./kit";
import { memoriesNow, type MemoryNow, strongestFirst, touches, weightOf } from "./memory";
import { type CastWrite, type CastWriter, type Character, findCharacter, writeCast } from "./record";
import { CAST_LANE, isUnread, type Kind, readArg, type Unread } from "./update";

/** A memory as the character's own answers show it: in full, or as its gist alone, marked faint, once it has faded. */
export function memoryView(m: MemoryNow, clock: CastClock | null): JsonObject {
  const { text, gist, recalled: _recalled, settled: _settled, top: _top, ...rest } = m.item.fields;
  return {
    id: m.item.id,
    tier: m.tier,
    ...(m.faint ? { gist: gist ?? null, faint: true } : { text: text ?? null, gist: gist ?? null }),
    ...rest,
    ...(m.item.at !== null && clock !== null ? { date: clock.text(m.item.at) } : {}),
  };
}

/** What one call of a memory action works with: the reading, the character, story time, and the writer of its rows. */
interface Self {
  reading: CastReading;
  character: Character;
  now: number | null;
  writer: CastWriter;
}

/** The character the calling agent plays, on the call's turn; a line says why not when there is none. */
function selfOr(call: CastCall, reply: Reply): Self | null {
  const reading = readingOr(call, reply);
  if (reading === null) return null;
  const turn = call.scope.turn;
  if (turn === undefined) {
    reply.line("memory_turn", {}).fail();
    return null;
  }
  const plays = call.agent.plays;
  if (plays === undefined) {
    reply.line("plays_none", { tool: call.tool }).fail();
    return null;
  }
  const character = findCharacter(call.deps.store.db, call.scope.user, reading.chats, plays);
  if (character === null) {
    reply.line("no_character", { who: plays }).fail();
    return null;
  }
  const now = reading.clock?.now ?? null;
  return { reading, character, now, writer: { user: call.scope.user, turn, by: call.agent.definition, agent: call.agent.id, job: call.agent.job ?? null, at: now, now: (call.deps.now ?? Date.now)() } };
}

/** The fields of a memory the character writes, each read as its kind. */
function memoryKinds(s: CastSettings): Readonly<Record<string, Kind>> {
  return { text: "text", gist: "text", weight: { min: 1, max: s.weightMax }, tone: "text", who: "texts", about: "texts" };
}

const MEMORY_PROPERTIES: Record<string, JsonObject> = { text: TEXT, gist: TEXT, weight: { ...WHOLE, minimum: 1 }, tone: TEXT, who: TEXTS, about: TEXTS };

/** Reads `fields` of item `n` (`op` names what kind) into `value`; what cannot be read goes to `bad`. */
function readFields(n: number, op: string, given: JsonObject, kinds: Readonly<Record<string, Kind>>, value: JsonObject, bad: Unread[]): void {
  for (const [field, kind] of Object.entries(kinds)) {
    const got = readArg(n, op, field, kind, given[field]);
    if (isUnread(got)) bad.push(got);
    else if (got !== undefined) value[field] = got;
  }
}

/** The ids of `part` a list names that are none of the character's on this path. */
function strangers(self: Self, part: "memory" | "perception", ids: unknown): string[] {
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  return list.filter((id) => {
    const item = self.reading.record.items.get(id);
    return item === undefined || item.part !== part || item.character !== self.character.id;
  });
}

const asObject = (v: JsonValue): JsonObject | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? v : null);

/** Lines for what could not be read, and that nothing was written. */
function refuse(reply: Reply, unread: readonly Unread[]): Reply {
  for (const u of unread) reply.line(u.line, u.fields);
  return reply.line("nothing_recorded", {}).fail();
}

/** Each memory named, as it stands after the call. */
function after(call: CastCall, reply: Reply, self: Self, ids: readonly string[]): JsonObject[] | null {
  const reading = readingOr(call, reply);
  if (reading === null) return null;
  const now = new Map(memoriesNow(reading.record, self.character.id, self.now, call.settings).map((m) => [m.item.id, m]));
  return ids.flatMap((id) => {
    const m = now.get(id);
    return m === undefined ? [] : [memoryView(m, reading.clock)];
  });
}

// ---------------------------------------------------------------- recall

async function recall(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  const cue = readArg(1, "recall", "cue", "text", args.cue);
  const skip = readArg(1, "recall", "skip", "whole", args.skip);
  if (isUnread(cue) || isUnread(skip)) return refuse(reply, [cue, skip].filter(isUnread));
  if (typeof cue !== "string") return reply.line("needs", { n: 1, op: "recall", fields: ["cue"] }).fail();
  const self = selfOr(call, reply);
  if (self === null) return reply;
  const from = typeof skip === "number" ? skip : 0;
  const touched = memoriesNow(self.reading.record, self.character.id, self.now, call.settings)
    .filter((m) => touches(m.item, [cue]))
    .sort(strongestFirst);
  const back = touched.slice(from, from + call.settings.recallItems);
  if (back.length === 0) return reply.line("no_memories", { cue });
  // Recalling strengthens each memory it brings back: one more recall, as of now.
  await call.deps.writes.run(
    (db) =>
      writeCast(
        db,
        self.writer,
        back.map((m) => ({ character: self.character.id, part: "memory", item: m.item.id, value: { recalls: (typeof m.item.fields.recalls === "number" ? m.item.fields.recalls : 0) + 1, ...(self.now !== null ? { recalled: self.now } : {}) } })),
      ),
    call.tool,
  );
  const shown = after(call, reply, self, back.map((m) => m.item.id));
  if (shown === null) return reply;
  reply.data({ cue, memories: shown });
  const rest = touched.length - from - back.length;
  if (rest > 0) reply.line("more_memories", { count: rest, cue, skip: from + back.length });
  return reply;
}

export const RECALL: CastToolSpec = {
  name: "recall",
  family: "cast",
  tier: "write",
  lane: CAST_LANE,
  properties: { cue: TEXT, skip: WHOLE },
  required: ["cue"],
  example: { cue: "the reeve" },
  run: recall,
};

// ---------------------------------------------------------------- remember

async function remember(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  const list = args.memories;
  if (!Array.isArray(list) || list.length === 0) return reply.line("no_memories_sent", {}).fail();
  const self = selfOr(call, reply);
  if (self === null) return reply;
  const writes: CastWrite[] = [];
  const unread: Unread[] = [];
  for (const [i, raw] of list.entries()) {
    const n = i + 1;
    const given = asObject(raw);
    if (given === null) {
      unread.push({ line: "unreadable_op", fields: { n, op: "memory", field: "memory", value: JSON.stringify(raw), choices: [] } });
      continue;
    }
    const value: JsonObject = {};
    const bad: Unread[] = [];
    readFields(n, "memory", given, { id: "text", ...memoryKinds(call.settings), from: "texts", top: "flag" }, value, bad);
    const { id, ...fields } = value;
    if (bad.length === 0 && id !== undefined && strangers(self, "memory", [id]).length > 0) bad.push({ line: "unknown_id", fields: { n, op: "memory", who: self.character.name, part: "memory", id: JSON.stringify(id) } });
    if (bad.length === 0 && id === undefined && (fields.text === undefined || fields.gist === undefined)) bad.push({ line: "needs", fields: { n, op: "memory", fields: ["text", "gist"] } });
    if (bad.length === 0 && id !== undefined && Object.keys(fields).length === 0) bad.push({ line: "needs_one", fields: { n, op: "memory", fields: Object.keys(MEMORY_PROPERTIES).concat("from", "top") } });
    for (const stranger of strangers(self, "perception", fields.from)) bad.push({ line: "unknown_id", fields: { n, op: "memory", who: self.character.name, part: "perception", id: JSON.stringify(stranger) } });
    if (bad.length > 0) unread.push(...bad);
    else writes.push({ character: self.character.id, part: "memory", item: (id as string | undefined) ?? null, value: fields });
  }
  if (unread.length > 0) return refuse(reply, unread);
  const rows = await call.deps.writes.run((db) => writeCast(db, self.writer, writes), call.tool);
  const shown = after(call, reply, self, rows.map((r) => r.item));
  return shown === null ? reply : reply.data({ memories: shown });
}

export const REMEMBER: CastToolSpec = {
  name: "remember",
  family: "cast",
  tier: "write",
  lane: CAST_LANE,
  properties: { memories: { type: "array", minItems: 1, items: { type: "object", properties: { id: TEXT, ...MEMORY_PROPERTIES, from: TEXTS, top: YES_NO } } } },
  required: ["memories"],
  example: { memories: [{ text: "She went pale at the letter, and I poured her cider as if I had not seen.", gist: "Pretended not to see her go pale.", weight: 2, tone: "ashamed", who: ["Wren"], about: ["the letter"], from: ["p-4"] }] },
  run: remember,
};

// ---------------------------------------------------------------- reflect

async function reflect(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  const value: JsonObject = {};
  const bad: Unread[] = [];
  readFields(1, "reflect", args, { from: "texts", ...memoryKinds(call.settings), growth: "text" }, value, bad);
  if (bad.length > 0) return refuse(reply, bad);
  const { from, growth, ...fields } = value;
  if (from === undefined || fields.text === undefined || fields.gist === undefined) return reply.line("needs", { n: 1, op: "reflect", fields: ["from", "text", "gist"] }).fail();
  const self = selfOr(call, reply);
  if (self === null) return reply;
  const unknown = strangers(self, "memory", from);
  if (unknown.length > 0) return refuse(reply, unknown.map((id) => ({ line: "unknown_id", fields: { n: 1, op: "reflect", who: self.character.name, part: "memory", id: JSON.stringify(id) } })));
  const written = await call.deps.writes.run((db) => {
    const [realization] = writeCast(db, self.writer, [{ character: self.character.id, part: "memory", item: null, value: { ...fields, memories: from, kind: "realization" } }]);
    const id = realization?.item ?? "";
    // A change the realization proposes is growth the Author has yet to accept (`cast_update`'s growth `accept`).
    const proposed = typeof growth === "string" ? writeCast(db, self.writer, [{ character: self.character.id, part: "growth", item: null, value: { text: growth, cause: id, proposed: true } }]) : [];
    return { id, growth: proposed[0]?.item ?? null };
  }, call.tool);
  const shown = after(call, reply, self, [written.id]);
  return shown === null ? reply : reply.data({ realization: shown[0] ?? null, ...(written.growth !== null ? { proposed_growth: written.growth } : {}) });
}

export const REFLECT: CastToolSpec = {
  name: "reflect",
  family: "cast",
  tier: "write",
  lane: CAST_LANE,
  properties: { from: TEXTS, ...MEMORY_PROPERTIES, growth: TEXT },
  required: ["from", "text", "gist"],
  example: { from: ["mem-12", "mem-19"], text: "Every time the reeve's seal comes through my door, someone gets hurt.", gist: "The reeve's letters bring harm.", weight: 3, who: ["the reeve"], growth: "No longer carries letters without reading the seal." },
  run: reflect,
};

// ---------------------------------------------------------------- dream

async function dream(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  const value: JsonObject = {};
  const unread: Unread[] = [];
  readFields(1, "dream", args, { keep: "texts", fade: "texts" }, value, unread);
  const connections: JsonObject[] = [];
  const connect = args.connect;
  if (connect !== undefined && connect !== null && !Array.isArray(connect)) unread.push({ line: "unreadable_op", fields: { n: 1, op: "dream", field: "connect", value: JSON.stringify(connect), choices: [] } });
  for (const [i, raw] of (Array.isArray(connect) ? connect : []).entries()) {
    const given = asObject(raw);
    const fields: JsonObject = {};
    if (given === null) unread.push({ line: "unreadable_op", fields: { n: i + 1, op: "connection", field: "connect", value: JSON.stringify(raw), choices: [] } });
    else readFields(i + 1, "connection", given, { memories: "texts", ...memoryKinds(call.settings) }, fields, unread);
    if (given !== null && (fields.memories === undefined || fields.text === undefined || fields.gist === undefined)) unread.push({ line: "needs", fields: { n: i + 1, op: "connection", fields: ["memories", "text", "gist"] } });
    connections.push(fields);
  }
  if (unread.length > 0) return refuse(reply, unread);
  const self = selfOr(call, reply);
  if (self === null) return reply;
  const unknown = [...strangers(self, "memory", value.keep), ...strangers(self, "memory", value.fade), ...connections.flatMap((c) => strangers(self, "memory", c.memories))];
  if (unknown.length > 0) return refuse(reply, unknown.map((id) => ({ line: "unknown_id", fields: { n: 1, op: "dream", who: self.character.name, part: "memory", id: JSON.stringify(id) } })));

  const memories = memoriesNow(self.reading.record, self.character.id, self.now, call.settings);
  const byId = new Map(memories.map((m) => [m.item.id, m]));
  const keep = new Set((value.keep as string[] | undefined) ?? []);
  const fade = new Set((value.fade as string[] | undefined) ?? []);
  const writes: CastWrite[] = [];
  for (const m of memories) {
    const change: JsonObject = {};
    // What is still short term settles into long term.
    if (m.tier === "short") change.settled = self.now ?? true;
    if (fade.has(m.item.id)) change.weight = 1;
    else if (keep.has(m.item.id)) change.weight = Math.min(call.settings.weightMax, weightOf(m.item, call.settings) + 1);
    if (Object.keys(change).length > 0) writes.push({ character: self.character.id, part: "memory", item: m.item.id, value: change });
  }
  for (const c of connections) writes.push({ character: self.character.id, part: "memory", item: null, value: { ...c, kind: "connection" } });
  const rows = await call.deps.writes.run((db) => writeCast(db, self.writer, writes), call.tool);
  const made = rows.filter((r) => !byId.has(r.item)).map((r) => r.item);
  const shown = after(call, reply, self, [...rows.filter((r) => byId.has(r.item)).map((r) => r.item), ...made]);
  if (shown === null) return reply;
  return reply.data({
    settled: writes.filter((w) => w.value.settled !== undefined).map((w) => w.item),
    kept: [...keep],
    faded: [...fade],
    connections: made,
    memories: shown,
  });
}

export const DREAM: CastToolSpec = {
  name: "dream",
  family: "cast",
  tier: "write",
  lane: CAST_LANE,
  properties: {
    keep: TEXTS,
    fade: TEXTS,
    connect: { type: "array", items: { type: "object", properties: { memories: TEXTS, ...MEMORY_PROPERTIES } } },
  },
  required: [],
  example: { keep: ["mem-12"], fade: ["mem-14"], connect: [{ memories: ["mem-3", "mem-12"], text: "The cellar again. It was the cellar when I was a boy, too.", gist: "The cellar keeps coming back." }] },
  run: dream,
};
