// The story engine end to end, in the runtime (DEPTH2-PLAN §3): LumiAH's real runtime and backend,
// mounted in the engine as production mounts them, with every agent's model scripted
// (`support/runtime-bed.ts`). The author decides through the engine's tools; a principal's own agent
// acts from its own mind; the reply is only what was released, once and whole: one reply_write that
// names each passage of the narrator's by its number, or a principal's own stream on the direct line;
// an author that ends with nothing released has what passed its checks sent in its place. Each
// narrator keeps to the passage its number names, however many are at work. The narration reads
// reach their readers whole, and the turn's record holds what was decided. On a chat the harness
// plays the engine makes no model call of its own.

import { afterEach, describe, expect, test } from "bun:test";
import type { ModelRequest } from "lumi-ah/core";
import { renderPrompt } from "../../src/backend/prompts";
import { placeOfEntity } from "../../src/engine/scope";
import { recStoryOf } from "../../src/engine/story/record";
import { STAGE_NOTE } from "../../src/shared/harness-texts-stage";
import { cast, heard, offers, results, told, toolCall } from "../support/lumiah-bed";
import { Rig } from "../support/rig";
import { type RuntimeBed, runtimeBed } from "../support/runtime-bed";
import { MARA, noModelCalls, recordOn, stateOf } from "./harness-driver";
import { alderWorld, chatOn, guard, inRuntime } from "./harness-e2e-kit";

const beds: RuntimeBed[] = [];
afterEach(() => {
  for (const bed of beds.splice(0)) bed.close();
});

/** A new Port Alder chat with the tests' people, on the harness in a runtime that is linked: its first reply goes to the runtime. */
async function storyChat(): Promise<{ bed: RuntimeBed; rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true, minds: true });
  const bed = await runtimeBed(rig);
  beds.push(bed);
  const chatId = await chatOn(rig, await alderWorld(rig));
  await bed.until(() => inRuntime(bed, chatId), "the chat set to play in the runtime");
  guard(rig);
  return { bed, rig, chatId };
}

/** What a tool answered, as the agent's next call was sent it: the latest result, read back from its JSON. */
const lastResult = (request: ModelRequest | undefined): Record<string, unknown> => JSON.parse(results(request).at(-1) ?? "{}") as Record<string, unknown>;

/** Text `n` characters long that JSON has to escape in places: quote marks and line breaks, as prose has. */
const prose = (n: number): string => 'She said "not tonight".\nThe harbor lamps went out one by one. '.repeat(Math.ceil(n / 60) + 1).slice(0, n);

/** Who was there for the scene: everyone in the kitchen, as the world placed them. */
const everyone = (who: readonly string[]): { who: string; reach: "whole" }[] => who.map((one) => ({ who: one, reach: "whole" }));

const LINE = "Mara, could you pass the salt?";
const MARA_TASK = "Jordan asks you to pass the salt. You answer the player on the direct line.";
const MARA_SAYS = "Mara slides the salt across the table. “There you go. Anything else, your highness?”";

// ---------------------------------------------------------------- a scene told in two pieces

const RENT = "The landlord called about the rent.";
const NARRATE_FIRST = "Tell what Jordan saw and heard.";
const NARRATE_KETTLE = "Tell the kettle as Jordan hears it.";
const CHECK_FIRST = "Check passage 1 against its beats.";
const CHECK_KETTLE = "Check passage 2 against its beats.";
const FIRST = `“${RENT}” you tell them, and the kitchen goes quiet.`;
const KETTLE = "Behind you the kettle starts to shriek.";
const LATE = "One more line, once the reply is out.";

// ---------------------------------------------------------------- a passage at its longest

const NARRATE_LONG = "Tell the kettle at the longest a passage may be.";
const CHECK_LONG = "Hold passage 1, long as it is, to its beat.";
const REVISE_LONG = "Revise passage 1 as its check asks.";
const CHECK_AGAIN = "Hold the revised passage 1 to its beat.";

const NARRATE_TWO = "Tell passage 2, the second of three.";
const NARRATE_THREE = "Tell passage 3, the last of three.";
const TELL_MORE = "Now tell the kettle, as the next passage.";
const NARRATE_NEXT = "Tell what Jordan does with the kettle.";

/** The handle of the agent a delegate's answer came from, as LumiAH heads that answer for the agent that asked. */
const handleIn = (request: ModelRequest): string => results(request).map((r) => /handle (\S+)\. agent_message/.exec(r)?.[1]).find((h) => h !== undefined) ?? "";

/** The beat of the kettle, written by the author, reaching everyone in the kitchen. */
const kettleBeat = () => toolCall("beat_write", { by: "world", kind: "happen", what: "The kettle starts to shriek on the stove.", surface: "The kettle shrieks.", exposure: everyone(["player", "Mara", "Joss"]) as never });

/** The beat of the rent, said by the player's character to Mara and Joss. */
const rentBeat = () => toolCall("beat_write", { by: "player", kind: "say", what: "Jordan tells Mara and Joss the landlord called about the rent.", surface: "Jordan says the landlord called about the rent.", quotes: [RENT], to: ["Mara", "Joss"], exposure: everyone(["Mara", "Joss"]) as never });

describe("the story engine in the runtime", () => {
  test("the direct line: the author hands the reply to Mara, her passage is the reply and the turn's one release, and her beat is in the reply's record, reaching whoever was there", async () => {
    const { bed, rig, chatId } = await storyChat();
    const play = cast(
      {
        name: "mara",
        is: (request) => told(MARA_TASK)(request) && offers("feed_read")(request),
        lines: [
          { toolCalls: [toolCall("feed_read", {})] },
          // Who it reached is left out: a person's own act is written at once as reaching whoever is there.
          { toolCalls: [toolCall("beat_write", { by: "Mara", kind: "say", what: "Mara passes Jordan the salt and teases him.", surface: "Mara slides the salt across and says something wry.", quotes: ["There you go. Anything else, your highness?"] })] },
          MARA_SAYS,
        ],
      },
      {
        name: "author",
        is: offers("reply_write"),
        lines: [
          { toolCalls: [toolCall("cast_set", { who: "Mara", standing: "principal", why: "She shares the flat and the story turns on her." }), toolCall("beat_write", { by: "player", kind: "say", what: "Jordan asks Mara for the salt.", surface: "Jordan asks for the salt.", quotes: [LINE], to: ["Mara"], exposure: [{ who: "Mara", reach: "whole" }, { who: "Joss", reach: "whole" }, { who: "Ilse", reach: "whole" }] })] },
          { toolCalls: [toolCall("delegate", { agent: "character", as: MARA, task: MARA_TASK, to_reply: true })] },
          // Her stream was the turn's release: a line of the author's own after it goes nowhere.
          { toolCalls: [toolCall("reply_write", { words: LATE })] },
          "Mara answered on the direct line.",
        ],
      },
    );
    bed.script = play.script;
    rig.host.sendUser(chatId, LINE);
    await rig.host.settle();

    const replied = await bed.reply(chatId);

    expect(replied.error).toBeNull();
    // The reply is Mara's own passage, as she wrote it: nothing of the author's is in it.
    expect(replied.content).toBe(MARA_SAYS);
    expect(rig.host.head(chatId)?.swipes[0]).toBe(MARA_SAYS);
    // She read what reached her: Jordan's line, as he said it.
    expect(JSON.stringify(results(play.calls("mara")[1]))).toContain(LINE);
    // Her beat is in the reply's record, decided by her own agent, and it reached everyone there.
    const replyId = replied.generation.messageId ?? "";
    await bed.until(async () => recStoryOf(await recordOn(rig, chatId, replyId)).beats.length === 2, "the turn's beats on the reply's record");
    const beats = recStoryOf(await recordOn(rig, chatId, replyId)).beats;
    const hers = beats.find((b) => b.by === MARA);
    expect(hers).toMatchObject({ kind: "say", quotes: ["There you go. Anything else, your highness?"], decidedBy: { agent: "character", as: MARA } });
    // Whoever was there: everyone in the kitchen with her, as the world places them, and the player's character.
    const state = await stateOf(rig, chatId);
    const there = Object.keys(state.entities).filter((id) => id !== MARA && id !== "pov" && state.entities[id]?.kind === "character" && placeOfEntity(state, id) === placeOfEntity(state, MARA));
    expect(hers?.exposure.map((e) => e.who).sort()).toEqual([...there, "player"].sort());
    expect(there).toEqual(expect.arrayContaining(["ilse", "joss"]));
    expect(recStoryOf(await recordOn(rig, chatId, replyId)).cast).toEqual([expect.objectContaining({ entity: MARA, standing: "principal" })]);
    noModelCalls(rig);
  });

  test("a scene told in two pieces goes out as one reply: one reply_write names both, the reply is their drafts in order, nothing goes out before it or after it, and both read as out", async () => {
    const { bed, rig, chatId } = await storyChat();
    const play = cast(
      {
        name: "author",
        is: offers("reply_write"),
        lines: [
          { toolCalls: [rentBeat()] },
          { toolCalls: [toolCall("time_pass", { minutes: 5 }), toolCall("commit", {})] },
          { toolCalls: [toolCall("delegate", { agent: "narrator", task: NARRATE_FIRST })] },
          { toolCalls: [toolCall("delegate", { agent: "game_master", task: CHECK_FIRST })] },
          { toolCalls: [kettleBeat(), toolCall("commit", {})] },
          { toolCalls: [toolCall("delegate", { agent: "narrator", task: NARRATE_KETTLE })] },
          // Named before the kettle's check: the gate refuses the release, naming that passage, and nothing goes out.
          { toolCalls: [toolCall("reply_write", { pieces: [1, 2] })] },
          { toolCalls: [toolCall("delegate", { agent: "game_master", task: CHECK_KETTLE })] },
          { toolCalls: [toolCall("reply_write", { pieces: [1, 2] })] },
          // The turn's reply is out: a second release goes nowhere, and each passage reads as out.
          { toolCalls: [toolCall("reply_write", { words: LATE })] },
          { toolCalls: [toolCall("passage_read", { passage: 1 }), toolCall("passage_read", { passage: 2 })] },
          "The scene rests with Jordan.",
        ],
      },
      { name: "narrator-first", is: told(NARRATE_FIRST), lines: [{ toolCalls: [toolCall("narration_read", { passage: 1 })] }, { toolCalls: [toolCall("passage_draft", { passage: 1, text: FIRST })] }, `Passage 1, ${FIRST.length} characters, waiting for its check.`] },
      { name: "narrator-kettle", is: told(NARRATE_KETTLE), lines: [{ toolCalls: [toolCall("narration_read", { passage: 2 })] }, { toolCalls: [toolCall("passage_draft", { passage: 2, text: KETTLE })] }, `Passage 2, ${KETTLE.length} characters, waiting for its check.`] },
      { name: "gm-first", is: told(CHECK_FIRST), lines: [{ toolCalls: [toolCall("passage_read", { passage: 1 })] }, { toolCalls: [toolCall("passage_check", { passage: 1, holds: true })] }, "It holds."] },
      { name: "gm-kettle", is: told(CHECK_KETTLE), lines: [{ toolCalls: [toolCall("passage_read", { passage: 2 })] }, { toolCalls: [toolCall("passage_check", { passage: 2, holds: true })] }, "It holds."] },
    );
    bed.script = play.script;
    rig.host.sendUser(chatId, RENT);
    await rig.host.settle();

    const replied = await bed.reply(chatId);

    expect(replied.error).toBeNull();
    // One message, whole: both drafts in the order named, a blank line between them, and nothing released before or after.
    expect(replied.content).toBe(`${FIRST}\n\n${KETTLE}`);
    expect(rig.host.head(chatId)?.swipes[0]).toBe(`${FIRST}\n\n${KETTLE}`);
    const author = play.calls("author");
    // The release that named a passage not checked yet was refused, naming it.
    expect(results(author[7]).at(-1)).toContain(renderPrompt(STAGE_NOTE.gateUnchecked, {}, { n: "2" }));
    // Up to its release the author was never given either passage's text: each narrator answered in a line, and what went out is the drafts the engine holds.
    for (const [i, request] of author.slice(0, 9).entries()) expect({ i, first: heard(request).includes(FIRST), kettle: heard(request).includes(KETTLE) }).toEqual({ i, first: false, kettle: false });
    // The second narrator went on from the first passage, which had passed its check, though none of it was out.
    expect(lastResult(play.calls("narrator-kettle")[1]).reply).toBe(FIRST);
    // Both read as out once the reply went.
    expect(results(author[11]).slice(-2).map((r) => (JSON.parse(r) as { passage: number; released?: boolean })).map((p) => [p.passage, p.released])).toEqual([
      [1, true],
      [2, true],
    ]);
    noModelCalls(rig);
  });

  test("a passage at its longest, found at fault with every change a check may ask, reaches the game master checking it and the narrator revising it whole, what each acts on first", async () => {
    const { bed, rig, chatId } = await storyChat();
    const s = (await rig.rt.settings.get(rig.host.userId)).narration;
    const long = prose(s.passageChars).trim();
    const revised = `${prose(s.passageChars - 40).trim()} The kettle shrieks.`;
    const changes = Array.from({ length: s.changes }, (_, i) => `${prose(s.changeChars - 4).trim()} #${i}`);
    const play = cast(
      {
        name: "author",
        is: offers("reply_write"),
        lines: [
          { toolCalls: [kettleBeat(), toolCall("commit", {})] },
          { toolCalls: [toolCall("delegate", { agent: "narrator", task: NARRATE_LONG })] },
          { toolCalls: [toolCall("delegate", { agent: "game_master", task: CHECK_LONG })] },
          { toolCalls: [toolCall("delegate", { agent: "narrator", task: REVISE_LONG })] },
          { toolCalls: [toolCall("delegate", { agent: "game_master", task: CHECK_AGAIN })] },
          { toolCalls: [toolCall("reply_write", { pieces: [1] })] },
          "Told.",
        ],
      },
      { name: "narrator", is: told(NARRATE_LONG), lines: [{ toolCalls: [toolCall("narration_read", { passage: 1 })] }, { toolCalls: [toolCall("passage_draft", { passage: 1, text: long })] }, `Passage 1, ${long.length} characters, waiting for its check.`] },
      { name: "gm", is: told(CHECK_LONG), lines: [{ toolCalls: [toolCall("passage_read", { passage: 1 })] }, { toolCalls: [toolCall("passage_check", { passage: 1, holds: false, changes })] }, "It doesn't hold."] },
      { name: "reviser", is: told(REVISE_LONG), lines: [{ toolCalls: [toolCall("narration_read", { passage: 1 })] }, { toolCalls: [toolCall("passage_draft", { passage: 1, text: revised })] }, `Passage 1, ${revised.length} characters, waiting for its check.`] },
      { name: "gm-again", is: told(CHECK_AGAIN), lines: [{ toolCalls: [toolCall("passage_read", { passage: 1 })] }, { toolCalls: [toolCall("passage_check", { passage: 1, holds: true })] }, "It holds."] },
    );
    bed.script = play.script;
    rig.host.sendUser(chatId, "I wait for the kettle.");
    await rig.host.settle();

    const replied = await bed.reply(chatId);

    expect(replied.error).toBeNull();
    expect(replied.content).toBe(revised);
    // The game master was given the beat, then the draft at its longest, in one result: read back whole, nothing of it left for scratch_read.
    const checked = lastResult(play.calls("gm")[1]) as { beats: { what: string }[]; draft: { text: string } };
    expect([checked.beats.map((b) => b.what), checked.draft.text]).toEqual([["The kettle starts to shriek on the stove."], long]);
    expect(Object.keys(checked).indexOf("beats")).toBeLessThan(Object.keys(checked).indexOf("draft"));
    // The narrator revising was given its draft and every change first, whole, before the prose it matches its voice to.
    const revising = lastResult(play.calls("reviser")[1]);
    expect(revising.revise).toEqual({ draft: long, changes });
    const keys = Object.keys(revising);
    expect([keys.indexOf("revise") < keys.indexOf("happened"), keys.indexOf("revise") < keys.indexOf("recent")]).toEqual([true, true]);
    noModelCalls(rig);
  });

  test("three narrators asked in one answer for the passage numbered 1, 2 and 3 keep to their numbers: only passage 1 opens, telling every beat, and the reply is it alone", async () => {
    const { bed, rig, chatId } = await storyChat();
    const play = cast(
      {
        name: "author",
        is: offers("reply_write"),
        lines: [
          { toolCalls: [rentBeat(), kettleBeat(), toolCall("commit", {})] },
          { toolCalls: [toolCall("delegate", { agent: "narrator", task: NARRATE_FIRST }), toolCall("delegate", { agent: "narrator", task: NARRATE_TWO }), toolCall("delegate", { agent: "narrator", task: NARRATE_THREE })] },
          { toolCalls: [toolCall("delegate", { agent: "game_master", task: CHECK_FIRST })] },
          { toolCalls: [toolCall("passage_read", {})] },
          { toolCalls: [toolCall("reply_write", { pieces: [1] })] },
          "Told.",
        ],
      },
      { name: "narrator-1", is: told(NARRATE_FIRST), lines: [{ toolCalls: [toolCall("narration_read", { passage: 1 })] }, { toolCalls: [toolCall("passage_draft", { passage: 1, text: FIRST })] }, `Passage 1, ${FIRST.length} characters, waiting for its check.`] },
      { name: "narrator-2", is: told(NARRATE_TWO), lines: [{ toolCalls: [toolCall("narration_read", { passage: 2 })] }, { toolCalls: [toolCall("passage_draft", { passage: 2, text: KETTLE })] }, "Passage 2 couldn't be told."] },
      { name: "narrator-3", is: told(NARRATE_THREE), lines: [{ toolCalls: [toolCall("narration_read", { passage: 3 })] }, { toolCalls: [toolCall("passage_draft", { passage: 3, text: KETTLE })] }, "Passage 3 couldn't be told."] },
      { name: "gm-first", is: told(CHECK_FIRST), lines: [{ toolCalls: [toolCall("passage_read", { passage: 1 })] }, { toolCalls: [toolCall("passage_check", { passage: 1, holds: true })] }, "It holds."] },
    );
    bed.script = play.script;
    rig.host.sendUser(chatId, RENT);
    await rig.host.settle();

    const replied = await bed.reply(chatId);

    expect(replied.error).toBeNull();
    expect(replied.content).toBe(FIRST);
    // Passage 1 was told whoever read first, with both beats; neither other narrator opened or drafted a passage.
    const told1 = lastResult(play.calls("narrator-1")[1]) as { passage: number; happened: unknown[] };
    expect({ passage: told1.passage, beats: told1.happened.length }).toEqual({ passage: 1, beats: 2 });
    expect(lastResult(play.calls("author")[4])).toEqual({ pieces: [expect.objectContaining({ passage: 1, draft: 1, chars: FIRST.length, check: "holds", ready: true })], next: 2 });
    noModelCalls(rig);
  });

  test("a narrator sent on with agent_message after its passage passed tells only the new beat, as the next passage, and the reply is both", async () => {
    const { bed, rig, chatId } = await storyChat();
    const play = cast(
      {
        name: "author",
        is: offers("reply_write"),
        lines: [
          { toolCalls: [rentBeat(), toolCall("commit", {})] },
          { toolCalls: [toolCall("delegate", { agent: "narrator", task: NARRATE_FIRST })] },
          { toolCalls: [toolCall("delegate", { agent: "game_master", task: CHECK_FIRST })] },
          { toolCalls: [kettleBeat(), toolCall("commit", {})] },
          (request) => ({ toolCalls: [toolCall("agent_message", { handle: handleIn(request), text: TELL_MORE })] }),
          { toolCalls: [toolCall("delegate", { agent: "game_master", task: CHECK_KETTLE })] },
          { toolCalls: [toolCall("reply_write", { pieces: [1, 2] })] },
          "Told.",
        ],
      },
      {
        name: "narrator",
        is: told(NARRATE_FIRST),
        lines: [
          { toolCalls: [toolCall("narration_read", {})] },
          { toolCalls: [toolCall("passage_draft", { passage: 1, text: FIRST })] },
          `Passage 1, ${FIRST.length} characters, waiting for its check.`,
          { toolCalls: [toolCall("narration_read", {})] },
          { toolCalls: [toolCall("passage_draft", { passage: 2, text: KETTLE })] },
          `Passage 2, ${KETTLE.length} characters, waiting for its check.`,
        ],
      },
      { name: "gm-first", is: told(CHECK_FIRST), lines: [{ toolCalls: [toolCall("passage_read", { passage: 1 })] }, { toolCalls: [toolCall("passage_check", { passage: 1, holds: true })] }, "It holds."] },
      { name: "gm-kettle", is: told(CHECK_KETTLE), lines: [{ toolCalls: [toolCall("passage_read", { passage: 2 })] }, { toolCalls: [toolCall("passage_check", { passage: 2, holds: true })] }, "It holds."] },
    );
    bed.script = play.script;
    rig.host.sendUser(chatId, RENT);
    await rig.host.settle();

    const replied = await bed.reply(chatId);

    expect(replied.error).toBeNull();
    expect(replied.content).toBe(`${FIRST}\n\n${KETTLE}`);
    // Sent on, it read the next passage: the kettle alone, going on from passage 1, which had passed.
    const more = lastResult(play.calls("narrator")[4]) as { passage: number; happened: { sensed?: string }[]; reply?: string };
    expect({ passage: more.passage, sensed: more.happened.map((h) => h.sensed), reply: more.reply }).toEqual({ passage: 2, sensed: ["The kettle shrieks."], reply: FIRST });
    noModelCalls(rig);
  });

  test("an author that ends after two checked pieces with nothing released has both sent, in order, as the turn's reply, which the next turn's narrator goes on from", async () => {
    const { bed, rig, chatId } = await storyChat();
    const play = cast(
      {
        name: "author",
        is: offers("reply_write"),
        lines: [
          { toolCalls: [rentBeat(), toolCall("commit", {})] },
          { toolCalls: [toolCall("delegate", { agent: "narrator", task: NARRATE_FIRST })] },
          { toolCalls: [toolCall("delegate", { agent: "game_master", task: CHECK_FIRST })] },
          { toolCalls: [kettleBeat(), toolCall("commit", {})] },
          { toolCalls: [toolCall("delegate", { agent: "narrator", task: NARRATE_KETTLE })] },
          { toolCalls: [toolCall("delegate", { agent: "game_master", task: CHECK_KETTLE })] },
          // It ends here, releasing nothing.
          "The scene is told.",
          // The next turn.
          { toolCalls: [toolCall("beat_write", { by: "player", kind: "do", what: "Jordan takes the kettle off the stove.", surface: "Jordan takes the kettle off.", exposure: everyone(["Mara", "Joss"]) as never }), toolCall("commit", {})] },
          { toolCalls: [toolCall("delegate", { agent: "narrator", task: NARRATE_NEXT })] },
          { toolCalls: [toolCall("reply_write", { words: "The kitchen goes quiet." })] },
          "Done.",
        ],
      },
      { name: "narrator-first", is: told(NARRATE_FIRST), lines: [{ toolCalls: [toolCall("narration_read", { passage: 1 })] }, { toolCalls: [toolCall("passage_draft", { passage: 1, text: FIRST })] }, `Passage 1, ${FIRST.length} characters, waiting for its check.`] },
      { name: "narrator-kettle", is: told(NARRATE_KETTLE), lines: [{ toolCalls: [toolCall("narration_read", { passage: 2 })] }, { toolCalls: [toolCall("passage_draft", { passage: 2, text: KETTLE })] }, `Passage 2, ${KETTLE.length} characters, waiting for its check.`] },
      { name: "narrator-next", is: told(NARRATE_NEXT), lines: [{ toolCalls: [toolCall("narration_read", { passage: 1 })] }, "Read."] },
      { name: "gm-first", is: told(CHECK_FIRST), lines: [{ toolCalls: [toolCall("passage_read", { passage: 1 })] }, { toolCalls: [toolCall("passage_check", { passage: 1, holds: true })] }, "It holds."] },
      { name: "gm-kettle", is: told(CHECK_KETTLE), lines: [{ toolCalls: [toolCall("passage_read", { passage: 2 })] }, { toolCalls: [toolCall("passage_check", { passage: 2, holds: true })] }, "It holds."] },
    );
    bed.script = play.script;
    rig.host.sendUser(chatId, RENT);
    await rig.host.settle();

    const replied = await bed.reply(chatId);

    expect(replied.error).toBeNull();
    expect(replied.content).toBe(`${FIRST}\n\n${KETTLE}`);
    expect(rig.host.head(chatId)?.swipes[0]).toBe(`${FIRST}\n\n${KETTLE}`);

    rig.host.sendUser(chatId, "I take the kettle off the stove.");
    await rig.host.settle();
    const next = await bed.reply(chatId);

    expect(next.error).toBeNull();
    // The reply that went in the author's place is the chat's prose the next turn's narrator goes on from.
    expect(String(lastResult(play.calls("narrator-next")[1]).recent)).toContain(`${FIRST}\n\n${KETTLE}`);
    noModelCalls(rig);
  });
});
