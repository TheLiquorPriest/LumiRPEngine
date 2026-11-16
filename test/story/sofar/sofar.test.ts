import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadGuidance, type TemplatePart } from "rp-harness";
import { createFolderHost } from "rp-harness/hosts/folder";
import { STORY_SO_FAR_DEFAULTS, storySoFar, storySoFarBudget, type StoryBeat, type StoryRecordParts } from "../../../src/story/sofar/index";

const SHIPPED_PART = resolve(import.meta.dir, "../../../guidance/.prompts/story-so-far.md");

let dir = "";
let layout: TemplatePart;

beforeAll(async () => {
  // The shipped layout, loaded the way the agents' guidance is: as the shipped level of a folder host.
  dir = mkdtempSync(join(tmpdir(), "rpe-story-so-far-"));
  mkdirSync(join(dir, "files", "defaults", ".prompts"), { recursive: true });
  copyFileSync(SHIPPED_PART, join(dir, "files", "defaults", ".prompts", "story-so-far.md"));
  mkdirSync(join(dir, "files", "chats", "hero", "c1"), { recursive: true });
  mkdirSync(join(dir, "host", "chats", "c1"), { recursive: true });
  writeFileSync(join(dir, "host", "chats", "c1", "chat.json"), JSON.stringify({ character: "hero" }));
  const host = await createFolderHost({ dir, user: "u1" });
  const guidance = loadGuidance(host.files, { user: "u1", chat: "c1", session: "s1" });
  expect(await guidance.problems()).toEqual([]);
  const part = await guidance.part("story-so-far");
  if (part?.format !== "template") throw new Error("The shipped story-so-far part did not load as a template.");
  layout = part;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** About four characters to a token, as a stand-in for the caller's counter. */
const tokens = (text: string): number => Math.ceil(text.length / 4);

/** An invented beat for each message from `from` to `to`, about a hundred characters each. */
function beats(from: number, to: number): StoryBeat[] {
  const out: StoryBeat[] = [];
  for (let at = from; at <= to; at++) out.push({ at, text: `Beat ${at}: the caravan reaches waypoint ${at} and the guide counts the lanterns again before dusk.` });
  return out;
}

const record = (over: Partial<StoryRecordParts>): StoryRecordParts => ({ chapters: [], scenes: [], beats: [], ...over });
const roomy = { contextWindow: 1_000_000, settings: STORY_SO_FAR_DEFAULTS, tokens };
const tight = (floor: number) => ({ contextWindow: 0, settings: { share: STORY_SO_FAR_DEFAULTS.share, floor }, tokens });

describe("the story so far", () => {
  test("prints the beats themselves where there is no summary, each with its message, and only for what the window leaves out", () => {
    // A chat carried over from today's build: beats and no scenes.
    const out = storySoFar({ record: record({ beats: beats(0, 299) }), keptFrom: 260, layout, ...roomy });
    expect(out.leftOut).toEqual([]);
    expect(out.text).toContain("messages 0 to 259");
    expect(out.text).toContain("- Message 0: Beat 0:");
    expect(out.text).toContain("- Message 259: Beat 259:");
    expect(out.text).not.toContain("Message 260:");
    expect(out.text).not.toContain("Not shown");
  });

  test("prints a scene's summary in place of its beats, and beats on both sides of it", () => {
    const scenes = [{ from: 10, to: 19, text: "The ferry scene: the toll is paid in salt and the ferryman remembers a face." }];
    const out = storySoFar({ record: record({ scenes, beats: beats(0, 39) }), keptFrom: 40, layout, ...roomy });
    expect(out.text).toContain("Scene summary, messages 10 to 19:\nThe ferry scene");
    for (let at = 10; at <= 19; at++) expect(out.text).not.toContain(`Message ${at}:`);
    const before = out.text.indexOf("- Message 9:");
    const scene = out.text.indexOf("The ferry scene");
    const after = out.text.indexOf("- Message 20:");
    expect(before).toBeGreaterThanOrEqual(0);
    expect(before < scene && scene < after).toBe(true);
  });

  test("fits its size, keeps the newest whole, and says in plain words what it left out", () => {
    const all = beats(0, 199);
    const out = storySoFar({ record: record({ beats: all }), keptFrom: 200, layout, ...tight(1000) });
    expect(out.budget).toBe(1000);
    expect(out.tokens).toBeLessThanOrEqual(1000);
    expect(out.tokens).toBe(tokens(out.text));
    expect(out.leftOut.length).toBe(1);
    const left = out.leftOut[0];
    if (left === undefined) throw new Error("unreachable");
    expect(left.from).toBe(0);
    const shown = all.filter((b) => out.text.includes(`- Message ${b.at}:`)).map((b) => b.at);
    // What is shown is the newest, without a gap, and the line accounts for everything older.
    expect(shown.length).toBeGreaterThan(0);
    expect(shown).toEqual(Array.from({ length: shown.length }, (_, i) => 200 - shown.length + i));
    expect(left).toEqual({ from: 0, to: 199 - shown.length, chapters: 0, scenes: 0, beats: 200 - shown.length });
    expect(out.text).toContain(`Not shown, for want of room: messages 0 to ${199 - shown.length}, beats: ${200 - shown.length}.`);
    // Given more room, it shows more.
    const roomier = storySoFar({ record: record({ beats: all }), keptFrom: 200, layout, ...tight(2000) });
    expect(roomier.leftOut[0]?.beats ?? 0).toBeLessThan(left.beats);
  });

  test("when the far past does not fit whole, it goes by its chapter's summary", () => {
    const chapters = [
      { from: 0, to: 99, text: "Chapter one: the caravan leaves the salt flats." },
      { from: 100, to: 199, text: "Chapter two: the mountain pass and the lost guide." },
    ];
    const rec = record({ chapters, beats: beats(0, 259) });
    const whole = storySoFar({ record: rec, keptFrom: 260, layout, ...roomy });
    // With room for everything, everything is given whole.
    expect(whole.text).toContain("- Message 0:");
    expect(whole.text).not.toContain("Chapter one:");

    const out = storySoFar({ record: rec, keptFrom: 260, layout, ...tight(3500) });
    expect(out.tokens).toBeLessThanOrEqual(3500);
    expect(out.leftOut).toEqual([]);
    expect(out.text).toContain("Chapter summary, messages 0 to 99:\nChapter one:");
    expect(out.text).toContain("Chapter summary, messages 100 to 199:\nChapter two:");
    expect(out.text).toContain("- Message 200:");
    expect(out.text).toContain("- Message 259:");
    expect(out.text).not.toContain("- Message 150:");
    expect(out.text.indexOf("Chapter one:")).toBeLessThan(out.text.indexOf("Chapter two:"));
    expect(out.text.indexOf("Chapter two:")).toBeLessThan(out.text.indexOf("- Message 200:"));
  });

  test("when even a chapter's summary has no room, the line counts it with what it held", () => {
    const chapters = [{ from: 0, to: 99, text: `Chapter one: ${"a long account of the salt flats, ".repeat(40)}` }];
    const scenes = [{ from: 0, to: 49, text: "The first scene." }];
    const out = storySoFar({ record: record({ chapters, scenes, beats: beats(0, 119) }), keptFrom: 120, layout, ...tight(250) });
    expect(out.tokens).toBeLessThanOrEqual(250);
    expect(out.text).not.toContain("Chapter one:");
    expect(out.leftOut[0]).toMatchObject({ from: 0, chapters: 1, scenes: 1 });
    expect(out.text).toMatch(/Not shown, for want of room: messages 0 to \d+, chapter summaries: 1, scene summaries: 1, beats: \d+\./);
  });

  test("shows nothing when the window leaves nothing out", () => {
    expect(storySoFar({ record: record({ beats: beats(0, 9) }), keptFrom: null, layout, ...roomy }).text).toBe("");
    expect(storySoFar({ record: record({ beats: beats(0, 9) }), keptFrom: 0, layout, ...roomy }).text).toBe("");
  });

  test("on a long chat it counts the block a few times, not once for every stretch it places", () => {
    // The caller's counter may be a real tokenizer: each count reads the whole block.
    let counted = 0;
    const counting = (text: string): number => {
      counted++;
      return tokens(text);
    };
    const few = (units: number): number => 2 * Math.ceil(Math.log2(units + 1)) + 4;

    // A chat carried over from today's build: beats and no scenes, far more than fit.
    const all = beats(0, 3999);
    const out = storySoFar({ record: record({ beats: all }), keptFrom: 4000, layout, contextWindow: 1_000_000, settings: STORY_SO_FAR_DEFAULTS, tokens: counting });
    expect(counted).toBeLessThanOrEqual(few(all.length));
    expect(out.tokens).toBeLessThanOrEqual(out.budget);
    const shown = all.filter((b) => out.text.includes(`- Message ${b.at}:`)).map((b) => b.at);
    expect(shown.length).toBeGreaterThan(1000);
    expect(shown).toEqual(Array.from({ length: shown.length }, (_, i) => 4000 - shown.length + i));

    // Forty chapters, too long to give whole: they go by their summaries, newest first, as far as they fit.
    counted = 0;
    const chapters = Array.from({ length: 40 }, (_, c) => ({ from: c * 100, to: c * 100 + 99, text: `Chapter ${c}: the caravan's ${c}th week on the salt road, told short.` }));
    const summed = storySoFar({ record: record({ chapters, beats: all }), keptFrom: 4000, layout, ...tight(400), tokens: counting });
    expect(counted).toBeLessThanOrEqual(few(chapters.length));
    expect(summed.tokens).toBeLessThanOrEqual(400);
    expect(summed.text).toContain("Chapter summary, messages 3900 to 3999:\nChapter 39:");
    expect(summed.leftOut).toEqual([expect.objectContaining({ from: 0, chapters: expect.any(Number) })]);
  });

  test("its size is a share of the Author's window, never below the floor", () => {
    expect(storySoFarBudget(200_000, STORY_SO_FAR_DEFAULTS)).toBe(10_000);
    expect(storySoFarBudget(32_000, STORY_SO_FAR_DEFAULTS)).toBe(6_000);
  });

  test("a beat that stands for a stretch is printed with its range, and a summary whose messages were deleted says so where its turn stands", () => {
    const out = storySoFar({ record: record({ beats: [{ at: 300, to: 340, text: "The long march." }, { at: 341, text: "Camp." }], scenes: [{ from: 350, to: 350, text: "The old scene.", gone: true }] }), keptFrom: 400, layout, ...roomy });
    expect(out.text).toContain("- Message 300 to 340: The long march.");
    expect(out.text).toContain("- Message 341: Camp.");
    expect(out.text).toContain("Scene summary; its messages are gone from the chat, it was written at message 350:\nThe old scene.");
  });

  test("a chat with no record is one line naming every message not covered, and beats covering the end leave the rest named", () => {
    const none = storySoFar({ record: record({ uncovered: [{ from: 0, to: 1999 }] }), keptFrom: 1960, layout, ...roomy });
    expect(none.text.trim()).toBe("Not covered by the record: messages 0 to 1959.");
    const some = storySoFar({ record: record({ beats: beats(1900, 1959), uncovered: [{ from: 0, to: 1899 }, { from: 1960, to: 1999 }] }), keptFrom: 1960, layout, ...roomy });
    expect(some.text).toContain("Not covered by the record: messages 0 to 1899.");
    expect(some.text).not.toContain("1960");
  });
});
