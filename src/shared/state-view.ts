// The state view: everything the frontend renders for one chat, computed by the backend from
// the fold and pushed as a snapshot plus deltas (ARCHITECTURE §5). Player-facing views are
// filtered to what the POV knows (DESIGN §7); GM previews are labelled and never recorded.

import type { JsonObject, JsonValue } from "./json";
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
import type { JournalNote, KeepLine, TimelapseTarget } from "./ledger";
import type { AdjudicationDef, FieldType, StepPurpose, WorldCurrency } from "./world";
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

/** A ✎ fix target: what `lre.fix` writes (DESIGN §12 HUD, §9.2). */
export interface FixTarget {
  entity: EntityId;
  field: FieldId;
  type: FieldType;
  value: JsonValue;
  options?: { value: JsonValue; label: string }[];
  min?: number;
  max?: number;
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
  fix?: FixTarget;
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
  /** ✎ fix targets for the HUD fields that have one. */
  fixes: Partial<Record<"place" | "weather" | "cash" | "scene", FixTarget>>;
}

export interface SceneView {
  /** The POV's place, or null when it is nowhere or somewhere it can't see. */
  placeId: PlaceId | null;
  sceneType: string;
  present: { id: EntityId; name: string; label: string }[];
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
}

/** The Timelapse sheet. Its request is `lre.action {action, params: {target, overrides}}`. */
export interface TimelapseView {
  action: ActionId;
  /** Why a timelapse can't start now (e.g. "Resume the clock first"); null when it can. */
  blocked: string | null;
  durations: number[];
  until: { label: string; detail?: string; target: TimelapseTarget }[];
  interrupts: Record<InterruptClass, InterruptPolicy>;
  /** Calendar level 1 rounds to day parts. */
  dayParts: boolean;
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
  journal: JournalNote[];
  keepReport: KeepLine[];
  pending: PendingMark[];
  /** Pack panel views keyed by `<packId>.<panel>`; each pack's `core/view.ts` owns the shape. */
  panels: Record<PanelId, JsonValue>;
  palette: PaletteView | null;
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
  /** Removed by a GM, or inside something that was: out of the world until restored. */
  gone: boolean;
  /** Not in the world document: spawned while this chat ran. */
  spawned: boolean;
  visibility: string;
  place: PlaceId | null;
  /** What holds it (`in`), if anything. */
  holder: EntityId | null;
  /** The posting total on it, for an account (minor units). */
  balance?: number;
  fields: GmField[];
  relations: GmRelation[];
  /** Each domain's effective level, and the override set on the entity (null: its tier decides). */
  levels: { domain: DomainId; level: number; override: number | null }[];
  /** The world ruleset's designed sheet read on this entity; null when the world designs none. */
  sheet: SheetSectionView[] | null;
}

/**
 * The GM view (DESIGN §7): everything as it stands, secrets and removed entities included, with
 * what the editor needs to change it. Loaded on request (`lre.gm`), never part of a state push.
 */
export interface GmView {
  entities: GmEntity[];
  kinds: { id: string; label: string }[];
  tiers: { id: string; label: string }[];
  domains: { id: DomainId; label: string }[];
  places: { id: PlaceId; name: string; visibility: string; parent: PlaceId | null }[];
  tracks: { id: string; label: string; kind: string; visibility: string; owner: string | null; stage: string; stages: { id: string; label: string; truth?: string }[] }[];
  relationTypes: { id: string; label: string; from: string; to: string; fields: { id: string; label: string; type: FieldType; min?: number; max?: number; values?: string[] }[] }[];
  /** Everyone else's money (the economy pack's `economy.people_money`); empty without it. */
  money: GmMoney[];
  /** The fight under way as the GM sees it, everyone named and HP exact (the combat pack's `combat.gm`); null without one. Its shape is the Encounter card's. */
  encounter: JsonValue | null;
  /** The ✎ fixes and GM edits in force on this chat's path, newest first, worded in full. */
  edits: { messageId: string; seq: number; lines: string[] }[];
  /** Writes held during a reply that didn't apply when it finished, with the validator's reason. */
  refused: { id: string; reason: string }[];
}

/** One person's money in the GM view, at their own Money level (as the Money panel shows the POV's at the POV's). */
export interface GmMoney {
  entity: EntityId;
  name: string;
  level: number;
  /** The wealth band; null at Money 0. */
  band: string | null;
  /** From Money 2, for someone who holds accounts. */
  netWorthCents: number | null;
  /**
   * False while their authored accounts haven't been opened yet (no money process or view has needed
   * them): the balances shown include the authored opening amounts that opening will post.
   */
  opened: boolean;
  accounts: { id: EntityId; name: string; kind: string; cents: number }[];
  /** Their recurring bills from Money 3: when, what, how much (negative) and who is paid. */
  bills: { at: string; label: string; cents: number; payee: string }[];
  /** Their latest history lines on the accounts shown, newest first. */
  recent: { at: string; memo: string; cents: number; account: string }[];
  /** Their latest payday, bill and decline notes, newest first. */
  notes: { at: string; text: string }[];
}

/**
 * What one model step read of the world's lore (DESIGN §5.4, §6.5). It is shown to the player, so
 * an unrevealed secret entry is left out, never listed or counted; a query carrying a secret or
 * naming someone or somewhere the POV doesn't know is withheld, and so is a lookup naming a secret
 * entry; and `npc.choose`, which reads an NPC's private options, lists its entries without titles.
 */
export interface LoreStepTrace {
  step: StepPurpose;
  phase: "pre" | "post";
  policy: LorePolicy;
  /** How lookups reached the model: `none` when none were offered. */
  transport: "none" | "tools" | "need";
  /** Each search: the prefetch over the step's inputs, or a lookup the model asked for (with no text when the step may read an unrevealed secret or reads private inputs), and how many entries it matched that the player may know of. */
  queries: { kind: "prefetch" | "search" | "get" | "list"; text: string; matched: number }[];
  /** The entries the step was given, in order, with their token cost: no unrevealed secret, and no title (`""`) for a private step's. */
  entries: { title: string; tokens: number; cut: boolean }[];
  /** Lookup rounds made: one model call each, on the phase's lookup budget. */
  lookups: number;
  /** Why lookups stopped or changed course (the lookup budget ran out, the connection refused tools). */
  notes: string[];
}

/** One interceptor run in the context inspector (`core.context`, DESIGN §6.5). */
export interface ContextGeneration {
  /** The generation id, or `dry:<n>` for a dry-run assembly. */
  id: string;
  at: number;
  /** `confirmed` once `WORLD_INFO_ACTIVATED` showed every forced entry; `unconfirmed` until then, or when one didn't activate. */
  activation: "confirmed" | "unconfirmed";
  /** `delivery`: found in a dry-run assembly when the inspector opened (`verified`), not found (`unverified`), or not yet checked. */
  sections: { slot: string; label: string; tokens: number; clipped: boolean; delivery: "verified" | "unverified" | "unchecked" }[];
  budget: { sections: number; used: number };
  /** What the turn's model steps read of the world's lore, step by step (absent: none read any). */
  lore?: LoreStepTrace[];
}

/** The `core.context` panel: the last ten interceptor runs, newest first, and standing warnings (book attachment and slot repair, preset caveats, journal notices). */
export interface ContextView {
  generations: ContextGeneration[];
  warnings: string[];
}
