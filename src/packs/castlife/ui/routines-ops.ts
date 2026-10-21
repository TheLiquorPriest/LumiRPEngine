// GM → Routines (DESIGN §8): the per-chat routine controls as `lre.edit` operations, and what the tab
// reads from the read model (`lre.routine`): how much a character's routine binds them now, who
// changed whose routine in this chat, and the changes the story made. Every control is one edit, so
// one Corrected chip with its Undo; the backend stamps the change as the GM's, at the chat's time.
// A form's draft is refused (null) when it wouldn't make a valid change, so its Save says so first.

import type { EntityId, ScheduleId } from "../../../shared/ids";
import { nameOfId } from "../../../shared/maps";
import type { Fidelity } from "../../../shared/minds";
import type { EditOp } from "../../../shared/protocol";
import type { BlockOrigin, ChatRoutineSource, EffectiveBlock, EffectiveSchedule, InvitationView, OwnerRef, RoutineAwareness, RoutineBlock, RoutineBlockId, RoutineChangeSummary, RoutineGmView, RoutineMode, RoutinePlace, RoutineRole, SkipLife, SourceView, StoryHoldView } from "../../../shared/routines";
import { blockShapeProblems, isOff, PLAN_BEND_LABEL, ROUTINE_ROLE_LABEL } from "../../../shared/routines";
import type { GmEntity } from "../../../shared/state-view";
import type { Recurrence, ScheduleDef, ScheduleSlot } from "../../../shared/world";
import { slotProblems } from "../../../frontend/build/schedule-form";
import { formatMinutes, humanize } from "../../../frontend/format";

// ---------------------------------------------------------------- how much the routine binds them

/**
 * How much a character's routine binds them now, from their effective role (`RoutineRole`): it leads
 * (enforced, and the planner lays their day), the story leads and it only informs (informative, or
 * enforced with no day laid), or they have none (their role is off, or their routine is off in this chat).
 */
export type RoutineBinding = "routine" | "story" | "none";

export const BINDING_LABEL: Record<RoutineBinding, string> = { routine: "Routine leads", story: "Story leads; routine informs", none: "No routine" };

/** The binding from their effective role, how they follow their routine in this chat, and whether the planner lays their day. */
export function bindingOf(role: RoutineRole, mode: RoutineMode, planned: boolean): RoutineBinding {
  if (mode === "off" || role === "off") return "none";
  return role === "enforced" && planned ? "routine" : "story";
}

/** Their effective role as the engine reads it: this chat's for them, else their level's; without minds, Background's. */
export function effectiveRole(tier: Fidelity | null, roles: Readonly<Record<Fidelity, RoutineRole>>, chat: RoutineRole | null | undefined): RoutineRole {
  return chat ?? roles[tier ?? "background"];
}

/** Whether the planner lays their day, as the GM view's entity shows it: an agent who acts, at Cast life 3 or higher, not removed. The character's page reads it from the read model. */
export function plannedHint(entity: GmEntity | undefined): boolean {
  if (!entity || entity.gone || !entity.agent || !entity.life.acts) return false;
  return (entity.levels.find((l) => l.domain === "castlife")?.level ?? 0) >= 3;
}

export const TIER_LABEL: Record<Fidelity, string> = { live: "Live", near: "Near", far: "Far", background: "Background" };

/** One character in the tab's list: their fidelity, how much their routine binds them, and who changed it in this chat. */
export interface RoutineRow {
  entity: EntityId;
  name: string;
  tier: Fidelity;
  binding: RoutineBinding;
  changed: ChangedBy | null;
}

/** The list's rows: every person but the POV, as the minds ladder orders them, each bound by their effective role (`roles`, the world's) and marked as this chat changed them (`lre.routine {op: "changed"}`). */
export function routineRows(characters: readonly { entity: EntityId; name: string; fidelity: { level: Fidelity } }[], entities: readonly GmEntity[], changed: readonly RoutineChangeSummary[], roles: Readonly<Record<Fidelity, RoutineRole>>): RoutineRow[] {
  return characters.map((c) => {
    const summary = changed.find((s) => s.entity === c.entity);
    const role = effectiveRole(c.fidelity.level, roles, summary?.follow?.role);
    const binding = bindingOf(role, summary?.follow?.mode ?? "follows", plannedHint(entities.find((e) => e.id === c.entity)));
    return { entity: c.entity, name: c.name, tier: c.fidelity.level, binding, changed: changedBy(summary) };
  });
}

/** What each way of following their routine means in this chat. */
export const MODE_NOTE: Record<RoutineMode, string> = {
  follows: "Their routine and schedules count as their role says.",
  no_invitations: "As they follow it, but their routine makes and accepts no invitations.",
  off: "No routine at all in this chat, not even as context: only the story, your edits, their commitments and their basic needs.",
};

/** What each role means for one character, for choosing one. */
export const ROLE_NOTE: Record<RoutineRole, string> = {
  informative: "The story and planning decide what they do; their routine and schedules are only context their mind and the narrator may weigh.",
  enforced: "The planner lives their routine and their schedules run whenever the story doesn't hold them, never in a scene with you.",
  off: "Their routine isn't used at all, not even as context.",
};

/** What each way of spending a time skip means, for someone whose routine is informative (Build's levels and the GM's per character). */
export const SKIP_NOTE: Record<SkipLife, string> = {
  stay: "They stay where the story has them while the time passes.",
  routine: "They go about their usual routine through the skip, unless a story plan, a trip or an appointment covers them.",
  model: "At the skip's start the helper model plans their time from their routine, plans and the story; if it can't, they stay.",
};

/** What each awareness does (DESIGN §8), for choosing one: it shapes only an enforced routine. */
export const AWARENESS_NOTE: Record<RoutineAwareness, string> = {
  story_first: "An enforced routine bends for story plans and your intent, and what the story set holds until the story or you release it.",
  balanced: "Background characters keep an enforced routine; others bend it for story plans and intent. What the story set holds for the rest of that day.",
  routine_first: "An enforced routine holds, bending only as the world lets story plans bend it. What the story set holds until the routine's next block.",
};

/** What an enforced routine does under each awareness, for Background (and those without minds) and for anyone closer (DESIGN §8, `RoutineAwareness`). */
const ENFORCED_NOTE: Record<RoutineAwareness, Record<"background" | "closer", string>> = {
  story_first: {
    background: "Off screen they keep to their routine, but bend for story plans and your intent. What the story set holds until the story or you release it.",
    closer: "Their routine leads, but they bend for story plans and your intent. What the story set holds until the story or you release it.",
  },
  balanced: {
    background: "Off screen they keep their routine and schedules. What the story set holds for the rest of that day.",
    closer: "Their routine leads, but they bend for story plans and intent. What the story set holds for the rest of that day.",
  },
  routine_first: {
    background: "They keep to their routine. What the story set holds until their routine's next block.",
    closer: "They keep to their routine. What the story set holds until their routine's next block.",
  },
};

/** Why they're bound as they are, in sentences, from their read model. */
export function bindingNote(view: Pick<RoutineGmView, "tier" | "planned" | "follow" | "settings">): string[] {
  const always = "Nobody is moved out of a scene with you, and no routine interrupts play.";
  if (view.follow.mode === "off") return ["No routine in this chat: their day is the story, your edits, their commitments and their basic needs.", always];
  const role = view.follow.role;
  const lines = [`${ROUTINE_ROLE_LABEL[role]}: ${ROLE_NOTE[role]}`];
  lines.push(view.follow.chat?.role ? "You set their role in this chat." : view.tier ? `The role of their level, ${TIER_LABEL[view.tier]}, as the world sets it.` : "Without minds there is no level of closeness: they take Background's role.");
  if (role === "enforced" && !view.planned) lines.push("The planner doesn't lay their day (it needs an agent who acts, at Cast life 3 or higher), so their routine only informs.");
  if (role === "enforced" && view.planned) {
    const awareness = view.follow.awareness;
    lines.push(ENFORCED_NOTE[awareness][view.tier === null || view.tier === "background" ? "background" : "closer"]);
    if (awareness === "routine_first") lines.push(`Story plans bend it only as the world allows: ${PLAN_BEND_LABEL[view.settings.planBend].toLowerCase()}.`);
  }
  if (role !== "off" && view.follow.mode === "no_invitations") lines.push("They make and accept no invitations.");
  lines.push(always);
  return lines;
}

// ---------------------------------------------------------------- what the chat changed

/** Who changed someone's routine or schedules in this chat: the GM (a follow setting is always the GM's), the story's replies, the player's own messages (asked, and answered Yes), or more than one of them. */
export type ChangedBy = "gm" | "story" | "player" | "gm_story" | "gm_player" | "story_player" | "all";

/** Who changed someone's routine or schedules in this chat; null when nothing changed. */
export function changedBy(summary: RoutineChangeSummary | undefined): ChangedBy | null {
  if (!summary) return null;
  const sources: ChatRoutineSource[] = [...summary.blocks.map((b) => b.source), ...summary.schedules.map((s) => s.source)];
  const gm = summary.follow !== null || sources.some((s) => s.type === "gm");
  const story = sources.some((s) => s.type === "story" && s.by !== "player");
  const player = sources.some((s) => s.type === "story" && s.by === "player");
  if (gm && story && player) return "all";
  if (gm) return story ? "gm_story" : player ? "gm_player" : "gm";
  if (story) return player ? "story_player" : "story";
  return player ? "player" : null;
}

export const CHANGED_LABEL: Record<ChangedBy, string> = {
  gm: "Changed by you",
  story: "Changed by the story",
  player: "Changed from your message",
  gm_story: "Changed by you and the story",
  gm_player: "Changed by you and from your message",
  story_player: "Changed by the story and from your message",
  all: "Changed by you, the story and your message",
};

/** A source as a row reads it: its label, and for a change this chat made (the story's or yours) how long ago, by the chat's clock. */
export function sourceWords(source: SourceView, now: number): string {
  if (source.type !== "story" && source.type !== "gm") return source.label;
  return `${source.label}, ${source.at >= now ? "just now" : `${formatMinutes(now - source.at)} ago`}`;
}

/**
 * A change the story made to their routine or schedules in this chat, as `lre.routine {op: "changed"}`
 * records it (the time and the turn), with the block or schedule as the read model has it now. A
 * block the story adds is in force from the day after it made it: until then the read model has the
 * block it will replace, if any, and never the story's.
 */
export type StoryChange =
  | { kind: "block"; id: RoutineBlockId; source: Extract<ChatRoutineSource, { type: "story" }>; off: boolean; block: EffectiveBlock | null; label?: string }
  | { kind: "schedule"; id: ScheduleId; source: Extract<ChatRoutineSource, { type: "story" }>; off: boolean; schedule: EffectiveSchedule | null };

/** The changes the story made to their routine and schedules in this chat (`summary`, what the chat changed of them), in the order the story made them. */
export function storyChanges(view: Pick<RoutineGmView, "blocks" | "schedules">, summary: RoutineChangeSummary | undefined): StoryChange[] {
  const out: StoryChange[] = [];
  for (const b of summary?.blocks ?? []) if (b.source.type === "story") out.push({ kind: "block", id: b.block, source: b.source, off: b.off, block: view.blocks.find((x) => x.block.id === b.block) ?? null, ...(b.label !== undefined ? { label: b.label } : {}) });
  for (const s of summary?.schedules ?? []) if (s.source.type === "story") out.push({ kind: "schedule", id: s.schedule, source: s.source, off: s.off, schedule: view.schedules.find((x) => x.schedule === s.schedule) ?? null });
  return out.sort((a, b) => a.source.at - b.source.at);
}

// ---------------------------------------------------------------- words for the read model

/** Whose a block or schedule is, as a row's line reads it. */
export function ownerWords(owner: OwnerRef): string {
  switch (owner.level) {
    case "chat":
      return "Changed in this chat";
    case "own":
      return "Their own";
    case "group":
      return `Group: ${owner.name}`;
    case "kind":
      return `Kind: ${owner.name}`;
    case "selector":
      return `Selector: ${owner.name}`;
    case "world":
      return "The world's default";
    case "builtin":
      return "Basic needs";
  }
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** When a block happens: a fixed block's start and length, a flexible or optional one's length in its window, how often, how likely. */
export function blockWhen(block: RoutineBlock): string {
  const length = formatMinutes(block.minutes);
  if (block.kind === "fixed") return `${block.at ?? "—"} for ${length}`;
  const parts = [`${length} between ${block.window?.from ?? "—"} and ${block.window?.to ?? "—"}`];
  if (block.perWeek !== undefined) parts.push(`${block.perWeek}× a week`);
  if (block.kind === "optional") parts.push(`${Math.round((block.chance ?? 0.5) * 100)}% likely`);
  return parts.join(", ");
}

/** The days a block is on, when it isn't every day. */
export function daysWords(block: RoutineBlock): string | null {
  const d = block.days;
  if (!d) return null;
  const parts: string[] = [];
  if (d.weekdays && d.weekdays.length > 0 && d.weekdays.length < 7) parts.push([...d.weekdays].sort((a, b) => a - b).map((w) => WEEKDAY[w] ?? String(w)).join(" "));
  if (d.off === "only") parts.push("days off only");
  if (d.off === "never") parts.push("not on days off");
  if (d.holidays && d.holidays.length > 0) parts.push(`on ${d.holidays.map(humanize).join(", ")}`);
  if (d.except && d.except.length > 0) parts.push(`not on ${d.except.map(humanize).join(", ")}`);
  if (d.birthday === "own") parts.push("on their birthday");
  if (d.birthday === "friend") parts.push("on a friend's birthday");
  if (d.seasons && d.seasons.length > 0) parts.push(`in ${d.seasons.join(", ")}`);
  if (d.weather) parts.push(`in ${d.weather} weather`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Where a block happens, places by name. */
export function placeWords(place: RoutinePlace | undefined, placeName: (id: string) => string): string {
  if (place === undefined || place === "home") return "At home";
  if (place === "work") return "At work";
  if (place === "here") return "Wherever they are";
  if (place === "with") return "At their company's home";
  return "place" in place ? `At ${placeName(place.place)}` : `At the nearest ${humanize(place.nearest).toLowerCase()}`;
}

/** Why a block of their day is there. */
export function originWords(origin: BlockOrigin, name: (id: string) => string): string {
  switch (origin.type) {
    case "routine":
      return origin.owner.level === "builtin" ? "Routine · Basic needs" : `Routine · ${ownerWords(origin.owner)} · ${origin.source.label}`;
    case "schedule":
      return origin.owner.level === "chat" ? `Their own schedule in this chat · ${origin.source.label}` : `Schedule ${nameOfId(origin.schedule)} · ${ownerWords(origin.owner)} · ${origin.source.label}`;
    case "appointment":
      return "An appointment";
    case "trip":
      return "A trip";
    case "plan":
      return origin.source === "gm" ? "Your plan for them" : origin.source === "memory" ? "A plan from the story" : "A plan from their mind";
    case "agenda":
      return `Their agenda: ${name(origin.track)}`;
    case "invitation":
      return `${name(origin.host)}'s invitation`;
    case "free":
      return "Free time";
  }
}

/** Where an invitation came from: its ground. */
export function invitationGround(origin: InvitationView["origin"]): string {
  switch (origin.type) {
    case "plan":
      return "From a plan the story made";
    case "routine":
      return `From their routine's ${nameOfId(origin.block)} · ${origin.source.label}`;
    case "gm":
      return "From you";
    case "legacy":
      return "Recorded before invitations needed a ground";
  }
}

/** How long a hold or a schedule switched off lasts, from the chat's clock. */
export function untilWords(until: number | null, now: number): string {
  if (until === null) return "until the story or you release it";
  return until <= now ? "ending now" : `for ${formatMinutes(until - now)} more`;
}

export const HOLD_BY: Record<StoryHoldView["by"], string> = { story: "The story set it", trip: "A trip", override: "An override", plan: "A plan under way" };

// ---------------------------------------------------------------- the controls

/**
 * How they follow their routine in this chat: following it is the world's way, so it clears the
 * chat's mode; a null awareness is the world's, a null role or skip life their level's. All cleared
 * clear the setting.
 */
export function followOp(entity: EntityId, mode: RoutineMode, awareness: RoutineAwareness | null, role: RoutineRole | null, skips: SkipLife | null): EditOp {
  return { op: "routine_follow", entity, mode: mode === "follows" ? null : mode, awareness, role, skips };
}

/** A block of their routine for this chat, added or changed: its shape must read (the backend stamps it as yours). Refused, with the problems, when it doesn't. */
export function blockOp(entity: EntityId, block: RoutineBlock): { op: EditOp } | { problems: string[] } {
  const value: RoutineBlock = { ...block };
  delete value.source;
  const problems = blockShapeProblems(value, false);
  return problems.length > 0 ? { problems } : { op: { op: "routine_block", entity, block: value.id, value } };
}

/** Switches a block off for them in this chat: one of their routine's, or a basic need. */
export function blockOffOp(entity: EntityId, block: RoutineBlockId): EditOp {
  return { op: "routine_block", entity, block, value: { id: block, off: true } };
}

/** Drops this chat's change to a block: the world's block again, or none when the chat added it. */
export function dropBlockOp(entity: EntityId, block: RoutineBlockId): EditOp {
  return { op: "routine_block", entity, block, value: null };
}

/** Their own version of a schedule in this chat: these slots, and its recurrence only when it differs from the schedule's. Refused, with the problems, while the slots don't read. */
export function scheduleOwnOp(entity: EntityId, schedule: ScheduleId, slots: ScheduleSlot[], recurrence: Recurrence, was: Recurrence): { op: EditOp } | { problems: string[] } {
  const problems = slots.length === 0 ? ["Give it at least one slot."] : slotProblems(slots);
  if (problems.length > 0) return { problems };
  const same = JSON.stringify(recurrence) === JSON.stringify(was);
  return { op: { op: "schedule_override", entity, schedule, value: same ? { slots } : { slots, recurrence } } };
}

/** Switches a schedule off for them in this chat, until a time (game minutes) or, with null, until you clear it. */
export function scheduleOffOp(entity: EntityId, schedule: ScheduleId, until: number | null): EditOp {
  return { op: "schedule_override", entity, schedule, value: { off: true, until } };
}

/** Drops this chat's change to a schedule: they follow the world's again. */
export function dropScheduleOp(entity: EntityId, schedule: ScheduleId): EditOp {
  return { op: "schedule_override", entity, schedule, value: null };
}

/** The schedule the GM's version starts from: the chat's own version when there is one, else the schedule as it applies to them, its slots without their sources (the version is yours). */
export function scheduleDraft(effective: EffectiveSchedule, entity: EntityId): ScheduleDef {
  const own = effective.chat && "slots" in effective.chat ? effective.chat : null;
  const slots = (own?.slots ?? effective.slots).map((slot) => {
    const plain: ScheduleSlot = { start: slot.start, end: slot.end };
    if (slot.value !== undefined) plain.value = structuredClone(slot.value);
    if (slot.weighted) plain.weighted = structuredClone(slot.weighted);
    if (slot.given) plain.given = structuredClone(slot.given);
    return plain;
  });
  return { id: effective.schedule, owner: entity, target: effective.target, recurrence: structuredClone(own?.recurrence ?? effective.recurrence), slots };
}

/** What a schedule sets, as its row says it. */
export function targetWords(target: string): string {
  return target === "place" ? "where they are" : target === "activity" ? "what they're doing" : humanize(target).toLowerCase();
}

/**
 * Their schedules as the tab lists them: the world's that apply to them, the most specific owner first
 * for each thing schedules set. A chat's own version of a schedule shows on the one it replaces (its
 * `chat`), so it isn't listed apart, and `over` names only the world's schedules that win over each.
 */
export function scheduleRows(view: Pick<RoutineGmView, "schedules">): { schedule: EffectiveSchedule; over: ScheduleId[] }[] {
  const versions = view.schedules.filter((s) => s.owner.level === "chat").map((s) => s.schedule);
  return view.schedules
    .filter((s) => s.owner.level !== "chat")
    .sort((a, b) => a.target.localeCompare(b.target) || a.owner.rank - b.owner.rank || a.schedule.localeCompare(b.schedule))
    .map((schedule) => ({ schedule, over: schedule.shadowedBy.filter((id) => !versions.includes(id)) }));
}

/** The block a chat change starts from: the effective one as it is (not one switched off), else a fresh one. */
export function blockDraft(effective: EffectiveBlock | undefined, fresh: RoutineBlock): RoutineBlock {
  if (!effective) return fresh;
  if (!isOff(effective.block)) return structuredClone(effective.block);
  const under = effective.shadowed.map((s) => s.block).find((b): b is RoutineBlock => !isOff(b));
  return under ? { ...structuredClone(under), id: effective.block.id } : { ...fresh, id: effective.block.id };
}

/** Whether a block's shadows say what it replaces, as a line: the owners it wins over. */
export function shadowWords(block: EffectiveBlock): string | null {
  if (block.shadowed.length === 0) return null;
  return `Over ${block.shadowed.map((s) => (s.owner.level === "builtin" ? "the basic need" : ownerWords(s.owner).toLowerCase())).join(", ")}`;
}
