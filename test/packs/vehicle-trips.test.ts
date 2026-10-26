// Vehicle trips (DESIGN §9.1): from Port Alder's garage, the ATV's trip to The Rusty Anchor drives
// the road to Harbor Street and walks the rest, rather than out to the dunes and back; a vehicle
// parked elsewhere is fetched on foot; every trip's time is its parts, which the row tells; and the
// world's travel tuning (speeds, overheads) changes the times.

import { describe, expect, test } from "bun:test";
import type { PlaceId, TravelMode } from "../../src/shared/ids";
import type { TravelTuning, WorldDoc } from "../../src/shared/world";
import { createRegistry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { resolveOn } from "../../src/engine/resolve";
import { applyEffects } from "../../src/engine/effects";
import { Working } from "../../src/engine/working";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { buildMapView, type MapView } from "../../src/packs/space/core/view";
import { routeAt } from "../../src/packs/space/core/travel";
import { startState } from "./support";

const reg = createRegistry(ALL_PACKS);

/** Port Alder with the player character at `where`, its travel tuned by `travel`. */
function portAlder(where: PlaceId, travel?: Partial<TravelTuning>): { world: WorldDoc; state: WorldState } {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("w", "modern_slice_of_life");
  if (travel) world.mapSettings = { display: "knowledge", grid: { movement: false, sightRadius: 3 }, travel };
  const state = startState(world, reg);
  const pov = state.entities[world.pov];
  if (!pov) throw new Error("no player character");
  pov.fields.place = where;
  return { world, state };
}

type Row = MapView["travel"][number];

function rows(world: WorldDoc, state: WorldState): Row[] {
  return buildMapView(reg.context(world, state)).travel;
}

function row(list: readonly Row[], to: PlaceId, vehicle: string | null): Row {
  const found = list.find((r) => r.to === to && (vehicle === null ? r.action === "go" : r.params.vehicle === vehicle));
  if (!found) throw new Error(`no ${vehicle ?? "walk"} row to ${to}`);
  return found;
}

const partsSum = (r: Row): number => (r.parts ?? []).reduce((a, p) => a + p.minutes, 0);

describe("vehicle trips", () => {
  test("the ATV to The Rusty Anchor drives the road and walks the rest: quicker than walking, never out to the dunes and back", () => {
    const { world, state } = portAlder("alder_automotive");
    const list = rows(world, state);
    const walk = row(list, "rusty_anchor", null);
    const atv = row(list, "rusty_anchor", "pov_atv");
    expect(atv.minutes).toBeLessThan(walk.minutes);
    expect(partsSum(atv)).toBe(atv.minutes);
    // The row says where it's left, by the place's name, in the walk from there.
    expect((atv.parts ?? []).find((p) => p.kind === "walk")?.words).toContain(world.places.harbor_street_114?.name ?? "?");
  });

  test("driving a short hop is never slower than walking it without a reason the row shows", () => {
    const modes: Record<string, readonly TravelMode[]> = { pov_atv: ["offroad", "road"], pov_truck: ["road"], pov_boat: ["water"] };
    for (const from of ["alder_automotive", "harbor_street_114", "alder_harbor_marina", "shoreline_fuel"]) {
      const { world, state } = portAlder(from);
      const ctx = reg.context(world, state);
      for (const r of rows(world, state).filter((x) => x.action === "drive")) {
        const kinds = (r.parts ?? []).map((p) => p.kind);
        // The row's time is its parts, every one of them told.
        expect([from, r.to, partsSum(r)]).toEqual([from, r.to, r.minutes]);
        const walk = routeAt(ctx, from, r.to, "walk");
        // Left short of the place, the trip beats walking there, or it isn't offered.
        if (kinds.includes("walk") && walk) expect([from, r.to, r.minutes < walk.minutes]).toEqual([from, r.to, true]);
        // Driving where it is to the place itself, it goes the fastest way it can: never a slower mode first.
        if (!kinds.includes("walk") && !kinds.includes("fetch")) {
          const fastest = Math.min(...(modes[String(r.params.vehicle)] ?? []).map((m) => routeAt(ctx, from, r.to, m)?.minutes ?? Infinity));
          const drive = (r.parts ?? []).find((p) => p.kind === "drive")?.minutes ?? 0;
          expect([from, r.to, drive <= fastest]).toEqual([from, r.to, true]);
        }
      }
    }
  });

  test("a vehicle parked elsewhere is fetched on foot, and the row says where it is; past the world's longest fetch it isn't offered", () => {
    const { world, state } = portAlder("alder_automotive");
    const pickup = row(rows(world, state), "shoreline_fuel", "pov_truck");
    const fetch = routeAt(reg.context(world, state), "alder_automotive", "harbor_street_114", "walk");
    expect(pickup.parts?.[0]?.minutes).toBe(fetch?.minutes);
    expect(partsSum(pickup)).toBe(pickup.minutes);
    const near = portAlder("alder_automotive", { fetchMinutes: 5 });
    expect(rows(near.world, near.state).some((r) => r.params.vehicle === "pov_truck")).toBe(false);
  });

  test("the world's travel tuning changes the times: a vehicle class's speed, the overheads and walking speed", () => {
    const base = portAlder("alder_automotive");
    const before = row(rows(base.world, base.state), "shoreline_fuel", "pov_atv");
    const slow = portAlder("alder_automotive", { vehicleSpeeds: { atv_utility: 3 } });
    expect(row(rows(slow.world, slow.state), "shoreline_fuel", "pov_atv").minutes).toBeGreaterThan(before.minutes);
    const fussy = portAlder("alder_automotive", { startMinutes: 6 });
    expect(row(rows(fussy.world, fussy.state), "shoreline_fuel", "pov_atv").minutes).toBe(before.minutes + 5);
    const walkBefore = row(rows(base.world, base.state), "rusty_anchor", null).minutes;
    const stroll = portAlder("alder_automotive", { speeds: { walk: 2 } });
    expect(row(rows(stroll.world, stroll.state), "rusty_anchor", null).minutes).toBeGreaterThan(walkBefore);
  });

  test("driving takes the row's time, leaves the vehicle where the walk starts and brings the driver to the place", () => {
    const { world, state } = portAlder("alder_automotive");
    const atv = row(rows(world, state), "rusty_anchor", "pov_atv");
    const { resolution, state: after } = resolveOn(reg, world, state, { action: "drive", params: { vehicle: "pov_atv", to: "rusty_anchor" } }, createRng("drive"));
    expect(resolution.ok).toBe(true);
    expect(resolution.duration).toBe(atv.minutes);
    expect(placeOfEntity(after, world.pov)).toBe("rusty_anchor");
    expect(placeOfEntity(after, "pov_atv")).toBe("harbor_street_114");
  });

  test("the pickup at home can be driven from the garage: the drive action fetches it", () => {
    const { world, state } = portAlder("alder_automotive");
    const pickup = row(rows(world, state), "shoreline_fuel", "pov_truck");
    const { resolution, state: after } = resolveOn(reg, world, state, { action: "drive", params: { vehicle: "pov_truck", to: "shoreline_fuel" } }, createRng("fetch"));
    expect(resolution.ok).toBe(true);
    expect(resolution.duration).toBe(pickup.minutes);
    expect(placeOfEntity(after, "pov_truck")).toBe("shoreline_fuel");
  });

  test("driving a vehicle to where it already is isn't a trip: no row, the action declines and the effect refuses, so it stays put with its fuel", () => {
    const { world, state } = portAlder("alder_automotive");
    expect(rows(world, state).some((r) => r.params.vehicle === "pov_truck" && r.to === "harbor_street_114")).toBe(false);
    const fuel = state.entities.pov_truck?.fields.fuel_pct;
    const { resolution, state: after } = resolveOn(reg, world, state, { action: "drive", params: { vehicle: "pov_truck", to: "harbor_street_114" } }, createRng("home"));
    expect(resolution.ok).toBe(false);
    expect(placeOfEntity(after, "pov_truck")).toBe("harbor_street_114");
    expect(after.entities.pov_truck?.fields.fuel_pct).toBe(fuel);
    const w = new Working(reg, world, state);
    const told = applyEffects(reg, w, [{ type: "vehicles.drive", args: { vehicle: "pov_truck", to: "harbor_street_114" } }], { bindings: {}, rng: createRng("told") });
    expect(told.rejected.map((r) => r.rejection.code)).toEqual(["already_there"]);
    expect(placeOfEntity(w.state, "pov_truck")).toBe("harbor_street_114");
  });
});
