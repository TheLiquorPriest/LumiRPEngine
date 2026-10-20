// State pushes (DESIGN §9.6): a turn's steps and a burst of edits each tell of a change, so while
// a view builds at most one more waits behind it, carrying every change made meanwhile.

import { describe, expect, test } from "bun:test";
import { StatePush } from "../../src/backend/push";
import { notWorldView } from "../../src/backend/view";
import { FakeHost } from "../support/fake-host";

describe("state pushes", () => {
  test("changes made while a view builds bring one more build, not one each", async () => {
    const host = new FakeHost();
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const started = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    let builds = 0;
    const push = new StatePush(host, async (chatId) => {
      const n = builds++;
      started[n]?.resolve();
      await gates[n]?.promise;
      return notWorldView(chatId);
    });
    push.changed("chat", host.userId);
    const first = push.settle();
    await started[0]?.promise;
    // Five more changes while the first view builds: one build waits behind it for all of them.
    for (let i = 0; i < 5; i++) {
      push.changed("chat", host.userId);
      void push.settle();
    }
    gates[0]?.resolve();
    await started[1]?.promise;
    gates[1]?.resolve();
    await first;
    await push.settle();
    expect(builds).toBe(2);
  });
});
