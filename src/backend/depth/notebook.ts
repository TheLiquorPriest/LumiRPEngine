// The author's notebook and its reading of the history (DEPTH-PLAN §4.5, §8.1 step 5). The author
// reads a chat's history in order, each stretch's prose beside its distilled beats, revises its
// notebook lightly per stretch and deeply at the chapter ends it decides, feeds the player-intent
// section from the history's signals, and decides who gets a mind. Each revision is `engine.ws.write`
// events for the files it changed and `engine.notebook` beside them (`engine/notebook.ts`); a file
// the player edited is pinned, and the author is shown his edit and may comment on it but never
// rewrites it. GM → Notebook reads it all (`notebookView`), and a player's edit is a GM edit with
// Undo (`notebookEditOps`).

import type { EntityId, MessageId } from "../../shared/ids";
import type { PackEvent, WorkspaceOp } from "../../shared/ledger";
import type { PromptTexts } from "../../shared/prompts";
import { DEPTH_TEXT } from "../../shared/depth-prompts";
import { AUTHOR_DRIFT, AUTHOR_POLL, AUTHOR_PREDICT, AUTHOR_SCORE, authorData, DRIFT_LEVELS, driftEvent, predictEvent, predictionId, type DriftData, type DriftLevel, type PollData, type PredictData, type ScoreData } from "../../shared/author";
import type { DepthNotebookView, DepthPoll, DepthRevision } from "../../shared/depth-views";
import { draftOf, STORY_DRAFT } from "../../shared/episodes";
import type { WorldDoc } from "../../shared/world";
import { mindsV2Of, povOf } from "../../shared/character-engine";
import { lineDiff } from "../../shared/text-diff";
import { isNotebookPath, notebookEvent, notebookFiles, notebookOf, NOTEBOOK_REVISE, type NotebookEventData, type NotebookKind } from "../../engine/notebook";
import { own } from "../../engine/pack-kit";
import type { WorldState } from "../../engine/state";
import type { LiveEvent } from "../../engine/ledger/story";
import { isBlobHash } from "../../shared/stores";
import { wsWrite, WS_WRITE } from "../../engine/workspace";
import type { Runtime } from "../runtime";
import { answerWhy, askRole, bareId, beatLine, named, personNamed, putText, sameName, type BeatText, type Blobs, type Reading, type StageCost } from "./common";
import type { HistorianRow } from "./historian";
import type { ModelPort } from "./port";
import { depthOptedIn } from "../bootstrap/service";
import { chainNumbers } from "./chat-numbers";

/** The notebook as a revision reads it: each file's text, and the player's edits the author hasn't seen written by itself. */
export interface NotebookRead {
  files: Record<string, string>;
  /** Files the player edited since the author last wrote them, with the text the author last wrote ("" for one only he wrote). */
  pinned: { path: string; before: string; after: string }[];
  /** The player's own edits of characters' minds standing at the state (`mindEditsAt`): whose, which file, its text before and after; each a directive, as his notebook edits are. */
  minds?: { who: EntityId; path: string; before: string; after: string }[];
}

/** One person the story has met, as the author decides about them. */
export interface CastMember {
  id: EntityId;
  name: string;
  /** A character card seeds their core (D-17). */
  card: boolean;
  /** They have a mind already. */
  mind: boolean;
}

export interface AuthorReadInput {
  world: WorldDoc;
  state: Readonly<WorldState>;
  texts: PromptTexts;
  /** The stretch's prose, oldest first. */
  chunk: readonly HistorianRow[];
  /** The beats the historian distilled from it. */
  beats: readonly BeatText[];
  notebook: NotebookRead;
  /** The chapter the stretch falls in: its place among chapters (from 0), and how many stretches of it came before. */
  chapter: { index: number; stretches: number };
  cast: readonly CastMember[];
  /** What the player did beyond his words, where the history shows it: swipes and which reply he kept, edits, Regenerates. */
  signals?: readonly string[];
  signal?: AbortSignal;
}

export interface AuthorChapterInput {
  world: WorldDoc;
  state: Readonly<WorldState>;
  texts: PromptTexts;
  /** The chapter the author closed: its place, its title, and the last message it holds. */
  chapter: { index: number; title: string; through: MessageId | null };
  /** The chapter's beats, whole, in order. */
  beats: readonly BeatText[];
  notebook: NotebookRead;
  cast: readonly CastMember[];
  signal?: AbortSignal;
}

export interface AuthorResult extends StageCost {
  /** The revision: a write per changed file, then its `engine.notebook` (none when nothing moved); a chapter's re-read then adds its drift checks and predictions. */
  events: PackEvent[];
  blobs: Blobs;
  uncertain: string[];
  /** What of the answer couldn't be made, and why (a pinned file it tried to rewrite, a path outside the notebook). */
  refused: string[];
}

export interface AuthorReadResult extends AuthorResult {
  /** Whether the stretch ends a chapter, and its title. */
  chapter: { ends: boolean; title: string | null };
  /** Who gets a mind, and why; `core` seeds one without a card, marked for the player's review. */
  cast: { who: EntityId; mind: boolean; why: string; core?: string }[];
}

function notebookData(notebook: NotebookRead): string {
  const pinned = new Set(notebook.pinned.map((p) => p.path));
  const files = Object.entries(notebook.files)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, text]) => `### ${path}${pinned.has(path) ? " (pinned: the player's own words)" : ""}\n${text}`);
  const edits = notebook.pinned.map((p) => `### ${p.path}\nYou last wrote:\n${p.before || "(nothing: he wrote this file)"}\nHe made it:\n${p.after}`);
  return [`Your notebook:\n\n${files.join("\n\n") || "(empty: this is its start)"}`, ...(edits.length > 0 ? [`The player edited your notebook (each a directive):\n\n${edits.join("\n\n")}`] : []), ...mindEditsText(notebook)].join("\n\n");
}

/**
 * The player's own edits of characters' minds standing at a state (§4.4, §7: a mind edit is a
 * directive): every mind file whose latest write is his (`pinnedBy`'s mode; `now.md` until the next
 * play moves it on), with the text before his edit (`MindFileMeta.was`) and after.
 */
export async function mindEditsAt(get: (hash: string) => Promise<string | null>, state: Readonly<WorldState>): Promise<NonNullable<NotebookRead["minds"]>> {
  const out: NonNullable<NotebookRead["minds"]> = [];
  const byKey = <T>(a: [string, T], b: [string, T]): number => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  for (const [who, mind] of Object.entries(mindsV2Of(state).minds).sort(byKey)) {
    for (const [path, m] of Object.entries(mind.files).sort(byKey)) {
      if (m.mode !== "user") continue;
      out.push({ who, path, before: m.was ? ((await get(m.was)) ?? "") : "", after: (await get(m.hash)) ?? "" });
    }
  }
  return out;
}

/** The most changed lines a mind edit's diff shows the author; past it, how many more there are is said. */
const MIND_DIFF_LINES = 24;

/** The player's mind edits as the author reads them, beside his notebook edits: whose mind, which file, and a short line diff. */
export function mindEditsText(notebook: NotebookRead): string[] {
  const edits = (notebook.minds ?? []).map((e) => {
    const changed = lineDiff(e.before, e.after).filter((l) => l.kind !== "same");
    const lines = changed.slice(0, MIND_DIFF_LINES).map((l) => `${l.kind === "del" ? "-" : "+"} ${l.text}`);
    if (changed.length > MIND_DIFF_LINES) lines.push(`(${changed.length - MIND_DIFF_LINES} more changed lines)`);
    return `### ${e.who}: ${e.path}${e.before === "" ? " (new: he wrote this file)" : ""}\n${lines.join("\n") || "(no change)"}`;
  });
  return edits.length > 0 ? [`The player edited characters' minds (each a directive):\n\n${edits.join("\n\n")}`] : [];
}

function castData(world: WorldDoc, state: Readonly<WorldState>, cast: readonly CastMember[]): string {
  // The player character in force (D-10): the one the player switched to last, else the world's.
  const pov = povOf(world, state);
  return cast.map((c) => `- ${c.name} [${c.id}]${c.id === pov ? " (the player character: the player's own, never given a mind while he plays him)" : `${c.mind ? ", has a mind" : ""}${c.card ? ", has a card" : ", no card"}`}`).join("\n") || `- ${named(world, state, pov)}`;
}

/** How the author changes a notebook file: adds to its end, rewrites one section (by its heading), or writes it whole (a new file, or one it reshapes throughout). */
export const NOTEBOOK_EDITS = ["append", "section", "whole"] as const;
export type NotebookEdit = (typeof NOTEBOOK_EDITS)[number];

/** A heading line's depth and its title, compared without case or the space around it. */
function headingOf(line: string): { depth: number; title: string } | null {
  const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
  return m ? { depth: (m[1] as string).length, title: (m[2] as string).trim().toLowerCase() } : null;
}

/**
 * A file's text after one of the author's edits (bookkeeping: the author decided the edit). `append`
 * adds the text at the file's end. `section` replaces the section headed `section` (written with or
 * without its #s): from under its heading to the next heading as deep or shallower; a text that opens
 * with that same heading replaces the heading too. A file without that section gains it at its end.
 * `whole` is the file's whole new text.
 */
export function editNotebookFile(current: string, edit: { edit: NotebookEdit; section?: string; text: string }): string {
  if (edit.edit === "whole") return edit.text;
  const text = edit.text.trim();
  if (edit.edit === "append") return current.trim() === "" ? `${text}\n` : `${current.trimEnd()}\n\n${text}\n`;
  const title = (edit.section ?? "").trim();
  const heading = title.startsWith("#") ? title : `## ${title}`;
  const want = headingOf(heading)?.title;
  const textLines = text.split("\n");
  // A text that opens with the section's own heading carries it; otherwise the section keeps the heading it has.
  const carries = headingOf(textLines[0] ?? "")?.title === want;
  const lines = current.split("\n");
  const at = lines.findIndex((l) => headingOf(l)?.title === want);
  if (at < 0) return editNotebookFile(current, { edit: "append", text: carries ? text : `${heading}\n${text}` });
  const depth = headingOf(lines[at] as string)?.depth ?? 2;
  const next = lines.findIndex((l, k) => k > at && (headingOf(l)?.depth ?? 7) <= depth);
  const after = next < 0 ? [] : lines.slice(next);
  return [...lines.slice(0, at), ...(carries ? textLines : [lines[at] as string, ...textLines]), "", ...after].join("\n");
}

/** The revision an answer's files, comments and account make, at `kind`, closing `chapter` if given; refusals for what it may not write. */
function revision(answer: Record<string, unknown>, read: Reading, notebook: NotebookRead, kind: NotebookKind, through: MessageId | null, chapter: { index: number; title: string } | null): { events: PackEvent[]; blobs: Blobs; refused: string[] } {
  const blobs: Blobs = {};
  const refused: string[] = [];
  const pinned = new Set(notebook.pinned.map((p) => p.path));
  const files: Record<string, string> = {};
  const events: PackEvent[] = [];
  // Each edit applies to the file as the edits before it left it: a second edit to a file builds on the first.
  const texts = new Map<string, string>();
  for (const [i, raw] of read.list("files", answer.files).entries()) {
    const f = read.record(`files[${i}]`, raw);
    if (!f) continue;
    // An edit with neither a path nor a text isn't made.
    if (typeof f.path !== "string" || f.path.trim() === "" || typeof f.text !== "string" || f.text.trim() === "") {
      read.drop(`files[${i}]`, f);
      continue;
    }
    const path = f.path.trim();
    if (!isNotebookPath(path)) {
      refused.push(`a file outside the notebook: ${path}`);
      continue;
    }
    if (pinned.has(path)) {
      refused.push(`${path} is pinned (the player's edit): it may be commented on, never rewritten`);
      continue;
    }
    const how = typeof f.edit === "string" && (NOTEBOOK_EDITS as readonly string[]).includes(f.edit) ? (f.edit as NotebookEdit) : "whole";
    if (f.edit !== undefined && how !== f.edit) read.change(`files[${i}].edit`, f.edit, how, "it isn't an edit the notebook takes");
    const section = typeof f.section === "string" ? f.section : "";
    if (how === "section" && section.trim() === "") {
      read.drop(`files[${i}]`, f, "a section's edit names no section");
      continue;
    }
    texts.set(path, editNotebookFile(texts.get(path) ?? own(notebook.files, path) ?? "", { edit: how, section, text: f.text }));
  }
  for (const [path, text] of texts) {
    if (own(notebook.files, path) === text) continue;
    files[path] = putText(blobs, text);
    events.push(wsWrite(path, files[path]));
  }
  const comments: Record<string, string> = {};
  for (const [i, raw] of read.list("comments", answer.comments).entries()) {
    const c = read.record(`comments[${i}]`, raw);
    if (!c) continue;
    const path = read.text(`comments[${i}].path`, c.path);
    const text = read.text(`comments[${i}].text`, c.text);
    // A comment is for a file the player pinned.
    if (pinned.has(path) && text !== "") comments[path] = text;
    else read.drop(`comments[${i}]`, c);
  }
  const reason = answerWhy(answer);
  if (events.length > 0 || Object.keys(comments).length > 0 || chapter) {
    const data: NotebookEventData = { kind, files, through, ...(chapter ? { chapter } : {}), ...(reason !== "" ? { reason } : {}), ...(Object.keys(comments).length > 0 ? { comments } : {}) };
    events.push(notebookEvent(data));
  }
  return { events, blobs, refused };
}

/** The author reads one stretch of the history: a light revision, whether a chapter ends, and who gets a mind. */
export async function authorRead(input: AuthorReadInput, model: ModelPort): Promise<AuthorReadResult> {
  const { world, state } = input;
  const prose = input.chunk.map((m) => `[${m.id}] ${m.isUser ? `${m.name} (the player)` : m.name}:\n${m.text}`).join("\n\n");
  // What changes least comes first, so consecutive calls share their prompt's opening (the provider's cache): the cast, then the notebook, then the stretch.
  const data = [
    `The people the story has met:\n${castData(world, state, input.cast)}`,
    notebookData(input.notebook),
    `This stretch is ${input.chapter.stretches === 0 ? "the first" : `number ${input.chapter.stretches + 1}`} of chapter ${input.chapter.index + 1}.`,
    ...(input.signals && input.signals.length > 0 ? [`What the player did beyond his words:\n${input.signals.map((s) => `- ${s}`).join("\n")}`] : []),
    `The beats the historian distilled from it:\n${input.beats.map((b) => beatLine(world, state, b)).join("\n") || "- (none)"}`,
    `The stretch as it was written:\n\n${prose}`,
  ].join("\n\n");
  const asked = await askRole(model, "author", DEPTH_TEXT.authorRead, { world, state, texts: input.texts, data, ...(input.signal ? { signal: input.signal } : {}) });
  const { answer: a, read } = asked;
  const through = input.chunk[input.chunk.length - 1]?.id ?? null;
  const rev = revision(a, read, input.notebook, "light", through, null);
  const ch = read.record("chapter", a.chapter);
  const ends = ch ? read.flag("chapter.ends", ch.ends) : false;
  const title = ends ? (ch ? read.text("chapter.title", ch.title) : "") || `Chapter ${input.chapter.index + 1}` : null;
  const known = new Map(input.cast.map((c) => [c.id, c]));
  const pov = povOf(world, state);
  const cast: AuthorReadResult["cast"] = [];
  for (const [i, raw] of read.list("cast", a.cast).entries()) {
    const c = read.record(`cast[${i}]`, raw);
    if (!c) continue;
    const said = typeof c.who === "string" ? bareId(c.who) : "";
    // By its id, else the one member it names as an answer may write a name (`sameName`).
    const byName = known.has(said) ? [] : input.cast.filter((m) => sameName(said, m.name));
    const who = byName.length === 1 ? (byName[0]?.id ?? said) : said;
    const member = known.get(who);
    // The player character never gets a mind (D-10); someone not of the cast, or named twice, is left out.
    if (!member || cast.some((x) => x.who === who)) {
      read.drop(`cast[${i}]`, c);
      continue;
    }
    if (who === pov) continue;
    const mind = read.flag(`cast[${i}].mind`, c.mind);
    const core = mind && !member.card && !member.mind ? read.text(`cast[${i}].core`, c.core) : "";
    cast.push({ who, mind, why: read.text(`cast[${i}].why`, c.why), ...(core !== "" ? { core } : {}) });
  }
  return { ...rev, uncertain: read.texts("uncertain", a.uncertain), chapter: { ends, title }, cast, ...(asked.reasoning ? { reasoning: asked.reasoning } : {}), ...(asked.usage ? { usage: asked.usage } : {}) };
}

/**
 * The author re-reads a chapter it closed: a deep revision of the notebook, which closes the chapter,
 * then its check of each character's arc against who they have become (`author.drift`) and its
 * predictions (`author.predict`, from the chapter), which the poll scores once the story goes on.
 */
export async function authorChapter(input: AuthorChapterInput, model: ModelPort): Promise<AuthorResult> {
  const { world, state } = input;
  const data = [
    `The people the story has met:\n${castData(world, state, input.cast)}`,
    notebookData(input.notebook),
    `Chapter ${input.chapter.index + 1}, “${input.chapter.title}”, has ended. Its beats, in order:\n${input.beats.map((b) => beatLine(world, state, b)).join("\n") || "- (none)"}`,
  ].join("\n\n");
  const asked = await askRole(model, "author", DEPTH_TEXT.authorChapter, { world, state, texts: input.texts, data, ...(input.signal ? { signal: input.signal } : {}) });
  const { answer: a, read } = asked;
  const rev = revision(a, read, input.notebook, "chapter", input.chapter.through, { index: input.chapter.index, title: input.chapter.title });
  // The player character is the player's: he has no arc to drift from.
  const pov = povOf(world, state);
  const checked = new Set<string>();
  const drift: PackEvent[] = [];
  for (const [i, raw] of read.list("drift", a.drift).entries()) {
    const d = read.record(`drift[${i}]`, raw);
    if (!d) continue;
    const who = typeof d.who === "string" ? personNamed(state, d.who) : null;
    const level = typeof d.drift === "string" && (DRIFT_LEVELS as readonly string[]).includes(d.drift) ? (d.drift as DriftLevel) : null;
    // A check of no one in the world, at no level it knows, or of someone checked already, is left out.
    if (who === null || level === null || checked.has(who)) {
      read.drop(`drift[${i}]`, d);
      continue;
    }
    if (who === pov) continue;
    checked.add(who);
    drift.push(driftEvent({ who, drift: level, note: read.text(`drift[${i}].note`, d.note) }));
  }
  const predictions = read.list("predictions", a.predictions).flatMap((raw, i): PackEvent[] => {
    const p = read.record(`predictions[${i}]`, raw);
    const text = p ? read.text(`predictions[${i}].text`, p.text) : "";
    if (!p || text === "") return [];
    const about = [
      ...new Set(
        read.list(`predictions[${i}].about`, p.about).flatMap((x, k) => {
          const who = typeof x === "string" ? personNamed(state, x) : null;
          if (who === null) read.drop(`predictions[${i}].about[${k}]`, x);
          return who ?? [];
        }),
      ),
    ];
    return [predictEvent({ id: predictionId("chapter", String(input.chapter.index), input.chapter.through ?? "", String(i)), text, about, from: "chapter" })];
  });
  return { ...rev, events: [...rev.events, ...drift, ...predictions], uncertain: read.texts("uncertain", a.uncertain), ...(asked.reasoning ? { reasoning: asked.reasoning } : {}), ...(asked.usage ? { usage: asked.usage } : {}) };
}

/** The notebook in `state` as a revision reads it: every file's text, and the player's edits. */
export async function readNotebook(rt: { readonly blobs: Pick<Runtime["blobs"], "get"> }, userId: string, state: Readonly<WorldState>): Promise<NotebookRead> {
  const { authored } = notebookOf(state);
  const out: NotebookRead = { files: {}, pinned: [] };
  for (const f of notebookFiles(state)) {
    const text = (await rt.blobs.get(userId, f.hash)) ?? "";
    out.files[f.path] = text;
    if (!f.pinned) continue;
    const was = own(authored, f.path);
    out.pinned.push({ path: f.path, before: was ? ((await rt.blobs.get(userId, was)) ?? "") : "", after: text });
  }
  const minds = await mindEditsAt((hash) => rt.blobs.get(userId, hash), state);
  return minds.length > 0 ? { ...out, minds } : out;
}

/**
 * GM → Notebook (§7): the author's files with whether the player pinned each, and every revision on
 * this chat's active chain, newest first, with its account and its text before and after: the
 * author's (`engine.notebook` beside its writes, in a turn's record or a layer entry) and the
 * player's own edits (a write with no revision beside it); every poll, newest first, with what it
 * considered and whether it raised it, the jobs it asked for (whom or what, by name: a draft or an
 * episode by its draft's words), its account and the author's whole reasoning (§6.4: they stay
 * readable); and the predictions the author made, newest first, each with how a later poll scored
 * it, open until one does (`shared/author.ts`). The chat is on depth when it opted in (as Drafts and
 * Treatments read it), or when its chain already has the author's work.
 */
export async function notebookView(rt: { readonly host: Runtime["host"]; readonly blobs: Pick<Runtime["blobs"], "get">; readonly ledger: Pick<Runtime["ledger"], "basisFor" | "foldAtBasis" | "chainBases" | "readEvents"> }, chatId: string, userId: string): Promise<DepthNotebookView> {
  const optedIn = await depthOptedIn(rt, chatId, userId);
  const basis = await rt.ledger.basisFor(chatId, userId);
  const head = basis ? await rt.ledger.foldAtBasis(chatId, userId, basis) : null;
  if (!head) return { on: optedIn, files: [], revisions: [], poll: [], predictions: [], drift: [] };
  const text = async (hash: string | undefined): Promise<string> => (hash ? ((await rt.blobs.get(userId, hash)) ?? "") : "");
  const order = await chainNumbers(rt.host, chatId, userId, (await rt.ledger.chainBases(chatId, userId)).map((b) => b.message));
  const live = await rt.ledger.readEvents(chatId, userId, [WS_WRITE, NOTEBOOK_REVISE, AUTHOR_POLL, AUTHOR_PREDICT, AUTHOR_SCORE, AUTHOR_DRIFT, STORY_DRAFT]);
  const containerOf = (from: LiveEvent["from"]): string => ("layer" in from ? `l:${from.layer}` : "post" in from ? `p:${from.post}` : `r:${from.rec}`);
  // What each container's revisions say the author wrote: a write among them is the author's; any other is the player's edit.
  const authored = new Set<string>();
  for (const l of live) if (l.event.type === NOTEBOOK_REVISE && "data" in l.event) for (const [path, hash] of Object.entries((l.event.data as unknown as NotebookEventData).files ?? {})) authored.add(`${containerOf(l.from)}\u0000${path}\u0000${hash}`);
  const revisions: DepthRevision[] = [];
  const polls: DepthPoll[] = [];
  // A poll's job names a draft or the episode it drafted: each by the draft's own words.
  const drafted = new Map<string, string>();
  for (const l of live) {
    const d = l.event.type === STORY_DRAFT && "data" in l.event ? draftOf(l.event.data) : null;
    if (!d) continue;
    // Its summary is a blob's hash; an old draft's, inline words.
    const summary = isBlobHash(d.summary) ? await text(d.summary) : d.summary;
    drafted.set(d.id, summary).set(d.episode.id, summary);
  }
  const nameOf = (who: EntityId): string => own(head.state.entities, who)?.name ?? who;
  const predictions = new Map<string, DepthNotebookView["predictions"][number]>();
  const drift: DepthNotebookView["drift"] = [];
  const last: Record<string, string> = {};
  const counts: Record<string, number> = {};
  for (const l of live) {
    const e = l.event;
    if (!("data" in e)) continue;
    const at = `after message ${order.get(l.from.messageId) ?? 0}`;
    const poll = authorData<PollData>(e, AUTHOR_POLL);
    if (poll) {
      const reasoning = l.reasoning === undefined ? "" : isBlobHash(l.reasoning) ? await text(l.reasoning) : l.reasoning;
      const jobs = poll.jobs.map((j) => ({ kind: j.kind, why: j.kind === "interview" ? [`Asked: ${j.question}`, j.why].filter((s) => s !== "").join(" · ") : j.why, subject: "who" in j ? nameOf(j.who) : "depth" in j ? (j.depth === "chapter" ? "Its re-read of the chapter" : "Its reflection on the scene") : "episode" in j ? (drafted.get(j.episode) ?? "An episode not drafted yet") : (drafted.get(j.draft) ?? "A draft no longer on the chain") }));
      polls.push({ at, considered: poll.considered.map((c) => ({ what: c.what, raised: c.raised, why: c.why })), jobs, note: await text(poll.note), reasoning });
      continue;
    }
    const predicted = authorData<PredictData>(e, AUTHOR_PREDICT);
    if (predicted) {
      predictions.set(predicted.id, { at, text: predicted.text, outcome: "pending", note: "" });
      continue;
    }
    const score = authorData<ScoreData>(e, AUTHOR_SCORE);
    if (score) {
      const p = predictions.get(score.prediction);
      if (p) Object.assign(p, { outcome: score.outcome, note: score.note });
      continue;
    }
    const checked = authorData<DriftData>(e, AUTHOR_DRIFT);
    if (checked) {
      drift.push({ at, who: nameOf(checked.who), drift: checked.drift, note: checked.note });
      continue;
    }
    if (e.type === NOTEBOOK_REVISE) {
      const d = e.data as unknown as NotebookEventData;
      const reasoning = d.reason ?? (l.reasoning === undefined ? "" : isBlobHash(l.reasoning) ? await text(l.reasoning) : l.reasoning);
      for (const [path, hash] of Object.entries(d.files ?? {})) {
        revisions.push({ id: `${containerOf(l.from)}:${l.at}:${path}`, path, at, kind: d.kind, reasoning, before: await text(own(last, path)), after: await text(hash) });
        last[path] = hash;
        counts[path] = (counts[path] ?? 0) + 1;
      }
      continue;
    }
    const path = e.data.path;
    const hash = e.data.hash;
    if (typeof path !== "string" || !isNotebookPath(path) || typeof hash !== "string") continue;
    if (!authored.has(`${containerOf(l.from)}\u0000${path}\u0000${hash}`)) {
      revisions.push({ id: `${containerOf(l.from)}:${l.at}:${path}`, path, at, kind: "user", reasoning: "", before: await text(own(last, path)), after: await text(hash) });
      last[path] = hash;
      counts[path] = (counts[path] ?? 0) + 1;
    }
  }
  const files: DepthNotebookView["files"] = [];
  for (const f of notebookFiles(head.state)) files.push({ path: f.path, text: await text(f.hash), pinned: f.pinned, revisions: counts[f.path] ?? 0 });
  return { on: optedIn || files.length > 0 || revisions.length > 0 || polls.length > 0 || predictions.size > 0 || drift.length > 0, files, revisions: revisions.reverse(), poll: polls.reverse(), predictions: [...predictions.values()].reverse(), drift: drift.reverse() };
}

/**
 * The player's edit of a notebook file as the GM editor's operations (`lre.edit`'s): its text kept
 * as a blob and written to the file. The caller runs them as any GM edit, with Undo; the file is
 * then pinned, and the author is shown the edit on its next revision.
 */
export async function notebookEditOps(rt: Pick<Runtime, "blobs">, userId: string, path: string, text: string): Promise<WorkspaceOp[]> {
  if (!isNotebookPath(path)) throw new Error(`not a notebook file: ${path}`);
  return [{ op: "ws_write", path, hash: await rt.blobs.put(userId, text) }];
}
