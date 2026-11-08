// What depth's work costs, folded with that work (DEPTH-PLAN §4.7, §6.5): `author.spend` rides in the
// turn's record (the scene; each settlement the player forced by walking in) and in each job's layer
// entry (a draft, a settlement or a drop, the step after a reply), so it is live exactly where the
// work is: a swipe that discards a turn gives back what that turn spent, and nothing else. The meter
// reads the live spend events of a chain (`spendsOn`); a per-day ceiling counts actual spend apart.
//
// `metered` wraps a model port and sums what each of its calls cost, per role, as the provider
// reported it; `spendData` makes the record of it. Bookkeeping only: nothing here judges.

import { AUTHOR_SPEND, authorData, SPEND_WORK, type SpendCost, type SpendData, type SpendWork } from "../../shared/author";
import { DEPTH_TREATMENTS, type DepthBudget, type DepthRole, type DepthTreatment } from "../../shared/depth-settings";
import type { StoryContainer } from "../../shared/story";
import type { LiveEvent } from "../../engine/ledger/story";
import type { ModelPort, PortUsage } from "./port";

/** The event types a reader of spend asks a chain for (`foldAtBasis`'s `types`). */
export const SPEND_TYPES: readonly string[] = [AUTHOR_SPEND];

/** A story interval's length in minutes (§6.5): allowances and the meter count over it. */
export const INTERVAL_MINUTES: Readonly<Record<DepthBudget["interval"], number>> = { day: 24 * 60, week: 7 * 24 * 60, month: 30 * 24 * 60 };

/** The story interval of `unit` holding story minute `at`: its unit and first minute. */
export function intervalAt(unit: DepthBudget["interval"], at: number): SpendData["interval"] {
  const len = INTERVAL_MINUTES[unit];
  return { unit, from: Math.floor(at / len) * len };
}

export const NO_COST: SpendCost = { calls: 0, tokensIn: 0, tokensOut: 0 };

/** Two costs summed; an amount neither has stays absent. */
export function addCost(a: SpendCost, b: SpendCost): SpendCost {
  const reasoningOut = a.reasoningOut === undefined && b.reasoningOut === undefined ? undefined : (a.reasoningOut ?? 0) + (b.reasoningOut ?? 0);
  const money = a.money === undefined && b.money === undefined ? undefined : (a.money ?? 0) + (b.money ?? 0);
  return { calls: a.calls + b.calls, tokensIn: a.tokensIn + b.tokensIn, tokensOut: a.tokensOut + b.tokensOut, ...(reasoningOut === undefined ? {} : { reasoningOut }), ...(money === undefined ? {} : { money }) };
}

/** One call's cost, as the provider reported its usage (none reported: the call alone). */
function callCost(usage: PortUsage | undefined): SpendCost {
  return { calls: 1, tokensIn: usage?.tokensIn ?? 0, tokensOut: usage?.tokensOut ?? 0, ...(usage?.reasoningOut !== undefined ? { reasoningOut: usage.reasoningOut } : {}), ...(usage?.cost !== undefined ? { money: usage.cost } : {}) };
}

/** What a metered port spent so far: in all, and per role. */
export interface Spent {
  cost: SpendCost;
  roles: Partial<Record<DepthRole, SpendCost>>;
}

export interface Metered {
  port: ModelPort;
  spent(): Spent;
}

/** Wraps `port` so each call it answers adds what it cost (a call that throws reported nothing to add). */
export function metered(port: ModelPort): Metered {
  let cost = NO_COST;
  const roles: Partial<Record<DepthRole, SpendCost>> = {};
  return {
    port: async (role, messages, opts) => {
      const count = (usage: Parameters<typeof callCost>[0]): void => {
        const c = callCost(usage);
        cost = addCost(cost, c);
        roles[role] = addCost(roles[role] ?? NO_COST, c);
      };
      // A call its provider refused spent what it read (`ProviderRefusal.usage`): the turn's spend counts it.
      const answer = await port(role, messages, opts).catch((error: unknown) => {
        if (error instanceof Error && error.name === "ProviderRefusal" && "usage" in error && error.usage) count(error.usage as Parameters<typeof callCost>[0]);
        throw error;
      });
      count(answer.usage);
      return answer;
    },
    spent: () => ({ cost, roles: { ...roles } }),
  };
}

/** Two readings' sums: what two pieces of work spent together. */
export function addSpent(a: Spent, b: Spent): Spent {
  const roles: Partial<Record<DepthRole, SpendCost>> = { ...a.roles };
  for (const [role, c] of Object.entries(b.roles) as [DepthRole, SpendCost][]) roles[role] = addCost(roles[role] ?? NO_COST, c);
  return { cost: addCost(a.cost, b.cost), roles };
}

/** What `b` spent beyond `a` (a reading taken earlier from the same meter, or the sum of some of its work). */
export function spentSince(a: Spent, b: Spent): Spent {
  const less = (x: SpendCost, y: SpendCost): SpendCost => {
    const reasoningOut = y.reasoningOut === undefined ? undefined : y.reasoningOut - (x.reasoningOut ?? 0);
    const money = y.money === undefined ? undefined : y.money - (x.money ?? 0);
    return { calls: y.calls - x.calls, tokensIn: y.tokensIn - x.tokensIn, tokensOut: y.tokensOut - x.tokensOut, ...(reasoningOut === undefined ? {} : { reasoningOut }), ...(money === undefined ? {} : { money }) };
  };
  const roles: Partial<Record<DepthRole, SpendCost>> = {};
  for (const [role, c] of Object.entries(b.roles) as [DepthRole, SpendCost][]) {
    const d = less(a.roles[role] ?? NO_COST, c);
    if (d.calls > 0) roles[role] = d;
  }
  return { cost: less(a.cost, b.cost), roles };
}

/** An episode's leading treatment: its costliest part's, by the ladder's order (§4.4, §4.6; written for none), what its spend counts as. */
export function leadingTreatment(parts: readonly { treatment: DepthTreatment }[]): DepthTreatment {
  return DEPTH_TREATMENTS.find((t) => parts.some((p) => p.treatment === t)) ?? "written";
}

/**
 * The record of what `spent` cost (null when it made no call and put nothing off): bought `treatment`
 * for `for`, counted in the story interval holding minute `at`, on the real day `now`, with what a
 * ceiling or an allowance put off meanwhile (`put`).
 */
export function spendData(spent: Spent, o: { treatment: SpendWork; interval: DepthBudget["interval"]; at: number; for: string; put?: readonly string[]; now?: Date }): SpendData | null {
  const put = (o.put ?? []).filter((p) => p.trim() !== "");
  if ((spent.cost.calls <= 0 && put.length === 0) || !(SPEND_WORK as readonly string[]).includes(o.treatment)) return null;
  return { treatment: o.treatment, interval: intervalAt(o.interval, o.at), cost: spent.cost, roles: spent.roles, day: (o.now ?? new Date()).toISOString().slice(0, 10), for: o.for, ...(put.length > 0 ? { put } : {}) };
}

/** Each live spend on a chain with where it rides, in fold order, from the chain's live events (`SPEND_TYPES`). */
export function spendsOn(events: readonly LiveEvent[]): { data: SpendData; from: StoryContainer }[] {
  const out: { data: SpendData; from: StoryContainer }[] = [];
  for (const e of events) {
    const d = authorData<SpendData>(e.event, AUTHOR_SPEND);
    if (d) out.push({ data: d, from: e.from });
  }
  return out;
}
