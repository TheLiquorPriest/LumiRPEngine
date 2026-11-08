// `story.record` (DEPTH-PLAN Round 2 item 1): an imported record, what a memory system the chat used
// before depth (LumiBooks) kept of a stretch of it, landed as a neutral layer entry at the stretch's
// last message, citing the messages it spans. It is evidence, never canon: no mind lives it and
// nothing reads it as a beat; reading the stretch deeply lands beats that replace it.

import type { MessageId } from "./ids";
import { hasOwn, isRecord } from "./json";
import type { JsonObject } from "./json";
import { isBlobHash } from "./stores";
import type { LbLevel } from "./bootstrap";

export const STORY_RECORD = "story.record";

export interface StoryRecord {
  /** The system it was imported from, and its entry's id there. */
  source: "lumibooks";
  entry: string;
  level: LbLevel;
  title: string;
  /** The messages it spans, by index from 0 on the path it was imported against, inclusive, and the first's and last's ids. */
  range: [number, number];
  from: MessageId;
  to: MessageId;
  /** Its text, as a blob. */
  text: string;
  /** Its keys, as its book kept them. */
  keys: string[];
  /** The entry it sits under in its book's tree. */
  parent?: string;
}

const LEVELS: Readonly<Record<LbLevel, true>> = { volume: true, arc: true, chapter: true };

export function recordProblem(data: unknown): string | null {
  if (!isRecord(data)) return "a record must be an object";
  if (data.source !== "lumibooks") return "a record names the system it was imported from";
  if (typeof data.entry !== "string" || data.entry === "") return "a record names its entry";
  if (typeof data.level !== "string" || !hasOwn(LEVELS, data.level)) return "a record is a volume, an arc or a chapter";
  if (typeof data.title !== "string") return "a record has a title";
  const r = data.range;
  if (!Array.isArray(r) || r.length !== 2 || !r.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0) || (r[0] as number) > (r[1] as number)) return "a record spans messages, first to last";
  if (typeof data.from !== "string" || data.from === "" || typeof data.to !== "string" || data.to === "") return "a record names its first and last messages";
  if (!isBlobHash(data.text)) return "a record's text must be a blob";
  if (!Array.isArray(data.keys) || data.keys.some((k) => typeof k !== "string")) return "a record's keys must be words";
  if (data.parent !== undefined && (typeof data.parent !== "string" || data.parent === "")) return "a record's parent is an entry";
  return null;
}

export function recordOf(data: unknown): StoryRecord | null {
  return recordProblem(data) === null ? (data as unknown as StoryRecord) : null;
}

/** The event (pack `story`): never grouped. */
export function recordEvent(record: StoryRecord): { type: typeof STORY_RECORD; data: JsonObject } {
  return { type: STORY_RECORD, data: record as unknown as JsonObject };
}

/** The blobs a record names (the sweep keeps them). */
export function recordBlobs(data: unknown): string[] {
  const r = recordOf(data);
  return r ? [r.text] : [];
}
