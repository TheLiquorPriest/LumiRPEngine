// A reply that tells again a movement of money the turn's own actions made (a withdrawal, a
// deposit, a move between accounts, a payment) offers no second transfer: the same sides and an
// amount within ±25% of what moved, as a purchase's price is held to its Buy's. Applying it would
// move the money twice. A narrated transfer that differs (another amount, another account) keeps
// its chip.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import { toChain } from "../../src/backend/ledger-io";
import { movedAlong } from "../../src/backend/runtime";
import { placeOfEntity } from "../../src/engine/scope";
import { STARTER_WORLDS } from "../../src/packs/index";
import { startState } from "../packs/support";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const TYPED = "Before work I walk over to Alder Market and take $60 out of the credit union machine with my debit card.";

/**
 * The live turn on Port Alder: the player walks to Alder Market and takes $60 from checking at the
 * credit union's counter there, and the extractor reads the reply as `proposals`. Returns the POV's
 * place, checking and cash after it, and the money chips left on the reply.
 */
async function withdrawal(proposals: JsonObject[], opts: { auto?: boolean } = {}) {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  if (opts.auto) rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { transfer: { mode: "auto" } } } }));
  rig.host.quietReply = (req) => {
    const prompt = req.messages[0]?.content ?? "";
    if (prompt.includes(INTERPRET_MARK)) return JSON.stringify({ action: "go", params: { to: "alder_market" }, confidence: 0.9, more: [{ action: "withdraw_cash", params: { account: "acct_pov_checking", amount: 60 }, text: "I take $60 out of the credit union machine with my debit card" }] });
    if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals });
    return "{}";
  };
  await rig.turn(chatId, TYPED, "You walk the few blocks to Alder Market, slide your debit card into the credit union machine and take out sixty dollars.");
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  const view = await rig.rt.view(chatId, rig.host.userId);
  expect(rig.rt.ledger.errors).toEqual([]);
  return {
    place: placeOfEntity(state, "pov"),
    checking: state.accounts.acct_pov_checking ?? 0,
    cash: state.accounts.acct_pov_cash ?? 0,
    chips: view.chips.filter((c) => c.kind === "confirm" || c.kind === "decline" || c.kind === "undo").map((c) => `${c.kind}: ${c.label}`),
  };
}

describe("a narrated transfer that tells the turn's own withdrawal again", () => {
  test("checking to the wallet at the amount withdrawn leaves no chip, and the money moves once", async () => {
    const none = await withdrawal([]);
    expect(none.place).toBe("alder_market");
    const told = await withdrawal([{ type: "transfer", from: "acct_pov_checking", to: "acct_pov_cash", amount: 60 }]);
    expect(told.chips).toEqual([]);
    expect([told.checking, told.cash]).toEqual([none.checking, none.cash]);
    // Named by its holder, or a few dollars off the amount (within ±25%), it is the same withdrawal.
    expect((await withdrawal([{ type: "transfer", from: "pov", to: "acct_pov_cash", amount: 60 }])).chips).toEqual([]);
    expect((await withdrawal([{ type: "transfer", from: "acct_pov_checking", to: "acct_pov_cash", amount: 65 }])).chips).toEqual([]);
    // With transfers applying on their own, the narration still doesn't take the $60 a second time.
    const auto = await withdrawal([{ type: "transfer", from: "acct_pov_checking", to: "acct_pov_cash", amount: 60 }], { auto: true });
    expect([auto.checking, auto.cash]).toEqual([none.checking, none.cash]);
    expect(auto.chips).toEqual([]);
  });

  test("a transfer that differs keeps its chip: another amount, or another account", async () => {
    expect((await withdrawal([{ type: "transfer", from: "acct_pov_checking", to: "acct_pov_cash", amount: 100 }])).chips).toEqual([expect.stringMatching(/^confirm: .*paid \$100\.00 to /)]);
    expect((await withdrawal([{ type: "transfer", from: "acct_pov_checking", to: "acct_pov_savings", amount: 60 }])).chips).toEqual([expect.stringMatching(/^confirm: .*paid \$60\.00 to .*savings/i)]);
  });
});

describe("movedAlong: the turn's own deposits, moves and payments", () => {
  const world = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("pa", "Port Alder");
  const state = startState(world);
  const post = (lines: { account: string; amount: number }[], memo: string): LedgerEvent => ({ type: "post", lines, memo });
  const deposit = post([{ account: "acct_pov_cash", amount: -5000 }, { account: "acct_pov_checking", amount: 5000 }], "Cash deposit at Alder Market");
  const payDanny = post([{ account: "acct_pov_checking", amount: -2000 }, { account: "acct_danny_checking", amount: 2000 }], "Payment");
  const transfer = (from: string, to: string, amount: number): JsonObject => ({ type: "transfer", from, to, cents: amount });

  test("a deposit told again is the deposit: the wallet into checking, by account or by holder", () => {
    expect(movedAlong(transfer("acct_pov_cash", "acct_pov_checking", 5000), [deposit], state)).toBe(true);
    expect(movedAlong(transfer("pov", "acct_pov_checking", 4500), [deposit], state)).toBe(true);
    // The other way round, or twice the amount, is a movement of its own.
    expect(movedAlong(transfer("acct_pov_checking", "acct_pov_cash", 5000), [deposit], state)).toBe(false);
    expect(movedAlong(transfer("acct_pov_cash", "acct_pov_checking", 10000), [deposit], state)).toBe(false);
  });

  test("a payment told again names the payer and the payee or their accounts; a payment to someone else stays", () => {
    expect(movedAlong(transfer("pov", "danny_okafor", 2000), [payDanny], state)).toBe(true);
    expect(movedAlong(transfer("acct_pov_checking", "acct_danny_checking", 2000), [payDanny], state)).toBe(true);
    expect(movedAlong(transfer("pov", "priya_nair", 2000), [payDanny], state)).toBe(false);
    // Only this turn's own movements count: with nothing moved, every narrated transfer stays.
    expect(movedAlong(transfer("pov", "danny_okafor", 2000), [], state)).toBe(false);
    expect(movedAlong({ type: "purchase", item: "coffee" }, [payDanny], state)).toBe(false);
  });
});
