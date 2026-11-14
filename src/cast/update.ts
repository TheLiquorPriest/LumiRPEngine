// `cast_update` (plan §7.1, §7.2, §6.8): the omniscient side's writes to the cast as named
// operations, applied in order, one call writing many: casting, the sources bound, the base, growth,
// history, relationships and knowledge. The call is read whole first: anything it cannot read (an
// operation that is none of the list, a character the cast does not hold, a source Lumiverse does
// not hold, an item the path does not hold) answers the whole call, and nothing is written. Then the
// user's setting for the story lane is asked through the contract's approvals, never decided here.
// What goes ahead is written in one queued write, and the answer says what each operation wrote and
// how its part of the record now stands. A character a call casts is known to all its operations,
// whatever their order, so a call can bind, draw and cast someone new at once.

import type { ApprovalAsk, JsonObject, JsonValue } from "rp-harness/contract";
import { oneOf, type Reply, TEXT, TEXTS, YES_NO } from "../iface/kit";
import type { Fields } from "../iface/texts";
import type { Lane } from "../store";
import { baseView, type CastCall, type CastReading, type CastToolSpec, itemView, readingOr, sourceView, whoView } from "./kit";
import {
  addCharacter,
  BASE_PARTS,
  type BasePart,
  baseOf,
  bindingsOf,
  bindSource,
  CASTINGS,
  castingInForce,
  castingItemId,
  type Character,
  findCharacter,
  nameKey,
  RELATIONSHIP_DIMENSIONS,
  relationshipItemId,
  type RowPart,
  SOURCE_KINDS,
  type SourceKind,
  sourceKey,
  unbindSource,
  writeBase,
  writeCast,
} from "./record";
import { type SourceNow, type SourceReader, sourcesNow } from "./sources";

/** The lane every operation of the tool writes to: the cast is the story's side of a turn. */
export const CAST_LANE: Lane = "story";

/** Every operation, in the order the tool's file lists them. */
export const UPDATE_OPERATIONS = ["cast", "bind", "base", "growth", "history", "relationship", "knowledge"] as const;
type Op = (typeof UPDATE_OPERATIONS)[number];

/** The operations that stand outside turns: a swipe leaves what they write. Every other one is kept with its turn. */
const OUTSIDE_TURNS: Readonly<Partial<Record<Op, true>>> = { bind: true, base: true };

/** The scale a relationship's dimensions are given on: the one today's regard is kept on (`src/packs/relationships/core/index.ts:41-45`). */
export const DIMENSION_RANGE = Object.freeze({ min: -100, max: 100 });

/** How an argument is read: words; a list of words; true or false; a dimension; one of a list. */
type Kind = "text" | "texts" | "flag" | "dimension" | readonly string[];

const DROP = { drop: "flag", why: "text" } as const;
const DIMENSIONS = Object.fromEntries(RELATIONSHIP_DIMENSIONS.map((d) => [d, "dimension"])) as Record<(typeof RELATIONSHIP_DIMENSIONS)[number], "dimension">;

/** The arguments each operation takes besides `op` and `who`, each read as its kind. */
const ARGS: Readonly<Record<Op, Readonly<Record<string, Kind>>>> = {
  cast: { as: CASTINGS, line: "text", why: "text" },
  bind: { card: "text", persona: "text", entry: "text", memory: "text", defines: "text", drop: "flag" },
  base: { seed: "text", soul: "text", inner_voice: "text", background: "text" },
  growth: { id: "text", text: "text", cause: "text", ...DROP },
  history: { id: "text", text: "text", beats: "texts", ...DROP },
  relationship: { with: "text", text: "text", ...DIMENSIONS, ...DROP },
  knowledge: { id: "text", text: "text", how: "text", ...DROP },
};

const DIMENSION = { type: "number", minimum: DIMENSION_RANGE.min, maximum: DIMENSION_RANGE.max };

/** The arguments an operation may carry, each once, whichever operations read it: the file says what each is. */
export const UPDATE_PROPERTIES: Record<string, JsonObject> = {
  op: oneOf(UPDATE_OPERATIONS),
  who: TEXT,
  id: TEXT,
  as: oneOf(CASTINGS),
  line: TEXT,
  card: TEXT,
  persona: TEXT,
  entry: TEXT,
  memory: TEXT,
  defines: TEXT,
  seed: TEXT,
  soul: TEXT,
  inner_voice: TEXT,
  background: TEXT,
  text: TEXT,
  cause: TEXT,
  beats: TEXTS,
  with: TEXT,
  ...Object.fromEntries(RELATIONSHIP_DIMENSIONS.map((d) => [d, DIMENSION])),
  how: TEXT,
  drop: YES_NO,
  why: TEXT,
};

/** Something an operation says that cannot be read: the answers' line that says so, and its fields. */
interface Unread {
  line: string;
  fields: Fields;
}

function isUnread(v: unknown): v is Unread {
  return typeof v === "object" && v !== null && "line" in v;
}

/** An operation read. `character` is the character's id, or `new:<name key>` for one this call casts. */
interface Planned {
  n: number;
  op: Op;
  character: string;
  name: string;
  /** What it writes: the fields of a row, the base's parts, a binding's `defines`. */
  value: JsonObject;
  /** A row's part, and the item it writes: an id the path holds, or null for a new one (keyed parts are named at the write). */
  part?: RowPart;
  item?: string | null;
  /** A binding's source, and what Lumiverse holds of it now. */
  source?: { kind: SourceKind; ref: string; now: SourceNow | null };
  /** For a base: each bound source's revision as it was read for this call. */
  seen?: Record<string, string>;
}

/** One argument read as its kind; undefined when it is not given. */
function readArg(n: number, op: string, field: string, kind: Kind, said: JsonValue | undefined): JsonValue | Unread | undefined {
  if (said === undefined || said === null) return undefined;
  const unreadable = (choices: readonly JsonValue[] = []): Unread => ({ line: "unreadable_op", fields: { n, op, field, value: JSON.stringify(said), choices } });
  if (Array.isArray(kind)) return typeof said === "string" && kind.includes(said) ? said : unreadable(kind);
  switch (kind) {
    case "text": {
      if (typeof said !== "string") return unreadable();
      return said.trim() === "" ? undefined : said.trim();
    }
    case "texts": {
      const list = typeof said === "string" ? [said] : said;
      if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) return unreadable();
      const texts = (list as string[]).map((x) => x.trim()).filter((x) => x !== "");
      return texts.length === 0 ? undefined : texts;
    }
    case "flag":
      return typeof said === "boolean" ? said : unreadable([true, false]);
    case "dimension":
      return typeof said === "number" && Number.isFinite(said) && said >= DIMENSION_RANGE.min && said <= DIMENSION_RANGE.max
        ? said
        : { line: "out_of_range", fields: { n, op, field, value: JSON.stringify(said), ...DIMENSION_RANGE } };
  }
  return unreadable();
}

/** What a call works with while it reads its operations. */
interface Reading {
  call: CastCall;
  cast: CastReading;
  /** The names this call casts that the cast does not hold yet, by name key. */
  fresh: Map<string, string>;
  /** Each character's bindings as they stand after the operations read so far, by source key, with what Lumiverse holds now. */
  bound: Map<string, Map<string, { kind: SourceKind; ref: string; now: SourceNow | null }>>;
  /** Reads a source live once per call. */
  read: (kind: SourceKind, ref: string) => Promise<SourceNow | null>;
}

/** The bindings of a character as the call has them so far, read live on first use. */
async function boundOf(r: Reading, character: string): Promise<Map<string, { kind: SourceKind; ref: string; now: SourceNow | null }>> {
  let bound = r.bound.get(character);
  if (bound === undefined) {
    bound = new Map();
    if (!character.startsWith("new:")) {
      for (const b of bindingsOf(r.call.deps.store.db, r.call.scope.user, character)) bound.set(sourceKey(b.kind, b.ref), { kind: b.kind, ref: b.ref, now: await r.read(b.kind, b.ref) });
    }
    r.bound.set(character, bound);
  }
  return bound;
}

/** One operation read; a list of what could not be read when it cannot be. */
async function readOp(r: Reading, n: number, raw: JsonValue): Promise<Planned | Unread[]> {
  const given = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : null;
  const op = given?.op;
  if (given === null || typeof op !== "string" || !(UPDATE_OPERATIONS as readonly string[]).includes(op)) {
    return [{ line: "unknown_op", fields: { n, value: JSON.stringify(op ?? null), choices: UPDATE_OPERATIONS } }];
  }
  const name = op as Op;
  const bad: Unread[] = [];
  if (OUTSIDE_TURNS[name] !== true && r.call.scope.turn === undefined) bad.push({ line: "turn_needed_op", fields: { n, op } });

  const who = readArg(n, op, "who", "text", given.who);
  let character: { id: string; name: string } | null = null;
  if (isUnread(who)) bad.push(who);
  else if (who === undefined) bad.push({ line: "needs", fields: { n, op, fields: ["who"] } });
  else {
    const found = findCharacter(r.call.deps.store.db, r.call.scope.user, r.cast.chats, who as string);
    const fresh = r.fresh.get(nameKey(who as string));
    character = found !== null ? { id: found.id, name: found.name } : fresh !== undefined ? { id: `new:${nameKey(fresh)}`, name: fresh } : null;
    if (character === null) bad.push({ line: "unknown_who", fields: { n, op, who: who as string } });
  }

  const value: JsonObject = {};
  for (const [field, kind] of Object.entries(ARGS[name])) {
    const got = readArg(n, op, field, kind, given[field]);
    if (isUnread(got)) bad.push(got);
    else if (got !== undefined) value[field] = got;
  }
  if (bad.length > 0 || character === null) return bad;
  const planned: Planned = { n, op: name, character: character.id, name: character.name, value };

  switch (name) {
    case "cast":
      if (value.as === undefined) return [{ line: "needs", fields: { n, op, fields: ["as"] } }];
      planned.part = "casting";
      return planned;
    case "bind": {
      const named = SOURCE_KINDS.filter((k) => value[k] !== undefined);
      const [kind] = named;
      if (kind === undefined || named.length > 1) return [{ line: "one_source", fields: { n, op, choices: SOURCE_KINDS } }];
      const ref = value[kind] as string;
      const bound = await boundOf(r, character.id);
      const key = sourceKey(kind, ref);
      if (value.drop === true) {
        if (!bound.has(key)) return [{ line: "not_bound", fields: { n, op, who: character.name, kind, id: ref } }];
        bound.delete(key);
        planned.source = { kind, ref, now: null };
      } else {
        const now = await r.read(kind, ref);
        if (now === null) return [{ line: "no_source", fields: { n, op, kind, id: ref } }];
        bound.set(key, { kind, ref, now });
        planned.source = { kind, ref, now };
      }
      planned.value = { ...(value.defines !== undefined ? { defines: value.defines } : {}), ...(value.drop === true ? { drop: true } : {}) };
      return planned;
    }
    case "base": {
      if (Object.keys(value).length === 0) return [{ line: "needs_one", fields: { n, op, fields: BASE_PARTS } }];
      const seen: Record<string, string> = {};
      for (const [key, b] of await boundOf(r, character.id)) if (b.now !== null) seen[key] = b.now.revision;
      planned.seen = seen;
      return planned;
    }
    case "relationship": {
      const toward = value.with;
      if (typeof toward !== "string") return [{ line: "needs", fields: { n, op, fields: ["with"] } }];
      if (Object.keys(value).length === 1) return [{ line: "needs_one", fields: { n, op, fields: ["text", ...RELATIONSHIP_DIMENSIONS, "drop"] } }];
      planned.part = "relationship";
      return planned;
    }
    case "growth":
    case "history":
    case "knowledge": {
      planned.part = name;
      const { id, ...fields } = value;
      planned.value = fields;
      if (id === undefined) {
        if (fields.text === undefined) return [{ line: "needs", fields: { n, op, fields: ["text"] } }];
        planned.item = null;
        return planned;
      }
      const item = r.cast.record.items.get(id as string);
      if (item === undefined || item.part !== name || item.character !== character.id) return [{ line: "unknown_id", fields: { n, op, who: character.name, part: name, id: JSON.stringify(id) } }];
      if (Object.keys(fields).length === 0) return [{ line: "needs_one", fields: { n, op, fields: Object.keys(ARGS[name]).filter((f) => f !== "id") } }];
      planned.item = id as string;
      return planned;
    }
  }
}

/** The user's word for the story lane: null to go ahead; else why the call's operations may not. */
async function approval(call: CastCall, operations: JsonValue[]): Promise<"never" | { declined: string | undefined } | null> {
  const approvals = call.deps.approvals;
  if (approvals === undefined) return null;
  const permission = await approvals.permission(call.scope, CAST_LANE);
  if (permission === "auto") return null;
  if (permission === "never") return "never";
  const ask: ApprovalAsk = { agent: call.agent, callId: call.callId, tool: call.tool, lane: CAST_LANE, args: { operations }, at: (call.deps.now ?? Date.now)() };
  const said = await approvals.ask(call.scope, ask, call.signal);
  return said.go ? null : { declined: said.reason };
}

/** A reader that asks Lumiverse once per source for the whole call. */
function onceEach(read: SourceReader, scope: { user: string; chat: string }): (kind: SourceKind, ref: string) => Promise<SourceNow | null> {
  const asked = new Map<string, Promise<SourceNow | null>>();
  return (kind, ref) => {
    const key = sourceKey(kind, ref);
    let got = asked.get(key);
    if (got === undefined) {
      got = read(scope, { kind, ref });
      asked.set(key, got);
    }
    return got;
  };
}

async function update(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  const list = args.operations;
  if (!Array.isArray(list) || list.length === 0) return reply.line("no_operations", {}).fail();
  const cast = readingOr(call, reply);
  if (cast === null) return reply;
  const { store, writes } = call.deps;
  const scope = { user: call.scope.user, chat: call.scope.chat };
  const read = onceEach(call.deps.sources, scope);

  // The names this call casts that the cast does not hold yet: known to every operation of the call.
  const fresh = new Map<string, string>();
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw) || raw.op !== "cast" || typeof raw.who !== "string" || raw.who.trim() === "") continue;
    if (findCharacter(store.db, call.scope.user, cast.chats, raw.who) === null && !fresh.has(nameKey(raw.who))) fresh.set(nameKey(raw.who), raw.who.trim());
  }
  const reading: Reading = { call, cast, fresh, bound: new Map(), read };
  const planned: Planned[] = [];
  const unread: Unread[] = [];
  for (const [i, raw] of list.entries()) {
    const got = await readOp(reading, i + 1, raw);
    if (Array.isArray(got)) unread.push(...got);
    else planned.push(got);
  }
  if (unread.length > 0) {
    for (const u of unread) reply.line(u.line, u.fields);
    return reply.line("nothing_recorded", {}).fail();
  }

  const held = await approval(call, list);
  if (held !== null) {
    for (const p of planned) {
      if (held === "never") reply.line("never", { n: p.n, op: p.op, lane: CAST_LANE });
      else reply.line("declined", { n: p.n, op: p.op, ...(held.declined !== undefined ? { reason: held.declined } : {}) });
    }
    return reply.data({ operations: planned.map((p) => ({ n: p.n, op: p.op, recorded: false, held: held === "never" ? "never" : "declined" })) });
  }

  const now = (call.deps.now ?? Date.now)();
  const user = call.scope.user;
  const turn = call.scope.turn ?? null;
  const by = call.agent.definition;
  const written = await writes.run((db) => {
    // Each character this call casts is made first, so every operation can name it.
    const ids = new Map<string, string>();
    for (const [key, name] of fresh) ids.set(`new:${key}`, addCharacter(db, user, call.scope.chat, name, now).id);
    const items = new Map<number, string>();
    for (const p of planned) {
      const id = ids.get(p.character) ?? p.character;
      if (p.op === "bind" && p.source !== undefined) {
        if (p.value.drop === true) unbindSource(db, user, id, p.source.kind, p.source.ref);
        else bindSource(db, user, id, { kind: p.source.kind, ref: p.source.ref, defines: typeof p.value.defines === "string" ? p.value.defines : null }, now);
      } else if (p.op === "base") {
        writeBase(db, { user, turn, by, agent: call.agent.id, now }, id, p.value as Partial<Record<BasePart, string>>, p.seen ?? {});
      } else if (p.part !== undefined && turn !== null) {
        const item = p.part === "casting" ? castingItemId(id) : p.part === "relationship" ? relationshipItemId(id, p.value.with as string) : (p.item ?? null);
        const [row] = writeCast(db, { user, turn, by, agent: call.agent.id, job: call.agent.job ?? null, at: cast.clock?.now ?? null, now }, [{ character: id, part: p.part, item, value: p.value }]);
        if (row !== undefined) items.set(p.n, row.item);
      }
    }
    return { ids, items };
  }, call.tool);

  // How each part now stands, read again as the turn sees it.
  const after = readingOr(call, reply);
  if (after === null) return reply;
  const operations: JsonObject[] = [];
  for (const p of planned) {
    const id = written.ids.get(p.character) ?? p.character;
    const who = whoView({ id, name: p.name });
    const done: JsonObject = { n: p.n, op: p.op, who, wrote: p.op === "bind" && p.source !== undefined ? { [p.source.kind]: p.source.ref, ...p.value } : p.value };
    if (p.op === "cast") {
      const character = findCharacter(store.db, user, after.chats, id) as Character;
      const casting = castingInForce(after.record, character);
      done.now = casting === null ? null : { as: casting.as, ...(casting.pinned ? { pinned: true } : {}), ...(casting.line !== null ? { line: casting.line } : {}) };
      if (casting?.pinned === true && casting.as !== p.value.as) reply.report("pinned", { n: p.n, who: p.name, as: casting.as });
    } else if (p.op === "bind" || p.op === "base") {
      const states = await sourcesNow((_s, src) => read(src.kind, src.ref), scope, bindingsOf(store.db, user, id), baseOf(store.db, user, id).values());
      if (p.op === "bind") done.now = states.map(sourceView);
      else {
        const older = states.filter((s) => s.newer);
        done.now = { ...baseView(baseOf(store.db, user, id), null), ...(older.length > 0 ? { older_than: older.map(sourceView) } : {}) };
      }
    } else {
      const itemId = written.items.get(p.n);
      const item = itemId === undefined ? undefined : after.record.items.get(itemId);
      done.id = itemId ?? null;
      done.now = item === undefined ? null : itemView(after, item);
    }
    operations.push(done);
  }
  return reply.data({ operations });
}

export const CAST_UPDATE: CastToolSpec = {
  name: "cast_update",
  family: "cast",
  tier: "write",
  lane: CAST_LANE,
  properties: { operations: { type: "array", minItems: 1, items: { type: "object", properties: UPDATE_PROPERTIES, required: ["op", "who"] } } },
  required: ["operations"],
  example: {
    operations: [
      { op: "cast", who: "Bram", as: "supporting", line: "The innkeeper of the Gilded Hart." },
      { op: "bind", who: "Bram", entry: "e-112", defines: "background" },
      { op: "base", who: "Bram", seed: "An innkeeper who keeps his head down.", background: "Born in the inn's cellar." },
      { op: "relationship", who: "Bram", with: "Wren", text: "She pays on time.", trust: 40 },
      { op: "knowledge", who: "Bram", text: "The reeve's seal has a chipped corner.", how: "He saw it on the letter." },
    ],
  },
  run: update,
};
