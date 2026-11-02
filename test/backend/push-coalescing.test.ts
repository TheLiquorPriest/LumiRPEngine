// State pushes (DESIGN §9.6): a turn's steps and a burst of edits each tell of a change, so while
// a view builds at most one more waits behind it, carrying every change made meanwhile. A ledger
// operation that leaves what a view reads of the ledger as it was tells of none, and a push copies
// and compares only the parts of a view that aren't the same frozen parts the last one held.

import { describe, expect, test } from "bun:test";
import { StatePush } from "../../src/backend/push";
import { notWorldView } from "../../src/backend/view";
import { deepFreeze } from "../../src/shared/json";
import type { StateView } from "../../src/shared/state-view";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";

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

  test("a part that is the same frozen object as in the view before is neither copied nor compared again; any other part is", async () => {
    const host = new FakeHost();
    const kept = deepFreeze({ rows: [{ label: "Cash", value: "$20" }] });
    const open = { rows: [{ label: "Mood", value: "calm" }] };
    const views: StateView[] = [];
    const push = new StatePush(host, async (chatId) => {
      const view: StateView = { ...notWorldView(chatId), panels: { kept, open } };
      views.push(view);
      return view;
    });
    const base = (): unknown => (Reflect.get(push, "channels") as Map<string, { last: { panels: Record<string, unknown> } }>).get(`${host.userId}\u0000chat`)?.last.panels;
    await push.snapshot("chat", host.userId);
    const first = base() as Record<string, unknown>;
    // The part a build keeps is the same object, and so is the base's JSON of it; the other changed in place.
    open.rows[0] = { label: "Mood", value: "tense" };
    push.changed("chat", host.userId);
    await push.settle();
    const second = base() as Record<string, unknown>;
    expect([second.kept === first.kept, second.open === first.open]).toEqual([true, false]);
    expect(host.sent.filter((m) => m.type === "lre.state.delta").map((m) => (m.type === "lre.state.delta" ? m.ops : []))).toEqual([[{ op: "set", path: ["panels", "open", "rows"], value: [{ label: "Mood", value: "tense" }] }]]);
    expect(views.length).toBe(2);
  });

  test("a ledger operation that leaves the chat's journal, chain, kept turn and notices as they were asks for no push", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    await rig.host.settle();
    let asked = 0;
    const changed = rig.rt.push.changed.bind(rig.rt.push);
    rig.rt.push.changed = (c, u) => {
      asked++;
      changed(c, u);
    };
    await rig.rt.ledger.with(chatId, rig.host.userId, () => undefined);
    expect(asked).toBe(0);
    rig.host.sendUser(chatId, "I wait.");
    await rig.host.settle();
    expect(asked).toBeGreaterThan(0);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
