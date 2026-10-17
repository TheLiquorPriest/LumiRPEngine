// The deterministic outline (DESIGN §5.2 Outline, D13): `beats` always renders it; prompted outline
// steps stack on top. Lines come from what this turn decided, in a fixed order: the action's
// outcome, the timelapse, visible track changes and signals, storylet beats (a seeded weighted
// order, so a Re-run may pick different storylets and a Re-narrate repeats them), agents present
// and the next commitment. Everything is filtered to what the POV knows.

import type { EntityId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import { calendarOf, dateAt, formatHHMM, MINUTES_PER_DAY } from "./calendar";
import { ENGINE_EVENTS, signalOf } from "./engine-pack";
import type { Registry } from "./registry-impl";
import type { Resolution } from "./resolve";
import type { Rng } from "./rng";
import { allSchedules, nextStartFor, scheduleOwners } from "./schedules";
import { asObject, placeOfEntity } from "./scope";
import type { WorldState } from "./state";
import { own } from "./pack-kit";
import type { TimelapseOutcome } from "./time";
import { canSeeEntity, playerTrack, signalVisible } from "./visibility";

export interface BeatInput {
  resolution?: Resolution | null;
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
  const r = input.resolution;
  if (r) {
    const label = own(world.actions, r.action)?.label ?? reg.actions.get(r.action)?.label ?? r.action;
    if (!r.ok) lines.push(`${label} doesn't happen: ${r.failed?.reason ?? "not possible"}.`);
    else if (r.check) lines.push(`${label}: the result is decided — ${r.outcome}.`);
    else lines.push(`${label} happens.`);
  }
  const tl = input.timelapse;
  if (tl) {
    const stop = tl.result.stops[0];
    if (stop && signalVisible(world, state, pov, stop)) lines.push(`Time passes until it's interrupted: ${stop.text}. Narrate the interval from the Montage; don't add events.`);
    else lines.push("Time passes. Narrate the interval from the Montage; don't add events.");
  }
  for (const e of input.events) {
    if (e.type === "stage") {
      const t = playerTrack(reg, world, state, pov, e.track);
      if (t && own(world.tracks, e.track)?.visibility !== "secret") lines.push(t.cue ? t.cue : `${t.label}: ${t.stage}.`);
      continue;
    }
    const s = "data" in e ? signalOf(e) : null;
    if (s && s.text && !tl && signalVisible(world, state, pov, s)) lines.push(s.text);
  }
  for (const b of weightedOrder(storylets(input.events), rng.fork("storylets")).slice(0, 2)) lines.push(b.hint);
  const here = placeOfEntity(state, pov);
  if (here) {
    for (const id of Object.keys(state.entities).sort()) {
      const e = own(state.entities, id);
      if (!e || id === pov || !e.agent || placeOfEntity(state, id) !== here || !canSeeEntity(world, state, pov, id)) continue;
      const act = e.fields.activity;
      if (typeof act === "string" && act !== "" && act !== "idle") lines.push(`${e.name} is ${act.replace(/_/g, " ")}.`);
    }
  }
  const cal = calendarOf(world);
  const ctx = reg.context(world, state);
  for (const s of allSchedules(reg, world)) {
    if (s.target !== "activity" || !scheduleOwners(reg, world, state, s).includes(pov)) continue;
    const n = nextStartFor(reg, ctx, s, pov, state.clock, 1);
    const v = n?.slot.value;
    if (n && typeof v === "string" && n.at - state.clock <= 60) {
      lines.push(`${v.replace(/_/g, " ")} starts at ${formatHHMM(dateAt(cal, n.at).minuteOfDay)}.`);
      break;
    }
  }
  return [...new Set(lines)].slice(0, max);
}
