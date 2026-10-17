// Reads of a stopped reply: a Retry read reads everything saved, a Continue included, and replaces
// what was read meanwhile, so no change lands twice; a refused read changes nothing.

import { describe, expect, test } from "bun:test";
import type { Chip } from "../../src/shared/state-view";
import { toChain } from "../../src/backend/ledger-io";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

const EXTRACT_MARK = "propose concrete state changes";

/** Extraction finds a $5 tip (automatic, with an Undo chip) and a $30 lamp (a confirm chip) wherever the text says so. */
function reader(rig: Rig): void {
  rig.host.quietReply = (req) => {
    if (!req.messages[0]?.content.includes(EXTRACT_MARK)) return "{}";
    const narration = req.messages[1]?.content.split("Narration:\n")[1] ?? "";
    const proposals = [
      ...(narration.includes("tip") ? [{ type: "condition", entity: POV, field: "cash", delta: 5 }] : []),
      ...(narration.includes("lamp") ? [{ type: "purchase", payer: POV, item: "lamp", price: 30 }] : []),
    ];
    return JSON.stringify({ proposals });
  };
}

async function stoppedTurn(rig: Rig, chatId: string): Promise<string> {
  rig.host.sendUser(chatId, "I look around.");
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  await rig.host.finish(g, "Half a reply.", { error: "provider timeout" });
  const head = rig.host.head(chatId);
  if (!head) throw new Error("no reply");
  return head.id;
}

async function chips(rig: Rig, chatId: string): Promise<Chip[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips;
}

async function tap(rig: Rig, chatId: string, kind: string, choice: string): Promise<void> {
  const chip = (await chips(rig, chatId)).find((c) => c.kind === kind);
  if (!chip) throw new Error(`no ${kind} chip`);
  rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice }));
}

const lampChip = async (rig: Rig, chatId: string): Promise<Chip[]> => (await chips(rig, chatId)).filter((c) => c.kind === "confirm" && `${c.label} ${c.detail ?? ""}`.includes("lamp"));

describe("Retry read of a stopped reply", () => {
  test("after a finished Continue: the full read replaces the Continue's read, so the tip lands once and the lamp charges once", async () => {
    const rig = new Rig();
    reader(rig);
    const chatId = await rig.worldChat();
    const start = Number(await rig.cashOf(chatId));
    const id = await stoppedTurn(rig, chatId);
    const c = await rig.host.start(chatId, { type: "continue", messageId: id });
    await rig.host.finish(c, " Sam finds a tip and eyes a lamp.");
    await tap(rig, chatId, "retry_read", "retry_read");
    expect(Number(await rig.cashOf(chatId))).toBe(start + 5);
    expect((await chips(rig, chatId)).filter((ch) => ch.kind === "undo")).toHaveLength(1);
    expect(await lampChip(rig, chatId)).toHaveLength(1);
    await tap(rig, chatId, "confirm", "confirm");
    expect(Number(await rig.cashOf(chatId))).toBe(start + 5 - 30);
    // The reply is read now: no Retry read is left to tap.
    expect((await chips(rig, chatId)).some((ch) => ch.kind === "retry_read")).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("after a stopped Continue: the Retry read reads the whole saved text once; tapping it again can't charge twice", async () => {
    const rig = new Rig();
    reader(rig);
    const chatId = await rig.worldChat();
    const start = Number(await rig.cashOf(chatId));
    const id = await stoppedTurn(rig, chatId);
    const c = await rig.host.start(chatId, { type: "continue", messageId: id });
    await rig.host.stop(c, " Sam finds a tip and eyes a lamp.");
    const retry = (await chips(rig, chatId)).find((ch) => ch.kind === "retry_read");
    expect(retry).toBeDefined();
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: retry?.id, choice: "retry_read" }));
    expect(Number(await rig.cashOf(chatId))).toBe(start + 5);
    expect((await chips(rig, chatId)).filter((ch) => ch.kind === "undo")).toHaveLength(1);
    expect(await lampChip(rig, chatId)).toHaveLength(1);
    await tap(rig, chatId, "confirm", "confirm");
    expect(Number(await rig.cashOf(chatId))).toBe(start + 5 - 30);
    // The chip lapsed with the read: a second tap is refused and nothing is charged again.
    expect((await rig.send({ type: "lre.chip", chatId, chip: retry?.id, choice: "retry_read" })).type).toBe("lre.error");
    expect(Number(await rig.cashOf(chatId))).toBe(start + 5 - 30);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a Re-read edit of a stopped reply reads it, so no leftover Retry read re-reads and charges twice", async () => {
    const rig = new Rig();
    reader(rig);
    const chatId = await rig.worldChat();
    const start = Number(await rig.cashOf(chatId));
    const id = await stoppedTurn(rig, chatId);
    const c = await rig.host.start(chatId, { type: "continue", messageId: id });
    await rig.host.stop(c, " Sam finds a tip and eyes a lamp.");
    await tap(rig, chatId, "reread", "reread");
    await tap(rig, chatId, "confirm", "confirm");
    expect(Number(await rig.cashOf(chatId))).toBe(start + 5 - 30);
    const left = (await chips(rig, chatId)).find((ch) => ch.kind === "retry_read");
    if (left) rig.body(await rig.send({ type: "lre.chip", chatId, chip: left.id, choice: "retry_read" }));
    expect(left).toBeUndefined();
    expect((await lampChip(rig, chatId)).length).toBe(0);
    expect(Number(await rig.cashOf(chatId))).toBe(start + 5 - 30);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a refused read", () => {
  test("a Re-read in a paused chat makes no model call and keeps the chips", async () => {
    const rig = new Rig();
    reader(rig);
    const chatId = await rig.worldChat();
    const id = await stoppedTurn(rig, chatId);
    const c = await rig.host.start(chatId, { type: "continue", messageId: id });
    await rig.host.stop(c, " Sam finds a tip and eyes a lamp.");
    await tap(rig, chatId, "retry_read", "retry_read");
    // Accept the edit unread: a Re-read edit chip appears. Then edit an earlier user message: paused.
    rig.host.editMessage(chatId, id, `${rig.host.head(chatId)?.swipes[0] ?? ""} More lamps.`);
    await rig.host.settle();
    const user = rig.host.chat(chatId).messages.find((m) => m.isUser);
    if (!user) throw new Error("no user message");
    rig.host.editMessage(chatId, user.id, "I look around twice.");
    await rig.host.settle();
    const before = (await chips(rig, chatId)).map((ch) => ch.id);
    const calls = rig.host.quietCalls.length;
    // A paused view may hide the chip; a tap already on its way still arrives.
    const reply = await rig.send({ type: "lre.chip", chatId, chip: `reread:${id}:0`, choice: "reread" });
    expect(reply.type === "lre.error" && reply.code).toBe("paused");
    expect(rig.host.quietCalls.length).toBe(calls);
    expect((await chips(rig, chatId)).map((ch) => ch.id)).toEqual(before);
  });
});


describe("a Re-read of an edited reply", () => {
  test("'buy … pay him with your debit card' offers the purchase, and Apply charges checking once, in cents", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    // The extractor names the card the POV carries as the payer, as the live model did.
    rig.host.quietReply = (req) => {
      if (!req.messages[0]?.content.includes(EXTRACT_MARK)) return "{}";
      return req.messages[1]?.content.includes("motor oil") ? JSON.stringify({ proposals: [{ type: "purchase", payer: "pov_debit_card", item: "Quart of motor oil", category: "automotive", price: 8, method: "debit card" }] }) : "{}";
    };
    await rig.turn(chatId, "I stop by the shop.", "Marcus waves you in.");
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    rig.host.editMessage(chatId, head.id, `${head.swipes[0] ?? ""} Before you go, you buy a quart of motor oil from Marcus for $8.00 and pay him with your debit card.`);
    await rig.host.settle();
    const accounts = async (): Promise<Record<string, number>> => {
      const core = await rig.rt.ledger.core(chatId, rig.host.userId);
      return core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state.accounts ?? {};
    };
    const before = await accounts();
    await tap(rig, chatId, "reread", "reread");
    const offered = (await chips(rig, chatId)).filter((c) => c.kind === "confirm" && `${c.label} ${c.detail ?? ""}`.includes("motor oil"));
    expect(offered).toHaveLength(1);
    // The amount the chip shows (the catalog's motor oil row prices it), charged once, in cents.
    const shown = /\$(\d[\d,]*\.\d{2})/.exec(offered[0]?.label ?? "");
    expect(shown).not.toBeNull();
    await tap(rig, chatId, "confirm", "confirm");
    const after = await accounts();
    expect((after.acct_pov_checking ?? 0) - (before.acct_pov_checking ?? 0)).toBe(-Math.round(Number((shown?.[1] ?? "").replaceAll(",", "")) * 100));
    expect([after.acct_pov_cash, after.acct_pov_card]).toEqual([before.acct_pov_cash, before.acct_pov_card]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a world's own effects step", () => {
  test("money it reads as written ('$30') is charged in minor units, like extraction's", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Lamps");
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "steps", id: "fx", value: { id: "fx", purpose: "extract", template: "List what the shop sold.", output: "effects", signals: ["always"] } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { purchase: { mode: "auto" } } } }));
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes("List what the shop sold.") ? JSON.stringify({ proposals: [{ type: "purchase", payer: POV, item: "lamp", price: 30 }] }) : "{}");
    const start = Number(await rig.cashOf(chatId));
    await rig.turn(chatId, "I buy the lamp.", "She rings up the lamp: thirty dollars.");
    expect(rig.host.quietCalls.some((r) => r.messages[0]?.content.includes("Money amounts are plain amounts in USD as written"))).toBe(true);
    expect(Number(await rig.cashOf(chatId))).toBe(start - 30);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});