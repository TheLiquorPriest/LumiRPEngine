// The final review (DESIGN §4.6): before every reply of an agent chat, once the engine has made the
// turn's sections and before the guard writes them, the main agent reviews the main generation's
// prompt as the narrator will read it (every engine section, the Outline with the brief, and the
// narrator rules) and may revise it a line at a time. Here: the prompt as the review sees it (each
// part's header and lines), the review's edits and how they apply, the record of them a turn keeps
// (`Rec.finalEdits`, outside every hash) so a Re-narrate tells the same prompt, the parts it saw as
// made (`Rec.finalParts`), which a review scoped to what changed compares the next turn's with
// (`changedScope`), and every text the review sends a model, on the Main agent page of Settings →
// Agents → Prompts.

import { hashParts } from "./hash";
import { MAIN_AGENT_PAGE } from "./main-agent-prompts";
import { neutralizeMacros } from "./macros";
import type { PromptDef, PromptVar } from "./prompts";

/** The review's step, as Diagnostics, the activity line and the engine-failed card name it. */
export const FINAL_REVIEW_STEP = "final review";

/** The narrator rules' id among the parts the review sees: never a section's slot, which is a world's word. */
export const RULES_PART = "narrator_rules";

/**
 * One part of the narrator's prompt as the review sees it: its id (the section's slot, or the
 * narrator rules'), its name, the header line it starts with (`[Outcome]`; none when it has none),
 * and its lines after that, as the narrator reads them.
 */
export interface PromptPart {
  id: string;
  label: string;
  header: string | null;
  lines: string[];
}

/** A part as its text reads it: a first line in square brackets is its header, every other line one of its lines. */
export function partOf(id: string, label: string, content: string): PromptPart {
  const lines = content.split("\n");
  const first = lines[0] ?? "";
  return /^\[.*\]$/.test(first) ? { id, label, header: first, lines: lines.slice(1) } : { id, label, header: null, lines };
}

/** A part's text, as its entry holds it. */
export function partText(part: PromptPart): string {
  return [...(part.header === null ? [] : [part.header]), ...part.lines].join("\n");
}

/**
 * One edit the final review made (`Rec.finalEdits`): a line of a part rewritten or taken out, by
 * where it stood (`at`, from 0 among the part's lines) and what it said (`line`), or text added at
 * the part's end. Texts are as the narrator reads them, neutralized as every engine text is; one
 * that holds several lines adds them all.
 */
export type FinalEdit =
  | { op: "replace"; part: string; at: number; line: string; text: string }
  | { op: "append"; part: string; text: string }
  | { op: "drop"; part: string; at: number; line: string };

const isAt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/** A turn's edits as stored: each well-formed one, in order; anything else (none, or written by another build) reads as none. */
export function finalEditsOf(raw: unknown): FinalEdit[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e): FinalEdit[] => {
    if (typeof e !== "object" || e === null || Array.isArray(e)) return [];
    const r = e as Record<string, unknown>;
    if (typeof r.part !== "string") return [];
    if (r.op === "append") return typeof r.text === "string" ? [{ op: "append", part: r.part, text: r.text }] : [];
    if (!isAt(r.at) || typeof r.line !== "string") return [];
    if (r.op === "drop") return [{ op: "drop", part: r.part, at: r.at, line: r.line }];
    return r.op === "replace" && typeof r.text === "string" ? [{ op: "replace", part: r.part, at: r.at, line: r.line, text: r.text }] : [];
  });
}

/** One edit on `part`, in place; false when the line it names isn't there. */
function applyOne(part: PromptPart, edit: FinalEdit): boolean {
  if (edit.op === "append") {
    part.lines.push(...edit.text.split("\n"));
    return true;
  }
  // A line still saying what it said where it stood is that one; else the first that says it.
  const i = part.lines[edit.at] === edit.line ? edit.at : part.lines.indexOf(edit.line);
  if (i < 0) return false;
  if (edit.op === "drop") part.lines.splice(i, 1);
  else part.lines.splice(i, 1, ...edit.text.split("\n"));
  return true;
}

/**
 * A turn's recorded edits told again on a prompt made from the same plan (a Re-narrate's): each in
 * order on the part it names, a line found where it stood or else where its words first stand.
 * `applied` are those that found their part and line; the rest (`missed`) change nothing.
 */
export function applyFinalEdits(parts: readonly PromptPart[], edits: readonly FinalEdit[]): { parts: PromptPart[]; applied: FinalEdit[]; missed: FinalEdit[] } {
  const out = parts.map((p) => ({ ...p, lines: [...p.lines] }));
  const applied: FinalEdit[] = [];
  const missed: FinalEdit[] = [];
  for (const edit of edits) {
    const part = out.find((p) => p.id === edit.part);
    if (part && applyOne(part, edit)) applied.push(edit);
    else missed.push(edit);
  }
  return { parts: out, applied, missed };
}

/** A part as a turn's record keeps it (`Rec.finalParts`): the fingerprint of its text as the engine made it. */
export function partHash(part: PromptPart): string {
  return hashParts("lre.final-part", part.id, partText(part));
}

/** A turn's parts as stored: each part id with its fingerprint; anything else (none, or another build's) reads as none. */
export function finalPartsOf(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/**
 * A review scoped to what changed (Settings → Agents → Main agent → Final review, while Smart
 * persistence is on): each part that reads as it did when the last turn's review saw it (`last.parts`)
 * gets that review's edits made again (`kept`, with those that found their line in `applied`), and
 * only the parts that changed are sent (`changed`), in the prompt's order.
 */
export function changedScope(parts: readonly PromptPart[], last: { parts: Readonly<Record<string, string>>; edits: readonly FinalEdit[] }): { kept: PromptPart[]; applied: FinalEdit[]; changed: PromptPart[] } {
  const same = new Set(parts.filter((p) => last.parts[p.id] === partHash(p)).map((p) => p.id));
  const told = applyFinalEdits(parts.filter((p) => same.has(p.id)), last.edits.filter((e) => same.has(e.part)));
  return { kept: told.parts, applied: told.applied, changed: parts.filter((p) => !same.has(p.id)).map((p) => ({ ...p, lines: [...p.lines] })) };
}

/** Why the review's draft refused an edit: no such part, no such line (`line`, the number given that its part doesn't have), or no text. */
export type DraftRefusal = { refused: "part" } | { refused: "line"; part: PromptPart; line: number } | { refused: "text" };

/**
 * An edit the draft made: its part as it reads now, and where the edit stands in it, from line `at`
 * (from 0) for `count` lines, the lines its text made; a take-out's count is none, where the lines
 * it took out stood before what is line `at` now.
 */
export interface DraftChange {
  part: PromptPart;
  at: number;
  count: number;
}

/**
 * The prompt as the review edits it: its parts, and each edit made, in order. A line is named by its
 * number as its part reads now (from 1), a block of lines by its first and last (in either order).
 * Text is taken as the narrator will read it: line breaks kept, blank lines at either end left out,
 * neutralized, and cut to `maxChars` with "…". A block's edit is recorded line by line, as edits of
 * one line each, so the record and its telling again (`applyFinalEdits`) know no blocks. Each edit
 * says where it stands (`DraftChange`), so its answer can show it with the lines around it.
 */
export class ReviewDraft {
  private readonly current: PromptPart[];
  private readonly made: FinalEdit[] = [];

  constructor(
    parts: readonly PromptPart[],
    private readonly maxChars: number,
  ) {
    this.current = parts.map((p) => ({ ...p, lines: [...p.lines] }));
  }

  get parts(): readonly PromptPart[] {
    return this.current;
  }

  get edits(): readonly FinalEdit[] {
    return this.made;
  }

  part(id: string): PromptPart | undefined {
    return this.current.find((p) => p.id === id);
  }

  /** Line `n`, or the block from it to line `to`, rewritten with `text`, whose lines take its place together. */
  replace(id: string, n: number, text: string, to = n): DraftChange | DraftRefusal {
    const found = this.block(id, n, to);
    if ("refused" in found) return found;
    const clean = this.clean(text);
    if (clean === null) return { refused: "text" };
    const { part, at, count } = found;
    const line = part.lines[at] ?? "";
    // Its own words again change nothing; the rest of a block goes, from after what took its place.
    const made = clean === line ? 1 : clean.split("\n").length;
    if (clean !== line) this.edit({ op: "replace", part: id, at, line, text: clean }, part);
    for (let i = 1; i < count; i++) this.edit({ op: "drop", part: id, at: at + made, line: part.lines[at + made] ?? "" }, part);
    return { part, at, count: made };
  }

  append(id: string, text: string): DraftChange | DraftRefusal {
    const part = this.part(id);
    if (!part) return { refused: "part" };
    const clean = this.clean(text);
    if (clean === null) return { refused: "text" };
    const at = part.lines.length;
    this.edit({ op: "append", part: id, text: clean }, part);
    return { part, at, count: part.lines.length - at };
  }

  /** Line `n`, or the block from it to line `to`, taken out. */
  drop(id: string, n: number, to = n): DraftChange | DraftRefusal {
    const found = this.block(id, n, to);
    if ("refused" in found) return found;
    const { part, at, count } = found;
    for (let i = 0; i < count; i++) this.edit({ op: "drop", part: id, at, line: part.lines[at] ?? "" }, part);
    return { part, at, count: 0 };
  }

  /** The lines from `n` through `to`, whichever comes first, of part `id` as it reads now: where they start (from 0) and how many; refused naming the first number given that the part doesn't have. */
  private block(id: string, n: number, to: number): { part: PromptPart; at: number; count: number } | DraftRefusal {
    const part = this.part(id);
    if (!part) return { refused: "part" };
    const missing = [n, to].find((x) => !(Number.isSafeInteger(x) && x >= 1 && x <= part.lines.length));
    if (missing !== undefined) return { refused: "line", part, line: missing };
    const first = Math.min(n, to);
    return { part, at: first - 1, count: Math.max(n, to) - first + 1 };
  }

  private edit(edit: FinalEdit, part: PromptPart): void {
    applyOne(part, edit);
    this.made.push(edit);
  }

  private clean(text: string): string | null {
    const trimmed = text.replace(/\r\n?/g, "\n").replace(/^\s*\n|\n\s*$/g, "");
    if (trimmed.trim() === "") return null;
    const fit = trimmed.length <= this.maxChars ? trimmed : `${trimmed.slice(0, Math.max(0, this.maxChars - 1))}…`;
    return neutralizeMacros(fit);
  }
}

// ---------------------------------------------------------------- what the review is sent

/**
 * The review's tools, by name; it hands its prompt back with the main agent's `commit`. A turn the
 * main agent decides offers them in every stage, where they refuse, so every call of the turn is
 * offered the same tools and reads the prefix the last one cached (DESIGN §4.6).
 */
export const REVIEW_TOOLS = { replace: "review_replace", append: "review_append", drop: "review_drop", read: "review_read", commit: "commit" } as const;

/** How many lines an edit's answer shows either side of what it changed (`REVIEW_TEXT.edited`, `dropped`): review_read shows a part whole. */
export const AROUND_EDIT = 2;

/** The review's text ids, so code names them once. */
export const REVIEW_TEXT = {
  system: "main.review.system",
  stage: "main.review.stage",
  stageMain: "main.review.stage.main",
  stageFixed: "main.review.stage.fixed",
  part: "main.review.part",
  line: "main.review.line",
  empty: "main.review.empty",
  tool: (name: string): string => `main.tool.${name}`,
  toolArg: (name: string, arg: string): string => `main.tool.${name}.${arg}`,
  commit: "main.review.commit",
  edited: "main.review.edited",
  dropped: "main.review.dropped",
  refusedPart: "main.review.refused.part",
  refusedLine: "main.review.refused.line",
  refusedText: "main.review.refused.text",
  refusedStage: "main.review.refused.stage",
  committed: "main.review.committed",
  committedNone: "main.review.committed.none",
} as const;

const page = MAIN_AGENT_PAGE.id;
const GROUP = "Final review";

const v = (name: string, text: string, required?: true): PromptVar => (required ? { name, text, required } : { name, text });

const PART_VAR = v("part", "the part's id, as the review lists it");

/** Every text the final review sends, on the Main agent page. */
export const FINAL_REVIEW_PROMPTS: readonly PromptDef[] = [
  {
    id: REVIEW_TEXT.system,
    page,
    group: GROUP,
    label: "System prompt, on the fixed pipeline",
    note: "Who the main agent is when the fixed pipeline runs a chat's turns and the main agent works only their final review. With a main agent deciding, it keeps its own system prompt.",
    text: "You are the main agent for {{world}}, a roleplay world that LumiRPEngine keeps; {{pov}} is the player character. In this chat the engine and its role agents work each turn on a fixed pipeline, and you do one job in it: before the narrator writes each reply, you review what the narrator will be given and fix what is wrong. You never write the story yourself: the narrator writes each reply from the prompt you hand it.\n\nYour tools read the world as it stands. Each turn's task says what changed since your last review and gives you your pinned files.",
    vars: [v("world", "the world's name"), v("pov", "the player character's name")],
  },
  {
    id: REVIEW_TEXT.stage,
    page,
    group: GROUP,
    label: "The review",
    note: "What the main agent is sent for the final review: what the review is for and how it works (it may fix, rewrite or take out an Outcome or Montage line: the ledger keeps what the engine did, and the edit is kept with the turn), then the prompt the narrator gets, part by part, each line numbered.",
    text: "{{stage}}\nBefore the narrator writes its reply, review the prompt it gets: the engine's sections below, the Outline and its brief among them, and the narrator rules, as the narrator will read them. Check each line against the world as it stands and this turn: a fact that is wrong, one the reply needs that is missing, lines that contradict each other, guidance that would lead the narrator astray, a secret told as known where it should stay marked. The player's own words and rules come first: never undo what they asked for.\n\nThe Outcome and the Montage tell what the engine did this turn, which its ledger keeps whatever you do here. Where one of their lines is wrong, misread or would jar the story (a payment or a change the story never set up, a line the player would take for something else), you may fix it, rewrite it or take it out to put it right; check it against the world first, with your tools where you have them (money_balances says where a standing payment came from). Your edit changes only what the narrator is told, and is kept with the turn.\n\nChange only what needs it: review_replace rewrites a line, review_append adds lines at the end of a part, review_drop takes a line out, and with to, review_replace and review_drop take the whole block from line through to in one call. Each names a line by its number as its part reads now, and answers with the lines around its edit, numbered as its part reads after it; review_read shows a part whole. A fact's line starts with \"- \". Then call commit, which hands the narrator the prompt as you leave it; with nothing to fix, call commit at once.\n\n{{parts}}",
    vars: [v("stage", "where the review stands in the turn, in the words below"), v("parts", "each part of the prompt, as below", true)],
  },
  { id: REVIEW_TEXT.stageMain, page, group: GROUP, label: "Where it stands: a main agent's turn", note: "Leads the review's message in a turn the main agent decides: the review is the start of the reply's stage.", text: "Stage 6 of 8: the narrator's reply.", vars: [] },
  { id: REVIEW_TEXT.stageFixed, page, group: GROUP, label: "Where it stands: the fixed pipeline", note: "Leads the review's message on the fixed pipeline, after the turn's task.", text: "The engine has planned this turn and its roles have done their work.", vars: [] },
  {
    id: REVIEW_TEXT.part,
    page,
    group: GROUP,
    label: "A part of the prompt",
    note: "One part of the narrator's prompt in the review's message and in review_read's answer: its id, which the tools take, its header as the narrator reads it, and its lines.",
    text: "Part {{part}}: {{header}}\n{{lines}}",
    vars: [v("part", "the part's id, as the tools take it", true), v("header", "its header as the narrator reads it, such as [Outcome], or its name when it has none"), v("lines", "its lines, each numbered as below", true)],
  },
  { id: REVIEW_TEXT.line, page, group: GROUP, label: "A numbered line", note: "One line of a part, with the number the review's tools name it by.", text: "{{n}}: {{text}}", vars: [v("n", "the line's number in its part, from 1", true), v("text", "the line as the narrator reads it", true)] },
  { id: REVIEW_TEXT.empty, page, group: GROUP, label: "A part with no lines", note: "Stands in for the lines of a part that has none left.", text: "(no lines)", vars: [] },
  { id: REVIEW_TEXT.tool(REVIEW_TOOLS.replace), page, group: GROUP, label: "review_replace: what it does", note: "The description of the review_replace tool.", text: "In the final review: rewrite a line of a part of the narrator's prompt, by its number as its part reads now, with your text in its place; with to, the whole block from line through to. Several lines in your text take its place together.", vars: [] },
  { id: REVIEW_TEXT.toolArg(REVIEW_TOOLS.replace, "part"), page, group: GROUP, label: "review_replace: part", note: "The description of review_replace's part argument.", text: "The part's id, as the review lists it.", vars: [] },
  { id: REVIEW_TEXT.toolArg(REVIEW_TOOLS.replace, "line"), page, group: GROUP, label: "review_replace: line", note: "The description of review_replace's line argument.", text: "The line's number, as its part reads now; with to, the block's first.", vars: [] },
  { id: REVIEW_TEXT.toolArg(REVIEW_TOOLS.replace, "to"), page, group: GROUP, label: "review_replace: to", note: "The description of review_replace's to argument: a block's last line.", text: "The block's last line, by its number as its part reads now, to rewrite every line from line through it as one; leave it out for line alone.", vars: [] },
  { id: REVIEW_TEXT.toolArg(REVIEW_TOOLS.replace, "text"), page, group: GROUP, label: "review_replace: text", note: "The description of review_replace's text argument.", text: "The line as the narrator should read it, whole.", vars: [] },
  { id: REVIEW_TEXT.tool(REVIEW_TOOLS.append), page, group: GROUP, label: "review_append: what it does", note: "The description of the review_append tool.", text: "In the final review: add lines at the end of a part of the narrator's prompt, what the reply needs that the part doesn't say.", vars: [] },
  { id: REVIEW_TEXT.toolArg(REVIEW_TOOLS.append, "part"), page, group: GROUP, label: "review_append: part", note: "The description of review_append's part argument.", text: "The part's id, as the review lists it.", vars: [] },
  { id: REVIEW_TEXT.toolArg(REVIEW_TOOLS.append, "text"), page, group: GROUP, label: "review_append: text", note: "The description of review_append's text argument.", text: "The line to add, as the narrator should read it; one per line break for several.", vars: [] },
  { id: REVIEW_TEXT.tool(REVIEW_TOOLS.drop), page, group: GROUP, label: "review_drop: what it does", note: "The description of the review_drop tool.", text: "In the final review: take a line out of a part of the narrator's prompt, by its number as its part reads now; with to, the whole block from line through to.", vars: [] },
  { id: REVIEW_TEXT.toolArg(REVIEW_TOOLS.drop, "part"), page, group: GROUP, label: "review_drop: part", note: "The description of review_drop's part argument.", text: "The part's id, as the review lists it.", vars: [] },
  { id: REVIEW_TEXT.toolArg(REVIEW_TOOLS.drop, "line"), page, group: GROUP, label: "review_drop: line", note: "The description of review_drop's line argument.", text: "The line's number, as its part reads now; with to, the block's first.", vars: [] },
  { id: REVIEW_TEXT.toolArg(REVIEW_TOOLS.drop, "to"), page, group: GROUP, label: "review_drop: to", note: "The description of review_drop's to argument: a block's last line.", text: "The block's last line, by its number as its part reads now, to take out every line from line through it; leave it out for line alone.", vars: [] },
  { id: REVIEW_TEXT.tool(REVIEW_TOOLS.read), page, group: GROUP, label: "review_read: what it does", note: "The description of the review_read tool: an edit's answer shows only the lines around it.", text: "In the final review: read a part of the narrator's prompt whole, each line numbered as its part reads now. An edit answers with the lines around it alone.", vars: [] },
  { id: REVIEW_TEXT.toolArg(REVIEW_TOOLS.read, "part"), page, group: GROUP, label: "review_read: part", note: "The description of review_read's part argument.", text: "The part's id, as the review lists it.", vars: [] },
  { id: REVIEW_TEXT.commit, page, group: GROUP, label: "commit, in the review: what it does", note: "The description of the commit tool in the final review: the whole of it when the main agent works the review alone; after commit's own (Tools) in a turn a main agent decides, whose every stage offers the same tools.", text: "In the final review: hand the narrator the prompt as your edits leave it, and end the review.", vars: [] },
  { id: REVIEW_TEXT.edited, page, group: GROUP, label: "An edit made", note: `review_replace's and review_append's answer: the lines the edit made, with up to ${AROUND_EDIT} either side, each numbered as its part reads after it. review_read shows a part whole.`, text: "Done. Part {{part}} now has {{count}} {{lines}}; around your edit it reads:\n{{excerpt}}", vars: [PART_VAR, v("count", "how many lines the part has now"), v("lines", '"line" for 1, else "lines"'), v("excerpt", "the lines around the edit, each numbered as the review numbers lines", true)] },
  { id: REVIEW_TEXT.dropped, page, group: GROUP, label: "Lines taken out", note: `review_drop's answer: up to ${AROUND_EDIT} lines either side of where the lines it took out stood, each numbered as its part reads after it. review_read shows a part whole.`, text: "Done. Part {{part}} now has {{count}} {{lines}}; around the cut it reads:\n{{excerpt}}", vars: [PART_VAR, v("count", "how many lines the part has now"), v("lines", '"line" for 1, else "lines"'), v("excerpt", "the lines either side of where the lines stood, each numbered as the review numbers lines", true)] },
  { id: REVIEW_TEXT.refusedPart, page, group: GROUP, label: "No such part", note: "An edit's answer when no part of the prompt has the id it gave.", text: "No part of the narrator's prompt has the id {{part}}. Its parts are {{parts}}.", vars: [PART_VAR, v("parts", "every part's id")] },
  { id: REVIEW_TEXT.refusedLine, page, group: GROUP, label: "No such line", note: "review_replace's and review_drop's answer for a line number, or a block's last (to), that its part doesn't have.", text: "Part {{part}} has no line {{line}}: it has {{count}} {{lines}}.", vars: [PART_VAR, v("line", "the number given"), v("count", "how many lines it has"), v("lines", '"line" for 1, else "lines"')] },
  { id: REVIEW_TEXT.refusedText, page, group: GROUP, label: "No text", note: "review_replace's and review_append's answer when the text given is empty.", text: "Give the line's text: an empty one says nothing. review_drop takes a line out.", vars: [] },
  { id: REVIEW_TEXT.refusedStage, page, group: GROUP, label: "Not in this stage", note: "A review tool's answer in any other stage of a turn a main agent decides: every stage offers the same tools, so that each call reads the prefix the provider cached, and the review's tools work only in the review.", text: "{{tool}} edits the narrator's prompt, and works only in the final review that opens stage 6, once the engine has made the prompt. In this stage, run the roles you want, then call commit.", vars: [v("tool", "the tool called")] },
  { id: REVIEW_TEXT.committed, page, group: GROUP, label: "Committed", note: "commit's answer in the final review, once it edited the prompt.", text: "Committed. The narrator gets the prompt with your {{count}} {{edits}}.", vars: [v("count", "how many edits the review made", true), v("edits", '"edit" for 1, else "edits"')] },
  { id: REVIEW_TEXT.committedNone, page, group: GROUP, label: "Committed, unchanged", note: "commit's answer in the final review when it edited nothing.", text: "Committed. The narrator gets the prompt as the engine made it.", vars: [] },
];
