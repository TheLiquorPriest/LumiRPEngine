// Changes to the migration fixture's "today's data", as today's build and Lumiverse would make them
// between two runs: a swipe's record written again (its harness and story parts lie outside every
// hash), the swipe a reply shows, a reply's text edited, a message deleted, a chat branched, an area
// LumiAH wrote. Holds no tests.

import { Database } from "bun:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { decodeLedger, encodeLedger } from "../../src/migrate/today/ledger-io";
import { docKey } from "../../src/migrate/history";
import { sha256 } from "../../src/migrate/files";
import type { JsonObject } from "../../src/shared/json";
import type { MessageLedger, Rec } from "../../src/shared/ledger";
import type { Fixture } from "./fixture";

/** Lumiverse's database of the fixture, for one change. */
export function lumiverse<T>(fixture: Fixture, change: (db: Database) => T): T {
  const db = new Database(join(fixture.sources.lumiverse, "lumiverse.db"));
  try {
    return change(db);
  } finally {
    db.close();
  }
}

/** Writes one swipe's record of a message again, as `change` makes it from the one there. */
export function editRecord(fixture: Fixture, message: string, swipe: number, change: (rec: Rec) => Rec): void {
  lumiverse(fixture, (db) => {
    const row = db.query<{ extra: string }, [string]>("SELECT extra FROM messages WHERE id = ?").get(message);
    if (row === null) throw new Error(`no message ${message}`);
    const extra = JSON.parse(row.extra) as { spindle_metadata: JsonObject };
    const ledger = JSON.parse(JSON.stringify(decodeLedger(extra.spindle_metadata))) as MessageLedger | null;
    const rec = ledger?.swipes[String(swipe)];
    if (ledger === null || rec === undefined) throw new Error(`no record of swipe ${swipe} of ${message}`);
    ledger.swipes[String(swipe)] = change(rec);
    db.query("UPDATE messages SET extra = ? WHERE id = ?").run(JSON.stringify({ ...extra, spindle_metadata: encodeLedger(extra.spindle_metadata, ledger) }), message);
  });
}

/** The reply shows another of its swipes, as the player flipped it. */
export function showSwipe(fixture: Fixture, message: string, swipe: number): void {
  lumiverse(fixture, (db) => {
    const row = db.query<{ swipes: string }, [string]>("SELECT swipes FROM messages WHERE id = ?").get(message);
    const text = (JSON.parse(row?.swipes ?? "[]") as string[])[swipe];
    if (text === undefined) throw new Error(`no swipe ${swipe} of ${message}`);
    db.query("UPDATE messages SET swipe_id = ?, content = ? WHERE id = ?").run(swipe, text, message);
  });
}

/** The player edits a reply's text in Lumiverse after its turn, as Lumiverse saves an edit: the swipe's text, the message's own where that swipe shows, and its revision raised. Its record, today's, keeps what the turn read. */
export function editReply(fixture: Fixture, message: string, swipe: number, text: string): void {
  lumiverse(fixture, (db) => {
    const row = db.query<{ swipes: string }, [string]>("SELECT swipes FROM messages WHERE id = ?").get(message);
    const swipes = JSON.parse(row?.swipes ?? "[]") as string[];
    if (swipes[swipe] === undefined) throw new Error(`no swipe ${swipe} of ${message}`);
    swipes[swipe] = text;
    db.query("UPDATE messages SET swipes = ?, content = CASE WHEN swipe_id = ? THEN ? ELSE content END, revision = revision + 1 WHERE id = ?").run(JSON.stringify(swipes), swipe, text, message);
  });
}

/** The player deleted a message. */
export function deleteMessage(fixture: Fixture, message: string): void {
  lumiverse(fixture, (db) => db.query("DELETE FROM messages WHERE id = ?").run(message));
}

/** A branch of a chat at one of its messages, as Lumiverse makes one: the chat's metadata with where it came from, and its messages up to that one copied under new ids. */
export function branchChat(fixture: Fixture, input: { from: string; at: string; id: string; name: string }): void {
  lumiverse(fixture, (db) => {
    const source = db.query<{ character_id: string | null; metadata: string; user_id: string }, [string]>("SELECT character_id, metadata, user_id FROM chats WHERE id = ?").get(input.from);
    if (source === null) throw new Error(`no chat ${input.from}`);
    const metadata = { ...(JSON.parse(source.metadata) as JsonObject), branched_from: input.from, branch_at_message: input.at };
    db.query("INSERT INTO chats (id, character_id, name, metadata, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run(input.id, source.character_id, input.name, JSON.stringify(metadata), 2, 1000, source.user_id);
    const messages = db.query<{ id: string; index_in_chat: number }, [string]>("SELECT id, index_in_chat FROM messages WHERE chat_id = ? ORDER BY index_in_chat").all(input.from);
    const last = messages.findIndex((m) => m.id === input.at);
    for (const m of messages.slice(0, last + 1)) {
      db.query("INSERT INTO messages (id, chat_id, index_in_chat, is_user, name, content, send_date, swipe_id, swipes, extra, swipe_dates) SELECT ?, ?, index_in_chat, is_user, name, content, send_date, swipe_id, swipes, extra, swipe_dates FROM messages WHERE id = ?").run(`${m.id}-${input.id}`, input.id, m.id);
    }
  });
}

/** A file of the user's storage, as today's build wrote it. */
async function put(fixture: Fixture, path: string, text: string): Promise<void> {
  const at = join(fixture.userFolder, path);
  await mkdir(dirname(at), { recursive: true });
  await writeFile(at, text);
}

/** Writes a chat's area as a generation left it, as LumiAH keeps it: each file's body and the index as blobs, and the document naming the index, written at `at`. Its index's hash. */
export async function putArea(fixture: Fixture, chat: string, generation: string, files: Record<string, string>, at: number): Promise<string> {
  const index: JsonObject = { v: 1, kind: "index", files: {} };
  for (const [path, text] of Object.entries(files)) {
    const hash = sha256(text);
    await put(fixture, `harness/blobs/${hash.slice(0, 2)}/${hash}`, text);
    (index.files as JsonObject)[path] = { hash, chars: text.length, at: 1, by: { kind: "user" }, was: [], pins: [] };
  }
  const text = JSON.stringify(index);
  const head = sha256(text);
  await put(fixture, `harness/blobs/${head.slice(0, 2)}/${head}`, text);
  await put(fixture, `harness/docs/chats/${docKey(chat)}/area/${docKey(generation)}.json`, JSON.stringify({ v: 1, kind: "area", head, at }));
  return head;
}

/** The index a chat's area document names: the area as that generation left it. */
export async function headOf(fixture: Fixture, chat: string, generation: string): Promise<string> {
  const doc = JSON.parse(await readFile(join(fixture.userFolder, `harness/docs/chats/${docKey(chat)}/area/${docKey(generation)}.json`), "utf8")) as { head: string };
  return doc.head;
}
