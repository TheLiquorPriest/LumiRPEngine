// The levels of RPE's tree as RPH reads its guidance through the port (plan §5.2): the shipped level
// laid out at every start from RPH's shipped files and then RPE's, RPE's winning a name both have;
// a user's file replacing the shipped one of its name, a chat's replacing the user's; and a name
// switched off in a config's `stack.off` list not found at all.

import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SHIPPED_GUIDANCE } from "rp-harness/helpers";
import { loadGuidance } from "../../src/app/guidance";
import { KIT_SEED } from "rp-harness/testing/kit";
import { CHAT_DEFAULTS, RPE_GUIDANCE } from "../../src/tree/index";
import { type LaidTree, layTree } from "./fixtures";

const scope = KIT_SEED.scope;

/** Every file below a folder, by its path below it. */
async function filesBelow(folder: string): Promise<string[]> {
  const found = await readdir(folder, { recursive: true, withFileTypes: true });
  return found.filter((d) => d.isFile()).map((d) => relative(folder, join(d.parentPath, d.name)));
}

const agent = (description: string, body: string) => `---\nname: narrator\ndescription: ${description}\n---\n${body}\n`;
const part = (text: string) => `---\ndescription: Words the kit reads.\n---\n${text}\n`;

describe("RPE's tree, level by level", () => {
  let place: string;
  let tree: LaidTree | undefined;

  beforeEach(async () => {
    place = await mkdtemp(join(tmpdir(), "rpe-levels-"));
  });

  afterEach(async () => {
    await tree?.close();
    tree = undefined;
    await rm(place, { recursive: true, force: true });
  });

  test("the shipped level as RPE lays it: every file of RPH's, every file of RPE's laid over them, RPE's chat defaults at its root", async () => {
    tree = await layTree(KIT_SEED, place, { sources: { rph: SHIPPED_GUIDANCE, rpe: RPE_GUIDANCE } });
    const expected = new Map<string, string>();
    for (const path of await filesBelow(SHIPPED_GUIDANCE)) expected.set(path, join(SHIPPED_GUIDANCE, path));
    for (const path of await filesBelow(RPE_GUIDANCE)) {
      const at = path.startsWith(`${CHAT_DEFAULTS}/`) ? path.slice(CHAT_DEFAULTS.length + 1) : path;
      expected.set(at, join(RPE_GUIDANCE, path));
    }
    const laid = await filesBelow(tree.levelDir("shipped"));
    expect(laid.sort()).toEqual([...expected.keys()].sort());
    for (const [path, from] of expected) {
      const read = await tree.port.read(scope, `@shipped/${path}`);
      expect({ path, text: read.status === "read" ? read.text : read.status }).toEqual({ path, text: await readFile(from, "utf8") });
    }
  });

  test("laid out again at every start: an update's files reach the tree, a file no longer shipped goes, RPE's still win, and the user's files are untouched", async () => {
    tree = await layTree(KIT_SEED, place, {
      rpe: [
        { level: "shipped", path: ".prompts/kit-words.md", text: part("RPE's words.") },
        { level: "shipped", path: `${CHAT_DEFAULTS}/TURN.md`, text: "RPE's turn guidance.\n" },
      ],
    });
    await Bun.write(join(tree.sources.rph, ".prompts", "kit-words.md"), part("RPH's words."));
    await Bun.write(join(tree.sources.rph, "RETIRED.md"), "Shipped once.\n");
    const { sources } = tree;
    await tree.close();
    tree = await layTree(KIT_SEED, place);
    expect(await tree.port.read(scope, "@shipped/TURN.md")).toMatchObject({ status: "read", text: "RPE's turn guidance.\n" });
    expect(await tree.port.read(scope, "@shipped/.prompts/kit-words.md")).toMatchObject({ status: "read", text: part("RPE's words.") });
    expect(await tree.port.read(scope, "@shipped/RETIRED.md")).toMatchObject({ status: "read" });

    // An update: RPH's narrator changes, RPH stops shipping a file, RPE's words change.
    await Bun.write(join(sources.rph, ".agents", "narrator.md"), agent("The updated narrator.", "Updated."));
    await rm(join(sources.rph, "RETIRED.md"));
    await Bun.write(join(sources.rpe, ".prompts", "kit-words.md"), part("RPE's newer words."));
    await tree.close();
    tree = await layTree(KIT_SEED, place);
    expect(await tree.port.read(scope, "@shipped/.agents/narrator.md")).toMatchObject({ status: "read", text: agent("The updated narrator.", "Updated.") });
    expect(await tree.port.read(scope, "@shipped/RETIRED.md")).toEqual({ status: "missing", path: "@shipped/RETIRED.md" });
    expect(await tree.port.read(scope, "@shipped/.prompts/kit-words.md")).toMatchObject({ status: "read", text: part("RPE's newer words.") });
    expect(await tree.port.read(scope, "@shipped/TURN.md")).toMatchObject({ status: "read", text: "RPE's turn guidance.\n" });
    for (const f of KIT_SEED.files.filter((f) => f.level !== "shipped")) {
      expect(await tree.port.read(scope, `${f.level === "chat" ? "" : `@${f.level}/`}${f.path}`)).toMatchObject({ status: "read", text: f.text });
    }
    // Nothing of the copy is left beside the tree.
    expect(await readdir(tree.scratch)).toEqual([]);
    expect((await stat(join(tree.levelDir("shipped"), ".agents", "narrator.md"))).mode & 0o222).toBe(0);
  });

  test("a user's prompt part of a name replaces the shipped one, as RPE's guidance reader finds it through the port", async () => {
    tree = await layTree(KIT_SEED, place, { rpe: [{ level: "shipped", path: ".prompts/kit-words.md", text: part("Shipped words.") }] });
    expect((await loadGuidance(tree.port, scope).part("kit-words"))?.source).toMatchObject({ level: "shipped", path: "@shipped/.prompts/kit-words.md" });
    await Bun.write(join(tree.levelDir("global"), ".prompts", "kit-words.md"), part("The user's words."));
    expect((await loadGuidance(tree.port, scope).part("kit-words"))?.source).toMatchObject({ level: "global", path: "@global/.prompts/kit-words.md" });
    // The shipped file is still there, read-only, to read and copy from.
    expect(await tree.port.read(scope, "@shipped/.prompts/kit-words.md")).toMatchObject({ status: "read", level: "shipped" });
  });

  test("a part switched off in the user's config is not found", async () => {
    tree = await layTree(KIT_SEED, place, { rpe: [{ level: "shipped", path: ".prompts/kit-words.md", text: part("Shipped words.") }] });
    expect(await loadGuidance(tree.port, scope).part("kit-words")).toBeDefined();
    await Bun.write(join(tree.levelDir("global"), "RPE-global.yml"), "stack:\n  off: [.prompts/kit-words.md]\n");
    expect(await loadGuidance(tree.port, scope).part("kit-words")).toBeUndefined();
  });
});
