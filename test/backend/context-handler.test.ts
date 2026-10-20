// The context handler's timeout (DESIGN §5.1): Lumiverse waits for it at most 120 s, so it waits as
// long as the slowest before-the-reply wall clock needs plus the plan's margin, and the settings keep
// that wall clock inside what the host allows.

import { describe, expect, test } from "bun:test";
import { CONTEXT_HANDLER_MAX_MS, PLAN_MARGIN_MS, PRE_REPLY_MAX_MS } from "../../src/shared/settings";
import { defaultSettings, MODEL_USE_PRESETS, SettingsStore } from "../../src/backend/settings-store";

const FULL_PRE_MS = MODEL_USE_PRESETS.full.budgets.pre.ms;
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";

describe("the context handler's timeout", () => {
  test("is the host's longest until a user's settings are read, then their wall clock plus the plan's margin", async () => {
    const rig = new Rig();
    expect(rig.host.contextTimeoutMs).toBe(CONTEXT_HANDLER_MAX_MS);
    rig.body(await rig.send({ type: "lre.settings.get" }));
    expect(rig.host.contextTimeoutMs).toBe(defaultSettings().modelUse.budgets.pre.ms + PLAN_MARGIN_MS);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    expect(rig.host.contextTimeoutMs).toBe(FULL_PRE_MS + PLAN_MARGIN_MS);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "custom", budgets: { pre: { ms: 100_000 } } } } }));
    expect(rig.host.contextTimeoutMs).toBe(100_000 + PLAN_MARGIN_MS);
  });

  test("a before-the-reply wall clock past what the host leaves reads as the most it does, set now or in an older file", async () => {
    const rig = new Rig();
    const set = rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "custom", budgets: { pre: { ms: 120_000 }, post: { ms: 120_000 } } } } }));
    expect(set.settings).toMatchObject({ modelUse: { budgets: { pre: { ms: PRE_REPLY_MAX_MS }, post: { ms: 120_000 } } } });
    expect(rig.host.contextTimeoutMs).toBe(CONTEXT_HANDLER_MAX_MS);
    const host = new FakeHost();
    const old = defaultSettings();
    await host.storage.write("settings.json", JSON.stringify({ ...old, modelUse: { ...old.modelUse, preset: "custom", budgets: { ...old.modelUse.budgets, pre: { calls: 2, ms: 120_000 } } } }), host.userId);
    expect((await new SettingsStore(host).get(host.userId)).modelUse.budgets.pre).toMatchObject({ calls: 2, ms: PRE_REPLY_MAX_MS });
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
    rig.body(await rig.send({ type: "lre.settings.get" }));
    rig.body(await rig.send({ type: "lre.settings.get" }));
    expect(registered).toEqual([defaultSettings().modelUse.budgets.pre.ms + PLAN_MARGIN_MS]);
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    // Another save while the host's chain may still be walking its list: nothing changes yet.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    expect(registered).toHaveLength(1);
    await rig.host.finish(g, "Quiet.");
    expect(registered).toEqual([defaultSettings().modelUse.budgets.pre.ms + PLAN_MARGIN_MS, FULL_PRE_MS + PLAN_MARGIN_MS]);
    expect(rig.host.contextTimeoutMs).toBe(FULL_PRE_MS + PLAN_MARGIN_MS);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
