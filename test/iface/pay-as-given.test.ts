// `pay` moves what it is told, from the way it names, to the one named, and adds nothing of its own:
// the way is a fixed one or one of the payer's own by id or exact name (nothing read from words), a
// closed or short way pays all the same and says so, money into one's own card moves whole, goods
// that are a recorded thing change hands and any others stay words, and the world's terms come only
// when asked.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { WorldDoc } from "../../src/shared/world";
import { dataOf, rig, texts, world, wordsFromFiles } from "./rig";

const PROSE = { source: { from: "prose", message: "m-12" }, standing: "established", precision: "exact" };

type Entity = WorldDoc["entities"][string];

/** The rig's world with a checking account (closed), a card that owes $200, and a lantern in Bram's hands, all Wren's or Bram's own. */
function moneyWorld(): WorldDoc {
  const w = world();
  const base = w.entities.acct_wren as Entity;
  const account = (id: string, name: string, fields: JsonObject): Entity => ({ ...base, id, name, fields: { owners: [{ party: "wren", role: "owner" }], ...fields }, relations: [] }) as Entity;
  w.entities.acct_chk = account("acct_chk", "Wren's checking", { product: "checking", opening: 5000, status: "closed" });
  w.entities.acct_visa = account("acct_visa", "Wren's Visa", { product: "credit_card", opening: -20000 });
  w.entities.lantern = { ...(w.entities.knife as Entity), id: "lantern", name: "Lantern", relations: [{ type: "in", to: "bram" }] } as Entity;
  return w;
}

async function pay(args: JsonObject, doc: WorldDoc = moneyWorld()) {
  const t = await rig({}, doc);
  const r = await t.call("world_apply", { operations: [{ op: "pay", ...args, ...PROSE }] });
  return { t, r, accounts: () => t.s.stateAt(t.turn.id).state.world.accounts, world: () => t.s.stateAt(t.turn.id).state.world };
}

describe("pay as given", () => {
  test("a method that is not a way is refused with Wren's ways; her account's id pays from it, closed and short, and says so", async () => {
    const bad = await pay({ who: "wren", to: "bram", amount: 3, method: "my Visa" });
    expect(bad.r.error).toBe(true);
    expect(texts(bad.r).join(" ")).toContain("Wren's Visa [acct_visa]");
    wordsFromFiles(bad.r);
    const closed = await pay({ who: "wren", to: "bram", amount: 90, method: "acct_chk" });
    expect(closed.r.error).toBeUndefined();
    expect(closed.accounts().acct_chk).toBe(5000 - 9000);
    expect(closed.r.reports?.join(" ")).toContain("Wren's checking [acct_chk] is closed");
    wordsFromFiles(closed.r);
  });

  test("who the purse is is refused with give named", async () => {
    const { r } = await pay({ who: "purse", to: "bram", amount: 3 });
    expect(r.error).toBe(true);
    expect(texts(r).join(" ")).toContain("give");
    wordsFromFiles(r);
  });

  test("500 paid into a card that owes 200 moves 500 and reports 300 past what was owed", async () => {
    const { r, accounts } = await pay({ who: "wren", to: "acct_visa", amount: 5, method: "acct_wren" });
    expect(r.error).toBeUndefined();
    expect(accounts().acct_visa).toBe(-20000 + 500);
    expect(r.reports).toBeUndefined();
    const big = await pay({ who: "wren", to: "acct_visa", amount: 250, method: "acct_wren" });
    expect(big.accounts().acct_visa).toBe(-20000 + 25000);
    expect(big.r.reports?.join(" ")).toContain("$50.00 past what was owed");
    wordsFromFiles(big.r);
  });

  test("goods naming the seller's lantern hand it to the payer as sold; goods that name nothing keep the words", async () => {
    const lantern = await pay({ who: "wren", to: "bram", amount: 2, goods: "Lantern" });
    expect(lantern.r.error).toBeUndefined();
    expect(lantern.world().entities.lantern?.relations).toContainEqual({ type: "in", to: "wren" });
    expect(lantern.r.reports).toBeUndefined();
    const meal = await pay({ who: "wren", to: "bram", amount: 2, goods: "a hot meal" });
    expect(meal.r.error).toBeUndefined();
    expect(Object.keys(meal.world().entities).length).toBe(Object.keys(moneyWorld().entities).length);
    expect(meal.r.reports?.join(" ")).toContain("a hot meal");
    wordsFromFiles(meal.r);
  });

  test("qty 0 is refused naming qty; a payment with no for carries no memo of code's; at Money 0 it is recorded", async () => {
    const q = await pay({ who: "wren", to: "bram", amount: 3, qty: 0 });
    expect(q.r.error).toBe(true);
    expect(texts(q.r).join(" ")).toContain("qty");
    const doc = moneyWorld();
    doc.realism.levels.money = 0;
    const zero = await pay({ who: "tam", to: "bram", amount: 3 }, doc);
    expect(zero.r.error).toBeUndefined();
    expect(zero.accounts()["economy.external:bram"]).toBe(300);
    const memo = JSON.stringify(zero.t.s.changes(zero.t.turn.id).map((c) => c.value));
    expect(memo).not.toContain("Payment");
  });

  test("a payment posts the amount alone; with world_terms it may bring the world's sums, each its own change as assumed", async () => {
    const plain = await pay({ who: "wren", to: "bram", amount: 3, for: "a mug of cider" });
    const posts = plain.t.s.changes(plain.t.turn.id).filter((c) => c.op === "post");
    expect(posts.length).toBe(1);
    const termed = await pay({ who: "wren", to: "bram", amount: 3, for: "a mug of cider", world_terms: true });
    expect(termed.r.error).toBeUndefined();
    for (const c of termed.t.s.changes(termed.t.turn.id).filter((c) => c.op === "post").slice(1)) {
      expect(c.source).toBe("default");
      expect(c.standing).toBe("assumed");
    }
    expect(dataOf(termed.r).operations).toBeDefined();
  });
});
