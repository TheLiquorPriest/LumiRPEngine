// The events on a chat's path as the kept engine's readers take them (`PathEvent`: its turn, what made it, its unit, the event), read
// over RPE's store (PlanTurnKinds-23 item 4): before a turn, each change that applied on the path that turn was made on, in order, the
// changes placed before each turn (his own and his jobs') at their place. A change that did not apply there is left out, and so is one
// that carries no event of the engine's (a store operation, an area's own). The tidy-up's finder reads it (`tidyFindings`); nothing here
// decides anything.

import { playedWorld } from "../engine/places-in-play";
import type { PathEvent } from "../engine/thing-gm";
import { tidyFindings } from "../engine/thing-tidy";
import type { HistorySource, TidyFinding } from "../shared/thing-gm";
import { thingsConfigOf } from "../shared/things";
import type { ChangeRow, Store, TurnRow, UserStore } from "../store";
import { eventOf } from "../store/fold";
import type { TidySettings } from "./settings";

/** What made a change, as the kept readers name it: his own edit, an agent's job, else the turn. */
function originOf(c: ChangeRow): HistorySource {
  if (c.chat !== null) return "fix";
  return c.job !== null ? "agent" : "turn";
}

/** The events on the path `turn` was made on, before it: each turn before it, after what was placed before that turn, then what was placed before `turn` itself. */
export function pathEventsBefore(store: UserStore, turn: string): PathEvent[] {
  const at = store.turn(turn);
  if (at === null) return [];
  const chain: TurnRow[] = [];
  for (let t = at.parent === null ? null : store.turn(at.parent); t !== null; t = t.parent === null ? null : store.turn(t.parent)) if (t.joined === null) chain.unshift(t);
  const missed = new Set(store.stateAt(turn).notApplied.map((n) => n.change));
  const out: PathEvent[] = [];
  const put = (n: number, c: ChangeRow): void => {
    const event = c.applied && !missed.has(c.id) ? eventOf(c.op, c.value) : null;
    if (event !== null) out.push({ turn: n, origin: originOf(c), unit: `change:${c.id}`, event });
  };
  chain.forEach((t, i) => {
    for (const p of store.changesBefore(t.id)) if (p.applied) put(i, p.change);
    for (const c of store.changes(t.id)) put(i + 1, c);
  });
  for (const p of store.changesBefore(turn)) if (p.applied) put(chain.length, p.change);
  return out;
}

/** The two kinds a turn's start lists (R-173): a thing too big to carry on a person, and a thing worn but lying elsewhere. */
const TURN_KINDS = ["too_big", "worn_elsewhere"] as const;

/**
 * The holds that cannot be at the start of `turn`, for its world state: with the chat's tidy-up on (its own switch, else the world's
 * `tidy.auto`), the kept finder's findings of the turn's two kinds, less those he left as they are. Each with the fix the tidy-up would
 * make; none is applied. None where the switch is off, or the chat plays no world. Which things the two kinds find is the state's alone;
 * only a thing too big to carry reads the path's events, for who bought it (its fix), so the path is read only where one is found.
 */
export function tidyHolds(store: Store, user: string, turn: string, tidy: TidySettings): TidyFinding[] {
  const s = store.user(user);
  const { state } = s.stateAt(turn);
  const doc = store.env.worlds(state.world.revision);
  if (doc === undefined) return [];
  const world = playedWorld(doc, state.world);
  if (!(tidy.on ?? thingsConfigOf(world).tidy.auto)) return [];
  const left = new Set(tidy.left);
  const ctx = store.env.registry.context(world, state.world);
  const found = tidyFindings(ctx, [], { kinds: TURN_KINDS });
  const read = found.some((f) => f.kind === "too_big") ? tidyFindings(ctx, pathEventsBefore(s, turn), { kinds: TURN_KINDS }) : found;
  return read.filter((f) => !left.has(f.key));
}
