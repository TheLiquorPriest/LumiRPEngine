// A reply told more than once, end to end with LumiAH's real backend and core
// (`harness-e2e-kit.ts`, `support/lumiah-bed.ts`): a swipe, a Continue, going back to an earlier
// swipe, and deleting one. Each telling is a turn of its own with a record of its own, all of them in
// the reply's one ledger record; LumiAH reads its record for whichever swipe the chat shows from the
// ledger, and never keeps a copy on the message.

import { afterEach, describe, expect, test } from "bun:test";
import { recHarnessOf } from "../../src/backend/harness/record";
import { type Bed, cast, offers } from "../support/lumiah-bed";
import type { Rig } from "../support/rig";
import { noModelCalls, recordOn, stateOf } from "./harness-driver";
import { brief, calls, say, worldChat } from "./harness-e2e-kit";

const beds: Bed[] = [];
afterEach(() => {
  for (const bed of beds.splice(0)) bed.close();
});

/** Which turn's record LumiAH holds for each swipe of a reply, as the engine's ledger gives it: by swipe. */
async function turnsOn(rig: Rig, chatId: string, messageId: string): Promise<Record<string, unknown>> {
  const row = (await rig.rt.harness.anchors(chatId, rig.host.userId)).find((r) => r.messageId === messageId);
  return Object.fromEntries(Object.entries(row?.swipes ?? {}).map(([swipe, record]) => [swipe, record.generationId]));
}

/** The turns LumiAH's Sessions page lists for the chat, each with the swipe its record is for. */
async function listed(bed: Bed, chatId: string): Promise<[string, number][]> {
  const page = await bed.page<{ turns: { turn: string; swipe: number }[] }>("lah.turns.list", { chatId, cursor: null, limit: 10 });
  return page.turns.map((t) => [t.turn, t.swipe]);
}

describe("a reply told more than once on the harness", () => {
  test("a swipe is played afresh from before the reply and keeps a record of its own; a Continue adds its turn to the swipe it continues; LumiAH reads the record of the swipe the chat shows", async () => {
    const { bed, rig, chatId } = await worldChat();
    beds.push(bed);
    const start = (await stateOf(rig, chatId)).clock;
    const play = cast({
      name: "author",
      is: offers("write_reply"),
      lines: [calls("time_pass", { minutes: 5 }), calls("commit"), brief("Five minutes pass."), calls("time_pass", { minutes: 10 }), calls("commit"), brief("Ten minutes pass."), brief("And the rain stops.")],
    });
    bed.script = play.script;

    // The reply, as first told.
    const first = await say(rig, chatId, "I sit a while.");
    await rig.host.finish(first, "Five minutes pass.");
    const replyId = first.messageId ?? "";
    await bed.until(async () => (await turnsOn(rig, chatId, replyId))["0"] === first.id, "the first telling's record");
    expect((await stateOf(rig, chatId)).clock - start).toBe(5);

    // A swipe: the author plays the turn again, from the world as it stood before the reply.
    const swipe = await rig.host.begin(chatId, { type: "swipe" });
    await rig.host.finish(swipe, "Ten minutes pass.");
    await bed.until(async () => (await turnsOn(rig, chatId, replyId))["1"] === swipe.id, "the swipe's record");
    expect(await turnsOn(rig, chatId, replyId)).toEqual({ "0": first.id, "1": swipe.id });
    expect((await stateOf(rig, chatId)).clock - start).toBe(10);
    expect(await listed(bed, chatId)).toEqual([[swipe.id, 1]]);

    // A Continue of that swipe: its turn joins the swipe's record, and LumiAH's record for the swipe is the Continue's.
    const more = await rig.host.begin(chatId, { type: "continue" });
    await rig.host.finish(more, "And the rain stops.");
    await bed.until(async () => (await turnsOn(rig, chatId, replyId))["1"] === more.id, "the Continue's record");
    expect(recHarnessOf(await recordOn(rig, chatId, replyId))?.turns).toEqual([swipe.id, more.id]);
    expect(rig.host.head(chatId)?.swipes[1]).toBe("Ten minutes pass. And the rain stops.");

    // Back to the first telling: its own record is the one LumiAH reads, and the world is as that telling left it.
    rig.host.navigate(chatId, replyId, 0);
    await rig.host.settle();
    expect(await listed(bed, chatId)).toEqual([[first.id, 0]]);
    expect((await stateOf(rig, chatId)).clock - start).toBe(5);

    // The second telling deleted: its record goes with it, the first telling's stays, and LumiAH wrote nothing to move it (the bed fails any write of the message's own entry).
    rig.host.deleteSwipe(chatId, replyId, 1);
    await rig.host.settle();
    expect(await turnsOn(rig, chatId, replyId)).toEqual({ "0": first.id });
    expect(await listed(bed, chatId)).toEqual([[first.id, 0]]);
    expect(play.left("author")).toBe(0);
    noModelCalls(rig);
  });
});
