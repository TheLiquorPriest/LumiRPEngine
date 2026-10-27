// The extract prompt's purchase contract on the shipped packs: the model is told the payer is a
// person and the method is the prose's way of paying, and a narrated purchase paid "by debit card"
// charges checking, not wallet cash (DESIGN §9.4). Money the model states as written ($8.00 is 8)
// reaches the packs in minor units (800 cents), once. A thing's condition and a regard are asked
// for as far as the prose moves them, on the world's own axes and ranges.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { CallMeter, extract, Steps } from "../../src/backend/steps";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";
import { POV, testWorld } from "../support/test-pack";

const EXTRACT_MARK = "You read a narrator's roleplay reply";

async function accounts(rig: Rig, chatId: string): Promise<Record<string, number>> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  return { ...(core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state.accounts ?? {}) };
}

describe("extract: purchase payer and method", () => {
  test("the prompt names payer as the person who pays and method as how the prose says they paid", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const prompts: string[] = [];
    rig.host.quietReply = (req) => {
      const text = req.messages.map((m) => m.content).join("\n");
      if (text.includes(EXTRACT_MARK)) prompts.push(text);
      return "{}";
    };
    await rig.turn(chatId, "I grab a coffee.", "You pay for a coffee with your debit card.");
    expect(prompts).toHaveLength(1);
    const purchase = prompts[0]?.match(/purchase\{[^}]*\}(?: \([^)]*\))?/)?.[0] ?? "";
    expect(purchase).toContain("method?");
    expect(purchase).toMatch(/payer: the person who pays/);
    expect(purchase).toMatch(/never an account or a card/);
    // The model passes the prose's words; the economy pack reads them.
    for (const words of ["cash", "debit card", "credit card", "savings"]) expect(purchase).toContain(words);
  });

  test("a narrated purchase paid by debit card charges checking, not wallet cash", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { purchase: { mode: "confirm" } } } }));
    rig.host.quietReply = (req) =>
      req.messages.map((m) => m.content).join("\n").includes(EXTRACT_MARK)
        ? JSON.stringify({ proposals: [{ type: "purchase", item: "coffee", category: "food", payer: "pov", price: 8.0, method: "debit card" }] })
        : "{}";
    await rig.turn(chatId, "I grab a coffee.", "You pay eight dollars for a coffee with your debit card.");
    const before = await accounts(rig, chatId);
    expect(before.acct_pov_cash).toBeGreaterThan(800);
    const head = rig.host.head(chatId);
    const confirms = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "confirm" && c.messageId === head?.id);
    expect(confirms).toHaveLength(1);
    for (const c of confirms) rig.body(await rig.send({ type: "lre.chip", chatId, chip: c.id, choice: "confirm" }));
    const after = await accounts(rig, chatId);
    const moved = (id: string): number => (after[id] ?? 0) - (before[id] ?? 0);
    // Checking pays (the coffee is priced from its catalog row; the amount is the row's).
    expect(moved("acct_pov_checking")).toBeLessThan(0);
    expect([moved("acct_pov_cash"), moved("acct_pov_card")]).toEqual([0, 0]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("extract states money as written and returns it in minor units, a cash give's transfer scaled once", async () => {
    const host = new FakeHost();
    const world = testWorld();
    let system = "";
    host.quietReply = (req) => {
      system = req.messages[0]?.content ?? "";
      return JSON.stringify({
        proposals: [
          { type: "purchase", item: "lamp", payer: POV, price: 8.5 },
          { type: "transfer", from: "dev", to: POV, amount: 12 },
          { type: "give", item: "cash", from: "dev", to: POV, amount: 5 },
        ],
      });
    };
    const out = await extract(new Steps(host, new CallMeter()), "Sam buys a lamp.", world, {}, 0, [], null, host.userId, new AbortController().signal);
    expect(system).toContain(`Money amounts are plain amounts in ${world.currency.code} as written (8 for ${world.currency.symbol}8)`);
    expect(out.proposals).toEqual([
      { type: "purchase", item: "lamp", payer: POV, price: 850 },
      { type: "transfer", from: "dev", to: POV, amount: 1200 },
      { type: "transfer", from: "dev", to: POV, amount: 500, method: "cash" },
    ]);
  });
});

describe("extract: how far a told change goes", () => {
  test("the prompt asks for a thing's condition and a regard as far as the prose moves them, on the world's own axes and ranges", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const prompts: string[] = [];
    rig.host.quietReply = (req) => {
      const text = req.messages.map((m) => m.content).join("\n");
      if (text.includes(EXTRACT_MARK)) prompts.push(text);
      return "{}";
    };
    await rig.turn(chatId, "I drop my phone.", "The phone cracks across the screen.");
    expect(prompts).toHaveLength(1);
    const condition = prompts[0]?.match(/item_condition\{[^}]*\}(?: \([^)]*\))?/)?.[0] ?? "";
    const regard = prompts[0]?.match(/regard\{[^}]*\}[^·]*/)?.[0] ?? "";
    expect(condition).toContain("as far as the prose says");
    expect(condition).toContain("0..100");
    expect(regard).toContain("as far as the prose moves it");
    for (const axis of ["warmth (-100..100)", "trust (-100..100)", "respect (-100..100)"]) expect(regard).toContain(axis);
    expect(regard).not.toContain("affection");
    for (const spec of [condition, regard]) expect(spec).not.toMatch(/-25\.\.25|-3\.\.3/);
  });
});
