// A harness chat end to end: LumiAH's real backend and core, mounted in the engine as production
// mounts them (`backend/harness/mount.ts`), on the fake Lumiverse, with the agents' model scripted
// (`support/lumiah-bed.ts`). Lumiverse assembles the prompt and asks the interceptor; the author
// works there through the engine's tools, hands a person's turn to that person's own agent, commits
// and briefs; Lumiverse's own generation writes the reply; the engine records one record on it, with
// LumiAH's record of the turn inside.
//
// These tests go through LumiAH's own delegation, tool lists and settings, which a driver that
// plays LumiAH's part by hand (`harness-driver.ts`) never does: what an agent is actually offered
// is only seen here.
//
// On a harness chat the engine makes no model call: its helper throws if reached, and each such
// test ends by checking it never was.

import { afterEach, describe, expect, test } from "bun:test";
import { recHarnessOf, unplayedOf } from "../../src/backend/harness/record";
import { placeOfEntity } from "../../src/engine/scope";
import type { ModelRequest } from "lumi-ah/core";
import type { JsonObject } from "../../src/shared/json";
import { type Bed, cast, heard, offers, PageRefused, results, told, toolCall } from "../support/lumiah-bed";
import { plainMinds } from "../support/rig";
import { HOME } from "../support/tools";
import { cashOf, noModelCalls, OKORO, playOn, recordOn, stateOf } from "./harness-driver";
import { alderWorld, brief, builtIn, CASH, chatOn, engineOf, say, worldChat as newChat } from "./harness-e2e-kit";

const beds: Bed[] = [];
afterEach(() => {
  for (const bed of beds.splice(0)) bed.close();
});

/** A new world chat with the harness built in (`harness-e2e-kit.ts`), its bed closed when the test ends. */
async function worldChat(guarded = true) {
  const made = await newChat(guarded);
  beds.push(made.bed);
  return made;
}

const DECISION: JsonObject = { who: "Mara", monologue: "He is up early. I wonder why.", depiction: "Mara looks up from her cup.", intent: "Ask what he is doing today.", reactions: ["if asked about the rent, changes the subject"], mood: "curious" };
const MARA_TASK = "You are Mara this turn. The player just came into the kitchen. Decide what you do.";
const SCOUT_TASK = "Find out what Mara does now, by asking her own agent.";
const BRIEF = "Okoro knocks and comes in from the street. Mara looks up from her cup and asks what the player is doing today.";
const REPLY = 'A knock, and Okoro lets himself in. Mara looks up from her cup. "What are you up to today?"';
/** Mara's own agent: it holds only a mind's tools, so it offers no `delegate`. */
const isMara = (request: ModelRequest): boolean => told(MARA_TASK)(request) && !offers("delegate")(request);
const maraLines = [{ toolCalls: [toolCall("mind_view", { who: "Mara" })] }, { toolCalls: [toolCall("mind_decide", DECISION)] }, "Mara looks up from her cup and asks what the player is doing today."];

describe("a world chat in a Lumiverse with the harness built in", () => {
  test("plays on the harness from its first turn: the author works through the engine's tools and commits, Lumiverse writes the reply from its brief, and the reply holds one record", async () => {
    const { bed, rig, chatId } = await worldChat();
    // Nothing was chosen: a chat new to its world is the harness's, and LumiAH is switched on for it, to run built in.
    expect(await engineOf(rig, chatId)).toBe("harness");
    expect((await bed.page<{ chat: { on: boolean; place: string } }>("lah.chat.get", { chatId })).chat).toMatchObject({ on: true, place: "builtin" });
    const play = cast({ name: "author", is: offers("write_reply"), lines: [{ toolCalls: [toolCall("gm_move", { entity: "Okoro", to: HOME })] }, { toolCalls: [toolCall("commit", {})] }, brief(BRIEF)] });
    bed.script = play.script;

    const generation = await say(rig, chatId, "I come into the kitchen and put the kettle on.");

    // The author is the engine's, with the world's guidance, and it is offered the engine's tools beside LumiAH's own.
    const first = play.calls("author")[0];
    const offered = first?.tools?.map((t) => t.name) ?? [];
    expect(heard(first)).toContain("Port Alder");
    expect(offered).toEqual(expect.arrayContaining(["write_reply", "delegate", "job_start", "gm_move", "commit", "time_pass"]));
    // The world's lore is the engine's to read, under its secrets rule: LumiAH's lore tools give way to the engine's of the same name, and those the engine has none for are withdrawn. A person's own mind is never the author's.
    for (const gone of ["active_lore", "lore_related", "lore_about", "mind_view", "mind_decide"]) expect(offered).not.toContain(gone);
    expect(first?.tools?.find((t) => t.name === "lore_grep")?.description).toContain("its secret marker");
    // The author's commit landed its change before the reply.
    expect(JSON.parse(results(play.calls("author")[2]).at(-1) ?? "{}")).toMatchObject({ committed: { landed: [expect.anything()], refused: [] } });
    // Lumiverse's own generation is sent its own prompt with the brief put in.
    expect(bed.prompt(generation.id).filter((m) => m.text.includes(BRIEF))).toHaveLength(1);

    await rig.host.finish(generation, REPLY);
    const replyId = generation.messageId ?? "";
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, replyId))?.record !== undefined, "the turn's record on the reply");

    // One record on the reply: the engine's, naming the harness turn, with LumiAH's own record of it inside and where it ran.
    const harness = recHarnessOf(await recordOn(rig, chatId, replyId));
    expect(harness?.turns).toEqual([generation.id]);
    expect(harness?.record).toMatchObject({ generationId: generation.id, kind: "new", ran: { place: "builtin" } });
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).toBe(HOME);
    // LumiAH's Sessions page lists the turn, read from the ledger; LumiAH never wrote the message's own entry (the bed fails that write).
    const listed = await bed.page<{ turns: { turn: string; place?: string }[] }>("lah.turns.list", { chatId, cursor: null, limit: 10 });
    expect(listed.turns).toMatchObject([{ turn: generation.id, place: "builtin" }]);
    // The two keep their files apart in the one storage an extension has: every file of LumiAH's is under `harness/`, and none of its own names stands beside the engine's.
    const files = [...rig.host.files.keys()].map((key) => key.slice(rig.host.userId.length + 1));
    expect(files).toContain("harness/chats.json");
    expect(files.filter((path) => /^(chats|registry|core)\b/.test(path))).toEqual([]);
    noModelCalls(rig);
  });

  test("a person's own agent decides for them: started by the author it reads its mind and stages its decision, which the turn records", async () => {
    const { bed, rig, chatId } = await worldChat();
    const play = cast({ name: "mara", is: isMara, lines: maraLines }, { name: "author", is: offers("write_reply"), lines: [{ toolCalls: [toolCall("delegate", { agent: "character", task: MARA_TASK })] }, { toolCalls: [toolCall("commit", {})] }, brief(BRIEF)] });
    bed.script = play.script;

    const generation = await say(rig, chatId, "I come into the kitchen and put the kettle on.");

    // Mara's agent holds a mind's tools and nothing else, whoever starts it: the author holds none of them.
    expect(play.calls("mara")[0]?.tools?.map((t) => t.name)).toEqual(expect.arrayContaining(["mind_view", "mind_decide"]));
    expect(play.calls("mara")).toHaveLength(3);
    expect(results(play.calls("mara")[2]).join("\n")).toContain("Staged for this turn");
    expect(results(play.calls("author")[1]).join("\n")).toContain("asks what the player is doing today");
    await rig.host.finish(generation, REPLY);
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, generation.messageId ?? ""))?.record !== undefined, "the turn's record on the reply");
    expect(JSON.stringify(await recordOn(rig, chatId, generation.messageId ?? ""))).toContain("Ask what he is doing today.");
    noModelCalls(rig);
  });

  test("a person's own files are kept in LumiAH's workspace for the chat: written, listed and read back through the engine's tools in a real turn", async () => {
    const { bed, rig, chatId } = await worldChat();
    const NOW = "Rent is due Friday. Joss has not said a word about it.";
    const play = cast(
      { name: "mara", is: isMara, lines: [{ toolCalls: [toolCall("mind_file_write", { who: "Mara", file: "now.md", text: NOW })] }, { toolCalls: [toolCall("mind_files", { who: "Mara" })] }, { toolCalls: [toolCall("mind_file_read", { who: "Mara", file: "now.md" })] }, "Mara keeps her own counsel."] },
      { name: "author", is: offers("write_reply"), lines: [{ toolCalls: [toolCall("delegate", { agent: "character", task: MARA_TASK })] }, brief(BRIEF)] },
    );
    bed.script = play.script;

    const generation = await say(rig, chatId, "I come into the kitchen and put the kettle on.");

    // Each call was answered by the workspace: the write with the file's version, the list with the file, the read with its text.
    const [wrote, listed, read] = [1, 2, 3].map((call) => JSON.parse(results(play.calls("mara")[call]).at(-1) ?? "{}") as Record<string, unknown>);
    expect(wrote?.written).toMatchObject({ file: "now.md", size: NOW.length });
    expect(listed?.files).toMatchObject([{ file: "now.md", size: NOW.length }]);
    expect(read).toMatchObject({ file: "now.md", text: NOW });
    // It is LumiAH's own workspace that holds it, in the chat's area, under the person it is of.
    const files = await rig.rt.harness.files?.({ chatId, userId: rig.host.userId }).list("");
    expect(files?.filter((file) => file.path.endsWith("now.md")).map((file) => file.size)).toEqual([NOW.length]);
    await rig.host.finish(generation, REPLY);
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, generation.messageId ?? ""))?.record !== undefined, "the turn's record on the reply");
    noModelCalls(rig);
  });

  test("a character started by an agent that only reads may not write: its decision is refused with the reason, and nothing of it is recorded", async () => {
    const { bed, rig, chatId } = await worldChat();
    // A user's own agent, which the engine lets only read, and which may start others.
    const defs = await bed.page<{ agents: (JsonObject & { id: string })[] }>("lah.defs.get");
    const { source: _source, ...summarizer }: JsonObject = defs.agents.find((a) => a.id === "summarizer") ?? {};
    await bed.page("lah.agent.save", { agent: { ...summarizer, id: "scout", name: "Scout", description: "Asks people what they do.", instructions: "Ask the person's own agent, and say what it answers.", tools: ["delegate"] } });
    await bed.page("lah.settings.set", { set: [{ path: ["core", "delegation", "depth"], value: 2 }], reset: [] });
    const play = cast(
      { name: "mara", is: isMara, lines: maraLines },
      { name: "scout", is: (request) => told(SCOUT_TASK)(request) && !offers("write_reply")(request), lines: [{ toolCalls: [toolCall("delegate", { agent: "character", task: MARA_TASK })] }, "Mara would not say."] },
      { name: "author", is: offers("write_reply"), lines: [{ toolCalls: [toolCall("delegate", { agent: "scout", task: SCOUT_TASK })] }, brief("Mara says nothing.")] },
    );
    bed.script = play.script;

    const generation = await say(rig, chatId, "I come into the kitchen and put the kettle on.");

    // The character's own definition would let it record its decision; the agent over it only reads, so it may not.
    const refused = results(play.calls("mara")[2]).join("\n");
    expect(refused).not.toContain("staged");
    expect(refused.trim()).not.toBe("");
    await rig.host.finish(generation, "Mara says nothing.");
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, generation.messageId ?? ""))?.record !== undefined, "the turn's record on the reply");
    expect(JSON.stringify(await recordOn(rig, chatId, generation.messageId ?? ""))).not.toContain("Ask what he is doing today.");
    noModelCalls(rig);
  });

  test("a change set to ask first waits on the reply's card while the rest of the commit lands, and Apply lands it after the turn", async () => {
    const { bed, rig, chatId } = await worldChat();
    const play = cast({ name: "author", is: offers("write_reply"), lines: [{ toolCalls: [toolCall("gm_move", { entity: "Okoro", to: HOME }), toolCall("gm_adjust_money", { account: CASH, cents: -2000 })] }, { toolCalls: [toolCall("commit", {})] }, brief("The player pays Mara back the twenty.")] });
    bed.script = play.script;

    const generation = await say(rig, chatId, "I pay Mara back the twenty I owe her.");
    // Money adjustments ask first as shipped: the move landed with the commit, the payment went to the card.
    const { committed } = JSON.parse(results(play.calls("author")[2]).at(-1) ?? "{}") as { committed: { landed: unknown[]; review: unknown[] } };
    expect([committed.landed.length, committed.review.length]).toEqual([1, 1]);
    await rig.host.finish(generation, "Mara counts the notes twice and pockets them.");
    const replyId = generation.messageId ?? "";
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, replyId))?.record !== undefined, "the turn's record on the reply");

    const opening = Number((await stateOf(rig, chatId)).entities[CASH]?.fields.opening);
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).toBe(HOME);
    expect(await cashOf(rig, chatId, CASH)).not.toBe(opening - 2000);
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as { turn: string; items: { status: string }[] }[];
    expect(cards.map((c) => [c.turn, c.items.map((i) => i.status)])).toEqual([[`${replyId}:0`, ["open"]]]);
    rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: `${replyId}:0` }));
    expect(await cashOf(rig, chatId, CASH)).toBe(opening - 2000);
    noModelCalls(rig);
  });

  test("when LumiAH's turn fails, the player still gets their reply, written by Lumiverse from its own prompt with the engine's sections in it; the reply is marked as one no turn was played for, in LumiAH's words, and the next turn's author is told", async () => {
    const { bed, rig, chatId } = await worldChat();
    // The author moved someone and committed, then its model failed: it never briefed the writer.
    const failing = cast({ name: "author", is: offers("write_reply"), lines: [{ toolCalls: [toolCall("gm_move", { entity: "Okoro", to: HOME })] }, { toolCalls: [toolCall("commit", {})] }, { error: "The provider answered 503." }] });
    bed.script = (request) => failing.script(request).catch(() => ({ error: "The provider answered 503." }));

    const generation = await say(rig, chatId, "I come into the kitchen and put the kettle on.");

    // The prompt goes on as Lumiverse assembled it: every entry of the engine's book it placed, and no brief.
    const sent = bed.prompt(generation.id).map((m) => m.text);
    const sections = rig.host.assembled.filter((e) => e.position !== 8 && e.content.trim() !== "").map((e) => e.content);
    expect(sections.length).toBeGreaterThan(0);
    expect(sent).toEqual(expect.arrayContaining(sections));
    expect(sent.join("\n")).not.toContain("brief");
    await rig.host.finish(generation, "The kettle ticks as it warms.");
    const replyId = generation.messageId ?? "";
    expect(rig.host.head(chatId)?.swipes[0]).toBe("The kettle ticks as it warms.");

    // Nothing of the turn stands, what its author had committed included, and the reply says no turn was played for it: at once in the engine's words, then in LumiAH's own, which say what happened and what to do.
    await bed.until(async () => (unplayedOf(await recordOn(rig, chatId, replyId))?.why ?? "").includes("503"), "LumiAH's reason on the reply's mark");
    const mark = unplayedOf(await recordOn(rig, chatId, replyId));
    expect(mark).toMatchObject({ added: false });
    expect(mark?.why).toContain("Lumiverse sent the prompt as it was");
    expect(recHarnessOf(await recordOn(rig, chatId, replyId))).toBeNull();
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).not.toBe(HOME);
    // LumiAH's own Sessions page lists the reply as one it had no part in, read from the ledger.
    const listed = await bed.page<{ turns: { turn: string; noPart?: { why: string } }[] }>("lah.turns.list", { chatId, cursor: null, limit: 10 });
    expect(listed.turns).toMatchObject([{ turn: generation.id, noPart: { why: "failed" } }]);

    // The next turn's author reads that first, and plays on.
    const play = cast({ name: "author", is: offers("write_reply"), lines: [{ toolCalls: [toolCall("gm_move", { entity: "Okoro", to: HOME })] }, { toolCalls: [toolCall("commit", {})] }, brief(BRIEF)] });
    bed.script = play.script;
    const next = await say(rig, chatId, "I take two cups down.");
    expect(heard(play.calls("author")[0])).toContain("Lumiverse sent the prompt as it was");
    await rig.host.finish(next, REPLY);
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, next.messageId ?? ""))?.record !== undefined, "the next turn's record");
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).toBe(HOME);
    noModelCalls(rig);
  });
});

describe("what the harness leaves alone", () => {
  test("a chat switched to its classic steps is played by the engine as before: LumiAH is switched off for it and has no part in its turn", async () => {
    const { bed, rig, chatId } = await worldChat(false);
    // Its classic steps call the engine's own helper model, minds among them: answered plainly here.
    rig.host.quietReply = plainMinds;
    await playOn(rig, chatId, "classic");
    expect((await bed.page<{ chat: { on: boolean } }>("lah.chat.get", { chatId })).chat.on).toBe(false);

    await rig.turn(chatId, "I wait for the kettle.", "The kettle ticks as it warms.");

    expect(bed.calls).toEqual([]);
    const reply = rig.host.head(chatId);
    expect(reply?.swipes[reply.swipeId]).toBe("The kettle ticks as it warms.");
    const rec = await recordOn(rig, chatId, reply?.id ?? "");
    expect(rec).not.toBeNull();
    expect([recHarnessOf(rec), unplayedOf(rec)]).toEqual([null, null]);
    // The agents engine is the engine's own too: choosing it leaves LumiAH off, and the harness comes back by the same switch.
    await playOn(rig, chatId, "agents");
    expect((await bed.page<{ chat: { on: boolean } }>("lah.chat.get", { chatId })).chat.on).toBe(false);
    await playOn(rig, chatId, "harness");
    expect((await bed.page<{ chat: { on: boolean } }>("lah.chat.get", { chatId })).chat.on).toBe(true);
  });

  test("LumiAH's Agents and Tools pages show the engine's own agents with the engine's tools, and the author's definition can be changed and saved there", async () => {
    const { bed } = builtIn();
    beds.push(bed);
    type Defs = { agents: (JsonObject & { id: string; source?: string; tools?: string[] })[]; tools: { name: string; family: string; tier: string }[] };
    const defs = await bed.page<Defs>("lah.defs.get");
    // About no chat, as the pages ask: the engine's tools are there to see and tick, each with its family and tier.
    const tools = new Map(defs.tools.map((tool) => [tool.name, tool]));
    for (const name of ["gm_move", "commit", "time_pass", "mind_view", "lore_grep"]) expect([name, tools.has(name)]).toEqual([name, true]);
    expect(tools.get("mind_view")).toMatchObject({ family: "mind", tier: "read" });
    expect(defs.agents.map((agent) => agent.id)).toEqual(expect.arrayContaining(["author", "character", "game_master", "knowledge", "chronicler"]));
    // The author's definition, edited on the page and saved: it is the user's from now on, with the tools it had.
    const { source: _source, ...author }: JsonObject = defs.agents.find((agent) => agent.id === "author") ?? {};
    const saved = await bed.page<Defs>("lah.agent.save", { agent: { ...author, instructions: `${String(author.instructions)}\n\nKeep every brief short.` } });
    const mine = saved.agents.find((agent) => agent.id === "author");
    expect(mine?.source).toBe("user");
    expect(String(mine?.instructions)).toContain("Keep every brief short.");
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
    // Without a permission LumiAH can't do without, the harness can't be chosen, and the Engine page is told why and what to do.
    await playOn(rig, chatId, "classic");
    bed.permit("generation", false);
    const blocked = rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engines: true })).harnessBlocked;
    expect(String(blocked)).toContain("generation");
    expect((await rig.send({ type: "lre.chat.knowledge", chatId, engine: "harness" })).type).toBe("lre.error");
    expect(await engineOf(rig, chatId)).toBe("classic");
  });

  test("where the harness can't play yet, a new world chat plays its classic steps and the Engine page says why; once it can, one press moves the chat", async () => {
    const { bed, rig } = builtIn();
    beds.push(bed);
    bed.permit("generation", false);
    const worldId = await alderWorld(rig);
    const chatId = await chatOn(rig, worldId);
    // Nothing failed and nothing was asked of the player: the chat is the engine's own to play.
    expect(await engineOf(rig, chatId)).toBe("classic");
    expect(String(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engines: true })).harnessBlocked)).toContain('The permission "generation" isn\'t granted');
    bed.permit("generation", true);
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engines: true })).harnessBlocked).toBeUndefined();
    await playOn(rig, chatId, "harness");
    expect((await bed.page<{ chat: { on: boolean } }>("lah.chat.get", { chatId })).chat.on).toBe(true);
  });

  test("a Branch of a harness chat plays on the harness from its first turn, with nothing to switch", async () => {
    const { bed, rig, chatId } = await worldChat();
    const first = cast({ name: "author", is: offers("write_reply"), lines: [{ toolCalls: [toolCall("time_pass", { minutes: 5 })] }, { toolCalls: [toolCall("commit", {})] }, brief("Five quiet minutes pass.")] });
    bed.script = first.script;
    const turn = await say(rig, chatId, "I sit a while.");
    await rig.host.finish(turn, "Five quiet minutes pass.");
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, turn.messageId ?? ""))?.record !== undefined, "the first chat's record");

    // Lumiverse copies the chat with its metadata: the engine's choice comes along, LumiAH's own switch does not (it is kept per chat).
    const branch = rig.host.branch(chatId, turn.messageId ?? "");
    await rig.host.settle();
    expect(await engineOf(rig, branch)).toBe("harness");
    const again = cast({ name: "author", is: offers("write_reply"), lines: [{ toolCalls: [toolCall("time_pass", { minutes: 10 })] }, { toolCalls: [toolCall("commit", {})] }, brief("Ten more minutes pass.")] });
    bed.script = again.script;
    const next = await say(rig, branch, "I sit a while longer.");
    await rig.host.finish(next, "Ten more minutes pass.");
    await bed.until(async () => recHarnessOf(await recordOn(rig, branch, next.messageId ?? ""))?.record !== undefined, "the branch's record");
    // The branch's first reply was played by its author, and LumiAH is switched on for the branch itself.
    expect(again.left("author")).toBe(0);
    expect((await bed.page<{ chat: { on: boolean } }>("lah.chat.get", { chatId: branch })).chat.on).toBe(true);
    noModelCalls(rig);
  });
});
