// What RPE keeps of a chat a run could not carry (the owner's ruling of 18 Nov: "if a chat can't be carried we need to know why and fix
// it"): one file a chat in RPE's data folder (`migration-failures/`), readable by the owner's account alone, kept until a run carries the
// chat or he removes it. It holds the stage the run was at (reading the previous build's records, its fold, RPE's store taking what the
// fold gave, the check against the previous build's state), the error's own message and its stack (where in RPE's code it was raised),
// the world and revision the chat plays, and where in the chat's records it stood: the message (its id and its place in the chat) and
// swipe, and the record of the ledger by its place and its kind, described by its shape alone (its keys, and the type and size of each
// value, never its content: the owner's chats are his, and whoever mends the code needs the shape); and where that record is in the
// previous build's files, so that he can look at it himself.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ownerOnlyFolder, writeWhole } from "../app/disk";
import type { Unreadable } from "./inside";
import type { StorageView } from "./stand-in";
import type { ChainMessage } from "../engine/ledger/chain";
import { isRecord, type JsonValue } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";

/** Where in its work the run was when a chat failed: reading the previous build's records, its fold, RPE's store taking what the fold gave, or the check against the previous build's state. */
export type FailureStage = "read" | "fold" | "store" | "check";

/** Where the record that broke is in the previous build's files: the store it is in, the file on the disk, the row (a message's id in Lumiverse's `messages` table), and its place there (a JSON path), then inside the decoded record. */
export interface FailureFile {
  store: "lumiverse-database" | "user-storage" | "runtime-copy";
  path: string;
  row: string | null;
  at: string;
  inside: string | null;
}

/** What RPE keeps of one chat a run could not carry. */
export interface ChatFailure {
  format: 1;
  chat: string;
  /** When the run that met it read the previous build's data. */
  at: string;
  stage: FailureStage;
  /** The error's own name and message, and its stack: where in RPE's code it was raised. */
  error: { name: string; message: string; stack: string | null };
  /** The world and revision the chat plays; null where its metadata names none. */
  world: { id: string; revision: string } | null;
  /** The message the run stood at: its id, its place in the chat (the first message is 1) and the swipe; null where it stood at none. */
  message: { id: string; number: number; swipe: number } | null;
  /** The record of the ledger that broke, by its place in the message's engine record and its kind (an event's type, `record` for a swipe's whole record), and its shape. */
  record: { place: string; kind: string; shape: JsonValue } | null;
  file: FailureFile | null;
}

/** A failure as a run finds it, before it is kept with the run's time. */
export type FoundFailure = Omit<ChatFailure, "format" | "at">;

/** The folder of the records, in RPE's data folder `root`. */
export function failuresFolder(root: string): string {
  return join(root, "migration-failures");
}

/** The record of chat `chat`'s failure, in RPE's data folder `root`. */
export function failureFile(root: string, chat: string): string {
  return join(failuresFolder(root), `${encodeURIComponent(chat)}.json`);
}

/** Keeps a chat's failure, over any an earlier run kept of it; the file it is in. */
export async function keepFailure(root: string, failure: ChatFailure): Promise<string> {
  await ownerOnlyFolder(failuresFolder(root));
  const file = failureFile(root, failure.chat);
  await writeWhole(file, `${JSON.stringify(failure, null, 2)}\n`);
  return file;
}

/** A chat's kept failure; null where none is kept (or the file is not one this build wrote). */
export function readFailure(root: string, chat: string): ChatFailure | null {
  const file = failureFile(root, chat);
  if (!existsSync(file)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isRecord(raw) && raw.format === 1 && raw.chat === chat ? (raw as unknown as ChatFailure) : null;
  } catch {
    // He may have edited or emptied it: it reads as kept, with nothing known of it.
    return null;
  }
}

/** The chats whose failure is kept in RPE's data folder `root`, in the order of their ids. */
export function failedChats(root: string): string[] {
  const folder = failuresFolder(root);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith(".json"))
    .map((name) => decodeURIComponent(name.slice(0, -".json".length)))
    .sort();
}

/** Closes a chat's kept failure, once a run carried the chat: when the run that kept it was (null where the file no longer says), or null where none was kept. */
export async function closeFailure(root: string, chat: string): Promise<{ at: string | null } | null> {
  const file = failureFile(root, chat);
  if (!existsSync(file)) return null;
  const was = readFailure(root, chat);
  await rm(file, { force: true });
  return { at: was?.at ?? null };
}

/** What a real run could not read of the previous build's files (`MigrationReport.unreadable`), kept with the error each met where one was met: nothing in them was carried. */
export interface UnreadFiles {
  format: 1;
  /** When the run read the previous build's data. */
  at: string;
  files: { path: string; why: string; error: ChatFailure["error"] | null }[];
}

/** The record of what the last real run could not read, in RPE's data folder `root`: beside the chats' records, in a folder of its own. */
export function unreadFile(root: string): string {
  return join(failuresFolder(root), "files", "unread.json");
}

/** Keeps what a run could not read, over what an earlier run kept; where it read everything, removes the record. */
export async function keepUnread(root: string, unread: UnreadFiles): Promise<void> {
  const file = unreadFile(root);
  if (unread.files.length === 0) {
    await rm(file, { force: true });
    return;
  }
  await ownerOnlyFolder(failuresFolder(root));
  await ownerOnlyFolder(dirname(file));
  await writeWhole(file, `${JSON.stringify(unread, null, 2)}\n`);
}

/**
 * Every file this run read as JSON that does not read, by its path as the report names it, with the parser's error: in the user's and the
 * extension's storage (`StorageView.json`), and in the runtime's folders (`RuntimeRead.damaged`).
 */
export function damagedOf(today: { userView: StorageView; extensionView: StorageView; runtime: { damaged: ReadonlyMap<string, unknown> } }): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const view of new Set([today.userView, today.extensionView])) for (const [path, error] of view.damaged) out.set(`${view.where}: ${path}`, error);
  for (const [path, error] of today.runtime.damaged) out.set(path, error);
  return out;
}

/** The files of `damaged` (`damagedOf`) not already among `listed`, each in fixed words: the parser's own words can quote the file, and the report holds no content. */
export function notReadAsJson(damaged: ReadonlyMap<string, unknown>, listed: readonly Unreadable[]): Unreadable[] {
  const named = new Set(listed.map((u) => u.path));
  return [...damaged.keys()].filter((path) => !named.has(path)).map((path) => ({ path, why: "it does not read as JSON, so nothing in it is carried" }));
}

/** An error's own name, message and stack. */
export function errorOf(error: unknown): ChatFailure["error"] {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack ?? null };
  return { name: typeof error, message: String(error), stack: null };
}

/** A value's shape: its type and size, and for a list or an object what it holds, `depth` levels down; never a value's content. */
export function shapeOf(value: unknown, depth = 2): JsonValue {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "string") return { type: "text", size: value.length };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "whole" : "number" };
  if (typeof value === "boolean") return { type: "yes-no" };
  if (Array.isArray(value)) return depth <= 0 ? { type: "list", size: value.length } : { type: "list", size: value.length, items: value.slice(0, 3).map((v) => shapeOf(v, depth - 1)) };
  if (typeof value === "object") {
    const entries = Object.entries(value);
    return depth <= 0 ? { type: "object", size: entries.length } : { type: "object", size: entries.length, keys: Object.fromEntries(entries.slice(0, 40).map(([key, v]) => [key, shapeOf(v, depth - 1)])) };
  }
  return { type: typeof value };
}

/** What the fold was handling when it failed: an event (the same object as in the record), or only the type it asked for where it knew no such type; null where it was handling none. */
export type FoldHandling = { event: LedgerEvent } | { type: string } | null;

/**
 * The record of the ledger that broke, found in `chain` (the chain the fold was given): the event it was handling, by the same object in a
 * swipe's record or one of its post entries, where it handled one; else, where it knew only the type it asked for, the first event of that
 * type in the message's own swipe (`at`, `swipe`); else that swipe's whole record. Its message's place in the chain and its swipe come with it.
 */
export function brokenRecord(chain: readonly ChainMessage[], at: number, swipe: number, handling: FoldHandling): { index: number; swipe: number; place: string; kind: string; value: unknown } | null {
  const order = [at, ...chain.keys()].filter((i, n, all) => all.indexOf(i) === n);
  for (const index of order) {
    const swipes = chain[index]?.ledger?.swipes ?? {};
    const own = index === at ? [[String(swipe), swipes[String(swipe)]] as const, ...Object.entries(swipes)] : Object.entries(swipes);
    for (const [s, rec] of own) {
      if (rec === undefined) continue;
      const found = (ev: LedgerEvent): boolean => (handling !== null && "event" in handling ? ev === handling.event : handling !== null && ev.type === handling.type && index === at);
      const i = rec.events.findIndex(found);
      if (i >= 0) return { index, swipe: Number(s), place: `swipes.${s}.events[${i}]`, kind: rec.events[i]?.type ?? "", value: rec.events[i] };
      for (const [j, p] of rec.post.entries()) {
        const k = p.events.findIndex(found);
        if (k >= 0) return { index, swipe: Number(s), place: `swipes.${s}.post[${j}].events[${k}]`, kind: p.events[k]?.type ?? "", value: p.events[k] };
      }
    }
  }
  const rec = chain[at]?.ledger?.swipes[String(swipe)];
  return rec === undefined ? null : { index: at, swipe, place: `swipes.${swipe}`, kind: "record", value: rec };
}
