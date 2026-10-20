// The money hub's layout, worked out from a party's view (DESIGN §25 realism gating): which
// sections show, how accounts group, which controls each thing offers the player (from the
// owner's role and the features running) and the choices the forms offer. Pure, so what the
// dashboards show at each level is tested directly; the core already left out what the level
// doesn't simulate, and nothing here shows detail the view marks as below the top level.

import { CLASS_TRAITS, ROLE_RIGHTS, type AccountView, type AlertLine, type BusinessView, type CardView, type DistributionRoute, type FinanceFeature, type FinanceView, type FlowView, type HoldingView, type HouseholdView, type Invoice, type JobView, type OwnerRole, type PartyKind, type PropertyView, type RoleRights, type UpcomingLine } from "../../../shared/finance";
import type { EntityId } from "../../../shared/ids";
import type { GmView, PaletteView } from "../../../shared/state-view";
import { cardChanges, type CardChange } from "./requests";

/** What a route picker opens on when the route in force is another owner's account, which the viewer can't pick. */
export const ROUTE_ELSEWHERE = " elsewhere";

/**
 * What a route picker opens on for the route a view says is in force: an account of the viewer's,
 * `reinvest`, " " for the usual place, ROUTE_ELSEWHERE for another owner's account, and "" (unset)
 * when the view says none.
 */
export function routePick(route: DistributionRoute | null): string {
  if (!route) return "";
  if (route.reinvest) return "reinvest";
  if (route.elsewhere) return ROUTE_ELSEWHERE;
  return route.to ?? " ";
}

/** A party's name as an owner: "Marcus Delgado's", and a household's, which is its family's and so a plural, "The Kowalczyks'". */
export function possessive(name: string, household: boolean): string {
  return household && name.endsWith("s") ? `${name}'` : `${name}'s`;
}

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
 * shows its members, and a player with no job or business sees no empty tab for one. The GM also
 * gets the sections that hold its create controls while they're empty, wherever what it adds would
 * show: a person's Jobs, anyone's Properties, and a person's Household where households run for
 * them (a household switched off shows nothing, so a member's would read as none).
 */
export function hubTabs(view: FinanceView, mode: "player" | "gm"): HubTab[] {
  if (view.level <= 0) return [];
  const tabs: HubTab[] = [{ id: "overview", label: SECTION_LABELS.overview, dot: view.overview?.alerts.some((a) => a.tone !== "info") ?? false }];
  if (view.level === 1) return tabs;
  const hasAccounts = view.accounts.length > 0;
  // A view without an overview is a band only (no accounts yet): nothing the GM adds would show in it.
  const creates = mode === "gm" && view.overview !== null;
  const person = view.partyKind === "person";
  if (hasAccounts) tabs.push({ id: "accounts", label: SECTION_LABELS.accounts, dot: view.accounts.some((a) => a.status !== "open" || a.statements.some((s) => s.state === "late") || a.cards.some((c) => c.state === "lost")) });
  if ((hasAccounts && view.features.includes("flows")) || view.flows.length > 0) tabs.push({ id: "flows", label: SECTION_LABELS.flows, dot: view.flows.some((f) => f.missed > 0 && f.status === "active") });
  if (view.jobs.length > 0 || (creates && person)) tabs.push({ id: "jobs", label: SECTION_LABELS.jobs, dot: false });
  if (view.businesses.length > 0) tabs.push({ id: "businesses", label: SECTION_LABELS.businesses, dot: view.businesses.some((b) => b.invoices.some((i) => i.state === "late")) });
  if (view.investments !== null) tabs.push({ id: "investments", label: SECTION_LABELS.investments, dot: false });
  if (view.properties.length > 0 || creates) tabs.push({ id: "properties", label: SECTION_LABELS.properties, dot: view.properties.some((p) => p.leases.some((l) => l.state === "vacant")) });
  if (view.credit !== null) tabs.push({ id: "credit", label: SECTION_LABELS.credit, dot: view.credit.marks.length > 0 });
  if (view.household !== null || (creates && person && view.features.includes("households"))) tabs.push({ id: "household", label: SECTION_LABELS.household, dot: false });
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

/**
 * Every account the party's view holds: its own (`accounts`), then those of a business it runs
 * that it holds no role on itself (`BusinessView.managed`), which it manages for the business. An
 * account's page, its cards and where a standing payment or an autopay pays from look in all of
 * them; the Accounts section lists only the party's own, and the business's page its own.
 */
export function viewAccounts(view: FinanceView): AccountView[] {
  const out = [...view.accounts];
  for (const b of view.businesses) for (const a of b.managed) if (!out.some((x) => x.id === a.id)) out.push(a);
  return out;
}

export function findAccount(view: FinanceView, id: string | undefined): AccountView | null {
  return viewAccounts(view).find((a) => a.id === id) ?? null;
}

/**
 * A business's accounts as its page lists them, in the business's order: each one the view holds
 * (by the party's own role on it, or managed for the business), and the ids of the rest, which the
 * party neither holds nor manages, so its view doesn't show them.
 */
export function businessAccounts(view: FinanceView, business: BusinessView): { shown: AccountView[]; others: EntityId[] } {
  const all = viewAccounts(view);
  const shown: AccountView[] = [];
  const others: EntityId[] = [];
  for (const id of business.accounts) {
    const a = all.find((x) => x.id === id);
    if (a) shown.push(a);
    else others.push(id);
  }
  return { shown, others };
}

/** What the viewing party's role lets it do with an account, a business or a property; no role (the GM looking at it) is no right. */
function rights(role: OwnerRole | null): RoleRights {
  return role ? ROLE_RIGHTS[role] : { spend: false, worth: false, sees: false, manage: false };
}

export type AccountControl = "pay" | "transfer" | "autopay" | "withdraw" | "deposit";

/**
 * The player's controls on one account, in the order the account card shows them:
 * - `pay`: something owed on a card, a line or a loan they hold, from an account they may pay from
 *   (a business's loan they only manage is the business's to pay, from its own account by autopay);
 * - `transfer`: money out of an account they may spend from, to another of theirs (cash moves by
 *   Withdraw and Deposit instead, which at the top level need a machine or a branch);
 * - `autopay`: where the view offers autopay (credit accounts, at the level that runs it) and they manage the account (by their role on it, or on the business that holds it);
 * - `withdraw` and `deposit`: cash out of and into a bank account they may spend from, when they hold cash.
 * Spending (`pay`, `transfer`, `withdraw`, `deposit`) follows their own role on the account;
 * managing one for a business gives none of it.
 */
export function accountControls(view: FinanceView, account: AccountView): AccountControl[] {
  if (view.level < 2 || account.status === "closed" || account.status === "charged_off" || account.status === "paid_off") return [];
  const t = CLASS_TRAITS[account.class];
  const r = rights(account.role);
  const out: AccountControl[] = [];
  if ((t.revolving || t.installment) && account.role !== null && account.cents < 0 && paySources(view).some((a) => a.id !== account.id)) out.push("pay");
  if (r.spend && account.status === "open" && moveSources(view).some((a) => a.id === account.id) && transferTargets(view, account.id).length > 0) out.push("transfer");
  if (account.autopay !== null && account.manages) out.push("autopay");
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

/** The card changes the player may make: on a card they hold, or on one on an account they manage (a business's, for its owner). */
export function cardControls(view: FinanceView, card: CardView): CardChange[] {
  if (card.holderId !== view.party && findAccount(view, card.account)?.manages !== true) return [];
  return cardChanges(card.state);
}

export type FlowControl = "edit" | "pause" | "resume" | "end_lease" | "delete" | "pay_now";

/**
 * The player's controls on one flow, in the order its row shows them. One they may change they
 * edit, pause, resume and delete, and rent they pay under a lease also ends by notice where
 * property runs. From Money 3 (where invoices are actions) an invoice billed to them, or to a
 * business they run, they pay before it falls due. Anything else changes at its source (a job, a
 * loan, the lease's owner).
 */
export function flowControls(view: FinanceView, flow: FlowView): FlowControl[] {
  if (flow.editable) {
    const out: FlowControl[] = [];
    if (flow.status !== "ended") out.push("edit");
    if (flow.status === "active") out.push("pause");
    if (flow.status === "paused") out.push("resume");
    if (flow.kind === "rent" && flow.link !== null && flow.status !== "ended" && view.features.includes("property")) out.push("end_lease");
    out.push("delete");
    return out;
  }
  const payer = flow.payer;
  const billed = payer !== null && (payer === view.party || view.businesses.some((b) => b.id === payer && rights(b.role).manage));
  return view.level >= 3 && flow.source === "invoice" && flow.link !== null && billed ? ["pay_now"] : [];
}

export type JobControl = "quit" | "raise" | "let_go";

/** The player's controls on a job while it lasts, from Money 3 (where work is actions): its worker quits; whoever runs the employer (shown on its payroll) gives a raise or lets them go. */
export function jobControls(view: FinanceView, job: JobView, employer: BusinessView | null): JobControl[] {
  if (view.level < 3 || job.status === "ended") return [];
  const out: JobControl[] = job.workerId === view.party ? ["quit"] : [];
  if (employer && rights(employer.role).manage) out.push("raise", "let_go");
  return out;
}

export type BusinessControl = "hire" | "invoice" | "draw" | "distribute" | "stake";

/** The player's controls on a business from Money 3: running it (hiring, invoicing, drawing, paying out profit) for whoever manages it; selling a stake, where investments run, for whoever holds a share of its worth. */
export function businessControls(view: FinanceView, business: BusinessView): BusinessControl[] {
  if (view.level < 3) return [];
  const r = rights(business.role);
  const out: BusinessControl[] = r.manage ? ["hire", "invoice", "draw", "distribute"] : [];
  if (r.worth && view.features.includes("investments")) out.push("stake");
  return out;
}

export type InvoiceControl = "void" | "pay";

/** The player's controls on an invoice a business issued, from Money 3 and while it's open or late: whoever runs the business voids it; the customer pays it. */
export function invoiceControls(view: FinanceView, business: BusinessView, invoice: Invoice): InvoiceControl[] {
  if (view.level < 3 || (invoice.state !== "open" && invoice.state !== "late")) return [];
  const out: InvoiceControl[] = rights(business.role).manage ? ["void"] : [];
  if (invoice.customer === view.party) out.push("pay");
  return out;
}

export type HoldingControl = "buy" | "sell" | "exercise";

/** The player's trades on a holding, where investments run for the party and its account is theirs to spend from: buy more, sell, and exercise an option where options run. */
export function holdingControls(view: FinanceView, holding: HoldingView): HoldingControl[] {
  if (!view.features.includes("investments")) return [];
  if (holding.account !== null && !rights(view.accounts.find((a) => a.id === holding.account)?.role ?? null).spend) return [];
  return holding.option && view.features.includes("options") ? ["buy", "sell", "exercise"] : ["buy", "sell"];
}

export type PropertyControl = "let" | "sell" | "buy";

/** The player's controls on a property, where property runs for the party: letting and selling one they own a share of, buying one for sale. */
export function propertyControls(view: FinanceView, property: PropertyView): PropertyControl[] {
  if (!view.features.includes("property")) return [];
  if (property.share > 0) return ["let", "sell"];
  return property.forSale !== null && property.forSale !== undefined ? ["buy"] : [];
}

/** The leases on a property the player may end: those still let that their books carry (outside tenants of a managed property come and go on their own). */
export function endableLeases(view: FinanceView, property: PropertyView): string[] {
  if (!propertyControls(view, property).includes("let")) return [];
  return property.leases.filter((l) => l.state === "let" && view.flows.some((f) => f.id === l.flow)).map((l) => l.flow);
}

/**
 * A property's Mortgage over choices on its Buy page: the terms its lenders offer, as the view sends
 * them (longest first; none on a property the player can't buy), in years where they come to whole
 * years, the one a purchase gets unless another is chosen marked as the usual.
 */
export function mortgageTermChoices(property: PropertyView): { value: string; label: string; detail?: string }[] {
  return (property.mortgageTerms ?? []).map((t) => {
    const [n, unit] = t.months % 12 === 0 ? [t.months / 12, "year"] : [t.months, "month"];
    return { value: String(t.months), label: `${n} ${unit}${n === 1 ? "" : "s"}`, ...(t.usual ? { detail: "The usual" } : {}) };
  });
}

/**
 * Where a new standing payment can come from: a non-cash account that pays and that the party
 * manages, by their role on it or on the business that holds it, a business's own account they
 * hold no role on included: the business pays it. Flows never draw on wallet cash, and an
 * authorized user spends on a card but sets up no standing payments.
 */
export function flowSources(view: FinanceView): { id: string; label: string }[] {
  return viewAccounts(view)
    .filter((a) => {
      const t = CLASS_TRAITS[a.class];
      return t.pays && t.asset && !t.locked && !t.cash && a.status === "open" && a.manages;
    })
    .map((a) => ({ id: a.id, label: a.name }));
}

/**
 * Where a credit account's autopay can pay from: another open, non-cash account that pays and that
 * the party may spend from or manages (the business's own account, for a loan of the business
 * they run).
 */
export function autopaySources(view: FinanceView, account: AccountView): AccountView[] {
  return viewAccounts(view).filter((a) => {
    const t = CLASS_TRAITS[a.class];
    return a.id !== account.id && t.pays && t.asset && !t.locked && !t.cash && a.status === "open" && (rights(a.role).spend || a.manages);
  });
}

/** The people the player may name (a payee, a tenant, a hire): the palette's Pay targets, which list only people the POV knows. */
export function knownPeople(palette: PaletteView | null): { id: string; label: string }[] {
  const pay = palette?.entries.find((e) => e.action === "pay");
  return (pay?.options ?? []).flatMap((o) => (typeof o.params.to === "string" ? [{ id: o.params.to, label: o.label }] : []));
}

/** Whom a business's manager may hire, of the people the player may name: no one already on its payroll, whom the economy won't hire twice. */
export function hireable<T extends { value: string }>(business: BusinessView, people: readonly T[]): T[] {
  return people.filter((p) => !business.employees.some((j) => j.workerId === p.value && j.status !== "ended"));
}

/** True when `kind` is `ancestor` or extends it, up the GM view's kinds as the engine's `kindIs` walks them (a loop ends the walk). */
export function gmKindIs(kinds: GmView["kinds"], kind: string, ancestor: string): boolean {
  const seen = new Set<string>();
  for (let id: string | null = kind; id !== null && !seen.has(id); id = kinds.find((k) => k.id === id)?.extends ?? null) {
    if (id === ancestor) return true;
    seen.add(id);
  }
  return false;
}

/** The party kinds in the order the economy tries them (`partyKindOf`): a business, a trust or a household before a person, which any of them might extend. */
const PARTY_KIND_ORDER: readonly PartyKind[] = ["business", "trust", "household", "person"];

/** The world's parties of `kinds` for a GM's picker, each with the kind the economy gives it (a kind that extends a person's is a person); whoever is gone is left out. */
export function gmParties(gm: Pick<GmView, "entities" | "kinds">, kinds: readonly PartyKind[]): { id: EntityId; name: string; kind: PartyKind }[] {
  const out: { id: EntityId; name: string; kind: PartyKind }[] = [];
  for (const e of gm.entities) {
    const kind = e.gone ? undefined : PARTY_KIND_ORDER.find((k) => gmKindIs(gm.kinds, e.kind, k));
    if (kind !== undefined && kinds.includes(kind)) out.push({ id: e.id, name: e.name, kind });
  }
  return out;
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

export interface HouseholdRow {
  /** The row's key: the member's id, or its place for someone the player can't see. */
  key: string;
  id: EntityId | null;
  name: string;
  role: string;
  share: number;
  /** Their part of the shared costs a month. */
  cents: number | null;
}

/**
 * A household's members as its card lists them, each with its part of the shared costs. Someone
 * the player can't see has no id, so they're paired by place: the view lists the members and
 * their parts in the same order.
 */
export function householdRows(h: HouseholdView): HouseholdRow[] {
  return h.members.map((m, i) => {
    const part = h.monthly.parts.find((p, j) => (m.id === null ? j === i && p.id === null : p.id === m.id));
    return { key: m.id ?? `someone:${i}`, id: m.id, name: m.name, role: m.role, share: m.share, cents: part?.cents ?? null };
  });
}

/** A household's shared accounts: the party's own among them by name, and the ids of the ones only the household holds, which the party's view doesn't name. */
export function sharedAccounts(view: FinanceView, h: HouseholdView): { names: string[]; others: EntityId[] } {
  const names: string[] = [];
  const others: EntityId[] = [];
  for (const id of h.accounts) {
    const a = view.accounts.find((x) => x.id === id);
    if (a) names.push(a.name);
    else others.push(id);
  }
  return { names, others };
}

// ---------------------------------------------------------------- realism gating

/**
 * Whether a party's view shows a feature's own detail: wherever the feature runs for the party,
 * from its usual level or from its floor where the world switches it on, and nowhere it's switched
 * off, the top level included. The rest of the full books (`detail`) is the top level's alone, so
 * a feature switched on lower shows its own detail and nothing else.
 */
function shows(view: FinanceView, feature: FinanceFeature): boolean {
  return view.features.includes(feature);
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
  /** What can be spent now, beside the balance: credit left, holds, overdraft room. A loan has none to spend: what's left on it shows as owed. */
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
    available: account.available !== null && !t.installment && (t.revolving || shows(view, "holds") || shows(view, "overdraft")),
    terms: view.detail && account.terms.length > 0,
    statements: shows(view, "statements") && account.statements.length > 0,
    pending: shows(view, "holds") && account.pending.length > 0,
    holds: shows(view, "holds") && account.holds.length > 0,
    owners: account.owners.length > 1 || (view.detail && account.owners.length > 0),
    cardLimits: shows(view, "daily_limits"),
    transactions: view.detail ? 40 : 5,
  };
}

/** Whether a card shows its daily limits and today's spend: as on the cards of any account (`AccountBlocks.cardLimits`), a card on someone else's account included. */
export function cardLimitsShown(view: FinanceView): boolean {
  return shows(view, "daily_limits");
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

// ---------------------------------------------------------------- Now's glance

/** How far ahead Now's money glance looks for what's coming up: about three days of the world's clock, in minutes. */
export const GLANCE_AHEAD_MINUTES = 3 * 24 * 60;

export type GlanceLine = { kind: "alert"; alert: AlertLine } | { kind: "upcoming"; line: UpcomingLine };

/**
 * What Now's money glance may show, in order: the overview's problems, then its
 * warnings, then what's coming up within about three days of `now` (the HUD clock's minutes),
 * compared by each line's clock and never its words. Without a clock only the alerts show; the
 * glance shows the first few.
 */
export function glanceLines(view: FinanceView, now: number | null): GlanceLine[] {
  const o = view.overview;
  if (!o) return [];
  const alerts = [...o.alerts.filter((a) => a.tone === "neg"), ...o.alerts.filter((a) => a.tone === "warn")].map((alert): GlanceLine => ({ kind: "alert", alert }));
  const soon = now === null ? [] : o.upcoming.filter((u) => u.clock <= now + GLANCE_AHEAD_MINUTES).map((line): GlanceLine => ({ kind: "upcoming", line }));
  return [...alerts, ...soon];
}
