// The world state (plan §6.9): compiled from memory at a turn's start, the tree opened at the
// horizon in the layout's eight sections, every line a recorded value worded by the layout. The
// horizon is never cut; the rest shares the budget, and on a world of 5,000 things the outline
// gives what does not fit as a line with the query that opens it.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import { factStore } from "../../src/store/facts";
import { openStore } from "../../src/store/store";
import type { ChangeInput } from "../../src/store/types";
import { renderView } from "../../src/store/words";
import { WORLD_STATE_DEFAULTS, worldState, type DueSource, type MapText } from "../../src/store/world-state";
import { engine, hashOf, pay, play, POV, registry, SHIPPED_LAYOUT, SHIPPED_PART, testStore, USER } from "./fixtures";
import { bigWorld } from "./measure";

const HEADINGS = ["### At hand", "### Above it", "### Around it", "### The rest of the world, in outline", "### Due", "### Open business here", "### Changed last turn", "### Unsettled"];

/** The grid lane's map, as a test gives it: a map for the common room only. */
const MAP: MapText = { text: ({ place }) => (place === "common_room" ? "+---+\n|W.B|\n+---+" : null) };
/** What time brings due, as a test gives it: the market opening in the span asked for. */
const DUE: DueSource = { due: (_state, span) => [{ at: span.from + 90, kind: "schedule", where: "place:market_square", who: ["tam"], what: "the market opens" }] };

function played() {
  const ts = testStore();
  const { s } = ts;
  s.createChat({ id: "c", revision: ts.revision });
  const first: ChangeInput[] = [
    { lane: "story", op: "store.horizon", value: { list: ["common_room", "tam"] }, by: "author", source: "author" },
    { lane: "story", op: "store.note", value: { at: "lamp_ladle", text: "busier than usual" }, by: "author", source: "author" },
    { lane: "engine", ...factStore.change({ about: `entity:${POV}`, key: "mood", value: "on edge" }), by: "gm", source: "prose", precision: "vague" },
    ...engine(pay("acct_wren", 75, "A round for the room")).map((c) => ({ ...c, precision: "approximate" as const })),
    ...engine({ type: "set", entity: "nobody", field: "mood", value: "glad" }),
  ];
  play(s, "c", "m1", "Wren buys the room a round.", 1, first);
  const t2 = s.beginTurn({ chat: "c", kind: "normal" });
  return { ...ts, t2 };
}

describe("the world state", () => {
  test("holds all eight sections, laid out by the layout, each line a recorded value", () => {
    const { s, t2 } = played();
    const block = worldState(s, { chat: "c", turn: t2.id, layout: SHIPPED_LAYOUT, map: MAP, due: DUE });
    const at = HEADINGS.map((h) => block.text.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const lines = block.text.split("\n");
    // The horizon in full: the scene's place with its map after its own values, everyone in it with what they carry; and Tam, elsewhere.
    expect(lines).toContain("The Common Room [common_room] (place) — 2 people (Bram, Wren), 4 things, 1 record, 1 open, changed turn 1");
    const map = lines.indexOf("  +---+");
    expect(lines.slice(map, map + 3)).toEqual(["  +---+", "  |W.B|", "  +---+"]);
    expect(lines.indexOf("  · weather: rain (weather)")).toBeLessThan(map);
    expect(lines).toContain("    · mood: \"on edge\" (vague, turn 1) [" + (s.stateAt(t2.id).state.facts[`entity:${POV}`]?.[0]?.id ?? "") + "]");
    expect(lines.some((l) => l.startsWith("Tam [tam] (Character)"))).toBe(true);
    // The chain above, each by its own values and its reflection; around it, the room beside it.
    const above = block.sections.above?.map((l) => l.fields.ref);
    expect(above?.filter((r) => typeof r === "string" && !r.startsWith("entity:") && r !== undefined)).toEqual(["place:lamp_ladle", "place:thornbury", "place:vale", "world"]);
    expect(lines).toContain("The Lamp and Ladle [lamp_ladle] (place) — 3 people (Bram, Wren, Odile), 5 things, 2 places, 1 record, 1 open, changed turn 1, note: busier than usual");
    expect(block.sections.around?.map((l) => l.fields.ref)).toEqual(["place:cellar"]);
    // Due, open business, what changed by lane, and what is soft.
    expect(lines).toContain("Sat 1 Mar 2031, 9:30 AM: schedule at Market Square, Tam (the market opens)");
    expect(lines).toContain("The sealed letter [errand] (quest): Asked, Wren's");
    expect(lines).toContain("story: 2 changes (store.horizon, store.note), to The Lamp and Ladle");
    expect(lines).toContain("engine: 3 changes (store.fact, post, set), to Wren, Wren's coin; 1 did not apply");
    expect(lines.some((l) => /^Wren: mood: "on edge" \(vague, turn 1\) \[f-[0-9a-f]{12}\]$/.test(l))).toBe(true);
    expect(lines.some((l) => /^Wren's coin: posted: -\$0\.75 \(approximate, turn 1\)$/.test(l))).toBe(true);
    expect(lines).toContain("set, turn 1, not applied: missing_entity");
    // The outline: a line for each level in the world, the horizon's place among them.
    expect(lines).toContain("Groups [groups] (groups) — 1 group");
    expect(block.tokens).toBeLessThanOrEqual(WORLD_STATE_DEFAULTS.budget);
  });

  test("a section switched off is absent, a moved one moves, and with no map or due list to hand the layout says so", () => {
    const { s, t2 } = played();
    const off = SHIPPED_LAYOUT.replace(/\{\{#due\}\}[\s\S]*?\{\{\/due\}\}\n/, "");
    const block = worldState(s, { chat: "c", turn: t2.id, layout: off, map: MAP, due: DUE });
    expect(block.text).not.toContain("### Due");
    expect(block.sections.due).toBeUndefined();
    expect(block.text).not.toContain("the market opens");
    for (const h of HEADINGS.filter((x) => x !== "### Due")) expect(block.text).toContain(h);
    const moved = SHIPPED_LAYOUT.replace(/(\{\{#unsettled\}\}[\s\S]*?\{\{\/unsettled\}\}\n)/, "").replace("{{#horizon}}", "{{#unsettled}}\n### Unsettled\n\n{{unsettled}}\n{{/unsettled}}\n{{#horizon}}");
    expect(worldState(s, { chat: "c", turn: t2.id, layout: moved }).text.startsWith("### Unsettled")).toBe(true);
    const bare = worldState(s, { chat: "c", turn: t2.id, layout: SHIPPED_LAYOUT }).text.split("\n");
    expect(bare).toContain("  No map is drawn here: this world state has no maps to hand.");
    expect(bare).toContain("What falls due is not listed here.");
  });

  test("a chat with no world compiles one from its first turn", () => {
    const ts = testStore();
    ts.s.createChat({ id: "c" });
    const t = ts.s.beginTurn({ chat: "c", kind: "normal" });
    const block = worldState(ts.s, { chat: "c", turn: t.id, layout: SHIPPED_LAYOUT });
    expect(block.text).toContain("### The rest of the world, in outline");
    // With no horizon, the outline opens on the world's own line, which says nothing is recorded yet.
    expect(block.sections.outline?.map((l) => l.kind)).toEqual(["level_world"]);
    expect(block.text).toContain("[world] (world) — nothing is recorded in it yet");
    expect(block.text).toContain("What falls due is not listed here.");
  });

  test("on a world of 5,000 things it fits the budget with the horizon whole, in a few milliseconds", () => {
    const world = bigWorld();
    const revision = hashJson(world);
    const store = openStore({ db: ":memory:", registry: registry(), worlds: (r) => (r === revision ? world : undefined) });
    const s = store.user(USER);
    s.createChat({ id: "c", revision });
    const room = String(world.entities[POV]?.fields.place);
    const t1 = s.beginTurn({ chat: "c", kind: "normal" });
    s.addChanges(t1.id, [{ lane: "story", op: "store.horizon", value: { list: [room, "group_3"] }, by: "author", source: "author" }]);
    s.tieTurn(t1.id, { message: "m1", hash: hashOf("Wren looks around."), date: 1 });
    const t2 = s.beginTurn({ chat: "c", kind: "normal" });
    const entities = Object.keys(world.entities).length;
    expect(entities).toBeGreaterThanOrEqual(5000);
    const compile = () => worldState(s, { chat: "c", turn: t2.id, layout: SHIPPED_PART, map: MAP, due: DUE });
    // The first compile at a turn also builds the tree over its state; later ones reuse it.
    const cold = performance.now();
    const block = compile();
    const first = performance.now() - cold;
    // The horizon whole: the room and the group, every line of each as a full query gives it.
    const view = s.viewAt(t2.id);
    const whole = [view.query(room, "full"), view.query("group_3", "full")].flatMap((q) => q?.lines ?? []);
    expect(block.sections.horizon?.filter((l) => l.kind !== "map" && l.kind !== "map_unavailable")).toEqual(whole);
    expect(renderView(whole, SHIPPED_PART).split("\n").length).toBeGreaterThan(50);
    // Everything else within the budget; a line for every level of the world; what did not fit opened by a query.
    expect(block.tokens).toBeLessThanOrEqual(WORLD_STATE_DEFAULTS.budget);
    expect(block.tokens).toBeGreaterThan(WORLD_STATE_DEFAULTS.budget / 2);
    const outline = block.sections.outline ?? [];
    for (const ref of view.childrenOf("world")) expect(outline.some((l) => l.fields.ref === ref)).toBe(true);
    expect(outline.some((l) => l.fields.opens === true)).toBe(true);
    expect(block.text).toContain("[opened by world_query at place:");
    const runs: number[] = [];
    for (let i = 0; i < 9; i++) {
      const t0 = performance.now();
      compile();
      runs.push(performance.now() - t0);
    }
    const median = [...runs].sort((a, b) => a - b)[4] ?? Number.NaN;
    console.log(`world state on ${entities} entities: first ${first.toFixed(2)} ms (the tree built), then median ${median.toFixed(2)} ms over 9 runs; ${block.tokens} tokens besides the horizon, ${block.text.length} characters in all`);
    expect(median).toBeLessThan(100);
    store.close();
  });
});
