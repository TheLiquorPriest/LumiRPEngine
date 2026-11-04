// The final review's message and tools (DESIGN §4.6; `shared/final-review.ts`): the narrator's
// prompt as the main agent is shown it, part by part with each line numbered, and the tools that
// edit it a line, or a block of lines, at a time in the review's draft, each answering with the lines
// around its edit as they read after it, and the one that reads a part whole. `commit` hands the
// prompt back as the edits leave it and ends the review's send. A turn the main agent decides offers
// these tools in every stage, where each refuses, so that every call of its turn is offered the same
// tools and reads the prefix the provider cached. Every text is the Main agent page's.

import type { JsonObject } from "../../shared/json";
import type { LiveReviewEdit } from "../../shared/live";
import { MAIN_TEXT } from "../../shared/main-agent-prompts";
import type { PromptTexts } from "../../shared/prompts";
import { AROUND_EDIT, type DraftChange, type DraftRefusal, type PromptPart, REVIEW_TEXT, REVIEW_TOOLS, type ReviewDraft } from "../../shared/final-review";
import { nounFor } from "../../shared/words";
import { renderPrompt } from "../prompts";
import type { AgentTool, ToolOutcome } from "./runtime";
import { tidy } from "./turn-task";

/** What a review works on: its draft, and whether it was committed. */
export interface ReviewWork {
  draft: ReviewDraft;
  done: { committed: boolean };
}

/** A part's lines from `from` up to `to` (from 0), each with its number as the review shows it; a part with none says so. */
function numbered(texts: PromptTexts, part: PromptPart, from: number, to: number): string {
  if (part.lines.length === 0) return renderPrompt(REVIEW_TEXT.empty, texts, {});
  return part.lines.slice(from, to).map((text, i) => renderPrompt(REVIEW_TEXT.line, texts, { n: String(from + i + 1), text })).join("\n");
}

/** A part as the review shows it: its id, its header, and each line numbered. */
export function partShown(texts: PromptTexts, part: PromptPart): string {
  return renderPrompt(REVIEW_TEXT.part, texts, { part: part.id, header: part.header ?? part.label, lines: numbered(texts, part, 0, part.lines.length) });
}

/** An edit as its answer shows it: the lines it made with up to `AROUND_EDIT` either side (a take-out's, either side of where its lines stood), numbered as the part reads now. */
export function aroundEdit(texts: PromptTexts, change: DraftChange): string {
  const { part, at, count } = change;
  return numbered(texts, part, Math.max(0, at - AROUND_EDIT), Math.min(part.lines.length, at + count + AROUND_EDIT));
}

/** The review's message: where it stands in the turn (`stage`, a text id), what it is for, then every part of the prompt. */
export function reviewMessage(texts: PromptTexts, draft: ReviewDraft, stage: string): string {
  return tidy(renderPrompt(REVIEW_TEXT.stage, texts, { stage: renderPrompt(stage, texts, {}), parts: draft.parts.map((p) => partShown(texts, p)).join("\n\n") }));
}

/** A line number as a tool's arguments give it: a whole number, or one written as text; anything else names no line. */
function lineArg(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : 0;
}

/** A block's last line as the arguments give it (`to`); none (or null) is the line alone. */
function toArg(args: JsonObject): number {
  return args.to === undefined || args.to === null ? lineArg(args.line) : lineArg(args.to);
}

/**
 * The review's own tools on `work`: rewrite a line or a block, add lines at a part's end, take a line
 * or a block out, and read a part whole. An edit answers with the lines around it as its part reads
 * after it (`aroundEdit`), or why it was refused; once the review is committed (`done.committed`),
 * every call is refused. A rewrite or a take-out names its lines by where they stand now, so the same
 * arguments once the draft changed name others: their state is the draft's edits so far, and the
 * loop detector takes such a call again, after an edit, as a new one (`AgentTool.state`). With no
 * `work` (a stage of a turn the main agent decides, whose every send offers them), each is refused.
 */
export function reviewTools(texts: PromptTexts, work: ReviewWork | null): AgentTool[] {
  const text = (id: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(id, texts, vars);
  const describe = (name: string, arg: string): string => text(REVIEW_TEXT.toolArg(name, arg));
  const str = (args: JsonObject, key: string): string => (typeof args[key] === "string" ? args[key] : "");
  const refused = (draft: ReviewDraft, got: DraftRefusal, part: string): ToolOutcome => {
    if (got.refused === "part") return { text: text(REVIEW_TEXT.refusedPart, { part, parts: draft.parts.map((p) => p.id).join(", ") }), error: true };
    if (got.refused === "line") return { text: text(REVIEW_TEXT.refusedLine, { part, line: String(got.line), count: String(got.part.lines.length), lines: nounFor(got.part.lines.length, "line", "lines") }), error: true };
    return { text: text(REVIEW_TEXT.refusedText), error: true };
  };
  // An edit's answer (`answer`: the lines it made, or those around the cut) shows only where it stands.
  const changed = (draft: ReviewDraft, answer: string, got: DraftChange | DraftRefusal, part: string): ToolOutcome => {
    if ("refused" in got) return refused(draft, got, part);
    const n = got.part.lines.length;
    return { text: text(answer, { part: got.part.id, count: String(n), lines: nounFor(n, "line", "lines"), excerpt: aroundEdit(texts, got) }) };
  };
  // Out of the review a call is refused, and so is one after its commit: the narrator has the prompt.
  const open =
    (name: string, run: (draft: ReviewDraft, args: JsonObject) => ToolOutcome) =>
    (args: JsonObject): Promise<ToolOutcome> => {
      if (work === null) return Promise.resolve({ text: text(REVIEW_TEXT.refusedStage, { tool: name }), error: true });
      return Promise.resolve(work.done.committed ? { text: text(MAIN_TEXT.refusedCommitted), error: true } : run(work.draft, args));
    };
  const draft = work?.draft;
  const state = draft ? { state: (): number => draft.edits.length } : {};
  const partProp = (name: string): JsonObject => ({ type: "string", description: describe(name, "part") });
  const lineProp = (name: string): JsonObject => ({ type: "integer", minimum: 1, description: describe(name, "line") });
  const toProp = (name: string): JsonObject => ({ type: "integer", minimum: 1, description: describe(name, "to") });
  const textProp = (name: string): JsonObject => ({ type: "string", description: describe(name, "text") });
  return [
    {
      name: REVIEW_TOOLS.replace,
      description: text(REVIEW_TEXT.tool(REVIEW_TOOLS.replace)),
      parameters: { type: "object", properties: { part: partProp(REVIEW_TOOLS.replace), line: lineProp(REVIEW_TOOLS.replace), to: toProp(REVIEW_TOOLS.replace), text: textProp(REVIEW_TOOLS.replace) }, required: ["part", "line", "text"] },
      ...state,
      run: open(REVIEW_TOOLS.replace, (d, args) => changed(d, REVIEW_TEXT.edited, d.replace(str(args, "part"), lineArg(args.line), str(args, "text"), toArg(args)), str(args, "part"))),
    },
    {
      name: REVIEW_TOOLS.append,
      description: text(REVIEW_TEXT.tool(REVIEW_TOOLS.append)),
      parameters: { type: "object", properties: { part: partProp(REVIEW_TOOLS.append), text: textProp(REVIEW_TOOLS.append) }, required: ["part", "text"] },
      run: open(REVIEW_TOOLS.append, (d, args) => changed(d, REVIEW_TEXT.edited, d.append(str(args, "part"), str(args, "text")), str(args, "part"))),
    },
    {
      name: REVIEW_TOOLS.drop,
      description: text(REVIEW_TEXT.tool(REVIEW_TOOLS.drop)),
      parameters: { type: "object", properties: { part: partProp(REVIEW_TOOLS.drop), line: lineProp(REVIEW_TOOLS.drop), to: toProp(REVIEW_TOOLS.drop) }, required: ["part", "line"] },
      ...state,
      run: open(REVIEW_TOOLS.drop, (d, args) => changed(d, REVIEW_TEXT.dropped, d.drop(str(args, "part"), lineArg(args.line), toArg(args)), str(args, "part"))),
    },
    {
      name: REVIEW_TOOLS.read,
      description: text(REVIEW_TEXT.tool(REVIEW_TOOLS.read)),
      parameters: { type: "object", properties: { part: partProp(REVIEW_TOOLS.read) }, required: ["part"] },
      run: open(REVIEW_TOOLS.read, (d, args) => {
        const part = d.part(str(args, "part"));
        return part ? { text: partShown(texts, part) } : refused(d, { refused: "part" }, str(args, "part"));
      }),
    },
  ];
}

/** `commit` in the review: the narrator gets the prompt as its edits leave it, and the review's send ends; once it is committed, refused. */
export function commitReview(texts: PromptTexts, work: ReviewWork): ToolOutcome {
  if (work.done.committed) return { text: renderPrompt(MAIN_TEXT.refusedCommitted, texts, {}), error: true };
  work.done.committed = true;
  const n = work.draft.edits.length;
  return { text: n === 0 ? renderPrompt(REVIEW_TEXT.committedNone, texts, {}) : renderPrompt(REVIEW_TEXT.committed, texts, { count: String(n), edits: nounFor(n, "edit", "edits") }), end: true };
}

/** The review's commit tool when the main agent works the review alone, described as the review's own; a turn it decides has one commit for its stages and its review. */
export function reviewCommitTool(texts: PromptTexts, work: ReviewWork): AgentTool {
  return { name: REVIEW_TOOLS.commit, description: renderPrompt(REVIEW_TEXT.commit, texts, {}), parameters: { type: "object", properties: {} }, run: () => Promise.resolve(commitReview(texts, work)) };
}

/** The review's edits as GM → Live shows them: each with its part's name, what it did, the line it changed and the text it gave. */
export function liveEdits(draft: ReviewDraft): LiveReviewEdit[] {
  return draft.edits.map((e) => ({ part: e.part, label: draft.part(e.part)?.label ?? e.part, op: e.op, ...(e.op === "append" ? {} : { line: e.line }), ...(e.op === "drop" ? {} : { text: e.text }) }));
}
