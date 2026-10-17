// The state view: everything the frontend renders for one chat, computed by the backend from
// the fold and pushed as a snapshot plus deltas (ARCHITECTURE §5). Player-facing views are
// filtered to what the POV knows (DESIGN §7); GM previews are labelled and never recorded.

import type { JsonObject, JsonValue } from "./json";
import type {
  ActionId,
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
  Tier,
  WorldId,
} from "./ids";
import type { JournalNote, KeepLine, TimelapseTarget } from "./ledger";
import type { FieldType, WorldCurrency } from "./world";

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

export interface HudView {
  clock: ClockView;
  place: { id: PlaceId; name: string } | null;
  weather: string | null;
  /** Cash shown at the POV's Money level: a band at level 1, cents from level 2. */
  cash: { band: string } | { cents: number } | null;
  /** ✎ fix targets for the HUD fields that have one. */
  fixes: Partial<Record<"place" | "weather" | "cash" | "scene", FixTarget>>;
}

export interface SceneView {
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
  | "retry_timelapse"
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
  | "contradiction";

export interface ChipAction {
  id: string;
  label: string;
  style?: "primary" | "danger";
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
  turn: { calls: number; tokens: number; ms: number };
  average: { calls: number; tokens: number; ms: number };
  p95: { calls: number; tokens: number; ms: number };
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
  group: "action" | "buy" | "pay" | "transfer" | "drive" | "lend";
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

export interface PaletteView {
  entries: PaletteEntry[];
  timelapse: TimelapseView | null;
}

/** The running chat's folded realism and time controls (Play → Calendar, "This chat" realism). */
export interface ControlsView {
  realism: { preset: RealismPresetId; levels: Record<DomainId, Level>; tierCaps: Record<Exclude<Tier, "pov">, Partial<Record<DomainId, Level>>> };
  time: {
    sceneType: SceneTypeId;
    sceneTicks: Record<SceneTypeId, number>;
    scale: number;
    paused: boolean;
    interrupts: Record<InterruptClass, InterruptPolicy>;
    speedThrough: Record<string, { mode: "offer" | "auto"; thresholdMinutes: number }>;
    montage: "key" | "day" | "week";
    unitCap: { agentDays: number; events: number };
    npcCalls: number;
  };
}

export interface StateView {
  v: 1;
  chatId: ChatId;
  worldId: WorldId | null;
  revision: RevisionId | null;
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

/** The `core.gm` panel (DESIGN §7, §9.2): everything, secrets included, as labelled previews that record nothing. */
export interface GmView {
  /** "Preview — not recorded". */
  label: string;
  previews: { title: string; lines: string[] }[];
  truths: { track: string; stage: string; truth: string }[];
  agendas: { entity: string; label: string; stage: string }[];
  /** Everyone else's money (the economy pack's `economy.people_money`); empty without it. */
  money: GmMoney[];
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

/** One interceptor run in the context inspector (`core.context`, DESIGN §6.5). */
export interface ContextGeneration {
  /** The generation id, or `dry:<n>` for a dry-run assembly. */
  id: string;
  at: number;
  /** `confirmed` once `WORLD_INFO_ACTIVATED` showed every forced entry. */
  activation: "confirmed" | "unconfirmed" | "stalled";
  /** `delivery`: found in a dry-run assembly when the inspector opened (`verified`), not found (`unverified`), or not yet checked. */
  sections: { slot: string; label: string; tokens: number; clipped: boolean; delivery: "verified" | "unverified" | "unchecked" }[];
  budget: { sections: number; used: number };
}

/** The `core.context` panel: the last ten interceptor runs, newest first, and standing warnings (book attachment and slot repair, preset caveats, journal notices). */
export interface ContextView {
  generations: ContextGeneration[];
  warnings: string[];
}
