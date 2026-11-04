// Business stakes (DESIGN §27.10). An owner of a business holds a stake: their share (the business's
// `owners`) of its value. The value is the business's own `value` when its author or the GM set one;
// otherwise its book value (its net worth: its accounts, holdings, property and stakes, less what it
// owes, plus what its customers owe it less what it owes its suppliers, from the work module's
// books) and its last twelve months' profit times its valuation multiple. The work module pays
// profit out by share; where each owner's share lands is theirs to route here (an account, or kept
// in the business, which adds to their stake), and each payout is income for their year. Selling
// part of a stake moves the share and realises the seller's gain against what they put in.

import type { EntityId } from "../../../shared/ids";
import type { JsonValue } from "../../../shared/json";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { countsUnits, FINANCE_ACTIONS, moveUnits, ownersJson, PARTY_KINDS, unitsOf, withUnitShares, worthShares, type Owner } from "../../../shared/finance";
import type { FieldDef } from "../../../shared/world";
import { formatMoney } from "../../../shared/world";
import { labelOf, numOf, objOf, optionalQuery, own, strOf } from "../../../engine/pack-kit";
import { passMemo } from "../../../engine/read-pass";
import type { EffectContext, EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import type { FinanceApi, FinanceRegistry } from "./module";
import { holdingsRecord, holdingsSlice, reject } from "./assets";
import { acquisition, disposal } from "./gains";
import { unit } from "./holdings";
import { incomeFor } from "./income";
import { YEAR_MINUTES } from "./pricing";
import { structureOf } from "./taxes";
import { actAs, asParam, mayAs, moneyWords } from "./acting";

/** What a business is worth beyond its books, in years of profit, when it names no multiple of its own. */
const VALUATION_MULTIPLE = 3;

const BUSINESS_FIELDS: Record<string, FieldDef> = {
  value: { type: "money", label: "Value (set: overrides the books)", min: 0, domain: "money", level: 3 },
  valuation_multiple: { type: "number", label: "Valued at this many years of profit, over its books", min: 0, default: VALUATION_MULTIPLE, domain: "money", level: 4 },
};

/** The businesses being valued right now: a business that (through others) owns itself is worth nothing more the second time round. */
const valuing = new Set<EntityId>();

/** Every business (a party of kind business), by id. Kept for the read pass: every party's worth walks them. */
export function businessIds(api: FinanceApi, ctx: ReadContext): EntityId[] {
  return passMemo([ctx.state, ctx.state.entities, ctx.world, api], "economy.businesses", () =>
    Object.keys(ctx.state.entities)
      .filter((id) => api.partyKind(ctx, id) === "business")
      .sort(),
  );
}

/** How a business's value is worked out (DESIGN §27.10): its set value, else its book value and its last year's profit times its multiple; never below nothing. */
export interface Valuation {
  value: number;
  /** Its author or the GM set it (`value`). */
  set: boolean;
  book: number;
  profit: number;
  multiple: number;
}

/** A business's valuation, its parts as they add up. */
export function valuationOf(api: FinanceApi, ctx: ReadContext, business: EntityId): Valuation {
  const f = own(ctx.state.entities, business)?.fields ?? {};
  const multiple = Math.max(0, numOf(f.valuation_multiple, VALUATION_MULTIPLE));
  if (typeof f.value === "number" && Number.isFinite(f.value)) return { value: Math.max(0, Math.round(f.value)), set: true, book: 0, profit: 0, multiple };
  if (valuing.has(business)) return { value: 0, set: false, book: 0, profit: 0, multiple };
  valuing.add(business);
  try {
    const books = optionalQuery(ctx, "economy.business_books")?.(ctx, business, ctx.state.clock - YEAR_MINUTES, ctx.state.clock);
    const book = api.netWorth(ctx, business) + (books ? books.receivables - books.payables : 0);
    const profit = Math.max(0, books?.profit ?? 0);
    return { value: Math.max(0, Math.round(book + profit * multiple)), set: false, book: Math.round(book), profit, multiple };
  } finally {
    valuing.delete(business);
  }
}

/** What a business is worth: its set value, else its books and a multiple of its last year's profit; never below nothing. */
export function businessValue(api: FinanceApi, ctx: ReadContext, business: EntityId): number {
  return valuationOf(api, ctx, business).value;
}

/** A party's share of every business they own, a line each. */
export function stakeWorth(api: FinanceApi, ctx: ReadContext, party: EntityId): { assets: number; lines: { label: string; cents: number }[] } {
  const lines: { label: string; cents: number }[] = [];
  let assets = 0;
  for (const id of businessIds(api, ctx)) {
    if (id === party) continue;
    const share = api.shareOf(ctx.state, id, party);
    if (share <= 0) continue;
    const cents = Math.round((businessValue(api, ctx, id) * share) / 100);
    if (cents === 0) continue;
    assets += cents;
    lines.push({ label: `${labelOf(ctx, id)} (${Math.round(share * 100) / 100}%)`, cents });
  }
  return { assets, lines };
}

/** Where an owner's profit share goes: `routes[business][owner]`, an account or `reinvest`. */
export function stakeRoute(ctx: ReadContext, owner: EntityId, business: EntityId): { account: EntityId } | { reinvest: true } | null {
  const route = strOf(own(objOf(own(objOf(holdingsSlice(ctx.state).routes), business)), owner));
  if (route === "reinvest") return { reinvest: true };
  return route !== "" && own(ctx.state.entities, route)?.kind === "account" ? { account: route } : null;
}

function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

const routeEvent: EventTypeDef<PackEvent> = {
  // Where one owner's share of a business's profit goes from now on ("" puts it back to their deposit account).
  type: "economy.stake_route",
  validate: (e, ctx) => (own(ctx.state.entities, str(e, "business")) && own(ctx.state.entities, str(e, "owner")) ? null : reject("missing_entity", "a route names a business and its owner")),
  apply: (e, state) => {
    const routes = holdingsRecord(state, "routes");
    const mine = objOf(own(routes, str(e, "business")));
    if (str(e, "to") === "") delete mine[str(e, "owner")];
    else mine[str(e, "owner")] = str(e, "to");
    routes[str(e, "business")] = mine;
  },
  describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "owner"))}'s profit from ${labelOf(ctx, str(e, "business"))} goes to ${str(e, "to") || "their account"}`),
};

/** Where an owner's profit share from a business lands (`economy.route` with a business). */
export function setStakeRoute(api: FinanceApi, ctx: ReadContext, owner: EntityId, business: EntityId, to: string): LedgerEvent[] | Rejection {
  if (api.partyKind(ctx, business) !== "business") return reject("not_business", `${labelOf(ctx, business)} isn't a business`);
  if (api.shareOf(ctx.state, business, owner) <= 0) return reject("not_yours", `${labelOf(ctx, owner)} owns no part of ${labelOf(ctx, business)}`);
  const route = to.trim();
  if (route !== "" && route !== "reinvest") {
    const unusable = api.mayUse(ctx, owner, route, "into");
    if (unusable) return unusable;
  }
  const current = stakeRoute(ctx, owner, business);
  const now = current === null ? "" : "reinvest" in current ? "reinvest" : current.account;
  return now === route ? [] : [{ type: "economy.stake_route", data: { business, owner, to: route } }];
}

export interface StakeSale {
  party: EntityId;
  business: EntityId;
  /** Percentage points of the whole business; in a company counting units, read as that many of its units. */
  share?: number;
  /** Units of a company that counts them (ORG-SPEC §3.10). */
  units?: number;
  price: number;
  buyer?: EntityId;
  to?: EntityId;
}

/**
 * Selling part of a stake (`stake_sell`): the buyer pays the seller, the share moves between them,
 * and the seller realises the gain on that part. In a company counting units (ORG-SPEC §3.10), units
 * move, each keeping its class, and every share is written from them. A buyer outside the world can
 * only take a whole business from its only owner. A price of nothing gives the stake away.
 */
export function sellStake(api: FinanceApi, ctx: EffectContext | ReadContext, x: StakeSale): LedgerEvent[] | Rejection {
  if (api.partyKind(ctx, x.business) !== "business") return reject("not_business", `${labelOf(ctx, x.business)} isn't a business`);
  const owners = api.ownersOf(ctx.state, x.business);
  const shares = worthShares(owners);
  const held = shares[x.party] ?? 0;
  const name = labelOf(ctx, x.business);
  if (held <= 0) return reject("not_yours", `${labelOf(ctx, x.party)} owns no part of ${name}`);
  const counting = countsUnits(owners);
  if (x.units !== undefined && !counting) return reject("no_units", `${name} doesn't count its shares in units: sell a share of it in percent`);
  const heldUnits = unitsOf(owners, x.party);
  const units = counting ? (x.units ?? Math.round((unitsOf(owners) * (x.share ?? 0)) / 100)) : undefined;
  if (units !== undefined && !(Number.isSafeInteger(units) && units > 0)) return reject("bad_amount", "say how many units to sell");
  if (units !== undefined && units > heldUnits) return reject("declined", `${labelOf(ctx, x.party)} holds ${heldUnits} units of ${name}, not ${units}`);
  const share = units !== undefined ? (held * units) / heldUnits : Math.min(held, x.share ?? 0);
  if (!(share > 0)) return reject("bad_amount", "say what share to sell");
  if (units === undefined && (x.share ?? 0) > held + 1e-9) return reject("declined", `${labelOf(ctx, x.party)} owns ${Math.round(held * 100) / 100}% of ${name}, not ${x.share}%`);
  const price = Math.round(x.price);
  if (!(price >= 0) || !Number.isSafeInteger(price)) return reject("bad_amount", "a price is a whole amount");
  if (x.buyer !== undefined && (!own(ctx.state.entities, x.buyer) || x.buyer === x.party || x.buyer === x.business)) return reject("missing_entity", `no buyer ${labelOf(ctx, x.buyer)}`);
  const whole = units !== undefined ? units === heldUnits : Math.abs(share - held) < 1e-9;
  if (x.buyer === undefined && !(whole && held >= 100 - 1e-9)) return reject("needs_buyer", `selling part of ${name} needs a buyer in the world`);
  // A buyer outside the world pays what the market does: no more than the business is worth.
  const worth = businessValue(api, ctx, x.business);
  if (x.buyer === undefined && price > worth) return reject("declined", `no buyer outside the world pays more than ${formatMoney(worth, ctx.world.currency)} for ${name}`);
  const to = x.to ?? api.depositAccount(ctx, x.party);
  if (!to) return reject("no_account", `${labelOf(ctx, x.party)} has no account the money could go to`);
  const unusable = api.mayUse(ctx, x.party, to, "into");
  if (unusable) return unusable;
  const part = `${units !== undefined ? `${units} units (${Math.round(share * 100) / 100}%)` : `${Math.round(share * 100) / 100}%`} of ${name}`;
  const memo = price > 0 ? `Sold ${part} for ${formatMoney(price, ctx.world.currency)}` : `Gave ${part} away`;
  const events: LedgerEvent[] = [];
  if (price > 0) {
    const paid = x.buyer ? api.pay(ctx, { from: x.buyer, to: x.party, cents: price, memo, deposit: to, kind: "purchase", category: "investment" }) : api.post(ctx, [{ account: api.outside(`buyer:${x.business}`), amount: -price }, { account: to, amount: price }], { memo, kind: "sale", category: "investment" });
    if (!Array.isArray(paid)) return paid;
    events.push(...paid);
  }
  let next: Owner[];
  if (units !== undefined) next = x.buyer ? moveUnits(owners, x.party, x.buyer, units) : withUnitShares(owners.map((o) => (o.party === x.party ? { ...o, units: 0 } : o)));
  else {
    // Everyone's share written out, so the buyer's and seller's add up with the rest's unchanged.
    next = [];
    for (const o of owners) {
      const pct = (shares[o.party] ?? 0) - (o.party === x.party ? share : 0) + (o.party === x.buyer ? share : 0);
      if (o.party === x.party && pct <= 1e-9) continue;
      next.push({ party: o.party, role: o.role, share: Math.round(pct * 10000) / 10000 });
    }
    if (x.buyer && !next.some((o) => o.party === x.buyer)) next.push({ party: x.buyer, role: "owner", share: Math.round(share * 10000) / 10000 });
  }
  return unit([
    ...events,
    disposal(x.business, x.party, units !== undefined ? (units / heldUnits) * 100 : (share / held) * 100, price, memo),
    { type: "set", entity: x.business, field: "owners", value: (units !== undefined ? ownersJson(next) : next) as unknown as JsonValue },
    ...(x.buyer ? [acquisition(x.business, x.buyer, price)] : []),
  ]);
}

/** Business stakes (DESIGN §27.10): value, profit routing and sales. */
export function registerStakes(r: FinanceRegistry): void {
  r.fields("business", BUSINESS_FIELDS);
  r.core.event(routeEvent);
  r.core.query("economy.stake_route", stakeRoute);
  // A pass-through business's profit is its owners' income through estimated tax; a C corporation's payout is a dividend, which the investment tax covers.
  r.core.service("economy.stake_paid", (ctx, owner, business, cents, reinvested) => incomeFor(business, owner, Math.round(cents), structureOf(ctx.state, business) === "c_corp" ? "dividend" : "profit", reinvested));
  // Sold `as` an organization (ORG-SPEC §3.6): its stake, by someone who manages its shares (`shares.manage`). The GM's (and agents' `transfer`) names the holder as `party`, with no `by`.
  r.core.effect({
    type: "economy.stake_sell",
    args: ["business", "share?", "units?", "price?", "buyer?", "to?", "party?", "by?"],
    gm: true,
    resolve: (a, ctx) => {
      const buyer = strOf(a.buyer);
      const to = strOf(a.to);
      const party = strOf(a.party) || ctx.world.pov;
      const share = typeof a.share === "number" ? a.share : undefined;
      const units = typeof a.units === "number" ? a.units : undefined;
      const price = typeof a.price === "number" ? a.price : 0;
      const what = units !== undefined ? `${units} units` : `${Math.round((share ?? 0) * 100) / 100}%`;
      return actAs(ctx, { by: strOf(a.by), party, power: "shares.manage", line: () => `${price > 0 ? "Sold" : "Gave"} ${what} of ${labelOf(ctx, strOf(a.business))}${buyer ? ` to ${labelOf(ctx, buyer)}` : ""}${price > 0 ? ` for ${moneyWords(ctx, price)}` : ""}`, names: [buyer] }, () =>
        sellStake(r.api, ctx, { party, business: strOf(a.business), price, ...(share !== undefined ? { share } : {}), ...(units !== undefined ? { units } : {}), ...(buyer ? { buyer } : {}), ...(to ? { to } : {}) }),
      );
    },
  });
  r.core.action({
    id: FINANCE_ACTIONS.stakeSell,
    label: "Sell a share of a business",
    description: "Sell part of your share of a business, in percent or, where it counts them, in units; to someone in the world, or a whole business to a buyer outside it.",
    pack: "economy",
    params: {
      business: { type: "ref", ref: "business" },
      share: { type: "number", label: "Share, %", optional: true },
      units: { type: "number", label: "Units (where it counts them)", optional: true },
      price: { type: "money", label: "Price" },
      buyer: { type: "ref", of: { kind: [...PARTY_KINDS] }, label: "Buyer", optional: true },
      to: { type: "ref", ref: "account", label: "Proceeds to", optional: true },
      as: asParam("shares.manage", "Selling as: an organization whose shares you manage, only when the input sells its stake (\"the trust's share of the shop\"); left out, it's yours"),
    },
    requires: ["money_feature('investments', self)", "params.share != null or params.units != null", mayAs("shares.manage")],
    outcomes: { default: [{ type: "economy.stake_sell", args: { party: "self", business: "business", share: "=params.share", units: "=params.units", price: "=params.price", buyer: "=params.buyer", to: "=params.to", by: "actor" } }] },
    duration: "60",
    lexicon: ["sell my share of the business", "sell the shop", "sell my shares"],
    observable: "signs a stack of papers",
  });
  r.core.formula("business_value", (ctx, id) => businessValue(r.api, ctx, String(id ?? "")));
}
