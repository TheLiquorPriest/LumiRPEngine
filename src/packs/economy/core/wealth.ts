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
import { labelOf, optionalQuery, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import type { FinanceApi, FinanceRegistry } from "./module";
import { assetOf, configAssets, dateText, listedAssets, priceOf, readAssetDef, registerMarkets, reject } from "./assets";
import { indexView } from "./history";
import { registerGains, taxEstimate } from "./gains";
import { holdingsWorth, holdingView, lotsOf, qtyOf, registerHoldings, setRoute, visibleHoldings } from "./holdings";
import { registerIncome } from "./income";
import { hiddenFrom } from "./model";
import { registerOptions } from "./options";
import { monthlyRent, propertyIds, propertyValue, propertyView, propertyWorth, registerProperty, routeRent, securedLoans, visibleProperties } from "./property";
import { gainsIn, incomeIn } from "./records";
import { businessIds, registerStakes, setStakeRoute, stakeWorth, valuationOf } from "./stakes";
import { actAs, asParam } from "./acting";
import { say } from "../../../engine/lines";

/** Where a property's rent lands (`economy.route` with a property): an account of the owner's, or back to the owners' accounts. */
function setRentRoute(api: FinanceApi, ctx: ReadContext, party: EntityId, property: EntityId, to: string): LedgerEvent[] | Rejection {
  if (own(ctx.state.entities, property)?.kind !== "property") return reject("missing_property", say("why_no_property_property", { property: labelOf(ctx, property) }));
  if (!api.ownersOf(ctx.state, property).some((o) => o.party === party && (o.role === "owner" || o.role === "joint" || o.role === "trustee" || o.role === "custodian"))) return reject("not_yours", say("why_holding_isnt_party_s_to_manage", { holding: labelOf(ctx, property), party: labelOf(ctx, party) }));
  const route = to.trim();
  if (route === "reinvest") return reject("bad_route", say("why_rent_goes_to_an_account"));
  if (route !== "") {
    const unusable = api.mayUse(ctx, party, route, "into");
    if (unusable) return unusable;
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
    .map((id) => holdingView(api, ctx, id, detail, party))
    .filter((h): h is HoldingView => h !== null);
  if (holdings.length === 0 && !api.feature(ctx, party, "investments")) return null;
  const year = dateAt(calendarOf(ctx.world), ctx.state.clock).year;
  const gains = gainsIn(ctx.state, party, year);
  const income = incomeIn(ctx.state, party, year);
  const held = new Set(holdings.map((h) => h.asset.id));
  // The world's assets, and every listed company's stock the party can see (§27.10 Listing): a company hidden from them names nothing, not even its ticker.
  const listed = listedAssets(ctx);
  const market = [...new Set([...Object.keys(configAssets(ctx.world)), ...listed.keys()])]
    .sort()
    .flatMap((id) => {
      const def = listed.has(id) && !own(configAssets(ctx.world), id) ? true : readAssetDef(own(configAssets(ctx.world), id));
      const a = def ? assetOf(ctx, id) : null;
      if (!a || held.has(id) || listed.get(id) === party || a.class === "property" || a.class === "business_stake") return [];
      const company = listed.get(id);
      if (company !== undefined && !own(configAssets(ctx.world), id) && hiddenFrom(ctx, party, company)) return [];
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
    index: indexView(ctx),
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
    if (a.option && a.option.expiry > ctx.state.clock && a.option.expiry - ctx.state.clock <= 7 * day) out.push({ tone: "warn", text: say("feed_contract_of_label_expire_expiry", { contract: unitsWord(qty, "contract"), label: a.label, expiry: dateText(ctx.world, a.option.expiry) }) });
    if (a.bond && a.bond.maturity > ctx.state.clock && a.bond.maturity - ctx.state.clock <= 31 * day) out.push({ tone: "info", text: say("fin_label_matures_maturity", { label: a.label, maturity: dateText(ctx.world, a.bond.maturity) }) });
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
  if (invested > 0) out.push(say("feed_has_about_invested_invested", { invested: about(ctx, invested) }));
  for (const id of propertyIds(ctx.state)) {
    const share = api.shareOf(ctx.state, id, who);
    if (share <= 0) continue;
    const owed = securedLoans(api, ctx.state, id).reduce((a, l) => a + l.owed, 0);
    out.push(say("feed_owns_part_id_worth_id2_owed_left", { pct: share < 100 ? Math.round(share) : undefined, id: labelOf(ctx, id), id2: about(ctx, propertyValue(ctx.state, id)), owed: about(ctx, owed), if_owed: owed > 0 }));
  }
  const rent = monthlyRent(api, ctx, who);
  if (rent > 0) out.push(say("feed_collects_about_rent_a_month_in_rent", { rent: about(ctx, rent) }));
  for (const id of businessIds(api, ctx)) {
    const share = api.shareOf(ctx.state, id, who);
    if (share <= 0 || id === who) continue;
    // What the shares are worth, never below nothing (limited liability): one whose net worth is below zero says so.
    const value = valuationOf(api, ctx, id);
    out.push(say("feed_owns_share_of_id_the_shares_worth", { share: Math.round(share), id: labelOf(ctx, id), share2: about(ctx, Math.round((value.value * share) / 100)), if_share: share < 100, if_floored: !!(value.floored) }));
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

  // Routed `as` an organization (ORG-SPEC §3.6): its rent by someone who manages its property (`property.manage`), its dividends and profits by someone who manages its money (`money.manage`).
  r.core.effect({
    type: "economy.route",
    args: ["holding?", "property?", "business?", "to?", "party?", "by?"],
    gm: true,
    resolve: (a, ctx) => {
      const party = strOf(a.party) || ctx.world.pov;
      const to = strOf(a.to);
      const from = strOf(a.holding) || strOf(a.property) || strOf(a.business);
      const where = to === "" ? say("fin_back_to_its_owners") : to === "reinvest" ? say("fin_to_be_reinvested") : `to ${labelOf(ctx, to)}`;
      const what = strOf(a.property) !== "" ? "rent" : strOf(a.business) !== "" ? "profits" : "dividends";
      return actAs(ctx, { by: strOf(a.by), party, power: strOf(a.property) !== "" ? "property.manage" : "money.manage", line: () => say("org_log_sent_from_s_what_where", { from: labelOf(ctx, from), what: what, where: where }) }, () => {
        if (strOf(a.holding) !== "") return setRoute(r.api, ctx, party, strOf(a.holding), to);
        if (strOf(a.property) !== "") return setRentRoute(r.api, ctx, party, strOf(a.property), to);
        if (strOf(a.business) !== "") return setStakeRoute(r.api, ctx, party, strOf(a.business), to);
        return reject("bad_route", say("why_say_which_holding_property_or_business"));
      });
    },
  });
  r.core.action({
    id: "route_distributions",
    pack: "economy",
    mechanical: true,
    params: {
      holding: { type: "ref", ref: "holding", optional: true },
      property: { type: "ref", ref: "property", optional: true },
      business: { type: "ref", ref: "business", optional: true },
      to: { type: "text", optional: true },
      as: asParam("money.manage", "param_routing_as"),
    },
    requires: ["level.money >= 3", "params.as == null or may(actor, params.as, params.property == null ? 'money.manage' : 'property.manage')"],
    outcomes: { default: [{ type: "economy.route", args: { party: "self", holding: "=params.holding", property: "=params.property", business: "=params.business", to: "=params.to", by: "actor" } }] },
    duration: "1",
    lexicon: ["reinvest dividends", "send dividends to", "send the rent to"],
    observable: "checks their phone",
  });

  r.worth((ctx, party) => {
    const h = holdingsWorth(r.api, ctx, party);
    const p = propertyWorth(r.api, ctx, party);
    const s = stakeWorth(r.api, ctx, party);
    // Vehicles are worth what they'd sell for (the vehicles pack's values), so a car loan isn't counted against nothing; each line is marked, for Assets' vehicles row.
    const v = (optionalQuery(ctx, "vehicles.values")?.(ctx) ?? []).flatMap((x) => {
      const cents = Math.round((x.cents * r.api.shareOf(ctx.state, x.vehicle, party)) / 100);
      return cents > 0 ? [{ label: labelOf(ctx, x.vehicle), cents, vehicle: true as const }] : [];
    });
    return { assets: h.assets + p.assets + s.assets + v.reduce((a, l) => a + l.cents, 0), liabilities: 0, lines: [...h.lines, ...p.lines, ...s.lines, ...v] };
  });
  r.view((ctx, party, view) => ({
    investments: investmentsView(r.api, ctx, party, view.detail),
    properties: r.api.feature(ctx, party, "property") || visibleProperties(r.api, ctx, party).some((id) => r.api.shareOf(ctx.state, id, party) > 0) ? visibleProperties(r.api, ctx, party).map((id) => propertyView(r.api, ctx, id, party, view.flows)) : [],
    alerts: alertsFor(r.api, ctx, party),
  }));
  r.summary((ctx, who) => summaryLines(r.api, ctx, who));
}
