// Build → Packs → gear's Containers and Saved outfits and loadouts rows (DESIGN §28.8, §28.16),
// walked as rendered trees (no DOM): each control reads the config as the engine does; a row is
// Changed, with its default and Default to go back, only while it differs from the shipped default;
// a change keeps its group in the config, and the group goes once all of it is the default again; a
// value the engine can't use is never written.

import { describe, expect, test } from "bun:test";
import { ChoiceInput, NumberInput } from "../../src/frontend/build/schema-form";
import { SettingRow, type Reset } from "../../src/frontend/settings/kit";
import { ContainerRows, GearConfig, SavedSetRows } from "../../src/packs/gear/ui/config";
import { STARTER_WORLDS } from "../../src/packs/index";
import type { JsonObject } from "../../src/shared/json";
import { thingsConfigOf } from "../../src/shared/things";
import { labelled, press, propsOf } from "../support/tree";

const makeWorld = STARTER_WORLDS.modern_slice_of_life;
if (!makeWorld) throw new Error("no Port Alder starter");
const world = makeWorld("pa", "Port Alder");

const CAPACITY = "A holder's room and load";
const DEPTH = "Packed at most, holders deep";
const KEPT = "Each person keeps at most";

/** The two groups rendered for `config`, read as the engine reads it, and every config they hand back. */
function rows(config: JsonObject) {
  const changes: JsonObject[] = [];
  const read = thingsConfigOf({ packs: { gear: { version: 1, config } } });
  const props = { world, config, lint: [], onChange: (next: JsonObject) => void changes.push(next) };
  return { containers: ContainerRows({ ...props, read: read.containers }), sets: SavedSetRows({ ...props, read: read.sets }), changes };
}

/** A row's Default, pressed. */
const reset = (row: Record<string, unknown> | undefined): void => (row?.reset as Reset | undefined)?.onClick();

describe("Build → Packs → gear: containers and saved outfits", () => {
  test("as shipped: Refuse, 8 deep and 12 kept, nothing changed; a change keeps its group beside the rest, and nothing the engine can't use is written", () => {
    const { containers, sets, changes } = rows({ notWithYou: 2 });
    expect([...propsOf(containers, SettingRow), ...propsOf(sets, SettingRow)].map((p) => [p.id, p.changed])).toEqual([
      ["gear-capacity", false],
      ["gear-depth", false],
      ["gear-sets", false],
    ]);
    expect([labelled(containers, ChoiceInput, CAPACITY).value, labelled(containers, NumberInput, DEPTH).value, labelled(sets, NumberInput, KEPT).value]).toEqual(["refuse", 8, 12]);
    press(labelled(containers, ChoiceInput, CAPACITY), "off");
    press(labelled(containers, NumberInput, DEPTH), 3);
    press(labelled(sets, NumberInput, KEPT), 0);
    expect(changes).toEqual([
      { notWithYou: 2, containers: { capacity: "off", depth: 8 } },
      { notWithYou: 2, containers: { capacity: "refuse", depth: 3 } },
      { notWithYou: 2, sets: { max: 0 } },
    ]);
    press(labelled(containers, ChoiceInput, CAPACITY), "sideways");
    press(labelled(containers, NumberInput, DEPTH), 33);
    press(labelled(containers, NumberInput, DEPTH), 2.5);
    press(labelled(sets, NumberInput, KEPT), 51);
    expect(changes).toHaveLength(3);
  });

  test("changed: each row says so, with its default and Default, which drops the group once all of it is the default again", () => {
    const { containers, sets, changes } = rows({ containers: { capacity: "off", depth: 3 }, sets: { max: 4 } });
    const [capacity, depth] = propsOf(containers, SettingRow);
    const [kept] = propsOf(sets, SettingRow);
    expect([capacity?.changed, depth?.changed, kept?.changed]).toEqual([true, true, true]);
    expect([capacity?.reset, depth?.reset, kept?.reset]).toMatchObject([
      { label: "Reset a holder's room and load to its default, Refuse", to: "Refuse" },
      { label: "Reset how deep things nest to its default, 8", to: "8" },
      { label: "Reset how many outfits and loadouts a person keeps to its default, 12", to: "12" },
    ]);
    reset(capacity);
    reset(depth);
    reset(kept);
    expect(changes).toEqual([
      { containers: { capacity: "refuse", depth: 3 }, sets: { max: 4 } },
      { containers: { capacity: "off", depth: 8 }, sets: { max: 4 } },
      { containers: { capacity: "off", depth: 3 } },
    ]);
    // Off at the default depth, Refuse again puts the whole group back as shipped: no entry of its own.
    const back = rows({ containers: { capacity: "off", depth: 8 } });
    press(labelled(back.containers, ChoiceInput, CAPACITY), "refuse");
    expect(back.changes).toEqual([{}]);
  });

  test("the gear pack's page lays them out after Sizes by name, reading what it can't use as the default", () => {
    const tree = GearConfig({ world, config: { containers: { capacity: "sideways", depth: 99 }, sets: { max: -1 } }, lint: [], onChange: () => undefined });
    expect(propsOf(tree, ContainerRows)[0]?.read).toEqual({ capacity: "refuse", depth: 8 });
    expect(propsOf(tree, SavedSetRows)[0]?.read).toEqual({ max: 12 });
  });
});
