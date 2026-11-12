// Every agent of the harness engine's cast holds the tools its texts tell it to use. A model told to
// call a tool it doesn't hold can't call it, so each text an agent is given is held to that agent's
// own tools as LumiAH gives them in a chat the engine plays: its instructions; what the engine adds
// to them for a chat (its part of the preset, how a moment is narrated or how it speaks on the direct
// line, the author's opening), in every setting that changes them; the world's guidance, which every
// agent reads; each skill it is offered; and, for an agent that starts others, what each of them is
// for. A tool is found in a text by its name as a whole word, among every tool there is (the
// engine's and LumiAH's), so a new tool or a new text is held to this with nothing to change here.
// A word written like a tool's name that names none is a tool that no longer exists.
//
// A text that tells a model to start an agent (`delegate` or `job_start` with its id) names one that
// exists and that the told agent can start. Every tool the engine registers is held by at least one
// agent, or is named in `NOBODYS` with why. Each check fails with a list of what is wrong.

import { describe, expect, test } from "bun:test";
import { AGENT, BASE_TOOLS, baseAgents, SCRATCH_READ, TOOL } from "lumi-ah/core";
import { HARNESS_LISTED } from "../../src/backend/agents/tools/harness";
import { harnessDefinitions } from "../../src/backend/harness/definitions";
import { chatAdditions, LUMIAH_WITHDRAWN } from "../../src/backend/harness/extension";
import type { AgentDefinition, Skill } from "../../src/backend/harness/shapes";
import { renderPrompt } from "../../src/backend/prompts";
import type { StoryPresetRead } from "../../src/backend/story/preset";
import { HARNESS_AGENT_IDS, HARNESS_SKILL_AGENTS, HARNESS_TEXT } from "../../src/shared/harness-texts";
import { PREPARE_NOTE } from "../../src/shared/harness-texts-prepare";
import { STAGE_TEXT } from "../../src/shared/harness-texts-stage";
import { PROMPT_SETTINGS_DEFAULTS, PROMPTS } from "../../src/shared/prompts";
import { DIRECT_LINE_PASSAGES, NARRATION_CHECKS, NARRATION_DEFAULTS } from "../../src/shared/settings";

/**
 * The tools the engine registers that no agent of the cast is given, each with why. A tool lands
 * here only when no agent should hold it; a tool someone should hold goes in that agent's list.
 */
const NOBODYS: Readonly<Record<string, string>> = {};

const shipped = (id: string): string => renderPrompt(id, {}, {});

/** Every tool a chat the engine plays has, by name, with its family: LumiAH's own but those the claim withdraws, then the engine's, whose own of a name stands in for LumiAH's. */
const FAMILIES: ReadonlyMap<string, string> = new Map([...BASE_TOOLS.filter((t) => !LUMIAH_WITHDRAWN.includes(t.name)).map((t): [string, string] => [t.name, t.family]), ...HARNESS_LISTED.map((t): [string, string] => [t.name, t.family])]);

/** Every tool's name a text may hold: the engine's, LumiAH's (those withdrawn here too, so a text that names one is caught), and the one LumiAH gives any agent with tools. */
const KNOWN: readonly string[] = [...new Set([...HARNESS_LISTED.map((t) => t.name), ...BASE_TOOLS.map((t) => t.name), SCRATCH_READ])];

/** Every family a definition may name a tool by. */
const KNOWN_FAMILIES = new Set([...HARNESS_LISTED.map((t) => t.family), ...BASE_TOOLS.map((t) => t.family)]);

const whole = (word: string): RegExp => new RegExp(`(?<![A-Za-z0-9_-])${word}(?![A-Za-z0-9_-])`);

/** The tools `text` names, in the order of `KNOWN`. */
const named = (text: string): string[] => KNOWN.filter((name) => whole(name).test(text));

/** The agents a chat the engine plays has: the cast, and LumiAH's own (its chronicler and story reader are left out where the engine is mounted, and aren't among these). */
const { agents: CAST, skills: SKILLS } = harnessDefinitions({});
const AGENTS: readonly string[] = [...CAST.map((a) => a.id), ...baseAgents().map((a) => a.id)];

/** A word written like a tool's name: two or more parts joined by `_`, the first one a tool's first part. A word of the kind that isn't a tool's (an agent's id, a skill's) is no tool. */
const FIRST_PARTS = new Set(KNOWN.map((name) => name.split("_")[0] ?? name));
const NOT_TOOLS = new Set([...AGENTS, ...SKILLS.map((s) => s.id)]);
const unknownTools = (text: string): string[] => [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])].filter((word) => FIRST_PARTS.has(word.split("_")[0] ?? "") && !KNOWN.includes(word) && !NOT_TOOLS.has(word));

/** What an agent of `definition` holds in a chat the engine plays: each tool its list names, every tool of a family it names, and `scratch_read` once it holds any. */
function holds(definition: AgentDefinition): Set<string> {
  const out = new Set<string>();
  for (const name of definition.tools) {
    if (name.startsWith("@")) for (const [tool, family] of FAMILIES) if (`@${family}` === name) out.add(tool);
    if (FAMILIES.has(name)) out.add(name);
  }
  if (out.size > 0) out.add(SCRATCH_READ);
  return out;
}

/** The skills offered to an agent of `definition`: none without `skill_load`, else each skill whose agents name it (every skill, where a skill names none). */
const offered = (definition: AgentDefinition): Skill[] => (holds(definition).has(TOOL.skillLoad) ? SKILLS.filter((s) => s.agents === undefined || s.agents.includes(definition.id)) : []);

/** The agents an agent of `definition` can start, and by which tool: `delegate` any agent but itself, `job_start` any; neither LumiAH's main agent nor its writer. */
function starts(definition: AgentDefinition, tool: string, target: string): boolean {
  if (!holds(definition).has(tool) || !AGENTS.includes(target) || target === AGENT.main || target === AGENT.writer) return false;
  return tool !== TOOL.delegate || target !== definition.id;
}

/** A chat's preset, read: no text of its own for any agent, and one presentation module, so each fixed line the engine adds for one is there. */
const PRESET: StoryPresetRead = { preset: { id: "preset", name: "A preset", revision: 1 }, parts: { contract: "", author: "", character: "", gm: "", narrator: "", voice: "" }, modules: [{ name: "Phone", line: "a phone's screen", text: "Show a text message as a phone shows it." }], over: [], separately: false, diagnostics: [] };

/** Every line the author's opening may hold: the moment's, the drafts due, and where the story's preparation stands. */
const OPENING = [...Object.entries(HARNESS_TEXT).flatMap(([key, id]) => (key.startsWith("opening") && typeof id === "string" ? [id] : [])), ...Object.entries(PREPARE_NOTE).flatMap(([key, id]) => (key.startsWith("turn") || key.startsWith("left") ? [id] : []))]
  .map(shipped)
  .join("\n");

/** What the engine adds to each definition for a chat, in every setting that changes it: who checks a passage, whether the author releases words of its own, and whose the direct line is. */
function additions(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const check of NARRATION_CHECKS) {
    for (const ownChars of [0, NARRATION_DEFAULTS.ownChars]) {
      for (const directLine of DIRECT_LINE_PASSAGES) {
        const settings = { narration: { ...NARRATION_DEFAULTS, check, ownChars, directLine }, prompts: PROMPT_SETTINGS_DEFAULTS };
        for (const read of [PRESET, null]) for (const [id, parts] of chatAdditions({ read, settings, opening: OPENING })) out.set(id, [...(out.get(id) ?? []), ...parts]);
      }
    }
  }
  return out;
}

/** The world's guidance, which every agent of a chat reads: each of its texts but the narration lines, which only the author is given (`chatAdditions`). */
const AUTHORS_LINES = new Set([...NARRATION_CHECKS.map(STAGE_TEXT.check), STAGE_TEXT.own, STAGE_TEXT.ownNone, ...DIRECT_LINE_PASSAGES.map(STAGE_TEXT.directLine)]);
const GUIDANCE = PROMPTS.filter((p) => (p.id === HARNESS_TEXT.guidance || p.id.startsWith(`${HARNESS_TEXT.guidance}.`)) && !AUTHORS_LINES.has(p.id));

/** Every text an agent of `definition` is given, each with where it comes from. */
function told(definition: AgentDefinition, added: ReadonlyMap<string, readonly string[]>): [string, string][] {
  const startable = CAST.filter((other) => starts(definition, TOOL.delegate, other.id) || starts(definition, TOOL.jobStart, other.id));
  return [
    ["its instructions", definition.instructions],
    ...(added.get(definition.id) ?? []).map((text): [string, string] => ["what a chat adds to its instructions", text]),
    ...GUIDANCE.map((p): [string, string] => [`the world's guidance (${p.id})`, shipped(p.id)]),
    ...offered(definition).map((s): [string, string] => [`the skill ${s.id}`, `${s.name}\n${s.description}\n${s.body}`]),
    ...startable.map((other): [string, string] => [`what ${other.id} is for`, other.description]),
  ];
}

describe("the cast holds every tool its texts tell it to use", () => {
  test("every tool and family a definition lists exists: the engine's own as it registers them, or LumiAH's", () => {
    const wrong = CAST.flatMap((a) => a.tools.filter((name) => (name.startsWith("@") ? !KNOWN_FAMILIES.has(name.slice(1)) : !KNOWN.includes(name))).map((name) => `${a.id} lists ${name}, which is no tool and no family`));
    expect(wrong).toEqual([]);
  });

  test("every tool an agent's instructions, what a chat adds to them, the world's guidance, its skills and what those it starts are for name is one it holds", () => {
    const added = additions();
    // Each agent is given something for a chat that the others aren't: the author its opening and the narration lines, a person how it speaks on the direct line, each its part of the preset.
    expect(["author", "character"].every((id) => (added.get(id) ?? []).length > 0)).toBe(true);
    const wrong = CAST.flatMap((a) => {
      const held = holds(a);
      return told(a, added).flatMap(([where, text]) => [...named(text).filter((tool) => !held.has(tool)).map((tool) => `${a.id}: ${where} names ${tool}, which it doesn't hold`), ...unknownTools(text).map((word) => `${a.id}: ${where} names ${word}, which is no tool`)]);
    });
    expect([...new Set(wrong)]).toEqual([]);
  });

  test("each skill is offered to the agents that hold every tool it names, and to at least one", () => {
    const wrong = SKILLS.flatMap((s) => {
      const to = CAST.filter((a) => offered(a).includes(s));
      return [...(to.length === 0 ? [`${s.id} is offered to no agent of the cast`] : []), ...(s.agents ?? []).filter((id) => !CAST.some((a) => a.id === id)).map((id) => `${s.id} is offered to ${id}, which is no agent of the cast`)];
    });
    expect(wrong).toEqual([]);
  });

  test("every agent a text tells a model to start exists, and the agent told so can start it", () => {
    const added = additions();
    const wrong = CAST.flatMap((a) =>
      told(a, added).flatMap(([where, text]) =>
        [...text.matchAll(/(?<![A-Za-z0-9_-])(delegate|job_start)(?![A-Za-z0-9_-])([^\n]*?)(?:[.!?](?:\s|$)|\n|$)/g)].flatMap((m) => {
          const tool = m[1] ?? "";
          const target = /\bagent\b[`"']*\s*:\s*[`"']?([A-Za-z0-9_.:-]+)/.exec(m[2] ?? "")?.[1];
          if (target === undefined) return [];
          if (!AGENTS.includes(target)) return [`${a.id}: ${where} tells it to start ${target} with ${tool}, and there is no such agent`];
          return starts(a, tool, target) ? [] : [`${a.id}: ${where} tells it to start ${target} with ${tool}, which it can't`];
        }),
      ),
    );
    expect([...new Set(wrong)]).toEqual([]);
  });

  test("every tool the engine registers is held by an agent of the cast, or is nobody's with why", () => {
    const held = new Set(CAST.flatMap((a) => [...holds(a)]));
    const wrong = [
      ...HARNESS_LISTED.filter((t) => !held.has(t.name) && !Object.hasOwn(NOBODYS, t.name)).map((t) => `${t.name} is held by no agent, and NOBODYS doesn't say why`),
      ...Object.entries(NOBODYS).flatMap(([name, why]) => [...(held.has(name) ? [`${name} is in NOBODYS, but an agent holds it`] : []), ...(HARNESS_LISTED.some((t) => t.name === name) ? [] : [`${name} is in NOBODYS, and the engine registers no such tool`]), ...(why.trim() === "" ? [`${name} is in NOBODYS with no reason`] : [])]),
    ];
    expect(wrong).toEqual([]);
  });
});

describe("the engine keeps its agents' tools and texts", () => {
  test("each definition keeps its name, what it is for, its instructions and its tools as the engine's, whatever version the user keeps; each skill is the engine's, offered to its own agents", () => {
    for (const a of CAST) expect({ id: a.id, owns: [...(a.owns ?? [])].sort() }).toEqual({ id: a.id, owns: ["description", "instructions", "name", "tools"] });
    expect(HARNESS_AGENT_IDS.length).toBe(CAST.length);
    for (const s of SKILLS) expect({ id: s.id, owned: s.owned, agents: s.agents }).toEqual({ id: s.id, owned: true, agents: HARNESS_SKILL_AGENTS[s.id] });
  });
});
