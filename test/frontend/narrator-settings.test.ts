// Settings → Narrator holds the narrator's knowledge (DESIGN §6.11): whose knowledge it gets and what
// of a secret, each sent as the user's default, and whether it is given the engine's prices (§9.5).
// How a secret is marked is a text of the prompt registry, so the page has no editor for it and
// points to Settings → Agents → Prompts instead.

import { describe, expect, test } from "bun:test";
import { HostSwitch, Seg } from "../../src/frontend/components";
import { NarratorPage, NarratorViewControl } from "../../src/frontend/settings/narrator";
import { PromptEditor } from "../../src/frontend/settings/prompt-editor";
import type { JsonObject } from "../../src/shared/json";
import { NARRATOR_DEFAULTS } from "../../src/shared/settings";
import { labelled, press, propsOf } from "../support/tree";

describe("Settings → Narrator", () => {
  test("holds the view choices only, and points to the Prompts page for how a secret is marked", () => {
    const patches: JsonObject[] = [];
    const tree = NarratorPage({ narrator: { ...NARRATOR_DEFAULTS }, statePrices: true, patch: (p) => void patches.push(p), busy: false });
    // No text editor of its own: the mark's wording is the registry's.
    expect(propsOf(tree, PromptEditor)).toEqual([]);
    const controls = propsOf(tree, NarratorViewControl);
    expect(controls).toHaveLength(1);
    const shown = NarratorViewControl(controls[0] as Parameters<typeof NarratorViewControl>[0]);
    expect(propsOf(shown, Seg).map((p) => p.label)).toEqual(["Whose knowledge the narrator gets", "Secrets"]);
    press(labelled(shown, Seg, "Whose knowledge the narrator gets"), "pov");
    press(labelled(shown, Seg, "Secrets"), "omit");
    expect(patches).toEqual([{ narrator: { knowledge: "pov", secrets: "marked" } }, { narrator: { knowledge: "scene", secrets: "omit" } }]);
    const pointer = propsOf(tree, "p").find((p) => "data-lre-mark-wording" in p);
    expect(String(pointer?.children)).toContain("Settings → Agents → Prompts → Final output, under Secret marks");
  });

  test("Prices switches whether the narrator is given the engine's prices and told to state them", () => {
    const patches: JsonObject[] = [];
    const tree = NarratorPage({ narrator: { ...NARRATOR_DEFAULTS }, statePrices: true, patch: (p) => void patches.push(p), busy: false });
    const [prices] = propsOf(tree, HostSwitch).filter((p) => p.label === "The narrator states prices");
    expect(prices?.checked).toBe(true);
    (prices?.onChange as (checked: boolean) => void)(false);
    expect(patches).toEqual([{ statePrices: false }]);
  });
});
