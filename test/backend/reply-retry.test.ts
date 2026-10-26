// A reply that fails keeps its engine turn (DESIGN §5.1): Retry the reply writes it again from that
// turn, with no engine calls and the very sections the failed reply had, and Re-run the engine runs
// the engine again first. An empty reply fails too, and none of its turn is committed.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import type { Chip } from "../../src/shared/state-view";
import type { AssembledEntry } from "../support/fake-host";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

const INTERPRET = "You map a player's typed input";
const BRIEF = "You brief a roleplay narrator";
const OUTLINE = "You outline a roleplay narrator";

/** A world chat on the Full model-use preset: each engine run writes a brief and an outline, numbered by run, so two runs' sections differ. */
async function fullChat(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig();
  const chatId = await rig.worldChat();
  rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
  let runs = 0;
  rig.host.quietReply = (req) => {
    const system = req.messages[0]?.content ?? "";
    if (system.includes(INTERPRET)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (system.includes(BRIEF)) return JSON.stringify({ text: `Sam takes stock of the shop (run ${++runs}).` });
    if (system.includes(OUTLINE)) return JSON.stringify({ beats: [`Sam looks around (run ${runs}).`] });
    return "{}";
  };
  return { rig, chatId };
}

const engineCalls = (rig: Rig, from: number): number => rig.host.quietCalls.slice(from).filter((r) => [INTERPRET, BRIEF, OUTLINE].some((mark) => (r.messages[0]?.content ?? "").includes(mark))).length;

async function card(rig: Rig, chatId: string): Promise<Chip | undefined> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "reply_failed");
}

async function clockOf(rig: Rig, chatId: string): Promise<number> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return state.clock;
}

/** The player's message, and a reply to it that fails with a provider error before anything streams: what its prompt carried. */
async function failedReply(rig: Rig, chatId: string): Promise<AssembledEntry[]> {
  rig.host.sendUser(chatId, "I look around the shop.");
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  const sections = structuredClone(rig.host.assembled);
  await rig.host.finish(g, "", { error: "provider timeout" });
  return sections;
}

describe("a reply that fails keeps its engine turn", () => {
  test("Retry the reply goes straight to the reply, with no engine calls, and its prompt carries the failed reply's sections", async () => {
    const { rig, chatId } = await fullChat();
    const before = await clockOf(rig, chatId);
    const sections = await failedReply(rig, chatId);
    expect((await card(rig, chatId))?.actions.map((a) => a.id)).toEqual(["regenerate", "rerun", "diagnostics"]);
    const calls = rig.host.quietCalls.length;
    // Retry the reply is Lumiverse's Regenerate: it goes through as it starts, with no engine run.
    const retry = await rig.host.begin(chatId, { type: "regenerate" });
    expect(retry.halted).toBeUndefined();
    expect(engineCalls(rig, calls)).toBe(0);
    expect(rig.host.assembled).toEqual(sections);
    await rig.host.finish(retry, "The shop is quiet.");
    // The turn plays once: one tick of conversation.
    expect((await clockOf(rig, chatId)) - before).toBe(2);
    expect(await card(rig, chatId)).toBeUndefined();
  });

  test("Re-run the engine runs the engine again before the reply", async () => {
    const { rig, chatId } = await fullChat();
    const sections = await failedReply(rig, chatId);
    const failed = await card(rig, chatId);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: failed?.id, choice: "rerun" }));
    const calls = rig.host.quietCalls.length;
    const g = await rig.host.start(chatId, { type: "regenerate" });
    expect(engineCalls(rig, calls)).toBeGreaterThan(0);
    expect(rig.host.assembled).not.toEqual(sections);
    await rig.host.finish(g, "The shop is quiet.");
    expect(await card(rig, chatId)).toBeUndefined();
  });

  test("an empty reply commits none of its turn, and its retry plays the turn once", async () => {
    const { rig, chatId } = await fullChat();
    const before = await clockOf(rig, chatId);
    rig.host.sendUser(chatId, "I look around the shop.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "");
    expect(await clockOf(rig, chatId)).toBe(before);
    expect((await card(rig, chatId))?.label).toBe("The reply came back empty");
    const calls = rig.host.quietCalls.length;
    const retry = await rig.host.begin(chatId, { type: "regenerate" });
    expect(retry.halted).toBeUndefined();
    expect(engineCalls(rig, calls)).toBe(0);
    await rig.host.finish(retry, "The shop is quiet.");
    expect((await clockOf(rig, chatId)) - before).toBe(2);
  });

  test("an empty reply whose text arrives after it is the turn's reply: read once, the turn played once with no engine run, and the card goes", async () => {
    const { rig, chatId } = await fullChat();
    const before = await clockOf(rig, chatId);
    rig.host.sendUser(chatId, "I look around the shop.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "");
    expect((await card(rig, chatId))?.label).toBe("The reply came back empty");
    const calls = rig.host.quietCalls.length;
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    // Lumiverse saves the text late, or the player writes it in.
    rig.host.editMessage(chatId, reply.id, "The shop is quiet; a bell rings somewhere in the back.");
    await rig.host.settle();
    expect(engineCalls(rig, calls)).toBe(0);
    const reads = rig.host.quietCalls.slice(calls).filter((r) => (r.messages[0]?.content ?? "").includes("You read a narrator's roleplay reply"));
    expect(reads.map((r) => (r.messages[1]?.content ?? "").includes("a bell rings somewhere"))).toEqual([true]);
    expect((await clockOf(rig, chatId)) - before).toBe(2);
    expect(await card(rig, chatId)).toBeUndefined();
  });

  test("a failed swipe of a reply keeps its turn for that reply: the next swipe takes it", async () => {
    const { rig, chatId } = await fullChat();
    await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
    const failed = await rig.host.start(chatId, { type: "swipe" });
    const sections = structuredClone(rig.host.assembled);
    await rig.host.finish(failed, "", { error: "provider timeout" });
    const calls = rig.host.quietCalls.length;
    const retry = await rig.host.begin(chatId, { type: "swipe" });
    expect(retry.halted).toBeUndefined();
    expect(engineCalls(rig, calls)).toBe(0);
    expect(rig.host.assembled).toEqual(sections);
  });

  test("text that streamed before the error stays unread with Retry read, and Retry the reply plays the turn on a new swipe", async () => {
    const { rig, chatId } = await fullChat();
    const before = await clockOf(rig, chatId);
    rig.host.sendUser(chatId, "I look around the shop.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "Half a re", { error: "provider timeout" });
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
    expect(chips.some((c) => c.kind === "retry_read")).toBe(true);
    expect(chips.some((c) => c.kind === "reply_failed")).toBe(true);
    const calls = rig.host.quietCalls.length;
    const retry = await rig.host.begin(chatId, { type: "regenerate" });
    expect(retry.halted).toBeUndefined();
    expect(engineCalls(rig, calls)).toBe(0);
    await rig.host.finish(retry, "The shop is quiet.");
    expect(rig.host.head(chatId)?.swipes).toEqual(["Half a re", "The shop is quiet."]);
    expect((await clockOf(rig, chatId)) - before).toBe(2);
  });

  test("the swipe option's Re-run rolls the turn again: the kept turn goes, and the engine runs", async () => {
    const { rig, chatId } = await fullChat();
    rig.host.sendUser(chatId, "I look around the shop.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "Half a re", { error: "provider timeout" });
    const option = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "swipe_option");
    expect(await card(rig, chatId)).toBeDefined();
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: option?.id, choice: "rerun" }));
    expect(await card(rig, chatId)).toBeUndefined();
    const retry = await rig.host.begin(chatId, { type: "regenerate" });
    expect(retry.halted).toBe("cancelled");
  });

  test("a change to the world before the retry drops the kept turn: its card goes, and the engine runs again", async () => {
    const { rig, chatId } = await fullChat();
    await failedReply(rig, chatId);
    expect(await card(rig, chatId)).toBeDefined();
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: POV, field: "cash", value: 50 }));
    expect(await card(rig, chatId)).toBeUndefined();
    const retry = await rig.host.begin(chatId, { type: "regenerate" });
    expect(retry.halted).toBe("cancelled");
  });
});
