// GM → This chat → Engine, on a harness chat: Sovereign Hand and what the author is given of the
// player's newest message, among the harness's own settings (`HarnessRows`). Each choice says in one
// line what it does, a change differs from its default with a Default that sends null, and the
// newest message's row shows where it does something: with Sovereign Hand not off, or once changed.

import { describe, expect, test } from "bun:test";
import { Seg } from "../../src/frontend/components";
import { HarnessRows } from "../../src/frontend/gm/engine";
import { SettingRow } from "../../src/frontend/settings/kit";
import { defaultAgentSettings, type HarnessSettings, NEWEST_MESSAGES, SOVEREIGN_HANDS } from "../../src/shared/agent-settings";
import type { JsonObject } from "../../src/shared/json";
import { labelled, press, propsOf } from "../support/tree";

const HAND = "Sovereign Hand on this engine";
const NEWEST = "Your newest message, with Sovereign Hand on";

/** The harness's rows for `harness` (the defaults where it says nothing), and the patches they send. */
function rows(harness: Partial<HarnessSettings> = {}): { tree: unknown; patches: JsonObject[] } {
  const patches: JsonObject[] = [];
  return { tree: HarnessRows({ harness: { ...defaultAgentSettings().harness, ...harness }, limits: defaultAgentSettings().harnessLimits, busy: false, patch: (patch) => void patches.push(patch) }), patches };
}

/** The row of the setting `id`. */
const row = (tree: unknown, id: string) => propsOf(tree, SettingRow).find((p) => p.id === id);

describe("Sovereign Hand on the harness's settings", () => {
  test("it follows Lumiverse until set, each choice says what it does, and a choice is sent as the harness's setting", () => {
    const { tree, patches } = rows();
    const hand = labelled(tree, Seg, HAND);
    expect([hand.value, (hand.options as { value: string; label: string }[]).map((o) => o.label)]).toEqual(["follow", ["Follow Lumiverse", "On", "Off"]]);
    expect(row(tree, "harness-sovereign-hand")?.changed).toBe(false);
    // One line for each choice, each its own.
    const lines = SOVEREIGN_HANDS.map((sovereignHand) => row(rows({ sovereignHand }).tree, "harness-sovereign-hand")?.help);
    expect(new Set(lines).size).toBe(SOVEREIGN_HANDS.length);
    for (const line of lines) expect(typeof line === "string" && line.length > 20).toBe(true);
    press(hand, "on");
    expect(patches).toEqual([{ agents: { harness: { sovereignHand: "on" } } }]);
    // Set, it differs from its default, and Default sends null.
    const off = rows({ sovereignHand: "off" });
    const set = row(off.tree, "harness-sovereign-hand");
    expect(set?.changed).toBe(true);
    (set?.reset as { onClick(): void } | undefined)?.onClick();
    expect(off.patches).toEqual([{ agents: { harness: { sovereignHand: null } } }]);
  });

  test("what the author is given of the newest message shows where it does something, says what each choice does, and has its Default", () => {
    // Off, it does nothing: its row isn't shown unless it was changed.
    expect(propsOf(rows({ sovereignHand: "off" }).tree, Seg).filter((p) => p.label === NEWEST)).toEqual([]);
    expect(labelled(rows({ sovereignHand: "off", newestMessage: "leave_out" }).tree, Seg, NEWEST).value).toBe("leave_out");
    // Following Lumiverse or on, it is shown, given as the direction until set.
    for (const sovereignHand of ["follow", "on"] as const) expect(labelled(rows({ sovereignHand }).tree, Seg, NEWEST).value).toBe("direction");
    const { tree, patches } = rows({ sovereignHand: "on" });
    expect((labelled(tree, Seg, NEWEST).options as { label: string }[]).map((o) => o.label)).toEqual(["Given as the direction", "Left out"]);
    press(labelled(tree, Seg, NEWEST), "leave_out");
    expect(patches).toEqual([{ agents: { harness: { newestMessage: "leave_out" } } }]);
    const lines = NEWEST_MESSAGES.map((newestMessage) => row(rows({ sovereignHand: "on", newestMessage }).tree, "harness-newest-message")?.help);
    expect(new Set(lines).size).toBe(NEWEST_MESSAGES.length);
    const left = rows({ sovereignHand: "on", newestMessage: "leave_out" });
    const changed = row(left.tree, "harness-newest-message");
    expect(changed?.changed).toBe(true);
    (changed?.reset as { onClick(): void } | undefined)?.onClick();
    expect(left.patches).toEqual([{ agents: { harness: { newestMessage: null } } }]);
  });
});
