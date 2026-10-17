// The Money panel's view model (`economy.money`), shown at the POV's Money level: a band at 1;
// cash plus one account at 2; every account with cards and bills at 3; APR, limits and dues at 4.
// Everyone else's money, for the GM view (`economy.people_money`), follows the same levels.

import type { EntityId } from "../../../shared/ids";
import type { JsonValue } from "../../../shared/json";
import type { GmMoney } from "../../../shared/state-view";
import type { ReadContext } from "../../../engine/registry";
import { calendarOf, formatClock, monthName, weekdayName } from "../../../engine/calendar";
import { isMaterialized } from "../../../engine/materialize";
import { numOf, objOf, sliceOf, strOf, own } from "../../../engine/pack-kit";
import { kindIs } from "../../../engine/scope";
import { accountsOf, accountType, balance, holdingsValue, wealthBand, wealthOf, type AccountType } from "./model";

export interface MoneyAccount {
  id: EntityId;
  name: string;
  kind: AccountType;
  /** Balance from the holder's side: negative on a card or loan means money owed. Brokerage: cash plus holdings. */
  cents: number;
  limitCents?: number;
  aprPct?: number;
  due?: { label: string; cents: number };
}

export interface MoneyView {
  level: number;
  band: string | null;
  netWorthCents: number | null;
  /** What the HUD shows: the band at level 1, cash in cents from level 2. */
  cash: { band: string } | { cents: number } | null;
  accounts: MoneyAccount[];
  recent: { at: string; memo: string; cents: number; account: string }[];
  upcoming: { at: string; label: string; cents: number }[];
}

/**
 * An account's balance as a view shows it. Until its holder's money is materialized, the authored
 * opening amount it will start from is its representation (DESIGN §9.2): the materialization posts
 * exactly that amount, so the figure doesn't jump when a view or an action opens the accounts, and a
 * materialize write held during a generation shows the same amounts in the meantime.
 */
function shownCents(ctx: ReadContext, account: EntityId, opened: boolean): number {
  return balance(ctx.state, account) + holdingsValue(ctx.state, account) + (opened ? 0 : Math.round(numOf(own(ctx.state.entities, account)?.fields.opening)));
}

export function buildMoneyView(ctx: ReadContext): MoneyView {
  const pov = ctx.world.pov;
  const level = ctx.levelOf(pov, "money");
  const cal = calendarOf(ctx.world);
  const mine = accountsOf(ctx.state, pov);
  const opened = mine.length === 0 || isMaterialized(ctx.state, pov, "money");
  const cents = (account: EntityId): number => shownCents(ctx, account, opened);
  const worth = mine.reduce((sum, account) => sum + cents(account), 0);
  const band = level >= 1 ? (mine.length > 0 ? wealthBand(worth) : wealthOf(ctx.state, pov)) : null;
  if (level === 0) return { level, band: null, netWorthCents: null, cash: null, accounts: [], recent: [], upcoming: [] };
  if (level === 1 || mine.length === 0) return { level, band, netWorthCents: null, cash: band ? { band } : null, accounts: [], recent: [], upcoming: [] };
  const firstChecking = mine.find((id) => accountType(ctx.state, id) === "checking");
  const shown = level >= 3 ? mine : mine.filter((id) => accountType(ctx.state, id) === "cash" || id === firstChecking);
  const statements = objOf(sliceOf(ctx.state, "economy").cards);
  const accounts: MoneyAccount[] = shown.map((id) => {
    const e = own(ctx.state.entities, id);
    const kind = accountType(ctx.state, id) ?? "checking";
    const a: MoneyAccount = { id, name: e?.name ?? id, kind, cents: cents(id) };
    if (level >= 3 && kind === "card" && typeof e?.fields.limit === "number") a.limitCents = e.fields.limit;
    if (level >= 4 && typeof e?.fields.apr_pct === "number") a.aprPct = e.fields.apr_pct;
    const st = objOf(statements[id]);
    if (level >= 4 && Object.keys(st).length > 0 && numOf(st.paid) < numOf(st.minimum)) a.due = { label: `Minimum due ${formatClock(cal, numOf(st.due)).split(",")[0] ?? ""}`, cents: numOf(st.minimum) - numOf(st.paid) };
    return a;
  });
  const rawHistory = sliceOf(ctx.state, "economy").history;
  const recent = recentLines(ctx, Array.isArray(rawHistory) ? rawHistory : [], new Set(shown), 10);
  const upcoming: MoneyView["upcoming"] = level >= 3 ? billsOf(ctx, pov).map(({ payee: _payee, ...bill }) => bill) : [];
  return {
    level,
    band,
    netWorthCents: worth,
    cash: { cents: mine.filter((id) => accountType(ctx.state, id) === "cash").reduce((a, id) => a + cents(id), 0) },
    accounts,
    recent,
    upcoming,
  };
}

/** The newest lines of a history (entries `{at, memo, lines}`) that touch the accounts shown, newest first, at most `max`. */
function recentLines(ctx: ReadContext, history: readonly JsonValue[], shown: ReadonlySet<EntityId>, max: number): MoneyView["recent"] {
  const cal = calendarOf(ctx.world);
  const out: MoneyView["recent"] = [];
  for (let i = history.length - 1; i >= 0 && out.length < max; i--) {
    const h = objOf(history[i]);
    const lines = Array.isArray(h.lines) ? h.lines.map((l) => objOf(l)) : [];
    for (const l of lines) {
      const account = strOf(l.account);
      if (!shown.has(account)) continue;
      out.push({ at: formatClock(cal, numOf(h.at)), memo: strOf(h.memo), cents: numOf(l.amount), account: own(ctx.state.entities, account)?.name ?? account });
    }
  }
  return out;
}

/** A person's recurring bills: when ("day 1", "every Friday", "March 3"), the label, the amount as money going out, and who is paid. */
function billsOf(ctx: ReadContext, who: EntityId): GmMoney["bills"] {
  const cal = calendarOf(ctx.world);
  const bills = own(ctx.state.entities, who)?.fields.bills;
  if (!Array.isArray(bills)) return [];
  return bills.map((raw) => {
    const b = objOf(raw);
    const every = strOf(b.every, "month");
    const at = every === "week" ? `every ${typeof b.day === "string" ? b.day : weekdayName(cal, numOf(b.day, 1))}` : every === "year" ? `${monthName(cal, numOf(b.month, 1))} ${numOf(b.day, 1)}` : `day ${numOf(b.day, 1)}`;
    const payee = strOf(b.payee);
    return { at, label: strOf(b.label, "Bill"), cents: -Math.round(numOf(b.amountCents)), payee: own(ctx.state.entities, payee)?.name ?? payee };
  });
}

/**
 * Everyone but the POV, at their own Money level, for the GM view: a band at 1; cash and one
 * account at 2; every account and their bills from 3. Their recent lines and notes come from their
 * own record in the economy slice. Someone whose authored accounts no money process or view has
 * opened yet shows them with the opening amounts they will start from (`opened` false).
 */
export function buildPeopleMoney(ctx: ReadContext): GmMoney[] {
  const cal = calendarOf(ctx.world);
  const records = objOf(sliceOf(ctx.state, "economy").people);
  const out: GmMoney[] = [];
  for (const id of Object.keys(ctx.state.entities)) {
    const e = own(ctx.state.entities, id);
    if (!e || id === ctx.world.pov || !kindIs(ctx.registry, ctx.world, e.kind, "person")) continue;
    const level = ctx.levelOf(id, "money");
    if (level === 0) continue;
    const mine = accountsOf(ctx.state, id);
    const opened = mine.length === 0 || isMaterialized(ctx.state, id, "money");
    const cents = (account: EntityId): number => shownCents(ctx, account, opened);
    const worth = mine.reduce((sum, account) => sum + cents(account), 0);
    const firstChecking = mine.find((account) => accountType(ctx.state, account) === "checking");
    const shown = level >= 3 ? mine : level === 2 ? mine.filter((account) => accountType(ctx.state, account) === "cash" || account === firstChecking) : [];
    const record = objOf(own(records, id));
    const notes = Array.isArray(record.notes) ? record.notes.map((n) => objOf(n)) : [];
    out.push({
      entity: id,
      name: e.name,
      level,
      band: mine.length > 0 ? wealthBand(worth) : wealthOf(ctx.state, id),
      netWorthCents: level >= 2 && mine.length > 0 ? worth : null,
      opened,
      accounts: shown.map((account) => ({ id: account, name: own(ctx.state.entities, account)?.name ?? account, kind: accountType(ctx.state, account) ?? "checking", cents: cents(account) })),
      bills: level >= 3 ? billsOf(ctx, id) : [],
      recent: recentLines(ctx, Array.isArray(record.history) ? record.history : [], new Set(shown), 8),
      notes: notes.reverse().map((n) => ({ at: formatClock(cal, numOf(n.at)), text: strOf(n.text) })),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
