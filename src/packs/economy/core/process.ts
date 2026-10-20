// The money processes (DESIGN §25.5, §25.6): openings, then one engine that does every money
// instant inside a slot in time order (pending card payments settling, statements and bills,
// deposit interest and fees, flows and their retries, due dates, monthly credit scores), and the
// money materializer that opens a party's authored accounts or samples a person's within their
// wealth band.

import type { JsonObject } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PostingLine } from "../../../shared/ledger";
import { FINANCE_EVENTS, featureOn } from "../../../shared/finance";
import { MINDS_EVENTS } from "../../../shared/minds";
import type { EntityDef } from "../../../shared/world";
import { isMaterialized, pinnedVersion, tablesRevision } from "../../../engine/materialize";
import { numOf, own, strOf } from "../../../engine/pack-kit";
import type { ReadContext, SlotInfo } from "../../../engine/registry";
import { rulesetFloor } from "../../../engine/registry-impl";
import type { Rng } from "../../../engine/rng";
import { isGone, kindIs } from "../../../engine/scope";
import type { FinanceHooks } from "./module";
import { cycleTasks, type CycleTask } from "./cycle";
import { hasCreditFile, monthlyScore, scoreInstants } from "./credit";
import { allFlows, flowLevel, occurrences, planPayments, runOccurrence } from "./flows";
import { flowRunOf, isOpened } from "./journal";
import { accountsOf, bandByLabel, external, openerOf } from "./model";
import { featureFor, isParty, toggles } from "./pay";
import { Run } from "./run";

/** Every party with authored accounts that hasn't opened them, in id order. */
function parties(ctx: ReadContext): EntityId[] {
  return Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => isParty(ctx, id) && !isGone(ctx.state, id));
}

/**
 * The posting of a party's authored opening balances, from its own outside account, for the
 * accounts it holds that haven't opened (a joint account opens once, with whichever holder opens
 * first); none when it holds none with an opening amount. It draws no randomness, so a view's
 * materialization and the money processes record the same events.
 */
export function openingBalances(entity: EntityId, ctx: ReadContext, claimed?: Set<EntityId>): LedgerEvent[] {
  const s = ctx.state;
  const closed = accountsOf(ctx, entity).filter((id) => !claimed?.has(id) && !isOpened(s, id, openerOf(s, id) === entity ? null : openerOf(s, id)));
  for (const id of closed) claimed?.add(id);
  const lines: PostingLine[] = closed.filter((id) => typeof own(s.entities, id)?.fields.opening === "number" && numOf(own(s.entities, id)?.fields.opening) !== 0).map((id) => ({ account: id, amount: Math.round(numOf(own(s.entities, id)?.fields.opening)) }));
  const out: LedgerEvent[] = [];
  if (lines.length > 0) {
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const all = total === 0 ? lines : [...lines, { account: external(entity), amount: -total }];
    if (all.length >= 2) out.push({ type: "post", lines: all, memo: "Opening balances" }, { type: FINANCE_EVENTS.txn, data: { memo: "Opening balance", kind: "opening", category: "opening", lines: lines.map((l) => ({ account: l.account, amount: l.amount })) } });
  }
  if (closed.length > 0) out.push({ type: FINANCE_EVENTS.open, data: { accounts: closed } });
  return out;
}

/**
 * Opens the authored accounts of everyone the money processes act for (Money 3+): in the first slot
 * that steps them at that level, their opening balances post as the same `materialize` event a
 * view would record, so their flows draw on the money the author gave them.
 */
export function openAccounts(ctx: ReadContext): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  // Every party here opens from the same state, so an account two of them hold goes with the first only.
  const claimed = new Set<EntityId>();
  for (const who of parties(ctx)) {
    if (ctx.levelOf(who, "money") < 3 || isMaterialized(ctx.state, who, "money")) continue;
    const opening = openingEvent(ctx, who, claimed);
    if (opening) out.push(opening);
  }
  return out;
}

/** A party's opening balances as the `materialize` event a view records when it first shows them; null when nothing is left to open. */
export function openingEvent(ctx: ReadContext, who: EntityId, claimed?: Set<EntityId>): LedgerEvent | null {
  const version = pinnedVersion(ctx.world, ctx.registry, "money");
  if (typeof version !== "number") return null;
  const events = openingBalances(who, ctx, claimed);
  return events.length > 0 ? { type: "materialize", entity: who, domain: "money", generatorVersion: version, tablesRevision: tablesRevision(ctx.world), events } : null;
}

/** The money engine's step: every money instant in the slot, in time order, each seeing the last. */
export function moneyStep(hooks: FinanceHooks, slot: SlotInfo, ctx: ReadContext, rng: (entity: EntityId) => Rng): LedgerEvent[] {
  const tasks: CycleTask[] = [...cycleTasks(ctx, slot.start, slot.end), ...planTasks(hooks, slot, ctx, rng)];
  for (const flow of allFlows(hooks, ctx)) {
    // A mind's plan is a one-off its own task carries out, not a standing payment.
    if (flow.status !== "active" || flow.source === "minds") continue;
    const level = flowLevel(ctx, flow);
    if (!featureOn(level, "flows", toggles(ctx.world))) continue;
    const run = flowRunOf(ctx.state, flow.id);
    if (run.ended) continue;
    for (const o of occurrences(ctx, flow.schedule, slot.start, slot.end, flow.start, flow.end)) tasks.push({ at: o.at, rank: 3, key: `flow:${flow.id}:${o.day}`, run: (r) => runOccurrence(hooks, r, flow, o.at, rng(`flow:${flow.id}:${o.at}`), false) });
    if (run.retry && run.retry.at > slot.start && run.retry.at <= slot.end) {
      const at = run.retry.at;
      tasks.push({ at, rank: 3, key: `retry:${flow.id}`, run: (r) => runOccurrence(hooks, r, flow, at, rng(`flow:${flow.id}:${at}`), true) });
    }
  }
  const scores = scoreInstants(ctx, slot.start, slot.end);
  if (scores.length > 0) {
    for (const person of parties(ctx)) {
      if (!kindIs(ctx.registry, ctx.world, own(ctx.state.entities, person)?.kind ?? "", "person") || !featureFor(ctx, person, "credit")) continue;
      for (const at of scores) tasks.push({ at, rank: 6, key: `score:${person}`, run: (r) => (hasCreditFile(r.ctx, person) ? void r.emit(monthlyScore(r.ctx, person, at)) : undefined) });
    }
  }
  return runTasks(ctx, tasks);
}

/** Tasks run in time order (then rank, then key), each seeing the last, as one run's events. */
function runTasks(ctx: ReadContext, tasks: CycleTask[]): LedgerEvent[] {
  if (tasks.length === 0) return [];
  tasks.sort((a, b) => a.at - b.at || a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const run = new Run(ctx);
  for (const t of tasks) t.run(run);
  return run.out;
}

/**
 * A mind's plans to pay or lend someone, carried out (DESIGN §24.8): each one payment at its time,
 * at the planner's own Money level, as a one-off they hand over rather than a standing payment, so
 * it needs no flows. A step reaching its time late pays it at the step's first minute. The plan is
 * done once paid, and dropped with the reason when the money wasn't there.
 */
function planTasks(hooks: FinanceHooks, slot: SlotInfo, ctx: ReadContext, rng: (entity: EntityId) => Rng): CycleTask[] {
  return planPayments(ctx).flatMap(({ entity, plan, flow, at: due }): CycleTask[] => {
    if (due > slot.end) return [];
    const at = Math.max(due, slot.start + 1);
    return [
      {
        at,
        rank: 3,
        key: `flow:${flow.id}`,
        run: (r) => {
          const ran = runOccurrence(hooks, r, flow, at, rng(`flow:${flow.id}:${at}`), false);
          const paid = ran?.outcome === "paid";
          r.emit([{ type: MINDS_EVENTS.plan, data: { entity, plan: plan.id, status: paid ? "done" : "dropped", at, reason: paid ? null : (ran?.reason ?? "the payment didn't go through") } }]);
        },
      },
    ];
  });
}

/** The Money level from which the money step runs: below it, `planStep` carries out the minds' plans alone. */
export const MONEY_STEP_LEVEL = 2;

/**
 * The minds' money plans where the money step doesn't run (Money below 2): carried out all the
 * same, each as any payment at its planner's level is (nothing moves at 0), so no plan is left open
 * for want of an engine to settle it.
 */
export function planStep(hooks: FinanceHooks, slot: SlotInfo, ctx: ReadContext, rng: (entity: EntityId) => Rng): LedgerEvent[] {
  if (rulesetFloor(ctx.world, "money", ctx.state.realism.levels.money) >= MONEY_STEP_LEVEL) return [];
  return runTasks(ctx, planTasks(hooks, slot, ctx, rng));
}

// ---------------------------------------------------------------- materialization

function logUniform(rng: Rng, lo: number, hi: number): number {
  const a = Math.log(Math.max(1, lo));
  const b = Math.log(Math.max(2, hi));
  return Math.exp(a + (b - a) * rng.next());
}

/**
 * Samples a person's money within their wealth band: a net worth inside the band, split into cash,
 * checking, savings and a card balance. Generator 1 (worlds that pin it) writes the account shapes
 * an older build wrote; generator 2 writes owners and products, a debit card and a credit card.
 */
export function materializeMoney(entity: EntityId, ctx: ReadContext, rng: Rng, version: number): LedgerEvent[] {
  const s = ctx.state;
  const e = own(s.entities, entity);
  const level = e ? ctx.levelOf(entity, "money") : 0;
  if (!e || level < 1) return [];
  if (accountsOf(ctx, entity).length > 0) return openingBalances(entity, ctx);
  if (level < 2 || !kindIs(ctx.registry, ctx.world, e.kind, "person")) return [];
  const ext = external(entity);
  // A net worth inside the current band (its level-1 representation), then split.
  const band = bandByLabel(strOf(e.fields.wealth, "modest"));
  const lo = Number.isFinite(band.min) ? Math.max(band.min, 0) : 0;
  const hi = Number.isFinite(band.max) ? band.max - 1 : band.typical * 4;
  const worth = Math.round(logUniform(rng, Math.max(lo, 500), Math.max(hi, 1000)));
  const cash = Math.min(worth, Math.round(Math.min(50_000, Math.max(2_000, worth * (0.01 + rng.next() * 0.02)))));
  const rest = worth - cash;
  const checkingShare = worth < 2_000_000 ? 0.4 + rng.next() * 0.4 : 0.15 + rng.next() * 0.2;
  const checking = Math.round(rest * checkingShare);
  const savings = rest - checking;
  const limit = Math.round(Math.min(2_500_000, Math.max(50_000, band.typical * 0.3)) / 10_000) * 10_000;
  const owed = Math.round(limit * rng.next() * 0.25);
  const statementDay = 1 + rng.int(0, 27);
  const wallet = Object.keys(s.entities)
    .sort()
    .find((id) => own(s.entities, id)?.fields.owner === entity && (own(s.entities, id)?.fields.catalog === "wallet" || /wallet|purse/i.test(own(s.entities, id)?.name ?? "")));
  const id = (suffix: string): EntityId => `${entity}:${suffix}`;
  const out: LedgerEvent[] = [];
  if (version === 1) {
    const mk = (suffix: string, name: string, fields: JsonObject, inWallet = false): EntityDef => ({ id: id(suffix), kind: "account", name, tier: "background", fields: { owner: entity, ...fields }, relations: inWallet && wallet ? [{ type: "in", to: wallet }] : [] });
    for (const def of [mk("cash", "Cash", { type: "cash" }, true), mk("checking", "Checking", { type: "checking", institution: "Local bank" }), mk("savings", "Savings", { type: "savings", institution: "Local bank", apy_pct: 0.4 }), mk("card", "Credit card", { type: "card", limit, apr_pct: 22, statement_day: statementDay, due_days: 25, autopay: "minimum" })]) out.push({ type: "spawn", entity: def });
  } else {
    const owners = [{ party: entity, role: "owner" }];
    const mk = (suffix: string, name: string, fields: JsonObject, inWallet = false): EntityDef => ({ id: id(suffix), kind: "account", name, tier: "background", fields: { owners, ...fields }, relations: inWallet && wallet ? [{ type: "in", to: wallet }] : [] });
    const card = (suffix: string, name: string, account: string, network: string): EntityDef => ({ id: id(suffix), kind: "card", name, tier: "background", fields: { account, holder: entity, network, state: "active" }, relations: [] });
    for (const def of [
      mk("cash", "Cash", { product: "cash" }, true),
      mk("checking", "Checking", { product: "checking", institution: "Local bank" }),
      mk("savings", "Savings", { product: "savings", institution: "Local bank" }),
      mk("card", "Credit card", { product: "credit_card", institution: "Local bank", limit, statement_day: statementDay, autopay: "minimum", autopay_from: id("checking") }),
      card("debit_card", "Debit card", id("checking"), "debit"),
      card("credit_card", "Credit card", id("card"), "credit"),
    ])
      out.push({ type: "spawn", entity: def });
  }
  const lines: PostingLine[] = [
    { account: id("cash"), amount: cash },
    { account: id("checking"), amount: checking },
    { account: id("savings"), amount: savings },
    { account: id("card"), amount: -owed },
  ].filter((l) => l.amount !== 0);
  const total = lines.reduce((a, l) => a + l.amount, 0);
  if (lines.length > 0) out.push({ type: "post", lines: [...lines, { account: ext, amount: -total }], memo: "Opening balances" });
  out.push({ type: FINANCE_EVENTS.open, data: { accounts: [id("cash"), id("checking"), id("savings"), id("card")] } });
  return out;
}
