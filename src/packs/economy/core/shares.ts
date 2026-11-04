// Shares (ORG-SPEC §3.10; DESIGN §27.10): a company may count its owners' stakes in units of share
// classes, which differ only in the votes a unit carries; issuing new units to a buyer, buying units
// back and changing the classes are ownership decisions, which need more than its decision threshold
// (`decide_pct`, half by default) of the votes on the decider's own. Each is one unit: the money, the
// whole owners list written once (units and every share from them, so every reader of `share` stays
// as it was) and the basis events, with its History line. A company that doesn't count units yet
// counts its holders in units (the economy config's `shareUnits`, 1,000 by default) the first time
// one is issued or bought back. A company's Ownership on its page in Orgs is built here: the cap
// table, its classes, its valuation and value per unit, its parents and subsidiaries with the
// figures of those it controls consolidated, the reader's payouts and what they may decide.

import type { EntityId } from "../../../shared/ids";
import type { JsonValue } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import { classesIn, COMMON_CLASS, countedIn, countsUnits, FINANCE_ACTIONS, FINANCE_EVENTS, listingIn, ownersIn, ownersJson, PARTY_KINDS, ROLE_RIGHTS, rowClass, unitsOf, votePcts, withUnitShares, worthShares, type ConsolidatedView, type DistributionRoute, type Owner, type OwnerLine, type OwnerRole, type OwnershipActs, type OwnershipView, type ShareClass, type StructureLink } from "../../../shared/finance";
import { positionIdOf, type OrgPower } from "../../../shared/org";
import { calendarOf, clockAt, dateAt, dayIndexOf } from "../../../engine/calendar";
import { businessIds, mayAct, orgTypeOf } from "../../../engine/org";
import { labelOf, numOf, objOf, optionalQuery, optionalService, own, strOf } from "../../../engine/pack-kit";
import { passMemo } from "../../../engine/read-pass";
import type { EffectContext, ReadContext, Rejection } from "../../../engine/registry";
import { VOTE_PARAM } from "../../../shared/org-motions";
import { asParam, mayAs, moneyWords } from "./acting";
import { reject } from "./assets";
import { businessBooks, operatingAccount } from "./books";
import { isBusiness, mayDraw } from "./business";
import { acquisition, disposal } from "./gains";
import { stockHolders, unit } from "./holdings";
import { hiddenFrom } from "./model";
import type { FinanceApi, FinanceRegistry } from "./module";
import { marketValueOf, orgValue, ownedOrgIds, stakeRoute, valuationOf } from "./stakes";
import { deciderFor, mergeView, windingView } from "./winding";

declare module "../../../engine/registry" {
  interface QueryMap {
    /** Why `party` may not make an ownership decision on `business` (more than its threshold of the votes on their own), in words, `doing` heading it ("Changing the structure of"); null when they may. */
    "economy.decide": (ctx: ReadContext, business: EntityId, party: EntityId, doing: string) => string | null;
    /** Each holder's votes in a company as its decisions count them, in percent of all (`decisionVotes`): its motions' voters. */
    "economy.votes": (ctx: ReadContext, business: EntityId) => Record<EntityId, number>;
  }
  interface ServiceMap {
    /**
     * A decision short of the decider's votes put to a vote instead (ORG-SPEC Phase 5, the orgs
     * pack's): the motion's events, when the action asks for one (`vote`); a refusal when it can't
     * be; null when the action didn't ask, so the decision is refused as before.
     */
    "orgs.put_to_vote": (ctx: ReadContext, ask: { org: EntityId; by: EntityId; party: EntityId; text: string; why: string }) => LedgerEvent[] | Rejection | null;
  }
}

/** Units a company counts its holders in the first time it issues or buys back shares, unless the economy config sets its own (`shareUnits`). */
export const SHARE_UNITS = 1000;

/** How deep the Structure and consolidation follow subsidiaries (WORTH_DEPTH's four holders). */
const STRUCTURE_DEPTH = 4;

type Args = Record<string, JsonValue>;

/** The units a company counts its holders in when it first counts them. */
function unitsToCount(ctx: ReadContext): number {
  const v = numOf(objOf(ctx.world.packs.economy?.config).shareUnits, SHARE_UNITS);
  return Number.isSafeInteger(v) && v > 0 ? v : SHARE_UNITS;
}

/** The percent of its votes an ownership decision on a company needs more than (`decide_pct`, half by default). */
export function decidePct(state: ReadContext["state"], business: EntityId): number {
  return Math.min(100, Math.max(0, numOf(own(state.entities, business)?.fields.decide_pct, 50)));
}

/**
 * Each holder's votes in a company, in percent of all (§3.10). A listed company's public units vote
 * too, at their class's votes (§27.10 Listing): a holder of its stock in the world casts its own on
 * top of any units on the cap table, and the rest of the float counts for the public, which no one
 * casts.
 */
export function votesIn(state: ReadContext["state"], business: EntityId): Record<EntityId, number> {
  const e = own(state.entities, business);
  if (!e) return {};
  const owners = ownersIn(e.fields);
  const classes = classesIn(e.fields);
  const listing = listingIn(e.fields);
  if (!listing || !countsUnits(owners)) return votePcts(owners, classes);
  const each = listedVotes(classes, listing.class);
  const votes: Record<EntityId, number> = {};
  let total = listing.float * each;
  for (const o of owners) {
    const v = ROLE_RIGHTS[o.role].worth ? (o.units ?? 0) * rowClass(o, classes).votes : 0;
    votes[o.party] = (votes[o.party] ?? 0) + v;
    total += v;
  }
  for (const [party, units] of Object.entries(stockHolders(state, listing.asset))) votes[party] = (votes[party] ?? 0) + units * each;
  const out: Record<EntityId, number> = {};
  for (const [party, v] of Object.entries(votes)) out[party] = total > 0 ? (v * 100) / total : 0;
  return out;
}

/** The votes a listed company's public unit carries: its listed class's, else its first class's. */
export function listedVotes(classes: readonly ShareClass[], cls: string | undefined): number {
  return (classes.find((c) => c.id === cls) ?? classes[0] ?? COMMON_CLASS).votes;
}

/**
 * Each holder's votes in a company as its decisions count them (§3.10, ORG-SPEC Phase 5): by its
 * shares (`votesIn`), or, where it counts by members (`vote_by`), one each to the holders of its worth.
 */
export function decisionVotes(ctx: Pick<ReadContext, "state">, business: EntityId): Record<EntityId, number> {
  const e = own(ctx.state.entities, business);
  if (!e || e.fields.vote_by !== "members") return votesIn(ctx.state, business);
  const holders = [...new Set(ownersIn(e.fields).filter((o) => ROLE_RIGHTS[o.role].worth).map((o) => o.party))];
  return Object.fromEntries(holders.map((h) => [h, 100 / holders.length]));
}

/** Why `party` may not make an ownership decision on `business`, `doing` heading the words; null when their votes are enough. */
export function decisionRefusal(ctx: ReadContext, business: EntityId, party: EntityId, doing: string): string | null {
  const need = decidePct(ctx.state, business);
  const have = decisionVotes(ctx, business)[party] ?? 0;
  if (have > need + 1e-9) return null;
  return `${doing} ${labelOf(ctx, business)} needs ${need === 50 ? "more than half the votes" : `more than ${need}% of the votes`}; ${labelOf(ctx, party)} holds ${Math.round(have * 100) / 100}%`;
}

/**
 * Whether `by`, deciding as `party` (themselves, or an organization holder they act for), may make an
 * ownership decision on `business` with `power`: they hold it at `party` when they act for it, `party`
 * holds it at `business`, and `party` holds more than the decision threshold of its votes (§3.10).
 * Short of the votes, an action that asks (`vote`) puts it to a vote instead (`orgs.put_to_vote`: the
 * motion's events, which the effect returns), `what` its words. A motion of the company's that passed
 * carries it out with its holders' votes, and with no `by` (the GM's) anything goes.
 */
export function decision(ctx: ReadContext, by: EntityId, party: EntityId, business: EntityId, power: OrgPower, doing: string, what?: string): LedgerEvent[] | Rejection | null {
  if (by === "") return null;
  const carried = (ctx as Partial<EffectContext>).carried;
  if (carried?.motion !== undefined && carried.org === business) return null;
  if (party !== by) {
    const may = mayAct(ctx, by, party, power);
    if (!may.ok) return reject("not_allowed", may.reason);
  }
  const holds = mayAct(ctx, party, business, power);
  if (!holds.ok) return reject("not_allowed", holds.reason);
  const why = decisionRefusal(ctx, business, party, doing);
  if (why === null) return null;
  return optionalService(ctx, "orgs.put_to_vote")?.(ctx, { org: business, by, party, text: what ?? `${doing} ${labelOf(ctx, business)}`, why }) ?? reject("votes", why);
}

/** The History lines of a decision: the company's, and the organization holder's it was made for. */
export function decided(ctx: ReadContext, business: EntityId, by: EntityId, party: EntityId, text: string, names: readonly EntityId[]): LedgerEvent[] {
  const acted = optionalService(ctx, "orgs.acted");
  if (!acted) return [];
  const named = [...new Set(names.filter((id) => id !== "" && own(ctx.state.entities, id)))];
  const line = (org: EntityId): LedgerEvent[] => acted(ctx, { org, by, power: "shares.manage", text, ...(named.length > 0 ? { names: named } : {}) });
  return [...line(business), ...(party !== by && party !== business && orgTypeOf(ctx, party) !== null ? line(party) : [])];
}

/** A payment's postings stamped with who made it for the organization it was made as (§3.6), as `actAs` stamps them. */
export function stamped(events: readonly LedgerEvent[], by: EntityId, as: EntityId): LedgerEvent[] {
  return by === "" || by === as ? [...events] : events.map((e): LedgerEvent => (e.type === FINANCE_EVENTS.txn && "data" in e ? { ...e, data: { ...e.data, by, as } } : e));
}

/** A company's owners counted in units: as they are when it counts them, else in the units it counts them in first. */
export function counted(api: FinanceApi, ctx: ReadContext, business: EntityId): Owner[] {
  const owners = api.ownersOf(ctx.state, business);
  return countsUnits(owners) ? owners : countedIn(owners, unitsToCount(ctx));
}

/** A price a unit, given or (absent) its value a unit; a total for `units`, the whole value's share where it is worked out. A listed company's value a unit is its market price. */
function priced(api: FinanceApi, ctx: ReadContext, business: EntityId, owners: readonly Owner[], units: number, given: JsonValue | undefined): { each: number; cents: number } | Rejection {
  if (typeof given === "number" && Number.isFinite(given)) {
    const each = Math.round(given);
    return each >= 0 && Number.isSafeInteger(each * units) ? { each, cents: each * units } : reject("bad_amount", "a price is a whole amount");
  }
  const market = marketValueOf(ctx, business);
  if (market) return { each: Math.round(market.price), cents: Math.round(market.price * units) };
  const total = unitsOf(owners);
  if (total <= 0) return reject("bad_amount", `${labelOf(ctx, business)} has no units to value one by: say the price a unit`);
  const value = orgValue(api, ctx, business);
  return { each: Math.round(value / total), cents: Math.round((value * units) / total) };
}

function wholeUnits(v: JsonValue | undefined): number | Rejection {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : reject("bad_amount", "say a whole number of units");
}

function isRejection<T>(v: T | Rejection): v is Rejection {
  return typeof v === "object" && v !== null && "code" in v && "reason" in v;
}

/**
 * Issuing shares (`economy.shares_issue`, §3.10): `units` new units to `to`, who pays `price` a unit
 * (else the value a unit) from their own money (`from`, else as they pay) into the company's
 * operating account; everyone's share diluted by the new units; the buyer's basis; its History line.
 * A buyer that is the deciding organization itself pays as it, by whoever acts for it.
 */
function issueShares(api: FinanceApi, ctx: ReadContext, a: Args): LedgerEvent[] | Rejection {
  const business = strOf(a.business);
  const name = labelOf(ctx, business);
  if (!isBusiness(ctx, business)) return reject("not_business", `${name} isn't a company`);
  const by = strOf(a.by);
  const party = strOf(a.party) || by;
  const to = strOf(a.to);
  if (to === "" || to === business || api.partyKind(ctx, to) === null) return reject("missing_entity", `no one ${labelOf(ctx, to)} to issue shares to`);
  const units = wholeUnits(a.units);
  if (isRejection(units)) return units;
  const denied = decision(ctx, by, party, business, "shares.manage", "Issuing shares in", `Issue ${units} units of ${name} to ${labelOf(ctx, to)}${typeof a.price === "number" ? ` at ${moneyWords(ctx, a.price)} a unit` : " at their value a unit"}`);
  if (denied) return denied;
  const fields = own(ctx.state.entities, business)?.fields ?? {};
  const classes = classesIn(fields);
  const named = strOf(a.class);
  if (named !== "" && !classes.some((c) => c.id === named)) return reject("bad_class", `${name} has no class ${named}: its classes are ${classes.map((c) => c.label).join(", ")}`);
  const owners = counted(api, ctx, business);
  const price = priced(api, ctx, business, owners, units, a.price);
  if (isRejection(price)) return price;
  const row = owners.find((o) => o.party === to && ROLE_RIGHTS[o.role].worth && (named === "" || rowClass(o, classes).id === named));
  const cls = named !== "" ? named : row?.class;
  const next = row ? owners.map((o) => (o === row ? { ...o, units: (o.units ?? 0) + units } : o)) : [...owners, { party: to, role: "owner" as const, units, ...(cls !== undefined && cls !== COMMON_CLASS.id ? { class: cls } : {}) }];
  // An S corporation's holders after the issue, as its taxes allow them (DESIGN §26.3; the taxes module's check).
  const holders = [...new Set(next.filter((o) => ROLE_RIGHTS[o.role].worth && (o.units ?? 0) > 0).map((o) => o.party))];
  const scorp = optionalService(ctx, "economy.scorp_holders")?.(ctx, business, holders) ?? null;
  if (scorp) return scorp;
  const memo = `${units} units of ${name} at ${moneyWords(ctx, price.each)} a unit`;
  const events: LedgerEvent[] = [];
  if (price.cents > 0) {
    const deposit = operatingAccount(api, ctx, business);
    if (!deposit) return reject("no_account", `${name} has no account to take the money`);
    const from = strOf(a.from);
    if (from !== "") {
      const unusable = api.mayUse(ctx, to, from, "from");
      if (unusable) return unusable;
    }
    const paid = api.pay(ctx, { from: from || to, to: business, cents: price.cents, memo: `Bought ${memo}`, deposit, kind: "purchase", category: "investment" });
    if (!Array.isArray(paid)) return paid;
    events.push(...(to === party ? stamped(paid, by, party) : paid));
  }
  return unit([
    ...events,
    { type: "set", entity: business, field: "owners", value: ownersJson(withUnitShares(next)) as unknown as JsonValue },
    acquisition(business, to, price.cents),
    ...decided(ctx, business, by, party, `Issued ${units} units to ${labelOf(ctx, to)} at ${moneyWords(ctx, price.each)} a unit (${moneyWords(ctx, price.cents)})`, [to]),
  ]);
}

/**
 * Buying back (`economy.shares_buy_back`, §3.10): `units` of `from`'s, the company paying `price` a
 * unit (else the value a unit) from its operating account to `from` (`to`, else their deposit
 * account); its owners and every share rewritten; the seller's gain realised; its History line.
 */
function buyBack(api: FinanceApi, ctx: ReadContext, a: Args): LedgerEvent[] | Rejection {
  const business = strOf(a.business);
  const name = labelOf(ctx, business);
  if (!isBusiness(ctx, business)) return reject("not_business", `${name} isn't a company`);
  const by = strOf(a.by);
  const party = strOf(a.party) || by;
  const holder = strOf(a.from);
  const units = wholeUnits(a.units);
  if (isRejection(units)) return units;
  const denied = decision(ctx, by, party, business, "shares.manage", "Buying back shares in", `Buy back ${units} units of ${name} from ${labelOf(ctx, holder)}${typeof a.price === "number" ? ` at ${moneyWords(ctx, a.price)} a unit` : " at their value a unit"}`);
  if (denied) return denied;
  const owners = counted(api, ctx, business);
  const held = unitsOf(owners, holder);
  if (held <= 0) return reject("not_holder", `${labelOf(ctx, holder)} holds no units of ${name}`);
  if (units > held) return reject("declined", `${labelOf(ctx, holder)} holds ${held} units of ${name}, not ${units}`);
  const price = priced(api, ctx, business, owners, units, a.price);
  if (isRejection(price)) return price;
  const memo = `${name} bought back ${units} units at ${moneyWords(ctx, price.each)} a unit`;
  const events: LedgerEvent[] = [];
  if (price.cents > 0) {
    const source = operatingAccount(api, ctx, business);
    if (!source) return reject("no_account", `${name} has no account to pay from`);
    const into = strOf(a.to) || api.depositAccount(ctx, holder);
    if (!into) return reject("no_account", `${labelOf(ctx, holder)} has no account the money could go to`);
    const unusable = api.mayUse(ctx, holder, into, "into");
    if (unusable) return unusable;
    const paid = api.pay(ctx, { from: source, to: holder, cents: price.cents, memo, deposit: into, kind: "purchase", category: "investment" });
    if (!Array.isArray(paid)) return paid;
    events.push(...stamped(paid, by, business));
  }
  let left = units;
  const next = owners.map((o) => {
    if (left <= 0 || o.party !== holder || !ROLE_RIGHTS[o.role].worth) return o;
    const take = Math.min(left, o.units ?? 0);
    left -= take;
    return { ...o, units: (o.units ?? 0) - take };
  });
  return unit([
    ...events,
    disposal(business, holder, (units / held) * 100, price.cents, memo),
    { type: "set", entity: business, field: "owners", value: ownersJson(withUnitShares(next)) as unknown as JsonValue },
    ...decided(ctx, business, by, party, `Bought back ${units} of ${labelOf(ctx, holder)}'s units at ${moneyWords(ctx, price.each)} a unit (${moneyWords(ctx, price.cents)})`, [holder]),
  ]);
}

/**
 * The share classes (`economy.shares_classes`, §3.10), at once: a class added or changed (its label
 * and votes a unit) or removed (its units going to the first class left), and a holder's units moved
 * into it. Classes count only with units, so a company that doesn't count them yet does first.
 */
function setClasses(api: FinanceApi, ctx: ReadContext, a: Args): LedgerEvent[] | Rejection {
  const business = strOf(a.business);
  const name = labelOf(ctx, business);
  if (!isBusiness(ctx, business)) return reject("not_business", `${name} isn't a company`);
  const by = strOf(a.by);
  const party = strOf(a.party) || by;
  const denied = decision(ctx, by, party, business, "shares.manage", "Changing the share classes of", `${a.remove === true ? "Remove" : "Set"} the share class ${strOf(a.label).trim() || strOf(a.class)} of ${name}${a.remove !== true && typeof a.votes === "number" ? ` (${a.votes} votes a unit)` : ""}${strOf(a.holder) !== "" ? `, with ${labelOf(ctx, strOf(a.holder))}'s units in it` : ""}`);
  if (denied) return denied;
  const fields = own(ctx.state.entities, business)?.fields ?? {};
  const before = classesIn(fields);
  const label = strOf(a.label).trim();
  const id = strOf(a.class) || positionIdOf(label);
  if (id === "") return reject("bad_class", "a class needs a name");
  const was = before.find((c) => c.id === id);
  let classes: ShareClass[];
  if (a.remove === true) {
    if (!was) return reject("bad_class", `${name} has no class ${id}`);
    const rest = before.filter((c) => c.id !== id);
    classes = rest.length > 0 ? rest : [COMMON_CLASS];
  } else {
    const votes = typeof a.votes === "number" && Number.isFinite(a.votes) && a.votes >= 0 ? a.votes : (was?.votes ?? 1);
    const one: ShareClass = { id, label: label || was?.label || id.replace(/_/g, " "), votes };
    classes = was ? before.map((c) => (c.id === id ? one : c)) : [...before, one];
  }
  const holder = strOf(a.holder);
  const first = classes[0] ?? COMMON_CLASS;
  const owners = counted(api, ctx, business);
  if (holder !== "" && unitsOf(owners, holder) <= 0) return reject("not_holder", `${labelOf(ctx, holder)} holds no units of ${name}`);
  // Each row in a class that's gone goes to the first left; the holder's, into the class named. Rows of one holder and class merge.
  const moved: Owner[] = [];
  for (const o of owners) {
    const target = ROLE_RIGHTS[o.role].worth && o.party === holder && a.remove !== true ? id : classes.some((c) => c.id === rowClass(o, before).id) ? rowClass(o, before).id : first.id;
    const cls = ROLE_RIGHTS[o.role].worth ? target : o.class;
    const same = moved.find((m) => m.party === o.party && m.role === o.role && ROLE_RIGHTS[o.role].worth && (m.class ?? first.id) === cls);
    if (same) same.units = (same.units ?? 0) + (o.units ?? 0);
    else moved.push({ ...o, ...(cls !== undefined ? { class: cls } : {}) });
  }
  const written = withUnitShares(moved).map((o) => (o.class === COMMON_CLASS.id && classes[0]?.id === COMMON_CLASS.id && classes.length === 1 ? (({ class: _c, ...rest }) => rest)(o) : o));
  const words = a.remove === true ? `Removed the share class ${was?.label ?? id}` : `${was ? "Changed" : "Added"} the share class ${classes.find((c) => c.id === id)?.label ?? id} (${classes.find((c) => c.id === id)?.votes ?? 1} votes a unit)${holder !== "" ? `, with ${labelOf(ctx, holder)}'s units in it` : ""}`;
  return unit([
    { type: "set", entity: business, field: "share_classes", value: classes.map((c) => ({ id: c.id, label: c.label, votes: c.votes })) as unknown as JsonValue },
    { type: "set", entity: business, field: "owners", value: ownersJson(written) as unknown as JsonValue },
    ...decided(ctx, business, by, party, words, holder !== "" ? [holder] : []),
  ]);
}

// ---------------------------------------------------------------- the Ownership view

/** What a company holds in deposit accounts: its cash. */
function cashOf(api: FinanceApi, ctx: ReadContext, business: EntityId): number {
  return api.accountsOf(ctx, business, "worth").reduce((sum, a) => {
    const t = api.traitsOf(ctx, a);
    return t && t.depositRank !== null && !t.liability ? sum + api.balance(ctx.state, a) : sum;
  }, 0);
}

/** A company's profit this calendar year. */
function profitThisYear(api: FinanceApi, ctx: ReadContext, business: EntityId): number {
  const cal = calendarOf(ctx.world);
  const d = dateAt(cal, ctx.state.clock);
  return businessBooks(api, ctx, business, clockAt(cal, dayIndexOf(cal, d.year, 1, 1), 0), ctx.state.clock + 1).profit;
}

/** The companies `parent` holds a share of the worth of, with that share and its votes there, in id order. */
export function subsidiariesOf(api: FinanceApi, ctx: ReadContext, parent: EntityId): { id: EntityId; share: number; votes: number; controlled: boolean }[] {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], `economy.subsidiaries:${parent}`, () =>
    businessIds(ctx).flatMap((id) => {
      if (id === parent) return [];
      const share = api.shareOf(ctx.state, id, parent);
      if (share <= 0) return [];
      const votes = votesIn(ctx.state, id)[parent] ?? 0;
      return [{ id, share, votes, controlled: votes > decidePct(ctx.state, id) + 1e-9 }];
    }),
  );
}

/**
 * A parent with the companies it controls (more than their threshold of their votes, through others
 * too, four deep), worked out when read (§3.10): their cash and this year's profit added in full, and
 * its net worth with each stake in them counted at its share of their own (so consolidated) worth
 * rather than their value, unless that value is set or the market's, which it keeps; invoices between
 * them cancel in profit, and payouts between them are in no company's books. Null when it controls none.
 */
export function consolidated(api: FinanceApi, ctx: ReadContext, parent: EntityId): ConsolidatedView | null {
  const walk = (id: EntityId, seen: ReadonlySet<EntityId>, depth: number): ConsolidatedView => {
    let cash = cashOf(api, ctx, id);
    let profit = profitThisYear(api, ctx, id);
    let netWorth = api.netWorth(ctx, id);
    let companies = 0;
    if (depth < STRUCTURE_DEPTH) {
      for (const child of subsidiariesOf(api, ctx, id)) {
        if (!child.controlled || seen.has(child.id)) continue;
        const c = walk(child.id, new Set([...seen, child.id]), depth + 1);
        cash += c.cash;
        profit += c.profit;
        const value = valuationOf(api, ctx, child.id);
        if (!value.set && !value.market) netWorth += Math.round((c.netWorth * child.share) / 100) - Math.round((value.value * child.share) / 100);
        companies += 1 + c.companies;
      }
    }
    return { cash, profit, netWorth, companies };
  };
  const out = walk(parent, new Set([parent]), 0);
  return out.companies > 0 ? out : null;
}

/** The trusts `holder` holds a role on, with its share of their worth (a beneficiary's) and that role, in id order. */
function heldTrustsOf(api: FinanceApi, ctx: ReadContext, holder: EntityId): { id: EntityId; share: number; role: OwnerRole }[] {
  return ownedOrgIds(api, ctx).flatMap((id) => {
    if (id === holder || api.partyKind(ctx, id) !== "trust") return [];
    const row = api.ownersOf(ctx.state, id).find((o) => o.party === holder);
    return row ? [{ id, share: api.shareOf(ctx.state, id, holder), role: row.role }] : [];
  });
}

/** The Structure's links below a company or a trust (its subsidiaries and the trusts it holds a role on, theirs under them), as `viewer` may see them; figures where values show, each one's net worth beside the value of its shares. */
function childLinks(api: FinanceApi, ctx: ReadContext, parent: EntityId, viewer: EntityId | null, figures: boolean, seen: ReadonlySet<EntityId>, depth: number): StructureLink[] {
  if (depth >= STRUCTURE_DEPTH) return [];
  const below = (id: EntityId): StructureLink[] => childLinks(api, ctx, id, viewer, figures, new Set([...seen, id]), depth + 1);
  const companies = subsidiariesOf(api, ctx, parent).flatMap((s): StructureLink[] => {
    if (seen.has(s.id) || hiddenFrom(ctx, viewer, s.id)) return [];
    return [{ id: s.id, name: labelOf(ctx, s.id), share: s.share, votes: s.votes, controlled: s.controlled, value: figures ? orgValue(api, ctx, s.id) : null, netWorth: figures ? Math.round(api.netWorth(ctx, s.id)) : null, cash: figures ? cashOf(api, ctx, s.id) : null, profit: figures ? profitThisYear(api, ctx, s.id) : null, children: below(s.id) }];
  });
  // A trust is run by its trustees, not by votes: one the holder is a trustee of is theirs to run.
  const trusts = heldTrustsOf(api, ctx, parent).flatMap((t): StructureLink[] => {
    if (seen.has(t.id) || hiddenFrom(ctx, viewer, t.id)) return [];
    return [{ id: t.id, name: labelOf(ctx, t.id), share: t.share, votes: 0, controlled: ROLE_RIGHTS[t.role].manage, value: figures ? orgValue(api, ctx, t.id) : null, netWorth: figures ? Math.round(api.netWorth(ctx, t.id)) : null, cash: figures ? cashOf(api, ctx, t.id) : null, profit: null, children: below(t.id), trust: { role: t.role } }];
  });
  return [...companies, ...trusts];
}

/** Why `viewer` may not use `power` at `business` from Money 3, or null. */
function refusalOf(ctx: ReadContext, viewer: EntityId, business: EntityId, power: OrgPower, level: number): string | null {
  if (level < 3) return `${labelOf(ctx, business)} decides about its shares from Money 3`;
  const may = mayAct(ctx, viewer, business, power);
  return may.ok ? null : may.reason;
}

/** A company's accounts its capital may come from: its own money (accounts it holds a worth share of, not one it is only an authorized user on) that pays, open, unlocked deposit accounts, with their balances. */
function capitalSources(api: FinanceApi, ctx: ReadContext, business: EntityId): OwnershipActs["sources"] {
  const owned = new Set(api.accountsOf(ctx, business, "worth"));
  return api
    .accountsOf(ctx, business, "spend")
    .filter((a) => {
      const t = api.traitsOf(ctx, a);
      return owned.has(a) && t !== null && t.pays && !t.liability && !t.locked && t.depositRank !== null && strOf(own(ctx.state.entities, a)?.fields.status, "open") === "open";
    })
    .map((a) => ({ id: a, name: labelOf(ctx, a), balance: api.money(ctx, api.balance(ctx.state, a)) }));
}

/**
 * A company's Ownership (§4.4) as `viewer` (the player character; null for the GM) may read it: its
 * cap table, with an owner they can't see named "an owner"; its classes and units; from Money 3 its
 * net worth, as its Summary has it (below zero where it owes more than it holds); at Money 4 its
 * valuation, the value of its shares (never below nothing, `floored` where its net worth takes it
 * there), value per unit, each row's value and the figures of its parents and subsidiaries; the
 * reader's role, draw and route, their votes, and what they may do.
 */
export function ownershipView(api: FinanceApi, ctx: ReadContext, business: EntityId, viewer: EntityId | null): OwnershipView {
  const level = ctx.levelOf(business, "money");
  const values = level >= 4;
  const fields = own(ctx.state.entities, business)?.fields ?? {};
  const owners = api.ownersOf(ctx.state, business);
  const classes = classesIn(fields);
  const counting = countsUnits(owners);
  // A listed company's units are its owners' and the public's (§27.10 Listing), and the public's vote at their class's votes.
  const listing = listingIn(fields);
  const total = unitsOf(owners) + (listing?.float ?? 0);
  const totalVotes = owners.reduce((a, o) => a + (ROLE_RIGHTS[o.role].worth ? (o.units ?? 0) * rowClass(o, classes).votes : 0), 0) + (listing ? listing.float * listedVotes(classes, listing.class) : 0);
  const shares = worthShares(owners);
  const valuation = values ? valuationOf(api, ctx, business) : null;
  const lines: OwnerLine[] = owners.map((o) => {
    const worth = ROLE_RIGHTS[o.role].worth;
    const share = counting && worth ? (total > 0 ? ((o.units ?? 0) * 100) / total : 0) : (shares[o.party] ?? 0);
    const hidden = hiddenFrom(ctx, viewer, o.party);
    return {
      party: hidden ? null : o.party,
      name: hidden ? "an owner" : labelOf(ctx, o.party),
      role: o.role,
      share,
      ...(counting && worth ? { units: o.units ?? 0, class: rowClass(o, classes).label, votes: totalVotes > 0 ? ((o.units ?? 0) * rowClass(o, classes).votes * 100) / totalVotes : 0 } : {}),
      ...(valuation && worth ? { value: Math.round((valuation.value * share) / 100) } : {}),
    };
  });
  const parents: StructureLink[] = [...new Set(owners.map((o) => o.party))].flatMap((p) => (orgTypeOf(ctx, p) !== null && !hiddenFrom(ctx, viewer, p) && (shares[p] ?? 0) > 0 ? [{ id: p, name: labelOf(ctx, p), share: api.shareOf(ctx.state, business, p), votes: votesIn(ctx.state, business)[p] ?? 0, controlled: (votesIn(ctx.state, business)[p] ?? 0) > decidePct(ctx.state, business) + 1e-9, value: null, netWorth: null, cash: null, profit: null, children: [] }] : []));
  const routed = viewer !== null && api.shareOf(ctx.state, business, viewer) > 0 ? stakeRoute(ctx, viewer, business) : undefined;
  const route: DistributionRoute | null = routed === undefined ? null : routed === null ? { to: null, reinvest: false } : "reinvest" in routed ? { to: null, reinvest: true } : { to: routed.account, reinvest: false };
  // Its market (§27.10 Listing): the listing, its holders on the market after the cap table's rows, and what the reader may do about it.
  const market = optionalQuery(ctx, "economy.market_view")?.(ctx, business, viewer) ?? null;
  const acts: OwnershipActs | null =
    viewer === null
      ? null
      : {
          decide: refusalOf(ctx, viewer, business, "shares.manage", level) ?? decisionRefusal(ctx, business, viewer, "Deciding about the shares of"),
          restructure: refusalOf(ctx, viewer, business, "org.govern", level) ?? decisionRefusal(ctx, business, viewer, "Changing the structure of"),
          // Short of the votes alone, they may put it to a vote (ORG-SPEC Phase 5).
          vote: refusalOf(ctx, viewer, business, "shares.manage", level) === null && decisionRefusal(ctx, business, viewer, "Deciding about the shares of") !== null,
          voteRestructure: refusalOf(ctx, viewer, business, "org.govern", level) === null && decisionRefusal(ctx, business, viewer, "Changing the structure of") !== null,
          holdings: refusalOf(ctx, viewer, business, "shares.manage", level),
          found: refusalOf(ctx, viewer, business, "org.govern", level),
          sources: capitalSources(api, ctx, business),
        };
  // Winding up and merging (§3.13): the reader's own decision, or one through an organization holding it that they govern; short only of the votes, they may put it to a vote (ORG-SPEC Phase 5).
  const decides = (doing: string): { why: string | null; vote: boolean } => {
    if (viewer === null) return { why: null, vote: false };
    if (level < 3) return { why: `${labelOf(ctx, business)} is wound up or merged from Money 3`, vote: false };
    const d = deciderFor(ctx, viewer, business, "org.govern", doing);
    return "reason" in d ? { why: d.reason, vote: d.code === "votes" } : { why: null, vote: false };
  };
  const winding = decides("Winding up");
  const merging = decides("Merging");
  return {
    structure: strOf(fields.structure, "llc"),
    owners: [...lines, ...(market?.holders ?? [])],
    classes: Array.isArray(fields.share_classes) && fields.share_classes.length > 0 ? classes : null,
    units: counting ? total : null,
    listing: market?.listing ?? null,
    market: market?.acts ?? null,
    decidePct: decidePct(ctx.state, business),
    netWorth: level >= 3 ? Math.round(api.netWorth(ctx, business)) : null,
    valuation: valuation ? { value: valuation.value, set: valuation.set, book: valuation.book, profit: valuation.profit, multiple: valuation.multiple, perUnit: counting && total > 0 ? valuation.value / total : null, floored: valuation.floored === true, ...(valuation.market ? { market: valuation.market } : {}) } : null,
    parents,
    children: childLinks(api, ctx, business, viewer, values, new Set([business]), 0),
    consolidated: values ? consolidated(api, ctx, business) : null,
    role: viewer === null ? null : (owners.find((o) => o.party === viewer)?.role ?? null),
    mayDraw: viewer !== null && mayDraw(api, ctx.state, viewer, business),
    route,
    votes: viewer === null ? 0 : (decisionVotes(ctx, business)[viewer] ?? 0),
    acts,
    winding: windingView(api, ctx, business, viewer, winding.why, winding.vote),
    merge: level >= 3 ? mergeView(api, ctx, business, viewer, merging.why, merging.vote) : null,
  };
}

// ---------------------------------------------------------------- registration

/** Shares (§3.10): issuing, buying back and the classes, as effects the GM and agents may make too, and the actions; the decision query; Ownership on an organization's page. */
export function registerShares(r: FinanceRegistry): void {
  const { api, core } = r;
  core.query("economy.decide", (ctx, business, party, doing) => decisionRefusal(ctx, business, party, doing));
  core.query("economy.votes", (ctx, business) => decisionVotes(ctx, business));
  core.effect({ type: "economy.shares_issue", args: ["business", "to", "units", "price?", "class?", "from?", "party?", "by?"], gm: true, resolve: (a, ctx) => issueShares(api, ctx, a) });
  core.effect({ type: "economy.shares_buy_back", args: ["business", "from", "units", "price?", "to?", "party?", "by?"], gm: true, resolve: (a, ctx) => buyBack(api, ctx, a) });
  core.effect({ type: "economy.shares_classes", args: ["business", "class?", "label?", "votes?", "holder?", "remove?", "party?", "by?"], gm: true, resolve: (a, ctx) => setClasses(api, ctx, a) });
  const as = asParam("shares.manage", "Deciding as: an organization whose shares you manage, only when the input decides for a company it holds shares in; left out, it's your own votes");
  core.action({
    id: FINANCE_ACTIONS.sharesIssue,
    label: "Issue shares",
    description: "Issue new units of a company you control to a buyer, who pays for them into its account.",
    pack: "economy",
    params: { business: { type: "ref", ref: "business", label: "Company" }, to: { type: "ref", of: { kind: [...PARTY_KINDS] }, label: "To" }, units: { type: "number", label: "Units" }, price: { type: "money", optional: true, label: "Price a unit (else its value a unit)" }, class: { type: "text", optional: true, label: "Class (its id)" }, from: { type: "ref", ref: "account", optional: true, label: "Paid from (the buyer's account)" }, as, vote: VOTE_PARAM },
    requires: ["level.money >= 3", "params.units > 0", "may(self, business, 'shares.manage')", mayAs("shares.manage")],
    outcomes: { default: [{ type: "economy.shares_issue", args: { business: "business", to: "to", units: "=params.units", price: "=params.price", class: "=params.class", from: "=params.from", party: "self", by: "actor" } }] },
    duration: "30",
    lexicon: ["issue shares", "sell new shares in the company", "bring in a partner", "let them buy in"],
    observable: "signs share papers",
  });
  core.action({
    id: FINANCE_ACTIONS.sharesBuyBack,
    label: "Buy back shares",
    description: "Have a company you control buy back some of a holder's units, paying them from its account.",
    pack: "economy",
    params: { business: { type: "ref", ref: "business", label: "Company" }, from: { type: "ref", of: { kind: [...PARTY_KINDS] }, label: "From (the holder)" }, units: { type: "number", label: "Units" }, price: { type: "money", optional: true, label: "Price a unit (else its value a unit)" }, as, vote: VOTE_PARAM },
    requires: ["level.money >= 3", "params.units > 0", "may(self, business, 'shares.manage')", mayAs("shares.manage")],
    outcomes: { default: [{ type: "economy.shares_buy_back", args: { business: "business", from: "from", units: "=params.units", price: "=params.price", party: "self", by: "actor" } }] },
    duration: "30",
    lexicon: ["buy back shares", "buy them out", "buy back their stake"],
    observable: "signs share papers",
  });
  core.action({
    id: FINANCE_ACTIONS.sharesClasses,
    label: "Change share classes",
    description: "Add, change or remove a company's share class (the votes a unit carries), and move a holder's units into it.",
    pack: "economy",
    mechanical: true,
    params: { business: { type: "ref", ref: "business", label: "Company" }, label: { type: "text", label: "Class" }, class: { type: "text", optional: true, label: "Its id (else from its name)" }, votes: { type: "number", optional: true, label: "Votes a unit" }, holder: { type: "ref", of: { kind: [...PARTY_KINDS] }, optional: true, label: "Move this holder's units into it" }, remove: { type: "bool", optional: true, label: "Remove it" }, as, vote: VOTE_PARAM },
    requires: ["level.money >= 3", "may(self, business, 'shares.manage')", mayAs("shares.manage")],
    outcomes: { default: [{ type: "economy.shares_classes", args: { business: "business", label: "=params.label", class: "=params.class", votes: "=params.votes", holder: "=params.holder", remove: "=params.remove", party: "self", by: "actor" } }] },
    duration: "2",
    lexicon: ["add a share class", "non-voting shares", "change the votes"],
    observable: "does some paperwork",
  });
  // Ownership on a company's page (§4.4), from Money 1, behind `money.view`.
  core.orgSection({
    id: "ownership",
    label: "Ownership",
    power: "money.view",
    build: (ctx, org, viewer) => (isBusiness(ctx, org) && ctx.levelOf(org, "money") >= 1 ? (ownershipView(api, ctx, org, viewer) as unknown as JsonValue) : null),
  });
}
