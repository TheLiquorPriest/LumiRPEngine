// `story_query` (plan §8.1, §6.8): any part of the story record as it stands on the call's path, by
// id, by a range of messages, by who is involved, by what is open, due or held hot, with each item's
// history when asked. It reads only. It picks by the record's own marks, names and positions, never by
// what an item says, and answers in the record's order.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { oneOf, type Reply, TEXT, WHOLE, YES_NO } from "../iface/kit";
import { allSpans, itemView, namesOf, recordOr, type StoryCall, storyClock, type StoryToolSpec } from "./kit";
import { nameKey, STORY_PARTS, type Span, type StoryItem, type StoryPart, type StoryRecord } from "./record";

const QUERY_PROPERTIES: Record<string, JsonObject> = {
  part: oneOf(STORY_PARTS),
  id: TEXT,
  from: WHOLE,
  to: WHOLE,
  who: TEXT,
  open: YES_NO,
  due: YES_NO,
  hot: YES_NO,
  history: YES_NO,
};

/** The parts an item of which can be closed, and so be open. */
const CLOSABLE: Readonly<Partial<Record<StoryPart, true>>> = { chapter: true, scene: true, thread: true, future: true };

/** The messages an item lies in, a turn whose reply is not saved yet counting as after the last message: a beat's own, a scene's or chapter's span, the message a write names, else those of the turns that wrote it. */
function placeOf(record: StoryRecord, item: StoryItem, spans: ReadonlyMap<string, Span>): [number, number] {
  const after = record.at.messages.length;
  const span = spans.get(item.id);
  if (span !== undefined) return [span.from ?? after, span.to ?? after];
  if (item.part === "beat") {
    const at = record.beatAt(item) ?? after;
    return [at, at];
  }
  if (item.fields.message !== undefined) {
    const at = record.numberOf(item.fields.message) ?? after;
    return [at, at];
  }
  const touched = item.rows.map((r) => record.at.replyOf(r.turn) ?? after);
  return [Math.min(...touched), Math.max(...touched)];
}

async function query(args: JsonObject, call: StoryCall): Promise<Reply> {
  const reply = call.reply();
  const unreadable = (field: string, value: JsonValue | undefined, choices: readonly JsonValue[] = []): Reply => reply.line("unreadable", { field, value: JSON.stringify(value), choices }).fail();
  const part = args.part;
  if (part !== undefined && !(STORY_PARTS as readonly JsonValue[]).includes(part)) return unreadable("part", part, STORY_PARTS);
  for (const field of ["from", "to"]) if (args[field] !== undefined && !(typeof args[field] === "number" && Number.isInteger(args[field]))) return unreadable(field, args[field]);
  for (const field of ["open", "due", "hot", "history"]) if (args[field] !== undefined && typeof args[field] !== "boolean") return unreadable(field, args[field], [true, false]);
  if (args.who !== undefined && typeof args.who !== "string") return unreadable("who", args.who);
  if (args.id !== undefined && typeof args.id !== "string") return unreadable("id", args.id);

  const record = recordOr(call, reply);
  if (record === null) return reply;
  const clock = storyClock(call.deps.store, call.scope.user, call.scope.chat, call.scope.turn ?? null);
  const spans = allSpans(record);
  const history = args.history === true;

  if (typeof args.id === "string") {
    const item = record.items.get(args.id.trim());
    if (item === undefined) return reply.line("unknown_id", { id: JSON.stringify(args.id) }).fail();
    return reply.data({ [item.part]: [itemView(record, item, clock, spans, history)] });
  }
  if (args.due === true && clock === null) reply.line("no_clock_due", {});

  const from = typeof args.from === "number" ? args.from : 0;
  const to = typeof args.to === "number" ? args.to : Number.POSITIVE_INFINITY;
  const who = typeof args.who === "string" ? nameKey(args.who) : null;
  const matches: StoryItem[] = [];
  for (const p of part === undefined ? STORY_PARTS : [part as StoryPart]) {
    for (const item of record.of(p)) {
      if (args.open === true && (CLOSABLE[item.part] !== true || item.closedBy !== null)) continue;
      if (args.hot === true && !(item.part === "thread" && item.fields.hot === true)) continue;
      if (args.due === true) {
        const due = item.fields.due;
        if (item.part !== "future" || item.closedBy !== null || clock === null || typeof due !== "number" || due > clock.now) continue;
      }
      if (who !== null && !namesOf(item).some((n) => nameKey(n) === who)) continue;
      const [start, end] = placeOf(record, item, spans);
      if (end < from || start > to) continue;
      matches.push(item);
    }
  }
  if (matches.length === 0) return reply.line("none", {});
  const shown = matches.slice(0, call.settings.queryItems);
  const data: JsonObject = {};
  for (const item of shown) {
    const list = (data[item.part] ??= []) as JsonValue[];
    list.push(itemView(record, item, clock, spans, history));
  }
  if (args.due === true && clock !== null) data.now = clock.text(clock.now);
  reply.data(data);
  const rest = matches.slice(shown.length);
  if (rest.length > 0) reply.line("more", { count: rest.length, next: rest[0]?.id ?? "" });
  return reply;
}

export const STORY_QUERY: StoryToolSpec = {
  name: "story_query",
  family: "story",
  tier: "read",
  properties: QUERY_PROPERTIES,
  required: [],
  example: { part: "thread", open: true, who: "Bram" },
  run: query,
};
