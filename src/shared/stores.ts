// The agent stores' shared formats (DESIGN §4.4; AGENT-LOOP-PLAN §3.3-3.5, §4): a blob's address and
// a workspace file's path, which the backend's stores, the workspace's events in the engine and the
// sweep all read; and how long the stores keep what nothing needs (Settings → Agents → Retention).

import { hashParts } from "./hash";
import { isRecord, safeKey } from "./json";
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
 * Whether `v` reads as a workspace file's path (`notes/marcus.md`, `.pins.json`): names joined by
 * `/`, none empty, `.` or `..`. A path is only a key (in the workspace's index in engine state and
 * in the learned index): a file's body is stored by its hash, never under its path.
 */
export function isWorkspacePath(v: unknown): v is string {
  if (!safeKey(v)) return false;
  return v.split("/").every((name) => name !== "." && name !== ".." && PATH_SEGMENT.test(name));
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

/** How long the agent stores keep what nothing needs (Settings → Agents → Retention). */
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
}

export const RETENTION_DEFAULTS: Readonly<RetentionSettings> = Object.freeze({ transcriptDays: 30, unreferencedDays: 7, sweepHours: 24 });

/** `UserSettings.retention` as stored: each part a whole number from its floor, with no ceiling, else `base`'s. */
export function retentionOf(raw: unknown, base: Readonly<RetentionSettings> = RETENTION_DEFAULTS): RetentionSettings {
  const r = isRecord(raw) ? raw : {};
  const days = r.unreferencedDays;
  return {
    transcriptDays: limitIn(r.transcriptDays, 0, Number.MAX_SAFE_INTEGER, base.transcriptDays),
    unreferencedDays: typeof days === "number" && Number.isInteger(days) && days >= 0 ? days : base.unreferencedDays,
    sweepHours: limitIn(r.sweepHours, 1, Number.MAX_SAFE_INTEGER, base.sweepHours),
  };
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
