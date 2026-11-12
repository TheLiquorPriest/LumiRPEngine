// Where a harness turn starts from (HARNESS-SLICE3: "The ledger as the anchor"). A turn plays on the
// record its generation stands on: a new reply on the chat's head, a swipe and a Regenerate on the
// state before the reply they tell again, a Continue on the reply it adds to. Each telling keeps its
// own record, with LumiAH's record of its turn, and the anchors LumiAH resumes its session from are
// read from the records on the path the chat shows. The engine choice itself is the chat's, kept
// with it, and follows LumiAH's own switch for the chat.

import { describe, expect, test } from "bun:test";
import { recHarnessOf } from "../../src/backend/harness/record";
import { renderPrompt } from "../../src/backend/prompts";
import { HARNESS_NOTE } from "../../src/shared/harness-texts";
import { placeOfEntity } from "../../src/engine/scope";
import type { Rig } from "../support/rig";
import { alderChat, HOME } from "../support/tools";
import { AUTHOR, beginTurn, BRANN, harnessChat, mount, noModelCalls, OKORO, playOn, recordOn, stateOf } from "./harness-driver";

const note = (id: string): string => renderPrompt(id, {}, {});

/** Where Okoro and Brann are and what time it is, as the chat's ledger folds it now. */
async function where(rig: Rig, chatId: string): Promise<{ okoro: string | null; brann: string | null; clock: number }> {
  const state = await stateOf(rig, chatId);
  return { okoro: placeOfEntity(state, OKORO), brann: placeOfEntity(state, BRANN), clock: state.clock };
}

/** LumiAH's record on each reply the chat shows: which swipe, and which generation's turn wrote it. */
async function anchors(rig: Rig, chatId: string): Promise<[number, unknown][]> {
  return (await rig.rt.harness.anchors(chatId, rig.host.userId)).flatMap((a): [number, unknown][] => (a.swipes[String(a.swipeId)] ? [[a.swipeId, a.swipes[String(a.swipeId)]?.generationId]] : []));
}

describe("where a harness turn starts from", () => {
  test("a swipe and a Regenerate play again from the state before the reply, and each telling keeps its own record", async () => {
    const { rig, chatId } = await harnessChat();
    const start = (await stateOf(rig, chatId)).clock;
    const first = await beginTurn(rig, chatId, "I ask whether Okoro is coming by.");
    await first.answer(AUTHOR, "gm_move", { entity: "Okoro", to: HOME });
    await first.answer(AUTHOR, "time_pass", { minutes: 10 });
    await first.finish("Okoro is on the step.");
    expect(await where(rig, chatId)).toEqual({ okoro: HOME, brann: null, clock: start + 10 });
    expect(await anchors(rig, chatId)).toEqual([[0, first.turn]]);

    // A swipe tells the reply again: its turn stands where the first one stood, with nothing of the first telling.
    const swipe = await beginTurn(rig, chatId, null, { type: "swipe" });
    expect(JSON.stringify(await swipe.answer(AUTHOR, "people_find", { name: "Okoro" }))).not.toContain(HOME);
    expect((await swipe.answer(AUTHOR, "time_clock", {})).minutes).toBe(start);
    await swipe.answer(AUTHOR, "gm_move", { entity: "Brann", to: HOME });
    await swipe.answer(AUTHOR, "time_pass", { minutes: 20 });
    await swipe.finish("Brann leans in the doorway.");
    expect(await where(rig, chatId)).toEqual({ okoro: null, brann: HOME, clock: start + 20 });
    expect(await anchors(rig, chatId)).toEqual([[1, swipe.turn]]);
    // The first telling is still there, whole: shown again, the chat is where it left it, and so is LumiAH's record.
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    rig.host.navigate(chatId, reply.id, 0);
    await rig.host.settle();
    expect(await where(rig, chatId)).toEqual({ okoro: HOME, brann: null, clock: start + 10 });
    expect(await anchors(rig, chatId)).toEqual([[0, first.turn]]);

    // A Regenerate does the same from whichever telling is shown.
    const again = await beginTurn(rig, chatId, null, { type: "regenerate" });
    expect((await again.answer(AUTHOR, "time_clock", {})).minutes).toBe(start);
    await again.answer(AUTHOR, "time_pass", { minutes: 5 });
    await again.finish("Nobody comes.");
    expect(await where(rig, chatId)).toEqual({ okoro: null, brann: null, clock: start + 5 });
    expect(await anchors(rig, chatId)).toEqual([[2, again.turn]]);
    expect(recHarnessOf(await recordOn(rig, chatId, reply.id))?.turns).toEqual([again.turn]);
    noModelCalls(rig);
  });

  test("a new turn plays on from the reply before it, and a Continue adds to the reply's own record", async () => {
    const { rig, chatId } = await harnessChat();
    const start = (await stateOf(rig, chatId)).clock;
    const first = await beginTurn(rig, chatId, "I ask whether Okoro is coming by.");
    await first.answer(AUTHOR, "gm_move", { entity: "Okoro", to: HOME });
    await first.answer(AUTHOR, "time_pass", { minutes: 10 });
    await first.finish("Okoro is on the step.");
    // A Continue stands on the reply it adds to: what its agents commit joins that reply's record, which names both turns.
    const more = await beginTurn(rig, chatId, null, { type: "continue" });
    expect((await more.answer(AUTHOR, "time_clock", {})).minutes).toBe(start + 10);
    await more.answer(AUTHOR, "gm_move", { entity: "Brann", to: HOME });
    await more.answer(AUTHOR, "time_pass", { minutes: 7 });
    await more.finish("Brann is right behind him.");
    expect(await where(rig, chatId)).toEqual({ okoro: HOME, brann: HOME, clock: start + 17 });
    const reply = rig.host.head(chatId);
    const rec = reply ? await recordOn(rig, chatId, reply.id) : null;
    expect(recHarnessOf(rec)?.turns).toEqual([first.turn, more.turn]);
    expect(recHarnessOf(rec)?.record?.generationId).toBe(more.turn);
    expect(rec?.post.map((p) => p.kind)).toEqual(["cont"]);
    // The next turn stands on all of it.
    const next = await beginTurn(rig, chatId, "I make room at the table.");
    expect((await next.answer(AUTHOR, "time_clock", {})).minutes).toBe(start + 17);
    expect(JSON.stringify(await next.answer(AUTHOR, "people_find", { name: "Brann" }))).toContain(HOME);
    await next.answer(AUTHOR, "time_pass", { minutes: 0 });
    await next.finish("They sit.");
    expect(await anchors(rig, chatId)).toEqual([
      [0, more.turn],
      [0, next.turn],
    ]);
    noModelCalls(rig);
  });

  test("a turn that begins while an edit waits on Keep or Discard has nothing to stand on: its tools say so, and nothing is recorded", async () => {
    const { rig, chatId } = await harnessChat();
    const first = await beginTurn(rig, chatId, "I ask whether Okoro is coming by.");
    await first.answer(AUTHOR, "time_pass", { minutes: 10 });
    await first.finish("Okoro is on the step.");
    const before = await where(rig, chatId);
    const said = rig.host.chat(chatId).messages.find((m) => m.isUser);
    if (!said) throw new Error("no message");
    rig.host.editMessage(chatId, said.id, "I ask whether Brann is coming by.");
    await rig.host.settle();
    const paused = await beginTurn(rig, chatId, "I wait for an answer.");
    expect(await paused.refusal(AUTHOR, "gm_move", { entity: "Okoro", to: HOME })).toBe(note(HARNESS_NOTE.noTurn));
    expect(await paused.refusal(AUTHOR, "commit", {})).toBe(note(HARNESS_NOTE.noTurn));
    await paused.finish("Nobody answers.");
    const reply = rig.host.head(chatId);
    expect(recHarnessOf(reply ? await recordOn(rig, chatId, reply.id) : null)).toBeNull();
    expect((await where(rig, chatId)).okoro).toBe(before.okoro);
    noModelCalls(rig);
  });
});

describe("the engine choice", () => {
  test("a chat can be switched to the harness only in a build that mounts LumiAH; where its runtime can't play it yet the page says why and the choice is kept all the same; and LumiAH's own switch for the chat follows the choice", async () => {
    const { rig, chatId } = await alderChat();
    const choose = (engine: string | null) => rig.send({ type: "lre.chat.knowledge", chatId, engine });
    const asked = async (on: Rig) => on.body(await on.send({ type: "lre.chat.knowledge", chatId, engines: true }));
    // Nothing mounted: no one would play the chat's turns, so the choice is refused, in words that say what to do, and the chat stays as it was.
    const refused = await choose("harness");
    expect(refused.type === "lre.error" ? refused.code : null).toBe("unavailable");
    expect(refused.type === "lre.error" ? refused.message : "").toContain("Update LumiRPEngine in Lumiverse (Extensions → LumiRPEngine), then choose Harness here.");
    expect(await rig.rt.chatKnowledge.engine(chatId, rig.host.userId)).toBe("classic");
    // The Engine page learns it before anything is pressed; every other reader of the chat's choices is answered as it always was.
    expect(await asked(rig)).toEqual({ knowledge: null, narrator: null, harnessBlocked: "This build of LumiRPEngine doesn't include the harness yet. Update LumiRPEngine in Lumiverse (Extensions → LumiRPEngine), then choose Harness here." });
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId }))).toEqual({ knowledge: null, narrator: null });
    const unknown = await choose("turbo");
    expect(unknown.type === "lre.error" ? unknown.code : null).toBe("bad_request");
    // Mounted, but LumiAH lacks something of the user's: the page says what, and the choice is kept all the same, with LumiAH's switch on: the chat waits for its runtime, and no other engine stands in.
    const pins = mount(rig);
    rig.rt.harness.runtime = async () => "LumiRPEngine isn't granted the interceptor permission. Grant it in Lumiverse (Extensions → LumiRPEngine → Permissions).";
    expect((await asked(rig)).harnessBlocked).toContain("Grant it in Lumiverse");
    expect(rig.body(await choose("harness")).engine).toBe("harness");
    expect(pins).toEqual([{ chatId, harness: true }]);
    // Able to play, nothing else is asked of the user, and the choice and LumiAH's switch survive a restart of the backend.
    rig.rt.harness.runtime = async () => null;
    expect(await asked(rig)).toEqual({ engine: "harness", knowledge: null, narrator: null });
    const restarted = rig.restart();
    const later = mount(restarted);
    expect(await restarted.rt.chatKnowledge.engine(chatId, restarted.host.userId)).toBe("harness");
    // Switched back, LumiAH's switch goes off with it, and the chat plays as it did.
    await playOn(restarted, chatId, "agents");
    await playOn(restarted, chatId, "classic");
    expect(later).toEqual([
      { chatId, harness: false },
      { chatId, harness: false },
    ]);
    expect(await restarted.rt.chatKnowledge.engine(chatId, restarted.host.userId)).toBe("classic");
  });

  test("where LumiAH's switch refuses, the chat is the harness's all the same, and is set to its runtime when the user's runtime changes", async () => {
    const { rig, chatId } = await alderChat();
    const pins = mount(rig);
    const working = rig.rt.harness.pin;
    rig.rt.harness.pin = async () => {
      throw new Error("no runtime was ever set up");
    };
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "harness" })).engine).toBe("harness");
    expect(pins).toEqual([]);
    // The runtime links: the chat that couldn't be set is set now, and only once.
    rig.rt.harness.pin = working;
    await rig.rt.harness.runtimeChanged(rig.host.userId);
    await rig.rt.harness.runtimeChanged(rig.host.userId);
    expect(pins).toEqual([{ chatId, harness: true }]);
    expect(await rig.rt.chatKnowledge.engine(chatId, rig.host.userId)).toBe("harness");
  });

  test("on a harness chat the engine reads and tells no reply itself: no chip offers it, one pressed anyway is refused with no model call, and the chat's other engines offer theirs as they always did", async () => {
    const { rig, chatId } = await harnessChat();
    const run = await beginTurn(rig, chatId, "I put the kettle on.");
    await run.finish("The kettle ticks as it warms.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    const kinds = async (): Promise<string[]> => (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === reply.id).map((c) => c.kind);
    // The reply edited: where the engine reads replies itself, the edit gets a Re-read chip, and the reply a Swipe as… one.
    rig.host.editMessage(chatId, reply.id, "The kettle ticks as it warms, and Okoro knocks.");
    await rig.host.settle();
    const shown = await kinds();
    for (const kind of ["reread", "retry_read", "swipe_option"]) expect(shown).not.toContain(kind);
    const pressed = await rig.send({ type: "lre.chip", chatId, chip: `reread:${reply.id}:0`, choice: "reread" });
    expect(pressed.type === "lre.error" ? pressed.message : "").toContain("plays on the harness");
    noModelCalls(rig);
    // Switched to its classic steps, the same chat shows both again.
    await playOn(rig, chatId, "classic");
    const classic = await kinds();
    expect(classic).toContain("reread");
    expect(classic).toContain("swipe_option");
  });
});
