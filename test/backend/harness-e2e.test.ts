// A harness chat end to end: LumiAH's real backend mounted in the engine as production mounts it
// (`backend/harness/mount.ts`), with its runtime linked (`support/runtime-bed.ts`), on the fake
// Lumiverse, with the agents' model scripted. What the harness leaves alone, LumiAH's own pages for
// the engine's agents and tools, the one switch the two share, and a Branch.
//
// On a harness chat the engine makes no model call: its helper throws if reached, and each such
// test ends by checking it never was.

import { afterEach, describe, expect, test } from "bun:test";
import { recHarnessOf, unplayedOf } from "../../src/backend/harness/record";
import type { JsonObject } from "../../src/shared/json";
import { cast, offers, PageRefused } from "../support/lumiah-bed";
import { plainMinds } from "../support/rig";
import type { RuntimeBed } from "../support/runtime-bed";
import { noModelCalls, playOn, recordOn } from "./harness-driver";
import { alderWorld, calls, chatOn, engineOf, linked, release, say, worldChat as newChat } from "./harness-e2e-kit";

const beds: RuntimeBed[] = [];
afterEach(() => {
  for (const bed of beds.splice(0)) bed.close();
});

/** A new world chat on the harness in a linked runtime (`harness-e2e-kit.ts`), its bed closed when the test ends. */
async function worldChat(guarded = true) {
  const made = await newChat(guarded);
  beds.push(made.bed);
  return made;
}

/** LumiAH's own switch for a chat, as its page reads it. */
const isOn = async (bed: RuntimeBed, chatId: string): Promise<boolean> => (await bed.page<{ chat: { on: boolean } }>("lah.chat.get", { chatId })).chat.on;

describe("what the harness leaves alone", () => {
  test("a chat switched to its classic steps is played by the engine as before: LumiAH is switched off for it and has no part in its turn", async () => {
    const { bed, rig, chatId } = await worldChat(false);
    // Its classic steps call the engine's own helper model, minds among them: answered plainly here.
    rig.host.quietReply = plainMinds;
    await playOn(rig, chatId, "classic");
    expect(await isOn(bed, chatId)).toBe(false);

    await rig.turn(chatId, "I wait for the kettle.", "The kettle ticks as it warms.");

    expect(bed.calls).toEqual([]);
    const reply = rig.host.head(chatId);
    expect(reply?.swipes[reply.swipeId]).toBe("The kettle ticks as it warms.");
    const rec = await recordOn(rig, chatId, reply?.id ?? "");
    expect(rec).not.toBeNull();
    expect([recHarnessOf(rec), unplayedOf(rec)]).toEqual([null, null]);
    // The agents engine is the engine's own too: choosing it leaves LumiAH off, and the harness comes back by the same switch.
    await playOn(rig, chatId, "agents");
    expect(await isOn(bed, chatId)).toBe(false);
    await playOn(rig, chatId, "harness");
    expect(await isOn(bed, chatId)).toBe(true);
  });

  test("LumiAH's Agents and Tools pages show the engine's own agents with the engine's tools; the author saved there runs as the user set it, and keeps the engine's instructions and tools", async () => {
    const { bed } = await linked();
    beds.push(bed);
    type Defs = { agents: (JsonObject & { id: string; source?: string; tools?: string[] })[]; tools: { name: string; family: string; tier: string }[] };
    const defs = await bed.page<Defs>("lah.defs.get");
    // About no chat, as the pages ask: the engine's tools are there to see and tick, each with its family and tier.
    const tools = new Map(defs.tools.map((tool) => [tool.name, tool]));
    for (const name of ["gm_move", "commit", "time_pass", "mind_read", "beat_write", "lore_grep"]) expect([name, tools.has(name)]).toEqual([name, true]);
    expect(tools.get("mind_read")).toMatchObject({ family: "mind", tier: "read" });
    expect(defs.agents.map((agent) => agent.id)).toEqual(expect.arrayContaining(["author", "character", "game_master", "narrator", "gm_assistant"]));
    // The author's definition, edited on the page and saved: it is the user's from now on in what it runs with, while its instructions and its tools stay the engine's, whose texts are edited on the engine's own Prompts page and name its tools.
    const { source: _source, ...author }: JsonObject = defs.agents.find((agent) => agent.id === "author") ?? {};
    const saved = await bed.page<Defs>("lah.agent.save", { agent: { ...author, effort: "low", instructions: `${String(author.instructions)}\n\nKeep every scene short.`, tools: ["beat_write"] } });
    const mine = saved.agents.find((agent) => agent.id === "author");
    expect(mine?.source).toBe("user");
    expect(mine?.effort).toBe("low");
    expect(mine?.instructions).toBe(author.instructions);
    expect(mine?.tools).toEqual(author.tools as string[]);
  });

  test("LumiAH's own switch and the Engine page are one choice, and a chat that plays no world can't be switched on here", async () => {
    const { bed, rig, chatId } = await worldChat();
    // Off on LumiAH's page: the chat plays its classic steps. On again: the harness.
    expect((await bed.page<{ chat: { on: boolean } }>("lah.chat.set", { chatId, on: false })).chat.on).toBe(false);
    expect(await engineOf(rig, chatId)).toBe("classic");
    expect((await bed.page<{ chat: { on: boolean } }>("lah.chat.set", { chatId, on: true })).chat.on).toBe(true);
    expect(await engineOf(rig, chatId)).toBe("harness");
    // A chat with no world is none of this LumiAH's.
    const plain = rig.host.createChat("Hello.");
    const refused = await bed.page("lah.chat.set", { chatId: plain, on: true }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(PageRefused);
    expect([(refused as PageRefused).code, (refused as PageRefused).message]).toEqual(["unavailable", expect.stringContaining("plays none")]);
  });

  test("without a permission LumiAH can't do without, a new world chat is the harness's all the same and the Engine page says what to grant; once granted, nothing is left to press", async () => {
    const { bed, rig } = await linked();
    beds.push(bed);
    bed.permit("interceptor", false);
    const worldId = await alderWorld(rig);
    const chatId = await chatOn(rig, worldId);
    // No quieter engine stands in: the chat waits on the harness, and its page says why and what to do.
    expect(await engineOf(rig, chatId)).toBe("harness");
    expect(String(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engines: true })).harnessBlocked)).toContain('The permission "interceptor" isn\'t granted');
    bed.permit("interceptor", true);
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engines: true })).harnessBlocked).toBeUndefined();
    expect(await engineOf(rig, chatId)).toBe("harness");
  });

  test("a Branch of a harness chat plays on the harness from its first turn, with nothing to switch", async () => {
    const { bed, rig, chatId } = await worldChat();
    const first = cast({ name: "author", is: offers("reply_write"), lines: [calls("time_pass", { minutes: 5 }), calls("commit"), release("Five quiet minutes pass."), "Released."] });
    bed.script = first.script;
    const turn = await say(bed, rig, chatId, "I sit a while.");
    expect(turn.content).toBe("Five quiet minutes pass.");
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, turn.generation.messageId ?? ""))?.record !== undefined, "the first chat's record");

    // Lumiverse copies the chat with its metadata: the engine's choice comes along, LumiAH's own switch does not (it is kept per chat).
    const branch = rig.host.branch(chatId, turn.generation.messageId ?? "");
    await rig.host.settle();
    expect(await engineOf(rig, branch)).toBe("harness");
    const again = cast({ name: "author", is: offers("reply_write"), lines: [calls("time_pass", { minutes: 10 }), calls("commit"), release("Ten more minutes pass."), "Released."] });
    bed.script = again.script;
    const next = await say(bed, rig, branch, "I sit a while longer.");
    expect(next.content).toBe("Ten more minutes pass.");
    await bed.until(async () => recHarnessOf(await recordOn(rig, branch, next.generation.messageId ?? ""))?.record !== undefined, "the branch's record");
    // The branch's first reply was played by its author, and LumiAH is switched on for the branch itself.
    expect(again.left("author")).toBe(0);
    expect(await isOn(bed, branch)).toBe(true);
    noModelCalls(rig);
  });
});
