// What the migration does with the models and files of his own agents: every place that names a connection is found and matched with RPE's,
// and one press writes an attached file where its kind is read from, never over a name in force.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findChoices, matcherOf } from "../../src/migrate/model-choices";
import { switchOn } from "../../src/migrate/switch-on";

const RPE = [
  { id: "mine-1", name: "Mine", provider: "anthropic", model: "claude-small" },
  { id: "mine-2", name: "Local", provider: "openai-compatible", model: "tiny", baseUrl: "http://127.0.0.1:8080/v1/" },
];
const PROFILES = [
  { id: "lv-1", name: "Small", provider: "anthropic", url: "", model: "claude-small" },
  { id: "lv-2", name: "Local", provider: "custom", url: "http://127.0.0.1:8080/v1", model: "tiny" },
  { id: "lv-3", name: "Big", provider: "anthropic", url: "", model: "claude-big" },
];

describe("a model choice", () => {
  test("is found wherever a setting or an agent of his names a connection, and carried to RPE's connection of the same id or of the same provider, model and address; the rest are listed", () => {
    const engine = { helper: { connectionId: "lv-1", model: null }, story: { models: { default: { connectionId: "lv-2" } } } };
    const harness = { v: 1, own: [{ path: ["core", "agents", "scout", "connectionId"], value: "mine-1" }, { path: ["core", "connections", "throttles", "lv-3"], value: { atOnce: 2 } }], definitions: { agents: { scout: { connectionId: "gone-1", model: "x" } } } };
    const found = findChoices(engine, harness);
    expect(found.map((f) => f.where)).toEqual(["settings.json: helper.connectionId", "settings.json: story.models.default.connectionId", "harness/settings.json: core.agents.scout.connectionId", "harness/settings.json: core.connections.throttles.lv-3", "agent scout of his own"]);
    const match = matcherOf(PROFILES, RPE);
    expect(found.map((f) => match(f).carried?.id ?? null)).toEqual(["mine-1", "mine-2", "mine-1", null, null]);
    expect(match(found[4] as never).why).toContain("neither RPE nor Lumiverse");
    expect(match(found[3] as never).why).toContain("claude-big");
  });
});

describe("switching an attached file on", () => {
  const folders: string[] = [];
  afterEach(async () => {
    for (const f of folders.splice(0)) await rm(f, { recursive: true, force: true });
  });
  const tree = async (): Promise<{ root: string; shipped: string; written: [string, string][]; deps: Parameters<typeof switchOn>[1] }> => {
    const base = await mkdtemp(join(tmpdir(), "rpe-switch-on-"));
    folders.push(base);
    const [root, shipped] = [join(base, "files"), join(base, "defaults")];
    const written: [string, string][] = [];
    const deps = {
      root,
      shipped,
      folders: { agents: ".agents", skills: ".skills" },
      write: async (path: string, text: string) => {
        written.push([path, text]);
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), text);
        return path;
      },
    };
    return { root, shipped, written, deps };
  };
  const put = async (base: string, path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(base, path)), { recursive: true });
    await writeFile(join(base, path), text);
  };

  test("writes GUIDANCE.md as AGENTS.md, an agent and a skill where they are read, keeps the attached files, and never writes over a name in force", async () => {
    const { root, shipped, written, deps } = await tree();
    await put(root, "imported/GUIDANCE.md", "Keep the fog grey.");
    await put(root, "imported/agents/scout.md", "---\nname: scout\n---\nWalk ahead.\n");
    await put(root, "imported/skills/tides/SKILL.md", "---\nname: tides\n---\nRead the table.\n");
    await put(root, "imported/agents/gm.md", "His gm.");
    await put(shipped, ".agents/gm.md", "RPE's gm.");
    expect(await switchOn("imported/GUIDANCE.md", deps)).toEqual({ switched: true, from: "imported/GUIDANCE.md", to: "AGENTS.md" });
    expect((await switchOn("imported/agents/scout.md", deps)).switched).toBe(true);
    expect((await switchOn("imported/skills/tides/SKILL.md", deps)).switched).toBe(true);
    expect(written.map(([path]) => path)).toEqual(["AGENTS.md", ".agents/scout.md", ".skills/tides/SKILL.md"]);
    expect(await readFile(join(root, ".agents/scout.md"), "utf8")).toBe(await readFile(join(root, "imported/agents/scout.md"), "utf8"));
    // A second press finds his own file in force; a name RPE ships is shown beside his, and nothing is written either time.
    expect(await switchOn("imported/agents/scout.md", deps)).toMatchObject({ switched: false, inForce: { level: "global" } });
    expect(await switchOn("imported/agents/gm.md", deps)).toMatchObject({ switched: false, inForce: { level: "shipped", text: "RPE's gm." }, attached: "His gm." });
    expect(written).toHaveLength(3);
    await expect(switchOn("imported/.prompts/x.md", deps)).rejects.toThrow("cannot be switched on");
  });
});
