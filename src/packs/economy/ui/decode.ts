// The money dashboards' view (`FinanceView`, shared/finance.ts) as it arrives: JSON from the
// player's state push (`economy.money`), the GM view (`GmView.money`) or an organization's page
// in Orgs (`orgs.org`'s money section), and the economy's other sections of that page (payroll,
// ownership, taxes). Read defensively, so a view an older or newer backend built still draws what
// it can; null when it isn't one at all.

import { isRecord } from "../../../shared/json";
import type { JsonObject } from "../../../shared/json";
import {
  ACCOUNT_CLASSES,
  ACCOUNT_STATUSES,
  ASSET_CLASSES,
  AUTOPAY_MODES,
  CARD_NETWORKS,
  CARD_STATES,
  CREDIT_TIERS,
  DELINQUENCY_STAGES,
  DEPRECIATION_METHODS,
  FINANCE_FEATURES,
  FLOW_KINDS,
  FLOW_SHORTFALLS,
  FLOW_STATUSES,
  INVOICE_STATES,
  OWNER_ROLES,
  PARTY_KINDS,
  PAY_BASES,
  PAY_CHOICES,
  STATEMENT_PERIODS,
  TXN_KINDS,
  type CashFlowStatement,
  type IncomeStatement,
  type StatementsView,
  type AccountView,
  type DistributionRoute,
  type OwnerRole,
  type CardView,
  type CreditReport,
  type FinanceView,
  type Flow,
  type FlowAmount,
  type FlowSchedule,
  type FlowView,
  type HoldingView,
  type IndexView,
  type InterestView,
  type JobFields,
  type JobView,
  type JournalLine,
  type ListingView,
  type MarketActs,
  type OwnerLine,
  type OwnershipView,
  type PayTier,
  type PerformanceView,
  type PropertyView,
  type StatementView,
  type StructureLink,
  type TaxesView,
  type UnemploymentView,
  type MergeView,
  type WindingView,
  type WindLine,
} from "../../../shared/finance";
import type { RevenueStreamView } from "../../../shared/revenue";
import { decodeTaxesExtra, type TaxesExtra } from "../../../shared/tax-year";
import { bool, list, num, obj, oneOf, optNum, str, strings, type Obj } from "../../../frontend/decode";

function nullableNum(value: unknown): number | null {
  return optNum(value) ?? null;
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** One of `values`, or null when the value isn't one. */
function nullableOf<T extends string>(value: unknown, values: readonly T[]): T | null {
  return values.find((v) => v === value) ?? null;
}

const INCOME_CLASSES = ["revenue", "cogs", "opex", "interest", "investment", "income_tax", "depreciation", "depletion"] as const;
const CASH_LINE_SECTIONS = ["operating", "investing", "financing", "owners", "correction", "opening"] as const;

function incomeStatement(i: Obj | null): IncomeStatement {
  const r = i ?? {};
  const m = obj(r.margins) ?? {};
  return {
    revenue: num(r.revenue),
    cogs: num(r.cogs),
    grossProfit: num(r.grossProfit),
    opex: num(r.opex),
    depreciation: num(r.depreciation),
    depletion: num(r.depletion),
    operatingIncome: num(r.operatingIncome),
    ebitda: num(r.ebitda),
    interest: num(r.interest),
    investmentIncome: num(r.investmentIncome),
    preTax: num(r.preTax),
    tax: num(r.tax),
    netIncome: num(r.netIncome),
    margins: { gross: nullableNum(m.gross), operating: nullableNum(m.operating), ebitda: nullableNum(m.ebitda), net: nullableNum(m.net) },
    lines: list(r.lines, (l) => ({ category: str(l.category), label: str(l.label), class: oneOf(l.class, INCOME_CLASSES, "opex"), cents: num(l.cents) })),
  };
}

function cashFlowStatement(c: Obj | null): CashFlowStatement {
  const r = c ?? {};
  return { operating: num(r.operating), investing: num(r.investing), financing: num(r.financing), owners: num(r.owners), corrections: num(r.corrections), openings: num(r.openings), change: num(r.change), start: num(r.start), end: num(r.end), lines: list(r.lines, (l) => ({ section: oneOf(l.section, CASH_LINE_SECTIONS, "operating"), label: str(l.label), cents: num(l.cents) })) };
}

/** A party's statements (§26.5), or undefined when the value isn't one. */
export function decodeStatements(value: unknown): StatementsView | undefined {
  const s = obj(value);
  if (!s) return undefined;
  const balance = obj(s.balance) ?? {};
  return {
    kind: s.kind === "personal" ? "personal" : "books",
    depreciation: oneOf(s.depreciation, DEPRECIATION_METHODS, "none"),
    ebitdaNote: nullableStr(s.ebitdaNote),
    periods: list(s.periods, (p) => ({ id: oneOf(p.id, STATEMENT_PERIODS, "month"), label: str(p.label), from: str(p.from), to: str(p.to), income: incomeStatement(obj(p.income)), cash: cashFlowStatement(obj(p.cash)) })),
    balance: { assets: num(balance.assets), liabilities: num(balance.liabilities), equity: num(balance.equity), lines: list(balance.lines, (b) => ({ label: str(b.label), cents: num(b.cents), ...(b.vehicle === true ? { vehicle: true as const } : {}) })) },
  };
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === "number" && Number.isFinite(v)) : [];
}

function idName(value: unknown): { id: string; name: string } | null {
  const o = obj(value);
  return o && typeof o.id === "string" ? { id: o.id, name: str(o.name, o.id) } : null;
}

function journalLine(o: Obj): JournalLine | null {
  return {
    id: str(o.id),
    at: str(o.at),
    memo: str(o.memo),
    cents: num(o.cents),
    account: str(o.account),
    accountId: str(o.accountId),
    kind: nullableOf(o.kind, TXN_KINDS),
    category: nullableStr(o.category),
    counterparty: nullableStr(o.counterparty),
    card: nullableStr(o.card),
    ...(typeof o.by === "string" && o.by !== "" ? { by: o.by } : {}),
    status: o.status === "pending" ? "pending" : "posted",
  };
}

function ownerLine(o: Obj): OwnerLine | null {
  // An owner the player can't see comes with a null id and the name "someone".
  const party = typeof o.party === "string" ? o.party : o.party === null ? null : undefined;
  if (party === undefined) return null;
  const units = optNum(o.units);
  const votes = optNum(o.votes);
  const value = optNum(o.value);
  return { party, name: str(o.name, party ?? "someone"), role: oneOf(o.role, OWNER_ROLES, "owner"), share: num(o.share), ...(units !== undefined ? { units } : {}), ...(typeof o.class === "string" ? { class: o.class } : {}), ...(votes !== undefined ? { votes } : {}), ...(value !== undefined ? { value } : {}), ...(o.public === true ? { public: true } : {}) };
}

/** A listed company's market, as its Ownership sends it; null for one not on a market. */
function listingView(value: unknown): ListingView | null {
  const l = obj(value);
  if (!l || typeof l.asset !== "string") return null;
  return { asset: l.asset, symbol: str(l.symbol, l.asset), since: str(l.since), price: num(l.price), float: num(l.float), held: num(l.held), available: num(l.available), marketCap: num(l.marketCap), fair: nullableNum(l.fair), performance: performance(l.performance) };
}

/** What the reader may do about a company's market; null for the GM's view. */
function marketActs(value: unknown): MarketActs | null {
  const m = obj(value);
  return m ? { list: nullableStr(m.list), delist: nullableStr(m.delist), offer: nullableStr(m.offer), units: num(m.units), ...(m.voteList === true ? { voteList: true } : {}), ...(m.voteDelist === true ? { voteDelist: true } : {}) } : null;
}

function structureLink(o: Obj): StructureLink | null {
  const trust = obj(o.trust);
  const role = trust ? oneOf(trust.role, OWNER_ROLES, "beneficiary") : null;
  return typeof o.id === "string" ? { id: o.id, name: str(o.name, o.id), share: num(o.share), votes: num(o.votes), controlled: o.controlled === true, value: nullableNum(o.value), netWorth: nullableNum(o.netWorth), cash: nullableNum(o.cash), profit: nullableNum(o.profit), children: list(o.children, structureLink), ...(role !== null ? { trust: { role } } : {}) } : null;
}

function card(o: Obj): CardView | null {
  if (typeof o.id !== "string") return null;
  return {
    id: o.id,
    name: str(o.name, o.id),
    network: oneOf(o.network, CARD_NETWORKS, "debit"),
    state: oneOf(o.state, CARD_STATES, "active"),
    holder: str(o.holder),
    holderId: nullableStr(o.holderId),
    account: str(o.account),
    last4: nullableStr(o.last4),
    item: nullableStr(o.item),
    dailyPurchaseLimit: nullableNum(o.dailyPurchaseLimit),
    dailyAtmLimit: nullableNum(o.dailyAtmLimit),
    spentToday: num(o.spentToday),
  };
}

/** An account's interest block: null where none runs, or when it isn't one. */
function interest(value: unknown): InterestView | null {
  const o = obj(value);
  if (!o || (o.way !== "earns" && o.way !== "charges")) return null;
  const last = obj(o.last);
  const next = obj(o.next);
  return { way: o.way, ratePct: num(o.ratePct), basis: str(o.basis), thisYear: num(o.thisYear), last: last ? { cents: num(last.cents), at: str(last.at) } : null, next: next ? { cents: num(next.cents), at: str(next.at) } : null };
}

function statement(o: Obj): StatementView | null {
  return {
    at: str(o.at),
    closing: num(o.closing),
    interest: num(o.interest),
    fees: num(o.fees),
    minimum: num(o.minimum),
    due: str(o.due),
    paid: num(o.paid),
    apr: num(o.apr),
    stage: oneOf(o.stage, DELINQUENCY_STAGES, "current"),
    state: oneOf(o.state, ["paid", "minimum", "open", "late"] as const, "open"),
  };
}

function account(o: Obj): AccountView | null {
  if (typeof o.id !== "string") return null;
  const product = obj(o.product);
  const autopay = obj(o.autopay);
  const due = obj(o.due);
  const loan = obj(o.loan);
  return {
    id: o.id,
    name: str(o.name, o.id),
    class: oneOf(o.class, ACCOUNT_CLASSES, "checking"),
    classLabel: str(o.classLabel),
    product: { id: str(product?.id), label: str(product?.label) },
    institution: nullableStr(o.institution),
    status: oneOf(o.status, ACCOUNT_STATUSES, "open"),
    cents: num(o.cents),
    available: nullableNum(o.available),
    owners: list(o.owners, ownerLine),
    role: nullableOf(o.role, OWNER_ROLES),
    manages: o.manages === true,
    spends: o.spends === true,
    autopayFrom: strings(o.autopayFrom),
    fallbacks: strings(o.fallbacks),
    limit: nullableNum(o.limit),
    interest: interest(o.interest),
    terms: list(o.terms, (t) => ({ label: str(t.label), value: str(t.value) })),
    autopay: autopay ? { mode: oneOf(autopay.mode, AUTOPAY_MODES, "none"), from: nullableStr(autopay.from), fromName: nullableStr(autopay.fromName), cents: nullableNum(autopay.cents) } : null,
    due: due ? { label: str(due.label), cents: num(due.cents), at: str(due.at) } : null,
    statements: list(o.statements, statement),
    cards: list(o.cards, card),
    pending: list(o.pending, journalLine),
    holds: list(o.holds, (h) => ({ id: str(h.id), cents: num(h.cents), until: str(h.until), kind: h.kind === "authorization" ? "authorization" : "deposit", memo: str(h.memo) })),
    transactions: list(o.transactions, journalLine),
    securedBy: idName(o.securedBy),
    loan: loan ? { payment: num(loan.payment), monthsLeft: num(loan.monthsLeft), payoff: num(loan.payoff) } : null,
  };
}

function flowAmount(value: unknown): FlowAmount {
  const o = obj(value) ?? {};
  if (typeof o.fixed === "number") return { fixed: o.fixed };
  if (typeof o.formula === "string") return { formula: o.formula };
  if (typeof o.table === "string") return { table: o.table, row: str(o.row), ...(typeof o.column === "string" ? { column: o.column } : {}), ...(typeof o.scale === "number" ? { scale: o.scale } : {}) };
  const range = obj(o.range);
  if (range) return { range: { min: num(range.min), max: num(range.max) } };
  if (typeof o.percent === "number") return { percent: o.percent, ...(typeof o.of === "string" ? { of: o.of } : {}) };
  if (o.due === "minimum" || o.due === "statement" || o.due === "balance") return { due: o.due };
  if (typeof o.provider === "string") return { provider: o.provider, ...(isRecord(o.args) ? { args: JSON.parse(JSON.stringify(o.args)) as JsonObject } : {}) };
  return { fixed: 0 };
}

function flowSchedule(value: unknown): FlowSchedule {
  const o = obj(value) ?? {};
  const out: FlowSchedule = {};
  const every = nullableOf(o.every, ["day", "week", "month", "year"] as const);
  if (every) out.every = every;
  if (typeof o.interval === "number") out.interval = o.interval;
  if (Array.isArray(o.weekdays)) out.weekdays = numbers(o.weekdays);
  if (Array.isArray(o.days)) out.days = numbers(o.days);
  if (Array.isArray(o.months)) out.months = numbers(o.months);
  if (Array.isArray(o.except)) out.except = strings(o.except);
  const roll = nullableOf(o.roll, ["none", "before", "after"] as const);
  if (roll) out.roll = roll;
  if (typeof o.at === "string") out.at = o.at;
  if (typeof o.once === "string" || typeof o.once === "number") out.once = o.once;
  return out;
}

/** A stored flow, as `FlowView.spec` carries it for the edit form. */
export function decodeFlow(o: Obj): Flow {
  return {
    id: str(o.id),
    label: str(o.label),
    kind: oneOf(o.kind, FLOW_KINDS, "other"),
    from: str(o.from),
    to: str(o.to),
    ...(Array.isArray(o.splits) ? { splits: list(o.splits, (s) => (typeof s.to === "string" ? { to: s.to, ...(typeof s.cents === "number" ? { cents: s.cents } : {}), ...(typeof s.pct === "number" ? { pct: s.pct } : {}) } : null)) } : {}),
    ...(Array.isArray(o.shares) ? { shares: list(o.shares, (s) => (typeof s.party === "string" ? { party: s.party, pct: num(s.pct), ...(typeof s.from === "string" ? { from: s.from } : {}) } : null)) } : {}),
    amount: flowAmount(o.amount),
    schedule: flowSchedule(o.schedule),
    ...(typeof o.start === "string" ? { start: o.start } : {}),
    ...(typeof o.end === "string" ? { end: o.end } : {}),
    ...(typeof o.count === "number" ? { count: o.count } : {}),
    shortfall: oneOf(o.shortfall, FLOW_SHORTFALLS, "skip"),
    ...(typeof o.retry_days === "number" ? { retry_days: o.retry_days } : {}),
    ...(typeof o.retries === "number" ? { retries: o.retries } : {}),
    ...(typeof o.fallback === "string" ? { fallback: o.fallback } : {}),
    ...(typeof o.category === "string" ? { category: o.category } : {}),
    ...(typeof o.link === "string" ? { link: o.link } : {}),
    status: oneOf(o.status, FLOW_STATUSES, "active"),
    ...(typeof o.method === "string" ? { method: o.method } : {}),
    source: str(o.source, "entity"),
  };
}

function flowView(o: Obj): FlowView | null {
  if (typeof o.id !== "string") return null;
  return {
    id: o.id,
    label: str(o.label, o.id),
    kind: oneOf(o.kind, FLOW_KINDS, "other"),
    from: str(o.from),
    to: str(o.to),
    amount: str(o.amount),
    cents: nullableNum(o.cents),
    schedule: str(o.schedule),
    next: nullableStr(o.next),
    shortfall: oneOf(o.shortfall, FLOW_SHORTFALLS, "skip"),
    status: oneOf(o.status, FLOW_STATUSES, "active"),
    category: nullableStr(o.category),
    link: idName(o.link),
    payer: nullableStr(o.payer),
    payee: nullableStr(o.payee),
    direction: o.direction === "in" || o.direction === "out" ? o.direction : null,
    whose: idName(o.whose),
    editable: bool(o.editable),
    source: str(o.source, "entity"),
    done: num(o.done),
    missed: num(o.missed),
    deferred: num(o.deferred),
    spec: obj(o.spec) ? decodeFlow({ id: o.id, ...(obj(o.spec) ?? {}) }) : null,
  };
}

function jobSpec(o: Obj): JobFields {
  const spec: JobFields = { worker: str(o.worker), employer: str(o.employer), basis: oneOf(o.basis, PAY_BASES, "salary"), rate: num(o.rate), pay_every: oneOf(o.pay_every, PAY_CHOICES, "biweekly") };
  // The rest are plain values of the job's declared fields; the GM's edit form shows them as stored.
  for (const [key, value] of Object.entries(o)) if (!(key in spec) && value !== undefined) (spec as unknown as JsonObject)[key] = JSON.parse(JSON.stringify(value)) as JsonObject[string];
  return spec;
}

function job(o: Obj): JobView | null {
  if (typeof o.id !== "string") return null;
  const hours = obj(o.hours);
  const last = obj(o.lastPay);
  return {
    id: o.id,
    title: str(o.title),
    employer: str(o.employer),
    employerId: nullableStr(o.employerId),
    worker: str(o.worker),
    workerId: str(o.workerId),
    basis: oneOf(o.basis, PAY_BASES, "salary"),
    pay: str(o.pay),
    rate: num(o.rate),
    payEvery: oneOf(o.payEvery, PAY_CHOICES, "biweekly"),
    schedule: str(o.schedule),
    nextPay: nullableStr(o.nextPay),
    grossPerPeriod: nullableNum(o.grossPerPeriod),
    status: oneOf(o.status, ["active", "leave", "ended"] as const, "active"),
    hours: hours ? { scheduled: num(hours.scheduled), attended: num(hours.attended) } : null,
    lastPay: last ? { at: str(last.at), gross: num(last.gross), taxes: num(last.taxes), deductions: num(last.deductions), net: num(last.net) } : null,
    deductions: list(o.deductions, (d) => ({ label: str(d.label), value: str(d.value) })),
    splits: list(o.splits, (s) => ({ to: str(s.to), value: str(s.value) })),
    spec: jobSpec(obj(o.spec) ?? {}),
  };
}

function holding(o: Obj): HoldingView | null {
  if (typeof o.id !== "string") return null;
  const asset = obj(o.asset) ?? {};
  const option = obj(o.option);
  return {
    id: o.id,
    account: nullableStr(o.account),
    asset: { id: str(asset.id), label: str(asset.label, str(asset.id)), class: oneOf(asset.class, ASSET_CLASSES, "other"), symbol: nullableStr(asset.symbol) },
    qty: num(o.qty),
    price: num(o.price),
    value: num(o.value),
    cost: num(o.cost),
    gain: num(o.gain),
    lots: list(o.lots, (l) => ({ qty: num(l.qty), cost: num(l.cost), at: str(l.at), gain: num(l.gain), term: l.term === "long" ? "long" : "short" })),
    option: option ? { right: option.right === "put" ? "put" : "call", underlying: str(option.underlying), strike: num(option.strike), expiry: str(option.expiry), inTheMoney: bool(option.inTheMoney) } : null,
    route: distributionRoute(o.route),
    performance: performance(o.performance),
  };
}

/** How a holding's price has done, as a view sends it; null when it sends none. */
function performance(value: unknown): PerformanceView | null {
  const p = obj(value);
  return p ? { points: list(p.points, (x) => (typeof x.at === "string" ? { at: x.at, price: num(x.price) } : null)), month: nullableNum(p.month), year: nullableNum(p.year), twelve: nullableNum(p.twelve) } : null;
}

/** The stock market, as a view sends it; null where the world keeps no history. */
function indexView(value: unknown): IndexView | null {
  const v = obj(value);
  if (!v) return null;
  return { history: bool(v.history), from: str(v.from), to: str(v.to), source: str(v.source), points: list(v.points, (x) => (typeof x.at === "string" ? { at: x.at, level: num(x.level) } : null)), month: num(v.month), year: num(v.year), twelve: num(v.twelve) };
}

/** Where payouts go, as a view sends it; null when it says none. */
function distributionRoute(value: unknown): HoldingView["route"] {
  const r = obj(value);
  return r ? { to: nullableStr(r.to), reinvest: bool(r.reinvest), ...(r.elsewhere === true ? { elsewhere: true as const } : {}) } : null;
}

function property(o: Obj): PropertyView | null {
  if (typeof o.id !== "string") return null;
  const mortgage = obj(o.mortgage);
  return {
    id: o.id,
    name: str(o.name, o.id),
    place: nullableStr(o.place),
    owners: list(o.owners, ownerLine),
    share: num(o.share),
    value: num(o.value),
    equity: num(o.equity),
    mortgage: mortgage && typeof mortgage.id === "string" ? { id: mortgage.id, name: str(mortgage.name, mortgage.id), owed: num(mortgage.owed), payment: nullableNum(mortgage.payment), monthsLeft: nullableNum(mortgage.monthsLeft) } : null,
    leases: list(o.leases, (l) => ({ flow: str(l.flow), tenant: str(l.tenant), rent: num(l.rent), start: nullableStr(l.start), end: nullableStr(l.end), state: oneOf(l.state, ["let", "vacant", "ended"] as const, "let") })),
    costs: list(o.costs, flowView),
    forSale: nullableNum(o.forSale),
    route: distributionRoute(o.route),
    // Only on a property the viewer may buy: absent stays absent.
    ...(Array.isArray(o.mortgageTerms) ? { mortgageTerms: list(o.mortgageTerms, (t) => (typeof t.months === "number" && t.months > 0 ? { months: t.months, usual: bool(t.usual) } : null)) } : {}),
  };
}

function credit(o: Obj): CreditReport {
  const factors = obj(o.factors);
  return {
    person: str(o.person),
    score: nullableNum(o.score),
    band: nullableStr(o.band),
    tier: nullableOf(o.tier, CREDIT_TIERS),
    asOf: nullableStr(o.asOf),
    factors: factors ? { payment: num(factors.payment), utilisation: num(factors.utilisation), age: num(factors.age), mix: num(factors.mix), recent: num(factors.recent) } : null,
    history: list(o.history, (h) => ({ at: str(h.at), score: num(h.score) })),
    utilisationPct: num(o.utilisationPct),
    ageMonths: num(o.ageMonths),
    onTimePct: num(o.onTimePct),
    accounts: list(o.accounts, (a) => (typeof a.id === "string" ? { id: a.id, name: str(a.name, a.id), class: oneOf(a.class, ACCOUNT_CLASSES, "credit_card"), status: oneOf(a.status, ACCOUNT_STATUSES, "open"), limit: nullableNum(a.limit), owed: num(a.owed), opened: nullableStr(a.opened), late30: num(a.late30), late60: num(a.late60), late90: num(a.late90) } : null)),
    inquiries: list(o.inquiries, (i) => ({ at: str(i.at), note: str(i.note) })),
    marks: list(o.marks, (m) => ({ at: str(m.at), kind: str(m.kind), note: str(m.note) })),
    offers: list(o.offers, (f) => (typeof f.product === "string" ? { product: f.product, label: str(f.label, f.product), class: oneOf(f.class, ACCOUNT_CLASSES, "credit_card"), aprPct: nullableNum(f.aprPct), limit: nullableNum(f.limit) } : null)),
  };
}

function payTier(o: Obj): PayTier | null {
  if (typeof o.use !== "string") return null;
  return {
    use: o.use,
    ...(typeof o.min === "number" ? { min: o.min } : {}),
    ...(typeof o.max === "number" ? { max: o.max } : {}),
    ...(Array.isArray(o.categories) ? { categories: strings(o.categories) } : {}),
    ...(Array.isArray(o.except) ? { except: strings(o.except) } : {}),
  };
}

/** A view's `statements`, as an optional field: absent when the value isn't statements. */
function statementsField(value: unknown): { statements?: StatementsView } {
  const statements = decodeStatements(value);
  return statements ? { statements } : {};
}

/** A party's money view, or null when the value isn't one (the panel then shows the JSON). */
export function decodeFinanceView(value: unknown): FinanceView | null {
  if (!isRecord(value) || typeof value.party !== "string" || typeof value.level !== "number") return null;
  const overview = obj(value.overview);
  const flow = overview ? obj(overview.cashFlow) : null;
  const cash = obj(value.cash);
  const investments = obj(value.investments);
  const household = obj(value.household);
  const report = obj(value.credit);
  return {
    party: value.party,
    name: str(value.name, value.party),
    partyKind: oneOf(value.partyKind, PARTY_KINDS, "person"),
    level: num(value.level),
    detail: bool(value.detail),
    features: strings(value.features).flatMap((f) => FINANCE_FEATURES.filter((known) => known === f)),
    band: nullableStr(value.band),
    opened: value.opened !== false,
    cash: cash ? (typeof cash.cents === "number" ? { cents: cash.cents } : { band: str(cash.band) }) : null,
    overview: overview
      ? {
          netWorth: nullableNum(overview.netWorth),
          assets: nullableNum(overview.assets),
          liabilities: nullableNum(overview.liabilities),
          breakdown: list(overview.breakdown, (b) => ({ label: str(b.label), cents: num(b.cents), ...(b.vehicle === true ? { vehicle: true as const } : {}) })),
          cashFlow: flow ? { period: str(flow.period), in: num(flow.in), out: num(flow.out), byCategory: list(flow.byCategory, (c) => ({ category: str(c.category), cents: num(c.cents) })), nextIn: num(flow.nextIn), nextOut: num(flow.nextOut) } : null,
          upcoming: list(overview.upcoming, (u) => ({ at: str(u.at), clock: num(u.clock), label: str(u.label), cents: num(u.cents), flow: nullableStr(u.flow), account: nullableStr(u.account) })),
          alerts: list(overview.alerts, (a) => ({ tone: oneOf(a.tone, ["info", "warn", "neg"] as const, "info"), text: str(a.text), ...(typeof a.account === "string" ? { account: a.account } : {}), ...(typeof a.flow === "string" ? { flow: a.flow } : {}) })),
        }
      : null,
    accounts: list(value.accounts, account),
    cards: list(value.cards, card),
    flows: list(value.flows, flowView),
    jobs: list(value.jobs, job),
    businesses: list(value.businesses, (b) => {
      if (typeof b.id !== "string") return null;
      const books = obj(b.books) ?? {};
      return {
        id: b.id,
        name: str(b.name, b.id),
        role: nullableOf(b.role, OWNER_ROLES),
        mayDraw: b.mayDraw === true,
        selfDealing: strings(b.selfDealing),
        owners: list(b.owners, ownerLine),
        accounts: strings(b.accounts),
        managed: list(b.managed, account),
        places: list(b.places, (p) => (typeof p.id === "string" ? { id: p.id, name: str(p.name, p.id) } : null)),
        books: { period: str(books.period), revenue: num(books.revenue), expenses: num(books.expenses), payroll: num(books.payroll), taxes: num(books.taxes), profit: num(books.profit), lines: list(books.lines, (l) => ({ category: str(l.category), cents: num(l.cents) })) },
        months: list(b.months, (m) => ({ period: str(m.period), revenue: num(m.revenue), expenses: num(m.expenses), profit: num(m.profit) })),
        sales: list(b.sales, journalLine),
        invoices: list(b.invoices, (i) =>
          typeof i.id === "string"
            ? {
                id: i.id,
                business: str(i.business, b.id as string),
                customer: str(i.customer),
                cents: num(i.cents),
                memo: str(i.memo),
                issued: num(i.issued),
                due: num(i.due),
                state: oneOf(i.state, INVOICE_STATES, "open"),
                ...(typeof i.paid === "number" ? { paid: i.paid } : {}),
                ...(typeof i.late_fee === "number" ? { late_fee: i.late_fee } : {}),
                ...(typeof i.days_late === "number" ? { days_late: i.days_late } : {}),
                ...(typeof i.flow === "string" ? { flow: i.flow } : {}),
                customerName: str(i.customerName, str(i.customer)),
                issuedAt: str(i.issuedAt),
                dueAt: str(i.dueAt),
              }
            : null,
        ),
        employees: list(b.employees, job),
        taxes: list(b.taxes, (t) => ({ label: str(t.label), cents: num(t.cents), due: nullableStr(t.due) })),
        route: distributionRoute(b.route),
        ...statementsField(b.statements),
      };
    }),
    investments: investments
      ? {
          value: num(investments.value),
          cost: num(investments.cost),
          unrealised: num(investments.unrealised),
          realised: num(investments.realised),
          ...(typeof investments.income === "number" ? { income: investments.income } : {}),
          ...(typeof investments.realisedShort === "number" ? { realisedShort: investments.realisedShort } : {}),
          ...(typeof investments.realisedLong === "number" ? { realisedLong: investments.realisedLong } : {}),
          taxDue: obj(investments.taxDue) ? { cents: num(obj(investments.taxDue)?.cents), at: str(obj(investments.taxDue)?.at) } : null,
          holdings: list(investments.holdings, holding),
          market: list(investments.market, (m) => (typeof m.asset === "string" ? { asset: m.asset, label: str(m.label, m.asset), class: oneOf(m.class, ASSET_CLASSES, "other"), symbol: nullableStr(m.symbol), price: num(m.price) } : null)),
          accounts: strings(investments.accounts),
          index: indexView(investments.index),
        }
      : null,
    properties: list(value.properties, property),
    credit: report ? credit(report) : null,
    household:
      household && typeof household.id === "string"
        ? {
            id: household.id,
            name: str(household.name, household.id),
            members: list(household.members, (m) => (typeof m.id === "string" || m.id === null ? { id: typeof m.id === "string" ? m.id : null, name: str(m.name, typeof m.id === "string" ? m.id : "someone"), role: str(m.role), share: num(m.share) } : null)),
            accounts: strings(household.accounts),
            flows: list(household.flows, flowView),
            monthly: { total: num(obj(household.monthly)?.total), parts: list(obj(household.monthly)?.parts, (p) => (typeof p.id === "string" || p.id === null ? { id: typeof p.id === "string" ? p.id : null, name: str(p.name, typeof p.id === "string" ? p.id : "someone"), cents: num(p.cents) } : null)) },
          }
        : null,
    recent: list(value.recent, journalLine),
    notes: list(value.notes, (n) => ({ at: str(n.at), text: str(n.text) })),
    payPrefs: list(value.payPrefs, payTier),
    paysFor: list(value.paysFor, (p) => (typeof p.from === "string" ? { from: p.from, to: strings(p.to) } : null)),
    ownKeys: strings(value.ownKeys),
    ...statementsField(value.statements),
    ...(Array.isArray(value.streams) ? { streams: value.streams.filter(isRecord) as unknown as RevenueStreamView[] } : {}),
  };
}

/** An employer's unemployment taxes as its Taxes and Payroll show their rates (`UnemploymentView`); null when it isn't one. */
export function decodeUnemployment(value: unknown): UnemploymentView | null {
  const o = obj(value);
  if (!o) return null;
  const f = obj(o.futa);
  const s = obj(o.suta);
  return { futa: f ? { pct: num(f.pct), grossPct: num(f.grossPct), creditPct: num(f.creditPct), reductionPct: num(f.reductionPct), base: num(f.base) } : null, suta: s ? { pct: num(s.pct), base: num(s.base) } : null };
}

/** A company's Payroll in Orgs (the economy's `payroll` section of its page): how many are on its payroll, what payroll has cost it this year, each job, and its unemployment taxes this year with their rates (ORG-SPEC §3.11, Phase 5). */
export interface PayrollSection {
  headcount: number;
  payroll: number;
  employees: JobView[];
  unemployment: { futa: number; suta: number; rates: UnemploymentView | null } | null;
}

export function decodePayroll(value: unknown): PayrollSection | null {
  const o = obj(value);
  if (!o) return null;
  const u = obj(o.unemployment);
  return { headcount: num(o.headcount), payroll: num(o.payroll), employees: list(o.employees, job), unemployment: u ? { futa: num(u.futa), suta: num(u.suta), rates: decodeUnemployment(u.rates) } : null };
}

/** A company's winding up as its Ownership shows it (`WindingView`); null while it trades and the reader may not wind it up. */
function decodeWinding(value: unknown): WindingView | null {
  const o = obj(value);
  if (!o) return null;
  const into = obj(o.mergedInto);
  const line = (l: Obj): WindLine => ({ label: str(l.label), cents: num(l.cents) });
  return {
    since: nullableStr(o.since),
    dissolved: nullableStr(o.dissolved),
    mergedInto: into ? { id: nullableStr(into.id), name: str(into.name, "another company") } : null,
    why: nullableStr(o.why),
    cash: num(o.cash),
    debts: list(o.debts, line),
    owed: list(o.owed, line),
    assets: list(o.assets, (x) => (typeof x.id === "string" ? { id: x.id, label: str(x.label, x.id), value: nullableNum(x.value), goes: str(x.goes) } : null)),
    staff: list(o.staff, (s) => ({ id: nullableStr(s.id), name: str(s.name, "someone") })),
    payments: list(o.payments, (p) => (typeof p.id === "string" ? { id: p.id, label: str(p.label, p.id) } : null)),
    payouts: list(o.payouts, (p) => ({ party: nullableStr(p.party), name: str(p.name, "someone"), share: num(p.share), cents: num(p.cents) })),
    short: num(o.short),
    ...(o.vote === true ? { vote: true } : {}),
  };
}

/** The companies the reader may merge a company with (`MergeView`). */
function decodeMerge(value: unknown): MergeView | null {
  const o = obj(value);
  return o ? { why: nullableStr(o.why), units: num(o.units), perUnit: num(o.perUnit), with: list(o.with, (m) => (typeof m.id === "string" ? { id: m.id, name: str(m.name, m.id), units: num(m.units), perUnit: num(m.perUnit) } : null)), ...(o.vote === true ? { vote: true } : {}) } : null;
}

/** A company's Ownership in Orgs (the economy's `ownership` section, `OwnershipView`). */
export function decodeOwnership(value: unknown): OwnershipView | null {
  const o = obj(value);
  if (!o) return null;
  const v = obj(o.valuation);
  const c = obj(o.consolidated);
  const a = obj(o.acts);
  return {
    structure: str(o.structure, "llc"),
    owners: list(o.owners, ownerLine),
    classes: Array.isArray(o.classes) ? list(o.classes, (k) => (typeof k.id === "string" ? { id: k.id, label: str(k.label, k.id), votes: num(k.votes) } : null)) : null,
    units: nullableNum(o.units),
    listing: listingView(o.listing),
    market: marketActs(o.market),
    decidePct: optNum(o.decidePct) ?? 50,
    netWorth: nullableNum(o.netWorth),
    valuation: v ? { value: num(v.value), set: v.set === true, book: num(v.book), profit: num(v.profit), multiple: num(v.multiple), perUnit: nullableNum(v.perUnit), floored: v.floored === true, ...(obj(v.market) ? { market: { price: num(obj(v.market)?.price), units: num(obj(v.market)?.units) } } : {}) } : null,
    parents: list(o.parents, structureLink),
    children: list(o.children, structureLink),
    consolidated: c ? { cash: num(c.cash), profit: num(c.profit), netWorth: num(c.netWorth), companies: num(c.companies) } : null,
    role: nullableOf(o.role, OWNER_ROLES),
    mayDraw: o.mayDraw === true,
    route: distributionRoute(o.route),
    votes: num(o.votes),
    acts: a ? { decide: nullableStr(a.decide), restructure: nullableStr(a.restructure), vote: a.vote === true, voteRestructure: a.voteRestructure === true, holdings: nullableStr(a.holdings), found: nullableStr(a.found), sources: list(a.sources, (s) => (typeof s.id === "string" ? { id: s.id, name: str(s.name, s.id), balance: str(s.balance) } : null)) } : null,
    winding: decodeWinding(o.winding),
    merge: decodeMerge(o.merge),
  };
}

/** An organization's Taxes in Orgs (the economy's `taxes` section, `TaxesView`). */
export function decodeTaxes(value: unknown): (TaxesView & TaxesExtra) | null {
  const o = obj(value);
  if (!o) return null;
  const share = (x: Obj): { name: string; share: number } => ({ name: str(x.name, "someone"), share: num(x.share) });
  const p = obj(o.pending);
  const e = obj(o.exempt);
  const c = obj(o.consolidation);
  const a = obj(o.acts);
  return {
    income: o.income === "corporate" || o.income === "owners" || o.income === "exempt" ? o.income : null,
    years: list(o.years, (y) => ({ year: num(y.year), salesCollected: num(y.salesCollected), salesRemitted: num(y.salesRemitted), withheld: num(y.withheld), employerShare: num(y.employerShare), futa: num(y.futa), futaPaid: num(y.futaPaid), suta: num(y.suta), sutaPaid: num(y.sutaPaid), income: num(y.income), property: num(y.property), donations: num(y.donations) })),
    salesHeld: num(o.salesHeld),
    incomeSoFar: nullableNum(o.incomeSoFar),
    taxedTo: list(o.taxedTo, share),
    untaxed: list(o.untaxed, share),
    exemptHolders: list(o.exemptHolders, share),
    due: list(o.due, (d) => ({ label: str(d.label), cents: nullableNum(d.cents), at: str(d.at) })),
    pending: p ? { structure: str(p.structure), from: str(p.from) } : null,
    unemployment: decodeUnemployment(o.unemployment),
    exempt: e ? { status: str(e.status), name: str(e.name, str(e.status)), code: str(e.code), deductible: bool(e.deductible), futa: bool(e.futa), suta: bool(e.suta) } : null,
    statuses: Array.isArray(o.statuses) ? list(o.statuses, (s) => (typeof s.id === "string" ? { id: s.id, name: str(s.name, s.id), code: str(s.code) } : null)) : null,
    consolidation: c ? { elected: bool(c.elected), members: list(c.members, (m) => ({ name: str(m.name, "a company"), votes: num(m.votes), share: num(m.share) })), profit: nullableNum(c.profit), tax: nullableNum(c.tax) } : null,
    filedBy: typeof o.filedBy === "string" ? o.filedBy : null,
    acts: a ? { consolidate: typeof a.consolidate === "string" ? a.consolidate : null } : null,
    ...decodeTaxesExtra(o),
  };
}
