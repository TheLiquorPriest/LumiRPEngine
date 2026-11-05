// The tellers of things (ITEMS-SPEC §4.4, §5.5, §10.3), on Port Alder: the Gear section's On you,
// Holding for, Borrowed, Lent out and Not with you lines; the Place section's furnishings, loose
// things and what is in the holders the player character may use; whose a carried thing is in
// People; Play → Me → Gear's sections; everyday carry as the gear pack's generator 2 and its lint;
// and the words for whose a thing is and where it is.

import { describe, expect, test } from "bun:test";
import type { RelationInstance } from "../../../src/shared/world";
import type { JsonObject } from "../../../src/shared/json";
import type { FeedScope, WorldDoc } from "../../../src/shared/world";
import { calendarOf, formatClock } from "../../../src/engine/calendar";
import { linesOf } from "../../../src/engine/feed";
import { materializeAll } from "../../../src/engine/materialize";
import type { FeedLine } from "../../../src/engine/registry";
import { createRegistry } from "../../../src/engine/registry-impl";
import type { EntityState, WorldState } from "../../../src/engine/state";
import { whereWords, whoseWords } from "../../../src/engine/thing-words";
import { Working } from "../../../src/engine/working";
import { carryProblems } from "../../../src/packs/gear/core/carry";
import { buildGearView } from "../../../src/packs/gear/core/view";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const POV = "pov";
const DANNY = "danny_okafor";
const MARCUS = "marcus_delgado";
const HOME = "harbor_street_114";

/** Port Alder with `patch` made to its document and `put` to its starting state, Jordan at 114 Harbor Street with Danny. */
function portAlder(put: (s: WorldState) => void = () => undefined, patch: (world: WorldDoc) => void = () => undefined): Working {
  const world = STARTER_WORLDS.modern_slice_of_life!("pa", "Port Alder");
  patch(world);
  const state = startState(world, reg);
  put(state);
  return new Working(reg, world, state);
}

/** A thing in the starting state. */
function thing(name: string, fields: JsonObject, relations: RelationInstance[] = [], kind = "item"): EntityState {
  return { kind, name, tier: "background", fields, relations, levels: {}, agent: false };
}

/** Moves a thing of the state into `to` (a person or a holder), out of whatever had it. */
function moveInto(s: WorldState, id: string, to: string): void {
  const e = s.entities[id]!;
  e.relations = [...e.relations.filter((r) => r.type !== "in" && r.type !== "worn_by" && r.type !== "equipped"), { type: "in", to }];
  delete e.fields.place;
}

/** Leaves a thing of the state at a place, in nothing. */
function moveTo(s: WorldState, id: string, place: string): void {
  const e = s.entities[id]!;
  e.relations = e.relations.filter((r) => r.type !== "in" && r.type !== "worn_by" && r.type !== "equipped");
  e.fields.place = place;
}

/** A use grant: `who` may use `id`. */
function grant(s: WorldState, who: string, id: string, basis: "hold" | "loan" | "assign", until?: number): void {
  s.entities[who]!.relations.push({ type: "uses", to: id, ...(until !== undefined ? { until } : {}), fields: { basis } });
}

function linesFor(w: Working, slot: string, scope: FeedScope = "player"): FeedLine[] {
  return reg.renderers.filter((r) => r.slot === slot && !r.hint).flatMap((r) => linesOf(r, w.ctx, scope));
}

const texts = (w: Working, slot: string, scope: FeedScope = "player"): string[] => linesFor(w, slot, scope).map((l) => l.text);

describe("the Gear section", () => {
  test("On you: worn, in a pocket, and what a thing is in", () => {
    const out = texts(portAlder(), "gear");
    expect(out).toContain("On you: Wristwatch (worn): A cheap analog watch with a stretched band. Reliable.");
    expect(out).toContain("On you: Phone (in your pocket): A midrange phone with a cracked corner and too many unread group chats.");
    expect(out).toContain("On you: Debit card (in Wallet): Lakeshore Credit Union debit card.");
  });

  test("Holding for Danny with the story's why, and Taken from Marcus", () => {
    let clock = 0;
    const out = texts(
      portAlder((s) => {
        clock = s.clock;
        s.entities.danny_jacket = thing("Denim jacket", { owner: DANNY, got: { how: "holding", from: DANNY, at: s.clock, why: "while he changes a tire" } }, [{ type: "in", to: POV }]);
        s.entities.marcus_ledger = thing("Shop ledger", { owner: MARCUS, got: { how: "took", from: MARCUS, at: s.clock } }, [{ type: "in", to: "pov_wallet" }], "item");
      }),
      "gear",
    );
    expect(clock).toBeGreaterThan(0);
    expect(out).toContain("Holding for Danny Okafor: Denim jacket (while he changes a tire).");
    expect(out).toContain("Taken from Marcus Delgado: Shop ledger (in Wallet).");
    expect(out.some((l) => l.startsWith("On you: Denim jacket") || l.startsWith("On you: Shop ledger"))).toBe(false);
  });

  test("Borrowed from Marcus: until when, overdue, assigned, and where it is when not on you", () => {
    let until = 0;
    const w = portAlder((s) => {
      until = s.clock + 1440;
      s.entities.jack = thing("Floor jack", { owner: MARCUS }, [{ type: "in", to: POV }]);
      grant(s, POV, "jack", "loan", until);
      s.entities.creeper = thing("Mechanic's creeper", { owner: MARCUS }, [{ type: "in", to: POV }]);
      grant(s, POV, "creeper", "loan", s.clock - 60);
      s.entities.lift = thing("Shop lift remote", { owner: MARCUS, place: "alder_automotive" });
      grant(s, POV, "lift", "assign");
    });
    const out = texts(w, "gear");
    expect(out).toContain(`Borrowed from Marcus Delgado: Floor jack (until ${formatClock(calendarOf(w.world), until)}).`);
    expect(out).toContain("Borrowed from Marcus Delgado: Mechanic's creeper (overdue: it should go back).");
    expect(out).toContain("Borrowed from Marcus Delgado: Shop lift remote (yours to use; at Alder Automotive).");
  });

  test("Lent out to Danny until when, overdue, and With Danny for one he holds for you", () => {
    let until = 0;
    const w = portAlder((s) => {
      until = s.clock + 1440;
      moveInto(s, "pov_toolbox", DANNY);
      grant(s, DANNY, "pov_toolbox", "loan", until);
      moveInto(s, "pov_pocketknife", DANNY);
      grant(s, DANNY, "pov_pocketknife", "loan", s.clock - 60);
      moveInto(s, "pov_watch", DANNY);
      grant(s, DANNY, "pov_watch", "hold");
    });
    const out = texts(w, "gear");
    expect(out).toContain(`Lent out: Mechanic's toolbox (45 of its 45 pieces; to Danny Okafor until ${formatClock(calendarOf(w.world), until)}): A red 20-inch steel toolbox, dented in two places and organized to the millimeter.`);
    expect(out).toContain("Lent out: Pocketknife (to Danny Okafor; overdue: it should have come back by now): A folding knife from your grandfather.");
    expect(out).toContain("With Danny Okafor: Wristwatch (holding it for you): A cheap analog watch with a stretched band. Reliable.");
  });

  test("Not with you: what goes about with you and isn't here, with where, as many as the world allows", () => {
    const away = (s: WorldState): void => {
      moveTo(s, "pov_keys", "alder_automotive");
      moveTo(s, "pov_phone", "alder_automotive");
      moveTo(s, "pov_watch", "alder_automotive");
      moveInto(s, "pov_pocketknife", DANNY);
    };
    const notWith = (w: Working): string[] => texts(w, "gear").filter((l) => l.startsWith("Not with you:"));
    expect(notWith(portAlder(away))).toEqual([
      "Not with you: Keys (at Alder Automotive): Truck, apartment, shop back door and a bottle opener.",
      "Not with you: Phone (at Alder Automotive): A midrange phone with a cracked corner and too many unread group chats.",
      "Not with you: Pocketknife (you don't know where): A folding knife from your grandfather.",
    ]);
    const cap = (n: number) => (world: WorldDoc) => {
      world.packs.gear!.config = { ...world.packs.gear!.config, notWithYou: n };
    };
    expect(notWith(portAlder(away, cap(1)))).toHaveLength(1);
    expect(notWith(portAlder(away, cap(0)))).toEqual([]);
    expect(notWith(portAlder(away, cap(5)))).toHaveLength(4);
    // The toolbox rests at the shop: away from Jordan, it is never "not with you".
    expect(notWith(portAlder(away, cap(5))).some((l) => l.includes("toolbox"))).toBe(false);
  });

  test("at Gear 1 only things in play are on you or not with you; what changed hands always shows", () => {
    const w = portAlder(
      (s) => {
        s.entities.pov_phone!.fields.notable = true;
        s.entities.danny_jacket = thing("Denim jacket", { owner: DANNY }, [{ type: "in", to: POV }]);
        moveTo(s, "pov_keys", "alder_automotive");
        s.entities.pov_keys!.fields.notable = true;
        moveTo(s, "pov_watch", "alder_automotive");
      },
      (world) => {
        world.realism.levels.gear = 1;
      },
    );
    const out = texts(w, "gear");
    const named = (lead: string): string[] => out.filter((l) => l.startsWith(lead)).map((l) => l.slice(lead.length).split(/[(:]/)[0]!.trim());
    // At Gear 1 a line has no worn-or-pocket words.
    expect(named("On you:")).toEqual(["Phone"]);
    expect(out.some((l) => l.startsWith("Holding for Danny Okafor: Denim jacket"))).toBe(true);
    expect(named("Not with you:")).toEqual(["Keys"]);
  });

  test("the GM scope adds what is on you without your knowing", () => {
    const w = portAlder(undefined, (world) => {
      world.entities.tracker = { id: "tracker", kind: "item", name: "GPS tracker", tier: "background", visibility: "secret", fields: { owner: MARCUS }, relations: [{ type: "in", to: "pov_wallet" }] };
    });
    expect(texts(w, "gear").some((l) => l.includes("GPS tracker"))).toBe(false);
    expect(linesFor(w, "gear", "gm").filter((l) => l.text.includes("GPS tracker"))).toEqual([{ text: "On you without your knowing: GPS tracker.", known: "gm" }]);
  });
});

describe("the Place section", () => {
  const furnish = (world: WorldDoc): void => {
    const put = (id: string, name: string, fields: JsonObject, relations: RelationInstance[] = [], kind = "item"): void => {
      world.entities[id] = { id, kind, name, tier: "background", fields, relations };
    };
    put("couch", "Couch", { owner: POV, size: "furniture", place: HOME });
    put("armchair", "Armchair", { owner: POV, size: "furniture", place: HOME });
    put("bookshelf", "Bookshelf", { owner: "helen_kowalczyk", size: "builtin", place: HOME });
    put("bench", "Workbench", { owner: POV, size: "furniture", place: HOME, description: "A scarred oak bench." });
    put("mug", "Coffee mug", { owner: DANNY, place: HOME });
    put("fridge", "Fridge", { owner: POV, size: "builtin", place: HOME, capacity_l: 300 }, [], "container");
    put("milk", "Milk", { owner: POV }, [{ type: "in", to: "fridge" }]);
    put("beer", "Beer", { owner: DANNY, qty: 6 }, [{ type: "in", to: "fridge" }]);
    put("cooler", "Cooler", { owner: "dale_whitcomb", place: HOME, capacity_l: 30 }, [], "container");
    put("bait", "Bait", { owner: "dale_whitcomb" }, [{ type: "in", to: "cooler" }]);
  };
  const place = (patch: (world: WorldDoc) => void = () => undefined): Working =>
    portAlder(undefined, (world) => {
      furnish(world);
      patch(world);
    });

  test("furnishings that are only a name go together by whose they are; a described one has its own line", () => {
    const out = texts(place(), "place");
    expect(out).toContain("In the room: Armchair, Couch, Fridge (yours); Bookshelf (Helen Kowalczyk's).");
    expect(out).toContain("In the room: Workbench (yours): A scarred oak bench.");
  });

  test("everything else lying loose is Lying here, with whose it is", () => {
    const out = texts(place(), "place");
    expect(out).toContain("Lying here: Coffee mug (Danny Okafor's).");
    expect(out.some((l) => l.startsWith("Lying here: Couch") || l.startsWith("Lying here: Fridge"))).toBe(false);
  });

  test("what is in a holder here the player character may use, whose only when it isn't the holder's; nothing of one he may not", () => {
    const out = texts(place(), "place");
    expect(out).toContain("In Fridge: Beer ×6 (Danny Okafor's), Milk.");
    expect(out.some((l) => l.startsWith("In Cooler:") || l.includes("Bait"))).toBe(false);
    // The holders' contents go last, so the section's caps cut them first.
    const fridge = out.indexOf("In Fridge: Beer ×6 (Danny Okafor's), Milk.");
    expect(out.every((l, i) => i <= fridge || !(l.startsWith("In the room:") || l.startsWith("Lying here:")))).toBe(true);
  });

  test("a secret thing in the fridge is told only in the GM scope, marked", () => {
    const w = place((world) => {
      world.entities.ring = { id: "ring", kind: "item", name: "Engagement ring", tier: "background", visibility: "secret", fields: { owner: DANNY }, relations: [{ type: "in", to: "fridge" }] };
    });
    expect(texts(w, "place").some((l) => l.includes("Engagement ring"))).toBe(false);
    expect(linesFor(w, "place", "gm").filter((l) => l.text.includes("Engagement ring"))).toEqual([{ text: "In Fridge: Engagement ring.", known: "gm" }]);
  });
});

describe("People: whose a carried thing is", () => {
  test("Danny carries Jordan's toolbox: told as yours; his own things say no whose", () => {
    const out = texts(
      portAlder((s) => {
        moveInto(s, "pov_toolbox", DANNY);
        grant(s, DANNY, "pov_toolbox", "hold");
        s.entities.danny_bag = thing("Gym bag", { owner: DANNY }, [{ type: "in", to: DANNY }]);
      }),
      "people",
    );
    expect(out).toContain("Danny Okafor carries Gym bag, Mechanic's toolbox (45 of its 45 pieces; yours).");
  });
});

describe("Play → Me → Gear", () => {
  test("On you, Holding for others, Yours elsewhere, Lent out and Borrowed, each with whose, why and where", () => {
    let until = 0;
    const w = portAlder((s) => {
      until = s.clock + 1440;
      s.entities.danny_jacket = thing("Denim jacket", { owner: DANNY, got: { how: "holding", from: DANNY, at: s.clock, why: "while he changes a tire" } }, [{ type: "in", to: "pov_wallet" }]);
      moveInto(s, "pov_watch", DANNY);
      grant(s, DANNY, "pov_watch", "hold");
      s.entities.jack = thing("Floor jack", { owner: MARCUS }, [{ type: "in", to: POV }]);
      grant(s, POV, "jack", "loan", until);
    });
    const view = buildGearView(w.ctx);
    expect(view.on.map((i) => i.id)).toEqual(["pov_keys", "pov_phone", "pov_pocketknife", "pov_wallet"]);
    expect(view.on.find((i) => i.id === "pov_wallet")?.children?.map((i) => i.id)).not.toContain("danny_jacket");
    // Whose it is by id too (GearItem.ownerId), for Owner & use: Danny, whom the player character knows.
    expect(view.holding).toEqual([{ id: "danny_jacket", name: "Denim jacket", ownerId: DANNY, whose: "Danny Okafor's", why: "Danny Okafor handed it to you to hold: while he changes a tire", where: "In Wallet" }]);
    // Jordan's ATV, boat and pickup are the Garage's, with the pickup's bed and glovebox: what he keeps in the glovebox is his elsewhere, with where it is.
    expect(view.elsewhere.map((i) => [i.id, i.where])).toEqual([
      ["pov_first_aid", "In Truck glovebox at 114 Harbor Street"],
      ["pov_flashlight", "In Truck glovebox at 114 Harbor Street"],
      ["pov_toolbox", "At Alder Automotive"],
    ]);
    expect(view.lent.map((i) => [i.id, i.lent, i.where, i.kept])).toEqual([["pov_watch", { to: "Danny Okafor", overdue: false, hold: true }, "With Danny Okafor", "On you"]]);
    expect(view.borrowed.map((i) => [i.id, i.whose, i.borrowed])).toEqual([["jack", "Marcus Delgado's", { from: "Marcus Delgado", until: formatClock(calendarOf(w.world), until), overdue: false }]]);
  });
});

describe("everyday carry (gear generator 2)", () => {
  const made = (w: Working, who: string): EntityState[] => Object.values(w.state.entities).filter((e) => e.fields.owner === who && typeof e.fields.catalog === "string" && e.relations.some((r) => r.type === "in" && r.to === who));

  test("Danny, lacking them, is made a wallet, keys and a phone: his, on him, not notable", () => {
    const w = portAlder();
    expect(made(w, DANNY)).toEqual([]);
    materializeAll(reg, w, DANNY, "walk");
    const his = made(w, DANNY);
    expect(his.map((e) => [e.name, e.fields.catalog]).sort()).toEqual([
      ["Key set", "keys_set"],
      ["Smartphone", "smartphone"],
      ["Wallet", "wallet"],
    ]);
    expect(his.every((e) => e.fields.notable === undefined)).toBe(true);
  });

  test("Marcus keeps his own key set: only a wallet and a phone are made; a thing named Wallet is a wallet", () => {
    const w = portAlder((s) => {
      s.entities.priya_wallet = thing("Wallet", { owner: "priya_nair" }, [{ type: "in", to: "priya_nair" }], "container");
    });
    materializeAll(reg, w, MARCUS, "walk");
    expect(made(w, MARCUS).map((e) => e.fields.catalog).sort()).toEqual(["keys_set", "smartphone", "wallet"]);
    expect(Object.values(w.state.entities).filter((e) => e.fields.owner === MARCUS && e.fields.catalog === "keys_set")).toHaveLength(1);
    materializeAll(reg, w, "priya_nair", "walk");
    expect(made(w, "priya_nair").map((e) => e.fields.catalog).sort()).toEqual(["keys_set", "smartphone"]);
  });

  test("at Gear 1 the made things don't show until the story touches them; at Gear 0 nothing is made", () => {
    const w = portAlder(
      (s) => {
        delete s.entities.pov_phone;
      },
      (world) => {
        world.realism.levels.gear = 1;
        delete world.entities.pov_phone;
      },
    );
    materializeAll(reg, w, POV, "walk");
    expect(made(w, POV).map((e) => e.fields.catalog)).toContain("smartphone");
    expect(buildGearView(w.ctx).on.some((i) => i.name === "Smartphone")).toBe(false);
    const off = portAlder(
      () => undefined,
      (world) => {
        world.realism.levels.gear = 0;
      },
    );
    materializeAll(reg, off, DANNY, "walk");
    expect(made(off, DANNY)).toEqual([]);
  });

  test("a world pinned to generator 1 makes only a wallet, as before", () => {
    const w = portAlder(
      () => undefined,
      (world) => {
        world.pins.generators.gear = 1;
      },
    );
    materializeAll(reg, w, DANNY, "walk");
    expect(made(w, DANNY).map((e) => [e.name, e.fields.catalog, e.fields.notable])).toEqual([["Wallet", "wallet", true]]);
  });

  test("the lint gear.carry names a type no catalog of the world has, only in the world's own rules", () => {
    const world = STARTER_WORLDS.modern_slice_of_life!("pa", "Port Alder");
    expect(carryProblems(world)).toEqual([]);
    world.packs.gear!.config = { carry: [{ who: { kind: ["person"] }, types: ["wallet", "hoverboard"] }] };
    expect(carryProblems(world).map((i) => [i.code, i.severity, i.path])).toEqual([["gear.carry", "warning", "packs.gear.config.carry.0.types"]]);
  });
});

describe("whose a thing is and where it is, in words", () => {
  test("whoseWords: yours, someone's by name, presumed told alike, your household's, nobody's", () => {
    const w = portAlder((s) => {
      s.entities.helen_pot = thing("Stock pot", { owner: "household_kowalczyk", place: HOME });
      s.entities.driftwood = thing("Driftwood", { place: "alder_harbor_marina" });
      s.entities.pebble = thing("Pebble", {});
    });
    expect(whoseWords(w.ctx, "pov_wallet")).toBe("yours");
    expect(whoseWords(w.ctx, "spare_relay")).toBe("Marcus Delgado's");
    expect(whoseWords(w.ctx, "helen_pot", "jess_kowalczyk")).toBe("your household's");
    // Nobody said whose the driftwood is: lying at Dale's marina, it is presumed his, and told as his.
    expect(whoseWords(w.ctx, "driftwood")).toBe("Dale Whitcomb's");
    expect(whoseWords(w.ctx, "pebble")).toBeNull();
  });

  test("whereWords: lost, with someone, in a holder at a place", () => {
    const w = portAlder((s) => {
      moveInto(s, "pov_pocketknife", DANNY);
      s.entities.pov_keys!.fields.lost = true;
    });
    expect(whereWords(w.ctx, "pov_keys")).toBe("lost");
    expect(whereWords(w.ctx, "pov_pocketknife")).toBe("with Danny Okafor");
    expect(whereWords(w.ctx, "pov_flashlight")).toBe("in Truck glovebox at 114 Harbor Street");
    expect(whereWords(w.ctx, "pov_wallet")).toBeNull();
  });
});
