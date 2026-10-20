// Import from lore / Build-Refine proposals: per-pack catalog, validation against kinds, field
// types and references, deterministic dedupe, Refine merges; and the import job end to end on the
// fake host (lore book → helper → proposals → accepted puts → committed revision).

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import type { JobProposal } from "../../src/shared/protocol";
import { blankWorld } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { checkProposals, dropSummary, IMPORT_MAX_CALLS, kindCatalog, PROPOSAL_MAX_TOKENS, proposalSystem, readProposals, type DropCounts } from "../../src/backend/proposals";
import { JobRunner } from "../../src/backend/jobs";
import { Rig } from "../support/rig";

const registry = createRegistry(ALL_PACKS);
const world = (() => {
  const w = blankWorld("w_p", "Proposals");
  w.entities.rosie = { id: "rosie", kind: "person", name: "Rosie", tier: "principal", fields: {}, relations: [] };
  return w;
})();

function p(collection: JobProposal["collection"], key: string, value: Record<string, unknown>, confidence = 0.8): JobProposal {
  return { id: `${collection}:${key}:${confidence}`, collection, key, value: JSON.parse(JSON.stringify(value)), source: "test", confidence };
}

const lore = (comment: string, content: string) => ({ comment, content, keys: [comment.toLowerCase()], disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {} });

/** Starts a job on the rig's fake host and returns its final update. */
async function finished(rig: Rig, kind: "import_lore" | "refine", worldId: string, input: Record<string, unknown>) {
  const jobId = rig.body(await rig.send({ type: "lre.job", op: "start", kind, worldId, input: JSON.parse(JSON.stringify(input)) })).jobId;
  await rig.host.settle();
  const done = rig.host.sent.find((m) => m.type === "lre.job.update" && m.jobId === jobId && m.status === "done");
  if (done?.type !== "lre.job.update") throw new Error("the job didn't finish");
  return { message: done.message, proposals: done.result && "proposals" in done.result ? done.result.proposals : [] };
}

describe("Import and Refine proposals", () => {
  test("a job that keeps nothing says why", () => {
    const drops: DropCounts = new Map();
    const raw = [p("entities", "ghost", { kind: "spirit", name: "Ghost" }), p("entities", "wisp", { kind: "spirit", name: "Wisp" }), p("routes", "nowhere", { from: "a", to: "b", modes: { walk: { minutes: 5 } } })];
    const kept = checkProposals(world, registry, raw, "import", undefined, drops);
    expect(kept).toEqual([]);
    expect(dropSummary(raw.length, kept.length, drops)).toBe("3 of 3 proposal(s) dropped: 2 used a kind this world doesn't have (spirit); 1 joined places that don't exist.");
    expect(dropSummary(0, 0, new Map())).toContain("proposed nothing");
  });

  test("the prompt lists every pack's kinds and the strict rules", () => {
    const catalog = kindCatalog(world, registry);
    expect(catalog).toContain("[vehicles] vehicle (a container)");
    expect(catalog).toContain("fuel_pct:number");
    expect(proposalSystem("import", world, registry)).toContain("Never invent numbers");
  });

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

  test("Import from lore end to end: book → helper → reviewed proposals → draft → revision", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const book = await rig.host.books.create("Town lore", "", rig.host.userId);
    const entry = await rig.host.books.createEntry(book, { comment: "The diner", content: "Rosie's Diner sits on Main Street, a short walk from home.", keys: ["diner"], disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {} }, rig.host.userId);
    // The model cites the entry by the source id in its heading.
    rig.host.quietReply = (req) => {
      const cited = /\(source: ([^)]+)\)/.exec(req.messages.map((m) => m.content).join("\n"))?.[1] ?? "";
      return JSON.stringify({ proposals: [{ collection: "places", key: "rosies_diner", value: { name: "Rosie's Diner" }, confidence: 0.9, source: cited }, { collection: "routes", key: "home_diner", value: { from: "home", to: "rosies_diner", modes: { walk: { minutes: 5 } } }, confidence: 0.6 }] });
    };
    const jobId = rig.body(await rig.send({ type: "lre.job", op: "start", kind: "import_lore", worldId, input: { bookIds: [book] } })).jobId;
    await rig.host.settle();
    const done = rig.host.sent.find((m) => m.type === "lre.job.update" && m.jobId === jobId && m.status === "done");
    if (done?.type !== "lre.job.update" || !done.result || !("proposals" in done.result)) throw new Error("no proposals");
    expect(done.result.proposals.map((x) => x.key)).toEqual(["rosies_diner", "home_diner"]);
    // Back-linked to its entry (DESIGN §9.7), which stays as it was.
    const diner = done.result.proposals[0]?.value;
    expect(isRecord(diner) ? diner.sources : null).toEqual([`${book}/${entry}`]);
    // Show value names the cited entry by its title; the review adds the book's name.
    expect(done.result.proposals[0]?.sourceNames).toEqual({ [`${book}/${entry}`]: "The diner" });
    expect(done.result.proposals[1]?.sourceNames).toBeUndefined();
    // The review accepts both and writes them to the draft (as the UI's proposalWrites does).
    for (const x of done.result.proposals) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: x.collection, id: x.key, value: x.value }));
    const committed = rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const head = rig.body(await rig.send({ type: "lre.world", op: "get", worldId }));
    expect(head.revision).toBe(committed.revision);
    expect(isRecord(head.world) && isRecord(head.world.places) && "rosies_diner" in head.world.places).toBe(true);
  });

  test("an Import/Refine model call ends at its own deadline and the job still finishes", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const deadline = new AbortController();
    const jobs = new JobRunner(rig.host, rig.rt.worlds, rig.rt.steps, rig.rt.settings, rig.rt.registry, () => deadline.signal);
    let calls = 0;
    // A model that never answers: only the call's signal ends it.
    rig.host.models.quiet = (_request, _userId, signal) => {
      calls++;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("deadline")), { once: true }));
    };
    const jobId = await jobs.start("refine", worldId, { instructions: "Add a diner." }, rig.host.userId);
    for (let i = 0; i < 1000 && calls === 0; i++) await Promise.resolve();
    expect(calls).toBe(1);
    deadline.abort();
    await jobs.idle();
    // A call that ran out of time is not asked again: the retry lives inside the call's deadline.
    expect(calls).toBe(1);
    expect(rig.host.sent.some((m) => m.type === "lre.job.update" && m.jobId === jobId && m.status === "done")).toBe(true);
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

  test("an empty or non-JSON reply is asked once more with the shape; the retry's proposals stand, and the call is metered", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const book = await rig.host.books.create("Harbor lore", "", rig.host.userId);
    await rig.host.books.createEntry(book, lore("Lighthouse", "The old lighthouse stands dark on the breakwater."), rig.host.userId);
    const good = JSON.stringify({ proposals: [{ collection: "places", key: "old_lighthouse", value: { name: "The Old Lighthouse" }, confidence: 0.8 }] });
    // Empty first: no repair call, then the reminder.
    let replies = ["", good];
    rig.host.quietReply = () => replies.shift() ?? "";
    const empty = await finished(rig, "import_lore", worldId, { bookIds: [book] });
    expect(empty.proposals.map((x) => x.key)).toEqual(["old_lighthouse"]);
    expect(empty.message).toBeUndefined();
    expect(rig.host.quietCalls.length).toBe(2);
    const retry = rig.host.quietCalls[1]?.messages.map((m) => m.content).join("\n") ?? "";
    expect(retry).toContain("Reply with JSON only, in this shape");
    expect(retry).toContain("(source: ");
    expect(rig.rt.steps.meter.log.filter((c) => c.purpose === "brief").length).toBe(2);
    // Prose that doesn't parse, and a repair that doesn't either: the retry is the third call.
    rig.host.quietCalls.length = 0;
    replies = ["Sure! The lighthouse is a place.", "Still prose.", good];
    const prose = await finished(rig, "import_lore", worldId, { bookIds: [book] });
    expect(prose.proposals.map((x) => x.key)).toEqual(["old_lighthouse"]);
    expect(rig.host.quietCalls.length).toBe(3);
    // Valid JSON in another shape is a bad reply too.
    rig.host.quietCalls.length = 0;
    replies = [JSON.stringify({ places: [{ id: "old_lighthouse" }] }), good];
    expect((await finished(rig, "import_lore", worldId, { bookIds: [book] })).proposals.length).toBe(1);
  });

  test("Import's first reply with nothing usable for lore with text (an empty list, or no readable proposal) is asked once more; each call is in the diagnostics", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const book = await rig.host.books.create("Harbor lore", "", rig.host.userId);
    await rig.host.books.createEntry(book, lore("Lighthouse", "The old lighthouse stands dark on the breakwater."), rig.host.userId);
    const good = JSON.stringify({ proposals: [{ collection: "places", key: "old_lighthouse", value: { name: "The Old Lighthouse" }, confidence: 0.8 }] });
    for (const first of [JSON.stringify({ proposals: [] }), JSON.stringify({ proposals: [{ type: "place", name: "The Old Lighthouse" }] })]) {
      const replies = [first, good];
      rig.host.quietReply = () => replies.shift() ?? "";
      rig.host.quietCalls.length = 0;
      const out = await finished(rig, "import_lore", worldId, { bookIds: [book] });
      expect(out.proposals.map((x) => x.key)).toEqual(["old_lighthouse"]);
      expect(rig.host.quietCalls.length).toBe(2);
      expect(rig.host.quietCalls[1]?.messages.map((m) => m.content).join("\n")).toContain("Each entry above describes something");
    }
    const lines = (rig.host.userLogs.get(rig.host.userId) ?? []).filter((l) => l.includes("import chunk"));
    expect(lines.map((l) => l.replace(/ in \d+ ms$/, ""))).toEqual([
      "info: [LumiRPEngine] import chunk 1 of 1 call: an empty list for lore with text",
      "info: [LumiRPEngine] import chunk 1 of 1 retry: 1 proposal(s)",
      "info: [LumiRPEngine] import chunk 1 of 1 call: none of its 1 proposal(s) readable",
      "info: [LumiRPEngine] import chunk 1 of 1 retry: 1 proposal(s)",
    ]);
  });

  test("Import and Refine calls have room for a full answer, and a reply cut off at the limit is logged", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const book = await rig.host.books.create("Harbor lore", "", rig.host.userId);
    await rig.host.books.createEntry(book, lore("Lighthouse", "The old lighthouse stands dark on the breakwater."), rig.host.userId);
    const asked: number[] = [];
    rig.host.models.quiet = async (request) => {
      asked.push(request.maxTokens);
      return { content: '{"proposals":[{"collection":"places","key":"old_li', finishReason: "length", tokens: request.maxTokens };
    };
    await finished(rig, "import_lore", worldId, { bookIds: [book] });
    await finished(rig, "refine", worldId, { instructions: "Add a lighthouse keeper." });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((n) => n >= PROPOSAL_MAX_TOKENS)).toBe(true);
    expect((rig.host.userLogs.get(rig.host.userId) ?? []).some((l) => l.startsWith(`warn: [LumiRPEngine] brief helper reply was cut off at ${PROPOSAL_MAX_TOKENS} tokens`))).toBe(true);
  });

  test("a retry that fails too keeps the reason; retries only spend calls no chunk needs", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const book = await rig.host.books.create("Big lore", "", rig.host.userId);
    await rig.host.books.createEntry(book, lore("Lighthouse", "The old lighthouse stands dark."), rig.host.userId);
    rig.host.quietReply = () => "";
    const one = await finished(rig, "import_lore", worldId, { bookIds: [book] });
    expect(one.message).toBe("The helper proposed nothing (or its reply wasn't valid JSON).");
    expect(rig.host.quietCalls.length).toBe(2);
    // 72 entries take all 12 calls, so nothing is left for a retry.
    for (let i = 1; i < 72; i++) await rig.host.books.createEntry(book, lore(`Entry ${i}`, `Text ${i}.`), rig.host.userId);
    rig.host.quietCalls.length = 0;
    await finished(rig, "import_lore", worldId, { bookIds: [book] });
    expect(rig.host.quietCalls.length).toBe(IMPORT_MAX_CALLS);
  });

  test("Refine shares the retry", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const replies = ["", JSON.stringify({ proposals: [{ collection: "places", key: "bait_shop", value: { name: "Bait Shop" }, confidence: 0.8 }] })];
    rig.host.quietReply = () => replies.shift() ?? "";
    const out = await finished(rig, "refine", worldId, { instructions: "Add a bait shop." });
    expect(out.proposals.map((x) => x.key)).toEqual(["bait_shop"]);
    expect(rig.host.quietCalls.length).toBe(2);
    // For Refine an empty list is an answer: nothing fits the request.
    rig.host.quietCalls.length = 0;
    rig.host.quietReply = () => JSON.stringify({ proposals: [] });
    expect((await finished(rig, "refine", worldId, { instructions: "Add nothing." })).proposals).toEqual([]);
    expect(rig.host.quietCalls.length).toBe(1);
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
    expect(dropSummary(raw.length, out.length, drops)).toBe("1 of 5 proposal(s) dropped: 1 used a kind this world doesn't have (spirit).");
    // A second base kind makes none obvious: the kind-less proposal is dropped, and no kind is invented.
    const two = structuredClone(world);
    two.kinds.spell = { id: "spell", label: "Spell", fields: {} };
    two.kinds.fire_spell = { id: "fire_spell", label: "Fire spell", extends: "spell", fields: {} };
    const twoDrops: DropCounts = new Map();
    expect(checkProposals(two, registry, [p("entities", "biscuit", { name: "Biscuit" })], "import", undefined, twoDrops)).toEqual([]);
    expect([...twoDrops.keys()]).toEqual(["used a kind this world doesn't have (none)"]);
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
    expect(dropSummary(raw.length, 0, drops)).toBe("4 of 4 proposal(s) dropped: 1 used a kind this world doesn't have (constructor); 1 used a kind this world doesn't have (__proto__); 1 used a kind this world doesn't have (toString); 1 used a kind this world doesn't have (hasOwnProperty).");
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
