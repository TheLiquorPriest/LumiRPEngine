// What holds what and what lies where, as the engine answers it (DESIGN §7, §6.11, §9.7): nobody
// takes a vehicle, a part built into one or a fixed thing; only what holds things holds them; the
// Place section lists only things; a bed is never a truck's bed; import reads a truck bed as the
// part the gear tables declare; and a world kind that takes a pack kind's place is reported.

import { describe, expect, test } from "bun:test";
import type { JobProposal } from "../../../src/shared/protocol";
import { playedKinds, type WorldDoc } from "../../../src/shared/world";
import { lintWorld, migrateWorld, newBlankWorld } from "../../../src/engine/authoring";
import { buildCharacter } from "../../../src/engine/character";
import { resolveEdit } from "../../../src/engine/edits";
import { buildGmWorld } from "../../../src/engine/gm-view";
import { kindFields } from "../../../src/engine/scope";
import { createRegistry } from "../../../src/engine/registry-impl";
import { findAction, paramCandidates, resolveOn } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { initialState } from "../../../src/engine/world-state";
import { checkProposals } from "../../../src/backend/proposals";
import { searchThings } from "../../../src/frontend/character/places";
import { ALL_PACKS } from "../../../src/packs/index";
import { placeLines } from "../../../src/packs/space/core/feed";

const reg = createRegistry(ALL_PACKS);

/** The Modern starter (Port Alder): a pickup with a truck bed and a glovebox, an ATV with racks, an installed relay. */
async function portAlder(): Promise<WorldDoc> {
  return migrateWorld(await Bun.file(new URL("../../../src/packs/starters/modern_slice_of_life.json", import.meta.url)).json());
}

describe("Take never carries a vehicle, a built-in part or a fixed thing", () => {
  test("at home, Take offers what lies in the glovebox but not the pickup, its bed or its glovebox", async () => {
    const world = await portAlder();
    const state = initialState(world, "take", reg);
    const take = findAction(reg, world, "take");
    if (!take) throw new Error("no take action");
    const offered = paramCandidates(reg, world, state, take, "item");
    expect(offered).not.toContain("pov_truck");
    expect(offered).not.toContain("pov_truck_bed");
    expect(offered).not.toContain("pov_truck_glovebox");
    expect(offered).toContain("pov_flashlight");
    const truck = resolveOn(reg, world, state, { action: "take", params: { item: "pov_truck" } }, createRng("take"));
    expect(truck.resolution.ok).toBe(false);
    expect(truck.state.entities.pov_truck?.relations.some((r) => r.type === "in")).toBe(false);
  });

  test("at the shop, neither the vehicles, the ATV's racks nor the installed relay can be taken; the spare relay can", async () => {
    const world = await portAlder();
    const state = initialState(world, "shop", reg);
    const pov = state.entities[world.pov];
    if (!pov) throw new Error("no POV");
    pov.fields.place = "alder_automotive";
    const take = findAction(reg, world, "take");
    if (!take) throw new Error("no take action");
    const offered = paramCandidates(reg, world, state, take, "item");
    for (const id of ["pov_atv", "pov_atv_racks", "shop_tow_truck", "township_pickup", "relay_fuel_pump"]) expect(offered).not.toContain(id);
    expect(offered).toContain("spare_relay");
    const relay = resolveOn(reg, world, state, { action: "take", params: { item: "relay_fuel_pump" } }, createRng("relay"));
    expect(relay.resolution.ok).toBe(false);
  });
});

describe("only what holds things holds them", () => {
  test("a GM can't put a phone in a bill, the pickup in a wallet or a person in a phone; a phone in a wallet and a rider in the pickup stand", async () => {
    const world = await portAlder();
    const state = initialState(world, "put", reg);
    // The refusal's code, or null when the edit stands.
    const put = (entity: string, into: string): string | null => {
      const out = resolveEdit(reg, world, state, [{ op: "put", entity, into }], { gm: true, runSeed: "put" });
      return "rejection" in out ? out.rejection.code : null;
    };
    expect(put("pov_phone", "bill_phone")).toBe("cant_hold");
    expect(put("pov_truck", "pov_wallet")).toBe("cant_hold");
    expect(put("danny_okafor", "pov_phone")).toBe("cant_hold");
    expect(put("pov_phone", "pov_wallet")).toBeNull();
    expect(put("danny_okafor", "pov_truck")).toBeNull();
  });

  test("the GM view says what holds things and where each may go: a bill holds nothing and goes nowhere, the pickup goes only on a vehicle", async () => {
    const world = await portAlder();
    const gm = buildGmWorld(reg, world, initialState(world, "gm", reg));
    const at = (id: string) => gm.entities.find((e) => e.id === id);
    expect(at("pov")?.holds).toBe("person");
    expect(at("pov_wallet")?.holds).toBe("container");
    expect(at("pov_truck")?.holds).toBe("vehicle");
    expect(at("bill_phone")?.holds).toBeUndefined();
    expect(at("pov_phone")?.holds).toBeUndefined();
    expect(at("pov_phone")?.goes).toBeUndefined();
    expect(at("pov_truck")?.goes).toBe("vehicle");
    expect(at("danny_okafor")?.goes).toBe("vehicle");
    expect(at("bill_phone")?.goes).toBe("nowhere");
    expect(at("pov_truck_bed")?.goes).toBe("nowhere");
  });
});

describe("the Place section lists only things lying there", () => {
  test("at the shop, the business that trades there is no object on the floor, nor a bill a GM moved there", async () => {
    const world = await portAlder();
    const state = initialState(world, "place", reg);
    const pov = state.entities[world.pov];
    const bill = state.entities.bill_phone;
    if (!pov || !bill) throw new Error("no POV or bill");
    pov.fields.place = "alder_automotive";
    bill.fields.place = "alder_automotive";
    const lying = placeLines(reg.context(world, state), "player")
      .map((l) => l.text)
      .find((t) => t.startsWith("Lying here:"));
    expect(lying).toContain("Spare relay");
    expect(lying).not.toContain("Alder Automotive (");
    expect(lying).not.toContain("Mobile phone");
  });
});

describe("a bed is never a part built into a vehicle", () => {
  test("searching for a bed doesn't find the pickup's truck bed, and the parts aren't offered as somewhere to sleep", async () => {
    const world = await portAlder();
    const built = buildCharacter(reg, world, "pov");
    if (!built) throw new Error("no character");
    const ids = built.things.map((t) => t.id);
    expect(ids).not.toContain("pov_truck_bed");
    expect(ids).not.toContain("pov_truck_glovebox");
    expect(searchThings(built.things, "bed")).toEqual([]);
  });
});

describe("import reads a truck bed as the part the gear tables declare", () => {
  test("a Truck bed from lore gets a pickup bed row, never the price catalog's bed sheet set", () => {
    const world = newBlankWorld("w_bed", "Beds", reg);
    const raw: JobProposal[] = [{ id: "entities:truck_bed", collection: "entities", key: "truck_bed", value: { kind: "container", name: "Truck bed", fields: {} }, source: "test", confidence: 0.8 }];
    const [kept] = checkProposals(world, reg, raw, "import");
    const value = kept?.value;
    const catalog = value && typeof value === "object" && !Array.isArray(value) && value.fields && typeof value.fields === "object" && !Array.isArray(value.fields) ? value.fields.catalog : undefined;
    expect(catalog).not.toBe("bedding_sheet_set");
    expect(typeof catalog === "string" && world.tables["gear.containers"]?.rows[catalog]?.location).toBe("vehicle_fixed");
  });
});

describe("a world kind with a pack kind's id lies over it", () => {
  test("an empty Person kind of the world's own keeps the pack's Home, Bed and Place and its Extends, and Check world stays quiet", async () => {
    const world = await portAlder();
    world.kinds.person = { id: "person", label: "Person", fields: { grit: { type: "number", label: "Grit" } } };
    expect(Object.keys(kindFields(reg, world, "person"))).toEqual(expect.arrayContaining(["home", "bed", "place", "grit"]));
    expect(buildGmWorld(reg, world, initialState(world, "kinds", reg)).kinds.find((k) => k.id === "person")?.extends).toBe("thing");
    expect(lintWorld(world, reg).some((i) => i.code === "kind_shadow")).toBe(false);
  });

  test("one that builds on something else and so loses the pack's fields is reported, naming them and the fix", async () => {
    const world = await portAlder();
    world.kinds.vehicle = { id: "vehicle", label: "Vehicle", extends: "item", fields: {} };
    const shadow = lintWorld(world, reg).find((i) => i.code === "kind_shadow");
    expect(shadow?.severity).toBe("warning");
    expect(shadow?.path).toBe("kinds.vehicle");
    expect(shadow?.message).toContain("Capacity (l)");
    expect(shadow?.message).toContain("Set its Extends back to container");
    expect(lintWorld(await portAlder(), reg).some((i) => i.code === "kind_shadow")).toBe(false);
  });

  test("Build's forms read the same: the world's Person over the pack's keeps Home and Extends beside its own Grit", () => {
    const kinds = playedKinds(Object.fromEntries(reg.kinds), { person: { id: "person", label: "Person", fields: { grit: { type: "number", label: "Grit" } } } });
    expect(Object.keys(kinds.person?.fields ?? {})).toEqual(expect.arrayContaining(["home", "bed", "grit"]));
    expect(kinds.person?.extends).toBe("thing");
    expect(kinds.vehicle === reg.kinds.get("vehicle")).toBe(true);
  });
});
