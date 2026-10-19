// Holdings (DESIGN §27.3–27.5): positions in assets, held in a brokerage or retirement account or
// directly by their owners, with lots for cost basis. A trade is a posting with the asset's market
// (the outside account `market:<asset>`) and an `economy.lots` event; the lots event's reducer takes
// a sale's units first in, first out and records the gain each owner realised, so the gain is the
// fold's own arithmetic on whatever lots the branch holds. A purchase pays from the account it
// names, else the holding's own account (brokerage cash is cash), else the buyer's deposit account;
// a sale's proceeds land where the player says, else in the holding's account, else the seller's
// deposit account: never simply in the first checking account.

import type { EntityId } from "../../../shared/ids";
import { isRecord, safeKey, type JsonObject, type JsonValue } from "../../../shared/json";
import type { LedgerEvent, PackEvent, PostingLine } from "../../../shared/ledger";
import { ownersIn, ROLE_RIGHTS, worthShares, type DistributionRoute, type HoldingView, type Owner } from "../../../shared/finance";
import { hashParts } from "../../../shared/hash";
import { formatMoney } from "../../../shared/world";
import { labelOf, numOf, objOf, own, strOf } from "../../../engine/pack-kit";
import type { EffectContext, EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import type { WorldState } from "../../../engine/state";
import type { FinanceApi, FinanceRegistry } from "./module";
import { assetDefOf, assetFromDef, assetOf, clockOfDate, dateText, optionDef, optionId, priceOf, reject, type Asset, type AssetBooks } from "./assets";
import { byShare, recordGain } from "./records";
import { intrinsic, QTY_EPSILON, roundQty, takeFifo, YEAR_MINUTES, type OpenLot, type TakenLot } from "./pricing";

/** What an older chat's market priced a unit at before its first step: 100 major units. */
const LEGACY_UNIT_PRICE = 10000;
/** The symbol an older brokerage account held when it named none. */
const LEGACY_SYMBOL = "broad_us_equity_index";

// ---------------------------------------------------------------- reading holdings

/** The account a holding sits in, when it names one that exists. */
export function accountOfHolding(state: Readonly<WorldState>, holding: EntityId): EntityId | null {
  const account = strOf(own(state.entities, holding)?.fields.account);
  return account !== "" && own(state.entities, account) ? account : null;
}

/** A holding's beneficial owners: its account's when it sits in one, else its own list. */
export function holdingOwners(api: Pick<FinanceApi, "ownersOf">, state: Readonly<WorldState>, holding: EntityId): Owner[] {
  const account = accountOfHolding(state, holding);
  return api.ownersOf(state, account ?? holding);
}

/** Every holding entity, by id. */
export function holdingIds(state: Readonly<WorldState>): EntityId[] {
  return Object.keys(state.entities)
    .filter((id) => own(state.entities, id)?.kind === "holding")
    .sort();
}

/**
 * The holding an older chat's account-level units belong to (DESIGN §27.3 older chats): before
 * holdings were rebuilt, buying and selling added to the account's own `units`. The world
 * migration moved the authored units into a holding of the account's symbol, so what an account
 * still carries is what that chat traded, and it counts in that holding until a trade folds it in.
 */
function legacyHolding(state: Readonly<WorldState>, account: EntityId): EntityId | null {
  const units = own(state.entities, account)?.fields.units;
  if (typeof units !== "number" || units === 0) return null;
  const symbol = strOf(own(state.entities, account)?.fields.symbol, LEGACY_SYMBOL);
  return holdingIds(state).find((id) => own(state.entities, id)?.fields.account === account && own(state.entities, id)?.fields.asset === symbol) ?? null;
}

/** Authored or recorded lots: entries with units, their dates read as clock readings (a missing date is the world's start). */
function readLots(world: ReadContext["world"], raw: JsonValue | undefined): OpenLot[] {
  if (!Array.isArray(raw)) return [];
  const out: OpenLot[] = [];
  for (const l of raw) {
    if (!isRecord(l)) continue;
    const qty = typeof l.qty === "number" && Number.isFinite(l.qty) ? l.qty : 0;
    if (qty <= QTY_EPSILON) continue;
    const cost = typeof l.cost === "number" && Number.isFinite(l.cost) ? Math.round(l.cost) : 0;
    out.push({ qty, cost, at: clockOfDate(world, l.at as JsonValue) ?? 0 });
  }
  return out;
}

/** A holding's open lots, oldest first, with an older chat's account-level units counted in. */
export function lotsOf(books: AssetBooks, holding: EntityId): OpenLot[] {
  const e = own(books.state.entities, holding);
  if (!e || e.kind !== "holding") return [];
  const lots = readLots(books.world, e.fields.lots);
  const account = accountOfHolding(books.state, holding);
  if (!account || legacyHolding(books.state, account) !== holding) return lots;
  const units = numOf(own(books.state.entities, account)?.fields.units);
  if (units > 0) return [...lots, { qty: roundQty(units), cost: Math.round(units * LEGACY_UNIT_PRICE), at: 0 }];
  return takeFifo(lots, Math.min(-units, qtyOf(lots)))?.left ?? [];
}

/** Units held across lots. */
export function qtyOf(lots: readonly OpenLot[]): number {
  return roundQty(lots.reduce((a, l) => a + l.qty, 0));
}

/** What a holding's units are worth now, minor units. */
export function holdingValue(books: AssetBooks, holding: EntityId): number {
  const a = assetOf(books, strOf(own(books.state.entities, holding)?.fields.asset));
  return a ? Math.round(qtyOf(lotsOf(books, holding)) * priceOf(books, a)) : 0;
}

/** The holding of `asset` in `account`, or held directly with `party` among its owners. */
export function findHolding(state: Readonly<WorldState>, asset: string, account: EntityId | null, party: EntityId): EntityId | null {
  return (
    holdingIds(state).find((id) => {
      const f = own(state.entities, id)?.fields;
      if (!f || f.asset !== asset) return false;
      return account ? f.account === account : strOf(f.account) === "" && ownersIn(f).some((o) => o.party === party);
    }) ?? null
  );
}

/** Whether `party` may trade a holding: spend rights on its account, or a spending role on its own list. */
export function canTrade(api: FinanceApi, ctx: ReadContext, party: EntityId, holding: EntityId): boolean {
  const account = accountOfHolding(ctx.state, holding);
  if (account) return api.accountsOf(ctx, party, "spend").includes(account);
  return ownersIn(own(ctx.state.entities, holding)?.fields ?? {}).some((o) => o.party === party && ROLE_RIGHTS[o.role].spend);
}

/** Whether `party` sees a holding on their dashboards. */
export function seesHolding(api: FinanceApi, ctx: ReadContext, party: EntityId, holding: EntityId): boolean {
  const account = accountOfHolding(ctx.state, holding);
  if (account) return api.accountsOf(ctx, party, "sees").includes(account);
  return ownersIn(own(ctx.state.entities, holding)?.fields ?? {}).some((o) => o.party === party && ROLE_RIGHTS[o.role].sees);
}

/** A party's share of a holding's worth, percent: their share of its account, else of the holding. */
export function holdingShare(api: FinanceApi, state: Readonly<WorldState>, holding: EntityId, party: EntityId): number {
  return api.shareOf(state, accountOfHolding(state, holding) ?? holding, party);
}

/** Where a holding's distributions go: reinvested, a named account, or (null) its account, else its owner's deposit account. */
export function routeOf(state: Readonly<WorldState>, holding: EntityId): { reinvest: boolean; to: EntityId | null } {
  const route = strOf(own(state.entities, holding)?.fields.route);
  if (route === "reinvest") return { reinvest: true, to: null };
  return { reinvest: false, to: route !== "" && own(state.entities, route)?.kind === "account" ? route : null };
}

/**
 * A route as `viewer` may see it (DESIGN §27.11): reinvested, the usual place, or an account by id
 * when it is one they see; another owner's account shows as `elsewhere`, unnamed.
 */
export function shownRoute(api: FinanceApi, ctx: ReadContext, viewer: EntityId, to: EntityId | null, reinvest: boolean): DistributionRoute {
  if (reinvest) return { to: null, reinvest: true };
  if (to === null) return { to: null, reinvest: false };
  return api.accountsOf(ctx, viewer, "sees").includes(to) ? { to, reinvest: false } : { to: null, reinvest: false, elsewhere: true };
}

// ---------------------------------------------------------------- gains

/** A sale's proceeds over the parts of lots it took, short and long term apart, as each owner's gains. */
function realise(api: Pick<FinanceApi, "ownersOf">, state: WorldState, world: ReadContext["world"], holding: EntityId, taken: readonly TakenLot[], proceeds: number, label: string): void {
  const total = taken.reduce((a, t) => a + t.qty, 0);
  if (total <= 0) return;
  const parts: Record<"short" | "long", { qty: number; proceeds: number; basis: number }> = { short: { qty: 0, proceeds: 0, basis: 0 }, long: { qty: 0, proceeds: 0, basis: 0 } };
  let left = proceeds;
  taken.forEach((t, i) => {
    const p = i === taken.length - 1 ? left : Math.round((proceeds * t.qty) / total);
    left -= p;
    const term = state.clock - t.at >= YEAR_MINUTES ? "long" : "short";
    parts[term].qty += t.qty;
    parts[term].proceeds += p;
    parts[term].basis += t.cost;
  });
  const shares = worthShares(holdingOwners(api, state, holding));
  for (const term of ["short", "long"] as const) {
    const part = parts[term];
    if (part.qty <= 0) continue;
    for (const { party } of byShare(shares, 1)) {
      const pct = shares[party] ?? 0;
      const scale = (n: number): number => Math.round((n * pct) / 100);
      recordGain(state, world, party, { term, gain: scale(part.proceeds - part.basis), proceeds: scale(part.proceeds), basis: scale(part.basis), label, qty: roundQty((part.qty * pct) / 100) });
    }
  }
}

// ---------------------------------------------------------------- the lots event

function str(e: PackEvent, k: string): string {
  return typeof e.data[k] === "string" ? (e.data[k] as string) : "";
}

/** The kinds of change a holding's lots take: each says why the units moved, for the views and gains. */
export const LOT_KINDS = ["buy", "sell", "reinvest", "expire", "redeem", "settle", "exercise", "transfer"] as const;

/**
 * Applies a change of lots: units bought (a new lot at its cost) or taken first in, first out (the
 * proceeds against their cost, realised by the owners), and folds an older chat's account-level
 * units in on the way, so they're never counted twice. Entities are replaced, not written in place:
 * a money step applies its events to a copy of the state that shares entities it hasn't copied.
 */
export function applyLots(api: Pick<FinanceApi, "ownersOf">, state: WorldState, world: ReadContext["world"], tables: ReadContext["tables"], holding: EntityId, qty: number, cents: number, label: string, realised = true): void {
  const e = own(state.entities, holding);
  if (!e) return;
  const books: AssetBooks = { world, state, tables };
  let lots = lotsOf(books, holding);
  const account = accountOfHolding(state, holding);
  if (account && legacyHolding(state, account) === holding) {
    const a = own(state.entities, account);
    if (a) state.entities[account] = { ...a, fields: { ...a.fields, units: 0 } };
  }
  if (qty > 0) lots.push({ qty: roundQty(qty), cost: cents, at: state.clock });
  else {
    const taken = takeFifo(lots, -qty);
    if (!taken) return;
    lots = taken.left;
    if (realised) realise(api, state, world, holding, taken.taken, cents, label);
  }
  state.entities[holding] = { ...e, fields: { ...e.fields, lots: lots.map((l) => ({ qty: l.qty, cost: l.cost, at: l.at })) } };
}

function lotsEvent(api: FinanceApi): EventTypeDef<PackEvent> {
  return {
    type: "economy.lots",
    validate(e, ctx) {
      const holding = str(e, "holding");
      const h = own(ctx.state.entities, holding);
      if (!h || h.kind !== "holding") return reject("missing_holding", `no holding ${labelOf(ctx, holding)}`);
      const qty = e.data.qty;
      const cents = e.data.cents;
      if (typeof qty !== "number" || !Number.isFinite(qty) || Math.abs(qty) <= QTY_EPSILON) return reject("bad_event", "lots change by a number of units");
      if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents < 0) return reject("bad_event", "lots change for a whole amount, nothing or more");
      const held = qtyOf(lotsOf(ctx, holding));
      return qty < 0 && held + qty < -QTY_EPSILON ? reject("declined", `${h.name} holds ${held} units, not ${-qty}`) : null;
    },
    apply: (e, state, ctx) => applyLots(api, state, ctx.world, ctx.tables, str(e, "holding"), numOf(e.data.qty), numOf(e.data.cents), strOf(e.data.label, labelOf(ctx, str(e, "holding")))),
    describe: (e, ctx, viewer) => (viewer ? "" : `${labelOf(ctx, str(e, "holding"))}: ${numOf(e.data.qty) > 0 ? "+" : ""}${numOf(e.data.qty)} units (${strOf(e.data.kind, "trade")}) for ${formatMoney(numOf(e.data.cents), ctx.world.currency)}`),
    touches: (e) => [{ entity: str(e, "holding"), field: "lots" }, ...(str(e, "legacy") !== "" ? [{ entity: str(e, "legacy"), field: "units" }] : [])],
  };
}

/** A change of a holding's lots as an event, naming the account an older chat's units would be folded in from. */
export function lotsChange(state: Readonly<WorldState>, holding: EntityId, qty: number, cents: number, kind: (typeof LOT_KINDS)[number], label: string): LedgerEvent {
  const account = accountOfHolding(state, holding);
  const legacy = account && legacyHolding(state, account) === holding ? account : null;
  return { type: "economy.lots", data: { holding, qty: roundQty(qty), cents, kind, label, ...(legacy ? { legacy } : {}) } };
}

/** Events that make one unit: a rebased view keeps or drops them together. */
export function unit(events: readonly LedgerEvent[]): LedgerEvent[] {
  if (events.length < 2) return [...events];
  const bare = events.map(({ group: _group, ...rest }) => rest);
  const group = `pay:${hashParts(JSON.stringify(bare)).slice(0, 10)}`;
  return bare.map((e) => ({ ...e, group }) as LedgerEvent);
}

// ---------------------------------------------------------------- trading

function isRejection(v: LedgerEvent[] | Rejection): v is Rejection {
  return !Array.isArray(v);
}

/** A count of units as people say it: whole numbers plain, fractions to four places. */
export function unitsText(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** A new holding's id: its account (or owner) and asset, made unique. */
function newHoldingId(state: Readonly<WorldState>, base: string): EntityId {
  const clean = base.replace(/[^\w:.-]/g, "_");
  if (!own(state.entities, clean)) return clean;
  for (let i = 2; i < 1000; i++) if (!own(state.entities, `${clean}:${i}`)) return `${clean}:${i}`;
  return `${clean}:${hashParts(clean, state.clock).slice(0, 6)}`;
}

/** An outside account an asset trades through: purchases pay into it and sales come out of it. */
export function marketOf(api: Pick<FinanceApi, "outside">, asset: string): string {
  return api.outside(`market:${asset}`);
}

export interface Trade {
  side: "buy" | "sell";
  party: EntityId;
  holding?: EntityId;
  asset?: string;
  account?: EntityId;
  qty?: number;
  amount?: number;
  from?: EntityId;
  to?: EntityId;
  option?: { right: "call" | "put"; strike: number; expiry: string };
}

/** The account a sale's proceeds land in: the one named, else the holding's own, else the seller's deposit account. */
function proceedsAccount(api: FinanceApi, ctx: ReadContext, party: EntityId, holding: EntityId, to: EntityId | undefined): EntityId | Rejection {
  const account = accountOfHolding(ctx.state, holding);
  // A retirement account's money stays in it: its own effects are the only way out.
  if (account && api.traitsOf(ctx, account)?.locked && to && to !== account) return reject("locked", `${labelOf(ctx, account)} keeps what its holdings pay; move it out from the account itself`);
  if (to) {
    if (own(ctx.state.entities, to)?.kind !== "account") return reject("not_account", `${labelOf(ctx, to)} isn't an account`);
    if (!api.accountsOf(ctx, party, "worth").includes(to) && !api.accountsOf(ctx, party, "spend").includes(to)) return reject("not_yours", `${labelOf(ctx, to)} isn't ${labelOf(ctx, party)}'s`);
    return to;
  }
  return account ?? api.depositAccount(ctx, party) ?? reject("no_account", `${labelOf(ctx, party)} has no account the money could go to`);
}

/**
 * A buy or a sale (`economy.trade`): its posting with the asset's market, the lots it changes and,
 * for something not held yet, the new holding (and for an option contract not listed yet, its
 * definition), all one unit. Investments must run for the party (options too, for a contract).
 */
export function trade(api: FinanceApi, ctx: EffectContext | ReadContext, t: Trade): LedgerEvent[] | Rejection {
  const { party } = t;
  if (!own(ctx.state.entities, party)) return reject("missing_entity", `no ${labelOf(ctx, party)}`);
  if (!api.feature(ctx, party, "investments")) return reject("level", "investments aren't followed at this money level");
  const events: LedgerEvent[] = [];
  // What is traded, and in which holding.
  let holding = t.holding && own(ctx.state.entities, t.holding)?.kind === "holding" ? t.holding : null;
  if (t.holding && !holding) return reject("missing_holding", `no holding ${labelOf(ctx, t.holding)}`);
  let assetId = holding ? strOf(own(ctx.state.entities, holding)?.fields.asset) : (t.asset ?? "");
  let asset: Asset | null = assetOf(ctx, assetId);
  if (t.option && !holding) {
    if (!api.feature(ctx, party, "options")) return reject("level", "options aren't followed at this money level");
    const def = optionDef(ctx, assetId, t.option.right, t.option.strike, t.option.expiry);
    if (!def) return reject("bad_option", `there's no ${t.option.right} on ${labelOf(ctx, assetId)} at that strike and expiry`);
    assetId = optionId(assetId, t.option.right, t.option.strike, t.option.expiry);
    asset = assetFromDef(ctx, assetId, def);
    if (!assetDefOf(ctx, assetId)) events.push({ type: "economy.mint", data: { asset: assetId, def: def as unknown as JsonObject } });
  }
  if (!asset) return reject("missing_asset", `no asset ${assetId || "named"}`);
  if (asset.option && !api.feature(ctx, party, "options")) return reject("level", "options aren't followed at this money level");
  if (asset.class === "property" || asset.class === "business_stake") return reject("not_traded", `${asset.label} changes hands as a property or a stake, not a trade`);
  const account = holding ? accountOfHolding(ctx.state, holding) : t.account && own(ctx.state.entities, t.account) ? t.account : null;
  if (t.account && !account) return reject("missing_account", `no account ${labelOf(ctx, t.account)}`);
  if (account && !holding) {
    if (!api.traitsOf(ctx, account)?.investment) return reject("not_investment", `${labelOf(ctx, account)} doesn't hold investments`);
    if (!api.accountsOf(ctx, party, "spend").includes(account)) return reject("not_yours", `${labelOf(ctx, account)} isn't ${labelOf(ctx, party)}'s to trade in`);
  }
  holding ??= findHolding(ctx.state, assetId, account, party);
  if (holding && !canTrade(api, ctx, party, holding)) return reject("not_yours", `${labelOf(ctx, holding)} isn't ${labelOf(ctx, party)}'s to trade`);
  if (asset.option && ctx.state.clock >= asset.option.expiry) return reject("expired", `${asset.label} has expired`);
  if (asset.bond && ctx.state.clock >= asset.bond.maturity) return reject("matured", `${asset.label} has matured`);
  const price = priceOf(ctx, asset);
  if (!(price > 0)) return reject("no_price", `${asset.label} has no price to trade at`);
  const whole = asset.option !== null;
  const held = holding ? qtyOf(lotsOf(ctx, holding)) : 0;
  const money = (c: number): string => formatMoney(c, ctx.world.currency);

  if (t.side === "buy") {
    const raw = typeof t.qty === "number" && t.qty > 0 ? t.qty : typeof t.amount === "number" && t.amount > 0 ? t.amount / price : 0;
    const qty = whole ? Math.floor(raw + 1e-9) : roundQty(raw);
    if (!(qty > QTY_EPSILON)) return reject("bad_amount", whole ? `${money(Math.round(t.amount ?? 0))} buys no whole contract at ${money(Math.round(price))}` : "say how much to buy");
    const cents = Math.round(qty * price);
    if (cents <= 0) return reject("bad_amount", "say how much to buy");
    let source: EntityId | null;
    if (t.from) {
      if (!api.accountsOf(ctx, party, "spend").includes(t.from)) return reject("not_yours", `${labelOf(ctx, t.from)} isn't ${labelOf(ctx, party)}'s to pay from`);
      source = t.from;
    } else source = account ?? api.depositAccount(ctx, party);
    if (!source) return reject("no_account", `${labelOf(ctx, party)} has no account to pay from`);
    const spawned = !holding;
    if (!holding) {
      holding = newHoldingId(ctx.state, `${account ?? party}:${assetId}`);
      events.push({ type: "spawn", entity: { id: holding, kind: "holding", name: asset.symbol ? `${asset.symbol}${account ? ` in ${labelOf(ctx, account)}` : ""}` : asset.label, tier: "background", fields: { asset: assetId, lots: [], ...(account ? { account } : { owners: [{ party, role: "owner" }] }) }, relations: [] } });
    }
    const label = `Bought ${unitsText(qty)} ${asset.symbol ?? asset.label}`;
    const lines: PostingLine[] = [
      { account: source, amount: -cents },
      { account: marketOf(api, assetId), amount: cents },
    ];
    const posted = api.post(ctx, lines, { memo: label, kind: "purchase", category: "investment" });
    if (isRejection(posted)) return posted;
    // A new holding has no older units to fold in; an existing one names its account's, if any.
    const lots: LedgerEvent = spawned ? { type: "economy.lots", data: { holding, qty, cents, kind: "buy", label } } : lotsChange(ctx.state, holding, qty, cents, "buy", label);
    return unit([...events, ...posted, lots]);
  }

  if (!holding || held <= QTY_EPSILON) return reject("nothing_held", `${labelOf(ctx, party)} holds no ${asset.label}`);
  const wanted = typeof t.qty === "number" && t.qty > 0 ? t.qty : typeof t.amount === "number" && t.amount > 0 ? t.amount / price : held;
  const qty = whole ? Math.min(held, Math.floor(wanted + 1e-9)) : Math.min(held, roundQty(wanted));
  if (!(qty > QTY_EPSILON)) return reject("bad_amount", "say how much to sell");
  if (typeof t.qty === "number" && t.qty > held + QTY_EPSILON) return reject("declined", `${labelOf(ctx, holding)} holds ${unitsText(held)}, not ${unitsText(t.qty)}`);
  const cents = Math.round(qty * price);
  const dest = proceedsAccount(api, ctx, party, holding, t.to);
  if (typeof dest !== "string") return dest;
  const label = `Sold ${unitsText(qty)} ${asset.symbol ?? asset.label}`;
  const lines: PostingLine[] = [
    { account: marketOf(api, assetId), amount: -cents },
    { account: dest, amount: cents },
  ];
  const posted = cents > 0 ? api.post(ctx, lines, { memo: label, kind: "sale", category: "investment" }) : [];
  if (isRejection(posted)) return posted;
  return unit([...posted, lotsChange(ctx.state, holding, -qty, cents, "sell", label)]);
}

/** Where a holding's distributions go (`route_distributions`): reinvested, an account of the owner's, or back to the default. */
export function setRoute(api: FinanceApi, ctx: ReadContext, party: EntityId, holding: EntityId, to: string): LedgerEvent[] | Rejection {
  if (own(ctx.state.entities, holding)?.kind !== "holding") return reject("missing_holding", `no holding ${labelOf(ctx, holding)}`);
  if (!canTrade(api, ctx, party, holding)) return reject("not_yours", `${labelOf(ctx, holding)} isn't ${labelOf(ctx, party)}'s to manage`);
  const route = to.trim();
  if (route !== "" && route !== "reinvest") {
    if (own(ctx.state.entities, route)?.kind !== "account") return reject("not_account", `${labelOf(ctx, route)} isn't an account`);
    const account = accountOfHolding(ctx.state, holding);
    if (account && api.traitsOf(ctx, account)?.locked && route !== account) return reject("locked", `${labelOf(ctx, account)} keeps what its holdings pay`);
    if (!api.accountsOf(ctx, party, "worth").includes(route) && !api.accountsOf(ctx, party, "spend").includes(route)) return reject("not_yours", `${labelOf(ctx, route)} isn't ${labelOf(ctx, party)}'s`);
  }
  if (strOf(own(ctx.state.entities, holding)?.fields.route) === route) return [];
  return [{ type: "set", entity: holding, field: "route", value: route }];
}

// ---------------------------------------------------------------- views and worth

/** A holding as `viewer`'s dashboard draws it; lots and gains only where cost basis is followed. */
export function holdingView(api: FinanceApi, ctx: ReadContext, holding: EntityId, detail: boolean, viewer: EntityId): HoldingView | null {
  const e = own(ctx.state.entities, holding);
  const a = assetOf(ctx, strOf(e?.fields.asset));
  if (!e || !a) return null;
  const lots = lotsOf(ctx, holding);
  const qty = qtyOf(lots);
  const price = priceOf(ctx, a);
  const value = Math.round(qty * price);
  const cost = lots.reduce((s, l) => s + l.cost, 0);
  const under = a.option ? assetOf(ctx, a.option.underlying) : null;
  const route = routeOf(ctx.state, holding);
  return {
    id: holding,
    account: accountOfHolding(ctx.state, holding),
    asset: { id: a.id, label: a.label, class: a.class, symbol: a.symbol },
    qty,
    price,
    value,
    cost: detail ? cost : 0,
    gain: detail ? value - cost : 0,
    lots: detail ? lots.map((l) => ({ qty: l.qty, cost: l.cost, at: dateText(ctx.world, l.at), gain: Math.round(l.qty * price) - l.cost, term: ctx.state.clock - l.at >= YEAR_MINUTES ? "long" : "short" })) : [],
    option: a.option && under ? { right: a.option.right, underlying: under.label, strike: a.option.strike, expiry: dateText(ctx.world, a.option.expiry), inTheMoney: intrinsic(a.option.right, priceOf(ctx, under), a.option.strike) > 0 } : null,
    route: a.pays > 0 || a.bond ? shownRoute(api, ctx, viewer, route.to, route.reinvest) : null,
  };
}

/** The holdings a party sees, with units left, by id. */
export function visibleHoldings(api: FinanceApi, ctx: ReadContext, party: EntityId): EntityId[] {
  return holdingIds(ctx.state).filter((id) => seesHolding(api, ctx, party, id) && qtyOf(lotsOf(ctx, id)) > QTY_EPSILON);
}

/** A party's share of every holding's market value, with a line per holding. */
export function holdingsWorth(api: FinanceApi, ctx: ReadContext, party: EntityId): { assets: number; lines: { label: string; cents: number }[] } {
  const lines: { label: string; cents: number }[] = [];
  let assets = 0;
  for (const id of holdingIds(ctx.state)) {
    const share = holdingShare(api, ctx.state, id, party);
    if (share <= 0) continue;
    const cents = Math.round((holdingValue(ctx, id) * share) / 100);
    if (cents === 0) continue;
    assets += cents;
    lines.push({ label: labelOf(ctx, id), cents });
  }
  return { assets, lines };
}

/** A trade's arguments as an action or a GM passes them. */
export function tradeArgs(a: Record<string, JsonValue>, ctx: ReadContext): Trade {
  const n = (k: string): number | undefined => (typeof a[k] === "number" && Number.isFinite(a[k]) ? (a[k] as number) : undefined);
  const s = (k: string): string | undefined => (typeof a[k] === "string" && a[k] !== "" ? (a[k] as string) : undefined);
  const right = s("right");
  const strike = n("strike");
  const expiry = s("expiry");
  const qty = n("qty");
  const amount = n("amount");
  const holding = s("holding");
  const asset = s("asset");
  const account = s("account");
  const from = s("from");
  const to = s("to");
  return {
    side: a.side === "sell" ? "sell" : "buy",
    party: s("party") ?? ctx.world.pov,
    ...(holding ? { holding } : {}),
    ...(asset ? { asset } : {}),
    ...(account ? { account } : {}),
    ...(qty !== undefined ? { qty } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...((right === "call" || right === "put") && strike !== undefined && expiry ? { option: { right, strike, expiry } } : {}),
  };
}

/** Holdings (DESIGN §27.3–27.5): the lots event and trading. */
export function registerHoldings(r: FinanceRegistry): void {
  r.core.event(lotsEvent(r.api));
  r.core.effect({
    type: "economy.trade",
    args: ["side?", "party?", "holding?", "asset?", "account?", "qty?", "amount?", "from?", "to?", "right?", "strike?", "expiry?"],
    resolve: (a, ctx) => trade(r.api, ctx, tradeArgs(a, ctx)),
  });
  r.core.action({
    id: "trade",
    label: "Buy or sell investments",
    pack: "economy",
    params: {
      side: { type: "text", label: "Buy or sell", optional: true },
      holding: { type: "ref", ref: "holding", optional: true },
      asset: { type: "text", label: "Asset", optional: true },
      account: { type: "ref", ref: "account", label: "Held in", optional: true },
      qty: { type: "number", label: "Units", optional: true },
      amount: { type: "money", label: "Amount", optional: true },
      from: { type: "ref", ref: "account", label: "Pay from", optional: true },
      to: { type: "ref", ref: "account", label: "Proceeds to", optional: true },
      right: { type: "text", label: "Call or put", optional: true },
      strike: { type: "money", label: "Strike", optional: true },
      expiry: { type: "text", label: "Expiry (YYYY-MM-DD)", optional: true },
    },
    requires: ["money_feature('investments', self)"],
    outcomes: { default: [{ type: "economy.trade", args: { party: "self", side: "=params.side", holding: "=params.holding", asset: "=params.asset", account: "=params.account", qty: "=params.qty", amount: "=params.amount", from: "=params.from", to: "=params.to", right: "=params.right", strike: "=params.strike", expiry: "=params.expiry" } }] },
    duration: "2",
    lexicon: ["invest", "buy stocks", "buy shares", "sell stocks", "sell shares", "cash out", "buy an option"],
    observable: "checks their phone",
  });
  r.core.formula("holding_value", (ctx, id) => holdingValue(ctx, String(id ?? "")));
  r.core.formula("holding_units", (ctx, id) => qtyOf(lotsOf(ctx, String(id ?? ""))));
  r.core.lint({
    code: "economy.holdings",
    check(world) {
      const issues = [];
      const assets = objOf(objOf(world.packs.economy?.config).assets);
      for (const e of Object.values(world.entities)) {
        if (e.kind !== "holding") continue;
        const asset = strOf(e.fields.asset);
        if (!own(assets, asset)) issues.push({ severity: "error" as const, code: "economy.holdings", message: `Holding ${e.name} names asset "${asset}", which the economy's assets don't list.`, path: `entities.${e.id}.fields.asset` });
        const account = strOf(e.fields.account);
        if (account !== "" && own(world.entities, account)?.kind !== "account") issues.push({ severity: "error" as const, code: "economy.holdings", message: `Holding ${e.name} sits in ${account}, which isn't an account.`, path: `entities.${e.id}.fields.account` });
        if (account === "" && ownersIn(e.fields).length === 0) issues.push({ severity: "error" as const, code: "economy.holdings", message: `Holding ${e.name} sits in no account and has no owners.`, path: `entities.${e.id}.fields.owners` });
        if (e.fields.lots !== undefined && !Array.isArray(e.fields.lots)) issues.push({ severity: "error" as const, code: "economy.holdings", message: `Holding ${e.name}'s lots are a list of {qty, cost, at}.`, path: `entities.${e.id}.fields.lots` });
        const route = strOf(e.fields.route);
        if (route !== "" && route !== "reinvest" && own(world.entities, route)?.kind !== "account") issues.push({ severity: "warning" as const, code: "economy.holdings", message: `Holding ${e.name} routes its payouts to ${route}, which isn't an account; they go to its account instead.`, path: `entities.${e.id}.fields.route` });
      }
      return issues;
    },
  });
}
