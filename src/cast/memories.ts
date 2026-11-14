// The character's own memory actions (plan §7.4): `recall`, `remember`, `reflect`, `dream`. Each acts
// for the character the calling agent plays (`AgentRef.plays`), on the call's turn, so a swipe takes
// back what it did. Every word of a memory is the character's agent's; code keeps the rows and does
// the arithmetic (`memory.ts`): recalling strengthens what it brings back, dreaming settles what is
// still short term into long term and raises or lowers the weights the character names. When the
// memory work runs, and what the character makes of anything, is guidance. The user's setting for
// the story lane is held by the harness's gate before a call runs.
//
// Each call is read in whatever shape its arguments were sent. What it does not read, or a value it
// cannot read (a weight off the scale, an id that is none of the character's), is left out: the rest
// is written, and the answer names what was left out. A call one of whose memories cannot be read at
// all is answered whole, and nothing is written.

import type { JsonObject } from "rp-harness/contract";
import type { Reply } from "../iface/kit";
import { isRecord } from "../shared/json";
import { type CastCall, type CastClock, type CastSettings, type CastToolSpec, datedAt, readingOr } from "./kit";
import { memoriesNow, type MemoryNow, strongestFirst, touches, weightOf } from "./memory";
import { type CastWrite, writeCast } from "./record";
import { listOf, notAnItem, ownIds, readFields, type Self, selfOr, strangers, unchecked } from "./self";
import { CAST_LANE, ignoredOf, type ItemRead, type Kind, leftOut, needed, type Reads, refused } from "./update";

/** A memory as the character's own answers show it: in full, or as its gist alone, marked faint, once it has faded. */
export function memoryView(m: MemoryNow, clock: CastClock | null): JsonObject {
  const { text, gist, recalled: _recalled, settled: _settled, top: _top, ...rest } = m.item.fields;
  return {
    id: m.item.id,
    tier: m.tier,
    ...(m.faint ? { gist: gist ?? null, faint: true } : { text: text ?? null, gist: gist ?? null }),
    ...rest,
    ...datedAt(clock, m.item.at),
  };
}

/** The fields of a memory the character writes, each read as its kind. */
function memoryKinds(s: CastSettings): Readonly<Record<string, Kind>> {
  return { text: "text", gist: "text", weight: { min: 1, max: s.weightMax }, tone: "text", who: "texts", about: "texts" };
}

const MEMORY_FIELDS = ["text", "gist", "weight", "tone", "who", "about"];

const RECALL_READS: Reads = { reads: ["cue", "skip"], needs: ["cue"], newNeeds: [] };
const MEMORY_READS: Reads = { reads: ["id", ...MEMORY_FIELDS, "from", "top"], needs: [], newNeeds: ["text", "gist"] };
const REFLECT_READS: Reads = { reads: ["from", ...MEMORY_FIELDS, "growth"], needs: ["from", "text", "gist"], newNeeds: [] };
const DREAM_READS: Reads = { reads: ["keep", "fade", "connect"], needs: [], newNeeds: [] };
const CONNECTION_READS: Reads = { reads: ["memories", ...MEMORY_FIELDS], needs: ["memories", "text", "gist"], newNeeds: [] };

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
  const it: ItemRead = { n: 1, op: "recall", fatal: [], unread: [], ignored: ignoredOf(args, RECALL_READS.reads) };
  const value: JsonObject = {};
  readFields(call, it, args, { cue: "text", skip: "whole" }, value);
  if (value.cue === undefined) needed(it, ["cue"]);
  if (it.fatal.length > 0) return refused(reply, [it], () => RECALL_READS);
  const cue = value.cue as string;
  const self = selfOr(call, reply);
  if (self === null) return reply;
  leftOut(reply, it, RECALL_READS.reads);
  const from = typeof value.skip === "number" ? value.skip : 0;
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
  properties: unchecked(RECALL_READS.reads),
  required: [],
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
  const items: ItemRead[] = [];
  const writes: CastWrite[] = [];
  for (const [i, raw] of list.entries()) {
    const n = i + 1;
    if (!isRecord(raw)) {
      items.push(notAnItem(n, "memory", "memory", raw));
      continue;
    }
    const given = raw as JsonObject;
    const it: ItemRead = { n, op: "memory", fatal: [], unread: [], ignored: ignoredOf(given, MEMORY_READS.reads) };
    items.push(it);
    const value: JsonObject = {};
    readFields(call, it, given, { id: "name", ...memoryKinds(call.settings), from: "texts", top: "flag" }, value);
    const { id, ...fields } = value;
    if (id !== undefined && strangers(self, "memory", [id]).length > 0) {
      it.fatal.push({ line: "unknown_id", fields: { n, op: "memory", who: self.character.name, part: "memory", id: JSON.stringify(id) } });
      continue;
    }
    if (fields.from !== undefined) {
      const from = ownIds(self, it, "perception", "from", fields.from, false);
      if (from.length > 0) fields.from = from;
      else delete fields.from;
    }
    if (id === undefined) needed(it, ["text", "gist"].filter((f) => fields[f] === undefined));
    else if (Object.keys(fields).length === 0) it.fatal.push({ line: "needs_one", fields: { n, op: "memory", fields: MEMORY_READS.reads.filter((f) => f !== "id") } });
    if (it.fatal.length === 0) writes.push({ character: self.character.id, part: "memory", item: (id as string | undefined) ?? null, value: fields });
  }
  if (items.some((it) => it.fatal.length > 0)) return refused(reply, items, () => MEMORY_READS);
  const rows = await call.deps.writes.run((db) => writeCast(db, self.writer, writes), call.tool);
  for (const it of items) leftOut(reply, it, MEMORY_READS.reads);
  const shown = after(call, reply, self, rows.map((r) => r.item));
  return shown === null ? reply : reply.data({ memories: shown });
}

export const REMEMBER: CastToolSpec = {
  name: "remember",
  family: "cast",
  tier: "write",
  lane: CAST_LANE,
  properties: { memories: { type: "array", items: { type: "object", properties: unchecked(MEMORY_READS.reads) } } },
  required: [],
  example: { memories: [{ text: "She went pale at the letter, and I poured her cider as if I had not seen.", gist: "Pretended not to see her go pale.", weight: 2, tone: "ashamed", who: ["Wren"], about: ["the letter"], from: ["p-4"] }] },
  run: remember,
};

// ---------------------------------------------------------------- reflect

async function reflect(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  const it: ItemRead = { n: 1, op: "reflect", fatal: [], unread: [], ignored: ignoredOf(args, REFLECT_READS.reads) };
  const value: JsonObject = {};
  readFields(call, it, args, { from: "texts", ...memoryKinds(call.settings), growth: "text" }, value);
  needed(it, REFLECT_READS.needs.filter((f) => value[f] === undefined));
  if (it.fatal.length > 0) return refused(reply, [it], () => REFLECT_READS);
  const self = selfOr(call, reply);
  if (self === null) return reply;
  const { from: named, growth, ...fields } = value;
  const from = ownIds(self, it, "memory", "from", named, true);
  if (it.fatal.length > 0) return refused(reply, [it], () => REFLECT_READS);
  const written = await call.deps.writes.run((db) => {
    const [realization] = writeCast(db, self.writer, [{ character: self.character.id, part: "memory", item: null, value: { ...fields, memories: from, kind: "realization" } }]);
    const id = realization?.item ?? "";
    // A change the realization proposes is growth the Author has yet to accept (`cast_update`'s growth `accept`).
    const proposed = typeof growth === "string" ? writeCast(db, self.writer, [{ character: self.character.id, part: "growth", item: null, value: { text: growth, cause: id, proposed: true } }]) : [];
    return { id, growth: proposed[0]?.item ?? null };
  }, call.tool);
  leftOut(reply, it, REFLECT_READS.reads);
  const shown = after(call, reply, self, [written.id]);
  return shown === null ? reply : reply.data({ realization: shown[0] ?? null, ...(written.growth !== null ? { proposed_growth: written.growth } : {}) });
}

export const REFLECT: CastToolSpec = {
  name: "reflect",
  family: "cast",
  tier: "write",
  lane: CAST_LANE,
  properties: unchecked(REFLECT_READS.reads),
  required: [],
  example: { from: ["mem-12", "mem-19"], text: "Every time the reeve's seal comes through my door, someone gets hurt.", gist: "The reeve's letters bring harm.", weight: 3, who: ["the reeve"], growth: "No longer carries letters without reading the seal." },
  run: reflect,
};

// ---------------------------------------------------------------- dream

async function dream(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  const it: ItemRead = { n: 1, op: "dream", fatal: [], unread: [], ignored: ignoredOf(args, DREAM_READS.reads) };
  const value: JsonObject = {};
  readFields(call, it, args, { keep: "texts", fade: "texts" }, value);
  const items: ItemRead[] = [it];
  const connections: { it: ItemRead; fields: JsonObject }[] = [];
  const connect = listOf(args.connect);
  for (const [i, raw] of connect.entries()) {
    if (!isRecord(raw)) {
      items.push(notAnItem(i + 1, "connection", "connect", raw));
      continue;
    }
    const given = raw as JsonObject;
    const c: ItemRead = { n: i + 1, op: "connection", fatal: [], unread: [], ignored: ignoredOf(given, CONNECTION_READS.reads) };
    const fields: JsonObject = {};
    readFields(call, c, given, { memories: "texts", ...memoryKinds(call.settings) }, fields);
    needed(c, CONNECTION_READS.needs.filter((f) => fields[f] === undefined));
    items.push(c);
    connections.push({ it: c, fields });
  }
  const readsOf = (op: string): Reads => (op === "dream" ? DREAM_READS : CONNECTION_READS);
  if (items.some((x) => x.fatal.length > 0)) return refused(reply, items, readsOf);
  const self = selfOr(call, reply);
  if (self === null) return reply;
  const keep = new Set(ownIds(self, it, "memory", "keep", value.keep, false));
  const fade = new Set(ownIds(self, it, "memory", "fade", value.fade, false));
  for (const c of connections) c.fields.memories = ownIds(self, c.it, "memory", "memories", c.fields.memories, true);
  if (items.some((x) => x.fatal.length > 0)) return refused(reply, items, readsOf);

  const memories = memoriesNow(self.reading.record, self.character.id, self.now, call.settings);
  const byId = new Map(memories.map((m) => [m.item.id, m]));
  const writes: CastWrite[] = [];
  for (const m of memories) {
    const change: JsonObject = {};
    // What is still short term settles into long term.
    if (m.tier === "short") change.settled = self.now ?? true;
    if (fade.has(m.item.id)) change.weight = 1;
    else if (keep.has(m.item.id)) change.weight = Math.min(call.settings.weightMax, weightOf(m.item, call.settings) + 1);
    if (Object.keys(change).length > 0) writes.push({ character: self.character.id, part: "memory", item: m.item.id, value: change });
  }
  for (const c of connections) writes.push({ character: self.character.id, part: "memory", item: null, value: { ...c.fields, kind: "connection" } });
  const rows = await call.deps.writes.run((db) => writeCast(db, self.writer, writes), call.tool);
  for (const x of items) leftOut(reply, x, readsOf(x.op ?? "").reads);
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
  properties: { ...unchecked(["keep", "fade"]), connect: { type: "array", items: { type: "object", properties: unchecked(CONNECTION_READS.reads) } } },
  required: [],
  example: { keep: ["mem-12"], fade: ["mem-14"], connect: [{ memories: ["mem-3", "mem-12"], text: "The cellar again. It was the cellar when I was a boy, too.", gist: "The cellar keeps coming back." }] },
  run: dream,
};
