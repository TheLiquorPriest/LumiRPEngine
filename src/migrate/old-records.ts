// What today's build recorded on each reply it played, kept beside the turn that became of it
// (`imported_record`, STANDALONE-PLAN §15.2 l.1615, Appendix B) and read-only: the swipe's record as it
// was, and every text it names in either blob store (the agents engine's sessions, summaries and
// transcripts; LumiAH's segments, transcripts, summaries, kept segments and jobs' reports), word for
// word, so an old reply's Turn page shows what the old engine did. A text today's clean-up had removed
// is kept as missing, by its path, and the report lists it. Nothing here writes outside the migration's
// own table, and the table's columns stay as they were: the record column holds the record with its
// `texts` laid beside it.

import type { Database } from "bun:sqlite";
import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { Rec } from "../shared/ledger";
import type { ChatEngine } from "./chats";
import { blobPath, recordParts } from "./inside";
import { chatRecord } from "./tables";
import type { Today } from "./today";

/** One text a record names: the part of the record that names it, where it was in user storage, and its words (null: today's clean-up had removed it). */
export interface OldText {
  part: string;
  path: string;
  text: string | null;
}

/** The parts of a record that hold what an old engine recorded on a reply, by name: what the sessions row counts. */
export const OLD_FIELDS = ["session", "agents", "memoryNext", "finalEdits", "finalParts", "prompts", "diag", "harness"] as const;

/** What a carried turn's row holds: the record as today's build kept it, and the texts it names. */
type Kept = Record<string, JsonValue> & { texts?: OldText[] };

function parsed(text: string): Kept | null {
  try {
    const raw = JSON.parse(text) as unknown;
    return isRecord(raw) && !Array.isArray(raw) ? (raw as Kept) : null;
  } catch {
    return null;
  }
}

/** How many rows are written in one go: a chat's texts are read, kept and let go in slices of it. */
const SLICE = 100;

/**
 * Keeps, beside each imported turn of `chats`, the words of every text its record names, read from
 * the user's storage as today's build keeps them. Answers how many turns hold texts, how many texts
 * were kept, and the paths of those that were no longer there.
 */
export async function attachTexts(today: Today, db: Database, user: string, chats: readonly string[]): Promise<{ turns: number; texts: number; missing: string[] }> {
  const out = { turns: 0, texts: 0, missing: new Set<string>() };
  const select = db.query<{ turn: string; record: string }, [string, string]>("SELECT turn, record FROM imported_record WHERE user = ? AND chat = ? ORDER BY rowid");
  const update = db.query("UPDATE imported_record SET record = ? WHERE user = ? AND turn = ?");
  for (const chat of chats) {
    const rows = select.all(user, chat);
    for (let from = 0; from < rows.length; from += SLICE) {
      const writes: [string, string][] = [];
      for (const row of rows.slice(from, from + SLICE)) {
        const rec = parsed(row.record);
        if (rec === null) continue;
        const parts = recordParts(rec as unknown as Rec);
        if (parts.length === 0) continue;
        const texts: OldText[] = [];
        for (const p of parts) {
          const path = blobPath(p.store, p.hash);
          const text = await today.userView.read(path);
          if (text === null) out.missing.add(path);
          else out.texts++;
          texts.push({ part: p.part, path, text });
        }
        out.turns++;
        writes.push([row.turn, JSON.stringify({ ...rec, texts })]);
      }
      db.transaction(() => {
        for (const [turn, record] of writes) update.run(record, user, turn);
      })();
    }
  }
  return { turns: out.turns, texts: out.texts, missing: [...out.missing].sort() };
}

/** What an old reply's Turn page shows of it: which engine played it, what the old engine recorded by name, the texts it names, and why it stood unplayed and where it said something against its turn. */
export interface OldRecord {
  turn: string;
  chat: string;
  message: string;
  swipe: number;
  /** The engine that played the chat, as today's build had it; null where it was not read. */
  engine: ChatEngine | null;
  fields: { name: string; value: JsonValue }[];
  texts: OldText[];
  /** Why the reply stood with no turn played (stopped, failed, restarted); null where a turn was played. */
  unplayed: string | null;
  /** Each line where the reply says something against what its turn decided. */
  departures: string[];
}

function oldOf(db: Database, user: string, row: { turn: string; chat: string; message: string; swipe: number; record: string }): OldRecord {
  const rec = parsed(row.record) ?? {};
  const harness = isRecord(rec.harness) && !Array.isArray(rec.harness) ? rec.harness : {};
  const departures = Array.isArray(harness.departures) ? harness.departures.filter((d): d is string => typeof d === "string") : [];
  return {
    turn: row.turn,
    chat: row.chat,
    message: row.message,
    swipe: row.swipe,
    engine: chatRecord(db, user, row.chat)?.carried.engine ?? null,
    fields: OLD_FIELDS.flatMap((name) => (rec[name] === undefined ? [] : [{ name, value: rec[name] as JsonValue }])),
    texts: Array.isArray(rec.texts) ? rec.texts : [],
    unplayed: typeof harness.unplayed === "string" ? harness.unplayed : null,
    departures,
  };
}

/** What the old engine recorded on an imported turn, whole; null for a turn no run carried. */
export function oldRecord(db: Database, user: string, turn: string): OldRecord | null {
  if (!hasRecords(db)) return null;
  const row = db.query<{ turn: string; chat: string; message: string; swipe: number; record: string }, [string, string]>("SELECT turn, chat, message, swipe, record FROM imported_record WHERE user = ? AND turn = ?").get(user, turn);
  return row === null ? null : oldOf(db, user, row);
}

/** One imported turn in a chat's list: what it is tied to, the engine, and how much of the old record it holds. */
export interface OldListed {
  turn: string;
  message: string;
  swipe: number;
  engine: ChatEngine | null;
  unplayed: string | null;
  departures: number;
  texts: number;
}

/** A chat's imported turns, in the order the run imported them (a reply's swipes after the replies before it), `limit` of them from the `from`th. */
export function oldRecords(db: Database, user: string, chat: string, page: { from: number; limit: number }): { turns: OldListed[]; total: number } {
  if (!hasRecords(db)) return { turns: [], total: 0 };
  const total = db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM imported_record WHERE user = ? AND chat = ?").get(user, chat)?.n ?? 0;
  const rows = db.query<{ turn: string; chat: string; message: string; swipe: number; record: string }, [string, string, number, number]>("SELECT turn, chat, message, swipe, record FROM imported_record WHERE user = ? AND chat = ? ORDER BY rowid LIMIT ? OFFSET ?").all(user, chat, page.limit, page.from);
  return {
    total,
    turns: rows.map((r) => {
      const o = oldOf(db, user, r);
      return { turn: o.turn, message: o.message, swipe: o.swipe, engine: o.engine, unplayed: o.unplayed, departures: o.departures.length, texts: o.texts.length };
    }),
  };
}

/** Whether the database holds the migration's records at all (a database no migration touched holds none). */
function hasRecords(db: Database): boolean {
  return (db.query<{ n: number }, []>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'imported_record'").get()?.n ?? 0) > 0;
}
