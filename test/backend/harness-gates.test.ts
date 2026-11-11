// The bridge's gates (the tools review's findings that are the bridge's to hold): who may call a
// tool is decided where every call enters and once more where a change is staged, by where the
// caller stands as LumiAH says who it is on the call, never by what its definition lists or by who
// called first. Played by the driver that stands where LumiAH's runtime does (`harness-driver.ts`):
// each test is the rule a finding states, on the bridge's own turn and its own job path.
//
// - A tool's tier is checked at the call, in a turn and in a job, and again in `stage`.
// - An agent is one record for its run's whole life: who it thinks for is said once.
// - The engine's tools are given the chat's files in a turn, in its tail and in a job.
// - `grant_writes` opens what it says, and refuses with why where it would open nothing.
// - The author is the run's main agent; an agent writes no higher than the agents over it, and a
//   job's agents no higher than whoever started the job.
// - A cap that holds across the turn is counted on what every agent staged.
// - What a gate's card taught is counted only once the turn's record is written.
// - What a commit asks of the world's document is made in order, and whoever waits for the turn
//   waits for it.

import { describe, expect, test } from "bun:test";
import { worldBuild } from "../../src/backend/agents/tools/harness-ports";
import type { HarnessChange } from "../../src/backend/agents/tools/harness-turn";
import { jobEnv } from "../../src/backend/harness/jobs";
import { Cast, type OpenTurn, standingOf } from "../../src/backend/harness/turn";
import { renderPrompt } from "../../src/backend/prompts";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { HARNESS_AGENT, HARNESS_NOTE } from "../../src/shared/harness-texts";
import type { JsonObject } from "../../src/shared/json";
import { placeOfEntity } from "../../src/engine/scope";
import { readKnowledge, readSlice } from "../../src/packs/minds/core/state";
import { Rig } from "../support/rig";
import { HOME } from "../support/tools";
import { memoryFiles, turnChat } from "./harness-cast-kit";
import { A_BRIEF, type Agent, AUTHOR, beginJob, beginTurn, harnessChat, JOSS, MARA, mount, noModelCalls, OKORO, PEOPLE, playOn, type Run, stateOf } from "./harness-driver";

const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

/** An agent of the game master's definition, which only reads; one of a definition the user made, which the engine lets only read; the chronicler, which holds the story's tier. Each is started by the author unless a test says otherwise. */
const GM: Agent = { id: "gm-1", role: HARNESS_AGENT.gm };
const OWN: Agent = { id: "helper-1", role: "a_definition_of_the_users" };
const CHRONICLER: Agent = { id: "chronicler-1", role: HARNESS_AGENT.chronicler };
/** A character's agent, as the author's `delegate` starts one. */
const mind = (handle: string, above?: readonly Agent[]): Agent => ({ id: `mind-${handle}`, role: HARNESS_AGENT.character, ...(above ? { above } : {}) });

const MOVE: JsonObject = { entity: "Okoro", to: HOME };
const WHISTLE: JsonObject = { name: "a tin whistle", at: HOME, why: "it lies on the sill" };
const DECISION: JsonObject = { who: "Mara", monologue: "He said noon, so I will say noon.", depiction: "Mara glances at the door", intent: "Tell him Okoro comes by at noon.", mood: "easy" };
const REPLY = "Mara shrugs and says nobody new has come by.";

/** A refusal the writer words: its code, with the reason in the user's text for it. */
const refusedAs = (code: string, id: string, vars: Record<string, string> = {}): JsonObject => ({ refused: { code, reason: note(id, vars) } });
const refusalOf = async (run: Run, agent: Agent, name: string, args: JsonObject = {}): Promise<unknown> => JSON.parse(await run.refusal(agent, name, args));
const held = (tool: string, under: string, holds: string): string => note(HARNESS_NOTE.heldUnder, { tool, under, holds });

const namesIn = async (rig: Rig, chatId: string): Promise<string[]> => Object.values((await stateOf(rig, chatId)).entities).map((e) => e.name);
const committed = async (run: Run): Promise<{ landed: string[][]; review: string[][]; refused: { lines: string[]; reason: string }[] }> => (await run.answer(AUTHOR, "commit", {})).committed as { landed: string[][]; review: string[][]; refused: { lines: string[]; reason: string }[] };

/** The turn the engine holds open for a run, as the bridge keeps it: for the checks a test makes behind the call's own gate. */
function openTurn(rig: Rig, run: Run): OpenTurn {
  // The engine's own table of open turns, which no other door reaches: read here as the bridge reads it.
  const engine = rig.rt.harness as unknown as { turns: ReadonlyMap<string, OpenTurn> };
  const open = engine.turns.get(run.turn);
  if (!open) throw new Error("no turn is open for the run");
  return open;
}

/** A change no tool made: what `stage` is handed where only who hands it is under test. */
const HANDED: HarnessChange = { key: "gates:handed", changeType: null, events: [], lines: ["A change handed straight to the turn."] };

describe("a tool's tier is checked at the call, whatever the caller's definition lists", () => {
  test("in a turn, an agent that only reads stages nothing through a note tool, and nothing of it lands when the reply is saved", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { spawn: { mode: "auto" }, place_make: { mode: "auto" }, purchase: { mode: "auto" } } } }));
    const before = await stateOf(rig, chatId);
    const turn = await beginTurn(rig, chatId, "I ask Mara who is new in town.");
    await turn.answer(AUTHOR, "time_clock");
    // The note tools record through the reply's own channels, at the story's tier: given to an agent that only reads by a definition the user edited or made, each is closed at the gate.
    const closed: [Agent, string, JsonObject][] = [
      [GM, "person_add", { name: "Brann" }],
      [OWN, "person_add", { name: "Brann" }],
      [GM, "place_make", { name: "The back room", parent: HOME, as: "room", why: "Mara steps into it.", entity: "Mara" }],
      [GM, "purchase", { item: "a loaf of bread", category: "food", price: 3 }],
      [OWN, "item_make", WHISTLE],
      [GM, "gm_move", MOVE],
    ];
    for (const [agent, tool, args] of closed) expect({ agent: agent.role, tool, answer: await refusalOf(turn, agent, tool, args) }).toEqual({ agent: agent.role, tool, answer: refusedAs("no_writer", WRITE_NOTE.noWriter) });
    // The author never commits: the reply's own commit lands what is staged, and nothing was.
    await turn.finish(REPLY);
    const after = await stateOf(rig, chatId);
    expect(Object.keys(after.entities).sort()).toEqual(Object.keys(before.entities).sort());
    expect(placeOfEntity(after, MARA)).toBe(HOME);
    // The same tool, from an agent at the story's tier, is staged and lands: the gate closed the caller, not the tool.
    const next = await beginTurn(rig, chatId, "I ask again.");
    expect(await next.answer(CHRONICLER, "person_add", { name: "Brann" })).toMatchObject({ staged: { changeType: "spawn" } });
    await next.finish("Brann, Mara says, as of this morning.");
    expect(await namesIn(rig, chatId)).toContain("Brann");
    noModelCalls(rig);
  });

  test("in a job, the same agent writes nothing, and no agent of a job passes the turn's time", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { spawn: { mode: "auto" } } } }));
    const turn = await beginTurn(rig, chatId, "I ask Mara who is new in town.");
    await turn.answer(AUTHOR, "time_clock");
    await turn.finish(REPLY);
    const before = await stateOf(rig, chatId);
    const job = await beginJob(rig, turn, "job-after");
    expect(await refusalOf(job, GM, "person_add", { name: "Brann" })).toEqual(refusedAs("no_writer", WRITE_NOTE.noWriter));
    expect(await refusalOf(job, OWN, "person_add", { name: "Brann" })).toEqual(refusedAs("no_writer", WRITE_NOTE.noWriter));
    // Time is the author's to pass, in its own turn: after the reply no one is the author, whatever tier it holds.
    for (const agent of [GM, CHRONICLER, { id: "job-author", role: HARNESS_AGENT.author }]) expect({ agent: agent.role, answer: await job.refusal(agent, "time_pass", { minutes: 5 }) }).toEqual({ agent: agent.role, answer: note(HARNESS_NOTE.authorOnly, { tool: "time_pass" }) });
    const after = await stateOf(rig, chatId);
    expect(after.clock).toBe(before.clock);
    expect(await namesIn(rig, chatId)).not.toContain("Brann");
    // The chronicler's own note is written at once.
    expect(await job.answer(CHRONICLER, "person_add", { name: "Brann" })).toMatchObject({ staged: { changeType: "spawn", lands: note(HARNESS_NOTE.recorded) } });
    expect(await namesIn(rig, chatId)).toContain("Brann");
    noModelCalls(rig);
  });

  test("a change is refused once more where it is staged, in a turn and in a job, so the rule doesn't rest on the call's gate alone", async () => {
    const { rig, chatId } = await turnChat();
    const signal = new AbortController().signal;
    const turn = await beginTurn(rig, chatId, "I ask Mara who is new in town.");
    await turn.answer(AUTHOR, "time_clock");
    // Behind the call's gate: the env the bridge would build for a call of `person_add`, and a change handed to its turn as a tool would hand one.
    const open = openTurn(rig, turn);
    const envOf = (agent: Agent) => open.env({ agent: open.cast.of({ agentId: agent.id, role: agent.role, main: false, above: [{ agentId: AUTHOR.id, role: AUTHOR.role }] }), tool: "person_add", ceiling: null, files: null }, signal);
    expect(await envOf(GM).turn?.stage(HANDED)).toEqual({ refused: true, code: "no_writer", reason: note(WRITE_NOTE.noWriter), key: HANDED.key });
    expect(await envOf(OWN).turn?.stage(HANDED)).toEqual({ refused: true, code: "no_writer", reason: note(WRITE_NOTE.noWriter), key: HANDED.key });
    expect(await envOf(CHRONICLER).turn?.stage(HANDED)).toEqual({ mode: "auto" });
    await turn.finish(REPLY);
    // The same after the reply, where a job's change is written as it is made.
    const jobEnvOf = async (agent: Agent) => {
      const one = new Cast("job-after").of({ agentId: agent.id, role: agent.role, main: true, above: [] });
      const env = await jobEnv(rig.rt, rig.rt.review, { chatId, userId: rig.host.userId, basis: turn.turn, committed: true, agent: one, standing: standingOf(one), tool: "person_add", files: null, staged: new Map(), signal });
      if ("refused" in env) throw new Error(`no env for the job's call: ${env.reason}`);
      return env;
    };
    expect(await (await jobEnvOf(GM)).turn?.stage(HANDED)).toEqual({ refused: true, code: "no_writer", reason: note(WRITE_NOTE.noWriter), key: HANDED.key });
    expect(await (await jobEnvOf(OWN)).turn?.stage(HANDED)).toEqual({ refused: true, code: "no_writer", reason: note(WRITE_NOTE.noWriter), key: HANDED.key });
    expect(await (await jobEnvOf(CHRONICLER)).turn?.stage(HANDED)).toEqual({ mode: "auto" });
    noModelCalls(rig);
  });

  test("a tool that writes is closed to an agent started by one that only reads, whatever it runs as", async () => {
    const { rig, chatId } = await turnChat();
    const turn = await beginTurn(rig, chatId, "I ask Mara whether Okoro is coming by today.");
    await turn.answer(AUTHOR, "time_clock");
    // A person's own mind, started by the game master's agent: it reads its mind, and records nothing.
    const under = mind("mara", [AUTHOR, GM]);
    expect((await turn.call(under, "mind_view", { who: "Mara" })).text).toContain("You are Mara.");
    expect(await turn.refusal(under, "mind_decide", DECISION)).toBe(held("mind_decide", GM.id, "read"));
    // An agent of the author's own definition, started the same way: its definition's tier is no higher than what started it.
    const second: Agent = { id: "author-2", role: HARNESS_AGENT.author, above: [AUTHOR, GM] };
    expect(await turn.refusal(second, "gm_move", MOVE)).toBe(held("gm_move", GM.id, "read"));
    expect(await turn.refusal(second, "person_add", { name: "Brann" })).toBe(held("person_add", GM.id, "read"));
    expect(JSON.stringify(await turn.answer(second, "people_find", { name: "Okoro" }))).toContain("Okoro");
    // Started by the author, the same mind decides.
    await turn.answer(mind("mara-2"), "mind_decide", DECISION);
    await turn.finish(REPLY);
    const state = await stateOf(rig, chatId);
    expect(readSlice(state).chars[MARA]?.mind?.intent).toBe("Tell him Okoro comes by at noon.");
    expect(placeOfEntity(state, OKORO)).toBeNull();
    noModelCalls(rig);
  });
});

describe("an agent is one record for its run's whole life", () => {
  test("who a character's agent thinks for is said once, and holds in the turn, in what it calls after the reply, and across a job's runs", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    const other = (self: string, named: string): string => note(HARNESS_NOTE.otherMind, { self, other: named, tool: "mind_view" });
    const turn = await beginTurn(rig, chatId, "I ask Mara about the rent.");
    const one = mind("one");
    expect((await turn.call(one, "mind_view", { who: "Mara" })).text).toContain("You are Mara.");
    expect(await turn.refusal(one, "mind_view", { who: "Ilse" })).toBe(other("Mara", "Ilse"));
    await turn.finish("Mara sighs.");
    // The reply is saved: the same agent is still Mara's mind, and no one else's.
    expect(await turn.refusal(one, "mind_view", { who: "Ilse" })).toBe(other("Mara", "Ilse"));
    expect((await turn.call(one, "mind_view", { who: "Mara" })).text).toContain("You are Mara.");
    // An agent of the turn that first speaks after the reply is bound then, for good.
    const late = mind("late");
    expect((await turn.call(late, "mind_view", { who: "Ilse" })).text).toContain("You are Ilse.");
    expect(await turn.refusal(late, "mind_view", { who: "Mara" })).toBe(other("Ilse", "Mara"));
    // A job's agent is one mind from its first call to its last, through a run of the job that ended and one started again.
    const job = await beginJob(rig, turn, "job-memory");
    const kept = mind("job");
    expect((await job.call(kept, "mind_view", { who: "Joss" })).text).toContain("You are Joss.");
    await job.end("done", { record: null });
    expect(await job.refusal(kept, "mind_view", { who: "Mara" })).toBe(other("Joss", "Mara"));
    const again = await beginJob(rig, turn, "job-memory");
    expect(await again.refusal(kept, "mind_view", { who: "Mara" })).toBe(other("Joss", "Mara"));
    expect((await again.call(kept, "mind_view", { who: "Joss" })).text).toContain("You are Joss.");
    // The same handle in another job is another agent.
    const elsewhere = await beginJob(rig, turn, "job-other");
    expect((await elsewhere.call(kept, "mind_view", { who: "Mara" })).text).toContain("You are Mara.");
    noModelCalls(rig);
  });
});

describe("the chat's files reach the engine's tools", () => {
  test("a person's own files are written and read in a turn, in what its agent calls after the reply, and in a job", async () => {
    const { rig, chatId } = await turnChat();
    const files = memoryFiles();
    const asked: { chatId: string; userId: string }[] = [];
    rig.rt.harness.files = (at) => {
      asked.push(at);
      return files;
    };
    const turn = await beginTurn(rig, chatId, "I ask Mara about the rent.");
    const one = mind("one");
    const NOW = "Rent is due Friday.";
    expect(await turn.answer(one, "mind_file_write", { who: "Mara", file: "now.md", text: NOW })).toMatchObject({ written: { file: "now.md", size: NOW.length } });
    expect(await turn.answer(one, "mind_file_read", { who: "Mara", file: "now.md" })).toMatchObject({ file: "now.md", text: NOW });
    await turn.finish("Mara sighs.");
    // After the reply, by the same agent, and by a job's.
    expect((await turn.answer(one, "mind_files", { who: "Mara" })).files).toEqual([{ file: "now.md", size: NOW.length }]);
    const job = await beginJob(rig, turn, "job-memory");
    const kept = mind("job");
    const LATER = "Joss said nothing about it.";
    expect(await job.answer(kept, "mind_file_write", { who: "Mara", file: "later.md", text: LATER })).toMatchObject({ written: { file: "later.md", size: LATER.length } });
    expect(await job.answer(kept, "mind_file_read", { who: "Mara", file: "now.md" })).toMatchObject({ text: NOW });
    expect([...files.files.keys()].sort()).toEqual([`minds/${MARA}/later.md`, `minds/${MARA}/now.md`]);
    // Each was given the area of this chat, as this user's.
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((at) => at.chatId === chatId && at.userId === rig.host.userId)).toBe(true);
    noModelCalls(rig);
  });
});

describe("grant_writes does what it says", () => {
  test("a grant opens that tier's changes to the agent, whatever it runs as, for the turn and no longer", async () => {
    const { rig, chatId } = await turnChat();
    const turn = await beginTurn(rig, chatId, "I ask Mara what is on the sill.");
    await turn.answer(AUTHOR, "time_clock");
    expect(await refusalOf(turn, GM, "item_make", WHISTLE)).toEqual(refusedAs("no_writer", WRITE_NOTE.noWriter));
    // The story's tier, to an agent that isn't the story's keeper: the story's own changes open, and the game master's stay closed.
    expect(await turn.answer(AUTHOR, "grant_writes", { to: GM.id, tier: "story" })).toEqual({ granted: { to: GM.id, tier: "story" } });
    expect(await turn.answer(GM, "item_make", WHISTLE)).toMatchObject({ staged: { changeType: "item_make" } });
    expect(await refusalOf(turn, GM, "gm_move", MOVE)).toEqual(refusedAs("not_granted", WRITE_NOTE.notGranted, { tier: "story", needs: "gm" }));
    // The game master's tier, to an agent of a definition the user made: it is given a writer, and its edit is staged.
    expect(await refusalOf(turn, OWN, "gm_move", MOVE)).toEqual(refusedAs("no_writer", WRITE_NOTE.noWriter));
    expect(await turn.answer(AUTHOR, "grant_writes", { to: OWN.id, tier: "gm" })).toEqual({ granted: { to: OWN.id, tier: "gm" } });
    expect(await turn.answer(OWN, "gm_move", MOVE)).toMatchObject({ staged: {} });
    // To every agent of a definition, by its id: one that calls afterwards holds it too.
    const knowledge: Agent = { id: "knowledge-1", role: HARNESS_AGENT.knowledge };
    expect(await turn.answer(AUTHOR, "grant_writes", { to: HARNESS_AGENT.knowledge, tier: "story" })).toEqual({ granted: { to: HARNESS_AGENT.knowledge, tier: "story" } });
    expect(await turn.answer(knowledge, "person_add", { name: "Brann" })).toMatchObject({ staged: { changeType: "spawn" } });
    const done = await committed(turn);
    expect(done.refused).toEqual([]);
    await turn.finish(REPLY);
    const state = await stateOf(rig, chatId);
    expect(placeOfEntity(state, OKORO)).toBe(HOME);
    expect(Object.values(state.entities).some((e) => e.name === "a tin whistle")).toBe(true);
    // A grant ends with its turn: after the reply each stands where its definition leaves it.
    expect(await refusalOf(turn, GM, "item_make", { ...WHISTLE, name: "a tin cup" })).toEqual(refusedAs("no_writer", WRITE_NOTE.noWriter));
    expect(await refusalOf(turn, OWN, "gm_move", { entity: "Okoro", to: HOME })).toEqual(refusedAs("no_writer", WRITE_NOTE.noWriter));
    noModelCalls(rig);
  });

  test("a grant that would open nothing is refused with why: under an agent that holds less, to a person's own mind, to no one", async () => {
    const { rig, chatId } = await turnChat();
    const turn = await beginTurn(rig, chatId, "I ask Mara what is on the sill.");
    await turn.answer(AUTHOR, "time_clock");
    const grant = (to: string, tier: string): Promise<unknown> => refusalOf(turn, AUTHOR, "grant_writes", { to, tier });
    // An agent the game master's agent started writes no higher than it, so a grant to it alone opens nothing.
    const under: Agent = { id: "helper-2", role: OWN.role, above: [AUTHOR, GM] };
    await turn.call(under, "time_clock");
    expect(await grant(under.id, "gm")).toEqual(refusedAs("grant_under", HARNESS_NOTE.grantUnder, { to: under.id, tier: "gm", under: GM.id, holds: "read" }));
    expect(await refusalOf(turn, under, "gm_move", MOVE)).toEqual(refusedAs("no_writer", WRITE_NOTE.noWriter));
    // Granted first, the one over it lets it through.
    await turn.answer(AUTHOR, "grant_writes", { to: GM.id, tier: "gm" });
    await turn.answer(AUTHOR, "grant_writes", { to: under.id, tier: "gm" });
    expect(await turn.answer(under, "gm_move", MOVE)).toMatchObject({ staged: {} });
    // A person's own mind keeps to its own tools whatever it is granted: by its handle, and by its definition.
    const mara = mind("mara");
    await turn.call(mara, "mind_view", { who: "Mara" });
    expect(await grant(mara.id, "story")).toEqual(refusedAs("grant_mind", HARNESS_NOTE.grantMind, { to: mara.id }));
    expect(await grant(HARNESS_AGENT.character, "gm")).toEqual(refusedAs("grant_mind", HARNESS_NOTE.grantMind, { to: HARNESS_AGENT.character }));
    // No one by that handle or definition; and only the author grants.
    expect(await turn.refusal(AUTHOR, "grant_writes", { to: "nobody", tier: "gm" })).toBe(note(HARNESS_NOTE.grantNone, { to: "nobody" }));
    expect(await turn.refusal(GM, "grant_writes", { to: OWN.id, tier: "gm" })).toBe(note(HARNESS_NOTE.authorOnly, { tool: "grant_writes" }));
    noModelCalls(rig);
  });

  test("never above the granter's own tier", async () => {
    const { rig, chatId } = await turnChat();
    const turn = await beginTurn(rig, chatId, "I ask Mara what is on the sill.");
    // The run's main agent runs as a definition that holds the story's tier.
    const main: Agent = { id: "main", role: HARNESS_AGENT.chronicler, main: true };
    await turn.answer(main, "time_clock");
    await turn.call(GM, "time_clock");
    expect(await refusalOf(turn, main, "grant_writes", { to: GM.id, tier: "gm" })).toEqual(refusedAs("grant_above", HARNESS_NOTE.grantAbove, { tier: "gm", yours: "story" }));
    expect(await refusalOf(turn, GM, "item_make", WHISTLE)).toEqual(refusedAs("no_writer", WRITE_NOTE.noWriter));
    expect(await turn.answer(main, "grant_writes", { to: GM.id, tier: "story" })).toEqual({ granted: { to: GM.id, tier: "story" } });
    expect(await turn.answer(GM, "item_make", WHISTLE)).toMatchObject({ staged: { changeType: "item_make" } });
    noModelCalls(rig);
  });
});

describe("the author is the run's main agent, as LumiAH says on every call", () => {
  test("an agent of the author's definition that calls first is no author; the run's main agent commits and passes the time", async () => {
    const { rig, chatId } = await turnChat();
    const clock = (await stateOf(rig, chatId)).clock;
    const turn = await beginTurn(rig, chatId, "I wait.");
    const delegate: Agent = { id: "delegate-7", role: HARNESS_AGENT.author };
    for (const tool of ["commit", "time_pass", "grant_writes"]) expect({ tool, answer: await turn.refusal(delegate, tool, { minutes: 5, to: GM.id, tier: "gm" }) }).toEqual({ tool, answer: note(HARNESS_NOTE.authorOnly, { tool }) });
    // Saying so doesn't make one: an agent with another over it is not its run's main agent.
    const claims: Agent = { id: "delegate-8", role: HARNESS_AGENT.author, main: true, above: [AUTHOR] };
    expect(await turn.refusal(claims, "commit", {})).toBe(note(HARNESS_NOTE.authorOnly, { tool: "commit" }));
    // The run's own main agent, whenever it first calls.
    await turn.answer(AUTHOR, "time_pass", { minutes: 5 });
    expect((await committed(turn)).landed.length).toBe(1);
    // Its definition's tier is the delegate's own, under the author: it stages a game master's edit, which the author commits.
    await turn.answer(delegate, "gm_move", MOVE);
    expect((await committed(turn)).landed.length).toBe(1);
    await turn.finish(REPLY);
    const state = await stateOf(rig, chatId);
    expect(state.clock).toBe(clock + 5);
    expect(placeOfEntity(state, OKORO)).toBe(HOME);
    noModelCalls(rig);
  });

  test("a job's agents write no higher than whoever started the job: the turn's agent, a job's agent, or no one the engine heard from", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { spawn: { mode: "auto" } } } }));
    const turn = await beginTurn(rig, chatId, "I ask Mara who is new in town.");
    await turn.answer(AUTHOR, "time_clock");
    await turn.call(GM, "time_clock");
    const worker: Agent = { id: "job-author", role: HARNESS_AGENT.author };
    const scribe: Agent = { id: "job-chronicler", role: HARNESS_AGENT.chronicler };
    // Started by the game master's agent, which only reads: beside the turn its agents stage nothing, whatever they run as.
    const byReader = await beginJob(rig, turn, "job-by-reader", GM);
    expect(await byReader.refusal(worker, "gm_move", MOVE)).toBe(held("gm_move", GM.id, "read"));
    expect(await byReader.refusal(scribe, "person_add", { name: "Brann" })).toBe(held("person_add", GM.id, "read"));
    // A grant to whoever started it raises what it holds its job to, while the turn is open.
    await turn.answer(AUTHOR, "grant_writes", { to: GM.id, tier: "story" });
    expect(await byReader.answer(scribe, "person_add", { name: "Brann" })).toMatchObject({ staged: { changeType: "spawn" } });
    expect(await byReader.refusal(worker, "gm_move", MOVE)).toBe(held("gm_move", GM.id, "story"));
    await turn.finish(REPLY);
    expect(await namesIn(rig, chatId)).toContain("Brann");
    // After the reply the grant is over, and the job is held to where its starter's definition leaves it.
    expect(await byReader.refusal(worker, "gm_move", MOVE)).toBe(held("gm_move", GM.id, "read"));
    expect(await byReader.refusal(scribe, "item_make", WHISTLE)).toBe(held("item_make", GM.id, "read"));
    // A job that job's agent started is held the same way, through it.
    await byReader.call(worker, "time_clock");
    const child = await beginJob(rig, turn, "job-child", worker, "job-by-reader");
    expect(await child.refusal(scribe, "item_make", WHISTLE)).toBe(held("item_make", worker.id, "read"));
    // Started by the author, a job's chronicler writes the story's changes, and one started by its agent does too.
    const byAuthor = await beginJob(rig, turn, "job-by-author");
    expect(await byAuthor.answer(scribe, "item_make", WHISTLE)).toMatchObject({ staged: { changeType: "item_make" } });
    await byAuthor.call(worker, "time_clock");
    const grandchild = await beginJob(rig, turn, "job-grandchild", worker, "job-by-author");
    expect(await grandchild.answer(scribe, "item_make", { ...WHISTLE, name: "a tin cup" })).toMatchObject({ staged: { changeType: "item_make" } });
    // An agent the engine never heard from, by a call of its own or as one over a caller, can't be placed: its job only reads.
    const ghost: Agent = { id: "never-heard-from", role: HARNESS_AGENT.author };
    const unknown = await beginJob(rig, turn, "job-unknown", ghost);
    expect(await unknown.refusal(worker, "gm_move", MOVE)).toBe(held("gm_move", ghost.id, "read"));
    expect(await unknown.refusal(scribe, "item_make", WHISTLE)).toBe(held("item_make", ghost.id, "read"));
    expect(JSON.stringify(await unknown.answer(scribe, "people_find", { name: "Okoro" }))).toContain("Okoro");
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).toBeNull();
    noModelCalls(rig);
  });
});

/** A harness chat whose world lets replies introduce `spawnCap` people, with Mara, Joss and Ilse in it: Brann and Okoro are no one yet. */
async function cappedChat(spawnCap: number): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true, minds: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  for (const id of [MARA, JOSS, "ilse"]) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id, value: PEOPLE[id] ?? {} }));
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "meta", value: { spawnCap } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.host.quietReply = () => {
    throw new Error("the harness path reached one of the engine's own model calls");
  };
  mount(rig);
  await playOn(rig, chatId, "harness");
  return { rig, chatId };
}

describe("a cap that holds across the turn is counted on what every agent staged", () => {
  test("the people replies may introduce: two agents staging side by side share the world's one cap", async () => {
    const { rig, chatId } = await cappedChat(1);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { spawn: { mode: "auto" } } } }));
    const turn = await beginTurn(rig, chatId, "I ask Mara who is new in town.");
    await turn.answer(AUTHOR, "time_clock");
    expect(await turn.answer(CHRONICLER, "person_add", { name: "Brann" })).toMatchObject({ staged: { changeType: "spawn" } });
    // The author reads what landed and what it staged itself: Brann is no one to it yet, and the cap is still the turn's.
    expect(await refusalOf(turn, AUTHOR, "person_add", { name: "Okoro" })).toMatchObject({ refused: { code: "spawn_cap" } });
    // The same note from another agent is the one already staged: one person, once.
    expect(await turn.answer(AUTHOR, "person_add", { name: "Brann" })).toMatchObject({ staged: { changeType: "spawn" } });
    const done = await committed(turn);
    expect([done.landed.length, done.refused]).toEqual([1, []]);
    await turn.finish("Brann, Mara says, as of this morning.");
    const names = await namesIn(rig, chatId);
    expect([names.includes("Brann"), names.includes("Okoro")]).toEqual([true, false]);
    noModelCalls(rig);
  });

  test("the facts a turn may record: two knowledge agents share the turn's one budget", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, knowledge: true }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { knowledge: { factsPerTurn: 1 } }, extraction: { learn: { mode: "auto" } } } }));
    const turn = await beginTurn(rig, chatId, "I ask Joss whether the rent is paid.");
    const told = (claim: string): JsonObject => ({ who: ["Mara", "Joss"], facts: [{ ref: "n1", claim, matters: "Mara means to collect, and Joss is hiding it." }], learned: [{ fact: "n1", how: "told", by: "Joss", who: ["Mara"] }] });
    const first = "Joss owes Mara two months of rent.";
    const second = "Joss has pawned the spare key.";
    const recorded = (await turn.answer({ id: "knowledge-1", role: HARNESS_AGENT.knowledge }, "knowledge_infer", told(first))).recorded as { claim: string }[];
    expect(recorded.map((r) => r.claim)).toEqual([first]);
    // Another agent of the same turn: what the first staged is no part of its own view, and counts against the turn all the same.
    const over = await turn.call({ id: "knowledge-2", role: HARNESS_AGENT.knowledge }, "knowledge_infer", told(second));
    expect(over.error).toBe(true);
    await turn.finish("Joss shrugs and says the rent can wait.");
    const claims = Object.values(readKnowledge(await stateOf(rig, chatId)).facts).map((fact) => fact.claim);
    expect([claims.includes(first), claims.includes(second)]).toEqual([true, false]);
    noModelCalls(rig);
  });
});

describe("what a gate's card taught", () => {
  test("is counted once the turn's record is written, and never for a turn that was let go", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { review: { placement: "gate" } }, extraction: { spawn: { mode: "confirm" } } } }));
    const learning = async (): Promise<string> => JSON.stringify(await rig.rt.settings.learningOf(rig.host.userId));
    const untaught = await learning();
    /** A turn whose author notes Brann, commits, and is let through at the gate by the game master. */
    const letThrough = async (text: string): Promise<Run> => {
      const turn = await beginTurn(rig, chatId, text);
      const said = rig.host.chat(chatId).messages.findLast((m) => m.isUser);
      if (!said) throw new Error("no message");
      await turn.answer(AUTHOR, "person_add", { name: "Brann" });
      const waiting = committed(turn);
      await rig.host.settle();
      const gate = `${said.id}:gate`;
      const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as { turn: string; items: { key: string }[] }[];
      expect(cards.map((c) => c.turn)).toEqual([gate]);
      rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: gate }));
      expect((await waiting).landed.length).toBe(1);
      return turn;
    };
    // Let through, then stopped: nothing of the turn stands, and neither does what its card taught.
    const stopped = await letThrough("I ask Mara who is new in town.");
    expect(await learning()).toBe(untaught);
    if (!stopped.generation) throw new Error("no generation");
    await rig.host.stop(stopped.generation, "Mara");
    await stopped.end("stopped");
    expect(await namesIn(rig, chatId)).not.toContain("Brann");
    expect(await learning()).toBe(untaught);
    // Let through, and the reply saved: the answer counts toward what the type learns.
    const kept = await letThrough("I ask again.");
    expect(await learning()).toBe(untaught);
    await kept.finish("Brann, Mara says, as of this morning.");
    expect(await namesIn(rig, chatId)).toContain("Brann");
    const taught = await learning();
    expect(taught).not.toBe(untaught);
    expect(taught).toContain("spawn");
    noModelCalls(rig);
  });
});

const PIER: JsonObject = { title: "The old pier", content: "The old pier burned in the year of the long fog.", keys: ["pier"], links: [] };

describe("what a turn asks of the world's document", () => {
  test("its last commit's is made once the turn's record is written, a call that waits for the turn waits for it, and a turn that is let go makes none", async () => {
    const { rig, chatId } = await harnessChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { world_document: { mode: "auto" } } } }));
    const build = await worldBuild(rig.rt, chatId, rig.host.userId);
    if (!build) throw new Error("the harness chat plays no world");
    const first = await build.head();
    const reply = "The pier burned in the year of the long fog, Mara says.";
    const turn = await beginTurn(rig, chatId, "I ask what became of the old pier.");
    await turn.answer(AUTHOR, "world_put", { collection: "lore", id: "old_pier", value: JSON.stringify(PIER) });
    await turn.answer(AUTHOR, "world_commit", { note: "The old pier's story" });
    await turn.answer(AUTHOR, "world_upgrade");
    // The author never commits: the reply's own commit lands both. Until then nothing is made.
    await turn.writer(A_BRIEF);
    await turn.written(reply);
    expect(await build.head()).toBe(first);
    // A job for after the reply reads the world before Lumiverse has saved the reply: its call waits for the turn's record and for what the turn asked of the world's document.
    const job = await beginJob(rig, turn, "job-after");
    let answered = false;
    const early = job.answer(CHRONICLER, "world_status").finally(() => {
      answered = true;
    });
    await rig.host.settle();
    expect(answered).toBe(false);
    if (!turn.generation) throw new Error("no generation");
    await rig.host.finish(turn.generation, reply);
    const status = await early;
    const second = await build.head();
    expect(second).not.toBe(first);
    expect(status).toMatchObject({ playing: second, head: second, behind: false });
    await turn.end();
    // So does what an agent of the turn still calls.
    expect(await turn.answer(AUTHOR, "world_status")).toMatchObject({ playing: second, head: second, behind: false });
    expect((await stateOf(rig, chatId)).revision).toBe(second);

    // A turn that is stopped with a commit of the document still staged makes nothing of it.
    const stopped = await beginTurn(rig, chatId, "I ask about the boathouse.");
    await stopped.answer(AUTHOR, "world_put", { collection: "lore", id: "boathouse", value: JSON.stringify({ ...PIER, title: "The boathouse", keys: ["boathouse"] }) });
    await stopped.answer(AUTHOR, "world_commit", { note: "The boathouse" });
    if (!stopped.generation) throw new Error("no generation");
    await rig.host.stop(stopped.generation, "The boat");
    await stopped.end("stopped");
    expect(await build.head()).toBe(second);
    expect((await stateOf(rig, chatId)).revision).toBe(second);
    noModelCalls(rig);
  });
});

describe("the bridge's own words and limits are the user's", () => {
  test("a tool that fails inside the engine is answered in the user's text for it", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts: { [HARNESS_NOTE.toolFailed]: "Engine trouble in {{tool}}: {{reason}}" } } } }));
    const turn = await beginTurn(rig, chatId, "I wait.");
    rig.rt.harness.files = () => {
      throw new Error("the files can't be reached");
    };
    const out = await turn.call(AUTHOR, "time_clock");
    expect(out).toEqual({ text: "Engine trouble in time_clock: the files can't be reached", error: true });
  });

  test("how many runs the engine remembers is a setting: past it the oldest run's late calls are answered that no turn is open", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { harness: { runsRemembered: 16 } } } }));
    const turn = await beginTurn(rig, chatId, "I wait.");
    await turn.answer(AUTHOR, "time_clock");
    await turn.finish(REPLY);
    const oldest = await beginJob(rig, turn, "job-0");
    expect(JSON.stringify(await oldest.answer(CHRONICLER, "people_find", { name: "Mara" }))).toContain("Mara");
    let newest = oldest;
    for (let n = 1; n <= 16; n++) newest = await beginJob(rig, turn, `job-${n}`);
    expect(await oldest.refusal(CHRONICLER, "people_find", { name: "Mara" })).toBe(note(HARNESS_NOTE.noTurn));
    expect(JSON.stringify(await newest.answer(CHRONICLER, "people_find", { name: "Mara" }))).toContain("Mara");
    noModelCalls(rig);
  });
});
