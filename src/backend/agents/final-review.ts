// The final review's message and tools (DESIGN §4.6; `shared/final-review.ts`): the narrator's
// prompt as the main agent is shown it, part by part with each line numbered, and the tools that
// edit it a line at a time in the review's draft, each answering with the part as it reads after.
// `commit` hands the prompt back as the edits leave it and ends the review's send. Every text is
// the Main agent page's.

import type { JsonObject } from "../../shared/json";
import type { LiveReviewEdit } from "../../shared/live";
import { MAIN_TEXT } from "../../shared/main-agent-prompts";
import type { PromptTexts } from "../../shared/prompts";
import { type DraftRefusal, type PromptPart, REVIEW_TEXT, REVIEW_TOOLS, type ReviewDraft } from "../../shared/final-review";
import { nounFor } from "../../shared/words";
import { renderPrompt } from "../prompts";
import type { AgentTool, ToolOutcome } from "./runtime";
import { tidy } from "./turn-task";

/** A part as the review shows it: its id, its header, and each line numbered. */
export function partShown(texts: PromptTexts, part: PromptPart): string {
  const lines = part.lines.length === 0 ? renderPrompt(REVIEW_TEXT.empty, texts, {}) : part.lines.map((text, i) => renderPrompt(REVIEW_TEXT.line, texts, { n: String(i + 1), text })).join("\n");
  return renderPrompt(REVIEW_TEXT.part, texts, { part: part.id, header: part.header ?? part.label, lines });
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

/**
 * The review's tools on `draft`: rewrite a line, add lines at a part's end, take a line out, and
 * commit. Each edit answers with the part as it reads after it, or why it was refused; once the
 * review is committed (`done.committed`), every call is refused.
 */
export function reviewTools(texts: PromptTexts, draft: ReviewDraft, done: { committed: boolean }): AgentTool[] {
  const text = (id: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(id, texts, vars);
  const describe = (name: string, arg: string): string => text(REVIEW_TEXT.toolArg(name, arg));
  const str = (args: JsonObject, key: string): string => (typeof args[key] === "string" ? args[key] : "");
  const answer = (got: PromptPart | DraftRefusal, part: string, line?: number): ToolOutcome => {
    if (!("refused" in got)) return { text: text(REVIEW_TEXT.edited, { part: partShown(texts, got) }) };
    if (got.refused === "part") return { text: text(REVIEW_TEXT.refusedPart, { part, parts: draft.parts.map((p) => p.id).join(", ") }), error: true };
    if (got.refused === "line") return { text: text(REVIEW_TEXT.refusedLine, { part, line: String(line ?? ""), count: String(got.part.lines.length), lines: nounFor(got.part.lines.length, "line", "lines") }), error: true };
    return { text: text(REVIEW_TEXT.refusedText), error: true };
  };
  // A call after the commit changes nothing: the narrator has the prompt.
  const edit = (run: () => ToolOutcome): Promise<ToolOutcome> => Promise.resolve(done.committed ? { text: text(MAIN_TEXT.refusedCommitted), error: true } : run());
  const partProp = (name: string): JsonObject => ({ type: "string", description: describe(name, "part") });
  const lineProp = (name: string): JsonObject => ({ type: "integer", minimum: 1, description: describe(name, "line") });
  const textProp = (name: string): JsonObject => ({ type: "string", description: describe(name, "text") });
  return [
    {
      name: REVIEW_TOOLS.replace,
      description: text(REVIEW_TEXT.tool(REVIEW_TOOLS.replace)),
      parameters: { type: "object", properties: { part: partProp(REVIEW_TOOLS.replace), line: lineProp(REVIEW_TOOLS.replace), text: textProp(REVIEW_TOOLS.replace) }, required: ["part", "line", "text"] },
      run: (args) => edit(() => answer(draft.replace(str(args, "part"), lineArg(args.line), str(args, "text")), str(args, "part"), lineArg(args.line))),
    },
    {
      name: REVIEW_TOOLS.append,
      description: text(REVIEW_TEXT.tool(REVIEW_TOOLS.append)),
      parameters: { type: "object", properties: { part: partProp(REVIEW_TOOLS.append), text: textProp(REVIEW_TOOLS.append) }, required: ["part", "text"] },
      run: (args) => edit(() => answer(draft.append(str(args, "part"), str(args, "text")), str(args, "part"))),
    },
    {
      name: REVIEW_TOOLS.drop,
      description: text(REVIEW_TEXT.tool(REVIEW_TOOLS.drop)),
      parameters: { type: "object", properties: { part: partProp(REVIEW_TOOLS.drop), line: lineProp(REVIEW_TOOLS.drop) }, required: ["part", "line"] },
      run: (args) => edit(() => answer(draft.drop(str(args, "part"), lineArg(args.line)), str(args, "part"), lineArg(args.line))),
    },
    {
      name: REVIEW_TOOLS.commit,
      description: text(REVIEW_TEXT.commit),
      parameters: { type: "object", properties: {} },
      run: () =>
        edit(() => {
          done.committed = true;
          const n = draft.edits.length;
          return { text: n === 0 ? text(REVIEW_TEXT.committedNone) : text(REVIEW_TEXT.committed, { count: String(n), edits: nounFor(n, "edit", "edits") }), end: true };
        }),
    },
  ];
}

/** The review's edits as GM → Live shows them: each with its part's name, what it did, the line it changed and the text it gave. */
export function liveEdits(draft: ReviewDraft): LiveReviewEdit[] {
  return draft.edits.map((e) => ({ part: e.part, label: draft.part(e.part)?.label ?? e.part, op: e.op, ...(e.op === "append" ? {} : { line: e.line }), ...(e.op === "drop" ? {} : { text: e.text }) }));
}
