// Narrated transfers that name an account or a thing, and cash handed over: each side
// of a transfer is a person or a person's own cash, checking, savings or card account, so money is
// conserved or nothing moves, the chip says what happened, and bills handed over land in the wallet.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { toChain } from "../../src/backend/ledger-io";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "propose concrete state changes";
const DANNY = "danny_okafor";

/** One turn in a fresh Port Alder chat whose reply the extractor reads as `proposals`: the accounts after it, and the chips. */
async function turn(proposals: JsonObject[]) {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  // These tests exercise transfers applying; transfer starts in confirm (D4), so pin it to auto.
  rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { transfer: { mode: "auto" } } } }));
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals }) : "{}");
  await rig.turn(chatId, "I sort out some money.", "It's done.");
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  const view = await rig.rt.view(chatId, rig.host.userId);
  const at = (id: string): number => state.accounts[id] ?? 0;
  // Money outside the world: every outside account but the people's own (their opening balances
  // come from there). Money created or destroyed shows here.
  const outside = Object.keys(state.accounts)
    .filter((id) => id.startsWith(EXTERNAL_ACCOUNT_PREFIX) && id !== `${EXTERNAL_ACCOUNT_PREFIX}pov` && id !== `${EXTERNAL_ACCOUNT_PREFIX}${DANNY}`)
    .reduce((a, id) => a + at(id), 0);
  // Danny's money net of his opening balances: his accounts plus the outside account they came from.
  const danny = Object.keys(state.accounts)
    .filter((id) => state.entities[id]?.fields.owner === DANNY || id === `${EXTERNAL_ACCOUNT_PREFIX}${DANNY}`)
    .reduce((a, id) => a + at(id), 0);
  const pov = { cash: at("acct_pov_cash"), checking: at("acct_pov_checking"), savings: at("acct_pov_savings"), card: at("acct_pov_card"), loan: at("acct_pov_auto_loan"), brokerage: at("acct_pov_brokerage") };
  return { pov, outside, danny, accounts: { ...state.accounts }, chips: view.chips.map((c) => `${c.kind}: ${c.label}`), errors: rig.rt.ledger.errors };
}

const money = (chips: string[]): string[] => chips.filter((c) => c.startsWith("undo:") || c.startsWith("decline:"));

describe("a narrated transfer's two sides", () => {
  test("to the player's own savings: checking pays savings, nothing vanishes", async () => {
    const none = await turn([]);
    const got = await turn([{ type: "transfer", from: "pov", to: "acct_pov_savings", amount: 100 }]);
    expect(got.pov).toEqual({ ...none.pov, checking: none.pov.checking - 10000, savings: none.pov.savings + 10000 });
    expect(got.outside).toBe(none.outside);
    expect(money(got.chips)).toEqual(["undo: Paid $100.00 to Your savings account"]);
    expect(got.errors).toEqual([]);
  });

  test("from the player's checking to Danny: the player pays from checking, Danny gets it", async () => {
    const none = await turn([]);
    const got = await turn([{ type: "transfer", from: "acct_pov_checking", to: DANNY, amount: 20 }]);
    expect(got.pov).toEqual({ ...none.pov, checking: none.pov.checking - 2000 });
    expect(got.danny).toBe(2000);
    expect(got.outside).toBe(none.outside);
    expect(money(got.chips)).toEqual(["undo: Your checking account paid $20.00 to Danny Okafor"]);
  });

  test("between two of the player's accounts: a move that conserves money and says so", async () => {
    const none = await turn([]);
    const got = await turn([{ type: "transfer", from: "acct_pov_checking", to: "acct_pov_savings", amount: 100 }]);
    expect(got.pov).toEqual({ ...none.pov, checking: none.pov.checking - 10000, savings: none.pov.savings + 10000 });
    expect(got.outside).toBe(none.outside);
    expect(money(got.chips)).toEqual(["undo: Your checking account paid $100.00 to Your savings account"]);
  });

  test("a loan or a thing on either side is refused with a Didn't apply chip, and nothing moves", async () => {
    const none = await turn([]);
    const cases: [JsonObject, string][] = [
      [{ type: "transfer", from: "acct_pov_auto_loan", to: DANNY, amount: 400 }, "decline: Didn't apply: Your auto loan paid $400.00 to Danny Okafor"],
      [{ type: "transfer", from: "pov_truck", to: "pov", amount: 50 }, "decline: Didn't apply: Your pickup paid $50.00 to you"],
      [{ type: "transfer", from: "pov", to: "pov_truck", amount: 50 }, "decline: Didn't apply: Paid $50.00 to Your pickup"],
    ];
    for (const [p, chip] of cases) {
      const got = await turn([p]);
      expect(got.accounts).toEqual(none.accounts);
      expect(money(got.chips)).toEqual([chip]);
      expect(got.errors).toEqual([]);
    }
  });
});

describe("cash handed over", () => {
  test("a $20 cash gift to the player lands in the wallet, checking unchanged, from Danny's own money", async () => {
    const none = await turn([]);
    const gifts: JsonObject[] = [
      { type: "give", item: "$20", from: DANNY, to: "pov" },
      { type: "transfer", from: DANNY, to: "pov", amount: 20, method: "cash" },
    ];
    for (const p of gifts) {
      const got = await turn([p]);
      expect(got.pov).toEqual({ ...none.pov, cash: none.pov.cash + 2000 });
      expect(got.danny).toBe(-2000);
      expect(got.outside).toBe(none.outside);
      expect(money(got.chips)).toEqual(["undo: Danny Okafor paid $20.00 to you"]);
    }
  });
});
