// The context handler's timeout (DESIGN §5.1): Lumiverse waits for it at most 120 s, so it waits as
// long as the slowest before-the-reply wall clock needs plus the plan's margin, and the settings keep
// that wall clock inside what the host allows.

import { describe, expect, test } from "bun:test";
import { CONTEXT_HANDLER_MAX_MS, PLAN_MARGIN_MS, PRE_REPLY_MAX_MS } from "../../src/shared/settings";
import { defaultSettings, SettingsStore } from "../../src/backend/settings-store";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";

describe("the context handler's timeout", () => {
  test("is the host's longest until a user's settings are read, then their wall clock plus the plan's margin", async () => {
    const rig = new Rig();
    expect(rig.host.contextTimeoutMs).toBe(CONTEXT_HANDLER_MAX_MS);
    rig.body(await rig.send({ type: "lre.settings.get" }));
    expect(rig.host.contextTimeoutMs).toBe(defaultSettings().modelUse.budgets.pre.ms + PLAN_MARGIN_MS);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    expect(rig.host.contextTimeoutMs).toBe(60_000 + PLAN_MARGIN_MS);
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
});
