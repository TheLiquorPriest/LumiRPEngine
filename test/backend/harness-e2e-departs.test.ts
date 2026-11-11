// The reply serves the turn, end to end with LumiAH's real backend and core (`harness-e2e-kit.ts`,
// `support/lumiah-bed.ts`), the agents' model scripted. The author brings Okoro into the kitchen,
// commits, and leaves the chronicler a job for after the reply; Lumiverse's own generation writes a
// reply in which he never comes. The chronicler notes that on the reply: the world keeps the turn's
// Okoro, the reply's flag lists the line, and the next turn's author is told.

import { afterEach, describe, expect, test } from "bun:test";
import { departuresOf, recHarnessOf } from "../../src/backend/harness/record";
import { renderPrompt } from "../../src/backend/prompts";
import { STORY_NOTE } from "../../src/shared/harness-texts-story";
import { placeOfEntity } from "../../src/engine/scope";
import { type Bed, cast, heard, offers, results, told } from "../support/lumiah-bed";
import { HOME } from "../support/tools";
import { noModelCalls, OKORO, recordOn, stateOf } from "./harness-driver";
import { brief, calls, say, worldChat } from "./harness-e2e-kit";

const beds: Bed[] = [];
afterEach(() => {
  for (const bed of beds.splice(0)) bed.close();
});

const BRIEF = "Okoro knocks and comes in from the street.";
const TASK = "Hold the reply to this turn. My brief: Okoro knocks and comes in from the street. Committed: Okoro moved into the kitchen.";
const REPLY = "Nobody knocks. Okoro is still across town, and the kitchen stays quiet.";
const LINE = "The reply has Okoro stay across town; the world has him in the kitchen.";

describe("the reply serves the turn", () => {
  test("a reply that tells a committed fact otherwise leaves the world as the turn decided it, and the chronicler's line is on the reply, its flag and the next author's opening", async () => {
    const { bed, rig, chatId } = await worldChat();
    beds.push(bed);
    const play = cast(
      { name: "chronicler", is: (request) => told(TASK)(request) && !offers("write_reply")(request), lines: [calls("chat_read", {}), calls("story_departure", { lines: [LINE] }), "Okoro's arrival is not in the reply: noted as a departure."] },
      { name: "author", is: offers("write_reply"), lines: [calls("gm_move", { entity: "Okoro", to: HOME }), calls("commit", {}), calls("job_start", { agent: "chronicler", task: TASK, when: "after_reply" }), brief(BRIEF)] },
    );
    bed.script = play.script;

    const generation = await say(rig, chatId, "I wait for Okoro.");
    await rig.host.finish(generation, REPLY);
    const replyId = generation.messageId ?? "";
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, replyId))?.record !== undefined, "the turn's record on the reply");
    const world = await stateOf(rig, chatId);
    const before = await recordOn(rig, chatId, replyId);
    await bed.until(() => play.left("chronicler") === 0, "the chronicler's run after the reply");
    await bed.until(async () => departuresOf(await recordOn(rig, chatId, replyId)).length > 0, "the line on the reply's record");

    // The chronicler was offered the tool, and its answer says the line was kept on the reply.
    expect(play.calls("chronicler")[0]?.tools?.map((t) => t.name)).toEqual(expect.arrayContaining(["story_departure", "story_record"]));
    expect(JSON.parse(results(play.calls("chronicler")[2]).at(-1) ?? "{}")).toEqual({ departures: { lines: [LINE], lands: renderPrompt(STORY_NOTE.departed, {}, {}) } });
    // The world is the turn's: Okoro is in the kitchen, and nothing of the world or of the record's hashed parts moved.
    const after = await recordOn(rig, chatId, replyId);
    expect(departuresOf(after)).toEqual([LINE]);
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).toBe(HOME);
    expect(await stateOf(rig, chatId)).toEqual(world);
    expect({ ...after, harness: undefined }).toEqual({ ...before, harness: undefined });
    // The reply's flag lists it, with Regenerate.
    const flag = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.id === `departed:${replyId}:0`);
    expect(flag?.detail?.split("\n").slice(1)).toEqual([LINE]);
    expect(flag?.actions).toEqual([{ id: "regenerate", label: "Regenerate" }]);

    // The next turn's author reads the line first, and plays on from the world as it stands.
    const next = cast({ name: "author", is: offers("write_reply"), lines: [brief("Okoro sets his keys on the table.")] });
    bed.script = next.script;
    const again = await say(rig, chatId, "I ask Okoro how the drive was.");
    expect(heard(next.calls("author")[0])).toContain(LINE);
    await rig.host.finish(again, "Okoro sets his keys on the table.");
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, again.messageId ?? ""))?.record !== undefined, "the next turn's record");
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).toBe(HOME);
    noModelCalls(rig);
  });
});
