// Settings → Minds → What a mind reads (DESIGN §24.5–24.6): each source a mind may read is the
// user's to switch on or off and to limit, "no limit" allowed. Off, a source is not in the context;
// on, it comes within its own limit, a text cut at a word, lines kept whole, lore cut where it runs
// out; and each control reaches the settings store without touching the Model use preset.

import { describe, expect, test } from "bun:test";
import { sectionTokens } from "../../src/backend/book";
import { mindContext, type MindContextReport } from "../../src/backend/minds-context";
import { MEMORY_FIELDS, memoryOverridePatch, mindsReadPatch } from "../../src/frontend/settings/minds-patch";
import type { JsonObject } from "../../src/shared/json";
import type { MindMoment, MindSource, MindsReads, MindsSettings } from "../../src/shared/minds";
import { DEFAULT_MIND_READS, effectiveMemory, MIND_SOURCES } from "../../src/shared/minds";
import { pinsFor, worldPinText } from "../../src/engine/lore-pins";
import { placeOfEntity } from "../../src/engine/scope";
import { ASK, DANNY, stateOf, storyChat } from "../support/mind-chat";
import { Rig } from "../support/rig";

/** What shows each source is in Danny's context on the story's second turn. */
const MARKS: Record<MindSource, string> = {
  pinned: "PIN-MARK",
  activated: "ACTIVE-MARK",
  reply: "The story so far ended: SECOND-REPLY-MARK",
  message: `says or does: ${ASK}`,
  summary: "SUMMARY-MARK",
  memory: "NOTE-MARK",
  thoughts: "THOUGHT-MARK",
  recall: "FIRST-REPLY-MARK",
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
    const every = Object.fromEntries(MIND_SOURCES.map((s) => [s, s === "recall" ? { on: true } : { on: true, tokens: "none" }])) as unknown as MindsReads;
    const contextWith = (reads: MindsReads, report?: MindContextReport): string => mindContext({ reg: rig.rt.registry, world, state, who: DANNY, memory: effectiveMemory(world, settings.minds), messages, hideJson: true, moment, reads, pinned }, report);
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
});
