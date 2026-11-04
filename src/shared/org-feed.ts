// What an organization's life gives its page (ORG-SPEC §3.14, §4.4, assess-party §6.2): its alerts,
// each with whether it needs the reader and the tab Open goes to; what is coming up (paydays,
// invoices due, dues, lease ends); and its Plan, the goals and the orders given for it, with their
// statuses and where each came from. Each is an organization section (`r.orgSection`), read as the
// reader may see it. Pure.

import type { EntityId } from "./ids";
import type { OrgRef } from "./org-view";

/** The sections' ids on an organization's page. */
export const ALERTS_SECTION = "orgs.alerts";
export const COMING_SECTION = "orgs.coming";
export const PLAN_SECTION = "orgs.plan";
/** The Plan's tab on an organization's page (`r.orgTab`): `orgRoute(org, PLAN_TAB)` opens it. */
export const PLAN_TAB = "orgs.plan";

/** The Plan's actions (the player's bookkeeping, at once with Undo) and the GM effects they play (GM → Orgs edits them). */
export const PLAN_ACTIONS = { goal: "org_goal", order: "org_order", status: "org_plan_status" } as const;
export const PLAN_EFFECTS = { goal: "orgs.plan_goal", order: "orgs.plan_order", status: "orgs.plan_status" } as const;
/** The longest words a goal or an order keeps. */
export const PLAN_TEXT_MAX = 300;

/** The page's tabs an alert's Open may go to; `money` is the economy's Money tab. */
export const ALERT_TABS = ["overview", "people", "rules", "money", "plan"] as const;
export type AlertTab = (typeof ALERT_TABS)[number];

/** What an alert is about (§3.14). */
export const ALERT_KINDS = ["vacancy", "payroll_short", "delegation_ending", "dues_arrears", "negative_equity"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** One alert, as the reader may see it. */
export interface OrgAlertView {
  /** Stable within the page: its kind and what it is about. */
  id: string;
  kind: AlertKind;
  tone: "info" | "warn" | "neg";
  /** The whole sentence ("Master is vacant."). */
  text: string;
  /** The words after the organization's name on Now ("payroll short"). */
  short: string;
  tab: AlertTab;
  /** Whether it asks something of the reader: a Needs you dot, and a line on Now. */
  needsYou: boolean;
}

/** What an organization has coming up (§4.4). */
export const COMING_KINDS = ["payday", "invoice", "dues", "lease"] as const;
export type ComingKind = (typeof COMING_KINDS)[number];

/** One thing coming up: when, what, and its money where the reader may see it (in positive, out negative). */
export interface OrgComingView {
  kind: ComingKind;
  /** When, in the world's calendar's words. */
  at: string;
  /** Clock reading, for order. */
  clock: number;
  text: string;
  cents: number | null;
}

/** Where a plan's goal or order stands (assess-party §6.2). */
export const PLAN_STATUSES = ["open", "under_way", "done", "dropped", "blocked", "refused"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** The statuses that keep an item on the plan; the rest close it. */
export const PLAN_LIVE: readonly PlanStatus[] = ["open", "under_way", "blocked"];

export function isPlanStatus(v: unknown): v is PlanStatus {
  return typeof v === "string" && (PLAN_STATUSES as readonly string[]).includes(v);
}

/** Whether an item with this status is still on the plan. */
export function isPlanStatusLive(status: PlanStatus): boolean {
  return PLAN_LIVE.includes(status);
}

/** Each status in words. */
export const PLAN_STATUS_WORDS: Readonly<Record<PlanStatus, string>> = { open: "Open", under_way: "Under way", done: "Done", dropped: "Dropped", blocked: "Blocked", refused: "Refused" };

/** Who put an item on the plan or moved it: the player's message, the reply, the GM, or Play's own controls. */
export const PLAN_SOURCES = ["player", "reply", "gm", "play"] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

/** The latest word on an item: what was said or noted, when, and from where. */
export interface PlanNote {
  note: string;
  at: number;
  source: PlanSource;
  /** The words of the story it quotes, for a status the reply read. */
  said?: string;
}

/** A goal as the plan keeps it: the words it was set in, by when (`window`: "today" or a date), where, and how it stands. */
export interface PlanGoal {
  id: string;
  text: string;
  window?: string;
  where?: string;
  status: PlanStatus;
  /** Who set it: someone in the world, or none for the GM. */
  by?: EntityId;
  source: PlanSource;
  at: number;
  last?: PlanNote;
}

/** An order as the plan keeps it: whom it is for and who leads, the task in the words it was given, where and when, the goal it serves. */
export interface PlanOrder {
  id: string;
  goal?: string;
  to: EntityId[];
  lead?: EntityId;
  text: string;
  where?: string;
  /** When, as a clock reading; none for a standing order. */
  when?: number;
  status: PlanStatus;
  by?: EntityId;
  source: PlanSource;
  at: number;
  last?: PlanNote;
  /**
   * The planner's marker (`orgs.lived`): when every block the day planner laid for it had ended, so by
   * the day as laid it should be done, though nobody has said so. It never closes the order; a change
   * of its time, place or people clears it, as does a standing order going under way.
   */
  lived?: number;
}

/** The day planner's priority for an order, by the tier of the party member it is for (assess-party §6.2): core and hired 5, companion 4, ally 3. */
export const ORDER_PRIORITY = { core: 5, hired: 5, companion: 4, ally: 3 } as const;

/**
 * One order on the player character's party plan as the off-screen follow-through reads it for one
 * party member it is for (`orgs.order_plans`, assess-party §6.2-6.3): its words and who gave it, where
 * and when, how it stands, the priority their tier gives it, and the window the day planner lays it in
 * (Cast life 3 and up). A timed order runs from the minute after it was given to its time; a standing
 * one (no time) with a place, to the end of the window of the goal it serves, else for a day; a
 * standing order under way holds them from when it went under way (`hold`) to the end of its goal's
 * window, or with none until it is done or dropped. A blocked order, and an open standing one with no
 * place, lays nothing. A closed one lays only before it closed, so its day stays as it was.
 */
export interface OrderPlan {
  /** The plan id its blocks are laid under: `order:<org>:<id>`. */
  plan: string;
  org: EntityId;
  id: string;
  text: string;
  /** Who gave it; null for the GM. */
  by: EntityId | null;
  /** Everyone it is asked of: the team, the player character among them for an order "with me". */
  to: EntityId[];
  /** The place of the world it is bound to, or null. */
  place: string | null;
  /** Its time; null for a standing order. */
  when: number | null;
  status: PlanStatus;
  /** The day planner's priority, by their tier (`ORDER_PRIORITY`). */
  priority: number;
  /** When it was given. */
  made: number;
  /** Where the planner lays it, as game minutes (`to` null: until it is done or dropped); null where it lays nothing. */
  window: { from: number; to: number | null } | null;
  /** A standing order under way: it holds them through the waking hours of every day of its window, rather than an hour in it; with no window, around their fixed shifts. */
  hold: boolean;
  /** When it closed (its latest word's time); null while it is on the plan. */
  closed: number | null;
}

/** An order on the page, as the reader may read it: anyone they can't see named "someone". */
export interface PlanOrderView {
  id: string;
  goal: string | null;
  to: OrgRef[];
  lead: OrgRef | null;
  text: string;
  where: string | null;
  when: string | null;
  status: PlanStatus;
  /** Who set it and how long ago, in words ("Set by Jordan Ellis at 9:40 AM, from your message"). */
  set: string;
  /** Its window or time has passed while it is still open. */
  late: boolean;
  /** By the day as the planner laid it, it should be done; nobody has said so yet (`PlanOrder.lived`). */
  lived: boolean;
  last: { note: string; at: string } | null;
  /** It is asked of the reader. */
  mine: boolean;
  /** The reader may move it along (its giver, or one it is asked of), and change it or drop it (who may give orders). */
  mayStatus: boolean;
  mayEdit: boolean;
  /**
   * What Edit's form starts from, for a reader who may change it: whom it is for and who leads (only
   * those the reader can see; `hidden` counts the rest, whom the form can't change), where as given,
   * when as `YYYY-MM-DD HH:MM` in the world's calendar ("" for a standing order), the goal it serves.
   */
  edit: { to: string[]; hidden: number; lead: string; where: string; when: string; goal: string } | null;
}

/** A goal on the page with the orders that serve it. */
export interface PlanGoalView {
  id: string;
  text: string;
  window: string | null;
  where: string | null;
  status: PlanStatus;
  set: string;
  late: boolean;
  last: { note: string; at: string } | null;
  orders: PlanOrderView[];
  /** Every order it has is done: Play offers Mark plan done. */
  ordersDone: boolean;
  mayEdit: boolean;
  /** What Edit's form starts from: by when (`today`, a date, or ""), and where as given. */
  edit: { window: string; where: string } | null;
}

/** A closed goal or order, as the page lists the latest of them: Reopen puts it back on the plan. */
export interface PlanClosedView {
  id: string;
  kind: "goal" | "order";
  text: string;
  status: PlanStatus;
  /** When it was last moved along, in the world calendar's words. */
  when: string | null;
}

/** An organization's Plan (`orgs.plan`): its open goals with their orders, the orders that serve no goal, how many it has closed (the latest of them in `recent`), and what the reader may do. */
export interface OrgPlanView {
  goals: PlanGoalView[];
  orders: PlanOrderView[];
  closed: number;
  recent: PlanClosedView[];
  /** The reader may give orders here (`orders.give`). */
  mayGive: boolean;
  /** Those orders may go to: its people the reader can see. */
  people: OrgRef[];
}
