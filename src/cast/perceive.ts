// `perceive` (plan §7.3, §9.6): what reached a character of a moment of a turn, as the omniscient
// side writes it. Who writes perceptions, for whom and when is the perceptions rule's to say; code
// records them. Each carries the fields of §7.3: how much reached them, what reached their senses,
// what they missed, what they now know, its source (first hand, or who told them and how reliably),
// and the moment it belongs to. It is a row of the turn that wrote it and names the turn it is of
// (this one, or an earlier reply on the path), so who has none for a turn can be counted. Each
// statement of what they now know is a row of their knowledge, tied to the perception; a secret
// named by its id is held the way today's build holds it (`secrets.ts`), on the same turn.
//
// The whole call is read first, each perception in whatever shape its arguments were sent. What a
// perception does not read, or a value it cannot read (a reply the path does not have, a secret that
// cannot be held), is left out: the perception is written with the rest, and the answer names what
// was left out. A name the cast does not hold yet is made a character, not yet cast, and the answer
// says so. A perception that cannot be read at all answers the call, and nothing is written. The
// user's setting for the story lane is held by the harness's gate before the call runs.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { Reply } from "../iface/kit";
import type { ReadContext } from "../engine/registry";
import type { LedgerEvent } from "../shared/ledger";
import type { FactId } from "../shared/minds";
import { isRecord } from "../shared/json";
import { type CastCall, type CastReading, type CastToolSpec, readingOr, whoView } from "./kit";
import { type CastItem, type CastWrite, writeCast } from "./record";
import { holdingChanges, holdingEvents, type PersonFound, personNamed, secretFact, worldAt } from "./secrets";
import { CAST_LANE, characterNamed, ignoredOf, isUnread, type ItemRead, type Kind, leftOut, makeFresh, needed, readArg, type Reads, refused, type Unread } from "./update";

/** How much of a moment reached a character (§7.3): all of it, part of it, told of it by someone, or nothing. */
export const REACHES = ["whole", "part", "told", "none"] as const;

/** Each perception's arguments, each read as its kind. */
const ARGS: Readonly<Record<string, Kind>> = {
  id: "name",
  who: "name",
  message: "whole",
  moment: "text",
  reach: REACHES,
  content: "text",
  missed: "text",
  knows: "texts",
  secrets: "texts",
  told_by: "name",
  reliability: "text",
  drop: "flag",
  why: "text",
};

/** None holds back a value: the file says what each is, and this code reads each in whatever shape it comes. */
const PROPERTIES: Record<string, JsonObject> = Object.fromEntries(Object.keys(ARGS).map((name) => [name, {}]));

/** What an answer's lines call one item of the call. */
const OP = "perception";

/** What a perception reads, what every one needs, and what a new one needs. */
const READS: Reads = { reads: Object.keys(ARGS), needs: ["who"], newNeeds: ["reach"] };

/** A perception read, ready to write. */
interface Planned {
  n: number;
  character: string;
  name: string;
  /** The perception it rewrites, or null for a new one. */
  item: string | null;
  /** What the perception's row says. */
  value: JsonObject;
  /** Each statement of what they now know: a row of their knowledge. */
  knows: string[];
  /** Each secret they now hold, with the events that hold it (none when they hold it so already). */
  secrets: { fact: FactId; events: LedgerEvent[] }[];
}

/** One perception as read, and what it writes when it can be read. */
interface PerceptionRead extends ItemRead {
  planned?: Planned;
}

/** The turn a perception is of: the `of` it was written with. */
export function perceivedTurn(item: CastItem): string {
  return typeof item.fields.of === "string" ? item.fields.of : item.opened;
}

/** A perception as answers and views show it: its fields, with the reply it is of by its number on the path (null: this turn's, not saved yet) in place of the turn's id. */
export function perceptionView(reading: Pick<CastReading, "record">, item: CastItem): JsonObject {
  const { of: _of, ...fields } = item.fields;
  return { id: item.id, ...fields, message: reading.record.at.replyOf(perceivedTurn(item)), ...(item.dropped ? { dropped: true } : {}) };
}

/** Someone in the world a perception's secret names, or why a secret cannot be held by them. */
function oneIn(found: PersonFound, n: number, who: string, none: string): string | Unread {
  if ("id" in found) return found.id;
  if ("none" in found) return { line: none, fields: { n, op: OP, field: "secrets", who } };
  return { line: "many_named", fields: { n, op: OP, field: "secrets", who, count: found.many.length, ids: found.many } };
}

/** The secrets a perception names that its character can hold now; what keeps any of them from being held goes to `unread`. */
function secretsHeld(call: CastCall, world: () => ReadContext | null, n: number, name: string, tellerName: JsonValue | undefined, of: string | null, said: readonly string[], unread: Unread[]): Planned["secrets"] {
  const held: Planned["secrets"] = [];
  const ctx = world();
  if (ctx === null) {
    unread.push({ line: "no_world_secret", fields: { n, op: OP, field: "secrets" } });
    return held;
  }
  const holder = oneIn(personNamed(ctx, name), n, name, "no_holder");
  const teller = typeof tellerName === "string" ? oneIn(personNamed(ctx, tellerName), n, tellerName, "no_teller") : null;
  if (isUnread(holder)) unread.push(holder);
  if (isUnread(teller)) unread.push(teller);
  const turnRow = of === null ? null : call.deps.store.user(call.scope.user).turn(of);
  for (const secret of said) {
    const fact = secretFact(secret);
    if (fact === null) {
      unread.push({ line: "not_secret", fields: { n, op: OP, field: "secrets", value: secret } });
      continue;
    }
    if (isUnread(holder) || isUnread(teller)) continue;
    const since = { msg: turnRow?.message ?? null, at: turnRow?.storyTime ?? ctx.state.clock };
    const events = holdingEvents(ctx, { holder, fact, teller, since, confidence: call.settings.secretConfidence });
    if ("code" in events) unread.push({ line: events.code === "missing_fact" ? "unknown_secret" : "secret_refused", fields: { n, op: OP, field: "secrets", who: name, secret, code: events.code } });
    else held.push({ fact, events });
  }
  return held;
}

/** One perception read: what it writes, what of it could not be read, and what it does not read. A name the cast does not hold yet goes to `fresh`, made at the write. */
function readPerception(call: CastCall, cast: CastReading, world: () => ReadContext | null, fresh: Map<string, string>, n: number, raw: JsonValue): PerceptionRead {
  const given = isRecord(raw) ? (raw as JsonObject) : null;
  if (given === null) return { n, fatal: [{ line: "unreadable_op", fields: { n, op: OP, field: OP, value: JSON.stringify(raw) } }], unread: [], ignored: [] };
  const out: PerceptionRead = { n, op: OP, fatal: [], unread: [], ignored: ignoredOf(given, READS.reads) };
  const value: JsonObject = {};
  for (const [field, kind] of Object.entries(ARGS)) {
    const got = readArg(call.lines, n, OP, field, kind, given[field]);
    if (isUnread(got)) out.unread.push(got);
    else if (got !== undefined) value[field] = got;
  }
  const { id, who, message, knows, secrets, ...fields } = value;
  if (typeof who !== "string") return needed(out, ["who"]);
  const character = characterNamed(call, cast, fresh, who);

  let item: CastItem | null = null;
  if (id !== undefined) {
    const found = cast.record.items.get(id as string);
    if (found === undefined || found.part !== "perception" || found.character !== character.id) {
      out.fatal.push({ line: "unknown_id", fields: { n, op: OP, who: character.name, part: OP, id: JSON.stringify(id) } });
      return out;
    }
    if (Object.keys(fields).length === 0 && message === undefined && knows === undefined && secrets === undefined) {
      out.fatal.push({ line: "needs_one", fields: { n, op: OP, fields: Object.keys(ARGS).filter((f) => f !== "id" && f !== "who") } });
      return out;
    }
    item = found;
  } else if (fields.reach === undefined) return needed(out, ["reach"]);

  // The turn it is of: the reply named, else the one it was first written of, else this call's. A reply the path does not have is left out.
  const at = cast.record.at;
  let of: string | null = item === null ? (call.scope.turn ?? null) : perceivedTurn(item);
  const named = message === undefined ? undefined : at.turns.find((t) => at.replyOf(t) === message);
  if (named !== undefined) of = named;
  else if (message !== undefined) out.unread.push({ line: "no_message", fields: { n, op: OP, field: "message", message } });

  const said = (secrets as string[] | undefined) ?? [];
  const trouble: Unread[] = [];
  const held = said.length > 0 ? secretsHeld(call, world, n, character.name, fields.told_by, of, said, trouble) : [];
  // A secret that cannot be held is left out; while another is held, the perception still holds secrets.
  out.unread.push(...trouble.map((u) => (held.length > 0 ? { ...u, kept: true } : u)));
  const row: JsonObject = { ...(item === null || named !== undefined ? { of } : {}), ...fields };
  if (knows !== undefined) row.knows = knows;
  if (held.length > 0) row.secrets = held.map((s) => s.fact);
  out.planned = { n, character: character.id, name: character.name, item: item?.id ?? null, value: row, knows: (knows as string[] | undefined) ?? [], secrets: held };
  return out;
}

async function perceive(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  const list = args.perceptions;
  if (!Array.isArray(list) || list.length === 0) return reply.line("no_perceptions", {}).fail();
  const cast = readingOr(call, reply);
  if (cast === null) return reply;
  const turn = call.scope.turn;
  if (turn === undefined) return reply.line("perceive_turn", {}).fail();

  // The world as the state plays it in this turn, read once and only when a secret is named.
  let ctx: ReadContext | null | undefined;
  const world = (): ReadContext | null => (ctx === undefined ? (ctx = worldAt(call.deps.store, call.scope.user, turn)) : ctx);
  const fresh = new Map<string, string>();
  const reads = list.map((raw, i) => readPerception(call, cast, world, fresh, i + 1, raw));
  if (reads.some((x) => x.fatal.length > 0)) return refused(reply, reads, () => READS);
  const planned = reads.flatMap((x) => (x.planned === undefined ? [] : [x.planned]));

  const user = call.scope.user;
  const writer = { user, turn, by: call.agent.definition, agent: call.agent.id, job: call.agent.job ?? null, at: cast.clock?.now ?? null, now: (call.deps.now ?? Date.now)() };
  const written = await call.deps.writes.run((db) => {
    // Each character named that the cast did not hold is made first, not yet cast.
    const ids = makeFresh(db, call, fresh, writer.now);
    const out: { character: string; perception: string; knowledge: string[] }[] = [];
    for (const p of planned) {
      const character = ids.get(p.character) ?? p.character;
      const [row] = writeCast(db, writer, [{ character, part: "perception", item: p.item, value: p.value }]);
      const perception = row?.item ?? "";
      const source: JsonObject = { from: perception, ...(typeof p.value.told_by === "string" ? { told_by: p.value.told_by } : {}) };
      const knowledge: CastWrite[] = [
        ...p.knows.map((text): CastWrite => ({ character, part: "knowledge", item: null, value: { text, ...source } })),
        ...p.secrets.map((s): CastWrite => ({ character, part: "knowledge", item: null, value: { secret: s.fact, ...source } })),
      ];
      out.push({ character, perception, knowledge: writeCast(db, writer, knowledge).map((k) => k.item) });
    }
    const events = planned.flatMap((p) => p.secrets.flatMap((s) => s.events));
    if (events.length > 0) call.deps.store.user(user).addChanges(turn, holdingChanges(events, CAST_LANE, call.agent.id, call.agent.job ?? null));
    return out;
  }, call.tool);
  for (const name of fresh.values()) reply.line("added", { who: name });

  const after = readingOr(call, reply);
  if (after === null) return reply;
  for (const x of reads) leftOut(reply, x, READS.reads);
  return reply.data({
    perceptions: planned.map((p, i) => {
      const done = written[i];
      const item = done === undefined ? undefined : after.record.items.get(done.perception);
      return {
        n: p.n,
        who: whoView({ id: done?.character ?? p.character, name: p.name }),
        id: done?.perception ?? null,
        now: item === undefined ? null : perceptionView(after, item),
        knowledge: done?.knowledge ?? [],
        ...(p.secrets.length > 0 ? { holds: p.secrets.map((s) => s.fact) } : {}),
      };
    }),
  });
}

export const PERCEIVE: CastToolSpec = {
  name: "perceive",
  family: "cast",
  tier: "write",
  lane: CAST_LANE,
  // Nothing the code reads is held back by the schema: a call it cannot read is answered in the answers' words, with what would work.
  properties: { perceptions: { type: "array", items: { type: "object", properties: PROPERTIES } } },
  required: [],
  example: {
    perceptions: [
      { who: "Bram", moment: "Wren opens the letter", reach: "part", content: "From behind the bar: Wren breaks a seal and goes pale.", missed: "What the letter says.", knows: ["Wren had a sealed letter."] },
      { who: "Odile", moment: "Wren opens the letter", reach: "told", content: "Bram says Wren read a letter and went white.", told_by: "Bram", reliability: "He saw it himself.", secrets: ["wi:vale-book:e-7:0"] },
    ],
  },
  run: perceive,
};
