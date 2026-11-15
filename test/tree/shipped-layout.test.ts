// The one rule of the shipped level's layout (PlanGates-4-fix1 item 3): `shippedPlaces`, a pure function
// of the two shipped folders' path lists, and `layShipped`, which copies by it, agree path for path and
// source for source: on a small pair of folders holding RPE's `chat-defaults/` and a file both ship, and
// on the real shipped folders of this build.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { SHIPPED_FOLDER } from "../../src/tree/layout";
import { layShipped, RPE_GUIDANCE, shippedPlaces } from "../../src/tree/shipped";

const REPO = join(import.meta.dir, "../..");
const RPH_GUIDANCE = join(REPO, "node_modules/rp-harness/guidance");

const made: string[] = [];
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

async function folderOf(files: Record<string, string>, empty: string[] = []): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rpe-shipped-"));
  made.push(dir);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  for (const path of empty) await mkdir(join(dir, path), { recursive: true });
  return dir;
}

/** Every file below a folder, by its path below it ("/" between names), with its text. */
async function textsOf(folder: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const d of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!d.isFile()) continue;
    const at = join(d.parentPath, d.name);
    out.set(relative(folder, at).split(sep).join("/"), await readFile(at, "utf8"));
  }
  return out;
}

/** What the function says lands, read from the two folders: each place with its source's text. */
async function saidOf(rph: string, rpe: string): Promise<Map<string, string>> {
  const [rphTexts, rpeTexts] = await Promise.all([textsOf(rph), textsOf(rpe)]);
  const out = new Map<string, string>();
  for (const place of shippedPlaces([...rphTexts.keys()], [...rpeTexts.keys()])) {
    out.set(place.path, (place.from === "rph" ? rphTexts : rpeTexts).get(place.source) as string);
  }
  return out;
}

async function laid(rph: string, rpe: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rpe-shipped-tree-"));
  made.push(root);
  await layShipped(join(root, "files"), join(root, "scratch"), { rph, rpe });
  return join(root, "files", SHIPPED_FOLDER);
}

const sorted = (m: Map<string, string>): [string, string][] => [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

describe("the shipped level's one rule", () => {
  test("the function lays RPE's chat-defaults/ at the root and RPE's file over RPH's; RPH's own chat-defaults/ stays where it is", () => {
    expect(shippedPlaces(["TURN.md", "chat-defaults/A.md", ".prompts/x.md"], ["chat-defaults/TURN.md", ".prompts/x.md", ".rules/a.md"])).toEqual([
      { path: ".prompts/x.md", from: "rpe", source: ".prompts/x.md" },
      { path: ".rules/a.md", from: "rpe", source: ".rules/a.md" },
      { path: "TURN.md", from: "rpe", source: "chat-defaults/TURN.md" },
      { path: "chat-defaults/A.md", from: "rph", source: "chat-defaults/A.md" },
    ]);
  });

  test("layShipped lays a small pair of folders exactly as shippedPlaces says, path for path and source for source", async () => {
    const rph = await folderOf({
      ".prompts/prompt-frame.md": "rph frame",
      ".prompts/plan.md": "rph plan",
      ".rules/old.md": "rph rule",
      "TURN.md": "rph turn",
      "ALL-AGENTS.md": "rph all",
    });
    const rpe = await folderOf(
      {
        ".prompts/plan.md": "rpe plan",
        "chat-defaults/TURN.md": "rpe turn",
        "chat-defaults/WORLD.md": "rpe world",
        "chat-defaults/deep/NOTE.md": "rpe deep",
        "ALL-AGENTS.md": "rpe all",
        ".skills/kit/SKILL.md": "rpe skill",
      },
      [".tools"],
    );
    const shipped = await laid(rph, rpe);
    const said = await saidOf(rph, rpe);
    expect(sorted(await textsOf(shipped))).toEqual(sorted(said));
    expect(said.get("TURN.md")).toBe("rpe turn");
    expect(said.get(".prompts/plan.md")).toBe("rpe plan");
    expect(said.get(".prompts/prompt-frame.md")).toBe("rph frame");
    expect(said.get("deep/NOTE.md")).toBe("rpe deep");
    expect(await stat(join(shipped, "chat-defaults")).catch(() => null)).toBeNull();
    expect((await stat(join(shipped, ".tools"))).isDirectory()).toBe(true);
  });

  test("the real shipped folders of this build are laid exactly as shippedPlaces says", async () => {
    const shipped = await laid(RPH_GUIDANCE, RPE_GUIDANCE);
    const said = await saidOf(RPH_GUIDANCE, RPE_GUIDANCE);
    expect(said.has("TURN.md")).toBe(true);
    expect(sorted(await textsOf(shipped))).toEqual(sorted(said));
  });
});
