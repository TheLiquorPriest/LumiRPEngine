// The state route group's reads of a value's history and of what stopped applying (plan §4.4 l.309, §14 l.1551): the World page asks
// for the history of any value by turn (a field, a relation, a balance, a quest's stage, a fact's key, a world value, an area item's
// part), every change along the chat's path that wrote it, newest first, a page at a time; and for the changes that no longer apply on
// the swipes now showing. Both are read from the store alone. Every route is a page's: it answers only for the user this RPE belongs to.

import { route, RouteError, shape } from "../app";
import { isRecord } from "../shared/json";
import { JoinedTurnError, type UserStore } from "../store";
import { valueHistory } from "../store/history";
import type { Turns } from "./lane";

const T = shape.text();
const N = shape.number();
const opt = shape.optional;
const nullable = shape.nullable;

const valueChange = shape.named(
  "ValueChangeShown",
  "One change that wrote a value, as the World page lists a value's history: its id, the turn it is of or stands just before and that turn's number, when it was recorded, its lane and the area holding what it wrote, its operation and values, who made it, how exact, how sure and from where, its report codes, what it left there, whether it wrote the typed value or a fact beside it, and for a fact the turn of the later exact record that settled it.",
  shape.object({
    id: T,
    turn: T,
    n: N,
    at: N,
    lane: shape.oneOf("story", "engine"),
    area: T,
    op: T,
    words: T,
    values: shape.record(shape.json()),
    by: nullable(T),
    precision: nullable(shape.oneOf("exact", "approximate", "vague", "unknown")),
    standing: nullable(shape.oneOf("established", "proposed", "assumed")),
    source: nullable(shape.oneOf("prose", "lore", "author", "gm", "character", "player", "import", "default", "invented")),
    reports: shape.list(T),
    value: nullable(T),
    kind: shape.oneOf("value", "fact"),
    settledBy: nullable(T),
  }),
);

const valueHistoryReply = shape.named(
  "ValueHistoryReply",
  "The history of one value: the level and part asked for, a page of the changes that wrote it, newest first, and where the next page starts (null at the end).",
  shape.object({ at: T, part: T, items: shape.list(valueChange), next: nullable(T) }),
);

const notAppliedShown = shape.named(
  "NotAppliedShown",
  "A change that no longer applies on the swipes now showing: its id, its turn and that turn's number, its operation, and the codes of why.",
  shape.object({ change: T, turn: T, n: N, op: T, words: T, reason: T }),
);

const notAppliedReply = shape.named(
  "NotAppliedReply",
  "What no longer applies at the chat's head: the earlier reply that shows another swipe than its later turns were made on (null where none does), and each change that stopped applying.",
  shape.object({ reply: nullable(shape.object({ turn: T, n: N })), items: shape.list(notAppliedShown) }),
);

/** A value of the history as one line of text: a word as it is, anything else as JSON; null where the change took the value off. */
function said(v: unknown): string | null {
  return v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v);
}

export function stateRoutes(turns: Turns) {
  /** A chat RPE holds is there; any other is not (plan §6.1). A turn asked for is one of the chat's; a joined one is answered as a fact. */
  const held = (user: string, chat: string, turn?: string): UserStore => {
    const s = turns.store.user(user);
    if (s.chat(chat) === null) throw new RouteError(404, `RPE holds no chat ${chat} of yours.`);
    if (turn !== undefined) {
      const row = s.turn(turn);
      if (row === null || row.chat !== chat) throw new RouteError(404, `Chat ${chat} has no turn ${turn}.`);
      if (row.joined !== null) throw new JoinedTurnError(turn, row.joined);
    }
    return s;
  };

  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/state/history",
      access: "page",
      group: "state",
      does: "The history of one value by turn: every change along the chat's path, at its head or up to a turn, that wrote the part asked for of the level asked for (a field, a relation, a balance as `posted`, a quest's stage as `stage` of `track:<id>`, a fact's key, a world value, an area item's part), newest first, a page at a time; each with its turn, lane, who made it, its marks and reports, and for a fact the later exact record that settled it.",
      query: {
        at: shape.field(T, "The level, by its tree ref (`entity:<id>`, `place:<id>`, `world`, `track:<id>`, an area's own ref)."),
        part: shape.field(T, "The part of it: a field's or relation's name, `posted`, `stage`, a fact's key, a world value's key, an area item's part."),
        turn: opt(shape.turnId(), "Read the path up to this turn; the chat's head when left out."),
        limit: opt(shape.whole({ least: 1 }), "The most changes on the page; all of them when left out."),
        cursor: opt(T, "Where the page starts: the `next` of the page before."),
      },
      reply: valueHistoryReply,
      handle: async ({ user, params, query }) => {
        const s = held(user, params.chat, query.turn);
        const env = turns.store.env;
        const all = valueHistory(s, env, params.chat, query.at, query.part, query.turn).reverse();
        const from = query.cursor === undefined ? 0 : all.findIndex((w) => String(w.change.id) === query.cursor) + 1;
        const items = (query.limit === undefined ? all.slice(from) : all.slice(from, from + query.limit)).map((w) => {
          const c = w.change;
          const area = env.areas?.of(c.op)?.area.id ?? "engine";
          return {
            id: String(c.id),
            turn: w.turn ?? "",
            n: w.n,
            at: c.created,
            lane: c.lane,
            area,
            op: c.op,
            words: c.op,
            values: isRecord(c.value) ? c.value : { value: c.value },
            by: c.by,
            precision: c.precision,
            standing: c.standing,
            source: c.source,
            reports: c.reports.map((r) => r.code),
            value: said(w.value),
            kind: w.kind,
            settledBy: w.settledBy,
          };
        });
        const last = from + items.length;
        return { at: query.at, part: query.part, items, next: last < all.length ? (items[items.length - 1]?.id ?? null) : null };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/state/not-applied",
      access: "page",
      group: "state",
      does: "What no longer applies at the chat's head on the swipes now showing: each change that stopped applying, with its turn and the codes of why, and the earlier reply whose swipe the later turns were not made on.",
      reply: notAppliedReply,
      handle: async ({ user, params }) => {
        const s = held(user, params.chat);
        const folded = s.headState(params.chat);
        const path = s.path(params.chat).flatMap((e) => (e.turn === null ? [] : [e.turn]));
        const first = path.findIndex((t) => folded.rebased.includes(t));
        const before = first > 0 ? path[first - 1] : undefined;
        const items = folded.notApplied.map((x) => {
          const at = path.indexOf(x.turn);
          return { change: String(x.change), turn: x.turn, n: at < 0 ? path.length + 1 : at + 1, op: x.op, words: x.op, reason: x.reports.map((r) => r.code).join(", ") };
        });
        return { reply: before === undefined ? null : { turn: before, n: first }, items };
      },
    }),
  ] as const;
}
