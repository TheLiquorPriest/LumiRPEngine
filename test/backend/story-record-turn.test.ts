// The story record through the bridge's own turn and job (`harness-driver.ts`): a beat a turn's
// agent writes is staged with the turn and lands on the turn's record as it commits; a job of that
// turn writes on the same record at once; a turn that doesn't stand lands none of what it staged.

import { describe, expect, test } from "bun:test";
import { chatStoryPort } from "../../src/backend/story/record";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { RECORD_TOOL } from "../../src/shared/harness-texts-record";
import { recStoryOf } from "../../src/engine/story/record";
import { AUTHOR, beginJob, beginTurn, harnessChat, recordOn } from "./harness-driver";

const beat = (what: string) => ({ by: "world", kind: "happen", what, surface: what, exposure: [] });

describe("the story record on a harness turn", () => {
  test("a turn's beat lands on its record as it commits, its job writes there too, and a turn that doesn't stand lands nothing", async () => {
    const { rig, chatId } = await harnessChat();
    const story = chatStoryPort(rig.rt, { chatId, userId: rig.host.userId, turn: "read", on: "last" });
    const beatsOnPath = async (): Promise<string[]> => (await story.read())?.path.beats.map((b) => b.beat.what) ?? [];
    const run = await beginTurn(rig, chatId, "I put the kettle on.");
    expect(await run.answer(AUTHOR, RECORD_TOOL.beatWrite, beat("The kettle boils."))).toHaveProperty("written");
    // Staged: the turn reads it, the chat's path doesn't hold it yet.
    expect(await run.answer(AUTHOR, RECORD_TOOL.beatsRead, {})).toMatchObject({ beats: [{ what: "The kettle boils." }] });
    expect(await beatsOnPath()).toEqual([]);
    await run.finish("The kettle whistles.");
    const reply = rig.host.chat(chatId).messages.at(-1)?.id ?? "";
    expect(recStoryOf(await recordOn(rig, chatId, reply)).beats.map((b) => [b.what, b.turn])).toEqual([["The kettle boils.", run.turn]]);
    // A job of the turn writes on the turn's record at once.
    const job = await beginJob(rig, run, "job-story");
    expect(await job.answer({ id: "gm", role: HARNESS_AGENT.gm }, RECORD_TOOL.beatWrite, beat("Steam fogs the window."))).toHaveProperty("written");
    expect(recStoryOf(await recordOn(rig, chatId, reply)).beats.map((b) => b.what)).toEqual(["The kettle boils.", "Steam fogs the window."]);
    // A turn stopped before anything of its reply went out doesn't stand: what it staged goes with it.
    const stopped = await beginTurn(rig, chatId, "I wait.");
    expect(await stopped.answer(AUTHOR, RECORD_TOOL.beatWrite, beat("The lights flicker."))).toHaveProperty("written");
    await stopped.stop("");
    expect(await beatsOnPath()).toEqual(["The kettle boils.", "Steam fogs the window."]);
  });
});
