// A map's legend given in words, as the floor model sent it live to `map_lay` (and to `map_edit`):
// each symbol's value a few words, not one of the format's kinds of square. Played as the harness
// plays a call (checked and coerced by pi, then run). Every name here is made up.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { HostTool, JsonObject, ToolResult } from "rp-harness/contract";
import { Lines, SHIPPED_GUIDANCE } from "../../../src/iface/index";
import { asHarnessPasses } from "../../story/rig";
import { type Rig, rig, texts } from "../rig";

const SRC = { source: { from: "prose", message: "m-6" } } as const;

/** A line any text fills (one that is all fields) proves nothing, so the check leaves it out. */
const SENTINEL = "\u0001 no line of any part says this";
const mapPatterns = Lines.parse(await Bun.file(join(SHIPPED_GUIDANCE, ".prompts", "map-answers.md")).text(), "map-answers")
  .patterns()
  .filter((p) => !p.test(SENTINEL));

/** Every line and report of a map tool's answer is a line of the map's part. */
function wordsFromFiles(r: ToolResult): void {
  const kinds = ((r.details as { parts?: string[] } | undefined)?.parts ?? []) as string[];
  texts(r).forEach((text, i) => {
    if (kinds[i] === "line") expect({ text, ok: mapPatterns.some((p) => p.test(text)) }).toEqual({ text, ok: true });
  });
  for (const rep of r.reports ?? []) expect({ rep, ok: mapPatterns.some((p) => p.test(rep)) }).toEqual({ rep, ok: true });
}

async function play(t: Rig, tool: string, args: JsonObject): Promise<ToolResult> {
  const r = await t.call(tool, asHarnessPasses(t.tools.get(tool) as HostTool, args));
  wordsFromFiles(r);
  return r;
}

/** A blank world with an island and a keeper on it, the island with no map yet. */
async function island(): Promise<Rig> {
  const t = await rig({}, "blank");
  const r = await t.call("world_apply", {
    operations: [
      { op: "place", kind: "place", name: "Gull Skerry", ...SRC },
      { op: "spawn", kind: "person", name: "Ada Lorne", at: "Gull Skerry", ...SRC },
    ],
  });
  expect(r.error).toBeUndefined();
  return t;
}

/** Water above, a slip down through the rock, rock below. */
const ROWS = ["~~~~~~~~", "~~~SS~~~", ",,,SS,,,", ",,,,,,,,"];
const LIVE_LEGEND = { "~": "grey water, breaking", ",": "bare rock, wet", S: "slip, sloping into the sea" };

describe("a map's legend given in words", () => {
  test("map_lay, as sent live: each symbol's words are read as floor named by them, the answer says so, and it is clean", async () => {
    const t = await island();
    const r = await play(t, "map_lay", { place: "Gull Skerry", rows: ROWS, legend: LIVE_LEGEND, ...SRC });
    expect(r.error).toBeUndefined();
    expect(r.reports).toBeUndefined();
    expect(texts(r).filter((x) => x.includes("was read as"))).toEqual([
      'map_lay: ~ was read as floor named grey water, breaking; with "blocks": true it would be a square nobody walks through.',
      'map_lay: , was read as floor named bare rock, wet; with "blocks": true it would be a square nobody walks through.',
      'map_lay: S was read as floor named slip, sloping into the sea; with "blocks": true it would be a square nobody walks through.',
    ]);
    const shown = texts(await play(t, "map_view", { at: "Gull Skerry" })).join("\n");
    for (const said of ["~ grey water, breaking", ", bare rock, wet", "S slip, sloping into the sea"]) expect(shown).toContain(said);
    // Floor: someone put on the water stands there with nothing to report.
    const placed = await play(t, "map_place", { at: "Gull Skerry", pieces: [{ who: "Ada Lorne", square: [1, 1] }], ...SRC });
    expect(placed.reports).toBeUndefined();
  });

  test("words with blocks: true, or a wall named as their kind, are read as a square nobody walks through", async () => {
    const t = await island();
    const legend = { "~": { terrain: "grey water, breaking", blocks: true }, ",": "bare rock, wet", S: { kind: "wall", name: "slip rail" } };
    const r = await play(t, "map_lay", { place: "Gull Skerry", rows: ROWS, legend, ...SRC });
    expect(r.error).toBeUndefined();
    expect(texts(r).filter((x) => x.includes("was read as"))).toEqual([
      "map_lay: ~ was read as grey water, breaking, a square nobody walks through.",
      'map_lay: , was read as floor named bare rock, wet; with "blocks": true it would be a square nobody walks through.',
      "map_lay: S was read as slip rail, a square nobody walks through.",
    ]);
    const placed = await play(t, "map_place", { at: "Gull Skerry", pieces: [{ who: "Ada Lorne", square: [1, 1] }], ...SRC });
    expect(placed.reports).toEqual(["map_place: Ada Lorne [ada_lorne] stands on (1,1), which block the way; it was put there all the same."]);
  });

  test("a symbol of more than one character is answered with what a legend entry holds, and nothing is recorded", async () => {
    const t = await island();
    const before = t.s.changes(t.turn.id).length;
    const r = await play(t, "map_lay", { place: "Gull Skerry", rows: ROWS, legend: { ...LIVE_LEGEND, "~~": "deep water" }, ...SRC });
    expect(r.error).toBe(true);
    expect(texts(r)[0]).toStartWith('map_lay: legend ~~ cannot be read, you sent "deep water". A legend entry is one character, and what its squares are: wall, floor or door;');
    expect(t.s.changes(t.turn.id).length).toBe(before);
  });

  test("map_edit reads its legend the same way", async () => {
    const t = await island();
    expect((await play(t, "map_lay", { place: "Gull Skerry", rows: ROWS, legend: LIVE_LEGEND, ...SRC })).error).toBeUndefined();
    const r = await play(t, "map_edit", { at: "Gull Skerry", strokes: [{ symbol: "p", squares: [[2, 4]] }, { symbol: "r", squares: [[7, 4]] }], legend: { p: "rock pool", r: { name: "sea stack", blocks: true } }, ...SRC });
    expect(r.error).toBeUndefined();
    expect(r.reports).toBeUndefined();
    expect(texts(r).filter((x) => x.includes("was read as"))).toEqual([
      'map_edit: p was read as floor named rock pool; with "blocks": true it would be a square nobody walks through.',
      "map_edit: r was read as sea stack, a square nobody walks through.",
    ]);
    const refused = await play(t, "map_edit", { at: "Gull Skerry", strokes: [{ symbol: "q", squares: [[1, 4]] }], legend: { qq: "quicksand" }, ...SRC });
    expect(refused.error).toBe(true);
    expect(texts(refused)[0]).toStartWith('map_edit: legend qq cannot be read, you sent "quicksand".');
  });
});
