// `PROMPT-MAP.md` is laid out by the prompt part `prompt-map-file` (RPH's own `prompt-map` is the words of
// the `prompt` tool and the briefing's notices, and the name is not shared: RPE's file of the same name would
// replace it in the shipped level). The part is loaded as RPH loads it and filled with the fields
// `promptMapFields` gives, for a learned map and for a prompt not mapped yet. Every name is invented.

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { PromptMap, RawLayout } from "rp-harness/contract";
import { promptMapFields } from "../../src/tree/generated";
import { openSet, type OpenSet, shippedTexts } from "./set";

let set: OpenSet;
beforeAll(async () => {
  set = await openSet(shippedTexts());
});
afterAll(() => set.close());

async function laidOut(map: PromptMap | undefined, layout: RawLayout | null): Promise<string> {
  const part = await set.guidance().part("prompt-map-file");
  if (part?.format !== "template") throw new Error("prompt-map-file is not a template part");
  const rendered = part.render(promptMapFields(map, layout));
  expect(rendered.missing).toEqual([]);
  return rendered.text;
}

const LAYOUT: RawLayout = {
  messages: [],
  complete: true,
  preset: { id: "preset-lamp", name: "Lamp" },
  blocks: [{ name: "Main", type: "preset", text: "You narrate.", kind: "instructions" }, { name: "Note", type: "preset", text: "Keep it short." }],
};

const MAP: PromptMap = {
  format: 1,
  preset: { id: "preset-lamp", name: "Lamp", revision: "2" },
  slices: [
    { marker: "preset.main", kind: "instructions", line: "How the reply is made.", behaviour: "fixed", find: { signature: "[]", block: "Main", before: "history" } },
    { marker: "note", kind: "note", line: "A reminder after the history.", behaviour: "turn", edited: true, find: { after: "history" } },
  ],
};

test("a learned map shows each slice with its kind, behaviour, line, whether it was edited and how it is found again, and the blocks beside", async () => {
  const text = await laidOut(MAP, LAYOUT);
  expect(text).toContain("This is the map of Lamp, revision 2.");
  expect(text).toContain("- **preset.main** (instructions, fixed): How the reply is made.\n  Found again by:\n  - its text\n  - the chat application's block Main\n  - its place before history");
  expect(text).toContain("- **note** (note, turn, edited): A reminder after the history.\n  Found again by:\n  - its place after history");
  expect(text).toContain("1. Main (preset, instructions)\n2. Note (preset, other)");
  expect(text).not.toContain("Not mapped yet");
});

test("a prompt not mapped yet shows the chat application's blocks, which are the only names it has, and no slice", async () => {
  const text = await laidOut(undefined, LAYOUT);
  expect(text).toContain("## Not mapped yet");
  expect(text).toContain("1. Main (preset, instructions)\n2. Note (preset, other)");
  expect(text).not.toContain("## The slices");
});

test("a prompt the chat application did not name, with no blocks, says so and asks for nothing", async () => {
  const text = await laidOut(undefined, null);
  expect(text).toContain("The chat application did not name the preset this prompt is from.");
  expect(text).toContain("The chat application named no blocks.");
  expect(text).not.toMatch(/\b(must|should|always|never)\b/i);
});
