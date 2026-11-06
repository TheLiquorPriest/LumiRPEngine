// A vehicle's free specs (DESIGN §9.3) on Port Alder: the owner's ✎ sets and clears them, a GM edit
// on a thing that isn't a vehicle is refused, a make with a class takes them from its details, the
// Garage card shows them, and the Vehicles section tells the first few of one at the player
// character's place, none of one away from it.

import { describe, expect, test } from "bun:test";
import type { FixOp } from "../../src/shared/ledger";
import { parseItemOp } from "../../src/shared/things";
import { vehicleSpecsOf, type VehicleSpec } from "../../src/shared/vehicles";
import type { WorldDoc } from "../../src/shared/world";
import { resolveEdit } from "../../src/engine/edits";
import { createRegistry } from "../../src/engine/registry-impl";
import type { WorldState } from "../../src/engine/state";
import { Working } from "../../src/engine/working";
import { ListRow, Button } from "../../src/frontend/components";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { buildGarageView } from "../../src/packs/vehicles/core/view";
import { decodeGarageView, VehicleCard } from "../../src/packs/vehicles/ui/panel";
import { propsOf } from "../support/tree";
import { fold, startState } from "./support";

const reg = createRegistry(ALL_PACKS);

const SPECS: VehicleSpec[] = [
  { label: "Engine", value: "5.0L V8" },
  { label: "Seats", value: "5" },
  { label: "Tow rating", value: "3,500 lb" },
  { label: "Bed", value: "6 ft" },
  { label: "Tyres", value: "All-terrain" },
  { label: "Radio", value: "AM/FM" },
];

function portAlder(): { world: WorldDoc; state: WorldState } {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.realism.levels.vehicles = 3;
  return { world, state: startState(world, reg) };
}

/** The edit folded onto the state, or its refusal's code. */
function edit(world: WorldDoc, state: Readonly<WorldState>, ops: readonly FixOp[], gm: boolean): WorldState | string {
  const out = resolveEdit(reg, world, state, ops, { gm, runSeed: "specs" });
  return "rejection" in out ? out.rejection.code : fold(reg, world, state, out.events);
}

function applied(world: WorldDoc, state: Readonly<WorldState>, ops: readonly FixOp[], gm = false): WorldState {
  const out = edit(world, state, ops, gm);
  if (typeof out === "string") throw new Error(`refused: ${out}`);
  return out;
}

const specsOf = (state: WorldState, id: string): VehicleSpec[] => vehicleSpecsOf(state.entities[id]?.fields.specs) ?? [];

describe("a vehicle's specs", () => {
  test("the owner's ✎ sets them and clears them; a GM edit on a thing that isn't a vehicle is refused", () => {
    const { world, state } = portAlder();
    const set = applied(world, state, [{ op: "fix_item", change: { do: "specs", item: "pov_truck", specs: SPECS } }]);
    expect(specsOf(set, "pov_truck")).toEqual(SPECS);
    expect(edit(world, set, [{ op: "fix_item", change: { do: "specs", item: "pov_truck", specs: SPECS } }], false)).toBe("no_change");
    const cleared = applied(world, set, [{ op: "fix_item", change: { do: "specs", item: "pov_truck", specs: [] } }]);
    expect(specsOf(cleared, "pov_truck")).toEqual([]);
    expect(edit(world, state, [{ op: "item", change: { do: "label", item: "pov_keys", specs: SPECS } }], true)).toBe("not_a_vehicle");
  });

  test("outside data is trimmed, and a spec missing its label or value is dropped", () => {
    expect(parseItemOp({ do: "label", item: "pov_truck", specs: [{ label: " Engine ", value: " 5.0L  V8 " }, { label: "", value: "x" }, { label: "Seats", value: 5 }, "junk"] })).toEqual({ do: "label", item: "pov_truck", specs: [{ label: "Engine", value: "5.0L V8" }, { label: "Seats", value: "5" }] });
  });

  test("a make with a class takes them from its details", () => {
    const { world, state } = portAlder();
    const made = applied(world, state, [{ op: "item", change: { do: "make", name: "Work van", class: "pickup_midsize", details: { specs: SPECS.slice(0, 2) }, at: { place: "harbor_street_114" }, why: "The GM made it" } }], true);
    const van = Object.values(made.entities).find((e) => e.name === "Work van");
    expect(van?.kind).toBe("vehicle");
    expect(vehicleSpecsOf(van?.fields.specs)).toEqual(SPECS.slice(0, 2));
  });

  test("the Garage card shows them, and Specs… is the owner's", () => {
    const { world, state } = portAlder();
    const set = applied(world, state, [{ op: "fix_item", change: { do: "specs", item: "pov_truck", specs: SPECS.slice(0, 2) } }]);
    const view = decodeGarageView(JSON.parse(JSON.stringify(buildGarageView(new Working(reg, world, set).ctx))));
    const truck = view?.vehicles.find((v) => v.id === "pov_truck");
    if (!truck) throw new Error("no pickup in the Garage");
    const sheets: string[] = [];
    const card = VehicleCard({ vehicle: truck, onSheet: (kind) => sheets.push(kind) });
    expect(propsOf(card, ListRow).find((p) => p.title === "Specs")?.subtitle).toBe("Engine: 5.0L V8 · Seats: 5");
    const open = propsOf(card, Button).find((p) => p.children === "Specs…");
    (open?.onClick as () => void)();
    expect(sheets).toEqual(["specs"]);
    // Not his: no Specs…
    expect(propsOf(VehicleCard({ vehicle: { ...truck, mine: false }, onSheet: () => undefined }), Button).some((p) => p.children === "Specs…")).toBe(false);
  });

  test("the Vehicles section tells the first four of one at his place, and none of one away from it", () => {
    const { world, state } = portAlder();
    const set = applied(world, state, [
      { op: "fix_item", change: { do: "specs", item: "pov_truck", specs: SPECS } },
      { op: "fix_item", change: { do: "specs", item: "pov_atv", specs: SPECS } },
    ]);
    const lines = reg.renderers.filter((r) => r.slot === "vehicles").flatMap((r) => r.render(new Working(reg, world, set).ctx));
    const truck = lines.find((l) => l.startsWith("Your pickup:")) ?? "";
    expect(truck).toContain("specs Engine: 5.0L V8, Seats: 5, Tow rating: 3,500 lb, Bed: 6 ft, and 2 more");
    expect(truck).not.toContain("Tyres");
    const atv = lines.find((l) => l.startsWith("Your ATV:")) ?? "";
    expect(atv).toContain("away from here");
    expect(atv).not.toContain("specs");
  });
});
