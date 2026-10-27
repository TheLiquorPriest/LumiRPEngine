// Purchases and money on the shipped packs (DESIGN §9.2, §9.5, §11): catalog rows that name the
// item, one purchase per item, unpriced purchases owned and priced from their chip, the cash ✎ as a balanced
// correction, the world's cap on narrated prices, and an action the helper couldn't read.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { splitAlongBuy } from "../../src/backend/runtime";
import { transientFailure } from "../../src/backend/steps";
import { lintWorld, migrateWorld } from "../../src/engine/authoring";
import { matchCatalog } from "../../src/packs/economy/core/index";
import { derivedUnpricedCap } from "../../src/packs/economy/core/model";
import { salesTaxOn } from "../../src/packs/economy/core/taxes";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { Rig } from "../support/rig";
import { heldBy } from "../../src/shared/finance";

const EXTRACT_MARK = "You read a narrator's roleplay reply";
const INTERPRET_MARK = "You map a player's typed input";

async function chat(template = "modern_slice_of_life"): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("World", template);
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

async function folded(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = state ? core?.worldAt(state.revision) : undefined;
  if (!state || !world) throw new Error("no state");
  return { state, world, ctx: rig.rt.registry.context(world, state) };
}

/** The "Bought …" charges on the POV's own accounts' journals, with what each charged. */
async function bought(rig: Rig, chatId: string): Promise<{ memo: string; cents: number }[]> {
  const { state, world } = await folded(rig, chatId);
  const journal = state.packs.economy?.journal;
  const out: { memo: string; cents: number; at: number }[] = [];
  for (const [account, entries] of Object.entries(journal && typeof journal === "object" && !Array.isArray(journal) ? journal : {})) {
    if (!heldBy(state.entities, account, world.pov)) continue;
    for (const j of Array.isArray(entries) ? entries : []) {
      if (!j || typeof j !== "object" || Array.isArray(j) || typeof j.memo !== "string" || !j.memo.startsWith("Bought ")) continue;
      out.push({ memo: j.memo, cents: typeof j.cents === "number" ? Math.abs(j.cents) : 0, at: typeof j.at === "number" ? j.at : 0 });
    }
  }
  return out.sort((x, y) => x.at - y.at).map(({ memo, cents }) => ({ memo, cents }));
}

/** A typed Buy of a $3 kazoo, and a reply the extractor reads as `narrated`. */
function script(rig: Rig, narrated: JsonObject[], interpret: () => string = () => JSON.stringify({ action: "buy", params: { item: "kazoo", price: 3 }, confidence: 0.9 })): void {
  rig.host.quietReply = (req) => {
    const prompt = req.messages.map((m) => m.content).join("\n");
    if (prompt.includes(INTERPRET_MARK)) return interpret();
    if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: narrated.map((p) => ({ type: "purchase", payer: "pov", ...p })) });
    return "{}";
  };
}

describe("a catalog row prices an item only when it names it", () => {
  test("whole words with the item's main noun: no tasting menu for a tin kazoo, no desk for a desk lamp, no drip coffee for a coffee machine", async () => {
    const { rig, chatId } = await chat();
    const { ctx, world } = await folded(rig, chatId);
    const name = (id: string | null): string => (id ? String(world.tables["economy.catalog"]?.rows[id]?.name ?? id) : "");
    expect(matchCatalog(ctx, "tin kazoo", null)).toBeNull();
    expect(name(matchCatalog(ctx, "chocolate bar", null))).not.toMatch(/cover charge/i);
    expect(name(matchCatalog(ctx, "coffee machine", null))).not.toMatch(/drip coffee/i);
    expect(name(matchCatalog(ctx, "coffees", null))).toMatch(/coffee/i);
    // Another kind of the thing isn't the thing: lantern oil is neither vegetable nor canola oil,
    // while a plain coffee is still the drip coffee row.
    expect(matchCatalog(ctx, "lantern oil", null)).toBeNull();
    expect(name(matchCatalog(ctx, "coffee", null))).toMatch(/^drip coffee/i);
    expect(name(matchCatalog(ctx, "whole milk", null))).toBe("Milk, whole");
    expect(name(matchCatalog(ctx, "desk lamp", null))).not.toBe("Desk");
  });

  test("a desk lamp typed at $25 costs $25 and its sales tax, and an automatic purchase's chip shows what it charged", async () => {
    const { rig, chatId } = await chat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { purchase: { mode: "auto" } } } }));
    script(rig, [{ item: "milk" }], () => JSON.stringify({ action: "buy", params: { item: "desk lamp", price: 25 }, confidence: 0.9 }));
    await rig.turn(chatId, "I buy a desk lamp for $25.", "The clerk rings it up, and you grab some milk too.");
    // At the top Money level the price is charged with Port Alder's sales tax, Michigan's 6%.
    expect((await bought(rig, chatId)).find((b) => b.memo === "Bought desk lamp")?.cents).toBe(2650);
    const undo = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "undo").map((c) => c.label);
    expect(undo).toEqual([expect.stringMatching(/^Bought milk: \$\d+\.\d{2} \(priced as Milk, whole\)/)]);
  });
});

describe("where the item is bought chooses between rows that name it alike", () => {
  /** A typed walk to `place` that buys `item` (`qty` of them) in the same turn: what the POV's history charged, and the sales tax it paid. */
  async function boughtAt(place: string, item: string, qty: number): Promise<{ memo: string; cents: number; tax: number }> {
    const { rig, chatId } = await chat();
    const taxAccount = "economy.external:tax:sales:mi";
    const taxBefore = (await folded(rig, chatId)).state.accounts[taxAccount] ?? 0;
    const buy = { action: "buy", params: { item, qty }, text: `I buy ${qty} ${item}` };
    rig.host.quietReply = (req) => (req.messages.map((m) => m.content).join("\n").includes(INTERPRET_MARK) ? JSON.stringify({ action: "go", params: { to: place }, confidence: 0.9, more: [buy] }) : "{}");
    await rig.turn(chatId, `I jog across to the ${place} and buy ${qty} ${item}.`, "You order at the counter.");
    expect(rig.rt.ledger.errors).toEqual([]);
    const charges = await bought(rig, chatId);
    expect(charges).toHaveLength(1);
    const { state } = await folded(rig, chatId);
    return { memo: charges[0]?.memo ?? "", cents: charges[0]?.cents ?? 0, tax: (state.accounts[taxAccount] ?? 0) - taxBefore };
  }

  test("two large coffees at Bluebird Coffee are two cafe drips, taxed as prepared food at Money 4", async () => {
    const got = await boughtAt("bluebird_coffee", "large coffee", 2);
    expect(got.memo).toBe("Bought Drip coffee, 12 oz, cafe ×2");
    expect(got.tax).toBeGreaterThan(0);
    expect(got.tax).toBe(salesTaxOn(got.cents - got.tax, 6));
  });

  test("coffee at Alder Market is a bag of ground coffee, which groceries' exemption leaves untaxed", async () => {
    for (const item of ["coffee", "large coffee"]) {
      const got = await boughtAt("alder_market", item, 1);
      expect(got.memo).toBe("Bought Coffee, ground");
      expect(got.tax).toBe(0);
    }
  });

  test("an item only one row names is that row wherever it's bought; a place that sells neither, or the purchase's own category, decides as before", async () => {
    const { rig, chatId } = await chat();
    const { ctx } = await folded(rig, chatId);
    for (const place of [null, "bluebird_coffee", "alder_market", "shoreline_fuel"]) {
      expect(matchCatalog(ctx, "ground coffee", place)).toBe("coffee_ground");
      expect(matchCatalog(ctx, "drip coffee", place)).toBe("coffee_drip_cafe");
      expect(matchCatalog(ctx, "large latte", place)).toBe("latte_16oz");
      expect(matchCatalog(ctx, "lantern oil", place)).toBeNull();
    }
    // Nowhere, at home or at the garage, nothing sold tells the kinds apart: the row that names the item outright stands.
    for (const place of [null, "harbor_street_114", "alder_automotive"]) expect(matchCatalog(ctx, "large coffee", place)).toBe("coffee_ground");
    expect(matchCatalog(ctx, "large coffee", "bluebird_coffee", "groceries_staples")).toBe("coffee_ground");
  });
});

describe("a world with its own currency prices a category in it", () => {
  // A meat pie no catalog row names, priced by its category: bits in Brindlemere, pence in Harrowmere.
  for (const [template, min, max] of [["fantasy_town", 2, 20], ["mystery_manor", 6, 120]] as const) {
    test(`${template}: a meal by its category costs what a meal costs there, and the cap is in the same money`, async () => {
      const { rig, chatId } = await chat(template);
      const { world } = await folded(rig, chatId);
      expect(derivedUnpricedCap(world)).toBeLessThan(10_000);
      rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { purchase: { mode: "auto" } } } }));
      script(rig, [{ item: "meat pie", category: "meals_out" }], () => JSON.stringify({ action: "buy", params: { item: "kazoo", price: 3 }, confidence: 0.9 }));
      await rig.turn(chatId, "I buy a kazoo for 3.", "You eat a meat pie at the stall.");
      // Priced by its category, the purchase takes the category's name; the other charge is the kazoo.
      const pie = (await bought(rig, chatId)).find((b) => b.memo !== "Bought kazoo");
      expect(pie?.cents).toBeGreaterThanOrEqual(min);
      expect(pie?.cents).toBeLessThanOrEqual(max);
    });
  }
});

describe("one purchase per item", () => {
  test("a narrated 'coffee and bran muffin' after a coffee Buy keeps the muffin alone, without the pair's price; 'fish and chips' stays whole", async () => {
    const { rig, chatId } = await chat();
    const { ctx } = await folded(rig, chatId);
    const pre = [{ type: "economy.txn", data: { memo: "Bought Drip coffee, 12 oz, cafe", lines: [{ account: "acct_pov_cash", amount: -296 }] } } as LedgerEvent];
    const parts = splitAlongBuy({ type: "purchase", item: "coffee and bran muffin", price: 700, payer: "pov" }, pre, ctx);
    expect(parts.map((p) => p.item)).toEqual(["bran muffin"]);
    expect(parts[0]?.price).toBeUndefined();
    const whole = { type: "purchase", item: "fish and chips", price: 900, payer: "pov" };
    expect(splitAlongBuy(whole, pre, ctx)).toEqual([whole]);
  });
});

describe("a narrated purchase nothing prices", () => {
  test("asks to make it the player's with nothing charged, or at the price the player sets", async () => {
    const { rig, chatId } = await chat();
    script(rig, [{ item: "tin whistle" }]);
    await rig.turn(chatId, "I buy a kazoo for $3.", "You also pocket a tin whistle.");
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.label.startsWith("Bought tin whistle"));
    // Nothing in the catalog is called a whistle, so there's no item to pick here: a price, Apply or No.
    expect(chip?.actions.map((a) => a.id)).toEqual(["price", "confirm", "reject"]);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id ?? "", choice: "price", payload: { cents: 450 } }));
    expect((await bought(rig, chatId)).find((b) => b.memo === "Bought tin whistle")?.cents).toBe(477);
  });

  test("a narrated price is capped at the world's cap, and the chip says so and lets the player edit it", async () => {
    const { rig, chatId } = await chat();
    const { world } = await folded(rig, chatId);
    const rows = Object.values(world.tables["economy.catalog"]?.rows ?? {});
    const cap = Math.max(...rows.map((row) => (row.price_cents && typeof row.price_cents === "object" && !Array.isArray(row.price_cents) && typeof row.price_cents.max === "number" ? row.price_cents.max : 0)));
    // Enough cash that the capped price is affordable.
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: world.pov, field: "cash", value: cap * 3 }));
    script(rig, [{ item: "antique astrolabe", price: (cap * 2) / 100 }]);
    await rig.turn(chatId, "I buy a kazoo for $3.", "You also buy an antique astrolabe.");
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.label.startsWith("Bought antique astrolabe"));
    expect(chip?.label).toMatch(/narrated .*capped at/);
    const amount = chip?.actions.find((a) => a.input?.type === "money");
    expect(amount).toBeDefined();
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id ?? "", choice: amount?.id ?? "", payload: { cents: cap + 100 } }));
    expect((await bought(rig, chatId)).find((b) => b.memo === "Bought antique astrolabe")?.cents).toBe(Math.round((cap + 100) * 1.06));
  });
});

describe("the cash ✎ corrects cash with a balanced posting", () => {
  test("cash becomes the amount, the books still balance, and it stays a fix", async () => {
    const { rig, chatId } = await chat();
    const { world } = await folded(rig, chatId);
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: world.pov, field: "cash", value: 1234 }));
    const { state } = await folded(rig, chatId);
    expect(state.accounts.acct_pov_cash).toBe(1234);
    const journal = state.packs.economy?.journal;
    const cash = journal && typeof journal === "object" && !Array.isArray(journal) ? journal.acct_pov_cash : undefined;
    expect((Array.isArray(cash) ? cash : []).some((j) => !!j && typeof j === "object" && !Array.isArray(j) && j.memo === "Correction")).toBe(true);
  });
});

describe("an action the helper couldn't read", () => {
  test("a dropped connection is asked once more", async () => {
    expect(transientFailure(new Error("ECONNRESET"))).toBe(true);
    expect(transientFailure(new Error("Provider error (503)"))).toBe(true);
    expect(transientFailure(new Error("Unexpected token in JSON"))).toBe(false);
    const { rig, chatId } = await chat();
    let calls = 0;
    script(rig, [], () => {
      calls++;
      if (calls === 1) throw new Error("ECONNRESET");
      return JSON.stringify({ action: "buy", params: { item: "kazoo", price: 3 }, confidence: 0.9 });
    });
    await rig.turn(chatId, "I buy a kazoo for $3.", "The clerk rings it up.");
    expect(calls).toBe(2);
    expect((await bought(rig, chatId)).map((b) => b.memo)).toEqual(["Bought kazoo"]);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "read_failed")).toBe(false);
  });

  test("still failing after its retries, it stops the engine run: nothing is generated, and the flag's Retry reads it again", async () => {
    const { rig, chatId } = await chat();
    let down = true;
    script(rig, [], () => {
      if (down) throw new Error("ECONNRESET");
      return JSON.stringify({ action: "buy", params: { item: "kazoo", price: 3 }, confidence: 0.9 });
    });
    rig.host.sendUser(chatId, "I buy a kazoo for $3.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(g.halted).toBe("cancelled");
    expect(rig.host.chat(chatId).messages.at(-1)?.isUser).toBe(true);
    const flag = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "engine_failed");
    expect(flag?.detail).toBe("Reading your action: ECONNRESET (after 2 retries)");
    expect(flag?.actions.map((a) => a.id)).toEqual(["regenerate", "diagnostics"]);
    // The connection is back: Retry (Lumiverse's Regenerate) runs the engine again, then the reply.
    down = false;
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    await rig.host.finish(reply, "The clerk rings it up.");
    expect((await bought(rig, chatId)).map((b) => b.memo)).toEqual(["Bought kazoo"]);
  });
});

describe("the cap on narrated prices", () => {
  test("an old world's unpricedCapCents becomes unpricedCap once", async () => {
    const { rig, chatId } = await chat();
    const { world } = await folded(rig, chatId);
    const migrated = migrateWorld({ ...world, packs: { ...world.packs, economy: { version: 1, config: { unpricedCapCents: 1000 } } } });
    expect(migrated.packs.economy?.config).toEqual({ unpricedCap: 1000 });
  });

  test("a cap that isn't a positive whole number of minor units is a warning on its field; a valid or unset one is not", async () => {
    const { rig, chatId } = await chat();
    const { world } = await folded(rig, chatId);
    const issues = (cap: JsonValue | undefined) => lintWorld({ ...world, packs: { ...world.packs, economy: { version: 1, config: cap === undefined ? {} : { unpricedCap: cap } } } }, rig.rt.registry).filter((i) => i.path === "packs.economy.config.unpricedCap");
    for (const bad of [0, -500, 12.5, "500"]) expect(issues(bad).map((i) => i.severity)).toEqual(["warning"]);
    for (const good of [undefined, 1, 25_000]) expect(issues(good)).toEqual([]);
  });
});
