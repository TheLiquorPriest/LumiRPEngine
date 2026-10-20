// The GM's money on a large world (DESIGN §9.6): a page per party, each with its flows, so within
// one read pass the world's flows, accounts and tax standing are gathered once, not per party, and
// each party added costs a bounded number of walks over the world's entities.

import { describe, expect, test } from "bun:test";
import type { FinanceView } from "../../../src/shared/finance";
import { readPass } from "../../../src/engine/read-pass";
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
