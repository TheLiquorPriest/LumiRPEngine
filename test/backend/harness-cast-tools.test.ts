// The harness engine's own tools (HARNESS-SLICE3: "Agents RPEngine registers"), each called as the
// bridge calls it (`runHarnessTool`) against a real chat: a valid call is checked by the engine's own
// validator and staged as the engine's own events, which hold when they are applied; a call that
// isn't valid is answered with what to fix, and stages nothing. The turn each call belongs to is a
// stand-in that keeps what was staged (`harness-cast-kit.ts`).
//
// None of these tools may reach a model: every test ends by checking that the engine made no model
// call of its own.

import { describe, expect, test } from "bun:test";
import { HARNESS_MIND_REASON } from "../../src/backend/agents/tools/harness-tools/minds";
import type { ToolWriter } from "../../src/backend/agents/tools/writer";
import { renderPrompt } from "../../src/backend/prompts";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { HARNESS_AGENT, HARNESS_NOTE } from "../../src/shared/harness-texts";
import type { JsonObject } from "../../src/shared/json";
import { MINDS_EVENTS } from "../../src/shared/minds";
import { ELAPSED_TEXT_IDS } from "../../src/shared/prompts";
import { TIME_LIMITS } from "../../src/engine/time-limits";
import { readCharacter, readKnowledge } from "../../src/packs/minds/core/state";
import { stateOf } from "../support/mind-chat";
import { HOME, POV, recordFix } from "../support/tools";
import { answer, applied, call, castChat, castEnv, castTurn, JOSS, MARA, noModelCalls, refusal } from "./harness-cast-kit";
import { type Agent, AUTHOR, BRANN, beginJob, beginTurn, harnessChat, noModelCalls as noModelCallsOf, stateOf as foldOf } from "./harness-driver";

/** A registry text as shipped, filled: what a tool answers when the user changed nothing. */
const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

const DECISION: JsonObject = { who: "Mara", monologue: "He is up early. I wonder why.", depiction: "Mara looks up from her cup.", intent: "Ask what he is doing today.", reactions: ["if asked about the rent, changes the subject"], mood: "curious" };
const REPLY = { messageId: "m-reply", text: "Mara laughs and says she will bring the ladder back at noon." };
const CLAIM = "Joss owes Mara two months of rent.";
const RENT: JsonObject = { ref: "n1", claim: CLAIM, matters: "Mara means to collect, and Joss is hiding it." };

describe("a person's own mind", () => {
  test("a character's agent reads as the one person it is, and its decision is staged as the mind step's own event", async () => {
    const { rig, chatId } = await castChat();
    const turn = await castTurn(rig, chatId, { main: false });
    const mind = castEnv(rig, chatId, turn, HARNESS_AGENT.character);

    const seen = await call(mind, "mind_view", { who: "Mara" });
    expect(seen.error).toBeUndefined();
    expect(seen.text.startsWith("You are Mara.")).toBe(true);
    expect(seen.text).toContain(turn.said.user);
    // Its first call made it Mara's mind; reading stages nothing.
    expect([turn.character, turn.changes]).toEqual([MARA, []]);

    const decided = await answer(mind, "mind_decide", DECISION);
    expect(decided.decided).toMatchObject({ who: { id: MARA, name: "Mara" }, intent: "Ask what he is doing today.", mood: "curious", lands: note(WRITE_NOTE.staged) });
    expect(turn.changes.map((c) => [c.changeType, c.time, c.proposal, c.events.map((e) => e.type), c.lines])).toEqual([["mind", undefined, undefined, [MINDS_EVENTS.mind], ["Mara's mind, at Near fidelity, means to: Ask what he is doing today."]]]);
    expect(turn.changes[0]?.events[0]).toMatchObject({ data: { entity: MARA, place: HOME, moment: "turn", reason: HARNESS_MIND_REASON, monologue: "He is up early. I wonder why.", depiction: "Mara looks up from her cup.", reactions: ["if asked about the rent, changes the subject"], interrupt: null } });
    // The engine's reducer takes it: Mara's mind is the one the call gave.
    const after = await applied(rig, chatId, turn.changes[0]?.events ?? []);
    expect(readCharacter(after.state, MARA).mind).toMatchObject({ intent: "Ask what he is doing today.", mood: "curious" });
    expect(readCharacter(after.before, MARA).mind).toBeNull();

    // The same decision again is the one staged; a moment inside skipped time may say it would break in.
    await answer(mind, "mind_decide", DECISION);
    expect(turn.changes.length).toBe(1);
    await answer(mind, "mind_decide", { who: MARA, intent: "Go and knock on his door.", moment: "beat", interrupt: { reason: "The rent is due today." } });
    expect(turn.changes[1]?.events[0]).toMatchObject({ data: { entity: MARA, moment: "beat", interrupt: { reason: "The rent is due today." } } });
    noModelCalls(rig);
  });

  test("a mind decides for itself alone: not for another person, not for the player's character, and no other agent decides for it", async () => {
    const { rig, chatId } = await castChat();
    const turn = await castTurn(rig, chatId, { main: false });
    const mind = castEnv(rig, chatId, turn, HARNESS_AGENT.character);
    await answer(mind, "mind_decide", DECISION);

    // Mara's agent names Joss: refused with whose mind it is, and nothing of Joss's is staged.
    for (const tool of ["mind_decide", "mind_view", "mind_remember"]) expect(await refusal(mind, tool, { who: "Joss", intent: "Leave without paying." })).toBe(note(HARNESS_NOTE.otherMind, { self: "Mara", other: "Joss", tool }));
    expect<unknown>(turn.changes.map((c) => c.events.map((e) => ("data" in e ? e.data.entity : null)))).toEqual([[MARA]]);

    // The author knows what no one person does, so it writes no mind itself; nor does any agent but a character.
    for (const role of [HARNESS_AGENT.author, HARNESS_AGENT.gm, HARNESS_AGENT.knowledge, HARNESS_AGENT.chronicler, "someone_else"]) {
      const other = await castTurn(rig, chatId, { main: role === HARNESS_AGENT.author });
      expect(await refusal(castEnv(rig, chatId, other, role), "mind_decide", DECISION)).toBe(note(HARNESS_NOTE.notCharacter, { tool: "mind_decide" }));
      expect([other.character, other.changes]).toEqual([null, []]);
    }

    // The player decides for their own character.
    const fresh = await castTurn(rig, chatId, { main: false });
    const pov = (await stateOf(rig, chatId)).state.entities[POV]?.name ?? "";
    expect(await refusal(castEnv(rig, chatId, fresh, HARNESS_AGENT.character), "mind_decide", { ...DECISION, who: POV })).toBe(note(HARNESS_NOTE.playerMind, { name: pov }));
    expect(fresh.character).toBeNull();

    // What a call got wrong is said so that the next call can fix it.
    const again = castEnv(rig, chatId, await castTurn(rig, chatId, { main: false }), HARNESS_AGENT.character);
    expect(await refusal(again, "mind_decide", { who: "Mara" })).toBe(note(HARNESS_NOTE.mindEmpty));
    expect(await refusal(again, "mind_decide", { ...DECISION, moment: "dusk" })).toContain("turn, beat");
    expect(await refusal(again, "mind_decide", { intent: "Wait." })).toContain("mind_decide needs who");
    expect(await refusal(again, "mind_decide", { ...DECISION, who: "Nobody By That Name" })).toContain("Nobody By That Name");

    // Minds switched off in Settings: nothing is recorded, and the mind is told to answer in words.
    const settings = (await castTurn(rig, chatId)).settings;
    const off = await castTurn(rig, chatId, { main: false, settings: { ...settings, minds: { ...settings.minds, enabled: false } } });
    expect(await refusal(castEnv(rig, chatId, off, HARNESS_AGENT.character), "mind_decide", DECISION)).toBe(note(HARNESS_NOTE.mindsOff));
    // Outside a harness turn there is nothing to stage into.
    expect(await refusal(castEnv(rig, chatId, null, HARNESS_AGENT.character), "mind_decide", DECISION)).toBe(note(HARNESS_NOTE.noTurn));
    noModelCalls(rig);
  });

  test("after the reply it remembers the turn as written, and is told what was left out and why", async () => {
    const { rig, chatId } = await castChat();
    const turn = await castTurn(rig, chatId, { main: false, reply: REPLY });
    const mind = castEnv(rig, chatId, turn, HARNESS_AGENT.character);

    // Once the reply is written, what it reads is that turn as written.
    const seen = await call(mind, "mind_view", { who: "Mara" });
    expect(seen.text).toContain("## The turn just written");
    expect(seen.text).toContain(REPLY.text);

    const remembered = await answer(mind, "mind_remember", {
      who: MARA,
      notes: [{ text: "He asked who was in today.", salience: 2 }, { text: "" }],
      commitments: [{ kind: "promise", with: ["Joss"], text: "Bring the ladder back at noon." }],
      plans: [{ what: "Return the ladder", kind: "errand", when: { from: "12:00" } }, { what: "No time given", when: { from: "whenever" } }],
      told: [{ to: ["Joss"], what: "The ladder comes back at noon." }],
      resolved: [{ id: "no-such-commitment", status: "kept" }],
    });
    // After the reply no turn holds a change: it is written as it is made, and the answer says so.
    expect(remembered.remembered).toEqual({ who: { id: MARA, name: "Mara" }, notes: 1, commitments: 1, resolved: 0, plans: 1, told: 1, summary: false, lands: note(HARNESS_NOTE.recorded) });
    expect(remembered.leftOut).toEqual([note(HARNESS_NOTE.leftWordless, { count: "1", list: "notes" }), note(HARNESS_NOTE.leftPlans, { count: "1" }), note(HARNESS_NOTE.leftResolved, { count: "1" })]);
    expect(turn.changes.map((c) => [c.changeType, c.events.map((e) => e.type)])).toEqual([["mind", [MINDS_EVENTS.memory]]]);
    const after = await applied(rig, chatId, turn.changes[0]?.events ?? []);
    const kept = readCharacter(after.state, MARA);
    expect([kept.notes.map((n) => n.text), kept.commitments.map((c) => [c.kind, c.with, c.text]), kept.plans.map((p) => p.what)]).toEqual([["He asked who was in today."], [["promise", [JOSS], "Bring the ladder back at noon."]], ["Return the ladder"]]);

    // Nothing it can keep is no memory: the mind is told why, and nothing is staged.
    const empty = await castTurn(rig, chatId, { main: false, reply: REPLY });
    expect(await refusal(castEnv(rig, chatId, empty, HARNESS_AGENT.character), "mind_remember", { who: MARA, notes: [{ text: "" }] })).toBe(note(HARNESS_NOTE.memoryEmpty, { why: note(HARNESS_NOTE.leftWordless, { count: "1", list: "notes" }) }));
    expect(empty.changes).toEqual([]);

    // While the chat tracks who knows what, telling is the knowledge agent's to record.
    const knowing = await castTurn(rig, chatId, { main: false, reply: REPLY, knowing: true });
    const told = await answer(castEnv(rig, chatId, knowing, HARNESS_AGENT.character), "mind_remember", { who: MARA, notes: [{ text: "He asked who was in today." }], told: [{ to: ["Joss"], what: "The ladder comes back at noon." }] });
    expect(told.leftOut).toEqual([note(HARNESS_NOTE.leftToldKnowing)]);
    expect(knowing.changes[0]?.events[0]).toMatchObject({ data: { told: [] } });
    noModelCalls(rig);
  });
});

describe("who knows what", () => {
  test("the scene is the knowledge step's own context, and an answer is checked as the step's is: what holds is staged, the player character's own as a change its mode decides", async () => {
    const { rig, chatId } = await castChat();
    const turn = await castTurn(rig, chatId, { main: false, knowing: true });
    const agent = castEnv(rig, chatId, turn, HARNESS_AGENT.knowledge);

    const scene = await call(agent, "knowledge_scene", {});
    expect(scene.error).toBeUndefined();
    for (const part of ["## What happened this turn", turn.said.user, "## Who could perceive it", "- Mara (id: mara): there throughout", "What this turn can still record: 3 new facts"]) expect(scene.text).toContain(part);
    expect(await refusal(agent, "knowledge_scene", { who: ["Okoro"] })).toBe(note(HARNESS_NOTE.knowledgeNotThere, { name: "Okoro" }));

    const recorded = await answer(agent, "knowledge_infer", { facts: [RENT], learned: [{ fact: "n1", how: "witnessed" }] });
    const lines = recorded.recorded as { who: string[]; claim: string; how: string; lands: string }[];
    expect(lines.map((l) => [l.claim, l.how, l.lands])).toEqual([[CLAIM, "witnessed", note(WRITE_NOTE.staged)], [CLAIM, "witnessed", note(WRITE_NOTE.staged)]]);
    expect(lines[0]?.who).toContain("Mara");
    expect(lines[1]?.who.length).toBe(1);
    // Everyone else's learning is one `learn` change of the engine's events; the player character's own carries the proposal its channel takes, for the review card.
    expect(turn.changes.map((c) => [c.changeType, c.proposal !== undefined, c.events.map((e) => e.type)])).toEqual([["learn", false, [MINDS_EVENTS.fact, MINDS_EVENTS.learn]], ["learn", true, [MINDS_EVENTS.fact, MINDS_EVENTS.learn]]]);
    expect(turn.changes[1]?.proposal).toMatchObject({ type: "learn", claim: CLAIM, learn: { who: [POV] } });
    // Both hold when they land in staging order: the second names the same fact, which is recorded once.
    const after = await applied(rig, chatId, turn.changes.flatMap((c) => c.events));
    const known = readKnowledge(after.state);
    expect(Object.values(known.facts).map((f) => f.claim)).toEqual([CLAIM]);
    expect([MARA, JOSS, POV].map((id) => Object.keys(known.holdings[id] ?? {}).length)).toEqual([1, 1, 1]);
    noModelCalls(rig);
  });

  test("what the knowledge step's check refuses is refused, with the engine's reason, and nothing of it is staged", async () => {
    const { rig, chatId } = await castChat();
    const turn = await castTurn(rig, chatId, { main: false, knowing: true });
    const agent = castEnv(rig, chatId, turn, HARNESS_AGENT.knowledge);
    const unlearned = `- ${note(HARNESS_NOTE.knowledgeUnlearned, { claim: CLAIM })}`;
    const refusedFor = (...reasons: string[]): string => note(HARNESS_NOTE.knowledgeRefused, { refused: reasons.join("\n") });

    // A teller who doesn't hold what they tell; an inference from nothing its person holds; the player character's own inference; a fact that doesn't say why it matters; a fact no one learned.
    expect(await refusal(agent, "knowledge_infer", { facts: [RENT], learned: [{ fact: "n1", how: "told", by: "Okoro", who: ["Mara"] }] })).toBe(refusedFor(`- Okoro told what they don't hold: "${CLAIM}"`, unlearned));
    expect(await refusal(agent, "knowledge_infer", { facts: [RENT], inferred: [{ who: "Mara", fact: "n1", confidence: 0.8, evidence: ["nothing-held"] }] })).toBe(refusedFor(`- Mara infers from what they neither hold nor witnessed (nothing-held): "${CLAIM}"`, unlearned));
    expect(await refusal(agent, "knowledge_infer", { facts: [RENT], inferred: [{ who: POV, fact: "n1", confidence: 0.8, evidence: ["n1"] }] })).toContain("or by the player character");
    expect(await refusal(agent, "knowledge_infer", { facts: [{ ref: "n1", claim: CLAIM }], learned: [{ fact: "n1", how: "witnessed" }] })).toContain("a new fact that doesn't say why it matters, or to whom");
    expect(await refusal(agent, "knowledge_infer", { facts: [RENT] })).toBe(refusedFor(unlearned));
    expect(await refusal(agent, "knowledge_infer", {})).toBe(note(HARNESS_NOTE.knowledgeNothing));
    expect(turn.changes).toEqual([]);

    // A chat that doesn't track who knows what has nothing to read and records nothing.
    const off = await castTurn(rig, chatId, { main: false });
    for (const tool of ["knowledge_scene", "knowledge_infer"]) expect(await refusal(castEnv(rig, chatId, off, HARNESS_AGENT.knowledge), tool, { facts: [RENT], learned: [{ fact: "n1", how: "witnessed" }] })).toBe(note(HARNESS_NOTE.knowledgeOff));
    // Before the reply, in a turn that answers no message of the player's, there is nothing to record a learning against.
    const unanswered = await castTurn(rig, chatId, { main: false, knowing: true, said: { messageId: null, user: "", before: "Morning." } });
    expect(await refusal(castEnv(rig, chatId, unanswered, HARNESS_AGENT.knowledge), "knowledge_infer", { facts: [RENT], learned: [{ fact: "n1", how: "witnessed" }] })).toBe(note(HARNESS_NOTE.knowledgeNoMessage));
    // A change type the user set to Never is refused where it is staged, and the answer carries why.
    const never = await castTurn(rig, chatId, { main: false, knowing: true, refuse: { refused: true, code: "never", reason: "Learning is set to Never." } });
    expect(await refusal(castEnv(rig, chatId, never, HARNESS_AGENT.knowledge), "knowledge_infer", { who: ["Mara", "Joss"], facts: [RENT], learned: [{ fact: "n1", how: "told", by: "Joss", who: ["Mara"] }] })).toBe(refusedFor("- Learning is set to Never."));
    noModelCalls(rig);
  });

  test("a turn's limits hold across calls: what it already recorded counts, and what someone already holds is not recorded again", async () => {
    const { rig, chatId } = await castChat();
    const turn = await castTurn(rig, chatId, { main: false, knowing: true });
    const agent = castEnv(rig, chatId, turn, HARNESS_AGENT.knowledge);
    const told = { who: ["Mara", "Joss"], facts: [RENT], learned: [{ fact: "n1", how: "told", by: "Joss", who: ["Mara"], keptFrom: ["everyone"] }] };
    await answer(agent, "knowledge_infer", told);
    // Kept from everyone, as the one word in the list says.
    expect(turn.changes[0]?.events.at(-1)).toMatchObject({ type: MINDS_EVENTS.learn, data: { who: [MARA], by: JOSS, how: "told", keptFrom: "everyone" } });
    // Once the change is in the state the tools read, the turn has spent it: one fact and one learning fewer.
    await recordFix(rig, chatId, "staged-learning", turn.changes[0]?.events ?? []);
    const scene = await call(agent, "knowledge_scene", { who: ["Mara"] });
    expect(scene.text).toContain("What this turn can still record: 2 new facts");
    expect(scene.text).toContain("and 23 learnings");
    expect(scene.text).toContain("Joss owes Mara two months of rent. (told by Joss); keeps it from everyone");
    expect(await refusal(agent, "knowledge_infer", told)).toBe(note(HARNESS_NOTE.knowledgeHeld));
    noModelCalls(rig);
  });
});

// The engine's dice (`checks_stakes`, `action_play`) have a file of their own: `harness-cast-play.test.ts`.

describe("time", () => {
  test("the author passes a turn's time: the engine runs the world across the span, and the change, of the type time passing, says how much time the turn takes", async () => {
    const { rig, chatId } = await castChat();
    const turn = await castTurn(rig, chatId);
    const author = castEnv(rig, chatId, turn);

    const passed = await answer(author, "time_pass", { minutes: 30 });
    expect(passed.passed).toEqual({ minutes: 30, line: "This turn took 30 min, from 6:15 AM to 6:45 AM.", now: "Mon 14 Sep 2026, 6:45 AM", lands: note(WRITE_NOTE.staged) });
    const change = turn.changes[0];
    // Under the player's mode for time passing, with the proposal the reply's card would make it from again.
    expect([turn.changes.length, change?.changeType, change?.time, change?.proposal, change?.lines[0]]).toEqual([1, "time_advance", 30, { type: "time_advance", minutes: 30 }, "This turn took 30 min, from 6:15 AM to 6:45 AM."]);
    // The world ran: beside the clock, someone's routine took them to work, and the answer says so.
    expect(change?.events.some((e) => e.type === "set" && e.field === "place")).toBe(true);
    expect((passed.happened as string[]).length).toBeGreaterThan(0);
    expect(change?.lines.slice(1)).toEqual(passed.happened as string[]);
    const after = await applied(rig, chatId, change?.events ?? []);
    expect(after.state.clock - after.before.clock).toBe(30);
    // The player's character is held where the story has them.
    expect(after.state.entities[POV]?.fields.place).toBe(HOME);

    // No time is said, not left out: a change of no events that still says the turn's time. It records nothing, so it is under no mode.
    const none = await answer(author, "time_pass", { minutes: 0 });
    expect(none).toEqual({ passed: { minutes: 0, line: note(ELAPSED_TEXT_IDS.none), now: "Mon 14 Sep 2026, 6:15 AM", lands: note(WRITE_NOTE.staged) } });
    expect(turn.changes[1]).toMatchObject({ changeType: null, time: 0, events: [], lines: [note(ELAPSED_TEXT_IDS.none)] });
    expect(turn.changes[1]?.proposal).toBeUndefined();

    // A time instead of a span; a longer span runs more of the world.
    expect((await answer(author, "time_pass", { until: "2026-09-14 07:00" })).passed).toMatchObject({ minutes: 45, now: "Mon 14 Sep 2026, 7:00 AM" });
    await answer(author, "time_pass", { minutes: 480 });
    const day = turn.changes.at(-1);
    expect([day?.time, (day?.events.length ?? 0) > (change?.events.length ?? 0)]).toEqual([480, true]);
    expect((await applied(rig, chatId, day?.events ?? [])).state.clock - after.before.clock).toBe(480);
    noModelCalls(rig);
  });

  test("a span it can't pass is answered with why: unreadable, into the past, longer than the player lets one call move the clock, not the author's, after the reply, or while the player has paused the clock", async () => {
    const { rig, chatId } = await castChat();
    const turn = await castTurn(rig, chatId);
    const author = castEnv(rig, chatId, turn);
    const unreadable: JsonObject[] = [{}, { minutes: -5 }, { minutes: 2.5 }, { minutes: "soon" }];
    for (const args of unreadable) expect(await refusal(author, "time_pass", args)).toBe(note(HARNESS_NOTE.timeMinutes));
    for (const until of ["1999-01-01 00:00", "next Tuesday"]) expect(await refusal(author, "time_pass", { until })).toBe(note(HARNESS_NOTE.timeUntil, { now: "2026-09-14 06:15" }));
    // The farthest one call moves the clock is the player's to set (Settings → Agents), never past the engine's own reach.
    expect(await refusal(author, "time_pass", { minutes: TIME_LIMITS.timelapseMinutes + 1 })).toBe(note(HARNESS_NOTE.timeTooLong, { minutes: String(TIME_LIMITS.timelapseMinutes) }));
    const agents = turn.settings.agents;
    const brief = await castTurn(rig, chatId, { settings: { ...turn.settings, agents: { ...agents, harnessLimits: { ...agents.harnessLimits, timePassMinutes: 60 } } } });
    expect(await refusal(castEnv(rig, chatId, brief), "time_pass", { minutes: 61 })).toBe(note(HARNESS_NOTE.timeTooLong, { minutes: "60" }));
    expect((await answer(castEnv(rig, chatId, brief), "time_pass", { minutes: 60 })).passed).toMatchObject({ minutes: 60 });
    // In a turn the time is the author's alone: an agent it started tells it how long things took.
    const other = await castTurn(rig, chatId, { main: false });
    for (const role of [HARNESS_AGENT.character, HARNESS_AGENT.gm, HARNESS_AGENT.chronicler, HARNESS_AGENT.author]) expect(await refusal(castEnv(rig, chatId, other, role), "time_pass", { minutes: 5 })).toBe(note(HARNESS_NOTE.timeAuthor));
    expect(await refusal(castEnv(rig, chatId, null), "time_pass", { minutes: 5 })).toBe(note(HARNESS_NOTE.noTurn));
    // Once the reply is written the turn's time is settled: no one passes it then, a job's agent or the author itself, whatever tier it holds.
    const after = await castTurn(rig, chatId, { main: false, reply: REPLY, tier: "gm" });
    const still = await castTurn(rig, chatId, { main: true, reply: REPLY });
    for (const env of [castEnv(rig, chatId, after, HARNESS_AGENT.chronicler), castEnv(rig, chatId, after, HARNESS_AGENT.gm), castEnv(rig, chatId, still)]) expect(await refusal(env, "time_pass", { minutes: 5 })).toBe(note(HARNESS_NOTE.timeAfter));
    expect([turn.changes, other.changes, after.changes, still.changes]).toEqual([[], [], [], []]);

    // The player's mode for time passing decides a span: Confirm sends it to the review card, Never refuses it.
    const confirm = await castTurn(rig, chatId, { mode: "confirm" });
    expect((await answer(castEnv(rig, chatId, confirm), "time_pass", { minutes: 20 })).passed).toMatchObject({ lands: note(WRITE_NOTE.stagedReview) });
    const never = await castTurn(rig, chatId, { refuse: { refused: true, code: "never", reason: "Time passing is set to Never." } });
    expect(JSON.parse(await refusal(castEnv(rig, chatId, never), "time_pass", { minutes: 20 }))).toEqual({ refused: { code: "never", reason: "Time passing is set to Never." } });
    // A span longer than a reply passes without asking (Settings → Time) has no form the card could make again: the card lands it as it was run here.
    const long = await castTurn(rig, chatId, { settings: { ...turn.settings, time: { ...turn.settings.time, askBeyondMinutes: 30 } } });
    await answer(castEnv(rig, chatId, long), "time_pass", { minutes: 20 });
    await answer(castEnv(rig, chatId, long), "time_pass", { minutes: 45 });
    expect(long.changes.map((c) => [c.changeType, c.time, c.proposal])).toEqual([["time_advance", 20, { type: "time_advance", minutes: 20 }], ["time_advance", 45, undefined]]);

    // The player's pause holds the turn's time; saying that none passes still stands.
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "time", control: "pause", scope: { all: true }, to: true }));
    expect(await refusal(author, "time_pass", { minutes: 10 })).toBe(note(HARNESS_NOTE.timePaused));
    expect((await answer(author, "time_pass", { minutes: 0 })).passed).toMatchObject({ minutes: 0 });
    expect(turn.changes.map((c) => c.time)).toEqual([0]);
    noModelCalls(rig);
  });

  test("through the bridge's own turn: time_pass is the turn's main agent's alone, before its reply; a span is under the player's mode for time passing; and what happened in it is told with its secrets marked", async () => {
    // Brann stands where the player character wakes, the world keeps them secret, and their timetable takes them to the yard at half past six.
    const { rig, chatId } = await harnessChat({
      minds: true,
      put: {
        entities: { [BRANN]: { id: BRANN, kind: "character", name: "Brann", tier: "background", visibility: "secret", fields: { place: HOME }, relations: [] } },
        places: { the_yard: { id: "the_yard", name: "The Yard", parent: HOME, fields: {} } },
        schedules: { brann_rounds: { id: "brann_rounds", target: "place", owner: BRANN, recurrence: { every: "day" }, slots: [{ start: "06:30", end: "09:00", value: "the_yard" }] } },
      },
    });
    const clock = async (): Promise<number> => (await foldOf(rig, chatId)).clock;
    const start = await clock();
    const GM: Agent = { id: "gm-1", role: HARNESS_AGENT.gm };
    const gate = (tool: string): string => note(HARNESS_NOTE.authorOnly, { tool });

    // With time passing set to Never the author's span is refused, and saying that none passes still stands: it records nothing.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { time_advance: { mode: "never" } } } }));
    const held = await beginTurn(rig, chatId, "I wait by the window.");
    expect(JSON.parse(await held.refusal(AUTHOR, "time_pass", { minutes: 30 }))).toMatchObject({ refused: { code: "mode_never" } });
    expect((await held.answer(AUTHOR, "time_pass", { minutes: 0 })).passed).toMatchObject({ minutes: 0 });
    await held.finish("Nothing stirs.");
    expect(await clock()).toBe(start);

    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { time_advance: { mode: "auto" } } } }));
    const turn = await beginTurn(rig, chatId, "I wait a while longer.");
    // An agent the author started, whatever its definition, and a second agent run as the author's own: neither says the turn's time.
    for (const agent of [GM, { id: "delegate-7", role: HARNESS_AGENT.author }]) expect(await turn.refusal(agent, "time_pass", { minutes: 5 })).toBe(gate("time_pass"));
    const passed = await turn.answer(AUTHOR, "time_pass", { minutes: 30 });
    expect(passed.passed).toMatchObject({ minutes: 30, lands: note(WRITE_NOTE.staged) });
    // What happened in the span names Brann, whom the world keeps from the player's character: each such line is marked.
    const lines = (passed.happened ?? []) as string[];
    expect(lines.some((line) => line.includes("Brann"))).toBe(true);
    expect(lines.filter((line) => line.includes("Brann") && !line.includes("[secret;"))).toEqual([]);
    await turn.finish("The light changes.");
    expect((await clock()) - start).toBe(30);

    // After the reply no one passes time with it: a job's agent is refused, whichever it is, and so is the author's own handle. The clock stands.
    const job = await beginJob(rig, turn, "job-after");
    for (const agent of [GM, { id: "chronicler-1", role: HARNESS_AGENT.chronicler }]) expect((await job.call(agent, "time_pass", { minutes: 5 })).error).toBe(true);
    expect((await turn.call(AUTHOR, "time_pass", { minutes: 5 })).error).toBe(true);
    expect((await clock()) - start).toBe(30);
    noModelCallsOf(rig);
  });
});

describe("the turn's own tools", () => {
  test("only the author commits, and only while its turn is open", async () => {
    const { rig, chatId } = await castChat();
    const turn = await castTurn(rig, chatId);
    const author = castEnv(rig, chatId, turn);
    await answer(author, "time_pass", { minutes: 0 });
    expect(await answer(author, "commit", { note: "before the reply" })).toEqual({ committed: { landed: [[note(ELAPSED_TEXT_IDS.none)]], review: [], refused: [] } });
    await answer(author, "commit");
    expect(turn.committed).toEqual(["before the reply", null]);

    const other = await castTurn(rig, chatId, { main: false });
    for (const role of [HARNESS_AGENT.character, HARNESS_AGENT.gm, HARNESS_AGENT.knowledge, HARNESS_AGENT.chronicler]) expect(await refusal(castEnv(rig, chatId, other, role), "commit")).toBe(note(HARNESS_NOTE.commitAuthor));
    // After the reply each change is written as it is made: nothing waits.
    const after = await castTurn(rig, chatId, { main: false, reply: REPLY });
    expect(await refusal(castEnv(rig, chatId, after), "commit")).toBe(note(HARNESS_NOTE.notTurn));
    expect(await refusal(castEnv(rig, chatId, null), "commit")).toBe(note(HARNESS_NOTE.noTurn));
    expect([other.committed, after.committed]).toEqual([[], []]);
    // What the bridge refuses of a commit is the tool's answer.
    const refusing = await castTurn(rig, chatId);
    refusing.commit = async () => ({ refused: true, code: "paused", reason: "The chat is paused on an edit." });
    expect(JSON.parse(await refusal(castEnv(rig, chatId, refusing), "commit"))).toEqual({ refused: { code: "paused", reason: "The chat is paused on an edit." } });
    noModelCalls(rig);
  });

  test("only the author grants writes, to an agent or a kind of agent, at a tier the engine has", async () => {
    const { rig, chatId } = await castChat();
    const turn = await castTurn(rig, chatId);
    const author = castEnv(rig, chatId, turn);
    expect(await answer(author, "grant_writes", { to: HARNESS_AGENT.chronicler, tier: "gm" })).toEqual({ granted: { to: HARNESS_AGENT.chronicler, tier: "gm" } });
    expect(turn.granted).toEqual([[HARNESS_AGENT.chronicler, "gm"]]);
    // A grant opens the story's changes or the game master's edits: every agent reads from the start, so `read` is no tier to grant.
    expect(await refusal(author, "grant_writes", { to: HARNESS_AGENT.chronicler, tier: "admin" })).toContain("story, gm");
    expect(await refusal(author, "grant_writes", { to: HARNESS_AGENT.chronicler, tier: "read" })).toContain("story, gm");
    expect(await refusal(author, "grant_writes", { tier: "gm" })).toContain("grant_writes needs to");
    expect(await refusal(author, "grant_writes", { to: "nobody", tier: "gm" })).toBe(note(HARNESS_NOTE.grantNone, { to: "nobody" }));
    // Whom a grant can't reach is the turn's to say, and its reason is the tool's answer.
    const held = castEnv(rig, chatId, { ...turn, grant: () => ({ refused: true, code: "not_granted", reason: "the chronicler was started by an agent that holds less" }) });
    expect(await refusal(held, "grant_writes", { to: HARNESS_AGENT.chronicler, tier: "gm" })).toContain("started by an agent that holds less");
    const other = await castTurn(rig, chatId, { main: false });
    expect(await refusal(castEnv(rig, chatId, other, HARNESS_AGENT.chronicler), "grant_writes", { to: HARNESS_AGENT.chronicler, tier: "gm" })).toBe(note(HARNESS_NOTE.grantAuthor));
    const after = await castTurn(rig, chatId, { main: false, reply: REPLY });
    expect(await refusal(castEnv(rig, chatId, after), "grant_writes", { to: HARNESS_AGENT.chronicler, tier: "gm" })).toBe(note(HARNESS_NOTE.grantAuthor));
    expect([turn.granted.length, other.granted, after.granted]).toEqual([1, [], []]);
    noModelCalls(rig);
  });
});

describe("the old engines' tools through the harness", () => {
  test("a tool runs by its name with the env of the call; one the harness doesn't list isn't run", async () => {
    const { rig, chatId } = await castChat();
    const author = castEnv(rig, chatId, await castTurn(rig, chatId));
    expect(await answer(author, "time_clock")).toMatchObject({ time: "Mon 14 Sep 2026, 6:15 AM", minutes: 375, paused: false });
    expect(await answer(author, "people_where", { person: "Mara" })).toMatchObject({ person: { id: MARA } });
    // The workspace's own tools and the one that condenses with a model call aren't the engine's to run here; the lore tools that keep a file are (`harness-cast-surfaces.test.ts`).
    for (const tool of ["workspace_read", "workspace_write", "condense", "no_such_tool"]) expect(await refusal(author, tool, { path: "notes.md" })).toBe(note(HARNESS_NOTE.noTool, { tool }));
    noModelCalls(rig);
  });

  test("a fact a note tool notes is staged as the change its channel makes of it, with its proposal for the review card", async () => {
    const { rig, chatId } = await castChat();
    const turn = await castTurn(rig, chatId);
    const author = castEnv(rig, chatId, turn);
    // Someone who walks on: the spawn channel's events, which make the person when they land.
    expect(await answer(author, "person_add", { name: "Brann" })).toEqual({ staged: { changeType: "spawn", lines: ["Brann appears", "You now know Brann"], lands: note(WRITE_NOTE.staged) } });
    expect(turn.changes.map((c) => [c.changeType, c.proposal])).toEqual([["spawn", { type: "spawn", kind: "person", name: "Brann" }]]);
    const after = await applied(rig, chatId, turn.changes[0]?.events ?? []);
    const named = (state: typeof after.state): string[] => Object.values(state.entities).filter((e) => e.name === "Brann").map((e) => e.kind);
    expect([named(after.before), named(after.state)]).toEqual([[], ["person"]]);
    // The same fact again is the change already staged.
    await answer(author, "person_add", { name: "Brann" });
    expect(turn.changes.length).toBe(1);
    // A purchase is the economy's own: the goods and the money as one change.
    const bought = (await answer(author, "purchase", { item: "a loaf of bread", category: "food", price: 3 })).staged as { changeType: string; lines: string[] };
    expect([bought.changeType, bought.lines.length]).toEqual(["purchase", 2]);
    expect(turn.changes[1]).toMatchObject({ changeType: "purchase", proposal: { type: "purchase", item: "a loaf of bread", price: 300 } });
    await applied(rig, chatId, turn.changes[1]?.events ?? []);

    // Confirm sends it to the review card; Never refuses it; after the reply it is written at once.
    const confirm = await castTurn(rig, chatId, { mode: "confirm" });
    expect((await answer(castEnv(rig, chatId, confirm), "person_add", { name: "Brann" })).staged).toMatchObject({ lands: note(WRITE_NOTE.stagedReview) });
    const never = await castTurn(rig, chatId, { refuse: { refused: true, code: "never", reason: "Walk-on people are set to Never." } });
    expect(JSON.parse(await refusal(castEnv(rig, chatId, never), "person_add", { name: "Brann" }))).toEqual({ refused: { code: "never", reason: "Walk-on people are set to Never." } });
    const written = await castTurn(rig, chatId, { main: false, reply: REPLY, tier: "story" });
    expect((await answer(castEnv(rig, chatId, written, HARNESS_AGENT.chronicler), "person_add", { name: "Brann" })).staged).toMatchObject({ lands: note(HARNESS_NOTE.recorded) });
    // A place made in play for someone to be put in is its channel's change too.
    expect((await answer(author, "place_make", { name: "The back room", parent: HOME, as: "room", why: "Mara steps into it.", entity: "Mara" })).staged).toMatchObject({ changeType: "place_make" });
    expect(turn.changes[2]).toMatchObject({ changeType: "place_make", proposal: { type: "place_make", entity: MARA } });
    // What the channel refuses is refused with its reason, before anything is staged.
    expect(JSON.parse(await refusal(author, "person_add", { name: "Mara" }))).toEqual({ refused: { code: "duplicate", reason: "Mara already exists" } });
    expect(turn.changes.length).toBe(3);
    noModelCalls(rig);
  });

  test("a write through the call's writer says where it stands: with the turn until the reply, written at once after it", async () => {
    const { rig, chatId } = await castChat();
    const ops: unknown[] = [];
    const writer: ToolWriter = {
      dryRun: async () => ({ key: "k", changeType: "gm_edit", mode: "auto", lines: ["dry"] }),
      apply: async () => ({ applied: [], refused: [], chipId: null, pending: false }),
      stage: async (op) => {
        ops.push(op);
        return { key: "k", changeType: "gm_edit", mode: "auto", lines: ["Joss moves"] };
      },
    };
    const move = { entity: JOSS, to: HOME };
    const open = await answer(castEnv(rig, chatId, await castTurn(rig, chatId), HARNESS_AGENT.author, writer), "gm_move", move);
    expect(open).toEqual({ staged: { key: "k", changeType: "gm_edit", mode: "auto", lines: ["Joss moves"], lands: note(WRITE_NOTE.staged) } });
    const closed = await answer(castEnv(rig, chatId, await castTurn(rig, chatId, { main: false, reply: REPLY }), HARNESS_AGENT.chronicler, writer), "gm_move", move);
    expect(closed).toEqual({ staged: { key: "k", changeType: "gm_edit", mode: "auto", lines: ["Joss moves"], lands: note(HARNESS_NOTE.recorded) } });
    expect(ops.length).toBe(2);
    // An agent with no writer only reads, on the harness as before.
    expect(await refusal(castEnv(rig, chatId, await castTurn(rig, chatId, { main: false }), HARNESS_AGENT.gm), "gm_move", move)).toBe(note(WRITE_NOTE.noWriter));
    noModelCalls(rig);
  });
});
