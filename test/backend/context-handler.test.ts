// The guard (DESIGN §5.1): the one context handler, registered as required where Lumiverse supports
// it, so a guard that fails or runs out of time stops the generation. Lumiverse waits for it as long
// as the user's Generation guard timeout says, within its own limit (`HOST_LIMITS.contextHandler`).
// The engine run's own time limit is the user's to set, with no ceiling.

import { describe, expect, test } from "bun:test";
import { SettingsStore } from "../../src/backend/settings-store";
import { HOST_LIMITS } from "../../src/shared/timeouts";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";

describe("the guard's registration", () => {
  test("is required where Lumiverse supports it; Lumiverse waits its longest until a user's settings are read, then the user's guard timeout within its limit", async () => {
    const rig = new Rig();
    expect(rig.host.contextRequired).toBe(true);
    expect(rig.host.contextTimeoutMs).toBe(HOST_LIMITS.contextHandler.maxMs);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { timeouts: { guardMs: 30_000 } } }));
    expect(rig.host.contextTimeoutMs).toBe(30_000);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { timeouts: { guardMs: "none" } } }));
    expect(rig.host.contextTimeoutMs).toBe(HOST_LIMITS.contextHandler.maxMs);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { timeouts: { guardMs: 600_000 } } }));
    expect(rig.host.contextTimeoutMs).toBe(HOST_LIMITS.contextHandler.maxMs);
  });

  test("an engine run past Lumiverse's limit is kept as set, now and in a stored file; the guard's wait doesn't follow it", async () => {
    const rig = new Rig();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { timeouts: { engineRunMs: 900_000, postReplyMs: 1_800_000, requestMs: 3_600_000 } } }));
    const set = await rig.rt.settings.get(rig.host.userId);
    expect(set.timeouts).toMatchObject({ engineRunMs: 900_000, postReplyMs: 1_800_000, requestMs: 3_600_000 });
    expect(rig.host.contextTimeoutMs).toBe(HOST_LIMITS.contextHandler.maxMs);
    const host = new FakeHost();
    await host.storage.write("settings.json", JSON.stringify({ ...set, timeouts: { ...set.timeouts, engineRunMs: 86_400_000 } }), host.userId);
    expect((await new SettingsStore(host).get(host.userId)).timeouts.engineRunMs).toBe(86_400_000);
  });

  test("is registered again only when its wait changes, and never while a generation runs: the change waits for its end", async () => {
    const rig = new Rig();
    // How many times the host's handler list was changed, and the waits registered.
    const registered: number[] = [];
    const register = rig.host.registerContextHandler.bind(rig.host);
    rig.host.registerContextHandler = (handler, options) => {
      registered.push(options.timeoutMs);
      register(handler, options);
    };
    const chatId = await rig.worldChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { timeouts: { guardMs: 30_000 } } }));
    rig.body(await rig.send({ type: "lre.settings.get" }));
    expect(registered).toEqual([30_000]);
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    // Another save while the host's chain may still be walking its list: nothing changes yet.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { timeouts: { guardMs: 60_000 } } }));
    expect(registered).toHaveLength(1);
    await rig.host.finish(g, "Quiet.");
    expect(registered).toEqual([30_000, 60_000]);
    expect(rig.host.contextTimeoutMs).toBe(60_000);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("on a Lumiverse without required handlers the guard still registers, and the chat says the engine can't stop a generation there", async () => {
    const host = new FakeHost();
    host.capabilities = { cancel: false, required: false, sessions: true };
    const rig = new Rig({ host });
    expect(rig.host.contextRequired).toBe(false);
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    // The generation goes on without the engine's sections, and diagnostics say why.
    expect(g.halted).toBeUndefined();
    const records = await rig.rt.diag.records(chatId, rig.host.userId);
    expect(records.some((r) => r.step === "guard" && r.status === "failed" && /can't stop generation/.test(r.reason ?? ""))).toBe(true);
    await rig.host.finish(g, "Quiet.");
  });
});
