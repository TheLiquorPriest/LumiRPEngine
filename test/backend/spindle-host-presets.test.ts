// The preset's blocks as the host port reads them from Lumiverse: which blocks name a category of
// their own, which the story engine's reader files them by (`story/preset.ts`).

import { afterEach, expect, test } from "bun:test";
import { createSpindleHost } from "../../src/backend/spindle-host";

afterEach(() => {
  Object.assign(globalThis, { spindle: undefined });
});

type Stored = Readonly<Record<string, unknown>>;

/** A block as `blocks.list` gives it: every field filled in, and a `group` on every block, null where the stored block has none. */
const listed = (b: Stored): Stored => ({ content: "", enabled: true, marker: null, injectionTrigger: [], categoryMode: null, ...b, group: typeof b.group === "string" ? b.group : null });

/** Lumiverse's answers for a preset: `presets.get` gives its blocks as they are stored (null: the preset can't be read), `blocks.list` gives `list`. */
function lumiverse(stored: readonly Stored[] | null, list: readonly Stored[]): void {
  Object.assign(globalThis, {
    spindle: { presets: { get: async () => (stored === null ? null : { id: "p", name: "P", cache_revision: 1, metadata: {}, prompt_order: stored }), blocks: { list: async () => list } } },
  });
}

const groups = async (): Promise<unknown[]> => (await createSpindleHost().presets.blocks("p", "u")).map((b) => [b.id, "group" in b ? b.group : "names none"]);

test("a block names a category only where its stored block does", async () => {
  const stored: Stored[] = [
    { id: "header", name: "Author", marker: "category" },
    { id: "older", name: "A block stored with no group" },
    { id: "filed", name: "A block filed by id", group: "header" },
    { id: "unfiled", name: "A block set outside every category", group: null },
  ];
  lumiverse(stored, stored.map(listed));
  // The older block falls under the header above it: Lumiverse's null for it isn't the block's own word.
  expect(await groups()).toEqual([["header", "names none"], ["older", "names none"], ["filed", "header"], ["unfiled", null]]);
});

test("a preset whose stored blocks can't be read keeps what the list says", async () => {
  lumiverse(null, [listed({ id: "b", name: "B" })]);
  expect(await groups()).toEqual([["b", null]]);
});
