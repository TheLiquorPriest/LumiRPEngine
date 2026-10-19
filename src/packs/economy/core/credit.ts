// Credit (DESIGN §25.9): a credit report per person (their credit accounts, payment history,
// utilisation, account age, inquiries and derogatory marks) and a score from 300 to 850 worked
// out each month from it. The score sets the APR tier (the finance tables' rates by credit tier)
// and whether an application for credit is approved.

import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent } from "../../../shared/ledger";
import { CLASS_TRAITS, FINANCE_EVENTS, SCORE_MAX, SCORE_MIN, creditTierOf, isAccountClass, isCredit, scoreBand, type AccountClass, type CreditApplication, type CreditEntry, type CreditReport, type CreditTier, type ScoreFactors } from "../../../shared/finance";
import { calendarOf, clockAt, clockOfLocal, dateAt, formatClock } from "../../../engine/calendar";
import { labelOf, numOf, objOf, own, sliceOf, strOf } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import { cycleOf, reject } from "./journal";
import { accountsOf, balance, classOf, productOf, statusOf, worldProducts } from "./model";

const MONTH = 1440 * 30.4;

export function creditEntriesOf(ctx: Pick<ReadContext, "state">, person: EntityId): CreditEntry[] {
  const raw = objOf(own(objOf(sliceOf(ctx.state, "economy").credit), person));
  return (Array.isArray(raw.entries) ? raw.entries : []).map((x) => objOf(x) as unknown as CreditEntry);
}

/** The person's credit accounts: credit they owe or hold jointly. */
export function creditAccounts(ctx: ReadContext, person: EntityId): EntityId[] {
  return accountsOf(ctx, person, "worth").filter((id) => {
    const c = classOf(ctx, id);
    return c !== null && isCredit(c);
  });
}

/** An account's age in months, from its `opened` date (the start of the chat when it doesn't say). */
function ageMonths(ctx: ReadContext, account: EntityId): number {
  const opened = strOf(own(ctx.state.entities, account)?.fields.opened);
  let at = 0;
  if (opened !== "") {
    try {
      at = clockOfLocal(calendarOf(ctx.world), opened.slice(0, 10));
    } catch {
      at = 0;
    }
  }
  return Math.max(0, (ctx.state.clock - at) / MONTH);
}

/** The parts of a person's score, each 0–1; null without a credit file (no credit account, no history). */
export function scoreFactors(ctx: ReadContext, person: EntityId): ScoreFactors | null {
  const accounts = creditAccounts(ctx, person);
  const entries = creditEntriesOf(ctx, person);
  if (accounts.length === 0 && entries.length === 0) return null;
  const now = ctx.state.clock;
  const recent = entries.filter((e) => now - numOf(e.at) <= 24 * MONTH);
  let payment = 1;
  for (const e of recent) {
    if (e.kind === "late") payment -= e.days === 30 ? 0.15 : e.days === 60 ? 0.25 : 0.35;
    if (e.kind === "collections") payment -= 0.5;
    if (e.kind === "charged_off") payment -= 0.6;
  }
  let limit = 0;
  let owed = 0;
  let revolving = false;
  let installment = false;
  for (const id of accounts) {
    const c = classOf(ctx, id) as AccountClass;
    if (CLASS_TRAITS[c].revolving) {
      revolving = true;
      const p = productOf(ctx, id);
      if (p?.limit !== null && p?.limit !== undefined) {
        limit += p.limit;
        owed += Math.max(0, -balance(ctx.state, id));
      }
    }
    if (CLASS_TRAITS[c].installment) installment = true;
  }
  const u = limit > 0 ? owed / limit : null;
  const utilisation = u === null ? 0.7 : u <= 0.1 ? 1 : u <= 0.3 ? 0.85 : u <= 0.5 ? 0.6 : u <= 0.75 ? 0.35 : 0.1;
  const ages = accounts.map((id) => ageMonths(ctx, id));
  const age = ages.length > 0 ? Math.min(1, ages.reduce((a, b) => a + b, 0) / ages.length / 120) : 0;
  const mix = revolving && installment ? 1 : revolving || installment ? 0.6 : 0.3;
  const inquiries = entries.filter((e) => e.kind === "inquiry" && now - numOf(e.at) <= 12 * MONTH).length;
  return { payment: Math.max(0, payment), utilisation, age, mix, recent: Math.max(0.4, 1 - 0.1 * inquiries) };
}

export function scoreOf(f: ScoreFactors): number {
  const weighted = 0.35 * f.payment + 0.3 * f.utilisation + 0.15 * f.age + 0.1 * f.mix + 0.1 * f.recent;
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(SCORE_MIN + (SCORE_MAX - SCORE_MIN) * weighted)));
}

/** A person's score: the last one recorded, else worked out from their file now. */
export function currentScore(ctx: ReadContext, person: EntityId): number | null {
  const raw = objOf(own(objOf(sliceOf(ctx.state, "economy").credit), person));
  if (typeof raw.score === "number") return raw.score;
  const f = scoreFactors(ctx, person);
  return f ? scoreOf(f) : null;
}

/** The month's score for a person with a credit file. */
export function monthlyScore(ctx: ReadContext, person: EntityId, at: number): LedgerEvent[] {
  const f = scoreFactors(ctx, person);
  return f ? [{ type: FINANCE_EVENTS.score, data: { person, score: scoreOf(f), factors: { ...f }, at } }] : [];
}

const TIER_KEYS: Record<CreditTier, string> = { super_prime: "super_prime_781_850", prime: "prime_661_780", nonprime: "nonprime_601_660", subprime: "subprime_501_600", deep_subprime: "deep_subprime_300_500" };

/** The APR a class of credit gets at a score: the finance tables' rate for its credit tier, else its band spread over the five tiers. */
export function aprFor(ctx: ReadContext, cls: AccountClass, score: number | null): number | null {
  const tier = creditTierOf(score ?? 700);
  const rows = ctx.tables.get("economy.finance")?.rows ?? {};
  const loans = objOf(rows.loans?.values);
  const auto = objOf(objOf(loans.auto).apr_by_credit_tier_used_pct);
  if (cls === "loan" && typeof auto[TIER_KEYS[tier]] === "number") return auto[TIER_KEYS[tier]] as number;
  const band = cls === "credit_card" ? objOf(objOf(rows.credit_card?.values).apr_pct) : cls === "mortgage" ? objOf(objOf(loans.mortgage).apr_pct_30yr_fixed) : cls === "line_of_credit" ? objOf(objOf(loans.personal).apr_pct) : null;
  if (!band || typeof band.min !== "number" || typeof band.max !== "number") return null;
  const step = ["super_prime", "prime", "nonprime", "subprime", "deep_subprime"].indexOf(tier) / 4;
  return Math.round((band.min + (band.max - band.min) * step) * 100) / 100;
}

/** The limit a card or line of credit starts at for a score. */
function limitFor(ctx: ReadContext, cls: AccountClass, score: number | null): number | null {
  if (!CLASS_TRAITS[cls].revolving || cls === "charge_card") return null;
  const limits = objOf(objOf(ctx.tables.get("economy.finance")?.rows.credit_card?.values).credit_limit_cents);
  const tier = creditTierOf(score ?? 700);
  return tier === "super_prime" ? numOf(limits.good_credit, 1_500_000) : tier === "prime" ? numOf(limits.typical, 1_000_000) : numOf(limits.starter, 50_000);
}

export interface Decision {
  approved: boolean;
  reason: string;
  apr: number | null;
  limit: number | null;
  cls: AccountClass;
  label: string;
}

/**
 * What an application for credit gets: declined for an unsecured product below a subprime score (or
 * with a charge-off in the last two years), else approved at the APR and limit its tier gets.
 */
export function decide(ctx: ReadContext, person: EntityId, app: CreditApplication): Decision | Rejection {
  const products = worldProducts(ctx.world);
  const def = own(products, app.product);
  const cls = def?.class ?? (isAccountClass(app.product) ? app.product : null);
  if (!cls || !isCredit(cls)) return reject("not_credit", `${app.product.replace(/_/g, " ")} isn't a kind of credit`);
  const score = currentScore(ctx, person);
  const entries = creditEntriesOf(ctx, person);
  const chargedOff = entries.some((e) => e.kind === "charged_off" && ctx.state.clock - numOf(e.at) <= 24 * MONTH);
  const secured = app.secured_by !== undefined && own(ctx.state.entities, app.secured_by) !== undefined;
  const label = def?.label ?? CLASS_TRAITS[cls].label;
  const tier = creditTierOf(score ?? 650);
  if (!secured && (tier === "deep_subprime" || chargedOff)) return { approved: false, reason: chargedOff ? "a recent charge-off on their report" : "their credit score is too low", apr: null, limit: null, cls, label };
  return { approved: true, reason: "", apr: def?.apr_pct ?? aprFor(ctx, cls, score), limit: typeof def?.limit === "number" ? def.limit : limitFor(ctx, cls, score), cls, label };
}

/** A person's credit report, for the dashboards. */
export function creditReport(ctx: ReadContext, person: EntityId): CreditReport {
  const cal = calendarOf(ctx.world);
  const raw = objOf(own(objOf(sliceOf(ctx.state, "economy").credit), person));
  const factors = scoreFactors(ctx, person);
  const score = typeof raw.score === "number" ? raw.score : factors ? scoreOf(factors) : null;
  const accounts = creditAccounts(ctx, person);
  const entries = creditEntriesOf(ctx, person);
  let limit = 0;
  let owed = 0;
  let ontime = 0;
  let late = 0;
  const rows = accounts.map((id) => {
    const c = classOf(ctx, id) as AccountClass;
    const p = productOf(ctx, id);
    const cycle = cycleOf(ctx.state, id);
    const debt = Math.max(0, -balance(ctx.state, id));
    if (CLASS_TRAITS[c].revolving && p?.limit) {
      limit += p.limit;
      owed += debt;
    }
    ontime += cycle?.ontime ?? 0;
    late += (cycle?.late30 ?? 0) + (cycle?.late60 ?? 0) + (cycle?.late90 ?? 0);
    const opened = strOf(own(ctx.state.entities, id)?.fields.opened);
    return { id, name: labelOf(ctx, id), class: c, status: statusOf(ctx.state, id), limit: p?.limit ?? null, owed: debt, opened: opened !== "" ? opened : null, late30: cycle?.late30 ?? 0, late60: cycle?.late60 ?? 0, late90: cycle?.late90 ?? 0 };
  });
  const ages = accounts.map((id) => ageMonths(ctx, id));
  const when = (at: number): string => formatClock(cal, at).split(",")[0] ?? "";
  const products = { ...Object.fromEntries((["credit_card", "line_of_credit", "loan"] as const).map((c) => [c, { label: CLASS_TRAITS[c].label, class: c }])), ...Object.fromEntries(Object.entries(worldProducts(ctx.world)).map(([id, p]) => [id, { label: p.label, class: p.class }])) };
  const offers = Object.entries(products)
    .filter(([, p]) => isCredit(p.class) && p.class !== "mortgage")
    .map(([product, p]) => ({ product, label: p.label, class: p.class, aprPct: aprFor(ctx, p.class, score), limit: limitFor(ctx, p.class, score) }));
  return {
    person,
    score,
    band: score === null ? null : scoreBand(score),
    tier: score === null ? null : creditTierOf(score),
    asOf: typeof raw.at === "number" ? when(raw.at) : null,
    factors,
    history: (Array.isArray(raw.history) ? raw.history : []).map((h) => objOf(h)).map((h) => ({ at: when(numOf(h.at)), score: numOf(h.score) })),
    utilisationPct: limit > 0 ? Math.round((owed * 1000) / limit) / 10 : 0,
    ageMonths: ages.length > 0 ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0,
    onTimePct: ontime + late > 0 ? Math.round((ontime * 1000) / (ontime + late)) / 10 : 100,
    accounts: rows,
    inquiries: entries.filter((e) => e.kind === "inquiry").map((e) => ({ at: when(numOf(e.at)), note: strOf(e.note) })),
    marks: entries.filter((e) => e.kind === "collections" || e.kind === "charged_off" || e.kind === "late").map((e) => ({ at: when(numOf(e.at)), kind: e.kind, note: e.kind === "late" ? `${labelOf(ctx, strOf(e.account))}: ${numOf(e.days)} days late` : `${labelOf(ctx, strOf(e.account))}: ${e.kind.replace(/_/g, " ")}` })),
    offers,
  };
}

/** Whether a person has a credit file (anything to score). */
export function hasCreditFile(ctx: ReadContext, person: EntityId): boolean {
  return creditAccounts(ctx, person).length > 0 || creditEntriesOf(ctx, person).length > 0;
}

/** The first day of the month at 06:00 in the world's calendar, inside `(from, to]`. */
export function scoreInstants(ctx: ReadContext, from: number, to: number): number[] {
  const cal = calendarOf(ctx.world);
  const out: number[] = [];
  for (let d = dateAt(cal, from).dayIndex; d <= dateAt(cal, to).dayIndex; d++) {
    const at = clockAt(cal, d, 360);
    if (dateAt(cal, at).day === 1 && at > from && at <= to) out.push(at);
  }
  return out;
}
