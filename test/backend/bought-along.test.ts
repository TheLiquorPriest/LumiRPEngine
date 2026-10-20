// A reply that tells the turn's own Buy again offers no second purchase. Names compare after
// normalizing: lowercase, a catalog name's "Noun, qualifier" read as its noun with the qualifier's
// words kept for overlap, a trailing "for/to/from/at/with/in/on …" phrase dropped, articles and stop
// words dropped, plurals made singular. It is the same purchase when one name's words hold all of the
// other's, or when the head noun matches and the shorter name shares at least 2/3 of its words; either
// way with any stated price within ±25% of what the Buy charged, of the price the player typed for it,
// or of its catalog row's range. The same head noun at an equal stated price is the same purchase too.
// Anything else keeps its chip, and a purchase's confirm chip shows what it charges.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { ReadContext } from "../../src/engine/registry";
import type { LedgerEvent } from "../../src/shared/ledger";
import { toChain } from "../../src/backend/ledger-io";
import { boughtAlong } from "../../src/backend/runtime";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "propose concrete state changes";

/** The "Bought …" lines a chat's payer history records, one per charge, with what each charged. */
async function boughtLines(rig: Rig, chatId: string): Promise<{ memo: string; cents: number }[]> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  // The journal keeps each posting's line per account, under the posting's id: one purchase is the lines sharing an id.
  const journal = state.packs.economy?.journal;
  const byId = new Map<string, { memo: string; cents: number; at: number }>();
  for (const entries of Object.values(journal && typeof journal === "object" && !Array.isArray(journal) ? journal : {})) {
    for (const j of Array.isArray(entries) ? entries : []) {
      if (!j || typeof j !== "object" || Array.isArray(j) || typeof j.memo !== "string" || !j.memo.startsWith("Bought ") || typeof j.id !== "string") continue;
      const seen = byId.get(j.id) ?? { memo: j.memo, cents: 0, at: typeof j.at === "number" ? j.at : 0 };
      seen.cents += typeof j.cents === "number" ? Math.abs(j.cents) : 0;
      byId.set(j.id, seen);
    }
  }
  return [...byId.entries()].sort((x, y) => x[1].at - y[1].at || x[0].localeCompare(y[0])).map(([, v]) => ({ memo: v.memo, cents: v.cents }));
}

/**
 * A typed Buy of `bought` (at `price` dollars, `qty` of them) in a fresh Port Alder chat, and a reply
 * the extractor reads as the purchase `narrated` (none when null): the purchase chips left and the
 * "Bought …" lines the payer's history records, one per charge. `auto` sets purchases to automatic.
 */
async function after(bought: string, narrated: JsonObject | null, opts: { price?: number; qty?: number; auto?: boolean } = {}) {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  if (opts.auto) rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { purchase: { mode: "auto" } } } }));
  const params: JsonObject = { item: bought, ...(opts.price !== undefined ? { price: opts.price } : {}), ...(opts.qty !== undefined ? { qty: opts.qty } : {}) };
  const proposals = narrated ? [{ type: "purchase", payer: "pov", ...narrated }] : [];
  rig.host.quietReply = (req) => {
    const prompt = req.messages[0]?.content ?? "";
    if (prompt.includes("You map a player's typed input")) return JSON.stringify({ action: "buy", params, confidence: 0.9 });
    if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals });
    return "{}";
  };
  await rig.turn(chatId, `I buy ${opts.qty ?? "a"} ${bought}${opts.price !== undefined ? ` for $${opts.price}` : ""}.`, "The clerk rings it up.");
  const view = await rig.rt.view(chatId, rig.host.userId);
  expect(rig.rt.ledger.errors).toEqual([]);
  const lines = await boughtLines(rig, chatId);
  const chips = view.chips.filter((c) => c.kind === "confirm" || c.kind === "decline");
  return { chips: chips.map((c) => c.label), chipIds: chips.map((c) => c.id), memos: lines.map((l) => l.memo), lines, rig, chatId };
}

/** The purchase chips a reply that tells `narrated` (a household purchase) leaves after a typed Buy of `bought` at `price` dollars. */
async function chipsAfter(bought: string, price: number, narrated: JsonObject) {
  return (await after(bought, { category: "household", ...narrated }, { price })).chips;
}

describe("a narrated purchase that tells the turn's own Buy again", () => {
  test("'leather card holder' told for a typed 'credit card holder' may be the Buy or another one: it asks instead of charging or dropping it", async () => {
    expect(await chipsAfter("credit card holder", 12, { item: "leather card holder" })).toEqual([expect.stringMatching(/^Also bought leather card holder\b/)]);
    expect(await chipsAfter("credit card holder", 12, { item: "leather card holder", price: 12 })).toEqual([expect.stringMatching(/^Also bought leather card holder\?/)]);
    expect(await chipsAfter("credit card holder", 12, { item: "slim leather holder", price: 12 })).toEqual([expect.stringMatching(/^Also bought slim leather holder\?/)]);
  });

  // Shaped like "decaf coffee for Danny, $4.50" after a typed $3 coffee, with an item the catalog
  // doesn't price, so the Buy costs exactly the $3 typed (a catalogued coffee costs the catalog's price).
  // At the top Money level a chip shows the price with its sales tax (Michigan's 6% in Port Alder).
  test("the same head noun at a price more than 25% off asks: a $4.50 'tin kazoo' after a typed $3 kazoo", async () => {
    expect(await chipsAfter("kazoo", 3, { item: "tin kazoo", price: 4.5 })).toEqual([expect.stringMatching(/^Also bought tin kazoo\?.*\$4\.77/)]);
    expect(await chipsAfter("kazoo", 3, { item: "tin kazoo", price: 3.5 })).toEqual([]);
  });

  test("a different head noun keeps its chip: 'lantern oil' after a typed lantern, 'credit card reader' after a holder", async () => {
    // No catalog row is lantern oil, so the narrated $6 is its price.
    expect(await chipsAfter("lantern", 40, { item: "lantern oil", price: 6 })).toEqual(["Bought lantern oil: $6.36"]);
    expect(await chipsAfter("credit card holder", 12, { item: "credit card reader", price: 12 })).toEqual([expect.stringMatching(/^Bought credit card reader: /)]);
  });

  test("a trailing 'for …', 'to …' or 'from …' phrase on either name doesn't change the thing bought", async () => {
    expect((await after("bus ticket", { item: "bus ticket to Boston", price: 40 }, { price: 40 })).chips).toEqual([]);
    expect((await after("bus ticket", { item: "bus ticket to Boston" }, { price: 40 })).chips).toEqual([]);
    expect((await after("sandwich", { item: "sandwich for lunch" })).chips).toEqual([]);
    expect((await after("lantern from the market", { item: "lantern", price: 40 }, { price: 40 })).chips).toEqual([]);
  });

  test("a catalog name's 'Noun, qualifier' reads as the noun with its qualifier: 'whole milk' after a Buy charged as 'Milk, whole'", async () => {
    const got = await after("milk", { item: "whole milk" });
    expect(got.memos).toEqual(["Bought Milk, whole"]);
    expect(got.chips).toEqual([]);
  });

  test("a plural tells the same Buy: 'coffees' after 'Coffee ×2'", async () => {
    const got = await after("coffee", { item: "coffees" }, { qty: 2 });
    expect(got.memos).toHaveLength(1);
    expect(got.memos[0]).toMatch(/^Bought .*coffee.* ×2$/i);
    expect(got.chips).toEqual([]);
  });
});

describe("a narrated purchase of a sibling of the turn's Buy", () => {
  // "Coffee" priced as Drip coffee is in the Latte's group of the price table: the reply may be
  // naming the latte the player bought, so it asks rather than charging a second drink.
  test("'coffee' after a typed latte asks whether it was bought too, unless it's another one, for someone, or another quantity", async () => {
    const sibling = await after("latte", { item: "coffee", category: "coffee" });
    expect(sibling.memos).toEqual(["Bought Latte, 16 oz"]);
    expect(sibling.chips).toEqual([expect.stringMatching(/^Also bought coffee\?/)]);
    const others: JsonObject[] = [{ item: "another coffee" }, { item: "coffee for Danny" }, { item: "coffee", qty: 2 }];
    for (const narrated of others) {
      const chips = (await after("latte", { ...narrated, category: "coffee" })).chips;
      expect(chips).toHaveLength(1);
      expect(chips[0]).toMatch(/^Bought /);
    }
  });
});

describe("with purchases on auto, a reply that tells a catalog-matched Buy again charges it once", () => {
  const cases: { typed: string; price?: number; narrated: JsonObject; charged: string }[] = [
    { typed: "milk", narrated: { item: "milk" }, charged: "Bought Milk, whole" },
    { typed: "large pizza, delivered", price: 18, narrated: { item: "pizza", price: 18 }, charged: "Bought Pizza, large 14-16 in, delivered" },
    { typed: "sandwich for lunch", narrated: { item: "sandwich" }, charged: "Bought Deli sandwich" },
  ];
  for (const c of cases) {
    test(`'${c.narrated.item}' after a typed '${c.typed}' (charged as '${c.charged.slice("Bought ".length)}')`, async () => {
      const priced = c.price !== undefined ? { price: c.price } : {};
      const once = await after(c.typed, null, { ...priced, auto: true });
      const told = await after(c.typed, c.narrated, { ...priced, auto: true });
      expect(once.memos).toEqual([c.charged]);
      expect(told.memos).toEqual([c.charged]);
      expect(told.chips).toEqual([]);
    });
  }
});

/** A history line for a Buy recorded as `memo` that charged `cents`. */
function bought(memo: string, cents: number): LedgerEvent {
  return { type: "economy.txn", data: { memo, lines: [{ account: "acct_pov_cash", amount: -cents }] } } as LedgerEvent;
}

/** A narrated purchase of `item` at `dollars`, in minor units as the read gives it. */
function purchase(item: string, dollars: number): JsonObject {
  return { type: "purchase", item, price: Math.round(dollars * 100), payer: "pov" };
}

/** A Port Alder chat's read context after a typed Buy, as the comparisons read it: both tests read the same one, so it plays once. */
let read: Promise<ReadContext> | null = null;
function afterBuy(): Promise<ReadContext> {
  read ??= (async () => {
    const { rig, chatId } = await after("newspaper", null);
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
    const world = state ? core?.worldAt(state.revision) : undefined;
    if (!state || !world) throw new Error("no state");
    return rig.rt.registry.context(world, state);
  })();
  return read;
}

describe("a stated price is the Buy's when it is within ±25% of what it charged, the price the player typed, or its catalog row's range", () => {
  test("the Buy told again drops; another noun is a new purchase; the same noun at a price off the Buy's asks", async () => {
    const ctx = await afterBuy();
    // A typed $9 sandwich charged $2.43, a typed $3 coffee charged $5.38, a typed $5 milk charged
    // $3.63, a typed $6 pair of coffees charged $10.76.
    expect(boughtAlong(purchase("sandwich", 9), [bought("Bought Deli sandwich", 243)], ctx, [900])).toBe("retold");
    expect(boughtAlong(purchase("coffee", 3), [bought("Bought Coffee", 538)], ctx, [300])).toBe("retold");
    expect(boughtAlong(purchase("milk", 5), [bought("Bought Milk, whole", 363)], ctx, [500])).toBe("retold");
    expect(boughtAlong(purchase("coffees", 6), [bought("Bought Coffee ×2", 1076)], ctx, [600])).toBe("retold");
    // Without a typed price, the catalog row's range: $7.50 is inside "Milk, whole"'s.
    expect(boughtAlong(purchase("milk", 7.5), [bought("Bought Milk, whole", 363)], ctx)).toBe("retold");
    // A sandwich is not a loaf of bread, and lantern oil is oil, not the lantern: new purchases.
    expect(boughtAlong(purchase("sandwich", 9), [bought("Bought Bread, white sandwich loaf", 243)], ctx)).toBeNull();
    expect(boughtAlong(purchase("lantern oil", 6), [bought("Bought lantern", 4000)], ctx, [4000])).toBeNull();
    // The same noun at a price far from the Buy's, with no catalog row: maybe the Buy, maybe not.
    expect(boughtAlong(purchase("tin kazoo", 4.5), [bought("Bought kazoo", 300)], ctx, [300])).toBe("unsure");
  });

  test("another one, one for someone, a different quantity or a ruled-out qualifier is a new purchase", async () => {
    const ctx = await afterBuy();
    const coffee = [bought("Bought Coffee", 538)];
    expect(boughtAlong(purchase("another coffee", 5.38), coffee, ctx)).toBeNull();
    expect(boughtAlong(purchase("second coffee", 5.38), coffee, ctx)).toBeNull();
    expect(boughtAlong({ ...purchase("coffee", 5.38), qty: 2 }, coffee, ctx)).toBeNull();
    expect(boughtAlong(purchase("green apple", 1), [bought("Bought red apple", 100)], ctx)).toBeNull();
    // Told as another in the narration beside a price that fits: asked, not dropped.
    expect(boughtAlong(purchase("coffee", 5.38), coffee, ctx, [], "She pours you another coffee and you pay for it.")).toBe("unsure");
  });
});

describe("with fixed seeds, a reply that repeats the player's typed price for a catalogued Buy charges it once", () => {
  // Every id and seed the rig draws comes from this counter, so each Buy's catalog price is the same every run.
  let n = 0;
  let restore: (() => void) | null = null;
  beforeEach(() => {
    n = 0;
    const spy = spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-a${String(++n).padStart(11, "0")}` as `${string}-${string}-${string}-${string}-${string}`);
    restore = () => spy.mockRestore();
  });
  afterEach(() => restore?.());

  // `near`: the catalog's price is within 25% of the typed one, so either match drops the retelling.
  const cases: { typed: string; price: number; qty?: number; narrated: string; charged: string; near?: boolean }[] = [
    { typed: "sandwich", price: 9, narrated: "sandwich", charged: "Bought Deli sandwich" },
    { typed: "coffee", price: 3, narrated: "coffee", charged: "Bought Drip coffee, 12 oz, cafe", near: true },
    { typed: "milk", price: 5, narrated: "milk", charged: "Bought Milk, whole" },
    { typed: "coffee", price: 6, qty: 2, narrated: "coffees", charged: "Bought Drip coffee, 12 oz, cafe ×2", near: true },
  ];
  for (const c of cases) {
    test(`'${c.narrated}' at the typed $${c.price} after a typed '${c.typed}' (charged as '${c.charged.slice("Bought ".length)}')`, async () => {
      const opts = { price: c.price, ...(c.qty !== undefined ? { qty: c.qty } : {}) };
      const told = await after(c.typed, { item: c.narrated, price: c.price }, { ...opts, auto: true });
      expect(told.memos).toEqual([c.charged]);
      // The charge is the catalog's, more than 25% off the typed price, so only the typed price matches.
      if (!c.near) expect(Math.abs((told.lines[0]?.cents ?? 0) - c.price * 100)).toBeGreaterThan(0.25 * (told.lines[0]?.cents ?? 0));
      expect(told.chips).toEqual([]);
    });
  }

  test("in confirm mode, 'coffees' at $6 after a typed 'Coffee ×2' at $6 offers no chip", async () => {
    const got = await after("coffee", { item: "coffees", price: 6 }, { price: 6, qty: 2 });
    expect(got.memos).toEqual([expect.stringMatching(/^Bought .*coffee.* ×2$/i)]);
    expect(got.chips).toEqual([]);
  });
});

describe("a purchase's confirm chip", () => {
  test("shows the amount it charges and the catalog item it's priced as, and Apply charges that amount", async () => {
    const got = await after("kazoo", { item: "milk" }, { price: 3 });
    expect(got.chips).toHaveLength(1);
    const shown = /^Bought milk: \$(\d+\.\d{2}) \(priced as Milk, whole\)$/.exec(got.chips[0] ?? "");
    expect(shown).not.toBeNull();
    got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: got.chipIds[0], choice: "confirm" }));
    const lines = await boughtLines(got.rig, got.chatId);
    expect(lines.map((l) => l.memo)).toEqual(["Bought kazoo", "Bought Milk, whole"]);
    expect((lines[1]?.cents ?? 0) / 100).toBe(Number(shown?.[1]));
  });
});
