// What the harness engine registers with LumiAH (`harnessDefinitions`, `harnessRole`,
// `worldGuidance`): each definition is given tools that exist and no more than its part needs; every
// name, description, instruction and skill is a registry text the user may replace; the texts name
// only tools, agents and skills that exist; and the world's guidance reads the chat's own rules.

import { describe, expect, test } from "bun:test";
import { HARNESS_LISTED, harnessTools } from "../../src/backend/agents/tools/harness";
import { HARNESS_AGENT, harnessDefinitions, harnessRole, worldGuidance } from "../../src/backend/harness/definitions";
import { LUMIAH_FAMILY, LUMIAH_TOOL } from "../../src/backend/harness/definitions/lumiah";
import type { AgentDefinition } from "../../src/backend/harness/shapes";
import { harnessSkills } from "../../src/backend/harness/skills";
import { renderPrompt } from "../../src/backend/prompts";
import { toolGuideId } from "../../src/shared/agent-tools";
import { HARNESS_AGENT_IDS, HARNESS_FAMILY, HARNESS_PAGE, HARNESS_PROMPTS, HARNESS_SKILL_IDS, HARNESS_TEXT, HARNESS_TOOL } from "../../src/shared/harness-texts";
import { STORY_TOOL } from "../../src/shared/harness-texts-story";
import { isRecord, type JsonValue } from "../../src/shared/json";
import { PROMPT_PAGES, promptDef, promptProblems } from "../../src/shared/prompts";
import { policyOf } from "../../src/engine/adjudication";
import { presetOf } from "../../src/engine/realism";
import { stateOf } from "../support/mind-chat";
import { alderChat, POV } from "../support/tools";

const shipped = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);
const families = new Set(HARNESS_LISTED.map((t) => t.family));
const lumiah = { tools: new Set<string>(Object.values(LUMIAH_TOOL)), families: new Set<string>(Object.values(LUMIAH_FAMILY)) };
const definition = (id: string, agents: readonly AgentDefinition[] = harnessDefinitions({}).agents): AgentDefinition => {
  const found = agents.find((a) => a.id === id);
  if (!found) throw new Error(`no definition ${id}`);
  return found;
};
/** The engine's tools a definition is given, a family's each by its name. */
const given = (d: AgentDefinition): string[] => HARNESS_LISTED.filter((t) => d.tools.includes(t.name) || d.tools.includes(`@${t.family}`)).map((t) => t.name);
const tool = (name: string): (typeof HARNESS_LISTED)[number] => {
  const found = HARNESS_LISTED.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

describe("the definitions the harness engine registers", () => {
  test("six agents and eight skills, each definition given tools and families that exist", () => {
    const { agents, skills } = harnessDefinitions({});
    expect(agents.map((a) => a.id)).toEqual([...HARNESS_AGENT_IDS]);
    expect(agents.map((a) => a.id)).toEqual(["author", "character", "game_master", "knowledge", "chronicler", "gm_assistant"]);
    expect(skills.map((s) => s.id)).toEqual([...HARNESS_SKILL_IDS]);
    expect(skills.map((s) => s.id)).toEqual(["play_a_turn", "contested_action", "a_fight", "newcomer", "build_a_world", "time_passing", "after_the_reply", "returning_character"]);
    for (const a of agents) {
      expect({ id: a.id, twice: a.tools.filter((t, i) => a.tools.indexOf(t) !== i) }).toEqual({ id: a.id, twice: [] });
      const unknown = a.tools.filter((t) => (t.startsWith("@") ? !families.has(t.slice(1)) && !lumiah.families.has(t.slice(1)) : !HARNESS_LISTED.some((l) => l.name === t) && !lumiah.tools.has(t)));
      expect({ id: a.id, unknown }).toEqual({ id: a.id, unknown: [] });
      expect(a.tools.length).toBeGreaterThan(0);
      // Each is something that calls a model in LumiAH's runtime, on the author's connection until the user gives it its own. Only a character keeps its definition's tools whoever starts it: the author holds none of a mind's.
      expect({ id: a.id, connectionId: a.connectionId, model: a.model, effort: a.effort, given: a.given, follows: a.follows, grant: a.grant }).toEqual({ id: a.id, connectionId: null, model: null, effort: "inherit", given: a.id === "author" ? "request" : "task", follows: a.id === "author" ? undefined : "author", grant: a.id === "character" ? "definition" : undefined });
    }
    for (const s of skills) expect({ id: s.id, named: s.name !== "", described: s.description !== "", body: s.body.startsWith(`# ${s.name}`) }).toEqual({ id: s.id, named: true, described: true, body: true });
  });

  test("each is given what its part needs: the author everything but a mind, a character only its own mind, the game master nothing that writes", () => {
    const author = definition(HARNESS_AGENT.author);
    // Every family of the engine's but a person's own mind, and every family of LumiAH's.
    expect(given(author).sort()).toEqual(HARNESS_LISTED.filter((t) => t.family !== HARNESS_FAMILY.mind).map((t) => t.name).sort());
    expect(author.tools).not.toContain(`@${HARNESS_FAMILY.mind}`);
    for (const name of [HARNESS_TOOL.commit, HARNESS_TOOL.grant, HARNESS_TOOL.timePass, HARNESS_TOOL.checksStakes, HARNESS_TOOL.knowledgeInfer, STORY_TOOL.record, "gm_spawn", "lore_load", "purchase", "person_make", "action_play", "fight_start", "fight_round", "fight_end", "world_place", "world_path", "world_map", "world_put", "world_commit", "world_upgrade", "place_remove", "gm_effects", "sections_read"]) expect(given(author)).toContain(name);
    for (const f of Object.values(LUMIAH_FAMILY)) expect(author.tools).toContain(`@${f}`);

    // A person's own mind: its view, its decision, its memory, its choice in a fight, its files and its notes folded, and nothing else, so what it reads is what that person perceives.
    const character = definition(HARNESS_AGENT.character);
    expect([character.tools, given(character)]).toEqual([[`@${HARNESS_FAMILY.mind}`], [HARNESS_TOOL.mindView, HARNESS_TOOL.mindDecide, HARNESS_TOOL.mindRemember, "mind_fight", "mind_files", "mind_file_read", "mind_file_write", "mind_consolidate"]]);

    // The game master reads and rules: nothing it is given changes anything, and nothing it is given rolls. It reads an attempt's odds and what is at stake, and a fight as it stands, to rule on what a round leaves open.
    const gm = definition(HARNESS_AGENT.gm);
    expect(given(gm).filter((n) => tool(n).tier !== "read")).toEqual([]);
    for (const name of ["checks_odds", HARNESS_TOOL.checksStakes, "people_sheet", "items_inventory", "time_clock", "fight_read"]) expect(given(gm)).toContain(name);
    expect(given(gm)).not.toContain("lore_load");
    expect(given(gm).filter((n) => tool(n).family === HARNESS_FAMILY.world)).toEqual([]);

    // The knowledge agent: its own two tools, and what reads people and who knows what; its one write is checked by the knowledge step's own check.
    const knowledge = definition(HARNESS_AGENT.knowledge);
    expect(given(knowledge).filter((n) => tool(n).tier !== "read")).toEqual([HARNESS_TOOL.knowledgeInfer]);
    for (const name of [HARNESS_TOOL.knowledgeScene, "knowledge_who_knows", "knowledge_what_knows", "people_find"]) expect(given(knowledge)).toContain(name);

    // The chronicler: the chat as written, what reads the world, the story's own changes and what the reply told (`story_record`, the time its telling added among it); none of the game master's edits, and not the turn's own time, which is the author's alone.
    const chronicler = definition(HARNESS_AGENT.chronicler);
    expect(given(chronicler).filter((n) => tool(n).writer === "gm")).toEqual([]);
    expect(given(chronicler).filter((n) => tool(n).writer === null)).toEqual([STORY_TOOL.record]);
    for (const name of ["item_move", "item_make", "person_add", "purchase", "place_make", "items_find", "time_clock"]) expect(given(chronicler)).toContain(name);
    for (const name of [LUMIAH_TOOL.chatRead, LUMIAH_TOOL.chatGrep, LUMIAH_TOOL.chatSearch]) expect(chronicler.tools).toContain(name);

    // The game master's assistant: what reads the world and every change the old engines' assistant could propose, but those a conversation outside a turn can't use; none of the harness engine's own tools, which each work inside a turn; LumiAH's chat and workspace.
    const assistant = definition(HARNESS_AGENT.assistant);
    const left = ["lore_load", "person_add", "purchase", "revenue_note", "project_note", "lore_save", "lore_draft"];
    expect(left.filter((name) => !HARNESS_LISTED.some((t) => t.name === name))).toEqual([]);
    expect(given(assistant).sort()).toEqual(HARNESS_LISTED.filter((t) => t.writer !== null && !left.includes(t.name)).map((t) => t.name).sort());
    for (const name of ["gm_spawn", "item_move", "place_make", "people_find", "time_clock"]) expect(given(assistant)).toContain(name);
    for (const f of [LUMIAH_FAMILY.chat, LUMIAH_FAMILY.workspace]) expect(assistant.tools).toContain(`@${f}`);

    // Committing, granting, delegating, starting jobs and writing the reply are the author's alone.
    for (const d of [character, gm, knowledge, chronicler, assistant]) {
      expect(given(d).filter((n) => n === HARNESS_TOOL.commit || n === HARNESS_TOOL.grant)).toEqual([]);
      expect(d.tools.filter((t) => t === `@${LUMIAH_FAMILY.agents}` || t === `@${LUMIAH_FAMILY.jobs}` || t === `@${LUMIAH_FAMILY.reply}` || t === LUMIAH_TOOL.delegate || t === LUMIAH_TOOL.jobStart || t === LUMIAH_TOOL.writeReply)).toEqual([]);
    }
    // No one but a character is given a mind's tools.
    for (const d of [author, gm, knowledge, chronicler, assistant]) expect(given(d).filter((n) => tool(n).family === HARNESS_FAMILY.mind)).toEqual([]);
  });

  test("a budget is a default of the definition's settings in LumiAH: only an answer's size, the rounds, the revisions and the calls at once are bounded", () => {
    const budgets = Object.fromEntries(harnessDefinitions({}).agents.map((a) => [a.id, a.budget]));
    const unlimited = { callTokensIn: null, callMs: null, callTools: null, tokensIn: null, tokensOut: null, wallMs: null };
    expect(budgets).toEqual({
      author: { ...unlimited, callTokensOut: 16_000, toolTurns: 40, revisions: 2, concurrency: 4 },
      character: { ...unlimited, callTokensOut: 4000, toolTurns: 10, revisions: 2, concurrency: 2 },
      game_master: { ...unlimited, callTokensOut: 4000, toolTurns: 8, revisions: 2, concurrency: 2 },
      knowledge: { ...unlimited, callTokensOut: 8000, toolTurns: 8, revisions: 1, concurrency: 2 },
      chronicler: { ...unlimited, callTokensOut: 8000, toolTurns: 12, revisions: 1, concurrency: 4 },
      gm_assistant: { ...unlimited, callTokensOut: 8000, toolTurns: 20, revisions: 1, concurrency: 4 },
    });
    // Each read is its own copy: a caller that changes one changes no other read.
    const once = definition(HARNESS_AGENT.author);
    once.budget.toolTurns = 1;
    once.tools.push("nothing");
    expect([definition(HARNESS_AGENT.author).budget.toolTurns, definition(HARNESS_AGENT.author).tools.includes("nothing")]).toEqual([40, false]);
  });

  test("every name, description, instruction and skill is a text of the Harness engine page, sent in the user's own words where they wrote them", () => {
    expect(PROMPT_PAGES.some((p) => p.id === HARNESS_PAGE.id)).toBe(true);
    for (const d of HARNESS_PROMPTS) expect({ id: d.id, page: promptDef(d.id)?.page, problems: promptProblems(d, d.text), empty: d.text.trim() === "" }).toEqual({ id: d.id, page: HARNESS_PAGE.id, problems: [], empty: false });
    for (const id of HARNESS_AGENT_IDS) {
      for (const part of ["name", "description", "instructions"] as const) {
        const textId = HARNESS_TEXT.agent(id, part);
        expect({ textId, shipped: promptDef(textId)?.text === definition(id)[part].split("\n\n" + shipped(toolGuideId("changes")))[0]?.split("\n\n" + shipped(toolGuideId("things")))[0] }).toEqual({ textId, shipped: true });
        const mine = definition(id, harnessDefinitions({ [textId]: `MINE ${id} ${part}` }).agents);
        // Its own instructions come first; what its tools share follows them.
        expect({ textId, mine: part === "instructions" ? mine.instructions.split("\n\n")[0] : mine[part] }).toEqual({ textId, mine: `MINE ${id} ${part}` });
        // Only that one text changed.
        for (const other of ["name", "description"] as const) if (other !== part) expect(mine[other]).toBe(definition(id)[other]);
      }
    }
    for (const id of HARNESS_SKILL_IDS) {
      for (const part of ["name", "description", "body"] as const) {
        const textId = HARNESS_TEXT.skill(id, part);
        expect(promptDef(textId)?.text).toBe(harnessSkills({}).find((s) => s.id === id)?.[part] ?? "");
        expect(harnessSkills({ [textId]: `MINE ${id} ${part}` }).find((s) => s.id === id)?.[part]).toBe(`MINE ${id} ${part}`);
      }
    }
    // What tools that change or name a thing share is told once, after the instructions of a definition given such tools, in the user's words too.
    const things = shipped(toolGuideId("things"));
    expect(definition(HARNESS_AGENT.author).instructions.endsWith(things)).toBe(true);
    expect(definition(HARNESS_AGENT.chronicler).instructions).toContain(shipped(toolGuideId("changes")));
    expect(definition(HARNESS_AGENT.character).instructions).toBe(shipped(HARNESS_TEXT.agent(HARNESS_AGENT.character, "instructions")));
    expect(definition(HARNESS_AGENT.author, harnessDefinitions({ [toolGuideId("things")]: "A thing goes by its id." }).agents).instructions.endsWith("A thing goes by its id.")).toBe(true);
  });

  test("the texts name only tools, agents and skills that exist", async () => {
    const { agents, skills } = harnessDefinitions({});
    const { rig, chatId } = await alderChat();
    const { world } = await stateOf(rig, chatId);
    // What a tool takes is named in its texts too: its arguments, and the values an argument takes.
    const taken = new Set<string>();
    const walk = (schema: JsonValue | undefined): void => {
      if (!isRecord(schema)) return;
      for (const value of Array.isArray(schema.enum) ? schema.enum : []) if (typeof value === "string") taken.add(value);
      for (const [name, child] of Object.entries(isRecord(schema.properties) ? schema.properties : {})) {
        taken.add(name);
        walk(child);
      }
      walk(schema.items);
    };
    for (const listed of harnessTools({ world, registry: rig.rt.registry, texts: {} })) walk(listed.parameters);
    // Every word written like a tool's name is a tool the harness lists, one of LumiAH's, an agent, a skill, or something a tool takes.
    const known = new Set<string>([...HARNESS_LISTED.map((t) => t.name), ...lumiah.tools, ...HARNESS_AGENT_IDS, ...HARNESS_SKILL_IDS, ...taken, "after_reply"]);
    // A word is written like a tool's name when it starts as one does (gm_, item_, world_, mind_): the words of an example (old_mill) don't.
    const starts = new Set([...HARNESS_LISTED.map((t) => t.name), ...lumiah.tools].map((name) => name.split("_")[0] ?? name));
    const texts: [string, string][] = [...agents.flatMap((a): [string, string][] => [[`${a.id} instructions`, shipped(HARNESS_TEXT.agent(a.id as (typeof HARNESS_AGENT_IDS)[number], "instructions"))], [`${a.id} description`, a.description]]), ...skills.flatMap((s): [string, string][] => [[`${s.id} body`, s.body], [`${s.id} description`, s.description]]), ...HARNESS_PROMPTS.filter((d) => d.id.startsWith("tool.") || d.id.startsWith("harness.tool.") || d.id.startsWith("harness.note.")).map((d): [string, string] => [d.id, d.text])];
    for (const [where, text] of texts) expect({ where, unknown: [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])].filter((word) => starts.has(word.split("_")[0] ?? "") && !known.has(word)) }).toEqual({ where, unknown: [] });
    // The author's instructions say plainly that nothing happens unless it calls for it, and name the tools a turn turns on.
    const author = shipped(HARNESS_TEXT.agent(HARNESS_AGENT.author, "instructions"));
    for (const name of ["delegate", "checks_stakes", "action_play", "person_make", "time_pass", "commit", "job_start", "write_reply"]) expect(author).toContain(name);
    for (const id of [HARNESS_AGENT.character, HARNESS_AGENT.gm]) expect(author).toContain(`agent: ${id}`);
    // Time is a tool the author calls: the skill says what 0 records and when the engine's own tick stands in.
    const body = (id: string): string => skills.find((s) => s.id === id)?.body ?? "";
    for (const part of ["Advancing time is a tool you call", "`time_pass` with 0 records that the turn takes no time", "If you never call it"]) expect(body("time_passing")).toContain(part);
    // A fight's rounds are the author's to play, and every fighter's choice is their own.
    for (const part of ["no round plays unless you play it", "`fight_start`", "`fight_round`", "`mind_fight`", "`fight_end`", "Never decide for the player's character"]) expect(body("a_fight")).toContain(part);
    // A contested action is played through the rules, never recorded by hand from a roll.
    for (const part of ["`action_play`", "`checks_odds`", "You never pick how it turns out"]) expect(body("contested_action")).toContain(part);
    // Someone new is made whole, and a world is built in two layers: in play, and in its document, which is committed and brought to the chat.
    expect(body("newcomer")).toContain("`person_make`");
    for (const part of ["`place_make`", "`person_make`", "`world_place`", "`world_path`", "`world_map`", "`world_shape`", "`world_commit`", "`world_upgrade`", "`world_keep`"]) expect(body("build_a_world")).toContain(part);
  });

  test("an agent of each definition reads and writes as its part does; one that isn't the engine's only reads", () => {
    expect(Object.fromEntries(HARNESS_AGENT_IDS.map((id) => [id, harnessRole(id)]))).toEqual({
      author: { role: "director", tier: "gm", view: "gm", marks: true },
      character: { role: "minds", tier: "read", view: "everyone", marks: false },
      game_master: { role: "intent", tier: "read", view: "gm", marks: true },
      knowledge: { role: "knowledge", tier: "read", view: "gm", marks: true },
      chronicler: { role: "curator", tier: "story", view: "gm", marks: true },
      gm_assistant: { role: "director", tier: "read", view: "gm", marks: true },
    });
    for (const id of ["main", "writer", "summarizer", "someone_else", "toString", ""]) expect(harnessRole(id)).toBeNull();
  });
});

describe("the world's guidance", () => {
  test("it names the world and whose the player character is, and says how the chat's own rules play, each line a text the user may replace", async () => {
    const { rig, chatId } = await alderChat();
    const { world, state } = await stateOf(rig, chatId);
    const pov = state.entities[POV]?.name ?? "";
    const policy = policyOf(world, state);
    const guidance = worldGuidance({ world, state, texts: {} });
    expect(guidance.name).toBe("this world's");
    // Port Alder as shipped: every check rolls, the roll settles it, an approach moves nothing, a failure may be retried.
    expect([policy.checks, policy.authority, policy.description.weight, policy.retry]).toEqual(["every", "mechanics", "none", "free"]);
    expect(guidance.text).toBe(
      [
        `You are working in ${world.name}. ${pov} is the player's character: the player alone decides what they say and do.`,
        "",
        "How this world plays:",
        shipped(HARNESS_TEXT.checks("every")),
        shipped(HARNESS_TEXT.authority("mechanics")),
        shipped(HARNESS_TEXT.approach("none")),
        shipped(HARNESS_TEXT.retry("free")),
        "",
        "Its tone:",
        shipped(HARNESS_TEXT.realism(presetOf(state.realism))),
        shipped(HARNESS_TEXT.secrecy("full")),
        shipped(HARNESS_TEXT.pricing(world.lenientPricing)),
      ].join("\n"),
    );

    // What the narrator knows in this chat adds its two lines.
    const narrated = worldGuidance({ world, state, texts: {}, narrator: { knowledge: "pov", secrets: "omit" } }).text;
    expect(narrated).toContain(`- The writer knows only what ${pov} knows.\n${shipped(HARNESS_TEXT.secrets("omit"))}`);
    expect(worldGuidance({ world, state, texts: {}, narrator: { knowledge: "scene", secrets: "marked" } }).text).toContain(`${shipped(HARNESS_TEXT.narrator("scene"))}\n${shipped(HARNESS_TEXT.secrets("marked"))}`);

    // The chat's own policy, not the world's default, is what it reads.
    const mine = worldGuidance({ world, state: { ...state, adjudication: { ...policy, checks: "never", authority: "narrative", description: { weight: "advantage", max: 3, advantageAt: 2 }, retry: "changed", retryAfter: 45 } }, texts: {} }).text;
    for (const line of [shipped(HARNESS_TEXT.checks("never")), shipped(HARNESS_TEXT.authority("narrative")), "- A well-described approach, rated 2 or more out of 3, rolls with advantage.", "- A failed attempt fails the same way until something changes, or 45 minutes have passed."]) expect(mine).toContain(line);

    // Every line is the user's to replace; one they blanked is left out.
    const edited = worldGuidance({ world, state, texts: { [HARNESS_TEXT.guidanceName]: "Alder's", [HARNESS_TEXT.checks("every")]: "- Always roll.", [HARNESS_TEXT.retry("free")]: "", [HARNESS_TEXT.guidance]: "{{world}} / {{pov}}\n{{rules}}\n--\n{{tone}}" } });
    expect(edited.name).toBe("Alder's");
    expect(edited.text.split("\n--\n")[0]).toBe([`${world.name} / ${pov}`, "- Always roll.", shipped(HARNESS_TEXT.authority("mechanics")), shipped(HARNESS_TEXT.approach("none"))].join("\n"));
  });
});
