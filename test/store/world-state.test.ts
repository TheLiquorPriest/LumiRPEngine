// The world state (plan §6.9): compiled from memory at a turn's start, the tree opened at the
// horizon in the layout's eight sections, every line a recorded value worded by the layout. The
// horizon is never cut; the rest shares the budget, and on a world of 5,000 things the outline
// gives what does not fit as a line with the query that opens it.

import { describe, expect, test } from "bun:test";
import { calendarOf, formatClock } from "../../src/engine/calendar";
import { hashJson } from "../../src/shared/hash";
import { timeDue } from "../../src/store/due";
import { factStore } from "../../src/store/facts";
import { openStore } from "../../src/store/store";
import { STORY_STORE_AREA } from "../../src/story";
import type { ChangeInput } from "../../src/store/types";
import { renderView, wordLine, type ViewLine } from "../../src/store/words";
import { WORLD_STATE_DEFAULTS, worldState, type DueSource, type MapText } from "../../src/store/world-state";
import { engine, hand, hashOf, inventedWorld, make, pay, play, POV, registry, shown, SHIPPED_LAYOUT, SHIPPED_PART, testStore, tick, USER } from "./fixtures";
import { bigWorld } from "./measure";

const HEADINGS = ["### At hand", "### Above it", "### Around it", "### The rest of the world, in outline", "### Due", "### Open business here", "### Changed last turn", "### Unsettled"];

/** The grid lane's map, as a test gives it: a map for the common room only. */
const MAP: MapText = { text: ({ place }) => (place === "common_room" ? { grid: "grid_inn", drawn: "d1", text: "+---+\n|W.B|\n+---+" } : null) };
/** What time brings due, as a test gives it: the market opening in the span asked for, for the whole world (a level's reflection asks of its own and finds none). */
const DUE: DueSource = { due: (_state, span, at) => (at === null ? { items: [{ at: span.from + 90, kind: "schedule", where: "place:market_square", who: ["tam"], what: "the market opens" }], more: 0 } : { items: [], more: 0 }) };

function played() {
  const ts = testStore();
  const { s } = ts;
  s.createChat({ id: "c", revision: ts.revision });
  const first: ChangeInput[] = [
    { lane: "story", op: "story.horizon", value: { list: ["common_room", "tam"] }, by: "author", source: "author" },
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
    const block = worldState(s, { chat: "c", turn: t2.id, layout: SHIPPED_LAYOUT, map: MAP, due: DUE, charsPerToken: 4 });
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
    // Tam, on the horizon too, brings his own chain: only the market is not shared with the scene's.
    expect(above?.filter((r) => typeof r === "string" && !r.startsWith("entity:") && r !== undefined)).toEqual(["place:lamp_ladle", "place:thornbury", "place:vale", "world", "place:market_square"]);
    expect(lines).toContain("The Lamp and Ladle [lamp_ladle] (place) — 3 people (Bram, Wren, Odile), 5 things, 2 places, 1 record, 1 open, changed turn 1, note: busier than usual");
    expect(block.sections.around?.map((l) => l.fields.ref)).toEqual(["place:cellar"]);
    // Due, open business, what changed by lane, and what is soft.
    expect(lines).toContain("Sat 1 Mar 2031, 9:30 AM: schedule at Market Square, Tam (the market opens)");
    expect(lines).toContain("The sealed letter [errand] (quest): Asked, Wren's");
    expect(lines.some((l) => l.startsWith("story: 2 changes (story.horizon, store.note), to The Lamp and Ladle"))).toBe(true);
    expect(lines.some((l) => l.startsWith("engine: 3 changes (store.fact, post, set), to Wren, Wren's coin"))).toBe(true);
    expect(lines.some((l) => /^Wren: mood: "on edge" \(vague, turn 1\) \[f-[0-9a-f]{12}\]$/.test(l))).toBe(true);
    expect(lines.some((l) => /^Wren's coin: posted: -\$0\.75 \(approximate, turn 1\)$/.test(l))).toBe(true);
    expect(lines.some((l) => /^set, turn 1, .*not applied: missing_entity/.test(l))).toBe(true);
    // The outline: a line for each level in the world, the horizon's place among them.
    expect(lines).toContain("Groups [groups] (groups) — 1 group");
    expect(block.tokens).toBeLessThanOrEqual(WORLD_STATE_DEFAULTS.budget);
  });

  test("a horizon entry that names nothing in the world is shown in the Author's own words, in its place, once", () => {
    const ts = testStore();
    const { s } = ts;
    s.createChat({ id: "c", revision: ts.revision });
    const storm = "the storm coming in off the sea";
    play(s, "c", "m1", "Wren looks to the door.", 1, [{ lane: "story", op: "story.horizon", value: { list: [storm, "common_room", storm] }, by: "author", source: "author" }]);
    const t2 = s.beginTurn({ chat: "c", kind: "normal" });
    const block = worldState(s, { chat: "c", turn: t2.id, layout: SHIPPED_LAYOUT, map: MAP, charsPerToken: 4 });
    const lines = block.text.split("\n");
    const words = `${storm} (on the horizon in your own words: nothing in the world is called that)`;
    expect(lines.filter((l) => l === words)).toHaveLength(1);
    // The scene's place opens the horizon; the words keep their place among the Author's entries after it.
    expect(lines.indexOf(words)).toBeGreaterThan(lines.findIndex((l) => l.startsWith("The Common Room [common_room] (place)")));
    expect(block.sections.horizon?.find((l) => l.kind === "horizon_words")).toEqual({ kind: "horizon_words", depth: 0, fields: { text: storm } });
  });

  test("a section switched off is absent, a moved one moves, and with no map or due list to hand there is nothing of either", () => {
    const { s, t2 } = played();
    const off = SHIPPED_LAYOUT.replace(/\{\{#due\}\}[\s\S]*?\{\{\/due\}\}\n/, "");
    const block = worldState(s, { chat: "c", turn: t2.id, layout: off, map: MAP, due: DUE, charsPerToken: 4 });
    expect(block.text).not.toContain("### Due");
    expect(block.sections.due).toBeUndefined();
    expect(block.text).not.toContain("the market opens");
    for (const h of HEADINGS.filter((x) => x !== "### Due")) expect(block.text).toContain(h);
    const moved = SHIPPED_LAYOUT.replace(/(\{\{#unsettled\}\}[\s\S]*?\{\{\/unsettled\}\}\n)/, "").replace("{{#horizon}}", "{{#unsettled}}\n### Unsettled\n\n{{unsettled}}\n{{/unsettled}}\n{{#horizon}}");
    expect(worldState(s, { chat: "c", turn: t2.id, layout: moved, charsPerToken: 4 }).text.startsWith("### Unsettled")).toBe(true);
    const bare = worldState(s, { chat: "c", turn: t2.id, layout: SHIPPED_LAYOUT, charsPerToken: 4 }).text;
    // With no source of what falls due or of maps, there is neither section nor line to say so.
    expect(bare).not.toContain("### Due");
    expect(bare).not.toContain("No map is drawn here");
  });

  test("a chat with no world compiles one from its first turn", () => {
    const ts = testStore();
    ts.s.createChat({ id: "c" });
    const t = ts.s.beginTurn({ chat: "c", kind: "normal" });
    const block = worldState(ts.s, { chat: "c", turn: t.id, layout: SHIPPED_LAYOUT, charsPerToken: 4 });
    expect(block.text).toContain("### The rest of the world, in outline");
    // With no horizon, the outline opens on the world's own line, which says nothing is recorded yet.
    expect(block.sections.outline?.map((l) => l.kind)).toEqual(["realism", "level_world"]);
    expect(block.text).toContain("[world] (world) — nothing is recorded in it yet");
    expect(block.sections.due).toBeUndefined();
  });

  test("on a world of 5,000 things it fits the budget with the horizon whole, in a few milliseconds", () => {
    const world = bigWorld();
    const revision = hashJson(world);
    const store = openStore({ db: ":memory:", registry: registry(), worlds: (r) => (r === revision ? world : undefined), areas: [STORY_STORE_AREA] });
    const s = store.user(USER);
    s.createChat({ id: "c", revision });
    const room = String(world.entities[POV]?.fields.place);
    const t1 = s.beginTurn({ chat: "c", kind: "normal" });
    s.addChanges(t1.id, [{ lane: "story", op: "story.horizon", value: { list: [room, "group_3"] }, by: "author", source: "author" }]);
    s.tieTurn(t1.id, { message: "m1", hash: hashOf("Wren looks around."), date: 1 });
    const t2 = s.beginTurn({ chat: "c", kind: "normal" });
    const entities = Object.keys(world.entities).length;
    expect(entities).toBeGreaterThanOrEqual(5000);
    const compile = () => worldState(s, { chat: "c", turn: t2.id, layout: SHIPPED_PART, map: MAP, due: DUE, charsPerToken: 4 });
    // The first compile at a turn also builds the tree over its state; later ones reuse it.
    const cold = performance.now();
    const block = compile();
    const first = performance.now() - cold;
    // The horizon whole: the room and the group, every line of each as a full query gives it.
    const view = s.viewAt(t2.id);
    const whole = [view.query(room, "full"), view.query("group_3", "full")].flatMap((q) => q?.lines ?? []);
    expect(block.sections.horizon?.filter((l) => l.kind !== "map")).toEqual(whole);
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

  test("holds its budget: with 600 rooms beside the scene every section but the horizon fits, and a section cut short says how much it left out", () => {
    const roomy = inventedWorld();
    const inn = roomy.places.common_room?.parent ?? "";
    for (let i = 1; i <= 600; i++) roomy.places[`room_${i}`] = { id: `room_${i}`, name: `Guest room ${i} on the upper landing`, parent: inn, fields: {} };
    const ts = testStore({ world: roomy });
    const { s } = ts;
    s.createChat({ id: "c", revision: ts.revision });
    play(s, "c", "m1", "Wren looks down the long landing.", 1, [
      { lane: "story", op: "story.horizon", value: { list: ["common_room"] }, by: "author", source: "author" },
      { lane: "engine", ...factStore.change({ about: `entity:${POV}`, key: "mood", value: "lost" }), by: "gm", precision: "vague" },
    ]);
    const t2 = s.beginTurn({ chat: "c", kind: "normal" });
    const block = worldState(s, { chat: "c", turn: t2.id, layout: SHIPPED_LAYOUT, map: MAP, due: DUE, charsPerToken: 4 });
    expect(block.tokens).toBeLessThanOrEqual(WORLD_STATE_DEFAULTS.budget);
    // The horizon whole, whatever the rest takes.
    const whole = s.viewAt(t2.id).query("common_room", "full")?.lines ?? [];
    expect(block.sections.horizon?.filter((l) => l.kind !== "map")).toEqual(whole);
    // Around it: the rooms that fit, then the layout's line counting the rest.
    const around = block.sections.around ?? [];
    const last = around.at(-1);
    const shownRooms = around.filter((l) => l.kind === "level_place").length;
    expect(shownRooms).toBeGreaterThan(0);
    expect([last?.kind, last?.fields.n]).toEqual(["left_out", 601 - shownRooms]);
    expect(block.text.split("\n")).toContain(wordLine(SHIPPED_PART, last as ViewLine) ?? "the layout words a left_out line");
    // The sections that fit whole are whole, and the outline keeps its share.
    for (const section of ["above", "due", "changed", "unsettled"] as const) expect([section, block.sections[section]?.some((l) => l.kind === "left_out")]).toEqual([section, false]);
    expect(block.sections.outline?.length ?? 0).toBeGreaterThan(0);
  });

  test("a change that stopped applying is listed once, in the next briefing", () => {
    const ts = testStore();
    const { s } = ts;
    s.createChat({ id: "c", revision: ts.revision });
    play(s, "c", "m1", "Bram lends her a lantern.", 1, engine(make("lantern", "Lantern", POV)));
    play(s, "c", "m2", "She sets it on the cask.", 2, engine(...hand("lantern", POV, "cask")));
    // The other swipe of the first reply: no lantern was lent, so setting it down no longer applies.
    const candle = s.beginTurn({ chat: "c", kind: "swipe", on: null });
    s.tieTurn(candle.id, { message: "m1", hash: hashOf("No lantern tonight."), date: 11 });
    const flipped = s.sync("c", shown(["u1", "light"], ["m1", "No lantern tonight.", 11], ["u2", "down"], ["m2", "She sets it on the cask.", 2]));
    expect(flipped.notApplied.map((n) => n.op)).toEqual(["unlink", "link"]);
    const reports = (turn: string): string[] =>
      (worldState(s, { chat: "c", turn, layout: SHIPPED_LAYOUT, charsPerToken: 4 }).sections.unsettled ?? []).filter((l) => l.kind === "unsettled_stopped").map((l) => `${String(l.fields.op)} ${String(l.fields.turn)}`);
    const next = s.beginTurn({ chat: "c", kind: "normal" });
    expect(reports(next.id)).toEqual(["unlink 2", "link 2"]);
    s.addChanges(next.id, engine(tick(5)));
    s.tieTurn(next.id, { message: "m3", hash: hashOf("She waits."), date: 3 });
    expect(reports(s.beginTurn({ chat: "c", kind: "normal" }).id)).toEqual([]);
  });
});

describe("what falls due in the world state", () => {
  const DAY = 24 * 60;

  /** Tam keeps the market from nine to five and the common room after; the vale's weather turns at six and at noon: four starts a day. */
  function scheduledStore() {
    const world = inventedWorld();
    world.schedules = {
      tam_day: { id: "tam_day", owner: "tam", target: "place", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: "market_square" }, { start: "17:00", end: "22:00", value: "common_room" }] },
      vale_weather: { id: "vale_weather", target: "weather", recurrence: { every: "day" }, slots: [{ start: "06:00", end: "12:00", value: "rain" }, { start: "12:00", end: "18:00", value: "sun" }] },
    };
    const ts = testStore({ world });
    ts.s.createChat({ id: "c", revision: ts.revision });
    return { ...ts, world };
  }

  /** The store's own due list, counting every start it makes. */
  function counted(source: DueSource): { source: DueSource; made: () => number } {
    let made = 0;
    return {
      source: {
        due: (state, span, at, most) => {
          const listing = source.due(state, span, at, most);
          made += listing.items.length;
          return listing;
        },
      },
      made: () => made,
    };
  }

  test("after a turn whose clock moved two days on, the next world state lists what fell due in those two days, and what is due from the new time on", () => {
    const { s, store, world } = scheduledStore();
    const first = play(s, "c", "m1", "Wren sits by the fire.", 1, []);
    const since = s.headState("c").state.world.clock;
    // The clock's ✎ two days on, as the play panels record it on the chat's newest turn.
    s.addChanges(first.id, [{ lane: "engine", op: "clock", value: { type: "clock", minutes: 2 * DAY, cause: "advance" }, by: "player", source: "player" }]);
    const next = s.beginTurn({ chat: "c", kind: "normal" });
    const now = s.stateAt(next.id).state.world.clock;
    expect(now).toBe(since + 2 * DAY);

    const due = timeDue(store);
    const block = worldState(s, { chat: "c", turn: next.id, layout: SHIPPED_LAYOUT, due, charsPerToken: 4 });
    const fell = due.due(s.stateAt(next.id).state, { from: since, to: now }, null, Number.POSITIVE_INFINITY).items;
    // Eight slots start in the two days; the point-of-view character's hunger, fatigue and social needs also cross their lines in them.
    expect(fell.length).toBe(8 + 3);
    const calendar = calendarOf(world);
    expect(block.sections.passed?.map((l) => [l.kind, l.fields.when, l.fields.what])).toEqual(fell.map((d) => ["fell_due", formatClock(calendar, d.at), typeof d.what === "string" ? d.what : JSON.stringify(d.what)]));
    const lines = block.text.split("\n");
    const heading = lines.indexOf("### Fell due as the clock moved last turn");
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(lines[heading + 2]).toBe(wordLine(SHIPPED_PART, block.sections.passed?.[0] as ViewLine) ?? "the layout words a fell_due line");
    // What is due is still listed from the new time on.
    expect(block.sections.due?.filter((l) => l.kind === "due").every((l) => typeof l.fields.after === "number" && l.fields.after > 0)).toBe(true);

    // A turn whose clock did not move lists nothing as fallen due.
    s.tieTurn(next.id, { message: "m2", hash: hashOf("She waits."), date: 2 });
    const after = s.beginTurn({ chat: "c", kind: "normal" });
    expect(worldState(s, { chat: "c", turn: after.id, layout: SHIPPED_LAYOUT, due, charsPerToken: 4 }).sections.passed).toBeUndefined();
  });

  // hardening
  test.skip("a due span of a century costs no more than a day's: the list stops at what the budget can show, and the rest is counted", () => {
    const { s, store } = scheduledStore();
    play(s, "c", "m1", "Wren sits by the fire.", 1, []);
    const next = s.beginTurn({ chat: "c", kind: "normal" });
    const state = s.stateAt(next.id).state;
    const now = state.world.clock;
    // A layout that holds the due section alone, and a budget a day's starts overflow: what it can show is the bound.
    const layout = `${SHIPPED_LAYOUT.slice(0, SHIPPED_LAYOUT.indexOf("\n---\n") + 5)}{{#due}}\n{{due}}\n{{/due}}\n`;
    const budget = { budget: 50 };
    const listed = (dueAhead: number) => {
      const due = counted(timeDue(store));
      const block = worldState(s, { chat: "c", turn: next.id, layout, due: due.source, settings: { ...budget, dueAhead }, charsPerToken: 4 });
      return { made: due.made(), lines: block.sections.due ?? [] };
    };
    const day = listed(DAY);
    const century = listed(100 * 365 * DAY);
    expect(day.lines.at(-1)?.kind).toBe("left_out");
    expect(century.made).toBeLessThanOrEqual(day.made);
    // The rest is counted from what the store's due list says remains in the span.
    const shown = century.lines.filter((l) => l.kind === "due").length;
    const all = timeDue(store).due(state, { from: now, to: now + 100 * 365 * DAY }, null, 0).more;
    expect(all).toBeGreaterThan(100 * 365 * 4 - 8);
    expect(shown).toBeGreaterThan(0);
    expect(century.lines.at(-1)?.kind).toBe("left_out");
    expect(century.lines.at(-1)?.fields.n).toBe((all ?? 0) - shown);
  });
});
