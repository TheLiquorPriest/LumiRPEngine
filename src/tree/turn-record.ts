// A turn's record (plan §5 `turn.json`): which message and which swipe the turn made (the swipe by its saved text's hash and
// its date, since swipe numbers shift when one is deleted), its parent turn and kind, its runs' timings and the tokens each
// agent spent, in all and per run. It is written at intake with what is known then, and completed when a run ends and when
// the turn's message is tied, each change merged into what the file holds under the file's one queue, so whichever lands
// first, none is lost: a field given replaces the one before, and a run is kept by its own id, a continue's beside the
// first, never over it. Retention orders turn folders by when the record says the turn was received (`retention.ts`).

import type { JsonValue, Scope } from "rp-harness/contract";
import { isRecord } from "../shared/json";
import type { TreeFiles } from "./files";

/** The record's file in a turn's folder. */
export const TURN_RECORD = "turn.json";

/** The message a turn made, and its swipe by what it is: its saved text's hash and its date. */
export interface TurnRecordMessage {
  id: string;
  hash: string | null;
  date: number | null;
}

/** Tokens: sent (cached ones among them), written, and read from the provider's cache. */
export interface TurnRecordTokens {
  in: number;
  out: number;
  cacheRead: number;
}

/** One run of the turn, by its own id: its kind, its timings (epoch milliseconds; null for a moment it never reached), and its tokens per agent and in all. */
export interface TurnRecordRun {
  run: string;
  kind: string;
  timings: { received: number; firstCall: number | null; firstWord: number | null; released: number | null; ended: number | null };
  tokens: { agents: Record<string, TurnRecordTokens>; all: TurnRecordTokens };
}

/** What a change adds to the record: facts of the turn by name (intake's), its message, and a run. */
export interface TurnRecordChange {
  fields?: Readonly<Record<string, JsonValue>>;
  message?: TurnRecordMessage;
  run?: TurnRecordRun;
}

/** The record as `old` holds it, with `change` merged in. */
export function mergedTurnRecord(old: string | null, change: TurnRecordChange): string {
  let held: unknown = null;
  try {
    held = old === null ? null : JSON.parse(old);
  } catch {
    // A record that is not JSON is made again from what is given.
  }
  const record: Record<string, unknown> = isRecord(held) ? { ...held } : {};
  Object.assign(record, change.fields ?? {});
  if (change.message !== undefined) record.message = change.message;
  if (change.run !== undefined) {
    const runs = Array.isArray(record.runs) ? record.runs.filter((r) => !(isRecord(r) && r.run === change.run?.run)) : [];
    record.runs = [...runs, change.run];
  }
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** Merges `change` into the record of the scope's turn: nothing where RPE knows no folder for the turn, and a throw where its write is refused. */
export async function mergeTurnRecord(files: TreeFiles, scope: Scope & { turn: string }, change: TurnRecordChange): Promise<void> {
  const places = await files.places(scope);
  if (places.turn === undefined) return;
  const result = await files.update(scope, `${places.turn}${TURN_RECORD}`, (old) => mergedTurnRecord(old, change));
  if (result.status !== "written") throw new Error(`The turn's ${TURN_RECORD} could not be written (${result.reason}).`);
}

/** When the record says its turn was received; null where it says nothing readable. */
export function receivedOf(text: string): number | null {
  try {
    const record: unknown = JSON.parse(text);
    return isRecord(record) && typeof record.received === "number" ? record.received : null;
  } catch {
    return null;
  }
}
