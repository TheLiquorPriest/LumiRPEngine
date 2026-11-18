// The HUD's run line from what RPE tells the page (src/ui/kept/play/source.ts, activity.ts): a turn that
// starts while the page is open, from the live trace; one already running when the page opens, and one that
// ended while it was closed, from the chat's newest turn as the Live view reads it.

import { describe, expect, test } from "bun:test";
import type { LiveEvent, TurnReply } from "../../../../src/shared/api";
import { chatState } from "../../../../src/ui/kept/play/source";
import { recordedRpe } from "./bed";
import { CHAT, recordedView } from "./recorded";

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

const VIEW = await recordedView();
const TURNS = "GET /api/v1/chats/:chat/turns";
const TURN = "GET /api/v1/chats/:chat/turns/:turn";

/** A record of the newest turn's run, as RPH's trace gives it. */
function record(seq: number, at: number, event: Record<string, unknown>): Record<string, unknown> {
  return { run: "run-1", seq, at, scope: { user: "user-quill", chat: CHAT, session: "session-1", turn: "turn-1" }, event };
}

/** The newest turn as the turn route reads it: what the run line is folded from. */
function turnRead(status: string, trace: Record<string, unknown>[], progress: string[] = [], emptyReply: string | null = null): TurnReply {
  return { id: "turn-1", status, trace, reply: { text: "", progress }, emptyReply } as unknown as TurnReply;
}

function opened(newest: TurnReply | null) {
  const rpe = recordedRpe(CHAT, VIEW);
  rpe.answer = (key) => {
    if (key === TURNS) return { turns: newest === null ? [] : [{ id: newest.id }], more: false };
    if (key === TURN && newest !== null) return newest;
    throw new Error(`No route ${key}.`);
  };
  return { rpe, state: chatState(rpe.client, CHAT) };
}

describe("the HUD's run line", () => {
  test("a turn already running when the page opens shows who is at work and its newest progress line, timed from its start", async () => {
    const { state } = opened(turnRead("running", [record(1, 1000, { kind: "run_started", run: "turn", lead: "author" }), record(2, 1100, { kind: "agent_started", definition: "scene-writer" })], ["Weighing the bell"]));
    await settle();
    expect(state.get().activity).toMatchObject({ state: "running", turn: "turn-1", label: "Weighing the bell", since: 1000 });
    state.stop();
  });

  test("a turn that failed while the page was closed says so with its reason, and what to do with the empty reply it left", async () => {
    const failed = turnRead("failed", [record(1, 1000, { kind: "run_started", run: "turn", lead: "author" }), record(2, 2000, { kind: "run_ended", outcome: { status: "failed", error: { code: "provider", detail: "the model could not be reached" } } })], [], "msg-empty");
    const { state } = opened(failed);
    await settle();
    const activity = state.get().activity;
    expect(activity).toMatchObject({ state: "failed", turn: "turn-1" });
    expect(activity?.label).toStartWith("The turn failed: the model could not be reached.");
    expect(activity?.label).toContain("Its empty reply stays in your chat");
    state.stop();
  });

  test("a run the trace leaves going on that its turn no longer runs shows nothing; a turn that starts while the page is open shows at once", async () => {
    const { rpe, state } = opened(turnRead("stopped", [record(1, 1000, { kind: "run_started", run: "turn", lead: "author" })]));
    await settle();
    expect(state.get().activity).toBeNull();
    rpe.publish([{ kind: "trace", data: record(1, 5000, { kind: "run_started", run: "turn", lead: "author" }) } as unknown as Pick<LiveEvent, "kind" | "data">]);
    await settle();
    expect(state.get().activity).toMatchObject({ state: "running", label: "author is starting the turn", since: 5000 });
    state.stop();
  });
});
