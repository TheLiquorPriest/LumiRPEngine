// Import from lore / Build-Refine proposals: validation against kinds, field types and references, deterministic dedupe, Refine merges.

import { describe, expect, test } from "bun:test";
import type { JsonValue } from "../../src/shared/json";
import { isRecord } from "../../src/shared/json";
import type { JobProposal } from "../../src/shared/jobs";
import { blankWorld } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { checkProposals as check, readProposals as read, type DropCounts, type ImportSources, type ProposalMode } from "../../src/build/jobs/checks";
import type { Registry } from "../../src/engine/registry-impl";
import type { WorldDoc } from "../../src/shared/world";

const registry = createRegistry(ALL_PACKS);
const world = (() => {
  const w = blankWorld("w_p", "Proposals");
  w.entities.rosie = { id: "rosie", kind: "person", name: "Rosie", tier: "principal", fields: {}, relations: [] };
  return w;
})();

function p(collection: JobProposal["collection"], key: string, value: Record<string, unknown>, confidence = 0.8): JobProposal {
  return { id: `${collection}:${key}:${confidence}`, collection, key, value: JSON.parse(JSON.stringify(value)), source: "test", confidence };
}

/** The checks as they were called before Build's jobs kept a limit of their own: no limit that matters here. */
const checkProposals = (w: WorldDoc, reg: Registry, raw: readonly JobProposal[], mode: ProposalMode, sources?: ImportSources, drops?: DropCounts): JobProposal[] => check(w, reg, raw, mode, 1000, sources, drops);
/** A reply's proposals as the job reads them: the list a `world_propose` call gives. */
const readProposals = (reply: { proposals: JsonValue[] }, source: string): JobProposal[] => read(reply.proposals, source);

describe("Import and Refine proposals", () => {
  test("kinds, field types and references are checked; packs are named", () => {
    const out = checkProposals(
      world,
      registry,
      [
        p("entities", "truck", { kind: "vehicle", name: "Old Truck", tier: "background", fields: { fuel_pct: 40, status: "rusty", class: "pickup", wings: 2, home: "nowhere" } }),
        p("entities", "ghost", { kind: "spirit", name: "Ghost" }),
        p("entities", "you", { kind: "person", name: "Me" }),
        p("places", "Diner Lot", { name: "Diner lot", parent: "home" }),
        p("routes", "lot_home", { from: "diner_lot", to: "home", modes: { road: { minutes: 6.4 } } }),
        p("routes", "bad", { from: "mars", to: "home", modes: { walk: { minutes: 5 } } }),
      ],
      "import",
    );
    const truck = out.find((x) => x.key === "truck");
    expect(truck?.pack).toBe("vehicles");
    expect(isRecord(truck?.value) && truck.value.fields).toEqual({ fuel_pct: 40, class: "pickup" });
    expect(truck?.note).toContain("dropped field status");
    expect(out.map((x) => x.key).sort()).toEqual(["diner_lot", "lot_home", "truck"]);
    const route = out.find((x) => x.key === "lot_home");
    expect(isRecord(route?.value) && route.value.modes).toEqual({ road: { minutes: 6 } });
  });

  test("dedupe: same key keeps the most confident; same kind and name is dropped; import skips existing ids", () => {
    const out = checkProposals(
      world,
      registry,
      [
        p("entities", "dev", { kind: "person", name: "Dev" }, 0.4),
        p("entities", "dev", { kind: "person", name: "Dev Patel" }, 0.9),
        p("entities", "rosie2", { kind: "person", name: "rosie" }),
        p("entities", "rosie", { kind: "person", name: "Rosie", fields: {} }),
      ],
      "import",
    );
    expect(out.map((x) => [x.key, isRecord(x.value) ? x.value.name : null])).toEqual([["dev", "Dev Patel"]]);
  });

  test("Refine merges a change onto the existing entity", () => {
    const w = structuredClone(world);
    w.entities.rosie = { id: "rosie", kind: "person", name: "Rosie", tier: "principal", fields: { activity: "cooking" }, relations: [], agent: true };
    const [change] = checkProposals(w, registry, readProposals({ proposals: [{ collection: "entities", key: "rosie", value: { kind: "person", name: "Rosie Vale" }, confidence: 0.9 }] }, "refine"), "refine");
    expect(isRecord(change?.value) && change.value.name).toBe("Rosie Vale");
    expect(isRecord(change?.value) && change.value.agent).toBe(true);
    expect(isRecord(change?.value) && change.value.tier).toBe("principal");
  });

  test("a proposal naming a prototype key as its collection is skipped; the reply's valid proposals stand", () => {
    const read = readProposals({ proposals: [{ collection: "constructor", key: "x", value: { name: "X" } }, { collection: "__proto__", key: "y", value: { name: "Y" } }, { collection: "places", key: "diner", value: { name: "Diner" } }] }, "refine");
    expect(read.map((p) => `${p.collection}:${p.key}`)).toEqual(["places:diner"]);
    expect(checkProposals(blankWorld("w_keys", "Keys"), registry, read, "refine").map((p) => p.key)).toEqual(["diner"]);
  });

  test("Import fills a table-backed field from the best-matching row and marks it assumed (DESIGN §9.7)", () => {
    const w = blankWorld("w_t", "Tables");
    w.kinds.trinket = { id: "trinket", label: "Trinket", extends: "item", fields: { catalog: { type: "text", table: "economy.catalog" } } };
    w.tables["economy.catalog"] = { id: "economy.catalog", pack: "economy", schema: "lre-table/economy.catalog/v1", revision: "r", label: "Catalog", columns: {}, rows: { brass_lantern: { name: "Brass lantern", price_cents: 2400 }, rope: { name: "Rope, 50 ft", price_cents: 1500 } } };
    const out = checkProposals(w, registry, [p("entities", "lamp", { kind: "trinket", name: "Old lantern" }), p("entities", "coil", { kind: "trinket", name: "Coil", fields: { catalog: "rope" } }), p("entities", "gem", { kind: "trinket", name: "Gem" })], "import");
    const byKey = new Map(out.map((x) => [x.key, isRecord(x.value) ? x.value : {}]));
    expect(isRecord(byKey.get("lamp")?.fields) ? byKey.get("lamp")?.fields : null).toEqual({ catalog: "brass_lantern" });
    expect(byKey.get("lamp")?.assumed).toEqual(["catalog"]);
    // A stated row id is the lore's, not an assumption; no shared word, no fill.
    expect(byKey.get("coil")?.assumed).toBeUndefined();
    expect(byKey.get("gem")?.fields).toEqual({});
  });

  test("a proposal with no kind takes the world's one base kind, marked assumed; otherwise it is dropped", () => {
    const drops: DropCounts = new Map();
    const raw = [p("entities", "biscuit", { name: "Biscuit" }), p("entities", "okafor", { kind: "none", name: "Mrs Okafor" }), p("entities", "ferry", { kind: null, name: "Island Ferry" }), p("entities", "skiff", { kind: "", name: "Skiff", fields: { owner: "rosie", home: "x" } }), p("entities", "ghost", { kind: "spirit", name: "Ghost" })];
    const out = checkProposals(world, registry, raw, "import", undefined, drops);
    // `thing` is the root the people, items, vehicles and businesses build on; accounts and regions build on nothing and nothing builds on them.
    expect(out.map((x) => [x.key, isRecord(x.value) ? x.value.kind : null])).toEqual([
      ["biscuit", "thing"],
      ["okafor", "thing"],
      ["ferry", "thing"],
      ["skiff", "thing"],
    ]);
    const skiff = out.find((x) => x.key === "skiff");
    expect(isRecord(skiff?.value) && skiff.value.assumed).toEqual(["kind"]);
    expect(isRecord(skiff?.value) && skiff.value.fields).toEqual({ owner: "rosie" });
    expect(skiff?.note).toContain("assumed kind: thing");
    expect(skiff?.pack).toBe("space");
    // A second base kind makes none obvious: the kind-less proposal is dropped, and no kind is invented.
    const two = structuredClone(world);
    two.kinds.spell = { id: "spell", label: "Spell", fields: {} };
    two.kinds.fire_spell = { id: "fire_spell", label: "Fire spell", extends: "spell", fields: {} };
    const twoDrops: DropCounts = new Map();
    expect(checkProposals(two, registry, [p("entities", "biscuit", { name: "Biscuit" })], "import", undefined, twoDrops)).toEqual([]);
    expect([...twoDrops.keys()]).toHaveLength(1);
  });

  test("a Refine change that leaves out the kind keeps the entity's kind; a new entity in the same reply still takes the base kind", () => {
    const w = structuredClone(world);
    w.entities.pickles = { id: "pickles", kind: "thing", name: "Pickles", tier: "background", fields: {}, relations: [], assumed: ["kind"] };
    const out = checkProposals(
      w,
      registry,
      readProposals(
        {
          proposals: [
            { collection: "entities", key: "rosie", value: { name: "Rosie Vale" }, confidence: 0.9 },
            { collection: "entities", key: "pickles", value: { kind: "none", name: "Pickles the cat" }, confidence: 0.9 },
            { collection: "entities", key: "biscuit", value: { name: "Biscuit" }, confidence: 0.8 },
          ],
        },
        "refine",
      ),
      "refine",
    );
    const byKey = new Map(out.map((x) => [x.key, x]));
    const rosie = byKey.get("rosie");
    expect(isRecord(rosie?.value) && [rosie.value.kind, rosie.value.name, rosie.value.tier, rosie.value.assumed ?? null]).toEqual(["person", "Rosie Vale", "principal", null]);
    expect(rosie?.note).toBeUndefined();
    // The kind didn't change, so its earlier assumption stays marked.
    const pickles = byKey.get("pickles")?.value;
    expect(isRecord(pickles) && [pickles.kind, pickles.name, pickles.assumed]).toEqual(["thing", "Pickles the cat", ["kind"]]);
    const biscuit = byKey.get("biscuit")?.value;
    expect(isRecord(biscuit) && [biscuit.kind, biscuit.assumed]).toEqual(["thing", ["kind"]]);
  });

  test("a kind, parent or table named by a prototype key is unknown", () => {
    const drops: DropCounts = new Map();
    const keys = ["constructor", "__proto__", "toString", "hasOwnProperty"];
    const raw = keys.map((kind, i) => p("entities", `k${i}`, { kind, name: `Odd ${i}` }));
    expect(checkProposals(world, registry, raw, "import", undefined, drops)).toEqual([]);
    // A world kind extending "constructor" is a root of its own, so `thing` stays the one base kind;
    // its field backed by a "constructor" table has no table to fill from.
    const w = structuredClone(world);
    w.kinds.odd = { id: "odd", label: "Odd", extends: "constructor", fields: { label: { type: "text", table: "constructor" } } };
    const out = checkProposals(w, registry, [p("entities", "odd_one", { kind: "odd", name: "Odd one" }), p("entities", "plain", { name: "Plain" })], "import");
    expect(out.map((x) => [x.key, isRecord(x.value) ? x.value.kind : null, isRecord(x.value) ? (x.value.assumed ?? null) : null])).toEqual([
      ["odd_one", "odd", null],
      ["plain", "thing", ["kind"]],
    ]);
  });
});
