// What a Settle now or Re-draft came to is kept in the chat's run (W21), not in memory: a later
// press of the same draft replaces it, a running one never lands over its own outcome, and the file
// goes with the chat's run.

import { describe, expect, test } from "bun:test";
import { notePress } from "../../src/backend/depth/drafts-view";
import { runDir } from "../../src/shared/ids";
import { Harness } from "../support/harness";

describe("the Drafts view's presses", () => {
  test("each press's outcome is kept in the chat's run, in order, the newest per draft", async () => {
    const h = new Harness("fresh", {});
    const userId = h.host.userId;
    const chat = await h.newChat();
    const running = notePress(h.host, chat, userId, "d1", { op: "settle", state: "running", lines: ["The author is reading it."] });
    const done = notePress(h.host, chat, userId, "d1", { op: "settle", state: "done", lines: ["Settled into canon."] });
    await notePress(h.host, chat, userId, "d2", { op: "redraft", state: "failed", lines: ["It isn't open at the chat's head."] });
    await Promise.all([running, done]);
    const kept = JSON.parse((await h.host.storage.read(`${runDir(chat)}presses.json`, userId)) ?? "null");
    expect(kept).toEqual({ v: 1, presses: { d1: { op: "settle", state: "done", lines: ["Settled into canon."] }, d2: { op: "redraft", state: "failed", lines: ["It isn't open at the chat's head."] } } });
  });
});
