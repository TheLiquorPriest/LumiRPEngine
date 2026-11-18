// What a turn's time brought due, for the World page (plan §6.4, scenario 1): the span the turn's clock
// moved over, from its start to its end, and each thing the host lists as falling due in it (`timeDue`,
// the list the engine's tools give), soonest first, at the chat's `engine.maxDueItems`, each by the name
// a person knows it by (whose it is, what, when), with the changes of the turn that concern it, each as
// its own line in the words the GM view words a change in. A list only, read from the store: nothing here
// decides what the time did.

import { calendarOf, formatClock, placeOffset } from "../engine/calendar";
import { own } from "../engine/pack-kit";
import { authorLines } from "../engine/player-events";
import { chatSchedulesIn } from "../engine/schedules";
import { placeOfEntity } from "../engine/scope";
import { isRecord } from "../shared/json";
import type { WorldDoc } from "../shared/world";
import { type ChangeRow, clockRecorded, type Store, type StoreState, timeDue } from "../store";
import { eventOf } from "../store/fold";
import type { DueEntry } from "../store/world-state";

/** One thing the turn's time brought due: its kind as a person names it, what it is in words, when as the world prints it, the level it concerns, and what the turn recorded for it, one line to a change. */
export interface DueShown {
  label: string;
  words: string;
  when: string;
  at: string | null;
  changes: string[];
}

export interface DueRead {
  turn: string;
  /** The turn's span as the world prints its two ends; null where no time passed. */
  span: { from: string; to: string } | null;
  items: DueShown[];
  /** How many more fell due than are listed; null where more did, but counting them would take going through the span year by year. */
  more: number | null;
}

/** A line of the play answers' words, filled with `fields`; empty where the file has none. */
export type Say = (line: string, fields?: Record<string, unknown>) => string;

/** An id as words: its underscores as spaces. */
const plain = (id: string): string => id.replace(/_/g, " ");

/** A clock reading as the world prints it at the player character's place; minutes from the turn's start where nobody set the clock. */
function printed(world: WorldDoc | undefined, state: StoreState, clock: number, from: number): string {
  if (world === undefined || !clockRecorded(state)) return `+${clock - from}`;
  return formatClock(calendarOf(world), clock, placeOffset(world, clock, placeOfEntity(state.world, world.pov)));
}

/** What a thing that fell due is, in words: whose it is by name, what, and where, as the answers' file says it. */
function dueWords(entry: DueEntry, world: WorldDoc, state: StoreState, schedules: ReadonlySet<string>, say: Say): string {
  const nameOf = (id: string): string => own(state.world.entities, id)?.name ?? plain(id);
  const placeOf = (ref: string): string => {
    const id = ref.replace(/^place:/, "");
    return own(world.places, id)?.name ?? plain(id);
  };
  const spot = (ref: string): string => (ref.startsWith("place:") ? placeOf(ref) : ref);
  const names = (entry.who ?? []).map(nameOf);
  const who = names.join(", ");
  const what = entry.what;
  const obj = isRecord(what) ? what : {};
  const text = (key: string): string => (typeof obj[key] === "string" ? obj[key] : "");
  // A routine block with no value of its own is listed by its schedule's id, which no person knows it by.
  const slot = typeof what === "string" && !schedules.has(what) ? plain(what) : "";
  switch (entry.kind) {
    case "place":
      return say("due_place", { who, place: entry.where !== undefined ? placeOf(entry.where) : slot });
    case "activity":
      return say("due_activity", { who, what: slot });
    case "future":
      return say("due_future", { what: typeof what === "string" ? what : "", who, place: entry.where !== undefined ? placeOf(entry.where) : "" });
    case "arrival":
      return say("due_arrival", { who: text("character"), from: spot(text("from")), to: spot(text("to")), intention: text("intention") });
    case "ending":
      return say("due_ending", { who, relation: plain(text("relation")), to: nameOf(text("to")) });
    case "need":
      return say("due_need", { who, need: plain(text("need")), line: typeof obj.line === "number" ? obj.line : "" });
    case "fading":
      return say("due_fading", { who: names[0] ?? "", to: names[1] ?? "", axis: plain(text("axis")) });
    default:
      return say(who === "" ? "due_process" : "due_field", { who, kind: plain(entry.kind), what: slot, place: entry.where !== undefined ? placeOf(entry.where) : "" });
  }
}

/** The turn's applied changes of the world that name what an item concerns (whose it is, or its place where it is no one's), in the order recorded, each as its own line in the GM view's words; a change worded twice reads once. */
function changesFor(store: Store, world: WorldDoc, state: StoreState, changes: readonly ChangeRow[], names: readonly string[]): string[] {
  if (names.length === 0) return [];
  const lines = new Set<string>();
  for (const c of changes) {
    if (!c.applied || !names.some((name) => JSON.stringify(c.value).includes(JSON.stringify(name)))) continue;
    const event = eventOf(c.op, c.value);
    const line = event === null ? undefined : authorLines(store.env.registry, world, state.world, [event], 1)[0];
    if (line !== undefined && line !== "") lines.add(line);
  }
  return [...lines];
}

/** What the turn's time brought due on its chat, `most` of it listed, in the words `say` gives. */
export function turnDue(store: Store, user: string, turn: string, most: number, say: Say): DueRead {
  const s = store.user(user);
  const start = s.startOf(turn).state;
  const end = s.stateAt(turn).state;
  const from = start.world.clock;
  const to = end.world.clock;
  if (to <= from) return { turn, span: null, items: [], more: 0 };
  const world = store.env.worlds(start.world.revision);
  const listing = timeDue(store).due(start, { from, to }, null, most);
  const changes = s.changes(turn);
  const schedules = new Set(world === undefined ? [] : chatSchedulesIn(store.env.registry.context(world, start.world)).map((schedule) => schedule.id));
  return {
    turn,
    span: { from: printed(world, start, from, from), to: printed(world, end, to, from) },
    items: listing.items.map((item) => {
      const where = item.where ?? null;
      const who = item.who ?? [];
      return {
        label: say(`due_kind_${item.kind}`) || plain(item.kind),
        words: world === undefined ? plain(item.kind) : dueWords(item, world, start, schedules, say),
        when: printed(world, start, item.at, from),
        at: where ?? (who[0] === undefined ? null : `entity:${who[0]}`),
        changes: world === undefined ? [] : changesFor(store, world, end, changes, who.length > 0 ? who : where === null ? [] : [where.replace(/^place:/, "")]),
      };
    }),
    more: listing.more,
  };
}
