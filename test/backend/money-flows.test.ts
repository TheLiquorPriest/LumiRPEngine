// Purchases and money on the shipped packs (DESIGN §9.2, §9.5, §11): catalog rows that name the
// item, one purchase per item, unpriced purchases priced from their chip, the cash ✎ as a balanced
// correction, the world's cap on narrated prices, and an action the helper couldn't read.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { splitAlongBuy } from "../../src/backend/runtime";
import { transientFailure } from "../../src/backend/steps";
import { migrateWorld } from "../../src/engine/authoring";
import { matchCatalog } from "../../src/packs/economy/core/index";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "You read a narrator's roleplay reply";
const INTERPRET_MARK = "You map a player's typed input";

async function chat(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
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

/** The "Bought …" charges the payer's history records, with what each charged. */
async function bought(rig: Rig, chatId: string): Promise<{ memo: string; cents: number }[]> {
  const { state } = await folded(rig, chatId);
  const history = state.packs.economy?.history;
  return (Array.isArray(history) ? history : []).flatMap((h) => {
    if (!h || typeof h !== "object" || Array.isArray(h) || typeof h.memo !== "string" || !h.memo.startsWith("Bought ")) return [];
    const lines = Array.isArray(h.lines) ? h.lines : [];
    return [{ memo: h.memo, cents: lines.reduce((sum: number, l) => sum + (l && typeof l === "object" && !Array.isArray(l) && typeof l.amount === "number" ? Math.abs(l.amount) : 0), 0) }];
  });
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

  test("a desk lamp typed at $25 costs $25, and an automatic purchase's chip shows what it charged", async () => {
    const { rig, chatId } = await chat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { purchase: { mode: "auto" } } } }));
    script(rig, [{ item: "milk" }], () => JSON.stringify({ action: "buy", params: { item: "desk lamp", price: 25 }, confidence: 0.9 }));
    await rig.turn(chatId, "I buy a desk lamp for $25.", "The clerk rings it up, and you grab some milk too.");
    expect((await bought(rig, chatId)).find((b) => b.memo === "Bought desk lamp")?.cents).toBe(2500);
    const undo = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "undo").map((c) => c.label);
    expect(undo).toEqual([expect.stringMatching(/^Bought milk: \$\d+\.\d{2} \(priced as Milk, whole\)/)]);
  });
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
  test("leaves a chip that charges the price the player sets", async () => {
    const { rig, chatId } = await chat();
    script(rig, [{ item: "tin whistle" }]);
    await rig.turn(chatId, "I buy a kazoo for $3.", "You also pocket a tin whistle.");
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.label.startsWith("Bought tin whistle"));
    // Nothing in the catalog is called a whistle, so there's no item to pick here: price or dismiss.
    expect(chip?.actions.map((a) => a.id)).toEqual(["price", "dismiss"]);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id ?? "", choice: "price", payload: { cents: 450 } }));
    expect((await bought(rig, chatId)).find((b) => b.memo === "Bought tin whistle")?.cents).toBe(450);
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
    expect((await bought(rig, chatId)).find((b) => b.memo === "Bought antique astrolabe")?.cents).toBe(cap + 100);
  });
});

describe("the cash ✎ corrects cash with a balanced posting", () => {
  test("cash becomes the amount, the books still balance, and it stays a fix", async () => {
    const { rig, chatId } = await chat();
    const { world } = await folded(rig, chatId);
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: world.pov, field: "cash", value: 1234 }));
    const { state } = await folded(rig, chatId);
    expect(state.accounts.acct_pov_cash).toBe(1234);
    const history = state.packs.economy?.history;
    expect((Array.isArray(history) ? history : []).some((h) => !!h && typeof h === "object" && !Array.isArray(h) && h.memo === "Correction")).toBe(true);
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

  test("still failing, it leaves a chip whose Retry re-runs the turn", async () => {
    const { rig, chatId } = await chat();
    script(rig, [], () => {
      throw new Error("ECONNRESET");
    });
    await rig.turn(chatId, "I buy a kazoo for $3.", "The clerk rings it up.");
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "read_failed");
    expect(chip?.actions.map((a) => a.id)).toEqual(["rerun"]);
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id ?? "", choice: "rerun" }))).toMatchObject({ applied: true });
  });
});

describe("the cap on narrated prices", () => {
  test("an old world's unpricedCapCents becomes unpricedCap once", async () => {
    const { rig, chatId } = await chat();
    const { world } = await folded(rig, chatId);
    const migrated = migrateWorld({ ...world, packs: { ...world.packs, economy: { version: 1, config: { unpricedCapCents: 1000 } } } });
    expect(migrated.packs.economy?.config).toEqual({ unpricedCap: 1000 });
  });
});
