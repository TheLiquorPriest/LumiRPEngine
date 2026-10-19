// The money dashboards' view (`FinanceView`, shared/finance.ts) as it arrives: JSON from the
// player's state push (`economy.money`) or the GM view (`GmView.money`). Read defensively, so a
// view an older or newer backend built still draws what it can; null when it isn't one at all.

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
  FINANCE_FEATURES,
  FLOW_KINDS,
  FLOW_SHORTFALLS,
  FLOW_STATUSES,
  INVOICE_STATES,
  OWNER_ROLES,
  PARTY_KINDS,
  PAY_BASES,
  PAY_EVERY,
  TXN_KINDS,
  type AccountView,
  type CardView,
  type CreditReport,
  type FinanceView,
  type Flow,
  type FlowAmount,
  type FlowSchedule,
  type FlowView,
  type HoldingView,
  type JobFields,
  type JobView,
  type JournalLine,
  type OwnerLine,
  type PayTier,
  type PropertyView,
  type StatementView,
} from "../../../shared/finance";
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
    status: o.status === "pending" ? "pending" : "posted",
  };
}

function ownerLine(o: Obj): OwnerLine | null {
  return typeof o.party === "string" ? { party: o.party, name: str(o.name, o.party), role: oneOf(o.role, OWNER_ROLES, "owner"), share: num(o.share) } : null;
}

function card(o: Obj): CardView | null {
  if (typeof o.id !== "string") return null;
  return {
    id: o.id,
    name: str(o.name, o.id),
    network: oneOf(o.network, CARD_NETWORKS, "debit"),
    state: oneOf(o.state, CARD_STATES, "active"),
    holder: str(o.holder),
    holderId: str(o.holderId),
    account: str(o.account),
    last4: nullableStr(o.last4),
    item: nullableStr(o.item),
    dailyPurchaseLimit: nullableNum(o.dailyPurchaseLimit),
    dailyAtmLimit: nullableNum(o.dailyAtmLimit),
    spentToday: num(o.spentToday),
  };
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
    limit: nullableNum(o.limit),
    aprPct: nullableNum(o.aprPct),
    apyPct: nullableNum(o.apyPct),
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
    editable: bool(o.editable),
    source: str(o.source, "entity"),
    done: num(o.done),
    missed: num(o.missed),
    deferred: num(o.deferred),
    spec: decodeFlow({ id: o.id, ...(obj(o.spec) ?? {}) }),
  };
}

function jobSpec(o: Obj): JobFields {
  const spec: JobFields = { worker: str(o.worker), employer: str(o.employer), basis: oneOf(o.basis, PAY_BASES, "salary"), rate: num(o.rate), pay_every: oneOf(o.pay_every, PAY_EVERY, "biweekly") };
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
    payEvery: oneOf(o.payEvery, PAY_EVERY, "biweekly"),
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
  };
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
          breakdown: list(overview.breakdown, (b) => ({ label: str(b.label), cents: num(b.cents) })),
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
        owners: list(b.owners, ownerLine),
        accounts: strings(b.accounts),
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
        }
      : null,
    properties: list(value.properties, property),
    credit: report ? credit(report) : null,
    household:
      household && typeof household.id === "string"
        ? {
            id: household.id,
            name: str(household.name, household.id),
            members: list(household.members, (m) => (typeof m.id === "string" ? { id: m.id, name: str(m.name, m.id), role: str(m.role), share: num(m.share) } : null)),
            accounts: strings(household.accounts),
            flows: list(household.flows, flowView),
            monthly: { total: num(obj(household.monthly)?.total), parts: list(obj(household.monthly)?.parts, (p) => (typeof p.id === "string" ? { id: p.id, name: str(p.name, p.id), cents: num(p.cents) } : null)) },
          }
        : null,
    recent: list(value.recent, journalLine),
    notes: list(value.notes, (n) => ({ at: str(n.at), text: str(n.text) })),
    payPrefs: list(value.payPrefs, payTier),
  };
}
