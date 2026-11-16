// `cast_query` (plan §7.1, §6.8): a character's record as it stands on the call's path, part by part,
// or with no character named, who is in the cast there and as what. Sources are read live, each
// marked when the base is older than it. It reads only. It picks by the record's own marks, names and
// words, never by what an entry means, and answers in the record's order.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { oneOf, type Reply, TEXT, WHOLE, YES_NO } from "../iface/kit";
import { baseView, type CastCall, type CastReading, type CastToolSpec, itemView, readingOr, sourceView, whoView } from "./kit";
import { perceptionView } from "./perceive";
import { baseHistory, baseOf, bindingsOf, type CastItem, castingInForce, castingItemId, castOn, charactersOf, findCharacter, nameKey, type RowPart } from "./record";
import { sourcesNow } from "./sources";

/** The parts a query can ask for, as the record's table names them. */
export const QUERY_PARTS = ["sources", "base", "casting", "growth", "mind", "relationships", "knowledge", "history", "perceptions", "away"] as const;
type QueryPart = (typeof QUERY_PARTS)[number];

/** The parts kept as rows, by the name a query gives them. */
const ROWS: Readonly<Partial<Record<QueryPart, RowPart>>> = { growth: "growth", mind: "mind", relationships: "relationship", knowledge: "knowledge", history: "history", perceptions: "perception", away: "away" };

const QUERY_PROPERTIES: Record<string, JsonObject> = {
  who: TEXT,
  part: oneOf(QUERY_PARTS),
  with: TEXT,
  words: TEXT,
  history: YES_NO,
  skip: WHOLE,
};

/** Whether every one of `words` is in what an entry says, case ignored. */
function says(item: CastItem, words: readonly string[]): boolean {
  const text = Object.values(item.fields)
    .flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []))
    .join("\n")
    .toLowerCase();
  return words.every((w) => text.includes(w));
}

/** Who is in the cast on this path, and as what. */
function castList(call: CastCall, reading: CastReading, reply: Reply): Reply {
  const members = castOn(reading.record, charactersOf(call.deps.store.db, call.scope.user, reading.chats));
  if (members.length === 0) return reply.line("no_cast", {});
  return reply.data({ cast: members.map((m) => ({ ...whoView(m.character), casting: m.as, ...(m.pinned ? { pinned: true } : {}), ...(m.line !== null ? { line: m.line } : {}) })) });
}

async function query(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  const unreadable = (field: string, value: JsonValue | undefined, choices: readonly JsonValue[] = []): Reply => reply.line("unreadable", { field, value: JSON.stringify(value), choices }).fail();
  const part = args.part;
  if (part !== undefined && !(QUERY_PARTS as readonly JsonValue[]).includes(part)) return unreadable("part", part, QUERY_PARTS);
  for (const field of ["who", "with", "words"]) if (args[field] !== undefined && typeof args[field] !== "string") return unreadable(field, args[field]);
  if (args.history !== undefined && typeof args.history !== "boolean") return unreadable("history", args.history, [true, false]);
  if (args.skip !== undefined && !(typeof args.skip === "number" && Number.isInteger(args.skip) && args.skip >= 0)) return unreadable("skip", args.skip);

  const reading = readingOr(call, reply);
  if (reading === null) return reply;
  if (typeof args.who !== "string" || args.who.trim() === "") return castList(call, reading, reply);
  const { db } = call.deps.store;
  const user = call.scope.user;
  const character = findCharacter(db, user, reading.chats, args.who);
  if (character === null) return reply.line("no_character", { who: args.who.trim() }).fail();

  const history = args.history === true;
  const casting = castingInForce(reading.record, character);
  const castingNow: JsonObject | null = casting === null ? null : { as: casting.as, ...(casting.pinned ? { pinned: true } : {}), ...(casting.line !== null ? { line: casting.line } : {}) };
  const data: JsonObject = { character: { ...whoView(character), casting: castingNow } };
  if (casting === null) reply.line("not_cast", { who: character.name });
  const parts = part === undefined ? QUERY_PARTS : [part as QueryPart];

  if (parts.includes("sources") || parts.includes("base")) {
    const base = baseOf(db, user, character.id);
    const states = await sourcesNow(call.deps.sources, { user, chat: call.scope.chat }, bindingsOf(db, user, character.id), base.values());
    if (parts.includes("sources")) data.sources = states.map(sourceView);
    if (parts.includes("base")) {
      const older = states.filter((s) => s.newer);
      data.base = { ...baseView(base, history ? baseHistory(db, user, character.id) : null), ...(older.length > 0 ? { older_than: older.map(sourceView) } : {}) };
    }
  }
  if (parts.includes("casting") && history) {
    const item = reading.record.items.get(castingItemId(character.id));
    if (item !== undefined) data.casting = itemView(reading, item, true);
  }

  const words = typeof args.words === "string" ? args.words.toLowerCase().split(/\s+/).filter((w) => w !== "") : [];
  const toward = typeof args.with === "string" ? nameKey(args.with) : null;
  const skip = typeof args.skip === "number" ? args.skip : 0;
  const more: { count: number; part: string; skip: number }[] = [];
  for (const name of parts) {
    const rowPart = ROWS[name];
    if (rowPart === undefined) continue;
    const matches = reading.record
      .of(character.id, rowPart, history)
      .filter((item) => (toward === null || rowPart !== "relationship" || nameKey(String(item.fields.with ?? "")) === toward) && says(item, words));
    const shown = matches.slice(skip, skip + call.settings.queryItems);
    data[name] = shown.map((item) => (rowPart === "perception" ? { ...perceptionView(reading, item), ...(history ? { history: itemView(reading, item, true).history ?? [] } : {}) } : itemView(reading, item, history)));
    const rest = matches.length - skip - shown.length;
    if (rest > 0) more.push({ count: rest, part: name, skip: skip + shown.length });
  }
  reply.data(data);
  for (const m of more) reply.line("more", m);
  return reply;
}

export const CAST_QUERY: CastToolSpec = {
  name: "cast_query",
  family: "cast",
  tier: "read",
  properties: QUERY_PROPERTIES,
  required: [],
  example: { who: "Bram", part: "relationships", with: "Wren" },
  run: query,
};
