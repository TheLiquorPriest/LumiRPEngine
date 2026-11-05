// Receipts (DESIGN §4.6, `receipts.ts`): once a turn is over, the main session keeps the final
// review's message as each part's id, header, line count and hash, with the review's edits, so a
// 76 KB review message keeps at most 12 KB; a tool's long answer as its first characters with its
// length, lines and hash, never cutting a character in two; and the review's own tool calls as
// counts. What the turn itself sends is never changed: a receipt replaces only what later turns read
// (`MainMessage.content`), each message kept whole beside it (`whole`), and a segment written before
// receipts, with no `whole`, reads as it always did.

import { describe, expect, test } from "bun:test";
import { historyOf, isMainMessage, MAIN_BY, wholeText } from "../../src/backend/agents/compaction";
import { isReviewTool, receiptHash, receiptOf, reviewCounts, reviewReceipt } from "../../src/backend/agents/receipts";
import { type FinalEdit, partHash, type PromptPart, REVIEW_TOOLS } from "../../src/shared/final-review";

const TEXTS = {};

/** The narrator's prompt as a long chat's review saw it: twelve parts, about 76 KB in all. */
function bigPrompt(): PromptPart[] {
  return Array.from({ length: 12 }, (_, i) => ({ id: `part_${i + 1}`, label: `Part ${i + 1}`, header: i % 2 === 0 ? `[Section ${i + 1}]` : null, lines: Array.from({ length: 104 }, (_, n) => `Line ${n + 1} of part ${i + 1}: the harbor at dusk, gulls over the water.`) }));
}

describe("the final review's receipt", () => {
  test("a 76 KB review message keeps at most 12 KB: each part by its id, header, line count and hash, and the review's edits", () => {
    const parts = bigPrompt();
    const whole = parts.map((p) => [p.header ?? "", ...p.lines].join("\n")).join("\n\n");
    expect(whole.length).toBeGreaterThan(76_000);
    const edits: FinalEdit[] = [
      { op: "replace", part: "part_1", at: 2, line: parts[0]?.lines[2] ?? "", text: "Line 3, revised: the tide is out." },
      { op: "append", part: "part_4", text: "A gull lands on the railing." },
      { op: "drop", part: "part_7", at: 0, line: parts[6]?.lines[0] ?? "" },
    ];
    const receipt = reviewReceipt(parts, edits, { reply: 12, texts: TEXTS });
    expect(receipt.length).toBeLessThanOrEqual(12_000);
    expect(receipt).toStartWith("[The final review of reply 12: the narrator's prompt in 12 parts, kept as a receipt; past_turn with reply 12 reads it whole]");
    for (const p of parts) expect(receipt).toContain(`- ${p.id}${p.header ? ` ${p.header}` : ""}: 104 lines, #${partHash(p).slice(0, 8)}`);
    expect(receipt).toContain('- replace part_1 line 3: "Line 3 of part 1');
    expect(receipt).toContain('- append to part_4: "A gull lands on the railing."');
    expect(receipt).toContain('- drop part_7 line 1: "Line 1 of part 7');
    expect(reviewReceipt(parts.slice(0, 1), [], { reply: 3, texts: TEXTS })).toEndWith("Its edits: (none)");
  });
});

describe("a tool's answer and the review's calls", () => {
  test("an answer is kept whole up to Receipt length, else its first characters and its receipt, never cutting a character in two", () => {
    expect(receiptOf("Short answer.", { chars: 600, reply: 4, texts: TEXTS })).toBe("Short answer.");
    const long = `${"x".repeat(700)}\nsecond line`;
    expect(receiptOf(long, { chars: 600, reply: 4, texts: TEXTS })).toBe(`${"x".repeat(600)}… (a receipt: ${long.length} characters, 2 lines, #${receiptHash(long)}; past_turn with reply 4 reads it whole)`);
    // An emoji across the cut stays whole on the near side of it.
    const emoji = `${"y".repeat(599)}😀${"z".repeat(50)}`;
    expect(receiptOf(emoji, { chars: 600, reply: 4, texts: TEXTS })).toStartWith(`${"y".repeat(599)}… (a receipt`);
  });

  test("the review's own tool calls are kept as counts, in the order first made; none, nothing", () => {
    expect([REVIEW_TOOLS.replace, REVIEW_TOOLS.append, REVIEW_TOOLS.drop, REVIEW_TOOLS.read].every(isReviewTool)).toBe(true);
    expect(isReviewTool("run_role")).toBe(false);
    expect(reviewCounts([REVIEW_TOOLS.read, REVIEW_TOOLS.replace, REVIEW_TOOLS.read], TEXTS)).toBe(`[The review's tool calls: ${REVIEW_TOOLS.read} ×2, ${REVIEW_TOOLS.replace} ×1]`);
    expect(reviewCounts([], TEXTS)).toBe("");
  });
});

describe("what a session reads of a past turn", () => {
  test("a receipt where one was kept, the message whole beside it for past_turn; a segment written before receipts reads as it always did", () => {
    const kept = { role: "user", content: "[The final review of reply 2: …]", whole: "The whole review message.", by: MAIN_BY };
    const old = { role: "assistant", content: "An answer kept whole, as earlier builds kept every one.", by: MAIN_BY };
    const theirs = { role: "user", content: "A fixed pipeline's digest.", by: "pipeline" };
    expect([kept, old, theirs].map(isMainMessage)).toEqual([true, true, false]);
    if (!isMainMessage(kept) || !isMainMessage(old)) throw new Error("not the main agent's");
    expect([wholeText(kept), wholeText(old)]).toEqual(["The whole review message.", "An answer kept whole, as earlier builds kept every one."]);
    expect(historyOf({ summary: null, segments: [{ hash: "s1", messages: [kept, old, theirs] }] }, TEXTS)).toEqual([
      { role: "user", text: "[The final review of reply 2: …]" },
      { role: "assistant", text: "An answer kept whole, as earlier builds kept every one." },
    ]);
  });
});
