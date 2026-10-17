// The Money panel's view model (`economy.money`), shown at the POV's Money level: a band at 1;
// cash plus one account at 2; every account with cards and bills at 3; APR, limits and dues at 4.

import type { EntityId } from "../../../shared/ids";
import type { ReadContext } from "../../../engine/registry";
import { calendarOf, formatClock, monthName, weekdayName } from "../../../engine/calendar";
import { numOf, objOf, sliceOf, strOf, own } from "../../../engine/pack-kit";
import { accountsOf, accountType, balance, holdingsValue, netWorth, wealthOf, type AccountType } from "./model";

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

export function buildMoneyView(ctx: ReadContext): MoneyView {
  const pov = ctx.world.pov;
  const level = ctx.levelOf(pov, "money");
  const cal = calendarOf(ctx.world);
  const band = level >= 1 ? wealthOf(ctx.state, pov) : null;
  const mine = accountsOf(ctx.state, pov);
  if (level === 0) return { level, band: null, netWorthCents: null, cash: null, accounts: [], recent: [], upcoming: [] };
  if (level === 1 || mine.length === 0) return { level, band, netWorthCents: null, cash: band ? { band } : null, accounts: [], recent: [], upcoming: [] };
  const firstChecking = mine.find((id) => accountType(ctx.state, id) === "checking");
  const shown = level >= 3 ? mine : mine.filter((id) => accountType(ctx.state, id) === "cash" || id === firstChecking);
  const statements = objOf(sliceOf(ctx.state, "economy").cards);
  const accounts: MoneyAccount[] = shown.map((id) => {
    const e = own(ctx.state.entities, id);
    const kind = accountType(ctx.state, id) ?? "checking";
    const a: MoneyAccount = { id, name: e?.name ?? id, kind, cents: balance(ctx.state, id) + holdingsValue(ctx.state, id) };
    if (level >= 3 && kind === "card" && typeof e?.fields.limit === "number") a.limitCents = e.fields.limit;
    if (level >= 4 && typeof e?.fields.apr_pct === "number") a.aprPct = e.fields.apr_pct;
    const st = objOf(statements[id]);
    if (level >= 4 && Object.keys(st).length > 0 && numOf(st.paid) < numOf(st.minimum)) a.due = { label: `Minimum due ${formatClock(cal, numOf(st.due)).split(",")[0] ?? ""}`, cents: numOf(st.minimum) - numOf(st.paid) };
    return a;
  });
  const shownSet = new Set(shown);
  const rawHistory = sliceOf(ctx.state, "economy").history;
  const history = Array.isArray(rawHistory) ? rawHistory : [];
  const recent: MoneyView["recent"] = [];
  for (let i = history.length - 1; i >= 0 && recent.length < 10; i--) {
    const h = objOf(history[i]);
    const lines = Array.isArray(h.lines) ? h.lines.map((l) => objOf(l)) : [];
    for (const l of lines) {
      const account = strOf(l.account);
      if (!shownSet.has(account)) continue;
      recent.push({ at: formatClock(cal, numOf(h.at)), memo: strOf(h.memo), cents: numOf(l.amount), account: own(ctx.state.entities, account)?.name ?? account });
    }
  }
  const upcoming: MoneyView["upcoming"] = [];
  if (level >= 3) {
    const bills = own(ctx.state.entities, pov)?.fields.bills;
    if (Array.isArray(bills)) for (const raw of bills) {
      const b = objOf(raw);
      const every = strOf(b.every, "month");
      const when = every === "week" ? `every ${typeof b.day === "string" ? b.day : weekdayName(cal, numOf(b.day, 1))}` : every === "year" ? `${monthName(cal, numOf(b.month, 1))} ${numOf(b.day, 1)}` : `day ${numOf(b.day, 1)}`;
      upcoming.push({ at: when, label: strOf(b.label, "Bill"), cents: -Math.round(numOf(b.amountCents)) });
    }
  }
  return {
    level,
    band,
    netWorthCents: netWorth(ctx.state, pov),
    cash: { cents: mine.filter((id) => accountType(ctx.state, id) === "cash").reduce((a, id) => a + balance(ctx.state, id), 0) },
    accounts,
    recent,
    upcoming,
  };
}
