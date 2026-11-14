// What a span of time brings due is listed up to a setting, soonest first, and the answer says how
// many more fall in the span: a skip of a year over a world whose weather turns four times a day
// answers with a page and a count, not with every turn of the year, and a skip of a thousand years
// over the store's own list costs what its page does. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { JsonObject, ToolResult } from "rp-harness/contract";
import { hashJson } from "../../src/shared/hash";
import type { ScheduleDef } from "../../src/shared/world";
import { type DueItem, type DueList, IFACE_DEFAULTS, Lines, SHIPPED_GUIDANCE } from "../../src/iface/index";
import { timeDue } from "../../src/store/due";
import { openStore } from "../../src/store/store";
import { dataOf, registry, rig, texts, wordsFromFiles, world } from "./rig";

const lines = Lines.parse(await Bun.file(join(SHIPPED_GUIDANCE, ".prompts", "engine-answers.md")).text(), "engine-answers");

/** The weather turning every six hours of any span, as a world's own process would bring it due: the soonest up to the bound, the rest counted. */
const WEATHER: DueList = {
  due: (_state, span, _at, most) => {
    const items: DueItem[] = [];
    for (let at = span.from + 360; at <= span.to && items.length < most; at += 360) items.push({ at, kind: "weather", what: "vale_weather" });
    return { items, more: Math.floor((span.to - span.from) / 360) - items.length };
  },
};

const YEAR = 365 * 24 * 60;
/** More than a year's turns of the weather: every one of them is listed. */
const ALL = 10_000;

async function passTime(due: DueList, minutes: number, settings: { dueItems?: number } = {}, doc = world()): Promise<{ r: ToolResult; due: JsonObject[] }> {
  const t = await rig({ due, settings }, doc);
  const r = await t.call("world_apply", { operations: [{ op: "pass_time", minutes, source: { from: "prose", message: "m-1" } }] });
  expect(r.error).toBeUndefined();
  return { r, due: ((dataOf(r).operations as JsonObject[])[0] as JsonObject).due as JsonObject[] };
}

describe("what falls due, listed up to a setting", () => {
  test("passing a year lists the soonest of what falls due, up to the setting, and says how many more fall in the span", async () => {
    const whole = await passTime(WEATHER, YEAR, { dueItems: ALL });
    expect(whole.due).toHaveLength(1460);
    expect(texts(whole.r).some((x) => x.includes("more fall due"))).toBe(false);

    const { r, due } = await passTime(WEATHER, YEAR);
    expect(due).toEqual(whole.due.slice(0, IFACE_DEFAULTS.dueItems));
    expect(texts(r)).toContain(lines.line("due_more", { n: 1, op: "pass_time", listed: IFACE_DEFAULTS.dueItems, more: 1460 - IFACE_DEFAULTS.dueItems }) ?? "");
    expect(r.reports).toBeUndefined();
    wordsFromFiles(r);
    expect(JSON.stringify(r.content).length).toBeLessThan(JSON.stringify(whole.r.content).length / 10);
  });

  test("world_query's due is held to the same setting, which the host sets", async () => {
    const t = await rig({ due: WEATHER, settings: { dueItems: 3 } });
    const r = await t.call("world_query", { at: "thornbury", due: "2032-03-01 08:00" });
    expect(r.error).toBeUndefined();
    const due = dataOf(r).due as JsonObject[];
    expect(due.map((d) => d.kind)).toEqual(["weather", "weather", "weather"]);
    const said = texts(r).find((x) => x.includes("more fall due")) ?? "";
    const more = Number(/(\d+) more fall due/.exec(said)?.[1]);
    expect(said).toBe(lines.line("due_more", { listed: 3, more }) ?? "");
    expect(more).toBeGreaterThan(1400);
    wordsFromFiles(r);
  });

  test("where the host could not count the rest, the answer says there are more, with no number", async () => {
    const uncounted: DueList = { due: (state, span, at, most) => ({ ...WEATHER.due(state, span, at, most), more: null }) };
    const { r, due } = await passTime(uncounted, YEAR, { dueItems: 4 });
    expect(due).toHaveLength(4);
    expect(texts(r)).toContain(lines.line("due_more_uncounted", { n: 1, op: "pass_time", listed: 4 }) ?? "");
    expect(texts(r).some((x) => /\d+ more fall due/.test(x))).toBe(false);
    wordsFromFiles(r);
  });

  test("a thousand years passed over the store's own list answers with a page and the count of the rest, in well under a second", async () => {
    const doc = world();
    const daily = (id: string, ...slots: [string, string][]): ScheduleDef => ({ id, target: "activity", recurrence: { every: "day" }, slots: slots.map(([start, end]) => ({ start, end, value: id })) });
    doc.schedules = Object.fromEntries(
      [...Array.from({ length: 20 }, (_, i) => daily(`routine_${i}`, ["08:00", "17:00"], ["17:00", "23:00"])), daily("weather", ["00:00", "06:00"], ["06:00", "12:00"], ["12:00", "18:00"], ["18:00", "24:00"])].map((s) => [s.id, s]),
    );
    // The store's list over a store of its own on the same world: it reads only the world and the state it is handed.
    const revision = hashJson(doc);
    const due = timeDue(openStore({ db: ":memory:", registry: registry(), worlds: (r) => (r === revision ? doc : undefined) }));
    const days = 365_243;
    const t = await rig({ due }, doc);
    Bun.gc(true);
    const heap = process.memoryUsage().heapUsed;
    const started = performance.now();
    const r = await t.call("world_apply", { operations: [{ op: "pass_time", minutes: days * 24 * 60, source: { from: "prose", message: "m-1" } }] });
    const took = performance.now() - started;
    const grew = process.memoryUsage().heapUsed - heap;
    expect(r.error).toBeUndefined();
    expect(((dataOf(r).operations as JsonObject[])[0] as JsonObject).due).toHaveLength(IFACE_DEFAULTS.dueItems);
    // Twenty routines of two slots and the weather's four, each starting once a day.
    expect(texts(r)).toContain(lines.line("due_more", { n: 1, op: "pass_time", listed: IFACE_DEFAULTS.dueItems, more: days * 44 - IFACE_DEFAULTS.dueItems }) ?? "");
    expect(took).toBeLessThan(1000);
    expect(grew).toBeLessThan(64 * 1024 * 1024);
  });
});
