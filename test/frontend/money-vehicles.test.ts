// Assets' vehicles (ORG-SPEC §5.1 "your vehicles' worth (opens Garage)") on Port Alder: the money view
// marks each vehicle's net worth line, the decoder keeps the mark, and Assets' Your vehicles row
// shows what Jordan's pickup, boat and ATV are worth together, opening the Garage; with none worth
// anything it shows no figure.

import { describe, expect, test } from "bun:test";
import { materializeAll } from "../../src/engine/materialize";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import { ListRow } from "../../src/frontend/components";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { AssetsSegment } from "../../src/packs/economy/ui/assets";
import { decodeFinanceView } from "../../src/packs/economy/ui/decode";
import type { PlayerControls } from "../../src/packs/economy/ui/hub";
import { ALL_ACTIVITY } from "../../src/packs/economy/ui/layout";
import type { Elsewhere } from "../../src/packs/economy/ui/nav";
import type { FinanceView } from "../../src/shared/finance";
import { formatMoney, type WorldDoc } from "../../src/shared/world";
import { startState } from "../packs/support";
import { propsOf } from "../support/tree";

const reg = createRegistry(ALL_PACKS);

/** Jordan's money at chat start on Port Alder, as the Money panel decodes it, with the world changes a test makes. */
function jordansMoney(patch: (world: WorldDoc) => void = () => undefined): { view: FinanceView; world: WorldDoc } {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  materializeAll(reg, w, world.pov, "vehicles");
  const view = decodeFinanceView(JSON.parse(JSON.stringify(w.ctx.query("economy.finance")(w.ctx, world.pov, true))));
  if (!view) throw new Error("no money for Jordan");
  return { view, world };
}

/** The Your vehicles row Assets draws in Play, and where pressing it leads. */
function vehiclesRow(view: FinanceView, world: WorldDoc): { value: unknown; away: Elsewhere[] } {
  const away: Elsewhere[] = [];
  const controls: PlayerControls = { mode: "player", busy: false, currency: world.currency, palette: { entries: [], timelapse: null }, act: () => Promise.resolve(true) };
  const tree = AssetsSegment({ view, controls, nav: { page: null, open: () => undefined, back: () => undefined, elsewhere: (to) => away.push(to), frame: "play", backLabel: null }, segment: "assets", onSegment: () => undefined, filter: ALL_ACTIVITY, onFilter: () => undefined, now: null, garage: true, panelId: "p" });
  const row = propsOf(tree, ListRow).find((p) => p.title === "Your vehicles");
  if (!row) throw new Error("Assets draws no Your vehicles row");
  (row.onClick as () => void)();
  return { value: row.value, away };
}

/** Jordan's vehicles on Port Alder, by name. */
const HIS = ["Your ATV", "Your fishing boat", "Your pickup"];

describe("Assets' vehicles", () => {
  test("Jordan's vehicles are marked in what his worth is made of, and the row shows what they're worth together, opening the Garage", () => {
    const { view, world } = jordansMoney();
    const vehicles = view.overview?.breakdown.filter((line) => line.vehicle === true) ?? [];
    expect(vehicles.map((line) => line.label).sort()).toEqual(HIS);
    for (const line of vehicles) expect(line.cents).toBeGreaterThan(0);
    // Only they are marked: the accounts' lines aren't.
    const rest = view.overview?.breakdown.filter((line) => !HIS.includes(line.label)) ?? [];
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.filter((line) => line.vehicle === true)).toEqual([]);
    const { value, away } = vehiclesRow(view, world);
    expect(value).toBe(formatMoney(vehicles.reduce((sum, line) => sum + line.cents, 0), world.currency));
    expect(away).toEqual([{ panel: "vehicles.garage" }]);
  });

  test("with no vehicle worth anything, nothing is marked and the row shows no figure", () => {
    const { view, world } = jordansMoney((w) => {
      for (const e of Object.values(w.entities)) if (HIS.includes(e.name)) e.fields.value = 0;
    });
    expect(view.overview?.breakdown.filter((line) => line.vehicle === true)).toEqual([]);
    const { value, away } = vehiclesRow(view, world);
    expect(value).toBeUndefined();
    expect(away).toEqual([{ panel: "vehicles.garage" }]);
  });
});
