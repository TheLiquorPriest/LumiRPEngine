// `story_record` (plan §8.1, §6.8): the Author's understanding written as named operations, applied
// in order, one call writing many. The schema holds nothing back, so every call reaches this code,
// which reads each operation itself, against the record as it stands with each earlier operation of
// the call applied, and in whatever shape an argument was sent when what was meant can be read. An
// argument an operation does not read, or whose value cannot be read (a message the chat does not
// have, a time that is not one), is left out: the operation is recorded with the rest, and the
// answer names what was left out, once, with what that operation reads. An operation that cannot be
// read at all (none of the list, an id the record does not hold, a new item without what it needs)
// answers the whole call, and nothing is recorded. The user's setting for the story lane is not asked
// here: the tool is a write to that lane, so the harness's gate holds the call by it before it runs,
// once. What goes ahead is recorded in one queued write, the lore lane's overlays included, and the
// answer says what each operation wrote, how its item now stands, and what did not add up.

import type { AgentRef, JsonObject, JsonValue } from "rp-harness/contract";
import type { Reply } from "../iface/kit";
import { MARKS, type Provenance, provenanceData, provenanceLeniently, type Stamp, stampOf } from "../iface/source";
import { type Fields, type Lines, textOf } from "../iface/texts";
import { DRAFT_TIERS } from "../shared/ledger";
import { isRecord } from "../shared/json";
import { type Lane, STANDINGS, type Standing, type TreeView } from "../store";
import { questRefOf } from "../quests/read";
import { allSpans, itemView, nearIds, placeRefOf, recordOr, STORY_DEFAULTS, type StoryCall, type StoryClock, storyClock, type StoryToolSpec, treeOf, valueView } from "./kit";
import { keyedItemId, recordStory, type StoryItem, type StoryOverlayWrite, type StoryPart, type StoryRecord, type StoryRecorded, type StoryWrite } from "./record";

/** The lane every operation of the tool writes to. */
export const STORY_LANE: Lane = "story";

/** How an operation finds the item it writes: a new one or one named by id; a scene's or chapter's (new, named, or the current one); the one premise; a person's arc; this turn's record. */
type Finds = "new-or-id" | "span" | "premise" | "arc" | "record";

/** How an argument is read: words; names; true or false; a message by number or id; a tier; a story time; an item by id; one of a list. */
type Kind = "text" | "names" | "flag" | "message" | "tier" | "due" | "item" | readonly string[];

interface OpDef {
  name: string;
  part: StoryPart;
  finds: Finds;
  /** The arguments it writes, each read as its kind. `from` and `to` are kept as `first` and `last`, the message ids. */
  args: Readonly<Record<string, Kind>>;
  /** What a new item needs. */
  needs?: readonly string[];
}

export const THREAD_KINDS = ["question", "promise", "setup"] as const;
export const PLAYER_KINDS = ["enjoys", "avoids", "pacing", "request", "line"] as const;

const DROP = { drop: "flag", why: "text" } as const;

/** The parts whose `place` words are tied to the place's ref where they name one. */
const PLACED: Readonly<Partial<Record<StoryPart, true>>> = { scene: true, beat: true, future: true };

const OPS: readonly OpDef[] = [
  { name: "premise", part: "premise", finds: "premise", args: { text: "text", tone: "text", rules: "text", role: "text" } },
  { name: "chapter", part: "chapter", finds: "span", args: { title: "text", place: "text", time: "text", summary: "text", from: "message", to: "message", close: "flag", ...DROP } },
  {
    name: "scene",
    part: "scene",
    finds: "span",
    args: { title: "text", place: "text", time: "text", who: "names", purpose: "text", tension: "text", wants: "text", ends: "text", summary: "text", from: "message", to: "message", close: "flag", ...DROP },
  },
  { name: "beat", part: "beat", finds: "new-or-id", args: { text: "text", who: "names", place: "text", quests: "names", time: "text", message: "message", from: "message", to: "message", ...DROP }, needs: ["text"] },
  { name: "thread", part: "thread", finds: "new-or-id", args: { text: "text", kind: THREAD_KINDS, state: "text", stakes: "text", who: "names", payoff: "text", hot: "flag", close: "flag", ...DROP }, needs: ["text"] },
  { name: "arc", part: "arc", finds: "arc", args: { began: "text", stands: "text", next: "text", ...DROP } },
  { name: "player", part: "player", finds: "new-or-id", args: { text: "text", kind: PLAYER_KINDS, ...DROP }, needs: ["text"] },
  { name: "future", part: "future", finds: "new-or-id", args: { text: "text", tier: "tier", due: "due", standing: STANDINGS, who: "names", place: "text", close: "flag", ...DROP }, needs: ["text"] },
  { name: "canon", part: "canon", finds: "new-or-id", args: { text: "text", who: "names", message: "message", ...DROP }, needs: ["text"] },
  { name: "retcon", part: "retcon", finds: "new-or-id", args: { text: "text", why: "text", of: "item", drop: "flag" }, needs: ["text"] },
  { name: "record", part: "record", finds: "record", args: { intent: "text", decided: "text", why: "text", rulings: "text", consents: "text", next: "text", turn: "text" } },
];

/** The operation that writes no story item: it hands the lore lane's overlay its note. */
const OVERLAY = "overlay";

/** Every operation, in the order the tool's file lists them. */
export const STORY_OPERATIONS: readonly string[] = [...OPS.map((o) => o.name), OVERLAY];

const BY_NAME: ReadonlyMap<string, OpDef> = new Map(OPS.map((o) => [o.name, o]));

/** The arguments an operation may carry, in the order the tool's file lists them. */
const RECORD_ARGUMENTS = ["op", "id", "new", "text", "title", "summary", "who", "place", "quests", "time", "message", "from", "to", "purpose", "tension", "wants", "ends", "kind", "state", "stakes", "payoff", "hot", "began", "stands", "next", "tier", "due", "standing", "source", "precision", "tone", "rules", "role", "of", "intent", "decided", "rulings", "consents", "turn", "entry", "close", "drop", "why"] as const;

/**
 * The arguments an operation may carry, each once, whichever operations read it. None holds back a
 * value: the file says what each is, and this code reads each in whatever shape it comes, so the
 * harness never refuses a call for what it carries.
 */
export const RECORD_PROPERTIES: Record<string, JsonObject> = Object.fromEntries(RECORD_ARGUMENTS.map((name) => [name, {}]));

/** Something an operation says that cannot be read: the answers' line that says so, and its fields. */
export interface Unread {
  line: string;
  fields: Fields;
}

/** An operation read: the write it makes (of an item already there, or of a new one held by a stand-in id until it is written), and its reports. */
interface Planned {
  n: number;
  op: string;
  part: StoryPart;
  item: string;
  fresh: boolean;
  value: JsonObject;
  reports: Unread[];
  /** Where it comes from, how exact and how sure; none for a page's correction, which is the player's. */
  prov?: Provenance;
}

interface PlannedOverlay {
  n: number;
  op: typeof OVERLAY;
  entry: string;
  note: string;
  prov?: Provenance;
}

type Read = Planned | PlannedOverlay;

/** One operation of a call as it was read. */
interface OpRead {
  n: number;
  /** Its kind, when that could be read. */
  op?: string;
  /** What it writes; none when it cannot be read at all. */
  read?: Read;
  /** What makes it unreadable: the whole call is answered with it, and nothing is recorded. */
  fatal: Unread[];
  /** Values it could not read: left out of what it writes, and named in the answer. */
  unread: Unread[];
  /** The arguments it was sent that it does not read. */
  ignored: string[];
}

/** What a call works with while it reads its operations. */
interface Reading {
  record: StoryRecord;
  clock: StoryClock | null;
  /** The turn the call belongs to; none for a call of his own job or the assistant's, whose writes belong to no turn. */
  turn: string | null;
  lines: Lines;
  /** Who writes: its operations carry a source, a precision and a standing of their own; none for a page's correction. */
  agent?: AgentRef;
  /** A page's correction of his: a field sent blank is blanked, where a tool's blank is a field not given. */
  blanking?: true;
  /** The ref of the place a name or id names in the world the turn stands in; null when it names none there, undefined when that world has no place to name. */
  placeRef(words: string): string | null | undefined;
  /** The ref of the quest, the world's or one opened in play, a name or id names; null when it names none. Absent: quests are not tied to refs. */
  questRef?(words: string): string | null;
  /** What an answer about an id the record does not hold adds: the near ids of that part (of any part with none), or that the record holds none. */
  near(said: string, part: StoryPart | null): Fields;
}

/** Whether he sent nothing in a field: null, no words, or no names. */
function isBlank(v: JsonValue | undefined): boolean {
  return v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.every((x) => x === null || (typeof x === "string" && x.trim() === "")));
}

function isUnread(v: unknown): v is Unread {
  return typeof v === "object" && v !== null && "line" in v;
}

/** The arguments every operation reads for where it comes from: read by each, so never said to be left out, and said in each argument's file rather than in each operation's list. */
const PROVENANCE_KEYS = ["source", "precision", "standing"] as const;

/** What an operation reads besides `op` (its provenance aside); what every one of it needs; and what a new item of it needs. */
function takesOf(op: string): { reads: string[]; needs: string[]; newNeeds: string[] } {
  if (op === OVERLAY) return { reads: ["entry", "text"], needs: ["entry", "text"], newNeeds: [] };
  const def = BY_NAME.get(op) as OpDef;
  const finding = def.finds === "new-or-id" || def.finds === "record" ? ["id"] : def.finds === "span" ? ["id", "new"] : def.finds === "arc" ? ["who"] : [];
  return { reads: [...new Set([...finding, ...Object.keys(def.args)])], needs: def.finds === "arc" ? ["who"] : [], newNeeds: [...(def.needs ?? [])] };
}

/** One argument read as its kind, in any shape that says it; undefined when it is not given. */
function readArg(r: Reading, n: number, op: string, field: string, kind: Kind, said: JsonValue | undefined): JsonValue | Unread | undefined {
  if (said === undefined || said === null) return undefined;
  const unreadable = (choices: readonly JsonValue[] = [], wants?: string): Unread => ({
    line: "unreadable_op",
    // Whatever was meant that a fixed list cannot hold can go in the item's `text`, which takes any words.
    fields: { n, op, field, value: JSON.stringify(said), choices: textOf(choices), ...(wants !== undefined ? { wants: r.lines.line(`wants_${wants}`) ?? "" } : {}), ...(choices.length > 0 && field !== "text" && BY_NAME.get(op)?.args.text !== undefined ? { says: "text" } : {}) },
  });
  if (Array.isArray(kind)) return typeof said === "string" && kind.includes(said.trim()) ? said.trim() : unreadable(kind);
  switch (kind) {
    case "text": {
      // Words sent in another shape (a list, an object, a number) are kept as they were sent.
      const text = typeof said === "string" ? said.trim() : JSON.stringify(said);
      return text === "" || text === "[]" || text === "{}" ? undefined : text;
    }
    case "names": {
      const list = Array.isArray(said) ? said : [said];
      if (!list.every((x) => typeof x === "string" || typeof x === "number")) return unreadable([], "names");
      const names = list.map((x) => String(x).trim()).filter((x) => x !== "");
      return names.length === 0 ? undefined : names;
    }
    case "flag":
      return typeof said === "boolean" ? said : said === "true" || said === "false" ? said === "true" : unreadable([true, false]);
    case "tier": {
      const tier = typeof said === "string" && said.trim() !== "" ? Number(said) : said;
      return typeof tier === "number" && (DRAFT_TIERS as readonly number[]).includes(tier) ? tier : unreadable([...DRAFT_TIERS]);
    }
    case "message": {
      // By its number as the story so far shows it, or by its id.
      const messages = r.record.at.messages;
      const number = typeof said === "number" ? said : typeof said === "string" && /^\d+$/.test(said.trim()) ? Number(said.trim()) : null;
      const message = number !== null ? (Number.isInteger(number) ? messages[number] : undefined) : typeof said === "string" ? messages.find((m) => m.message === said.trim()) : undefined;
      return message === undefined ? { line: "no_message", fields: { n, op, field, value: JSON.stringify(said), last: messages.length - 1 } } : message.message;
    }
    case "due": {
      // A time no date can be counted from is kept in the words it was given: shown as given, it never comes up as due.
      const at = r.clock !== null && typeof said === "string" ? r.clock.read(said) : null;
      if (at !== null) return at;
      const words = typeof said === "string" ? said.trim() : JSON.stringify(said);
      return words === "" ? undefined : words;
    }
    case "item":
      return typeof said === "string" && r.record.items.has(said.trim()) ? said.trim() : { line: "unknown_id", fields: { n, op, field, id: JSON.stringify(said), ...r.near(typeof said === "string" ? said : "", null) } };
  }
}

/** The item an operation writes: one named by id, a new one, the current scene or chapter, or the one its key names. */
function findItem(r: Reading, def: OpDef, n: number, raw: JsonObject, value: JsonObject): { item: string; fresh: boolean } | Unread {
  const named = raw.id;
  const byId = (): { item: string; fresh: boolean } | Unread => {
    const id = typeof named === "string" ? named.trim() : "";
    return r.record.items.get(id)?.part === def.part ? { item: id, fresh: false } : { line: "unknown_id", fields: { n, op: def.name, part: def.part, id: JSON.stringify(named), ...r.near(id, def.part) } };
  };
  switch (def.finds) {
    case "new-or-id": {
      if (named !== undefined && named !== null) return byId();
      const missing = (def.needs ?? []).filter((f) => value[f] === undefined);
      return missing.length > 0 ? { line: "needs", fields: { n, op: def.name, fields: missing } } : { item: `new:${n}`, fresh: true };
    }
    case "span": {
      const fresh = readArg(r, n, def.name, "new", "flag", raw.new);
      if (isUnread(fresh)) return fresh;
      if (fresh === true) return { item: `new:${n}`, fresh: true };
      if (named !== undefined && named !== null) return byId();
      const current = r.record.current(def.part as "scene" | "chapter");
      if (current === null) return { line: "no_current", fields: { n, op: def.name, part: def.part } };
      // A closed one is not written to unless it is named: the operation may mean a new one.
      return current.closedBy === null ? { item: current.id, fresh: false } : { line: "current_closed", fields: { n, op: def.name, part: def.part, id: current.id } };
    }
    case "arc": {
      const who = readArg(r, n, def.name, "who", "names", raw.who);
      if (isUnread(who)) return who;
      if (who === undefined) return { line: "needs", fields: { n, op: def.name, fields: ["who"] } };
      const [name, ...more] = who as string[];
      if (name === undefined || more.length > 0) return { line: "one_name", fields: { n, op: def.name } };
      value.who = name;
      return { item: keyedItemId("arc", name), fresh: false };
    }
    case "premise":
    case "record": {
      // The turn whose record it is: the one a call names (a job of his own writes the record of a turn it was told of), by the turn's
      // id or by its record's id as answers print it (`rec:<turn>`), in `turn` or `id`; else the call's own, and for a call with none (a job of his)
      // the chat's newest turn, which the answer names by its record's id.
      const said = def.finds === "record" ? (value.turn ?? (typeof named === "string" ? named : undefined)) : undefined;
      if (def.finds === "record") delete value.turn;
      if (Object.keys(value).length === 0) return { line: "needs_one", fields: { n, op: def.name, fields: Object.keys(def.args).filter((f) => f !== "turn") } };
      if (def.finds === "premise") return { item: keyedItemId("premise", ""), fresh: false };
      const words = typeof said === "string" ? said.trim() : "";
      const turn = words === "" ? (r.turn ?? r.record.at.turns.at(-1) ?? null) : words.startsWith(RECORD_ID) ? words.slice(RECORD_ID.length) : words;
      // A chat with no turn has no turn to record.
      if (turn === null) return { line: "turn_needed", fields: { n, op: def.name } };
      if (!r.record.at.turns.includes(turn)) return { line: "no_turn", fields: { id: turn } };
      return { item: keyedItemId("record", turn), fresh: false };
    }
  }
}

/** The start of a turn's record's id (`rec:<turn>`), as answers print it. */
const RECORD_ID = keyedItemId("record", "");

/** What a write carries to the store: its provenance as a change keeps it; none where the writer's own stands. */
const stampOn = (prov: Provenance | undefined): { stamp?: Stamp } => (prov === undefined ? {} : { stamp: stampOf(prov) });

/** The marks and lines an operation's provenance carries into the answer: the write was made all the same. */
function provenanceLines(reply: Reply, n: number, op: string, prov: Provenance | undefined): void {
  if (prov === undefined) return;
  for (const mark of prov.marks) reply.mark(mark);
  const fields = { n, op };
  if (prov.marks.includes(MARKS.unsourced)) reply.line("unsourced", fields);
  if (prov.marks.includes(MARKS.noGapCheck)) reply.line("invented_unchecked", fields);
  if (prov.marks.includes(MARKS.noConsent)) reply.line("invented_unconsented", fields);
}

/**
 * What an operation's own provenance reads as (its source, precision and standing): an argument that cannot be read is left out and
 * said, and the operation is recorded without it, so a source left out is an unsourced write. A future's own `standing` is its standing.
 */
function provenanceFor(r: Reading, n: number, op: string, given: JsonObject, out: OpRead, futureStanding?: Standing): Provenance | undefined {
  if (r.agent === undefined) return undefined;
  const { standing: _kept, ...rest } = given;
  const { prov, left } = provenanceLeniently(futureStanding !== undefined || op === "future" ? rest : given, r.agent);
  for (const u of left) out.unread.push({ line: "unreadable_op", fields: { n, op, field: u.field, value: JSON.stringify(u.value), choices: textOf(u.choices) } });
  return futureStanding !== undefined ? { ...prov, standing: futureStanding } : prov;
}

/** One operation read, and applied to the record the next one is read against. */
function readOp(r: Reading, n: number, raw: JsonValue): OpRead {
  const given = isRecord(raw) ? (raw as JsonObject) : null;
  const op = typeof given?.op === "string" ? given.op.trim() : undefined;
  if (given === null || op === undefined || (op !== OVERLAY && !BY_NAME.has(op))) {
    return { n, fatal: [{ line: "unknown_op", fields: { n, value: JSON.stringify(given?.op ?? null), choices: textOf(STORY_OPERATIONS) } }], unread: [], ignored: [] };
  }
  const reads = new Set(["op", ...takesOf(op).reads, ...PROVENANCE_KEYS]);
  const out: OpRead = { n, op, fatal: [], unread: [], ignored: Object.keys(given).filter((k) => !reads.has(k) && given[k] !== undefined && given[k] !== null) };
  if (op === OVERLAY) {
    // Words are always read, so an overlay is unreadable only for what it lacks.
    const entry = readArg(r, n, op, "entry", "text", given.entry) as string | undefined;
    const note = readArg(r, n, op, "text", "text", given.text) as string | undefined;
    const missing = [entry === undefined ? "entry" : null, note === undefined ? "text" : null].filter((f): f is string => f !== null);
    if (entry === undefined || note === undefined) out.fatal.push({ line: "needs", fields: { n, op, fields: missing } });
    else {
      const prov = provenanceFor(r, n, op, given, out);
      out.read = { n, op, entry, note, ...(prov !== undefined ? { prov } : {}) };
    }
    return out;
  }
  const def = BY_NAME.get(op) as OpDef;
  const value: JsonObject = {};
  for (const [field, kind] of Object.entries(def.args)) {
    const got = readArg(r, n, op, field, kind, given[field]);
    if (isUnread(got)) out.unread.push(got);
    // A stretch is kept as its first and last message; a beat's first is the message it came from, as a carried beat's is.
    else if (got !== undefined) value[field === "from" ? (def.part === "beat" ? "message" : "first") : field === "to" ? "last" : field] = got;
    // His correction can leave words, a time or a list of names empty: the field is set to nothing, as he sent it.
    else if (r.blanking === true && isBlank(given[field]) && (kind === "text" || kind === "due" || kind === "names")) value[field] = kind === "names" ? [] : "";
  }
  const found = findItem(r, def, n, given, value);
  if (isUnread(found)) {
    out.fatal.push(found);
    return out;
  }
  const reports: Unread[] = [];
  // A place named by words is tied to the place's ref, the words kept beside it; words that name none stay words, and the answer says so.
  if (value.place === "" && r.blanking === true && PLACED[def.part] === true) value.place_ref = null;
  else if (typeof value.place === "string" && PLACED[def.part] === true) {
    const ref = r.placeRef(value.place);
    if (typeof ref === "string") value.place_ref = ref;
    else if (ref === null) reports.push({ line: "place_unresolved", fields: { n, op, place: value.place } });
  }
  // The quests a beat moved are tied to their refs, the words kept beside them; words that name none stay words, and the answer says so.
  if (Array.isArray(value.quests) && value.quests.length === 0 && r.blanking === true && def.part === "beat") value.quest_refs = [];
  else if (Array.isArray(value.quests) && def.part === "beat" && r.questRef !== undefined) {
    const refs: string[] = [];
    for (const words of value.quests as string[]) {
      const ref = r.questRef(words);
      if (ref === null) reports.push({ line: "quest_unresolved", fields: { n, op, quest: words } });
      else if (!refs.includes(ref)) refs.push(ref);
    }
    if (refs.length > 0) value.quest_refs = refs;
  }
  const before = r.record.items.get(found.item);
  if (value.close === true && before !== undefined && before.closedBy !== null) reports.push({ line: "already_closed", fields: { n, op, id: found.item } });
  // Said with both times; on a clock play has not set, which shows no date, said with neither: the future is due all the same.
  if (typeof value.due === "number" && r.clock !== null && value.due <= r.clock.now) {
    const [due, now] = [r.clock.text(value.due), r.clock.text(r.clock.now)];
    reports.push(due !== null && now !== null ? { line: "due_now", fields: { n, op, due, now } } : { line: "due_now_undated", fields: { n, op } });
  }
  if (typeof value.due === "string") reports.push({ line: r.clock === null ? "no_clock" : "unreadable_time", fields: { n, op, field: "due", value: JSON.stringify(value.due) } });
  r.record.apply({ part: def.part, item: found.item, value, turn: r.turn ?? "" });
  const prov = provenanceFor(r, n, op, given, out, def.part === "future" && typeof value.standing === "string" ? (value.standing as Standing) : undefined);
  out.read = { n, op, part: def.part, item: found.item, fresh: found.fresh, value, reports, ...(prov !== undefined ? { prov } : {}) };
  return out;
}

/** What a page's correction of an item is read against: the record as it stands, story time, the answers' lines and the world's places. */
export type CorrectionReading = Omit<Reading, "turn" | "near">;

/** A correction of an item as read: what it writes, and the lines that say what was not read or did not add up. */
export interface CorrectionRead {
  value: JsonObject;
  said: string[];
}

/**
 * Reads the fields a page sends to correct an item as `story_record` reads the same fields of an operation on that part (messages by
 * number or id, a time, one of a list, names), against the item named. What cannot be read is left out and said; nothing readable
 * is refused in the line that says so. The item's record of a turn is read as that turn's.
 */
export function readCorrection(r: CorrectionReading, item: StoryItem, fields: JsonObject): CorrectionRead | { refused: Unread } {
  const reading: Reading = { ...r, turn: item.part === "record" ? item.opened : null, blanking: true, near: (said, part) => nearIds(r.lines, STORY_DEFAULTS, r.record, said, part) };
  // What names the item is the item's own, whatever the page sent: an arc is found by who it is about.
  const given: JsonObject = { ...fields, op: item.part, id: item.id, ...(item.part === "arc" ? { who: item.fields.who ?? "" } : {}) };
  const out = readOp(reading, 1, given);
  const fatal = out.fatal[0];
  if (fatal !== undefined) return { refused: fatal };
  const planned = out.read as Planned;
  const taken = takesOf(item.part).reads.filter((f) => f !== "id" && f !== "new");
  if (Object.keys(planned.value).length === 0) return { refused: { line: "correction_empty", fields: { id: item.id, fields: taken.join(", ") } } };
  const said = [...out.unread, ...planned.reports].map((u) => r.lines.line(u.line, u.fields) ?? "");
  // The id names the item for every part, though not every operation reads one.
  const ignored = out.ignored.filter((k) => k !== "id");
  if (ignored.length > 0) said.push(r.lines.line("correction_ignored", { id: item.id, fields: ignored.join(", ") }) ?? "");
  return { value: planned.value, said: said.filter((s) => s !== "") };
}

/** Raised inside the write when the lore lane does not know an entry: the write is undone and the answer says so. */
class OverlayRefused extends Error {
  constructor(
    readonly n: number,
    readonly entry: string,
    readonly near: readonly string[],
  ) {
    super(`no lore entry ${entry}`);
  }
}

async function recordOperations(args: JsonObject, call: StoryCall): Promise<Reply> {
  const reply = call.reply();
  const list = args.operations;
  if (!Array.isArray(list) || list.length === 0) return reply.line("no_operations", {}).fail();
  const turn = call.scope.turn ?? null;
  const record = recordOr(call, reply);
  if (record === null) return reply;
  const { store, writes } = call.deps;
  let view: TreeView | undefined;
  const reading: Reading = {
    record,
    clock: storyClock(store, call.scope.user, call.scope.chat, turn),
    turn,
    lines: call.lines,
    agent: call.agent,
    placeRef: (words) => placeRefOf((view ??= treeOf(call)), words),
    questRef: (words) => questRefOf((view ??= treeOf(call)).world.tracks, record.quests, words),
    near: (said, part) => nearIds(call.lines, call.settings, record, said, part),
  };
  const ops = list.map((raw, i) => readOp(reading, i + 1, raw));
  if (ops.some((o) => o.fatal.length > 0)) {
    // Every operation's trouble is said, each with what that kind of operation reads, so the call can be sent again put right in one go.
    for (const o of ops) {
      for (const u of [...o.fatal, ...o.unread]) reply.line(u.line, u.fields);
      if (o.op === undefined || o.fatal.length + o.unread.length + o.ignored.length === 0) continue;
      const { reads, needs, newNeeds } = takesOf(o.op);
      reply.line("op_takes", { op: o.op, reads: textOf(reads), needs: textOf(needs), new_needs: textOf(newNeeds), ignored: textOf(o.ignored) });
    }
    // An operation the tool does not have is answered with every operation and what each reads, so the call can be sent again with the one that records what was meant.
    if (ops.some((o) => o.fatal.some((u) => u.line === "unknown_op"))) {
      for (const name of STORY_OPERATIONS) {
        const { reads, needs, newNeeds } = takesOf(name);
        reply.line("op_takes", { op: name, reads: textOf(reads), needs: textOf(needs), new_needs: textOf(newNeeds), ignored: "" });
      }
    }
    return reply.line("nothing_recorded", {}).fail();
  }
  const read = ops.flatMap((o) => (o.read === undefined ? [] : [o.read]));

  const writer = { user: call.scope.user, chat: call.scope.chat, turn, by: call.agent.definition, agent: call.agent.id, job: call.agent.job ?? null };
  const overlay = call.deps.overlay;
  let recorded: StoryRecorded[];
  try {
    recorded = await writes.run((db) => {
      // The lore lane's word on every overlay's entry comes first: one it does not know refuses the call whole, and nothing is recorded; one it knows by another id is kept under that id.
      for (const r of read) {
        if (r.op !== OVERLAY) continue;
        const o = r as PlannedOverlay;
        const out = overlay(db, { user: call.scope.user, chat: call.scope.chat, turn, entry: o.entry });
        if (out !== null && "unknown" in out) throw new OverlayRefused(o.n, out.unknown, out.near ?? []);
        if (out !== null) o.entry = out.as;
      }
      // A new item's stand-in id, as later operations of the call named it, becomes the id its first write is given.
      const made = new Set<string>();
      const list = read.map((r): StoryWrite | StoryOverlayWrite => {
        if (r.op === OVERLAY) return { entry: (r as PlannedOverlay).entry, note: (r as PlannedOverlay).note, ...stampOn((r as PlannedOverlay).prov) };
        const p = r as Planned;
        if (!p.fresh || made.has(p.item)) return { part: p.part, item: p.item, value: p.value, ...stampOn(p.prov) };
        made.add(p.item);
        return { part: p.part, item: null, stand: p.item, value: p.value, ...stampOn(p.prov) };
      });
      // One write of the store: the call's changes stand or fall together.
      return recordStory(store, writer, list);
    }, call.tool);
  } catch (error) {
    if (!(error instanceof OverlayRefused)) throw error;
    reply.line("overlay_unknown", { n: error.n, entry: error.entry, near: textOf(error.near) });
    return reply.line("nothing_recorded", {}).fail();
  }
  const written = new Map(read.map((r, i) => [r.n, recorded[i]] as const));

  // How each item now stands, read again as the turn sees it.
  const after = recordOr(call, reply);
  if (after === null) return reply;
  const spans = allSpans(after);
  const operations: JsonObject[] = [];
  for (const o of ops) {
    // What an operation was recorded without is said once, with what it reads.
    for (const u of o.unread) reply.report(u.line, u.fields);
    const left = [...o.ignored, ...o.unread.map((u) => String(u.fields.field))];
    if (o.op !== undefined && left.length > 0) reply.report("not_read", { n: o.n, op: o.op, left: textOf(left), reads: textOf(takesOf(o.op).reads) });
    const r = o.read;
    if (r === undefined) continue;
    provenanceLines(reply, r.n, r.op, r.prov);
    if (r.op === OVERLAY) {
      const ov = r as PlannedOverlay;
      const done = written.get(ov.n);
      operations.push({ n: ov.n, op: ov.op, entry: ov.entry, wrote: { text: ov.note }, ...(ov.prov !== undefined ? provenanceData(ov.prov) : {}), ...(done !== undefined ? { written: { overlay: done.change, entry: ov.entry, note: ov.note } } : { recorded: false }) });
      continue;
    }
    const p = r as Planned;
    const row = written.get(p.n);
    const item = row?.item == null ? undefined : after.items.get(row.item);
    for (const report of p.reports) reply.report(report.line, report.fields);
    operations.push({ n: p.n, op: p.op, id: row?.item ?? null, wrote: valueView(after, p.value, reading.clock), ...(p.prov !== undefined ? provenanceData(p.prov) : {}), now: item === undefined ? null : itemView(after, item, reading.clock, spans) });
  }
  return reply.data({ operations });
}

export const STORY_RECORD: StoryToolSpec = {
  name: "story_record",
  family: "story",
  tier: "write",
  lane: STORY_LANE,
  // Nothing the code reads is held back by the schema: a call it cannot read is answered in the answers' words, with what would work.
  properties: { operations: { type: "array", items: { type: "object", properties: RECORD_PROPERTIES } } },
  required: [],
  example: {
    operations: [
      { op: "beat", text: "Bram slides the sealed letter across the bar.", who: ["Bram", "Wren"] },
      { op: "thread", id: "th-4", state: "Wren has the letter; the seal is unbroken.", hot: true },
      { op: "scene", tension: "Bram keeps glancing at the door." },
      { op: "record", intent: "An action: Wren takes the letter.", decided: "Bram gives it, uneasy.", why: "He is frightened of the sender." },
    ],
  },
  run: recordOperations,
};
