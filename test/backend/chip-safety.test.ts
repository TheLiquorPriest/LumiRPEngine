// Stored chips act once even when what follows the action fails (DESIGN §11): a chip whose ledger
// write landed is taken before its learning runs, and a learning failure is logged, never retried by
// a second tap.

import { describe, expect, test } from "bun:test";
import { Rig } from "../support/rig";
import { POV, testWorld } from "../support/test-pack";

const EXTRACT_MARK = "propose concrete state changes";
const LEARNING = "extraction-learning.json";

/** A $30 lamp: purchases confirm by default. */
const LAMP = { type: "purchase", payer: POV, item: "lamp", price: 30 };

/** Taps a chip `times` times in a row; each reply as its type, or its code for an error. */
async function taps(rig: Rig, chatId: string, chip: string, choice: string, times: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < times; i++) {
    const reply = await rig.send({ type: "lre.chip", chatId, chip, choice });
    out.push(reply.type === "lre.error" ? reply.code : reply.type);
  }
  return out;
}

/** Confirm entries posted on the head reply's swipe. */
async function confirmPosts(rig: Rig, chatId: string): Promise<number> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes["0"] : undefined;
  return rec?.post.filter((p) => p.kind === "confirm").length ?? 0;
}

describe("stored chips act once", () => {
  test("Apply on a confirm chip whose learning throws posts once: three taps, one purchase", async () => {
    const rig = new Rig();
    // The file's shape is fine; the entry under the turn's connection is a number.
    await rig.host.storage.write(LEARNING, JSON.stringify({ v: 1, connections: { active: 5 } }), rig.host.userId);
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [LAMP] }) : "{}");
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I buy the lamp.", "She rings up the lamp: thirty dollars.");
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "confirm");
    if (!chip) throw new Error("no confirm chip");
    const start = Number(await rig.cashOf(chatId));
    expect(await taps(rig, chatId, chip.id, "confirm", 3)).toEqual(["lre.result", "not_found", "not_found"]);
    expect(Number(await rig.cashOf(chatId))).toBe(start - 30);
    expect(await confirmPosts(rig, chatId)).toBe(1);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.id === chip.id)).toBe(false);
    // The malformed entry was dropped when the file was read, so the Apply was counted.
    expect((await rig.rt.settings.learningOf(rig.host.userId)).connections.active?.purchase?.accepted).toBe(1);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a learning save that fails after Apply or Undo is logged, and the chip is still taken: each acts once", async () => {
    const rig = new Rig();
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "condition", entity: POV, field: "cash", delta: 7 }, LAMP] }) : "{}");
    const chatId = await rig.worldChat();
    const start = Number(testWorld().entities[POV]?.fields.cash);
    await rig.turn(chatId, "I buy the lamp.", "Dev slips you seven bucks; she rings up the lamp: thirty dollars.");
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
    const confirm = chips.find((c) => c.kind === "confirm");
    const undo = chips.find((c) => c.kind === "undo");
    if (!confirm || !undo) throw new Error("no confirm and undo chips");
    expect(Number(await rig.cashOf(chatId))).toBe(start + 7);
    // From here on the learning file can't be written.
    const write = rig.host.storage.write;
    rig.host.storage.write = (path, data, userId) => (path.startsWith(LEARNING) ? Promise.reject(new Error("storage is full")) : write(path, data, userId));
    expect(await taps(rig, chatId, confirm.id, "confirm", 3)).toEqual(["lre.result", "not_found", "not_found"]);
    expect(Number(await rig.cashOf(chatId))).toBe(start + 7 - 30);
    expect(await taps(rig, chatId, undo.id, "undo", 2)).toEqual(["lre.result", "not_found"]);
    expect(Number(await rig.cashOf(chatId))).toBe(start - 30);
    expect(await confirmPosts(rig, chatId)).toBe(1);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.id === confirm.id || c.id === undo.id)).toBe(false);
    const warnings = (rig.host.userLogs.get(rig.host.userId) ?? []).filter((l) => l.startsWith("warn: [LumiRPEngine]") && l.includes("storage is full"));
    expect(warnings.length).toBe(2);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("chips follow a swipe delete", () => {
  /** A chat whose head reply has a swipe per text, each read in turn (a lamp in the text is a $30 purchase to confirm); the last one is shown. */
  async function swipes(texts: readonly string[]): Promise<{ rig: Rig; chatId: string; head: string }> {
    const rig = new Rig();
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? JSON.stringify({ proposals: (req.messages[1]?.content ?? "").includes("lamp") ? [LAMP] : [] }) : "{}");
    const chatId = await rig.worldChat();
    const [first, ...rest] = texts;
    await rig.turn(chatId, "I look around the shop.", first ?? "");
    const head = rig.host.head(chatId)?.id ?? "";
    for (const text of rest) await rig.host.finish(await rig.host.start(chatId, { type: "swipe", messageId: head }), text);
    return { rig, chatId, head };
  }
  const lamps = async (rig: Rig, chatId: string) => (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "confirm" && `${c.label} ${c.detail ?? ""}`.includes("lamp"));

  test("a deleted reply's confirm chip doesn't show on the swipe that takes its index, and a tap on it charges nothing", async () => {
    const { rig, chatId, head } = await swipes(["She rings up the lamp: thirty dollars.", "Nothing catches your eye."]);
    // On the lamp's swipe, its chip; on the other, none.
    rig.host.navigate(chatId, head, 0);
    await rig.host.settle();
    const [chip] = await lamps(rig, chatId);
    if (!chip) throw new Error("no lamp chip");
    rig.host.navigate(chatId, head, 1);
    await rig.host.settle();
    expect(await lamps(rig, chatId)).toEqual([]);
    const start = Number(await rig.cashOf(chatId));
    // The lamp's swipe goes: the one left takes its index.
    rig.host.deleteSwipe(chatId, head, 0);
    await rig.host.settle();
    expect(await lamps(rig, chatId)).toEqual([]);
    const reply = await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "confirm" });
    expect(reply.type === "lre.error" && reply.code).toBe("not_found");
    expect(Number(await rig.cashOf(chatId))).toBe(start);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the chips of the swipes after it move down with them: shown on their own reply, applied once", async () => {
    const { rig, chatId, head } = await swipes(["Nothing catches your eye.", "She rings up the lamp: thirty dollars.", "Still nothing."]);
    rig.host.deleteSwipe(chatId, head, 0);
    await rig.host.settle();
    // The last reply is shown, now swipe 1: the lamp isn't on it.
    expect(await lamps(rig, chatId)).toEqual([]);
    rig.host.navigate(chatId, head, 0);
    await rig.host.settle();
    const [chip] = await lamps(rig, chatId);
    if (!chip) throw new Error("the lamp's chip didn't move with its reply");
    const start = Number(await rig.cashOf(chatId));
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "confirm" })).applied).toBe(true);
    expect(Number(await rig.cashOf(chatId))).toBe(start - 30);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a tap on a swipe's chip while another swipe is shown applies nothing", async () => {
    const { rig, chatId, head } = await swipes(["She rings up the lamp: thirty dollars.", "Nothing catches your eye."]);
    rig.host.navigate(chatId, head, 0);
    await rig.host.settle();
    const [chip] = await lamps(rig, chatId);
    if (!chip) throw new Error("no lamp chip");
    rig.host.navigate(chatId, head, 1);
    await rig.host.settle();
    const start = Number(await rig.cashOf(chatId));
    const reply = await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "confirm" });
    expect(reply.type === "lre.error" && reply.code).toBe("not_found");
    expect(Number(await rig.cashOf(chatId))).toBe(start);
  });
});
