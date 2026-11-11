// The engine's dice on the harness engine: an attempt read (`checks_stakes`) and an attempt played
// (`action_play`), each called as the bridge calls it (`runHarnessTool`) against a real chat, and
// then through the bridge's own turn. The read answers the odds and what is at stake and never a
// roll; the roll is made once, when the attempt is played, from the turn, who rolls and how many
// rolls the turn has recorded for them, so nothing a call says moves it; what a play records is one
// change of the type "What the author plays", which the player's mode decides like any other. A
// call that isn't valid is answered with what to fix, and stages nothing.
//
// No tool here may reach a model: every test ends by checking that the engine made no model call.

import { describe, expect, test } from "bun:test";
import { rollSeed } from "../../src/backend/agents/tools/harness-tools/checks";
import { renderPrompt } from "../../src/backend/prompts";
import { presetAdjudication } from "../../src/shared/adjudication";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { HARNESS_AGENT, HARNESS_NOTE } from "../../src/shared/harness-texts";
import { PLAY_NOTE } from "../../src/shared/harness-texts-play";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import { checkView } from "../../src/engine/adjudication";
import { ENGINE_EVENTS } from "../../src/engine/engine-pack";
import { allowedSkills, inferredOf, skillSources } from "../../src/engine/inferred";
import { actionOdds } from "../../src/engine/resolve";
import { stateOf } from "../support/mind-chat";
import type { Rig } from "../support/rig";
import { type AlderSetup, alderChat, HOME, POV, recordFix } from "../support/tools";
import { answer, applied, call, castChat, castEnv, type CastTurn, castTurn, DARE, guardModel, JOSS, noModelCalls, refusal } from "./harness-cast-kit";
import { AUTHOR, beginTurn, harnessChat, noModelCalls as noModelCallsOf, recordOn } from "./harness-driver";

/** A registry text as shipped, filled: what a tool answers when the user changed nothing. */
const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

/** What `checks_stakes` answers: the attempt before any dice fall. */
interface Stakes {
  action: { id: string; label: string };
  actor: { id: string; name: string };
  rolls: boolean;
  why?: string;
  outcome?: string;
  odds?: Record<string, number>;
  check?: { dice: string; modifier: number; dc: number };
  stakes: JsonObject;
  minutes: number;
  note: string;
}

/** What `action_play` answers: the attempt as it fell. */
interface Played {
  action: { id: string; label: string };
  actor: { id: string; name: string };
  outcome: string;
  passed?: boolean;
  rolled: boolean;
  roll?: { dice: string; natural: number; total: number; modifier: number; dc: number; margin: number };
  odds?: Record<string, number>;
  why?: string;
  detail?: string;
  retry?: string;
  minutes: number;
  recorded?: string[];
  lands?: string;
  note: string;
  tell?: string;
}

/** What a roll's answer holds and a read's never does. */
const ROLLED = ["roll", "rolled", "outcome", "passed", "recorded", "tell"];

/** An action whose one effect the rules refuse where no fight is under way. */
const CALL_OFF: JsonObject = { id: "call_off", label: "Call it off", params: {}, requires: [], outcomes: { default: [{ type: "combat.end", args: {} }] }, duration: "0" };

/** A rule of the world's that hears the dare pay or cost someone, and tips Joss 7 each time it does: what it gave says how often it fired. */
const TIP: JsonObject = { id: "tip", on: { event: "add" }, when: "event.field == 'cash' and (event.delta == 500 or event.delta == -500)", do: [{ type: "add", args: { entity: JOSS, field: "cash", delta: 7 } }] };

const cashOf = (state: { entities: Record<string, { fields: Record<string, unknown> }> }, who: string): number => Number(state.entities[who]?.fields.cash ?? 0);

/** Someone's cash as the chat's ledger folds it now: the field the dare pays into, and the tip. */
const cashIn = async (rig: Rig, chatId: string, who: string = POV): Promise<number> => cashOf((await stateOf(rig, chatId)).state, who);

const dataOf = (e: LedgerEvent | undefined): Record<string, unknown> => (e && "data" in e ? e.data : {});

/** The rolls `events` record for `who`: each as the engine records a check it rolled. */
const rollsOf = (events: readonly LedgerEvent[], who: string): Record<string, unknown>[] => events.filter((e) => e.type === ENGINE_EVENTS.check && dataOf(e).actor === who).map(dataOf);

/** The attempt as the engine recorded it among `events`. */
function adjudged(events: readonly LedgerEvent[]): Record<string, unknown> {
  const e = events.find((x) => x.type === ENGINE_EVENTS.adjudged);
  if (!e || !("data" in e)) throw new Error("no adjudged event");
  return e.data;
}

/** The dare as a fresh turn of `seed` plays it first: the dice are the turn's, so every such turn rolls the same. */
async function firstDare(rig: Rig, chatId: string, seed: string): Promise<Played> {
  return (await answer(castEnv(rig, chatId, await castTurn(rig, chatId, { seed })), "action_play", { action: "dare" })) as unknown as Played;
}

/** A turn on `chatId` whose dice fail the dare: the outcome is the engine's, so the test looks for a seed that falls that way. */
async function failingTurn(rig: Rig, chatId: string): Promise<CastTurn> {
  for (let i = 0; i < 32; i++) if ((await firstDare(rig, chatId, `seed-${i}`)).passed === false) return castTurn(rig, chatId, { seed: `seed-${i}` });
  throw new Error("no seed failed the dare");
}

describe("an attempt read, then played", () => {
  test("the read answers the odds and what is at stake and never a roll, however often it is asked; played, the attempt is rolled once and staged as one change of the type the author plays", async () => {
    const { rig, chatId } = await castChat();
    const turn = await castTurn(rig, chatId);
    const author = castEnv(rig, chatId, turn);
    const head = (await stateOf(rig, chatId)).state;

    const first = await call(author, "checks_stakes", { action: "dare" });
    const stakes = JSON.parse(first.text) as Stakes;
    expect(stakes).toMatchObject({ action: { id: "dare", label: "Take the dare" }, actor: { id: POV }, rolls: true, odds: { failure: 50, success: 50 }, check: { dice: "d20", dc: 11 }, stakes: DARE.outcomes as JsonObject, minutes: 5, note: note(HARNESS_NOTE.stakesNote) });
    // No roll and no outcome: there is nothing in it an agent could decline, or keep for another attempt.
    expect(Object.keys(stakes).filter((key) => ROLLED.includes(key))).toEqual([]);
    expect(first.text).not.toContain("natural");
    // The odds are the ones `checks_odds` reads for the same check.
    expect((await answer(author, "checks_odds", { action: "dare" })).odds).toEqual(stakes.odds);
    // Asked again, by anyone in the turn or in another, it answers the same; and it stages and changes nothing.
    for (const env of [author, castEnv(rig, chatId, turn, HARNESS_AGENT.gm), castEnv(rig, chatId, await castTurn(rig, chatId, { main: false, seed: "another" }), HARNESS_AGENT.gm)]) expect((await call(env, "checks_stakes", { action: "dare" })).text).toBe(first.text);
    expect(turn.changes).toEqual([]);
    expect((await stateOf(rig, chatId)).state).toEqual(head);

    // Played: the dice fall, once, and the answer is the roll the turn now holds.
    const played = (await answer(author, "action_play", { action: "dare" })) as unknown as Played;
    expect(played).toMatchObject({ action: stakes.action, actor: stakes.actor, rolled: true, roll: { dice: "d20", dc: 11 }, odds: stakes.odds ?? {}, minutes: 5, note: note(PLAY_NOTE.played, { minutes: "5" }), lands: note(WRITE_NOTE.staged) });
    const total = played.roll?.total ?? 0;
    // The outcome is the dice's, never an argument's: the total against the difficulty.
    expect([played.outcome, played.passed, played.roll?.margin]).toEqual(total >= 11 ? ["success", true, total - 11] : ["failure", false, total - 11]);
    expect(played.recorded).toContain(played.passed ? "Your cash went up by 500" : "Your cash went down by 500");

    // One change, of the type "What the author plays", saying nothing of the turn's time; the roll is in it, as the engine records a check it rolled.
    expect(turn.changes.map((c) => ({ changeType: c.changeType, time: c.time, lines: c.lines }))).toEqual([{ changeType: "play", time: undefined, lines: played.recorded ?? [] }]);
    const events = turn.changes[0]?.events ?? [];
    expect(rollsOf(events, POV)).toEqual([{ check: "dare", actor: POV, notation: "d20", natural: played.roll?.natural ?? 0, total, dc: 11, outcome: played.outcome }]);
    // Its events hold on the head as the engine's reducers take them.
    const { state, before } = await applied(rig, chatId, events);
    expect(cashOf(state, POV) - cashOf(before, POV)).toBe(played.passed ? 500 : -500);

    // Someone else's action is theirs: Joss pays or is paid, by a roll of Joss's own.
    const joss = (await answer(author, "action_play", { action: "dare", actor: "Joss" })) as unknown as Played;
    expect(joss).toMatchObject({ actor: { id: JOSS, name: "Joss" }, rolled: true });
    expect(joss.recorded).toContain(joss.passed ? "Joss's cash went up by 500" : "Joss's cash went down by 500");
    const theirs = await applied(rig, chatId, turn.changes[1]?.events ?? []);
    expect(cashOf(theirs.state, JOSS) - cashOf(theirs.before, JOSS)).toBe(joss.passed ? 500 : -500);

    // Staging is not landing: the chat's head is as it was until the author commits.
    expect((await stateOf(rig, chatId)).state).toEqual(head);
    noModelCalls(rig);
  });

  test("the dice are the turn's and the actor's: two attempts by one actor in one turn roll separately, and nothing a call says moves them", async () => {
    const { rig, chatId } = await castChat();
    const { state, world } = await stateOf(rig, chatId);

    // What a roll is drawn from: the turn, who rolls, and how many of their rolls the turn has recorded. Each recorded roll moves it on, for that actor alone.
    const turn = await castTurn(rig, chatId);
    const author = castEnv(rig, chatId, turn);
    const seeds = [rollSeed(turn, POV)];
    const theirs = rollSeed(turn, JOSS);
    const one = (await answer(author, "action_play", { action: "dare" })) as unknown as Played;
    seeds.push(rollSeed(turn, POV));
    const two = (await answer(author, "action_play", { action: "dare" })) as unknown as Played;
    seeds.push(rollSeed(turn, POV));
    expect(new Set(seeds).size).toBe(3);
    expect(rollSeed(turn, JOSS)).toBe(theirs);
    // Two attempts, two changes, each with its own roll on the turn's record.
    expect(turn.changes.map((c) => rollsOf(c.events, POV).map((r) => r.natural))).toEqual([[one.roll?.natural], [two.roll?.natural]]);
    // The first is the turn's first roll for them whoever plays it again in a turn of the same seed; the second is another, so across a few turns the two differ.
    expect((await firstDare(rig, chatId, turn.seed)).roll).toEqual(one.roll);
    const pairs: [number | undefined, number | undefined][] = [];
    for (let i = 0; i < 12; i++) {
      const env = castEnv(rig, chatId, await castTurn(rig, chatId, { seed: `pair-${i}` }));
      pairs.push([((await answer(env, "action_play", { action: "dare" })) as unknown as Played).roll?.natural, ((await answer(env, "action_play", { action: "dare" })) as unknown as Played).roll?.natural]);
    }
    expect(pairs.some(([a, b]) => a !== b)).toBe(true);
    // Another turn's seed draws other dice: across those turns both outcomes come up.
    const outcomes = new Set<string>();
    for (let i = 0; i < 16; i++) outcomes.add((await firstDare(rig, chatId, `seed-${i}`)).outcome);
    expect([...outcomes].sort()).toEqual(["failure", "success"]);

    // An argument the action doesn't declare is refused, by the read and by the play alike: nothing beside what the engine reads tells one call from another.
    const fresh = await castTurn(rig, chatId);
    const env = castEnv(rig, chatId, fresh);
    for (const tool of ["checks_stakes", "action_play"]) {
      expect(await refusal(env, tool, { action: "dare", params: { nonce: 3 } })).toBe(note(PLAY_NOTE.takesNone, { action: "dare", given: "nonce" }));
      expect(await refusal(env, tool, { action: "go", params: { to: HOME, nonce: 3, luck: "high" } })).toBe(note(PLAY_NOTE.undeclared, { action: "go", given: "nonce, luck", takes: "to, with" }));
      expect(await refusal(env, tool, { action: "try", params: { skill: "any", attempt: "talk my way past", nonce: 3 } })).toBe(note(PLAY_NOTE.undeclared, { action: "try", given: "nonce", takes: "skill, difficulty, against, with, attempt" }));
    }
    expect(fresh.changes).toEqual([]);

    // The open attempt no action covers: its wording is the story's, and no part of the dice. Reworded in a turn of the same seed it rolls the same.
    const skill = allowedSkills(inferredOf(world, state), skillSources(rig.rt.registry, world, state))[0]?.id ?? "";
    const tried = async (attempt: string): Promise<Played> => (await answer(castEnv(rig, chatId, await castTurn(rig, chatId, { seed: "same" })), "action_play", { action: "try", params: { skill, difficulty: "hard", attempt, against: ["Joss"] } })) as unknown as Played;
    const plain = await tried("talk my way past");
    const reworded = await tried("say something else entirely, at length, and hope");
    expect(plain).toMatchObject({ action: { id: "try" }, actor: { id: POV }, rolled: true });
    expect([reworded.roll, reworded.outcome]).toEqual([plain.roll, plain.outcome]);
    expect(plain.tell).toContain('for "talk my way past"');
    expect(plain.tell).toContain("against Joss");
    // Nor does how the approach was judged choose them: a rating changes what the policy lets it change, never the natural roll.
    const judged = (await answer(castEnv(rig, chatId, await castTurn(rig, chatId, { seed: turn.seed })), "action_play", { action: "dare", rating: 2, reason: "Rehearsed it." })) as unknown as Played;
    expect(judged.roll?.natural).toBe(one.roll?.natural);
    noModelCalls(rig);
  });

  test("a call that can't be read or played says what to fix and stages nothing; only the author plays, before the reply", async () => {
    const { rig, chatId } = await alderChat({ minds: true, put: { actions: { dare: DARE, locked_dare: { ...DARE, id: "locked_dare", label: "Take the locked dare", requires: ["1 > 2"], check: { id: "locked_dare", dice: "d20", dc: "11" } }, call_off: CALL_OFF } } });
    guardModel(rig);
    const turn = await castTurn(rig, chatId);
    const author = castEnv(rig, chatId, turn);
    const { state, world } = await stateOf(rig, chatId);

    for (const tool of ["checks_stakes", "action_play"]) {
      expect(await refusal(author, tool, {})).toContain(`${tool} needs action`);
      expect(await refusal(author, tool, { action: "fly" })).toContain(`${tool} doesn't take fly as action`);
      expect(await refusal(author, tool, { action: "dare", actor: "Nobody By That Name" })).toContain("Nobody By That Name");
      expect(await refusal(author, tool, { action: "try" })).toContain(`${tool} needs params`);
      // An action that can't be tried as things stand is refused with the engine's reason.
      expect(await refusal(author, tool, { action: "locked_dare" })).toBe(note(HARNESS_NOTE.rollUnavailable, { why: "requires 1 > 2" }));
      // Port Alder rates an approach from 0 to 2; odds are numbers by outcome.
      for (const rating of [99, -1]) expect(await refusal(author, tool, { action: "dare", rating })).toBe(note(HARNESS_NOTE.rollRating, { max: "2" }));
      for (const outcomes of ["nonsense", '{"success": 4}', '{"somewhere": 0.5}']) expect(await refusal(author, tool, { action: "dare", outcomes })).toBe(note(HARNESS_NOTE.rollOutcomes, { outcomes: "failure, success" }));
    }
    // The open attempt: a skill the chat doesn't roll is answered with those it does.
    const skills = allowedSkills(inferredOf(world, state), skillSources(rig.rt.registry, world, state)).map((s) => s.id);
    expect(skills.length).toBeGreaterThan(0);
    expect(await refusal(author, "checks_stakes", { action: "try", params: { skill: "juggling" } })).toContain(`"juggling" isn't a skill this chat rolls an open attempt with. Its skills: ${skills.join(", ")}.`);
    // The rules refuse the one thing it does, before any dice fall: nothing of it is played.
    expect(await refusal(author, "action_play", { action: "call_off" })).toBe(note(PLAY_NOTE.rejected, { why: "no fight is under way" }));

    // Playing needs the author's own turn, before its reply: outside one there is nothing to stage into, and any other agent is told whose call it is.
    expect(await refusal(castEnv(rig, chatId, null), "action_play", { action: "dare" })).toBe(note(HARNESS_NOTE.noTurn));
    const whose = note(PLAY_NOTE.author, { tool: "action_play" });
    const gm = await castTurn(rig, chatId, { main: false });
    expect(await refusal(castEnv(rig, chatId, gm, HARNESS_AGENT.gm), "action_play", { action: "dare" })).toBe(whose);
    const after = await castTurn(rig, chatId, { reply: { messageId: "m-reply", text: "They take the dare." } });
    expect(await refusal(castEnv(rig, chatId, after), "action_play", { action: "dare" })).toBe(whose);
    // A change the turn refuses to stage is answered with the turn's own refusal, and with nothing of the roll.
    const closed = await castTurn(rig, chatId, { refuse: { refused: true, code: "no_turn", reason: "the turn is over", key: "k" } });
    expect(JSON.parse(await refusal(castEnv(rig, chatId, closed), "action_play", { action: "dare" }))).toEqual({ refused: { code: "no_turn", reason: "the turn is over" } });

    expect([turn.changes, gm.changes, after.changes, closed.changes]).toEqual([[], [], [], []]);
    noModelCalls(rig);
  });
});

describe("the chat's retry rule", () => {
  test("a failed attempt played again in the same scene is answered as the engine answers it: no new roll, the same failure; it rolls anew once the rule's wait has passed", async () => {
    const { rig, chatId } = await castChat();
    // Until its first turn a chat plays under the user's own policy (Settings), which here gives a failed attempt one try a scene.
    const once = { ...presetAdjudication("crunchy"), preset: "custom", retry: "once" };
    rig.body(await rig.send({ type: "lre.settings.set", patch: { adjudication: once as unknown as JsonObject } }));
    const turn = await failingTurn(rig, chatId);
    const author = castEnv(rig, chatId, turn);
    const name = (await stateOf(rig, chatId)).state.entities[POV]?.name ?? "";

    // The failed attempt is recorded as the retry rule keeps one: who, what, where, and that it failed.
    const first = (await answer(author, "action_play", { action: "dare" })) as unknown as Played;
    expect(first).toMatchObject({ rolled: true, outcome: "failure", passed: false });
    expect(first.recorded).toContain("Your cash went down by 500");
    expect(first.retry).toBeUndefined();
    const played = turn.changes[0]?.events ?? [];
    expect(adjudged(played)).toMatchObject({ actor: POV, action: "dare", outcome: "failure", rolled: true, failed: true });
    expect(typeof adjudged(played).key).toBe("string");
    await applied(rig, chatId, played);
    await recordFix(rig, chatId, "play-1", played);

    // Tried again where nothing changed: the engine rolls nothing and the earlier failure stands, with what failing does.
    const head = await author.reader.view();
    const odds = actionOdds(rig.rt.registry, head.world, head.state, { action: "dare" });
    expect(odds.verdict).toMatchObject({ roll: false, why: "retry", outcome: "failure" });
    // The read says so before anyone plays it.
    expect(await answer(author, "checks_stakes", { action: "dare" })).toMatchObject({ rolls: false, why: "retry", outcome: "failure" });
    const again = (await answer(author, "action_play", { action: "dare" })) as unknown as Played;
    expect(again).toMatchObject({ rolled: false, why: "retry", detail: checkView(odds, "once").detail ?? "", outcome: "failure", passed: false, retry: note(PLAY_NOTE.retryOnce, { name }) });
    expect(again.recorded).toContain("Your cash went down by 500");
    expect(again.detail).toBe("Retry needs a new scene");
    expect(again.roll).toBeUndefined();
    // And so does the record: a refused retry is no new attempt and no roll, so the rule's wait still runs from the failed roll.
    const refusedRetry = adjudged(turn.changes[1]?.events ?? []);
    expect(refusedRetry).toMatchObject({ actor: POV, action: "dare", outcome: "failure", rolled: false, why: "retry" });
    expect(refusedRetry.key).toBeUndefined();
    expect(rollsOf(turn.changes[1]?.events ?? [], POV)).toEqual([]);
    await applied(rig, chatId, turn.changes[1]?.events ?? []);

    // Under `changed` the same holds until something changes: an hour on, the attempt is rolled anew.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { adjudication: { ...once, retry: "changed", retryAfter: 60 } as unknown as JsonObject } }));
    const waiting = await castTurn(rig, chatId, { seed: turn.seed });
    const still = (await answer(castEnv(rig, chatId, waiting), "action_play", { action: "dare" })) as unknown as Played;
    expect(still).toMatchObject({ rolled: false, why: "retry", detail: "Retry needs a change", retry: note(PLAY_NOTE.retryChanged, { name, minutes: "60" }) });
    const hour = await castTurn(rig, chatId);
    await answer(castEnv(rig, chatId, hour), "time_pass", { minutes: 60 });
    await recordFix(rig, chatId, "hour-1", hour.changes[0]?.events ?? []);
    const later = (await answer(castEnv(rig, chatId, await castTurn(rig, chatId, { seed: turn.seed })), "action_play", { action: "dare" })) as unknown as Played;
    expect(later.rolled).toBe(true);
    expect(later.retry).toBeUndefined();
    noModelCalls(rig);
  });
});

describe("the dice through the bridge's own turn", () => {
  /** A harness chat whose world has the dare and a rule that hears it. */
  const ruledChat = (): Promise<{ rig: Rig; chatId: string }> => harnessChat({ minds: true, put: { actions: { dare: DARE }, rules: { tip: TIP } } as AlderSetup["put"] });
  const NEVER = { refused: { code: "mode_never" } };

  test("the read shows no roll, an undeclared argument is refused, and two attempts in one turn are two rolls on the reply's record, each heard once by the world's rules", async () => {
    const { rig, chatId } = await ruledChat();
    const before = { pov: await cashIn(rig, chatId), joss: await cashIn(rig, chatId, JOSS) };
    const turn = await beginTurn(rig, chatId, "I take the dare, twice.");
    const read = await turn.call(AUTHOR, "checks_stakes", { action: "dare" });
    expect(Object.keys(JSON.parse(read.text) as JsonObject).filter((key) => ROLLED.includes(key))).toEqual([]);
    // Asked for with an argument the dare doesn't take, as a model fishing for another roll would: refused, and nothing is rolled.
    for (const n of [1, 2, 3]) {
      expect((await turn.call(AUTHOR, "checks_stakes", { action: "dare" })).text).toBe(read.text);
      for (const tool of ["checks_stakes", "action_play"]) expect(await turn.refusal(AUTHOR, tool, { action: "dare", params: JSON.stringify({ nonce: n }) })).toBe(note(PLAY_NOTE.takesNone, { action: "dare", given: "nonce" }));
    }
    const plays = [(await turn.answer(AUTHOR, "action_play", { action: "dare" })) as unknown as Played, (await turn.answer(AUTHOR, "action_play", { action: "dare" })) as unknown as Played];
    expect(plays.map((p) => [p.rolled, p.lands])).toEqual([[true, note(WRITE_NOTE.staged)], [true, note(WRITE_NOTE.staged)]]);
    const committed = (await turn.answer(AUTHOR, "commit")).committed as { landed: string[][]; review: string[][]; refused: unknown[] };
    expect([committed.landed.length, committed.review, committed.refused]).toEqual([2, [], []]);
    await turn.finish("You take it, and then again.");

    // Both rolls are on the reply's record, in the order they were played, and each did what its own outcome does.
    const reply = rig.host.head(chatId);
    const rec = reply ? await recordOn(rig, chatId, reply.id) : null;
    const recorded = [...(rec?.events ?? []), ...(rec?.post ?? []).flatMap((entry) => entry.events)];
    expect(rollsOf(recorded, POV).map((r) => [r.natural, r.outcome])).toEqual(plays.map((p) => [p.roll?.natural, p.outcome]));
    expect((await cashIn(rig, chatId)) - before.pov).toBe(plays.reduce((sum, p) => sum + (p.passed ? 500 : -500), 0));
    // The world's rule heard each play once, as it was played: the commit fired nothing a second time.
    expect((await cashIn(rig, chatId, JOSS)) - before.joss).toBe(2 * 7);
    noModelCallsOf(rig);
  });

  test("with what the author plays set to Never a play is refused before any roll is shown; set to Confirm it waits on the reply's card, and Apply lands it with the rules heard once", async () => {
    const { rig, chatId } = await ruledChat();
    const before = { pov: await cashIn(rig, chatId), joss: await cashIn(rig, chatId, JOSS) };
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { play: { mode: "never" } } } }));
    const refusedTurn = await beginTurn(rig, chatId, "I take the dare.");
    const refusedPlays: JsonObject[] = [{ action: "dare" }, { action: "dare", actor: "Mara" }];
    for (const args of refusedPlays) {
      const out = await refusedTurn.refusal(AUTHOR, "action_play", args);
      expect(JSON.parse(out)).toMatchObject(NEVER);
      expect(ROLLED.filter((key) => out.includes(`"${key}"`))).toEqual([]);
    }
    expect((await refusedTurn.answer(AUTHOR, "commit")).committed).toMatchObject({ landed: [], review: [], refused: [] });
    await refusedTurn.finish("Nothing comes of it.");
    expect([await cashIn(rig, chatId), await cashIn(rig, chatId, JOSS)]).toEqual([before.pov, before.joss]);

    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { play: { mode: "confirm" } } } }));
    const turn = await beginTurn(rig, chatId, "I take the dare after all.");
    const played = (await turn.answer(AUTHOR, "action_play", { action: "dare" })) as unknown as Played;
    expect([played.rolled, played.lands]).toEqual([true, note(WRITE_NOTE.stagedReview)]);
    await turn.finish("You take it.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    const cardOf = async (op: "get" | "apply"): Promise<string[][]> => {
      const cards = rig.body(await rig.send({ type: "lre.review", chatId, op, turn: `${reply.id}:0` })).cards as { turn: string; items: { changeType: string; status: string }[] }[];
      return (cards.find((card) => card.turn === `${reply.id}:0`)?.items ?? []).map((item) => [item.changeType, item.status]);
    };
    expect(await cardOf("get")).toEqual([["play", "open"]]);
    expect([await cashIn(rig, chatId), await cashIn(rig, chatId, JOSS)]).toEqual([before.pov, before.joss]);
    expect(await cardOf("apply")).toEqual([["play", "applied"]]);
    // Applied: the roll that was shown is the one that landed, and the rule that heard the play gave its tip once.
    expect((await cashIn(rig, chatId)) - before.pov).toBe(played.passed ? 500 : -500);
    expect((await cashIn(rig, chatId, JOSS)) - before.joss).toBe(7);
    noModelCallsOf(rig);
  });

  test("a secret is marked in what the read and the play answer, as every read marks one", async () => {
    // Brann stands where the player character wakes, and the world keeps them secret. Whether a view marks is the bridge's to say: the author's does.
    const { rig, chatId } = await harnessChat({ minds: true, put: { entities: { brann: { id: "brann", kind: "character", name: "Brann", tier: "background", visibility: "secret", fields: { place: HOME }, relations: [] } }, actions: { dare: DARE } } });
    const turn = await beginTurn(rig, chatId, "I dare whoever is in the room.");
    const marked = secretMarkText("Brann", [], "everyone", SECRET_MARK_WORDING);
    expect(((await turn.answer(AUTHOR, "checks_stakes", { action: "dare", actor: "Brann" })) as unknown as Stakes).actor).toMatchObject({ id: "brann", name: marked });
    const played = (await turn.answer(AUTHOR, "action_play", { action: "dare", actor: "Brann" })) as unknown as Played;
    expect(played.actor).toMatchObject({ id: "brann", name: marked });
    // The line that says what it did names them, so it is kept from the player's character, and marked so; Mara's own line is no one's secret.
    const theirs = (played.recorded ?? []).filter((line) => line.includes("Brann's cash"));
    expect(theirs.map((line) => line.includes("[secret;"))).toEqual([true]);
    const plain = (await turn.answer(AUTHOR, "action_play", { action: "dare", actor: "Mara" })) as unknown as Played;
    expect((plain.recorded ?? []).filter((line) => line.includes("[secret;"))).toEqual([]);
    noModelCallsOf(rig);
  });
});
