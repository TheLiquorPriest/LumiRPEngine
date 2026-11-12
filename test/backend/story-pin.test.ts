// The player's pin on someone's standing (`story/pages.ts`, `castOnReplies`), on a harness chat the
// driver plays: kept on the newest reply and on the reply before it, where a regenerate of the newest
// starts from, so the player's word holds against the author either way; lifted in both places
// alike. The copy on the reply before keeps the mark of what the mind took in that stood there.

import { describe, expect, test } from "bun:test";
import { renderPrompt } from "../../src/backend/prompts";
import { chatStoryPort } from "../../src/backend/story/record";
import { recStoryOf } from "../../src/engine/story/record";
import { RECORD_NOTE, RECORD_TOOL } from "../../src/shared/harness-texts-record";
import type { CastStanding } from "../../src/shared/ledger";
import type { Rig } from "../support/rig";
import { AUTHOR, beginTurn, harnessChat, MARA, recordOn } from "./harness-driver";

const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

/** A turn the author plays to its end: one beat written, and the reply released. That beat's id and the reply's. */
async function played(rig: Rig, chatId: string, text: string, what: string): Promise<{ beat: string; reply: string }> {
  const run = await beginTurn(rig, chatId, text);
  expect(await run.answer(AUTHOR, RECORD_TOOL.beatWrite, { by: "world", kind: "happen", what, surface: what, exposure: [] })).toHaveProperty("written");
  await run.finish(what);
  const reply = rig.host.chat(chatId).messages.at(-1)?.id ?? "";
  return { beat: recStoryOf(await recordOn(rig, chatId, reply)).beats[0]?.id ?? "", reply };
}

describe("the player's pin", () => {
  test("holds through a regenerate of the newest reply and stays lifted once lifted, each reply keeping the mark that stood there", async () => {
    const { rig, chatId } = await harnessChat();
    const userId = rig.host.userId;
    const castOf = async (reply: string) => recStoryOf(await recordOn(rig, chatId, reply)).cast;
    const pin = async (standing: CastStanding | null) => rig.body(await rig.send({ type: "lre.story", chatId, op: "pin", entity: MARA, standing }));
    const cast = async () => rig.body(await rig.send({ type: "lre.story", chatId, op: "cast" }));
    // Mara takes in each turn's beat, as a job of the turn marks it on the newest reply.
    const mark = (to: string) => chatStoryPort(rig.rt, { chatId, userId, turn: "mark", on: "last" }).write({ cast: [{ entity: MARA, standing: "principal", digestedTo: to }] });

    const first = await played(rig, chatId, "I put the kettle on.", "The kettle boils.");
    expect(await mark(first.beat)).toEqual({ kept: true });
    const second = await played(rig, chatId, "I pour the tea.", "The tea steams.");
    expect(await mark(second.beat)).toEqual({ kept: true });

    // Pinned small: on the newest reply with the mark there, on the reply before with the mark that stood there.
    await pin("supporting");
    expect(await castOf(second.reply)).toEqual([{ entity: MARA, standing: "supporting", pinned: true, digestedTo: second.beat }]);
    expect(await castOf(first.reply)).toEqual([{ entity: MARA, standing: "supporting", pinned: true, digestedTo: first.beat }]);

    // A regenerate of the newest reply reads from the reply before: the pin holds against the author.
    const again = await beginTurn(rig, chatId, null, { type: "regenerate" });
    expect(await again.refusal(AUTHOR, RECORD_TOOL.castSet, { who: "Mara", standing: "principal", why: "She leads." })).toBe(note(RECORD_NOTE.pinned, { name: "Mara", standing: "supporting" }));
    await again.finish("The tea is poured again.");
    expect(await cast()).toMatchObject({ cast: { cast: expect.arrayContaining([expect.objectContaining({ entity: MARA, standing: "supporting", pinned: true })]) } });

    // Lifted on both replies alike, each keeping its own mark: a regenerate keeps it lifted, and the author casts her again.
    await pin(null);
    expect(await castOf(first.reply)).toEqual([{ entity: MARA, standing: "supporting", digestedTo: first.beat }]);
    const third = await beginTurn(rig, chatId, null, { type: "regenerate" });
    expect(await third.answer(AUTHOR, RECORD_TOOL.castSet, { who: "Mara", standing: "principal", why: "She leads." })).toHaveProperty("cast");
    await third.finish("The tea is poured a third time.");
    expect(await cast()).toMatchObject({ cast: { cast: expect.arrayContaining([expect.objectContaining({ entity: MARA, standing: "principal", pinned: false })]) } });
  });
});
