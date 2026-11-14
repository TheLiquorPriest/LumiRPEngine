// A summary Lumiverse's memory put in place of history (`prompt-assembly.service.ts:3286-3292`) is
// marked as one in the tag, so the turn knows which history its prompt holds only as a summary; RPE
// reads the mark back, and refuses a tag that garbles it.

import { expect, test } from "bun:test";
import { readTag, TAG_FIELD, textHash, type Tag } from "../../src/adapter/lumiverse/wire";
import { listedMessage } from "../../src/ext/prompt";

const RECAP = "[Memory Cortex — Consolidated scene summary; earlier messages 2–4]\nThe crew rowed out at dawn.";

test("the tag marks a summary in place of history, with the last message it stands for; a message that is not history is never marked", () => {
  const summary = listedMessage({ role: "assistant", content: RECAP, __isChatHistory: true, __cortexHistorySummary: true, sourceMessageId: "m4", sourceIndexInChat: 4 });
  expect(summary).toEqual({ role: "assistant", length: RECAP.length, hash: textHash(RECAP), history: true, source: { id: "m4", index: 4 }, summary: true });
  expect(listedMessage({ role: "assistant", content: "Wren laughs.", __isChatHistory: true, sourceMessageId: "m5", sourceIndexInChat: 5 }).summary).toBeUndefined();
  expect(listedMessage({ role: "system", content: RECAP, __cortexHistorySummary: true }).summary).toBeUndefined();

  const tag: Tag = {
    v: 1,
    user: "user-a",
    chat: "chat-a",
    generation: "gen-a",
    kind: "new",
    target: { message: "m6", swipe: 0 },
    speaker: { id: null, name: null },
    connection: "conn-rpe",
    preset: null,
    persona: null,
    cut: { answered: true, keep: null, removed: 0 },
    messages: [summary],
    lore: [],
  };
  const read = readTag({ [TAG_FIELD]: tag });
  expect("tag" in read ? read.tag.messages[0]?.summary : null).toBe(true);
  expect(readTag({ [TAG_FIELD]: { ...tag, messages: [{ ...summary, summary: "yes" }] } })).toEqual({ invalid: "the tag's message 0 is malformed" });
});
