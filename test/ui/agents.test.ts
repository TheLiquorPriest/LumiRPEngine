// The Agents page: a definition's file made again from the form (fields set, added or taken out, the rest of the header and the comments left as they
// were, a field over several lines left alone), what a definition runs on in words, and a tool nobody registers marked.

import { describe, expect, test } from "bun:test";
import type { ListedDefinition, RegisteredTool } from "rp-harness/contract";
import { runsWords, sortedAgents, toolStanding } from "../../src/ui/pages/agents";
import { listLine, rewrite, splitFile } from "../../src/ui/pages/agents/header";

const FILE = `---\nname: gm\ndescription: Runs the world.\nmodel: default\n# the effort\neffort: medium\ntools: [world_apply, archive_search]\nreads:\n  - ALL-AGENTS\n---\nYou run the world.\n`;

describe("a definition's file made again", () => {
  test("a field set is changed on its own line, a new one added, one taken out; the comment, the other lines and the text stay", () => {
    const made = rewrite(FILE, { model: "Flash", effort: null, tools: listLine(["world_apply"]), given: listLine(["world:scene"]) });
    expect(made.text).toBe(`---\nname: gm\ndescription: Runs the world.\nmodel: Flash\n# the effort\ntools: [world_apply]\nreads:\n  - ALL-AGENTS\ngiven: [world:scene]\n---\nYou run the world.\n`);
    expect(made.kept).toEqual([]);
  });

  test("a field written over several lines is left as it is and named, and the text is replaced where the page edited it", () => {
    const made = rewrite(FILE, { reads: listLine(["TURN"]) }, "You run it all.\n");
    expect(made.kept).toEqual(["reads"]);
    expect(splitFile(made.text).body).toBe("You run it all.\n");
    expect(made.text).toContain("  - ALL-AGENTS");
  });
});

describe("what a definition runs on", () => {
  const agent = (over: Partial<ListedDefinition> = {}): ListedDefinition => ({ name: "gm", description: "", path: "p", level: "shipped", replaces: [], off: false, tools: [], reads: [], given: [], runsOn: { connection: { id: "c1", name: "Flash" }, model: "deepseek-v4-flash", effort: "medium", sent: "medium" }, ...over });

  test("the connection, model and effort are said, and a definition with no connection says so; those in force come first", () => {
    expect(runsWords(agent())).toBe("Flash · deepseek-v4-flash · medium");
    expect(runsWords(agent({ runsOn: { connection: null, model: null, effort: null, sent: null } }))).toBe("no connection resolves");
    expect(sortedAgents([agent({ name: "b", off: true }), agent({ name: "c" }), agent({ name: "a" })]).map((a) => a.name)).toEqual(["a", "c", "b"]);
  });

  test("a tool nobody registers is marked, one the registry holds says its family and whose it is", () => {
    const registered: RegisteredTool[] = [{ name: "world_apply", family: "world", from: "rph" }];
    expect(toolStanding("archive_search", registered)).toMatchObject({ tool: null, text: "nobody registers it, so it is not offered" });
    expect(toolStanding("world_apply", registered).text).toBe("world, RPH's own");
  });
});
