// The story engine end to end, in the runtime (DEPTH2-PLAN §3): LumiAH's real runtime and backend,
// mounted in the engine as production mounts them, with every agent's model scripted
// (`support/runtime-bed.ts`). The author decides through the engine's tools; a principal's own agent
// acts from its own mind; the reply is only what was released, and the turn's record holds what was
// decided. On a chat the harness plays the engine makes no model call of its own.

import { afterEach, describe, expect, test } from "bun:test";
import type { ModelRequest } from "lumi-ah/core";
import { placeOfEntity } from "../../src/engine/scope";
import { recStoryOf } from "../../src/engine/story/record";
import { cast, offers, results, told, toolCall } from "../support/lumiah-bed";
import { Rig } from "../support/rig";
import { type RuntimeBed, runtimeBed } from "../support/runtime-bed";
import { JOSS, MARA, noModelCalls, recordOn, stateOf } from "./harness-driver";
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
const lastResult = (request: ModelRequest): Record<string, unknown> => JSON.parse(results(request).at(-1) ?? "{}") as Record<string, unknown>;

const LINE = "Mara, could you pass the salt?";
const MARA_TASK = "Jordan asks you to pass the salt. You answer the player on the direct line.";
const MARA_SAYS = "Mara slides the salt across the table. “There you go. Anything else, your highness?”";

// ---------------------------------------------------------------- a scene

const RENT = "The landlord called about the rent.";
const MARA_ACTS = "Jordan just told you and Joss the landlord called about the rent. Do what Mara does now.";
const JOSS_ACTS = "Jordan just told you and Mara the landlord called about the rent. Say what Joss does now, and nothing more.";
const JOSS_DOES = "Joss slips the landlord's letter into his pocket before anyone sees it.";
const MARA_QUOTE = "Again? We paid him on Friday.";
const NARRATE_FIRST = "Tell what Jordan saw and heard.";
const NARRATE_KETTLE = "Tell the kettle as Jordan hears it.";
const CHECK_FIRST = "Check passage 1 against its beats.";
const CHECK_KETTLE = "Check passage 2 against its beats.";
const FIRST = `“${RENT}” you tell them. Mara sets her cup down hard. “${MARA_QUOTE}”\n\n`;
const KETTLE = "Behind you the kettle starts to shriek.";
const MARA_TAKES_IN = "Take in what reached you, Mara.";
const JOSS_TAKES_IN = "Take in what reached you, Joss.";
const MARA_NOW = "Joss went quiet about the rent. He is hiding something.";

/** Who was there for the scene: everyone in the kitchen, as the world placed them. */
const everyone = (who: readonly string[]): { who: string; reach: "whole" }[] => who.map((one) => ({ who: one, reach: "whole" }));

/**
 * A scene, played in one turn and its digests after: Jordan tells Mara and Joss the landlord called.
 * Both are cast as principals and act from their own minds: Mara says something aloud and writes her
 * own beat; Joss does something unseen, which the author writes as a beat only Mara half caught. The
 * narrator tells what reached Jordan, the game master checks it, and the author releases it; a world
 * beat follows (the kettle), told and checked the same way. The author tries to release the second
 * passage before its check, and the gate refuses. Each principal takes in what reached them after the
 * reply, Mara writing her own mind and marking what she took in.
 */
async function playScene() {
  const { bed, rig, chatId } = await storyChat();
  const before = await stateOf(rig, chatId);
  const play = cast(
    {
      name: "author",
      is: offers("reply_write"),
      lines: [
        { toolCalls: [toolCall("cast_set", { who: "Mara", standing: "principal", why: "She keeps the flat running and the rent is hers to worry about." }), toolCall("cast_set", { who: "Joss", standing: "principal", why: "He has been hiding the landlord's letters." }), toolCall("beat_write", { by: "player", kind: "say", what: "Jordan tells Mara and Joss the landlord called about the rent.", surface: "Jordan says the landlord called about the rent.", quotes: [RENT], to: ["Mara", "Joss"], exposure: everyone(["Mara", "Joss"]) as never })] },
        { toolCalls: [toolCall("delegate", { agent: "character", as: MARA, task: MARA_ACTS })] },
        { toolCalls: [toolCall("delegate", { agent: "character", as: JOSS, task: JOSS_ACTS })] },
        // What Joss did was his to decide; who caught it is the author's: only Mara, and only in part.
        { toolCalls: [toolCall("beat_write", { by: "Joss", kind: "do", what: JOSS_DOES, surface: "Joss tucks a letter away.", exposure: [{ who: "Mara", reach: "part", got: "Joss tucks something into his pocket." }] })] },
        { toolCalls: [toolCall("time_pass", { minutes: 5 }), toolCall("commit", {})] },
        { toolCalls: [toolCall("delegate", { agent: "narrator", task: NARRATE_FIRST })] },
        { toolCalls: [toolCall("delegate", { agent: "game_master", task: CHECK_FIRST })] },
        { toolCalls: [toolCall("reply_write", { text: FIRST })] },
        { toolCalls: [toolCall("beat_write", { by: "world", kind: "happen", what: "The kettle starts to shriek on the stove.", surface: "The kettle shrieks.", exposure: everyone(["player", "Mara", "Joss"]) as never })] },
        { toolCalls: [toolCall("delegate", { agent: "narrator", task: NARRATE_KETTLE })] },
        // Released before its check: the gate refuses it.
        { toolCalls: [toolCall("reply_write", { text: KETTLE })] },
        { toolCalls: [toolCall("delegate", { agent: "game_master", task: CHECK_KETTLE })] },
        { toolCalls: [toolCall("reply_write", { text: KETTLE })] },
        { toolCalls: [toolCall("job_start", { agent: "character", as: MARA, task: MARA_TAKES_IN, when: "after_reply", lane: "soon", due: "next_turn" }), toolCall("job_start", { agent: "character", as: JOSS, task: JOSS_TAKES_IN, when: "after_reply", lane: "soon", due: "next_turn" })] },
        "The scene rests with Jordan.",
      ],
    },
    {
      name: "mara",
      is: told(MARA_ACTS),
      lines: [
        { toolCalls: [toolCall("feed_read", {})] },
        { toolCalls: [toolCall("beat_write", { by: "Mara", kind: "say", what: "Mara protests that they paid the landlord on Friday.", surface: "Mara sets her cup down and protests.", quotes: [MARA_QUOTE] })] },
        (request) => {
          const { proposed } = lastResult(request) as { proposed: { exposure: unknown } };
          return { toolCalls: [toolCall("beat_write", { by: "Mara", kind: "say", what: "Mara protests that they paid the landlord on Friday.", surface: "Mara sets her cup down and protests.", quotes: [MARA_QUOTE], exposure: proposed.exposure as never })] };
        },
        "Mara protests: they paid on Friday.",
      ],
    },
    { name: "joss", is: told(JOSS_ACTS), lines: [{ toolCalls: [toolCall("feed_read", {})] }, JOSS_DOES] },
    { name: "narrator-first", is: told(NARRATE_FIRST), lines: [{ toolCalls: [toolCall("narration_read", {})] }, { toolCalls: [toolCall("passage_draft", { text: FIRST })] }, "Drafted."] },
    { name: "narrator-kettle", is: told(NARRATE_KETTLE), lines: [{ toolCalls: [toolCall("narration_read", {})] }, { toolCalls: [toolCall("passage_draft", { text: KETTLE })] }, "Drafted."] },
    { name: "gm-first", is: told(CHECK_FIRST), lines: [{ toolCalls: [toolCall("passage_read", { passage: 1 })] }, { toolCalls: [toolCall("passage_check", { passage: 1, holds: true })] }, "It holds."] },
    { name: "gm-kettle", is: told(CHECK_KETTLE), lines: [{ toolCalls: [toolCall("passage_read", { passage: 2 })] }, { toolCalls: [toolCall("passage_check", { passage: 2, holds: true })] }, "It holds."] },
    {
      name: "mara-takes-in",
      is: told(MARA_TAKES_IN),
      lines: [
        { toolCalls: [toolCall("feed_read", {})] },
        { toolCalls: [toolCall("mind_read", { who: "Joss", file: "now.md" })] },
        { toolCalls: [toolCall("mind_write", { file: "now.md", text: MARA_NOW })] },
        (request) => ({ toolCalls: [toolCall("mind_digested", { to: String((JSON.parse(results(request)[0] ?? "{}") as { last?: string }).last) })] }),
        "Taken in.",
      ],
    },
    { name: "joss-takes-in", is: told(JOSS_TAKES_IN), lines: [{ toolCalls: [toolCall("feed_read", {})] }, "Taken in."] },
  );
  bed.script = play.script;
  rig.host.sendUser(chatId, RENT);
  await rig.host.settle();
  const replied = await bed.reply(chatId);
  const replyId = replied.generation.messageId ?? "";
  await bed.until(async () => play.left("mara-takes-in") === 0 && play.left("joss-takes-in") === 0, "each principal's taking in");
  await bed.until(async () => recStoryOf(await recordOn(rig, chatId, replyId)).cast.some((c) => c.entity === MARA && c.digestedTo !== undefined), "Mara's mark of what she took in");
  return { bed, rig, chatId, play, replied, replyId, before };
}

/** A feed as a character's agent was answered it: each item as it reached them. */
const feedOf = (request: ModelRequest | undefined): { items: Record<string, unknown>[] } => JSON.parse(results(request)[0] ?? "{}") as { items: Record<string, unknown>[] };

describe("the story engine in the runtime", () => {
  test("the direct line: the author hands the reply to Mara, her passage is the reply, and her beat is in the reply's record, reaching whoever was there", async () => {
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
          "Mara answered on the direct line.",
        ],
      },
    );
    bed.script = play.script;
    rig.host.sendUser(chatId, LINE);
    await rig.host.settle();

    const replied = await bed.reply(chatId);

    expect(replied.error).toBeNull();
    // The reply is Mara's own passage, as she wrote it: nothing of the author's answer is in it.
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
});
