// The money family's read tools on Port Alder (INC1-SPEC R3a): Jordan's accounts at the balances
// they open with, his cash and his debts; Marcus's money, which Jordan doesn't know and the narrator
// and the GM read whole; and what a latte costs at Bluebird Coffee, and everything Bluebird sells.

import { describe, expect, test } from "bun:test";
import { matchCatalog, placeTrade } from "../../src/packs/economy/core/index";
import { priceOf } from "../../src/packs/economy/core/model";
import { formatMoney } from "../../src/shared/world";
import { alderChat, answerOf, callTool, HOME, KNOWLEDGE, POV, toolEnv } from "../support/tools";

const JORDAN = "Jordan Ellis";
const HIDDEN = `${JORDAN} doesn't know that, and you read the world as ${JORDAN} knows it.`;

interface Amount {
  cents: number;
  amount: string;
}
interface Ref {
  id?: string;
  name: string;
}
interface Account extends Ref {
  class: string;
  role: string | null;
  cents: number;
  balance: string;
}
interface Balances {
  party: Ref;
  wealth?: string | null;
  cash?: Amount | { band: string } | null;
  accounts: Account[];
  owes: (Ref & Amount)[];
  notes?: unknown[];
}
interface Priced {
  place: Ref | null;
  item: string;
  price: (Amount & { catalog?: string; band: { min: Amount; typical: Amount; max: Amount }; sold: boolean }) | null;
}
interface Sells {
  place: Ref | null;
  sells: (Amount & { catalog: string })[];
}

describe("money_balances", () => {
  test("Jordan's money: his checking at the balance it opens with, his cash and what he owes, under each knowledge", async () => {
    const { rig, chatId } = await alderChat();
    const view = await toolEnv(rig, chatId, "gm").reader.view();
    const opening = (account: string): number => Number(view.state.entities[account]?.fields.opening);
    const money = (cents: number): string => formatMoney(cents, view.world.currency);
    // Nothing has opened his accounts yet: each shows the opening it will post.
    for (const account of ["acct_pov_checking", "acct_pov_cash", "acct_pov_auto_loan"]) expect(view.state.accounts[account] ?? 0).toBe(0);
    const wealth = view.read(() => view.ctx.query("wealth")(view.ctx, POV));
    for (const knowledge of KNOWLEDGE) {
      const m = await answerOf<Balances>(rig, chatId, knowledge, "money_balances");
      expect(m.party).toMatchObject({ id: POV, name: JORDAN });
      expect(m.accounts.find((a) => a.id === "acct_pov_checking")).toMatchObject({ class: "checking", role: "owner", cents: opening("acct_pov_checking"), balance: money(opening("acct_pov_checking")) });
      expect(m.cash).toEqual({ cents: opening("acct_pov_cash"), amount: money(opening("acct_pov_cash")) });
      expect(m.owes).toContainEqual(expect.objectContaining({ id: "acct_pov_auto_loan", cents: -opening("acct_pov_auto_loan"), amount: money(-opening("acct_pov_auto_loan")) }));
      expect(m.wealth).toBe(wealth);
      // The economy's notes are the GM's.
      expect(m.notes === undefined).toBe(knowledge !== "gm");
      // Named by name, the player character is the same.
      expect(await answerOf<Balances>(rig, chatId, knowledge, "money_balances", { person: JORDAN })).toEqual(m);
    }
  });

  test("Marcus's money is beyond Jordan's knowledge; the narrator and the GM read his checking and the mortgage he owes", async () => {
    const { rig, chatId } = await alderChat();
    const view = await toolEnv(rig, chatId, "gm").reader.view();
    const opening = (account: string): number => Number(view.state.entities[account]?.fields.opening);
    expect(await callTool(rig, chatId, "pov", "money_balances", { person: "Marcus Delgado" })).toEqual({ text: HIDDEN, error: true });
    for (const knowledge of ["everyone", "gm"] as const) {
      const m = await answerOf<Balances>(rig, chatId, knowledge, "money_balances", { person: "Marcus Delgado" });
      expect(m.party).toMatchObject({ id: "marcus_delgado", name: "Marcus Delgado" });
      expect(m.accounts.find((a) => a.id === "acct_marcus_checking")).toMatchObject({ role: "owner", cents: opening("acct_marcus_checking") });
      const mortgage = m.accounts.find((a) => a.id === "acct_marcus_mortgage");
      expect(mortgage?.cents).toBe(opening("acct_marcus_mortgage"));
      expect(mortgage?.cents).toBeLessThan(0);
      expect(m.owes).toContainEqual(expect.objectContaining({ id: "acct_marcus_mortgage", cents: -opening("acct_marcus_mortgage"), amount: formatMoney(-opening("acct_marcus_mortgage"), view.world.currency) }));
    }
  });
});

describe("money_prices", () => {
  test("a latte at Bluebird Coffee: its price there and its band, in words or by its catalog id, under each knowledge", async () => {
    const { rig, chatId } = await alderChat();
    const view = await toolEnv(rig, chatId, "gm").reader.view();
    const money = (cents: number): Amount => ({ cents, amount: formatMoney(cents, view.world.currency) });
    const latte = view.read(() => priceOf(view.ctx, { catalog: "latte_16oz", place: "bluebird_coffee" }));
    if (!latte) throw new Error("the catalog prices no latte");
    const said = view.read(() => matchCatalog(view.ctx, "latte", "bluebird_coffee"));
    expect(said).not.toBeNull();
    for (const knowledge of KNOWLEDGE) {
      const p = await answerOf<Priced>(rig, chatId, knowledge, "money_prices", { item: "latte_16oz", place: "Bluebird Coffee" });
      expect(p.place).toEqual({ id: "bluebird_coffee", name: "Bluebird Coffee" });
      expect(p.price).toMatchObject({ catalog: "latte_16oz", ...money(latte.unitCents), sold: true });
      expect(p.price?.band).toEqual({ min: money(latte.band.min), typical: money(latte.band.typical), max: money(latte.band.max) });
      const words = await answerOf<Priced>(rig, chatId, knowledge, "money_prices", { item: "latte", place: "Bluebird Coffee" });
      expect(words.price?.catalog).toBe(said ?? "");
    }
  });

  test("everything Bluebird Coffee sells, every one of it, priced there; Jordan prices where he is, and never at a place he can't see", async () => {
    const { rig, chatId } = await alderChat();
    const view = await toolEnv(rig, chatId, "gm").reader.view();
    const trade = view.read(() => placeTrade(view.ctx, "bluebird_coffee"));
    const rows = view.ctx.tables.get("economy.catalog")?.rows ?? {};
    const ids = Object.keys(rows).sort();
    const sold = trade.categories.flatMap((category) => ids.filter((id) => rows[id]?.category === category));
    expect(sold.length).toBeGreaterThan(0);
    for (const knowledge of KNOWLEDGE) {
      const s = await answerOf<Sells>(rig, chatId, knowledge, "money_prices", { place: "Bluebird Coffee" });
      expect(s.sells.map((o) => o.catalog)).toEqual(sold);
      for (const o of s.sells) expect(o.cents).toBe(view.read(() => priceOf(view.ctx, { catalog: o.catalog, place: "bluebird_coffee" }))?.unitCents ?? NaN);
    }
    // Where he is, by default: home sells nothing, and a latte has its price there all the same.
    const home = await answerOf<Priced>(rig, chatId, "pov", "money_prices", { item: "latte_16oz" });
    expect(home.place).toMatchObject({ id: HOME });
    expect(home.price?.sold).toBe(false);
    expect((await answerOf<Sells>(rig, chatId, "pov", "money_prices", {})).sells).toEqual([]);
    expect(await callTool(rig, chatId, "pov", "money_prices", { item: "latte_16oz", place: "12 Birch Lane" })).toEqual({ text: "No such place here: 12 Birch Lane.", error: true });
  });
});
