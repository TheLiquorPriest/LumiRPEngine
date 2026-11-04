// The agent stores' settings (DESIGN §4.4, §6.9): Settings → Agents → Retention and Settings →
// Diagnostics' records per chat, each with its default, read from a file saved before they existed,
// and kept within what each takes.

import { describe, expect, test } from "bun:test";
import { defaultSettings, SettingsStore } from "../../src/backend/settings-store";
import { DIAG_RING } from "../../src/shared/diagnostics";
import { RETENTION_DEFAULTS } from "../../src/shared/stores";
import { FakeHost } from "../support/fake-host";

describe("retention and diagnostics settings", () => {
  test("a settings file saved before them reads with their defaults: every turn's transcript kept, however old", async () => {
    const host = new FakeHost();
    const { retention: _retention, diagnostics: _diagnostics, ...older } = defaultSettings();
    await host.storage.write("settings.json", JSON.stringify({ ...older, swipeDefault: "renarrate" }), host.userId);
    const loaded = await new SettingsStore(host).get(host.userId);
    expect(loaded.retention).toEqual({ ...RETENTION_DEFAULTS });
    expect(loaded.diagnostics.recordsPerChat).toBe(DIAG_RING);
    expect(loaded.swipeDefault).toBe("renarrate");
    expect([RETENTION_DEFAULTS.turnTranscripts, RETENTION_DEFAULTS.turnTranscriptDays]).toEqual(["none", "none"]);
    // A file saved with the stores' settings but before the turn transcripts' reads them as before.
    await host.storage.write("settings.json", JSON.stringify({ ...older, retention: { transcriptDays: 10, unreferencedDays: 2, sweepHours: 12 } }), host.userId);
    expect((await new SettingsStore(host).get(host.userId)).retention).toEqual({ transcriptDays: 10, unreferencedDays: 2, sweepHours: 12, turnTranscripts: "none", turnTranscriptDays: "none" });
  });

  test("a change lands within what each takes: whole days, hours and turns from their floors, no limit only where it means something", async () => {
    const host = new FakeHost();
    const store = new SettingsStore(host);
    const set = await store.set(host.userId, { retention: { transcriptDays: "none", unreferencedDays: 0, sweepHours: 6, turnTranscripts: 20, turnTranscriptDays: 14 }, diagnostics: { recordsPerChat: 1200 } });
    expect(set.retention).toEqual({ transcriptDays: "none", unreferencedDays: 0, sweepHours: 6, turnTranscripts: 20, turnTranscriptDays: 14 });
    expect(set.diagnostics.recordsPerChat).toBe(1200);
    // A value one doesn't take falls back to its default, as every setting's does: a turn limit keeps at least one turn, an age at least a day.
    const fallen = await store.set(host.userId, { retention: { transcriptDays: -1, unreferencedDays: "none", sweepHours: 0, turnTranscripts: 0, turnTranscriptDays: 1.5 }, diagnostics: { recordsPerChat: 0 } });
    expect(fallen.retention).toEqual({ ...RETENTION_DEFAULTS });
    expect(fallen.diagnostics.recordsPerChat).toBe(DIAG_RING);
    // Never sweeping is a choice of its own, and so is keeping every transcript again.
    expect((await store.set(host.userId, { retention: { sweepHours: "none" } })).retention.sweepHours).toBe("none");
    await store.set(host.userId, { retention: { turnTranscripts: 3, turnTranscriptDays: 7 } });
    expect((await store.set(host.userId, { retention: { turnTranscripts: "none", turnTranscriptDays: null } })).retention).toMatchObject({ turnTranscripts: "none", turnTranscriptDays: "none" });
  });
});
