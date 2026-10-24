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
import { factLines, slotVars } from "../../src/backend/turn-steps";

const reg = createRegistry(ALL_PACKS);

/** A section's lines from the renderers of its slot (and `source` when given), in a scope. */
function lines(patch: (w: WorldDoc) => void, slot: string, scope: FeedScope = "player", source?: string): FeedLine[] {
  const world = modernUsWorld("w", "R");
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  return reg.renderers.filter((r) => r.slot === slot && !r.hint && (source === undefined || r.source === source)).flatMap((r) => linesOf(r, w.ctx, scope));
}

const thing = (id: string, name: string, fields: EntityDef["fields"], extra: Partial<EntityDef> = {}): EntityDef => ({ id, kind: "item", name, tier: "background", fields, relations: [], ...extra });

/** Everything a player surface reads for a world: every section's player lines, the helpers' fact lines and the step vars. */
function playerSurfaces(patch: (w: WorldDoc) => void): string {
  const world = modernUsWorld("w", "R");
  patch(world);
  const state = startState(world, reg);
  const w = new Working(reg, world, state);
  const player = reg.renderers.filter((r) => !r.hint).flatMap((r) => linesOf(r, w.ctx, "player").map((l) => l.text));
  return [...player, ...factLines(reg, world, state, []), ...Object.values(slotVars(reg, world, state))].join("\n");
}

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

describe("whose a thing lying here is", () => {
  test("a thing lying here is told with its owner, and one lent to the player character as his to use", () => {
    const base = (w: WorldDoc): void => {
      w.entities.key = thing("key", "Brass key", { place: "apartment", owner: "maya" });
      w.entities.drill = thing("drill", "Cordless drill", { place: "apartment", owner: "rosa" });
    };
    const here = (patch: (w: WorldDoc) => void): string => lines(patch, "place").map((l) => l.text).find((l) => l.includes("Brass key")) ?? "";
    expect(here(base)).toContain("Maya Chen");
    const lent = here((w) => {
      base(w);
      w.entities.you?.relations.push({ type: "uses", to: "drill" });
    });
    expect(lent).not.toEqual(here(base));
  });
});

describe("secrets stay off every player surface", () => {
  test("standing in a secret place, its description is in no player line, fact line or step var, and only the GM scope tells it", () => {
    const patch = (w: WorldDoc): void => {
      w.places.vault = { id: "vault", name: "Hidden vault", parent: "riverton", visibility: "secret", fields: { description: "A cold room lined with stolen paintings." } };
      const you = w.entities.you;
      if (you) you.fields.place = "vault";
    };
    expect(playerSurfaces(patch)).not.toContain("stolen paintings");
    expect(lines(patch, "place", "scene").map((l) => l.text).join("\n")).not.toContain("stolen paintings");
    expect(lines(patch, "place", "gm").filter((l) => l.text.includes("stolen paintings")).map((l) => l.known)).toEqual(["gm"]);
  });

  test("a secret safehouse his faction owns is in no player line, fact line or {{property}}, and only the GM scope tells it", () => {
    const patch = (w: WorldDoc): void => {
      w.entities.order = { id: "order", kind: "household", name: "Order of Ash", tier: "background", fields: {}, relations: [] };
      w.entities.you?.relations.push({ type: "member_of", to: "order" });
      w.entities.safehouse = { id: "safehouse", kind: "property", name: "Safehouse on Quarry Road", tier: "background", fields: { place: "park", owners: [{ party: "order", role: "owner" }], value: 9000000 }, relations: [], visibility: "secret" };
    };
    expect(playerSurfaces(patch)).not.toContain("Safehouse");
    expect(lines(patch, "property", "gm").filter((l) => l.text.includes("Safehouse")).map((l) => l.known)).toEqual(["gm"]);
  });

  test("in the scene scope a companion's secret revolver, van and warehouse appear nowhere; in the GM scope they do, marked", () => {
    const patch = (w: WorldDoc): void => {
      w.places.bay = { id: "bay", name: "Hidden service bay", parent: "riverton", visibility: "secret", fields: {} };
      w.entities.lee = { id: "lee", kind: "person", name: "Lee Park", tier: "supporting", fields: { place: "apartment" }, relations: [] };
      w.entities.revolver = thing("revolver", "Snub-nosed revolver", { owner: "lee" }, { relations: [{ type: "in", to: "lee" }], visibility: "secret" });
      w.entities.van = { id: "van", kind: "vehicle", name: "Unmarked van", tier: "background", fields: { owner: "lee", class: "minivan", place: "garage", status: "ok", fuel_pct: 50 }, relations: [], visibility: "secret" };
      w.entities.warehouse = { id: "warehouse", kind: "property", name: "Pier 9 warehouse", tier: "background", fields: { place: "bay", owners: [{ party: "lee", role: "owner" }], value: 5000000 }, relations: [], visibility: "secret" };
    };
    const secrets = ["Snub-nosed revolver", "Unmarked van", "Pier 9 warehouse", "Hidden service bay"];
    const scoped = (scope: FeedScope): FeedLine[] => ["people", "vehicles", "property"].flatMap((slot) => lines(patch, slot, scope));
    const scene = scoped("scene").map((l) => l.text).join("\n");
    for (const s of secrets) expect(scene).not.toContain(s);
    const gm = scoped("gm");
    for (const s of ["Snub-nosed revolver", "Unmarked van", "Pier 9 warehouse"]) expect(gm.filter((l) => l.text.includes(s)).map((l) => l.known)).toEqual(["gm"]);
  });
});
