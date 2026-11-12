// LumiAH's two asks of the engine as every run starts: its agents' definitions and its claim on the
// chat. LumiAH waits for each no longer than its Wait for the extension, and a reply whose lead isn't
// there isn't started. So the definitions name the agents at once, on the shipped texts where the
// engine's settings can't be read, and wait for what only adds to them (the chat's preset, the
// author's opening read through LumiAH's workspace) no longer than half of that wait; the claim,
// which LumiAH's Agents page asks too, outside any run, waits for no turn there, reads the chat's
// world within half of that wait, and changes nothing a run is told, and it never fails: a chat on
// the harness always gets one that names the author. A reply the engine can't play is stopped before
// any agent runs. With LumiAH's real backend mounted (`support/lumiah-bed.ts`), its runtime linked
// where a reply is played (`support/runtime-bed.ts`), and the driver in the runtime's place where
// only the engine is asked.

import { afterEach, describe, expect, test } from "bun:test";
import { harnessDefinitions } from "../../src/backend/harness/definitions";
import { recHarnessOf } from "../../src/backend/harness/record";
import { renderPrompt } from "../../src/backend/prompts";
import { HARNESS_AGENT, HARNESS_TEXT } from "../../src/shared/harness-texts";
import { MINDS_NOTE } from "../../src/shared/harness-texts-minds";
import { type Bed, cast, lumiahBed, offers } from "../support/lumiah-bed";
import { Rig } from "../support/rig";
import { claimOf, harnessChat, noModelCalls, playOn, recordOn, Run, STORY_WITHOUT_CLAIM } from "./harness-driver";
import { alderWorld, calls, chatOn, release, say, worldChat } from "./harness-e2e-kit";

const opened: { close(): void }[] = [];
afterEach(() => {
  for (const one of opened.splice(0)) one.close();
});

/** Where the engine shows LumiAH's Settings, as LumiAH's words name a wait there. */
const SETTINGS_AT = "LumiRPEngine's Harness tab → System → Settings";

/** LumiAH's Wait for the extension, set as a player sets it on LumiAH's Timeouts page. */
const lumiahWaits = (bed: Bed, ms: number): Promise<unknown> => bed.page("lah.settings.set", { set: [{ path: ["core", "extension", "waitMs"], value: ms }], reset: [] });

/**
 * The first `ms` of a promise: its value, or "late". A real wait on purpose: what is proved is that
 * an answer comes inside LumiAH's own wait, which is real time in LumiAH's core.
 */
const inTime = <T>(answer: Promise<T>, ms: number): Promise<T | "late"> => Promise.race([answer, Bun.sleep(ms).then(() => "late" as const)]);

/** The line the claim's guidance opens with for what wasn't read. */
const unread = (why: string): string => renderPrompt(HARNESS_TEXT.unread, {}, { why });

describe("the engine's definitions, asked as a run starts", () => {
  test("with every read of the chat's workspace held, they are answered within LumiAH's wait with the author in them, and the author is told its opening wasn't read in time", async () => {
    const rig = new Rig({ shipped: true });
    const bed = lumiahBed(rig);
    opened.push(bed);
    const chatId = await chatOn(rig, await alderWorld(rig));
    const userId = rig.host.userId;
    await lumiahWaits(bed, 600);
    // A runtime that answers none of the workspace's reads while the run starts: the author's opening reads where the story's preparation stands there.
    const mounted = rig.rt.harness.files;
    const definitions = rig.rt.harness.extension.definitions;
    if (mounted === null || definitions === undefined) throw new Error("the mount gave the engine no workspace, or the engine gives no definitions");
    const held = Promise.withResolvers<void>();
    rig.rt.harness.files = (at) => ({
      ...mounted(at),
      read: async () => {
        await held.promise;
        return null;
      },
      list: async () => {
        await held.promise;
        return [];
      },
    });
    const answered = await inTime(definitions({ userId, chatId }), 600);
    held.resolve();
    if (answered === "late") throw new Error("the definitions weren't answered within LumiAH's wait");
    const author = answered.agents?.find((agent) => agent.id === HARNESS_AGENT.author);
    expect(author?.instructions).toContain(renderPrompt(HARNESS_TEXT.openingLate, {}, {}));
    // Only what was late is left out: the chat's preset was read in time.
    expect(author?.instructions).not.toContain(renderPrompt(HARNESS_TEXT.presetLate, {}, {}));
    // Waited for half of LumiAH's own wait, and the log says what was left out.
    expect(rig.host.logs.filter((line) => line.includes("the author's opening") && line.includes("wasn't read within 300 ms"))).toHaveLength(1);
    noModelCalls(rig);
  });

  test("with the engine's settings unreadable, they still name the agents, on the shipped texts, and the log says why", async () => {
    const { rig, chatId } = await harnessChat();
    const definitions = rig.rt.harness.extension.definitions;
    if (definitions === undefined) throw new Error("the engine gives LumiAH no definitions");
    const settings = rig.rt.settings;
    const get = settings.get.bind(settings);
    settings.get = () => Promise.reject(new Error("the settings file is unreadable"));
    const answered = await definitions({ userId: rig.host.userId, chatId }).finally(() => {
      settings.get = get;
    });
    const shipped = harnessDefinitions({}).agents.find((agent) => agent.id === HARNESS_AGENT.author)?.instructions ?? "";
    expect(shipped).not.toBe("");
    expect(answered.agents?.find((agent) => agent.id === HARNESS_AGENT.author)?.instructions.startsWith(shipped)).toBe(true);
    expect(rig.host.logs.filter((line) => line.includes("the settings file is unreadable"))).not.toEqual([]);
    noModelCalls(rig);
  });
});

describe("the engine's claim on a chat", () => {
  test("LumiAH's Agents page asks it while the turn before is still being recorded: it is answered at once, and names the author", async () => {
    const rig = new Rig({ shipped: true });
    const bed = lumiahBed(rig);
    opened.push(bed);
    const chatId = await chatOn(rig, await alderWorld(rig));
    // Long waits, so an ask that waited for the turn before would show.
    await lumiahWaits(bed, 60_000);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { harness: { commitWaitMs: 30_000 } } } }));
    // The turn before, still being written on the chat's queue.
    const commit = Promise.withResolvers<void>();
    const done = rig.rt.ledger.with(chatId, rig.host.userId, () => commit.promise);
    for (let i = 0; i < 1000 && !rig.rt.ledger.queued(chatId); i++) await Promise.resolve();
    expect(rig.rt.ledger.queued(chatId)).toBe(true);
    const lead = await inTime(bed.page<{ lead: unknown }>("lah.chat.lead.get", { chatId }), 2_000);
    commit.resolve();
    await done;
    expect(lead).toEqual({ lead: { by: "LumiRPEngine", lead: HARNESS_AGENT.author, released: true } });
    noModelCalls(rig);
  });

  test("asked by a page between a run's own claim and its start, it changes nothing that run is told: whether the player directs the story is the run's own word", async () => {
    const { rig, chatId } = await harnessChat();
    const userId = rig.host.userId;
    const asPlayer = { id: "player-mind", role: HARNESS_AGENT.character, as: "player" };
    const sovereign = async (sovereignHand: "on" | "off"): Promise<void> => void rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { harness: { sovereignHand } } } }));
    /** A reply's run: its own claim, then what happens before it begins, then its start with its own word on the story. */
    const turn = async (story: typeof STORY_WITHOUT_CLAIM, between: () => Promise<void>): Promise<Run> => {
      rig.host.sendUser(chatId, "I look out at the harbor.");
      await rig.host.settle();
      const generation = await rig.host.begin(chatId, { type: "normal" });
      await claimOf(rig, chatId);
      await between();
      await rig.rt.harness.extension.runBegan?.({ userId, chatId, turn: generation.id, kind: "new", story });
      return new Run(rig, chatId, generation.id, "new", generation);
    };

    // The run was claimed with Sovereign Hand off; the player switches it on, and the Agents page asks again before the run begins.
    await sovereign("off");
    const plain = await turn(STORY_WITHOUT_CLAIM, async () => {
      await sovereign("on");
      expect((await claimOf(rig, chatId))?.story).toEqual({ from: "replies", newest: "directive" });
    });
    // That run isn't directed: the player's character has no mind of its own in it.
    expect(await plain.refusal(asPlayer, "mind_fight")).toBe(renderPrompt(MINDS_NOTE.playerNoMind, {}, { name: "Jordan Ellis" }));
    await plain.finish("The harbor is grey.");

    // And the other way: a run whose own word is that the replies alone are the story is directed, whatever a page was told meanwhile.
    const directed = await turn({ ...STORY_WITHOUT_CLAIM, from: "replies" }, async () => {
      await sovereign("off");
      expect((await claimOf(rig, chatId))?.story).toEqual({ from: "everyone", newest: "directive" });
    });
    expect(await directed.refusal(asPlayer, "mind_fight")).toBe(renderPrompt(MINDS_NOTE.playerFights, {}, {}));
    noModelCalls(rig);
  });

  test("it never fails: a chat on the harness whose world or settings can't be read still gets a claim that names the author, its guidance saying what wasn't read; a chat on another engine gets none", async () => {
    const { rig, chatId } = await harnessChat();
    const guidance = async (): Promise<{ lead: string | undefined; text: string }> => {
      const claim = await claimOf(rig, chatId);
      return { lead: claim?.mainAgent, text: claim?.guidance && "text" in claim.guidance ? claim.guidance.text : "" };
    };
    const ledger = rig.rt.ledger;
    const core = ledger.core.bind(ledger);
    // Reading the chat's ledger fails.
    ledger.core = () => Promise.reject(new Error("the journal couldn't be opened"));
    expect(await guidance()).toEqual({ lead: HARNESS_AGENT.author, text: unread("This chat's world couldn't be read (the journal couldn't be opened)") });
    // The chat's world isn't loaded.
    ledger.core = () => Promise.resolve(null);
    expect(await guidance()).toEqual({ lead: HARNESS_AGENT.author, text: unread("This chat's world wasn't loaded") });
    ledger.core = core;
    // The engine's settings can't be read: the shipped ones stand in, and the guidance says so first.
    const settings = rig.rt.settings;
    const get = settings.get.bind(settings);
    settings.get = () => Promise.reject(new Error("the settings file is unreadable"));
    const shipped = await guidance();
    settings.get = get;
    expect(shipped.lead).toBe(HARNESS_AGENT.author);
    expect(shipped.text.startsWith(`${unread("LumiRPEngine's settings couldn't be read (the settings file is unreadable)")}\n\n`)).toBe(true);
    // Read whole again: nothing is said missing.
    expect((await guidance()).text).not.toContain("couldn't be read");
    // On another engine the chat isn't the harness's.
    await playOn(rig, chatId, "classic");
    expect(await claimOf(rig, chatId)).toBeNull();
    noModelCalls(rig);
  });

  test("its world read late, it is answered within half of LumiAH's wait all the same: it names the author, and its guidance opens by saying the world wasn't read in time", async () => {
    const { rig, chatId } = await harnessChat();
    // LumiAH's Wait for the extension, as the mount reads it for the user.
    rig.rt.harness.extensionWait = async () => 600;
    const guidance = async (): Promise<{ lead: string | undefined; text: string } | "late"> => {
      const claim = await inTime(claimOf(rig, chatId), 600);
      return claim === "late" ? claim : { lead: claim?.mainAgent, text: claim?.guidance && "text" in claim.guidance ? claim.guidance.text : "" };
    };
    // The chat's messages never come: as a chat that isn't loaded, whose whole message list is read through Lumiverse, can keep them.
    const chats = rig.rt.host.chats;
    const messages = chats.messages.bind(chats);
    chats.messages = () => new Promise(() => undefined);
    const held = await guidance();
    chats.messages = messages;
    if (held === "late") throw new Error("the claim wasn't answered within LumiAH's wait");
    const late = renderPrompt(HARNESS_TEXT.worldLate, {}, {});
    expect(held.lead).toBe(HARNESS_AGENT.author);
    expect(held.text.startsWith(late)).toBe(true);
    expect(rig.host.logs.filter((line) => line.includes("world") && line.includes("wasn't read within 300 ms"))).toHaveLength(1);
    // Read in time, the world's own guidance is there, and nothing is said to be late.
    const read = await guidance();
    if (read === "late") throw new Error("the claim wasn't answered within LumiAH's wait");
    expect(read.text).not.toContain(late);
    expect(read.text).toContain("Jordan Ellis");
    noModelCalls(rig);
  });
});

describe("a reply the engine can't play", () => {
  test("whose chat's world can't be read is stopped before any agent runs, in words that say what to do; readable again, the reply plays", async () => {
    const { bed, rig, chatId } = await worldChat();
    opened.push(bed);
    const ledger = rig.rt.ledger;
    const core = ledger.core.bind(ledger);
    ledger.core = () => Promise.resolve(null);
    const stopped = await say(bed, rig, chatId, "I wait by the window.");
    ledger.core = core;
    expect([stopped.generation.halted, stopped.content]).toEqual(["cancelled", ""]);
    expect((await rig.rt.chips.list(chatId, rig.host.userId)).find((chip) => chip.kind === "engine_failed")?.detail).toContain("This chat's world isn't loaded yet, so this reply wasn't played. Try again in a moment.");
    expect(bed.calls).toEqual([]);

    bed.script = cast({ name: "author", is: offers("reply_write"), lines: [release("The street below is quiet."), "Released."] }).script;
    expect((await bed.reply(chatId)).content).toBe("The street below is quiet.");
    noModelCalls(rig);
  });
});

describe("LumiAH's rule that a reply's lead is there, from the engine's side", () => {
  test("its agents given too late: no model is called and the reply isn't started, in LumiAH's words naming the author, the wait and where it is changed; given in time, the next reply is the author's", async () => {
    const { bed, rig, chatId } = await worldChat();
    opened.push(bed);
    await lumiahWaits(bed, 500);
    const extension = rig.rt.harness.extension;
    const definitions = extension.definitions;
    if (definitions === undefined) throw new Error("the engine gives LumiAH no definitions");
    const held = Promise.withResolvers<void>();
    extension.definitions = async (ask) => {
      await held.promise;
      return definitions(ask);
    };
    const play = cast({ name: "author", is: offers("reply_write"), lines: [calls("time_pass", { minutes: 5 }), calls("commit"), release("Five quiet minutes pass."), "Released."] });
    bed.script = play.script;
    const refused = await say(bed, rig, chatId, "I sit a while.");
    held.resolve();
    extension.definitions = definitions;
    expect(bed.calls).toEqual([]);
    expect(refused.content).toBe("");
    expect(refused.error?.message).toContain(`LumiRPEngine names ${HARNESS_AGENT.author} to lead this chat's replies, and it isn't in this run: LumiRPEngine didn't give its agents within 500 ms, so this reply wasn't started. Try again; if it keeps happening, give LumiRPEngine longer with Wait for the extension (${SETTINGS_AT} → Timeouts → Tools and approvals)`);
    // The run ended without ever beginning: the engine kept nothing of it and logged nothing wrong of its own, and the reply has no turn's record.
    await rig.host.settle();
    expect(rig.host.logs.filter((line) => line.startsWith("error:"))).toEqual([]);
    const failed = refused.generation.messageId;
    if (failed) expect(recHarnessOf(await recordOn(rig, chatId, failed))?.turns ?? []).toEqual([]);

    // The next reply, with the agents given in time, is the author's, and its tools play in a turn of its own.
    const played = await say(bed, rig, chatId, "I sit a while longer.");
    expect([played.error, played.content]).toEqual([null, "Five quiet minutes pass."]);
    expect(play.left("author")).toBe(0);
    expect(recHarnessOf(await recordOn(rig, chatId, played.generation.messageId ?? ""))?.turns).toEqual([played.generation.id]);
    noModelCalls(rig);
  });
});
