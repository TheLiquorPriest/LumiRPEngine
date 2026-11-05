// The GM's money on a large world (DESIGN §9.6): a page per party, each with its flows, so within
// one read pass the world's flows, accounts and tax standing are gathered once, not per party, and
// each party added costs a bounded number of walks over the world's entities. And the money
// process that opens authored accounts, which runs every slot: once they are open, it costs one
// walk however many parties there are, with the events a walk over every party gave. And a
// timelapse over that world (BUILD-C C3): its slots' marks copy nothing (`Working.lightMark`), so it
// copies the state no more for three days than for one, and a run the unit cap ends, which goes
// back to a slot's start, ends as one that copied the state at every slot did.

import { describe, expect, test } from "bun:test";
import type { Rejection } from "../../../src/engine/registry";
import { runTimelapse, type TimelapseOutcome } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import type { FinanceView } from "../../../src/shared/finance";
import type { EntityId, InterruptClass, InterruptPolicy } from "../../../src/shared/ids";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { isMaterialized } from "../../../src/engine/materialize";
import { readPass } from "../../../src/engine/read-pass";
import type { ReadContext } from "../../../src/engine/registry";
import { isGone } from "../../../src/engine/scope";
import { moneyLevel } from "../../../src/packs/economy/core/model";
import { isParty } from "../../../src/packs/economy/core/pay";
import { openAccounts, openingEvent } from "../../../src/packs/economy/core/process";
import { account, CLERK, entity, lapse, reg, setup } from "./work-world";

/** Riverton with `n` more people, each with a checking account and a clerk's job. */
function crowd(n: number): ReturnType<typeof setup> {
  return setup((world) => {
    for (let i = 0; i < n; i++) {
      world.entities[`p${i}`] = entity(`p${i}`, "person", `Person ${i}`, { place: "office" });
      world.entities[`p${i}_checking`] = account(`p${i}_checking`, `p${i}`, "checking", 10_000);
      world.entities[`p${i}_job`] = entity(`p${i}_job`, "job", `Job ${i}`, { ...CLERK, worker: `p${i}`, title: `Clerk ${i}` });
    }
  });
}

/** The GM's money pages for a crowd of `n`, and how many times building them listed the world's entities. */
function peopleMoney(n: number): { pages: FinanceView[]; walks: number } {
  const { world, w } = crowd(n);
  let walks = 0;
  const entities = new Proxy(w.state.entities, {
    ownKeys: (target) => {
      walks++;
      return Reflect.ownKeys(target);
    },
  });
  const ctx = reg.context(world, { ...w.state, entities });
  return { pages: readPass(() => ctx.query("economy.people_money")(ctx)), walks };
}

describe("the GM's money on a large world", () => {
  test("each party added costs a bounded number of walks over the world's entities", () => {
    const small = peopleMoney(10);
    const large = peopleMoney(40);
    expect(large.walks - small.walks).toBeLessThanOrEqual(20 * 30);
    // Every page is still there, with its account.
    const page = large.pages.find((v) => v.party === "p37");
    expect(page).toBeDefined();
    expect(JSON.stringify(page)).toContain("p37_checking");
  });
});

/** The opening the money process gave before it asked least first: every party, in id order, at Money 3+ and not opened, each opening from the same state. */
function openedEveryParty(ctx: ReadContext): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  const claimed = new Set<EntityId>();
  for (const who of Object.keys(ctx.state.entities).sort()) {
    if (!isParty(ctx, who) || isGone(ctx.state, who) || moneyLevel(ctx, who) < 3 || isMaterialized(ctx.state, who, "money")) continue;
    const opening = openingEvent(ctx, who, claimed);
    if (opening) out.push(opening);
  }
  return out;
}

/** `openAccounts` on a crowd of `n` with none of the crowd's accounts opened, or once all have, and how many times it listed the world's entities. */
function opening(n: number, opened: boolean): { events: LedgerEvent[]; before: LedgerEvent[]; walks: number } {
  const { world, w } = crowd(n);
  if (opened) for (const event of openAccounts(reg.context(world, w.state))) w.apply(event);
  let walks = 0;
  const entities = new Proxy(w.state.entities, {
    ownKeys: (target) => {
      walks++;
      return Reflect.ownKeys(target);
    },
  });
  const ctx = reg.context(world, { ...w.state, entities });
  const events = openAccounts(ctx);
  const counted = walks;
  return { events, before: openedEveryParty(reg.context(world, w.state)), walks: counted };
}

describe("opening authored accounts, every slot", () => {
  test("the events are those a walk over every party gave, accounts unopened or opened", () => {
    const fresh = opening(12, false);
    expect(fresh.events.length).toBeGreaterThan(0);
    expect(fresh.events).toEqual(fresh.before);
    const open = opening(12, true);
    expect(open.events).toEqual([]);
    expect(open.before).toEqual([]);
  });

  test("once the accounts are open, a slot costs one walk of the entities however many parties there are", () => {
    const small = opening(10, true);
    const large = opening(60, true);
    expect(large.walks).toBe(small.walks);
    expect(large.walks).toBeLessThanOrEqual(1);
  });
});

const DAY = 24 * 60;
/** The interrupts a timelapse here meets, noted rather than stopping it, as `lapse` runs them. */
const NOTED: Partial<Record<InterruptClass, InterruptPolicy>> = { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" };

/** A timelapse of a crowd of 12 settled by a day of its own (its accounts open, its first pay worked out), and what it did, and how many times it copied the working state whole. */
interface Lapse {
  outcome: TimelapseOutcome;
  events: unknown;
  state: unknown;
  copies: number;
}

/**
 * `days` days' timelapse of the settled crowd, with `events` its unit cap's events when given:
 * the outcome (`processMs`, which is wall clock, left out), the events it applied and the state it
 * left, and how many times anything copied the working state whole (`structuredClone` of it).
 */
function settledLapse(days: number, events?: number): Lapse {
  const { w } = crowd(12);
  lapse(w, DAY);
  const before = w.events.length;
  const real = globalThis.structuredClone;
  let copies = 0;
  globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
    if (value === w.state) copies++;
    return real(value, options);
  }) as typeof structuredClone;
  let outcome: TimelapseOutcome | Rejection;
  try {
    outcome = runTimelapse(reg, w, { type: "duration", minutes: days * DAY }, { runSeed: "run", overrides: NOTED, ...(events !== undefined ? { unitCap: { agentDays: 600, events } } : {}) });
  } finally {
    globalThis.structuredClone = real;
  }
  if ("code" in outcome) throw new Error(outcome.reason);
  const { processMs: _wallClock, ...result } = outcome.result;
  return { outcome: { ...outcome, result }, events: JSON.parse(JSON.stringify(w.events.slice(before))), state: JSON.parse(JSON.stringify(w.state)), copies };
}

/** `fn` with every slot's mark a whole copy of the state (`Working.mark`), as before light marks. */
function wholeMarks<T>(fn: () => T): T {
  const light = Working.prototype.lightMark;
  Working.prototype.lightMark = Working.prototype.mark;
  try {
    return fn();
  } finally {
    Working.prototype.lightMark = light;
  }
}

describe("a timelapse's slots", () => {
  test("copy the state no more for three days than for one: at most once a day beside the slots, and never per slot", () => {
    const one = settledLapse(1);
    const three = settledLapse(3);
    expect([one.outcome.result.slots, three.outcome.result.slots]).toEqual([4, 12]);
    // At most a day's slots and one more, per day, as the plan bounds it; in fact once, however many days.
    expect(three.copies).toBeLessThanOrEqual(three.outcome.result.slots / 3 + 1);
    expect(three.copies).toBe(one.copies);
    // With a whole copy at each slot's mark, as before, the copies grow with the slots.
    const oneWhole = wholeMarks(() => settledLapse(1));
    const threeWhole = wholeMarks(() => settledLapse(3));
    expect(threeWhole.copies - oneWhole.copies).toBe(three.outcome.result.slots - one.outcome.result.slots);
  });

  test("end as they did with a whole copy at every slot: run to the target, and stopped by the unit cap, which goes back to a slot's start", () => {
    const through = settledLapse(3);
    expect(through.outcome.result.stop).toBe("target");
    expect(through).toEqual({ ...wholeMarks(() => settledLapse(3)), copies: through.copies });
    // The cap trips mid-run: the slot that took it past is undone, rebuilt from the copy the Working's first light mark made.
    const capped = settledLapse(3, 60);
    expect(capped.outcome.result.stop).toBe("cap");
    expect(capped.outcome.result.slots).toBeLessThan(12);
    expect(capped.outcome.remaining).toBeGreaterThan(0);
    expect(capped).toEqual({ ...wholeMarks(() => settledLapse(3, 60)), copies: capped.copies });
  });
});
