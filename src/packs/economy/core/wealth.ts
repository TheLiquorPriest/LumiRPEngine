// The holdings module (DESIGN §27): assets and their markets, holdings and trading, distributions,
// options and maturities, gains and their tax, real estate and business stakes, and what all of it
// adds to a party's net worth, dashboards and money summary. `registerAssets` is the one entry the
// economy pack calls (`modules.ts`); each part registers its own events, effects and processes, in
// an order that matters for the processes: the day's marks before the day's settlements.

import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent } from "../../../shared/ledger";
import type { AlertLine, HoldingView, InvestmentsView } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { calendarOf, dateAt } from "../../../engine/calendar";
import { labelOf, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import type { FinanceApi, FinanceRegistry } from "./module";
import { assetOf, configAssets, dateText, priceOf, readAssetDef, registerMarkets, reject } from "./assets";
import { registerGains, taxEstimate } from "./gains";
import { holdingsWorth, holdingView, lotsOf, qtyOf, registerHoldings, setRoute, visibleHoldings } from "./holdings";
import { registerIncome } from "./income";
import { registerOptions } from "./options";
import { monthlyRent, propertyIds, propertyValue, propertyView, propertyWorth, registerProperty, routeRent, securedLoans, visibleProperties } from "./property";
import { gainsIn, incomeIn } from "./records";
import { businessIds, businessValue, registerStakes, setStakeRoute, stakeWorth } from "./stakes";

/** Where a property's rent lands (`economy.route` with a property): an account of the owner's, or back to the owners' accounts. */
function setRentRoute(api: FinanceApi, ctx: ReadContext, party: EntityId, property: EntityId, to: string): LedgerEvent[] | Rejection {
  if (own(ctx.state.entities, property)?.kind !== "property") return reject("missing_property", `no property ${labelOf(ctx, property)}`);
  if (!api.ownersOf(ctx.state, property).some((o) => o.party === party && (o.role === "owner" || o.role === "joint" || o.role === "trustee" || o.role === "custodian"))) return reject("not_yours", `${labelOf(ctx, property)} isn't ${labelOf(ctx, party)}'s to manage`);
  const route = to.trim();
  if (route === "reinvest") return reject("bad_route", "rent goes to an account");
  if (route !== "") {
    if (own(ctx.state.entities, route)?.kind !== "account") return reject("not_account", `${labelOf(ctx, route)} isn't an account`);
    if (!api.accountsOf(ctx, party, "worth").includes(route) && !api.accountsOf(ctx, party, "spend").includes(route)) return reject("not_yours", `${labelOf(ctx, route)} isn't ${labelOf(ctx, party)}'s`);
  }
  return routeRent(api, ctx, property, route);
}

/** A rough amount in words: two significant figures, for a mind's summary ("about $410,000"). */
function about(ctx: ReadContext, cents: number): string {
  const abs = Math.abs(cents);
  const step = abs >= 100000 ? Math.pow(10, Math.floor(Math.log10(abs)) - 1) : 100;
  return formatMoney(Math.sign(cents) * Math.round(abs / step) * step, ctx.world.currency);
}

/** A party's investments as their dashboard draws them: what they see, what they can buy, this year's gains, income and tax. */
function investmentsView(api: FinanceApi, ctx: ReadContext, party: EntityId, detail: boolean): InvestmentsView | null {
  const holdings = visibleHoldings(api, ctx, party)
    .map((id) => holdingView(api, ctx, id, detail))
    .filter((h): h is HoldingView => h !== null);
  if (holdings.length === 0 && !api.feature(ctx, party, "investments")) return null;
  const year = dateAt(calendarOf(ctx.world), ctx.state.clock).year;
  const gains = gainsIn(ctx.state, party, year);
  const income = incomeIn(ctx.state, party, year);
  const held = new Set(holdings.map((h) => h.asset.id));
  const market = Object.keys(configAssets(ctx.world))
    .sort()
    .flatMap((id) => {
      const def = readAssetDef(own(configAssets(ctx.world), id));
      const a = def ? assetOf(ctx, id) : null;
      if (!a || held.has(id) || a.class === "property" || a.class === "business_stake") return [];
      if (a.option && (!api.feature(ctx, party, "options") || ctx.state.clock >= a.option.expiry)) return [];
      return [{ asset: id, label: a.label, class: a.class, symbol: a.symbol, price: priceOf(ctx, a) }];
    });
  const tax = detail ? taxEstimate(api, ctx, party) : null;
  return {
    value: holdings.reduce((s, h) => s + h.value, 0),
    cost: holdings.reduce((s, h) => s + h.cost, 0),
    unrealised: holdings.reduce((s, h) => s + h.gain, 0),
    realised: detail ? gains.short + gains.long : 0,
    income: income.dividend + income.interest + income.profit,
    realisedShort: detail ? gains.short : 0,
    realisedLong: detail ? gains.long : 0,
    taxDue: tax ? { cents: tax.cents, at: dateText(ctx.world, tax.at) } : null,
    holdings,
    market,
    accounts: api.accountsOf(ctx, party, "spend").filter((a) => api.traitsOf(ctx, a)?.investment === true),
  };
}

/** Contracts expiring within a week and bonds maturing within a month, for the party's alerts. */
function alertsFor(api: FinanceApi, ctx: ReadContext, party: EntityId): AlertLine[] {
  const out: AlertLine[] = [];
  const day = 1440;
  for (const id of visibleHoldings(api, ctx, party)) {
    const a = assetOf(ctx, strOf(own(ctx.state.entities, id)?.fields.asset));
    if (!a) continue;
    const qty = qtyOf(lotsOf(ctx, id));
    if (a.option && a.option.expiry > ctx.state.clock && a.option.expiry - ctx.state.clock <= 7 * day) out.push({ tone: "warn", text: `${unitsWord(qty, "contract")} of ${a.label} expire ${dateText(ctx.world, a.option.expiry)}.` });
    if (a.bond && a.bond.maturity > ctx.state.clock && a.bond.maturity - ctx.state.clock <= 31 * day) out.push({ tone: "info", text: `${a.label} matures ${dateText(ctx.world, a.bond.maturity)}.` });
  }
  return out;
}

function unitsWord(qty: number, word: string): string {
  return `${Math.round(qty * 10000) / 10000} ${word}${qty === 1 ? "" : "s"}`;
}

/** The holdings module's sentences in a character's money summary, in their own terms. */
function summaryLines(api: FinanceApi, ctx: ReadContext, who: EntityId): string[] {
  const out: string[] = [];
  const invested = holdingsWorth(api, ctx, who).assets;
  if (invested > 0) out.push(`Has about ${about(ctx, invested)} invested.`);
  for (const id of propertyIds(ctx.state)) {
    const share = api.shareOf(ctx.state, id, who);
    if (share <= 0) continue;
    const owed = securedLoans(api, ctx.state, id).reduce((a, l) => a + l.owed, 0);
    const part = share < 100 ? `a ${Math.round(share)}% share of ` : "";
    out.push(`Owns ${part}${labelOf(ctx, id)} (worth ${about(ctx, propertyValue(ctx.state, id))}${owed > 0 ? `; ${about(ctx, owed)} left on the mortgage` : ""}).`);
  }
  const rent = monthlyRent(api, ctx, who);
  if (rent > 0) out.push(`Collects about ${about(ctx, rent)} a month in rent.`);
  for (const id of businessIds(api, ctx)) {
    const share = api.shareOf(ctx.state, id, who);
    if (share <= 0 || id === who) continue;
    out.push(`Owns ${share < 100 ? `${Math.round(share)}% of ` : ""}${labelOf(ctx, id)} (worth about ${about(ctx, Math.round((businessValue(api, ctx, id) * share) / 100))}).`);
  }
  return out;
}

/** The holdings module: everything above, wired into the foundation. */
export function registerAssets(r: FinanceRegistry): void {
  registerMarkets(r);
  registerHoldings(r);
  registerIncome(r);
  registerOptions(r);
  registerGains(r);
  registerProperty(r);
  registerStakes(r);

  r.core.effect({
    type: "economy.route",
    args: ["holding?", "property?", "business?", "to?", "party?"],
    gm: true,
    resolve: (a, ctx) => {
      const party = strOf(a.party) || ctx.world.pov;
      const to = strOf(a.to);
      if (strOf(a.holding) !== "") return setRoute(r.api, ctx, party, strOf(a.holding), to);
      if (strOf(a.property) !== "") return setRentRoute(r.api, ctx, party, strOf(a.property), to);
      if (strOf(a.business) !== "") return setStakeRoute(r.api, ctx, party, strOf(a.business), to);
      return reject("bad_route", "say which holding, property or business");
    },
  });
  r.core.action({
    id: "route_distributions",
    label: "Route dividends, rent or profits",
    pack: "economy",
    params: {
      holding: { type: "ref", ref: "holding", optional: true },
      property: { type: "ref", ref: "property", optional: true },
      business: { type: "ref", ref: "business", optional: true },
      to: { type: "text", label: "To (an account, or reinvest)", optional: true },
    },
    requires: ["level.money >= 3"],
    outcomes: { default: [{ type: "economy.route", args: { party: "self", holding: "=params.holding", property: "=params.property", business: "=params.business", to: "=params.to" } }] },
    duration: "1",
    lexicon: ["reinvest dividends", "send dividends to", "send the rent to"],
    observable: "checks their phone",
  });

  r.worth((ctx, party) => {
    const h = holdingsWorth(r.api, ctx, party);
    const p = propertyWorth(r.api, ctx, party);
    const s = stakeWorth(r.api, ctx, party);
    return { assets: h.assets + p.assets + s.assets, liabilities: 0, lines: [...h.lines, ...p.lines, ...s.lines] };
  });
  r.view((ctx, party, view) => ({
    investments: investmentsView(r.api, ctx, party, view.detail),
    properties: r.api.feature(ctx, party, "property") || visibleProperties(r.api, ctx, party).some((id) => r.api.shareOf(ctx.state, id, party) > 0) ? visibleProperties(r.api, ctx, party).map((id) => propertyView(r.api, ctx, id, party, view.flows)) : [],
    alerts: alertsFor(r.api, ctx, party),
  }));
  r.summary((ctx, who) => summaryLines(r.api, ctx, who));
}
