// The world's document end to end, with LumiAH's real backend and core (`harness-e2e-kit.ts`,
// `support/lumiah-bed.ts`): the author lays a path into the world and commits it in its turn, as it
// ships, and nothing waits for the user. The world has a new revision, the chat plays it after the
// turn, and the reply lists the change with Undo, which the user presses.

import { afterEach, describe, expect, test } from "bun:test";
import { worldBuild } from "../../src/backend/agents/tools/harness-ports";
import { recHarnessOf } from "../../src/backend/harness/record";
import { type Bed, cast, offers } from "../support/lumiah-bed";
import { HOME } from "../support/tools";
import { noModelCalls, recordOn, stateOf } from "./harness-driver";
import { brief, calls, say, worldChat } from "./harness-e2e-kit";

const beds: Bed[] = [];
afterEach(() => {
  for (const bed of beds.splice(0)) bed.close();
});

const BRIEF = "Mara says the old mill still stands, half an hour's walk past the creek.";
const REPLY = "\"It still stands,\" Mara says. \"Half an hour past the creek, if the footbridge holds.\"";

describe("the world's document, as the author changes it in a turn", () => {
  test("the author lays a path and commits: the world has a new revision, the chat is on it after the turn, nothing waited for the user, and the reply lists the change with Undo", async () => {
    const { bed, rig, chatId } = await worldChat();
    beds.push(bed);
    const build = await worldBuild(rig.rt, chatId, rig.host.userId);
    if (!build) throw new Error("the chat plays no world");
    const first = await build.head();
    const play = cast({
      name: "author",
      is: offers("write_reply"),
      lines: [calls("world_place", { name: "The Old Mill", parent: HOME }), calls("world_path", { from: HOME, to: "The Old Mill", minutes: 25, km: 2 }), calls("world_commit", { note: "The old mill and the way to it" }), calls("world_upgrade"), calls("commit"), brief(BRIEF)],
    });
    bed.script = play.script;

    const generation = await say(rig, chatId, "I ask Mara whether the old mill past the creek still stands.");
    await rig.host.finish(generation, REPLY);
    const replyId = generation.messageId ?? "";
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, replyId))?.record !== undefined, "the turn's record on the reply");
    const made = async () => (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "world_made" && c.messageId === replyId);
    await bed.until(async () => (await made()).length > 0, "the reply's line for what the turn made of the world");

    const second = await build.head();
    expect(second).not.toBe(first);
    expect((await build.revision(second)).routes).toHaveProperty(`rt_${HOME}_the_old_mill`);
    expect((await stateOf(rig, chatId)).revision).toBe(second);
    expect(rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards).toEqual([]);
    const [chip] = await made();
    expect(chip?.actions.map((a) => a.label)).toEqual(["Undo", "Open in Build"]);
    expect(chip?.detail).toContain("routes: added");

    // The user's Undo: the world as it was, and the chat back on it.
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id ?? "", choice: "undo" }));
    expect(await build.head()).toBe(first);
    expect((await stateOf(rig, chatId)).revision).toBe(first);
    noModelCalls(rig);
  });
});
