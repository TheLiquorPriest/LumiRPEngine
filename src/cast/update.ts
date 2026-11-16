// `cast_update` (plan §7.1, §7.2, §6.8): the omniscient side's writes to the cast as named
// operations, applied in order, one call writing many: casting, the sources bound, the base, growth,
// history, relationships, knowledge, and the mark that a migrated character's old mind files have
// been filed (§15.2). The schema holds nothing back, so every call reaches this
// code, which reads each operation itself, in whatever shape an argument was sent when what was meant
// can be read. An argument an operation does not read, or whose value cannot be read (a number off
// its scale), is left out: the operation is written with the rest, and the answer names what was left
// out, once, with what that operation reads. An operation that cannot be read at all (none of the
// list, a source Lumiverse does not hold, an item the path does not hold) answers the whole call, and
// nothing is written. The user's setting for the story lane is held by the harness's gate before the
// call ever runs (the spec's tier and lane), so the tool asks nothing itself. What goes ahead is
// written in one queued write, and the answer says what each operation wrote and how its part of the
// record now stands. A name the cast does not hold yet is made a character at the write, known to
// every operation of the call whatever their order, so a call can bind, draw and cast someone new at
// once; one no operation casts is made not yet cast, and the answer says so. Knowledge that names a
// secret the lore marks makes the character its holder on the call's turn, the way a perception that
// names it does (`secrets.ts`); a secret that cannot be held is left out, and said.

import type { Database } from "bun:sqlite";
import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { ReadContext } from "../engine/registry";
import type { Reply } from "../iface/kit";
import { type Fields, type Lines, textOf } from "../iface/texts";
import { isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { FactId } from "../shared/minds";
import type { Lane } from "../store";
import { IFACE_DEFAULTS } from "../iface/kit";
import { nearestOf } from "../iface/reading";
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
  awayItemId,
  type CastItem,
  type Character,
  findCharacter,
  nameKey,
  RELATIONSHIP_DIMENSIONS,
  relationshipItemId,
  setPerson,
  type RowPart,
  SOURCE_KINDS,
  type SourceKind,
  sourceKey,
  unbindSource,
  writeBase,
  writeCast,
} from "./record";
import { fileName, fileNamed, importedFiles, isFiled } from "./imported";
import { refOf, storyTimeOf, towardOf } from "./refs";
import { forgetsOf, holdingChanges, personNamed, secretsHeld, secretsLetGo, SecretWorld, worldAt } from "./secrets";
import { type SourceNow, type SourceReader, sourcesNow } from "./sources";

/** The lane every operation of the tool writes to: the cast is the story's side of a turn. */
export const CAST_LANE: Lane = "story";

/** Every operation, in the order the tool's file lists them. */
export const UPDATE_OPERATIONS = ["cast", "bind", "base", "growth", "history", "relationship", "away", "knowledge", "filed"] as const;
type Op = (typeof UPDATE_OPERATIONS)[number];

/** The operations that stand outside turns: a swipe leaves what they write. Every other one is kept with its turn. */
const OUTSIDE_TURNS: Readonly<Partial<Record<Op, true>>> = { bind: true, base: true };

/** How an argument is read: words; a name or an id; a list of them; true or false; a whole number from 0; a number in a range; a relationship's dimension (on the scale the setting `cast.dimensionScale` gives); one of a list. */
export type Kind = "text" | "name" | "texts" | "flag" | "whole" | "dimension" | Readonly<{ min: number; max: number }> | readonly string[];

const DROP = { drop: "flag", why: "text" } as const;
const DIMENSIONS = Object.fromEntries(RELATIONSHIP_DIMENSIONS.map((d) => [d, "dimension"])) as Record<(typeof RELATIONSHIP_DIMENSIONS)[number], "dimension">;

/** The arguments each operation takes besides `op` and `who`, each read as its kind. */
const ARGS: Readonly<Record<Op, Readonly<Record<string, Kind>>>> = {
  cast: { as: CASTINGS, line: "text", person: "name", why: "text" },
  bind: { card: "name", persona: "name", entry: "name", memory: "name", defines: "text", drop: "flag" },
  base: { seed: "text", soul: "text", inner_voice: "text", background: "text" },
  growth: { id: "name", text: "text", cause: "text", accept: "flag", ...DROP },
  history: { id: "name", text: "text", beats: "texts", ...DROP },
  relationship: { with: "name", text: "text", ...DIMENSIONS, ...DROP },
  away: { whereabouts: "text", place: "name", names: "texts", intention: "text", until: "text", ...DROP },
  knowledge: { id: "name", text: "text", secret: "name", how: "text", ...DROP },
  filed: { files: "texts" },
};

/** The arguments an operation may carry, in the order the tool's file lists them. */
const UPDATE_ARGUMENTS = ["op", "who", "id", "as", "line", "person", "card", "persona", "entry", "memory", "defines", "seed", "soul", "inner_voice", "background", "text", "cause", "beats", "with", ...RELATIONSHIP_DIMENSIONS, "whereabouts", "place", "names", "intention", "until", "how", "secret", "files", "accept", "drop", "why"];

/**
 * The arguments an operation may carry, each once, whichever operations read it. None holds back a
 * value: the file says what each is, and this code reads each in whatever shape it comes, so the
 * harness never refuses a call for what it carries.
 */
export const UPDATE_PROPERTIES: Record<string, JsonObject> = Object.fromEntries(UPDATE_ARGUMENTS.map((name) => [name, {}]));

/** Something a call says that cannot be read: the answers' line that says so, and its fields; `kept` when it is one item left out of a list whose other items were kept, or a value kept as sent (`applied`) though it is past what it should be. */
export interface Unread {
  line: string;
  fields: Fields;
  kept?: boolean;
  applied?: JsonValue;
}

export function isUnread(v: unknown): v is Unread {
  return typeof v === "object" && v !== null && "line" in v;
}

/**
 * One item of a call (an operation, a perception, a memory) as it was read: what makes it unreadable
 * (the whole call is answered with it, and nothing is written), values it could not read (left out
 * of what it writes, and named in the answer), and the arguments it was sent that it does not read.
 */
export interface ItemRead {
  n: number;
  /** What kind of item it is, as the answers name it; none when that could not be read. */
  op?: string;
  fatal: Unread[];
  unread: Unread[];
  ignored: string[];
}

/** What a kind of item reads; what every one of it needs; and what a new one needs. */
export interface Reads {
  reads: readonly string[];
  needs: readonly string[];
  newNeeds: readonly string[];
}

/** The arguments an item was sent that it does not read. */
export function ignoredOf(given: JsonObject, reads: readonly string[]): string[] {
  return Object.keys(given).filter((k) => !reads.includes(k) && given[k] !== undefined && given[k] !== null);
}

/** The answer to a call one of whose items cannot be read at all: every item's trouble, each with what that kind of item reads, and that nothing was written. */
export function refused(reply: Reply, items: readonly ItemRead[], readsOf: (op: string) => Reads): Reply {
  for (const it of items) {
    for (const u of [...it.fatal, ...it.unread]) reply.line(u.line, u.fields);
    if (it.op === undefined || it.fatal.length + it.unread.length + it.ignored.length === 0) continue;
    const { reads, needs, newNeeds } = readsOf(it.op);
    reply.line("op_takes", { op: it.op, reads: textOf(reads), needs: textOf(needs), new_needs: textOf(newNeeds), ignored: textOf(it.ignored) });
  }
  return reply.line("nothing_recorded", {}).fail();
}

/** What an item that was written was written without, reported once, with what that kind of item reads. */
export function leftOut(reply: Reply, it: ItemRead, reads: readonly string[]): void {
  for (const u of it.unread) reply.report(u.line, u.fields);
  const left = [...new Set([...it.ignored, ...it.unread.flatMap((u) => (u.kept === true ? [] : [String(u.fields.field)]))])];
  if (it.op !== undefined && left.length > 0) reply.report("not_read", { n: it.n, op: it.op, left: textOf(left), reads: textOf(reads) });
}

/** Values an item needs: one sent but unreadable makes the item unreadable, said as what could not be read; those not sent are said to be needed, in one line. */
export function needed(it: ItemRead, fields: readonly string[]): ItemRead {
  const missing: string[] = [];
  for (const field of fields) {
    const at = it.unread.findIndex((u) => u.fields.field === field);
    if (at >= 0) it.fatal.push(...it.unread.splice(at, 1));
    else missing.push(field);
  }
  if (missing.length > 0) it.fatal.push({ line: "needs", fields: { n: it.n, op: it.op, fields: missing } });
  return it;
}

/**
 * The character a name or an id gives: one the cast holds, or, for a name it does not hold yet, one
 * the call makes at its write (`new:<name key>`), known to every item of the call. Code decides
 * nothing about how it is cast: one a cast operation names is cast by it, any other is made not yet
 * cast, and the answer says so.
 */
export function characterNamed(call: CastCall, cast: CastReading, fresh: Map<string, string>, said: string): { id: string; name: string } {
  const found = findCharacter(call.deps.store.db, call.scope.user, cast.chats, said);
  if (found !== null) return { id: found.id, name: found.name };
  const key = nameKey(said);
  const name = fresh.get(key) ?? said.trim();
  fresh.set(key, name);
  return { id: `new:${key}`, name };
}

/** Makes, inside the call's write, each character it named that the cast did not hold: their ids, by the stand-in ids its items used. */
export function makeFresh(db: Database, call: CastCall, fresh: ReadonlyMap<string, string>, now: number): Map<string, string> {
  const ids = new Map<string, string>();
  for (const [key, name] of fresh) ids.set(`new:${key}`, addCharacter(db, call.scope.user, call.scope.chat, name, now).id);
  return ids;
}

/** An operation read: `character` is the character's id, or `new:<name key>` for one this call makes. */
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
  /** For `filed`: the carried mind files it marks filed, by their items' ids. */
  files?: string[];
  /** A binding's source, and what Lumiverse holds of it now. */
  source?: { kind: SourceKind; ref: string; now: SourceNow | null };
  /** For a base: each bound source's revision as it was read for this call. */
  seen?: Record<string, string>;
  /** For knowledge of a secret: the holding it makes, with the events that make it (none when they hold it so already). */
  holds?: { fact: FactId; events: LedgerEvent[] };
  /** For knowledge it strikes, or gives another secret: the holding of the secret it gave taken back, with the events that do. */
  forgets?: { fact: FactId; events: LedgerEvent[] }[];
  /** For a casting: the world's person the character is, by its entity's id, to keep on the character. */
  person?: string;
  /** For a relationship: who it is toward, by reference (a character's id, the world's person, or the name). */
  toward?: string;
}

/** One operation as read, and what it writes when it can be read. */
interface OpRead extends ItemRead {
  planned?: Planned;
}

/**
 * One argument of the `n`th item of a call (`op` names what kind of item) read as its kind, in any
 * shape that says it; undefined when it is not given. `lines` give the words for what a value takes.
 */
export function readArg(lines: Lines, n: number, op: string, field: string, kind: Kind, said: JsonValue | undefined, scale = 100): JsonValue | Unread | undefined {
  if (said === undefined || said === null) return undefined;
  const unreadable = (choices: readonly JsonValue[] = [], wants?: string): Unread => ({
    line: "unreadable_op",
    fields: { n, op, field, value: JSON.stringify(said), choices: textOf(choices), ...(wants !== undefined ? { wants: lines.line(`wants_${wants}`) ?? "" } : {}) },
  });
  const number = typeof said === "number" ? said : typeof said === "string" && said.trim() !== "" && Number.isFinite(Number(said)) ? Number(said) : null;
  if (Array.isArray(kind)) return typeof said === "string" && kind.includes(said.trim()) ? said.trim() : unreadable(kind);
  if (kind === "dimension") {
    // A dimension past its scale is applied as it was sent, and said to be past it; only what is no number at all is left out.
    if (number === null) return { line: "out_of_range", fields: { n, op, field, value: JSON.stringify(said), min: -scale, max: scale } };
    return number >= -scale && number <= scale ? number : { line: "past_scale", fields: { n, op, field, value: JSON.stringify(said), min: -scale, max: scale }, kept: true, applied: number };
  }
  if (typeof kind === "object") {
    const range = kind as Readonly<{ min: number; max: number }>;
    return number !== null && number >= range.min && number <= range.max ? number : { line: "out_of_range", fields: { n, op, field, value: JSON.stringify(said), min: range.min, max: range.max } };
  }
  switch (kind) {
    case "text": {
      // Words sent in another shape (a list, an object, a number) are kept as they were sent.
      const text = typeof said === "string" ? said.trim() : JSON.stringify(said);
      return text === "" || text === "[]" || text === "{}" ? undefined : text;
    }
    case "name": {
      if (typeof said !== "string" && typeof said !== "number") return unreadable([], "name");
      const name = String(said).trim();
      return name === "" ? undefined : name;
    }
    case "texts": {
      const list = Array.isArray(said) ? said : [said];
      if (!list.every((x) => typeof x === "string" || typeof x === "number")) return unreadable([], "texts");
      const texts = list.map((x) => String(x).trim()).filter((x) => x !== "");
      return texts.length === 0 ? undefined : texts;
    }
    case "flag":
      return typeof said === "boolean" ? said : said === "true" || said === "false" ? said === "true" : unreadable([true, false]);
    case "whole":
      return number !== null && Number.isInteger(number) && number >= 0 ? number : unreadable([], "whole");
  }
}

/** What a kind of operation reads besides `op`, what every one of it needs, and what a new item of it needs. */
function readsOf(op: string): Reads {
  const name = op as Op;
  return {
    reads: ["who", ...Object.keys(ARGS[name])],
    needs: name === "cast" ? ["who", "as"] : name === "relationship" ? ["who", "with"] : name === "filed" ? ["who", "files"] : ["who"],
    // Knowledge is words, a secret, or both: a new one needs one of them, which `readOp` says when it has neither.
    newNeeds: name === "growth" || name === "history" ? ["text"] : [],
  };
}

/** What a call works with while it reads its operations. */
interface Reading {
  call: CastCall;
  cast: CastReading;
  /** The names this call gives that the cast does not hold yet, by name key: each is made at the write, so every operation of the call knows it. */
  fresh: Map<string, string>;
  /** Each character's bindings as they stand after the operations read so far, by source key, with what Lumiverse holds now. */
  bound: Map<string, Map<string, { kind: SourceKind; ref: string; now: SourceNow | null }>>;
  /** Reads a source live once per call. */
  read: (kind: SourceKind, ref: string) => Promise<SourceNow | null>;
  /** Where knowledge holds the secrets it names: the state at the call's turn; none for a call that belongs to no turn. */
  world: SecretWorld | null;
  /** The world as the call's turn plays it, read once, for the people and places the words name; null where the chat plays none. */
  ctx: () => ReadContext | null;
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

/** One operation read: what it writes, what of it could not be read, and what it does not read. */
async function readOp(r: Reading, n: number, raw: JsonValue): Promise<OpRead> {
  const given = isRecord(raw) ? (raw as JsonObject) : null;
  const op = typeof given?.op === "string" ? given.op.trim() : undefined;
  if (given === null || op === undefined || !(UPDATE_OPERATIONS as readonly string[]).includes(op)) {
    return { n, fatal: [{ line: "unknown_op", fields: { n, value: JSON.stringify(given?.op ?? null), choices: textOf(UPDATE_OPERATIONS) } }], unread: [], ignored: [] };
  }
  const name = op as Op;
  const out: OpRead = { n, op, fatal: [], unread: [], ignored: ignoredOf(given, ["op", ...readsOf(op).reads]) };
  const unreadable = (u: Unread): OpRead => {
    out.fatal.push(u);
    return out;
  };
  if (OUTSIDE_TURNS[name] !== true && r.call.scope.turn === undefined) out.fatal.push({ line: "turn_needed_op", fields: { n, op } });

  const who = readArg(r.call.lines, n, op, "who", "name", given.who);
  let character: { id: string; name: string } | null = null;
  if (isUnread(who)) out.fatal.push(who);
  else if (who === undefined) out.fatal.push({ line: "needs", fields: { n, op, fields: ["who"] } });
  else character = characterNamed(r.call, r.cast, r.fresh, who as string);

  const value: JsonObject = {};
  for (const [field, kind] of Object.entries(ARGS[name])) {
    const got = readArg(r.call.lines, n, op, field, kind, given[field], r.call.settings.dimensionScale);
    if (isUnread(got)) {
      out.unread.push(got);
      if (got.applied !== undefined) value[field] = got.applied;
    } else if (got !== undefined) value[field] = got;
  }
  if (out.fatal.length > 0 || character === null) return out;
  const planned: Planned = { n, op: name, character: character.id, name: character.name, value };
  out.planned = planned;

  switch (name) {
    case "cast": {
      if (value.as === undefined) return needed(out, ["as"]);
      planned.part = "casting";
      // The world's person it is, kept on the character: the one named (an id or a name the world holds), else the one its name finds where it has none yet.
      const ctx = r.ctx();
      const held = findCharacter(r.call.deps.store.db, r.call.scope.user, r.cast.chats, character.id)?.person ?? null;
      if (typeof value.person === "string") {
        const found = ctx === null ? null : personNamed(ctx, value.person);
        if (found !== null && "id" in found) planned.person = found.id;
        else {
          const names = ctx === null ? [] : Object.values(ctx.state.entities).map((e) => e.name);
          out.unread.push({ line: "no_person", fields: { n, op, field: "person", said: value.person, near: textOf(nearestOf(value.person, names, IFACE_DEFAULTS).slice(0, IFACE_DEFAULTS.nearMatches)) } });
        }
      } else if (held === null && ctx !== null) {
        const found = personNamed(ctx, character.name);
        if ("id" in found) planned.person = found.id;
      }
      delete value.person;
      return out;
    }
    case "bind": {
      const named = SOURCE_KINDS.filter((k) => value[k] !== undefined);
      const [kind] = named;
      if (kind === undefined || named.length > 1) return unreadable({ line: "one_source", fields: { n, op, choices: textOf(SOURCE_KINDS) } });
      const ref = value[kind] as string;
      const bound = await boundOf(r, character.id);
      const key = sourceKey(kind, ref);
      if (value.drop === true) {
        if (!bound.has(key)) return unreadable({ line: "not_bound", fields: { n, op, who: character.name, kind, id: ref } });
        bound.delete(key);
        planned.source = { kind, ref, now: null };
      } else {
        const now = await r.read(kind, ref);
        if (now === null) return unreadable({ line: "no_source", fields: { n, op, kind, id: ref } });
        bound.set(key, { kind, ref, now });
        planned.source = { kind, ref, now };
      }
      planned.value = { ...(value.defines !== undefined ? { defines: value.defines } : {}), ...(value.drop === true ? { drop: true } : {}) };
      return out;
    }
    case "base": {
      if (Object.keys(value).length === 0) return unreadable({ line: "needs_one", fields: { n, op, fields: BASE_PARTS } });
      const seen: Record<string, string> = {};
      for (const [key, b] of await boundOf(r, character.id)) if (b.now !== null) seen[key] = b.now.revision;
      planned.seen = seen;
      return out;
    }
    case "relationship": {
      if (typeof value.with !== "string") return needed(out, ["with"]);
      if (Object.keys(value).length === 1) return unreadable({ line: "needs_one", fields: { n, op, fields: ["text", ...RELATIONSHIP_DIMENSIONS, "drop"] } });
      // Toward a person by reference: a rename follows, and the id or a nickname joins the same relationship.
      const toward = towardOf(r.call.deps.store.db, r.call.scope.user, r.cast.chats, r.ctx(), value.with);
      planned.toward = toward.ref;
      value.with = toward.name;
      value.toward = toward.ref;
      planned.part = "relationship";
      return out;
    }
    case "away": {
      // A principal out of view keeps living: where it is and what it means to do, in the Author's words, with the refs of the places and
      // people they name and the story time the intention is meant for. A word the world holds nothing for is left unreferenced and says so.
      const ctx = r.ctx();
      if (value.place !== undefined) {
        const named = ctx === null ? ({ near: [] } as const) : refOf(ctx, value.place as string);
        if ("ref" in named) value.place_ref = named.ref;
        else out.unread.push({ line: "no_ref", fields: { n, op, field: "place", said: value.place as string, near: textOf(named.near) } });
      }
      if (Array.isArray(value.names)) {
        const refs: string[] = [];
        for (const said of value.names as string[]) {
          const named = ctx === null ? ({ near: [] } as const) : refOf(ctx, said);
          if ("ref" in named) refs.push(named.ref);
          else out.unread.push({ line: "no_ref", fields: { n, op, field: "names", said, near: textOf(named.near) }, kept: true });
        }
        if (refs.length > 0) value.name_refs = refs;
      }
      if (typeof value.until === "string" && ctx !== null) {
        const minutes = storyTimeOf(ctx, value.until);
        if (minutes !== null) value.until_at = minutes;
      }
      if (!Object.keys(value).some((k) => k !== "drop" && k !== "why")) return unreadable({ line: "needs_one", fields: { n, op, fields: ["whereabouts", "intention", "place", "names", "until", "drop"] } });
      planned.part = "away";
      return out;
    }
    case "growth":
    case "history":
    case "knowledge": {
      planned.part = name;
      const { id, accept, ...fields } = value;
      // Accepting a growth a character's reflection proposed: it is growth from now on.
      planned.value = accept === undefined ? fields : { ...fields, proposed: accept !== true };
      let item: CastItem | null = null;
      if (id !== undefined) {
        const found = r.cast.record.items.get(id as string);
        if (found === undefined || found.part !== name || found.character !== character.id) return unreadable({ line: "unknown_id", fields: { n, op, who: character.name, part: name, id: JSON.stringify(id) } });
        item = found;
      }
      // Knowledge of a secret the lore marks: they hold it from now on, as a perception that names it makes them hold it. One
      // that cannot be held is left out, and said; so is one sent with a strike, which holds nothing.
      const secret = name === "knowledge" ? planned.value.secret : undefined;
      if (typeof secret === "string" && planned.value.drop === true) {
        delete planned.value.secret;
        out.ignored.push("secret");
      } else if (typeof secret === "string" && r.world !== null) {
        const turn = r.call.scope.turn;
        const learned = turn === undefined ? null : r.call.deps.store.user(r.call.scope.user).turn(turn);
        const [held] = await secretsHeld(r.world, { n, op, field: "secret" }, character.name, undefined, learned, [secret], r.call.settings.secretConfidence, out.unread);
        if (held === undefined) delete planned.value.secret;
        else {
          planned.value.secret = held.fact;
          planned.holds = held;
        }
      }
      if (item === null) {
        if (planned.value.text !== undefined || planned.value.secret !== undefined) {
          planned.item = null;
          return out;
        }
        if (name !== "knowledge") return needed(out, ["text"]);
        // What they know is words, a secret, or both: one sent that cannot be read or held makes the operation unreadable.
        const said = out.unread.filter((u) => u.fields.field === "text" || u.fields.field === "secret");
        if (said.length === 0) return unreadable({ line: "needs_one", fields: { n, op, fields: ["text", "secret"] } });
        out.unread = out.unread.filter((u) => !said.includes(u));
        out.fatal.push(...said);
        return out;
      }
      if (Object.keys(planned.value).length === 0) return unreadable({ line: "needs_one", fields: { n, op, fields: Object.keys(ARGS[name]).filter((f) => f !== "id") } });
      planned.item = item.id;
      // Knowledge of a secret struck, or given another secret: the one it gave is let go, unless other knowledge of theirs still gives it.
      const replaced = planned.value.drop === true || (typeof planned.value.secret === "string" && planned.value.secret !== item.fields.secret);
      if (name === "knowledge" && replaced && !item.dropped && r.world !== null) {
        const facts = secretsLetGo(r.cast.record, character.id, [item]);
        if (facts.length > 0) planned.forgets = forgetsOf(r.world.ctx, n, op, character.name, facts, out.unread);
      }
      return out;
    }
    case "filed": {
      if (value.files === undefined) return needed(out, ["files"]);
      // Each file named that the character carried on this path; one that is none of theirs is left out, and said with the names of theirs.
      const theirs = importedFiles(r.cast.record, character.id);
      const named: CastItem[] = [];
      const unknown: string[] = [];
      for (const said of value.files as string[]) {
        const found = fileNamed(theirs, said);
        if (found === undefined) unknown.push(said);
        else if (!named.includes(found)) named.push(found);
      }
      const files = textOf(theirs.map(fileName));
      const said = unknown.map((file): Unread => ({ line: "no_file", fields: { n, op, field: "files", who: character.name, file, files }, ...(named.length > 0 ? { kept: true } : {}) }));
      (named.length === 0 ? out.fatal : out.unread).push(...said);
      planned.files = named.map((f) => f.id);
      planned.value = { files: named.map(fileName) };
      return out;
    }
  }
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

  const fresh = new Map<string, string>();
  const at = call.scope.turn;
  const world = at === undefined ? null : new SecretWorld(() => worldAt(store, scope.user, at, call.agent.job ?? null), (book, entry) => (call.deps.books === undefined ? Promise.resolve(null) : call.deps.books(scope, book, entry)));
  const reading: Reading = { call, cast, fresh, bound: new Map(), read, world, ctx: () => (ctxOf ??= worldAt(store, scope.user, at ?? null, call.agent.job ?? null, scope.chat)) };
  let ctxOf: ReadContext | null | undefined;
  const ops: OpRead[] = [];
  for (const [i, raw] of list.entries()) ops.push(await readOp(reading, i + 1, raw));
  if (ops.some((o) => o.fatal.length > 0)) return refused(reply, ops, readsOf);
  const planned = ops.flatMap((o) => (o.planned === undefined ? [] : [o.planned]));

  const now = (call.deps.now ?? Date.now)();
  const user = call.scope.user;
  const turn = call.scope.turn ?? null;
  const by = call.agent.definition;
  const written = await writes.run((db) => {
    // Each character this call names that the cast does not hold is made first, so every operation can name it.
    const ids = makeFresh(db, call, fresh, now);
    // A secret's fact is recorded before anyone holds it.
    if (turn !== null && world !== null && world.facts.length > 0) store.user(user).addChanges(turn, holdingChanges(world.facts, CAST_LANE, call.agent.id, call.agent.job ?? null));
    const items = new Map<number, string>();
    for (const p of planned) {
      const id = ids.get(p.character) ?? p.character;
      if (p.op === "bind" && p.source !== undefined) {
        if (p.value.drop === true) unbindSource(db, user, id, p.source.kind, p.source.ref);
        else bindSource(db, user, id, { kind: p.source.kind, ref: p.source.ref, defines: typeof p.value.defines === "string" ? p.value.defines : null }, now);
      } else if (p.op === "base") {
        writeBase(db, { user, turn, by, agent: call.agent.id, now }, id, p.value as Partial<Record<BasePart, string>>, p.seen ?? {});
      } else if (p.op === "filed" && p.files !== undefined && turn !== null) {
        writeCast(
          store,
          { user, turn, by, agent: call.agent.id, job: call.agent.job ?? null, at: cast.clock?.now ?? null, now },
          p.files.map((item) => ({ character: id, part: "mind", item, value: { filed: true } })),
        );
      } else if (p.part !== undefined && turn !== null) {
        const item = p.part === "casting" ? castingItemId(id) : p.part === "relationship" ? relationshipItemId(id, p.toward ?? (p.value.with as string)) : p.part === "away" ? awayItemId(id) : (p.item ?? null);
        const [row] = writeCast(store, { user, turn, by, agent: call.agent.id, job: call.agent.job ?? null, at: cast.clock?.now ?? null, now }, [{ character: id, part: p.part, item, value: p.value }]);
        if (row !== undefined) items.set(p.n, row.item);
        // The world's person a character is: kept on the character, outside the turn, as a binding of a source is.
        if (p.person !== undefined) setPerson(db, user, id, p.person);
        const events = [...(p.holds?.events ?? []), ...(p.forgets?.flatMap((f) => f.events) ?? [])];
        if (events.length > 0) store.user(user).addChanges(turn, holdingChanges(events, CAST_LANE, call.agent.id, call.agent.job ?? null));
      }
    }
    return { ids, items };
  }, call.tool);

  // One made here that no operation of the call casts is said to be in the cast now, not yet cast.
  const castHere = new Set(planned.flatMap((p) => (p.op === "cast" ? [p.character] : [])));
  for (const [key, name] of fresh) if (!castHere.has(`new:${key}`)) reply.line("added", { who: name });

  // How each part now stands, read again as the turn sees it.
  const after = readingOr(call, reply);
  if (after === null) return reply;
  const operations: JsonObject[] = [];
  for (const o of ops) {
    leftOut(reply, o, readsOf(o.op as Op).reads);
    const p = o.planned;
    if (p === undefined) continue;
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
    } else if (p.op === "filed") {
      done.now = { files: importedFiles(after.record, id).map((f) => ({ file: fileName(f), filed: isFiled(f) })) };
    } else {
      const itemId = written.items.get(p.n);
      const item = itemId === undefined ? undefined : after.record.items.get(itemId);
      done.id = itemId ?? null;
      done.now = item === undefined ? null : itemView(after, item);
      if (p.holds !== undefined) done.holds = [p.holds.fact];
      const gone = p.forgets?.flatMap((f) => (f.events.length > 0 ? [f.fact] : [])) ?? [];
      if (gone.length > 0) done.lets_go = gone;
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
  // Nothing the code reads is held back by the schema: a call it cannot read is answered in the answers' words, with what would work.
  properties: { operations: { type: "array", items: { type: "object", properties: UPDATE_PROPERTIES } } },
  required: [],
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
