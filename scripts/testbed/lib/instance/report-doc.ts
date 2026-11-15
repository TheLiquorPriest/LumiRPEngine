// The test instance read back (`report.ts`), as one document: what the run was made on, the world
// part by part, and every row of STANDALONE-PLAN §15.2 with what today's build's own reads gave back.
// Its checks are the package's tests on the instance: a world part that holds nothing, a row with
// nothing read back, a read that failed. Its checksum is what the golden copy keeps beside it, so a
// restore can be shown to give back the same instance (`golden.sh`, the live runner).
//
// Every id sits under a key named `ids` and everything the model chose under a key named `played`:
// `compare.ts` sets the first aside and asks of the second only that it is there.

import { createHash } from "node:crypto";
import type { Json } from "../record";

export interface RowReport {
  /** The plan's words for the row. */
  today: string;
  made: string;
  via: string;
  found: number;
  facts: Json;
  played?: Json;
  ids?: Json;
  /** The read failed: its message. A row whose read failed fails the report. */
  error?: string;
  /** Why this row holds nothing on today's build by its own definition (RPE's own registration exists only once the new extension has run), or absent. */
  absentBy?: string;
}

export interface ReportDoc {
  run: {
    build: string | null;
    branch: string | null;
    lumiverse: string | null;
    ids: { owner: string | null; other: string | null };
  };
  world: {
    /** Entries in each part of the head revision's document (1 for a value, 0 for nothing). */
    parts: { [part: string]: number };
    empty: string[];
    /** Parts the document holds that today's build does not declare. */
    unknown: string[];
    /** How many revisions the world's history holds, and which one each chat plays (its number there; 0: not in the history). */
    revisions: number;
    played: { [chat: string]: number };
    draft: boolean;
    ids: Json;
  };
  rows: { [row: string]: RowReport };
}

/** Why the instance does not stand as the package requires: one line each; none when it does. */
export function failures(doc: ReportDoc): string[] {
  const out: string[] = [];
  for (const part of doc.world.empty) out.push(`the world's part "${part}" holds nothing`);
  for (const part of doc.world.unknown) out.push(`the world holds a part "${part}" the report does not know: add it to WORLD_PARTS`);
  if (doc.world.revisions === 0) out.push("the world's history holds no revision");
  for (const [chat, n] of Object.entries(doc.world.played)) if (n === 0) out.push(`the chat "${chat}" plays a revision the world's history does not hold`);
  for (const [id, row] of Object.entries(doc.rows)) {
    if (row.error !== undefined) out.push(`row "${id}": the read failed: ${row.error}`);
    else if (row.found === 0 && row.absentBy === undefined) out.push(`row "${id}" (${row.today}): nothing read back`);
  }
  return out;
}

/** The document as one canonical text: keys sorted at every depth, no spacing, so the same instance gives the same bytes. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as { [key: string]: unknown })
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The checksum the golden copy keeps beside it: sha256 of the canonical text. */
export function checksum(doc: ReportDoc): string {
  return createHash("sha256").update(canonical(doc)).digest("hex");
}
