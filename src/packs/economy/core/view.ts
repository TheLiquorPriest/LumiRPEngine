// Every party's money as its dashboard draws it (DESIGN §25.11): the player's Money hub
// (`economy.money`, the POV) and the GM's view of every party (`economy.people_money`) share one
// shape, `FinanceView`, built at the party's own Money level: a band at 1; cash and one account at
// 2; every account, card, flow and payment preference from 3; statements, terms, holds and credit
// at the top level (or where Custom turns them on). The modules fill their sections. On a player
// surface a party the POV can't see is "someone".

import type { EntityId } from "../../../shared/ids";
import { AUTOPAY_MODES, CLASS_TRAITS, FINANCE_FEATURES, featureOn, ownersIn, worthShares, type AccountView, type AutopayMode, type CycleState, type AlertLine, type CardView, type FinanceView, type Flow, type FlowView, type HouseholdView, type JournalEntry, type JournalLine, type OverviewView, type PartyKind, type StatementView, type UpcomingLine } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { calendarOf, formatClock, monthName, weekdayName } from "../../../engine/calendar";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../../engine/events";
import { numOf, objOf, own, sliceOf, strOf } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { kindIs } from "../../../engine/scope";
import { membersOf, MEMBER_OF } from "../../../engine/selector";
import { canSeeEntity } from "../../../engine/visibility";
import type { FinanceHooks } from "./module";
import { autopaySourceProblem, mayPayFrom } from "./actions";
import { statementState } from "./cycle";
import { creditReport } from "./credit";
import { allFlows, fallsBackOn, occurrences, occurrenceAmount } from "./flows";
import { cycleOf, flowRunOf, isOpened, journalOf, NOTES_CAP } from "./journal";
import { accountsOf, availableOf, balance, canSpend, classOf, holdersOf, holdsOn, householdOf, managesAccount, managesParty, opaqueId, openerOf, outsideHidden, outsideName, ownersOf, productOf, rightsOf, shareOf, statusOf, traitsOf, wealthBand } from "./model";
import { cardsOn, cardRoom, featureFor, isParty, overdraftRoom, tiersOf, toggles } from "./pay";
import { netWorthParts } from "./worth";
import { createRng } from "../../../engine/rng";

const DAY = 1440;

interface Viewer {
  /** The POV a player surface is drawn for, or null for the GM, who sees every name. */
  pov: EntityId | null;
}

/**
 * Whether the viewer may see an entity: the GM sees everything; the player sees the POV, what it
 * can see, and an account (or a card on one) it holds or that someone it can see holds. An outside
 * party's name isn't an entity and is always shown.
 */
function visible(ctx: ReadContext, viewer: Viewer, id: string): boolean {
  const pov = viewer.pov;
  if (pov === null || id === pov) return true;
  const e = own(ctx.state.entities, id);
  if (!e) return true;
  if (!canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id)) return false;
  if (e.kind !== "account" && e.kind !== "card") return true;
  const account = e.kind === "card" ? strOf(e.fields.account) : id;
  if (rightsOf(ctx.state, account, pov) !== null) return true;
  const holders = holdersOf(ctx.state, account).filter((h) => own(ctx.state.entities, h));
  return holders.length === 0 || holders.some((h) => canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, h));
}

function nameFor(ctx: ReadContext, viewer: Viewer, id: string): string {
  const e = own(ctx.state.entities, id);
  if (!e) return id.replace(/_/g, " ");
  return visible(ctx, viewer, id) ? e.name : "someone";
}

/** An entity's id as a view may send it: null for one the viewer can't see. */
function idFor(ctx: ReadContext, viewer: Viewer, id: string): EntityId | null {
  return visible(ctx, viewer, id) ? id : null;
}

/**
 * A flow's side, or a journal line's other party, as the viewer reads it: someone in the world by
 * name ("someone" when the viewer can't see them), an outside account of someone in the world as
 * them, and anyone outside in words, naming only what the viewer may see (`outsideName`).
 */
function sideName(ctx: ReadContext, viewer: Viewer, raw: string): string {
  const id = raw.startsWith(EXTERNAL_ACCOUNT_PREFIX) ? raw.slice(EXTERNAL_ACCOUNT_PREFIX.length) : raw;
  return own(ctx.state.entities, id) ? nameFor(ctx, viewer, id) : outsideName(ctx, raw, viewer.pov);
}

/** Whether the viewer may see a flow's side as it's stored: someone in the world (or their outside account) they can see, or an outside name that says no one and nowhere hidden from them. */
function sideSeen(ctx: ReadContext, viewer: Viewer, raw: string): boolean {
  const id = raw.startsWith(EXTERNAL_ACCOUNT_PREFIX) ? raw.slice(EXTERNAL_ACCOUNT_PREFIX.length) : raw;
  return own(ctx.state.entities, id) ? visible(ctx, viewer, id) : !outsideHidden(ctx, raw, viewer.pov);
}

/**
 * A journal line's other side as `sideName` reads it, masked too when it's the name of someone the
 * viewer can't see (a module's, or a line written before ids were kept).
 */
function counterpartyName(ctx: ReadContext, viewer: Viewer, raw: string): string {
  if (viewer.pov !== null && !own(ctx.state.entities, raw)) {
    const named = Object.keys(ctx.state.entities).find((id) => ctx.state.entities[id]?.name === raw);
    if (named !== undefined && !visible(ctx, viewer, named)) return "someone";
  }
  return sideName(ctx, viewer, raw);
}

function when(ctx: ReadContext, at: number): string {
  return formatClock(calendarOf(ctx.world), at);
}

function day(ctx: ReadContext, at: number): string {
  return formatClock(calendarOf(ctx.world), at).split(",")[0] ?? "";
}

function partyKindOf(ctx: ReadContext, id: EntityId): PartyKind {
  const kind = own(ctx.state.entities, id)?.kind ?? "";
  for (const k of ["business", "trust", "household"] as const) if (kindIs(ctx.registry, ctx.world, kind, k)) return k;
  return "person";
}

/** An account's balance as a view shows it: until it opens, the authored opening it will start from (DESIGN §9.2). */
function shown(ctx: ReadContext, account: EntityId): number {
  const opened = isOpened(ctx.state, account, openerOf(ctx.state, account));
  return balance(ctx.state, account) + (opened ? 0 : Math.round(numOf(own(ctx.state.entities, account)?.fields.opening)));
}

/** What an account can spend as a view shows it: until it opens, its opening counts as posted. */
function shownAvailable(ctx: ReadContext, account: EntityId): number {
  return availableOf(ctx, account) + shown(ctx, account) - balance(ctx.state, account);
}

function journalLine(ctx: ReadContext, viewer: Viewer, party: EntityId, j: JournalEntry): JournalLine {
  // A line names no one where its other side is the party reading it, or the one party whose money
  // the account is: money between their own accounts (a business's too, read by its manager), or a
  // line kept from before each line named its own side, when it named the payee on both. On an
  // account two hold, money one of them paid in reads by their name to the other.
  const worth = Object.entries(worthShares(ownersOf(ctx.state, j.account))).filter(([, share]) => share > 0);
  const whose = worth.length === 1 ? (worth[0]?.[0] ?? j.account) : j.account;
  const counterparty = j.counterparty && j.counterparty !== party && j.counterparty !== whose ? counterpartyName(ctx, viewer, j.counterparty) : null;
  return { id: j.id, at: when(ctx, j.at), memo: j.memo, cents: j.cents, account: nameFor(ctx, viewer, j.account), accountId: j.account, kind: j.kind ?? null, category: j.category ?? null, counterparty, card: j.card ? nameFor(ctx, viewer, j.card) : null, status: j.status };
}

function cardView(ctx: ReadContext, viewer: Viewer, card: EntityId): CardView {
  const e = own(ctx.state.entities, card);
  const f = e?.fields ?? {};
  const holder = strOf(f.holder);
  const purchase = cardRoom(ctx, card, "purchase");
  const atm = cardRoom(ctx, card, "atm");
  const p = productOf(ctx, strOf(f.account));
  const limitOf = (field: "daily_purchase_limit" | "daily_atm_limit"): number | null => (typeof f[field] === "number" ? (f[field] as number) : (p?.[field] ?? null));
  const purchaseLimit = limitOf("daily_purchase_limit");
  return {
    id: card,
    name: e?.name ?? card,
    network: f.network === "credit" || f.network === "charge" ? f.network : "debit",
    state: f.state === "frozen" || f.state === "lost" || f.state === "cancelled" ? f.state : "active",
    holder: nameFor(ctx, viewer, holder),
    holderId: idFor(ctx, viewer, holder),
    account: strOf(f.account),
    last4: typeof f.last4 === "string" ? f.last4 : null,
    item: typeof f.item === "string" && f.item !== "" ? f.item : null,
    dailyPurchaseLimit: Number.isFinite(purchase) ? purchaseLimit : null,
    dailyAtmLimit: Number.isFinite(atm) ? limitOf("daily_atm_limit") : null,
    spentToday: Number.isFinite(purchase) && purchaseLimit !== null ? Math.max(0, purchaseLimit - purchase) : 0,
  };
}

function money(ctx: ReadContext, cents: number): string {
  return formatMoney(cents, ctx.world.currency);
}

function terms(ctx: ReadContext, account: EntityId, detail: boolean): { label: string; value: string }[] {
  const p = productOf(ctx, account);
  const t = traitsOf(ctx, account);
  if (!p || !t) return [];
  const out: { label: string; value: string }[] = [];
  if (t.liability) {
    if (p.limit !== null) out.push({ label: "Credit limit", value: money(ctx, p.limit) });
    else if (t.revolving) out.push({ label: "Credit limit", value: "No preset limit" });
    if (p.apr_pct > 0) out.push({ label: "APR", value: `${p.apr_pct}%` });
    if (detail && p.penalty_apr_pct > 0) out.push({ label: "Penalty APR", value: `${p.penalty_apr_pct}% after 60 days late` });
    if (t.revolving) {
      out.push({ label: "Grace period", value: `${p.due_days} days, when the last statement was paid in full` });
      out.push({ label: "Minimum payment", value: `${p.minimum.pct}% of the balance${p.minimum.plus_interest ? " plus interest and fees" : ""}, at least ${money(ctx, p.minimum.floor)}` });
      out.push({ label: "Statement day", value: String(p.statement_day) });
    }
    if (detail && p.fees.late_first > 0) out.push({ label: "Late fee", value: `${money(ctx, p.fees.late_first)}, then ${money(ctx, p.fees.late_repeat)}` });
    if (detail && p.fees.annual > 0) out.push({ label: "Annual fee", value: money(ctx, p.fees.annual) });
    if (p.term_months !== null && t.installment) out.push({ label: "Term", value: `${p.term_months} months` });
  } else {
    if (p.apy_pct > 0) out.push({ label: "APY", value: `${p.apy_pct}%` });
    if (t.transactional) {
      out.push({ label: "Overdraft", value: p.overdraft === "fee" ? `Pays up to ${money(ctx, p.overdraft_limit)} over, for ${money(ctx, p.fees.overdraft)} an item` : p.overdraft === "linked" ? `Covered from ${own(ctx.state.entities, strOf(own(ctx.state.entities, account)?.fields.overdraft_link))?.name ?? "the linked account"}` : "Declined" });
      if (detail && p.fees.maintenance > 0) out.push({ label: "Monthly fee", value: `${money(ctx, p.fees.maintenance)}, waived from ${money(ctx, p.fees.maintenance_waive)}` });
      if (detail && p.daily_purchase_limit !== null) out.push({ label: "Debit card limits", value: `${money(ctx, p.daily_purchase_limit)} a day in purchases, ${money(ctx, p.daily_atm_limit ?? 0)} at machines` });
      if (detail && p.fees.atm > 0) out.push({ label: "Other banks' machines", value: money(ctx, p.fees.atm) });
    }
    if (detail && p.hold_days > 0 && (t.transactional || t.pays)) out.push({ label: "Deposit holds", value: `${p.hold_days} days at a machine` });
    if (p.term_months !== null) out.push({ label: "Term", value: `${p.term_months} months` });
  }
  if (p.institution) out.push({ label: "Institution", value: p.institution });
  return out;
}

function statementView(ctx: ReadContext, raw: CycleState | null): StatementView | null {
  if (!raw) return null;
  return { at: day(ctx, raw.at), closing: raw.closing, interest: raw.interest, fees: raw.fees, minimum: raw.minimum, due: day(ctx, raw.due), paid: raw.paid, apr: raw.apr, stage: raw.stage, state: statementState(raw, ctx.state.clock) };
}

function pastStatements(ctx: ReadContext, account: EntityId): StatementView[] {
  const raw = own(objOf(sliceOf(ctx.state, "economy").statements), account);
  return (Array.isArray(raw) ? raw : [])
    .map((x) => objOf(x))
    .reverse()
    .map((c) => ({ at: day(ctx, numOf(c.at)), closing: numOf(c.closing), interest: numOf(c.interest), fees: numOf(c.fees), minimum: numOf(c.minimum), due: day(ctx, numOf(c.due)), paid: numOf(c.paid), apr: numOf(c.apr), stage: (strOf(c.stage, "current") as StatementView["stage"]) ?? "current", state: numOf(c.paid) >= numOf(c.closing) ? "paid" : numOf(c.paid) >= numOf(c.minimum) ? "minimum" : "late" }));
}

function accountView(ctx: ReadContext, viewer: Viewer, party: EntityId, account: EntityId, level: number, detail: boolean): AccountView {
  const e = own(ctx.state.entities, account);
  const cls = classOf(ctx, account) ?? "checking";
  const t = CLASS_TRAITS[cls];
  const p = productOf(ctx, account);
  const owners = ownersOf(ctx.state, account);
  const shares = worthShares(owners);
  const cycle = cycleOf(ctx.state, account);
  const journal = journalOf(ctx.state, account);
  const cents = shown(ctx, account);
  // Statements, holds and cards show where they run: their level, or where Custom turns them on or off.
  const statements = featureOn(level, "statements", toggles(ctx.world));
  const holds = featureOn(level, "holds", toggles(ctx.world));
  const cards = featureOn(level, "cards", toggles(ctx.world));
  const autopayMode = strOf(e?.fields.autopay, "none");
  const autopayFrom = strOf(e?.fields.autopay_from);
  const securedBy = strOf(e?.fields.secured_by);
  const due = cycle && cycle.minimum - cycle.paid > 0 && (t.liability || false) ? { label: t.installment ? "Payment due" : "Minimum due", cents: cycle.minimum - cycle.paid, at: day(ctx, cycle.due) } : null;
  const role = owners.find((o) => o.party === party)?.role ?? null;
  return {
    id: account,
    name: e?.name ?? account,
    class: cls,
    classLabel: t.label,
    product: { id: p?.id ?? cls, label: p?.label ?? t.label },
    institution: p?.institution || null,
    status: statusOf(ctx.state, account),
    cents,
    available: level >= 2 ? (t.liability ? (p?.limit === null && cls === "charge_card" ? null : shownAvailable(ctx, account)) : shownAvailable(ctx, account) + overdraftRoom(ctx, account)) : null,
    owners: owners.map((o) => ({ party: idFor(ctx, viewer, o.party), name: nameFor(ctx, viewer, o.party), role: o.role, share: Math.round((own(shares, o.party) ?? 0) * 100) / 100 })),
    role,
    manages: managesAccount(ctx, account, party),
    spends: canSpend(ctx.state, account, party),
    // Filled once the view holds every account it shows (`buildFinanceView`).
    autopayFrom: [],
    fallbacks: [],
    limit: level >= 3 && t.liability ? (p?.limit ?? null) : null,
    aprPct: level >= 4 && t.liability ? (p?.apr_pct ?? null) : null,
    apyPct: level >= 4 && t.earns ? (p?.apy_pct ?? null) : null,
    terms: level >= 3 ? terms(ctx, account, detail) : [],
    autopay: level >= 3 && (t.revolving || t.installment) ? { mode: (AUTOPAY_MODES as readonly string[]).includes(autopayMode) ? (autopayMode as AutopayMode) : "none", from: autopayFrom ? idFor(ctx, viewer, autopayFrom) : null, fromName: autopayFrom ? nameFor(ctx, viewer, autopayFrom) : null, cents: autopayMode === "fixed" ? numOf(e?.fields.autopay_cents) : null } : null,
    due: statements ? due : null,
    statements: statements && (t.revolving || t.installment) ? [statementView(ctx, cycle), ...pastStatements(ctx, account)].filter((s): s is StatementView => s !== null) : [],
    cards: cards ? cardsOn(ctx.state, account).map((c) => cardView(ctx, viewer, c)) : [],
    pending: holds ? journal.filter((j) => j.status === "pending").reverse().map((j) => journalLine(ctx, viewer, party, j)) : [],
    holds: holds ? holdsOn(ctx.state, account).map((h) => ({ id: h.id, cents: h.cents, until: day(ctx, h.until), kind: h.kind, memo: h.memo })) : [],
    transactions: level >= 2 ? journal.slice(-(level >= 4 ? 40 : 20)).reverse().map((j) => journalLine(ctx, viewer, party, j)) : [],
    securedBy: securedBy !== "" && own(ctx.state.entities, securedBy) && visible(ctx, viewer, securedBy) ? { id: securedBy, name: nameFor(ctx, viewer, securedBy) } : null,
    loan: t.installment && level >= 3 ? { payment: typeof e?.fields.payment === "number" ? e.fields.payment : (cycle?.minimum ?? 0), monthsLeft: cycle?.months_left ?? numOf(e?.fields.months_left, numOf(e?.fields.remaining_months, p?.term_months ?? 0)), payoff: Math.max(0, -cents) } : null,
  };
}

/** A schedule in words: "every Friday", "monthly on the 1st", "once, 3 Oct". */
function scheduleWords(ctx: ReadContext, f: Flow): string {
  const cal = calendarOf(ctx.world);
  const s = f.schedule;
  if (s.once !== undefined && s.once !== "") return `once, ${typeof s.once === "number" ? day(ctx, s.once) : s.once.replace("T", " ")}`;
  const n = s.interval && s.interval > 1 ? s.interval : 1;
  const ord = (d: number): string => (d < 0 ? "the last day" : `the ${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`);
  switch (s.every) {
    case "day":
      return n > 1 ? `every ${n} days` : "daily";
    case "week":
      return `every ${n > 1 ? `${n} weeks on ` : ""}${(s.weekdays ?? []).map((w) => weekdayName(cal, w)).join(", ") || "week"}`;
    case "month":
      return `${n > 1 ? `every ${n} months` : "monthly"} on ${(s.days ?? [1]).map(ord).join(" and ")}`;
    case "year":
      return `yearly, ${(s.months ?? [1]).map((m) => monthName(cal, m)).join(", ")} ${(s.days ?? [1]).join(", ")}`;
    default:
      return "";
  }
}

function amountWords(ctx: ReadContext, viewer: Viewer, f: Flow): string {
  const a = f.amount;
  if ("fixed" in a) return money(ctx, a.fixed);
  if ("formula" in a) return "worked out each time";
  if ("table" in a) return "from the price tables";
  if ("range" in a) return `${money(ctx, a.range.min)} to ${money(ctx, a.range.max)}`;
  if ("percent" in a) return `${a.percent}% of ${a.of ? nameFor(ctx, viewer, a.of) : "the balance"}`;
  if ("due" in a) return a.due === "minimum" ? "the minimum due" : a.due === "statement" ? "the statement balance" : "the whole balance";
  return "worked out each time";
}

/**
 * Whether a flow touches a party: it pays from or into them, or an account of theirs, or shares it;
 * or it pays from money they manage, a business's account the viewer can see or the business
 * itself, whose standing payments are theirs to change (DESIGN §25.1).
 */
function flowTouches(ctx: ReadContext, viewer: Viewer, f: Flow, party: EntityId): boolean {
  const sides = [f.from, f.to, ...(f.splits ?? []).map((s) => s.to), ...(f.shares ?? []).flatMap((s) => [s.party, s.from ?? ""])];
  if (sides.some((id) => id === party || (own(ctx.state.entities, id)?.kind === "account" && rightsOf(ctx.state, id, party)?.sees === true))) return true;
  return own(ctx.state.entities, f.from)?.kind === "account" ? managesAccount(ctx, f.from, party) && visible(ctx, viewer, f.from) : managesParty(ctx.state, f.from, party);
}

function nextOf(ctx: ReadContext, f: Flow, horizon: number): number | null {
  const from = ctx.state.clock;
  const retry = flowRunOf(ctx.state, f.id).retry;
  const first = occurrences(ctx, f.schedule, from, from + horizon, f.start, f.end)[0];
  const candidates = [first?.at, retry?.at].filter((x): x is number => typeof x === "number" && x > from);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

/**
 * What a flow belongs to as the viewer may read it: an entity they can see, by name. A job is named
 * after its worker ("Danny's job at Alder Automotive"), so one whose worker they can't see reads by
 * its title and employer, under the id its employer's page sends it by (`opaqueId`). The job kind
 * is the foundation's (`kinds.ts`).
 */
function linkView(ctx: ReadContext, viewer: Viewer, link: string | undefined): { id: EntityId; name: string } | null {
  const e = link === undefined ? undefined : own(ctx.state.entities, link);
  if (link === undefined || !e || !visible(ctx, viewer, link)) return null;
  if (!kindIs(ctx.registry, ctx.world, e.kind, "job") || visible(ctx, viewer, strOf(e.fields.worker))) return { id: link, name: nameFor(ctx, viewer, link) };
  const employer = strOf(e.fields.employer);
  const at = employer === "" || outsideHidden(ctx, employer, viewer.pov) ? "" : own(ctx.state.entities, employer) ? nameFor(ctx, viewer, employer) : outsideName(ctx, `employer:${employer}`, viewer.pov);
  const title = strOf(e.fields.title) || "A job";
  return { id: opaqueId(link), name: at === "" ? title : `${title} at ${at}` };
}

function flowView(hooks: FinanceHooks, ctx: ReadContext, viewer: Viewer, party: EntityId, f: Flow): FlowView {
  const run = flowRunOf(ctx.state, f.id);
  const next = run.ended || f.status !== "active" ? null : nextOf(ctx, f, 400 * DAY);
  let cents: number | null = null;
  if (!("provider" in f.amount) && next !== null) {
    const a = occurrenceAmount(hooks, ctx, f, next, createRng(`view:${f.id}`), run.deferred ?? 0);
    cents = a && !("code" in a) ? a.cents : null;
  }
  const fromSide = own(ctx.state.entities, f.from);
  // The party changes it when they manage what pays it: the account (by their role on it, or on the business or trust that holds it), or the business or trust paying.
  const payerHolds = fromSide?.kind === "account" ? managesAccount(ctx, f.from, party) : f.from === party || managesParty(ctx.state, f.from, party);
  const editable = f.source === "entity" && payerHolds;
  // The flow as stored goes out only when every side of it is someone the viewer can see.
  const sides = [f.from, f.to, f.fallback ?? "", f.link ?? "", ...(f.splits ?? []).map((s) => s.to), ...(f.shares ?? []).flatMap((s) => [s.party, s.from ?? ""])].filter((id) => id !== "");
  const seen = sides.every((id) => sideSeen(ctx, viewer, id));
  // What the party acts on by its id: a flow theirs to change, or a lease of a property they own a share of, which they may end (`lease_end`).
  const actsOn = editable || (f.kind === "rent" && f.link !== undefined && shareOf(ctx.state, f.link, party) > 0);
  return {
    // Nor, unless they act on it by it, does its id, which can name whom it's for (`pay:<job>`, an author's `bill_jess_household`).
    id: seen || actsOn ? f.id : opaqueId(f.id),
    label: f.label,
    kind: f.kind,
    from: sideName(ctx, viewer, f.from),
    to: sideName(ctx, viewer, f.to),
    amount: amountWords(ctx, viewer, f),
    cents,
    schedule: scheduleWords(ctx, f),
    next: next === null ? null : when(ctx, next),
    shortfall: f.shortfall,
    // A one-off flow entity that has run is over. Its run isn't marked ended: a derived flow (autopay) keeps its id while its one-off date moves on.
    status: run.ended || (f.schedule.once !== undefined && run.done > 0 && own(ctx.state.entities, f.id)?.kind === "flow") ? "ended" : f.status,
    category: f.category ?? null,
    link: linkView(ctx, viewer, f.link),
    payer: fromSide && visible(ctx, viewer, f.from) ? f.from : null,
    editable,
    source: f.source,
    done: run.done,
    missed: run.missed,
    deferred: run.deferred ?? 0,
    spec: seen ? f : null,
  };
}

/** What comes in (positive) or goes out (negative) for a party when a flow pays. */
function signedFor(ctx: ReadContext, f: Flow, party: EntityId, cents: number): number {
  const mine = (id: string): boolean => id === party || (own(ctx.state.entities, id)?.kind === "account" && rightsOf(ctx.state, id, party)?.worth === true);
  if (mine(f.from) && !mine(f.to)) return -cents;
  if (!mine(f.from) && mine(f.to)) return cents;
  return 0;
}

function householdView(hooks: FinanceHooks, ctx: ReadContext, viewer: Viewer, household: EntityId, flows: readonly Flow[]): HouseholdView {
  const members = membersOf(ctx.registry, ctx.world, ctx.state, household);
  // Shared: paid by the household, split among its members only, or paid from an account it holds.
  const splitAmongMembers = (f: Flow): boolean => (f.shares ?? []).length > 0 && (f.shares ?? []).every((s) => members.includes(s.party));
  const fromHouseholdAccount = (f: Flow): boolean => own(ctx.state.entities, f.from)?.kind === "account" && rightsOf(ctx.state, f.from, household) !== null;
  const shared = flows.filter((f) => f.from === household || splitAmongMembers(f) || fromHouseholdAccount(f));
  const monthlyOf = (f: Flow): number => {
    const a = f.amount;
    const each = "fixed" in a ? a.fixed : 0;
    const per = f.schedule.every === "week" ? 52 / 12 : f.schedule.every === "day" ? 365 / 12 : f.schedule.every === "year" ? 1 / 12 : 1;
    return Math.round((each * per) / Math.max(1, f.schedule.interval ?? 1));
  };
  const total = shared.reduce((a, f) => a + monthlyOf(f), 0);
  const partOf = (m: EntityId): number => shared.reduce((a, f) => a + Math.round((monthlyOf(f) * (f.shares?.find((s) => s.party === m)?.pct ?? (f.shares && f.shares.length > 0 ? 0 : 100 / Math.max(1, members.length)))) / 100), 0);
  return {
    id: household,
    name: nameFor(ctx, viewer, household),
    members: members.map((m) => {
      const rel = own(ctx.state.entities, m)?.relations.find((r) => r.type === MEMBER_OF && r.to === household);
      const part = partOf(m);
      return { id: idFor(ctx, viewer, m), name: nameFor(ctx, viewer, m), role: strOf(rel?.fields?.role), share: total > 0 ? Math.round((part * 1000) / total) / 10 : Math.round(1000 / Math.max(1, members.length)) / 10 };
    }),
    accounts: accountsOf(ctx, household).concat(members.length > 1 ? accountsOf(ctx, members[0] ?? household).filter((id) => members.every((m) => rightsOf(ctx.state, id, m) !== null)) : []).filter((id, i, all) => all.indexOf(id) === i),
    flows: shared.map((f) => flowView(hooks, ctx, viewer, household, f)),
    monthly: { total, parts: members.map((m) => ({ id: idFor(ctx, viewer, m), name: nameFor(ctx, viewer, m), cents: partOf(m) })) },
  };
}

/** One party's money at its own level (DESIGN §25.11). */
export function buildFinanceView(hooks: FinanceHooks, ctx: ReadContext, party: EntityId, player: boolean): FinanceView {
  const viewer: Viewer = { pov: player ? ctx.world.pov : null };
  const e = own(ctx.state.entities, party);
  const kind = partyKindOf(ctx, party);
  // A household is its members' shared money: it is followed as closely as its most closely followed member, though it holds no account of its own.
  const members = kind === "household" ? membersOf(ctx.registry, ctx.world, ctx.state, party) : [];
  const level = Math.max(ctx.levelOf(party, "money"), ...members.map((m) => ctx.levelOf(m, "money")));
  const tog = toggles(ctx.world);
  const detail = level >= 4;
  const features = FINANCE_FEATURES.filter((f) => featureFor(ctx, party, f));
  const mine = accountsOf(ctx, party);
  const empty: FinanceView = { party, name: e?.name ?? party, partyKind: kind, level, detail, features, band: null, opened: true, cash: null, overview: null, accounts: [], cards: [], flows: [], jobs: [], businesses: [], investments: null, properties: [], credit: null, household: null, recent: [], notes: [], payPrefs: [] };
  if (level === 0) return empty;
  const worth = netWorthParts(hooks, ctx, party);
  const band = mine.length > 0 ? wealthBand(worth.net) : strOf(e?.fields.wealth, "modest");
  const opened = mine.every((id) => isOpened(ctx.state, id, openerOf(ctx.state, id)));
  if (kind === "household" && level >= 3 && mine.length === 0) return { ...empty, band, cash: { band }, opened, household: householdView(hooks, ctx, viewer, party, allFlows(hooks, ctx)) };
  if (level === 1 || mine.length === 0) return { ...empty, band, cash: { band }, opened };
  const firstTransactional = mine.find((id) => traitsOf(ctx, id)?.transactional);
  const shownAccounts = level >= 3 ? mine : mine.filter((id) => classOf(ctx, id) === "cash" || id === firstTransactional);
  const accounts = shownAccounts.map((id) => accountView(ctx, viewer, party, id, level, detail));
  const cash = mine.filter((id) => classOf(ctx, id) === "cash" && rightsOf(ctx.state, id, party)?.spend).reduce((a, id) => a + shown(ctx, id), 0);
  const flows = featureFor(ctx, party, "flows") ? allFlows(hooks, ctx).filter((f) => flowTouches(ctx, viewer, f, party)) : [];
  const flowViews = flows.map((f) => flowView(hooks, ctx, viewer, party, f));
  const now = ctx.state.clock;
  const upcoming: UpcomingLine[] = [];
  for (const [i, f] of flows.entries()) {
    const v = flowViews[i];
    const next = f.status === "active" && !flowRunOf(ctx.state, f.id).ended ? nextOf(ctx, f, 31 * DAY) : null;
    if (next === null || !v) continue;
    const cents = v.cents === null ? 0 : signedFor(ctx, f, party, v.cents);
    // The account paying it, where the viewer can see it: money into theirs can come from an account of someone they can't.
    upcoming.push({ at: when(ctx, next), clock: next, label: f.label, cents, flow: v.id, account: own(ctx.state.entities, f.from)?.kind === "account" && visible(ctx, viewer, f.from) ? f.from : null });
  }
  for (const a of accounts) {
    const cycle = cycleOf(ctx.state, a.id);
    if (a.due && cycle && cycle.due > now && cycle.due <= now + 31 * DAY && !upcoming.some((u) => u.flow === `autopay:${a.id}`)) upcoming.push({ at: when(ctx, cycle.due), clock: cycle.due, label: `${a.name} ${a.due.label.toLowerCase()}`, cents: -a.due.cents, flow: null, account: a.id });
  }
  const alerts: AlertLine[] = [];
  for (const a of accounts) {
    if (a.status !== "open") alerts.push({ tone: "neg", text: `${a.name} is ${a.status.replace(/_/g, " ")}.`, account: a.id });
    const cycle = cycleOf(ctx.state, a.id);
    if (cycle && cycle.stage !== "current") alerts.push({ tone: "neg", text: `${a.name} is ${cycle.stage === "late" ? "past due" : `${cycle.stage} days past due`}.`, account: a.id });
    else if (a.due && cycle && cycle.due > now && cycle.due - now <= 3 * DAY) alerts.push({ tone: "warn", text: `${a.name}: ${money(ctx, a.due.cents)} due ${a.due.at}.`, account: a.id });
    if (!CLASS_TRAITS[a.class].liability && a.cents < 0) alerts.push({ tone: "neg", text: `${a.name} is overdrawn by ${money(ctx, -a.cents)}.`, account: a.id });
    for (const c of a.cards) if (c.state !== "active") alerts.push({ tone: "warn", text: `${c.name} is ${c.state}.`, account: a.id });
  }
  // A flow that missed within the last month: what's owed may still be owed.
  for (const v of flowViews) if (v.missed > 0 && v.status === "active" && (flowRunOf(ctx.state, v.id).last ?? -Infinity) > now - 31 * DAY) alerts.push({ tone: "warn", text: `${v.label} was missed.`, flow: v.id });
  // Money in and out over the last 30 days, by category, from the journal of the accounts shown.
  const since = now - 30 * DAY;
  let pastIn = 0;
  let pastOut = 0;
  const byCategory = new Map<string, number>();
  for (const id of shownAccounts) {
    for (const j of journalOf(ctx.state, id)) {
      if (j.at <= since || j.category === "transfer" || j.kind === "opening") continue;
      if (j.cents > 0) pastIn += j.cents;
      else pastOut -= j.cents;
      byCategory.set(j.category ?? "other", (byCategory.get(j.category ?? "other") ?? 0) + j.cents);
    }
  }
  const nextIn = upcoming.filter((u) => u.cents > 0).reduce((a, u) => a + u.cents, 0);
  const nextOut = upcoming.filter((u) => u.cents < 0).reduce((a, u) => a - u.cents, 0);
  const overview: OverviewView = {
    netWorth: worth.net,
    assets: worth.assets,
    liabilities: worth.liabilities,
    breakdown: worth.lines,
    cashFlow: level >= 3 ? { period: "the last 30 days", in: pastIn, out: pastOut, byCategory: [...byCategory].map(([category, cents]) => ({ category, cents })).sort((a, b) => a.cents - b.cents), nextIn, nextOut } : null,
    upcoming: level >= 3 ? upcoming.sort((a, b) => a.clock - b.clock).slice(0, 20) : [],
    alerts: level >= 3 ? alerts : [],
  };
  const recent = shownAccounts
    .flatMap((id) => journalOf(ctx.state, id))
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
    .slice(0, 10)
    .map((j) => journalLine(ctx, viewer, party, j));
  const notesRaw = own(objOf(sliceOf(ctx.state, "economy").notes), party);
  const notes = player ? [] : (Array.isArray(notesRaw) ? notesRaw : []).slice(-NOTES_CAP).map((n) => objOf(n)).reverse().map((n) => ({ at: when(ctx, numOf(n.at)), text: strOf(n.text) }));
  const household = kind === "household" ? party : householdOf(ctx, party);
  const view: FinanceView = {
    ...empty,
    band,
    opened,
    cash: { cents: cash },
    overview,
    accounts,
    cards: accounts.flatMap((a) => a.cards),
    flows: flowViews,
    credit: partyKindOf(ctx, party) === "person" && featureOn(level, "credit", tog) ? creditReport(ctx, party) : null,
    household: household && featureOn(level, "households", tog) ? householdView(hooks, ctx, viewer, household, allFlows(hooks, ctx)) : null,
    recent,
    notes,
    payPrefs: featureFor(ctx, party, "payment_prefs") && partyKindOf(ctx, party) === "person" ? tiersOf(ctx, party) : [],
  };
  for (const section of hooks.views) {
    const extra = section(ctx, party, view, viewer.pov);
    if (extra.jobs) view.jobs.push(...extra.jobs);
    if (extra.businesses) view.businesses.push(...extra.businesses);
    if (extra.investments) view.investments = extra.investments;
    if (extra.properties) view.properties.push(...extra.properties);
    if (extra.upcoming && view.overview) view.overview.upcoming = [...view.overview.upcoming, ...extra.upcoming].sort((a, b) => a.clock - b.clock).slice(0, 20);
    if (extra.alerts && view.overview) view.overview.alerts.push(...extra.alerts);
  }
  for (const b of view.businesses) {
    // An account of the business the viewer can't see stays off its page, by id as much as in full.
    b.accounts = b.accounts.filter((id) => visible(ctx, viewer, id));
    // Its accounts its owner manages without a role of their own on them are on its page, not among theirs.
    b.managed = level >= 3 ? b.accounts.filter((id) => !mine.includes(id) && managesAccount(ctx, id, party)).map((id) => accountView(ctx, viewer, party, id, level, detail)) : [];
  }
  // What each account's controls may draw on, by the actions' own rules: its autopay's sources, and what may back a standing payment from it.
  const listed = [...view.accounts, ...view.businesses.flatMap((b) => b.managed)];
  const pays = (id: EntityId): boolean => traitsOf(ctx, id)?.pays === true && mayPayFrom(ctx, party, id);
  for (const a of listed) {
    const others = listed.filter((x) => x.id !== a.id).map((x) => x.id);
    a.autopayFrom = a.autopay !== null && a.manages ? others.filter((id) => autopaySourceProblem(ctx, party, a.id, id) === null) : [];
    a.fallbacks = pays(a.id) ? others.filter((id) => pays(id) && fallsBackOn(ctx, a.id, id)) : [];
  }
  return view;
}

/** The POV's money, as the Play hub draws it. */
export function buildMoneyView(hooks: FinanceHooks, ctx: ReadContext): FinanceView {
  return buildFinanceView(hooks, ctx, ctx.world.pov, true);
}

/** Every party's money for the GM: the POV first, then everyone else who can hold money, by name. */
export function buildPeopleMoney(hooks: FinanceHooks, ctx: ReadContext): FinanceView[] {
  const out: FinanceView[] = [];
  for (const id of Object.keys(ctx.state.entities)) {
    if (id === ctx.world.pov || !isParty(ctx, id)) continue;
    const e = own(ctx.state.entities, id);
    if (!e || ctx.levelOf(id, "money") === 0) continue;
    // A household or business with no money of its own shows only through its members and owners.
    if (partyKindOf(ctx, id) !== "person" && accountsOf(ctx, id).length === 0 && ownersIn(e.fields).length === 0 && partyKindOf(ctx, id) !== "household") continue;
    out.push(buildFinanceView(hooks, ctx, id, false));
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return own(ctx.state.entities, ctx.world.pov) ? [buildFinanceView(hooks, ctx, ctx.world.pov, false), ...out] : out;
}
