// Routines (DESIGN §8, §24.8, §4.1): the dependable shape of a character's days, as world data, as a
// chat changes it, and as the GM and the player read it. A routine and a schedule are defaults the
// world relies on, never authority: what the story establishes always wins over them, and neither
// ever moves someone out of a scene with the POV, contradicts the narration or interrupts play.
//
// Where a character's day comes from, most binding first:
//   1. what the story established: a place or activity the story's events set (an action, the
//      narration's read, a GM edit), holds (trips, overrides, a plan under way) and the GM's intent;
//   2. their commitments: schedules (shifts, school), appointments and trips;
//   3. their story plans (the memory step's and the GM's), laid into their windows (§24.8);
//   4. their routine: the blocks of this collection that apply to them (below), else none;
//   5. their basic needs: sleep and meals (`BASIC_BLOCKS`), at home or at work, or wherever the
//      story has them. A character with no routine at all plans from the story and these only.
//
// The world's data is only where a chat starts: the GM changes a character's routine or schedules in
// a chat (`RoutineEditOp`, one `fix` entry with its Undo), and the story changes them too (a new job,
// a move, a new habit read from a reply), recorded with the turn it came from.

import type { EntityId, KindId, MessageId, PlaceId, ScheduleId, SceneTypeId } from "./ids";
import type { JsonValue } from "./json";
import { hasOwn, isRecord } from "./json";
import { FIDELITIES, type Fidelity } from "./minds";
import type { Recurrence, ScheduleSlot, Selector } from "./world";

// ---------------------------------------------------------------- world data

export type RoutineId = string;
/**
 * A block's name in a routine. Across owners it is the block's identity: a more specific owner's
 * block with the same id replaces a less specific one's, and the built-in basic needs answer to
 * `sleep`, `breakfast`, `lunch` and `dinner`.
 */
export type RoutineBlockId = string;

/**
 * How a block is laid:
 *  - `fixed`: at its time (`at`) on each day it's on, for `minutes`;
 *  - `flexible`: `minutes` somewhere in its window, where the day has room for it; with `perWeek`,
 *    on that many of the days it's on each week (a floating block: "the gym three times a week");
 *  - `optional`: as flexible, but only likely: on a day it's on, it happens with its `chance`, and
 *    it's the first thing a busier day leaves out.
 */
export type RoutineBlockKind = "fixed" | "flexible" | "optional";
export const ROUTINE_BLOCK_KINDS: readonly RoutineBlockKind[] = ["fixed", "flexible", "optional"];

/**
 * Where a block or a schedule rests. In world data: `authored` (absent means it), a `lore` entry or a
 * `sheet` field, each with the short quote it rests on. In a chat: the `story` (the turn whose reply
 * established it, at its clock time; `by: "player"` when the player's own message stated it and the
 * player said yes to adding it) or the `gm`. `builtin` is the basic needs'.
 */
export type RoutineSource =
  | { type: "authored" }
  | { type: "lore"; entry: string; quote?: string }
  | { type: "sheet"; entity: EntityId; field: string; quote?: string }
  | { type: "builtin" }
  | { type: "story"; at: number; turn?: MessageId; by?: "player" }
  | { type: "gm"; at: number };
/** The sources world data may carry. */
export type WorldRoutineSource = Extract<RoutineSource, { type: "authored" | "lore" | "sheet" }>;
/** The sources a chat's own change carries. */
export type ChatRoutineSource = Extract<RoutineSource, { type: "story" | "gm" }>;

/**
 * Where a block happens: their `home`; their `work` (their workplace, else home); `here`, wherever
 * they are when it starts (the story's place); `with`, the home of the first of its company (a
 * friend's birthday, a visit); a place by id; or the nearest place of a scene type to their home.
 */
export type RoutinePlace = "home" | "work" | "here" | "with" | { place: PlaceId } | { nearest: SceneTypeId };

export type RoutineSeason = "spring" | "summer" | "autumn" | "winter";

/** The days a block is on. Every constraint given must hold; none given: every day. */
export interface RoutineDays {
  /** Weekdays, 0 = Sunday. */
  weekdays?: number[];
  /** `only` on days off (the weekend, a holiday that gives one), or `never` on them. */
  off?: "only" | "never";
  /** Only on these holidays or observances (the calendar's ids). */
  holidays?: string[];
  /** Never on these. */
  except?: string[];
  /** Only on their own birthday, or on the birthday of someone they're close to (regard 30 and up). */
  birthday?: "own" | "friend";
  /** Only in these seasons (Weather 1 and up; ignored without a season). */
  seasons?: RoutineSeason[];
  /** Only in this weather (Weather 2 and up; ignored without it). */
  weather?: "fair" | "foul";
}

/** Who a block is with, and whether it asks them along (an invitation, under `RoutineSettings.invitations`). */
export interface RoutineCompany {
  who: Selector;
  invite?: boolean;
}

export interface RoutineBlock {
  id: RoutineBlockId;
  /** How the block reads ("Opens the shop", "Dinner with the family"). */
  label: string;
  /** The activity it sets: `sleep`, `breakfast`, `lunch`, `dinner`, `work`, `socialize`, `leisure`, or the world's own. */
  activity: string;
  kind: RoutineBlockKind;
  /** `fixed`: its start, HH:MM. */
  at?: string;
  /** `flexible` and `optional`: when it may start, HH:MM to HH:MM (a `to` at or before `from` runs past midnight). */
  window?: { from: string; to: string };
  /** How long, 1 to 1,440 minutes. */
  minutes: number;
  /** `flexible` and `optional`: on how many of the days it's on each week, 1 to 7; absent: all of them. */
  perWeek?: number;
  /** `optional`: how likely it is on a day it's on, above 0 and at most 1; absent: 0.5. */
  chance?: number;
  /** How much it matters when blocks compete for the same free time, 1 to 5 as a plan's priority reads; absent: 3. */
  priority?: number;
  days?: RoutineDays;
  /** Absent: `home`. */
  place?: RoutinePlace;
  company?: RoutineCompany;
  /** The needs it meets (`hunger`, `fatigue`, `social`, `fun`); absent: those its activity meets. */
  needs?: string[];
  /** The player reads it as "Busy", never its label or activity. */
  private?: boolean;
  /** Absent: the routine's own, else `authored`. */
  source?: RoutineSource;
}

/** A block that turns off a less specific owner's block of the same id (or a basic need) for whom its routine covers. */
export interface RoutineBlockOff {
  id: RoutineBlockId;
  off: true;
  source?: RoutineSource;
}

/** What a routine's list holds: blocks, and blocks turned off. */
export type RoutineEntry = RoutineBlock | RoutineBlockOff;

/** Whether an entry turns a block off. */
export function isOff(entry: RoutineEntry): entry is RoutineBlockOff {
  return "off" in entry && entry.off === true;
}

/**
 * A routine (`world.routines`, Build → Routines): blocks for an owner, as a schedule's owner reads
 * (DESIGN §4.1): absent, the world's default for everyone the planner plans; an entity; a group (its
 * members that aren't groups); a kind (with inheritance); or a selector. For each block id the most
 * specific owner wins: their own, then a group's, then a kind's, then a selector's, then the world's
 * default, then the basic needs. Equal-precedence routines that set the same block for the same
 * person are linted (`routine.overlap`); the routine with the lower id wins.
 */
export interface RoutineDef {
  id: RoutineId;
  label?: string;
  owner?: EntityId | KindId | Selector;
  /** False: blocks of less specific routines don't apply to whom this one covers (the basic needs still do, unless a block turns them off). Absent: true. */
  inherit?: boolean;
  blocks: RoutineEntry[];
  /** Its blocks' source when they give none. Absent: `authored`. */
  source?: WorldRoutineSource;
}

/** The built-in basic needs (source `builtin`): everyone's unless a routine replaces or turns one off. */
export const BASIC_BLOCKS: readonly RoutineBlock[] = Object.freeze([
  { id: "sleep", label: "Sleep", activity: "sleep", kind: "flexible", window: { from: "21:30", to: "01:00" }, minutes: 480, priority: 5, place: "home", needs: ["fatigue"], source: { type: "builtin" } },
  { id: "breakfast", label: "Breakfast", activity: "breakfast", kind: "flexible", window: { from: "06:00", to: "10:00" }, minutes: 30, priority: 4, place: "home", needs: ["hunger"], source: { type: "builtin" } },
  { id: "lunch", label: "Lunch", activity: "lunch", kind: "flexible", window: { from: "11:00", to: "14:00" }, minutes: 45, priority: 4, place: "work", needs: ["hunger"], source: { type: "builtin" } },
  { id: "dinner", label: "Dinner", activity: "dinner", kind: "flexible", window: { from: "17:00", to: "21:00" }, minutes: 60, priority: 4, place: "home", needs: ["hunger"], source: { type: "builtin" } },
] satisfies RoutineBlock[]);

// ---------------------------------------------------------------- the world's settings

/**
 * How strictly people keep to routine against the story (DESIGN §8), for whom their routine is
 * enforced (`RoutineRole`). In every setting what the story established holds, nobody is moved out
 * of a scene with the POV, and no routine interrupts play. On top of that:
 *  - `story_first`: they bend for story plans and the GM's intent; what the story set holds until
 *    the story or the GM releases it;
 *  - `balanced` (the default, the precedence by fidelity): Background characters keep their routine
 *    and schedules, the rest bend for story plans and intent; what the story set holds for the rest
 *    of that day;
 *  - `routine_first`: they keep to routine, bending only as the plan priority rule says
 *    (`planBend`); what the story set holds until the routine's next block.
 */
export type RoutineAwareness = "story_first" | "balanced" | "routine_first";
export const ROUTINE_AWARENESS: readonly RoutineAwareness[] = ["story_first", "balanced", "routine_first"];

/** Whom routine blocks may invite: nobody, only the POV, or anyone (people's days take each other's invitations). Story plans and the GM need no setting: they're invitations' own ground. */
export type RoutineInvitations = "off" | "player" | "everyone";
export const ROUTINE_INVITATIONS: readonly RoutineInvitations[] = ["off", "player", "everyone"];

/** How social people are: how fast the social and fun needs grow (half, as they are, half again). */
export type RoutineSociability = "reserved" | "usual" | "outgoing";
export const ROUTINE_SOCIABILITY: readonly RoutineSociability[] = ["reserved", "usual", "outgoing"];

/**
 * How strongly story plans bend routine work and school, as the plan priority rule reads (§24.8):
 * `must`, only a plan that must happen (5); `strong`, strong plans (4 and 5) for anyone; `standard`
 * (the default), strong plans, and for a Live or Near character an ordinary one (3) at a set time;
 * `ordinary`, strong plans, and an ordinary one at a set time for anyone whose plans are laid.
 */
export type RoutinePlanBend = "must" | "strong" | "standard" | "ordinary";
export const ROUTINE_PLAN_BEND: readonly RoutinePlanBend[] = ["must", "strong", "standard", "ordinary"];

/**
 * What someone's routine and their own place and activity schedules are to the engine (DESIGN §8):
 *  - `informative`: context only, what their mind and the narrator may consider. The planner and their
 *    schedules never move or occupy them by it; narration and context-aware planning (their story
 *    plans, the GM's intent) decide what they do;
 *  - `enforced`: the planner lives it and their schedules run, the story still first (`awareness`);
 *  - `off`: not even context.
 * World schedules (weather, prices, bills, paydays, business hours) and money flows run whatever the
 * role: a job still pays on its schedule when the worker's place isn't enforced. The POV has none: a
 * timelapse says whether its routine runs (`followRoutine`, `paletteFollowsRoutine`).
 */
export type RoutineRole = "informative" | "enforced" | "off";
export const ROUTINE_ROLES: readonly RoutineRole[] = ["informative", "enforced", "off"];
export const ROUTINE_ROLE_LABEL: Record<RoutineRole, string> = { informative: "Informative", enforced: "Enforced", off: "Off" };

/** `world.routineSettings` (Build → Routines → Settings; `lre.editor set part "routineSettings"`, the defaults remove it). */
export interface RoutineSettings {
  awareness: RoutineAwareness;
  invitations: RoutineInvitations;
  sociability: RoutineSociability;
  planBend: RoutinePlanBend;
  /** Each level of closeness's role (DESIGN §24.1 levels, as recomputed); `routine_follow`'s `role` sets one character's in a chat. */
  roles: Record<Fidelity, RoutineRole>;
  /** Whether the narrator gets the usual routines of the characters present, as soft context, never as what they must do. */
  narrator: boolean;
  /** The default of the palette Timelapse's "Follow my routine" choice: false holds the POV where the story has it, as a typed span does. */
  paletteFollowsRoutine: boolean;
}

export const DEFAULT_ROUTINE_ROLES: Readonly<Record<Fidelity, RoutineRole>> = Object.freeze({ live: "informative", near: "informative", far: "informative", background: "enforced" });

export const DEFAULT_ROUTINE_SETTINGS: Readonly<RoutineSettings> = Object.freeze({ awareness: "balanced", invitations: "player", sociability: "usual", planBend: "standard", roles: DEFAULT_ROUTINE_ROLES, narrator: true, paletteFollowsRoutine: false });

export const AWARENESS_LABEL: Record<RoutineAwareness, string> = { story_first: "Story first", balanced: "Balanced", routine_first: "Routine first" };
export const INVITATIONS_LABEL: Record<RoutineInvitations, string> = { off: "Off", player: "To the player only", everyone: "Between everyone" };
export const SOCIABILITY_LABEL: Record<RoutineSociability, string> = { reserved: "Reserved", usual: "Usual", outgoing: "Outgoing" };
export const PLAN_BEND_LABEL: Record<RoutinePlanBend, string> = { must: "Only plans that must happen", strong: "Strong plans", standard: "Strong plans, and set-time plans for the cast", ordinary: "Strong plans, and set-time plans for anyone" };
export const BLOCK_KIND_LABEL: Record<RoutineBlockKind, string> = { fixed: "Fixed", flexible: "Flexible", optional: "Optional" };

/** The world's routine settings, each part the world sets well, the defaults for the rest (a role per level). */
export function routineSettingsOf(world: { readonly routineSettings?: unknown }): RoutineSettings {
  const raw = isRecord(world.routineSettings) ? world.routineSettings : {};
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => allowed.find((a) => a === v) ?? fallback;
  const roles = isRecord(raw.roles) ? raw.roles : {};
  return {
    awareness: pick(raw.awareness, ROUTINE_AWARENESS, DEFAULT_ROUTINE_SETTINGS.awareness),
    invitations: pick(raw.invitations, ROUTINE_INVITATIONS, DEFAULT_ROUTINE_SETTINGS.invitations),
    sociability: pick(raw.sociability, ROUTINE_SOCIABILITY, DEFAULT_ROUTINE_SETTINGS.sociability),
    planBend: pick(raw.planBend, ROUTINE_PLAN_BEND, DEFAULT_ROUTINE_SETTINGS.planBend),
    roles: { live: pick(roles.live, ROUTINE_ROLES, DEFAULT_ROUTINE_ROLES.live), near: pick(roles.near, ROUTINE_ROLES, DEFAULT_ROUTINE_ROLES.near), far: pick(roles.far, ROUTINE_ROLES, DEFAULT_ROUTINE_ROLES.far), background: pick(roles.background, ROUTINE_ROLES, DEFAULT_ROUTINE_ROLES.background) },
    narrator: typeof raw.narrator === "boolean" ? raw.narrator : DEFAULT_ROUTINE_SETTINGS.narrator,
    paletteFollowsRoutine: typeof raw.paletteFollowsRoutine === "boolean" ? raw.paletteFollowsRoutine : DEFAULT_ROUTINE_SETTINGS.paletteFollowsRoutine,
  };
}

// ---------------------------------------------------------------- a chat's own changes

/**
 * How a character follows their routine in a chat: `follows` it; follows it but makes and accepts
 * no invitations (`no_invitations`); or `off`: no routine at all, only the story, the GM, their
 * commitments and their basic needs.
 */
export type RoutineMode = "follows" | "no_invitations" | "off";
export const ROUTINE_MODES: readonly RoutineMode[] = ["follows", "no_invitations", "off"];
export const ROUTINE_MODE_LABEL: Record<RoutineMode, string> = { follows: "Follows their routine", no_invitations: "Follows it, no invitations", off: "No routine" };

/** A character's follow setting in a chat; null parts follow the world (`follows`, the world's awareness, their level's role). */
export interface RoutineFollow {
  mode: RoutineMode | null;
  awareness: RoutineAwareness | null;
  role: RoutineRole | null;
}

/**
 * A chat's change to one of a character's schedules: they don't follow it (`off`), until a time or,
 * with `until` null, until it is cleared; or their own version of it in this chat, ranked as their
 * own: the same target, these slots, and its recurrence unless one is given.
 */
export type ChatScheduleChange = { off: true; until: number | null } | { slots: ScheduleSlot[]; recurrence?: Recurrence };

/**
 * The GM's routine controls (GM → a character → Routine), each an `lre.edit` op, so a submit is one
 * `fix` entry with its Undo:
 *  - `routine_follow`: their mode, awareness and role in this chat; a part left out is kept, null
 *    returns it to the world's (the role to their level's), and all null clear the setting;
 *  - `routine_block`: one block of their routine in this chat, by id: a block (`off: true` turns the
 *    block off for them), or null to drop the chat's change and go back to the world's;
 *  - `schedule_override`: one of their schedules in this chat, by id (`ChatScheduleChange`), or null
 *    to drop the chat's change.
 */
export type RoutineEditOp =
  | { op: "routine_follow"; entity: EntityId; mode?: RoutineMode | null; awareness?: RoutineAwareness | null; role?: RoutineRole | null }
  | { op: "routine_block"; entity: EntityId; block: RoutineBlockId; value: RoutineEntry | null }
  | { op: "schedule_override"; entity: EntityId; schedule: ScheduleId; value: ChatScheduleChange | null };

/**
 * The events a chat's routine changes are recorded as (the castlife slice), each carrying the change
 * whole, so both folds and an Undo agree: `follow` `{entity, follow: RoutineFollow | null}`; `block`
 * `{entity, block, value: RoutineEntry | null, source: ChatRoutineSource}` (the GM's, or the story's
 * read from a reply); `schedule` `{entity, schedule, value: ChatScheduleChange | null, source}`.
 */
export const ROUTINE_EVENTS = { follow: "castlife.follow", block: "castlife.routine", schedule: "castlife.schedule" } as const;

// ---------------------------------------------------------------- the read model

/** Whose a block or a schedule is, and how specific: rank 0 is the most specific. */
export interface OwnerRef {
  level: "chat" | "own" | "group" | "kind" | "selector" | "world" | "builtin";
  /** The owner's id (an entity, a group or a kind); absent for a selector, the world and the built-ins. */
  id?: string;
  /** How it reads: "Danny Okafor", "The Okafor family", "Mechanic", "Everyone", "Basic needs", "This chat". */
  name: string;
  /** 0 a change in this chat, 1 their own, 2 a group's, 3 a kind's, 4 a selector's, 5 the world's default, 6 the basic needs. */
  rank: number;
}

/** A source as a reader names it: a lore entry by its title, a sheet field by its owner's name. */
export type SourceView = RoutineSource & { label: string; title?: string };

/** One block of a character's effective routine: the one that applies and those it shadows. */
export interface EffectiveBlock {
  block: RoutineEntry;
  /** The routine it comes from; null for a basic need or a chat's change. */
  routine: RoutineId | null;
  owner: OwnerRef;
  source: SourceView;
  /** Off for them: turned off by a more specific owner or the chat (which one is `owner`). */
  off: boolean;
  shadowed: { routine: RoutineId | null; owner: OwnerRef; source: SourceView; block: RoutineEntry }[];
}

/** One schedule that applies to a character, and whether it is the one in force for its target. */
export interface EffectiveSchedule {
  schedule: ScheduleId;
  target: string;
  owner: OwnerRef;
  source: SourceView;
  recurrence: Recurrence;
  slots: (ScheduleSlot & { sourceView: SourceView })[];
  /** Shadowed for its target by these more specific schedules wherever both run (they win there). */
  shadowedBy: ScheduleId[];
  /** The chat's change to it for them, if any. */
  chat: (ChatScheduleChange & { source: SourceView }) | null;
}

/** Why a block of the day is there. */
export type BlockOrigin =
  | { type: "routine"; block: RoutineBlockId; owner: OwnerRef; source: SourceView }
  | { type: "schedule"; schedule: ScheduleId; owner: OwnerRef; source: SourceView }
  | { type: "appointment" }
  | { type: "trip" }
  | { type: "plan"; plan: string; source: "memory" | "gm" | "mind"; made: number }
  | { type: "agenda"; track: string }
  | { type: "invitation"; host: EntityId; block: RoutineBlockId }
  | { type: "free" };

/** One block of a day as laid, clock minutes and as the HUD reads them. */
export interface LaidBlock {
  start: number;
  end: number;
  from: string;
  to: string;
  label: string;
  activity: string;
  place: PlaceId | null;
  placeName: string | null;
  kind: "work" | "sleep" | "free" | "travel" | "other";
  reasons: string[];
  origin: BlockOrigin;
}

/** What the story established about them now: a place or activity the routine yields to, and until when (null: until the story or the GM releases it). */
export interface StoryHoldView {
  field: "place" | "activity";
  value: JsonValue;
  label: string;
  since: number | null;
  until: number | null;
  /** A trip, an override, a plan under way, or the story's own setting of it. */
  by: "story" | "trip" | "override" | "plan";
}

/** An invitation made or received, and its ground. */
export interface InvitationView {
  key: string;
  host: EntityId;
  hostName: string;
  guests: EntityId[];
  at: number;
  when: string;
  place: PlaceId | null;
  placeName: string | null;
  text: string;
  origin: { type: "plan"; plan: string } | { type: "routine"; block: RoutineBlockId; source: SourceView } | { type: "gm" } | { type: "legacy" };
  /** Made and sent (recorded), or still to come today. */
  status: "sent" | "planned";
}

/** One character's routine, schedules and day as the GM reads them (`lre.routine {op: "day", view: "gm"}`): everything, secrets included. */
export interface RoutineGmView {
  entity: EntityId;
  name: string;
  /** Their fidelity now (DESIGN §24.1); null without minds. */
  tier: Fidelity | null;
  /** Whether the planner lays their day (an agent, Cast life 3 and up) and lives it. */
  planned: boolean;
  /** How they follow it now: the chat's setting, else the world's (their role: their level's in `settings.roles`). */
  follow: { mode: RoutineMode; awareness: RoutineAwareness; role: RoutineRole; chat: RoutineFollow | null };
  settings: RoutineSettings;
  blocks: EffectiveBlock[];
  schedules: EffectiveSchedule[];
  day: { index: number; label: string; blocks: LaidBlock[] };
  story: StoryHoldView[];
  invitations: { made: InvitationView[]; received: InvitationView[] };
}

/** A block of a day as the player reads it (DESIGN §7): no place, company or GM change; a private block or a secret agenda reads "Busy". */
export interface PlayerBlock {
  from: string;
  to: string;
  label: string;
  kind: LaidBlock["kind"];
  reasons: string[];
  /** Why it's there, as the player may know: their routine, a lore entry the POV may read (by title), the story, their own plan, a commitment, or free time. */
  source: { type: "routine" } | { type: "lore"; entry: string; title: string } | { type: "story" } | { type: "plan" } | { type: "commitment" } | { type: "free" };
}

/** One character's day as the POV may know it (`lre.routine {op: "day", view: "player"}`): what Cast shows of them, with why; null `day` when Cast shows them no day. */
export interface RoutinePlayerView {
  entity: EntityId;
  name: string;
  day: { label: string; blocks: PlayerBlock[] } | null;
}

/** Every character a chat changed (GM → Routine's list badge): what it changed of them. */
export interface RoutineChangeSummary {
  entity: EntityId;
  name: string;
  follow: RoutineFollow | null;
  blocks: { block: RoutineBlockId; source: ChatRoutineSource; off: boolean }[];
  schedules: { schedule: ScheduleId; source: ChatRoutineSource; off: boolean }[];
}

/**
 * The read requests (`lre.routine`, behind the GM gate for `gm`): `day`, one character's effective
 * routine, schedules and day (`day`: a day index, default today), as the GM or as the POV may know it;
 * `changed`, everyone this chat changed.
 */
export type RoutineRead = { op: "day"; entity: EntityId; view: "gm" | "player"; day?: number } | { op: "changed" };

export interface RoutineReadResult {
  gm?: RoutineGmView;
  player?: RoutinePlayerView;
  changed?: RoutineChangeSummary[];
}

// ---------------------------------------------------------------- lint

/** Lint codes for routines and the schedule checks that go with them; paths are `routines.<id>.blocks.<index>.<field>`, `routineSettings.<field>` and `schedules.<id>…`. */
export const ROUTINE_LINT = {
  shape: "routine.shape",
  window: "routine.window",
  place: "routine.place",
  owner: "routine.owner",
  company: "routine.company",
  need: "routine.need",
  days: "routine.days",
  source: "routine.source",
  overlap: "routine.overlap",
  pack: "routine.pack",
  settings: "routine.settings",
  scheduleOwner: "schedule.owner",
  scheduleSlot: "schedule.slot",
  scheduleSource: "schedule.source",
} as const;

// ---------------------------------------------------------------- shape checks

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const SEASONS: readonly RoutineSeason[] = ["spring", "summer", "autumn", "winter"];

function isTime(v: unknown): v is string {
  return typeof v === "string" && HHMM.test(v);
}

function sourceProblem(v: unknown, world: boolean): string | null {
  if (v === undefined) return null;
  if (!isRecord(v)) return "its source isn't one";
  const t = v.type;
  const quote = v.quote === undefined || typeof v.quote === "string";
  if (t === "authored") return null;
  if (t === "lore") return typeof v.entry === "string" && v.entry !== "" && quote ? null : "a lore source names its entry";
  if (t === "sheet") return typeof v.entity === "string" && typeof v.field === "string" && quote ? null : "a sheet source names its entity and field";
  if (world) return "world data rests on what's authored, a lore entry or a sheet field";
  if (t === "builtin") return null;
  if (t === "story") return typeof v.at === "number" && (v.turn === undefined || typeof v.turn === "string") && (v.by === undefined || v.by === "player") ? null : "a story source has its time";
  if (t === "gm") return typeof v.at === "number" ? null : "a GM source has its time";
  return "its source isn't one";
}

function placeProblem(v: unknown): string | null {
  if (v === undefined || v === "home" || v === "work" || v === "here" || v === "with") return null;
  if (isRecord(v) && typeof v.place === "string" && v.place !== "") return null;
  if (isRecord(v) && typeof v.nearest === "string" && v.nearest !== "") return null;
  return "its place is home, work, here, with, {place} or {nearest}";
}

function daysProblem(v: unknown): string | null {
  if (v === undefined) return null;
  if (!isRecord(v)) return "its days aren't a set of constraints";
  const ints = (x: unknown, lo: number, hi: number): boolean => Array.isArray(x) && x.every((n) => Number.isInteger(n) && n >= lo && n <= hi);
  const strs = (x: unknown): boolean => Array.isArray(x) && x.every((s) => typeof s === "string");
  if (v.weekdays !== undefined && !ints(v.weekdays, 0, 6)) return "weekdays are 0 (Sunday) to 6";
  if (v.off !== undefined && v.off !== "only" && v.off !== "never") return "days off are only or never";
  if (v.holidays !== undefined && !strs(v.holidays)) return "holidays are calendar ids";
  if (v.except !== undefined && !strs(v.except)) return "except lists calendar ids";
  if (v.birthday !== undefined && v.birthday !== "own" && v.birthday !== "friend") return "a birthday is own or friend";
  if (v.seasons !== undefined && !(Array.isArray(v.seasons) && v.seasons.every((s) => SEASONS.some((x) => x === s)))) return "seasons are spring, summer, autumn and winter";
  if (v.weather !== undefined && v.weather !== "fair" && v.weather !== "foul") return "weather is fair or foul";
  return null;
}

/**
 * What is wrong with a block's shape, as phrases ("its window is HH:MM to HH:MM"); none when it reads.
 * `world`: world data, whose sources are authored, lore or sheet only. The world-aware checks (places,
 * owners, lore entries, needs) are the castlife lint's (`routineIssues`).
 */
export function blockShapeProblems(v: unknown, world = true): string[] {
  if (!isRecord(v)) return ["a block is an object"];
  const out: string[] = [];
  if (typeof v.id !== "string" || v.id === "") out.push("a block has an id");
  if (v.off === true) return out;
  if (typeof v.label !== "string" || v.label.trim() === "") out.push("a block has a label");
  if (typeof v.activity !== "string" || v.activity.trim() === "") out.push("a block has an activity");
  if (!ROUTINE_BLOCK_KINDS.some((k) => k === v.kind)) out.push("its kind is fixed, flexible or optional");
  if (typeof v.minutes !== "number" || !Number.isInteger(v.minutes) || v.minutes < 1 || v.minutes > 1440) out.push("its length (minutes) is 1 to 1,440 minutes");
  if (v.kind === "fixed" && !isTime(v.at)) out.push("a fixed block starts at an HH:MM time (at)");
  if (v.kind !== "fixed" && v.at !== undefined) out.push("only a fixed block has a start time (at)");
  if (v.kind !== "fixed" && !(isRecord(v.window) && isTime(v.window.from) && isTime(v.window.to))) out.push("its window is HH:MM to HH:MM");
  if (v.perWeek !== undefined && !(v.kind !== "fixed" && Number.isInteger(v.perWeek) && typeof v.perWeek === "number" && v.perWeek >= 1 && v.perWeek <= 7)) out.push("times a week (perWeek) is 1 to 7, for a flexible or optional block");
  if (v.chance !== undefined && !(v.kind === "optional" && typeof v.chance === "number" && v.chance > 0 && v.chance <= 1)) out.push("a chance is above 0 and at most 1, for an optional block");
  if (v.priority !== undefined && !(typeof v.priority === "number" && Number.isInteger(v.priority) && v.priority >= 1 && v.priority <= 5)) out.push("its priority is 1 to 5");
  if (v.needs !== undefined && !(Array.isArray(v.needs) && v.needs.every((n) => typeof n === "string"))) out.push("its needs are names");
  if (v.private !== undefined && typeof v.private !== "boolean") out.push("private is true or false");
  if (v.company !== undefined && !(isRecord(v.company) && isRecord(v.company.who) && (v.company.invite === undefined || typeof v.company.invite === "boolean"))) out.push("its company is {who: a selector, invite?}");
  for (const p of [placeProblem(v.place), daysProblem(v.days), sourceProblem(v.source, world)]) if (p) out.push(p);
  return out;
}

/** What is wrong with a routine's shape (a Build write, a proposal); none when it reads. Block problems are prefixed with the block's index. */
export function routineShapeProblems(v: unknown): string[] {
  if (!isRecord(v)) return ["a routine is an object"];
  const out: string[] = [];
  if (typeof v.id !== "string" || v.id === "") out.push("a routine has an id");
  if (v.label !== undefined && typeof v.label !== "string") out.push("its label is text");
  if (v.owner !== undefined && !(typeof v.owner === "string" ? v.owner !== "" : isRecord(v.owner))) out.push("its owner is an entity, a group, a kind or a selector");
  if (v.inherit !== undefined && typeof v.inherit !== "boolean") out.push("inherit is true or false");
  const src = sourceProblem(v.source, true);
  if (src) out.push(src);
  if (!Array.isArray(v.blocks)) return [...out, "a routine has a list of blocks"];
  const ids = new Set<string>();
  v.blocks.forEach((b, i) => {
    for (const p of blockShapeProblems(b, true)) out.push(`block ${i + 1}: ${p}`);
    const id = isRecord(b) && typeof b.id === "string" ? b.id : "";
    if (id !== "" && ids.has(id)) out.push(`block ${i + 1}: another block of this routine is ${id}`);
    ids.add(id);
  });
  return out;
}

/** Each setting's allowed values: a word of its list, a switch, or a role for each level of closeness. A setting not named here is none the engine reads. */
const SETTING_VALUES: Record<string, readonly string[] | "switch" | "roles"> = { awareness: ROUTINE_AWARENESS, invitations: ROUTINE_INVITATIONS, sociability: ROUTINE_SOCIABILITY, planBend: ROUTINE_PLAN_BEND, roles: "roles", narrator: "switch", paletteFollowsRoutine: "switch" } satisfies Record<keyof RoutineSettings, readonly string[] | "switch" | "roles">;

/**
 * What is wrong with routine settings as a write sends them (a Build save, an outside tool), one
 * phrase per field at fault; none when they read. A part left out keeps its default, so `{}` reads,
 * and so does a level `roles` leaves out. Stored settings are read leniently (`routineSettingsOf`); a
 * write is held to this.
 */
export function routineSettingsProblems(v: unknown): string[] {
  if (!isRecord(v)) return ["routine settings are an object"];
  return Object.entries(v).flatMap(([key, value]) => {
    const allowed = hasOwn(SETTING_VALUES, key) ? SETTING_VALUES[key] : undefined;
    if (!allowed) return [`there's no setting ${key} (${Object.keys(SETTING_VALUES).join(", ")})`];
    if (allowed === "switch") return typeof value === "boolean" ? [] : [`${key} is true or false`];
    if (allowed === "roles") {
      if (!isRecord(value)) return [`roles give ${FIDELITIES.join(", ")} each a role`];
      return Object.entries(value).flatMap(([level, role]) => (!FIDELITIES.some((f) => f === level) ? [`roles have no level ${level} (${FIDELITIES.join(", ")})`] : typeof role === "string" && ROUTINE_ROLES.some((r) => r === role) ? [] : [`roles.${level} is ${ROUTINE_ROLES.join(", ")}`]));
    }
    return typeof value === "string" && allowed.includes(value) ? [] : [`${key} is ${allowed.join(", ")}`];
  });
}
