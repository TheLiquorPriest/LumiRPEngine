// The shipped guidance is the product's behaviour, and a user edits it. RPH's own loader is run over the
// set as RPE lays it (RPH's `guidance/` first, RPE's over it, `chat-defaults/` at the root; `set.ts`),
// so what is found here is what an agent is given. Each check names a way the set can depart from
// Appendix E and D.2, and is shown to fail on a scratch copy of the set that breaks it. Words are the
// next test file's (`texts.test.ts`); this one is the form, the files present, the rules in force, and
// who reads what.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { basename } from "node:path";
import { changed, type LoaderGuidance, openSet, type OpenSet, shippedTexts, split } from "./set";
import { DREAM, REFLECT, RECALL, REMEMBER } from "../../src/cast/memories";
import { MIND_SET, RELATE } from "../../src/cast/own";
import { LORE_INDEX_WRITE } from "../../src/lore/tools";
import { HOME_FILES, REMINDERS } from "./homes";

/** Appendix E, file by file, as the shipped level holds them (E.1 to E.6). */
const APPENDIX_E: readonly string[] = [
  // E.1 and E.2
  "ALL-AGENTS.md",
  ".rules/consent.md",
  ".agents/author.md",
  "TURN.md",
  "WRITING.md",
  "SIMULATION.md",
  "WORLD.md",
  "SWIPE.md",
  "DELETE.md",
  "PRESET.md",
  ".rules/perceptions.md",
  // E.3: in force, then the examples
  ".rules/perceptions-owed.md",
  ".rules/perceptions-missing.md",
  ".rules/memory-owed.md",
  ".rules/memory-late.md",
  ".rules/memory-scene-end.md",
  ".rules/dream-due.md",
  ".rules/unsourced.md",
  ".rules/engine-silent.md",
  ".rules/intent-owed.md",
  ".rules/reply-missing.md",
  ".rules/history-leaving.md",
  ".rules/save-before-compaction.md",
  ".rules/examples/no-player-voice.md",
  ".rules/examples/banned-phrases.md",
  ".rules/examples/memory-nudge.md",
  ".rules/examples/scene-too-long.md",
  // E.4
  ".agents/gm.md",
  ".agents/character.md",
  ".agents/narrator.md",
  ".agents/keeper.md",
  ".agents/historian.md",
  ".agents/indexer.md",
  ".agents/mapper.md",
  ".agents/assistant.md",
  // E.5
  ...["sandbox", "long-input", "scene-end", "chapter-pass", "bootstrap", "casting", "lore-proposals", "places-and-maps", "economy", "items-and-wardrobe", "vehicles", "ruleset-and-sheets", "combat", "quests", "time", "groups"].map((name) => `.skills/${name}/SKILL.md`),
  // E.6
  ...["reply-contract", "prompt-frame", "briefing", "world-state", "lore-map", "delegate-brief", "question", "compaction", "continue-after-rule", "carried", "progress", "notices", "judge", "engine-answers"].map((name) => `.prompts/${name}.md`),
];

/** The rules in force at the shipped level (E.1, E.2, E.3): the two for the agents, and the reminders. */
const IN_FORCE = ["consent", "perceptions", "perceptions-owed", "perceptions-missing", "memory-owed", "memory-late", "memory-scene-end", "dream-due", "unsourced", "engine-silent", "intent-owed", "reply-missing", "history-leaving", "save-before-compaction"];

/** The examples the build added beyond E.3's four, for the owner's approval: two on the Author's record of a turn, one on what is left of its limits. */
const BUILD_EXAMPLES = [".rules/examples/intent-missing.md", ".rules/examples/turn-unrecorded.md", ".rules/examples/limits-left.md"];

const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * The header fields of a prompt part or a tool file that something reads besides a template of the file's
 * own: its description and format; a tool's `arguments`; a lines part's `lines` and `keys` (RPE's words for a state line); and the fields code reads
 * of one part by name (RPH's judge reads `yes`, its briefing `record`, its prompt map `views`, its turn the
 * reply contract's `tags` and `intent_file`; RPE's briefing `on_stage_views`).
 */
const READ_BY_CODE: Record<string, true> = { description: true, format: true, arguments: true, lines: true, keys: true, yes: true, record: true, views: true, tags: true, intent_file: true, on_stage_views: true };

/** The definitions' names, in the order E.4 lists them. */
const AGENTS = ["author", "gm", "character", "narrator", "keeper", "historian", "indexer", "mapper", "assistant"];
/** Build's five model jobs' definitions (R-171), beyond App. C's nine. */
const BUILD_JOBS = ["build-import-lore", "build-index-text", "build-refine", "build-describe-map", "build-propose-routines"];

/** Whether a template in a file's text puts in or tests a field by this name. */
function names(text: string, field: string): boolean {
  return new RegExp(`\\{\\{[#^]?${field}[.}]`).test(text);
}

/** Every way the set departs from what these checks hold it to, each as `kind: where: what`. */
async function departures(texts: ReadonlyMap<string, string>): Promise<string[]> {
  const out: string[] = [];
  for (const path of APPENDIX_E) if (!texts.has(path)) out.push(`missing: ${path}`);
  const set = await openSet(texts);
  try {
    const guidance = set.guidance();
    for (const problem of await guidance.problems()) out.push(`problem: ${problem.path}: ${problem.message}`);
    out.push(...(await inForce(guidance)));
    out.push(...(await reads(guidance, texts)));
  } finally {
    await set.close();
  }
  out.push(...fields(texts));
  out.push(...tags(texts));
  return out;
}

/** The rules in force are those of E.1 to E.3; a rule that needs a file names one in force. */
async function inForce(guidance: LoaderGuidance): Promise<string[]> {
  const out: string[] = [];
  const rules = await guidance.rules();
  const now = rules.filter((rule) => rule.inForce).map((rule) => rule.name).sort();
  if (JSON.stringify(now) !== JSON.stringify([...IN_FORCE].sort())) out.push(`rules: in force are ${now.join(", ")}`);
  for (const rule of rules) if (rule.why === "needs") out.push(`needs: ${rule.path} names a file that is not in force`);
  return out;
}

/** Every definition names its model and effort; who holds a tool reads the file for every agent and the rules, and who holds none reads neither. */
async function reads(guidance: LoaderGuidance, texts: ReadonlyMap<string, string>): Promise<string[]> {
  const out: string[] = [];
  for (const name of AGENTS) {
    const path = `.agents/${name}.md`;
    const definition = await guidance.definition(name);
    if (definition === undefined) {
      out.push(`definition: ${path} is not in force`);
      continue;
    }
    if (typeof definition.model !== "string" || definition.model === "") out.push(`model: ${path} names no model`);
    if (definition.effort === undefined || !EFFORTS.includes(definition.effort)) out.push(`effort: ${path} names no effort`);
    const holds = definition.tools.length > 0;
    for (const file of ["ALL-AGENTS", "rules"]) if (definition.reads.includes(file) !== holds) out.push(`reads: ${path} ${holds ? "holds a tool and does not read" : "holds none and reads"} ${file}`);
    // Only a definition that names a reply tool reaches the reply family; the GM's and the keeper's searches find no sub-agent either.
    const replies = definition.tools.some((tool) => tool === "write_reply" || tool === "reply_release");
    if (holds && !replies && !definition.outOfReach.includes("reply")) out.push(`reach: ${path} does not keep the reply family out of its reach`);
    if (replies && definition.outOfReach.includes("reply")) out.push(`reach: ${path} names a reply tool and keeps the family out`);
    if ((name === "gm" || name === "keeper") && !definition.outOfReach.includes("agents")) out.push(`reach: ${path} does not keep the agents family out of its reach`);
  }
  return out;
}

/** A header field of a file that nothing reads, and the file does not describe. */
function fields(texts: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [path, text] of texts) {
    if (!path.endsWith(".md")) continue;
    // A header that does not parse is the loader's problem, reported by `problems()`.
    const header = (() => {
      try {
        return split(text).header;
      } catch {
        return null;
      }
    })();
    if (header === null) continue;
    // The loader reports a field of a definition, a skill or a rule it does not read; a part's or a tool's it takes without a word.
    if (!path.startsWith(".prompts/") && !path.startsWith(".tools/")) continue;
    for (const field of Object.keys(header)) {
      const described = typeof header.description === "string" && header.description.includes(field);
      if (READ_BY_CODE[field] !== true && !names(text, field) && !described) out.push(`field: ${path}: ${field} is read by nothing`);
    }
  }
  return out;
}

/** The reply's tags are named in the reply contract and nowhere else (E.6). */
function tags(texts: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  const named = /<\/?(reply|intent)>/;
  for (const [path, text] of texts) if (path !== ".prompts/reply-contract.md" && named.test(text)) out.push(`tags: ${path} names a tag of the reply`);
  return out;
}

const SHIPPED = shippedTexts();

let set: OpenSet;
let guidance: LoaderGuidance;
beforeAll(async () => {
  set = await openSet(SHIPPED);
  guidance = set.guidance();
});
afterAll(() => set.close());

describe("the shipped set, as RPH's loader reads it, as RPE lays it", () => {
  test("holds every file of Appendix E and nothing departs from what the checks below hold it to", async () => {
    expect(await departures(SHIPPED)).toEqual([]);
  });

  test("every file loads with no problem reported", async () => {
    expect(await guidance.problems()).toEqual([]);
  });

  test("the rules in force at the shipped level are `consent`, `perceptions` and the seven of E.3, and no others; the three the build added are examples", async () => {
    const rules = await guidance.rules();
    expect(rules.filter((rule) => rule.inForce).map((rule) => rule.name).sort()).toEqual([...IN_FORCE].sort());
    for (const path of BUILD_EXAMPLES) expect(rules.find((rule) => rule.path.endsWith(path.slice(1)))).toMatchObject({ inForce: false, why: "example" });
  });

  test("every home D.2 names is a file of the shipped set, and every reminder's `needs:` names the home D.2 gives it", () => {
    for (const home of HOME_FILES) expect({ home, ships: SHIPPED.has(home) }).toEqual({ home, ships: true });
    for (const reminder of REMINDERS) {
      const header = split(SHIPPED.get(reminder.file) ?? "").header;
      expect({ file: reminder.file, needs: header?.needs ?? null }).toEqual({ file: reminder.file, needs: reminder.needs });
    }
    // The six reminders are the rules in force but the three that are no reminder: the two every agent reads, and the one before a compaction.
    const reminding = IN_FORCE.filter((name) => !["consent", "perceptions", "save-before-compaction"].includes(name)).map((name) => `.rules/${name}.md`);
    expect(reminding.sort()).toEqual(REMINDERS.map((reminder) => reminder.file).sort());
  });

  test("every definition names its model and effort, and nothing else sets them", async () => {
    for (const name of AGENTS) {
      const definition = await guidance.definition(name);
      expect({ name, model: typeof definition?.model, effort: EFFORTS.includes(definition?.effort ?? "") }).toEqual({ name, model: "string", effort: true });
    }
  });

  test("every definition with a tool lists `ALL-AGENTS`, `rules` and `AGENTS` in `reads`; one with none lists none of them", async () => {
    for (const name of AGENTS) {
      const definition = await guidance.definition(name);
      const holds = (definition?.tools.length ?? 0) > 0;
      expect({ name, holds, all: definition?.reads.includes("ALL-AGENTS"), rules: definition?.reads.includes("rules"), agents: definition?.reads.includes("AGENTS") }).toEqual({ name, holds, all: holds, rules: holds, agents: holds });
    }
    expect((await guidance.definition("narrator"))?.tools).toEqual([]);
  });

  test("only the Author's definition reaches the reply family, and the GM's and the keeper's searches find no `delegate` or `agent_message`", async () => {
    expect((await departures(SHIPPED)).filter((d) => d.startsWith("reach:"))).toEqual([]);
    expect((await guidance.definition("author"))?.tools).toEqual(expect.arrayContaining(["write_reply", "reply_release"]));
    for (const name of ["gm", "keeper"]) expect({ name, held: (await guidance.definition(name))?.tools.filter((tool) => tool === "delegate" || tool === "agent_message") }).toEqual({ name, held: [] });
  });

  test("the Author names its writer, and the writer is a definition in force", async () => {
    const writer = (await guidance.definition("author"))?.writer;
    expect(writer).toBe("narrator");
    expect(await guidance.definition(writer ?? "")).toBeDefined();
  });

  test("a header field that RPH's loader does not read and the file does not describe is found (the `family:` line of a tool file)", () => {
    expect(fields(SHIPPED)).toEqual([]);
    const withFamily = (SHIPPED.get(".tools/map_measure.md") ?? "").replace("---\n", "---\nfamily: map\n");
    expect(fields(changed(SHIPPED, { ".tools/map_measure.md": withFamily }))).toEqual([".tools/map_measure.md: family is read by nothing"].map((m) => `field: ${m}`));
  });

  test("the reply's tags are named in the reply contract and nowhere else", () => {
    expect(tags(SHIPPED)).toEqual([]);
    expect(tags(changed(SHIPPED, { "WRITING.md": `${SHIPPED.get("WRITING.md")}\nWrite it between <reply> and </reply>.\n` }))).toEqual(["tags: WRITING.md names a tag of the reply"]);
  });
});

describe("each check fails on a scratch copy of the set that breaks it", () => {
  const one = async (texts: ReadonlyMap<string, string>, kind: string): Promise<string[]> => (await departures(texts)).filter((d) => d.startsWith(`${kind}:`));

  test("a file of Appendix E taken away: `TURN.md`", async () => {
    expect(await one(changed(SHIPPED, { "TURN.md": null }), "missing")).toEqual(["missing: TURN.md"]);
  });

  test("a rule put back in force that the plan does not list", async () => {
    const back = changed(SHIPPED, { ".rules/turn-unrecorded.md": SHIPPED.get(".rules/examples/turn-unrecorded.md") ?? "" });
    expect((await one(back, "rules"))[0]).toContain("turn-unrecorded");
    const intent = changed(SHIPPED, { ".rules/intent-missing.md": SHIPPED.get(".rules/examples/intent-missing.md") ?? "" });
    expect((await one(intent, "rules"))[0]).toContain("intent-missing");
  });

  test("a rule that needs a file that is gone: `engine-silent` with `TURN.md` taken away", async () => {
    expect(await one(changed(SHIPPED, { "TURN.md": null }), "needs")).not.toEqual([]);
  });

  test("a definition with no effort, and a definition with a tool that does not read the rules", async () => {
    const author = SHIPPED.get(".agents/author.md") ?? "";
    expect(await one(changed(SHIPPED, { ".agents/author.md": author.replace("effort: max\n", "") }), "effort")).toEqual(["effort: .agents/author.md names no effort"]);
    const indexer = SHIPPED.get(".agents/indexer.md") ?? "";
    expect(await one(changed(SHIPPED, { ".agents/indexer.md": indexer.replace("reads: [ALL-AGENTS, rules, AGENTS]", "reads: []") }), "reads")).toEqual([
      "reads: .agents/indexer.md holds a tool and does not read ALL-AGENTS",
      "reads: .agents/indexer.md holds a tool and does not read rules",
    ]);
  });

  test("a definition that releases no reply and does not keep the reply family out, and a GM that reaches the agents family", async () => {
    const gm = SHIPPED.get(".agents/gm.md") ?? "";
    expect(await one(changed(SHIPPED, { ".agents/gm.md": gm.replace("out_of_reach: [reply, agents]", "out_of_reach: [agents]") }), "reach")).toEqual(["reach: .agents/gm.md does not keep the reply family out of its reach"]);
    expect(await one(changed(SHIPPED, { ".agents/gm.md": gm.replace("out_of_reach: [reply, agents]", "out_of_reach: [reply]") }), "reach")).toEqual(["reach: .agents/gm.md does not keep the agents family out of its reach"]);
    const author = SHIPPED.get(".agents/author.md") ?? "";
    expect(await one(changed(SHIPPED, { ".agents/author.md": author.replace("reads: [", "out_of_reach: [reply]\nreads: [") }), "reach")).toEqual(["reach: .agents/author.md names a reply tool and keeps the family out"]);
  });

  test("a header that does not parse is a problem reported", async () => {
    const broken = (SHIPPED.get(".prompts/progress.md") ?? "").replace("---\n", "---\ndescription: [unclosed\n");
    expect((await one(changed(SHIPPED, { ".prompts/progress.md": broken }), "problem")).length).toBeGreaterThan(0);
  });
});

test("the shipped definitions are App. C's nine and Build's five, and no other: RPH ships none", () => {
  expect([...SHIPPED.keys()].filter((path) => path.startsWith(".agents/")).map((path) => basename(path, ".md")).sort()).toEqual([...AGENTS, ...BUILD_JOBS].sort());
});

test("the Author's fixed tools, as RPH's loader reads them, are §6.8's thirty, name for name", async () => {
  const fixed = [
    "prompt", "chat_read", "chat_search", "lore_read", "lore_search", "archive_search", "web_search", "gap_check", "delegate", "agent_message",
    "write_reply", "reply_release", "file_read", "file_find", "file_write", "skill_load", "job_start", "suggest", "todo", "tool_search", "tool_use",
    "world_query", "world_search", "world_apply", "roll", "story_query", "story_record", "cast_query", "cast_update", "perceive",
  ];
  expect(fixed).toHaveLength(30);
  expect([...((await guidance.definition("author"))?.tools ?? [])].sort()).toEqual([...fixed].sort());
});

test("the Author's search finds no character's own tool, nor the mapper's or the indexer's writer", async () => {
  const author = await guidance.definition("author");
  const kept = [RECALL, REMEMBER, REFLECT, DREAM, MIND_SET, RELATE, LORE_INDEX_WRITE].map((tool) => ({ name: tool.name, family: tool.family }));
  // The mapper's writer is RPH's, of its family `prompt`.
  kept.push({ name: "prompt_map_write", family: "prompt" });
  for (const tool of kept) expect({ tool: tool.name, held: author?.tools.includes(tool.name), kept: author?.outOfReach.includes(tool.family) }).toEqual({ tool: tool.name, held: false, kept: true });
});

test("every rule that reminds of a D.2 behaviour, examples included, names that behaviour's home in `needs:`; one that reminds of none names none", () => {
  const needs: Record<string, string | null> = {
    ".rules/examples/memory-nudge.md": "perceptions",
    ".rules/examples/no-player-voice.md": "ALL-AGENTS",
    ".rules/examples/scene-too-long.md": "TURN",
    ".rules/examples/intent-missing.md": "TURN",
    ".rules/examples/turn-unrecorded.md": "TURN",
    ".rules/examples/banned-phrases.md": null,
    ".rules/examples/limits-left.md": null,
  };
  for (const [file, home] of Object.entries(needs)) expect({ file, needs: split(SHIPPED.get(file) ?? "").header?.needs ?? null }).toEqual({ file, needs: home });
});
