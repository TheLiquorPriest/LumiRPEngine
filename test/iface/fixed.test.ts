// The four fixed tools on an invented world: each everyday operation applies and answers in full;
// what does not add up is applied and reported; only a name that is not there or input that cannot
// be read is refused; time passing lists what is due and changes nothing else; a write with no
// source comes back marked; and every sentence of every answer is a line of the answers' file.

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject, ToolResult } from "rp-harness/contract";
import { ENGINE_TOOLS, Lines, SHIPPED_GUIDANCE } from "../../src/iface/index";
import { splitFile } from "../../src/iface/texts";
import { readPart, renderView } from "../../src/store/words";
import { CHAT, dataOf, rig, texts } from "./rig";

const lines = Lines.parse(await Bun.file(join(SHIPPED_GUIDANCE, ".prompts", "engine-answers.md")).text(), "engine-answers");
const patterns = lines.patterns();
const treePart = readPart(await Bun.file(join(SHIPPED_GUIDANCE, ".prompts", "world-state.md")).text(), "world-state");

/** Every part of an answer is data (JSON or the store's tree) or a line of the answers' file, and every report a line. */
function wordsFromFiles(r: ToolResult, trees: readonly string[] = []): void {
  const kinds = (r.details as { parts?: string[] } | undefined)?.parts ?? [];
  texts(r).forEach((text, i) => {
    if (kinds[i] === "tree") return expect(trees.length === 0 || trees.includes(text)).toBe(true);
    let json = false;
    try {
      JSON.parse(text);
      json = true;
    } catch {
      json = false;
    }
    if (!json) expect(patterns.some((p) => p.test(text))).toBe(true);
  });
  for (const rep of r.reports ?? []) expect(patterns.some((p) => p.test(rep))).toBe(true);
}

function ops(r: ToolResult): JsonObject[] {
  return dataOf(r).operations as JsonObject[];
}

describe("world_apply", () => {
  test("each everyday operation applies and answers with what changed and how it stands", async () => {
    const t = await rig();
    const src = { from: "prose", message: "m-1" };
    const r = await t.call("world_apply", {
      operations: [
        { op: "move", who: "bram", to: "market_square", source: src },
        { op: "place", what: "bell", at: "common_room", source: src },
        { op: "give", what: "knife", from: "wren", to: "odile", how: "lent", source: src },
        { op: "wear", what: "cloak", who: "wren", off: true, source: src },
        { op: "store", what: "cloak", in: "satchel", source: src },
        { op: "pay", who: "wren", to: "bram", amount: 2, for: "a room", source: src },
        { op: "pass_time", minutes: 30, source: src },
        { op: "set", at: "bram", key: "mood", value: "wary", source: src },
        { op: "fact", about: "wren", key: "boots", value: "muddy to the knee", precision: "exact", source: src },
        { op: "quest", quest: "errand", stage: "done", outcome: "met", why: "delivered", source: src },
        { op: "relate", who: "bram", to: "wren", change: 5, source: src },
        { op: "spawn", name: "Gate guard", bestiary: "town_guard", at: "market_square", source: { from: "default" } },
        { op: "horizon", list: ["common_room", "market_square"], source: { from: "author" } },
      ],
    });
    expect(r.error).toBeUndefined();
    const done = ops(r);
    expect(done.map((o) => o.op)).toEqual(["move", "place", "give", "wear", "store", "pay", "pass_time", "set", "fact", "quest", "relate", "spawn", "horizon"]);
    expect(done.every((o) => o.applied === true)).toBe(true);
    expect(done.find((o) => o.op === "relate")?.lane).toBe("story");
    expect(done.find((o) => o.op === "horizon")?.lane).toBe("story");
    expect(done.find((o) => o.op === "move")?.lane).toBe("engine");
    const data = dataOf(r);
    const changed = data.changed as JsonObject[];
    expect(changed.some((c) => c.at === "entity:bram" && (c.now as JsonObject).place === "market_square")).toBe(true);
    expect(changed.some((c) => c.at === "world")).toBe(true);
    expect(changed.some((c) => c.at === "track:errand")).toBe(true);
    expect(changed.some((c) => c.at === "horizon")).toBe(true);
    expect((data.now as JsonObject[]).length).toBeGreaterThan(0);
    const stored = t.s.stateAt(t.turn.id).state;
    const state = stored.world;
    expect(state.entities.knife?.relations.some((x) => x.type === "in" && x.to === "odile")).toBe(true);
    expect(state.entities.bram?.fields.mood).toBe("wary");
    expect(stored.facts["entity:wren"]?.map((f) => [f.key, f.value, f.precision])).toEqual([["boots", "muddy to the knee", "exact"]]);
    expect(Object.values(state.entities).some((e) => e.name === "Gate guard" && e.fields.mood === "bored")).toBe(true);
    expect(r.marks ?? []).not.toContain("unsourced");
    wordsFromFiles(r);
    const rows = t.s.changes(t.turn.id);
    expect(rows.some((c) => c.lane === "story")).toBe(true);
    expect(rows.find((c) => c.op === "set" && c.source === "prose")?.cite).toEqual({ message: "m-1" });
  });

  test("a fact replaces the one it names, and one that names no standing fact is applied and reported", async () => {
    const t = await rig();
    const src = { from: "prose", message: "m-5" };
    const first = await t.call("world_apply", { operations: [{ op: "fact", about: "wren", key: "boots", value: "muddy to the knee", source: src }] });
    const written = (ops(first)[0]?.facts as JsonObject[])[0];
    expect(written?.value).toBe("muddy to the knee");
    const second = await t.call("world_apply", { operations: [{ op: "fact", about: "wren", key: "footwear", value: "barefoot now", replaces: written?.id as string, source: src }] });
    expect(second.error).toBeUndefined();
    expect((ops(second)[0]?.facts as JsonObject[]).map((f) => f.value)).toEqual(["barefoot now"]);
    expect(second.reports ?? []).toEqual([]);
    const third = await t.call("world_apply", { operations: [{ op: "fact", about: "wren", key: "hat", value: "a wide straw hat", replaces: "f-000000000000", source: src }] });
    expect(third.error).toBeUndefined();
    expect(ops(third)[0]?.applied).toBe(true);
    expect((third.reports ?? []).some((x) => x.includes("f-000000000000"))).toBe(true);
    expect(t.s.stateAt(t.turn.id).state.facts["entity:wren"]?.filter((f) => f.replacedBy === undefined).map((f) => f.key)).toEqual(["footwear", "hat"]);
    wordsFromFiles(third);
  });

  test("a payment of more than is held is applied and reported", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "pay", who: "wren", to: "bram", amount: 50, for: "the horse", source: { from: "prose", message: "m-2" } }] });
    expect(r.error).toBeUndefined();
    expect(ops(r)[0]?.applied).toBe(true);
    expect((r.reports ?? []).some((x) => x.includes("could pay at most"))).toBe(true);
    const balances = t.s.stateAt(t.turn.id).state.world.accounts;
    expect(Object.values(balances).some((b) => b < 0)).toBe(true);
    wordsFromFiles(r);
  });

  test("a thing given by someone who does not hold it is applied and reported", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "give", what: "bell", from: "bram", to: "wren", how: "given", source: { from: "prose", message: "m-3" } }] });
    expect(r.error).toBeUndefined();
    expect((r.reports ?? []).some((x) => x.includes("did not hold"))).toBe(true);
    expect(t.s.stateAt(t.turn.id).state.world.entities.bell?.relations.some((x) => x.type === "in" && x.to === "wren")).toBe(true);
    wordsFromFiles(r);
  });

  test("a name that is not there is refused with the near matches, and nothing is recorded", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "give", what: "kniff", to: "bram", how: "handed" }] });
    expect(r.error).toBe(true);
    expect(texts(r).some((x) => x.includes("kniff") && x.includes("Knife [knife]"))).toBe(true);
    expect(t.s.changes(t.turn.id)).toEqual([]);
    wordsFromFiles(r);
  });

  test("passing time lists what is due and changes nothing else", async () => {
    const t = await rig();
    const before = t.s.stateAt(t.turn.id).state.world;
    const r = await t.call("world_apply", { operations: [{ op: "pass_time", for: "two hours", at: "thornbury", source: { from: "prose", message: "m-4" } }] });
    expect(r.error).toBeUndefined();
    const op = ops(r)[0] as JsonObject;
    expect((op.due as JsonObject[])[0]?.kind).toBe("arrival");
    const after = t.s.stateAt(t.turn.id).state.world;
    expect(after.clock - before.clock).toBe(120);
    expect(after.entities).toEqual(before.entities);
    expect(after.accounts).toEqual(before.accounts);
    wordsFromFiles(r);
  });

  test("an operation that names no source is applied and marked unsourced", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "set", at: "bram", key: "mood", value: "cross" }] });
    expect(r.error).toBeUndefined();
    expect(r.marks).toContain("unsourced");
    expect(texts(r).some((x) => x.includes("names no source"))).toBe(true);
    expect(t.s.changes(t.turn.id)[0]?.source).toBeNull();
    wordsFromFiles(r);
  });

  test("an invention with no gap check or consent is applied and marked so", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "spawn", name: "Old Hessa", kind: "character", at: "market_square", source: { from: "invented" } }] });
    expect(r.error).toBeUndefined();
    expect(r.marks).toEqual(expect.arrayContaining(["invented", "no-gap-check", "no-consent"]));
    wordsFromFiles(r);
  });

  test("a lane the player set to Never leaves its operations out and says so", async () => {
    const t = await rig({ approvals: { permission: async (_s, lane) => (lane === "story" ? "never" : "auto"), ask: async () => ({ go: true }) } });
    const r = await t.call("world_apply", { operations: [{ op: "relate", who: "bram", to: "wren", change: 5 }, { op: "set", at: "bram", key: "mood", value: "calm" }] });
    const done = ops(r);
    expect(done.find((o) => o.op === "relate")?.applied).toBe(false);
    expect(done.find((o) => o.op === "set")?.applied).toBe(true);
    expect(texts(r).some((x) => x.includes("where the player allows no writes"))).toBe(true);
    wordsFromFiles(r);
  });

  test("a call refused for a later operation carries no report of an earlier one, and records nothing", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "pay", who: "wren", to: "bram", amount: 50, source: { from: "prose", message: "m-7" } }, { op: "move", who: "brom", to: "cellar" }] });
    expect(r.error).toBe(true);
    expect(r.reports).toBeUndefined();
    expect(texts(r).some((x) => x.includes("Bram [bram]"))).toBe(true);
    expect(t.s.changes(t.turn.id)).toEqual([]);
    wordsFromFiles(r);
  });

  test("a searchable write is asked about as its own call, and one the player declines is left out", async () => {
    const asked: JsonObject[] = [];
    const t = await rig({
      approvals: {
        permission: async () => "confirm",
        ask: async (_s, ask) => {
          asked.push(ask.args as JsonObject);
          return { go: false, reason: "not now" };
        },
      },
    });
    const args = { item: "knife", delta: -10, source: { from: "prose", message: "m-8" } };
    const r = await t.call("item_condition", args);
    expect(asked).toEqual([args]);
    expect(ops(r)[0]).toMatchObject({ op: "item_condition", lane: "engine", applied: false, held: "declined" });
    expect(texts(r).some((x) => x.includes("Their reason: not now"))).toBe(true);
    expect(t.s.changes(t.turn.id)).toEqual([]);
    wordsFromFiles(r);
  });
});

describe("world_query, world_search and roll", () => {
  test("world_query reads the tree at a point and depth, and what falls due there", async () => {
    const t = await rig();
    const r = await t.call("world_query", { at: "Thornbury", depth: 1, due: "six hours" });
    expect(r.error).toBeUndefined();
    const tree = renderView(t.s.view(CHAT).query("place:thornbury", 1) ?? { lines: [] }, treePart);
    expect(tree).toContain("Thornbury [thornbury] (place)");
    expect(texts(r)[0]).toBe(tree);
    expect((dataOf(r).due as JsonObject[])[0]?.where).toBe("place:thornbury");
    wordsFromFiles(r, [tree]);
    const ruleset = await t.call("world_query", { at: "ruleset" });
    expect(((dataOf(ruleset).ruleset as JsonObject).bestiary as JsonObject[]).map((b) => b.id)).toEqual(["town_guard", "wolf"]);
  });

  test("world_query refuses a point that is not there, with the near matches", async () => {
    const t = await rig();
    const r = await t.call("world_query", { at: "Thornbery" });
    expect(r.error).toBe(true);
    expect(texts(r)[0]).toContain("Thornbury [thornbury]");
    wordsFromFiles(r);
  });

  test("world_search finds things by words", async () => {
    const t = await rig();
    const r = await t.call("world_search", { words: "cider" });
    expect((dataOf(r).hits as JsonObject[])[0]?.ref).toBe("entity:cask");
    wordsFromFiles(r);
  });

  test("roll rolls once and records the roll with what it was for", async () => {
    const t = await rig();
    const r = await t.call("roll", { who: "wren", for: "the climb", dice: "1d20+2", against: 12 });
    const roll = dataOf(r).roll as JsonObject;
    expect(roll.for).toBe("the climb");
    expect(typeof roll.total).toBe("number");
    expect(["success", "failure"]).toContain(roll.outcome as string);
    const rows = t.s.changes(t.turn.id);
    expect(rows.length).toBe(1);
    expect(rows[0]?.op).toBe("engine.check");
    expect(String(rows[0]?.id)).toBe(roll.id as string);
    wordsFromFiles(r);
  });
});

describe("the tools' files", () => {
  // `.tools/` holds every lane's tool files (the story's, the cast's, the maps'): an engine tool's file
  // says its family in its header, and only the files of the engine's families are held to its tools.
  test("every engine tool has its file in its family, and every file of an engine family names an engine tool", async () => {
    const dir = join(SHIPPED_GUIDANCE, ".tools");
    const familyOf = new Map<string, unknown>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) familyOf.set(file.slice(0, -3), splitFile(await Bun.file(join(dir, file)).text(), file).header.family);
    expect(ENGINE_TOOLS.filter((t) => familyOf.get(t.name) !== t.family).map((t) => t.name)).toEqual([]);
    const families = new Set<unknown>(ENGINE_TOOLS.map((t) => t.family));
    const names = new Set(ENGINE_TOOLS.map((t) => t.name));
    expect([...familyOf].filter(([name, family]) => families.has(family) && !names.has(name)).map(([name]) => name)).toEqual([]);
  });
});
