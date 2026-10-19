// A character's own money in plain words, for their mind (DESIGN §24, §25.11): what they carry
// and have in the bank, what they owe and what's due soon, what comes in, and what the modules
// add (their job, their business, their investments). Only their own money: never anyone else's.

import type { EntityId } from "../../../shared/ids";
import type { MoneySummary } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { numOf, own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import type { FinanceHooks } from "./module";
import { allFlows, occurrences, occurrenceAmount } from "./flows";
import { cycleOf, flowRunOf, isOpened } from "./journal";
import { accountsOf, availableOf, balance, classOf, openerOf, rightsOf, statusOf, traitsOf } from "./model";
import { featureFor, overdraftRoom } from "./pay";
import { wealthOf } from "./worth";
import { createRng } from "../../../engine/rng";

const DAY = 1440;

export function moneySummary(hooks: FinanceHooks, ctx: ReadContext, who: EntityId): MoneySummary {
  const level = ctx.levelOf(who, "money");
  const band = level >= 1 ? wealthOf(hooks, ctx, who) : null;
  if (level < 2 || accountsOf(ctx, who).length === 0) return { lines: band ? [`Money: ${band}.`] : [], band, spendable: null, pressing: [] };
  const money = (c: number): string => formatMoney(c, ctx.world.currency);
  const cal = calendarOf(ctx.world);
  const day = (at: number): string => formatClock(cal, at).split(",")[0] ?? "";
  const shown = (id: EntityId): number => balance(ctx.state, id) + (isOpened(ctx.state, id, openerOf(ctx.state, id)) ? 0 : Math.round(numOf(own(ctx.state.entities, id)?.fields.opening)));
  const lines: string[] = [];
  const mine = accountsOf(ctx, who);
  const cash = mine.filter((id) => classOf(ctx, id) === "cash" && rightsOf(ctx.state, id, who)?.spend).reduce((a, id) => a + shown(id), 0);
  const bank = mine.filter((id) => traitsOf(ctx, id)?.asset && !traitsOf(ctx, id)?.cash && rightsOf(ctx.state, id, who)?.spend && !traitsOf(ctx, id)?.locked);
  const inBank = bank.reduce((a, id) => a + shown(id), 0);
  lines.push(`You have ${money(cash)} in cash and ${money(inBank)} in the bank.`);
  let spendable = cash + bank.reduce((a, id) => a + Math.max(0, availableOf(ctx, id) + overdraftRoom(ctx, id)), 0);
  const pressing: MoneySummary["pressing"] = [];
  const now = ctx.state.clock;
  for (const id of mine) {
    const t = traitsOf(ctx, id);
    if (!t?.liability || !rightsOf(ctx.state, id, who)?.worth) continue;
    const owed = Math.max(0, -shown(id));
    const name = own(ctx.state.entities, id)?.name ?? id;
    if (t.revolving && statusOf(ctx.state, id) === "open") spendable += Math.max(0, Math.min(availableOf(ctx, id), 10_000_000));
    if (owed <= 0) continue;
    const cycle = cycleOf(ctx.state, id);
    const left = cycle ? cycle.minimum - cycle.paid : 0;
    let line = `${name} owes ${money(owed)}`;
    if (cycle && left > 0) {
      line += cycle.stage !== "current" ? `; ${money(left)} is past due` : `; ${money(left)} is due ${day(cycle.due)}`;
      if (cycle.due - now <= 14 * DAY || cycle.stage !== "current") pressing.push({ label: name, cents: left, at: day(cycle.due) });
    }
    if (statusOf(ctx.state, id) !== "open") line += ` (${statusOf(ctx.state, id).replace(/_/g, " ")})`;
    lines.push(`${line}.`);
  }
  if (featureFor(ctx, who, "flows")) {
    const soon: { at: number; text: string; cents: number; out: boolean; label: string }[] = [];
    for (const f of allFlows(hooks, ctx)) {
      if (f.status !== "active" || flowRunOf(ctx.state, f.id).ended) continue;
      const fromMine = f.from === who || (own(ctx.state.entities, f.from)?.kind === "account" && rightsOf(ctx.state, f.from, who)?.spend === true);
      const toMine = f.to === who || (own(ctx.state.entities, f.to)?.kind === "account" && rightsOf(ctx.state, f.to, who)?.worth === true);
      if (fromMine === toMine) continue;
      const next = occurrences(ctx, f.schedule, now, now + 14 * DAY, f.start, f.end)[0];
      if (!next) continue;
      const amount = "provider" in f.amount ? null : occurrenceAmount(hooks, ctx, f, next.at, createRng(`summary:${f.id}`), flowRunOf(ctx.state, f.id).deferred ?? 0);
      const cents = amount && !("code" in amount) ? amount.cents : 0;
      soon.push({ at: next.at, cents, out: fromMine, label: f.label, text: `${f.label}${cents > 0 ? ` (${money(cents)})` : ""} ${fromMine ? "is due" : "comes in"} ${day(next.at)}` });
    }
    soon.sort((a, b) => a.at - b.at);
    for (const s of soon.slice(0, 5)) lines.push(`${s.text}.`);
    for (const s of soon.filter((x) => x.out && x.cents > 0 && x.at - now <= 7 * DAY).slice(0, 3)) pressing.push({ label: s.label, cents: s.cents, at: day(s.at) });
    const out7 = soon.filter((x) => x.out && x.at - now <= 7 * DAY).reduce((a, x) => a + x.cents, 0);
    if (out7 > cash + inBank) lines.push(`What's due this week is more than you have in cash and the bank.`);
  }
  for (const source of hooks.summaries) lines.push(...source(ctx, who));
  return { lines, band, spendable: Math.round(spendable), pressing };
}
