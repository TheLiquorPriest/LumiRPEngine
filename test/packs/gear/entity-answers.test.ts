// What holds what and what lies where, as the engine answers it (DESIGN §7, §6.11, §9.7): nobody
// takes a vehicle, a part built into one or a fixed thing; only what holds things holds them, and
// Check world names a kind of the world's own given things it can't hold; the Place section lists
// only things; a bed is never a truck's bed; import reads a truck bed as the part the gear tables
// declare; and a world kind with a pack kind's id lies over it, Check world telling the kind whose
// own Extends cuts the pack's chain.

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

  test("Check world names a kind of the world's own that it puts things in or transfers things to but that holds nothing; one built on a container is quiet", () => {
    const world = newBlankWorld("w_holders", "Holders", reg);
    const thing = (id: string, kind: string, name: string, inside?: string) => ({ id, kind, name, tier: "background", fields: inside ? {} : { place: "home" }, relations: inside ? [{ type: "in", to: inside }] : [] });
    Object.assign(world.kinds, {
      chest: { id: "chest", label: "Chest", fields: {} },
      crate: { id: "crate", label: "Crate", fields: {} },
      bin: { id: "bin", label: "Bin", fields: {} },
      safe: { id: "safe", label: "Safe", extends: "container", fields: {} },
    });
    Object.assign(world.entities, { strongbox: thing("strongbox", "chest", "Strongbox"), coin: thing("coin", "item", "Coin", "strongbox"), dustbin: thing("dustbin", "bin", "Dustbin"), vault: thing("vault", "safe", "Vault"), ring: thing("ring", "item", "Ring", "vault") });
    world.actions.stash = {
      id: "stash",
      label: "Stash it",
      params: { box: { type: "ref", ref: "crate", label: "Box" } },
      requires: [],
      outcomes: { default: [{ type: "gear.transfer", args: { item: "coin", to: "box" } }, { type: "gear.give", args: { item: "ring", from: "you", to: "dustbin" } }] },
      duration: "1",
    };
    const told = () => lintWorld(world, reg).filter((i) => i.code === "gear.holders");
    expect(told().map((i) => [i.severity, i.path])).toEqual([
      ["warning", "kinds.chest"],
      ["warning", "kinds.crate"],
      ["warning", "kinds.bin"],
    ]);
    expect(told().map((i) => i.message.match(/in this world \((.*?)\) but/)?.[1])).toEqual(["Strongbox holds Coin", "Stash it gives things to its Box", "Stash it gives things to Dustbin"]);
    expect(told()[0]?.message).toContain("Set its Extends to container");
    for (const kind of ["chest", "crate", "bin"]) Object.assign(world.kinds[kind] ?? {}, { extends: "container" });
    expect(told()).toEqual([]);
  });

  test("Check world names a kind of the world's own whose things it moves but that goes nowhere, as the engine refuses them; one built on Item is quiet", () => {
    const world = newBlankWorld("w_contents", "Contents", reg);
    const thing = (id: string, kind: string, name: string, inside?: string) => ({ id, kind, name, tier: "background", fields: inside ? {} : { place: "home" }, relations: inside ? [{ type: "in", to: inside }] : [] });
    Object.assign(world.kinds, {
      coin: { id: "coin", label: "Coin", fields: {} },
      token: { id: "token", label: "Token", fields: {} },
      relic: { id: "relic", label: "Relic", fields: {} },
      gem: { id: "gem", label: "Gem", extends: "item", fields: {} },
    });
    Object.assign(world.entities, { pouch: thing("pouch", "container", "Pouch"), doubloon: thing("doubloon", "coin", "Doubloon", "pouch"), idol: thing("idol", "relic", "Idol"), ruby: thing("ruby", "gem", "Ruby", "pouch") });
    world.actions.pocket = {
      id: "pocket",
      label: "Pocket it",
      params: { loot: { type: "ref", ref: "token", label: "Loot" } },
      requires: [],
      outcomes: { default: [{ type: "gear.transfer", args: { item: "loot", to: "you" } }, { type: "gear.give", args: { item: "idol", from: "you", to: "pouch" } }] },
      duration: "1",
    };
    const told = () => lintWorld(world, reg).filter((i) => i.code === "gear.contents");
    expect(told().map((i) => [i.severity, i.path])).toEqual([
      ["warning", "kinds.coin"],
      ["warning", "kinds.token"],
      ["warning", "kinds.relic"],
    ]);
    expect(told().map((i) => i.message.match(/in this world \((.*?)\) but/)?.[1])).toEqual(["Pouch holds Doubloon", "Pocket it moves its Loot", "Pocket it moves Idol"]);
    expect(told()[0]?.message).toContain("Set its Extends to item");
    // What it warns of is what the engine does: a GM can't put the doubloon on you, the ruby can.
    const put = (entity: string): string | null => {
      const out = resolveEdit(reg, world, initialState(world, "contents", reg), [{ op: "put", entity, into: "you" }], { gm: true, runSeed: "contents" });
      return "rejection" in out ? out.rejection.code : null;
    };
    expect([put("doubloon"), put("ruby")]).toEqual(["cant_hold", null]);
    for (const kind of ["coin", "token", "relic"]) Object.assign(world.kinds[kind] ?? {}, { extends: "item" });
    expect(told()).toEqual([]);
    expect(put("doubloon")).toBeNull();
  });

  test("Check world reads what the engine certainly moves: a formula that is a parameter's name, a received thing, a lend of what the actor must carry; a lend of a parked thing and the scope's own names stay quiet", () => {
    const world = newBlankWorld("w_moves", "Moves", reg);
    const thing = (id: string, kind: string, name: string, inside?: string) => ({ id, kind, name, tier: "background", fields: inside ? {} : { place: "home" }, relations: inside ? [{ type: "in", to: inside }] : [] });
    const kinds = ["crate", "stall", "perch", "bench", "token", "relic", "hutch"];
    for (const id of kinds) world.kinds[id] = { id, label: id.charAt(0).toUpperCase() + id.slice(1), fields: {} };
    Object.assign(world.entities, { coin: thing("coin", "item", "Coin", "you"), chip: thing("chip", "token", "Chip"), bike: thing("bike", "item", "Bike"), box1: thing("box1", "crate", "Box"), stall1: thing("stall1", "stall", "Stall"), perch1: thing("perch1", "perch", "Perch"), bench1: thing("bench1", "bench", "Bench"), here: thing("here", "hutch", "Hutch") });
    const later = "=clock + 1440";
    const act = (id: string, label: string, params: Record<string, { type: "ref"; ref: string; label: string }>, requires: string[], effects: { type: string; args: Record<string, string> }[]) => ({ id, label, params, requires, outcomes: { default: effects }, duration: "1" });
    Object.assign(world.actions, {
      stash: act("stash", "Stash it", { box: { type: "ref", ref: "crate", label: "Box" }, loot: { type: "ref", ref: "token", label: "Loot" } }, [], [{ type: "gear.transfer", args: { item: "=loot", to: "=box" } }]),
      hand: act("hand", "Hand over", {}, [], [{ type: "gear.receive", args: { name: "Flyer", to: "stall1" } }]),
      lend: act("lend", "Lend it", { thing: { type: "ref", ref: "item", label: "Thing" } }, ["carries(self, thing)"], [{ type: "gear.lend", args: { item: "=params.thing", to: "perch1", until: later } }]),
      lend_relic: act("lend_relic", "Lend the relic", { relic: { type: "ref", ref: "relic", label: "Relic" } }, ["carries(self, relic)"], [{ type: "gear.lend", args: { item: "relic", to: "you", until: later } }]),
      lend_bike: act("lend_bike", "Lend the bike", {}, [], [{ type: "gear.lend", args: { item: "bike", to: "bench1", until: later } }]),
      drop_in: act("drop_in", "Put it here", {}, [], [{ type: "gear.transfer", args: { item: "coin", to: "=here" } }]),
    });
    const told = (code: string) => lintWorld(world, reg).filter((i) => i.code === code).map((i) => [i.path, i.message.match(/in this world \((.*?)\) but/)?.[1]]);
    expect(told("gear.holders")).toEqual([
      ["kinds.crate", "Stash it gives things to its Box"],
      ["kinds.stall", "Hand over gives things to Stall"],
      ["kinds.perch", "Lend it gives things to Perch"],
    ]);
    expect(told("gear.contents")).toEqual([
      ["kinds.token", "Stash it moves its Loot"],
      ["kinds.relic", "Lend the relic moves its Relic"],
    ]);
    // As the engine plays them: the box and the perch are refused, the stall is given a thing, the parked bike is lent where it stands.
    const state = initialState(world, "moves", reg);
    const run = (action: string, params: Record<string, string> = {}) => resolveOn(reg, world, state, { action, params }, createRng(action));
    expect(run("stash", { box: "box1", loot: "chip" }).resolution.rejected.map((r) => r.rejection.reason)).toEqual(["Box can't hold anything"]);
    expect(run("lend", { thing: "coin" }).resolution.rejected.map((r) => r.rejection.reason)).toEqual(["Perch can't hold anything"]);
    expect(Object.values(run("hand").state.entities).filter((e) => e.relations.some((r) => r.type === "in" && r.to === "stall1")).map((e) => e.name)).toEqual(["Flyer"]);
    expect(run("lend_bike").resolution.rejected).toEqual([]);
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

  test("Check world's advice goes to the kind whose own Extends cuts the pack's chain, and following it clears the warning", () => {
    const world = newBlankWorld("w_chain", "Chain", reg);
    Object.assign(world.kinds, { widget: { id: "widget", label: "Widget", fields: {} }, item: { id: "item", label: "Item", extends: "widget", fields: {} }, container: { id: "container", label: "Container", fields: {} } });
    const shadows = () => lintWorld(world, reg).filter((i) => i.code === "kind_shadow");
    expect(shadows().map((i) => i.path)).toEqual(["kinds.item"]);
    expect(shadows()[0]?.message).toContain("builds on widget instead of thing");
    expect(shadows()[0]?.message).toContain("Set its Extends back to thing");
    // A container that keeps the pack's parent, or names it, loses only what its Item cuts: told there.
    Object.assign(world.kinds.container ?? {}, { extends: "item" });
    expect(shadows().map((i) => i.path)).toEqual(["kinds.item"]);
    Object.assign(world.kinds.item ?? {}, { extends: "thing" });
    expect(shadows()).toEqual([]);
  });

  test("Build's forms read the same: the world's Person over the pack's keeps Home and Extends beside its own Grit", () => {
    const kinds = playedKinds(Object.fromEntries(reg.kinds), { person: { id: "person", label: "Person", fields: { grit: { type: "number", label: "Grit" } } } });
    expect(Object.keys(kinds.person?.fields ?? {})).toEqual(expect.arrayContaining(["home", "bed", "grit"]));
    expect(kinds.person?.extends).toBe("thing");
    expect(kinds.vehicle === reg.kinds.get("vehicle")).toBe(true);
  });
});
