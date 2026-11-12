// The author's notebook as the engine gives it its first shape (`shapeNotebook`): each page that
// doesn't exist yet gets its heading and what it is for, in the user's own words where they wrote
// them; a page that exists is never touched; the index and the scene are pinned for the author once
// each exists; and a write the workspace refuses is answered, never thrown.

import { describe, expect, test } from "bun:test";
import type { HarnessFile } from "../../src/backend/agents/tools/harness-ports";
import { renderPrompt } from "../../src/backend/prompts";
import { type NotebookPort, shapeNotebook } from "../../src/backend/story/notebook";
import { AUTHOR_FILE, type AuthorFile, HARNESS_AGENT, HARNESS_TEXT } from "../../src/shared/harness-texts";

/** A chat's area of the workspace in memory: its files by path, the pins asked for, and the paths whose writes it refuses (with the code it refuses them with). */
function area(files: Record<string, string> = {}, refuse: Record<string, string> = {}): NotebookPort & { files: Map<string, HarnessFile>; pins: [string, string][] } {
  const held = new Map<string, HarnessFile>(Object.entries(files).map(([path, text]) => [path, { path, text, version: `v-${path}` }]));
  const pins: [string, string][] = [];
  return {
    files: held,
    pins,
    async list(folder) {
      return [...held.values()].filter((f) => f.path.startsWith(folder)).map((f) => ({ path: f.path, size: f.text.length, version: f.version }));
    },
    async write(path, text, base) {
      const code = refuse[path];
      if (code !== undefined) return { refused: { code, reason: `The workspace refused ${path}.`, version: null } };
      if (base === null && held.has(path)) return { refused: { code: "conflict", reason: "Written meanwhile.", version: held.get(path)?.version ?? null } };
      held.set(path, { path, text, version: `v-${path}-new` });
      return { version: `v-${path}-new` };
    },
    async pin(path, agent) {
      pins.push([path, agent]);
    },
  };
}

const ALL = Object.values(AUTHOR_FILE);
/** The author's two pinned pages, each pinned for the author. */
const PINS: [string, string][] = [
  [AUTHOR_FILE.notebook, HARNESS_AGENT.author],
  [AUTHOR_FILE.scene, HARNESS_AGENT.author],
];

describe("the author's notebook, first shaped", () => {
  test("every page that doesn't exist yet is given its heading and what it is for, and the index and the scene are pinned for the author", async () => {
    const port = area();
    const shaped = await shapeNotebook(port, {});
    expect(shaped).toEqual({ shaped: [...ALL], refused: [] });
    for (const file of Object.keys(AUTHOR_FILE) as AuthorFile[]) {
      const text = port.files.get(AUTHOR_FILE[file])?.text ?? "";
      expect({ file, text }).toEqual({ file, text: renderPrompt(HARNESS_TEXT.notebook(file), {}, {}) });
      expect({ file, heading: text.startsWith("# ") }).toEqual({ file, heading: true });
    }
    expect(port.pins).toEqual(PINS);
  });

  test("a page that exists is never touched, whoever wrote it; a shape the user wrote is the one given", async () => {
    const mine = "# The ledger of threads\n\nMine.";
    const port = area({ [AUTHOR_FILE.notebook]: "# Notebook\n\nThe heist is a week out.", [AUTHOR_FILE.player]: "They want slow burn." });
    const shaped = await shapeNotebook(port, { [HARNESS_TEXT.notebook("threads")]: mine });
    expect(shaped.shaped).toEqual(ALL.filter((p) => p !== AUTHOR_FILE.notebook && p !== AUTHOR_FILE.player));
    expect(port.files.get(AUTHOR_FILE.notebook)?.text).toBe("# Notebook\n\nThe heist is a week out.");
    expect(port.files.get(AUTHOR_FILE.player)?.text).toBe("They want slow burn.");
    expect(port.files.get(AUTHOR_FILE.threads)?.text).toBe(mine);
    // The pages the author keeps pinned are pinned again: a pin already there stays as it is.
    expect(port.pins).toEqual(PINS);
  });

  test("a write the workspace refuses is answered with its own words and nothing is pinned that isn't there; one written meanwhile is left as it was written", async () => {
    const port = area({}, { [AUTHOR_FILE.notebook]: "too_many", [AUTHOR_FILE.arcs]: "conflict" });
    const shaped = await shapeNotebook(port, {});
    expect(shaped.refused).toEqual([{ path: AUTHOR_FILE.notebook, reason: `The workspace refused ${AUTHOR_FILE.notebook}.` }]);
    expect(shaped.shaped).toEqual(ALL.filter((p) => p !== AUTHOR_FILE.notebook && p !== AUTHOR_FILE.arcs));
    expect(port.pins).toEqual([[AUTHOR_FILE.scene, HARNESS_AGENT.author]]);
    // Written meanwhile by someone else: theirs, and the index pinned once it exists.
    const raced = area({}, { [AUTHOR_FILE.notebook]: "conflict" });
    expect((await shapeNotebook(raced, {})).refused).toEqual([]);
    expect(raced.pins).toEqual(PINS);
  });
});
