// The feedback typed in Lumiverse's regenerate dialog (`src/adapter/lumiverse/feedback.ts`), told apart from a regeneration's prompt only where RPE can be certain, never by the
// format's template. Each prompt is built from invented lines the way the interceptor lists them and the overlay lays them over the body.

import { describe, expect, test } from "bun:test";
import { changeOf } from "../../src/adapter/lumiverse/events";
import { createFeedback, type EarlierPrompt, type FeedbackFor } from "../../src/adapter/lumiverse/feedback";
import { rawLayout } from "../../src/adapter/lumiverse/layout";
import type { LaidMessage } from "../../src/adapter/lumiverse/overlay";
import type { LvSetting } from "../../src/adapter/lumiverse/rows";
import { textHash, type ReplyKind, type Tag, type TagMessage } from "../../src/adapter/lumiverse/wire";

interface Line {
  role: "system" | "user" | "assistant";
  text: string;
  /** The chat message it is, for a history line. */
  id?: string;
}

/** A prompt as the tag lists it and the overlay lays it: each line one message of its own. */
function prompt(lines: readonly Line[], kind: ReplyKind = "regenerate"): { tag: Tag; laid: LaidMessage[] } {
  const messages: TagMessage[] = lines.map((l, i) => ({ role: l.role, length: l.text.length, hash: textHash(l.text), ...(l.id !== undefined ? { history: true as const, source: { id: l.id, index: i } } : {}) }));
  const tag: Tag = {
    v: 1,
    user: "user-a",
    chat: "chat-a",
    generation: "gen-a",
    kind,
    target: { message: "m2", swipe: 1 },
    speaker: { id: null, name: null },
    connection: "conn-rpe",
    preset: null,
    persona: null,
    cut: { answered: true, keep: null, removed: 0 },
    secrecy: { by: "rpe" },
    question: null,
    messages,
  };
  const laid: LaidMessage[] = lines.map((l, i) => ({ role: l.role, content: l.text, text: l.text, media: 0, places: [{ member: i, start: 0, end: l.text.length }] }));
  return { tag, laid };
}

/** What an earlier attempt's turn keeps: the prompt it passed on and its layout. */
function earlierOf(lines: readonly Line[]): EarlierPrompt {
  const { tag, laid } = prompt(lines);
  return { prompt: laid.map((m) => ({ role: m.role, content: m.content })), layout: rawLayout(tag, laid, true, null) };
}

const HISTORY: Line[] = [
  { role: "system", text: "Rules of the harbor." },
  { role: "assistant", text: "The ferry waits.", id: "m0" },
  { role: "user", text: "I wait by the bell.", id: "m1" },
];
const FEEDBACK = "[OOC: be gentler with the ferryman]";

function feedbackOf(setting: LvSetting | null | Error, earlier: EarlierPrompt | null): FeedbackFor {
  return createFeedback({
    reads: {
      setting: async () => {
        if (setting instanceof Error) throw setting;
        return setting;
      },
    },
    replaced: async () => earlier,
  });
}

const regen = (value: Record<string, unknown>): LvSetting => ({ key: "regenFeedback", value: value as LvSetting["value"], updatedAt: 0 });

describe("which case applies is read from the player's setting", () => {
  test("with the setting unreadable, a regenerate's feedback is not separated and the turn says where it stands", async () => {
    const now = prompt([...HISTORY, { role: "system", text: FEEDBACK }]);
    const found = await feedbackOf(new Error("the settings row could not be read"), earlierOf(HISTORY))(now.tag, now.laid);
    expect(found).toEqual({ found: "unseparated", position: null, why: "setting-unreadable" });
  });

  test("with the setting off, a regenerate has none; a reply that is not a regeneration has no word on it at all", async () => {
    const now = prompt(HISTORY);
    expect(await feedbackOf(regen({ enabled: false, position: "system" }), earlierOf(HISTORY))(now.tag, now.laid)).toEqual({ found: "none" });
    expect(await feedbackOf(null, null)(now.tag, now.laid)).toEqual({ found: "none" });
    const fresh = prompt(HISTORY, "new");
    expect(await feedbackOf(regen({ enabled: true, position: "system" }), earlierOf(HISTORY))(fresh.tag, fresh.laid)).toBeNull();
  });
});

describe("at the system position", () => {
  const setting = regen({ enabled: true, position: "system" });

  test("the trailing system message the earlier prompt did not have is the feedback, and nothing else is guessed", async () => {
    const now = prompt([...HISTORY, { role: "system", text: FEEDBACK }]);
    expect(await feedbackOf(setting, earlierOf(HISTORY))(now.tag, now.laid)).toEqual({ found: "separated", position: "system", text: FEEDBACK });
    // The dialog skipped: the two prompts are equal.
    const skipped = prompt(HISTORY);
    expect(await feedbackOf(setting, earlierOf(HISTORY))(skipped.tag, skipped.laid)).toEqual({ found: "none" });
  });

  test("where the prompts differ in anything else, nothing is separated; with no earlier prompt of RPE's, the turn says where it stands", async () => {
    const changed = prompt([{ role: "system", text: "Other rules." }, ...HISTORY.slice(1), { role: "system", text: FEEDBACK }]);
    expect(await feedbackOf(setting, earlierOf(HISTORY))(changed.tag, changed.laid)).toEqual({ found: "unseparated", position: "system", why: "prompts-differ" });
    const now = prompt([...HISTORY, { role: "system", text: FEEDBACK }]);
    expect(await feedbackOf(setting, null)(now.tag, now.laid)).toEqual({ found: "unseparated", position: "system", why: "no-earlier-prompt" });
  });
});

describe("appended to his last line", () => {
  const setting = regen({ enabled: true, position: "user" });
  const withFeedback: Line[] = [...HISTORY.slice(0, 2), { role: "user", text: `I wait by the bell.\n${FEEDBACK}`, id: "m1" }];

  test("feedback appended to the player's last line is separated by the earlier attempt's prompt", async () => {
    const now = prompt(withFeedback);
    expect(await feedbackOf(setting, earlierOf(HISTORY))(now.tag, now.laid)).toEqual({ found: "separated", position: "user", text: FEEDBACK });
  });

  test("with no earlier prompt of RPE's it is not separated, and the turn says where it stands", async () => {
    const now = prompt(withFeedback);
    expect(await feedbackOf(setting, null)(now.tag, now.laid)).toEqual({ found: "unseparated", position: "user", why: "no-earlier-prompt" });
  });

  test("the player's last line is not read as edited: its part keeps the hash of the text Lumiverse stored, and the feedback is a part of its own", async () => {
    const now = prompt(withFeedback);
    const found = await feedbackOf(setting, earlierOf(HISTORY))(now.tag, now.laid);
    const layout = rawLayout(now.tag, now.laid, true, null, null, found);
    const message = layout.messages[2]!;
    const own = "I wait by the bell.";
    expect(message.parts).toHaveLength(2);
    expect(message.parts[0]).toMatchObject({ kind: "history", source: { id: "m1" }, start: 0, end: own.length, hash: textHash(own) });
    expect(message.parts[1]).toMatchObject({ kind: "other", start: own.length + 1, end: message.length, hash: textHash(FEEDBACK) });
    expect(message.parts[1]!.source).toBeUndefined();
    // The message as the model reads it is whole, and the same layout without the separation holds the line as one part with the whole text's hash.
    expect(message.hash).toBe(textHash(`${own}\n${FEEDBACK}`));
    expect(rawLayout(now.tag, now.laid, true, null).messages[2]!.parts).toHaveLength(1);
  });
});

describe("the breakdown Lumiverse stores with the saved reply", () => {
  const ready = (entries: unknown[]) => changeOf("GENERATION_BREAKDOWN_READY", { generationId: "gen-a", chatId: "chat-a", messageId: "m2", breakdown: { entries } });

  test("names the feedback and where it stood, which confirms or corrects what was separated, or completes it", () => {
    expect(ready([{ type: "preset", name: "Main", role: "system", content: "Rules." }, { type: "utility", name: "Regen Feedback", role: "system", content: FEEDBACK }])).toEqual({
      kind: "feedback-told",
      chat: "chat-a",
      generation: "gen-a",
      message: "m2",
      feedback: { position: "system", text: FEEDBACK },
    });
    expect(ready([{ type: "utility", name: "Regen Feedback", role: "user", content: FEEDBACK }])).toMatchObject({ feedback: { position: "user", text: FEEDBACK } });
  });

  test("a breakdown with no such entry says none was typed", () => {
    expect(ready([{ type: "preset", name: "Main", role: "system", content: "Rules." }])).toMatchObject({ kind: "feedback-told", feedback: null });
  });
});
