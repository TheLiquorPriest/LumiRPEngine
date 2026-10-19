// Options and maturities (DESIGN §27.7). An option contract is an asset priced from its underlying
// (Black-Scholes in assets.ts) and held in lots like any other. Its holder may exercise it before
// expiry: a call pays the strike for the underlying's units, a put delivers units the holder owns
// for the strike (a cash-settled contract pays what it's worth over the strike instead). What the
// contracts cost goes into the basis of the units a call brings, or comes off a put's proceeds, so
// the gain is the one a tax return would show. At expiry (the market's close on its date) a
// contract in the money is exercised and settled in cash at its intrinsic value; one out of the
// money expires worthless, its cost a realised loss. A bond held to maturity is redeemed at its
// face on its maturity date. Each is one `economy.exercise` or lots event whose reducer does the
// lot arithmetic, so a rebased view settles the lots the branch holds.

import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PackEvent, PostingLine } from "../../../shared/ledger";
import { formatMoney } from "../../../shared/world";
import { labelOf, numOf, own, strOf } from "../../../engine/pack-kit";
import type { EventTypeDef, ReadContext, Rejection, SlotInfo } from "../../../engine/registry";
import type { FinanceApi, FinanceRegistry } from "./module";
import { assetOf, instantIn, MARKET_CLOSE, priceOf, reject, type Asset } from "./assets";
import { accountOfHolding, applyLots, canTrade, findHolding, holdingIds, holdingOwners, lotsChange, lotsOf, marketOf, qtyOf, unit, unitsText } from "./holdings";
import { holdingIncome, payout } from "./income";
import { intrinsic, QTY_EPSILON, roundQty, takeFifo } from "./pricing";

function isRejection(v: LedgerEvent[] | Rejection): v is Rejection {
  return !Array.isArray(v);
}

function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

/**
 * A physical exercise: `qty` contracts out of the option holding (first in, first out), and the
 * underlying's units into (a call) or out of (a put) the holding `into`. A call's units cost the
 * strike paid plus the contracts' cost; a put's units are sold for the strike less the contracts'
 * cost, realised by their owners.
 */
function exerciseEvent(api: FinanceApi): EventTypeDef<PackEvent> {
  return {
    type: "economy.exercise",
    validate(e, ctx) {
      const option = str(e, "option");
      const into = str(e, "into");
      const qty = numOf(e.data.qty);
      const units = numOf(e.data.units);
      const cash = e.data.cash;
      if (own(ctx.state.entities, option)?.kind !== "holding" || own(ctx.state.entities, into)?.kind !== "holding") return reject("missing_holding", "an exercise names its contracts and the holding of their underlying");
      if (!(qty > 0) || !(units > 0) || typeof cash !== "number" || !Number.isSafeInteger(cash) || cash < 0) return reject("bad_event", "an exercise is a number of contracts, their units and the strike's cash");
      if (qtyOf(lotsOf(ctx, option)) + QTY_EPSILON < qty) return reject("declined", `${labelOf(ctx, option)} holds fewer than ${qty} contracts`);
      if (e.data.right === "put" && qtyOf(lotsOf(ctx, into)) + QTY_EPSILON < units) return reject("declined", `${labelOf(ctx, into)} holds fewer than ${unitsText(units)} units to deliver`);
      return e.data.right === "call" || e.data.right === "put" ? null : reject("bad_event", "an exercise is of a call or a put");
    },
    apply(e, state, ctx) {
      const option = str(e, "option");
      const into = str(e, "into");
      const cash = numOf(e.data.cash);
      const contracts = takeFifo(lotsOf({ world: ctx.world, state, tables: ctx.tables }, option), numOf(e.data.qty));
      if (!contracts) return;
      const premium = contracts.taken.reduce((a, l) => a + l.cost, 0);
      const label = strOf(e.data.label, `Exercised ${labelOf(ctx, option)}`);
      // The contracts leave without a gain of their own: their cost moves to the units.
      applyLots(api, state, ctx.world, ctx.tables, option, -numOf(e.data.qty), 0, label, false);
      if (e.data.right === "call") applyLots(api, state, ctx.world, ctx.tables, into, numOf(e.data.units), cash + premium, label);
      else applyLots(api, state, ctx.world, ctx.tables, into, -numOf(e.data.units), Math.max(0, cash - premium), label);
    },
    describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "option"))}: ${numOf(e.data.qty)} exercised`),
    touches: (e) => [
      { entity: str(e, "option"), field: "lots" },
      { entity: str(e, "into"), field: "lots" },
    ],
  };
}

export interface Exercise {
  party: EntityId;
  holding: EntityId;
  qty?: number;
  from?: EntityId;
  to?: EntityId;
}

/** Exercising contracts before expiry (`economy.exercise`): the strike's cash, the units, the lots; one unit. */
export function exercise(api: FinanceApi, ctx: ReadContext, x: Exercise): LedgerEvent[] | Rejection {
  const h = own(ctx.state.entities, x.holding);
  if (!h || h.kind !== "holding") return reject("missing_holding", `no holding ${labelOf(ctx, x.holding)}`);
  const a = assetOf(ctx, strOf(h.fields.asset));
  if (!a?.option) return reject("not_option", `${h.name} isn't an option`);
  if (!api.feature(ctx, x.party, "options")) return reject("level", "options aren't followed at this money level");
  if (!canTrade(api, ctx, x.party, x.holding)) return reject("not_yours", `${h.name} isn't ${labelOf(ctx, x.party)}'s to exercise`);
  if (ctx.state.clock >= a.option.expiry) return reject("expired", `${a.label} has expired`);
  const held = qtyOf(lotsOf(ctx, x.holding));
  const qty = typeof x.qty === "number" && x.qty > 0 ? Math.floor(x.qty + 1e-9) : Math.floor(held + 1e-9);
  if (qty < 1) return reject("nothing_held", `${labelOf(ctx, x.party)} holds no whole contract of ${a.label}`);
  if (qty > held + QTY_EPSILON) return reject("declined", `${h.name} holds ${unitsText(held)} contracts, not ${qty}`);
  const under = assetOf(ctx, a.option.underlying);
  if (!under) return reject("missing_asset", `no asset ${a.option.underlying}`);
  const units = qty * a.option.multiplier;
  const strike = Math.round(units * a.option.strike);
  const account = accountOfHolding(ctx.state, x.holding);
  const money = (c: number): string => formatMoney(c, ctx.world.currency);
  const label = `Exercised ${qty} ${a.label}`;

  if (a.option.settlement === "cash") {
    const cash = Math.round(units * intrinsic(a.option.right, priceOf(ctx, under), a.option.strike));
    if (cash <= 0) return reject("out_of_money", `${a.label} is worth nothing to exercise`);
    const posted = settle(api, ctx, x.holding, a, qty, cash, label, x.to);
    return isRejection(posted) ? posted : unit(posted);
  }

  const into = findHolding(ctx.state, under.id, account, x.party);
  const events: LedgerEvent[] = [];
  const market = marketOf(api, under.id);
  let lines: PostingLine[];
  let target = into;
  if (a.option.right === "call") {
    const from = x.from ?? account ?? api.depositAccount(ctx, x.party);
    if (!from) return reject("no_account", `${labelOf(ctx, x.party)} has no account to pay the strike from`);
    if (x.from && !api.accountsOf(ctx, x.party, "spend").includes(x.from)) return reject("not_yours", `${labelOf(ctx, x.from)} isn't ${labelOf(ctx, x.party)}'s to pay from`);
    if (!target) {
      target = `${account ?? x.party}:${under.id}`;
      for (let i = 2; own(ctx.state.entities, target); i++) target = `${account ?? x.party}:${under.id}:${i}`;
      events.push({ type: "spawn", entity: { id: target, kind: "holding", name: under.symbol ?? under.label, tier: "background", fields: { asset: under.id, lots: [], ...(account ? { account } : { owners: [{ party: x.party, role: "owner" }] }) }, relations: [] } });
    }
    lines = [
      { account: from, amount: -strike },
      { account: market, amount: strike },
    ];
  } else {
    if (!target || qtyOf(lotsOf(ctx, target)) + QTY_EPSILON < units) return reject("nothing_to_deliver", `exercising ${qty} ${a.label} delivers ${unitsText(units)} ${under.symbol ?? under.label}, which ${labelOf(ctx, x.party)} doesn't hold${account ? ` in ${labelOf(ctx, account)}` : ""}`);
    const to = x.to ?? account ?? api.depositAccount(ctx, x.party);
    if (!to) return reject("no_account", `${labelOf(ctx, x.party)} has no account the strike could go to`);
    lines = [
      { account: market, amount: -strike },
      { account: to, amount: strike },
    ];
  }
  const posted = api.post(ctx, lines, { memo: `${label}: ${money(strike)} for ${unitsText(units)} ${under.symbol ?? under.label}`, kind: a.option.right === "call" ? "purchase" : "sale", category: "investment" });
  if (isRejection(posted)) return posted;
  return unit([...events, ...posted, { type: "economy.exercise", data: { option: x.holding, into: target, qty, units, cash: strike, right: a.option.right, label } }]);
}

/** Contracts closed for cash (a cash-settled exercise, or settlement at expiry): the cash to the holder, the contracts sold for it. */
function settle(api: FinanceApi, ctx: ReadContext, holding: EntityId, a: Asset, qty: number, cash: number, label: string, to?: EntityId): LedgerEvent[] | Rejection {
  const source = marketOf(api, a.option?.underlying ?? a.id);
  const account = accountOfHolding(ctx.state, holding);
  const paid = payout(api, ctx, holdingOwners(api, ctx.state, holding), cash, source, to ?? null, account);
  if (paid.paid <= 0) return reject("no_account", `nobody holding ${a.label} has an account the cash could go to`);
  const posted = api.post(ctx, paid.lines, { memo: label, kind: "sale", category: "investment" });
  if (isRejection(posted)) return posted;
  return [...posted, lotsChange(ctx.state, holding, -qty, paid.paid, "settle", label)];
}

/**
 * The day's expiries and maturities, at the market's close: contracts in the money settle in cash at
 * their intrinsic value and the rest expire worthless; bonds pay their face. Each is a unit of its
 * own, with a note for its owners.
 */
function settlements(api: FinanceApi, ctx: ReadContext, slot: SlotInfo): LedgerEvent[] {
  const at = instantIn(ctx, slot, MARKET_CLOSE);
  if (!at) return [];
  const out: LedgerEvent[] = [];
  const money = (c: number): string => formatMoney(c, ctx.world.currency);
  for (const holding of holdingIds(ctx.state)) {
    const a = assetOf(ctx, strOf(own(ctx.state.entities, holding)?.fields.asset));
    const due = a?.option?.expiry ?? a?.bond?.maturity;
    if (!a || due === undefined || due > at.at) continue;
    const qty = qtyOf(lotsOf(ctx, holding));
    if (qty <= QTY_EPSILON) continue;
    const owners = holdingOwners(api, ctx.state, holding);
    const notes = (text: string): LedgerEvent[] => owners.flatMap((o) => api.note(ctx, o.party, "bill", text));
    if (a.bond) {
      const cash = Math.round(qty * a.bond.face);
      const label = `${a.label} matured`;
      // Its last coupon is paid with it, to where its coupons go, and is the year's interest.
      const coupon = holdingIncome(api, ctx, holding, at.at, true);
      const paid = coupon?.lines ? api.post(ctx, coupon.lines, { memo: coupon.memo ?? label, kind: "income", category: coupon.category ?? "interest" }) : [];
      const couponEvents = isRejection(paid) || !coupon ? [] : [...paid, ...(coupon.extra ?? [])];
      const couponCents = couponEvents.length > 0 && coupon ? coupon.cents : 0;
      const settled = settle(api, ctx, holding, { ...a, option: null }, qty, cash, label);
      out.push(...(isRejection(settled) ? [] : unit([...couponEvents, ...settled, ...notes(`${a.label} matured: ${money(cash + couponCents)} paid out${couponCents > 0 ? `, its last coupon of ${money(couponCents)} with it` : ""}.`)])));
      continue;
    }
    if (!a.option) continue;
    const under = assetOf(ctx, a.option.underlying);
    const value = under ? Math.round(roundQty(qty) * a.option.multiplier * intrinsic(a.option.right, priceOf(ctx, under, at.at), a.option.strike)) : 0;
    if (value > 0) {
      const label = `${a.label} exercised at expiry`;
      const settled = settle(api, ctx, holding, a, qty, value, label);
      if (!isRejection(settled)) {
        out.push(...unit([...settled, ...notes(`${a.label} was exercised at expiry and settled for ${money(value)}.`)]));
        continue;
      }
    }
    out.push(...unit([lotsChange(ctx.state, holding, -qty, 0, "expire", `${a.label} expired`), ...notes(`${a.label} expired worthless.`)]));
  }
  return out;
}

/** Options and maturities (DESIGN §27.7): exercise, expiry and redemption. */
export function registerOptions(r: FinanceRegistry): void {
  r.core.event(exerciseEvent(r.api));
  r.core.effect({
    type: "economy.exercise",
    args: ["holding", "qty?", "from?", "to?", "party?"],
    resolve: (a, ctx) => exercise(r.api, ctx, { party: strOf(a.party) || ctx.world.pov, holding: strOf(a.holding), ...(typeof a.qty === "number" ? { qty: a.qty } : {}), ...(strOf(a.from) !== "" ? { from: strOf(a.from) } : {}), ...(strOf(a.to) !== "" ? { to: strOf(a.to) } : {}) }),
  });
  r.core.action({
    id: "exercise_option",
    label: "Exercise an option",
    pack: "economy",
    params: { holding: { type: "ref", ref: "holding" }, qty: { type: "number", label: "Contracts", optional: true }, from: { type: "ref", ref: "account", label: "Pay the strike from", optional: true }, to: { type: "ref", ref: "account", label: "Strike to", optional: true } },
    requires: ["money_feature('options', self)"],
    outcomes: { default: [{ type: "economy.exercise", args: { party: "self", holding: "holding", qty: "=params.qty", from: "=params.from", to: "=params.to" } }] },
    duration: "2",
    lexicon: ["exercise the option", "exercise my calls", "exercise my puts"],
    observable: "checks their phone",
  });
  // After the day's marks (registered after the market), so contracts settle at the close's price.
  r.core.process({ id: "economy.settlements", domain: "money", minLevel: 3, step: (slot, ctx) => settlements(r.api, ctx, slot) });
}
