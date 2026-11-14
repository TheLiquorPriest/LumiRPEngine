// Proposals (plan §9.5): new canon the story made that the user may want kept everywhere. An agent
// drafts a new entry, or an edit to one of the user's book entries, through the harness's `suggest`
// tool; the host is told (`TurnEvents.suggestion`) and the turn lane hands over those about lore. Nothing
// is written until the user approves, edits or rejects the draft. An approval is one write to Lumiverse,
// over HTTP as the signed-in user (plan §4.2), checked against the entry's revision when the draft was
// made: an entry that changed meanwhile is not written, and the proposal says so. RPE keeps the entry
// before and after every write it makes, and can put the entry back, under the same check.
//
// The writes themselves are the adapter's (`LoreBookWrites`); this keeps the proposals and the writes'
// record, and gives the Lore page its lists.

import type { Database } from "bun:sqlite";
import type { AgentRef, Scope, Suggestion } from "rp-harness/contract";
import { type EntryNumbers, loreRefOf, type LoreWrites } from "./ids";
import type { LoreBookEntry, LoreBooks } from "./sources";

/** An entry's fields RPE writes: its text, its title (Lumiverse's `comment`) and its keys. */
export interface LoreEntryFields {
  content: string;
  comment: string;
  keys: string[];
}

/** RPE's writes to the user's books, as the signed-in user, each refused when the entry is not at the revision given. */
export interface LoreBookWrites {
  /** Sets an entry's fields: the entry as written; refused, the entry as it stands (null: it is gone). */
  update(user: string, entry: string, fields: LoreEntryFields, revision: number): Promise<{ written: LoreBookEntry } | { refused: LoreBookEntry | null }>;
  /** Adds an entry to one of the user's books. */
  create(user: string, book: string, fields: LoreEntryFields): Promise<LoreBookEntry>;
  /** Removes an entry; refused, the entry as it stands (null: it is gone). */
  remove(user: string, entry: string, revision: number): Promise<{ removed: true } | { refused: LoreBookEntry | null }>;
}

export type ProposalStatus = "open" | "approved" | "rejected" | "refused";

/** Why a write was not made: the entry changed after the draft (or after the write being put back), or it is not in the user's books. */
export type Refusal = "changed" | "missing";

/** A proposal, as the Lore page lists it. */
export interface LoreProposalView {
  id: number;
  chat: string;
  turn: string | null;
  /** The definition of the agent that drafted it. */
  agent: string;
  /** The entry it edits, by RPE's id as the agent named it; null for a new entry. */
  target: string | null;
  text: string;
  reason: string;
  status: ProposalStatus;
  /** For a refused proposal: why. */
  refused: Refusal | null;
  created: number;
  decided: number | null;
  /** The write an approval made. */
  write: number | null;
}

/** A write RPE made to the user's books, as the Lore page lists it. */
export interface LoreWriteView {
  id: number;
  proposal: number | null;
  /** `edit` and `create` approve a proposal; `put_back` undoes an earlier write. */
  kind: "edit" | "create" | "put_back";
  /** Lumiverse's id of the entry, and its book's. */
  entry: string;
  book: string;
  /** The entry's fields before and after; null where there was no entry. */
  before: LoreEntryFields | null;
  after: LoreEntryFields | null;
  /** For a put-back: the write it undid. */
  of: number | null;
  /** The write that put this one back, once one has. */
  putBack: number | null;
  at: number;
}

/** The user's changes to a draft as they approve it. A new entry needs the book it goes in. */
export interface ApprovalEdit {
  text?: string;
  title?: string;
  keys?: string[];
  book?: string;
}

export type ApprovalOutcome = { written: LoreWriteView } | { refused: Refusal } | { problem: "not_open" | "no_book" };
export type PutBackOutcome = { written: LoreWriteView } | { refused: Refusal } | { problem: "no_write" | "put_back_already" | "not_undoable" };

interface ProposalRow {
  id: number;
  chat: string;
  turn: string | null;
  agent: string;
  target: string | null;
  entry: string | null;
  revision: number | null;
  text: string;
  reason: string;
  status: ProposalStatus;
  said: string | null;
  created: number;
  decided: number | null;
  write: number | null;
}

interface WriteRow {
  id: number;
  proposal: number | null;
  kind: LoreWriteView["kind"];
  entry: string;
  book: string;
  before: string | null;
  after: string | null;
  revision: number | null;
  of: number | null;
  put_back: number | null;
  at: number;
}

function fieldsOf(entry: LoreBookEntry): LoreEntryFields {
  return { content: entry.content, comment: entry.comment, keys: [...entry.keys] };
}

function parsedFields(raw: string | null): LoreEntryFields | null {
  return raw === null ? null : (JSON.parse(raw) as LoreEntryFields);
}

function proposalView(row: ProposalRow): LoreProposalView {
  return { id: row.id, chat: row.chat, turn: row.turn, agent: row.agent, target: row.target, text: row.text, reason: row.reason, status: row.status, refused: row.said === "changed" || row.said === "missing" ? row.said : null, created: row.created, decided: row.decided, write: row.write };
}

function writeView(row: WriteRow): LoreWriteView {
  return { id: row.id, proposal: row.proposal, kind: row.kind, entry: row.entry, book: row.book, before: parsedFields(row.before), after: parsedFields(row.after), of: row.of, putBack: row.put_back, at: row.at };
}

export interface LoreProposalsDeps {
  db: Database;
  writes: LoreWrites;
  books: LoreBooks;
  numbers: EntryNumbers;
  /** The adapter's writes to Lumiverse, as the signed-in user. */
  write: LoreBookWrites;
  now?: () => number;
}

export class LoreProposals {
  constructor(private readonly deps: LoreProposalsDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /**
   * Keeps an agent's suggestion about lore as an open proposal: a new entry, or an edit to the entry
   * it names, with that entry's revision now. A suggestion about a file is not the lore's: null.
   */
  async suggested(scope: Scope, agent: AgentRef, suggestion: Suggestion): Promise<LoreProposalView | null> {
    const { target } = suggestion;
    if ("file" in target) return null;
    const named = "lore" in target ? target.lore : null;
    const ref = named === null ? null : loreRefOf(named);
    // Only a book entry RPE has numbered is one of the user's books; anything else is kept as asked and refused at approval.
    const entry = ref?.kind === "book" ? this.deps.numbers.entry(scope.user, ref.n) : null;
    const current = entry === null ? null : await this.deps.books.entry(scope.user, entry);
    const id = await this.deps.writes.run(
      (db) =>
        db
          .query<{ id: number }, [string, string, string | null, string, string | null, string | null, number | null, string, string, number]>(
            "INSERT INTO lore_proposal (user, chat, turn, agent, target, entry, revision, text, reason, status, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?) RETURNING id",
          )
          .get(scope.user, scope.chat, scope.turn ?? null, agent.definition, named, current === null ? null : current.id, current?.revision ?? null, suggestion.text, suggestion.reason, this.now())?.id ?? 0,
      "keeping a lore proposal",
    );
    return this.proposal(scope.user, id);
  }

  /** The user's proposals, newest first: those of one chat, or all. */
  proposals(user: string, chat?: string): LoreProposalView[] {
    const rows = this.deps.db.query<ProposalRow, [string, string | null, string | null]>("SELECT * FROM lore_proposal WHERE user = ? AND (? IS NULL OR chat = ?) ORDER BY id DESC").all(user, chat ?? null, chat ?? null);
    return rows.map(proposalView);
  }

  /** Every write RPE made to the user's books, newest first. */
  writesMade(user: string): LoreWriteView[] {
    return this.deps.db.query<WriteRow, [string]>("SELECT * FROM lore_write WHERE user = ? ORDER BY id DESC").all(user).map(writeView);
  }

  /** The user rejects an open proposal: nothing is written. */
  async reject(user: string, id: number): Promise<LoreProposalView | null> {
    const at = this.now();
    await this.deps.writes.run((db) => db.run("UPDATE lore_proposal SET status = 'rejected', decided = ? WHERE user = ? AND id = ? AND status = 'open'", [at, user, id]), "rejecting a lore proposal");
    return this.proposal(user, id);
  }

  /**
   * The user approves an open proposal, with any changes of theirs: one write. An edit is refused
   * when its entry is gone or is no longer at the revision the draft was made against; a new entry
   * needs the book it goes in.
   */
  async approve(user: string, id: number, edit: ApprovalEdit = {}): Promise<ApprovalOutcome> {
    const row = this.row(user, id);
    if (row === null || row.status !== "open") return { problem: "not_open" };
    if (row.target === null) {
      if (edit.book === undefined) return { problem: "no_book" };
      const fields = { content: edit.text ?? row.text, comment: edit.title ?? "", keys: edit.keys ?? [] };
      const made = await this.deps.write.create(user, edit.book, fields);
      return { written: await this.record(user, { proposal: id, kind: "create", entry: made.id, book: made.book, before: null, after: fieldsOf(made), revision: made.revision, of: null }) };
    }
    const current = row.entry === null ? null : await this.deps.books.entry(user, row.entry);
    if (current === null) return this.refuse(user, id, "missing");
    if (current.revision !== row.revision) return this.refuse(user, id, "changed");
    // What the entry held is taken before the write, whatever the reader hands back for it afterwards.
    const before = fieldsOf(current);
    const fields = { content: edit.text ?? row.text, comment: edit.title ?? before.comment, keys: edit.keys ?? before.keys };
    const done = await this.deps.write.update(user, current.id, fields, current.revision);
    if ("refused" in done) return this.refuse(user, id, done.refused === null ? "missing" : "changed");
    return { written: await this.record(user, { proposal: id, kind: "edit", entry: current.id, book: current.book, before, after: fieldsOf(done.written), revision: done.written.revision, of: null }) };
  }

  /**
   * Puts an entry back as it was before one of RPE's writes: the fields it had, or for an entry RPE
   * made, no entry. Refused when the entry has changed since that write.
   */
  async putBack(user: string, writeId: number): Promise<PutBackOutcome> {
    const w = this.deps.db.query<WriteRow, [string, number]>("SELECT * FROM lore_write WHERE user = ? AND id = ?").get(user, writeId);
    if (w === null) return { problem: "no_write" };
    if (w.put_back !== null) return { problem: "put_back_already" };
    if (w.kind === "put_back") return { problem: "not_undoable" };
    const current = await this.deps.books.entry(user, w.entry);
    if (current === null) return { refused: "missing" };
    if (current.revision !== w.revision) return { refused: "changed" };
    const was = parsedFields(w.before);
    const now = fieldsOf(current);
    if (was === null) {
      const done = await this.deps.write.remove(user, current.id, current.revision);
      if ("refused" in done) return { refused: done.refused === null ? "missing" : "changed" };
      return { written: await this.record(user, { proposal: w.proposal, kind: "put_back", entry: w.entry, book: w.book, before: now, after: null, revision: null, of: w.id }) };
    }
    const done = await this.deps.write.update(user, current.id, was, current.revision);
    if ("refused" in done) return { refused: done.refused === null ? "missing" : "changed" };
    return { written: await this.record(user, { proposal: w.proposal, kind: "put_back", entry: w.entry, book: w.book, before: now, after: fieldsOf(done.written), revision: done.written.revision, of: w.id }) };
  }

  private row(user: string, id: number): ProposalRow | null {
    return this.deps.db.query<ProposalRow, [string, number]>("SELECT * FROM lore_proposal WHERE user = ? AND id = ?").get(user, id);
  }

  private proposal(user: string, id: number): LoreProposalView | null {
    const row = this.row(user, id);
    return row === null ? null : proposalView(row);
  }

  private async refuse(user: string, id: number, why: Refusal): Promise<ApprovalOutcome> {
    const at = this.now();
    await this.deps.writes.run((db) => db.run("UPDATE lore_proposal SET status = 'refused', said = ?, decided = ? WHERE user = ? AND id = ?", [why, at, user, id]), "refusing a lore proposal");
    return { refused: why };
  }

  /** Keeps a write made, and for a proposal's write or a put-back, what it settles, in one write. */
  private async record(user: string, w: Omit<WriteRow, "id" | "put_back" | "at" | "before" | "after"> & { before: LoreEntryFields | null; after: LoreEntryFields | null }): Promise<LoreWriteView> {
    const at = this.now();
    const id = await this.deps.writes.run((db) => {
      const made =
        db
          .query<{ id: number }, [string, number | null, string, string, string, string | null, string | null, number | null, number | null, number]>(
            "INSERT INTO lore_write (user, proposal, kind, entry, book, before, after, revision, of, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
          )
          .get(user, w.proposal, w.kind, w.entry, w.book, w.before === null ? null : JSON.stringify(w.before), w.after === null ? null : JSON.stringify(w.after), w.revision, w.of, at)?.id ?? 0;
      if (w.kind === "put_back") db.run("UPDATE lore_write SET put_back = ? WHERE user = ? AND id = ?", [made, user, w.of]);
      else if (w.proposal !== null) db.run("UPDATE lore_proposal SET status = 'approved', decided = ?, write = ? WHERE user = ? AND id = ?", [at, made, user, w.proposal]);
      return made;
    }, "keeping a write to the user's lore");
    const row = this.deps.db.query<WriteRow, [string, number]>("SELECT * FROM lore_write WHERE user = ? AND id = ?").get(user, id);
    if (row === null) throw new Error(`The write ${id} to the user's lore was kept and cannot be read back.`);
    return writeView(row);
  }
}
