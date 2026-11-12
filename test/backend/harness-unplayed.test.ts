// A reply no turn was played for (HARNESS-SLICE3: "One turn on the harness engine", step 8). On the
// harness a turn's work lives in the backend's memory until its reply is saved, so a turn that
// doesn't stand leaves nothing: a backend that restarts while the reply is written, or one that was
// down when it began. The reply then stands with no turn's record. It says so, where the game master
// sees it, and the author of the next turn is told first, so it records what still matters. (A Stop
// is the runtime's: `harness-runtime.test.ts`.)

import { describe, expect, test } from "bun:test";
import { recHarnessOf, unplayedOf } from "../../src/backend/harness/record";
import { renderPrompt } from "../../src/backend/prompts";
import { HARNESS_AGENT, HARNESS_NOTE, HARNESS_TEXT } from "../../src/shared/harness-texts";
import type { Chip } from "../../src/shared/state-view";
import { placeOfEntity } from "../../src/engine/scope";
import { recStoryOf } from "../../src/engine/story/record";
import type { Rig } from "../support/rig";
import { HOME } from "../support/tools";
import { type Agent, AUTHOR, beginTurn, claimOf, harnessChat, MARA, mount, noModelCalls, OKORO, type Run, recordOn, stateOf } from "./harness-driver";

const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);
const MIND: Agent = { id: "delegate-mara", role: HARNESS_AGENT.character, as: MARA };
const CASH = "acct_pov_cash";

const RESTARTED = "the engine restarted while this reply was being written";
const UNHEARD = "the engine wasn't running when this reply was started";

/** What a turn's agents do before its reply: Mara is cast and speaks, Okoro arrives, ten minutes pass and are committed; a payment is staged and left uncommitted. */
async function play(run: Run): Promise<void> {
  await run.answer(AUTHOR, "cast_set", { who: "Mara", standing: "principal", why: "The story turns on her." });
  await run.answer(MIND, "beat_write", { by: "Mara", kind: "say", what: "Mara says Okoro comes by at noon.", surface: "Mara says Okoro comes by at noon.", exposure: [{ who: "player", reach: "whole" }] });
  await run.answer(AUTHOR, "gm_move", { entity: "Okoro", to: HOME });
  await run.answer(AUTHOR, "time_pass", { minutes: 10 });
  await run.answer(AUTHOR, "commit", {});
  await run.answer(AUTHOR, "gm_adjust_money", { account: CASH, cents: -2000 });
}

/** The chat's head reply. */
function head(rig: Rig, chatId: string) {
  const reply = rig.host.head(chatId);
  if (!reply) throw new Error("no reply");
  return reply;
}

/** The chips the chat's view shows on a message. */
async function chipsOn(rig: Rig, chatId: string, messageId: string): Promise<Chip[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === messageId);
}

/** The world's guidance the engine gives the chat's next run, as its author reads it. */
async function guidanceOf(rig: Rig, chatId: string): Promise<string> {
  const guidance = (await claimOf(rig, chatId))?.guidance;
  return guidance && "text" in guidance ? guidance.text : "";
}

/** Nothing of a turn is in the chat: nobody moved, no time passed, no beat was recorded, no card waits, and the journal holds no turn open. */
async function untouched(rig: Rig, chatId: string, clock: number): Promise<void> {
  const state = await stateOf(rig, chatId);
  expect(placeOfEntity(state, OKORO)).toBeNull();
  expect(state.clock).toBe(clock);
  const reply = rig.host.head(chatId);
  expect(reply ? recStoryOf(await recordOn(rig, chatId, reply.id)).beats : []).toEqual([]);
  expect(rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards).toEqual([]);
  const journal = (await rig.rt.ledger.core(chatId, rig.host.userId))?.journal;
  expect(Object.keys(journal?.pending ?? {})).toEqual([]);
  expect(journal?.windows ?? []).toEqual([]);
}

/** The reply says no turn was played for it, and why: on a record that names no turn, with a chip the game master sees. */
async function saysUnplayed(rig: Rig, chatId: string, why: string): Promise<void> {
  const reply = head(rig, chatId);
  const rec = await recordOn(rig, chatId, reply.id);
  expect(unplayedOf(rec)).toEqual({ why, added: false });
  expect(recHarnessOf(rec)).toBeNull();
  expect(rec?.events ?? []).toEqual([]);
  const chip = (await chipsOn(rig, chatId, reply.id)).find((c) => c.id === `unplayed:${reply.id}:${reply.swipeId}`);
  expect(chip?.label).toBe("No turn was played");
  expect(chip?.detail).toContain(`This reply was written without the harness's agents: ${why}.`);
}

describe("a reply no turn was played for", () => {
  test("the backend restarts mid-turn: the reply stands with no record and nothing half-written, says so, and the next turn's author is told first", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    const clock = (await stateOf(rig, chatId)).clock;
    const run = await beginTurn(rig, chatId, "I ask Mara whether Okoro is coming by today.");
    await play(run);
    if (!run.generation) throw new Error("no generation");

    // The extension's backend restarts alone; Lumiverse goes on writing the reply. The page finds the new backend, as it does after any restart, and then the reply is saved.
    const later = rig.reload();
    mount(later);
    later.body(await later.send({ type: "lre.hello", chatId }));
    await later.host.finish(run.generation, "Mara glances at the door. Okoro is already on the step.");
    await untouched(later, chatId, clock);
    await saysUnplayed(later, chatId, RESTARTED);
    // What the lost run still calls belongs to no turn.
    expect((await later.rt.harness.tools.call({ name: "gm_move", args: { entity: "Okoro", to: HOME }, turn: run.turn, chatId, agentId: AUTHOR.id, role: AUTHOR.role, callId: "late", kind: "new", main: true, above: [] }, new AbortController().signal)).text).toBe(note(HARNESS_NOTE.noTurn));

    // The next turn's author reads it before anything else of the world's guidance, and plays on from the chat as it stood.
    const next = await beginTurn(later, chatId, "I go to the door.");
    const told = await guidanceOf(later, chatId);
    expect(told.startsWith(`${note(HARNESS_TEXT.unplayed, { why: RESTARTED })}\n\n`)).toBe(true);
    expect((await next.answer(AUTHOR, "time_clock", {})).minutes).toBe(clock);
    await next.answer(AUTHOR, "gm_move", { entity: "Okoro", to: HOME });
    await next.answer(AUTHOR, "time_pass", { minutes: 15 });
    await next.finish("Okoro is on the step.");
    expect(placeOfEntity(await stateOf(later, chatId), OKORO)).toBe(HOME);
    expect((await stateOf(later, chatId)).clock).toBe(clock + 15);
    expect(recHarnessOf(await recordOn(later, chatId, head(later, chatId).id))?.turns).toEqual([next.turn]);
    // It was told once: the turn after follows a reply a turn was played for.
    await beginTurn(later, chatId, "I let him in.");
    expect(await guidanceOf(later, chatId)).not.toContain("no turn played");
    noModelCalls(later);
  });

  test("the restarted backend hears the reply end before any page finds it, or misses its end altogether: the lost turn closes the same way, with none of its plan committed", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    const clock = (await stateOf(rig, chatId)).clock;
    const run = await beginTurn(rig, chatId, "I ask Mara whether Okoro is coming by today.");
    await play(run);
    if (!run.generation) throw new Error("no generation");
    const later = rig.reload();
    mount(later);
    await later.host.finish(run.generation, "Mara glances at the door. Okoro is already on the step.");
    await untouched(later, chatId, clock);
    await saysUnplayed(later, chatId, RESTARTED);

    // The reply is saved while no backend listens; the next one learns of the turn it left open when a page opens the chat.
    const missed = await beginTurn(later, chatId, null, { type: "regenerate" });
    await play(missed);
    if (!missed.generation) throw new Error("no generation");
    later.host.reload();
    await later.host.finish(missed.generation, "Mara looks up from the kettle.");
    const last = later.reload();
    last.body(await last.send({ type: "lre.hello", chatId }));
    await untouched(last, chatId, clock);
    await saysUnplayed(last, chatId, RESTARTED);
    noModelCalls(last);
  });

  test("a reply that began while the backend was down holds no record at all, and says so when it is saved", async () => {
    const { rig, chatId } = await harnessChat();
    const clock = (await stateOf(rig, chatId)).clock;
    rig.host.sendUser(chatId, "I put the kettle on.");
    await rig.host.settle();
    // Nothing of the extension hears this generation start, guards it or reads its World Info: Lumiverse assembles the prompt without it.
    rig.host.reload();
    rig.host.worldInfoInterceptor = null;
    const generation = await rig.host.begin(chatId, { type: "normal" });
    const later = rig.reload();
    await later.host.finish(generation, "The kettle ticks as it warms.");
    await untouched(later, chatId, clock);
    await saysUnplayed(later, chatId, UNHEARD);
    expect(await guidanceOf(later, chatId)).toContain(note(HARNESS_TEXT.unplayed, { why: UNHEARD }));
    noModelCalls(later);
  });
});
