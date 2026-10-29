// The agent stores' settings (DESIGN §4.4, §6.9): Settings → Agents → Retention and Settings →
// Diagnostics' records per chat, each with its default, read from a file saved before they existed,
// and kept within what each takes.

import { describe, expect, test } from "bun:test";
import { defaultSettings, SettingsStore } from "../../src/backend/settings-store";
import { DIAG_RING } from "../../src/shared/diagnostics";
import { RETENTION_DEFAULTS } from "../../src/shared/stores";
import { FakeHost } from "../support/fake-host";

describe("retention and diagnostics settings", () => {
  test("a settings file saved before them reads with their defaults", async () => {
    const host = new FakeHost();
    const { retention: _retention, diagnostics: _diagnostics, ...older } = defaultSettings();
    await host.storage.write("settings.json", JSON.stringify({ ...older, swipeDefault: "renarrate" }), host.userId);
    const loaded = await new SettingsStore(host).get(host.userId);
    expect(loaded.retention).toEqual({ ...RETENTION_DEFAULTS });
    expect(loaded.diagnostics.recordsPerChat).toBe(DIAG_RING);
    expect(loaded.swipeDefault).toBe("renarrate");
  });

  test("a change lands within what each takes: whole days and hours from their floors, no limit only where it means something", async () => {
    const host = new FakeHost();
    const store = new SettingsStore(host);
    const set = await store.set(host.userId, { retention: { transcriptDays: "none", unreferencedDays: 0, sweepHours: 6 }, diagnostics: { recordsPerChat: 1200 } });
    expect(set.retention).toEqual({ transcriptDays: "none", unreferencedDays: 0, sweepHours: 6 });
    expect(set.diagnostics.recordsPerChat).toBe(1200);
    // A value one doesn't take falls back to its default, as every setting's does.
    const fallen = await store.set(host.userId, { retention: { transcriptDays: -1, unreferencedDays: "none", sweepHours: 0 }, diagnostics: { recordsPerChat: 0 } });
    expect(fallen.retention).toEqual({ ...RETENTION_DEFAULTS });
    expect(fallen.diagnostics.recordsPerChat).toBe(DIAG_RING);
    // Never sweeping is a choice of its own.
    expect((await store.set(host.userId, { retention: { sweepHours: "none" } })).retention.sweepHours).toBe("none");
  });
});
