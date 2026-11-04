// The agent stores' shared formats (DESIGN §4.4; AGENT-LOOP-PLAN §3.3-3.5, §4): a blob's address, a
// workspace file's path at either level (the chat's, or the user's global workspace under `~/`), the
// system files every agent is told, a file kept apart from the story, which the backend's stores,
// the workspace's events in the engine, the sweep and GM → Workspace all read; and how long the
// stores keep what nothing needs (Settings → Agents → Retention).

import { hashParts } from "./hash";
import { isRecord, type JsonObject, safeKey } from "./json";
import { limitIn, type Limit } from "./minds";

/**
 * A blob's address: the content hash of its text (`shared/hash.ts`, a fixed value of §16), so the
 * same text is the same blob in every chat of the user's, and a blob is never changed in place.
 */
export function blobHash(text: string): string {
  return hashParts("lre.blob", text);
}

const BLOB_HASH = /^[0-9a-f]{32}$/;

/** Whether `v` reads as a blob's address: 32 lowercase hex digits, as `blobHash` writes them. */
export function isBlobHash(v: unknown): v is string {
  return typeof v === "string" && BLOB_HASH.test(v);
}

/** One name of a workspace path: words of letters, digits, `.`, `_` and `-`, single spaces between them. */
const PATH_SEGMENT = /^[\p{L}\p{N}._-]+(?: [\p{L}\p{N}._-]+)*$/u;

/**
 * Whether `v` reads as a chat workspace file's path (`notes/marcus.md`, `.pins.json`): names joined
 * by `/`, none empty, `.` or `..`. A path is only a key (in the workspace's index in engine state and
 * in the learned index): a file's body is stored by its hash, never under its path. No name holds
 * `~`, so no chat path is a global one (`isGlobalPath`).
 */
export function isWorkspacePath(v: unknown): v is string {
  if (!safeKey(v)) return false;
  return v.split("/").every((name) => name !== "." && name !== ".." && PATH_SEGMENT.test(name));
}

/**
 * The user's global workspace's mark (DESIGN §4.4): a path under `~/` (`~/AGENTS.md`,
 * `~/notes/style.md`) is a file every chat of theirs shares, kept in their storage beside the blobs
 * (`backend/global-workspace.ts`), never in a chat's ledger or metadata.
 */
export const GLOBAL_PREFIX = "~/";

export function isGlobalPath(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(GLOBAL_PREFIX) && isWorkspacePath(v.slice(GLOBAL_PREFIX.length));
}

/** Whether `v` reads as a path of either level's workspace: the chat's, or the global one's. */
export function isFilePath(v: unknown): v is string {
  return isWorkspacePath(v) || isGlobalPath(v);
}

/** A path without its level's mark: the global workspace's own name for one of its files, a chat path as it is. */
export function levelPath(path: string): string {
  return path.startsWith(GLOBAL_PREFIX) ? path.slice(GLOBAL_PREFIX.length) : path;
}

/**
 * The system files (DESIGN §4.4): `AGENTS.md`, every agent's instructions, and `roles/<role>.md`,
 * one role's (`main` for the main agent, `assistant` for the GM assistant, a turn role by its id),
 * at each level, the global workspace's (`~/`) and the chat's. None ships: a file that isn't there,
 * or holds nothing, adds nothing.
 */
export const AGENTS_PATH = "AGENTS.md";
export const ROLES_DIR = "roles/";

/** `role`'s system files in the order its prompt is told them: the global workspace's, then the chat's, each `AGENTS.md` before the role's own. */
export function systemPaths(role: string): string[] {
  const own = `${ROLES_DIR}${role}.md`;
  return [`${GLOBAL_PREFIX}${AGENTS_PATH}`, `${GLOBAL_PREFIX}${own}`, AGENTS_PATH, own];
}

/** Whether a path at either level is a system file: `AGENTS.md`, or a file of `roles/` named `<role>.md`. */
export function isSystemPath(path: string): boolean {
  const at = levelPath(path);
  return at === AGENTS_PATH || (at.startsWith(ROLES_DIR) && at.endsWith(".md") && !at.slice(ROLES_DIR.length).includes("/"));
}

/**
 * The learned area's folder (AGENT-LOOP-PLAN §4): a workspace file under it is kept in the chat's
 * metadata (`backend/chat-agent-meta.ts`), not its ledger, so a swipe, a Re-run or an Undo never
 * changes it and a Branch copies it as it stands.
 */
export const LEARNED_DIR = "learned/";

export function isLearnedPath(path: string): boolean {
  return path.startsWith(LEARNED_DIR);
}

/** Whether a file at `path` is kept apart from the story (`KeptFile`): the learned area's, or the global workspace's. */
export function isKeptPath(path: string): boolean {
  return isLearnedPath(path) || isGlobalPath(path);
}

/**
 * A file kept apart from the story (DESIGN §4.4), the learned area's (`learned/`, in the chat's
 * metadata) or the global workspace's (`~/`, in the user's storage): its body's hash, whether it is
 * pinned, and the role that wrote it last. A swipe, a Re-run or an Undo never changes one.
 */
export interface KeptFile {
  hash: string;
  pinned?: true;
  role?: string;
}

/** A kept file as stored; null when it doesn't read. An earlier build's `readers` is read and ignored. */
export function keptFileOf(raw: unknown): KeptFile | null {
  if (!isRecord(raw) || !isBlobHash(raw.hash)) return null;
  if ((raw.pinned !== undefined && raw.pinned !== true) || (raw.role !== undefined && typeof raw.role !== "string")) return null;
  return { hash: raw.hash, ...(raw.pinned === true ? { pinned: true as const } : {}), ...(typeof raw.role === "string" ? { role: raw.role } : {}) };
}

/** A kept file as its store writes it. */
export function keptFileJson(file: KeptFile): JsonObject {
  return { hash: file.hash, ...(file.pinned ? { pinned: true } : {}), ...(file.role !== undefined ? { role: file.role } : {}) };
}

/** The pins manifest's path in the chat's workspace (a stored name, §16.7): which files each role is shown first (`backend/agents/turn-task.ts`). */
export const PINS_PATH = ".pins.json";

/**
 * The turns' transcripts' folder (DESIGN §4.6): a read-only area GM → Workspace lists, one file for
 * each reply on the chat's chain whose turn record keeps a transcript the user's retention keeps
 * (`RetentionSettings.turnTranscripts`, `turnTranscriptDays`), so the files follow the chat's path as
 * its workspace does. Every agent reads them; nothing writes, moves, deletes or pins a file under it,
 * and none is a pin or part of the main session.
 */
export const TRANSCRIPTS_DIR = "transcripts/";

export function isTranscriptPath(path: string): boolean {
  return path.startsWith(TRANSCRIPTS_DIR);
}

/** The transcript of the reply at `turn` on the chain (1-based): `transcripts/reply-0004.md`, the number padded so the list reads in order. */
export function transcriptPath(turn: number): string {
  return `${TRANSCRIPTS_DIR}reply-${String(turn).padStart(4, "0")}.md`;
}

/** How long the agent stores keep what nothing needs, and which of the turns' transcripts each chat keeps (Settings → Agents → Retention). */
export interface RetentionSettings {
  /** Days Diagnostics keeps an agent call's text after the call; "none" keeps it as long as its record. */
  transcriptDays: Limit;
  /**
   * Days a blob nothing references is kept, counted from the first sweep that found it so; a later
   * sweep removes it once they have passed. A referenced blob is never removed.
   */
  unreferencedDays: number;
  /** Hours between sweeps of unreferenced blobs; "none" never sweeps. No sweep runs while a turn does. */
  sweepHours: Limit;
  /**
   * The turns' transcripts (GM → Live's, under `transcripts/`) a chat keeps: its latest this many
   * replies' ("none", the default: every one). One past it is listed no more and nothing references
   * it, so a sweep removes it once nothing else needs it.
   */
  turnTranscripts: Limit;
  /** Days a turn's transcript is kept after it was written; "none", the default, keeps it however old. */
  turnTranscriptDays: Limit;
}

export const RETENTION_DEFAULTS: Readonly<RetentionSettings> = Object.freeze({ transcriptDays: 30, unreferencedDays: 7, sweepHours: 24, turnTranscripts: "none", turnTranscriptDays: "none" });

/** `UserSettings.retention` as stored: each part a whole number from its floor, with no ceiling, else `base`'s. */
export function retentionOf(raw: unknown, base: Readonly<RetentionSettings> = RETENTION_DEFAULTS): RetentionSettings {
  const r = isRecord(raw) ? raw : {};
  const days = r.unreferencedDays;
  return {
    transcriptDays: limitIn(r.transcriptDays, 0, Number.MAX_SAFE_INTEGER, base.transcriptDays),
    unreferencedDays: typeof days === "number" && Number.isInteger(days) && days >= 0 ? days : base.unreferencedDays,
    sweepHours: limitIn(r.sweepHours, 1, Number.MAX_SAFE_INTEGER, base.sweepHours),
    turnTranscripts: limitIn(r.turnTranscripts, 1, Number.MAX_SAFE_INTEGER, base.turnTranscripts),
    turnTranscriptDays: limitIn(r.turnTranscriptDays, 1, Number.MAX_SAFE_INTEGER, base.turnTranscriptDays),
  };
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
