// `story_record` (plan §8.1, §6.8): the Author's understanding written as named operations, applied
// in order, one call writing many. The call is read whole first, against the record as it stands with
// each earlier operation of the call applied: anything it cannot read (an operation that is none of
// the list, an id the record does not hold, a message the chat does not have, a time that is not one)
// answers the whole call, and nothing is recorded. Then the user's setting for the story lane is asked
// through the contract's approvals, never decided here. What goes ahead is recorded in one queued
// write, the lore lane's overlays included, and the answer says what each operation wrote, how its
// item now stands, and what did not add up.

import type { ApprovalAsk, JsonObject, JsonValue } from "rp-harness/contract";
import { oneOf, type Reply, TEXT, TEXTS, WHOLE, YES_NO } from "../iface/kit";
import type { Fields } from "../iface/texts";
import { DRAFT_TIERS } from "../shared/ledger";
import { type Lane, STANDINGS } from "../store";
import { allSpans, itemView, recordOr, type StoryCall, type StoryClock, storyClock, type StoryToolSpec, valueView } from "./kit";
import { keyedItemId, type StoryPart, type StoryRecord, type StoryRow, writeStory } from "./record";

/** The lane every operation of the tool writes to. */
export const STORY_LANE: Lane = "story";

/** How an operation finds the item it writes: a new one or one named by id; a scene's or chapter's (new, named, or the current one); the one premise; a person's arc; this turn's record. */
type Finds = "new-or-id" | "span" | "premise" | "arc" | "record";

/** How an argument is read: words; names; true or false; a message by number; a tier; a story time; an item by id; one of a list. */
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

const OPS: readonly OpDef[] = [
  { name: "premise", part: "premise", finds: "premise", args: { text: "text", tone: "text", rules: "text", role: "text" } },
  { name: "chapter", part: "chapter", finds: "span", args: { title: "text", place: "text", time: "text", summary: "text", from: "message", to: "message", close: "flag", ...DROP } },
  {
    name: "scene",
    part: "scene",
    finds: "span",
    args: { title: "text", place: "text", time: "text", who: "names", purpose: "text", tension: "text", wants: "text", ends: "text", summary: "text", from: "message", to: "message", close: "flag", ...DROP },
  },
  { name: "beat", part: "beat", finds: "new-or-id", args: { text: "text", who: "names", place: "text", time: "text", message: "message", ...DROP }, needs: ["text"] },
  { name: "thread", part: "thread", finds: "new-or-id", args: { text: "text", kind: THREAD_KINDS, state: "text", stakes: "text", who: "names", payoff: "text", hot: "flag", close: "flag", ...DROP }, needs: ["text"] },
  { name: "arc", part: "arc", finds: "arc", args: { began: "text", stands: "text", next: "text", ...DROP } },
  { name: "player", part: "player", finds: "new-or-id", args: { text: "text", kind: PLAYER_KINDS, ...DROP }, needs: ["text"] },
  { name: "future", part: "future", finds: "new-or-id", args: { text: "text", tier: "tier", due: "due", standing: STANDINGS, who: "names", place: "text", close: "flag", ...DROP }, needs: ["text"] },
  { name: "canon", part: "canon", finds: "new-or-id", args: { text: "text", who: "names", message: "message", ...DROP }, needs: ["text"] },
  { name: "retcon", part: "retcon", finds: "new-or-id", args: { text: "text", why: "text", of: "item", drop: "flag" }, needs: ["text"] },
  { name: "record", part: "record", finds: "record", args: { intent: "text", decided: "text", why: "text", rulings: "text", consents: "text", next: "text" } },
];

/** The operation that writes no story item: it hands the lore lane's overlay its note. */
const OVERLAY = "overlay";

/** Every operation, in the order the tool's file lists them. */
export const STORY_OPERATIONS: readonly string[] = [...OPS.map((o) => o.name), OVERLAY];

const BY_NAME: ReadonlyMap<string, OpDef> = new Map(OPS.map((o) => [o.name, o]));

/** The arguments an operation may carry, each once, whichever operations read it: the file says what each is. */
export const RECORD_PROPERTIES: Record<string, JsonObject> = {
  op: oneOf(STORY_OPERATIONS),
  id: TEXT,
  new: YES_NO,
  text: TEXT,
  title: TEXT,
  summary: TEXT,
  who: TEXTS,
  place: TEXT,
  time: TEXT,
  message: WHOLE,
  from: WHOLE,
  to: WHOLE,
  purpose: TEXT,
  tension: TEXT,
  wants: TEXT,
  ends: TEXT,
  kind: oneOf([...THREAD_KINDS, ...PLAYER_KINDS]),
  state: TEXT,
  stakes: TEXT,
  payoff: TEXT,
  hot: YES_NO,
  began: TEXT,
  stands: TEXT,
  next: TEXT,
  tier: { type: "integer", enum: [...DRAFT_TIERS] },
  due: TEXT,
  standing: oneOf(STANDINGS),
  tone: TEXT,
  rules: TEXT,
  role: TEXT,
  of: TEXT,
  intent: TEXT,
  decided: TEXT,
  rulings: TEXT,
  consents: TEXT,
  entry: TEXT,
  close: YES_NO,
  drop: YES_NO,
  why: TEXT,
};

/** Something an operation says that cannot be read: the answers' line that says so, and its fields. */
interface Unread {
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
}

interface PlannedOverlay {
  n: number;
  op: typeof OVERLAY;
  entry: string;
  note: string;
}

type Read = Planned | PlannedOverlay;

/** What a call works with while it reads its operations. */
interface Reading {
  record: StoryRecord;
  clock: StoryClock | null;
  turn: string;
}

function isUnread(v: unknown): v is Unread {
  return typeof v === "object" && v !== null && "line" in v;
}

/** One argument read as its kind; undefined when it is not given. */
function readArg(r: Reading, n: number, op: string, field: string, kind: Kind, said: JsonValue | undefined): JsonValue | Unread | undefined {
  if (said === undefined || said === null) return undefined;
  const unreadable = (choices: readonly JsonValue[] = []): Unread => ({ line: "unreadable_op", fields: { n, op, field, value: JSON.stringify(said), choices } });
  if (Array.isArray(kind)) return typeof said === "string" && kind.includes(said) ? said : unreadable(kind);
  switch (kind) {
    case "text": {
      if (typeof said !== "string") return unreadable();
      return said.trim() === "" ? undefined : said.trim();
    }
    case "names": {
      const list = typeof said === "string" ? [said] : said;
      if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) return unreadable();
      const names = (list as string[]).map((x) => x.trim()).filter((x) => x !== "");
      return names.length === 0 ? undefined : names;
    }
    case "flag":
      return typeof said === "boolean" ? said : unreadable([true, false]);
    case "tier":
      return typeof said === "number" && (DRAFT_TIERS as readonly number[]).includes(said) ? said : unreadable([...DRAFT_TIERS]);
    case "message": {
      const message = typeof said === "number" && Number.isInteger(said) ? r.record.at.messages[said] : undefined;
      return message === undefined ? { line: "no_message", fields: { n, op, field, value: JSON.stringify(said), last: r.record.at.messages.length - 1 } } : message.message;
    }
    case "due": {
      if (r.clock === null) return { line: "no_clock", fields: { n, op, field } };
      const at = typeof said === "string" ? r.clock.read(said) : null;
      return at ?? { line: "unreadable_time", fields: { n, op, field, value: JSON.stringify(said) } };
    }
    case "item":
      return typeof said === "string" && r.record.items.has(said.trim()) ? said.trim() : { line: "unknown_id", fields: { n, op, id: JSON.stringify(said) } };
  }
  return unreadable();
}

/** The item an operation writes: one named by id, a new one, the current scene or chapter, or the one its key names. */
function findItem(r: Reading, def: OpDef, n: number, raw: JsonObject, value: JsonObject): { item: string; fresh: boolean } | Unread {
  const named = raw.id;
  const byId = (): { item: string; fresh: boolean } | Unread => {
    const id = typeof named === "string" ? named.trim() : "";
    return r.record.items.get(id)?.part === def.part ? { item: id, fresh: false } : { line: "unknown_id", fields: { n, op: def.name, part: def.part, id: JSON.stringify(named) } };
  };
  switch (def.finds) {
    case "new-or-id": {
      if (named !== undefined && named !== null) return byId();
      const missing = (def.needs ?? []).filter((f) => value[f] === undefined);
      return missing.length > 0 ? { line: "needs", fields: { n, op: def.name, fields: missing } } : { item: `new:${n}`, fresh: true };
    }
    case "span": {
      if (raw.new !== undefined && typeof raw.new !== "boolean") return { line: "unreadable_op", fields: { n, op: def.name, field: "new", value: JSON.stringify(raw.new), choices: [true, false] } };
      if (raw.new === true) return { item: `new:${n}`, fresh: true };
      if (named !== undefined && named !== null) return byId();
      const current = r.record.current(def.part as "scene" | "chapter");
      return current === null ? { line: "no_current", fields: { n, op: def.name, part: def.part } } : { item: current.id, fresh: false };
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
      if (Object.keys(value).length === 0) return { line: "needs_one", fields: { n, op: def.name, fields: Object.keys(def.args) } };
      return { item: def.finds === "premise" ? keyedItemId("premise", "") : keyedItemId("record", r.turn), fresh: false };
    }
  }
}

/** One operation read, and applied to the record the next one is read against. */
function readOp(r: Reading, n: number, raw: JsonValue): Read | Unread[] {
  const op = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw.op : undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || typeof op !== "string" || (op !== OVERLAY && !BY_NAME.has(op))) {
    return [{ line: "unknown_op", fields: { n, value: JSON.stringify(op ?? null), choices: STORY_OPERATIONS } }];
  }
  if (op === OVERLAY) {
    const entry = readArg(r, n, op, "entry", "text", raw.entry);
    const note = readArg(r, n, op, "text", "text", raw.text);
    const bad = [entry, note].filter(isUnread);
    if (bad.length > 0) return bad;
    const missing = [entry === undefined ? "entry" : null, note === undefined ? "text" : null].filter((f): f is string => f !== null);
    if (missing.length > 0) return [{ line: "needs", fields: { n, op, fields: missing } }];
    return { n, op, entry: entry as string, note: note as string };
  }
  const def = BY_NAME.get(op) as OpDef;
  const value: JsonObject = {};
  const bad: Unread[] = [];
  for (const [field, kind] of Object.entries(def.args)) {
    const got = readArg(r, n, op, field, kind, raw[field]);
    if (isUnread(got)) bad.push(got);
    else if (got !== undefined) value[field === "from" ? "first" : field === "to" ? "last" : field] = got;
  }
  if (bad.length > 0) return bad;
  const found = findItem(r, def, n, raw, value);
  if (isUnread(found)) return [found];
  const reports: Unread[] = [];
  const before = r.record.items.get(found.item);
  if (value.close === true && before !== undefined && before.closedBy !== null) reports.push({ line: "already_closed", fields: { n, op, id: found.item } });
  if (typeof value.due === "number" && r.clock !== null && value.due <= r.clock.now) reports.push({ line: "due_now", fields: { n, op, due: r.clock.text(value.due), now: r.clock.text(r.clock.now) } });
  r.record.apply({ id: 0, turn: r.turn, ord: n, part: def.part, item: found.item, value, by: null, agent: null, job: null, created: 0 });
  return { n, op, part: def.part, item: found.item, fresh: found.fresh, value, reports };
}

/** The user's word for the story lane: null to go ahead; else why the call's operations may not. */
async function approval(call: StoryCall, operations: JsonValue[]): Promise<"never" | { declined: string | undefined } | null> {
  const approvals = call.deps.approvals;
  if (approvals === undefined) return null;
  const permission = await approvals.permission(call.scope, STORY_LANE);
  if (permission === "auto") return null;
  if (permission === "never") return "never";
  const ask: ApprovalAsk = { agent: call.agent, callId: call.callId, tool: call.tool, lane: STORY_LANE, args: { operations }, at: (call.deps.now ?? Date.now)() };
  const said = await approvals.ask(call.scope, ask, call.signal);
  return said.go ? null : { declined: said.reason };
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
  const turn = call.scope.turn;
  if (turn === undefined) return reply.line("turn_needed", {}).fail();
  const record = recordOr(call, reply);
  if (record === null) return reply;
  const { store, writes } = call.deps;
  const reading: Reading = { record, clock: storyClock(store, call.scope.user, call.scope.chat, turn), turn };
  const read: Read[] = [];
  const unread: Unread[] = [];
  list.forEach((raw, i) => {
    const got = readOp(reading, i + 1, raw);
    if (Array.isArray(got)) unread.push(...got);
    else read.push(got);
  });
  if (unread.length > 0) {
    for (const u of unread) reply.line(u.line, u.fields);
    return reply.line("nothing_recorded", {}).fail();
  }

  const held = await approval(call, list);
  if (held !== null) {
    for (const r of read) {
      if (held === "never") reply.line("never", { n: r.n, op: r.op, lane: STORY_LANE });
      else reply.line("declined", { n: r.n, op: r.op, ...(held.declined !== undefined ? { reason: held.declined } : {}) });
    }
    return reply.data({ operations: read.map((r) => ({ n: r.n, op: r.op, recorded: false, held: held === "never" ? "never" : "declined" })) });
  }

  const writer = { user: call.scope.user, turn, by: call.agent.definition, agent: call.agent.id, job: call.agent.job ?? null, now: (call.deps.now ?? Date.now)() };
  const overlay = call.deps.overlay;
  let written: { rows: Map<number, StoryRow>; overlays: Map<number, JsonObject> };
  try {
    written = await writes.run((db) => {
      const rows = new Map<number, StoryRow>();
      const overlays = new Map<number, JsonObject>();
      // A new item's stand-in id, as later operations of the call named it, becomes the id it is given.
      const given = new Map<string, string>();
      for (const r of read) {
        if (r.op === OVERLAY) {
          const o = r as PlannedOverlay;
          if (overlay === undefined) continue;
          const out = overlay(db, { user: call.scope.user, chat: call.scope.chat, turn, entry: o.entry, note: o.note, by: call.agent.definition });
          if ("unknown" in out) throw new OverlayRefused(o.n, out.unknown, out.near ?? []);
          overlays.set(o.n, out.written);
          continue;
        }
        const p = r as Planned;
        const [row] = writeStory(db, writer, [{ part: p.part, item: p.fresh && !given.has(p.item) ? null : (given.get(p.item) ?? p.item), value: p.value }]);
        if (row === undefined) continue;
        if (p.fresh) given.set(p.item, row.item);
        rows.set(p.n, row);
      }
      return { rows, overlays };
    }, call.tool);
  } catch (error) {
    if (!(error instanceof OverlayRefused)) throw error;
    reply.line("overlay_unknown", { n: error.n, entry: error.entry, near: [...error.near] });
    return reply.line("nothing_recorded", {}).fail();
  }

  // How each item now stands, read again as the turn sees it.
  const after = recordOr(call, reply);
  if (after === null) return reply;
  const spans = allSpans(after);
  const operations: JsonObject[] = [];
  for (const r of read) {
    if (r.op === OVERLAY) {
      const o = r as PlannedOverlay;
      const done = written.overlays.get(o.n);
      if (done === undefined) reply.line("no_overlays", { n: o.n, op: o.op });
      operations.push({ n: o.n, op: o.op, entry: o.entry, wrote: { text: o.note }, ...(done !== undefined ? { written: done } : { recorded: false }) });
      continue;
    }
    const p = r as Planned;
    const row = written.rows.get(p.n);
    const item = row === undefined ? undefined : after.items.get(row.item);
    for (const report of p.reports) reply.report(report.line, report.fields);
    operations.push({ n: p.n, op: p.op, id: row?.item ?? null, wrote: valueView(after, p.value, reading.clock), now: item === undefined ? null : itemView(after, item, reading.clock, spans) });
  }
  return reply.data({ operations });
}

export const STORY_RECORD: StoryToolSpec = {
  name: "story_record",
  family: "story",
  tier: "write",
  lane: STORY_LANE,
  properties: { operations: { type: "array", minItems: 1, items: { type: "object", properties: RECORD_PROPERTIES, required: ["op"] } } },
  required: ["operations"],
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
