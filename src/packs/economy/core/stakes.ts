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
import { worthShares, type Owner } from "../../../shared/finance";
import type { FieldDef } from "../../../shared/world";
import { formatMoney } from "../../../shared/world";
import { labelOf, numOf, objOf, optionalQuery, own, strOf } from "../../../engine/pack-kit";
import type { EffectContext, EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import type { FinanceApi, FinanceRegistry } from "./module";
import { holdingsRecord, holdingsSlice, reject } from "./assets";
import { acquisition, disposal } from "./gains";
import { unit } from "./holdings";
import { incomeFor } from "./income";
import { YEAR_MINUTES } from "./pricing";
import { structureOf } from "./taxes";

/** What a business is worth beyond its books, in years of profit, when it names no multiple of its own. */
const VALUATION_MULTIPLE = 3;

const BUSINESS_FIELDS: Record<string, FieldDef> = {
  value: { type: "money", label: "Value (set: overrides the books)", min: 0, domain: "money", level: 3 },
  valuation_multiple: { type: "number", label: "Valued at this many years of profit, over its books", min: 0, default: VALUATION_MULTIPLE, domain: "money", level: 4 },
};

/** The businesses being valued right now: a business that (through others) owns itself is worth nothing more the second time round. */
const valuing = new Set<EntityId>();

/** Every business (a party of kind business), by id. */
export function businessIds(api: FinanceApi, ctx: ReadContext): EntityId[] {
  return Object.keys(ctx.state.entities)
    .filter((id) => api.partyKind(ctx, id) === "business")
    .sort();
}

/** What a business is worth: its set value, else its books and a multiple of its last year's profit; never below nothing. */
export function businessValue(api: FinanceApi, ctx: ReadContext, business: EntityId): number {
  const f = own(ctx.state.entities, business)?.fields ?? {};
  if (typeof f.value === "number" && Number.isFinite(f.value)) return Math.max(0, Math.round(f.value));
  if (valuing.has(business)) return 0;
  valuing.add(business);
  try {
    const books = optionalQuery(ctx, "economy.business_books")?.(ctx, business, ctx.state.clock - YEAR_MINUTES, ctx.state.clock);
    const book = api.netWorth(ctx, business) + (books ? books.receivables - books.payables : 0);
    const multiple = Math.max(0, numOf(f.valuation_multiple, VALUATION_MULTIPLE));
    return Math.max(0, Math.round(book + Math.max(0, books?.profit ?? 0) * multiple));
  } finally {
    valuing.delete(business);
  }
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
  /** Percentage points of the whole business. */
  share: number;
  price: number;
  buyer?: EntityId;
  to?: EntityId;
}

/**
 * Selling part of a stake (`stake_sell`): the buyer pays the seller, the share moves between them,
 * and the seller realises the gain on that part. A buyer outside the world can only take a whole
 * business from its only owner.
 */
export function sellStake(api: FinanceApi, ctx: EffectContext | ReadContext, x: StakeSale): LedgerEvent[] | Rejection {
  if (api.partyKind(ctx, x.business) !== "business") return reject("not_business", `${labelOf(ctx, x.business)} isn't a business`);
  const owners = api.ownersOf(ctx.state, x.business);
  const shares = worthShares(owners);
  const held = shares[x.party] ?? 0;
  if (held <= 0) return reject("not_yours", `${labelOf(ctx, x.party)} owns no part of ${labelOf(ctx, x.business)}`);
  const share = Math.min(held, x.share);
  if (!(share > 0)) return reject("bad_amount", "say what share to sell");
  if (x.share > held + 1e-9) return reject("declined", `${labelOf(ctx, x.party)} owns ${Math.round(held * 100) / 100}% of ${labelOf(ctx, x.business)}, not ${x.share}%`);
  const price = Math.round(x.price);
  if (!(price >= 0) || !Number.isSafeInteger(price)) return reject("bad_amount", "a price is a whole amount");
  if (x.buyer !== undefined && (!own(ctx.state.entities, x.buyer) || x.buyer === x.party || x.buyer === x.business)) return reject("missing_entity", `no buyer ${labelOf(ctx, x.buyer)}`);
  const whole = Math.abs(share - held) < 1e-9;
  if (x.buyer === undefined && !(whole && held >= 100 - 1e-9)) return reject("needs_buyer", `selling part of ${labelOf(ctx, x.business)} needs a buyer in the world`);
  // A buyer outside the world pays what the market does: no more than the business is worth.
  const worth = businessValue(api, ctx, x.business);
  if (x.buyer === undefined && price > worth) return reject("declined", `no buyer outside the world pays more than ${formatMoney(worth, ctx.world.currency)} for ${labelOf(ctx, x.business)}`);
  const to = x.to ?? api.depositAccount(ctx, x.party);
  if (!to) return reject("no_account", `${labelOf(ctx, x.party)} has no account the money could go to`);
  const unusable = api.mayUse(ctx, x.party, to, "into");
  if (unusable) return unusable;
  const memo = `Sold ${Math.round(share * 100) / 100}% of ${labelOf(ctx, x.business)} for ${formatMoney(price, ctx.world.currency)}`;
  const events: LedgerEvent[] = [];
  if (price > 0) {
    const paid = x.buyer ? api.pay(ctx, { from: x.buyer, to: x.party, cents: price, memo, deposit: to, kind: "purchase", category: "investment" }) : api.post(ctx, [{ account: api.outside(`buyer:${x.business}`), amount: -price }, { account: to, amount: price }], { memo, kind: "sale", category: "investment" });
    if (!Array.isArray(paid)) return paid;
    events.push(...paid);
  }
  // Everyone's share written out, so the buyer's and seller's add up with the rest's unchanged.
  const next: Owner[] = [];
  for (const o of owners) {
    const pct = (shares[o.party] ?? 0) - (o.party === x.party ? share : 0) + (o.party === x.buyer ? share : 0);
    if (o.party === x.party && pct <= 1e-9) continue;
    next.push({ party: o.party, role: o.role, share: Math.round(pct * 10000) / 10000 });
  }
  if (x.buyer && !next.some((o) => o.party === x.buyer)) next.push({ party: x.buyer, role: "owner", share: Math.round(share * 10000) / 10000 });
  return unit([
    ...events,
    disposal(x.business, x.party, (share / held) * 100, price, memo),
    { type: "set", entity: x.business, field: "owners", value: next as unknown as JsonValue },
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
  r.core.effect({
    type: "economy.stake_sell",
    args: ["business", "share", "price", "buyer?", "to?", "party?"],
    resolve: (a, ctx) => {
      const buyer = strOf(a.buyer);
      const to = strOf(a.to);
      return sellStake(r.api, ctx, { party: strOf(a.party) || ctx.world.pov, business: strOf(a.business), share: typeof a.share === "number" ? a.share : NaN, price: typeof a.price === "number" ? a.price : NaN, ...(buyer ? { buyer } : {}), ...(to ? { to } : {}) });
    },
  });
  r.core.action({
    id: "stake_sell",
    label: "Sell a share of a business",
    pack: "economy",
    params: { business: { type: "ref", ref: "business" }, share: { type: "number", label: "Share, %" }, price: { type: "money", label: "Price" }, buyer: { type: "ref", ref: "person", label: "Buyer", optional: true }, to: { type: "ref", ref: "account", label: "Proceeds to", optional: true } },
    requires: ["money_feature('investments', self)"],
    outcomes: { default: [{ type: "economy.stake_sell", args: { party: "self", business: "business", share: "=params.share", price: "=params.price", buyer: "=params.buyer", to: "=params.to" } }] },
    duration: "60",
    lexicon: ["sell my share of the business", "sell the shop"],
    observable: "signs a stack of papers",
  });
  r.core.formula("business_value", (ctx, id) => businessValue(r.api, ctx, String(id ?? "")));
}
