// Money nobody gave is never made up: a payment, a correction of cash, an account opened, a gift and
// credit record only what the call says, a payer the world keeps no money for pays from outside the
// world's accounts, and the detail the world's tables give is filled in only when an agent asks,
// as a change of its own from the world's defaults that stands as assumed. So does what the engine
// works out by itself: an account's authored opening before a correction, and the band someone the
// world keeps no accounts for is taken to start from; each leaves the books as today's engine does.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { LedgerEvent } from "../../src/shared/ledger";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { optionalService } from "../../src/engine/pack-kit";
import { Working } from "../../src/engine/working";
import { l1Move } from "../../src/packs/economy/core/pay";
import type { ChangeRow } from "../../src/store/types";
import { dataOf, registry, rig, saidNotReported, texts, world as worldDoc, wordsFromFiles } from "./rig";

const PROSE = { source: { from: "prose", message: "m-12" }, standing: "established", precision: "exact" };

/** Whether anything of `who`'s money was made up: an account or a card in their name, or a sample recorded. */
function madeUp(rows: readonly ChangeRow[], state: { entities: Record<string, unknown> }, ...who: string[]): boolean {
  return rows.some((r) => r.op === "materialize") || Object.keys(state.entities).some((id) => who.some((w) => id.startsWith(`${w}:`)));
}

/** The economy's bookkeeping for someone it keeps no accounts for: the band their money is taken to start from, and a band a payment moves them to. */
function bookkeeping(row: ChangeRow): boolean {
  return row.op === "economy.anchor" || (row.op === "set" && (row.value as JsonObject).field === "wealth");
}

/** Recorded as the engine's, from the world's defaults: no call said it. */
function filledIn(row: ChangeRow): boolean {
  return row.source === "default" && row.standing === "assumed" && row.precision === null && row.cite === null;
}

/** Recorded with the call's own provenance. */
function asSaid(row: ChangeRow): boolean {
  return row.source === "prose" && row.standing === "established" && (row.cite as JsonObject | null)?.message === "m-12";
}

describe("money nobody gave", () => {
  test("a payment makes up no accounts or balances, and a payer the world keeps no money for pays from outside its accounts", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "pay", who: "tam", to: "bram", amount: 3, for: "a mug of cider", ...PROSE }] });
    expect(r.error).toBeUndefined();
    const rows = t.s.changes(t.turn.id);
    const world = t.s.stateAt(t.turn.id).state.world;
    expect(madeUp(rows, world, "tam", "bram")).toBe(false);
    expect(world.accounts[`${EXTERNAL_ACCOUNT_PREFIX}tam`]).toBe(-300);
    expect(world.accounts[`${EXTERNAL_ACCOUNT_PREFIX}bram`]).toBe(300);
    // Everything the call made is recorded with its provenance; the band each of them is taken to start from is the economy's bookkeeping, from the world's defaults.
    expect(rows.filter(bookkeeping).map((row) => ((row.value as JsonObject).data as JsonObject).entity)).toEqual(["tam", "bram"]);
    expect(rows.filter(bookkeeping).every(filledIn)).toBe(true);
    expect(rows.filter((row) => !bookkeeping(row)).length).toBeGreaterThan(0);
    expect(rows.filter((row) => !bookkeeping(row)).every(asSaid)).toBe(true);
    saidNotReported(r, "paid from their money outside the world's accounts");
    wordsFromFiles(r);
  });

  test("an account the world gave is opened as a change of its own, from the world's defaults and as assumed", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "pay", who: "wren", to: "bram", amount: 3, for: "a mug of cider", ...PROSE }] });
    expect(r.error).toBeUndefined();
    const rows = t.s.changes(t.turn.id);
    const opened = rows.filter((row) => row.op === "materialize");
    expect(opened.length).toBe(1);
    expect(opened.every(filledIn)).toBe(true);
    const paid = rows.filter((row) => row.op !== "materialize" && !bookkeeping(row));
    expect(paid.length).toBeGreaterThan(0);
    expect(paid.every(asSaid)).toBe(true);
    expect(rows.filter(bookkeeping).every(filledIn)).toBe(true);
    const world = t.s.stateAt(t.turn.id).state.world;
    expect(world.accounts.acct_wren).toBe(900);
    expect(madeUp([], world, "wren", "bram")).toBe(false);
    wordsFromFiles(r);
  });

  test("a correction of cash, an account opened, a gift and credit make up no accounts for anyone", async () => {
    const t = await rig();
    const cash = await t.call("world_apply", { operations: [{ op: "set", at: "tam", key: "cash", value: 40, ...PROSE }] });
    expect(cash.error).toBeUndefined();
    const opened = await t.call("open_account", { who: "bram", product: "checking", name: "Bram's till account", ...PROSE });
    expect(opened.error).toBeUndefined();
    const gift = await t.call("donate", { to: "lamplighters", amount: 1, from: "tam", ...PROSE });
    expect(gift.error).toBeUndefined();
    const credit = await t.call("apply_credit", { who: "odile", product: "loan", amount: 40, term: 12, ...PROSE });
    expect(credit.error).toBeUndefined();
    const rows = t.s.changes(t.turn.id);
    const world = t.s.stateAt(t.turn.id).state.world;
    expect(madeUp(rows, world, "tam", "bram", "odile", "lamplighters")).toBe(false);
    // Bram holds the one account the call opened, and nothing else.
    const bramsAccounts = Object.values(world.entities).filter((e) => e.kind === "account" && JSON.stringify(e.fields.owners ?? []).includes('"bram"'));
    expect(bramsAccounts.map((e) => e.name)).toEqual(["Bram's till account"]);
    expect(rows.filter((row) => !bookkeeping(row)).every((row) => row.source === "prose" && row.standing === "established")).toBe(true);
    expect(rows.filter(bookkeeping).every(filledIn)).toBe(true);
  });

  test("a GM correction of an account nobody opened opens it first, as a change of its own outside the correction, and leaves the books as today's correction does", async () => {
    const t = await rig();
    const before = structuredClone(t.s.stateAt(t.turn.id).state.world);
    const r = await t.call("gm_adjust_money", { account: "Wren's coin", amount: 5, ...PROSE });
    expect(r.error).toBeUndefined();
    const rows = t.s.changes(t.turn.id);
    const opened = rows.filter((row) => row.op === "materialize");
    expect(opened.length).toBe(1);
    expect(opened.every(filledIn)).toBe(true);
    expect((opened[0]?.value as JsonObject).group).toBeUndefined();
    // The correction's own unit holds what the call said, and nothing else.
    const corrected = rows.filter((row) => row.op !== "materialize");
    expect(corrected.map((row) => row.op)).toEqual(["post", "economy.txn"]);
    expect(corrected.every(asSaid)).toBe(true);
    expect(new Set(corrected.map((row) => (row.value as JsonObject).group)).size).toBe(1);
    // Today's correction, the opening inside its unit, leaves the same world.
    const today = new Working(registry(), worldDoc(), before);
    const events = optionalService(today.ctx, "economy.adjust")?.(today.ctx, "acct_wren", 500);
    if (!Array.isArray(events)) throw new Error("the economy corrects an account");
    expect(events.some((e) => e.type === "materialize")).toBe(true);
    for (const e of events as LedgerEvent[]) expect(today.apply(e)).toBeNull();
    const after = t.s.stateAt(t.turn.id).state.world;
    expect(after.accounts.acct_wren).toBe(1700);
    expect(after.accounts).toEqual(today.state.accounts);
    expect(after.materialized).toEqual(today.state.materialized);
    expect(after.entities).toEqual(today.state.entities);
    wordsFromFiles(r);
  });

  test("the band someone the world keeps no accounts for is taken to start from, and the band a payment moves them to, are recorded as assumed in the payment's unit, each today's", async () => {
    const t = await rig();
    const before = structuredClone(t.s.stateAt(t.turn.id).state.world);
    const r = await t.call("world_apply", { operations: [{ op: "pay", who: "wren", to: "tam", amount: 20_000, for: "a house by the quay", ...PROSE }] });
    expect(r.error).toBeUndefined();
    const rows = t.s.changes(t.turn.id);
    const kept = rows.filter(bookkeeping);
    expect(kept.every(filledIn)).toBe(true);
    // The economy's own bookkeeping for that payment, event for event, each recorded in the payment's unit.
    expect(kept.map((row) => ({ ...(row.value as JsonObject), group: undefined }))).toEqual(l1Move(before, "tam", 2_000_000).map((e) => ({ ...(e as unknown as JsonObject), group: undefined })));
    const payment = rows.filter((row) => row.op !== "materialize");
    expect(new Set(payment.map((row) => (row.value as JsonObject).group)).size).toBe(1);
    expect(payment.filter((row) => !bookkeeping(row)).every(asSaid)).toBe(true);
    const after = t.s.stateAt(t.turn.id).state.world;
    expect(after.entities.tam?.fields.wealth).toBe("comfortable");
    expect(after.accounts[`${EXTERNAL_ACCOUNT_PREFIX}tam`]).toBe(2_000_000);
    wordsFromFiles(r);
  });

  test("the detail the world's tables give is filled in when an agent asks, from the world's defaults and as assumed", async () => {
    const t = await rig();
    const r = await t.call("fill_in_detail", { who: "Tam", part: "money" });
    expect(r.error).toBeUndefined();
    const op = (dataOf(r).operations as JsonObject[])[0];
    expect(op).toMatchObject({ op: "fill_in_detail", applied: true, source: { from: "default" }, standing: "assumed" });
    expect(r.marks).toBeUndefined();
    const rows = t.s.changes(t.turn.id);
    expect(rows.map((row) => row.op)).toEqual(["materialize"]);
    expect(rows.every((row) => row.source === "default" && row.standing === "assumed" && row.cite === null)).toBe(true);
    const world = t.s.stateAt(t.turn.id).state.world;
    expect(Object.keys(world.entities).filter((id) => id.startsWith("tam:")).length).toBeGreaterThan(0);
    expect((dataOf(r).changed as JsonObject[]).some((c) => c.new === true && String(c.at).startsWith("entity:tam:"))).toBe(true);
    wordsFromFiles(r);

    // Asked again, nothing more is drawn: the answer says so and nothing is recorded.
    const again = await t.call("fill_in_detail", { who: "tam", part: "money" });
    saidNotReported(again, "nothing was filled in for Tam [tam]");
    expect(t.s.changes(t.turn.id).length).toBe(rows.length);
    wordsFromFiles(again);
  });

  test("a part the world's tables do not fill in is answered with the parts they do", async () => {
    const t = await rig();
    const r = await t.call("fill_in_detail", { who: "tam", part: "manners" });
    expect(r.error).toBe(true);
    expect(texts(r).some((x) => x.includes("gear") && x.includes("money") && x.includes("vehicles"))).toBe(true);
    expect(t.s.changes(t.turn.id)).toEqual([]);
    wordsFromFiles(r);
  });
});
