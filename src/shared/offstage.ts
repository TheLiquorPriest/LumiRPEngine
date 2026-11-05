// Out of play (DESIGN §11): the money and organization actions a tap does at once, off screen, with
// no message, no turn and no clock time, recorded on the head as a ✎ fix is, with its Undo. One table
// marks them, each with its group; the group decides, by Settings → Narrator → Out-of-play actions,
// whether the next turn's narrator is told of it (`by.told` on its fix, in the Outcome's words,
// recorded when it is done and never worked out again). Typed words or Send now still play the
// action as a turn, and `buy` stays in the world: it is no entry here. The gear actions Play → Me →
// Belongings sends (its things, and its hand-overs and changes of outfit) are entries too, applied at
// once only when their request says so (`offstage`); a palette tap of one stays story. Pure.

import type { ItemFix } from "./things";

/** What an out-of-play action is about: which of Settings → Narrator → Out-of-play actions' defaults tells it. */
export type OffstageGroup = "accounts" | "payments" | "credit" | "investing" | "property" | "business" | "staff" | "members" | "structure" | "governance" | "things" | "handovers";

export const OFFSTAGE_GROUPS: readonly OffstageGroup[] = ["payments", "credit", "property", "business", "staff", "members", "structure", "handovers", "accounts", "investing", "governance", "things"];

/** Each group as Settings and the Tell switch name it. */
export const OFFSTAGE_GROUP_LABEL: Readonly<Record<OffstageGroup, string>> = {
  accounts: "Your own accounts",
  payments: "Payments to others",
  credit: "Credit",
  investing: "Investing",
  property: "Property",
  business: "Business",
  staff: "Staff",
  members: "Members",
  structure: "Structure",
  governance: "Governance",
  things: "Things",
  handovers: "Hand-overs and outfits",
};

/** What each group holds, in a few words, for its row in Settings. */
export const OFFSTAGE_GROUP_HELP: Readonly<Record<OffstageGroup, string>> = {
  accounts: "Transfers between your accounts, card payments, cards, autopay, cash in and out",
  payments: "Paying someone, gifts, invoices you pay, standing payments, sharing out",
  credit: "Applying for credit, lending money to someone",
  investing: "Trades, options, where dividends go",
  property: "Buying, selling and listing property, leases",
  business: "Invoices, draws, profits, shares, stakes, consolidated returns, projects",
  staff: "Hiring, raises, hours, leave, titles, positions, pay schedules",
  members: "Admitting, removing, appointing, delegating, dues, your party",
  structure: "Founding, renaming, restructuring, merging, winding up",
  governance: "Votes, motions, decision rules, goals, orders, positions, entry",
  things: "Wearing, taking off, dropping, putting away, putting in, moving your things (Belongings)",
  handovers: "Giving, handing over, lending, giving back and taking back things, and changing into a saved outfit or loadout (Belongings)",
};

/** Which group's default tells each out-of-play action. Every money and organization action but `buy`, and Belongings' gear actions. */
export const OFFSTAGE_ACTIONS: Readonly<Record<string, OffstageGroup>> = Object.freeze({
  // Your own accounts.
  move_money: "accounts",
  pay_card: "accounts",
  set_autopay: "accounts",
  set_pay_prefs: "accounts",
  card_freeze: "accounts",
  card_unfreeze: "accounts",
  card_report_lost: "accounts",
  card_replace: "accounts",
  withdraw_cash: "accounts",
  deposit_cash: "accounts",
  party_purse: "accounts",
  // Payments to others.
  pay: "payments",
  donate: "payments",
  invoice_pay: "payments",
  flow_create: "payments",
  flow_update: "payments",
  flow_pause: "payments",
  flow_resume: "payments",
  flow_delete: "payments",
  org_share_out: "payments",
  // Credit.
  apply_credit: "credit",
  lend_money: "credit",
  // Investing.
  trade: "investing",
  exercise_option: "investing",
  route_distributions: "investing",
  // Property.
  property_buy: "property",
  property_sell: "property",
  property_list: "property",
  lease_start: "property",
  lease_end: "property",
  // Business.
  invoice_issue: "business",
  invoice_void: "business",
  owner_draw: "business",
  distribute_profit: "business",
  stake_sell: "business",
  shares_issue: "business",
  shares_buy_back: "business",
  shares_list: "business",
  shares_delist: "business",
  shares_classes: "business",
  tax_consolidate: "business",
  consent_dividend: "business",
  project_start: "business",
  project_pause: "business",
  project_resume: "business",
  project_drop: "business",
  // Staff.
  job_hire: "staff",
  job_end: "staff",
  job_hours: "staff",
  job_leave: "staff",
  job_return: "staff",
  job_raise: "staff",
  job_title: "staff",
  job_position: "staff",
  org_pay_schedule: "staff",
  party_hire: "staff",
  // Members.
  org_admit: "members",
  org_remove: "members",
  org_leave: "members",
  org_appoint: "members",
  org_title: "members",
  org_delegate: "members",
  org_revoke: "members",
  org_dues: "members",
  party_tier: "members",
  // Structure.
  org_found: "structure",
  org_rename: "structure",
  org_restructure: "structure",
  org_merge: "structure",
  org_wind_up: "structure",
  party_name: "structure",
  // Governance.
  org_decisions: "governance",
  org_vote: "governance",
  org_vote_rule: "governance",
  org_motion_end: "governance",
  org_goal: "governance",
  org_order: "governance",
  org_plan_status: "governance",
  org_position: "governance",
  org_entry: "governance",
  org_approve: "governance",
  org_deny: "governance",
  // Things: Belongings only (`offstage`).
  wear: "things",
  remove: "things",
  drop: "things",
  put_away: "things",
  take: "things",
  put_in: "things",
  // Hand-overs and outfits: Belongings only (`offstage`); someone not here is never handed anything.
  give: "handovers",
  hand_over: "handovers",
  give_back: "handovers",
  lend: "handovers",
  reclaim: "handovers",
  set_apply: "handovers",
});

/** The groups of the gear actions Belongings sends at once (`ActionRequest.offstage`); from the palette they stay story. */
const GEAR_GROUPS: Readonly<Partial<Record<OffstageGroup, true>>> = { things: true, handovers: true };

/** The gear actions Belongings sends at once (`ActionRequest.offstage`); from the palette they stay story. */
export const OFFSTAGE_GEAR: readonly string[] = Object.freeze(Object.keys(OFFSTAGE_ACTIONS).filter((id) => GEAR_GROUPS[OFFSTAGE_ACTIONS[id] ?? "accounts"] === true));

/** An action's group, or null for one that always plays in the story (`buy`, travel, a check). */
export function offstageGroupOf(action: string): OffstageGroup | null {
  return Object.hasOwn(OFFSTAGE_ACTIONS, action) ? (OFFSTAGE_ACTIONS[action] ?? null) : null;
}

/** Whether a tap of the action with no words is done at once wherever it is sent from: every money and organization action of the table; gear only from Belongings (`offstage`). */
export function atOnceByDefault(action: string): boolean {
  const group = offstageGroupOf(action);
  return group !== null && GEAR_GROUPS[group] !== true;
}

/**
 * Whether an `lre.action` is done at once, off screen (DESIGN §11): sent with no words and no Send
 * now, for an action the table marks (a gear one only when its surface asks, `offstage`), or one
 * whose definition is bookkeeping (`mechanical`, a world's own action among them).
 */
export function playsOffstage(action: string, req: { text?: string | undefined; now?: boolean | undefined; offstage?: boolean | undefined }, mechanical: boolean): boolean {
  if ((req.text?.trim() ?? "") !== "" || req.now === true) return false;
  return mechanical || atOnceByDefault(action) || (req.offstage === true && offstageGroupOf(action) !== null);
}

/** Settings → Narrator → Out-of-play actions: whether each group is told to the next turn's narrator, and the amount from which a payment to someone else is. */
export interface OffstageSettings {
  tell: Record<OffstageGroup, boolean>;
  /** A payment to someone else is told from this amount, in whole units of the chat world's money (0: every one); below it, it is bookkeeping. */
  paymentsFrom: number;
}

/** Told by default: what the story would have narrated as a turn (payments to others at any amount, credit, property, business, staff, members, structure, hand-overs and changes of outfit); not told: your own accounts, investing, governance, things. */
export const OFFSTAGE_DEFAULTS: Readonly<OffstageSettings> = Object.freeze({
  tell: Object.freeze({ payments: true, credit: true, property: true, business: true, staff: true, members: true, structure: true, handovers: true, accounts: false, investing: false, governance: false, things: false }),
  paymentsFrom: 0,
});

/** `UserSettings.offstage` as the engine reads it: each group a switch, the amount a whole number from 0, else `base`'s. */
export function offstageSettingsOf(raw: unknown, base: Readonly<OffstageSettings> = OFFSTAGE_DEFAULTS): OffstageSettings {
  const r = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const tell = typeof r.tell === "object" && r.tell !== null && !Array.isArray(r.tell) ? (r.tell as Record<string, unknown>) : {};
  const out = {} as Record<OffstageGroup, boolean>;
  for (const g of OFFSTAGE_GROUPS) {
    const v = tell[g];
    out[g] = typeof v === "boolean" ? v : base.tell[g];
  }
  const from = r.paymentsFrom;
  return { tell: out, paymentsFrom: typeof from === "number" && Number.isInteger(from) && from >= 0 ? from : base.paymentsFrom };
}

/** An action's money amount, read from its params as the palette sends it (`amount`), else null. */
export function offstageAmount(params: Readonly<Record<string, unknown>>): number | null {
  const v = params.amount;
  return typeof v === "number" && Number.isFinite(v) ? Math.abs(v) : null;
}

/** Whether an out-of-play action is told by default: its group's switch, and a payment only from the amount set (`decimals`: the world currency's). One outside the table isn't. */
export function toldByDefault(action: string, params: Readonly<Record<string, unknown>>, settings: Readonly<OffstageSettings>, decimals: number): boolean {
  const group = offstageGroupOf(action);
  if (group === null || !settings.tell[group]) return false;
  if (group !== "payments" || settings.paymentsFrom <= 0) return true;
  const amount = offstageAmount(params);
  return amount === null || amount >= settings.paymentsFrom * 10 ** decimals;
}

/** The group a list of ✎ changes to things (Belongings' `lre.fix {things}`) is told by: hand-overs when one of them hands a thing to someone, else things. */
export function fixGroupOf(things: readonly ItemFix[]): OffstageGroup {
  return things.some((t) => t.do === "hand") ? "handovers" : "things";
}

/** A confirm step's Tell switch for the action it sends (DESIGN §11): null for one done in the story, else on or off as Settings → Narrator → Out-of-play actions presets it. */
export function tellPreset(action: string, params: Readonly<Record<string, unknown>>, settings: Readonly<OffstageSettings>, decimals: number): boolean | null {
  return atOnceByDefault(action) ? toldByDefault(action, params, settings, decimals) : null;
}

/** The wording a control gives an action done at once (it replaces "It plays as your next turn"). */
export const OFFSTAGE_NOTE = "Done at once, off screen.";

/** The Tell switch's label and its help, on a confirm step and on the action's chip. */
export const TELL_LABEL = "Tell the story";
export const TELL_HELP = "On, the next reply mentions it as done; off, it's bookkeeping the story doesn't hear of.";

/** A standing payment set up off screen carries `origin: "offstage"` (stamped where the action is done at once), so its "…: $X paid." line says so. */
export const ORIGIN_FIELD = "origin";
export const OFFSTAGE_ORIGIN = "offstage";
