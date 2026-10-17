// The Upgrade merge (DESIGN §4.3 `migrate`): the picks on the marker, and each merge rule, folded
// from the two revisions, the touched record and the owner's picks.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import type { UpgradePicks } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import { blankWorld, migrateWorld } from "../../src/engine/authoring";
import { calendarOf, slotIndexAt } from "../../src/engine/calendar";
import { readEngineSlice } from "../../src/engine/engine-pack";
import { applyMarker, EXTERNAL_ACCOUNT_PREFIX, validMarkerBody } from "../../src/engine/events";
import { isGone } from "../../src/engine/scope";
import { inClass, tagsOf } from "../../src/engine/selector";
import type { WorldState } from "../../src/engine/state";
import { touchedAspect, touchedField } from "../../src/engine/touched";
import { definitionsLag, planUpgrade, type MarkerEnv } from "../../src/engine/upgrade";
import { entityVisibility } from "../../src/engine/visibility";
import { initialState } from "../../src/engine/world-state";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { baseWorld, fold, POV } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

/** The base world with an account for Sam, a role facet, a guild and a public and a secret quest. */
function worldA(): WorldDoc {
  const w = baseWorld();
  w.entities.acct = { id: "acct", kind: "account", name: "Sam's checking", tier: "background", fields: { owner: POV, type: "checking", opening: 5000 }, relations: [] };
  w.entities.guild = { id: "guild", kind: "faction", name: "Harbor Guild", tier: "background", fields: {}, relations: [] };
  w.classifications = { role: { id: "role", label: "Role", multiple: false, values: { ally: { label: "Ally" }, foe: { label: "Foe" } } } };
  const stages = { start: { label: "Rumours", next: [] }, middle: { label: "The hunt", next: [] }, end: { label: "Caught", next: [] } };
  w.tracks = {
    hunt: { id: "hunt", kind: "quest", label: "The hunt", start: "start", stages, visibility: "public" },
    plot: { id: "plot", kind: "quest", label: "The plot", start: "start", stages, visibility: "secret" },
  };
  return w;
}

interface Chat {
  a: WorldDoc;
  b: WorldDoc;
  ra: string;
  rb: string;
  env: MarkerEnv;
  state: WorldState;
}

/** A chat started on revision `a`, which an Upgrade can take to revision `b`. */
function between(a: WorldDoc, b: WorldDoc): Chat {
  const ra = hashJson(a);
  const rb = hashJson(b);
  const docs = new Map([
    [ra, a],
    [rb, b],
  ]);
  return { a, b, ra, rb, env: { worlds: (r) => docs.get(r), types: reg }, state: initialState(a, ra, reg) };
}

/** A chat started on `worldA` (adjusted by `base`) and its later revision (`edit`). */
function chat(edit: (w: WorldDoc) => void, base: (w: WorldDoc) => void = () => undefined): Chat {
  const a = worldA();
  base(a);
  const b = structuredClone(a);
  edit(b);
  b.name = `${a.name}, revised`;
  return between(a, b);
}

/** The inn's ground floor as a grid map: a taproom, a kitchen behind a door and a back hall below. */
const INN_LAYOUT = ["############", "#ttttt#kkkk#", "#ttttt+kkkk#", "#ttttL#kkkk#", "##+#########", "#hhhhhhhhhh#", "#####+######"];

/** A revision of the inn, the POV in its taproom, with the grid system on unless `movement` is false; `edit` runs before its map compiles. */
function inn(edit: (w: WorldDoc) => void = () => undefined, movement = true): WorldDoc {
  const w = blankWorld("w_inn", "Inn");
  w.mapSettings = { display: "knowledge", grid: { movement, sightRadius: 3 } };
  w.places = { town: { id: "town", name: "Saltmarsh", fields: {} }, inn: { id: "inn", name: "The Gull", parent: "town", fields: {} } };
  w.maps = {
    inn_ground: {
      id: "inn_ground",
      scope: "inn",
      layout: INN_LAYOUT,
      legend: { t: { place: "taproom" }, k: { place: "kitchen" }, h: { place: "hall" }, L: "floor" },
      places: [
        { id: "taproom", name: "Taproom" },
        { id: "kitchen", name: "Kitchen" },
        { id: "hall", name: "Back hall" },
      ],
    },
  };
  w.start = { ...w.start, place: "taproom" };
  Object.assign(w.entities.you?.fields ?? {}, { place: "taproom" });
  edit(w);
  return migrateWorld(w);
}

function play(c: Chat, events: Parameters<typeof fold>[3]): void {
  c.state = fold(reg, c.a, c.state, events);
}

function upgrade(c: Chat, merge: UpgradePicks = {}): string[] {
  return applyMarker(c.state, { kind: "migrate", to: c.rb, merge }, c.env);
}

describe("an Upgrade without picks", () => {
  test("only switches the revision, as before, and notes where the definitions still come from", () => {
    const c = chat((b) => {
      const dev = b.entities.dev;
      if (dev) dev.fields.home = "home";
      b.entities.jo = { id: "jo", kind: "person", name: "Jo", tier: "background", fields: { place: "cafe" }, relations: [] };
    });
    const before = structuredClone(c.state);
    expect(applyMarker(c.state, { kind: "migrate", to: c.rb }, c.env)).toEqual([]);
    expect(c.state.revision).toBe(c.rb);
    expect(c.state.entities).toEqual(before.entities);
    expect(c.state.accounts).toEqual(before.accounts);
    expect(c.state.tracks).toEqual(before.tracks);
    expect(definitionsLag(c.state)).toBe(c.ra);
    // Back to the revision the definitions come from: nothing lags any more.
    applyMarker(c.state, { kind: "migrate", to: c.ra }, c.env);
    expect(definitionsLag(c.state)).toBeNull();
    expect(c.state).toEqual(before);
  });

  test("a later Upgrade with picks brings in everything since the definitions' revision", () => {
    const c = chat((b) => {
      const dev = b.entities.dev;
      if (dev) dev.fields.home = "home";
    });
    applyMarker(c.state, { kind: "migrate", to: c.rb }, c.env);
    const third = structuredClone(c.b);
    third.name = "third";
    const sam = third.entities[POV];
    if (sam) sam.fields.skill = 9;
    const rc = hashJson(third);
    const docs = new Map([
      [c.ra, c.a],
      [c.rb, c.b],
      [rc, third],
    ]);
    applyMarker(c.state, { kind: "migrate", to: rc, merge: {} }, { worlds: (r) => docs.get(r), types: reg });
    expect(c.state.revision).toBe(rc);
    expect(c.state.entities.dev?.fields.home).toBe("home");
    expect(c.state.entities[POV]?.fields.skill).toBe(9);
    expect(definitionsLag(c.state)).toBeNull();
  });
});

describe("the merge", () => {
  test("a changed field is taken when play never wrote it, kept when it did, and taken when picked", () => {
    const edit = (b: WorldDoc): void => {
      const dev = b.entities.dev;
      if (!dev) return;
      dev.fields.home = "home";
      dev.fields.skill = 4;
    };
    const base = (a: WorldDoc): void => {
      const dev = a.entities.dev;
      if (dev) dev.fields.skill = 1;
    };
    const kept = chat(edit, base);
    play(kept, [{ type: "add", entity: "dev", field: "skill", delta: 1 }]);
    const plan = planUpgrade(kept.state, kept.env, kept.rb).entities.find((d) => d.id === "dev");
    expect(plan?.fields.home).toEqual({ now: "cafe", next: "home", touched: false });
    expect(plan?.fields.skill).toEqual({ now: 2, next: 4, touched: true });
    upgrade(kept);
    expect(kept.state.entities.dev?.fields).toMatchObject({ home: "home", skill: 2 });
    expect(touchedField(kept.state, "dev", "skill")).toBe(true);

    const taken = chat(edit, base);
    play(taken, [{ type: "add", entity: "dev", field: "skill", delta: 1 }]);
    upgrade(taken, { dev: { fields: { skill: "take" } } });
    expect(taken.state.entities.dev?.fields).toMatchObject({ home: "home", skill: 4 });
    // The chat now holds the revision's value: the next Upgrade takes a change to it again.
    expect(touchedField(taken.state, "dev", "skill")).toBe(false);

    // A change that went back to where it was still counts as play's.
    const back = chat(edit, base);
    play(back, [
      { type: "add", entity: "dev", field: "skill", delta: 1 },
      { type: "add", entity: "dev", field: "skill", delta: -1 },
    ]);
    upgrade(back);
    expect(back.state.entities.dev?.fields.skill).toBe(1);
  });

  test("a field the revision drops goes, and a whole-entity pick decides the parts it doesn't pick", () => {
    const c = chat(
      (b) => {
        const dev = b.entities.dev;
        if (!dev) return;
        delete dev.fields.cash;
        dev.fields.home = "home";
        dev.fields.skill = 7;
      },
      (a) => {
        const dev = a.entities.dev;
        if (dev) dev.fields.skill = 1;
      },
    );
    upgrade(c, { dev: { entity: "keep", fields: { skill: "take" } } });
    expect(c.state.entities.dev?.fields).toMatchObject({ cash: 900, home: "cafe", skill: 7 });
    const d = chat((b) => {
      const dev = b.entities.dev;
      if (dev) delete dev.fields.cash;
    });
    upgrade(d);
    expect(d.state.entities.dev?.fields.cash).toBeUndefined();
  });

  test("a new entity arrives as a chat's first state holds it: kinship two-sided, an agent caught up", () => {
    const edit = (b: WorldDoc): void => {
      b.entities.kid = { id: "kid", kind: "person", name: "Kit", tier: "background", fields: { place: "cafe", home: "cafe" }, relations: [{ type: "child_of", to: "dev" }], agent: true };
    };
    const c = chat(edit);
    play(c, [{ type: "clock", minutes: 600, cause: "tick" }]);
    upgrade(c);
    expect(c.state.entities.kid).toMatchObject({ kind: "person", name: "Kit", tier: "background", agent: true, relations: [{ type: "child_of", to: "dev" }] });
    expect(c.state.entities.dev?.relations).toContainEqual({ type: "parent_of", to: "kid" });
    expect(readEngineSlice(c.state).agents.kid).toBe(slotIndexAt(calendarOf(c.b), c.state.clock));

    const left = chat(edit);
    upgrade(left, { kid: { entity: "keep" } });
    expect(left.state.entities.kid).toBeUndefined();
    expect(left.state.entities.dev?.relations).toEqual([]);
  });

  test("an entity gone from the revision stays, holding what it was read as; remove takes it out and unlinks it", () => {
    const base = (a: WorldDoc): void => {
      a.entities.jo = { id: "jo", kind: "person", name: "Jo", tier: "background", fields: { place: "cafe" }, relations: [], visibility: "secret", tags: ["smuggler"], class: { role: ["foe"] } };
      a.entities.ring = { id: "ring", kind: "person", name: "Ring", tier: "background", fields: {}, relations: [{ type: "in", to: "jo" }] };
      const sam = a.entities[POV];
      if (sam) sam.relations.push({ type: "knows", to: "jo" });
    };
    const edit = (b: WorldDoc): void => {
      delete b.entities.jo;
      const sam = b.entities[POV];
      if (sam) sam.relations = [];
      const ring = b.entities.ring;
      if (ring) ring.relations = [];
    };
    const kept = chat(edit, base);
    upgrade(kept);
    expect(kept.state.entities.jo?.fields.gone).toBeUndefined();
    expect(entityVisibility(kept.b, kept.state, "jo")).toBe("secret");
    expect(tagsOf(kept.b, kept.state, "jo")).toEqual(["smuggler"]);
    expect(inClass(kept.b, kept.state, "jo", "role", ["foe"])).toBe(true);
    // Their links to it go with its pick, not with the revision's.
    expect(kept.state.entities[POV]?.relations).toContainEqual({ type: "knows", to: "jo" });

    const removed = chat(edit, base);
    upgrade(removed, { jo: { entity: "remove" } });
    expect(isGone(removed.state, "jo")).toBe(true);
    expect(removed.state.entities[POV]?.relations.some((r) => r.to === "jo")).toBe(false);
    // What is inside it stays inside and goes with it.
    expect(removed.state.entities.ring?.relations).toContainEqual({ type: "in", to: "jo" });
    expect(isGone(removed.state, "ring")).toBe(true);
  });

  test("kind, name, tier, agent, levels and classes follow the same rule", () => {
    const edit = (b: WorldDoc): void => {
      const dev = b.entities.dev;
      if (!dev) return;
      dev.name = "Devon";
      dev.tier = "supporting";
      dev.agent = false;
      dev.levels = { money: 2 };
      dev.class = { role: ["ally"] };
    };
    const base = (a: WorldDoc): void => {
      const dev = a.entities.dev;
      if (dev) dev.class = { role: ["foe"] };
    };
    const c = chat(edit, base);
    play(c, [{ type: "engine.entity", data: { entity: "dev", tier: "background" } }]);
    upgrade(c, { dev: { class: "keep" } });
    expect(c.state.entities.dev).toMatchObject({ name: "Devon", tier: "background", agent: false, levels: { money: 2 } });
    // Keeping the chat's classes means holding them: the world now reads the revision's.
    expect(inClass(c.b, c.state, "dev", "role", ["foe"])).toBe(true);
    expect(inClass(c.b, c.state, "dev", "role", ["ally"])).toBe(false);

    const taken = chat(edit, base);
    play(taken, [{ type: "engine.entity", data: { entity: "dev", tier: "background" } }]);
    upgrade(taken, { dev: { tier: "take" } });
    expect(taken.state.entities.dev?.tier).toBe("supporting");
    expect(touchedAspect(taken.state, "dev", "tier")).toBe(false);
    expect(inClass(taken.b, taken.state, "dev", "role", ["ally"])).toBe(true);
  });

  test("relations: authored additions and removals come in, and both sides of a pair change together or neither does", () => {
    const base = (a: WorldDoc): void => {
      const sam = a.entities[POV];
      if (sam) sam.relations.push({ type: "sibling_of", to: "dev" });
    };
    const edit = (b: WorldDoc): void => {
      const sam = b.entities[POV];
      if (sam) sam.relations = [{ type: "member_of", to: "guild" }];
    };
    const c = chat(edit, base);
    expect(c.state.entities.dev?.relations).toContainEqual({ type: "sibling_of", to: POV });
    upgrade(c);
    expect(c.state.entities[POV]?.relations).toEqual([{ type: "member_of", to: "guild" }]);
    expect(c.state.entities.dev?.relations.some((r) => r.type === "sibling_of")).toBe(false);

    // Play wrote Dev's side: the pair stays whole on both sides.
    const touched = chat(edit, base);
    play(touched, [{ type: "link", rel: "sibling_of", from: "dev", to: POV, fields: { close: true } }]);
    upgrade(touched);
    expect(touched.state.entities[POV]?.relations).toContainEqual({ type: "sibling_of", to: "dev" });
    expect(touched.state.entities[POV]?.relations).toContainEqual({ type: "member_of", to: "guild" });
    expect(touched.state.entities.dev?.relations.some((r) => r.type === "sibling_of")).toBe(true);
    // Picked for both sides, it goes.
    const picked = chat(edit, base);
    play(picked, [{ type: "link", rel: "sibling_of", from: "dev", to: POV, fields: { close: true } }]);
    upgrade(picked, { [POV]: { relations: { sibling_of: { dev: "take" } } }, dev: { relations: { sibling_of: { [POV]: "take" } } } });
    expect(picked.state.entities.dev?.relations.some((r) => r.type === "sibling_of")).toBe(false);
    expect(picked.state.entities[POV]?.relations.some((r) => r.type === "sibling_of")).toBe(false);
  });

  test("an open account's new opening balance posts the difference against its holder's outside account", () => {
    const edit = (b: WorldDoc): void => {
      const acct = b.entities.acct;
      if (acct) acct.fields.opening = 8000;
    };
    const opened = (c: Chat): void =>
      play(c, [{ type: "materialize", entity: POV, domain: "money", generatorVersion: 1, tablesRevision: "t", events: [{ type: "post", lines: [{ account: "acct", amount: 5000 }, { account: `${EXTERNAL_ACCOUNT_PREFIX}${POV}`, amount: -5000 }], memo: "Opening balances" }] }]);
    const c = chat(edit);
    opened(c);
    upgrade(c);
    expect(c.state.entities.acct?.fields.opening).toBe(8000);
    expect(c.state.accounts.acct).toBe(8000);
    expect(c.state.accounts[`${EXTERNAL_ACCOUNT_PREFIX}${POV}`]).toBe(-8000);
    expect(touchedAspect(c.state, "acct", "posted")).toBe(false);

    // A balance that moved in play keeps its opening unless picked; picked, the difference posts on top.
    const spent = (x: Chat): void => play(x, [{ type: "post", lines: [{ account: "acct", amount: -1000 }, { account: `${EXTERNAL_ACCOUNT_PREFIX}shop`, amount: 1000 }], memo: "Rent" }]);
    const kept = chat(edit);
    opened(kept);
    spent(kept);
    upgrade(kept);
    expect(kept.state.entities.acct?.fields.opening).toBe(5000);
    expect(kept.state.accounts.acct).toBe(4000);
    const taken = chat(edit);
    opened(taken);
    spent(taken);
    upgrade(taken, { acct: { fields: { opening: "take" } } });
    expect(taken.state.accounts.acct).toBe(7000);

    // Not open yet: the field changes, and the opening posts the new amount when it opens.
    const unopened = chat(edit);
    upgrade(unopened);
    expect(unopened.state.entities.acct?.fields.opening).toBe(8000);
    expect(unopened.state.accounts.acct).toBeUndefined();
    expect(Object.values(c.state.accounts).reduce((sum, v) => sum + v, 0)).toBe(0);
  });

  test("a track at a stage the revision dropped goes back to its start, with a Journal note only a public track gets", () => {
    const c = chat((b) => {
      for (const t of Object.values(b.tracks)) delete t.stages.middle;
    });
    play(c, [
      { type: "stage", track: "hunt", to: "middle" },
      { type: "stage", track: "plot", to: "middle" },
    ]);
    const notes = upgrade(c);
    expect(c.state.tracks.hunt?.stage).toBe("start");
    expect(c.state.tracks.plot?.stage).toBe("start");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("The hunt");
    expect(notes.join(" ")).not.toContain("plot");
  });
});

describe("the merge on a grid", () => {
  const standing = (x: number, y: number) => (w: WorldDoc) => void Object.assign(w.entities.you?.fields ?? {}, { x, y });

  test("a cell the POV stepped to in play is kept; one play never moved follows the revision", () => {
    const moved = between(inn(standing(1, 1)), inn(standing(2, 2)));
    // A step in play, as the `space.step` effect writes it.
    play(moved, [{ type: "space.pos", data: { entity: "you", at: { scope: "inn", x: 4, y: 3 }, from: { scope: "inn", x: 1, y: 1 } } }]);
    expect(planUpgrade(moved.state, moved.env, moved.rb).entities.find((d) => d.id === "you")?.fields.x?.touched).toBe(true);
    upgrade(moved);
    expect(moved.state.entities.you?.fields).toMatchObject({ x: 4, y: 3 });
    const still = between(inn(standing(1, 1)), inn(standing(2, 2)));
    upgrade(still);
    expect(still.state.entities.you?.fields).toMatchObject({ x: 2, y: 2 });
  });

  test("a thing a new revision's map lays in a cell arrives lying there, as in a new chat", () => {
    const lantern = (w: WorldDoc): void => {
      w.entities.lantern = { id: "lantern", kind: "item", name: "Lantern", tier: "background", fields: {}, relations: [] };
      const map = w.maps.inn_ground;
      if (map) map.legend = { ...map.legend, L: { item: "lantern" } };
    };
    const c = between(inn(), inn(lantern));
    upgrade(c);
    expect(c.state.entities.lantern?.fields).toMatchObject({ place: "taproom", x: 5, y: 3 });
    expect(c.state.entities.lantern?.fields).toEqual(initialState(c.b, c.rb, reg).entities.lantern?.fields);
  });
});

describe("Upgrade picks on the marker", () => {
  test("are checked: one malformed pick makes the marker invalid, and an entity with none is dropped", () => {
    expect(validMarkerBody({ kind: "migrate", to: "r1", merge: { dev: { fields: { home: "maybe" } } } })).toBeNull();
    expect(validMarkerBody({ kind: "migrate", to: "r1", merge: { dev: { colour: "take" } } })).toBeNull();
    expect(validMarkerBody({ kind: "migrate", to: "r1", merge: JSON.parse('{"__proto__": {"name": "take"}}') })).toBeNull();
    expect(validMarkerBody({ kind: "migrate", to: "r1", merge: { dev: { entity: "remove", relations: { knows: { sam: "keep" } } }, jo: {} } })).toEqual({ kind: "migrate", to: "r1", merge: { dev: { entity: "remove", relations: { knows: { sam: "keep" } } } } });
    expect(validMarkerBody({ kind: "migrate", to: "r1" })).toEqual({ kind: "migrate", to: "r1" });
  });
});
