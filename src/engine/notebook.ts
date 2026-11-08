// The author's notebook (DEPTH-PLAN §4.5): the author's own files about what the story means and
// where it points, in the chat's workspace under `notebook/` (`engine.ws.write`, blobs). Beside each
// revision the author makes rides `engine.notebook`: the files it wrote and their bodies' hashes, how
// deep the revision went, the chapter it closed, if any, and the author's account of it, so the engine knows what
// the author last wrote of each file. A file whose body isn't what the author last wrote was edited
// by the player (GM → Notebook, a GM edit with Undo): it is pinned, and the author may comment on it
// but never rewrites it, as no agent rewrites a character's `core.md`. A chat that never had a
// notebook holds no key, so it folds as before. Pure.

import { isRecord, type JsonObject } from "../shared/json";
import type { MessageId } from "../shared/ids";
import type { PackEvent } from "../shared/ledger";
import { isBlobHash, isWorkspacePath } from "../shared/stores";
import type { EventTypeDef, Rejection } from "./registry";
import type { WorldState } from "./state";
import { own } from "./pack-kit";
import { engineSlice } from "./scope";
import { workspaceOf } from "./workspace";

export const NOTEBOOK_REVISE = "engine.notebook";
/** Where the notebook's files live in the chat's workspace. */
export const NOTEBOOK_DIR = "notebook/";
/** The engine's state-slice key for the notebook's bookkeeping. */
const NOTEBOOK_KEY = "notebook";

/** How deep a revision went (§4.5): a light touch after a turn or a chunk, a scene's end, a chapter's re-read. */
export const NOTEBOOK_KINDS = ["light", "scene", "chapter"] as const;
export type NotebookKind = (typeof NOTEBOOK_KINDS)[number];

/** A chapter the author closed: its place among the chapters (from 0), its title, and the last message it holds. */
export interface NotebookChapter {
  index: number;
  title: string;
  through: MessageId | null;
  at: number;
}

/** `engine.notebook`: one revision's bookkeeping, beside its `engine.ws.write` events. */
export interface NotebookEventData {
  kind: NotebookKind;
  /** Each file the author wrote, path → its body's hash. */
  files: Record<string, string>;
  /** The latest message the revision read. */
  through: MessageId | null;
  /** The chapter this revision closed. */
  chapter?: { index: number; title: string };
  /** The author's own account of what moved and why, in a few lines (its whole thinking rides with the layer entry). */
  reason?: string;
  /** The author's comments on files the player pinned, path → words. */
  comments?: Record<string, string>;
}

/** The notebook's bookkeeping in a state: what the author last wrote of each file, and the chapters it closed. */
export interface NotebookState {
  authored: Record<string, string>;
  chapters: NotebookChapter[];
}

export function notebookEvent(data: NotebookEventData): PackEvent {
  return { type: NOTEBOOK_REVISE, data: data as unknown as JsonObject };
}

export function isNotebookPath(v: unknown): v is string {
  return isWorkspacePath(v) && v.startsWith(NOTEBOOK_DIR) && v.length > NOTEBOOK_DIR.length;
}

/** The notebook's bookkeeping in this state; empty in a chat that never had one. */
export function notebookOf(state: Readonly<WorldState>): NotebookState {
  const raw = engineSlice(state)[NOTEBOOK_KEY];
  const out: NotebookState = { authored: {}, chapters: [] };
  if (!isRecord(raw)) return out;
  if (isRecord(raw.authored)) for (const [path, hash] of Object.entries(raw.authored)) if (isNotebookPath(path) && isBlobHash(hash)) out.authored[path] = hash;
  if (Array.isArray(raw.chapters)) out.chapters = raw.chapters.filter((c): c is NotebookChapter & JsonObject => isRecord(c) && typeof c.index === "number" && typeof c.title === "string" && typeof c.at === "number").map((c) => ({ index: c.index, title: c.title, through: typeof c.through === "string" ? c.through : null, at: c.at }));
  return out;
}

/**
 * The notebook's files in this state, path → body hash, each with whether the player pinned it: a
 * file whose body isn't the one the author last wrote, or one only the player wrote.
 */
export function notebookFiles(state: Readonly<WorldState>): { path: string; hash: string; pinned: boolean }[] {
  const { authored } = notebookOf(state);
  return Object.entries(workspaceOf(state))
    .filter(([path]) => isNotebookPath(path))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, hash]) => ({ path, hash, pinned: own(authored, path) !== hash }));
}

function bad(reason: string): Rejection {
  return { code: "bad_event", reason };
}

/**
 * `engine.notebook`: the author's revision. Each file it names is under `notebook/` with a stored
 * body; a chapter it closes comes next after the last one closed; its account, if any, is words.
 */
export const notebookReviseEvent: EventTypeDef<PackEvent> = {
  type: NOTEBOOK_REVISE,
  validate: (e, ctx) => {
    const d = e.data;
    if (typeof d.kind !== "string" || !(NOTEBOOK_KINDS as readonly string[]).includes(d.kind)) return bad("a notebook revision is a light touch, a scene's end or a chapter's re-read");
    if (!isRecord(d.files) || !Object.entries(d.files).every(([path, hash]) => isNotebookPath(path) && isBlobHash(hash))) return bad("a notebook revision names files under notebook/, each with a stored body");
    if (!(d.through === null || (typeof d.through === "string" && d.through !== ""))) return bad("a notebook revision names the latest message it read, or none");
    if (d.reason !== undefined && typeof d.reason !== "string") return bad("a notebook revision's account is words");
    if (d.comments !== undefined && !(isRecord(d.comments) && Object.entries(d.comments).every(([path, words]) => isNotebookPath(path) && typeof words === "string"))) return bad("a notebook revision's comments are words on notebook files");
    if (d.chapter !== undefined) {
      const c = d.chapter;
      if (!isRecord(c) || typeof c.title !== "string" || c.title.trim() === "" || typeof c.index !== "number" || !Number.isInteger(c.index)) return bad("a chapter has its place and a title");
      if (c.index !== notebookOf(ctx.state).chapters.length) return bad("a chapter closes after the one before it");
    }
    return null;
  },
  apply: (e, state) => {
    const d = e.data;
    if (!isRecord(d.files)) return;
    // Copies, as a state the fold shares with a snapshot may hold the ones there.
    const s = state.packs.engine ?? {};
    state.packs.engine = s;
    const prev = isRecord(s[NOTEBOOK_KEY]) ? (s[NOTEBOOK_KEY] as JsonObject) : {};
    const authored: JsonObject = isRecord(prev.authored) ? { ...prev.authored } : {};
    for (const [path, hash] of Object.entries(d.files)) if (isNotebookPath(path) && isBlobHash(hash)) authored[path] = hash;
    const chapters = Array.isArray(prev.chapters) ? [...prev.chapters] : [];
    const c = d.chapter;
    if (isRecord(c) && typeof c.title === "string" && typeof c.index === "number") chapters.push({ index: c.index, title: c.title, through: typeof d.through === "string" ? d.through : null, at: state.clock });
    s[NOTEBOOK_KEY] = { authored, ...(chapters.length > 0 ? { chapters } : {}) };
  },
  describe: (e, _ctx, viewer) => {
    if (viewer !== undefined) return "";
    const d = e.data;
    const n = isRecord(d.files) ? Object.keys(d.files).length : 0;
    const chapter = isRecord(d.chapter) && typeof d.chapter.title === "string" ? `, closing the chapter “${d.chapter.title}”` : "";
    return `The author revised ${n === 1 ? "a notebook file" : `${n} notebook files`}${chapter}`;
  },
};
