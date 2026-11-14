// When a run of a chat ends, the live hub tells the chat's followers that its state changed, after the
// run's own last event, once a page has read the chat's state; other events of a run tell nothing.

import { describe, expect, test } from "bun:test";
import type { JsonValue } from "../../src/shared/json";
import { CHAT, makeBed } from "./bed";

/** A record of RPH's trace as the turn lane publishes it on the chat. */
function traced(kind: string): { kind: string; data: JsonValue } {
  return { kind: "trace", data: { seq: 9, run: "turn-1", scope: { user: "user-quill", chat: CHAT, session: "session-1", turn: "turn-1" }, at: 0, agent: { id: "author-1", definition: "author" }, event: { kind } } };
}

/** Lets what the hub was handed run its course. */
function settled(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  queueMicrotask(resolve);
  return promise;
}

describe("the end of a run", () => {
  test("tells the chat's followers its state changed, after the run's end, once a page has read the chat", async () => {
    const bed = makeBed();
    await bed.plays("fantasy_town");
    bed.listen();
    bed.live.publish(CHAT, traced("run_ended"));
    await settled();
    // No page has read the chat yet: nothing follows it.
    expect(bed.heard.map((e) => e.kind)).toEqual(["trace"]);

    await bed.state();
    await bed.state();
    bed.live.publish(CHAT, traced("tool_started"));
    bed.live.publish(CHAT, traced("run_ended"));
    await settled();
    expect(bed.heard.map((e) => [e.kind, e.seq])).toEqual([
      ["trace", 1],
      ["trace", 2],
      ["trace", 3],
      ["state", 4],
    ]);
  });
});
