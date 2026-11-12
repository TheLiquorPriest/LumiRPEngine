// The jobs of a harness turn (HARNESS-SLICE3 step 9: "The jobs run"). Work for after the reply is a
// job the author started. It belongs to the record its turn wrote: each change is written as it is
// made, through the ledger's path for writes outside a turn (and the story record's beside it), onto
// that record, until the record leaves the chat's path. A job that runs beside its turn stages into
// the turn, as the agents the author starts do. A job tied to no reply reads the world as it stands
// and changes nothing. A job's agents are held to whoever started the job (`harness-gates.test.ts`).

import { describe, expect, test } from "bun:test";
import { recHarnessOf } from "../../src/backend/harness/record";
import { renderPrompt } from "../../src/backend/prompts";
import { recStoryOf } from "../../src/engine/story/record";
import { HARNESS_AGENT, HARNESS_NOTE } from "../../src/shared/harness-texts";
import type { JsonObject } from "../../src/shared/json";
import { placeOfEntity } from "../../src/engine/scope";
import type { Rig } from "../support/rig";
import { HOME } from "../support/tools";
import { turnChat } from "./harness-cast-kit";
import { type Agent, AUTHOR, beginJob, beginTurn, beginUserJob, harnessChat, noModelCalls, OKORO, type Run, recordOn, stateOf, turnRecord } from "./harness-driver";

const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

/** The agents of a job's run, each a handle of its own: the game master, which writes the story record's beats; the historian, which holds the story's tier. */
const GM: Agent = { id: "job-gm", role: HARNESS_AGENT.gm };
const HISTORIAN: Agent = { id: "job-historian", role: HARNESS_AGENT.historian };

const REPLY = "Okoro is on the step before anyone answers.";
/** A beat of the world the game master writes after the reply: rain that Mara sees. */
const rain = (what: string): JsonObject => ({ by: "world", kind: "happen", what, surface: what, exposure: [{ who: "Mara", reach: "whole" }] });
/** The beats a reply's record holds, by what happened. */
const beatsOn = async (rig: Rig, chatId: string, messageId: string): Promise<string[]> => recStoryOf(await recordOn(rig, chatId, messageId)).beats.map((b) => b.what);
const offPath = { refused: { code: "off_path", reason: note(HARNESS_NOTE.offPath) } };
const noReply = { refused: { code: "no_basis", reason: note(HARNESS_NOTE.noBasis) } };
/** Whether Brann, whom the reply brings in, is in the world: the cast kit's chats start without them. */
const brannIsIn = async (rig: Rig, chatId: string): Promise<boolean> => Object.values((await stateOf(rig, chatId)).entities).some((e) => e.name === "Brann");

/** A turn whose author starts one job for after the reply, played to its end: the turn's run, and the job's. */
async function turnWithJob(rig: Rig, chatId: string): Promise<{ turn: Run; job: Run; replyId: string }> {
  const turn = await beginTurn(rig, chatId, "I ask whether Okoro is coming by.");
  await turn.answer(AUTHOR, "gm_move", { entity: "Okoro", to: HOME });
  await turn.answer(AUTHOR, "time_pass", { minutes: 10 });
  await turn.written(REPLY);
  if (!turn.generation) throw new Error("no generation");
  await rig.host.finish(turn.generation, REPLY);
  await turn.end("done", { record: turnRecord(turn, { jobs: [{ id: "job-after", agent: HARNESS_AGENT.historian, state: "queued" }] }) });
  const job = await beginJob(rig, turn, "job-after");
  const reply = rig.host.head(chatId);
  if (!reply) throw new Error("no reply");
  return { turn, job, replyId: reply.id };
}

describe("a harness turn's jobs", () => {
  test("a job's writes land on the record of the turn that started it, each as it is made", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { spawn: { mode: "auto" }, time_advance: { mode: "auto" } } } }));
    const { turn, job, replyId } = await turnWithJob(rig, chatId);
    // A beat of the story after the reply: written on the reply's record at once.
    await job.answer(GM, "beat_write", rain("Rain starts on the step."));
    expect(await beatsOn(rig, chatId, replyId)).toEqual(["Rain starts on the step."]);
    // Someone the story brought in, noted by the historian: the story's own change, written at once too.
    expect(await job.answer(HISTORIAN, "person_add", { name: "Brann" })).toMatchObject({ staged: { changeType: "spawn", lands: note(HARNESS_NOTE.recorded) } });
    expect(await brannIsIn(rig, chatId)).toBe(true);
    // Both are on the reply's record, beside what the turn committed, under the role that made it: the reply still holds one record.
    const rec = await recordOn(rig, chatId, replyId);
    expect(recHarnessOf(rec)?.turns).toEqual([turn.turn]);
    expect(recHarnessOf(rec)?.record?.jobs).toEqual([{ id: "job-after", agent: HARNESS_AGENT.historian, state: "queued" }]);
    expect(rec?.post.map((p) => [p.kind, p.agent?.role])).toEqual([["confirm", "curator"]]);
    // Passing time is the author's alone, in its own turn: no agent of a job passes it.
    const clock = (await stateOf(rig, chatId)).clock;
    expect(await job.refusal(HISTORIAN, "time_pass", { minutes: 30 })).toBe(note(HARNESS_NOTE.authorOnly, { tool: "time_pass" }));
    expect((await stateOf(rig, chatId)).clock).toBe(clock);
    // A job has no turn to commit: committing is the author's alone, in its own turn. It grants nothing, and writes at its definition's tier.
    expect(await job.refusal(HISTORIAN, "commit", {})).toBe(note(HARNESS_NOTE.authorOnly, { tool: "commit" }));
    expect(JSON.parse(await job.refusal(HISTORIAN, "gm_move", { entity: "Okoro", to: HOME })).refused.code).toBe("not_granted");
    await job.end("done", { record: null });
    noModelCalls(rig);
  });

  test("once an edit takes the record off the chat's path, the job writes nothing more", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    const { job, replyId } = await turnWithJob(rig, chatId);
    await job.answer(GM, "beat_write", rain("Rain starts on the step."));
    // The player's own message, before the reply, is edited: what the reply answered is no longer what the chat says, and the turn waits on Keep or Discard.
    const said = rig.host.chat(chatId).messages.findLast((m) => m.isUser);
    if (!said) throw new Error("no message");
    rig.host.editMessage(chatId, said.id, "I ask whether Brann is coming by.");
    await rig.host.settle();
    const before = await recordOn(rig, chatId, replyId);
    expect(JSON.parse(await job.refusal(GM, "beat_write", rain("The rain stops.")))).toEqual(offPath);
    expect(JSON.parse(await job.refusal(HISTORIAN, "person_add", { name: "Nell" }))).toEqual(offPath);
    // Nothing reached the record: it holds what it held.
    const after = await recordOn(rig, chatId, replyId);
    expect([after?.post, recStoryOf(after).beats.map((b) => b.what)]).toEqual([before?.post ?? [], ["Rain starts on the step."]]);
    noModelCalls(rig);
  });

  test("a reply swiped away or deleted takes its jobs' record with it; an edit of the reply's own text does not; a job tied to no reply reads and changes nothing", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    const { job, replyId } = await turnWithJob(rig, chatId);
    // The reply's own text edited: its record stands, as on every engine, and the job goes on.
    rig.host.editMessage(chatId, replyId, `${REPLY} He is grinning.`);
    await rig.host.settle();
    await job.answer(GM, "beat_write", rain("Rain starts on the step."));
    expect(await beatsOn(rig, chatId, replyId)).toEqual(["Rain starts on the step."]);
    // Another telling of the reply is shown: the first one's record is off the path, and its job writes nothing.
    const again = await beginTurn(rig, chatId, null, { type: "swipe" });
    await again.finish("Nobody comes.");
    expect(JSON.parse(await job.refusal(GM, "beat_write", rain("The rain stops.")))).toEqual(offPath);
    expect(await beatsOn(rig, chatId, replyId)).toEqual([]);
    // Shown again, its record is on the path again, with what was written to it.
    rig.host.navigate(chatId, replyId, 0);
    await rig.host.settle();
    expect(await beatsOn(rig, chatId, replyId)).toEqual(["Rain starts on the step."]);
    await job.answer(GM, "beat_write", rain("The rain stops."));
    // Deleted, the record is gone: the engine saw it written, so its job is told it left the path.
    rig.host.deleteMessage(chatId, replyId);
    await rig.host.settle();
    expect(JSON.parse(await job.refusal(GM, "beat_write", rain("The step dries.")))).toEqual(offPath);
    expect(JSON.parse(await job.refusal(HISTORIAN, "person_add", { name: "Nell" }))).toEqual(offPath);
    // A job the engine can't tie to any turn writes nothing either, and still reads the world as it stands.
    const lost = await beginJob(rig, { chatId, turn: "a-turn-never-seen" }, "job-lost");
    expect(JSON.parse(await lost.refusal(HISTORIAN, "person_add", { name: "Nell" }))).toEqual(noReply);
    expect(await lost.answer(HISTORIAN, "world_status")).toMatchObject({ behind: false });
    // So does one the user started, which belongs to no turn: the engine is told of no reply for it.
    const users = await beginUserJob(rig, chatId, "job-users");
    expect(await users.answer(HISTORIAN, "world_status")).toMatchObject({ behind: false });
    expect(JSON.parse(await users.refusal(HISTORIAN, "person_add", { name: "Nobody" }))).toEqual(noReply);
    expect(Object.values((await stateOf(rig, chatId)).entities).some((e) => e.name === "Nell" || e.name === "Nobody")).toBe(false);
    noModelCalls(rig);
  });

  test("a job that runs beside its turn stages into the turn, and one that starts once the reply is written waits for the turn's record", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    const turn = await beginTurn(rig, chatId, "I ask whether Okoro is coming by.");
    // The author has been heard from: a job is held to whoever started it, and the engine places an agent by its calls.
    await turn.answer(AUTHOR, "time_clock", {});
    // Beside the turn: its agents stage as the author's own delegates do, and none of them is the author, whatever it runs as.
    const beside = await beginJob(rig, turn, "job-now");
    const helper: Agent = { id: "job-author", role: HARNESS_AGENT.author };
    await beside.answer(helper, "gm_move", { entity: "Okoro", to: HOME });
    expect(await beside.refusal(helper, "commit", {})).toBe(note(HARNESS_NOTE.authorOnly, { tool: "commit" }));
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).toBeNull();
    const committed = (await turn.answer(AUTHOR, "commit", {})).committed as { landed: string[][] };
    expect(committed.landed.length).toBe(1);
    // The reply is written, and a job for after it starts before Lumiverse has saved it: its write waits for the turn's record, then lands on it.
    await turn.written(REPLY);
    const after = await beginJob(rig, turn, "job-after");
    let done = false;
    const early = after.answer(HISTORIAN, "person_add", { name: "Nell" }).finally(() => {
      done = true;
    });
    await rig.host.settle();
    expect(done).toBe(false);
    if (!turn.generation) throw new Error("no generation");
    await rig.host.finish(turn.generation, REPLY);
    expect(await early).toMatchObject({ staged: { changeType: "spawn", lands: note(HARNESS_NOTE.recorded) } });
    await turn.end();
    const reply = rig.host.head(chatId);
    const rec = reply ? await recordOn(rig, chatId, reply.id) : null;
    expect(recHarnessOf(rec)?.turns).toEqual([turn.turn]);
    expect(rec?.post.map((p) => [p.kind, p.agent?.role])).toEqual([["confirm", "curator"]]);
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).toBe(HOME);
    // A call still waiting when its turn is let go (stopped before anything of its reply went out) is answered that no turn stands.
    const stopped = await beginTurn(rig, chatId, "I wait.");
    await stopped.written("");
    const orphan = await beginJob(rig, stopped, "job-orphan");
    const waiting = orphan.refusal(HISTORIAN, "person_add", { name: "Wren" });
    await rig.host.settle();
    await stopped.stop("");
    expect(await waiting).toBe(note(HARNESS_NOTE.noTurn));
    noModelCalls(rig);
  });

  test("a job's change set to Confirm goes on its reply's review card", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { spawn: { mode: "confirm" } } } }));
    const { job, replyId } = await turnWithJob(rig, chatId);
    await job.answer(HISTORIAN, "person_add", { name: "Brann" });
    expect(await brannIsIn(rig, chatId)).toBe(false);
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as { turn: string; placement: string; items: { status: string; source: string }[] }[];
    expect(cards.map((c) => ({ turn: c.turn, placement: c.placement, items: c.items.map((i) => [i.source, i.status]) }))).toEqual([{ turn: `${replyId}:0`, placement: "chips", items: [["read", "open"]] }]);
    rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: `${replyId}:0` }));
    expect(await brannIsIn(rig, chatId)).toBe(true);
    noModelCalls(rig);
  });
});
