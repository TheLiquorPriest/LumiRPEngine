// The chat's state from RPE (source.ts), against recorded answers of RPE's state route: read when the
// page opens and when the chat's live view says it changed, never on a timer; a newer state replaces
// the older; a failed read is said in the client's words and the last state stays; once stopped, the
// chat is let go.

import { describe, expect, test } from "bun:test";
import { RpeError } from "../../../../src/ui/client";
import { chatState } from "../../../../src/ui/kept/play/source";
import { recordedRpe, runTrace } from "./bed";
import { CHAT, LATER, recordedView } from "./recorded";

/** Lets every answer on its way land: the recorded RPE answers in promises alone, so their turns are enough. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

const FIRST = await recordedView();
const SECOND = await recordedView({ at: LATER });

describe("the chat's state from RPE", () => {
  test("is read when the page opens, and held where today's state sync put its view", async () => {
    const rpe = recordedRpe(CHAT, FIRST);
    const state = chatState(rpe.client, CHAT);
    expect(state.get()).toMatchObject({ chatId: CHAT, view: null, status: "syncing", failed: null });
    await settle();
    expect(state.get()).toMatchObject({ chatId: CHAT, view: FIRST, status: "live", failed: null });
    expect(rpe.asked.every((call) => call.key === "GET /api/v1/chats/:chat/state" && call.chat === CHAT)).toBe(true);
    state.stop();
  });

  test("RPE's word that the state changed reads it again, and the newer state replaces the older; nothing else is read for", async () => {
    const rpe = recordedRpe(CHAT, FIRST);
    const state = chatState(rpe.client, CHAT);
    await settle();
    const opened = rpe.reads();
    // A run's own records, its end among them: RPE says the state changed once the run has ended.
    rpe.publish([runTrace("run_started"), { kind: "reply", data: { run: "run-1", from: 0, text: "The bell" } }, runTrace("run_ended")]);
    await settle();
    expect(rpe.reads()).toBe(opened);
    rpe.state = SECOND;
    rpe.publish([{ kind: "state", data: {} }]);
    await settle();
    expect(rpe.reads()).toBe(opened + 1);
    expect(state.get().view?.hud?.clock.label).toBe(SECOND.hud?.clock.label);
    expect(state.get().view?.hud?.clock.label).not.toBe(FIRST.hud?.clock.label);
    state.stop();
  });

  test("events lost on the way, and following begun again, each read it again", async () => {
    const rpe = recordedRpe(CHAT, FIRST);
    const state = chatState(rpe.client, CHAT);
    await settle();
    const opened = rpe.reads();
    rpe.publish([], { from: 4, to: 9 });
    await settle();
    rpe.reset();
    await settle();
    expect(rpe.reads()).toBe(opened + 2);
    state.stop();
  });

  test("what asks while a read is out is answered by one read after it", async () => {
    const rpe = recordedRpe(CHAT, FIRST);
    const state = chatState(rpe.client, CHAT);
    await settle();
    const opened = rpe.reads();
    rpe.publish([{ kind: "state", data: {} }]);
    rpe.publish([{ kind: "state", data: {} }]);
    rpe.publish([], { from: 6, to: 7 });
    rpe.reset();
    await settle();
    expect(rpe.reads()).toBe(opened + 2);
    state.stop();
  });

  test("a read that fails is said in the client's words, the last state stays shown, and the next read that succeeds clears it", async () => {
    const rpe = recordedRpe(CHAT, FIRST);
    const state = chatState(rpe.client, CHAT);
    await settle();
    rpe.state = new RpeError(0, "RPE did not answer: the road is down.");
    rpe.publish([{ kind: "state", data: {} }]);
    await settle();
    expect(state.get()).toMatchObject({ view: FIRST, status: "live", failed: "RPE did not answer: the road is down." });
    rpe.state = SECOND;
    rpe.publish([{ kind: "state", data: {} }]);
    await settle();
    expect(state.get()).toMatchObject({ view: SECOND, failed: null });
    state.stop();
  });

  test("with nothing read yet, a failed read leaves no view and says why", async () => {
    const rpe = recordedRpe(CHAT, FIRST);
    rpe.state = new RpeError(500, "The chat's state could not be built.");
    const state = chatState(rpe.client, CHAT);
    await settle();
    expect(state.get()).toMatchObject({ view: null, status: "closed", failed: "The chat's state could not be built." });
    state.stop();
  });

  test("once stopped, the chat is let go and an answer still on its way changes nothing", async () => {
    const rpe = recordedRpe(CHAT, FIRST);
    const state = chatState(rpe.client, CHAT);
    expect(rpe.followers()).toBe(1);
    state.stop();
    expect(rpe.followers()).toBe(0);
    await settle();
    expect(state.get().view).toBeNull();
  });
});
