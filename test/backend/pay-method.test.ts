// A typed Buy that names how it's paid: when interpret leaves `method` empty, the
// player's own words fill it; a method interpret set stands.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { saidPayMethod } from "../../src/backend/steps";
import { toChain } from "../../src/backend/ledger-io";
import { balance } from "../../src/packs/economy/core/model";
import { Rig } from "../support/rig";

const LONG = "I buy the old brass ship's lantern and pay with my credit card, then sit by the window and watch the harbor wake up while Tessa wraps it.";

/** One typed Buy in a fresh Port Alder chat with interpret's `params`; the card and checking balances after it. */
async function buy(params: JsonObject | null, text = LONG) {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes("You map a player's typed input") ? JSON.stringify(params ? { action: "buy", params, confidence: 0.9 } : { action: null }) : "{}");
  await rig.turn(chatId, text, "Tessa wraps it and you settle in by the window.");
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return { card: balance(state, "acct_pov_card"), checking: balance(state, "acct_pov_checking"), errors: rig.rt.ledger.errors };
}

describe("a typed Buy's way of paying", () => {
  test("the player's words name the method: credit or debit card, in or with cash, from savings", () => {
    expect([LONG, "I grab a coffee and pay with my debit card.", "I pay for it in cash.", "I pay With Cash.", "I take it out of my wallet and pay from my savings.", "I buy a card game."].map(saidPayMethod)).toEqual(["credit card", "debit card", "cash", "cash", "savings", null]);
  });

  test("a way of paying counts only when said as a payment; a negated one is skipped and the last one counts", () => {
    const probes = ["I buy a credit card holder for $12.", "I buy the lantern, not with cash, with my debit card.", "I pay with my debit card instead of cash.", "I'd rather pay in cash than with my credit card.", "I put it on my credit card.", "I drop the receipt in the cash register.", "I pay in cash, no, with my credit card."];
    expect(probes.map(saidPayMethod)).toEqual([null, "debit card", "debit card", "cash", "credit card", null, "credit card"]);
  });

  test("buying a credit card holder doesn't charge the card", async () => {
    const text = "I buy a credit card holder for $12.";
    const none = await buy(null, text);
    const got = await buy({ item: "credit card holder", price: 12 }, text);
    expect(got.card).toBe(none.card);
    expect(got.errors).toEqual([]);
  });

  test("a long sentence that says 'pay with my credit card' charges the card when interpret leaves the method out", async () => {
    const none = await buy(null);
    const got = await buy({ item: "old brass ship's lantern", price: 84 });
    // $84 and its 7% sales tax, at the top Money level.
    expect(Math.abs(got.card - none.card)).toBe(8988);
    expect(got.checking).toBe(none.checking);
    expect(got.errors).toEqual([]);
  });

  test("a method interpret set stands", async () => {
    const none = await buy(null);
    const got = await buy({ item: "old brass ship's lantern", price: 84, method: "checking" });
    expect(got.card).toBe(none.card);
    expect(none.checking - got.checking).toBe(8988);
  });
});
