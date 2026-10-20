// The context handler's timeout (DESIGN §5.1): Lumiverse waits for it at most 120 s, its own limit
// (`HOST_LIMITS.contextHandler`), so it waits as long as the slowest engine run needs plus the plan's
// margin, within that. The engine run itself is the user's to set, with no ceiling (Settings → Timeouts).

import { describe, expect, test } from "bun:test";
import { CONTEXT_HANDLER_MAX_MS, PLAN_MARGIN_MS } from "../../src/shared/settings";
import { SettingsStore } from "../../src/backend/settings-store";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";

describe("the context handler's timeout", () => {
  test("is the host's longest until a user's settings are read, then their engine run plus the plan's margin, within the host's limit", async () => {
    const rig = new Rig();
    expect(rig.host.contextTimeoutMs).toBe(CONTEXT_HANDLER_MAX_MS);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { timeouts: { engineRunMs: 60_000 } } }));
    expect(rig.host.contextTimeoutMs).toBe(60_000 + PLAN_MARGIN_MS);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { timeouts: { engineRunMs: "none" } } }));
    expect(rig.host.contextTimeoutMs).toBe(CONTEXT_HANDLER_MAX_MS);
  });

  test("an engine run past the old 105 s cap is kept as set, now and in a stored file; only the registration stops at Lumiverse's limit", async () => {
    const rig = new Rig();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { timeouts: { engineRunMs: 900_000, postReplyMs: 1_800_000, requestMs: 3_600_000 } } }));
    const set = await rig.rt.settings.get(rig.host.userId);
    expect(set.timeouts).toMatchObject({ engineRunMs: 900_000, postReplyMs: 1_800_000, requestMs: 3_600_000 });
    expect(rig.host.contextTimeoutMs).toBe(CONTEXT_HANDLER_MAX_MS);
    const host = new FakeHost();
    await host.storage.write("settings.json", JSON.stringify({ ...set, timeouts: { ...set.timeouts, engineRunMs: 86_400_000 } }), host.userId);
    expect((await new SettingsStore(host).get(host.userId)).timeouts.engineRunMs).toBe(86_400_000);
  });

  test("is registered again only when it changes, and never while a generation runs: the change waits for its end", async () => {
    const rig = new Rig();
    // How many times the host's handler list was changed, and the timeouts registered.
    const registered: number[] = [];
    const register = rig.host.registerContextHandler.bind(rig.host);
    rig.host.registerContextHandler = (handler, timeoutMs) => {
      registered.push(timeoutMs);
      register(handler, timeoutMs);
    };
    const chatId = await rig.worldChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { timeouts: { engineRunMs: 30_000 } } }));
    rig.body(await rig.send({ type: "lre.settings.get" }));
    expect(registered).toEqual([30_000 + PLAN_MARGIN_MS]);
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    // Another save while the host's chain may still be walking its list: nothing changes yet.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { timeouts: { engineRunMs: 60_000 } } }));
    expect(registered).toHaveLength(1);
    await rig.host.finish(g, "Quiet.");
    expect(registered).toEqual([30_000 + PLAN_MARGIN_MS, 60_000 + PLAN_MARGIN_MS]);
    expect(rig.host.contextTimeoutMs).toBe(60_000 + PLAN_MARGIN_MS);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
