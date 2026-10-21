// The read model of a character's routine (DESIGN §8): one request answers a character's effective
// routine (each block with the owner it comes from, its source and what it shadows), the schedules
// that apply to them (which wins and which are shadowed, and the chat's changes), their day as laid
// with why each block is there, what the story established now, and the invitations they made and
// received with their grounds. The GM reads all of it; the player reads only what Cast already shows
// of them, with why (`playerBlocks`), and never a GM change, a place or their company.

import type { EntityId } from "../../../shared/ids";
import type { JsonObject } from "../../../shared/json";
import type { ScheduleDef } from "../../../shared/world";
import { isOff, routineSettingsOf, type BlockOrigin, type EffectiveBlock, type EffectiveSchedule, type InvitationView, type LaidBlock, type OwnerRef, type RoutineChangeSummary, type RoutineGmView, type RoutinePlayerView, type StoryHoldView } from "../../../shared/routines";
import { calendarOf, dateAt, formatClock, formatHHMM } from "../../../engine/calendar";
import { objOf, optionalQuery, own, sliceOf, strOf } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { chatSchedulesIn, ownerRank, scheduleOwners } from "../../../engine/schedules";
import { povLife } from "../../../engine/life";
import { playerKnows } from "../../../engine/player-events";
import { canSeeEntity } from "../../../engine/visibility";
import { placeOfEntity } from "../../../engine/scope";
import { livesPlans } from "./commitments";
import { asksOf, dayPlan, invitationText, kindOfBlock, playerBlocks } from "./index";
import { activeBlocks, chatBlocks, chatFollow, chatSchedules, followOf, ownerOf, routineCandidates, routineRole, sourceView, type Applied } from "./routines";

/** A schedule's owner as the read model names it: the chat's own version, or the rank its owner has. */
function scheduleOwner(ctx: ReadContext, id: string, rank: number | null, owner: ScheduleDef["owner"]): OwnerRef {
  if (id.includes("@")) return ownerOf(ctx, "chat", undefined);
  return ownerOf(ctx, rank === 0 ? "own" : rank === 1 ? "group" : rank === 2 ? "kind" : rank === 3 ? "selector" : "world", owner);
}

/** The block of someone's routine in force on `day` with this id, if any. */
function appliedBlock(ctx: ReadContext, who: EntityId, id: string, day: number): Applied | undefined {
  return activeBlocks(ctx, who, day).find((x) => x.block.id === id)?.from;
}

/** The invitations someone made and was made (recorded; still to come today and tomorrow; laid in their day), each with its ground. */
function invitationsOf(ctx: ReadContext, who: EntityId, blocks: LaidBlock[]): { made: InvitationView[]; received: InvitationView[] } {
  const cal = calendarOf(ctx.world);
  const pov = ctx.world.pov;
  const day = dateAt(cal, ctx.state.clock).dayIndex;
  const list = sliceOf(ctx.state, "castlife").invitations;
  const recorded = (Array.isArray(list) ? list : []).map(objOf);
  const view = (host: EntityId, key: string, at: number, place: string | null, origin: InvitationView["origin"], status: InvitationView["status"], guests: EntityId[]): InvitationView => ({
    key,
    host,
    hostName: own(ctx.state.entities, host)?.name ?? host,
    guests,
    at,
    when: formatClock(cal, at),
    place,
    placeName: place ? (own(ctx.world.places, place)?.name ?? place) : null,
    text: invitationText(ctx, host, place, at),
    origin,
    status,
  });
  const routineOrigin = (host: EntityId, block: string): InvitationView["origin"] => ({ type: "routine", block, source: sourceView(ctx, appliedBlock(ctx, host, block, day)?.source ?? { type: "authored" }) });
  // An invitation an earlier build recorded names no origin: a plan's key still says so; the rest were the formula's.
  const originOf = (inv: JsonObject): InvitationView["origin"] => {
    const o = strOf(inv.origin);
    const key = strOf(inv.key);
    if (o.startsWith("plan:")) return { type: "plan", plan: o.slice(5) };
    if (key.includes(":plan:")) return { type: "plan", plan: key.slice(key.indexOf(":plan:") + 6) };
    if (o.startsWith("routine:")) return routineOrigin(strOf(inv.agent), o.slice(8));
    return { type: "legacy" };
  };
  const sent = recorded.map((inv) => view(strOf(inv.agent), strOf(inv.key), typeof inv.at === "number" ? inv.at : 0, typeof inv.place === "string" ? inv.place : null, originOf(inv), "sent", [pov]));
  const given = new Set(sent.map((s) => s.key));
  const coming = who === pov ? [] : asksOf(ctx, who, [day, day + 1]).filter((a) => a.ask >= ctx.state.clock && !given.has(a.key)).map((a) => view(who, a.key, a.at, a.place, a.origin.type === "plan" ? a.origin : routineOrigin(who, a.origin.block), "planned", [pov]));
  const laid = blocks.flatMap((b) => (b.origin.type === "invitation" ? [view(b.origin.host, `${b.origin.host}:invited:${b.origin.block}:${day}`, b.start, b.place, routineOrigin(b.origin.host, b.origin.block), "planned", [who])] : []));
  return { made: [...sent.filter((s) => s.host === who), ...coming], received: who === pov ? sent : laid };
}

/** Why a block of the day is there, from its option and reason, as `day` had its routine. */
function originOf(ctx: ReadContext, who: EntityId, option: string, reason: string, day: number): BlockOrigin {
  if (option.startsWith("routine:")) {
    const id = option.slice(8).replace(/:carried$/, "");
    const a = appliedBlock(ctx, who, id, day);
    if (a) return { type: "routine", block: id, owner: ownerOf(ctx, a.level, a.routine?.owner), source: sourceView(ctx, a.source) };
  }
  if (option.startsWith("plan:")) {
    const plan = option.slice(5);
    const p = (optionalQuery(ctx, "minds.plans")?.(ctx, who) ?? []).find((x) => x.id === plan);
    return { type: "plan", plan, source: p?.source ?? "memory", made: p?.made ?? 0 };
  }
  if (option.startsWith("agenda:")) return { type: "agenda", track: option.slice(7) };
  if (option.startsWith("invited:")) {
    const [host = "", block = ""] = option.slice(8).split(":");
    return { type: "invitation", host, block };
  }
  if (option.startsWith("chore:")) return { type: "routine", block: option, owner: ownerOf(ctx, "own", who), source: sourceView(ctx, { type: "sheet", entity: who, field: "chores" }) };
  if (option.startsWith("schedule:")) {
    const schedule = option.slice(9);
    const s = chatSchedulesIn(ctx).find((x) => x.id === schedule);
    return { type: "schedule", schedule, owner: scheduleOwner(ctx, schedule, s ? ownerRank(ctx.registry, ctx.world, ctx.state, s) : null, s?.owner), source: sourceView(ctx, s?.source ?? { type: "authored" }) };
  }
  if (reason === "appointment") return { type: "appointment" };
  if (reason === "trip") return { type: "trip" };
  return { type: "free" };
}

/**
 * One character's routine, schedules and day as the GM reads them (DESIGN §8): everything, secrets
 * included. `day` is a day index (default today).
 */
export function routineGmView(ctx: ReadContext, who: EntityId, day = dateAt(calendarOf(ctx.world), ctx.state.clock).dayIndex): RoutineGmView {
  const cal = calendarOf(ctx.world);
  const e = own(ctx.state.entities, who);
  // The routine as `day` has it, as the planner lays it: a block the story added is theirs from the day after its turn.
  const blocks: EffectiveBlock[] = [...routineCandidates(ctx, who, day).values()].flatMap((list) => {
    const [top, ...rest] = list;
    if (!top) return [];
    return [{ block: top.entry, routine: top.routine?.id ?? null, owner: ownerOf(ctx, top.level, top.routine?.owner), source: sourceView(ctx, top.source), off: isOff(top.entry), shadowed: rest.map((a) => ({ routine: a.routine?.id ?? null, owner: ownerOf(ctx, a.level, a.routine?.owner), source: sourceView(ctx, a.source), block: a.entry })) }];
  });
  const changes = chatSchedules(ctx.state, who);
  const mine = chatSchedulesIn(ctx).filter((s) => scheduleOwners(ctx.registry, ctx.world, ctx.state, s).includes(who) || own(changes, s.id) !== undefined);
  const schedules: EffectiveSchedule[] = mine.map((s) => {
    const rank = ownerRank(ctx.registry, ctx.world, ctx.state, s);
    const c = own(changes, s.id);
    return {
      schedule: s.id,
      target: s.target,
      owner: scheduleOwner(ctx, s.id, rank, s.owner),
      source: sourceView(ctx, s.source ?? { type: "authored" }),
      recurrence: s.recurrence,
      slots: s.slots.map((slot) => ({ ...slot, sourceView: sourceView(ctx, slot.source ?? s.source ?? { type: "authored" }) })),
      shadowedBy: mine.filter((o) => o.id !== s.id && o.target === s.target && (o.id.includes("@") || (ownerRank(ctx.registry, ctx.world, ctx.state, o) ?? 9) < (rank ?? 9))).map((o) => o.id),
      chat: c ? { ...c.value, source: sourceView(ctx, c.source) } : null,
    };
  });
  const plan = dayPlan(ctx, who, day);
  // A morning carried over from the night before is that night's block, as its day had it.
  const laid: LaidBlock[] = plan.blocks.map((b) => ({ start: b.start, end: b.end, from: formatHHMM(dateAt(cal, b.start).minuteOfDay), to: formatHHMM(dateAt(cal, b.end).minuteOfDay), label: b.label, activity: b.activity, place: b.place, placeName: b.place ? (own(ctx.world.places, b.place)?.name ?? b.place) : null, kind: kindOfBlock(b.activity), reasons: b.reasons, origin: originOf(ctx, who, b.option, b.reasons[0] ?? "", b.option.endsWith(":carried") ? day - 1 : day) }));
  // What the story holds now: holds (a plan under way, a trip, an override), and a place the routine would have them elsewhere than.
  const story: StoryHoldView[] = [];
  const holds = objOf(e?.fields.holds);
  for (const field of ["place", "activity"] as const) {
    const until = holds[field];
    const value = e?.fields[field] ?? null;
    if (typeof until === "number" && until > ctx.state.clock) story.push({ field, value, label: field === "place" ? (own(ctx.world.places, strOf(value))?.name ?? strOf(value)) : strOf(value), since: null, until, by: plan.blocks.some((b) => b.option.startsWith("plan:") && b.end === until) ? "plan" : strOf(e?.fields.activity) === "trip" ? "trip" : "override" });
  }
  const now = plan.blocks.find((b) => b.start <= ctx.state.clock && ctx.state.clock < b.end);
  if (now?.place && e?.fields.place !== now.place && !story.some((s) => s.field === "place")) {
    const awareness = followOf(ctx, who).awareness;
    const bed = plan.blocks.find((b) => b.start > ctx.state.clock && b.activity === "sleep")?.start ?? null;
    story.push({ field: "place", value: e?.fields.place ?? null, label: own(ctx.world.places, strOf(e?.fields.place))?.name ?? strOf(e?.fields.place), since: null, until: awareness === "story_first" ? null : awareness === "balanced" ? bed : now.end, by: "story" });
  }
  return {
    entity: who,
    name: e?.name ?? who,
    tier: optionalQuery(ctx, "minds.tier")?.(ctx, who) ?? null,
    planned: livesPlans(ctx, who),
    follow: { ...followOf(ctx, who), role: routineRole(ctx, who) },
    settings: routineSettingsOf(ctx.world),
    blocks,
    schedules,
    day: { index: day, label: formatClock(cal, plan.blocks[0]?.start ?? ctx.state.clock).split(" ")[0] ?? "", blocks: laid },
    story,
    invitations: invitationsOf(ctx, who, laid),
  };
}

/**
 * One character's day as the POV may know it (DESIGN §7): what Cast shows of them, with why; null
 * when the POV may not know them at all (the request answers as for no one). `day` is null unless
 * Cast would show their day: present and seen, an agent, acting as the POV knows, Cast life 3 and up.
 */
export function routinePlayerView(ctx: ReadContext, who: EntityId): RoutinePlayerView | null {
  const pov = ctx.world.pov;
  const e = own(ctx.state.entities, who);
  const here = placeOfEntity(ctx.state, pov);
  const present = !!e && here !== null && placeOfEntity(ctx.state, who) === here;
  if (!e || who === pov || !(present ? canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, who) : playerKnows(ctx.registry, ctx.world, ctx.state, pov, who))) return null;
  const life = povLife(ctx.world, ctx.state, who);
  if (!(present && e.agent && (life === null || life.acts) && ctx.levelOf(pov, "castlife") >= 3)) return { entity: who, name: e.name, day: null };
  const blocks = playerBlocks(ctx, who, dayPlan(ctx, who)).map((b) => ({ from: b.from, to: b.to, label: b.label, kind: b.kind, reasons: b.reasons, source: b.source }));
  return { entity: who, name: e.name, day: { label: formatClock(calendarOf(ctx.world), ctx.state.clock).split(" ")[0] ?? "", blocks } };
}

/** Everyone this chat changed (GM → Routine's list badge): their follow setting, the blocks and the schedules it changed. */
export function routineChanges(ctx: ReadContext): RoutineChangeSummary[] {
  const s = sliceOf(ctx.state, "castlife");
  const who = new Set([...Object.keys(objOf(s.follow)), ...Object.keys(objOf(s.routines)), ...Object.keys(objOf(s.schedules))]);
  return [...who].sort().map((id) => ({
    entity: id,
    name: own(ctx.state.entities, id)?.name ?? id,
    follow: chatFollow(ctx.state, id),
    blocks: Object.entries(chatBlocks(ctx.state, id)).map(([block, c]) => ({ block, source: c.source, off: isOff(c.value) })),
    schedules: Object.entries(chatSchedules(ctx.state, id)).map(([schedule, c]) => ({ schedule, source: c.source, off: "off" in c.value })),
  }));
}
