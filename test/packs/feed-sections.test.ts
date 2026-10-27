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

describe("the Place section tells what is here whole, never a summary", () => {
  // A room's lore listing its whole inventory: far past the old 480-character share.
  const INVENTORY = Array.from({ length: 40 }, (_, i) => `shelf ${i + 1} holds a labelled jar of screws`).join("; ");

  test("a lore entry with a long room inventory reaches the section whole, and so does every other entry about the place", () => {
    const out = lines(
      (w) => {
        w.lore.storeroom = { id: "storeroom", title: "The storeroom shelves", content: `The room's inventory: ${INVENTORY}; and a broom by the door.`, keys: [], links: ["apartment"] };
        for (let i = 0; i < 8; i++) w.lore[`note${i}`] = { id: `note${i}`, title: `Apartment note ${i}`, content: `Note ${i} about the apartment.`, keys: [], links: ["apartment"] };
      },
      "place",
      "player",
      "place_lore",
    ).map((l) => l.text);
    expect(out).toContain(`The storeroom shelves: The room's inventory: ${INVENTORY}; and a broom by the door.`);
    for (let i = 0; i < 8; i++) expect(out).toContain(`Apartment note ${i}: Note ${i} about the apartment.`);
  });

  test("more than 12 things lying here are all named, each with whose it is, its count, its condition and its description", () => {
    const out = lines((w) => {
      w.realism.levels.gear = 3;
      for (let i = 1; i <= 15; i++) w.entities[`jar${i}`] = thing(`jar${i}`, `Jar number ${i}`, { place: "apartment", owner: "you", description: `A glass jar marked ${i}.` });
      w.entities.bolts = thing("bolts", "Box of bolts", { place: "apartment", owner: "maya", qty: 3, condition: 30 });
    }, "place").map((l) => l.text);
    for (let i = 1; i <= 15; i++) expect(out.find((l) => l.includes(`Jar number ${i} `))).toContain(`A glass jar marked ${i}.`);
    expect(out.find((l) => l.includes("Box of bolts"))).toBe("Lying here: Box of bolts ×3 (Maya Chen's; condition worn).");
    expect(out.join("\n")).not.toMatch(/and \d+ more/);
  });

  test("every room inside and every way out is named", () => {
    const out = lines((w) => {
      for (let i = 1; i <= 9; i++) w.places[`closet${i}`] = { id: `closet${i}`, name: `Closet ${i}`, parent: "apartment", fields: {} };
    }, "place").map((l) => l.text);
    const inside = out.find((l) => l.startsWith("Places inside it:")) ?? "";
    for (let i = 1; i <= 9; i++) expect(inside).toContain(`Closet ${i}`);
  });

  test("the helpers' facts for a busy room still hold the money, gear and vehicle lines, each line bounded", () => {
    const world = modernUsWorld("w", "R");
    for (let i = 1; i <= 40; i++) world.entities[`jar${i}`] = thing(`jar${i}`, `Jar number ${i}`, { place: "apartment", description: `A glass jar marked ${i}.` });
    world.lore.inventory = { id: "inventory", title: "The apartment's shelves", content: Array.from({ length: 200 }, (_, i) => `shelf ${i} holds a jar`).join("; "), keys: [], links: ["apartment"] };
    const state = startState(world, reg);
    const facts = factLines(reg, world, state, []);
    const ctx = new Working(reg, world, state).ctx;
    for (const slot of ["money", "gear", "vehicles"]) {
      const own = reg.renderers.filter((r) => r.slot === slot && !r.hint).flatMap((r) => r.render(ctx));
      expect(own.length).toBeGreaterThan(0);
      expect(facts.some((f) => own.includes(f))).toBe(true);
    }
    expect(facts.length).toBeLessThanOrEqual(40);
    expect(Math.max(...facts.map((f) => f.length))).toBeLessThanOrEqual(481);
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

  test("every worn and carried thing a person visibly has is told, past six", () => {
    const text = lines((w) => {
      patch(w);
      for (let i = 1; i <= 8; i++) w.entities[`badge${i}`] = thing(`badge${i}`, `Enamel badge ${i}`, { owner: "lee" }, { relations: [{ type: "worn_by", to: "lee" }] });
    }, "people", "player", "present_gear").map((l) => l.text).join("\n");
    for (let i = 1; i <= 8; i++) expect(text).toContain(`Enamel badge ${i}`);
    expect(text).toContain("Gym bag");
    expect(text).not.toContain("Roll of fifties");
  });
});

describe("the Gear section", () => {
  test("every thing the player character carries is listed with its details and what it is in", () => {
    const out = lines((w) => {
      for (let i = 1; i <= 14; i++) w.entities[`card${i}`] = thing(`card${i}`, `Punch card ${i}`, { owner: "you", description: `A punch card from shop ${i}.` }, { relations: [{ type: "in", to: "wallet" }] });
    }, "gear").map((l) => l.text);
    for (let i = 1; i <= 14; i++) expect(out).toContain(`Carrying: Punch card ${i} (in Wallet): A punch card from shop ${i}.`);
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

  // The house as the Property section's player line tells it, with these holders; Vex Morrow is a
  // person the player character doesn't know of.
  const houseLine = (owners: { party: string; role: string; share?: number }[]): string =>
    lines((w) => {
      w.entities.vex = { id: "vex", kind: "person", name: "Vex Morrow", tier: "supporting", fields: { place: "park" }, relations: [], visibility: "secret" };
      w.entities.house = { id: "house", kind: "property", name: "The Elm Street house", tier: "background", fields: { place: "apartment_bldg", owners, value: 25000000 }, relations: [] };
    }, "property").find((l) => l.text.includes("The Elm Street house"))?.text ?? "";
  const sharedStart = (a: string, b: string): string => {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return a.slice(0, i);
  };

  test("a role that only uses, keeps or benefits is never told as his own", () => {
    // How a line claims the house is his: what it opens with whenever he owns it, alone or jointly.
    const claim = sharedStart(houseLine([{ party: "you", role: "owner" }]), houseLine([{ party: "you", role: "joint", share: 50 }, { party: "maya", role: "joint", share: 50 }]));
    expect(claim.length).toBeGreaterThan(0);
    for (const role of ["authorized_user", "custodian", "beneficiary", "trustee"]) {
      const line = houseLine([{ party: "maya", role: "owner", share: 100 }, { party: "you", role }]);
      expect(line).toContain("Maya Chen");
      expect(line.startsWith(claim)).toBe(false);
    }
  });

  test("every co-owner's role is told: changing only one holder's role changes the line", () => {
    const base = [{ party: "you", role: "owner", share: 60 }, { party: "maya", role: "joint" }, { party: "rosa", role: "authorized_user" }];
    const line = houseLine(base);
    expect(line).toContain("Maya Chen");
    expect(line).toContain("Rosa Delgado");
    expect(houseLine([base[0]!, { party: "maya", role: "trustee" }, base[2]!])).not.toBe(line);
    expect(houseLine([base[0]!, base[1]!, { party: "rosa", role: "beneficiary" }])).not.toBe(line);
  });

  test("a holder he doesn't know of is never named, yet their role is still told", () => {
    for (const [mine, theirs] of [
      [{ party: "you", role: "owner", share: 60 }, "joint"],
      [{ party: "you", role: "authorized_user" }, "owner"],
    ] as const) {
      const line = houseLine([mine, { party: "vex", role: theirs }]);
      expect(line).not.toContain("Vex Morrow");
      expect(houseLine([mine, { party: "vex", role: "trustee" }])).not.toBe(line);
    }
  });
});

describe("whose a thing lying here is", () => {
  test("a thing lying here is told with its owner, and one lent to the player character as his to use", () => {
    const base = (w: WorldDoc): void => {
      w.entities.key = thing("key", "Brass key", { place: "apartment", owner: "maya" });
      w.entities.drill = thing("drill", "Cordless drill", { place: "apartment", owner: "rosa" });
    };
    const here = (patch: (w: WorldDoc) => void, name: string): string => lines(patch, "place").map((l) => l.text).find((l) => l.includes(name)) ?? "";
    expect(here(base, "Brass key")).toContain("Maya Chen");
    const lent = here((w) => {
      base(w);
      w.entities.you?.relations.push({ type: "uses", to: "drill" });
    }, "Cordless drill");
    expect(lent).not.toEqual(here(base, "Cordless drill"));
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

  test("the details the sections now tell show what he may know and nothing hidden: no Known by field he doesn't know, hidden cargo or thing, or a shut secret about the place", () => {
    const patch = (w: WorldDoc): void => {
      w.kinds.crate = { id: "crate", label: "Crate", extends: "item", fields: { stencil: { type: "text", label: "Stencil" }, manifest: { type: "text", label: "Manifest", visibility: "known_by" } } };
      w.entities.crate = { id: "crate", kind: "crate", name: "Wooden crate", tier: "background", fields: { place: "apartment", stencil: "PROPERTY OF THE DOCKS", manifest: "Smuggled watches" }, relations: [] };
      w.entities.ledger = thing("ledger", "Hidden ledger", { place: "apartment" }, { visibility: "secret" });
      w.entities.spare = thing("spare", "Spare tire", { owner: "you" }, { relations: [{ type: "in", to: "truck" }] });
      w.entities.parcel = thing("parcel", "Sealed parcel", { owner: "you" }, { relations: [{ type: "in", to: "truck" }], visibility: "secret" });
      w.lore.floorboard = { id: "floorboard", title: "Under the floorboard", content: "A loose floorboard hides a stack of forged deeds.", keys: [], links: ["apartment"], secret: true, gate: "false" };
    };
    const shown = playerSurfaces(patch);
    expect(shown).toContain("stencil PROPERTY OF THE DOCKS");
    expect(shown).toContain("Cargo: Spare tire.");
    for (const hidden of ["Smuggled watches", "Hidden ledger", "Sealed parcel", "forged deeds"]) expect(shown).not.toContain(hidden);
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
