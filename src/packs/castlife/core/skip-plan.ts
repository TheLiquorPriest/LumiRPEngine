// The model's skip plan (#53, DESIGN §8 "Routine roles"): what one helper call is told of the people
// whose time skip the model plans, and how its answer is checked before it is recorded as
// `castlife.skip_plan`. The call is a helper's, and no helper may be handed what the POV may not know
// (DESIGN §24.3), so every line here is what the player could know: places the POV can see, the
// POV-filtered usual routine with no private block, and story commitments screened like any other
// player text. Routines are context for it, never rules.

import type { EntityId, PlaceId } from "../../../shared/ids";
import { isRecord, type JsonValue } from "../../../shared/json";
import { neutralizeMacros } from "../../../shared/macros";
import { activityPhrase } from "../../../shared/activity";
import { BASIC_BLOCKS, type SkipBlock } from "../../../shared/routines";
import { calendarOf, clockOfStamp, formatStamp } from "../../../engine/calendar";
import { own } from "../../../engine/pack-kit";
import { povMayKnow } from "../../../engine/player-events";
import type { ReadContext } from "../../../engine/registry";
import { chatSchedulesIn } from "../../../engine/schedules";
import { placeOfEntity } from "../../../engine/scope";
import { canSeeField, canSeePlace } from "../../../engine/visibility";
import { commitments } from "./commitments";
import { activeBlocks } from "./routines";
import { knownUsual, povSafe } from "./usual";

/** The activities every world has, as routine blocks name them (`RoutineBlock.activity`). */
const BUILTIN_ACTIVITIES = ["work", "socialize", "leisure"];

/** The commitments a plan must leave alone, as the planner lays them: the story's, never a routine's. */
const STORY_KINDS: Record<string, true> = { appointment: true, trip: true, plan: true };

/** The longest label kept, as a routine block's reads. */
const LABEL_CAP = 80;

/** One person as the call is told of them. */
export interface SkipPlanPerson {
  id: EntityId;
  name: string;
  /** Their place's name and id, or null where the POV may not know where they are. */
  place: { id: PlaceId; name: string } | null;
  activity: string | null;
  usual: string[];
  /** Their appointments, trips and story plans in the span, as the POV may know them. */
  story: string[];
}

/** Everything the call is told, and what its answer is checked against. */
export interface SkipPlanBrief {
  from: number;
  to: number;
  people: SkipPlanPerson[];
  places: { id: PlaceId; name: string }[];
  activities: string[];
}

/** The activities the world has: the built-in ones, and those its routines and activity schedules set. */
function worldActivities(ctx: ReadContext, people: readonly EntityId[]): string[] {
  const out = new Set<string>([...BUILTIN_ACTIVITIES, ...BASIC_BLOCKS.map((b) => b.activity)]);
  for (const def of Object.values(ctx.world.routines ?? {})) for (const entry of def.blocks) if ("activity" in entry) out.add(entry.activity);
  for (const id of people) for (const { block } of activeBlocks(ctx, id)) out.add(block.activity);
  for (const s of chatSchedulesIn(ctx)) if (s.target === "activity") for (const slot of s.slots) if (typeof slot.value === "string" && slot.value.trim() !== "") out.add(slot.value.trim());
  return [...out].sort();
}

/** What the call is told of `people` for the span [from, to): only what the POV may know. */
export function skipPlanBrief(ctx: ReadContext, people: readonly EntityId[], from: number, to: number): SkipPlanBrief {
  const { registry: reg, world, state } = ctx;
  const pov = world.pov;
  const cal = calendarOf(world);
  const safe = povSafe(ctx);
  const places = Object.keys(world.places)
    .filter((p) => canSeePlace(reg, world, state, pov, p))
    .sort()
    .map((id) => ({ id, name: own(world.places, id)?.name ?? id }));
  const seen = new Set(places.map((p) => p.id));
  const named = (id: PlaceId): string => `${own(world.places, id)?.name ?? id} (${id})`;
  const out: SkipPlanPerson[] = people.map((id) => {
    const e = own(state.entities, id);
    const here = placeOfEntity(state, id);
    const activity = e && canSeeField(reg, world, state, pov, id, "activity") && typeof e.fields.activity === "string" ? e.fields.activity : null;
    const story = commitments(ctx, id, from, to)
      .filter((c) => STORY_KINDS[c.kind] === true)
      .map((c) => `${formatStamp(cal, c.start)} to ${formatStamp(cal, c.end)}: ${c.label}${c.place && seen.has(c.place) ? ` at ${named(c.place)}` : ""}`)
      .filter(safe);
    return {
      id,
      name: e && povMayKnow(reg, world, state, id) ? e.name : "someone the player character hasn't met",
      place: here !== null && seen.has(here) && canSeeField(reg, world, state, pov, id, "place") ? { id: here, name: own(world.places, here)?.name ?? here } : null,
      activity: activity !== null && safe(activity) ? activity : null,
      usual: knownUsual(ctx, id, (p, name) => `${name} (${p})`, safe),
      story,
    };
  });
  return { from, to, people: out, places, activities: worldActivities(ctx, people) };
}

/** The brief as the call's user message: the span, the people, the places and activities it may use. */
export function skipPlanText(ctx: ReadContext, brief: SkipPlanBrief, reply: string, journal: readonly string[]): string {
  const cal = calendarOf(ctx.world);
  const person = (p: SkipPlanPerson): string =>
    [
      `- ${p.name} (id ${p.id}): ${p.place ? `at ${p.place.name} (${p.place.id})` : "somewhere of their own"}${p.activity && activityPhrase(p.activity) ? `, ${activityPhrase(p.activity)}` : ""}.`,
      p.usual.length > 0 ? `  Usually: ${p.usual.join("; ")}.` : "",
      p.story.length > 0 ? `  Already set by the story: ${p.story.join("; ")}.` : "",
    ]
      .filter((s) => s !== "")
      .join("\n");
  return [
    `The time skip runs from ${formatStamp(cal, brief.from)} to ${formatStamp(cal, brief.to)}.`,
    `People to plan:\n${brief.people.map(person).join("\n")}`,
    `Places they may use (id: name):\n${brief.places.map((p) => `- ${p.id}: ${p.name}`).join("\n")}`,
    `Activities: ${brief.activities.join(", ")}.`,
    journal.length > 0 ? `The story so far:\n${journal.map((l) => `- ${l}`).join("\n")}` : "",
    reply.trim() !== "" ? `The latest reply:\n${reply.trim()}` : "",
  ]
    .filter((s) => s !== "")
    .join("\n\n");
}

/** The answer's blocks that hold, per person, and why each other was dropped. */
export interface CheckedSkipPlan {
  plans: { entity: EntityId; blocks: SkipBlock[] }[];
  dropped: string[];
}

/**
 * The call's answer, checked: a block holds when its person was asked about, its place was offered,
 * its activity is the world's, it lies inside the span without overlapping one kept before it, and
 * its label passes the leak checks. Anyone left with nothing isn't planned, and stays.
 */
export function checkSkipPlan(ctx: ReadContext, brief: SkipPlanBrief, raw: JsonValue | null): CheckedSkipPlan {
  const cal = calendarOf(ctx.world);
  const safe = povSafe(ctx);
  const asked = new Set(brief.people.map((p) => p.id));
  const places = new Set(brief.places.map((p) => p.id));
  const activities = new Set(brief.activities);
  const dropped: string[] = [];
  const byEntity = new Map<EntityId, SkipBlock[]>();
  for (const plan of isRecord(raw) && Array.isArray(raw.plans) ? raw.plans : []) {
    if (!isRecord(plan) || typeof plan.entity !== "string" || !asked.has(plan.entity)) {
      dropped.push(`a plan for someone not asked about (${isRecord(plan) ? String(plan.entity) : "no entity"})`);
      continue;
    }
    const who = plan.entity;
    const blocks = byEntity.get(who) ?? [];
    const candidates: SkipBlock[] = [];
    for (const b of Array.isArray(plan.blocks) ? plan.blocks : []) {
      if (!isRecord(b)) continue;
      const start = typeof b.start === "string" ? clockOfStamp(cal, b.start) : null;
      const end = typeof b.end === "string" ? clockOfStamp(cal, b.end) : null;
      const place = typeof b.place === "string" ? b.place : "";
      const activity = typeof b.activity === "string" ? b.activity.trim() : "";
      const label = neutralizeMacros(typeof b.label === "string" ? b.label : "").replace(/\s+/g, " ").trim().slice(0, LABEL_CAP);
      const why =
        start === null || end === null ? "a time that isn't a day and time" : start < brief.from || end > brief.to || end <= start ? "outside the skip" : !places.has(place) ? `a place not offered (${place})` : !activities.has(activity) ? `an activity the world hasn't (${activity})` : label === "" ? "no label" : !safe(label) ? "a label naming what the player may not know" : null;
      if (why !== null || start === null || end === null) {
        dropped.push(`${who}: ${why ?? "unreadable"}`);
        continue;
      }
      candidates.push({ label, start, end, place, activity });
    }
    for (const c of candidates.sort((a, b) => a.start - b.start)) {
      if (blocks.some((k) => c.start < k.end && k.start < c.end)) dropped.push(`${who}: a block overlapping another`);
      else blocks.push(c);
    }
    byEntity.set(who, blocks);
  }
  const plans = brief.people.flatMap((p) => {
    const blocks = (byEntity.get(p.id) ?? []).sort((a, b) => a.start - b.start);
    return blocks.length > 0 ? [{ entity: p.id, blocks }] : [];
  });
  return { plans, dropped };
}
