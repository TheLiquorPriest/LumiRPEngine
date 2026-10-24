// The engine feed's sections (DESIGN §6.11): the Place section, what the people with the POV
// visibly wear and carry, other people's vehicles at its site, and the Property section, each in the
// player scope and, where they go further, the scope that adds what the POV doesn't know.

import { describe, expect, test } from "bun:test";
import type { EntityDef, FeedScope, WorldDoc } from "../../src/shared/world";
import { createRegistry } from "../../src/engine/registry-impl";
import type { FeedLine } from "../../src/engine/registry";
import { linesOf } from "../../src/engine/feed";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "./riverton";
import { startState } from "./support";

const reg = createRegistry(ALL_PACKS);

/** A section's lines from the renderers of its slot (and `source` when given), in a scope. */
function lines(patch: (w: WorldDoc) => void, slot: string, scope: FeedScope = "player", source?: string): FeedLine[] {
  const world = modernUsWorld("w", "R");
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  return reg.renderers.filter((r) => r.slot === slot && !r.hint && (source === undefined || r.source === source)).flatMap((r) => linesOf(r, w.ctx, scope));
}

const thing = (id: string, name: string, fields: EntityDef["fields"], extra: Partial<EntityDef> = {}): EntityDef => ({ id, kind: "item", name, tier: "background", fields, relations: [], ...extra });

describe("the Place section", () => {
  const patch = (w: WorldDoc): void => {
    w.entities.key = thing("key", "Brass key", { place: "apartment" });
    w.entities.letter = thing("letter", "Unsigned letter", { place: "apartment" }, { visibility: "secret" });
  };

  test("lists a thing lying here the player character can see, and not a hidden one", () => {
    const text = lines(patch, "place").map((l) => l.text).join("\n");
    expect(text).toContain("Brass key");
    expect(text).not.toContain("Unsigned letter");
  });

  test("the GM scope adds the hidden one, as a fact he doesn't know", () => {
    const hidden = lines(patch, "place", "gm").filter((l) => l.text.includes("Unsigned letter"));
    expect(hidden.map((l) => l.known)).toEqual(["gm"]);
  });
});

describe("what the people here wear and carry", () => {
  const patch = (w: WorldDoc): void => {
    w.entities.lee = { id: "lee", kind: "person", name: "Lee Park", tier: "supporting", fields: { place: "apartment" }, relations: [] };
    w.entities.jacket = thing("jacket", "Red rain jacket", { owner: "lee" }, { relations: [{ type: "worn_by", to: "lee" }] });
    w.entities.bag = thing("bag", "Gym bag", { owner: "lee" }, { kind: "container", relations: [{ type: "in", to: "lee" }] });
    w.entities.cash_roll = thing("cash_roll", "Roll of fifties", { owner: "lee" }, { relations: [{ type: "in", to: "bag" }] });
  };

  test("another person's worn thing is told, and what is in their bag is not", () => {
    const text = lines(patch, "people", "player", "present_gear").map((l) => l.text).join("\n");
    expect(text).toContain("Red rain jacket");
    expect(text).toContain("Gym bag");
    expect(text).not.toContain("Roll of fifties");
  });
});

describe("other people's vehicles", () => {
  test("someone else's car at his site is told with whose it is", () => {
    const out = lines((w) => {
      w.entities.jordan_car = { id: "jordan_car", kind: "vehicle", name: "Grey hatchback", tier: "background", fields: { owner: "jordan", class: "compact_car", place: "garage", status: "ok", fuel_pct: 50 }, relations: [] };
    }, "vehicles");
    const line = out.find((l) => l.text.startsWith("Grey hatchback:"));
    expect(line?.text).toContain("Jordan Price");
    expect(line?.known).toBe("pov");
  });
});

describe("the Property section", () => {
  test("lists the player character's house with his share and the other owner", () => {
    const out = lines((w) => {
      w.entities.house = { id: "house", kind: "property", name: "The Elm Street house", tier: "background", fields: { place: "apartment_bldg", owners: [{ party: "you", role: "owner", share: 60 }, { party: "maya", role: "owner", share: 40 }], value: 25000000 }, relations: [] };
    }, "property");
    const line = out.find((l) => l.text.includes("The Elm Street house"))?.text ?? "";
    expect(line).toContain("60%");
    expect(line).toContain("Maya Chen");
  });
});
