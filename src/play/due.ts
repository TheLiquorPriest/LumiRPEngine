// What a turn's time brought due, for the World page (plan §6.4, scenario 1): the span the turn's clock
// moved over, from its start to its end, and each thing the host lists as falling due in it (`timeDue`,
// the list the engine's tools give), soonest first, at the chat's `engine.dueItems`, with the changes of
// the turn that concern it as what was recorded for it. A list only, read from the store: nothing here
// decides what the time did.

import { calendarOf, formatClock, placeOffset } from "../engine/calendar";
import { placeOfEntity } from "../engine/scope";
import type { JsonValue } from "../shared/json";
import type { WorldDoc } from "../shared/world";
import { type ChangeRow, clockRecorded, type Store, type StoreState, timeDue } from "../store";

/** One thing the turn's time brought due: its kind, what it is, when as the world prints it, the level it concerns, and what the turn recorded for it. */
export interface DueShown {
  kind: string;
  words: string;
  when: string;
  at: string | null;
  outcome: string | null;
}

export interface DueRead {
  turn: string;
  /** The turn's span as the world prints its two ends; null where no time passed. */
  span: { from: string; to: string } | null;
  items: DueShown[];
  /** How many more fell due than are listed; null where more did, but counting them would take going through the span year by year. */
  more: number | null;
}

/** A value's text as a list shows it. */
const textOf = (value: JsonValue): string => (typeof value === "string" ? value : JSON.stringify(value));

/** A clock reading as the world prints it at the player character's place; minutes from the turn's start where nobody set the clock. */
function printed(world: WorldDoc | undefined, state: StoreState, clock: number, from: number): string {
  if (world === undefined || !clockRecorded(state)) return `+${clock - from}`;
  return formatClock(calendarOf(world), clock, placeOffset(world, clock, placeOfEntity(state.world, world.pov)));
}

/** The turn's applied changes that name what an item concerns (who, or the place), in the order recorded: each its operation and value. */
function recordedFor(changes: readonly ChangeRow[], names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const said = changes.filter((c) => c.applied && names.some((name) => JSON.stringify(c.value).includes(JSON.stringify(name)))).map((c) => `${c.op} ${textOf(c.value)}`);
  return said.length === 0 ? null : said.join("; ");
}

/** What the turn's time brought due on its chat, `most` of it listed. */
export function turnDue(store: Store, user: string, turn: string, most: number): DueRead {
  const s = store.user(user);
  const start = s.startOf(turn).state;
  const end = s.stateAt(turn).state;
  const from = start.world.clock;
  const to = end.world.clock;
  if (to <= from) return { turn, span: null, items: [], more: 0 };
  const world = store.env.worlds(start.world.revision);
  const listing = timeDue(store).due(start, { from, to }, null, most);
  const changes = s.changes(turn);
  return {
    turn,
    span: { from: printed(world, start, from, from), to: printed(world, end, to, from) },
    items: listing.items.map((item) => {
      const where = item.where ?? null;
      const who = item.who ?? [];
      return {
        kind: item.kind,
        words: textOf(item.what),
        when: printed(world, start, item.at, from),
        at: where ?? (who[0] === undefined ? null : `entity:${who[0]}`),
        outcome: recordedFor(changes, [...who, ...(where === null ? [] : [where.replace(/^place:/, "")])]),
      };
    }),
    more: listing.more,
  };
}
