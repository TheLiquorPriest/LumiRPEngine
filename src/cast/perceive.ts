// `perceive` (plan §7.3, §9.6): what reached a character of a moment of a turn, as the omniscient
// side writes it. Who writes perceptions, for whom and when is the perceptions rule's to say; code
// records them. Each carries the fields of §7.3: how much reached them, what reached their senses,
// what they missed, what they now know, its source (first hand, or who told them and how reliably),
// and the moment it belongs to. It is a row of the turn that wrote it and names the turn it is of
// (this one, or an earlier reply on the path), so who has none for a turn can be counted. Each
// statement of what they now know is a row of their knowledge, tied to the perception; a secret
// named by its id is held the way today's build holds it (`secrets.ts`), on the same turn.
//
// The whole call is read first: anything it cannot read answers the call, and nothing is written.
// The user's setting for the story lane is held by the harness's gate before the call runs.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { oneOf, type Reply, TEXT, TEXTS, WHOLE, YES_NO } from "../iface/kit";
import type { ReadContext } from "../engine/registry";
import type { LedgerEvent } from "../shared/ledger";
import type { FactId } from "../shared/minds";
import { type CastCall, type CastReading, type CastToolSpec, readingOr, whoView } from "./kit";
import { type CastItem, type CastWrite, findCharacter, writeCast } from "./record";
import { holdingChanges, holdingEvents, type PersonFound, personNamed, secretFact, worldAt } from "./secrets";
import { CAST_LANE, isUnread, type Kind, readArg, type Unread } from "./update";

/** How much of a moment reached a character (§7.3): all of it, part of it, told of it by someone, or nothing. */
export const REACHES = ["whole", "part", "told", "none"] as const;

/** Each perception's arguments, each read as its kind. */
const ARGS: Readonly<Record<string, Kind>> = {
  id: "text",
  who: "text",
  message: "whole",
  moment: "text",
  reach: REACHES,
  content: "text",
  missed: "text",
  knows: "texts",
  secrets: "texts",
  told_by: "text",
  reliability: "text",
  drop: "flag",
  why: "text",
};

const PROPERTIES: Record<string, JsonObject> = {
  id: TEXT,
  who: TEXT,
  message: WHOLE,
  moment: TEXT,
  reach: oneOf(REACHES),
  content: TEXT,
  missed: TEXT,
  knows: TEXTS,
  secrets: TEXTS,
  told_by: TEXT,
  reliability: TEXT,
  drop: YES_NO,
  why: TEXT,
};

/** What an answer's lines call one item of the call. */
const OP = "perception";

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

/** The turn a perception is of: the `of` it was written with. */
export function perceivedTurn(item: CastItem): string {
  return typeof item.fields.of === "string" ? item.fields.of : item.opened;
}

/** A perception as answers and views show it: its fields, with the reply it is of by its number on the path (null: this turn's, not saved yet) in place of the turn's id. */
export function perceptionView(reading: Pick<CastReading, "record">, item: CastItem): JsonObject {
  const { of: _of, ...fields } = item.fields;
  return { id: item.id, ...fields, message: reading.record.at.replyOf(perceivedTurn(item)), ...(item.dropped ? { dropped: true } : {}) };
}

/** Someone in the world a perception's secret names, or what cannot be read about them. */
function oneIn(found: PersonFound, n: number, who: string, none: string): string | Unread {
  if ("id" in found) return found.id;
  if ("none" in found) return { line: none, fields: { n, op: OP, who } };
  return { line: "many_named", fields: { n, op: OP, who, count: found.many.length, ids: found.many } };
}

/** One perception read; what cannot be read when it cannot be. */
function readPerception(call: CastCall, cast: CastReading, world: () => ReadContext | null, n: number, raw: JsonValue): Planned | Unread[] {
  const given = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : null;
  if (given === null) return [{ line: "unreadable_op", fields: { n, op: OP, field: OP, value: JSON.stringify(raw), choices: [] } }];
  const bad: Unread[] = [];
  const value: JsonObject = {};
  for (const [field, kind] of Object.entries(ARGS)) {
    const got = readArg(n, OP, field, kind, given[field]);
    if (isUnread(got)) bad.push(got);
    else if (got !== undefined) value[field] = got;
  }
  if (bad.length > 0) return bad;
  const { id, who, message, knows, secrets, ...fields } = value;
  if (typeof who !== "string") return [{ line: "needs", fields: { n, op: OP, fields: ["who"] } }];
  const { db } = call.deps.store;
  const character = findCharacter(db, call.scope.user, cast.chats, who);
  if (character === null) return [{ line: "not_in_cast", fields: { n, who } }];

  let item: CastItem | null = null;
  if (id !== undefined) {
    const found = cast.record.items.get(id as string);
    if (found === undefined || found.part !== "perception" || found.character !== character.id) return [{ line: "unknown_id", fields: { n, op: OP, who: character.name, part: OP, id: JSON.stringify(id) } }];
    if (Object.keys(fields).length === 0 && message === undefined && knows === undefined && secrets === undefined) {
      return [{ line: "needs_one", fields: { n, op: OP, fields: Object.keys(ARGS).filter((f) => f !== "id" && f !== "who") } }];
    }
    item = found;
  } else if (fields.reach === undefined) return [{ line: "needs", fields: { n, op: OP, fields: ["reach"] } }];

  // The turn it is of: the reply named, else the one it was first written of, else this call's.
  const at = cast.record.at;
  let of: string | null = item === null ? (call.scope.turn ?? null) : perceivedTurn(item);
  if (message !== undefined) {
    of = at.turns.find((t) => at.replyOf(t) === message) ?? null;
    if (of === null) return [{ line: "no_message", fields: { n, op: OP, message } }];
  }

  const held: Planned["secrets"] = [];
  const said = (secrets as string[] | undefined) ?? [];
  if (said.length > 0) {
    const ctx = world();
    if (ctx === null) return [{ line: "no_world_secret", fields: { n, op: OP } }];
    const holder = oneIn(personNamed(ctx, character.name), n, character.name, "no_holder");
    const teller = typeof fields.told_by === "string" ? oneIn(personNamed(ctx, fields.told_by), n, fields.told_by, "no_teller") : null;
    if (isUnread(holder)) bad.push(holder);
    if (isUnread(teller)) bad.push(teller);
    const turnRow = of === null ? null : call.deps.store.user(call.scope.user).turn(of);
    for (const secret of said) {
      const fact = secretFact(secret);
      if (fact === null) {
        bad.push({ line: "not_secret", fields: { n, op: OP, value: secret } });
        continue;
      }
      if (isUnread(holder) || isUnread(teller)) continue;
      const since = { msg: turnRow?.message ?? null, at: turnRow?.storyTime ?? ctx.state.clock };
      const events = holdingEvents(ctx, { holder, fact, teller, since, confidence: call.settings.secretConfidence });
      if ("code" in events) bad.push({ line: events.code === "missing_fact" ? "unknown_secret" : "secret_refused", fields: { n, op: OP, who: character.name, secret, code: events.code } });
      else held.push({ fact, events });
    }
  }
  if (bad.length > 0) return bad;
  const row: JsonObject = { ...(item === null || message !== undefined ? { of } : {}), ...fields };
  if (knows !== undefined) row.knows = knows;
  if (held.length > 0) row.secrets = held.map((s) => s.fact);
  return { n, character: character.id, name: character.name, item: item?.id ?? null, value: row, knows: (knows as string[] | undefined) ?? [], secrets: held };
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
  const planned: Planned[] = [];
  const unread: Unread[] = [];
  for (const [i, raw] of list.entries()) {
    const got = readPerception(call, cast, world, i + 1, raw);
    if (Array.isArray(got)) unread.push(...got);
    else planned.push(got);
  }
  if (unread.length > 0) {
    for (const u of unread) reply.line(u.line, u.fields);
    return reply.line("nothing_recorded", {}).fail();
  }

  const user = call.scope.user;
  const writer = { user, turn, by: call.agent.definition, agent: call.agent.id, job: call.agent.job ?? null, at: cast.clock?.now ?? null, now: (call.deps.now ?? Date.now)() };
  const written = await call.deps.writes.run((db) => {
    const out: { perception: string; knowledge: string[] }[] = [];
    for (const p of planned) {
      const [row] = writeCast(db, writer, [{ character: p.character, part: "perception", item: p.item, value: p.value }]);
      const perception = row?.item ?? "";
      const source: JsonObject = { from: perception, ...(typeof p.value.told_by === "string" ? { told_by: p.value.told_by } : {}) };
      const knowledge: CastWrite[] = [
        ...p.knows.map((text): CastWrite => ({ character: p.character, part: "knowledge", item: null, value: { text, ...source } })),
        ...p.secrets.map((s): CastWrite => ({ character: p.character, part: "knowledge", item: null, value: { secret: s.fact, ...source } })),
      ];
      out.push({ perception, knowledge: writeCast(db, writer, knowledge).map((k) => k.item) });
    }
    const events = planned.flatMap((p) => p.secrets.flatMap((s) => s.events));
    if (events.length > 0) call.deps.store.user(user).addChanges(turn, holdingChanges(events, CAST_LANE, call.agent.id, call.agent.job ?? null));
    return out;
  }, call.tool);

  const after = readingOr(call, reply);
  if (after === null) return reply;
  return reply.data({
    perceptions: planned.map((p, i) => {
      const done = written[i];
      const item = done === undefined ? undefined : after.record.items.get(done.perception);
      return {
        n: p.n,
        who: whoView({ id: p.character, name: p.name }),
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
  properties: { perceptions: { type: "array", minItems: 1, items: { type: "object", properties: PROPERTIES, required: ["who"] } } },
  required: ["perceptions"],
  example: {
    perceptions: [
      { who: "Bram", moment: "Wren opens the letter", reach: "part", content: "From behind the bar: Wren breaks a seal and goes pale.", missed: "What the letter says.", knows: ["Wren had a sealed letter."] },
      { who: "Odile", moment: "Wren opens the letter", reach: "told", content: "Bram says Wren read a letter and went white.", told_by: "Bram", reliability: "He saw it himself.", secrets: ["wi:vale-book:e-7:0"] },
    ],
  },
  run: perceive,
};
