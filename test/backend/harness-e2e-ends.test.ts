// How a harness turn ends, end to end with LumiAH's real backend and core (`harness-e2e-kit.ts`,
// `support/lumiah-bed.ts`): a job the author leaves for after the reply; Stop in Lumiverse while the
// author works; and the extension's backend restarting under a turn. Whatever happens, the player has
// their reply or their Stop, nothing half-done stays in the world, and the next turn plays.

import { afterEach, describe, expect, test } from "bun:test";
import { recHarnessOf, unplayedOf } from "../../src/backend/harness/record";
import { renderPrompt } from "../../src/backend/prompts";
import { placeOfEntity } from "../../src/engine/scope";
import { readSlice } from "../../src/packs/minds/core/state";
import { HARNESS_NOTE } from "../../src/shared/harness-texts";
import { isRecord } from "../../src/shared/json";
import type { Rec } from "../../src/shared/ledger";
import { type Bed, cast, gate, heard, lumiahBed, offers, results, told } from "../support/lumiah-bed";
import { HOME } from "../support/tools";
import { MARA, noModelCalls, OKORO, recordOn, stateOf } from "./harness-driver";
import { brief, calls, say, worldChat } from "./harness-e2e-kit";

const beds: Bed[] = [];
afterEach(() => {
  for (const bed of beds.splice(0)) bed.close();
});

const BRIEF = "Okoro knocks and comes in from the street.";
const REPLY = "A knock, and Okoro lets himself in before anyone answers.";
const NOTE = "Okoro came in before anyone answered the door.";
const JOB_TASK = "You are Mara. The reply is written: remember what just happened in the kitchen.";

/** The jobs LumiAH's record of a turn lists, each with the state LumiAH last said of it. */
function jobsOn(rec: Rec | null): { agent: unknown; state: unknown }[] {
  const jobs = recHarnessOf(rec)?.record?.jobs;
  return Array.isArray(jobs) ? jobs.flatMap((job) => (isRecord(job) ? [{ agent: job.agent, state: job.state }] : [])) : [];
}

describe("how a harness turn ends", () => {
  test("a job the author leaves for after the reply runs once the reply is saved, and what it records is tied to the turn's record", async () => {
    const { bed, rig, chatId } = await worldChat();
    beds.push(bed);
    const play = cast(
      { name: "job", is: (request) => told(JOB_TASK)(request) && !offers("write_reply")(request), lines: [calls("mind_view", { who: "Mara" }), calls("mind_remember", { who: "Mara", notes: [{ text: NOTE, salience: 3 }] }), "Mara will remember it."] },
      { name: "author", is: offers("write_reply"), lines: [calls("gm_move", { entity: "Okoro", to: HOME }), calls("job_start", { agent: "character", task: JOB_TASK, when: "after_reply" }), brief(BRIEF)] },
    );
    bed.script = play.script;

    const generation = await say(rig, chatId, "I ask whether Okoro is coming by.");
    // The job waits for the reply: nothing of it has run, and the player is not kept waiting for it.
    expect(play.calls("job")).toEqual([]);
    await rig.host.finish(generation, REPLY);
    const replyId = generation.messageId ?? "";
    await bed.until(() => play.left("job") === 0, "the job's run after the reply");
    await bed.until(async () => jobsOn(await recordOn(rig, chatId, replyId)).some((job) => job.state === "done"), "the job's end on the turn's record");

    // Mara's agent read the turn as it was written, and what she remembers was written at once, on the record of the turn that started the job.
    expect(results(play.calls("job")[1]).join("\n")).toContain(REPLY);
    expect(JSON.parse(results(play.calls("job")[2]).at(-1) ?? "{}")).toMatchObject({ remembered: { lands: renderPrompt(HARNESS_NOTE.recorded, {}, {}) } });
    expect((readSlice(await stateOf(rig, chatId)).chars[MARA]?.notes ?? []).map((note) => note.text)).toContain(NOTE);
    const harness = recHarnessOf(await recordOn(rig, chatId, replyId));
    expect(harness?.turns).toEqual([generation.id]);
    expect(jobsOn(await recordOn(rig, chatId, replyId))).toEqual([{ agent: "character", state: "done" }]);
    noModelCalls(rig);
  });

  test("Stop in Lumiverse while the author works ends the turn with nothing of it in the world, and the next turn plays", async () => {
    const { bed, rig, chatId } = await worldChat();
    beds.push(bed);
    const hold = gate();
    bed.script = cast({ name: "author", is: offers("write_reply"), lines: [calls("gm_move", { entity: "Okoro", to: HOME }), calls("commit"), hold.held(brief("never sent"))] }).script;

    // The author has moved Okoro and committed, and is still working when the player presses Stop.
    const begun = say(rig, chatId, "I ask whether Okoro is coming by.");
    await bed.until(() => hold.waiting === 1, "the author's third call", true);
    bed.giveUp(bed.waiting()[0] ?? "", "stopped");
    const stopped = await begun;
    await rig.host.stop(stopped, "");
    await rig.host.settle();

    // Nothing of the stopped turn stands: Okoro is where he was, no card waits, and no reply holds a record of it.
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).not.toBe(HOME);
    expect(rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards).toEqual([]);
    for (const message of rig.host.chat(chatId).messages) expect(recHarnessOf(await recordOn(rig, chatId, message.id))).toBeNull();

    // The chat is not left stuck on it: the next turn is played whole.
    const play = cast({ name: "author", is: offers("write_reply"), lines: [calls("gm_move", { entity: "Okoro", to: HOME }), calls("commit"), brief(BRIEF)] });
    bed.script = play.script;
    const next = await say(rig, chatId, "I ask again whether Okoro is coming by.");
    await rig.host.finish(next, REPLY);
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, next.messageId ?? ""))?.record !== undefined, "the next turn's record");
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).toBe(HOME);
    noModelCalls(rig);
  });

  test("the extension restarting while the author works costs the player nothing: Lumiverse writes the reply alone, it is marked as one no turn was played for, and the next turn's author is told", async () => {
    const { bed, rig, chatId } = await worldChat();
    beds.push(bed);
    const hold = gate();
    bed.script = cast({ name: "author", is: offers("write_reply"), lines: [calls("gm_move", { entity: "Okoro", to: HOME }), calls("commit"), hold.held(brief("never sent"))] }).script;
    const begun = say(rig, chatId, "I ask whether Okoro is coming by.");
    await bed.until(() => hold.waiting === 1, "the author's third call", true);
    const [waiting] = bed.waiting();

    // The backend goes (an update, a crash) and starts again over the same chats and storage; Lumiverse, which heard nothing back, sends the prompt as it stood.
    bed.gone();
    const again = rig.reload();
    const fresh = lumiahBed(again);
    beds.push(fresh);
    bed.lose(waiting ?? "");
    const generation = await begun;
    await again.host.finish(generation, "Okoro? He hasn't said.");
    await again.host.settle();

    // The player has the reply. Nothing the lost turn did is in the world, and the reply says no turn was played for it, and why.
    const replyId = generation.messageId ?? "";
    expect(again.host.head(chatId)?.swipes[0]).toBe("Okoro? He hasn't said.");
    expect(placeOfEntity(await stateOf(again, chatId), OKORO)).not.toBe(HOME);
    const mark = unplayedOf(await recordOn(again, chatId, replyId));
    expect(mark?.why).toContain("restarted while this reply was being written");

    // LumiAH is still switched on for the chat (its own storage kept it), and the next turn's author is told about that reply first.
    const play = cast({ name: "author", is: offers("write_reply"), lines: [calls("gm_move", { entity: "Okoro", to: HOME }), calls("commit"), brief(BRIEF)] });
    fresh.script = play.script;
    const next = await say(again, chatId, "I look out of the window for him.");
    expect(heard(play.calls("author")[0])).toContain("restarted while this reply was being written");
    await again.host.finish(next, REPLY);
    await fresh.until(async () => recHarnessOf(await recordOn(again, chatId, next.messageId ?? ""))?.record !== undefined, "the next turn's record");
    expect(placeOfEntity(await stateOf(again, chatId), OKORO)).toBe(HOME);
    noModelCalls(again);
  });
});
