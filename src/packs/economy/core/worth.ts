// Net worth (DESIGN §25.2, §27): a party's share of the accounts it holds with worth (a custodial
// account counts toward its beneficiary), plus whatever the modules value (holdings at market,
// property and business shares, the debts against them). The wealth band follows it.

import type { EntityId } from "../../../shared/ids";
import { CLASS_TRAITS, type AccountClass } from "../../../shared/finance";
import { numOf, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import type { FinanceHooks } from "./module";
import { isOpened } from "./journal";
import { accountsOf, balance, classOf, notional, openerOf, shareOf, wealthBand } from "./model";

export interface WorthParts {
  net: number;
  assets: number;
  liabilities: number;
  lines: { label: string; cents: number }[];
}

const GROUPS: { label: string; test: (cls: AccountClass) => boolean }[] = [
  { label: "Cash", test: (c) => CLASS_TRAITS[c].cash },
  { label: "Bank accounts", test: (c) => CLASS_TRAITS[c].asset && !CLASS_TRAITS[c].cash && !CLASS_TRAITS[c].investment },
  { label: "Investment accounts", test: (c) => CLASS_TRAITS[c].investment },
  { label: "Cards and credit lines", test: (c) => CLASS_TRAITS[c].revolving },
  { label: "Loans", test: (c) => CLASS_TRAITS[c].installment },
];

/** A party's net worth and its parts. */
export function netWorthParts(hooks: FinanceHooks, ctx: ReadContext, party: EntityId): WorthParts {
  const byGroup = new Map<string, number>();
  let assets = 0;
  let liabilities = 0;
  for (const id of accountsOf(ctx, party, "worth")) {
    const cls = classOf(ctx, id);
    if (!cls) continue;
    // An account that hasn't opened counts at the authored opening it will post, as the money views
    // show it, so a party's worth at a chat's start is what it is once their accounts open.
    const held = balance(ctx.state, id) + (isOpened(ctx.state, id, openerOf(ctx.state, id)) ? 0 : Math.round(numOf(own(ctx.state.entities, id)?.fields.opening)));
    const cents = Math.round((held * shareOf(ctx.state, id, party)) / 100);
    if (cents >= 0) assets += cents;
    else liabilities -= cents;
    const group = GROUPS.find((g) => g.test(cls))?.label ?? "Other";
    byGroup.set(group, (byGroup.get(group) ?? 0) + cents);
  }
  const lines = GROUPS.map((g) => ({ label: g.label, cents: byGroup.get(g.label) ?? 0 })).filter((l) => l.cents !== 0);
  for (const source of hooks.worth) {
    const w = source(ctx, party);
    assets += Math.max(0, w.assets);
    liabilities += Math.max(0, w.liabilities);
    lines.push(...w.lines);
  }
  return { net: assets - liabilities, assets, liabilities, lines };
}

export function netWorth(hooks: FinanceHooks, ctx: ReadContext, party: EntityId): number {
  return netWorthParts(hooks, ctx, party).net;
}

/** The wealth band at any level: from the books when the party holds accounts, else its band field. */
export function wealthOf(hooks: FinanceHooks, ctx: ReadContext, party: EntityId): string {
  return accountsOf(ctx, party).length > 0 ? wealthBand(netWorth(hooks, ctx, party)) : strOf(own(ctx.state.entities, party)?.fields.wealth, "modest");
}

/** Whether a party can afford `cents`: what it can spend from level 2, its net worth at 1 (its notional worth without accounts). */
export function canAfford(hooks: FinanceHooks, ctx: ReadContext, party: EntityId, cents: number, spendableNow: number): boolean {
  const level = ctx.levelOf(party, "money");
  if (level === 0) return true;
  if (accountsOf(ctx, party).length === 0) return notional(ctx.state, party) >= cents;
  return level >= 2 ? spendableNow >= cents : netWorth(hooks, ctx, party) >= cents;
}
