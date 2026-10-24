// Settings → Minds → What a mind reads (DESIGN §24.5–24.6): each source a mind may read is the
// user's to switch on or off and to limit, "no limit" allowed. Off, a source is not in the context;
// on, it comes within its own limit, a text cut at a word, lines kept whole, lore cut where it runs
// out, the recent chat within its messages and its tokens; and each control reaches the settings
// store without touching the Model use preset.

import { describe, expect, test } from "bun:test";
import { sectionTokens } from "../../src/backend/book";
import { mindContext, type MindContextReport } from "../../src/backend/minds-context";
import { MEMORY_FIELDS, memoryOverridePatch, mindsReadPatch } from "../../src/frontend/settings/minds-patch";
import type { JsonObject } from "../../src/shared/json";
import type { ModelUseSettings } from "../../src/shared/settings";
import type { MindMoment, MindSource, MindsReads, MindsSettings } from "../../src/shared/minds";
import { DEFAULT_MIND_READS, effectiveMemory, MIND_SOURCES } from "../../src/shared/minds";
import { pinsFor, worldPinText } from "../../src/engine/lore-pins";
import { placeOfEntity } from "../../src/engine/scope";
import { ASK, DANNY, fakeModels, lastFor, stateOf, storyChat, alderChat } from "../support/mind-chat";
import { Rig } from "../support/rig";

/** What shows each source is in Danny's context on the story's second turn. */
const MARKS: Record<MindSource, string> = {
  pinned: "PIN-MARK",
  activated: "ACTIVE-MARK",
  reply: "The story so far ended: SECOND-REPLY-MARK",
  message: `says or does: ${ASK}`,
  history: "## Recent chat",
  summary: "SUMMARY-MARK",
  memory: "NOTE-MARK",
  thoughts: "THOUGHT-MARK",
  recall: "## Turns you were there for",
  routine: "ROUTINE-MARK",
  plans: "PLAN-MARK",
  life: "COMMIT-MARK",
};

describe("each source of what a mind reads, on or off, within its own limit", () => {
  test("a source is in a mind's context only while it's on, and within its limit", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const { chatId } = await storyChat(rig);
    // Their day took Danny back to work after the reply; he's with the player character again to hear the turn.
    const here = placeOfEntity((await stateOf(rig, chatId)).state, "pov");
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: DANNY, to: here }] }));
    const { state, world } = await stateOf(rig, chatId);
    const messages = await rig.host.chats.messages(chatId, rig.host.userId);
    const settings = await rig.rt.settings.get(rig.host.userId);
    const pinned = pinsFor(world, placeOfEntity(state, DANNY), DANNY).flatMap((r) => worldPinText(world, r) ?? []);
    const moment: MindMoment = { kind: "turn", at: state.clock, reason: "", user: ASK, reply: messages.findLast((m) => !m.isUser)?.content ?? "" };
    const every = Object.fromEntries(MIND_SOURCES.map((s) => [s, s === "recall" ? { on: true } : s === "history" ? { on: true, messages: "none", tokens: "none" } : { on: true, tokens: "none" }])) as unknown as MindsReads;
    const contextWith = (reads: MindsReads, report?: MindContextReport): string => mindContext({ reg: rig.rt.registry, world, state, who: DANNY, memory: effectiveMemory(world, settings.minds), messages, hideJson: true, moment, reads, pinned, history: messages }, report);
    for (const source of MIND_SOURCES) {
      expect({ source, on: contextWith(every).includes(MARKS[source]) }).toEqual({ source, on: true });
      expect({ source, off: contextWith({ ...every, [source]: { ...every[source], on: false } }).includes(MARKS[source]) }).toEqual({ source, off: false });
    }
    // A text is cut at a word to its limit, at 3.2 characters a token: a reply keeps its end.
    const cut = (source: "reply" | "message" | "summary" | "thoughts", tokens: number, line: RegExp): string => line.exec(contextWith({ ...every, [source]: { on: true, tokens } }))?.[1] ?? "";
    expect(cut("reply", 4, /The story so far ended: (.*)\n/)).toBe("…window.");
    expect(cut("message", 5, /says or does: (.*)$/m)).toBe("I ask Danny…");
    expect(cut("summary", 4, /## Your story so far\n(.*)$/m)).toBe("SUMMARY-MARK…");
    expect(cut("thoughts", 4, /## Your last thoughts \([^)]*\)\n(.*)$/m)).toBe("THOUGHT-MARK…");
    // Lines are kept whole within the limit.
    for (const title of ["What you remember, and what you saw", "Your own life"]) {
      const source = title === "Your own life" ? "life" : "memory";
      const linesOf = (reads: MindsReads): string[] => new RegExp(`## ${title}\\n((?:- .*\\n?)+)`).exec(contextWith(reads))?.[1]?.trim().split("\n") ?? [];
      const whole = linesOf(every);
      expect(whole.length).toBeGreaterThan(1);
      const limit = sectionTokens(whole[0] ?? "");
      expect(linesOf({ ...every, [source]: { on: true, tokens: limit } })).toEqual([whole[0] ?? ""]);
    }
    // Lore is given whole until its limit runs out; an entry not even its title and a few words of fit is left out, and the report lists it so.
    for (const source of ["pinned", "activated"] as const) {
      const report: MindContextReport = { pinned: [], activated: [] };
      const context = contextWith({ ...every, [source]: { on: true, tokens: 10 } }, report);
      expect({ source, given: context.includes(MARKS[source]), listed: report[source].length > 0, left: report[source].every((g) => g.left === true && g.tokens === 0) }).toEqual({ source, given: false, listed: true, left: true });
    }
  });

  /** The lines of the Recent chat block in a mind's context: each message, oldest first. */
  const recentLines = (context: string): string[] => (/## Recent chat[^\n]*\n([\s\S]*?)(?=\n\n## |$)/.exec(context)?.[1] ?? "").split("\n").filter((l) => l.startsWith("Player: ") || l.startsWith("Story: "));
  const PAD = "the harbor wind keeps the gulls low over the water all morning ".repeat(2).trim();

  test("Recent chat: off by default a mind reads none of it; on, the latest messages before the turn as the player sees them, oldest first, at most its messages limit, and the trace counts them", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    const chatId = await alderChat(rig, async () => undefined);
    for (let k = 1; k <= 4; k++) await rig.turn(chatId, `U${k}-MARK ${PAD}`, `R${k}-MARK ${PAD} <json>{"hidden":"JSON-MARK"}</json>`);
    expect(lastFor(seen.minds, "Danny Okafor")).not.toContain("## Recent chat");
    // The latest reply off, so Recent chat is the only place it can come from.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { reads: { history: { on: true, messages: 3 }, reply: { on: false } } } } }));
    await rig.turn(chatId, `U5-MARK ${PAD}`, `R5-MARK ${PAD}`);
    const danny = lastFor(seen.minds, "Danny Okafor");
    expect(recentLines(danny)).toEqual([`Story: R3-MARK ${PAD}`, `Player: U4-MARK ${PAD}`, `Story: R4-MARK ${PAD}`]);
    expect(danny).not.toContain("JSON-MARK");
    const trace = rig.rt.inspectorRecords(chatId)?.at(-1)?.minds?.find((t) => t.who === "Danny Okafor" && t.purpose === "mind");
    expect(trace?.history).toBe(3);
  });

  test("Recent chat with no limit on messages stops at its tokens, the oldest it reaches keeping its end", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    const chatId = await alderChat(rig, async () => undefined);
    for (let k = 1; k <= 4; k++) await rig.turn(chatId, `U${k}-MARK ${PAD}`, `R${k}-MARK ${PAD}`);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { reads: { history: { on: true, messages: "none", tokens: 60 }, reply: { on: false } } } } }));
    await rig.turn(chatId, `U5-MARK ${PAD}`, `R5-MARK ${PAD}`);
    const lines = recentLines(lastFor(seen.minds, "Danny Okafor"));
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe(`Story: R4-MARK ${PAD}`);
    expect(lines[0]).toMatch(/^Player: …/);
    expect(lines.join("\n")).not.toMatch(/U[1-4]-MARK|R[1-3]-MARK/);
  });

  test("with The latest reply on, Recent chat leaves out that reply, which the mind reads as how the story so far ended, and gives the messages before it", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    const chatId = await alderChat(rig, async () => undefined);
    for (let k = 1; k <= 4; k++) await rig.turn(chatId, `U${k}-MARK ${PAD}`, `R${k}-MARK ${PAD}`);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { reads: { history: { on: true, messages: 3 } } } } }));
    await rig.turn(chatId, `U5-MARK ${PAD}`, `R5-MARK ${PAD}`);
    const danny = lastFor(seen.minds, "Danny Okafor");
    expect(danny).toContain(`The story so far ended: R4-MARK ${PAD}`);
    expect(recentLines(danny)).toEqual([`Player: U3-MARK ${PAD}`, `Story: R3-MARK ${PAD}`, `Player: U4-MARK ${PAD}`]);
  });

  test("Settings → Minds saves each source's switch and limit, recall's as its memory override with no limit allowed, and none of it touches the preset", async () => {
    const rig = new Rig();
    const set = async (patch: JsonObject | null): Promise<{ minds: MindsSettings; preset: string }> => {
      if (!patch) throw new Error("no patch");
      const s = rig.body(await rig.send({ type: "lre.settings.set", patch })).settings as { minds: MindsSettings; modelUse: { preset: string } };
      return { minds: s.minds, preset: s.modelUse.preset };
    };
    expect((await set({})).minds.reads).toEqual(DEFAULT_MIND_READS);
    let s = await set(mindsReadPatch("life", { on: true, tokens: 900 }));
    expect([s.minds.reads.life, s.preset]).toEqual([{ on: true, tokens: 900 }, "standard"]);
    s = await set(mindsReadPatch("activated", { tokens: "none" }));
    expect(s.minds.reads.activated).toEqual({ on: true, tokens: "none" });
    s = await set(mindsReadPatch("pinned", { on: false }));
    expect(s.minds.reads.pinned).toEqual({ on: false, tokens: "none" });
    s = await set(mindsReadPatch("pinned", { on: true, tokens: 250_000 }));
    expect(s.minds.reads.pinned).toEqual({ on: true, tokens: 250_000 });
    // A limit that isn't a whole number of tokens from 1 keeps the one before.
    s = await set(mindsReadPatch("reply", { tokens: 0 }));
    expect(s.minds.reads.reply).toEqual(DEFAULT_MIND_READS.reply);
    s = await set(mindsReadPatch("recall", { on: true }));
    expect(s.minds.reads.recall).toEqual({ on: true });
    const recallTokens = MEMORY_FIELDS.find((f) => f.part === "recall" && f.key === "tokens");
    const notesShown = MEMORY_FIELDS.find((f) => f.part === "notes" && f.key === "show");
    if (!recallTokens || !notesShown) throw new Error("no memory fields");
    s = await set(memoryOverridePatch(recallTokens, "none"));
    expect([s.minds.memory.recall?.tokens, s.preset]).toEqual(["none", "standard"]);
    s = await set(memoryOverridePatch(recallTokens, 25_000));
    expect(s.minds.memory.recall?.tokens).toBe(25_000);
    // No limit is only for a field that may have none.
    expect(memoryOverridePatch(notesShown, "none")).toBeNull();
    // A restart reads the switches and limits back.
    const back = rig.body(await rig.restart().send({ type: "lre.settings.get" })).settings as { minds: MindsSettings };
    expect({ life: back.minds.reads.life, pinned: back.minds.reads.pinned, recall: back.minds.reads.recall, recallTokens: back.minds.memory.recall?.tokens }).toEqual({ life: { on: true, tokens: 900 }, pinned: { on: true, tokens: 250_000 }, recall: { on: true }, recallTokens: 25_000 });
  });

  test("a minds step card keeps no recent chat of its own, as it keeps no lore: what minds read of the chat is Recent chat's; a helper's card keeps its own", async () => {
    const rig = new Rig();
    const recent = { on: true, messages: 5, tokens: 900 };
    const patch: JsonObject = { modelUse: { preset: "custom", steps: { memory: { enabled: true, signals: [], recent }, interpret: { enabled: true, signals: ["always"], recent } } } };
    const s = rig.body(await rig.send({ type: "lre.settings.set", patch })).settings as { modelUse: ModelUseSettings };
    expect(s.modelUse.steps.memory?.recent).toBeUndefined();
    expect(s.modelUse.steps.interpret?.recent).toEqual(recent);
  });
});
