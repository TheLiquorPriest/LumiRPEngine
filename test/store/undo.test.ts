// Undo of one change and the review card (plan §6.8, §6.3): an undo is a change of its own that
// reverses an earlier one, by the player, after the newest reply; nothing recorded is taken away.
// What cannot be reversed cleanly is said, and a part a later change wrote since is left alone.

import { describe, expect, test } from "bun:test";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { BANK_PREFIX } from "../../src/packs/economy/core/model";
import { asUnit, posting, txn } from "../../src/packs/economy/core/pay";
import type { JsonValue } from "../../src/shared/json";
import { factStore, standing } from "../../src/store/facts";
import type { UserStore } from "../../src/store/store";
import { engine, goTo, hand, make, pay, play, POV, testStore, tick } from "./fixtures";

function chat() {
  const ts = testStore();
  ts.s.createChat({ id: "c", revision: ts.revision });
  return ts;
}

/** An account's journal at the chat's head, as the money panel lists it: each line's memo, amount, kind and category. */
function journal(s: UserStore, account: string): { memo: JsonValue; cents: JsonValue; kind: JsonValue; category: JsonValue }[] {
  const economy = s.headState("c").state.world.packs.economy;
  const lines: JsonValue | undefined = typeof economy === "object" && economy !== null && !Array.isArray(economy) && typeof economy.journal === "object" && economy.journal !== null && !Array.isArray(economy.journal) ? economy.journal[account] : undefined;
  if (!Array.isArray(lines)) return [];
  return lines.flatMap((l) => (typeof l === "object" && l !== null && !Array.isArray(l) ? [{ memo: l.memo ?? null, cents: l.cents ?? null, kind: l.kind ?? null, category: l.category ?? null }] : []));
}

describe("undo of one change", () => {
  test("undoing a payment restores both balances, shows as a change of his own after the newest reply, and the card says so", () => {
    const { s } = chat();
    const t1 = play(s, "c", "m1", "Wren pays for two nights.", 1, engine(pay("acct_wren", 250, "Two nights")));
    const t2 = play(s, "c", "m2", "She settles in.", 2, engine(tick(30)));
    const paid = s.changes(t1.id)[0];
    if (!paid) throw new Error("no payment");
    const start = s.startOf(t1.id).state.world.accounts;
    const market = `${EXTERNAL_ACCOUNT_PREFIX}market`;
    expect([s.headState("c").state.world.accounts.acct_wren, s.headState("c").state.world.accounts[market]]).toEqual([(start.acct_wren ?? 0) - 250, (start[market] ?? 0) + 250]);

    const done = s.undo(paid.id);
    expect(done.left).toEqual([]);
    expect(done.changes.map((c) => [c.turn, c.chat, c.op, c.lane, c.source, c.by, c.cite, c.applied])).toEqual([["", "c", "post", "engine", "player", "player", { undoes: paid.id }, true]]);
    // It is his own: the next turn starts with it, and the turn it was undone after keeps its state.
    expect(s.stateAt(t2.id).state.world.accounts.acct_wren).toBe((start.acct_wren ?? 0) - 250);
    const head = s.headState("c").state.world.accounts;
    expect([head.acct_wren ?? 0, head[market] ?? 0]).toEqual([start.acct_wren ?? 0, start[market] ?? 0]);
    // Nothing recorded was taken away: the payment is still its turn's change.
    expect(s.changes(t1.id)).toEqual([paid]);
    // The card of the first turn shows the payment by lane, with the change that undid it.
    const card = s.reviewCard(t1.id);
    expect(card.map((l) => [l.lane, l.changes.map((c) => [c.change.id, c.undoneBy])])).toEqual([["engine", [[paid.id, [done.changes[0]?.id]]]]]);
  });

  test("a unit is undone whole, a fact's undo brings back what it replaced, and the card gives each change its undo", () => {
    const { s } = chat();
    const t1 = play(s, "c", "m1", "Wren takes out her knife.", 1, [...engine(...hand("knife", "satchel", POV)), { lane: "engine", ...factStore.change({ about: `entity:${POV}`, key: "mood", value: "on edge" }), by: "gm", source: "prose" }]);
    const t2 = play(s, "c", "m2", "She calms.", 2, [{ lane: "engine", ...factStore.change({ about: `entity:${POV}`, key: "mood", value: "calm" }), by: "gm", source: "prose", precision: "vague" }]);
    const holder = (): string[] => s.headState("c").state.world.entities.knife?.relations.filter((r) => r.type === "in").map((r) => r.to) ?? [];
    expect(holder()).toEqual([POV]);
    const card = s.reviewCard(t1.id);
    expect(card[0]?.changes.map((c) => [c.change.op, c.undo.ops])).toEqual([
      ["unlink", ["unlink", "link"]],
      ["link", ["unlink", "link"]],
      ["store.fact", []],
    ]);
    expect(card[0]?.changes[2]?.undo.left).toEqual([{ code: "changed_since", values: { change: s.changes(t1.id)[2]?.id ?? 0, op: "store.fact" } }]);
    // Undoing the move's second half takes back the whole move.
    const link = s.changes(t1.id)[1];
    const moved = s.undo(link?.id ?? 0);
    expect(moved.changes.map((c) => c.op)).toEqual(["unlink", "link"]);
    expect(holder()).toEqual(["satchel"]);
    // Undoing the calm brings back what it replaced.
    const calm = s.changes(t2.id)[0];
    s.undo(calm?.id ?? 0);
    expect(standing(s.headState("c").state, `entity:${POV}`).map((f) => f.value)).toEqual(["on edge"]);
  });

  test("a part a later change wrote since is left alone, as is what the store keeps no reverse for, and each is said", () => {
    const { s } = chat();
    const t1 = play(s, "c", "m1", "Wren goes down to the cellar and finds a lantern.", 1, engine(goTo(POV, "cellar"), make("lantern", "Lantern", POV)));
    const t2 = play(s, "c", "m2", "She goes out to the market.", 2, engine(goTo(POV, "market_square")));
    const [moved, made] = s.changes(t1.id);
    if (!moved || !made) throw new Error("missing changes");
    expect(s.undo(moved.id)).toEqual({ changes: [], left: [{ code: "changed_since", values: { change: moved.id, op: "set" } }] });
    expect(s.undo(made.id)).toEqual({ changes: [], left: [{ code: "not_reversible", values: { change: made.id, op: "spawn" } }] });
    expect(s.changes(t2.id)).toHaveLength(1);
    expect(s.headState("c").state.world.entities[POV]?.fields.place).toBe("market_square");
  });

  test("a journal line is taken back as the economy takes one back: its posting's lines the other way, named reversed, or refunded where the bank was paid", () => {
    const { s } = chat();
    const market = `${EXTERNAL_ACCOUNT_PREFIX}market`;
    const lodging = asUnit(posting([{ account: "acct_wren", amount: -250 }, { account: market, amount: 250 }], { memo: "Two nights", kind: "payment", category: "lodging" }));
    const fee = asUnit(posting([{ account: "acct_wren", amount: -35 }, { account: `${BANK_PREFIX}fees`, amount: 35 }], { memo: "Overdraft fee", kind: "fee", category: "fees" }));
    // A journal line recorded without its posting: nothing says what it moved.
    const alone = txn([{ account: "acct_wren", amount: -10 }], { memo: "Tip", kind: "payment" });
    const t1 = play(s, "c", "m1", "Wren pays for two nights, and the bank charges her.", 1, engine(...lodging, ...fee, alone));
    play(s, "c", "m2", "She settles in.", 2, engine(tick(30)));
    const start = s.startOf(t1.id).state.world.accounts.acct_wren ?? 0;
    const [, lodgingLine, , feeLine, aloneLine] = s.changes(t1.id);
    if (!lodgingLine || !feeLine || !aloneLine) throw new Error("missing changes");

    const undone = s.undo(lodgingLine.id);
    expect(undone.left).toEqual([]);
    expect(undone.changes.map((c) => c.op)).toEqual(["economy.txn", "post"]);
    const refunded = s.undo(feeLine.id);
    expect(refunded.left).toEqual([]);
    expect(s.headState("c").state.world.accounts.acct_wren ?? 0).toBe(start);
    expect(journal(s, "acct_wren").slice(-2)).toEqual([
      { memo: "Two nights reversed", cents: 250, kind: "transfer", category: "lodging" },
      { memo: "Overdraft fee refunded", cents: 35, kind: "refund", category: "fees" },
    ]);
    expect(s.undo(aloneLine.id)).toEqual({ changes: [], left: [{ code: "not_reversible", values: { change: aloneLine.id, op: "economy.txn" } }] });
  });
});
