// A reply that fails keeps its engine turn (DESIGN §5.1): Retry the reply writes it again from that
// turn, with no engine calls and the very sections the failed reply had, and Re-run the engine runs
// the engine again first. An empty reply fails too, and none of its turn is committed. A failure
// card, the reply's or the engine run's, starts its reply the way the stopped one started.

import { describe, expect, test } from "bun:test";
import type { ContextHandlerInput, ContextVerdict } from "../../src/backend/host";
import { OPEN_CHATS_CAP, toChain } from "../../src/backend/ledger-io";
import type { Chip } from "../../src/shared/state-view";
import { press } from "../support/chip-press";
import type { AssembledEntry, Generation } from "../support/fake-host";
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

async function card(rig: Rig, chatId: string, kind = "reply_failed"): Promise<Chip | undefined> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === kind);
}

async function clockOf(rig: Rig, chatId: string): Promise<number> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return state.clock;
}

/** What each read of a reply since call `from` was given to read. */
function readsSince(rig: Rig, from: number): string[] {
  return rig.host.quietCalls
    .slice(from)
    .filter((r) => (r.messages[0]?.content ?? "").includes("You read a narrator's roleplay reply"))
    .map((r) => r.messages[1]?.content ?? "");
}

/** The record a swipe of a message holds, as its metadata keeps it. */
async function recordOf(rig: Rig, chatId: string, messageId: string, swipe: number) {
  return toChain(await rig.host.chats.messages(chatId, rig.host.userId)).find((m) => m.id === messageId)?.ledger?.swipes[String(swipe)];
}

/** A played reply, then a swipe of it that comes back empty, its turn kept: the reply's id and its first swipe's record. */
async function emptySwipe(rig: Rig, chatId: string): Promise<{ replyId: string; played: number | undefined }> {
  await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
  const reply = rig.host.head(chatId);
  if (!reply) throw new Error("no reply");
  const played = (await recordOf(rig, chatId, reply.id, 0))?.seq;
  const empty = await rig.host.start(chatId, { type: "swipe" });
  await rig.host.finish(empty, "");
  expect((await card(rig, chatId))?.label).toBe("The reply came back empty");
  return { replyId: reply.id, played };
}

/** What the fake host keeps of the guard it was given: the context handler Lumiverse calls before a generation. */
interface GuardHolder {
  contextHandler: ((input: ContextHandlerInput, signal: AbortSignal) => Promise<ContextVerdict>) | null;
}

/** More world chats than the guard keeps state for, each opened by a dry run (Lumiverse's preset check). */
async function openMany(rig: Rig): Promise<() => Promise<void>> {
  const worldId = await rig.newWorld("Elsewhere");
  const chats: string[] = [];
  for (let n = 0; n <= OPEN_CHATS_CAP * 8; n++) {
    const chatId = rig.host.createChat("Hello.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    chats.push(chatId);
  }
  // The fake host keeps its registered context handler in a private field; the test calls it as the host does.
  const holder = rig.host as unknown as GuardHolder;
  const guard = holder.contextHandler;
  if (!guard) throw new Error("no guard");
  return async () => {
    for (const chatId of chats) await guard({ chatId, userId: rig.host.userId, generationType: "normal", dryRun: true, connectionId: null, personaId: null }, new AbortController().signal);
  };
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

/** A turn played to its reply, then a new reply after that reply, which fails before anything streams: the earlier reply's swipes. */
async function newReplyFails(rig: Rig, chatId: string): Promise<string[]> {
  await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
  const swipes = [...(rig.host.head(chatId)?.swipes ?? [])];
  const g = await rig.host.start(chatId, { type: "normal" });
  await rig.host.finish(g, "", { error: "provider timeout" });
  return swipes;
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

  test("an edit of the reply a failed swipe left behind is an assistant edit: its record stays, it gets Re-read edit, and the kept turn waits for its retry", async () => {
    const { rig, chatId } = await fullChat();
    const { replyId, played } = await emptySwipe(rig, chatId);
    // Back to the reply that played, to fix a typo.
    rig.host.navigate(chatId, replyId, 0);
    await rig.host.settle();
    const calls = rig.host.quietCalls.length;
    rig.host.editMessage(chatId, replyId, "The shop is quiet and dusty.");
    await rig.host.settle();
    expect(readsSince(rig, calls)).toEqual([]);
    expect((await recordOf(rig, chatId, replyId, 0))?.seq).toBe(played);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "reread" && c.messageId === replyId)).toBe(true);
    expect((await card(rig, chatId))?.label).toBe("The reply came back empty");
    const retry = await rig.host.begin(chatId, { type: "regenerate" });
    expect(retry.halted).toBeUndefined();
    expect(engineCalls(rig, calls)).toBe(0);
  });

  test("late text counts only on the empty swipe while it is shown: left for another swipe before it is read, it is an edit and the turn stays kept; written there again, it plays the turn once on that swipe", async () => {
    const { rig, chatId } = await fullChat();
    const { replyId, played } = await emptySwipe(rig, chatId);
    const calls = rig.host.quietCalls.length;
    // The text lands on the empty swipe, but the player is back on the played reply before its read
    // starts: both events are heard before the chat's queue runs.
    const idle = rig.host.idle;
    rig.host.idle = async () => undefined;
    rig.host.editMessage(chatId, replyId, "A bell rings in the back.");
    rig.host.navigate(chatId, replyId, 0);
    await rig.host.settle();
    rig.host.idle = idle;
    await rig.host.settle();
    expect(readsSince(rig, calls)).toEqual([]);
    expect((await recordOf(rig, chatId, replyId, 0))?.seq).toBe(played);
    expect((await card(rig, chatId))?.label).toBe("The reply came back empty");
    rig.host.navigate(chatId, replyId, 1);
    await rig.host.settle();
    rig.host.editMessage(chatId, replyId, "A bell rings somewhere in the back.");
    await rig.host.settle();
    expect(readsSince(rig, calls)).toEqual([expect.stringContaining("A bell rings somewhere in the back.")]);
    expect(engineCalls(rig, calls)).toBe(0);
    expect(await recordOf(rig, chatId, replyId, 1)).toBeDefined();
    expect((await recordOf(rig, chatId, replyId, 0))?.seq).toBe(played);
    expect(await card(rig, chatId)).toBeUndefined();
  });

  test("late text whose read waits behind the chat's queue while the player's other chats open: back on the played reply before it runs, the turn stays kept with its card", async () => {
    const { rig, chatId } = await fullChat();
    const { replyId, played } = await emptySwipe(rig, chatId);
    const open = await openMany(rig);
    const calls = rig.host.quietCalls.length;
    // The chat's queue is busy, so the late text's read waits; the player is back on the played reply
    // and every other chat is opened before it runs.
    const idle = rig.host.idle;
    rig.host.idle = async () => undefined;
    const busy = Promise.withResolvers<void>();
    const held = rig.rt.ledger.with(chatId, rig.host.userId, () => busy.promise);
    rig.host.editMessage(chatId, replyId, "A bell rings in the back.");
    rig.host.navigate(chatId, replyId, 0);
    await rig.host.settle();
    await open();
    busy.resolve();
    await held;
    rig.host.idle = idle;
    await rig.host.settle();
    expect(readsSince(rig, calls)).toEqual([]);
    expect((await recordOf(rig, chatId, replyId, 0))?.seq).toBe(played);
    expect((await card(rig, chatId))?.label).toBe("The reply came back empty");
  }, 30_000);

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

  test("a Continue that fails before anything streams: the card's Retry continues the reply from the kept turn", async () => {
    const { rig, chatId } = await fullChat();
    await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
    const failed = await rig.host.start(chatId, { type: "continue" });
    await rig.host.finish(failed, "", { error: "provider timeout" });
    const kept = await card(rig, chatId);
    const retry = kept?.actions.find((a) => a.style === "primary");
    if (!kept || !retry) throw new Error("no Retry on the card");
    const calls = rig.host.quietCalls.length;
    const [g] = (await press(rig, chatId, kept, retry.id)).began;
    if (!g) throw new Error("the card's Retry started nothing");
    expect(g.halted).toBeUndefined();
    expect(engineCalls(rig, calls)).toBe(0);
    await rig.host.finish(g, "The bell over the door rings.");
    // The reply is continued, not given a new swipe.
    expect(rig.host.head(chatId)?.swipes).toEqual(["The shop is quiet. The bell over the door rings."]);
  });

  test("a new reply after a reply that fails before anything streams: no button on its card starts a reply, which would roll the reply before it again", async () => {
    const { rig, chatId } = await fullChat();
    const earlier = await newReplyFails(rig, chatId);
    const kept = await card(rig, chatId);
    if (!kept) throw new Error("no card");
    const began: Generation[] = [];
    for (const action of kept.actions.filter((a) => a.id !== "diagnostics")) began.push(...(await press(rig, chatId, kept, action.id)).began);
    expect(began).toEqual([]);
    expect(rig.host.head(chatId)?.swipes).toEqual(earlier);
  });

  test("a new reply after a reply that fails before anything streams: the player's Send takes the kept turn", async () => {
    const { rig, chatId } = await fullChat();
    await newReplyFails(rig, chatId);
    expect(await card(rig, chatId)).toBeDefined();
    const calls = rig.host.quietCalls.length;
    const retry = await rig.host.begin(chatId, { type: "normal" });
    expect(retry.halted).toBeUndefined();
    expect(engineCalls(rig, calls)).toBe(0);
  });
});

describe("a failed engine run's card starts the reply the way the stopped one started", () => {
  test("a new reply after a reply whose engine run fails: no button on its card starts a reply, and the player's Send runs it again", async () => {
    const { rig, chatId } = await fullChat();
    await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
    const earlier = [...(rig.host.head(chatId)?.swipes ?? [])];
    const answer = rig.host.quietReply;
    rig.host.quietReply = (req) => {
      if ((req.messages[0]?.content ?? "").includes(BRIEF)) throw new Error("invalid api key");
      return answer ? answer(req) : "{}";
    };
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBe("cancelled");
    const flag = await card(rig, chatId, "engine_failed");
    if (!flag) throw new Error("no card");
    // The player fixes the step, then presses the card's buttons: none rolls the reply before it again.
    rig.host.quietReply = answer;
    const began: Generation[] = [];
    for (const action of flag.actions.filter((a) => a.id !== "diagnostics")) began.push(...(await press(rig, chatId, flag, action.id)).began);
    for (const g of began) if (g.open) await rig.host.finish(g, "The shop is quiet again.");
    expect(rig.host.head(chatId)?.swipes).toEqual(earlier);
    expect(began).toEqual([]);
    // Send, with nothing typed, runs the engine again and writes the new reply after it.
    const reply = await rig.host.start(chatId, { type: "normal" });
    expect(reply.halted).toBeUndefined();
    await rig.host.finish(reply, "The bell over the door rings.");
    expect(rig.host.head(chatId)?.swipes).toEqual(["The bell over the door rings."]);
  });

  test("a Continue whose reply couldn't start: the card's Retry runs the engine again and continues the reply", async () => {
    const { rig, chatId } = await fullChat();
    await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
    // The engine ran for the Continue; no page took its restart, and the player's RPEngine settings
    // changed before its reply started.
    expect((await rig.host.begin(chatId, { type: "continue" })).halted).toBe("cancelled");
    rig.host.restarts.splice(0);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { tokens: { sections: 3900 } } } }));
    const flag = await card(rig, chatId, "engine_failed");
    const retry = flag?.actions.find((a) => a.style === "primary");
    if (!flag || !retry) throw new Error("no Retry on the card");
    const [g] = (await press(rig, chatId, flag, retry.id)).began;
    if (!g?.open) throw new Error("the card's Retry started no reply");
    await rig.host.finish(g, "The bell over the door rings.");
    // The reply is continued, not given a new swipe.
    expect(rig.host.head(chatId)?.swipes).toEqual(["The shop is quiet. The bell over the door rings."]);
  });
});
