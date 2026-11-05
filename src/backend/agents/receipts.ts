// Receipts (Build C item 3, fork 3; the owner's decision 2): what the main session keeps of a past
// turn's long messages and answers, with Settings → Agents → Main agent → Session keeping receipts
// (the default). One turn's own messages ran to about 250 KB (the final review's message alone is
// the narrator's whole prompt), so three kept turns passed the compaction's tokens on their own and
// every turn compacted. A receipt keeps what a later turn needs to know was there, and how to find
// it: the final review's message as its parts (each part's id, header, line count and hash) and the
// edits the review made; a tool's long answer as its first characters, its length, its lines and its
// hash; the review's own tool calls as counts. The turn's own later stages still read every message
// whole (`MainTurn.sent`), the turn's segment keeps each message whole beside its receipt
// (`MainMessage.whole`), which `past_turn` reads and greps, and nothing a turn sends changes but
// what its later turns read.

import { type FinalEdit, partHash, type PromptPart, REVIEW_TOOLS } from "../../shared/final-review";
import { hashParts } from "../../shared/hash";
import { MAIN_TEXT } from "../../shared/main-agent-prompts";
import type { PromptTexts } from "../../shared/prompts";
import { renderPrompt } from "../prompts";

/** A text's short hash, as a receipt names it: the first 8 hex digits of its digest. */
export function receiptHash(text: string): string {
  return hashParts("lre.receipt", text).slice(0, 8);
}

/** A cut at `at` or one before, so it never splits a character: a UTF-16 unit from 0xD800 to 0xDBFF opens a surrogate pair. */
function cutAt(text: string, at: number): number {
  const unit = text.charCodeAt(at - 1);
  return at > 0 && at < text.length && unit >= 0xd800 && unit <= 0xdbff ? at - 1 : at;
}

/** A text clipped to `max` characters, ending in "…" where it was cut. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, cutAt(text, max))}…`;
}

/** A tool's answer as the session keeps it: whole while it is no longer than `chars`, else its first `chars` characters and its receipt. */
export function receiptOf(text: string, input: { chars: number; reply: number; texts: PromptTexts }): string {
  if (text.length <= input.chars) return text;
  return renderPrompt(MAIN_TEXT.receiptResult, input.texts, { text: text.slice(0, cutAt(text, input.chars)), chars: String(text.length), lines: String(text.split("\n").length), hash: receiptHash(text), reply: String(input.reply) });
}

/** One edit of the final review, in a line: what it did, where, and its text, clipped. */
function editLine(edit: FinalEdit): string {
  if (edit.op === "append") return `append to ${edit.part}: ${JSON.stringify(clip(edit.text, 200))}`;
  if (edit.op === "drop") return `drop ${edit.part} line ${edit.at + 1}: ${JSON.stringify(clip(edit.line, 120))}`;
  return `replace ${edit.part} line ${edit.at + 1}: ${JSON.stringify(clip(edit.line, 120))} → ${JSON.stringify(clip(edit.text, 200))}`;
}

/** The final review's message as the session keeps it: each part it showed (`parts`, as sent) by its id, header, line count and hash, and the edits the review made. */
export function reviewReceipt(parts: readonly PromptPart[], edits: readonly FinalEdit[], input: { reply: number; texts: PromptTexts }): string {
  const { texts } = input;
  const shown = parts.map((p) => renderPrompt(MAIN_TEXT.receiptPart, texts, { part: p.id, header: p.header ? ` ${p.header}` : "", lines: String(p.lines.length), hash: partHash(p).slice(0, 8) }));
  const made = edits.length > 0 ? edits.map((e) => `\n- ${editLine(e)}`).join("") : renderPrompt(MAIN_TEXT.none, texts, {});
  return renderPrompt(MAIN_TEXT.receiptReview, texts, { reply: String(input.reply), count: String(parts.length), parts: shown.join("\n"), edits: made });
}

/** The review's own tools, whose answers a receipt keeps as counts. */
const REVIEW_TOOL_NAMES: ReadonlySet<string> = new Set([REVIEW_TOOLS.replace, REVIEW_TOOLS.append, REVIEW_TOOLS.drop, REVIEW_TOOLS.read]);

export function isReviewTool(name: string): boolean {
  return REVIEW_TOOL_NAMES.has(name);
}

/** The review's tool calls as the session keeps them: how many of each it made, in the order first made; empty when it made none. */
export function reviewCounts(names: readonly string[], texts: PromptTexts): string {
  if (names.length === 0) return "";
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return renderPrompt(MAIN_TEXT.receiptReviewTools, texts, { counts: [...counts].map(([name, n]) => `${name} ×${n}`).join(", ") });
}
