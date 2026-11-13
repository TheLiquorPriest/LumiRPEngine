// The reply the engine sends in the author's place (LumiAH's `unreleased`), with LumiAH's side of the
// boundary played by hand (`harness-driver.ts`): the engine offers the turn's telling only where it is
// complete and settled (every passage passed its check, every beat that reached the player's
// character is told), and each passage of it is marked out only once LumiAH says the text went
// (`released`, with no arguments). An offer LumiAH never sends (its wait ran out, the player stopped
// the turn, the reply closed) marks nothing; a telling that isn't complete is never offered.

import { describe, expect, test } from "bun:test";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { type Agent, AUTHOR, beginTurn, harnessChat } from "./harness-driver";

const NARRATOR: Agent = { id: "delegate-narrator", role: HARNESS_AGENT.narrator };
const GM: Agent = { id: "delegate-gm", role: HARNESS_AGENT.gm };
const TOLD = "The kettle shrieks on the stove.";

/** A turn whose one beat reached the player's character and is told by passage 1, which passed its check. */
async function toldTurn() {
  const { rig, chatId } = await harnessChat();
  const run = await beginTurn(rig, chatId, "I wait for the kettle.");
  await run.answer(AUTHOR, "beat_write", { by: "world", kind: "happen", what: "The kettle starts to shriek.", surface: "The kettle shrieks.", exposure: [{ who: "player", reach: "whole" }] });
  await run.answer(AUTHOR, "commit");
  await run.answer(NARRATOR, "narration_read", { passage: 1 });
  await run.answer(NARRATOR, "passage_draft", { passage: 1, text: TOLD });
  await run.answer(GM, "passage_check", { passage: 1, holds: true });
  return { rig, run, extension: rig.rt.harness.extension, turn: { userId: rig.host.userId, chatId, turn: run.turn } };
}

describe("the reply sent in the author's place", () => {
  test("each passage of it is out only once LumiAH says the text went: offered and not sent, none is", async () => {
    const { run, extension, turn } = await toldTurn();
    /** Whether each passage reads as out, as the author's list gives it. */
    const out = async (): Promise<boolean[]> => ((await run.answer(AUTHOR, "passage_read")).pieces as { released?: boolean }[]).map((p) => p.released === true);

    expect(await extension.unreleased?.({ ...turn, ended: "done" })).toEqual({ text: TOLD });
    // Offered, and not sent: nothing is out, as nothing would be had LumiAH never sent it.
    expect(await out()).toEqual([false]);
    // LumiAH says it went: the lead's release, with no arguments.
    await extension.released?.({ ...turn, agent: { agentId: AUTHOR.id, role: AUTHOR.role }, text: TOLD, args: {} });
    expect(await out()).toEqual([true]);
  });

  test("a beat that reached the player's character and no passage tells keeps anything from being offered: the turn fails as it did before", async () => {
    const { run, extension, turn } = await toldTurn();
    await run.answer(AUTHOR, "beat_write", { by: "world", kind: "happen", what: "The front door bangs shut.", surface: "The front door bangs.", exposure: [{ who: "player", reach: "whole" }] });
    await run.answer(AUTHOR, "commit");

    expect(await extension.unreleased?.({ ...turn, ended: "limit" })).toBeNull();
  });
});
