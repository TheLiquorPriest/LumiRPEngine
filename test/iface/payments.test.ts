// Money as `world_apply` moves it, each call as the harness passes it: cash set to a sum, moved by
// one, or sent as text moves the money and makes no field; anything else is not read; a purchase
// pays the one named in `to`; and a payment is reported only when what it took from could not
// cover it.

import { describe, expect, test } from "bun:test";
import type { HostTool, JsonObject } from "rp-harness/contract";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { asHarnessPasses } from "../story/rig";
import { dataOf, type Rig, rig, texts, wordsFromFiles } from "./rig";

const SRC = { source: { from: "prose", message: "m-50" } };

function apply(t: Rig, operations: JsonObject[]) {
  return t.call("world_apply", asHarnessPasses(t.tools.get("world_apply") as HostTool, { operations }));
}

describe("cash", () => {
  test("cash moved by add, or set to a number sent as text, moves the money and makes no field", async () => {
    const t = await rig();
    const moved = await apply(t, [{ op: "set", at: "wren", key: "cash", add: "-3", ...SRC }]);
    expect(moved.error).toBeUndefined();
    expect(moved.reports).toBeUndefined();
    let world = t.s.stateAt(t.turn.id).state.world;
    expect(world.accounts.acct_wren).toBe(900);
    expect(world.entities.wren?.fields.cash).toBeUndefined();

    const set = await apply(t, [{ op: "set", at: "wren", key: "cash", value: "40", ...SRC }]);
    expect(set.error).toBeUndefined();
    world = t.s.stateAt(t.turn.id).state.world;
    expect(world.accounts.acct_wren).toBe(4000);
    expect(world.entities.wren?.fields.cash).toBeUndefined();
    wordsFromFiles(set);
  });

  test("cash taken past what is held is taken all the same, below nothing, and reported", async () => {
    const t = await rig();
    const r = await apply(t, [{ op: "set", at: "wren", key: "cash", add: -50, ...SRC }]);
    expect(r.error).toBeUndefined();
    expect(t.s.stateAt(t.turn.id).state.world.accounts.acct_wren).toBe(-3800);
    expect(r.reports).toEqual([expect.stringContaining("could pay at most $12.00")]);
    wordsFromFiles(r);
  });

  test("cash given as words that are no sum is not read, and nothing is recorded", async () => {
    const t = await rig();
    const r = await apply(t, [{ op: "set", at: "wren", key: "cash", value: "40 silver", ...SRC }]);
    expect(r.error).toBe(true);
    expect(texts(r).some((x) => x.includes("40 silver") && x.includes("a number, in the world's main coin"))).toBe(true);
    expect(t.s.changes(t.turn.id)).toEqual([]);
    wordsFromFiles(r);
  });
});

describe("pay", () => {
  test("a purchase pays the one named in to, not the market", async () => {
    const t = await rig();
    const before = t.s.stateAt(t.turn.id).state.world.accounts;
    const r = await apply(t, [{ op: "pay", who: "wren", to: "bram", amount: 3, goods: "Cask of cider", ...SRC }]);
    expect(r.error).toBeUndefined();
    const after = t.s.stateAt(t.turn.id).state.world.accounts;
    const gained = Object.keys(after).filter((id) => (after[id] ?? 0) > (before[id] ?? 0) && id !== "acct_wren");
    expect(gained).toEqual([`${EXTERNAL_ACCOUNT_PREFIX}bram`]);
    expect(after[`${EXTERNAL_ACCOUNT_PREFIX}bram`]).toBe(300);
    wordsFromFiles(r);
  });

  test("a payment the payer's money covers is not reported, and one it does not cover is, with what it held", async () => {
    const t = await rig();
    const covered = await apply(t, [{ op: "pay", who: "wren", to: "bram", amount: 3, for: "a mug of cider", ...SRC }]);
    expect(covered.error).toBeUndefined();
    expect(covered.reports).toBeUndefined();
    expect(t.s.stateAt(t.turn.id).state.world.accounts.acct_wren).toBe(900);

    const short = await apply(t, [{ op: "pay", who: "wren", to: "bram", amount: 50, for: "the horse", ...SRC }]);
    expect((dataOf(short).operations as JsonObject[])[0]?.applied).toBe(true);
    expect(short.reports).toEqual([expect.stringContaining("Wren [wren] paid $50.00 and could pay at most $9.00")]);
    wordsFromFiles(short);
  });
});
