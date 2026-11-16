// The generated files at the top of a chat's folder (plan §5.1, §4.8): written by RPE alone, only when their text changes, and laid
// out from the map of the preset the chat is played on, or until one is learned from the raw layout's names. Every name is invented.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PromptMap, RawLayout } from "rp-harness/contract";
import { GeneratedFiles, promptMapFields } from "../../src/tree/generated";
import { CHATS_FOLDER } from "../../src/tree/index";
import { type LaidTree, layTree } from "./fixtures";

let laid: LaidTree;
let place: string;

beforeAll(async () => {
  place = join(tmpdir(), `rpe-generated-${crypto.randomUUID()}`);
  laid = await layTree({ scope: { user: "u1", chat: "c1", session: "s1" }, files: [] } as never, place);
});

afterAll(async () => {
  await laid.close();
  await rm(place, { recursive: true, force: true });
});

test("a generated file is written at the top of a placed chat's folder only when its text changes; a chat not placed and a name RPE does not make get nothing", async () => {
  const generated = new GeneratedFiles({ files: laid.files, chats: laid.chats });
  const disk = join(laid.files, CHATS_FOLDER, laid.folders.character, laid.folders.chat, "PROMPT-MAP.md");
  expect(await generated.write("u1", "c1", "PROMPT-MAP.md", "# Map\n")).toBe("written");
  expect(await readFile(disk, "utf8")).toBe("# Map\n");
  const long = new Date(Date.now() - 3_600_000);
  await utimes(disk, long, long);
  expect(await generated.write("u1", "c1", "PROMPT-MAP.md", "# Map\n")).toBe("same");
  expect((await stat(disk)).mtimeMs).toBeLessThan(Date.now() - 1_000_000);
  expect(await generated.write("u1", "c1", "PROMPT-MAP.md", "# Map, again\n")).toBe("written");
  expect(await generated.write("u1", "never-met", "PROMPT-MAP.md", "x")).toBe("unplaced");
  await expect(generated.write("u1", "c1", "WORLD.md", "x")).rejects.toThrow("not a file RPE makes");
  await writeFile(disk, "# Map, again\n");
});

test("the map's fields name each slice with its marker, kind, line, behaviour and how it is found again; before a map is learned they name the raw layout's blocks", () => {
  const preset = { id: "preset-harbor", name: "Harbor", revision: "r2" };
  const map: PromptMap = {
    format: 1,
    preset,
    slices: [
      { marker: "persona", kind: "persona", line: "Who the player is.", behaviour: "scene", find: { after: "preset.style", block: "Persona" }, edited: true },
      { marker: "preset.style", kind: "style", line: "How the prose goes.", behaviour: "fixed", find: { signature: "abc" } },
    ],
  };
  const layout: RawLayout = { messages: [], complete: true, blocks: [{ name: "Main", type: "prompt", kind: "instructions", text: "…" }, { name: "Card", type: "slot", text: "…" }], blocksFrom: "breakdown", preset };
  const learned = promptMapFields(map, layout);
  expect(learned).toMatchObject({ learned: true, preset: { id: "preset-harbor", name: "Harbor", revision: "r2" } });
  expect(learned.slices).toEqual([
    { marker: "persona", kind: "persona", line: "Who the player is.", behaviour: "scene", edited: true, signature: false, after: "preset.style", block: "Persona" },
    { marker: "preset.style", kind: "style", line: "How the prose goes.", behaviour: "fixed", edited: false, signature: true },
  ]);
  const raw = promptMapFields(undefined, layout);
  expect(raw).toMatchObject({ learned: false, slices: [], blocks: [{ n: 1, name: "Main", type: "prompt", kind: "instructions" }, { n: 2, name: "Card", type: "slot", kind: "other" }] });
});
