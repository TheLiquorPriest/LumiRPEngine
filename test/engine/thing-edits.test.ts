// GM edits of things (ITEMS-SPEC §3.5 `EditOp`, §8) on Port Alder: an `item` edit is one item op,
// resolved as the things model resolves it, and Remove is the GM's despawn; a `place` edit is the
// space pack's place op (ITEMS-SPEC §6.2), its made place seen by the next edit; and the older operations that move a
// thing (`put`, `move`, `link in`, `unlink in`, `set place`) go through the one location writer and
// its size rules, so none leaves a thing both somewhere and in something.

import { describe, expect, test } from "bun:test";
import type { FixOp, LedgerEvent } from "../../src/shared/ledger";
import type { EditOp } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import { parseEditOps, resolveEdit, type EditOptions } from "../../src/engine/edits";
import { createRegistry } from "../../src/engine/registry-impl";
import { isGone, placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { spotOf } from "../../src/engine/things";
import { resolveThing } from "../../src/engine/thing-resolve";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { madePlaces, madePlacesOf } from "../../src/engine/places-in-play";
import { fold, startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const GM: EditOptions = { gm: true, runSeed: "run" };
const PLAYER: EditOptions = { gm: false, runSeed: "run" };

function portAlder(): { world: WorldDoc; state: WorldState } {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  return { world, state: startState(world, reg) };
}

/** The edit's events folded onto the state, or its refusal's code. */
function edit(world: WorldDoc, state: Readonly<WorldState>, ops: readonly FixOp[], opts: EditOptions = GM): { state: WorldState; events: LedgerEvent[] } | string {
  const out = resolveEdit(reg, world, state, ops, opts);
  return "rejection" in out ? out.rejection.code : { state: fold(reg, world, state, out.events), events: out.events };
}

function applied(world: WorldDoc, state: Readonly<WorldState>, ops: readonly FixOp[], opts: EditOptions = GM): WorldState {
  const out = edit(world, state, ops, opts);
  if (typeof out === "string") throw new Error(`refused: ${out}`);
  return out.state;
}

/** Things lying at a place and in a holder at once. */
const placedAndHeld = (state: WorldState): string[] => Object.keys(state.entities).filter((id) => typeof state.entities[id]?.fields.place === "string" && state.entities[id]?.relations.some((r) => r.type === "in"));

describe("item and place edits (ITEMS-SPEC §3.5)", () => {
  test("an item edit is one item op: the keys handed to Danny to hold, and back", () => {
    const { world, state } = portAlder();
    const held = applied(world, state, [{ op: "item", change: { do: "hand", item: "pov_keys", to: "danny_okafor", basis: "hold", why: "hold these" } }]);
    expect(spotOf(held, "pov_keys")).toEqual({ in: "danny_okafor" });
    expect(held.entities.pov_keys?.fields).toMatchObject({ owner: JORDAN, got: { how: "holding", from: JORDAN, why: "hold these" } });
    const back = applied(world, held, [{ op: "item", change: { do: "hand", item: "pov_keys", to: JORDAN, basis: "return", why: "" } }]);
    expect(spotOf(back, "pov_keys")).toEqual({ in: JORDAN });
    // A refused op refuses the edit, with its reason's code.
    expect(edit(world, state, [{ op: "item", change: { do: "move", item: "pov_toolbox", to: { in: "pov_wallet" }, why: "" } }])).toBe("too_big");
  });

  test("an item edit makes a thing, and the same edit made again finds it", () => {
    const { world, state } = portAlder();
    const made = edit(world, state, [{ op: "item", change: { do: "make", name: "Milk", type: "milk_whole", at: { place: "harbor_street_114" }, why: "Jordan bought milk" } }]);
    if (typeof made === "string") throw new Error(made);
    const spawned = made.events.find((e) => e.type === "spawn");
    const id = spawned && "entity" in spawned && typeof spawned.entity === "object" ? spawned.entity.id : "";
    expect(spotOf(made.state, id)).toEqual({ place: "harbor_street_114" });
    expect(made.state.entities[id]?.fields.made).toEqual({ by: "gm", at: { place: "harbor_street_114" } });
    expect(edit(world, made.state, [{ op: "item", change: { do: "make", name: "Milk", at: { place: "harbor_street_114" }, why: "" } }])).toBe("exists");
  });

  test("a label renames the thing (`engine.rename`) and gives it aliases; the resolver finds it by either", () => {
    const { world, state } = portAlder();
    const out = edit(world, state, [{ op: "item", change: { do: "label", item: "pov_keys", name: "Key ring", aliases: ["keys"] } }]);
    if (typeof out === "string") throw new Error(out);
    expect(out.events.find((e) => e.type === "engine.rename")).toMatchObject({ data: { entity: "pov_keys", name: "Key ring", was: "Keys" } });
    expect(out.state.entities.pov_keys?.name).toBe("Key ring");
    expect(out.state.entities.pov_keys?.fields.aliases).toEqual(["keys"]);
    const ctx = reg.context(world, out.state);
    expect(resolveThing(ctx, "the key ring", { actor: JORDAN, viewer: JORDAN })).toEqual({ id: "pov_keys", secret: false });
    expect(resolveThing(ctx, "my keys", { actor: JORDAN, viewer: JORDAN })).toEqual({ id: "pov_keys", secret: false });
    // Nothing to change is refused as so.
    expect(edit(world, out.state, [{ op: "item", change: { do: "label", item: "pov_keys", name: "Key ring" } }])).toBe("no_change");
  });

  test("Remove from the world is the GM's despawn; a player's ✎ can't, and it is for things only", () => {
    const { world, state } = portAlder();
    const removed = applied(world, state, [{ op: "item", change: { do: "remove", item: "pov_watch", why: "lost it off screen" } }]);
    expect(isGone(removed, "pov_watch")).toBe(true);
    expect(edit(world, state, [{ op: "item", change: { do: "remove", item: "pov_watch", why: "" } }], PLAYER)).toBe("gm_only");
    expect(edit(world, state, [{ op: "item", change: { do: "remove", item: "danny_okafor", why: "" } }])).toBe("not_a_thing");
  });

  test("a place edit is the space pack's: a room made, found first, labelled, moved into, and kept while someone is there", () => {
    const { world, state } = portAlder();
    const make: FixOp = { op: "place", change: { do: "make", name: "Back office", parent: "alder_automotive", as: "room", why: "Marcus's office" } };
    const out = edit(world, state, [make]);
    if (typeof out === "string") throw new Error(`refused: ${out}`);
    const made = madePlaces(out.state);
    expect(made.map((p) => [p.name, p.parent, p.made.as, p.made.by])).toEqual([["Back office", "alder_automotive", "room", "gm"]]);
    const office = made[0]?.id ?? "";
    expect(office).toMatch(/^place_back_office_[0-9a-f]{8}$/);
    // Found first: the same name under the same parent is that place, by name or by its head noun.
    expect(edit(world, out.state, [make])).toBe("exists");
    expect(edit(world, out.state, [{ op: "place", change: { do: "make", name: "the office", parent: "alder_automotive", as: "room", why: "" } }])).toBe("exists");
    // Every reader sees it: a move into it, and the move's own check of the place.
    const moved = applied(world, out.state, [{ op: "move", entity: "marcus_delgado", to: office }]);
    expect(placeOfEntity(moved, "marcus_delgado")).toBe(office);
    const renamed = applied(world, moved, [{ op: "place", change: { do: "label", place: office, name: "Marcus's office", aliases: ["the back office"] } }]);
    expect(madePlacesOf(renamed)[office]?.name).toBe("Marcus's office");
    expect(edit(world, moved, [{ op: "place", change: { do: "remove", place: office } }])).toBe("occupied");
    expect(edit(world, moved, [{ op: "place", change: { do: "label", place: "alder_automotive", name: "Alder Auto" } }])).toBe("not_made");
    const gone = applied(world, out.state, [{ op: "place", change: { do: "remove", place: office } }]);
    expect(madePlaces(gone)).toEqual([]);
    // A player's ✎ makes one too, as the player's.
    const mine = edit(world, state, [make], PLAYER);
    expect(typeof mine === "string" ? mine : madePlaces(mine.state).map((p) => p.made.by)).toEqual(["player"]);
  });

  test("parseEditOps reads item and place edits for shape, and refuses a malformed one", () => {
    const ops: EditOp[] = [
      { op: "item", change: { do: "move", item: "pov_keys", to: { place: "harbor_street_114" }, why: "" } },
      { op: "place", change: { do: "label", place: "alder_automotive", name: "Alder Auto" } },
    ];
    expect(parseEditOps(JSON.parse(JSON.stringify(ops)))).toEqual(ops);
    expect(parseEditOps([{ op: "item", change: { do: "move", item: "pov_keys", to: { shelf: "top" }, why: "" } }])).toBeNull();
    expect(parseEditOps([{ op: "item", change: { do: "teleport", item: "pov_keys" } }])).toBeNull();
    expect(parseEditOps([{ op: "place", change: { do: "make", name: "Shed", parent: "harbor_street_114", as: "castle", why: "" } }])).toBeNull();
  });
});

describe("the older moves of a thing go through the one location writer (ITEMS-SPEC §8)", () => {
  test("put: into a holder by the size rules, and out to where the holder stands", () => {
    const { world, state } = portAlder();
    const inBox = applied(world, state, [{ op: "put", entity: "pov_keys", into: "pov_toolbox" }]);
    expect(spotOf(inBox, "pov_keys")).toEqual({ in: "pov_toolbox" });
    expect(inBox.entities.pov_keys?.relations.some((r) => r.type === "worn_by")).toBe(false);
    const out = applied(world, inBox, [{ op: "put", entity: "pov_keys", into: null }]);
    expect(spotOf(out, "pov_keys")).toEqual({ place: "alder_automotive" });
    expect(edit(world, state, [{ op: "put", entity: "pov_toolbox", into: "pov_wallet" }])).toBe("too_big");
    expect(edit(world, state, [{ op: "put", entity: "spare_relay", into: null }])).toBe("not_inside");
  });

  test("move, link in, unlink in and set place: one place or one holder, never both", () => {
    const { world, state } = portAlder();
    const moved = applied(world, state, [{ op: "move", entity: "pov_phone", to: "rusty_anchor" }]);
    expect(spotOf(moved, "pov_phone")).toEqual({ place: "rusty_anchor" });
    const linked = applied(world, moved, [{ op: "link", rel: "in", from: "pov_phone", to: "pov_truck_glovebox" }]);
    expect(spotOf(linked, "pov_phone")).toEqual({ in: "pov_truck_glovebox" });
    expect(linked.entities.pov_phone?.fields.place ?? null).toBeNull();
    const unlinked = applied(world, linked, [{ op: "unlink", rel: "in", from: "pov_phone", to: "pov_truck_glovebox" }]);
    // Out of the glovebox, it lies where the pickup stands.
    expect(spotOf(unlinked, "pov_phone")).toEqual({ place: "harbor_street_114" });
    const set = applied(world, linked, [{ op: "set", entity: "pov_phone", field: "place", value: "lakefront_park" }]);
    expect(spotOf(set, "pov_phone")).toEqual({ place: "lakefront_park" });
    for (const s of [moved, linked, unlinked, set]) expect(placedAndHeld(s)).toEqual([]);
  });

  test("a player's ✎ never moves a Built-in thing; the GM's move is confirmed and does", () => {
    const { world, state } = portAlder();
    expect(edit(world, state, [{ op: "move", entity: "relay_fuel_pump", to: "alder_automotive" }], PLAYER)).toBe("builtin");
    const pulled = applied(world, state, [{ op: "move", entity: "relay_fuel_pump", to: "alder_automotive" }]);
    expect(spotOf(pulled, "relay_fuel_pump")).toEqual({ place: "alder_automotive" });
    // A part built into the truck never comes out, for anyone.
    expect(edit(world, state, [{ op: "move", entity: "pov_truck_bed", to: "harbor_street_114" }])).toBe("part");
  });

  test("a person still moves as before", () => {
    const { world, state } = portAlder();
    const moved = applied(world, state, [{ op: "move", entity: "danny_okafor", to: "rusty_anchor" }]);
    expect(placeOfEntity(moved, "danny_okafor")).toBe("rusty_anchor");
  });
});
