// The money hub's layout, worked out from a party's view (DESIGN §25 realism gating): which
// sections show, how accounts group, which controls each thing offers the player (from the
// owner's role and the features running) and the choices the forms offer. Pure, so what the
// dashboards show at each level is tested directly; the core already left out what the level
// doesn't simulate, and nothing here shows detail the view marks as below the top level.

import { CLASS_TRAITS, ROLE_RIGHTS, type AccountView, type CardView, type FinanceFeature, type FinanceView, type OwnerRole } from "../../../shared/finance";
import type { EntityId } from "../../../shared/ids";
import type { PaletteView } from "../../../shared/state-view";
import { cardChanges, type CardChange } from "./requests";

export type HubSection = "overview" | "accounts" | "flows" | "jobs" | "businesses" | "investments" | "properties" | "credit" | "household";

export const SECTION_LABELS: Readonly<Record<HubSection, string>> = { overview: "Overview", accounts: "Accounts", flows: "Flows", jobs: "Jobs", businesses: "Businesses", investments: "Investments", properties: "Properties", credit: "Credit", household: "Household" };

export interface HubTab {
  id: HubSection;
  label: string;
  /** Something there needs attention (an alert, a payment due or late, a declined flow). */
  dot: boolean;
}

/**
 * The hub's sections for a party, in order. Money 1 is a band and nothing else; from 2 a section
 * shows when the party has something there (accounts; flows, or the feature that runs them from
 * its accounts; a job, a household, …), so a household that holds no account of its own still
 * shows its members, and a player with no job or business sees no empty tab for one.
 */
export function hubTabs(view: FinanceView): HubTab[] {
  if (view.level <= 0) return [];
  const tabs: HubTab[] = [{ id: "overview", label: SECTION_LABELS.overview, dot: view.overview?.alerts.some((a) => a.tone !== "info") ?? false }];
  if (view.level === 1) return tabs;
  const hasAccounts = view.accounts.length > 0;
  if (hasAccounts) tabs.push({ id: "accounts", label: SECTION_LABELS.accounts, dot: view.accounts.some((a) => a.status !== "open" || a.statements.some((s) => s.state === "late") || a.cards.some((c) => c.state === "lost")) });
  if ((hasAccounts && view.features.includes("flows")) || view.flows.length > 0) tabs.push({ id: "flows", label: SECTION_LABELS.flows, dot: view.flows.some((f) => f.missed > 0 && f.status === "active") });
  if (view.jobs.length > 0) tabs.push({ id: "jobs", label: SECTION_LABELS.jobs, dot: false });
  if (view.businesses.length > 0) tabs.push({ id: "businesses", label: SECTION_LABELS.businesses, dot: view.businesses.some((b) => b.invoices.some((i) => i.state === "late")) });
  if (view.investments !== null) tabs.push({ id: "investments", label: SECTION_LABELS.investments, dot: false });
  if (view.properties.length > 0) tabs.push({ id: "properties", label: SECTION_LABELS.properties, dot: view.properties.some((p) => p.leases.some((l) => l.state === "vacant")) });
  if (view.credit !== null) tabs.push({ id: "credit", label: SECTION_LABELS.credit, dot: view.credit.marks.length > 0 });
  if (view.household !== null) tabs.push({ id: "household", label: SECTION_LABELS.household, dot: false });
  return tabs;
}

export type AccountGroup = "cash" | "banking" | "credit" | "loans" | "investing";

export const GROUP_LABELS: Readonly<Record<AccountGroup, string>> = { cash: "Cash", banking: "Bank accounts", credit: "Cards and credit lines", loans: "Loans", investing: "Investment accounts" };

export function groupOf(account: AccountView): AccountGroup {
  const t = CLASS_TRAITS[account.class];
  if (t.cash) return "cash";
  if (t.investment) return "investing";
  if (t.installment) return "loans";
  if (t.revolving) return "credit";
  return "banking";
}

/** Accounts by group, in the groups' order, each group's accounts as the view lists them. */
export function accountGroups(accounts: readonly AccountView[]): { group: AccountGroup; label: string; accounts: AccountView[] }[] {
  const order: AccountGroup[] = ["cash", "banking", "credit", "loans", "investing"];
  return order.map((group) => ({ group, label: GROUP_LABELS[group], accounts: accounts.filter((a) => groupOf(a) === group) })).filter((g) => g.accounts.length > 0);
}

/** What the viewing party's role lets it do with an account; no role (the GM looking at it) is no right. */
function rights(role: OwnerRole | null): { spend: boolean; manage: boolean; sees: boolean } {
  return role ? ROLE_RIGHTS[role] : { spend: false, manage: false, sees: false };
}

export type AccountControl = "pay" | "transfer" | "autopay" | "withdraw" | "deposit";

/**
 * The player's controls on one account, in the order the account card shows them:
 * - `pay`: something owed on a card, a line or a loan, from an account they may pay from;
 * - `transfer`: money out of an account they may spend from, to another of theirs (cash moves by
 *   Withdraw and Deposit instead, which at the top level need a machine or a branch);
 * - `autopay`: where the view offers autopay (credit accounts, at the level that runs it) and they manage the account;
 * - `withdraw` and `deposit`: cash out of and into a bank account they may spend from, when they hold cash.
 */
export function accountControls(view: FinanceView, account: AccountView): AccountControl[] {
  if (view.level < 2 || account.status === "closed" || account.status === "charged_off" || account.status === "paid_off") return [];
  const t = CLASS_TRAITS[account.class];
  const r = rights(account.role);
  const out: AccountControl[] = [];
  if ((t.revolving || t.installment) && account.cents < 0 && paySources(view).some((a) => a.id !== account.id)) out.push("pay");
  if (r.spend && account.status === "open" && moveSources(view).some((a) => a.id === account.id) && transferTargets(view, account.id).length > 0) out.push("transfer");
  if (account.autopay !== null && r.manage) out.push("autopay");
  const holdsCash = view.accounts.some((a) => CLASS_TRAITS[a.class].cash && rights(a.role).spend);
  if (holdsCash && r.spend && account.status === "open" && t.asset && !t.cash && !t.locked && !t.investment && t.depositRank !== null) out.push("withdraw", "deposit");
  return out;
}

/** Accounts the party may pay from: open asset accounts that pay and that its role lets it spend, never a locked one. */
export function paySources(view: FinanceView): AccountView[] {
  return view.accounts.filter((a) => {
    const t = CLASS_TRAITS[a.class];
    return t.pays && t.asset && !t.locked && a.status === "open" && rights(a.role).spend;
  });
}

/** Accounts money can move out of between the party's own: open, spendable, holding money, not cash and not locked (a brokerage's cash among them). */
export function moveSources(view: FinanceView): AccountView[] {
  return view.accounts.filter((a) => {
    const t = CLASS_TRAITS[a.class];
    return t.asset && !t.cash && !t.locked && a.status === "open" && rights(a.role).spend;
  });
}

/** Accounts money can move into from `from`: the party's other open asset accounts but cash (a CD or a retirement account takes money in, though it won't give it back early). */
export function transferTargets(view: FinanceView, from: EntityId): AccountView[] {
  return view.accounts.filter((a) => a.id !== from && CLASS_TRAITS[a.class].asset && !CLASS_TRAITS[a.class].cash && a.status === "open" && rights(a.role).sees);
}

/** The card changes the player may make: on a card they hold, or on one on an account they manage. */
export function cardControls(view: FinanceView, card: CardView): CardChange[] {
  const account = view.accounts.find((a) => a.id === card.account);
  if (card.holderId !== view.party && !rights(account?.role ?? null).manage) return [];
  return cardChanges(card.state);
}

/** Where a new standing payment can come from: a non-cash account the party may pay from (flows never draw on wallet cash). */
export function flowSources(view: FinanceView): { id: string; label: string }[] {
  return paySources(view)
    .filter((a) => !CLASS_TRAITS[a.class].cash)
    .map((a) => ({ id: a.id, label: a.name }));
}

/** The people the player may name (a payee, a tenant, a hire): the palette's Pay targets, which list only people the POV knows. */
export function knownPeople(palette: PaletteView | null): { id: string; label: string }[] {
  const pay = palette?.entries.find((e) => e.action === "pay");
  return (pay?.options ?? []).flatMap((o) => (typeof o.params.to === "string" ? [{ id: o.params.to, label: o.label }] : []));
}

/** Where a standing payment can go: the party's own accounts (savings, a card to pay off), the people the player may pay, or an outside payee by name (typed). */
export function flowTargets(view: FinanceView, palette: PaletteView | null): { id: string; label: string }[] {
  const own = view.accounts.filter((a) => a.status === "open" && !CLASS_TRAITS[a.class].cash && rights(a.role).sees).map((a) => ({ id: a.id, label: `${a.name} (yours)` }));
  return [...own, ...knownPeople(palette).filter((p) => !own.some((o) => o.id === p.id))];
}

/** How much of a credit account's limit is in use, percent; null without a limit (a charge card). */
export function utilisation(account: AccountView): number | null {
  return account.limit !== null && account.limit > 0 ? Math.round((Math.max(0, -account.cents) * 100) / account.limit) : null;
}

// ---------------------------------------------------------------- realism gating

/**
 * Whether a party's view shows a detailed feature: always at the top level (`detail`), else only
 * where the world's Custom toggles run the feature for it. Below that the books stay simple, even
 * when the view carries more (the GM's view of someone at a lower level).
 */
function shows(view: FinanceView, feature: FinanceFeature): boolean {
  return view.detail || view.features.includes(feature);
}

export interface OverviewBlocks {
  /** Assets and what's owed, apart from the net worth. */
  assets: boolean;
  breakdown: boolean;
  cashFlowByCategory: boolean;
  /** What's due in and out over the next 30 days. */
  cashFlowAhead: boolean;
  upcoming: number;
  recent: number;
}

export function overviewBlocks(view: FinanceView): OverviewBlocks {
  const assets = view.detail || shows(view, "investments") || shows(view, "property");
  return { assets, breakdown: assets, cashFlowByCategory: view.detail, cashFlowAhead: view.detail, upcoming: view.detail ? 20 : 5, recent: view.detail ? 20 : 5 };
}

export interface AccountBlocks {
  /** What can be spent now, beside the balance: credit left, holds, overdraft room. */
  available: boolean;
  terms: boolean;
  statements: boolean;
  pending: boolean;
  holds: boolean;
  /** Its owners and their roles: shown for a shared account, or in the full books. */
  owners: boolean;
  /** The card's daily limits and today's spend. */
  cardLimits: boolean;
  transactions: number;
}

export function accountBlocks(view: FinanceView, account: AccountView): AccountBlocks {
  const t = CLASS_TRAITS[account.class];
  return {
    available: account.available !== null && (t.revolving || shows(view, "holds") || shows(view, "overdraft")),
    terms: view.detail && account.terms.length > 0,
    statements: shows(view, "statements") && account.statements.length > 0,
    pending: shows(view, "holds") && account.pending.length > 0,
    holds: shows(view, "holds") && account.holds.length > 0,
    owners: account.owners.length > 1 || (view.detail && account.owners.length > 0),
    cardLimits: shows(view, "daily_limits"),
    transactions: view.detail ? 40 : 5,
  };
}

export interface InvestmentBlocks {
  /** Each holding's lots, with cost basis and gain by term. */
  lots: boolean;
  /** Gains realised this year, short and long term, and the tax on them. */
  gains: boolean;
  /** Distributions received this year. */
  income: boolean;
}

export function investmentBlocks(view: FinanceView): InvestmentBlocks {
  return { lots: shows(view, "capital_gains"), gains: shows(view, "capital_gains"), income: view.detail };
}

export interface CreditBlocks {
  /** What the score is made of. */
  factors: boolean;
  /** The report: its accounts, inquiries and marks. */
  report: boolean;
  /** The score's history, month by month. */
  history: number;
}

export function creditBlocks(view: FinanceView): CreditBlocks {
  return { factors: view.detail, report: view.detail, history: view.detail ? 12 : 0 };
}

export interface WorkBlocks {
  /** A paycheck's taxes and deductions apart from its gross and net. */
  withholding: boolean;
  deductions: boolean;
  /** A business's books by category, its sales and its taxes. */
  books: boolean;
  sales: boolean;
  taxes: boolean;
}

export function workBlocks(view: FinanceView): WorkBlocks {
  return { withholding: shows(view, "withholding"), deductions: view.detail, books: view.detail, sales: view.detail, taxes: shows(view, "business_tax") || shows(view, "sales_tax") };
}
