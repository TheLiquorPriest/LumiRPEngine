// A narrated purchase or transfer the payer can't cover still stands (DESIGN §9.5): the story wins.
// What was bought is owned, and the money goes through the payer's own way of paying, the last way
// that can run a debt taking it past what it covers. The chip says where the money went and that
// account after it, with Pay another way and Undo; under confirm it asks first. A purchase nothing
// prices is owned with nothing charged until a price is set. No note tells the next reply otherwise.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { heldBy } from "../../src/shared/finance";
import type { JsonObject } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "propose concrete state changes";
const DANNY = "danny_okafor";

/** The chat's state as it folds now. */
async function folded(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return state;
}

/**
 * Port Alder with the player character short of money: $78.00 in the wallet, $50.00 in checking and
 * $50.00 left on the credit card, savings as it starts. Purchases and payments apply as `mode` says.
 */
async function shortOfMoney(mode: "auto" | "confirm"): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { purchase: { mode }, transfer: { mode } } } }));
  await rig.turn(chatId, "I look around.", "The street wakes up.");
  rig.body(await rig.send({ type: "lre.fix", chatId, entity: "pov", field: "cash", value: 7800 }));
  const before = await folded(rig, chatId);
  const checking = (before.accounts.acct_pov_checking ?? 0) - 5000;
  // The card's limit is $4,500.00: it owes $4,450.00 after this.
  const card = (before.accounts.acct_pov_card ?? 0) + 445000;
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "adjust", account: "acct_pov_checking", cents: -checking }, { op: "adjust", account: "acct_pov_card", cents: -card }] }));
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

/** The player character's money in minor units, by account, and the things it owns by name. */
interface Holdings {
  cash: number;
  checking: number;
  savings: number;
  card: number;
  owned: string[];
}

/** The player character's money, and the things it owns by name. */
async function holdings(rig: Rig, chatId: string): Promise<Holdings> {
  const state = await folded(rig, chatId);
  const at = (id: string): number => state.accounts[id] ?? 0;
  const owned = Object.values(state.entities)
    .filter((e) => e.fields.owner === "pov")
    .map((e) => e.name);
  return { cash: at("acct_pov_cash"), checking: at("acct_pov_checking"), savings: at("acct_pov_savings"), card: at("acct_pov_card"), owned };
}

async function tap(rig: Rig, chatId: string, chip: Chip | undefined, choice: string, payload?: JsonObject): Promise<Record<string, unknown>> {
  return rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id ?? "", choice, ...(payload ? { payload } : {}) }));
}

/** The next turn's Outcome section, before its reply is written. */
async function nextOutcome(rig: Rig, chatId: string): Promise<string> {
  rig.host.sendUser(chatId, "I head out.");
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  const outcome = rig.host.section("Outcome");
  await rig.host.finish(g, "The street is quiet.");
  return outcome;
}

const COMPASS: JsonObject = { type: "purchase", payer: "pov", item: "brass ship's compass", price: 165 };

describe("a narrated purchase the payer can't cover", () => {
  test("auto: it is owned and goes on the last way that can run a debt; the chip says where and the balance after, and no note follows", async () => {
    const { rig, chatId } = await shortOfMoney("auto");
    const before = await holdings(rig, chatId);
    expect(before).toMatchObject({ cash: 7800, checking: 5000, card: -445000 });
    await narrate(rig, chatId, [COMPASS], "You count out what you have and the clerk wraps the compass.");
    const after = await holdings(rig, chatId);
    expect(after.owned).toContain("brass ship's compass");
    // $165.00 and Michigan's 6% sales tax, on the card: nothing the player pays with had it.
    expect({ cash: after.cash, checking: after.checking, savings: after.savings, card: after.card }).toEqual({ cash: before.cash, checking: before.checking, savings: before.savings, card: before.card - 17490 });
    const [chip] = await chipsOf(rig, chatId, "undo");
    expect(chip?.label).toBe("Bought brass ship's compass: $174.90 (over Your credit card's limit)");
    expect(chip?.detail).toBe("Applied automatically. On Your credit card: $4,624.90 owed, $124.90 over its limit. No way of paying covered $174.90.");
    expect(chip?.actions.map((a) => a.id)).toEqual(["other", "undo"]);
    expect(await chipsOf(rig, chatId, "decline")).toEqual([]);
    const outcome = await nextOutcome(rig, chatId);
    for (const said of ["compass", "declined", "didn't happen", "never happened"]) expect(outcome).not.toContain(said);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("auto: Pay another way moves the payment to savings, the first way that covers it, and the compass stays owned", async () => {
    const { rig, chatId } = await shortOfMoney("auto");
    const before = await holdings(rig, chatId);
    await narrate(rig, chatId, [COMPASS], "The clerk wraps the compass.");
    const [chip] = await chipsOf(rig, chatId, "undo");
    expect((await tap(rig, chatId, chip, "other")).applied).toBe(true);
    const after = await holdings(rig, chatId);
    expect({ savings: after.savings, card: after.card, checking: after.checking, cash: after.cash }).toEqual({ savings: before.savings - 17490, card: before.card, checking: before.checking, cash: before.cash });
    expect(after.owned.filter((n) => n === "brass ship's compass")).toHaveLength(1);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("auto: Undo takes the compass and its charge back", async () => {
    const { rig, chatId } = await shortOfMoney("auto");
    const before = await holdings(rig, chatId);
    await narrate(rig, chatId, [COMPASS], "The clerk wraps the compass.");
    const [chip] = await chipsOf(rig, chatId, "undo");
    expect((await tap(rig, chatId, chip, "undo")).applied).toBe(true);
    expect(await holdings(rig, chatId)).toEqual(before);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("confirm: an Apply/No chip that says where it would go; Apply makes it owned, on the card past its limit", async () => {
    const { rig, chatId } = await shortOfMoney("confirm");
    const before = await holdings(rig, chatId);
    await narrate(rig, chatId, [COMPASS], "The clerk wraps the compass.");
    expect(await holdings(rig, chatId)).toEqual(before);
    const [chip] = await chipsOf(rig, chatId, "confirm");
    expect(chip?.label).toBe("Bought brass ship's compass: $174.90 (over Your credit card's limit)");
    expect(chip?.detail).toBe("On Your credit card: $4,624.90 owed, $124.90 over its limit. No way of paying covered $174.90. The narration says this happened. Apply it?");
    expect(chip?.actions.map((a) => a.id)).toEqual(["confirm", "other", "reject"]);
    expect((await tap(rig, chatId, chip, "confirm")).applied).toBe(true);
    const after = await holdings(rig, chatId);
    expect(after.owned).toContain("brass ship's compass");
    expect(after.card).toBe(before.card - 17490);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("confirm: Pay another way pays from savings instead, and nothing goes on the card", async () => {
    const { rig, chatId } = await shortOfMoney("confirm");
    const before = await holdings(rig, chatId);
    await narrate(rig, chatId, [COMPASS], "The clerk wraps the compass.");
    const [chip] = await chipsOf(rig, chatId, "confirm");
    expect((await tap(rig, chatId, chip, "other")).applied).toBe(true);
    const after = await holdings(rig, chatId);
    expect(after.owned).toContain("brass ship's compass");
    expect({ savings: after.savings, card: after.card }).toEqual({ savings: before.savings - 17490, card: before.card });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("ignored, the chip lapses at the next send and no note reaches the next prompt", async () => {
    const { rig, chatId } = await shortOfMoney("confirm");
    await narrate(rig, chatId, [COMPASS], "The clerk wraps the compass.");
    const outcome = await nextOutcome(rig, chatId);
    for (const said of ["compass", "declined", "didn't happen", "never happened"]) expect(outcome).not.toContain(said);
  });
});

describe("a narrated purchase nothing prices", () => {
  test("auto: it is owned with nothing charged, and Set price charges it once, keeping the one thing", async () => {
    const { rig, chatId } = await shortOfMoney("auto");
    const before = await holdings(rig, chatId);
    await narrate(rig, chatId, [{ type: "purchase", payer: "pov", item: "tin whistle" }], "You pocket a tin whistle.");
    const owned = await holdings(rig, chatId);
    expect(owned.owned).toContain("tin whistle");
    expect({ cash: owned.cash, checking: owned.checking, card: owned.card, savings: owned.savings }).toEqual({ cash: before.cash, checking: before.checking, card: before.card, savings: before.savings });
    const [chip] = await chipsOf(rig, chatId, "undo");
    expect(chip?.label).toBe("Bought tin whistle: no price");
    expect(chip?.detail).toBe("It's yours, with nothing charged: the narration gives no price and the catalog doesn't list it. Set price charges it.");
    expect(chip?.actions.map((a) => a.id)).toEqual(["price", "undo"]);
    expect((await tap(rig, chatId, chip, "price", { cents: 450 })).applied).toBe(true);
    const priced = await holdings(rig, chatId);
    // $4.50 and its tax, from the wallet: it covers it.
    expect(priced.cash).toBe(before.cash - 477);
    expect(priced.owned.filter((n) => n === "tin whistle")).toHaveLength(1);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("confirm: Apply makes it owned with nothing charged and leaves Set price; Set price on the ask makes it owned and charged at once", async () => {
    const applied = await shortOfMoney("confirm");
    const before = await holdings(applied.rig, applied.chatId);
    await narrate(applied.rig, applied.chatId, [{ type: "purchase", payer: "pov", item: "tin whistle" }], "You pocket a tin whistle.");
    const [ask] = await chipsOf(applied.rig, applied.chatId, "confirm");
    expect(ask?.label).toBe("Bought tin whistle: no price");
    expect(ask?.actions.map((a) => a.id)).toEqual(["price", "confirm", "reject"]);
    expect((await tap(applied.rig, applied.chatId, ask, "confirm")).applied).toBe(true);
    const owned = await holdings(applied.rig, applied.chatId);
    expect(owned.owned).toContain("tin whistle");
    expect(owned.cash).toBe(before.cash);
    const [left] = await chipsOf(applied.rig, applied.chatId, "undo");
    expect(left?.label).toBe("Bought tin whistle: no price");
    expect(left?.actions.map((a) => a.id)).toEqual(["price", "undo"]);
    expect((await tap(applied.rig, applied.chatId, left, "price", { cents: 450 })).applied).toBe(true);
    const priced = await holdings(applied.rig, applied.chatId);
    expect(priced.cash).toBe(before.cash - 477);
    expect(priced.owned.filter((n) => n === "tin whistle")).toHaveLength(1);

    const asked = await shortOfMoney("confirm");
    await narrate(asked.rig, asked.chatId, [{ type: "purchase", payer: "pov", item: "tin whistle" }], "You pocket a tin whistle.");
    const [chip] = await chipsOf(asked.rig, asked.chatId, "confirm");
    expect((await tap(asked.rig, asked.chatId, chip, "price", { cents: 450 })).applied).toBe(true);
    const bought = await holdings(asked.rig, asked.chatId);
    expect(bought.owned).toContain("tin whistle");
    expect(bought.cash).toBe(before.cash - 477);
    expect(asked.rig.rt.ledger.errors).toEqual([]);
  });

  test("Undo on the chip an Apply left takes the thing back", async () => {
    const { rig, chatId } = await shortOfMoney("confirm");
    const before = await holdings(rig, chatId);
    await narrate(rig, chatId, [{ type: "purchase", payer: "pov", item: "tin whistle" }], "You pocket a tin whistle.");
    const [ask] = await chipsOf(rig, chatId, "confirm");
    await tap(rig, chatId, ask, "confirm");
    const [left] = await chipsOf(rig, chatId, "undo");
    expect((await tap(rig, chatId, left, "undo")).applied).toBe(true);
    expect(await holdings(rig, chatId)).toEqual(before);
  });
});

describe("a narrated payment the payer can't cover", () => {
  test("auto: Danny gets it, the money goes on the card past its limit, and Pay another way moves it to savings", async () => {
    const { rig, chatId } = await shortOfMoney("auto");
    const before = await holdings(rig, chatId);
    // Danny's money net of his opening balances: his accounts and the outside account they came from.
    const danny = async (): Promise<number> => {
      const state = await folded(rig, chatId);
      return Object.entries(state.accounts)
        .filter(([id]) => heldBy(state.entities, id, DANNY) || id === `${EXTERNAL_ACCOUNT_PREFIX}${DANNY}`)
        .reduce((sum, [, cents]) => sum + cents, 0);
    };
    const start = await danny();
    await narrate(rig, chatId, [{ type: "transfer", from: "pov", to: DANNY, amount: 200 }], "You send Danny the $200 you owe him.");
    expect(await danny()).toBe(start + 20000);
    expect((await holdings(rig, chatId)).card).toBe(before.card - 20000);
    const [chip] = await chipsOf(rig, chatId, "undo");
    expect(chip?.label).toBe("Paid $200.00 to Danny Okafor (over Your credit card's limit)");
    expect(chip?.detail).toBe("Applied automatically. On Your credit card: $4,650.00 owed, $150.00 over its limit. No way of paying covered $200.00.");
    expect(chip?.actions.map((a) => a.id)).toEqual(["other", "undo"]);
    expect((await tap(rig, chatId, chip, "other")).applied).toBe(true);
    const after = await holdings(rig, chatId);
    expect({ savings: after.savings, card: after.card }).toEqual({ savings: before.savings - 20000, card: before.card });
    expect(await danny()).toBe(start + 20000);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

/** Extraction that reads `proposals` from narration that says `said`, and nothing from any other. */
function readsWhere(rig: Rig, said: string, proposals: JsonObject[]): void {
  rig.host.quietReply = (req) => {
    if (!(req.messages[0]?.content ?? "").includes(EXTRACT_MARK)) return "{}";
    const narration = req.messages[1]?.content.split("Narration:\n")[1] ?? "";
    return JSON.stringify({ proposals: narration.includes(said) ? proposals : [] });
  };
}

/** The minutes the head reply's read moved the clock. */
async function readMinutes(rig: Rig, chatId: string): Promise<number> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = core?.chain(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).findLast((m) => !m.isUser);
  const rec = head?.ledger?.swipes[String(head.swipeId)];
  return (rec?.events.slice(rec.pre) ?? []).reduce((minutes, e) => minutes + (e.type === "clock" ? e.minutes : 0), 0);
}

/** The head reply's undo chip for the compass. */
async function compassChip(rig: Rig, chatId: string): Promise<Chip | undefined> {
  return (await chipsOf(rig, chatId, "undo")).find((c) => c.label.includes("brass ship's compass"));
}

/** A chat whose compass a read bought, and the money and things before that read. */
interface Bought {
  rig: Rig;
  chatId: string;
  before: Holdings;
}

/** The compass bought by a Continue of a reply that bought nothing. */
async function boughtOnContinue(): Promise<Bought> {
  const { rig, chatId } = await shortOfMoney("auto");
  readsWhere(rig, "compass", [COMPASS]);
  await rig.turn(chatId, "I look over the shelves.", "The shop is quiet.");
  const before = await holdings(rig, chatId);
  await rig.host.finish(await rig.host.start(chatId, { type: "continue" }), " The clerk wraps the compass.");
  return { rig, chatId, before };
}

/** The compass bought by a Re-read edit of a reply edited to say so. */
async function boughtOnReread(): Promise<Bought> {
  const { rig, chatId } = await shortOfMoney("auto");
  readsWhere(rig, "compass", [COMPASS]);
  await rig.turn(chatId, "I look over the shelves.", "The shop is quiet.");
  const before = await holdings(rig, chatId);
  const head = rig.host.head(chatId);
  if (!head) throw new Error("no reply");
  rig.host.editMessage(chatId, head.id, `${head.swipes[head.swipeId] ?? ""} The clerk wraps the compass.`);
  await rig.host.settle();
  const [reread] = await chipsOf(rig, chatId, "reread");
  await tap(rig, chatId, reread, "reread");
  return { rig, chatId, before };
}

/** The compass bought by a Retry read of a reply that stopped early. */
async function boughtOnRetryRead(): Promise<Bought> {
  const { rig, chatId } = await shortOfMoney("auto");
  readsWhere(rig, "compass", [COMPASS]);
  rig.host.sendUser(chatId, "I look over the shelves.");
  await rig.host.settle();
  await rig.host.finish(await rig.host.start(chatId, { type: "normal" }), "The clerk wraps the compass.", { error: "provider timeout" });
  const before = await holdings(rig, chatId);
  const [retry] = await chipsOf(rig, chatId, "retry_read");
  await tap(rig, chatId, retry, "retry_read");
  return { rig, chatId, before };
}

describe("an automatic purchase's chip holds the events its read recorded", () => {
  test("a reply that buys the compass and lets time pass: Undo takes back both the charge and the compass", async () => {
    const { rig, chatId } = await shortOfMoney("auto");
    const before = await holdings(rig, chatId);
    await narrate(rig, chatId, [COMPASS, { type: "time_advance", minutes: 60 }], "The clerk wraps the compass. An hour later you step back out onto the street.");
    // The hour is the turn's whole: what it runs past the turn's own time passes in the same read, ahead of the purchase.
    expect(await readMinutes(rig, chatId)).toBeGreaterThan(0);
    const bought = await holdings(rig, chatId);
    expect(bought.owned).toContain("brass ship's compass");
    expect(bought.card).toBe(before.card - 17490);
    expect((await tap(rig, chatId, await compassChip(rig, chatId), "undo")).applied).toBe(true);
    expect(await holdings(rig, chatId)).toEqual(before);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  for (const [how, buy] of [
    ["a Continue", boughtOnContinue],
    ["a Re-read edit", boughtOnReread],
    ["a Retry read", boughtOnRetryRead],
  ] as const) {
    test(`bought on ${how}: Undo takes back both the charge and the compass, and Pay another way moves the payment to savings`, async () => {
      const undone = await buy();
      const bought = await holdings(undone.rig, undone.chatId);
      expect(bought.owned).toContain("brass ship's compass");
      expect(bought.card).toBe(undone.before.card - 17490);
      const chip = await compassChip(undone.rig, undone.chatId);
      expect(chip?.actions.map((a) => a.id)).toEqual(["other", "undo"]);
      expect((await tap(undone.rig, undone.chatId, chip, "undo")).applied).toBe(true);
      expect(await holdings(undone.rig, undone.chatId)).toEqual(undone.before);
      expect(undone.rig.rt.ledger.errors).toEqual([]);

      const moved = await buy();
      expect((await tap(moved.rig, moved.chatId, await compassChip(moved.rig, moved.chatId), "other")).applied).toBe(true);
      const after = await holdings(moved.rig, moved.chatId);
      expect({ cash: after.cash, checking: after.checking, savings: after.savings, card: after.card }).toEqual({ cash: moved.before.cash, checking: moved.before.checking, savings: moved.before.savings - 17490, card: moved.before.card });
      expect(after.owned.filter((n) => n === "brass ship's compass")).toHaveLength(1);
      expect(moved.rig.rt.ledger.errors).toEqual([]);
    });
  }
});
