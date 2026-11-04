// Item ops (ITEMS-SPEC §3.3, §3.5, §12 Phase 1) on Port Alder: the one location writer keeps a thing
// in exactly one place or holder, which no sequence of ops ever breaks (the property below, over
// seeded random sequences); the size rules bite when an op is resolved (a refrigerator put on Jordan
// lands where he stands, nothing goes into something smaller, a part never moves, a Built-in thing
// moves only when confirmed); a make finds what it would make first; a handover moves possession,
// never ownership, unless it gives, sells or trades; and a merge never puts a thing inside itself.

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
  const fix = (w: Working, change: ItemFix): string | null => {
    const out = resolveEdit(reg, w.world, w.state, [{ op: "fix_item", change }], { gm: false, runSeed: "fix" });
    if ("rejection" in out) return out.rejection.code;
    w.applyAll(out.events);
    return null;
  };

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
});
