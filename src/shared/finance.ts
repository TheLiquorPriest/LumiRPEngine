// The money foundation's shared contract (DESIGN §25 Money foundation, §26 Work and business,
// §27 Holdings and property): account classes and their traits, parties and ownership, products,
// payment cards, flows, the transaction journal, statements and delinquency, the credit report,
// payment preferences, cash machines and branches, households, employment and business records,
// holdings, assets and property, the realism features, and every view the dashboards draw.
//
// Shapes only, plus the pure tables and reads every side needs (traits, rights, features, credit
// tiers). Where each shape lives in a world:
//   - entities of kind `account`, `card`, `flow`, `trust` and `business` (economy), `job` (work),
//     `holding` and `property` (assets); `household` is the relationships pack's group kind, its
//     members those with a `member_of` relation to it;
//   - the person fields `pay_prefs`, `filing_status` and `local_tax`; the place fields `atm` and
//     `branch`;
//   - `packs.economy.config`: `products`, `features`, `assets` (and `region`, `livingCosts`,
//     `unpricedCap`, as before).
// Money is always integer minor units; percentages are percent units (22 is 22 %).

import type { EntityId, Level } from "./ids";
import { hasOwn, type JsonObject } from "./json";

// ---------------------------------------------------------------- account classes

export const ACCOUNT_CLASSES = [
  "cash",
  "checking",
  "business_checking",
  "savings",
  "money_market",
  "cd",
  "trust",
  "escrow",
  "credit_card",
  "charge_card",
  "line_of_credit",
  "loan",
  "mortgage",
  "brokerage",
  "retirement",
] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];

/** What a class of account does. Every rule reads these, never a class name. */
export interface ClassTraits {
  label: string;
  /** Physical money: a wallet, a purse, a till. */
  cash: boolean;
  /** Holds money: a positive balance is an asset. */
  asset: boolean;
  /** Lends money: a negative balance is owed. */
  liability: boolean;
  /** A payment may draw on it (a purchase, a bill, a transfer to someone). */
  pays: boolean;
  /** Money paid to its holder may land in it, lowest first (payroll, a transfer, a refund); null: never by default. */
  depositRank: number | null;
  /** Carries debit cards and an overdraft policy. */
  transactional: boolean;
  /** Revolving credit: statements, a grace period, minimum payments, a limit (none preset for a charge card). */
  revolving: boolean;
  /** Installment credit: amortises over a term and finishes. */
  installment: boolean;
  /** Holds positions besides its cash (the holdings module). */
  investment: boolean;
  /** Pays interest (APY) on a positive balance. */
  earns: boolean;
  /** Its money can't be moved out before its term (a CD) or retirement, except by its own module. */
  locked: boolean;
}

const traits = (label: string, t: Partial<Omit<ClassTraits, "label">>): ClassTraits => ({ label, cash: false, asset: false, liability: false, pays: false, depositRank: null, transactional: false, revolving: false, installment: false, investment: false, earns: false, locked: false, ...t });

export const CLASS_TRAITS: Readonly<Record<AccountClass, ClassTraits>> = Object.freeze({
  cash: traits("Cash", { cash: true, asset: true, pays: true, depositRank: 1 }),
  checking: traits("Checking", { asset: true, pays: true, depositRank: 0, transactional: true, earns: true }),
  business_checking: traits("Business checking", { asset: true, pays: true, depositRank: 0, transactional: true, earns: true }),
  savings: traits("Savings", { asset: true, pays: true, depositRank: 2, earns: true }),
  money_market: traits("Money market", { asset: true, pays: true, depositRank: 3, earns: true }),
  cd: traits("Certificate of deposit", { asset: true, earns: true, locked: true }),
  trust: traits("Trust account", { asset: true, pays: true, depositRank: 4, earns: true }),
  escrow: traits("Escrow", { asset: true, pays: true, earns: true }),
  credit_card: traits("Credit card", { liability: true, pays: true, revolving: true }),
  charge_card: traits("Charge card", { liability: true, pays: true, revolving: true }),
  line_of_credit: traits("Line of credit", { liability: true, pays: true, revolving: true }),
  loan: traits("Loan", { liability: true, installment: true }),
  mortgage: traits("Mortgage", { liability: true, installment: true }),
  brokerage: traits("Brokerage", { asset: true, depositRank: 5, investment: true }),
  retirement: traits("Retirement", { asset: true, investment: true, locked: true }),
});

export function isAccountClass(v: unknown): v is AccountClass {
  return typeof v === "string" && (ACCOUNT_CLASSES as readonly string[]).includes(v);
}

/** Credit of either kind: the statement cycle runs for it. */
export function isCredit(c: AccountClass): boolean {
  return CLASS_TRAITS[c].revolving || CLASS_TRAITS[c].installment;
}

/** The class an older world's account `type` stood for (the world migration, and accounts older ledgers spawned). */
export const LEGACY_TYPE_CLASS: Readonly<Record<string, AccountClass>> = Object.freeze({ cash: "cash", checking: "checking", savings: "savings", card: "credit_card", loan: "loan", brokerage: "brokerage" });

// ---------------------------------------------------------------- parties and ownership

/** Who can hold money: a person, or one of the three party kinds. Each owns accounts and assets. */
export const PARTY_KINDS = ["person", "business", "trust", "household"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

export const OWNER_ROLES = ["owner", "joint", "custodian", "beneficiary", "trustee", "authorized_user"] as const;
export type OwnerRole = (typeof OWNER_ROLES)[number];

/**
 * One holder of an account or an asset (an `owners` list on accounts, businesses, holdings and
 * properties). `share` is a percentage of its worth among the owners whose role carries worth;
 * when none gives one, those owners share equally.
 */
export interface Owner {
  party: EntityId;
  role: OwnerRole;
  share?: number;
}

/** What a role lets its holder do. */
export interface RoleRights {
  /** Pay from it (a purchase, a bill, a transfer out). */
  spend: boolean;
  /** Its share counts toward the holder's net worth (a custodial account counts toward the beneficiary). */
  worth: boolean;
  /** It shows on the holder's dashboards. */
  sees: boolean;
  /** Change it: autopay, cards, flows from it, closing it. */
  manage: boolean;
}

export const ROLE_RIGHTS: Readonly<Record<OwnerRole, RoleRights>> = Object.freeze({
  owner: { spend: true, worth: true, sees: true, manage: true },
  joint: { spend: true, worth: true, sees: true, manage: true },
  custodian: { spend: true, worth: false, sees: true, manage: true },
  beneficiary: { spend: false, worth: true, sees: true, manage: false },
  trustee: { spend: true, worth: false, sees: true, manage: true },
  authorized_user: { spend: true, worth: false, sees: true, manage: false },
});

export function isOwnerRole(v: unknown): v is OwnerRole {
  return typeof v === "string" && (OWNER_ROLES as readonly string[]).includes(v);
}

/**
 * Each owner's share of the worth, in percent: the given shares scaled to 100, else equal parts
 * among the roles that carry worth. Roles without worth get 0.
 */
export function worthShares(owners: readonly Owner[]): Record<EntityId, number> {
  const out: Record<EntityId, number> = {};
  const holders = owners.filter((o) => ROLE_RIGHTS[o.role].worth);
  const given = holders.filter((o) => typeof o.share === "number" && Number.isFinite(o.share) && o.share > 0);
  const total = given.reduce((a, o) => a + (o.share ?? 0), 0);
  for (const o of owners) out[o.party] = out[o.party] ?? 0;
  for (const o of holders) out[o.party] = (out[o.party] ?? 0) + (given.length === 0 ? 100 / holders.length : given.includes(o) ? ((o.share ?? 0) * 100) / total : 0);
  return out;
}

/**
 * The owners an entity's fields name: its `owners` list (entries without a party are skipped, an
 * unknown role reads as `owner`), else an older single `owner` as the owner.
 */
export function ownersIn(fields: Readonly<JsonObject>): Owner[] {
  const list = fields.owners;
  if (Array.isArray(list)) {
    const out: Owner[] = [];
    for (const raw of list) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
      const party = raw.party;
      if (typeof party !== "string" || party === "") continue;
      const share = raw.share;
      out.push({ party, role: isOwnerRole(raw.role) ? raw.role : "owner", ...(typeof share === "number" && Number.isFinite(share) ? { share } : {}) });
    }
    return out;
  }
  return typeof fields.owner === "string" && fields.owner !== "" ? [{ party: fields.owner, role: "owner" }] : [];
}

/**
 * Whether `who` holds an entity: names it as its owner, or on its owners list with any role, as
 * its card holder, or (a holding or a card on an account) holds the account it belongs to. The
 * engine's "your own things" reads this, so accounts, cards, holdings and properties count as
 * their holders' like any owned thing.
 */
export function heldBy(entities: Readonly<Record<string, { fields: JsonObject }>>, id: EntityId, who: EntityId): boolean {
  const e = hasOwn(entities, id) ? entities[id] : undefined;
  if (!e) return false;
  if (e.fields.holder === who || ownersIn(e.fields).some((o) => o.party === who)) return true;
  const account = e.fields.account;
  return typeof account === "string" && account !== id && hasOwn(entities, account) && ownersIn(entities[account]?.fields ?? {}).some((o) => o.party === who);
}

// ---------------------------------------------------------------- products

export type InterestMethod = "monthly_simple" | "average_daily";
export const OVERDRAFT_POLICIES = ["decline", "fee", "linked"] as const;
export type OverdraftPolicy = (typeof OVERDRAFT_POLICIES)[number];

/** Fees a product charges, in minor units (percentages where named `_pct`). */
export interface ProductFees {
  annual?: number;
  /** A missed minimum payment: the first, then each repeat within six cycles. */
  late_first?: number;
  late_repeat?: number;
  /** An item paid into overdraft (policy `fee`), at most three a day. */
  overdraft?: number;
  /** An item returned unpaid (a bounced payment from this account). */
  nsf?: number;
  /** This bank's fee at another bank's machine (the machine's own surcharge comes on top). */
  atm?: number;
  cash_advance_pct?: number;
  cash_advance_min?: number;
  /** Monthly maintenance, waived at or above a balance of `maintenance_waive`. */
  maintenance?: number;
  maintenance_waive?: number;
  card_replacement?: number;
}

export interface MinimumRule {
  /** Percent of the statement balance. */
  pct: number;
  /** The least a minimum payment is (or the whole balance, when less). */
  floor: number;
  /** Whether the cycle's interest and fees come on top of the percentage. */
  plus_interest: boolean;
}

/**
 * A product: what an account is and how it behaves. A world lists its own under
 * `packs.economy.config.products` (id → def); every class id is also a built-in product whose
 * parameters come from the finance tables. An account's own fields override its product's.
 */
export interface ProductDef {
  label: string;
  class: AccountClass;
  institution?: string;
  /** Credit limit; null for no preset limit (a charge card); absent for the class default. */
  limit?: number | null;
  apr_pct?: number;
  apy_pct?: number;
  /** Monthly simple, or the average daily balance where the `average_daily` feature runs. */
  interest?: InterestMethod;
  /** From 60 days past due. */
  penalty_apr_pct?: number;
  cash_advance_apr_pct?: number;
  /** Days from the statement to its due date. */
  due_days?: number;
  statement_day?: number;
  minimum?: MinimumRule;
  fees?: ProductFees;
  /** Percent back on purchases. */
  rewards_pct?: number;
  daily_purchase_limit?: number;
  daily_atm_limit?: number;
  /** Days a deposit at a machine stays on hold (the `holds` feature). */
  hold_days?: number;
  overdraft?: OverdraftPolicy;
  /** How far policy `fee` lets the balance go below zero. */
  overdraft_limit?: number;
  term_months?: number;
  /** Secured by an asset: the account's `secured_by` (a mortgage by its property, a car loan by its car). */
  secured?: boolean;
}

/** A product with every parameter settled: the class defaults, the world's product, then the account's own fields. */
export interface ResolvedProduct {
  id: string;
  label: string;
  class: AccountClass;
  institution: string;
  limit: number | null;
  apr_pct: number;
  apy_pct: number;
  interest: InterestMethod;
  penalty_apr_pct: number;
  cash_advance_apr_pct: number;
  due_days: number;
  statement_day: number;
  minimum: MinimumRule;
  fees: Required<ProductFees>;
  rewards_pct: number;
  daily_purchase_limit: number | null;
  daily_atm_limit: number | null;
  hold_days: number;
  overdraft: OverdraftPolicy;
  overdraft_limit: number;
  term_months: number | null;
  secured: boolean;
}

// ---------------------------------------------------------------- accounts

export const ACCOUNT_STATUSES = ["open", "frozen", "collections", "charged_off", "closed", "paid_off", "matured"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** How a credit account pays itself: not at all, the minimum due, the statement balance, the whole balance or a fixed amount. */
export const AUTOPAY_MODES = ["none", "minimum", "statement", "full", "fixed"] as const;
export type AutopayMode = (typeof AUTOPAY_MODES)[number];

/**
 * An `account` entity's fields, all declared, so Build forms and lint cover them. The overrides
 * (`limit`, `apr_pct` and the rest) win over the product's.
 */
export interface AccountFields {
  owners: Owner[];
  /** A product id: one of `packs.economy.config.products`, or a class id (its built-in product). */
  product: string;
  institution?: string;
  /** The authored balance an opening posts, from the holder's side (negative: owed). */
  opening?: number;
  status?: AccountStatus;
  /** When it was opened (`YYYY-MM-DD`), for the credit report's account age. */
  opened?: string;
  limit?: number;
  apr_pct?: number;
  apy_pct?: number;
  statement_day?: number;
  due_day?: number;
  min_pct?: number;
  min_floor?: number;
  /** An installment loan's monthly payment; absent: amortised over the months left. */
  payment?: number;
  term_months?: number;
  /** Months left on an installment loan at the start; each statement counts one down. */
  months_left?: number;
  /** The asset securing it (a property, a vehicle). */
  secured_by?: EntityId;
  overdraft?: OverdraftPolicy;
  overdraft_link?: EntityId;
  overdraft_limit?: number;
  autopay?: AutopayMode;
  autopay_from?: EntityId;
  /** `fixed` autopay's amount. */
  autopay_cents?: number;
}

// ---------------------------------------------------------------- cards

export const CARD_NETWORKS = ["debit", "credit", "charge"] as const;
export type CardNetwork = (typeof CARD_NETWORKS)[number];
export const CARD_STATES = ["active", "frozen", "lost", "cancelled"] as const;
export type CardState = (typeof CARD_STATES)[number];

/** A `card` entity's fields: a payment card on an account, in one holder's hands. */
export interface CardFields {
  account: EntityId;
  holder: EntityId;
  network: CardNetwork;
  state: CardState;
  /** The physical card in gear (an item, usually in the wallet). */
  item?: EntityId;
  last4?: string;
  /** Overrides of the account's product limits. */
  daily_purchase_limit?: number;
  daily_atm_limit?: number;
  /** The card this one replaced, and the one that replaced it. */
  replaces?: EntityId;
  replaced_by?: EntityId;
}

// ---------------------------------------------------------------- flows

export const FLOW_KINDS = ["transfer", "bill", "rent", "utility", "subscription", "premium", "loan_payment", "card_payment", "savings", "income", "payroll", "allowance", "living", "tax", "distribution", "invoice", "draw", "other"] as const;
export type FlowKind = (typeof FLOW_KINDS)[number];

/**
 * What a flow does when the money isn't there: `skip` this occurrence; pay what there is
 * (`partial`); try again in `retry_days` up to `retries` times; pay from `fallback`; let the account
 * go into overdraft as its policy allows (`overdraft`); or carry the amount to the next occurrence
 * (`defer`).
 */
export const FLOW_SHORTFALLS = ["skip", "partial", "retry", "fallback", "overdraft", "defer"] as const;
export type FlowShortfall = (typeof FLOW_SHORTFALLS)[number];
export const FLOW_STATUSES = ["active", "paused", "ended"] as const;
export type FlowStatus = (typeof FLOW_STATUSES)[number];

/** How much one occurrence moves. */
export type FlowAmount =
  | { fixed: number }
  /** A formula in the engine's grammar with `self` the payer; minor units. */
  | { formula: string }
  /** A table cell (minor units; a band's typical), times `scale`. */
  | { table: string; row: string; column?: string; scale?: number }
  /** A seeded draw inside the range. */
  | { range: { min: number; max: number } }
  /** A percentage of an account's balance (`of`), else of the paying account's. */
  | { percent: number; of?: EntityId }
  /** What a credit account (`to`) has due: its minimum, its statement balance, or its whole balance. */
  | { due: "minimum" | "statement" | "balance" }
  /** A module's own amount and posting (payroll, a distribution, a lease), by provider id. */
  | { provider: string; args?: JsonObject };

/** When a flow falls due: the calendar's recurrence, or once. */
export interface FlowSchedule {
  every?: "day" | "week" | "month" | "year";
  /** Every Nth period, counted from the flow's `start` (biweekly is `week` with 2). */
  interval?: number;
  /** `week`: weekdays, 0 = Sunday. */
  weekdays?: number[];
  /** `month` and `year`: days of the month; 31 in a short month is its last day, -1 the last day. */
  days?: number[];
  /** `year`: months, 1-based. */
  months?: number[];
  /** Holiday ids it skips. */
  except?: string[];
  /** A due day that isn't a business day (a weekend or a day-off holiday) moves to the one before or after. */
  roll?: "none" | "before" | "after";
  /** Local time of day it moves, `HH:MM`; 09:00 when absent. */
  at?: string;
  /** A one-off: a local date-time `YYYY-MM-DDTHH:MM`, or a clock reading. */
  once?: string | number;
}

/** Money routed to more than one place: fixed amounts first, then percentages of the rest; what's left goes to the flow's `to`. */
export interface FlowSplit {
  to: string;
  cents?: number;
  pct?: number;
}

/** Who pays which part of a shared flow (a household's rent): a party's percentage, from an account of theirs or as their preferences choose. */
export interface FlowShare {
  party: EntityId;
  pct: number;
  from?: EntityId;
}

/** One scheduled or one-off movement of money, read from a `flow` entity or derived by a module from its records. */
export interface Flow {
  id: string;
  label: string;
  kind: FlowKind;
  /** An account, a party (paying as their preferences choose), or an outside payer by name. */
  from: string;
  /** An account, a party (into their deposit account), or an outside payee by name. */
  to: string;
  splits?: FlowSplit[];
  shares?: FlowShare[];
  amount: FlowAmount;
  schedule: FlowSchedule;
  /** First and last dates it runs (`YYYY-MM-DD`), and how many times at most. */
  start?: string;
  end?: string;
  count?: number;
  shortfall: FlowShortfall;
  retry_days?: number;
  retries?: number;
  fallback?: string;
  category?: string;
  /** What it belongs to: a property, a lease, a business, a job, a holding, a loan (any entity id). */
  link?: EntityId;
  status: FlowStatus;
  /** How a party's side pays (`cash`, `card`, `checking`, …); a flow pays from an account by default, never wallet cash. */
  method?: string;
  /** `entity` for a flow entity; otherwise the source that derives it (`job`, `lease`, `autopay`, …). */
  source: string;
}

/**
 * A `flow` entity's fields: the `Flow` flattened so each part is a declared field. Its amount is
 * the first of `amount_cents`, `amount_formula`, `amount_table` (`table.row[.column]`),
 * `amount_min`/`amount_max`, `amount_pct` (of `amount_of`) and `amount_due`.
 */
export interface FlowFields {
  flow_kind: FlowKind;
  from: string;
  to: string;
  splits?: FlowSplit[];
  shares?: FlowShare[];
  amount_cents?: number;
  amount_formula?: string;
  amount_table?: string;
  amount_min?: number;
  amount_max?: number;
  amount_pct?: number;
  amount_of?: EntityId;
  amount_due?: "minimum" | "statement" | "balance";
  every?: FlowSchedule["every"];
  interval?: number;
  weekdays?: number[];
  days?: number[];
  months?: number[];
  except?: string[];
  roll?: FlowSchedule["roll"];
  at?: string;
  once?: string;
  start?: string;
  end?: string;
  count?: number;
  shortfall?: FlowShortfall;
  retry_days?: number;
  retries?: number;
  fallback?: string;
  category?: string;
  link?: EntityId;
  status?: FlowStatus;
  method?: string;
}

/** A flow's own record in the fold: how often it ran, what it still owes. */
export interface FlowRunState {
  /** Occurrences paid, whole or in part. */
  done: number;
  /** Occurrences it couldn't pay at all. */
  missed: number;
  /** The last occurrence it handled, a clock reading. */
  last?: number;
  /** A retry still to come: when, how many tries are left after it, how much. */
  retry?: { at: number; left: number; cents: number };
  /** Carried from occurrences it couldn't pay (`defer`). */
  deferred?: number;
  /** It ran its count or passed its end. */
  ended?: boolean;
}

export type FlowOutcome = "paid" | "partial" | "skipped" | "retry" | "deferred" | "fallback" | "overdraft" | "declined";

// ---------------------------------------------------------------- the journal

export const TXN_KINDS = ["purchase", "payment", "transfer", "income", "fee", "interest", "withdrawal", "deposit", "refund", "adjustment", "opening", "rewards", "sale"] as const;
export type TxnKind = (typeof TXN_KINDS)[number];
export type TxnStatus = "pending" | "posted";

/**
 * One line of an account's journal: what moved on it, signed from its holder's side, what it was,
 * who was on the other side, which card paid, and whether it has posted yet.
 */
export interface JournalEntry {
  id: string;
  at: number;
  account: EntityId;
  cents: number;
  memo: string;
  kind?: TxnKind;
  category?: string;
  /** The other side: the entity id of someone in the world (views name it, or mask it), else an outside party's name. */
  counterparty?: string;
  card?: EntityId;
  flow?: string;
  status: TxnStatus;
  /** When a pending entry posts. */
  settles?: number;
}

/**
 * Money set aside on an account: a deposit not yet available, or a card authorisation not yet
 * settled. It lowers what's available, never the balance; it lapses at `until`.
 */
export interface Hold {
  id: string;
  account: EntityId;
  cents: number;
  until: number;
  kind: "deposit" | "authorization";
  memo: string;
}

// ---------------------------------------------------------------- statements and delinquency

export const DELINQUENCY_STAGES = ["current", "late", "30", "60", "90", "120", "collections", "charged_off"] as const;
export type DelinquencyStage = (typeof DELINQUENCY_STAGES)[number];

/** A credit account's statement cycle as the fold keeps it: the last statement and how it is being paid. */
export interface CycleState {
  /** The statement balance owed. */
  closing: number;
  interest: number;
  fees: number;
  minimum: number;
  /** The due date's clock reading. */
  due: number;
  /** Paid toward it since the statement. */
  paid: number;
  /** When the statement closed. */
  at: number;
  /** The APR the statement charged (the penalty APR when it applies). */
  apr: number;
  stage: DelinquencyStage;
  /** Whether the statement before was paid in full by its due date: the grace period holds, so no interest. */
  grace: boolean;
  /** Minimums past due and not yet paid. */
  past_due: number;
  /** Late payments in the last six cycles (the repeat late fee). */
  lates: number;
  penalty: boolean;
  /** Installment loans: months left after this statement. */
  months_left?: number;
  /** Consecutive cycles paid on time (six lift a penalty rate), and the history the credit report counts. */
  streak?: number;
  ontime?: number;
  late30?: number;
  late60?: number;
  late90?: number;
}

/** One statement as a dashboard lists it. */
export interface StatementView {
  at: string;
  closing: number;
  interest: number;
  fees: number;
  minimum: number;
  due: string;
  paid: number;
  apr: number;
  stage: DelinquencyStage;
  /** Paid in full, the minimum met, still open, or missed. */
  state: "paid" | "minimum" | "open" | "late";
}

// ---------------------------------------------------------------- credit

export const CREDIT_TIERS = ["super_prime", "prime", "nonprime", "subprime", "deep_subprime"] as const;
export type CreditTier = (typeof CREDIT_TIERS)[number];

/** The tier of a score, as the finance tables' `apr_by_credit_tier` rows name them. */
export function creditTierOf(score: number): CreditTier {
  if (score >= 781) return "super_prime";
  if (score >= 661) return "prime";
  if (score >= 601) return "nonprime";
  if (score >= 501) return "subprime";
  return "deep_subprime";
}

/** A score's band in words (the finance table's `credit_score.bands`). */
export function scoreBand(score: number): "poor" | "fair" | "good" | "very good" | "exceptional" {
  if (score >= 800) return "exceptional";
  if (score >= 740) return "very good";
  if (score >= 670) return "good";
  if (score >= 580) return "fair";
  return "poor";
}

export const SCORE_MIN = 300;
export const SCORE_MAX = 850;

/** Something on a person's credit history. */
export interface CreditEntry {
  at: number;
  kind: "inquiry" | "opened" | "on_time" | "late" | "collections" | "charged_off" | "closed" | "paid_off" | "declined";
  account?: EntityId;
  /** Days late, for `late`. */
  days?: number;
  note?: string;
}

/** The parts of a score, each 0–1, 1 best. */
export interface ScoreFactors {
  payment: number;
  utilisation: number;
  age: number;
  mix: number;
  recent: number;
}

export interface CreditReport {
  person: EntityId;
  score: number | null;
  band: string | null;
  tier: CreditTier | null;
  asOf: string | null;
  factors: ScoreFactors | null;
  history: { at: string; score: number }[];
  utilisationPct: number;
  ageMonths: number;
  onTimePct: number;
  accounts: { id: EntityId; name: string; class: AccountClass; status: AccountStatus; limit: number | null; owed: number; opened: string | null; late30: number; late60: number; late90: number }[];
  inquiries: { at: string; note: string }[];
  marks: { at: string; kind: string; note: string }[];
  /** What Apply for credit can ask for, at the APR this score gets. */
  offers: { product: string; label: string; class: AccountClass; aprPct: number | null; limit: number | null }[];
}

/** What applying for credit asks: a product (or a class), how much, over what term, secured by what. */
export interface CreditApplication {
  product: string;
  cents?: number;
  term_months?: number;
  secured_by?: EntityId;
}

// ---------------------------------------------------------------- payment preferences

/**
 * One tier of a person's payment preferences (`pay_prefs`, in order): a way of paying (`cash`,
 * `debit`, `credit`, `charge`, `checking`, `savings`) or a specific card or account, used when the
 * amount and category fit. A tier that can't cover the amount passes to the next, then to the
 * fallback: any account the person may spend from that covers it.
 */
export interface PayTier {
  use: string;
  min?: number;
  max?: number;
  categories?: string[];
  except?: string[];
}

// ---------------------------------------------------------------- cash, ATMs and branches

/** A place's `atm` field: a cash machine of `bank`, with its operator's surcharge and per-withdrawal limit. */
export interface AtmFeature {
  bank: string;
  fee?: number;
  limit?: number;
  /** It takes deposits (they go on hold for the account's hold days). */
  deposits?: boolean;
}

/** A place's `branch` field: a branch of `bank`, where its customers withdraw and deposit at the counter. */
export interface BranchFeature {
  bank: string;
}

// ---------------------------------------------------------------- realism features

/**
 * What the economy simulates beyond the level's basics. Each runs from its `on` level, unless the
 * world's Custom toggles (`packs.economy.config.features`) switch it on or off; a toggle reaches
 * down to its `floor`.
 */
export const FINANCE_FEATURES = [
  "flows",
  "cards",
  "payment_prefs",
  "households",
  "living_costs",
  "statements",
  "interest",
  "fees",
  "delinquency",
  "credit",
  "atm",
  "holds",
  "daily_limits",
  "overdraft",
  "average_daily",
  "withholding",
  "tax_brackets",
  "sales_tax",
  "business_tax",
  "capital_gains",
  "investments",
  "options",
  "property",
] as const;
export type FinanceFeature = (typeof FINANCE_FEATURES)[number];

export interface FeatureDef {
  label: string;
  /** The lowest Money level it can run at. */
  floor: Level;
  /** The level from which it runs unless a toggle says otherwise. */
  on: Level;
}

export const FEATURE_DEFS: Readonly<Record<FinanceFeature, FeatureDef>> = Object.freeze({
  flows: { label: "Standing payments and income", floor: 2, on: 3 },
  cards: { label: "Payment cards", floor: 2, on: 3 },
  payment_prefs: { label: "Payment preferences", floor: 2, on: 3 },
  households: { label: "Household shares", floor: 2, on: 3 },
  living_costs: { label: "Living costs", floor: 2, on: 3 },
  statements: { label: "Statements and minimum payments", floor: 3, on: 4 },
  interest: { label: "Interest", floor: 3, on: 4 },
  fees: { label: "Fees", floor: 3, on: 4 },
  delinquency: { label: "Late payments, penalty rates and collections", floor: 3, on: 4 },
  credit: { label: "Credit reports and scores", floor: 3, on: 4 },
  atm: { label: "Cash needs a machine or a branch", floor: 2, on: 4 },
  holds: { label: "Holds on deposits and card payments", floor: 3, on: 4 },
  daily_limits: { label: "Daily card limits", floor: 2, on: 4 },
  overdraft: { label: "Overdraft policies", floor: 2, on: 4 },
  average_daily: { label: "Interest on the average daily balance", floor: 3, on: 4 },
  withholding: { label: "Withholding on pay", floor: 3, on: 3 },
  tax_brackets: { label: "Tax brackets", floor: 3, on: 4 },
  sales_tax: { label: "Sales tax", floor: 3, on: 4 },
  business_tax: { label: "Business taxes", floor: 3, on: 4 },
  capital_gains: { label: "Capital gains", floor: 3, on: 4 },
  investments: { label: "Investments", floor: 3, on: 4 },
  options: { label: "Options", floor: 3, on: 4 },
  property: { label: "Property values, leases and upkeep", floor: 3, on: 3 },
});

/** Whether a feature runs at a Money level, given a world's toggles. */
export function featureOn(level: number, feature: FinanceFeature, toggles?: Readonly<Record<string, unknown>>): boolean {
  const def = FEATURE_DEFS[feature];
  if (level < def.floor) return false;
  const set = toggles?.[feature];
  return typeof set === "boolean" ? set : level >= def.on;
}

// ---------------------------------------------------------------- work and business (§26)

export const PAY_BASES = ["salary", "hourly", "per_shift", "commission", "tips", "stipend"] as const;
export type PayBasis = (typeof PAY_BASES)[number];
/** `per_job` pays at the end of each shift or gig. */
export const PAY_EVERY = ["weekly", "biweekly", "semimonthly", "monthly", "per_job", "custom"] as const;
export type PayEvery = (typeof PAY_EVERY)[number];
export const FILING_STATUSES = ["single", "married_filing_jointly", "head_of_household"] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number];

export interface Deduction {
  label: string;
  /** A 401(k) is pre-tax for income tax only; health premiums are exempt from FICA too. */
  kind?: "retirement" | "health" | "other";
  /** Taken before income tax. */
  pretax: boolean;
  cents?: number;
  pct?: number;
  /** The employer's match, as a percentage of pay. */
  match_pct?: number;
  /** Where it goes: an account of the worker's (a retirement account), else an outside payee by name. */
  to?: string;
}

/**
 * A `job` entity's fields: one worker's employment. The employer is a business entity (it pays from
 * its account) or an outside employer by name. Pay follows work: the season, the start and end,
 * and for hourly or per-shift pay the hours or shifts worked.
 */
export interface JobFields {
  worker: EntityId;
  employer: string;
  /** Where the work is (a place); else the employer business's `places`. */
  workplace?: string;
  title?: string;
  occupation?: string;
  basis: PayBasis;
  /** Salary a year, the hourly rate, or the pay per shift, in minor units. */
  rate: number;
  /** Hourly and per-shift pay counts castlife's scheduled commitments, the hours attended, or the contract's hours. */
  hours?: "scheduled" | "attended" | "contract";
  hours_per_week?: number;
  shifts_per_week?: number;
  weeks_per_year?: number;
  commission_pct?: number;
  /** Tips earned per hour worked, for tipped work. */
  tips_per_hour?: number;
  /** A contractor's pay has nothing withheld (the occupation's `self_employed` by default). */
  contractor?: boolean;
  /** A recurring season, `MM-DD` to `MM-DD` (a summer job). */
  season_from?: string;
  season_to?: string;
  pay_every: PayEvery;
  /** The first payday (weekly and biweekly count from it). */
  pay_anchor?: string;
  /** Semimonthly and monthly: the days of the month. */
  pay_days?: number[];
  pay_weekday?: number;
  /** `custom`: the schedule, flattened like a flow's (`pay_days`, `pay_weekday` and `pay_anchor` too). */
  pay_unit?: "day" | "week" | "month" | "year";
  pay_interval?: number;
  pay_weekdays?: number[];
  pay_months?: number[];
  pay_except?: string[];
  /** Every cycle's roll off a weekend or day-off holiday; `before` when absent. */
  pay_roll?: "none" | "before" | "after";
  start?: string;
  end?: string;
  deductions?: Deduction[];
  /** Where pay lands among the worker's accounts: fixed amounts, then percentages; the rest to their deposit account. */
  splits?: FlowSplit[];
  status?: "active" | "leave" | "ended";
  /** The castlife shift pattern its commitments follow. */
  shift_pattern?: string;
}

/** A `business` entity's money fields; its accounts are the accounts it owns. */
export interface BusinessFields {
  owners: Owner[];
  structure?: "sole_proprietorship" | "partnership" | "llc" | "s_corp" | "c_corp";
  /** Places it trades at: a purchase there pays it. */
  places?: string[];
  /** It collects sales tax on what it sells, at its region's rate. */
  collects_sales_tax?: boolean;
  /** The account takings land in and payroll comes from; else its first deposit account. */
  operating_account?: EntityId;
  industry?: string;
  /** What it keeps of a sale; the rest pays its suppliers. */
  margin_pct?: number;
  /** Net terms on its invoices, and the late fee as a percentage. */
  invoice_days?: number;
  late_fee_pct?: number;
  /** Profit paid out to the owners by share. */
  distribution_pct?: number;
  distribution_every?: "month" | "quarter" | "year";
}

export const INVOICE_STATES = ["open", "paid", "late", "void"] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

export interface Invoice {
  id: string;
  business: EntityId;
  customer: string;
  cents: number;
  memo: string;
  issued: number;
  due: number;
  state: InvoiceState;
  paid?: number;
  late_fee?: number;
  days_late?: number;
  flow?: string;
}

// ---------------------------------------------------------------- holdings, assets and property (§27)

export const ASSET_CLASSES = ["security", "fund", "bond", "option", "property", "business_stake", "crypto", "other"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** An asset positions are held in (`packs.economy.config.assets`, id → def). */
export interface AssetDef {
  /** Distributions a year (dividends, coupons). */
  pays_per_year?: number;
  /** How closely it follows its class's market, 0 to 1. */
  correlation?: number;
  /** Bonds: face value (minor units), coupon and maturity date. */
  face?: number;
  coupon_pct?: number;
  maturity?: string;
  /** Options: delivered in units, or settled in cash. */
  settlement?: "physical" | "cash";
  label: string;
  class: AssetClass;
  symbol?: string;
  /** Price per unit at the start, minor units. */
  price?: number;
  /** The finance table's recipe for its price path (an `investing` row key); the class default otherwise. */
  model?: string;
  annual_return_pct?: number;
  annual_volatility_pct?: number;
  /** Dividends, coupons or rent as a yearly percentage of value. */
  yield_pct?: number;
  /** Options: the underlying asset, the strike (minor units), the expiry date, call or put. */
  underlying?: string;
  strike?: number;
  expiry?: string;
  right?: "call" | "put";
  /** Units per contract (options: 100). */
  multiplier?: number;
  /** The entity it stands for (a business stake's business, a property). */
  entity?: EntityId;
}

/** One purchase of units, for cost basis. */
export interface Lot {
  qty: number;
  /** What the lot cost in all, minor units. */
  cost: number;
  at: number | string;
}

/**
 * A `holding` entity's fields: a position in one asset, in a brokerage or retirement account or
 * held directly by its owners.
 */
export interface HoldingFields {
  account?: EntityId;
  owners?: Owner[];
  asset: string;
  lots: Lot[];
  /** Where its distributions go: an account id, or `reinvest`. */
  route?: string;
}

/** A `property` entity's fields: real estate tied to a place. */
export interface PropertyFields {
  place?: string;
  owners: Owner[];
  /** Its value now: the holdings module's appreciation step moves it, and a GM edit sets it. */
  value: number;
  appreciation_pct?: number;
  purchase_price?: number;
  purchased?: string;
  /** The mortgage it secures (that account's `secured_by` names this property). */
  mortgage?: EntityId;
  /** Yearly property tax as a percentage of value; the region's when absent. */
  tax_pct?: number;
  /** Insurance a month, minor units. */
  insurance?: number;
  /** Upkeep a year as a percentage of value. */
  upkeep_pct?: number;
}

/** A lease: a rent flow from tenant to owner with its term and vacancy (a `flow` linked to the property). */
export interface LeaseView {
  flow: string;
  tenant: string;
  rent: number;
  start: string | null;
  end: string | null;
  state: "let" | "vacant" | "ended";
}

// ---------------------------------------------------------------- the events

/**
 * The economy's event types. The first eight are the older ones, which chats recorded before the
 * foundation was rebuilt and still fold (`economy.price` belongs to the holdings module).
 */
export const FINANCE_EVENTS = {
  anchor: "economy.anchor",
  txn: "economy.txn",
  note: "economy.note",
  modifier: "economy.modifier",
  statement: "economy.statement",
  cardPaid: "economy.card_paid",
  price: "economy.price",
  decline: "economy.decline",
  delinquency: "economy.delinquency",
  flowRun: "economy.flow_run",
  flowRenamed: "economy.flow_renamed",
  hold: "economy.hold",
  settle: "economy.settle",
  credit: "economy.credit",
  score: "economy.score",
  spend: "economy.spend",
  open: "economy.open",
  status: "economy.status",
  accrue: "economy.accrue",
} as const;

/** `economy.open`: accounts whose opening balances have posted (a joint account opens once, with whichever holder's money opens first). */
export interface OpenData {
  accounts: EntityId[];
}

/** `economy.flow_renamed`: a standing payment's new name, from 1 to 80 characters (a player's change, a GM edit). */
export interface FlowRenamedData {
  flow: EntityId;
  name: string;
}

/** `economy.status`: an account's status set in play (frozen, collections, charged off, paid off, closed, open again). */
export interface StatusData {
  account: EntityId;
  status: AccountStatus;
}

/** `economy.accrue`: an interest period ends for an account; its average daily balance starts again from `at`. */
export interface AccrueData {
  account: EntityId;
  at: number;
}

/** `economy.txn`: a posting's journal lines (one per account in the world it touches) and what it was. */
export interface TxnData {
  memo: string;
  lines: { account: EntityId; amount: number }[];
  kind?: TxnKind;
  category?: string;
  counterparty?: string;
  card?: EntityId;
  flow?: string;
  /** Pending until `settles` (card payments where holds run). */
  status?: TxnStatus;
  settles?: number;
  /** A narrated price the charge doesn't match. */
  narrated?: number;
  limited?: "cap" | "band";
  /** When it happened, when that isn't the time it folds (a flow at its own instant inside a slot). */
  at?: number;
}

/**
 * Money in and out of one account in one calendar month, by category (`other` when a line has
 * none), kept by the journal for books and cash flow: the economy slice's
 * `totals[account]["YYYY-MM"][category]`. The last 13 months are kept.
 */
export interface MonthTotals {
  in: number;
  out: number;
}

/** `economy.statement`: a credit account's statement closes (older ones carry only the first five fields). */
export interface StatementData {
  account: EntityId;
  closing: number;
  interest: number;
  minimum: number;
  due: number;
  fees?: number;
  apr?: number;
  stage?: DelinquencyStage;
  grace?: boolean;
  past_due?: number;
  lates?: number;
  penalty?: boolean;
  months_left?: number;
  /** The statement's own instant (older ones close at the time they fold). */
  at?: number;
  streak?: number;
  ontime?: number;
  late30?: number;
  late60?: number;
  late90?: number;
}

/** `economy.card_paid`: a payment toward a credit account's statement. */
export interface CardPaidData {
  account: EntityId;
  cents: number;
}

/** `economy.delinquency`: a credit account moves to a stage (a missed due date, a cure, collections). */
export interface DelinquencyData {
  account: EntityId;
  stage: DelinquencyStage;
  past_due: number;
  lates: number;
  penalty: boolean;
}

/** `economy.flow_run`: what one occurrence of a flow did. */
export interface FlowRunData {
  flow: string;
  at: number;
  outcome: FlowOutcome;
  cents: number;
  /** What it couldn't pay. */
  short?: number;
  retry?: { at: number; left: number; cents: number } | null;
  deferred?: number;
  /** It ran its count or passed its end. */
  ended?: boolean;
}

/** `economy.hold`: money set aside on an account, or (`release`) a hold let go early. */
export type HoldData = Hold | { id: string; account: EntityId; release: true };

/** `economy.settle`: an account's pending journal entries up to a time post. */
export interface SettleData {
  account: EntityId;
  upto: number;
}

/** `economy.credit`: something enters a person's credit history. */
export interface CreditData extends CreditEntry {
  person: EntityId;
}

/** `economy.score`: a person's monthly score. */
export interface ScoreData {
  person: EntityId;
  score: number;
  factors: ScoreFactors;
}

/** `economy.spend`: what a card has spent today, against its daily limits (purchases and machine withdrawals). */
export interface SpendData {
  card: EntityId;
  day: number;
  purchase: number;
  atm: number;
}

// ---------------------------------------------------------------- views

/** A line of money in or out as a dashboard lists it. */
export interface JournalLine {
  id: string;
  at: string;
  memo: string;
  cents: number;
  account: string;
  accountId: EntityId;
  kind: TxnKind | null;
  category: string | null;
  counterparty: string | null;
  card: string | null;
  status: TxnStatus;
}

export interface UpcomingLine {
  at: string;
  /** Clock reading, for sorting. */
  clock: number;
  label: string;
  /** Negative: money out. */
  cents: number;
  flow: string | null;
  account: EntityId | null;
}

export interface AlertLine {
  tone: "info" | "warn" | "neg";
  text: string;
  account?: EntityId;
  flow?: string;
}

export interface CardView {
  id: EntityId;
  name: string;
  network: CardNetwork;
  state: CardState;
  holder: string;
  /** Null on a player surface when the player can't see the holder. */
  holderId: EntityId | null;
  account: EntityId;
  last4: string | null;
  item: EntityId | null;
  dailyPurchaseLimit: number | null;
  dailyAtmLimit: number | null;
  spentToday: number;
}

export interface OwnerLine {
  /** Null on a player surface for an owner the player can't see (named "someone"). */
  party: EntityId | null;
  name: string;
  role: OwnerRole;
  share: number;
}

export interface AccountView {
  id: EntityId;
  name: string;
  class: AccountClass;
  classLabel: string;
  product: { id: string; label: string };
  institution: string | null;
  status: AccountStatus;
  /** From the holder's side: negative on credit means owed. */
  cents: number;
  /** What can be spent or drawn now (credit left, less holds, plus overdraft room); null below the ledger. */
  available: number | null;
  owners: OwnerLine[];
  /** The viewing party's role on it. */
  role: OwnerRole | null;
  limit: number | null;
  aprPct: number | null;
  apyPct: number | null;
  /** Plain lines: APR, APY, fees, grace, due day, minimum rule, overdraft, limits, hold days, term. */
  terms: { label: string; value: string }[];
  /** Null where autopay isn't offered (not credit, or below the level that runs it). */
  autopay: { mode: AutopayMode; from: EntityId | null; fromName: string | null; cents: number | null } | null;
  due: { label: string; cents: number; at: string } | null;
  statements: StatementView[];
  cards: CardView[];
  pending: JournalLine[];
  holds: { id: string; cents: number; until: string; kind: Hold["kind"]; memo: string }[];
  transactions: JournalLine[];
  securedBy: { id: EntityId; name: string } | null;
  loan: { payment: number; monthsLeft: number; payoff: number } | null;
}

export interface FlowView {
  id: string;
  label: string;
  kind: FlowKind;
  from: string;
  to: string;
  /** The amount in words ("$995.00", "the minimum due", "2 % of Savings"). */
  amount: string;
  /** The next amount when it's known ahead, minor units. */
  cents: number | null;
  schedule: string;
  next: string | null;
  shortfall: FlowShortfall;
  status: FlowStatus;
  category: string | null;
  link: { id: EntityId; name: string } | null;
  /** Who pays: the flow's `from` id when it's an entity the viewer can see, else null. */
  payer: EntityId | null;
  /** Whether the viewer may change it; a derived flow is changed at its source (`source`). */
  editable: boolean;
  source: string;
  done: number;
  missed: number;
  deferred: number;
  /** The flow as stored, so an editor can fill its form; null on a player surface when any side of it is someone the player can't see. */
  spec: Flow | null;
}

export interface OverviewView {
  netWorth: number | null;
  assets: number | null;
  liabilities: number | null;
  /** Cash, deposits, investments, property, business, debts. */
  breakdown: { label: string; cents: number }[];
  /** Money in and out over the last 30 days, by category; and what's due in the next 30. */
  cashFlow: { period: string; in: number; out: number; byCategory: { category: string; cents: number }[]; nextIn: number; nextOut: number } | null;
  upcoming: UpcomingLine[];
  alerts: AlertLine[];
}

export interface JobView {
  id: EntityId;
  title: string;
  employer: string;
  employerId: EntityId | null;
  worker: string;
  workerId: EntityId;
  basis: PayBasis;
  /** The pay in words ("$23.50 an hour"). */
  pay: string;
  rate: number;
  payEvery: PayEvery;
  schedule: string;
  nextPay: string | null;
  grossPerPeriod: number | null;
  status: "active" | "leave" | "ended";
  hours: { scheduled: number; attended: number } | null;
  lastPay: { at: string; gross: number; taxes: number; deductions: number; net: number } | null;
  deductions: { label: string; value: string }[];
  splits: { to: string; value: string }[];
  spec: JobFields;
}

/**
 * Where a holding's payouts, a property's rent or a business share's profit go now, as the viewer
 * may see it: an account of theirs (`to`), reinvested, or the usual place (`to` null). An account
 * the viewer doesn't see (another owner's) is `elsewhere`, and `to` never names it.
 */
export interface DistributionRoute {
  to: EntityId | null;
  reinvest: boolean;
  elsewhere?: true;
}

export interface BusinessView {
  id: EntityId;
  name: string;
  /** The viewing party's role. */
  role: OwnerRole | null;
  owners: OwnerLine[];
  accounts: EntityId[];
  places: { id: string; name: string }[];
  /** Year to date. */
  books: { period: string; revenue: number; expenses: number; payroll: number; taxes: number; profit: number; lines: { category: string; cents: number }[] };
  /** The last 12 months, newest first. */
  months: { period: string; revenue: number; expenses: number; profit: number }[];
  sales: JournalLine[];
  invoices: (Invoice & { customerName: string; issuedAt: string; dueAt: string })[];
  employees: JobView[];
  taxes: { label: string; cents: number; due: string | null }[];
  /** Where the viewer's share of its profit goes; null when they hold no share of its worth. */
  route: DistributionRoute | null;
}

export interface HoldingView {
  id: EntityId;
  account: EntityId | null;
  asset: { id: string; label: string; class: AssetClass; symbol: string | null };
  qty: number;
  price: number;
  value: number;
  cost: number;
  gain: number;
  lots: { qty: number; cost: number; at: string; gain: number; term: "short" | "long" }[];
  option: { right: "call" | "put"; underlying: string; strike: number; expiry: string; inTheMoney: boolean } | null;
  /** Where its payouts go; null when it pays none. */
  route: DistributionRoute | null;
}

export interface InvestmentsView {
  value: number;
  cost: number;
  unrealised: number;
  realised: number;
  /** This year: distributions received, gains realised short and long term, and the capital-gains tax estimated and when it's due. */
  income?: number;
  realisedShort?: number;
  realisedLong?: number;
  taxDue?: { cents: number; at: string } | null;
  holdings: HoldingView[];
  /** Assets the party can buy and doesn't hold, at their price now. */
  market?: { asset: string; label: string; class: AssetClass; symbol: string | null; price: number }[];
  /** Accounts that can hold a new position. */
  accounts?: EntityId[];
}

export interface PropertyView {
  id: EntityId;
  name: string;
  place: string | null;
  owners: OwnerLine[];
  /** The viewing party's share, percent. */
  share: number;
  value: number;
  equity: number;
  /** The asking price when it's for sale; a property for sale the party doesn't own comes with share 0. */
  forSale?: number | null;
  mortgage: { id: EntityId; name: string; owed: number; payment: number | null; monthsLeft: number | null } | null;
  leases: LeaseView[];
  /** Property tax, insurance and upkeep flows. */
  costs: FlowView[];
  /** Where its rent goes (`rent_to`), for an owner; null for anyone else. */
  route: DistributionRoute | null;
}

export interface HouseholdView {
  id: EntityId;
  name: string;
  /** A member the player can't see has a null id and is "someone". */
  members: { id: EntityId | null; name: string; role: string; share: number }[];
  accounts: EntityId[];
  flows: FlowView[];
  /** The household's shared costs a month, and each member's part. */
  monthly: { total: number; parts: { id: EntityId | null; name: string; cents: number }[] };
}

/**
 * One party's money, as its dashboard draws it: the player's Money hub (`economy.money`, the POV)
 * and the GM's view of every party (`economy.people_money`) share this shape. `level` is the
 * party's Money level and `detail` whether the full books show (the top level, or a Custom toggle
 * that turns a detailed feature on). The core leaves out what the level doesn't show, so the UI
 * only lays out.
 */
export interface FinanceView {
  party: EntityId;
  name: string;
  partyKind: PartyKind;
  level: number;
  detail: boolean;
  /** The features running for this party. */
  features: FinanceFeature[];
  band: string | null;
  /** False while their authored accounts aren't open yet: balances show the openings they'll post. */
  opened: boolean;
  /** What the HUD shows: the band at level 1, cash on hand from level 2. */
  cash: { band: string } | { cents: number } | null;
  overview: OverviewView | null;
  accounts: AccountView[];
  cards: CardView[];
  flows: FlowView[];
  jobs: JobView[];
  businesses: BusinessView[];
  investments: InvestmentsView | null;
  properties: PropertyView[];
  credit: CreditReport | null;
  household: HouseholdView | null;
  /** The newest journal lines across the accounts shown. */
  recent: JournalLine[];
  /** Private notes (paydays, bills, declines) for the GM; the player's own come as signals instead. */
  notes: { at: string; text: string }[];
  payPrefs: PayTier[];
}

/** The plain-language money summary a character's mind reads (`economy.summary`). */
export interface MoneySummary {
  /** Short sentences in plain terms: what they have, what's coming, what's pressing. */
  lines: string[];
  band: string | null;
  /** Roughly what they could spend today without trouble, minor units; null below Money 2. */
  spendable: number | null;
  /** Money owed that's due or past due soon. */
  pressing: { label: string; cents: number; at: string }[];
}

// ---------------------------------------------------------------- player actions

/**
 * The action ids the money dashboards send (`lre.action`). Each is an in-world action the engine
 * validates and plays like any other (DESIGN §11). The work and business ones are the work
 * module's, the investing ones the holdings module's.
 */
export const FINANCE_ACTIONS = {
  buy: "buy",
  pay: "pay",
  transfer: "move_money",
  payCard: "pay_card",
  withdraw: "withdraw_cash",
  deposit: "deposit_cash",
  cardFreeze: "card_freeze",
  cardUnfreeze: "card_unfreeze",
  cardLost: "card_report_lost",
  cardReplace: "card_replace",
  autopay: "set_autopay",
  flowCreate: "flow_create",
  flowUpdate: "flow_update",
  flowPause: "flow_pause",
  flowResume: "flow_resume",
  flowDelete: "flow_delete",
  applyCredit: "apply_credit",
  payPrefs: "set_pay_prefs",
  hire: "job_hire",
  fire: "job_end",
  raise: "job_raise",
  invoiceIssue: "invoice_issue",
  invoicePay: "invoice_pay",
  invoiceVoid: "invoice_void",
  draw: "owner_draw",
  distribute: "distribute_profit",
  trade: "trade",
  exercise: "exercise_option",
  route: "route_distributions",
  propertyBuy: "property_buy",
  propertySell: "property_sell",
  leaseStart: "lease_start",
  leaseEnd: "lease_end",
  stakeSell: "stake_sell",
} as const;
