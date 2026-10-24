// The state view: everything the frontend renders for one chat, computed by the backend from
// the fold and pushed as a snapshot plus deltas (ARCHITECTURE §5). Player-facing views are
// filtered to what the POV knows (DESIGN §7); GM previews are labelled and never recorded.

import type { ClaimsPolicy } from "./claims";
import type { InferredChecks, SheetSkill } from "./inferred";
import type { JsonObject, JsonValue } from "./json";
import type { MindCallTrace, MindsGmView } from "./minds";
import type {
  ActionId,
  Band,
  ChatId,
  ChipId,
  DomainId,
  EntityId,
  FieldId,
  InterruptClass,
  InterruptPolicy,
  Level,
  MessageId,
  PackId,
  PanelId,
  PlaceId,
  RealismPresetId,
  RevisionId,
  SceneTypeId,
  WorldId,
} from "./ids";
import type { FinanceView } from "./finance";
import type { JournalNote, KeepLine, TimelapseTarget } from "./ledger";
import type { AdjudicationDef, FacetDef, FacetId, FacetValueId, FieldType, SectionFeed, StepPurpose, WorldCurrency } from "./world";
import type { LorePolicy } from "./settings";

export type ChatStatus = "not_world" | "idle" | "in_flight" | "paused";

export interface ClockView {
  /** Minutes since the world epoch. */
  minutes: number;
  /** Local date-time text in the POV's place time zone. */
  label: string;
  dayPart: string;
  paused: boolean;
  /** Time scale when not 1×. */
  scale: number;
}

/** A ✎ fix target (DESIGN §12): a field `lre.fix` sets, or the clock. */
export type FixTarget = FieldFixTarget | TimeFixTarget;

/** A field a ✎ fix sets: what `lre.fix` writes as one typed `set` (DESIGN §12 HUD, §9.2). */
export interface FieldFixTarget {
  entity: EntityId;
  field: FieldId;
  type: FieldType;
  value: JsonValue;
  options?: { value: JsonValue; label: string }[];
  min?: number;
  max?: number;
}

/**
 * The clock's ✎ (DESIGN §9.2, §12): a date and a time of day in the world's calendar, local to the
 * POV's place as the HUD reads it, which `lre.fix` sends as `time`.
 */
export interface TimeFixTarget {
  type: "time";
  /** Now, `YYYY-MM-DD HH:MM`: where the editor starts. */
  value: string;
  /** The calendar's months in order, each with its name and days (February's 29 in a Gregorian calendar). */
  months: { name: string; days: number }[];
  /** A Gregorian calendar, whose February has 29 days only in a leap year. */
  gregorian: boolean;
}

/** One row of a character sheet: Play → You, the Sheet Designer's preview, anyone's sheet in a GM view. */
export interface SheetRowView {
  label: string;
  value: string;
  detail?: string;
  /** A pool's bar: its current value between its min and its max (null when the max can't be read). */
  pool?: { current: number; min: number; max: number | null };
  /** A progression: the level, the XP, the XP that level needed and the next level needs (null at the top). */
  progress?: { level: number; xp: number; from: number; next: number | null };
  fix?: FieldFixTarget;
}

export interface SheetSectionView {
  title: string;
  rows: SheetRowView[];
}

export interface HudView {
  clock: ClockView;
  /** The POV's place: its id and name, or no id and "Somewhere" when the POV can't see it (DESIGN §7). */
  place: { id: PlaceId | null; name: string } | null;
  weather: string | null;
  /** Cash shown at the POV's Money level: a band at level 1, cents from level 2. */
  cash: { band: string } | { cents: number } | null;
  /** ✎ fix targets for the HUD values that have one: the clock and the fields. */
  fixes: Partial<Record<"place" | "weather" | "cash" | "scene", FieldFixTarget>> & { time?: TimeFixTarget };
}

export interface SceneView {
  /** The POV's place, or null when it is nowhere or somewhere it can't see. */
  placeId: PlaceId | null;
  sceneType: string;
  /** People here the POV can see; `life`: their life state as the POV knows it, when that isn't alive (DESIGN §8). */
  present: { id: EntityId; name: string; label: string; life?: string }[];
  /** The last turn's elapsed time in minutes. */
  elapsed: number;
}

export type ChipKind =
  | "change"
  | "elapsed"
  | "roll"
  | "price"
  | "confirm"
  | "decline"
  | "undo"
  | "retry_read"
  | "not_action"
  | "swipe_option"
  | "overdue"
  | "timelapse_offer"
  | "continue_timelapse"
  | "keep_report"
  | "reread"
  | "retry"
  | "degraded"
  | "pending"
  /** D4 learning flipped a type on this connection ("Purchases now apply automatically — undo"). */
  | "mode_change"
  /** A suggested next move (DESIGN §5.2 `choices`); Send posts it as the player's message. */
  | "choice"
  /** The reply went against an engine fact (DESIGN §5.2 `contradiction`): Re-narrate, or It's fine. */
  | "contradiction"
  /** The call that reads typed text failed, so the turn ran as plain roleplay; Retry runs it again (DESIGN §9.4). */
  | "read_failed"
  /** The engine run before the reply failed, so nothing was generated; Retry runs the engine and then the reply (DESIGN §5.1). */
  | "engine_failed"
  /** A typed action uses a thing the world doesn't have and the turn waits, nothing generated, on Add or Not an action; either resumes it (DESIGN §9.4 player claims). */
  | "claim"
  /** A thing the player said they had, made real for their action ("Added: a coffee"), with Undo (DESIGN §9.4 player claims). */
  | "claimed"
  /** A typed attempt the chat reads as a check only suggests it ("Roll Persuasion?"): the turn waits, nothing generated, on Roll or No roll; either resumes it (DESIGN §11 inferred checks). */
  | "check"
  /** A routine change the player's own message states ("Would you like to add this to your routine?"): Yes records it, No drops it; the turn doesn't wait on it (DESIGN §9.4). */
  | "routine_ask"
  /** A routine change the player said Yes to, with Undo (DESIGN §9.4). */
  | "routine_added"
  /** A ✎ fix or GM edit on the head ("Corrected …"), with Undo (DESIGN §12). */
  | "fix"
  /** A write held during a reply that no longer applied when the reply finished (P2), with Dismiss. */
  | "refused";

/**
 * A value a chip action asks for before it's sent, in its `lre.chip` payload: an amount in the
 * world's currency (`{cents}`, minor units; `value` is the amount it starts at), or one of
 * `options` (`{value}`).
 */
export type ChipInput = { type: "money"; label: string; value?: number } | { type: "choice"; label: string; options: { value: string; label: string }[] };

export interface ChipAction {
  id: string;
  label: string;
  style?: "primary" | "danger";
  input?: ChipInput;
}

export interface Chip {
  id: ChipId;
  kind: ChipKind;
  messageId: MessageId;
  /** The swipe the chip belongs to; views show a message's chips only for its displayed swipe. Absent: the message as a whole. */
  swipeId?: number;
  label: string;
  detail?: string;
  actions: ChipAction[];
  /** Confirm and action chips lapse at the next send (DESIGN §11). */
  expires: "next_send" | "never";
}

/**
 * Whether a chip's action is finished by Lumiverse regenerating the reply (a new swipe), which only
 * a page can start: `regenerate` is nothing but that, and the others set up what the next swipe
 * does. The frontend regenerates after them; an outside client tells the user to.
 */
export function chipRegenerates(kind: ChipKind, choice: string): boolean {
  return choice === "regenerate" || (kind === "swipe_option" && (choice === "renarrate" || choice === "rerun")) || (kind === "contradiction" && choice === "renarrate") || (kind === "read_failed" && choice === "rerun") || (kind === "claim" && (choice === "add" || choice === "drop")) || (kind === "check" && (choice === "roll" || choice === "drop"));
}

/** Detail opened during an in-flight window shows "pending" until it closes (DESIGN §9.2). */
export interface PendingMark {
  panel: PanelId;
  entity: EntityId | null;
}

export interface CallMeterView {
  turn: { calls: number; tokens: number; ms: number; lookups: number };
  average: { calls: number; tokens: number; ms: number; lookups: number };
  p95: { calls: number; tokens: number; ms: number; lookups: number };
}

// ---------------------------------------------------------------- palette (DESIGN §12)

/** Exact outcome odds; the `p`s sum to 1. */
export interface OutcomeOdds {
  outcome: string;
  p: number;
}

export interface PaletteOption {
  label: string;
  /** Sent verbatim as `lre.action` params. */
  params: JsonObject;
  detail?: string;
  odds?: OutcomeOdds[];
  cents?: number;
  minutes?: number;
  /** Why the option can't be taken now; absent when it can. Never set on an option with `next` (only the final pick is judged). */
  disabled?: string;
  /**
   * A second pick (Drive's destination, Lend's borrower): at most 12 options, nearest first. Each
   * holds `{[param]: id}`; the UI sends the merged params of the whole picked chain.
   */
  next?: { param: string; label: string; options: PaletteOption[] };
}

export interface PaletteEntry {
  action: ActionId;
  label: string;
  /** `combat`: a world's combat actions (DESIGN §11), in its Combat tab. */
  group: "action" | "buy" | "pay" | "transfer" | "drive" | "lend" | "combat";
  /** One per target; one when the action has no target. */
  options: PaletteOption[];
  /** A free amount in cents, merged into params under `param`. */
  amount?: { param: string; min: number; max: number | null };
  /** A required number (Lend's days), pre-filled with `default` and merged into params under `param`; options are judged with the default. */
  number?: { param: string; label: string; min: number; max: number | null; default: number };
  /**
   * Who comes along (Go's `With`): the people in the scene the POV can see, any of whom the player
   * may tick; their ids are merged into params under `param` as a list. Absent with no one here.
   */
  people?: { param: string; label: string; options: { id: EntityId; name: string }[] };
}

/**
 * The Timelapse sheet. Its request is `lre.action {action, params: {target, overrides, followRoutine?}}`:
 * `followRoutine` true lets the POV live its routine through the skip; false holds it where the story
 * has it, as a typed span does (DESIGN §8, §9.2). Absent, the world's `paletteFollowsRoutine` decides.
 */
export interface TimelapseView {
  action: ActionId;
  /** Why a timelapse can't start now (e.g. "Resume the clock first"); null when it can. */
  blocked: string | null;
  durations: number[];
  until: { label: string; detail?: string; target: TimelapseTarget }[];
  interrupts: Record<InterruptClass, InterruptPolicy>;
  /** Calendar level 1 rounds to day parts. */
  dayParts: boolean;
  /** "Follow my routine" as the sheet opens: the world's `routineSettings.paletteFollowsRoutine`. */
  followRoutine: boolean;
}

/** A fight under way, as the palette heads its Combat tab (DESIGN §11): the round, whose turn it is and what the POV has left. */
export interface PaletteEncounter {
  round: number;
  /** Whose turn it is, as the POV names them ("you", a name, or "someone"). */
  turn: string;
  yours: boolean;
  economy: { id: string; label: string; left: number; of: number }[];
}

export interface PaletteView {
  entries: PaletteEntry[];
  timelapse: TimelapseView | null;
  /** The fight under way, when there is one. */
  encounter?: PaletteEncounter;
}

/** The running chat's folded realism, time controls and adjudication policy (Play → Calendar, Settings → This chat). */
export interface ControlsView {
  realism: {
    preset: RealismPresetId;
    levels: Record<DomainId, Level>;
    /** Caps per detail band. */
    tierCaps: Record<Band, Partial<Record<DomainId, Level>>>;
    /** The world's tiers each band's caps reach, in order. */
    bandTiers: Record<Band, string[]>;
    /** The world's floors on effective levels (DESIGN §9.1, §11): its ruleset's, and Space 3 while the grid system is on; the sliders don't go below them either. */
    floors: Partial<Record<DomainId, Level>>;
    /** What this chat makes of a typed action's thing the world doesn't have (DESIGN §9.4): its own marker's, else the world's default, else its realism preset's. */
    claims: ClaimsPolicy;
  };
  time: {
    sceneType: SceneTypeId;
    sceneTicks: Record<SceneTypeId, number>;
    scale: number;
    paused: boolean;
    interrupts: Record<InterruptClass, InterruptPolicy>;
    speedThrough: Record<string, { mode: "offer" | "auto"; thresholdMinutes: number }>;
    montage: "key" | "day" | "week";
    unitCap: { agentDays: number; events: number };
  };
  /** The policy deciding this chat's checks (DESIGN §11): its own marker's, else the world's, else plain rolling. */
  adjudication: AdjudicationDef;
  /** How this chat reads typed attempts as checks (DESIGN §11 inferred checks): its own `infer` marker's, else the world's default, else its realism preset's at its Sheets level. */
  inferred: InferredChecks;
  /** The skills the chat's world's sheet has, in sheet order: what an inferred check may roll, and what its skills list may name. */
  skills: SheetSkill[];
  /**
   * The chat's sections in rank order with their feed (DESIGN §6.11): the world's settings and the
   * GM's in this chat (null when the chat follows the world's). Settings, never what a section holds.
   */
  sections: { id: string; label: string; world: SectionFeed; chat: SectionFeed | null }[];
}

export interface StateView {
  v: 1;
  chatId: ChatId;
  worldId: WorldId | null;
  revision: RevisionId | null;
  /** The revision the chat's entity definitions still come from, when an Upgrade left them behind `revision` (DESIGN §4.3 `migrate`). */
  definitionsFrom?: RevisionId;
  status: ChatStatus;
  hud: HudView | null;
  scene: SceneView | null;
  chips: Chip[];
  /** Under each reply the engine ran, the world's date and time once its turn ended, for the swipe shown, local to where the POV is (as the HUD reads it): `formatClock`'s "Tue 15 Sep 2026, 12:25 PM". */
  replyClocks: Record<MessageId, string>;
  journal: JournalNote[];
  keepReport: KeepLine[];
  pending: PendingMark[];
  /** Pack panel views keyed by `<packId>.<panel>`; each pack's `core/view.ts` owns the shape. */
  panels: Record<PanelId, JsonValue>;
  palette: PaletteView | null;
  /** The action staged for the player's next message (DESIGN §11): its request as tapped, so ✕ and Send now resend it, and its words. Absent or null: none. */
  staged?: { action: string; params: JsonObject; source: "palette" | "map" | "command" | "chip"; label: string } | null;
  controls: ControlsView | null;
  meter: CallMeterView | null;
  packs: Record<PackId, number>;
  /** The attached revision's money display; format amounts with `formatMoney` from `shared/world`. */
  currency: WorldCurrency | null;
}

/** A field on the GM view's entity form: as the entity's kind defines it (when it does) and as stored. */
export interface GmField {
  id: FieldId;
  label: string;
  type: FieldType;
  /** Stored, else the definition's default, else null; a derived field's value as read now. */
  value: JsonValue;
  /** `enum` values. */
  values?: string[];
  /** The bounds an edit is held to (a pool's evaluated max included). */
  min?: number;
  max?: number;
  /** A `ref` field's kind, when its definition names one. */
  ref?: string;
  /** Worked out from other values: shown, never edited. */
  derived?: true;
  /** Never offered to a model; the GM edits it like any other. */
  locked?: true;
  /** A value the kind doesn't declare (a pack's bookkeeping, an authored extra), edited as JSON. */
  extra?: true;
}

/** One relation an entity holds, with its fields; a regard's current value where the relationships pack reads one. */
export interface GmRelation {
  type: string;
  to: EntityId;
  toName: string;
  fields?: JsonObject;
  until?: number;
  value?: number;
}

/** Everything about one entity, secrets included (DESIGN §7). */
export interface GmEntity {
  id: EntityId;
  name: string;
  kind: string;
  tier: string;
  agent: boolean;
  pov: boolean;
  /** A person, who may travel with the player character (its party, DESIGN §9.3). */
  person: boolean;
  /** Removed by a GM, or inside something that was: out of the world until restored. */
  gone: boolean;
  /** Not in the world document: spawned while this chat ran. */
  spawned: boolean;
  visibility: string;
  place: PlaceId | null;
  /** What holds it (`in`), if anything. */
  holder: EntityId | null;
  /** A thing the player said they had, made real for their action (`fields.claimed`, DESIGN §9.4 player claims). */
  claimed: boolean;
  /** The posting total on it, for an account (minor units). */
  balance?: number;
  fields: GmField[];
  relations: GmRelation[];
  /** Each domain's effective level, and the override set on the entity (null: its tier decides). */
  levels: { domain: DomainId; level: number; override: number | null }[];
  /** Its classes, every facet's (hidden ones too), and tags, as selectors read them now. */
  class: Record<FacetId, FacetValueId[]>;
  tags: string[];
  /** The world ruleset's designed sheet read on this entity; null when the world designs none. */
  sheet: SheetSectionView[] | null;
  /** Its life state (DESIGN §8), and who knows it as it is: everyone but `unaware`, or only `aware` (people). */
  life: { state: string; label: string; acts: boolean; everyone: boolean; aware: { id: EntityId; name: string }[]; unaware: { id: EntityId; name: string }[] };
}

/**
 * The GM view (DESIGN §7): everything as it stands, secrets and removed entities included, with
 * what the editor needs to change it. Loaded on request (`lre.gm`), never part of a state push.
 */
export interface GmView {
  entities: GmEntity[];
  /** Every kind, built in and the world's own, with the kind it extends (null for a root): a kind matches another when it is it or extends it, as the engine's `kindIs` walks the chain. */
  kinds: { id: string; label: string; extends: string | null }[];
  tiers: { id: string; label: string }[];
  /** The world's life states, built in and its own, in order: what the life editor offers. */
  lifeStates: { id: string; label: string; acts: boolean }[];
  domains: { id: DomainId; label: string }[];
  /** The world's classification facets, hidden ones too: what the classification editor offers. */
  classifications: Record<FacetId, FacetDef>;
  /** `pins`: how many lore entries are pinned to the place (DESIGN §24.5). */
  places: { id: PlaceId; name: string; visibility: string; parent: PlaceId | null; pins: number }[];
  tracks: { id: string; label: string; kind: string; visibility: string; owner: string | null; stage: string; stages: { id: string; label: string; truth?: string }[] }[];
  relationTypes: { id: string; label: string; from: string; to: string; fields: { id: string; label: string; type: FieldType; min?: number; max?: number; values?: string[] }[] }[];
  /** Every party's money, the POV first, each at their own Money level (the economy pack's `economy.people_money`); empty without it. */
  money: FinanceView[];
  /** The fight under way as the GM sees it, everyone named and HP exact (the combat pack's `combat.gm`); null without one. Its shape is the Encounter card's. */
  encounter: JsonValue | null;
  /** The ✎ fixes and GM edits in force on this chat's path, newest first, worded in full; `by`: a mechanical action of the player's, by how it reads, rather than a correction (DESIGN §11). */
  edits: { messageId: string; seq: number; lines: string[]; by?: string }[];
  /** Writes held during a reply that didn't apply when it finished, with the validator's reason. */
  refused: { id: string; reason: string }[];
  /** Character minds (DESIGN §24.9): every character's fidelity and why, their latest mind, plans, notes, commitments and summary. */
  minds: MindsGmView;
}

/**
 * What one model step read of the world's lore (DESIGN §5.4, §6.5). It is shown to the player, so
 * an unrevealed secret entry is left out, never listed or counted; a query carrying a secret or
 * naming someone or somewhere the POV doesn't know is withheld, and so is a lookup naming a secret
 * entry; and `npc.choose`, which reads an NPC's private options, is `private`: its searches go
 * uncounted and its entries unlisted.
 */
export interface LoreStepTrace {
  step: StepPurpose;
  phase: "pre" | "post";
  policy: LorePolicy;
  /** How lookups reached the model: `none` when none were offered. */
  transport: "none" | "tools" | "need";
  /** Each search: the prefetch over the step's inputs, or a lookup the model asked for (with no text when the step may read an unrevealed secret or reads private inputs), and how many entries it matched that the player may know of, unless the step is `private`. */
  queries: { kind: "prefetch" | "search" | "get" | "list"; text: string; matched?: number }[];
  /** The entries the step was given, in order, with their token cost: no unrevealed secret, and none for a `private` step. `pinned`: pinned to where the player character is (DESIGN §24.5), given before any search. */
  entries: { title: string; tokens: number; cut: boolean; pinned?: true }[];
  /** The step read someone's private plans: how much it found, and how big, would say what those are. */
  private?: true;
  /** Lookup rounds made: one model call each, on the phase's lookup budget. */
  lookups: number;
  /** Why lookups stopped or changed course (the lookup budget ran out, the connection refused tools). */
  notes: string[];
}

/** One engine run's sections in the context inspector (`core.context`, DESIGN §6.5). */
export interface ContextGeneration {
  /** The generation id, or `dry:<n>` for a dry-run assembly. */
  id: string;
  at: number;
  /** `confirmed` once `WORLD_INFO_ACTIVATED` showed every forced entry; `unconfirmed` until then, or when one didn't activate. */
  activation: "confirmed" | "unconfirmed";
  /** `delivery`: found in a dry-run assembly when the inspector opened (`verified`), not found (`unverified`), or not yet checked. `cut`: lines left out over the section's own budget (the Minds section, DESIGN §24.3). */
  sections: { slot: string; label: string; tokens: number; clipped: boolean; cut?: number; delivery: "verified" | "unverified" | "unchecked" }[];
  budget: { sections: number; used: number };
  /** What the turn's model steps read of the world's lore, step by step (absent: none read any). */
  lore?: LoreStepTrace[];
  /** The turn's minds calls (DESIGN §24.5), with no text (absent: none ran). */
  minds?: MindCallTrace[];
}

/** The `core.context` panel: the last ten engine runs' sections, newest first, and standing warnings (book attachment and slot repair, preset caveats, journal notices). */
export interface ContextView {
  generations: ContextGeneration[];
  warnings: string[];
}
