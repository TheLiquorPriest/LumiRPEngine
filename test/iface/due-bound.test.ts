// What a span of time brings due is listed up to a setting, soonest first, and the answer says how
// many more fall in the span: a skip of a year over a world whose weather turns four times a day
// answers with a page and a count, not with every turn of the year. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { JsonObject, ToolResult } from "rp-harness/contract";
import { type DueItem, type DueList, IFACE_DEFAULTS, Lines, SHIPPED_GUIDANCE } from "../../src/iface/index";
import { dataOf, rig, texts, wordsFromFiles } from "./rig";

const lines = Lines.parse(await Bun.file(join(SHIPPED_GUIDANCE, ".prompts", "engine-answers.md")).text(), "engine-answers");

/** The weather turning every six hours of any span, as a world's own process would bring it due. */
const WEATHER: DueList = {
  due: (_state, span) => {
    const out: DueItem[] = [];
    for (let at = span.from + 360; at <= span.to; at += 360) out.push({ at, kind: "weather", what: "vale_weather" });
    return out;
  },
};

const YEAR = 365 * 24 * 60;
/** More than a year's turns of the weather: every one of them is listed. */
const ALL = 10_000;

async function passYear(settings: { dueItems?: number } = {}): Promise<{ r: ToolResult; due: JsonObject[] }> {
  const t = await rig({ due: WEATHER, settings });
  const r = await t.call("world_apply", { operations: [{ op: "pass_time", minutes: YEAR, source: { from: "prose", message: "m-1" } }] });
  expect(r.error).toBeUndefined();
  return { r, due: ((dataOf(r).operations as JsonObject[])[0] as JsonObject).due as JsonObject[] };
}

describe("what falls due, listed up to a setting", () => {
  test("passing a year lists the soonest of what falls due, up to the setting, and says how many more fall in the span", async () => {
    const whole = await passYear({ dueItems: ALL });
    expect(whole.due).toHaveLength(1460);
    expect(texts(whole.r).some((x) => x.includes("more fall due"))).toBe(false);

    const { r, due } = await passYear();
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
});
