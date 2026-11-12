// The start of a harness turn and the turn before it (HARNESS-SLICE3: a turn's tail never holds the
// player). What a turn commits is written on the chat's queue once its reply is saved, which may
// still be under way when the next turn's run begins. The claim of a reply whose run is starting
// waits for it, for no longer than the user's setting (`agents.harness.commitWaitMs`); past that the
// run goes on, and its author is told first that the last turn's changes may not all be in. Asked
// when no reply is starting (LumiAH's Agents page, a job's run), the claim waits for nothing.

import { describe, expect, test } from "bun:test";
import { renderPrompt } from "../../src/backend/prompts";
import { HARNESS_TEXT } from "../../src/shared/harness-texts";
import type { Rig } from "../support/rig";
import { claimOf, harnessChat, noModelCalls } from "./harness-driver";

const BEHIND = renderPrompt(HARNESS_TEXT.behind, {}, {});

/** The world's guidance as the engine's claim on the chat gives it now. */
async function guidanceOf(rig: Rig, chatId: string): Promise<string> {
  const guidance = (await claimOf(rig, chatId))?.guidance;
  return guidance !== undefined && "text" in guidance ? guidance.text : "";
}

/** Sets how long a turn's start waits for the turn before it. */
const waitFor = async (rig: Rig, commitWaitMs: number | null): Promise<void> => void rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { harness: { commitWaitMs } } } }));

/** Work on the chat's queue that goes on until `release` is called, as a commit still being written does: the hold, and a promise of its end. */
function hold(rig: Rig, chatId: string): { release(): void; done: Promise<void> } {
  const gate = Promise.withResolvers<void>();
  return { release: () => gate.resolve(), done: rig.rt.ledger.with(chatId, rig.host.userId, () => gate.promise) };
}

/** Resolves once the chat's queue holds work. */
async function busy(rig: Rig, chatId: string): Promise<void> {
  for (let i = 0; i < 1000 && !rig.rt.ledger.queued(chatId); i++) await Promise.resolve();
  if (!rig.rt.ledger.queued(chatId)) throw new Error("the chat's queue never took the work");
}

/** A reply of the chat starts: the guard lets its generation go to the runtime, whose run asks the claim next. */
async function replyStarts(rig: Rig, chatId: string): Promise<void> {
  rig.host.sendUser(chatId, "I wait for the kettle.");
  await rig.host.settle();
  await rig.host.begin(chatId, { type: "normal" });
}

describe("the start of a harness turn and the turn before it", () => {
  test("nothing under way: the author is told nothing of it, however short the wait is set", async () => {
    const { rig, chatId } = await harnessChat();
    expect(await guidanceOf(rig, chatId)).not.toContain(BEHIND);
    // No wait at all still says nothing when there is nothing to wait for.
    await waitFor(rig, 0);
    expect(await guidanceOf(rig, chatId)).not.toContain(BEHIND);
    noModelCalls(rig);
  });

  test("the turn before is still being recorded as a reply starts: its claim waits for it, and says nothing once it is in", async () => {
    const { rig, chatId } = await harnessChat();
    await replyStarts(rig, chatId);
    const commit = hold(rig, chatId);
    await busy(rig, chatId);
    let claimed = false;
    const claiming = guidanceOf(rig, chatId).then((text) => {
      claimed = true;
      return text;
    });
    // The claim is held with the queue.
    for (let i = 0; i < 200; i++) await Promise.resolve();
    expect(claimed).toBe(false);
    commit.release();
    await commit.done;
    expect(await claiming).not.toContain(BEHIND);
    noModelCalls(rig);
  });

  test("the wait runs out: the run goes on, and the world's guidance opens by telling the author the last turn may not all be in", async () => {
    const { rig, chatId } = await harnessChat();
    await waitFor(rig, 0);
    await replyStarts(rig, chatId);
    const commit = hold(rig, chatId);
    await busy(rig, chatId);
    const text = await guidanceOf(rig, chatId);
    expect(text.startsWith(BEHIND)).toBe(true);
    // The guidance itself follows it, whole.
    expect(text.length).toBeGreaterThan(BEHIND.length + 100);
    commit.release();
    await commit.done;
    // Default gives it back its wait.
    await waitFor(rig, null);
    expect(await guidanceOf(rig, chatId)).not.toContain(BEHIND);
    noModelCalls(rig);
  });

  test("asked when no reply is starting, as LumiAH's Agents page asks it, the claim waits for nothing, whatever is still being recorded", async () => {
    const { rig, chatId } = await harnessChat();
    const commit = hold(rig, chatId);
    await busy(rig, chatId);
    // Answered while the queue is still held, and the turn before isn't said to be behind: nothing was waited for.
    const text = await guidanceOf(rig, chatId);
    expect(rig.rt.ledger.queued(chatId)).toBe(true);
    expect(text).not.toContain(BEHIND);
    commit.release();
    await commit.done;
    noModelCalls(rig);
  });
});
