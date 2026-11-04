// The GM's money on a large world (DESIGN §9.6): a page per party, each with its flows, so within
// one read pass the world's flows, accounts and tax standing are gathered once, not per party, and
// each party added costs a bounded number of walks over the world's entities. And the money
// process that opens authored accounts, which runs every slot: once they are open, it costs one
// walk however many parties there are, with the events a walk over every party gave.

import { describe, expect, test } from "bun:test";
import type { FinanceView } from "../../../src/shared/finance";
import type { EntityId } from "../../../src/shared/ids";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { isMaterialized } from "../../../src/engine/materialize";
import { readPass } from "../../../src/engine/read-pass";
import type { ReadContext } from "../../../src/engine/registry";
import { isGone } from "../../../src/engine/scope";
import { moneyLevel } from "../../../src/packs/economy/core/model";
import { isParty } from "../../../src/packs/economy/core/pay";
import { openAccounts, openingEvent } from "../../../src/packs/economy/core/process";
import { account, CLERK, entity, reg, setup } from "./work-world";

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
