// Item ops (ITEMS-SPEC §3.3, §3.5, §12 Phase 1) on Port Alder: the one location writer keeps a thing
// in exactly one place or holder, which no sequence of ops ever breaks (the property below, over
// seeded random sequences); the size rules bite when an op is resolved (a refrigerator put on Jordan
// lands where he stands, nothing goes into something smaller, a part never moves, a Built-in thing
// moves only when confirmed); a make finds what it would make first; a handover moves possession,
// never ownership, unless it gives, sells or trades, and a vehicle changes hands where it stands; a
// merge never puts a thing inside itself; a thing is worn in a slot of its own, Ready in hand; on the
// player's own paths a holder's room, its load and how deep things nest count; and the player's ✎
// on a thing of theirs says whose it is, who may use it, what it is called, puts it away or hands it
// to someone here, and adds a thing, under the player's rules (DESIGN §28.8).

import { describe, expect, test } from "bun:test";
import type { EntityId } from "../../src/shared/ids";
import type { JsonObject } from "../../src/shared/json";
import { GRANT_BASES, HANDOVER_BASES, PERMIT_SCOPES, SIZES, type ItemFix, type ItemOp, type Rest, type Spot } from "../../src/shared/things";
import type { EntityDef, RelationInstance, WorldDoc } from "../../src/shared/world";
import { resolveEdit } from "../../src/engine/edits";
import { createRegistry } from "../../src/engine/registry-impl";
import { createRng, type Rng } from "../../src/engine/rng";
import { isGone } from "../../src/engine/scope";
import { applyItemOp, type ItemOpOptions } from "../../src/engine/thing-ops";
import { tidyFindings } from "../../src/engine/thing-tidy";
import { holdsOf, isThing, spotOf } from "../../src/engine/things";
import { Working } from "../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const DANNY = "danny_okafor";
const GM: ItemOpOptions = { by: "gm", confirmed: true, gm: true, salt: "test" };
const STORY: ItemOpOptions = { by: "story", confirmed: false, gm: false, salt: "test" };

type Op = Exclude<ItemOp, { do: "remove" }>;

function thing(id: string, name: string, fields: JsonObject, relations: RelationInstance[] = []): EntityDef {
  return { id, kind: "item", name, tier: "background", fields, relations };
}

/** Port Alder with Danny's truck keys on him and the world changes a test makes. */
function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.entities.danny_keys = thing("danny_keys", "Truck keys", { owner: DANNY, catalog: "keys_set" }, [{ type: "in", to: DANNY }]);
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

/** The things that lie at a place and are in a holder at once: none, ever. */
function placedAndHeld(w: Working): EntityId[] {
  return Object.keys(w.state.entities).filter((id) => {
    const e = w.state.entities[id];
    return e !== undefined && isThing(w.ctx, id) && typeof e.fields.place === "string" && e.fields.place !== "" && e.relations.some((r) => r.type === "in");
  });
}

// ---------------------------------------------------------------- the property

const PEOPLE = [JORDAN, DANNY, "maddie_kowalczyk", "marcus_delgado", "jess_kowalczyk"];
const PLACES = ["harbor_street_114", "alder_automotive", "rusty_anchor", "lakefront_park", "alder_market"];
const NAMES = ["Wrench", "Refrigerator", "Turkey sandwich", "Toolbox", "Keys", "Shoebox", "Sofa", "Letter"];
const TYPES = [undefined, "refrigerator", "toolbox_20in", "keys_set", "wallet", "tv_55_4k", "sofa", "duffel_bag"];
const OPS = ["make", "move", "hand", "own", "grant", "revoke", "permit", "unpermit", "home", "use", "wear", "condition", "lose", "label", "merge"] as const;

const maybe = <T>(rng: Rng, value: () => T): T | undefined => (rng.int(0, 1) === 0 ? undefined : value());

/** One random item op over what the state has now: any thing, holder, person or place. */
function randomOp(rng: Rng, w: Working): Op {
  const things = Object.keys(w.state.entities).filter((id) => isThing(w.ctx, id) && !isGone(w.state, id)).sort();
  const holders = Object.keys(w.state.entities)
    .filter((id) => !isGone(w.state, id) && holdsOf(w.ctx, id) !== null)
    .sort();
  const item = rng.pick(things);
  const person = rng.pick(PEOPLE);
  const spot = (): Spot => (rng.int(0, 2) === 0 ? { place: rng.pick(PLACES) } : { in: rng.pick(holders) });
  const rest = (): Rest => (rng.int(0, 3) === 0 ? "owner" : spot());
  const until = (): number => w.state.clock + rng.int(1, 600);
  const kind = rng.pick(OPS);
  switch (kind) {
    case "make": {
      const type = rng.pick(TYPES);
      const size = maybe(rng, () => rng.pick(SIZES));
      const owner = maybe(rng, () => rng.pick(PEOPLE));
      const home = maybe(rng, rest);
      return { do: "make", name: rng.pick(NAMES), at: spot(), why: "it turned up", ...(type !== undefined ? { type } : {}), ...(size !== undefined ? { size } : {}), ...(owner !== undefined ? { owner } : {}), ...(home !== undefined ? { home } : {}) };
    }
    case "move":
      return { do: "move", item, to: spot(), why: "moved" };
    case "hand": {
      const basis = rng.pick(HANDOVER_BASES);
      return { do: "hand", item, to: person, basis, why: "handed over", ...(basis === "loan" ? { until: until() } : {}) };
    }
    case "own":
      return { do: "own", item, owner: rng.int(0, 3) === 0 ? null : person, why: "theirs now" };
    case "grant":
      return { do: "grant", item, who: person, basis: rng.pick(GRANT_BASES), ...(rng.int(0, 1) === 0 ? { until: until() } : {}) };
    case "revoke":
      return { do: "revoke", item, who: person };
    case "permit":
      return { do: "permit", from: rng.pick(PEOPLE), to: person, scope: rng.pick(PERMIT_SCOPES) };
    case "unpermit":
      return { do: "unpermit", from: rng.pick(PEOPLE), to: person };
    case "home":
      return { do: "home", item, home: rng.int(0, 3) === 0 ? null : rest() };
    case "use":
      return { do: "use", item, qty: rng.int(1, 2) };
    case "wear":
      return { do: "wear", item, who: person, ...(rng.int(0, 2) === 0 ? { off: true } : {}) };
    case "condition":
      return { do: "condition", item, delta: rng.int(-30, 30) || 1 };
    case "lose":
      return { do: "lose", item, ...(rng.int(0, 1) === 0 ? { by: person } : {}) };
    case "label":
      return { do: "label", item, name: rng.pick(NAMES), ...(rng.int(0, 1) === 0 ? { size: rng.pick(SIZES) } : {}) };
    case "merge":
      return { do: "merge", keep: item, drop: rng.pick(things) };
  }
}

describe("the one location writer (ITEMS-SPEC §3.3)", () => {
  test("property: no sequence of item ops leaves a thing both at a place and in a holder", () => {
    const start = portAlder();
    expect(placedAndHeld(start)).toEqual([]);
    const applied = new Map<string, number>();
    let refused = 0;
    for (let run = 0; run < 60; run++) {
      const rng = createRng(`thing-ops-property-${run}`);
      const w = new Working(reg, start.world, start.state);
      for (let step = 0; step < 40; step++) {
        const op = randomOp(rng, w);
        const mark = w.mark();
        const out = applyItemOp(w, op, { ...(rng.int(0, 1) === 0 ? GM : STORY), salt: `run:${run}:${step}` });
        // Whatever an op leaves, applied or refused partway, never breaks it.
        expect([`${run}:${step} ${op.do}`, placedAndHeld(w)]).toEqual([`${run}:${step} ${op.do}`, []]);
        if ("code" in out) {
          refused++;
          w.restore(mark);
        } else applied.set(op.do, (applied.get(op.do) ?? 0) + 1);
      }
      // Every thing is somewhere or nowhere, never in two holders.
      for (const id of Object.keys(w.state.entities)) expect(w.state.entities[id]?.relations.filter((r) => r.type === "in").length ?? 0).toBeLessThanOrEqual(1);
    }
    // The sequences reach every op, most of them applied.
    expect(OPS.filter((op) => (applied.get(op) ?? 0) === 0)).toEqual([]);
    const total = [...applied.values()].reduce((a, n) => a + n, 0);
    expect(total).toBeGreaterThan(refused);
  });
});

// ---------------------------------------------------------------- the size rules

describe("the size rules bite when an op resolves (ITEMS-SPEC §3.2, §5.3)", () => {
  test("a refrigerator made on Jordan lands where he stands, with a note for the GM; Furniture rests where it is", () => {
    const w = portAlder();
    const out = applyItemOp(w, { do: "make", name: "Refrigerator", type: "refrigerator", at: { in: JORDAN }, owner: JORDAN, why: "delivered" }, GM);
    if ("code" in out) throw new Error(out.reason);
    expect(out.placed).toEqual({ place: "harbor_street_114" });
    const id = out.made ?? "";
    expect(spotOf(w.state, id)).toEqual({ place: "harbor_street_114" });
    expect(w.state.entities[id]?.fields).toMatchObject({ owner: JORDAN, catalog: "refrigerator", category: "home_furnishings", made: { by: "gm", at: { place: "harbor_street_114" } } });
    expect(w.events.filter((e) => e.type === "engine.note").map((e) => ("data" in e ? e.data.visibility : null))).toEqual(["secret"]);
  });

  test("nothing goes into something smaller, a part never leaves its holder, and a Built-in thing moves only when confirmed", () => {
    const w = portAlder();
    expect(applyItemOp(w, { do: "move", item: "pov_toolbox", to: { in: "pov_wallet" }, why: "" }, GM)).toMatchObject({ code: "too_big" });
    expect(applyItemOp(w, { do: "move", item: "pov_truck_bed", to: { place: "alder_automotive" }, why: "" }, GM)).toMatchObject({ code: "part" });
    expect(applyItemOp(w, { do: "move", item: "relay_fuel_pump", to: { place: "alder_automotive" }, why: "" }, STORY)).toMatchObject({ code: "builtin" });
    // The GM's move is confirmed: the relay comes out of the truck, onto the shop floor.
    expect(applyItemOp(w, { do: "move", item: "relay_fuel_pump", to: { place: "alder_automotive" }, why: "pulled it" }, GM)).toEqual({});
    expect(spotOf(w.state, "relay_fuel_pump")).toEqual({ place: "alder_automotive" });
    // Put on Jordan, a Built-in thing is above the ceiling: it lands where he stands.
    expect(applyItemOp(w, { do: "move", item: "relay_fuel_pump", to: { in: JORDAN }, why: "" }, GM)).toEqual({ placed: { place: "harbor_street_114" } });
    // A vehicle goes only on another vehicle.
    expect(applyItemOp(w, { do: "move", item: "pov_atv", to: { in: "pov_truck_bed" }, why: "" }, GM)).toMatchObject({ code: "cant_hold" });
    expect(applyItemOp(w, { do: "move", item: "pov_atv", to: { in: "shop_tow_truck" }, why: "towed" }, GM)).toEqual({});
  });

  test("a make finds first: Jordan's keys stand for new keys made on him; a hidden thing it may be is weighed, not found", () => {
    const w = portAlder((world) => {
      world.entities.cash_envelope = thing("cash_envelope", "Envelope", { place: "alder_automotive", visibility: "discoverable" });
    });
    expect(applyItemOp(w, { do: "make", name: "keys", at: { in: JORDAN }, why: "" }, STORY)).toMatchObject({ code: "exists", exists: "pov_keys" });
    const made = applyItemOp(w, { do: "make", name: "Envelope", at: { place: "alder_automotive" }, why: "the reply put one on the counter" }, STORY);
    if ("code" in made) throw new Error(made.reason);
    expect(w.state.entities[made.made ?? ""]?.fields.maybe_same_as).toBe("cash_envelope");
  });
});

// ---------------------------------------------------------------- handovers

describe("a handover moves possession, never ownership, unless the story gives, sells or trades (ITEMS-SPEC §4.6)", () => {
  test("Danny hands Jordan his truck keys to move the truck: a hold, still Danny's; back to Danny ends it", () => {
    const w = portAlder();
    expect(applyItemOp(w, { do: "hand", item: "danny_keys", to: JORDAN, basis: "hold", why: "move the truck" }, STORY)).toEqual({});
    const keys = w.state.entities.danny_keys;
    expect(spotOf(w.state, "danny_keys")).toEqual({ in: JORDAN });
    expect(keys?.fields.owner).toBe(DANNY);
    expect(keys?.fields.got).toMatchObject({ how: "holding", from: DANNY, why: "move the truck" });
    expect(w.state.entities[JORDAN]?.relations).toContainEqual({ type: "uses", to: "danny_keys", fields: { basis: "hold", by: DANNY } });
    expect(applyItemOp(w, { do: "hand", item: "danny_keys", to: DANNY, basis: "return", why: "done" }, STORY)).toEqual({});
    expect(spotOf(w.state, "danny_keys")).toEqual({ in: DANNY });
    expect(w.state.entities[JORDAN]?.relations.some((r) => r.type === "uses" && r.to === "danny_keys")).toBe(false);
  });

  test("a gift makes it the receiver's and ends the grants on it; a theft keeps the owner", () => {
    const w = portAlder();
    expect(applyItemOp(w, { do: "hand", item: "pov_pocketknife", to: DANNY, basis: "theft", why: "" }, STORY)).toEqual({});
    expect(w.state.entities.pov_pocketknife?.fields).toMatchObject({ owner: JORDAN, got: { how: "took", from: JORDAN } });
    expect(applyItemOp(w, { do: "hand", item: "danny_keys", to: JORDAN, basis: "gift", why: "keep them" }, STORY)).toEqual({});
    expect(w.state.entities.danny_keys?.fields).toMatchObject({ owner: JORDAN, got: { how: "given", from: DANNY } });
    // Worn things come off whoever wore them.
    expect(w.state.entities.pov_pocketknife?.relations.some((r) => r.type === "worn_by")).toBe(false);
  });
});

describe("a vehicle changes hands where it stands (DESIGN §28.8)", () => {
  test("Jordan lends Danny his pickup: it stays at 114 Harbor Street, Danny's to use till then; given, it is Danny's and the loan ends; it is never taken by hand", () => {
    const w = portAlder();
    const until = w.state.clock + 600;
    expect(applyItemOp(w, { do: "hand", item: "pov_truck", to: DANNY, basis: "loan", until, why: "Danny needs a truck" }, STORY)).toEqual({});
    expect(spotOf(w.state, "pov_truck")).toEqual({ place: "harbor_street_114" });
    expect(w.state.entities.pov_truck?.fields.owner).toBe(JORDAN);
    expect(w.state.entities[DANNY]?.relations).toContainEqual({ type: "uses", to: "pov_truck", fields: { basis: "loan", by: JORDAN }, until });
    expect(applyItemOp(w, { do: "hand", item: "pov_truck", to: DANNY, basis: "theft", why: "" }, STORY)).toEqual({ code: "cant_hold", reason: "Your pickup is a vehicle: it is taken by driving it off, not by hand" });
    expect(applyItemOp(w, { do: "hand", item: "pov_truck", to: DANNY, basis: "gift", why: "Keep it" }, STORY)).toEqual({});
    expect(spotOf(w.state, "pov_truck")).toEqual({ place: "harbor_street_114" });
    expect(w.state.entities.pov_truck?.fields.owner).toBe(DANNY);
    expect(w.state.entities[DANNY]?.relations.some((r) => r.type === "uses" && r.to === "pov_truck")).toBe(false);
    // His now, he may use it already: a hold changes nothing.
    expect(applyItemOp(w, { do: "hand", item: "pov_truck", to: DANNY, basis: "hold", why: "" }, STORY)).toMatchObject({ code: "no_change" });
  });

  test("owners kept as a list become the one owner, or none, where they were refused before", () => {
    const w = portAlder((world) => {
      world.entities.skiff = { id: "skiff", kind: "vehicle", name: "Shared skiff", tier: "background", fields: { class: "bass_boat_outboard", place: "alder_harbor_marina", owners: [{ party: JORDAN, role: "owner", share: 50 }, { party: DANNY, role: "owner", share: 50 }] }, relations: [] };
    });
    expect(applyItemOp(w, { do: "own", item: "skiff", owner: JORDAN, why: "Jordan bought Danny out" }, GM)).toEqual({});
    expect(w.state.entities.skiff?.fields.owners).toEqual([{ party: JORDAN, role: "owner" }]);
    expect(applyItemOp(w, { do: "own", item: "skiff", owner: JORDAN, why: "" }, GM)).toMatchObject({ code: "no_change" });
    // Given for keeps, the receiver is its one owner, and it stays at the marina.
    expect(applyItemOp(w, { do: "hand", item: "skiff", to: DANNY, basis: "gift", why: "" }, GM)).toEqual({});
    expect([w.state.entities.skiff?.fields.owners, spotOf(w.state, "skiff")]).toEqual([[{ party: DANNY, role: "owner" }], { place: "alder_harbor_marina" }]);
    expect(applyItemOp(w, { do: "own", item: "skiff", owner: null, why: "" }, GM)).toEqual({});
    expect(w.state.entities.skiff?.fields.owners).toEqual([]);
  });
});

// ---------------------------------------------------------------- merging

describe("a merge never puts a thing inside itself (ITEMS-SPEC §3.3, §7.5)", () => {
  /** Port Alder with a duffel bag at home that may be the pouch inside it. */
  const nested = (): Working =>
    portAlder((world) => {
      world.entities.duffel = thing("duffel", "Duffel bag", { owner: JORDAN, catalog: "duffel_bag", place: "harbor_street_114", maybe_same_as: "pouch" });
      world.entities.pouch = thing("pouch", "Pouch", { owner: JORDAN, catalog: "wallet" }, [{ type: "in", to: "duffel" }]);
    });

  test("merging the bag into the pouch it holds is refused; the other way it merges", () => {
    const w = nested();
    expect(applyItemOp(w, { do: "merge", keep: "pouch", drop: "duffel" }, GM)).toMatchObject({ code: "cycle" });
    expect(w.state.entities.pouch?.relations.filter((r) => r.type === "in")).toEqual([{ type: "in", to: "duffel" }]);
    expect(applyItemOp(w, { do: "merge", keep: "duffel", drop: "pouch" }, GM)).toEqual({});
    expect(w.state.entities.pouch?.fields).toMatchObject({ merged_into: "duffel", gone: true });
  });

  test("Tidy up pairs a thing with the hidden one it may be only while neither holds the other", () => {
    const w = nested();
    const duplicates = (): string[] => tidyFindings(w.ctx, []).filter((f) => f.kind === "duplicate").map((f) => f.key);
    expect(duplicates()).toEqual([]);
    expect(applyItemOp(w, { do: "move", item: "pouch", to: { place: "harbor_street_114" }, why: "taken out" }, GM)).toEqual({});
    expect(duplicates()).toEqual(["duplicate:duffel+pouch"]);
  });
});

describe("wearing takes off what holds the slot, and a thing worn but lying elsewhere is a finding (N3)", () => {
  /** Port Alder with a rain jacket and a denim jacket on Jordan, the rain jacket worn, and a cap and a watch for the slots pockets and heads keep. */
  function dressed(): Working {
    return portAlder((world) => {
      world.entities.rain_jacket = thing("rain_jacket", "Rain jacket", { owner: JORDAN, slot: "torso_outer" }, [{ type: "in", to: JORDAN }, { type: "worn_by", to: JORDAN, fields: { slot: "torso_outer" } }]);
      world.entities.denim_jacket = thing("denim_jacket", "Denim jacket", { owner: JORDAN, slot: "torso_outer" }, [{ type: "in", to: JORDAN }]);
      world.entities.coin = thing("coin", "Lucky coin", { owner: JORDAN, slot: "pocket" }, [{ type: "in", to: JORDAN }, { type: "worn_by", to: JORDAN, fields: { slot: "pocket" } }]);
      world.entities.token = thing("token", "Arcade token", { owner: JORDAN, slot: "pocket" }, [{ type: "in", to: JORDAN }]);
    });
  }
  const wornBy = (w: Working, id: string): string[] => (w.state.entities[id]?.relations ?? []).filter((r) => r.type === "worn_by").map((r) => r.to);

  test("an occupied slot swaps: the denim jacket goes on, the rain jacket comes off and stays carried", () => {
    const w = dressed();
    expect(applyItemOp(w, { do: "wear", item: "denim_jacket", who: JORDAN }, STORY)).toEqual({});
    expect(wornBy(w, "denim_jacket")).toEqual([JORDAN]);
    expect(wornBy(w, "rain_jacket")).toEqual([]);
    expect(spotOf(w.state, "rain_jacket")).toEqual({ in: JORDAN });
    // A pocket holds several: nothing comes out of it.
    expect(applyItemOp(w, { do: "wear", item: "token", who: JORDAN }, STORY)).toEqual({});
    expect(wornBy(w, "coin")).toEqual([JORDAN]);
    expect(wornBy(w, "token")).toEqual([JORDAN]);
  });

  test("a jacket worn by Jordan but lying at 114 Harbor Street is a finding whose fix takes it off him, and it is gone once fixed", () => {
    const w = portAlder((world) => {
      world.entities.rain_jacket = thing("rain_jacket", "Rain jacket", { owner: JORDAN, slot: "torso_outer", place: "harbor_street_114" }, [{ type: "worn_by", to: JORDAN, fields: { slot: "torso_outer" } }]);
    });
    const finding = tidyFindings(w.ctx, []).find((f) => f.kind === "worn_elsewhere");
    expect(finding?.key).toBe("worn_elsewhere:rain_jacket");
    expect(finding?.text).toBe("Rain jacket lies at 114 Harbor Street, yet Jordan Ellis still wears it.");
    expect(finding?.fix?.ops).toEqual([{ op: "item", change: { do: "wear", item: "rain_jacket", who: JORDAN, off: true } }]);
    const change = finding?.fix?.ops[0];
    if (change?.op !== "item" || change.change.do === "remove") throw new Error("no item op");
    expect(applyItemOp(w, change.change, GM)).toEqual({});
    expect(wornBy(w, "rain_jacket")).toEqual([]);
    expect(spotOf(w.state, "rain_jacket")).toEqual({ place: "harbor_street_114" });
    expect(tidyFindings(w.ctx, []).some((f) => f.kind === "worn_elsewhere")).toBe(false);
  });
});

describe("a thing is worn in a slot of its own, and Ready is in hand (DESIGN §28.8)", () => {
  /** Port Alder with a hunting knife and a machete on Jordan, each kept in a sheath. */
  const armed = (): Working =>
    portAlder((world) => {
      world.entities.knife = thing("knife", "Hunting knife", { owner: JORDAN, category: "weapon", slot: "sheath" }, [{ type: "in", to: JORDAN }]);
      world.entities.machete = thing("machete", "Machete", { owner: JORDAN, category: "weapon", slot: "sheath" }, [{ type: "in", to: JORDAN }]);
    });
  /** How a thing is on Jordan: each relation that wears or readies it, with its slot. */
  const on = (w: Working, id: string): [string, unknown][] => (w.state.entities[id]?.relations ?? []).filter((r) => (r.type === "worn_by" || r.type === "equipped") && r.to === JORDAN).map((r) => [r.type, r.fields?.slot]);

  test("the knife goes in its sheath, is readied in hand and goes back to the sheath; readied twice, it is so already", () => {
    const w = armed();
    expect(applyItemOp(w, { do: "wear", item: "knife", who: JORDAN }, STORY)).toEqual({});
    expect(on(w, "knife")).toEqual([["worn_by", "sheath"]]);
    expect(applyItemOp(w, { do: "wear", item: "knife", who: JORDAN, slot: "hand_held" }, STORY)).toEqual({});
    expect(on(w, "knife")).toEqual([["equipped", "hand_held"]]);
    expect(applyItemOp(w, { do: "wear", item: "knife", who: JORDAN, slot: "hand_held" }, STORY)).toMatchObject({ code: "no_change" });
    expect(applyItemOp(w, { do: "wear", item: "knife", who: JORDAN, slot: "sheath" }, STORY)).toEqual({});
    expect(on(w, "knife")).toEqual([["worn_by", "sheath"]]);
  });

  test("a sheath takes one: the machete in it takes the knife off, still carried; anything may be readied; a slot the slots table hasn't is refused", () => {
    const w = armed();
    expect(applyItemOp(w, { do: "wear", item: "knife", who: JORDAN }, STORY)).toEqual({});
    expect(applyItemOp(w, { do: "wear", item: "machete", who: JORDAN }, STORY)).toEqual({});
    expect([on(w, "knife"), on(w, "machete"), spotOf(w.state, "knife")]).toEqual([[], [["worn_by", "sheath"]], { in: JORDAN }]);
    // The flashlight in the pickup's glovebox has no slot of its own: readied, it comes out into his hand.
    expect(applyItemOp(w, { do: "wear", item: "pov_flashlight", who: JORDAN, slot: "hand_held" }, STORY)).toEqual({});
    expect([spotOf(w.state, "pov_flashlight"), on(w, "pov_flashlight")]).toEqual([{ in: JORDAN }, [["equipped", "hand_held"]]]);
    // Any slot the slots table has: his watch moves from his wrist to his waist.
    expect(applyItemOp(w, { do: "wear", item: "pov_watch", who: JORDAN, slot: "waist" }, STORY)).toEqual({});
    expect(on(w, "pov_watch")).toEqual([["worn_by", "waist"]]);
    expect(applyItemOp(w, { do: "wear", item: "pov_watch", who: JORDAN, slot: "tail" }, STORY)).toEqual({ code: "bad_slot", reason: "there is no tail slot" });
  });
});

describe("on the player's own paths a holder's room, its load and how deep things nest count (DESIGN §28.8)", () => {
  /** An op on the player character's own path (an action, a ✎ fix): `room`. */
  const PLAYER: ItemOpOptions = { by: JORDAN, confirmed: false, gm: false, salt: "test", room: true };
  /** Port Alder with the gear pack's config as given and Jordan at the shop, where a shoebox takes a litre and a kilogram; a ball and a brick on him. */
  function shop(config: JsonObject = {}): Working {
    return portAlder((world) => {
      world.packs.gear = { version: world.packs.gear?.version ?? 1, config };
      const pov = world.entities[JORDAN];
      if (pov) pov.fields.place = "alder_automotive";
      world.entities.shoebox = { id: "shoebox", kind: "container", name: "Shoebox", tier: "background", fields: { owner: JORDAN, capacity_l: 1, max_load_kg: 1, holds: "hand", place: "alder_automotive" }, relations: [] };
      world.entities.ball = thing("ball", "Ball", { owner: JORDAN, size: "hand", volume_l: 2, weight_g: 100 }, [{ type: "in", to: JORDAN }]);
      world.entities.brick = thing("brick", "Brick", { owner: JORDAN, size: "hand", volume_l: 0.5, weight_g: 2500 }, [{ type: "in", to: JORDAN }]);
    });
  }
  const into = (item: string, holder: string): Op => ({ do: "move", item, to: { in: holder }, why: "" });

  test("the ball doesn't fit and the brick is too heavy for the shoebox, nor four mugs made in it; the story's and the GM's moves land as told", () => {
    const w = shop();
    expect(applyItemOp(w, into("ball", "shoebox"), PLAYER)).toEqual({ code: "no_room", reason: "Ball doesn't fit in Shoebox: 1 l of 1 l free" });
    expect(applyItemOp(w, into("brick", "shoebox"), PLAYER)).toEqual({ code: "no_room", reason: "Brick is too heavy for Shoebox, which takes 1 kg" });
    expect(applyItemOp(w, { do: "make", name: "Coffee mug", type: "mug_ceramic", qty: 4, at: { in: "shoebox" }, why: "" }, PLAYER)).toEqual({ code: "no_room", reason: "Coffee mug doesn't fit in Shoebox: 1 l of 1 l free" });
    const two = applyItemOp(w, { do: "make", name: "Coffee mug", type: "mug_ceramic", qty: 2, at: { in: "shoebox" }, why: "" }, PLAYER);
    if ("code" in two) throw new Error(two.reason);
    expect(spotOf(w.state, two.made ?? "")).toEqual({ in: "shoebox" });
    expect(applyItemOp(w, into("ball", "shoebox"), PLAYER)).toMatchObject({ reason: "Ball doesn't fit in Shoebox: 0.3 l of 1 l free" });
    expect(applyItemOp(w, into("ball", "shoebox"), STORY)).toEqual({});
    expect(applyItemOp(w, into("brick", "shoebox"), GM)).toEqual({});
  });

  test("with the world's capacity off only the size decides, and below Gear 2 nothing but the size counts", () => {
    expect(applyItemOp(shop({ containers: { capacity: "off" } }), into("ball", "shoebox"), PLAYER)).toEqual({});
    const low = shop();
    low.state.realism.levels.gear = 1;
    expect(applyItemOp(low, into("brick", "shoebox"), PLAYER)).toEqual({});
  });

  test("nothing nests deeper than the world's depth: a tin with a coin in it goes in the bag, not the pouch inside the bag", () => {
    const nested = (depth?: number): Working =>
      portAlder((world) => {
        world.packs.gear = { version: world.packs.gear?.version ?? 1, config: depth !== undefined ? { containers: { depth } } : {} };
        const pov = world.entities[JORDAN];
        if (pov) pov.fields.place = "alder_automotive";
        world.entities.bag = { id: "bag", kind: "container", name: "Duffel bag", tier: "background", fields: { owner: JORDAN, holds: "armful", place: "alder_automotive" }, relations: [] };
        world.entities.pouch = { id: "pouch", kind: "container", name: "Pouch", tier: "background", fields: { owner: JORDAN, holds: "hand" }, relations: [{ type: "in", to: "bag" }] };
        world.entities.tin = { id: "tin", kind: "container", name: "Tin", tier: "background", fields: { owner: JORDAN, size: "pocket", holds: "pocket" }, relations: [{ type: "in", to: JORDAN }] };
        world.entities.coin = thing("coin", "Coin", { owner: JORDAN, size: "pocket" }, [{ type: "in", to: "tin" }]);
        world.entities.button = thing("button", "Button", { owner: JORDAN, size: "pocket" }, [{ type: "in", to: JORDAN }]);
      });
    const w = nested(2);
    // In the pouch, in the bag: two deep, as deep as this world packs things.
    expect(applyItemOp(w, into("button", "pouch"), PLAYER)).toEqual({});
    // The tin takes its coin with it, which would be three deep.
    expect(applyItemOp(w, into("tin", "pouch"), PLAYER)).toEqual({ code: "too_deep", reason: "Tin can't go in Pouch: things are packed at most 2 deep" });
    expect(applyItemOp(w, into("tin", "bag"), PLAYER)).toEqual({});
    // Told by the story, it lands in the pouch; nothing more is made in it on the player's path.
    expect(applyItemOp(w, into("tin", "pouch"), STORY)).toEqual({});
    expect(applyItemOp(w, { do: "make", name: "Washer", size: "pocket", at: { in: "tin" }, why: "" }, PLAYER)).toMatchObject({ code: "too_deep" });
    // The world's own depth is 8.
    expect(applyItemOp(nested(), into("tin", "pouch"), PLAYER)).toEqual({});
  });
});

describe("a Gear or Place line the final review took out is a finding (N3)", () => {
  test("the head turn's dropped and rewritten Gear lines each read as one, naming the things they name; a Rules edit or an append is none", () => {
    const w = portAlder();
    const finalEdits = [
      { op: "drop" as const, part: "gear", at: 2, line: "- Truck keys (Danny Okafor's), in hand" },
      { op: "replace" as const, part: "place", at: 0, line: "In the room: a sofa", text: "In the room: a worn sofa" },
      { op: "drop" as const, part: "narrator_rules", at: 0, line: "Keep it short." },
      { op: "append" as const, part: "gear", text: "- A new line" },
    ];
    const found = tidyFindings(w.ctx, [], { finalEdits }).filter((f) => f.kind === "final_dropped");
    expect(found.map((f) => [f.things, f.fix, f.key.startsWith("final_dropped:")])).toEqual([
      [[], null, true],
      [["danny_keys", "pov_keys"], null, true],
    ]);
    expect(found[1]?.text).toBe('The last turn\'s final review took this line out of the narrator\'s Gear section: "- Truck keys (Danny Okafor\'s), in hand". A line it can\'t use often means the things are wrong: look at what it names.');
    // Without the head turn's edits, there is none.
    expect(tidyFindings(w.ctx, []).some((f) => f.kind === "final_dropped")).toBe(false);
  });
});

describe("a player's ✎ on a thing of theirs (fix_item, N3)", () => {
  /** Port Alder with Jordan at Alder Market, his TV on him, Danny's thermos at home and a wardrobe there. */
  function market(): Working {
    return portAlder((world) => {
      const pov = world.entities[JORDAN];
      if (pov) pov.fields.place = "alder_market";
      world.entities.tv = thing("tv", "Television", { owner: JORDAN }, [{ type: "in", to: JORDAN }]);
      world.entities.thermos = thing("thermos", "Thermos", { owner: DANNY, place: "harbor_street_114" });
      world.entities.wardrobe = thing("wardrobe", "Wardrobe", { owner: JORDAN, place: "harbor_street_114" });
    });
  }
  /** Port Alder at home, where Jordan wakes with Danny there: his old guitar on him, kept at home, and a cigar box there a harmonica fills. */
  function home(): Working {
    return portAlder((world) => {
      world.entities.guitar = thing("guitar", "Old guitar", { owner: JORDAN, home: "harbor_street_114" }, [{ type: "in", to: JORDAN }]);
      world.entities.cigar_box = { id: "cigar_box", kind: "container", name: "Cigar box", tier: "background", fields: { owner: JORDAN, capacity_l: 0.2, holds: "hand", place: "harbor_street_114" }, relations: [] };
      world.entities.harmonica = thing("harmonica", "Harmonica", { owner: JORDAN, size: "pocket", volume_l: 0.2 }, [{ type: "in", to: "cigar_box" }]);
    });
  }
  const fix = (w: Working, change: ItemFix): string | null => {
    const out = resolveEdit(reg, w.world, w.state, [{ op: "fix_item", change }], { gm: false, runSeed: "fix" });
    if ("rejection" in out) return out.rejection.code;
    w.applyAll(out.events);
    return null;
  };
  /** Whether `who` has leave to use `item` (a `uses` to it). */
  const mayUse = (w: Working, who: string, item: string): boolean => w.state.entities[who]?.relations.some((r) => r.type === "uses" && r.to === item) === true;

  test("his own TV moves home, and its size can be set and left to its name again", () => {
    const w = market();
    expect(fix(w, { do: "move", item: "tv", to: { place: "harbor_street_114" } })).toBeNull();
    expect(spotOf(w.state, "tv")).toEqual({ place: "harbor_street_114" });
    expect(fix(w, { do: "size", item: "tv", size: "armful" })).toBeNull();
    expect(w.state.entities.tv?.fields.size).toBe("armful");
    expect(fix(w, { do: "size", item: "tv", size: null })).toBeNull();
    expect(w.state.entities.tv?.fields.size ?? null).toBeNull();
  });

  test("refused: someone else's thing, a place he can't see, another person as the holder", () => {
    const w = market();
    expect(fix(w, { do: "move", item: "thermos", to: { place: "alder_market" } })).toBe("not_yours");
    expect(fix(w, { do: "move", item: "tv", to: { in: DANNY } })).toBe("not_yours");
    expect(fix(w, { do: "move", item: "tv", to: { place: "no_such_place" } })).toBe("missing_place");
    expect(spotOf(w.state, "tv")).toEqual({ in: JORDAN });
  });

  test("whose it is: his own, nobody's, or his household's once he has one; anyone else's is a Give, a Lend or a sale", () => {
    const w = market();
    expect(fix(w, { do: "own", item: "tv", owner: null })).toBeNull();
    expect(w.state.entities.tv?.fields.owner).toBeNull();
    // Nobody's, and on him: still his to change.
    expect(fix(w, { do: "own", item: "tv", owner: "self" })).toBeNull();
    expect(w.state.entities.tv?.fields.owner).toBe(JORDAN);
    expect(fix(w, { do: "own", item: "tv", owner: "self" })).toBe("no_change");
    expect(fix(w, { do: "own", item: "tv", owner: "household" })).toBe("no_household");
    const housed = portAlder((world) => {
      world.entities[JORDAN]?.relations.push({ type: "member_of", to: "household_kowalczyk", fields: { role: "member" } });
    });
    expect(fix(housed, { do: "own", item: "pov_watch", owner: "household" })).toBeNull();
    expect(housed.state.entities.pov_watch?.fields.owner).toBe("household_kowalczyk");
  });

  test("who may use it: someone he knows, for good or until an end after now, and taken back from one who has leave; and what it is called", () => {
    const w = market();
    const until = w.state.clock + 1440;
    expect(fix(w, { do: "grant", item: "tv", who: DANNY, until })).toBeNull();
    expect(w.state.entities[DANNY]?.relations).toContainEqual({ type: "uses", to: "tv", fields: { basis: "loan", by: JORDAN }, until });
    expect(fix(w, { do: "grant", item: "tv", who: "marcus_delgado" })).toBeNull();
    expect(w.state.entities.marcus_delgado?.relations).toContainEqual({ type: "uses", to: "tv", fields: { basis: "assign", by: JORDAN } });
    expect(fix(w, { do: "grant", item: "tv", who: DANNY, until: w.state.clock })).toBe("bad_until");
    expect(fix(w, { do: "grant", item: "tv", who: JORDAN })).toBe("missing_entity");
    expect(fix(w, { do: "grant", item: "thermos", who: "marcus_delgado" })).toBe("not_yours");
    expect(fix(w, { do: "revoke", item: "tv", who: DANNY })).toBeNull();
    expect([mayUse(w, DANNY, "tv"), mayUse(w, "marcus_delgado", "tv")]).toEqual([false, true]);
    expect(fix(w, { do: "revoke", item: "tv", who: DANNY })).toBe("no_change");
    expect(fix(w, { do: "label", item: "tv", name: "Old TV" })).toBeNull();
    expect(w.state.entities.tv?.name).toBe("Old TV");
    expect(fix(w, { do: "label", item: "tv", name: "Old TV" })).toBe("no_change");
    expect(fix(w, { do: "label", item: "thermos", name: "Mine now" })).toBe("not_yours");
  });

  test("put away: back where it is kept, or on him from someone holding it for him; a thing kept nowhere is refused", () => {
    const w = home();
    expect(fix(w, { do: "away", item: "guitar" })).toBeNull();
    expect(spotOf(w.state, "guitar")).toEqual({ place: "harbor_street_114" });
    expect(fix(w, { do: "away", item: "guitar" })).toBe("no_change");
    // His pocketknife, with Danny to hold: put away, it is back on him, and Danny's hold is over.
    expect(fix(w, { do: "hand", item: "pov_pocketknife", to: DANNY, basis: "hold" })).toBeNull();
    expect([spotOf(w.state, "pov_pocketknife"), mayUse(w, DANNY, "pov_pocketknife")]).toEqual([{ in: DANNY }, true]);
    expect(fix(w, { do: "away", item: "pov_pocketknife" })).toBeNull();
    expect([spotOf(w.state, "pov_pocketknife"), mayUse(w, DANNY, "pov_pocketknife")]).toEqual([{ in: JORDAN }, false]);
    // Made in play with nothing to say where it is kept: nowhere to put it.
    w.state.entities.sock = { kind: "item", name: "Odd sock", tier: "background", fields: { owner: JORDAN }, relations: [{ type: "in", to: JORDAN }], levels: {}, agent: false };
    expect(fix(w, { do: "away", item: "sock" })).toBe("no_rest");
  });

  test("handed to someone here: to hold, lent until an end, given; never to someone not here, and a loan needs its end", () => {
    const w = home();
    const until = w.state.clock + 600;
    expect(fix(w, { do: "hand", item: "guitar", to: DANNY, basis: "loan" })).toBe("bad_until");
    expect(fix(w, { do: "hand", item: "guitar", to: DANNY, basis: "loan", until })).toBeNull();
    expect([spotOf(w.state, "guitar"), w.state.entities.guitar?.fields.owner]).toEqual([{ in: DANNY }, JORDAN]);
    expect(w.state.entities[DANNY]?.relations).toContainEqual({ type: "uses", to: "guitar", fields: { basis: "loan", by: JORDAN }, until });
    expect(fix(w, { do: "hand", item: "pov_watch", to: DANNY, basis: "gift" })).toBeNull();
    expect([spotOf(w.state, "pov_watch"), w.state.entities.pov_watch?.fields.owner]).toEqual([{ in: DANNY }, DANNY]);
    // Marcus is at his own house: nobody walks it over to him.
    expect(fix(w, { do: "hand", item: "pov_keys", to: "marcus_delgado", basis: "hold" })).toBe("not_here");
    expect(fix(w, { do: "hand", item: "pov_keys", to: "pov_wallet", basis: "hold" })).toBe("not_a_person");
    // Given back only to whose it is: the keys are his own.
    expect(fix(w, { do: "hand", item: "pov_keys", to: DANNY, basis: "return" })).toBe("not_owner");
    expect(spotOf(w.state, "pov_keys")).toEqual({ in: JORDAN });
  });

  test("a thing he adds (Play's Add): his, by a type, by what it is or a vehicle's class, where he can see; never on someone else, nor while the chat holds him to the world", () => {
    const w = home();
    const made = (name: string): JsonObject | undefined => Object.values(w.state.entities).find((e) => e.name === name)?.fields;
    expect(fix(w, { do: "make", name: "Coffee mug", type: "mug_ceramic", at: { place: "harbor_street_114" } })).toBeNull();
    expect(made("Coffee mug")).toMatchObject({ catalog: "mug_ceramic", owner: JORDAN, place: "harbor_street_114", made: { by: "player" } });
    expect(fix(w, { do: "make", name: "Old revolver", is: "weapon", at: { in: JORDAN } })).toBeNull();
    expect(made("Old revolver")).toMatchObject({ category: "weapon", owner: JORDAN });
    expect(fix(w, { do: "make", name: "Shoebox", is: "container", description: "Full of letters", at: { place: "harbor_street_114" } })).toBeNull();
    expect(made("Shoebox")).toMatchObject({ holds: "hand", description: "Full of letters", owner: JORDAN });
    expect(fix(w, { do: "make", name: "Beater", class: "compact_car", details: { make: "Ford", model: "Focus", year: 2009 }, at: { place: "harbor_street_114" } })).toBeNull();
    expect(made("Beater")).toMatchObject({ class: "compact_car", owner: JORDAN, make: "Ford", model: "Focus", year: 2009, place: "harbor_street_114" });
    expect(fix(w, { do: "make", name: "Mug", at: { in: DANNY } })).toBe("not_yours");
    expect(fix(w, { do: "make", name: "Mug", at: { place: "birch_lane_12" } })).toBe("missing_place");
    // A fix counts a holder's room: the harmonica fills the cigar box.
    expect(fix(w, { do: "move", item: "pov_phone", to: { in: "cigar_box" } })).toBe("no_room");
    w.state.claims = { mode: "hold", capped: false };
    expect(fix(w, { do: "make", name: "Mug", at: { place: "harbor_street_114" } })).toBe("no_claims");
  });
});
