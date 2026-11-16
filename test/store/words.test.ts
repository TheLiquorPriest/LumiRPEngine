// No words of the store's reach an agent (BUILD.md, "No prompt text in code"): the tree view and the
// fold give structure and codes, and every word an agent reads comes from the part that words them.
// The test plays a turn that touches every kind of line, then holds every string the store gives
// to what the invented world and the recorded changes say, to today's engine's own formats (a
// clock, an amount), and to a short list of codes. A sentence written in the store's code fails it.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import type { JsonValue } from "../../src/shared/json";
import { kindDef } from "../../src/engine/scope";
import { factStore } from "../../src/store/facts";
import { LANES, PRECISIONS, SOURCES, STANDINGS, type ChangeInput } from "../../src/store/types";
import { readPart, renderView } from "../../src/store/words";
import { worldState } from "../../src/store/world-state";
import { engine, hand, inventedWorld, pay, play, POV, registry, say, SHIPPED_LAYOUT, SHIPPED_PART, testStore } from "./fixtures";

/** The codes the store may give in place of words: systems, its own value keys, and how a value stands. */
const CODES = new Set<string>(["calendar", "weather", "orgs", "economy", "time", "time_zone", "currency", "tier", "life", "coin", "posted", "members", "entry", "world", "groups", "elsewhere", ...PRECISIONS, ...STANDINGS, ...SOURCES, ...LANES]);
/** Today's engine's own formats: a clock, and an amount in the world's currency. */
const FORMATS = [/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d\d [AP]M$/, /^-?\$[\d,]+\.\d\d$/];
const FACT_ID = /^f-[0-9a-f]{12}$/;

/** Every string the world and the changes hold: values anywhere, as text the way data is shown (a number, a flag, JSON), and the keys of fields. */
function vocabulary(...sources: unknown[]): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, fieldsMap: boolean): void => {
    if (typeof v === "string") out.add(v.replace(/\s+/g, " ").trim());
    else if (typeof v === "number" || typeof v === "boolean") out.add(String(v));
    else if (Array.isArray(v)) {
      out.add(JSON.stringify(v));
      for (const x of v) walk(x, false);
    } else if (typeof v === "object" && v !== null) {
      out.add(JSON.stringify(v));
      for (const [k, x] of Object.entries(v)) {
        if (fieldsMap) out.add(k);
        walk(x, k === "fields");
      }
    }
  };
  for (const s of sources) walk(s, false);
  return out;
}

/** The strings in `value` that come neither from the data nor from a code: each with where it sits. */
function foreign(value: unknown, words: Set<string>): string[] {
  const bad: string[] = [];
  const known = (s: string): boolean => words.has(s) || CODES.has(s) || FORMATS.some((f) => f.test(s));
  const check = (name: string, s: string, at: string): void => {
    if (name === "kind" || name === "code" || name === "codes") {
      if (!/^[a-z][a-z0-9_.]*$/.test(s)) bad.push(`${at}: ${s}`);
      return;
    }
    if (name === "id" && FACT_ID.test(s)) return;
    if (name === "ref" || /^(place|entity):/.test(s)) {
      if (!known(s.replace(/^(place|entity):/, ""))) bad.push(`${at}: ${s}`);
      return;
    }
    if (known(s)) return;
    // A value the store put together from data: a list, or a role or symbol in brackets.
    const pieces = s.split(/, | \(|\)/).filter((p) => p !== "");
    if (pieces.length > 1 && pieces.every(known)) return;
    bad.push(`${at}: ${s}`);
  };
  const walk = (v: unknown, name: string, at: string): void => {
    if (typeof v === "string") check(name, v, at);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, name, `${at}[${i}]`));
    else if (typeof v === "object" && v !== null) for (const [k, x] of Object.entries(v)) walk(x, k, `${at}.${k}`);
  };
  walk(value, "", "");
  return bad;
}

function played() {
  const ts = testStore();
  const { s } = ts;
  s.createChat({ id: "c", revision: ts.revision });
  const changes: ChangeInput[] = [
    ...engine(pay("acct_wren", 250, "Two nights at the inn"), ...hand("knife", "satchel", POV), { type: "link", rel: "equipped", from: "knife", to: POV }, { type: "set", entity: "cask", field: "gone", value: true }, { type: "set", entity: "lamplighters", field: "uniform", value: "a brass lamp badge" }, { type: "set", entity: "nobody", field: "mood", value: "glad" }),
    { lane: "engine", ...factStore.change({ about: `entity:${POV}`, key: "mood", value: "wary of strangers" }), by: "gm", precision: "vague", standing: "assumed" },
    { lane: "engine", ...factStore.change({ about: "entity:acct_wren", key: "posted", value: "spent most of it on drink" }), by: "author", source: "prose", precision: "vague" },
    { lane: "story", op: "store.note", value: { at: "cellar", text: "uneasy since the fire" }, by: "author", source: "author" },
    { lane: "story", op: "store.horizon", value: { list: ["common_room", "tam"] }, by: "author", source: "author" },
    { lane: "engine", ...factStore.change({ about: "place:cellar", key: "door", value: "left unlocked", replaces: "f-000000000000" }), by: "gm", source: "gm" },
  ];
  const t = play(s, "c", "m1", "Wren pays for two nights and keeps her knife to hand.", 1, changes);
  return { ...ts, t, changes };
}

describe("no words of the store reach an agent", () => {
  test("every string a view, a fact or a report holds comes from the world, the changes or a code", () => {
    const { s, world, t, changes } = played();
    const view = s.view("c");
    const labels = Object.values(view.state.world.entities).map((e) => kindDef(registry(), world, e.kind)?.label ?? e.kind);
    const words = vocabulary(world, changes, labels, t.id);
    // The whole world, and two points whose own query shows what they take from above: a room, and a member of a group.
    const all = [view.query("world", "full"), view.query("cellar", 0), view.query("odile", 0)].flatMap((v) => v?.lines ?? []);
    expect(all.length).toBeGreaterThan(20);
    // The view holds every kind of line this turn makes: levels the tree adds, worn and equipped
    // things, something gone, values from systems and from above, facts, and an agent's line.
    const kinds = new Set(all.map((l) => l.kind));
    for (const kind of ["level_world", "level_place", "level_entity", "level_groups", "level_elsewhere", "value", "fact"]) expect(kinds.has(kind)).toBe(true);
    const flags = new Set(all.flatMap((l) => Object.keys(l.fields)));
    for (const flag of ["worn", "equipped", "gone", "reflection", "system", "from", "precision", "standing", "turn"]) expect([flag, flags.has(flag)]).toEqual([flag, true]);
    const nodes = ["world", "groups", "elsewhere", ...Object.keys(world.places), ...Object.keys(view.state.world.entities)].map((at) => view.node(at));
    const recorded = s.changes(t.id);
    expect(recorded.some((c) => c.reports.length > 0)).toBe(true);
    expect(foreign({ all, nodes, horizon: view.horizon(), recorded: recorded.map((c) => ({ reports: c.reports })), facts: factStore.of(view.state, `entity:${POV}`) }, words)).toEqual([]);
  });

  test("a part with no lines words nothing at all, and the shipped part words every kind of line", () => {
    const { s } = played();
    const view = s.view("c").query("world", "full");
    if (!view) throw new Error("no view");
    expect(renderView(view, "")).toBe("");
    expect(renderView(view, readPart("---\ndescription: only a description\n---\n{{horizon}}"))).toBe("");
    const text = renderView(view, SHIPPED_PART);
    expect(text.split("\n")).toHaveLength(view.lines.length);
    // Change a word in the part and the view follows it, and nothing else changes.
    const edited = readPart(`---\nlines:\n  level_place: '{{name}} — a place'\n---\n`);
    expect(renderView(view, edited).split("\n").every((l) => / — a place$/.test(l.trim()))).toBe(true);
    expect(say(s.view("c"), "cellar", 0).split("\n")[0]).toBe("The Cellar [cellar] (place) — 1 person (Odile), changed turn 1, note: uneasy since the fire");
  });

  test("what the fold says of a change is a code and its values", () => {
    const { s, t } = played();
    const reports = s.changes(t.id).flatMap((c) => c.reports);
    expect(reports).toContainEqual({ code: "missing_entity" });
    expect(reports).toContainEqual({ code: "replaces_none", values: { id: "f-000000000000" } });
    for (const r of reports) expect(Object.keys(r).every((k) => k === "code" || k === "values")).toBe(true);
    const asJson: JsonValue = JSON.parse(JSON.stringify(reports));
    expect(JSON.stringify(asJson)).not.toMatch(/"text"/);
  });

  test("every line of the world state is a recorded value too, and a layout that places nothing words nothing", () => {
    const { s, world, t, changes } = played();
    const next = s.beginTurn({ chat: "c", kind: "normal" });
    const labels = Object.values(s.view("c").state.world.entities).map((e) => kindDef(registry(), world, e.kind)?.label ?? e.kind);
    const due = { due: () => ({ items: [{ at: s.view("c").state.world.clock + 30, kind: "schedule", where: "place:market_square", who: ["tam"], what: "the bell rings" }], more: 0 }) };
    const block = worldState(s, { chat: "c", turn: next.id, layout: SHIPPED_LAYOUT, due, map: { text: () => ({ grid: "g", drawn: "d", text: "#.#" }) }, charsPerToken: 4 });
    for (const section of ["horizon", "above", "around", "outline", "due", "open", "changed", "unsettled"] as const) expect([section, (block.sections[section]?.length ?? 0) > 0]).toEqual([section, true]);
    // What the store kept of each change (its reports' codes and values) is recorded data too.
    expect(foreign(block.sections, vocabulary(world, changes, s.changes(t.id), labels, t.id, "the bell rings", "#.#"))).toEqual([]);
    expect(worldState(s, { chat: "c", turn: next.id, layout: "", due, charsPerToken: 4 }).text).toBe("");
  });

  test("what an Upgrade put back reaches a model as a code with values from the world, never in today's own words", () => {
    // A second revision of the world in which the errand's stage "Asked" is gone: the Upgrade puts it back to its new start.
    const base = inventedWorld();
    const errand = base.tracks.errand as NonNullable<typeof base.tracks.errand>;
    const second = { ...inventedWorld(), tracks: { errand: { ...errand, start: "sent", stages: { sent: { label: "Sent for", next: [{ to: "done", when: "false" }] }, done: { label: "Delivered", next: [] } } } } };
    const ts = testStore({ world: base, more: [second] });
    const { s } = ts;
    s.createChat({ id: "c", revision: ts.revision });
    const t = play(s, "c", "m1", "Word comes of the letter.", 1, [{ lane: "engine", op: "store.marker", value: { kind: "migrate", to: hashJson(second), merge: {} }, by: "player", source: "player" }]);
    const reports = s.changes(t.id).flatMap((c) => c.reports);
    expect(reports).toEqual([{ code: "track_reset", values: { track: "errand", label: "The sealed letter", from: "Asked", to: "Sent for" } }]);
    expect(foreign(reports, vocabulary(base, second))).toEqual([]);
  });
});
