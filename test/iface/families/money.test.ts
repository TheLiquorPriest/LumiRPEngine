// Money on an invented world: each tool is found by its own words, is called, applies and answers in
// full (a price is read and changes nothing); a correction that takes an account below nothing is
// applied and reported.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { MONEY_TOOLS } from "../../../src/iface/families/money";
import { dataOf } from "../rig";
import { appliedInFull, descriptions, eachFoundByItsWords, familyRig, opOf, searchByWords, SRC, wordsFromFiles } from "./kit";

const NAMES = MONEY_TOOLS.map((t) => t.name);
const BANKED = (w: { realism: { levels: Record<string, number> } }): void => {
  w.realism.levels.money = 3;
};

describe("money", () => {
  test("every tool is found by a search on its own words, and a price by the word", async () => {
    expect(NAMES).toEqual(["gm_adjust_money", "open_account", "close_account", "apply_credit", "tax_status", "donate", "money_prices"]);
    await eachFoundByItsWords(NAMES);
    expect(searchByWords("price", await descriptions())).toContain("money_prices");
    expect(searchByWords("loan", await descriptions())).toContain("apply_credit");
  });

  test("each tool is called, applies, and answers with what changed and how it stands", async () => {
    const t = await familyRig(BANKED);
    const world = () => t.s.stateAt(t.turn.id).state.world;

    const opened = appliedInFull(await t.call("open_account", { who: "wren", product: "savings", name: "Wren's savings", ...SRC }), "engine");
    const made = (opened.changed as JsonObject[]).find((c) => c.name === "Wren's savings");
    expect(made?.new).toBe(true);
    const id = String(made?.at).replace(/^entity:/, "");

    const closed = await t.call("close_account", { account: id, ...SRC });
    appliedInFull(closed, "engine", false);
    expect(opOf(closed).status).toBe("closed");

    const loan = appliedInFull(await t.call("apply_credit", { who: "wren", product: "loan", amount: 40, term: 12, ...SRC }), "engine");
    expect((loan.changed as JsonObject[]).some((c) => (c.now as JsonObject).product === "loan")).toBe(true);

    appliedInFull(await t.call("tax_status", { org: "lamplighters", status: "charity", ...SRC }), "engine");
    expect(world().entities.lamplighters?.fields.tax_exempt).toBe("charity");

    const before = world().accounts.acct_wren ?? 0;
    appliedInFull(await t.call("donate", { to: "lamplighters", amount: 1, from: "wren", ...SRC }), "engine");
    appliedInFull(await t.call("gm_adjust_money", { account: "Wren's coin", amount: 5, ...SRC }), "engine");
    expect(world().accounts.acct_wren).toBe(before - 100 + 500);

    const changes = t.s.changes(t.turn.id).length;
    const priced = await t.call("money_prices", { item: "bread" });
    expect(priced.error).toBeUndefined();
    const price = dataOf(priced).price as JsonObject;
    expect(price.cents).toBeGreaterThan(0);
    expect(typeof price.amount).toBe("string");
    expect(t.s.changes(t.turn.id).length).toBe(changes);
    wordsFromFiles(priced);
  });

  test("a correction that takes an account below nothing is applied and reported", async () => {
    const t = await familyRig(BANKED);
    const r = await t.call("gm_adjust_money", { account: "acct_wren", amount: -50, ...SRC });
    appliedInFull(r, "engine");
    expect((r.reports ?? []).some((x) => x.includes("could pay at most"))).toBe(true);
    expect(t.s.stateAt(t.turn.id).state.world.accounts.acct_wren ?? 0).toBeLessThan(0);
  });
});
