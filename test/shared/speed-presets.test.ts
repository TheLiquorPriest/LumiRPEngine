// Settings → Speed's presets (BUILD-C C3): each preset sets only rows Speed shows, by their paths in
// the settings; picking one lists what it changes; Thorough is the shipped defaults; and a preset
// applied through the settings store, then Back to Thorough, reads as the defaults again, leaving
// every other setting the user changed as it was.

import { describe, expect, test } from "bun:test";
import { defaultSettings, mergePatch } from "../../src/backend/settings-store";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import { currentSpeedPreset, PHASE_CONTROL, PRESET_ROWS, presetChanges, rowChanged, rowDefault, SPEED_PRESET_VALUES, SPEED_PRESETS, SPEED_ROWS, speedChanged, speedRow, speedValueText, valueAt } from "../../src/shared/speed-presets";
import { TURN_PHASES } from "../../src/shared/diagnostics";
import { Rig } from "../support/rig";

/** Every path a merge patch sets, as dotted keys. */
function pathsOf(patch: JsonValue, at: string[] = []): string[] {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return [at.join(".")];
  return Object.entries(patch).flatMap(([key, value]) => pathsOf(value, [...at, key]));
}

describe("the speed presets", () => {
  test("each preset sets only rows Speed shows, and each row's path is one setting", () => {
    const ids = new Set(SPEED_ROWS.map((r) => r.id));
    expect(ids.size).toBe(SPEED_ROWS.length);
    for (const id of SPEED_PRESETS) for (const row of Object.keys(SPEED_PRESET_VALUES[id])) expect([id, ids.has(row)]).toEqual([id, true]);
    expect(Object.keys(SPEED_PRESET_VALUES.thorough)).toEqual([]);
    const known = new Set(SPEED_ROWS.map((r) => r.path.join(".")));
    for (const id of SPEED_PRESETS) for (const path of pathsOf(presetChanges(defaultSettings(), id).patch)) expect([id, path, known.has(path)]).toEqual([id, path, true]);
    // A row whose setting this build's settings don't have yet is left out of a preset's changes, as the page leaves it out.
    for (const id of SPEED_PRESETS) for (const c of presetChanges(defaultSettings(), id).changes) expect([id, c.row.id, rowDefault(c.row) !== undefined]).toEqual([id, c.row.id, true]);
    // Every part of a turn's time that names a control names a row.
    for (const phase of TURN_PHASES) {
      const row = PHASE_CONTROL[phase];
      if (row !== undefined) expect([phase, speedRow(row)?.id]).toEqual([phase, row]);
    }
  });

  test("Balanced and Fast set what the plan says; Thorough is the defaults", () => {
    expect(SPEED_PRESET_VALUES.balanced).toEqual({ "persist.on": true, "persist.turns": 3, "persist.minutes": 30, "review.scope": "changed", "calls.atOnce": 4, "knowledge.atOnce": 2 });
    expect(SPEED_PRESET_VALUES.fast).toEqual({ ...SPEED_PRESET_VALUES.balanced, "stage.intent": "auto", "stage.prepare": "auto", "knowledge.atOnce": 3, "curator.gate": "on" });
    const d = defaultSettings();
    expect(currentSpeedPreset(d)).toBe("thorough");
    expect(presetChanges(d, "thorough")).toEqual({ changes: [], patch: {} });
    expect(speedChanged(d)).toBe(0);
    for (const row of SPEED_ROWS) if (rowDefault(row) !== undefined) expect([row.id, rowChanged(d, row)]).toEqual([row.id, false]);
  });

  test("picking a preset lists each row it changes, from what it is to what it becomes", () => {
    const d = defaultSettings();
    const { changes } = presetChanges(d, "balanced");
    const ids = changes.map((c) => c.row.id);
    // Persistence's turns and minutes already are Balanced's, so they aren't listed.
    expect(ids).toContain("persist.on");
    expect(ids).toContain("review.scope");
    expect(ids).not.toContain("persist.turns");
    const scope = changes.find((c) => c.row.id === "review.scope");
    expect(scope && [speedValueText(scope.row, scope.from), speedValueText(scope.row, scope.to)]).toEqual(["Every part", "Only what changed"]);
  });

  test("Apply, then Back to Thorough, reads as the defaults again; a setting the user changed elsewhere stays", async () => {
    const rig = new Rig();
    const set = (patch: JsonObject) => rig.rt.settings.set(rig.host.userId, patch);
    const own = await set({ agents: { loopRepeats: 5 }, gm: { duringTurn: "live" } });
    for (const id of ["balanced", "fast"] as const) {
      const applied = await set(presetChanges(own, id).patch);
      // What the store keeps of a preset is the preset: every row it sets this build's settings have.
      for (const [rowId, value] of Object.entries(SPEED_PRESET_VALUES[id])) {
        const row = speedRow(rowId);
        if (row && rowDefault(row) !== undefined) expect([id, rowId, valueAt(applied, row.path)]).toEqual([id, rowId, value]);
      }
      expect(currentSpeedPreset(applied)).toBe(id);
      const back = await set(presetChanges(applied, "thorough").patch);
      for (const rowId of PRESET_ROWS) {
        const row = speedRow(rowId);
        if (row) expect([id, rowId, valueAt(back, row.path)]).toEqual([id, rowId, rowDefault(row)]);
      }
      expect([back.agents.loopRepeats, back.gm.duringTurn]).toEqual([5, "live"]);
      expect(currentSpeedPreset(back)).toBe("thorough");
    }
  });

  test("a merge patch of a preset reads back the same through mergePatch", () => {
    const d = defaultSettings();
    const patch = presetChanges(d, "fast").patch;
    const merged = mergePatch(JSON.parse(JSON.stringify(d)) as JsonValue, patch);
    for (const path of pathsOf(patch)) expect(valueAt(merged, path.split("."))).toEqual(valueAt(patch, path.split(".")) as JsonValue);
  });
});
