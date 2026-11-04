// Entry and trespass (ORG-SPEC §3.9, §11 Phase 2 Access), on Port Alder with ITEMS' fixtures (the
// starter and a patch): with Marcus's house, 12 Birch Lane, set to entry owner, Go offers it to
// Jordan only greyed ("Private: Marcus Delgado's"); a narrated "Jordan walks into Marcus's house",
// with Marcus away, moves him and records `orgs.trespass`, and the Place section says so; carrying a
// key to it is a basis. At Alder Automotive after closing, Priya's entry reads as trespass and
// Jordan's (staff) doesn't. Change entry sets a place's entry in play, behind `property.manage`,
// with its History line, and the Premises section shows it.

import { describe, expect, test } from "bun:test";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { OrgView, PremisesView } from "../../../src/shared/org-view";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import { applyProposals } from "../../../src/backend/turn-model";
import { palette } from "../../../src/backend/view";
import { entryFor, entryRefusal, withoutLeave } from "../../../src/engine/entry";
import { createRng } from "../../../src/engine/rng";
import { placeEntry } from "../../../src/engine/org";
import { readPass } from "../../../src/engine/read-pass";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction } from "../../../src/engine/resolve";
import { evalExpr, placeOfEntity, scopeEnv } from "../../../src/engine/scope";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const MARCUS = "marcus_delgado";
const PRIYA = "priya_nair";
const HOUSE = "birch_lane_12";
const SHOP_PLACE = "alder_automotive";
const SHOP = "alder_automotive_co";

/** Port Alder at its start (Monday 14 Sep 2026, 6:15 AM: Alder Automotive opens at nine), with the world changes a test makes. */
function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

/** Marcus's house set to entry owner, a place Jordan knows of, with Marcus away at the shop. */
function privateHouse(world: WorldDoc): void {
  const house = world.places[HOUSE];
  if (!house) throw new Error("no 12 Birch Lane");
  delete house.visibility;
  house.fields.entry = "owner";
  const marcus = world.entities[MARCUS];
  if (marcus) marcus.fields.place = SHOP_PLACE;
}

/** A key to Marcus's house, on Jordan. */
const KEY: EntityDef = { id: "birch_key", kind: "item", name: "Brass house key", tier: "background", fields: { owner: MARCUS }, relations: [{ type: "in", to: JORDAN }] };

/** A move the reply tells, as the read stages it. */
function told(w: Working, entity: string, place: string): LedgerEvent[] {
  const [outcome] = applyProposals(reg, w, [{ type: "location", entity, place }], "seed", "run");
  if (!outcome || outcome.rejection) throw new Error(`the move was refused: ${outcome?.rejection?.reason ?? "no outcome"}`);
  return outcome.events;
}

const trespasses = (w: Working, place: string): JsonValue => (w.state.packs.orgs?.trespass as JsonObject | undefined)?.[place] ?? null;

/** The Place section's lines, every source of its slot, as the player character reads them. */
function placeSection(w: Working): string[] {
  return readPass(() => reg.renderers.filter((r) => r.slot === "place").flatMap((r) => r.render(w.ctx)));
}

function premises(w: Working, org: string): PremisesView {
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  const pages = readPass(() => view.build(w.ctx, { mapDisplay: null })) as unknown as Record<string, OrgView>;
  const section = pages[org]?.sections.premises;
  if (!section) throw new Error(`no premises for ${org}`);
  return section as unknown as PremisesView;
}

describe("Marcus's house set to entry owner", () => {
  test("Go offers it to Jordan only greyed, with why", () => {
    const w = portAlder(privateHouse);
    expect(placeEntry(w.ctx, HOUSE, w.state.clock)).toBe("owner");
    expect(entryFor(w.ctx, JORDAN, HOUSE)).toBeNull();
    expect(entryFor(w.ctx, MARCUS, HOUSE)).toEqual({ basis: "resident" });
    expect(entryRefusal(w.ctx, JORDAN, HOUSE)).toBe("Private: Marcus Delgado's");
    const go = readPass(() => palette(w.world, w.state, reg)).entries.find((e) => e.action === "go");
    expect(go?.options.find((o) => o.params.to === HOUSE)?.disabled).toBe("Private: Marcus Delgado's");
    // A place open to anyone is offered as before.
    expect(go?.options.find((o) => o.params.to === "bluebird_coffee")?.disabled).toBeUndefined();
    // Unset, as the starter has it, the house is open to him, as today.
    const plain = portAlder((world) => delete world.places[HOUSE]?.visibility);
    const open = readPass(() => palette(plain.world, plain.state, reg)).entries.find((e) => e.action === "go");
    expect(open?.options.find((o) => o.params.to === HOUSE)?.disabled).toBeUndefined();
  });

  test("a narrated walk-in with Marcus away moves Jordan, records orgs.trespass, and the Place section says so", () => {
    const w = portAlder(privateHouse);
    expect(placeSection(w).some((l) => l.includes("without leave"))).toBe(false);
    const events = told(w, JORDAN, HOUSE);
    expect(placeOfEntity(w.state, JORDAN)).toBe(HOUSE);
    expect(events.filter((e) => e.type === "orgs.trespass").map((e) => ("data" in e ? e.data : null))).toEqual([{ entity: JORDAN, place: HOUSE, at: w.state.clock, visibility: "public" }]);
    expect(trespasses(w, HOUSE)).toEqual([{ who: JORDAN, at: w.state.clock }]);
    const section = placeSection(w);
    expect(section).toContain("12 Birch Lane is Marcus Delgado's.");
    expect(section).toContain("You're in Marcus Delgado's house without leave.");
    // The player's line, in the Journal.
    const line = events.find((e) => e.type === "orgs.trespass");
    expect(line ? reg.get(line.type)?.describe(line as never, w.ctx, JORDAN) : null).toBe("You entered 12 Birch Lane without leave");
  });

  test("with Marcus at home, or coming along, an entry is no trespass", () => {
    const home = portAlder((world) => {
      privateHouse(world);
      const marcus = world.entities[MARCUS];
      if (marcus) marcus.fields.place = HOUSE;
    });
    expect(told(home, JORDAN, HOUSE).some((e) => e.type === "orgs.trespass")).toBe(false);
    expect(trespasses(home, HOUSE)).toBeNull();
    expect(placeSection(home).some((l) => l.includes("without leave"))).toBe(false);
    // Marcus brought along first (his move, then Jordan's): there when Jordan comes in.
    const along = portAlder(privateHouse);
    told(along, MARCUS, HOUSE);
    expect(told(along, JORDAN, HOUSE).some((e) => e.type === "orgs.trespass")).toBe(false);
  });

  test("carrying a key to it is a basis", () => {
    const w = portAlder((world) => {
      privateHouse(world);
      const house = world.places[HOUSE];
      if (house) house.fields.keys = [KEY.id];
      world.entities[KEY.id] = structuredClone(KEY);
    });
    expect(entryFor(w.ctx, JORDAN, HOUSE)).toEqual({ basis: "key", by: KEY.id });
    expect(evalExpr("may_enter(self, 'birch_lane_12')", scopeEnv({ reg, ctx: w.ctx, bindings: { self: JORDAN } }), null)).toBe(true);
    const go = readPass(() => palette(w.world, w.state, reg)).entries.find((e) => e.action === "go");
    expect(go?.options.find((o) => o.params.to === HOUSE)?.disabled).toBeUndefined();
    expect(told(w, JORDAN, HOUSE).some((e) => e.type === "orgs.trespass")).toBe(false);
    // Without it on him, no basis: the key left at home is no key carried.
    const left = portAlder((world) => {
      privateHouse(world);
      const house = world.places[HOUSE];
      if (house) house.fields.keys = [KEY.id];
      world.entities[KEY.id] = { ...structuredClone(KEY), fields: { owner: MARCUS, place: "harbor_street_114" }, relations: [] };
    });
    expect(entryFor(left.ctx, JORDAN, HOUSE)).toBeNull();
  });
});

describe("Alder Automotive after closing", () => {
  test("Priya's entry reads as trespass, and Jordan's, as staff, doesn't", () => {
    const w = portAlder();
    expect(placeEntry(w.ctx, SHOP_PLACE, w.state.clock)).toBe("staff");
    expect(entryFor(w.ctx, PRIYA, SHOP_PLACE)).toBeNull();
    expect(entryFor(w.ctx, JORDAN, SHOP_PLACE)).toEqual({ basis: "staff", via: SHOP, by: "job_pov_mechanic" });
    expect(entryFor(w.ctx, MARCUS, SHOP_PLACE)).toEqual({ basis: "owner", via: SHOP });
    expect(told(w, PRIYA, SHOP_PLACE).filter((e) => e.type === "orgs.trespass").map((e) => ("data" in e ? e.data.entity : null))).toEqual([PRIYA]);
    expect(withoutLeave(w.ctx, PRIYA, SHOP_PLACE)).toBe(true);
    // Jordan comes in after her: he may, and with him there she is no longer without leave.
    expect(told(w, JORDAN, SHOP_PLACE).some((e) => e.type === "orgs.trespass")).toBe(false);
    expect(trespasses(w, SHOP_PLACE)).toEqual([{ who: PRIYA, at: w.state.clock }]);
    expect(withoutLeave(w.ctx, PRIYA, SHOP_PLACE)).toBe(false);
  });

  test("open at ten, anyone comes in as a customer", () => {
    const w = portAlder();
    const ten = w.state.clock + (3 * 60 + 45);
    expect(placeEntry(w.ctx, SHOP_PLACE, ten)).toBe("customers");
    expect(entryFor(w.ctx, PRIYA, SHOP_PLACE, ten)).toEqual({ basis: "customer", via: SHOP });
  });
});

describe("Change entry and the Premises", () => {
  test("Marcus sets the shop to staff only at once, with its History line; Jordan may not; the Premises show it", () => {
    const w = portAlder();
    const before = premises(w, SHOP);
    expect(before.canChange).toBe(false);
    expect(before.places.map((p) => [p.id, p.entry, p.words, p.now, p.hours])).toEqual([[SHOP_PLACE, null, "Customers while it trades; staff only after hours", "Staff only now", "Mon to Sat, 9:00 AM to 5:00 PM"]]);
    const change = { org: SHOP, place: SHOP_PLACE, entry: "staff" };
    const refused = resolveAction(reg, new Working(reg, w.world, w.state), { action: "org_entry", actor: JORDAN, params: change }, createRng("t"));
    expect([refused.ok, refused.failed?.words]).toEqual([false, "Needs the power to manage its property"]);
    const done = resolveAction(reg, w, { action: "org_entry", actor: MARCUS, params: change }, createRng("t"));
    expect(done.ok).toBe(true);
    expect(done.events.map((e) => e.type)).toEqual(["orgs.entry", "orgs.log"]);
    expect(placeEntry(w.ctx, SHOP_PLACE, w.state.clock + 4 * 60)).toBe("staff");
    const after = premises(w, SHOP);
    expect(after.places.map((p) => [p.entry, p.inPlay, p.words])).toEqual([["staff", true, "Staff only"]]);
    // Put back as the world has it: the hours rule again.
    const back = resolveAction(reg, w, { action: "org_entry", actor: MARCUS, params: { ...change, entry: "default" } }, createRng("t2"));
    expect(back.ok).toBe(true);
    expect(placeEntry(w.ctx, SHOP_PLACE, w.state.clock + 4 * 60)).toBe("customers");
  });

  test("the GM's entry effect sets a person's house and its keys; a key set in play is a basis", () => {
    const w = portAlder((world) => {
      privateHouse(world);
      delete world.places[HOUSE]?.fields.entry;
      world.entities[KEY.id] = structuredClone(KEY);
    });
    expect(entryFor(w.ctx, JORDAN, HOUSE)).toEqual({ basis: "public" });
    const effect = reg.effects.get("orgs.entry");
    const events = effect?.resolve({ place: HOUSE, entry: "owner" }, { ...w.ctx, rng: createRng("gm"), params: {} });
    if (!Array.isArray(events)) throw new Error("the entry change was refused");
    w.applyAll(events);
    expect(entryFor(w.ctx, JORDAN, HOUSE)).toBeNull();
    const keyed = effect?.resolve({ place: HOUSE, keys: KEY.id }, { ...w.ctx, rng: createRng("gm"), params: {} });
    if (!Array.isArray(keyed)) throw new Error("the key change was refused");
    w.applyAll(keyed);
    expect(entryFor(w.ctx, JORDAN, HOUSE)).toEqual({ basis: "key", by: KEY.id });
    expect(effect?.resolve({ place: HOUSE, keys: KEY.id }, { ...w.ctx, rng: createRng("gm"), params: {} })).toEqual({ code: "no_change", reason: "it is so already" });
  });
});
