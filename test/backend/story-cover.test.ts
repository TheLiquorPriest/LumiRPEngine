// What a narrated payment's chip says when the engine can't run the payer's debt (DESIGN §9.5,
// §25.10): with nothing that covers it and no way that can run a debt, a purchase is the payer's
// with nothing charged and its chip says so, never a charge that wasn't made, and a payment moves
// nothing and is a Not tracked receipt. A purchase nothing prices that someone else made is
// theirs on its chip, never the player character's. On a rebased view the overdraft transfer a
// payment brought stands only with it, in both folds, and Pay another way puts right only what
// folded there. Edit amount charges what's typed on a taxed purchase too. A correction made where
// the payment stood (Edit amount, Pay another way) goes with it on a version of the story where it
// didn't, and gives an overdraft link nothing back where only its transfer didn't land.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { keepSummary } from "../../src/backend/view";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { referenceFold } from "../../src/engine/ledger/reference";
import { heldBy } from "../../src/shared/finance";
import { hashJson } from "../../src/shared/hash";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { EditOp } from "../../src/shared/protocol";
import type { Chip } from "../../src/shared/state-view";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "propose concrete state changes";
const DANNY = "danny_okafor";
const COMPASS: JsonObject = { type: "purchase", payer: "pov", item: "brass ship's compass", price: 165 };

/** The chat's state as it folds now. */
async function folded(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return state;
}

/** The chat as both folds read it, which must agree (L1): the reference fold's output. */
async function bothFolds(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  const observed = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
  const optimized = core.fold(observed);
  const reference = referenceFold(core.foldInput(observed), rig.rt.registry);
  expect(hashJson(optimized.state)).toBe(hashJson(reference.state));
  expect(optimized.messages).toEqual(reference.messages);
  expect(optimized.notes).toEqual(reference.notes);
  expect(optimized.keepReport).toEqual(reference.keepReport);
  expect(reference.violations).toEqual([]);
  return reference;
}

/** Port Alder after one turn, purchases and payments applied as `mode` says; with `cap`, the world's narrated-price cap in minor units. */
async function alder(mode: "auto" | "confirm", cap?: number): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  if (cap !== undefined) {
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    const packs = isRecord(draft.draft) && isRecord(draft.draft.packs) ? draft.draft.packs : {};
    const economy = isRecord(packs.economy) ? packs.economy : {};
    const config = isRecord(economy.config) ? economy.config : {};
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "packs", id: "economy", value: { ...economy, config: { ...config, unpricedCap: cap } } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
  }
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { purchase: { mode }, transfer: { mode } } } }));
  await rig.turn(chatId, "I look around.", "The street wakes up.");
  return { rig, chatId };
}

/** The player character's accounts brought to these balances (minor units) by one GM edit, with `ops` before them. */
async function balances(rig: Rig, chatId: string, to: Record<string, number>, ops: EditOp[] = []): Promise<void> {
  const now = await folded(rig, chatId);
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [...ops, ...Object.entries(to).map(([account, cents]): EditOp => ({ op: "adjust", account, cents: cents - (now.accounts[account] ?? 0) }))] }));
}

/**
 * A quiet reply on two swipes: `edits` are GM edits made after its first; its second, written
 * instead, has none. On the second, the next reply narrates `proposals`. The quiet reply's id and
 * the next one's; going back to the first swipe makes the next one's turn a rebased view.
 */
async function branched(rig: Rig, chatId: string, edits: EditOp[], proposals: JsonObject[], reply: string): Promise<{ earlier: string; later: string }> {
  await rig.turn(chatId, "I wait a while.", "A quiet hour passes.");
  const earlier = rig.host.head(chatId)?.id ?? "";
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: edits }));
  rig.host.addSwipe(chatId, earlier, "A quieter hour passes.");
  await rig.host.settle();
  await narrate(rig, chatId, proposals, reply);
  return { earlier, later: rig.host.head(chatId)?.id ?? "" };
}

/** Checking drawing on savings when it runs short (§25.10). */
const LINKED: EditOp[] = [
  { op: "set", entity: "acct_pov_checking", field: "overdraft", value: "linked" },
  { op: "set", entity: "acct_pov_checking", field: "overdraft_link", value: "acct_pov_savings" },
];

/**
 * Port Alder with nothing of the player character's that can run a debt: checking and the credit
 * card frozen, $78.00 in the wallet and $50.00 in savings.
 */
async function nothingToRunADebt(): Promise<{ rig: Rig; chatId: string }> {
  const { rig, chatId } = await alder("auto");
  rig.body(await rig.send({ type: "lre.fix", chatId, entity: "pov", field: "cash", value: 7800 }));
  const savings = (await folded(rig, chatId)).accounts.acct_pov_savings ?? 0;
  rig.body(
    await rig.send({
      type: "lre.edit",
      chatId,
      ops: [
        { op: "effect", effect: "economy.set_status", args: { account: "acct_pov_checking", status: "frozen" } },
        { op: "effect", effect: "economy.set_status", args: { account: "acct_pov_card", status: "frozen" } },
        { op: "adjust", account: "acct_pov_savings", cents: 5000 - savings },
      ],
    }),
  );
  return { rig, chatId };
}

/** A reply the extract step reads as `proposals`; every other step says nothing. */
async function narrate(rig: Rig, chatId: string, proposals: JsonObject[], reply: string): Promise<void> {
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals }) : "{}");
  await rig.turn(chatId, "I look over the shelves.", reply);
  rig.host.quietReply = () => "{}";
}

/** The head reply's chips of `kind`. */
async function chipsOf(rig: Rig, chatId: string, kind: Chip["kind"]): Promise<Chip[]> {
  const head = rig.host.head(chatId);
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id && c.kind === kind);
}

/** Everyone's money by account, and who owns each thing by name. */
async function holdings(rig: Rig, chatId: string) {
  const state = await folded(rig, chatId);
  return { accounts: { ...state.accounts }, owners: Object.fromEntries(Object.values(state.entities).flatMap((e) => (typeof e.fields.owner === "string" ? [[e.name, e.fields.owner]] : []))) };
}

async function tap(rig: Rig, chatId: string, chip: Chip | undefined, choice: string, payload?: JsonObject): Promise<Record<string, unknown>> {
  return rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id ?? "", choice, ...(payload ? { payload } : {}) }));
}

describe("a narrated payment with nothing that covers it or can run a debt", () => {
  test("a purchase is the player character's with nothing charged, and its chip says so; Undo takes it back", async () => {
    const { rig, chatId } = await nothingToRunADebt();
    const before = await holdings(rig, chatId);
    await narrate(rig, chatId, [{ type: "purchase", payer: "pov", item: "brass ship's compass", price: 165 }], "The clerk wraps the compass.");
    const after = await holdings(rig, chatId);
    expect(after.owners["brass ship's compass"]).toBe("pov");
    expect(after.accounts).toEqual(before.accounts);
    const [chip] = await chipsOf(rig, chatId, "undo");
    expect(chip?.label).toBe("Bought brass ship's compass: nothing charged");
    expect(chip?.detail).toBe("Applied automatically. Nothing you pay with covers $174.90 or can run a debt: it's yours with nothing charged.");
    expect(chip?.actions.map((a) => a.id)).toEqual(["undo"]);
    expect((await tap(rig, chatId, chip, "undo")).applied).toBe(true);
    expect((await holdings(rig, chatId)).owners["brass ship's compass"]).toBeUndefined();
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a payment moves nothing and is a Not tracked receipt that says why", async () => {
    const { rig, chatId } = await nothingToRunADebt();
    const danny = async (): Promise<number> => {
      const state = await folded(rig, chatId);
      return Object.entries(state.accounts)
        .filter(([id]) => heldBy(state.entities, id, DANNY) || id === `${EXTERNAL_ACCOUNT_PREFIX}${DANNY}`)
        .reduce((sum, [, cents]) => sum + cents, 0);
    };
    const before = await holdings(rig, chatId);
    const start = await danny();
    await narrate(rig, chatId, [{ type: "transfer", from: "pov", to: DANNY, amount: 200 }], "You send Danny the $200 you owe him.");
    expect((await holdings(rig, chatId)).accounts).toEqual(before.accounts);
    expect(await danny()).toBe(start);
    expect(await chipsOf(rig, chatId, "undo")).toEqual([]);
    const [receipt] = await chipsOf(rig, chatId, "untracked");
    expect(receipt?.label).toBe("Not tracked: Paid $200.00 to Danny Okafor");
    expect(receipt?.detail).toBe("Jordan Ellis has nothing that covers $200.00 or can run a debt, so nothing was paid. The story stands as told, and the next reply isn't told otherwise.");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a narrated purchase its checking's overdraft covers", () => {
  test("when only the overdraft fee goes past the limit, the chip says where it went and never that nothing covered it", async () => {
    const { rig, chatId } = await alder("auto");
    const checking = (await folded(rig, chatId)).accounts.acct_pov_checking ?? 0;
    // $85.00 in checking and $100.00 of overdraft: the compass's $174.90 is inside them, its fee isn't.
    rig.body(
      await rig.send({
        type: "lre.edit",
        chatId,
        ops: [
          { op: "set", entity: "acct_pov_checking", field: "overdraft", value: "fee" },
          { op: "set", entity: "acct_pov_checking", field: "overdraft_limit", value: 10000 },
          { op: "adjust", account: "acct_pov_checking", cents: 8500 - checking },
        ],
      }),
    );
    await narrate(rig, chatId, [{ type: "purchase", payer: "pov", item: "brass ship's compass", price: 165, method: "debit card" }], "You pay with your debit card and the clerk wraps the compass.");
    const after = (await folded(rig, chatId)).accounts.acct_pov_checking ?? 0;
    // Overdrawn past its $100.00 limit, by the fee alone.
    expect(after).toBeLessThan(8500 - 17490);
    expect(after).toBeLessThan(-10000);
    const [chip] = await chipsOf(rig, chatId, "undo");
    expect(chip?.label).toBe("Bought brass ship's compass: $174.90");
    expect(chip?.detail).toBe(`Applied automatically. From Your checking account: overdrawn by $${(-after / 100).toFixed(2)}.`);
    expect(chip?.actions.map((a) => a.id)).toEqual(["undo"]);
  });

  test("a rebased view where savings can't spare the linked overdraft transfer: one Keep-report row, for the transfer alone; the compass stays and checking carries the whole overdraft", async () => {
    const { rig, chatId } = await alder("auto");
    const start = await folded(rig, chatId);
    // Checking draws on savings when it runs short: $20.00 in checking, $50.00 in savings.
    rig.body(
      await rig.send({
        type: "lre.edit",
        chatId,
        ops: [
          { op: "set", entity: "acct_pov_checking", field: "overdraft", value: "linked" },
          { op: "set", entity: "acct_pov_checking", field: "overdraft_link", value: "acct_pov_savings" },
          { op: "adjust", account: "acct_pov_checking", cents: 2000 - (start.accounts.acct_pov_checking ?? 0) },
          { op: "adjust", account: "acct_pov_savings", cents: 5000 - (start.accounts.acct_pov_savings ?? 0) },
        ],
      }),
    );
    // One reply moves $40.00 of savings into the wallet; its other swipe moves nothing.
    await narrate(rig, chatId, [{ type: "transfer", from: "acct_pov_savings", to: "acct_pov_cash", amount: 40 }], "You move forty dollars from savings into your wallet.");
    const moved = rig.host.head(chatId)?.id ?? "";
    expect((await folded(rig, chatId)).accounts.acct_pov_savings).toBe(1000);
    rig.host.addSwipe(chatId, moved, "You leave your savings alone.");
    await rig.host.settle();
    // On that swipe the compass is bought with the debit card: savings' $50.00 moves over first.
    await narrate(rig, chatId, [{ type: "purchase", payer: "pov", item: "brass ship's compass", price: 165, method: "debit card" }], "You pay with your debit card and the clerk wraps the compass.");
    const bought = rig.host.head(chatId)?.id ?? "";
    const own = await folded(rig, chatId);
    expect([own.accounts.acct_pov_checking, own.accounts.acct_pov_savings]).toEqual([2000 + 5000 - 17490, 0]);
    // Back on the swipe that moved $40.00: savings holds $10.00, too little for the transfer.
    rig.host.navigate(chatId, moved, 0);
    await rig.host.settle();
    const rebased = await folded(rig, chatId);
    expect([rebased.accounts.acct_pov_checking, rebased.accounts.acct_pov_savings]).toEqual([2000 - 17490, 1000]);
    expect(Object.values(rebased.entities).some((e) => e.name === "brass ship's compass" && e.fields.owner === "pov")).toBe(true);
    const lines = (await rig.rt.view(chatId, rig.host.userId)).keepReport.filter((k) => k.messageId === bought);
    expect(keepSummary(lines).count).toBe(1);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.status).toBe("dropped");
      expect(line.text).toContain("Overdraft transfer");
      expect(line.text).not.toContain("compass");
    }
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a narrated purchase on a rebased view", () => {
  test("where checking was frozen, the purchase and the overdraft transfer it brought drop together, alike in both folds", async () => {
    const { rig, chatId } = await alder("auto");
    // $20.00 in checking, which draws on savings' $500.00 when it runs short.
    await balances(rig, chatId, { acct_pov_checking: 2000, acct_pov_savings: 50000 }, LINKED);
    // On the first swipe checking was frozen.
    const { earlier, later } = await branched(rig, chatId, [{ op: "effect", effect: "economy.set_status", args: { account: "acct_pov_checking", status: "frozen" } }], [{ ...COMPASS, method: "debit card" }], "You pay with your debit card and the clerk wraps the compass.");
    // On its own path savings covers what checking lacks.
    const own = await bothFolds(rig, chatId);
    expect([own.state.accounts.acct_pov_checking, own.state.accounts.acct_pov_savings]).toEqual([0, 50000 - (17490 - 2000)]);
    rig.host.navigate(chatId, earlier, 0);
    await rig.host.settle();
    const view = await bothFolds(rig, chatId);
    expect(view.messages.find((m) => m.id === later)?.fold).toBe("view");
    expect([view.state.accounts.acct_pov_checking, view.state.accounts.acct_pov_savings]).toEqual([2000, 50000]);
    expect(Object.values(view.state.entities).some((e) => e.name === "brass ship's compass")).toBe(false);
    const lines = view.keepReport.filter((k) => k.messageId === later);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((k) => k.status === "dropped")).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("Pay another way where the overdraft transfer didn't land moves the payment alone, and gives savings nothing it didn't lose", async () => {
    const { rig, chatId } = await alder("auto");
    await balances(rig, chatId, { acct_pov_checking: 2000, acct_pov_savings: 5000 }, LINKED);
    // On the first swipe $40.00 left savings, which then can't spare the $50.00 transfer.
    const { earlier } = await branched(rig, chatId, [{ op: "adjust", account: "acct_pov_savings", cents: -4000 }], [{ ...COMPASS, method: "debit card" }], "You pay with your debit card and the clerk wraps the compass.");
    const [chip] = await chipsOf(rig, chatId, "undo");
    expect(chip?.actions.map((a) => a.id)).toContain("other");
    rig.host.navigate(chatId, earlier, 0);
    await rig.host.settle();
    const before = await folded(rig, chatId);
    expect([before.accounts.acct_pov_checking, before.accounts.acct_pov_savings]).toEqual([2000 - 17490, 1000]);
    expect((await tap(rig, chatId, chip, "other")).applied).toBe(true);
    const after = await folded(rig, chatId);
    expect([after.accounts.acct_pov_checking, after.accounts.acct_pov_savings]).toEqual([2000, 1000]);
    expect(after.accounts.acct_pov_card).toBe((before.accounts.acct_pov_card ?? 0) - 17490);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("Pay another way where the payment itself didn't land is refused, and nothing moves", async () => {
    const { rig, chatId } = await alder("auto");
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: "pov", field: "cash", value: 7800 }));
    // $50.00 in checking and $50.00 left on the card: the compass goes on the card past its limit.
    await balances(rig, chatId, { acct_pov_checking: 5000, acct_pov_card: -445000 });
    // On the first swipe the card was frozen.
    const { earlier } = await branched(rig, chatId, [{ op: "effect", effect: "economy.set_status", args: { account: "acct_pov_card", status: "frozen" } }], [COMPASS], "The clerk wraps the compass.");
    const [chip] = await chipsOf(rig, chatId, "undo");
    expect(chip?.actions.map((a) => a.id)).toContain("other");
    rig.host.navigate(chatId, earlier, 0);
    await rig.host.settle();
    const before = await holdings(rig, chatId);
    expect(before.owners["brass ship's compass"]).toBeUndefined();
    const refused = await rig.send({ type: "lre.chip", chatId, chip: chip?.id ?? "", choice: "other" });
    expect(refused.type).toBe("lre.error");
    expect((await holdings(rig, chatId)).accounts).toEqual(before.accounts);
  });
});

describe("Edit amount on a purchase that applied by itself", () => {
  test("a taxed purchase whose narrated price was capped is charged what's typed, in all", async () => {
    const { rig, chatId } = await alder("auto", 2000);
    const paid = async (): Promise<number> => {
      const a = (await folded(rig, chatId)).accounts;
      return ["acct_pov_cash", "acct_pov_checking", "acct_pov_savings", "acct_pov_card"].reduce((sum, id) => sum + (a[id] ?? 0), 0);
    };
    const start = await paid();
    await narrate(rig, chatId, [{ type: "purchase", payer: "pov", item: "tin whistle", price: 30 }], "You pay thirty dollars for a tin whistle.");
    const [chip] = await chipsOf(rig, chatId, "undo");
    expect(chip?.label).toContain("narrated $30.00, capped at");
    expect(chip?.actions.map((a) => a.id)).toContain("amount");
    // $20.00, the cap, and Michigan's sales tax on it.
    expect(start - (await paid())).toBe(2120);
    expect((await tap(rig, chatId, chip, "amount", { cents: 3000 })).applied).toBe(true);
    expect(start - (await paid())).toBe(3000);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("where the purchase itself didn't land, Edit amount is refused, and nothing moves", async () => {
    const { rig, chatId } = await alder("auto", 2000);
    const cash = (await folded(rig, chatId)).accounts.acct_pov_cash ?? 0;
    // Paid in cash; on the first swipe the wallet came down to $10.00, short of the whistle's $21.20.
    const { earlier } = await branched(rig, chatId, [{ op: "adjust", account: "acct_pov_cash", cents: 1000 - cash }], [{ type: "purchase", payer: "pov", item: "tin whistle", price: 30, method: "cash" }], "You pay thirty dollars in cash for a tin whistle.");
    const [chip] = await chipsOf(rig, chatId, "undo");
    expect(chip?.actions.map((a) => a.id)).toContain("amount");
    expect((await folded(rig, chatId)).accounts.acct_pov_cash).toBe(cash - 2120);
    rig.host.navigate(chatId, earlier, 0);
    await rig.host.settle();
    const before = await holdings(rig, chatId);
    expect(before.owners["tin whistle"]).toBeUndefined();
    expect(before.accounts.acct_pov_cash).toBe(1000);
    const refused = await rig.send({ type: "lre.chip", chatId, chip: chip?.id ?? "", choice: "amount", payload: { cents: 3000 } });
    expect(refused.type).toBe("lre.error");
    expect((await holdings(rig, chatId)).accounts).toEqual(before.accounts);
  });
});

describe("a correction made where the payment stood, on a version of the story where it didn't", () => {
  test("an Edit amount drops with the cash purchase it corrected, alike in both folds: the wallet gets nothing back for a purchase never made", async () => {
    const { rig, chatId } = await alder("auto", 2000);
    const cash = (await folded(rig, chatId)).accounts.acct_pov_cash ?? 0;
    // Paid in cash; on the first swipe the wallet came down to $10.00, short of the whistle's $21.20.
    const { earlier, later } = await branched(rig, chatId, [{ op: "adjust", account: "acct_pov_cash", cents: 1000 - cash }], [{ type: "purchase", payer: "pov", item: "tin whistle", price: 30, method: "cash" }], "You pay thirty dollars in cash for a tin whistle.");
    const [chip] = await chipsOf(rig, chatId, "undo");
    // Where it stood, the whistle really cost $5.00 in all: $16.20 comes back.
    expect((await tap(rig, chatId, chip, "amount", { cents: 500 })).applied).toBe(true);
    expect((await folded(rig, chatId)).accounts.acct_pov_cash).toBe(cash - 500);
    rig.host.navigate(chatId, earlier, 0);
    await rig.host.settle();
    const view = await bothFolds(rig, chatId);
    expect(view.messages.find((m) => m.id === later)?.fold).toBe("view");
    expect(Object.values(view.state.entities).some((e) => e.name === "tin whistle")).toBe(false);
    expect(view.state.accounts.acct_pov_cash).toBe(1000);
    const lines = view.keepReport.filter((k) => k.messageId === later);
    expect(lines.some((k) => "in" in k.ref && k.ref.in === "post")).toBe(true);
    expect(lines.every((k) => k.status === "dropped")).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a Pay another way drops with the payment it moved: the account it moved to pays nothing", async () => {
    const { rig, chatId } = await alder("auto");
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: "pov", field: "cash", value: 7800 }));
    // $50.00 in checking and $50.00 left on the card: the compass goes on the card past its limit.
    await balances(rig, chatId, { acct_pov_checking: 5000, acct_pov_card: -445000 });
    const savings = (await folded(rig, chatId)).accounts.acct_pov_savings ?? 0;
    // On the first swipe the card was frozen.
    const { earlier } = await branched(rig, chatId, [{ op: "effect", effect: "economy.set_status", args: { account: "acct_pov_card", status: "frozen" } }], [COMPASS], "The clerk wraps the compass.");
    const [chip] = await chipsOf(rig, chatId, "undo");
    expect((await tap(rig, chatId, chip, "other")).applied).toBe(true);
    const moved = await folded(rig, chatId);
    expect([moved.accounts.acct_pov_savings, moved.accounts.acct_pov_card]).toEqual([savings - 17490, -445000]);
    rig.host.navigate(chatId, earlier, 0);
    await rig.host.settle();
    const view = await bothFolds(rig, chatId);
    expect(Object.values(view.state.entities).some((e) => e.name === "brass ship's compass")).toBe(false);
    expect([view.state.accounts.acct_pov_savings, view.state.accounts.acct_pov_card]).toEqual([savings, -445000]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a Pay another way gives the overdraft link nothing back where its transfer didn't land, and still moves the payment", async () => {
    const { rig, chatId } = await alder("auto");
    // $100.00 in checking, which draws on savings' $50.00 when it runs short.
    await balances(rig, chatId, { acct_pov_checking: 10000, acct_pov_savings: 5000 }, LINKED);
    const card = (await folded(rig, chatId)).accounts.acct_pov_card ?? 0;
    // On the first swipe $40.00 left savings, which then can't spare the $50.00 transfer.
    const { earlier } = await branched(rig, chatId, [{ op: "adjust", account: "acct_pov_savings", cents: -4000 }], [{ ...COMPASS, method: "debit card" }], "You pay with your debit card and the clerk wraps the compass.");
    const own = await folded(rig, chatId);
    expect([own.accounts.acct_pov_checking, own.accounts.acct_pov_savings]).toEqual([10000 + 5000 - 17490, 0]);
    const [chip] = await chipsOf(rig, chatId, "undo");
    // Where the transfer landed, the payment moves to the card and the $50.00 goes back to savings.
    expect((await tap(rig, chatId, chip, "other")).applied).toBe(true);
    const moved = await folded(rig, chatId);
    expect([moved.accounts.acct_pov_checking, moved.accounts.acct_pov_savings, moved.accounts.acct_pov_card]).toEqual([10000, 5000, card - 17490]);
    rig.host.navigate(chatId, earlier, 0);
    await rig.host.settle();
    const view = await bothFolds(rig, chatId);
    // There savings never sent the $50.00: it gets none back, and the payment still moves to the card.
    expect([view.state.accounts.acct_pov_checking, view.state.accounts.acct_pov_savings, view.state.accounts.acct_pov_card]).toEqual([10000, 1000, card - 17490]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a narrated purchase nothing prices that someone else made", () => {
  test("auto: the chip says whose it is, and never calls it the player character's", async () => {
    const { rig, chatId } = await alder("auto");
    await narrate(rig, chatId, [{ type: "purchase", payer: DANNY, item: "tin whistle" }], "Danny pockets a tin whistle.");
    expect((await holdings(rig, chatId)).owners["tin whistle"]).toBe(DANNY);
    const [chip] = await chipsOf(rig, chatId, "undo");
    expect(chip?.label).toBe("Bought tin whistle: no price");
    expect(chip?.detail).toStartWith("Danny Okafor has it, with nothing charged:");
    expect(chip?.detail).not.toContain("yours");
  });

  test("confirm: the ask and the chip Apply leaves both say whose it is", async () => {
    const { rig, chatId } = await alder("confirm");
    await narrate(rig, chatId, [{ type: "purchase", payer: DANNY, item: "tin whistle" }], "Danny pockets a tin whistle.");
    const [ask] = await chipsOf(rig, chatId, "confirm");
    expect(ask?.detail).toContain("Apply gives it to Danny Okafor with nothing charged;");
    expect(ask?.detail).not.toContain("yours");
    expect((await tap(rig, chatId, ask, "confirm")).applied).toBe(true);
    expect((await holdings(rig, chatId)).owners["tin whistle"]).toBe(DANNY);
    const [left] = await chipsOf(rig, chatId, "undo");
    expect(left?.detail).toStartWith("Danny Okafor has it, with nothing charged:");
    expect(left?.detail).not.toContain("yours");
  });
});
