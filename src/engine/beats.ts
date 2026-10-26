// The deterministic outline (DESIGN §5.2 Outline, D13): `beats` always renders it; prompted outline
// steps stack on top. Lines come from what this turn decided, in a fixed order: the actions'
// outcomes as they played, the timelapse, visible track changes and signals, storylet beats (a
// seeded weighted order, so a Re-run may pick different storylets and a Re-narrate repeats them),
// agents present and the next commitment. Everything is filtered to what the POV knows.

import type { EntityId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import { activityPhrase } from "../shared/activity";
import { spanText } from "./action-words";
import { calendarOf, dateAt, formatHHMM, MINUTES_PER_DAY, placeOffset } from "./calendar";
import { ENGINE_EVENTS, signalOf } from "./engine-pack";
import type { Registry } from "./registry-impl";
import { povLife } from "./life";
import type { Resolution } from "./resolve";
import type { Rng } from "./rng";
import { allSchedules, nextStartFor, scheduleOwners } from "./schedules";
import { asObject, placeOfEntity } from "./scope";
import type { WorldState } from "./state";
import { optionalQuery, own } from "./pack-kit";
import type { TimelapseOutcome } from "./time";
import { canSeeEntity, canSeeField, playerTrack, signalVisible } from "./visibility";

export interface BeatInput {
  /** The turn's actions as played, in order (DESIGN §11 action queue). */
  resolutions?: readonly Resolution[];
  timelapse?: TimelapseOutcome | null;
  /** The turn's events (signals, beats and stage changes are read from them). */
  events: readonly LedgerEvent[];
}

export const MAX_BEATS = 6;

function storylets(events: readonly LedgerEvent[]): { hint: string; weight: number }[] {
  const out: { hint: string; weight: number }[] = [];
  for (const e of events) {
    if (e.type !== ENGINE_EVENTS.beat) continue;
    const d = asObject("data" in e ? e.data : undefined);
    if (typeof d.hint === "string" && d.hint !== "") out.push({ hint: d.hint, weight: typeof d.weight === "number" && d.weight > 0 ? d.weight : 1 });
  }
  return out;
}

/** Weighted order without replacement, seeded. */
function weightedOrder<T extends { weight: number }>(items: readonly T[], rng: Rng): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (pool.length > 0) {
    const pick = rng.weighted(pool.map((value, i) => ({ value: i, weight: value.weight })));
    out.push(pool[pick] as T);
    pool.splice(pick, 1);
  }
  return out;
}

export function outline(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, input: BeatInput, rng: Rng, max = MAX_BEATS): string[] {
  const pov: EntityId = world.pov;
  const lines: string[] = [];
  for (const r of input.resolutions ?? []) {
    // The action as the narrator is told it: its picks in words, where it started, its time and what it changed (`toldAction`).
    const what = r.told?.what ?? r.inferred?.label ?? own(world.actions, r.action)?.label ?? reg.actions.get(r.action)?.label ?? r.action;
    const took = r.told && r.told.minutes > 0 ? `, taking ${spanText(r.told.minutes)}` : "";
    const changed = r.told && r.told.changes.length > 0 ? ` What changed: ${r.told.changes.join("; ")}.` : "";
    // A requirement's expression can name a secret or its stage: it reads as not possible, as on the Outcome.
    if (!r.ok) lines.push(`${what} doesn't happen: ${r.failed && r.failed.code !== "requirement" ? r.failed.reason : "not possible here and now"}.`);
    // A check the adjudication policy settled without a roll is decided all the same.
    else if (r.check || r.adjudged) lines.push(`${what}: the result is decided — ${r.outcome}${took}.${changed}`);
    else lines.push(`${what} happens${took}.${changed}`);
  }
  const tl = input.timelapse;
  if (tl) {
    const stop = tl.result.stops[0];
    if (stop && signalVisible(reg, world, state, pov, stop)) lines.push(`Time passes until it's interrupted: ${stop.text}. Narrate the interval from the Montage; don't add events.`);
    // A time skip a character's mind stopped (DESIGN §24.7): what they do comes from their mind, never stated here.
    else if (tl.summary.stoppedBy === "mind") lines.push(`Time passes until ${tl.mindName ?? "someone"} steps in; how they do is in the Minds section. Narrate the interval from the Montage; don't add events.`);
    else lines.push("Time passes. Narrate the interval from the Montage; don't add events.");
  }
  for (const e of input.events) {
    if (e.type === "stage") {
      const t = playerTrack(reg, world, state, pov, e.track);
      if (t && own(world.tracks, e.track)?.visibility !== "secret") lines.push(t.cue ? t.cue : `${t.label}: ${t.stage}.`);
      continue;
    }
    const s = "data" in e ? signalOf(e) : null;
    if (s && s.text && !tl && signalVisible(reg, world, state, pov, s)) lines.push(s.text);
  }
  for (const b of weightedOrder(storylets(input.events), rng.fork("storylets")).slice(0, 2)) lines.push(b.hint);
  const here = placeOfEntity(state, pov);
  const ctx = reg.context(world, state);
  if (here) {
    // An agenda's step reads as the castlife pack words it for the player (`castlife.activity`).
    const shownActivity = optionalQuery(ctx, "castlife.activity");
    for (const id of Object.keys(state.entities).sort()) {
      const e = own(state.entities, id);
      if (!e || id === pov || !e.agent || placeOfEntity(state, id) !== here || !canSeeEntity(reg, world, state, pov, id)) continue;
      // What they are doing is a field: told only when the POV may see it. A life state the POV knows
      // reads instead ("lies dead"); one it doesn't know of is never told.
      const life = povLife(world, state, id);
      const act = canSeeField(reg, world, state, pov, id, "activity") ? e.fields.activity : undefined;
      if (life) lines.push(`${e.name} ${life.reads}.`);
      else if (typeof act === "string") {
        // "Danny Okafor is at work.", never "is work": the activity's own words as a predicate.
        const doing = activityPhrase(shownActivity ? shownActivity(ctx, id, act) : act);
        if (doing) lines.push(`${e.name} is ${doing}.`);
      }
    }
  }
  // What the player character is due to be doing within the hour after the turn, by its routine: who,
  // what, and when, on the clock where it stands. A slot already under way or further off is none of this turn's.
  const cal = calendarOf(world);
  const shown = optionalQuery(ctx, "castlife.activity");
  for (const s of allSchedules(reg, world)) {
    if (s.target !== "activity" || !scheduleOwners(reg, world, state, s).includes(pov)) continue;
    const n = nextStartFor(reg, ctx, s, pov, state.clock, 1);
    const v = n?.slot.value;
    const doing = typeof v === "string" ? activityPhrase(shown ? shown(ctx, pov, v) : v) : null;
    if (n && doing && n.at > state.clock && n.at - state.clock <= SOON) {
      lines.push(`You are due to be ${doing} from ${formatHHMM(dateAt(cal, n.at + placeOffset(world, n.at, here)).minuteOfDay)} (in ${spanText(n.at - state.clock)}).`);
      break;
    }
  }
  return [...new Set(lines)].slice(0, max);
}

/** How far ahead of the turn's end the player character's next routine slot is told: within the hour. */
const SOON = 60;
