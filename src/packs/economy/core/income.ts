// Distributions (DESIGN §27.6): what holdings pay their owners, run as flows by the foundation's
// flow engine. Every holding whose asset pays (a dividend yield, a fund's income, a bond's coupon)
// derives a flow with its schedule; its amount is worked out when it falls due, from the units held
// then and the asset's price or face, and lands where the holding's route says: reinvested (more
// units at that day's price, the payout as their cost), an account its owners named, else the
// account the holding sits in, else each owner's deposit account by share. Each payout records the
// income for the owners' year (`economy.income`), which the investment view and the yearly
// investment tax read. Rent and business profits are their own flows (property.ts, and the work
// module's distributions, which `economy.stake_route` routes here).

import type { EntityId } from "../../../shared/ids";
import type { JsonObject } from "../../../shared/json";
import type { LedgerEvent, PackEvent, PostingLine } from "../../../shared/ledger";
import { formatMoney } from "../../../shared/world";
import { worthShares, type Flow, type Owner } from "../../../shared/finance";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { labelOf, numOf, objOf, own, strOf } from "../../../engine/pack-kit";
import type { EventTypeDef, ReadContext } from "../../../engine/registry";
import type { WorldState } from "../../../engine/state";
import type { AmountProvider, FinanceApi, FinanceRegistry, FlowPosting } from "./module";
import { assetOf, dateText, priceOf, reject, type Asset } from "./assets";
import { accountOfHolding, holdingIds, holdingOwners, lotsChange, lotsOf, marketOf, qtyOf, routeOf } from "./holdings";
import { basisRecord, byShare, INCOME_KINDS, recordIncome, setBasisRecord, type IncomeKind } from "./records";
import { QTY_EPSILON, roundQty } from "./pricing";

export const INCOME_PROVIDER = "holding_income";

/** Where a payout lands: each account and its part, the parts adding up to what was paid. */
export interface Payout {
  lines: PostingLine[];
  paid: number;
}

/**
 * A payout of `cents` from `source` (an outside account) to an entity's owners: to `to` when given,
 * else `account` (the account it belongs to), else each owner's deposit account by their share of
 * its worth. An owner with nowhere to put money (no account) isn't paid, so `paid` can be less.
 */
export function payout(api: FinanceApi, ctx: ReadContext, owners: readonly Owner[], cents: number, source: string, to: EntityId | null, account: EntityId | null): Payout {
  const into = to ?? account;
  if (into) return { lines: [{ account: source, amount: -cents }, { account: into, amount: cents }], paid: cents };
  const parts = byShare(worthShares(owners), cents);
  const lines: PostingLine[] = [];
  let paid = 0;
  parts.forEach((p, i) => {
    const deposit = api.depositAccount(ctx, p.party);
    // The last owner takes the rounding, so the parts add up to the whole.
    const part = i === parts.length - 1 ? cents - parts.slice(0, -1).reduce((a, x) => a + x.cents, 0) : p.cents;
    if (!deposit || part <= 0) return;
    lines.push({ account: deposit, amount: part });
    paid += part;
  });
  return paid > 0 ? { lines: [{ account: source, amount: -paid }, ...lines], paid } : { lines: [], paid: 0 };
}

/** The months a payment falls in, `pays` a year, evenly spaced and ending on `last` (December for dividends, a bond's maturity month). */
export function paymentMonths(pays: number, last: number, monthsInYear = 12): number[] {
  const n = Math.max(1, Math.min(monthsInYear, Math.round(pays)));
  const out = new Set<number>();
  for (let k = 0; k < n; k++) out.add((((last - 1 - Math.round((k * monthsInYear) / n)) % monthsInYear) + monthsInYear) % monthsInYear + 1);
  return [...out].sort((a, b) => a - b);
}

/** What one payment of a holding pays per unit, minor units (fractions kept). */
function perUnit(ctx: ReadContext, a: Asset, at: number): number {
  if (a.bond) return (a.bond.face * a.bond.couponPct) / 100 / Math.max(1, a.pays);
  return a.pays > 0 ? (priceOf(ctx, a, at) * a.yieldPct) / 100 / a.pays : 0;
}

/** A holding's income flow: its asset's payment schedule, the amount left to the provider. Null for a holding that pays nothing. */
function incomeFlow(api: FinanceApi, ctx: ReadContext, holding: EntityId): Flow | null {
  const a = assetOf(ctx, strOf(own(ctx.state.entities, holding)?.fields.asset));
  if (!a || a.option || a.pays <= 0 || (a.bond ? a.bond.couponPct <= 0 : a.yieldPct <= 0)) return null;
  if (qtyOf(lotsOf(ctx, holding)) <= QTY_EPSILON) return null;
  const owners = holdingOwners(api, ctx.state, holding);
  if (!owners.some((o) => api.feature(ctx, o.party, "investments"))) return null;
  const route = routeOf(ctx.state, holding);
  const account = accountOfHolding(ctx.state, holding);
  const cal = calendarOf(ctx.world);
  const name = a.symbol ?? a.label;
  const interest = a.bond !== null || a.class === "bond";
  // A bond pays on its maturity's day and month and every period back from it; dividends mid-month.
  const due = a.bond ? dateAt(cal, a.bond.maturity) : null;
  const months = paymentMonths(a.pays, due ? due.month : cal.system.months, cal.system.months);
  return {
    id: `income:${holding}`,
    label: `${name} ${interest ? "interest" : "dividend"}`,
    kind: "distribution",
    from: a.label,
    to: route.to ?? account ?? (owners[0] ? owners[0].party : ""),
    amount: { provider: INCOME_PROVIDER, args: { holding } },
    schedule: months.length >= cal.system.months ? { every: "month", days: [due ? due.day : 15], roll: "after" } : { every: "year", months, days: [due ? due.day : 15], roll: "after" },
    ...(a.bond ? { end: dateText(ctx.world, a.bond.maturity) } : {}),
    shortfall: "skip",
    category: interest ? "interest" : "dividends",
    link: holding,
    status: "active",
    source: "holdings",
  };
}

/**
 * One payment of a holding's income: the units held now times what a unit pays, from the asset's
 * issuer, to where it is routed (or reinvested in more units at today's price). Null when it holds
 * nothing or pays nothing today. Its posting is its one line (`quiet`): a reinvestment touches none
 * of the owner's accounts, so its memo carries the amount.
 */
export function holdingIncome(api: FinanceApi, ctx: ReadContext, holding: EntityId, at: number): FlowPosting | null {
  const a = assetOf(ctx, strOf(own(ctx.state.entities, holding)?.fields.asset));
  if (!a) return null;
  const qty = qtyOf(lotsOf(ctx, holding));
  if (qty <= QTY_EPSILON) return null;
  const cents = Math.round(qty * perUnit(ctx, a, at));
  if (cents <= 0) return null;
  const interest = a.bond !== null || a.class === "bond";
  const kind: IncomeKind = interest ? "interest" : "dividend";
  const name = a.symbol ?? a.label;
  const issuer = api.outside(`issuer:${a.id}`);
  const category = interest ? "interest" : "dividends";
  const route = routeOf(ctx.state, holding);
  const price = priceOf(ctx, a, at);
  if (route.reinvest && price > 0) {
    const memo = `${name} ${kind} reinvested: ${formatMoney(cents, ctx.world.currency)}`;
    return {
      cents,
      lines: [
        { account: issuer, amount: -cents },
        { account: marketOf(api, a.id), amount: cents },
      ],
      memo,
      kind: "income",
      category,
      extra: [{ type: "economy.income", data: { source: holding, cents, kind, reinvested: true } }, lotsChange(ctx.state, holding, roundQty(cents / price), cents, "reinvest", `${name} ${kind} reinvested`)],
      quiet: true,
    };
  }
  const account = accountOfHolding(ctx.state, holding);
  // A retirement account keeps what its holdings pay.
  const to = account && api.traitsOf(ctx, account)?.locked ? account : route.to;
  const paid = payout(api, ctx, holdingOwners(api, ctx.state, holding), cents, issuer, to, account);
  if (paid.paid <= 0) return null;
  return { cents: paid.paid, lines: paid.lines, memo: `${name} ${kind}`, kind: "income", category, extra: [{ type: "economy.income", data: { source: holding, cents: paid.paid, kind } }], quiet: true };
}

// ---------------------------------------------------------------- the income record

/** The owners an income source's payout is shared by: a holding's (its account's), else the entity's own list. */
function sourceOwners(api: FinanceApi, state: Readonly<WorldState>, source: EntityId): Owner[] {
  return own(state.entities, source)?.kind === "holding" ? holdingOwners(api, state, source) : api.ownersOf(state, source);
}

function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

function incomeEvent(api: FinanceApi): EventTypeDef<PackEvent> {
  return {
    // Income an entity paid its owners: a holding's dividend or interest, or a business's profit
    // share (to one owner, `party`). A reinvested profit share adds to that owner's stake.
    type: "economy.income",
    validate: (e, ctx) => {
      if (!own(ctx.state.entities, str(e, "source"))) return reject("missing_entity", `no ${labelOf(ctx, str(e, "source"))}`);
      if (!(INCOME_KINDS as readonly string[]).includes(str(e, "kind"))) return reject("bad_event", "income is a dividend, interest or a profit share");
      const cents = e.data.cents;
      if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0) return reject("bad_event", "income is a whole amount above nothing");
      return str(e, "party") === "" || own(ctx.state.entities, str(e, "party")) ? null : reject("missing_entity", `no ${labelOf(ctx, str(e, "party"))}`);
    },
    apply: (e, state, ctx) => {
      const kind = str(e, "kind") as IncomeKind;
      const cents = numOf(e.data.cents);
      const party = str(e, "party");
      const source = str(e, "source");
      if (party !== "") {
        recordIncome(state, ctx.world, party, kind, cents);
        if (e.data.reinvested === true && kind === "profit") {
          const r = basisRecord(state, source, party);
          setBasisRecord(state, source, party, { basis: (r?.basis ?? 0) + cents, since: r?.since ?? null });
        }
        return;
      }
      const shares = worthShares(sourceOwners(api, state, source));
      for (const p of byShare(shares, cents)) recordIncome(state, ctx.world, p.party, kind, p.cents);
    },
    describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "source"))}: ${formatMoney(numOf(e.data.cents), ctx.world.currency)} ${str(e, "kind") === "profit" ? "profit share" : str(e, "kind")}`),
  };
}

/** Holdings' income (DESIGN §27.6): the flows, their amounts and the income record. */
export function registerIncome(r: FinanceRegistry): void {
  r.core.event(incomeEvent(r.api));
  r.flows({
    id: "holdings",
    flows: (ctx) => holdingIds(ctx.state).flatMap((id) => incomeFlow(r.api, ctx, id) ?? []),
  });
  const provider: AmountProvider = (ctx, flow, at) => {
    const args: JsonObject = "provider" in flow.amount ? objOf(flow.amount.args) : {};
    return holdingIncome(r.api, ctx, strOf(args.holding), at);
  };
  r.amount(INCOME_PROVIDER, provider);
}

/** An income record for one owner (a business's profit share paid or reinvested): bookkeeping that rides with the payout. */
export function incomeFor(source: EntityId, party: EntityId, cents: number, kind: IncomeKind, reinvested = false): LedgerEvent[] {
  return cents > 0 ? [{ type: "economy.income", data: { source, party, cents, kind, ...(reinvested ? { reinvested: true } : {}) } }] : [];
}
