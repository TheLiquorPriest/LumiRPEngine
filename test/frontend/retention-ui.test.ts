// Settings → Agents → Retention (DESIGN §4.4, §4.6): the turn transcripts' rows come first, each at
// No limit by default (every turn keeps its transcript, however old), a switch away from a number
// of turns or days; each row's control sends its patch under `retention`, Default sends null and
// shows only while a value differs from its default; what the page sends lands in the settings store
// and reads back; and Settings home's line for the page.

import { describe, expect, test } from "bun:test";
import { RetentionPage, RetentionRow, retentionSummary } from "../../src/frontend/settings/retention";
import { Button, HostSwitch, NumberStepper } from "../../src/frontend/components";
import { SettingsStore } from "../../src/backend/settings-store";
import type { JsonObject } from "../../src/shared/json";
import { RETENTION_DEFAULTS, type RetentionSettings } from "../../src/shared/stores";
import { FakeHost } from "../support/fake-host";
import { expand, labelled, press, propsOf, type Props } from "../support/tree";

let sent: JsonObject | null = null;

/** The page for `retention`; what its controls send waits for `take`. */
function page(retention: Partial<RetentionSettings> = {}): unknown {
  return RetentionPage({ retention: { ...RETENTION_DEFAULTS, ...retention }, busy: false, patch: (p) => void (sent = p) });
}

/** The patch the last control pressed sent. */
function take(): JsonObject {
  const patch = sent;
  sent = null;
  if (!patch) throw new Error("nothing sent");
  return patch;
}

/** The setting a row's props are for. */
function rowId(p: Props): unknown {
  const def = p.row;
  return def !== null && typeof def === "object" && "id" in def ? def.id : undefined;
}

/** One setting's row, laid out. */
function row(tree: unknown, id: keyof RetentionSettings): unknown {
  const found = propsOf(tree, RetentionRow).filter((p) => rowId(p) === id);
  if (found.length !== 1) throw new Error(`${found.length} rows for ${id}`);
  return expand({ type: RetentionRow, props: found[0] as Props });
}

function click(button: Props): void {
  const onClick = button.onClick;
  if (typeof onClick !== "function") throw new Error("not a button");
  onClick();
}

describe("Settings → Agents → Retention", () => {
  test("the turn transcripts' rows come first, each at No limit by default: no number to set and no Default to go back to", () => {
    const tree = page();
    expect(propsOf(tree, RetentionRow).map(rowId)).toEqual(["turnTranscripts", "turnTranscriptDays", "transcriptDays", "unreferencedDays", "sweepHours"]);
    for (const [id, title] of [["turnTranscripts", "Turn transcripts"], ["turnTranscriptDays", "Turn transcript age"]] as const) {
      const laid = row(tree, id);
      expect(labelled(laid, HostSwitch, `${title}: no limit`).checked).toBe(true);
      expect(propsOf(laid, NumberStepper)).toEqual([]);
      expect(propsOf(laid, Button)).toEqual([]);
    }
  });

  test("turning No limit off keeps a number of the latest turns or days, each set from its floor, and Default and No limit give every transcript back", () => {
    press(labelled(row(page(), "turnTranscripts"), HostSwitch, "Turn transcripts: no limit"), false);
    expect(take()).toEqual({ retention: { turnTranscripts: 50 } });
    press(labelled(row(page(), "turnTranscriptDays"), HostSwitch, "Turn transcript age: no limit"), false);
    expect(take()).toEqual({ retention: { turnTranscriptDays: 30 } });
    const set = page({ turnTranscripts: 20, turnTranscriptDays: 14 });
    const turns = row(set, "turnTranscripts");
    const stepper = labelled(turns, NumberStepper, "Turn transcripts (turns)");
    expect([stepper.value, stepper.min, stepper.integer]).toEqual([20, 1, true]);
    press(stepper, 10);
    expect(take()).toEqual({ retention: { turnTranscripts: 10 } });
    expect(labelled(turns, HostSwitch, "Turn transcripts: no limit").checked).toBe(false);
    click(labelled(turns, Button, "Reset Turn transcripts to its default, No limit"));
    expect(take()).toEqual({ retention: { turnTranscripts: null } });
    const days = row(set, "turnTranscriptDays");
    expect(labelled(days, NumberStepper, "Turn transcript age (days)").value).toBe(14);
    press(labelled(days, HostSwitch, "Turn transcript age: no limit"), true);
    expect(take()).toEqual({ retention: { turnTranscriptDays: "none" } });
  });

  test("what the page sends lands in the settings store and reads back", async () => {
    const host = new FakeHost();
    const store = new SettingsStore(host);
    press(labelled(row(page(), "turnTranscripts"), HostSwitch, "Turn transcripts: no limit"), false);
    expect((await store.set(host.userId, take())).retention).toMatchObject({ turnTranscripts: 50, turnTranscriptDays: "none" });
    press(labelled(row(page({ turnTranscripts: 50 }), "turnTranscripts"), NumberStepper, "Turn transcripts (turns)"), 5);
    expect((await store.set(host.userId, take())).retention.turnTranscripts).toBe(5);
    click(labelled(row(page({ turnTranscripts: 5 }), "turnTranscripts"), Button, "Reset Turn transcripts to its default, No limit"));
    expect((await store.set(host.userId, take())).retention.turnTranscripts).toBe("none");
  });

  test("Settings home's line says which transcripts each chat keeps, then the stored texts' limits", () => {
    expect(retentionSummary({ ...RETENTION_DEFAULTS })).toBe("Transcripts: all · call texts 30 days · unused 7 days · swept every 24 hours");
    expect(retentionSummary({ ...RETENTION_DEFAULTS, turnTranscripts: 20, turnTranscriptDays: 14 })).toBe("Transcripts: latest 20 turns, 14 days · call texts 30 days · unused 7 days · swept every 24 hours");
    expect(retentionSummary({ ...RETENTION_DEFAULTS, turnTranscripts: 1, transcriptDays: "none", sweepHours: "none" })).toBe("Transcripts: latest 1 turn · call texts with their rows · unused 7 days · never swept");
  });
});
