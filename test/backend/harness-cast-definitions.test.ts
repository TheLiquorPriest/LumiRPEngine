// What the harness engine registers with LumiAH (`harnessDefinitions`, `harnessRole`,
// `worldGuidance`): the cast of agents, each given tools that exist and no more than its part
// needs; who may release the reply; every name, description, instruction and skill a registry text
// the user may replace; the texts naming only tools, agents and skills that exist; and the world's
// guidance reading the chat's own rules.

import { describe, expect, test } from "bun:test";
import { HARNESS_LISTED, harnessTools } from "../../src/backend/agents/tools/harness";
import { HARNESS_AGENT, harnessDefinitions, harnessRole, READER_PROMPT_TOKENS, worldGuidance } from "../../src/backend/harness/definitions";
import { defaultSettings } from "../../src/backend/settings-store";
import { lumiahBed } from "../support/lumiah-bed";
import { Rig } from "../support/rig";
import { LUMIAH_FAMILY, LUMIAH_TOOL } from "../../src/backend/harness/definitions/lumiah";
import type { AgentBudget, AgentDefinition } from "../../src/backend/harness/shapes";
import { harnessSkills } from "../../src/backend/harness/skills";
import { renderPrompt } from "../../src/backend/prompts";
import { toolGuideId } from "../../src/shared/agent-tools";
import { HARNESS_AGENT_IDS, HARNESS_FAMILY, HARNESS_PAGE, HARNESS_PROMPTS, HARNESS_SKILL, HARNESS_SKILL_IDS, HARNESS_TEXT, HARNESS_TOOL } from "../../src/shared/harness-texts";
import { MINDS_SKILL, MINDS_TOOL } from "../../src/shared/harness-texts-minds";
import { PLAY_TOOL } from "../../src/shared/harness-texts-play";
import { PREPARE_SKILL, PREPARE_TOOL } from "../../src/shared/harness-texts-prepare";
import { RECORD_TOOL } from "../../src/shared/harness-texts-record";
import { STAGE_TOOL } from "../../src/shared/harness-texts-stage";
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
/** The author's own skills, in the order its page lists them. */
const AUTHOR_SKILLS = ["direct_line", "a_scene", "time_passing", "the_reply", "after_the_reply", "off_screen", "the_notebook", "casting", "a_correction", "contested_action", "a_fight", "newcomer", "build_a_world", "returning_character"];

describe("the cast the harness engine registers", () => {
  test("each agent whose texts are written, in the cast's order, and every skill; each definition given tools and families that exist", () => {
    const { agents, skills } = harnessDefinitions({});
    expect(agents.map((a) => a.id)).toEqual([...HARNESS_AGENT_IDS]);
    for (const id of [HARNESS_AGENT.author, HARNESS_AGENT.character, HARNESS_AGENT.gm, HARNESS_AGENT.assistant]) expect(HARNESS_AGENT_IDS).toContain(id);
    // Every id registered is one the cast holds, in its order; a definition no lane has written the texts of isn't registered.
    const order: readonly string[] = Object.values(HARNESS_AGENT);
    expect(HARNESS_AGENT_IDS.map((id) => order.indexOf(id))).toEqual([...HARNESS_AGENT_IDS.map((id) => order.indexOf(id))].sort((a, b) => a - b));
    expect(Object.values<string>(HARNESS_SKILL)).toEqual(AUTHOR_SKILLS);
    expect(skills.map((s) => s.id)).toEqual([...HARNESS_SKILL_IDS]);
    expect(skills.map((s) => s.id)).toEqual([...AUTHOR_SKILLS, ...Object.values(MINDS_SKILL), PREPARE_SKILL]);
    for (const a of agents) {
      expect({ id: a.id, twice: a.tools.filter((t, i) => a.tools.indexOf(t) !== i) }).toEqual({ id: a.id, twice: [] });
      const unknown = a.tools.filter((t) => (t.startsWith("@") ? !families.has(t.slice(1)) && !lumiah.families.has(t.slice(1)) : !HARNESS_LISTED.some((l) => l.name === t) && !lumiah.tools.has(t)));
      expect({ id: a.id, unknown }).toEqual({ id: a.id, unknown: [] });
      expect(a.tools.length).toBeGreaterThan(0);
      // Each runs on the author's connection until the user, or the engine's model settings, give it its own. Everyone the author starts keeps its own tools whoever starts it: the author holds none of a mind's, nor all of the game master's, the narrator's or the historian's.
      const ownTools = a.id !== HARNESS_AGENT.author && a.id !== HARNESS_AGENT.assistant;
      expect({ id: a.id, connectionId: a.connectionId, model: a.model, effort: a.effort, given: a.given, follows: a.follows, grant: a.grant }).toEqual({ id: a.id, connectionId: null, model: null, effort: "inherit", given: a.id === "author" ? "request" : "task", follows: a.id === "author" ? undefined : "author", grant: ownTools ? "definition" : undefined });
    }
    for (const s of skills) expect({ id: s.id, named: s.name !== "", described: s.description !== "", body: s.body.startsWith(`# ${s.name}`) }).toEqual({ id: s.id, named: true, described: true, body: true });
  });

  test("each is given what its part needs: the author everything but a person's own mind, a character its own trade, the game master nothing that writes the world", () => {
    const author = definition(HARNESS_AGENT.author);
    // Every family of the engine's but a person's own mind, and of a mind's tools only those it needs: reading any mind, and writing who a principal is.
    expect(given(author).sort()).toEqual([...HARNESS_LISTED.filter((t) => t.family !== HARNESS_FAMILY.mind).map((t) => t.name), MINDS_TOOL.read, MINDS_TOOL.write].sort());
    expect(author.tools).not.toContain(`@${HARNESS_FAMILY.mind}`);
    for (const name of [RECORD_TOOL.feedRead, MINDS_TOOL.digested, PLAY_TOOL.mindFight]) expect(given(author)).not.toContain(name);
    for (const name of [HARNESS_TOOL.commit, HARNESS_TOOL.grant, HARNESS_TOOL.timePass, HARNESS_TOOL.checksStakes, RECORD_TOOL.beatWrite, RECORD_TOOL.beatStrike, RECORD_TOOL.castSet, RECORD_TOOL.draftOpen, RECORD_TOOL.draftsDue, MINDS_TOOL.seed, STAGE_TOOL.narrationRead, STAGE_TOOL.passageRead, STAGE_TOOL.passageCheck, "gm_spawn", "person_make", "action_play", "fight_start", "fight_round", "world_place", "world_path", "world_keep"]) expect(given(author)).toContain(name);
    // LumiAH's families but the reply's (no writer writes the reply on the harness), the preset's and the web; and the one tool of the reply's it needs, which releases a passage.
    for (const f of Object.values(LUMIAH_FAMILY)) expect({ family: f, given: author.tools.includes(`@${f}`) }).toEqual({ family: f, given: f !== LUMIAH_FAMILY.reply && f !== LUMIAH_FAMILY.preset && f !== LUMIAH_FAMILY.web });
    expect(author.tools).toContain(LUMIAH_TOOL.replyWrite);
    expect(author.tools).not.toContain(LUMIAH_TOOL.writeReply);

    // A character: what reached it, its own acts, its own mind, its choice in a fight, and its skills. Nothing that reads the world as the game master does. Its answer on the direct line streams through the author's hold on the reply (`delegate` with `to_reply`), so it holds no `reply_write` of its own.
    const character = definition(HARNESS_AGENT.character);
    expect(character.tools).toEqual([RECORD_TOOL.feedRead, RECORD_TOOL.beatWrite, MINDS_TOOL.read, MINDS_TOOL.write, MINDS_TOOL.digested, PLAY_TOOL.mindFight, LUMIAH_TOOL.skillLoad]);
    expect(given(character).filter((n) => tool(n).writer !== null)).toEqual([]);

    // The game master reads, rules, holds a passage to its beats and writes its rulings as beats; nothing it is given changes the world, and nothing it is given rolls.
    const gm = definition(HARNESS_AGENT.gm);
    expect(given(gm).filter((n) => tool(n).writer !== null && tool(n).writer !== "read")).toEqual([]);
    for (const name of ["checks_odds", HARNESS_TOOL.checksStakes, PLAY_TOOL.fightRead, "people_sheet", "time_clock", STAGE_TOOL.passageRead, STAGE_TOOL.passageCheck, RECORD_TOOL.beatsRead, RECORD_TOOL.beatWrite, MINDS_TOOL.read, MINDS_TOOL.seed]) expect(given(gm)).toContain(name);
    for (const name of ["action_play", "lore_load", RECORD_TOOL.castSet, MINDS_TOOL.write, RECORD_TOOL.feedRead, STAGE_TOOL.passageDraft]) expect(given(gm)).not.toContain(name);
    expect(given(gm).filter((n) => tool(n).family === HARNESS_FAMILY.world)).toEqual([]);

    // The narrator: what reached the point of view it tells, and the passage it drafts.
    expect(definition(HARNESS_AGENT.narrator).tools).toEqual([STAGE_TOOL.narrationRead, STAGE_TOOL.passageDraft]);

    // The historian: only the stretch of the chat's past it was given, the beats it records from it, and what reads the people, places, clock and lore they name; none of LumiAH's chat tools.
    const historian = definition(HARNESS_AGENT.historian);
    expect(historian.tools).toEqual([PREPARE_TOOL.read, PREPARE_TOOL.beats, PREPARE_TOOL.done, "people_find", "people_sheet", "places_find", "places_read", "time_clock", "lore_search", "lore_read"]);
    expect(historian.tools.filter((t) => t === `@${LUMIAH_FAMILY.chat}` || t.startsWith("chat_"))).toEqual([]);

    // The game master's assistant: what reads the world and every change the old engines' assistant could propose, but those a conversation outside a turn can't use; none of the harness engine's own tools, which each work inside a turn; LumiAH's chat and workspace.
    const assistant = definition(HARNESS_AGENT.assistant);
    const left = ["lore_load", "person_add", "purchase", "revenue_note", "project_note", "lore_save", "lore_draft"];
    expect(left.filter((name) => !HARNESS_LISTED.some((t) => t.name === name))).toEqual([]);
    expect(given(assistant).sort()).toEqual(HARNESS_LISTED.filter((t) => t.writer !== null && !left.includes(t.name)).map((t) => t.name).sort());
    for (const f of [LUMIAH_FAMILY.chat, LUMIAH_FAMILY.workspace]) expect(assistant.tools).toContain(`@${f}`);

    const others = harnessDefinitions({}).agents.filter((d) => d.id !== HARNESS_AGENT.author);
    for (const d of others) {
      // Committing, granting, delegating and starting jobs are the author's alone.
      expect({ id: d.id, held: given(d).filter((n) => n === HARNESS_TOOL.commit || n === HARNESS_TOOL.grant) }).toEqual({ id: d.id, held: [] });
      expect({ id: d.id, held: d.tools.filter((t) => t === `@${LUMIAH_FAMILY.agents}` || t === `@${LUMIAH_FAMILY.jobs}` || t === `@${LUMIAH_FAMILY.reply}` || t === LUMIAH_TOOL.delegate || t === LUMIAH_TOOL.jobStart || t === LUMIAH_TOOL.writeReply) }).toEqual({ id: d.id, held: [] });
      // The reply is released by the author alone.
      expect({ id: d.id, releases: d.tools.includes(LUMIAH_TOOL.replyWrite) }).toEqual({ id: d.id, releases: false });
      // No one but a character is given a person's own mind's tools beside reading and writing a mind, which the tools themselves hold to whose it is.
      if (d.id !== HARNESS_AGENT.character) expect({ id: d.id, own: given(d).filter((n) => n === RECORD_TOOL.feedRead || n === MINDS_TOOL.digested || n === PLAY_TOOL.mindFight) }).toEqual({ id: d.id, own: [] });
    }
  });

  test("a budget is a default of the definition's settings in LumiAH: only an answer's size, the rounds, the revisions, the calls at once and, for the two that read whole, the prompt per call are bounded", () => {
    const unlimited = { callTokensIn: null, callMs: null, callTools: null, tokensIn: null, tokensOut: null, wallMs: null };
    const readers: string[] = [HARNESS_AGENT.author, HARNESS_AGENT.historian];
    for (const agent of harnessDefinitions({}).agents) {
      const { callTokensOut, toolTurns, revisions, concurrency, ...rest } = agent.budget;
      // Everything else is left to the user's own LumiAH settings: a limit set here would cap them without saying so. The author and the historian read whole, so their prompt stops inside a 200,000-token window.
      expect({ id: agent.id, rest }).toEqual({ id: agent.id, rest: { ...unlimited, callTokensIn: readers.includes(agent.id) ? READER_PROMPT_TOKENS : null } });
      // The four are real bounds, and an answer has room for a reasoning model's thinking as well as what it writes.
      expect({ id: agent.id, bounded: [callTokensOut, toolTurns, revisions, concurrency].every((n) => typeof n === "number" && n >= 1) }).toEqual({ id: agent.id, bounded: true });
      expect({ id: agent.id, room: (callTokensOut ?? 0) >= 16_000 }).toEqual({ id: agent.id, room: true });
    }
    // The author's answer room and a margin fit beside its prompt in a 200,000-token window.
    expect(READER_PROMPT_TOKENS + (definition(HARNESS_AGENT.author).budget.callTokensOut ?? 0)).toBeLessThan(200_000);
    expect(harnessDefinitions({}).agents.map((a) => a.id).sort()).toEqual([...HARNESS_AGENT_IDS].sort());
    // Each read is its own copy: a caller that changes one changes no other read.
    const once = definition(HARNESS_AGENT.author);
    const rounds = once.budget.toolTurns;
    once.budget.toolTurns = 1;
    once.tools.push("nothing");
    expect([definition(HARNESS_AGENT.author).budget.toolTurns, definition(HARNESS_AGENT.author).tools.includes("nothing")]).toEqual([rounds, false]);
  });

  test("the prompt per call the author and the historian ship with is the user's to change: a version they save keeps its own, and the engine keeps its instructions", async () => {
    const bed = lumiahBed(new Rig());
    try {
      const agents = async () => (await bed.page<{ agents: AgentDefinition[] }>("lah.defs.get", {})).agents;
      const limit = async (id: string) => (await agents()).find((a) => a.id === id)?.budget.callTokensIn;
      expect([await limit(HARNESS_AGENT.author), await limit(HARNESS_AGENT.historian)]).toEqual([READER_PROMPT_TOKENS, READER_PROMPT_TOKENS]);
      // A larger model's window: the user saves their own version of the historian with a higher limit.
      const historian = definition(HARNESS_AGENT.historian);
      await bed.page("lah.agent.save", { agent: { ...historian, instructions: "Read nothing.", budget: { ...historian.budget, callTokensIn: 800_000 } } as unknown as JsonValue });
      const saved = (await agents()).find((a) => a.id === HARNESS_AGENT.historian);
      expect([saved?.budget.callTokensIn, saved?.instructions]).toEqual([800_000, historian.instructions]);
      expect(await limit(HARNESS_AGENT.author)).toBe(READER_PROMPT_TOKENS);
    } finally {
      bed.close();
    }
  });

  test("every name, description, instruction, skill and notebook page is a text of the Harness engine page, sent in the user's own words where they wrote them", () => {
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
    expect(definition(HARNESS_AGENT.author).instructions).toContain(shipped(toolGuideId("changes")));
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
    for (const listed of harnessTools({ world, registry: rig.rt.registry, settings: defaultSettings() })) walk(listed.parameters);
    // Every word written like a tool's name is a tool the harness lists, one of LumiAH's, an agent, a skill, or something a tool takes.
    const known = new Set<string>([...HARNESS_LISTED.map((t) => t.name), ...lumiah.tools, ...Object.values(HARNESS_AGENT), ...HARNESS_SKILL_IDS, ...taken, "after_reply", "to_reply", "next_turn"]);
    // A word is written like a tool's name when it starts as one does (gm_, item_, world_, mind_): the words of an example (old_mill) don't.
    const starts = new Set([...HARNESS_LISTED.map((t) => t.name), ...lumiah.tools].map((name) => name.split("_")[0] ?? name));
    const texts: [string, string][] = [...agents.flatMap((a): [string, string][] => [[`${a.id} instructions`, shipped(HARNESS_TEXT.agent(a.id as (typeof HARNESS_AGENT_IDS)[number], "instructions"))], [`${a.id} description`, a.description]]), ...skills.flatMap((s): [string, string][] => [[`${s.id} body`, s.body], [`${s.id} description`, s.description]]), ...HARNESS_PROMPTS.filter((d) => d.id.startsWith("tool.") || d.id.startsWith("harness.tool.") || d.id.startsWith("harness.note.") || d.id.startsWith("harness.notebook.")).map((d): [string, string] => [d.id, d.text])];
    for (const [where, text] of texts) expect({ where, unknown: [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])].filter((word) => starts.has(word.split("_")[0] ?? "") && !known.has(word)) }).toEqual({ where, unknown: [] });
    // No text of the engine's names a retired tool or agent.
    for (const [where, text] of texts) expect({ where, retired: ["story_record", "story_departure", "knowledge_scene", "knowledge_infer", "chronicler", "write_reply"].filter((word) => text.includes(word)) }).toEqual({ where, retired: [] });

    // The author's instructions name the tools a moment turns on, and whom it starts.
    const author = shipped(HARNESS_TEXT.agent(HARNESS_AGENT.author, "instructions"));
    for (const name of ["beat_write", "beat_strike", "cast_set", "delegate", "action_play", "time_pass", "reply_write", "job_start"]) expect(author).toContain(name);
    for (const id of [HARNESS_AGENT.gm, HARNESS_AGENT.narrator]) expect(author).toContain(`agent: ${id}`);
    const body = (id: string): string => skills.find((s) => s.id === id)?.body ?? "";
    // The direct line hands the reply's stream to a principal, as the person they are.
    for (const part of ["`to_reply: true`", "`as` their id", "`reply_write`"]) expect(body("direct_line")).toContain(part);
    // Time that passes is given a tier, and the treatments the budget counts are drafts.
    for (const part of ["T1", "T2", "T3", "T4", "`draft_open`", "`draft_settle`", "`time_pass`"]) expect(body("time_passing")).toContain(part);
    // After the reply: those a beat reached take it in before the next turn; the author's own reflection and look elsewhere wait in the later lane.
    for (const part of ["`due: \"next_turn\"`", "`lane: \"soon\"`", "`lane: \"later\"`", "`agent: \"author\"`"]) expect(body("after_the_reply")).toContain(part);
    // Off screen: what is due or stale first, then a tier, now or kept as a draft.
    for (const part of ["`drafts_due`", "`draft_open`", "`draft_settle`", "`draft_drop`"]) expect(body("off_screen")).toContain(part);
    // The notebook's pages, and a correction that strikes and tells.
    for (const page of ["author/notebook.md", "author/threads.md", "author/questions.md", "author/setups.md", "author/arcs.md", "author/player.md", "author/futures.md"]) expect(body("the_notebook")).toContain(page);
    for (const part of ["`beat_strike`", "`job_start`"]) expect(body("a_correction")).toContain(part);
    for (const part of ["`cast_set`", "`mind_seed`", "Never promote by default"]) expect(body("casting")).toContain(part);
    // A fight's rounds are the author's to play, and every fighter's choice is their own: a principal's is made by its own agent, with a tool the author doesn't hold.
    for (const part of ["no round plays unless you play it", "`fight_start`", "`fight_round`", "they choose their own option", "`fight_end`", "Never decide for the player's character"]) expect(body("a_fight")).toContain(part);
    // A contested action is played through the rules, never chosen.
    for (const part of ["`action_play`", "`checks_odds`", "You never pick how it turns out"]) expect(body("contested_action")).toContain(part);
    // Someone new is made on the spot and starts as an extra; a world is built in this chat's own world first.
    for (const part of ["`person_make`", "start as an extra"]) expect(body("newcomer")).toContain(part);
    for (const part of ["`place_make`", "`person_make`", "`world_place`", "`world_path`", "`world_map`", "`world_shape`", "`world_made`", "`world_keep`", "`world_commit`", "`world_upgrade`"]) expect(body("build_a_world")).toContain(part);
  });

  test("an agent of each definition reads and writes as its part does; one that isn't the engine's only reads", () => {
    expect(Object.fromEntries(Object.values(HARNESS_AGENT).map((id) => [id, harnessRole(id)]))).toEqual({
      author: { role: "director", tier: "gm", view: "gm", marks: true },
      character: { role: "minds", tier: "read", view: "everyone", marks: false },
      game_master: { role: "intent", tier: "read", view: "gm", marks: true },
      narrator: { role: "scene", tier: "read", view: "everyone", marks: false },
      historian: { role: "curator", tier: "story", view: "gm", marks: true },
      gm_assistant: { role: "director", tier: "read", view: "gm", marks: true },
    });
    for (const id of ["main", "writer", "summarizer", "knowledge", "chronicler", "someone_else", "toString", ""]) expect(harnessRole(id)).toBeNull();
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
    expect(narrated).toContain(`- The narrator knows only what ${pov} knows.\n${shipped(HARNESS_TEXT.secrets("omit"))}`);
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
