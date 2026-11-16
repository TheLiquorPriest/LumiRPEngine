// Proposals (plan §9.5): new canon the story made that the user may want kept everywhere. An agent
// drafts a new entry, or an edit to one of his entries (his Lumiverse books' or his world's own), through the
// harness's `suggest` tool; the host is told (`TurnEvents.suggestion`) and the turn lane hands over those about
// lore. Nothing is written until he approves, edits or rejects the draft. An approval is one write, checked
// against the entry's revision when the draft was made: an entry that changed meanwhile is not written, and the
// proposal says so. A book's entry is written to Lumiverse over HTTP as the signed-in user (plan §4.2); a
// world's own is written as a new revision of the world through Build's own write path (R-154). RPE keeps the
// entry before and after every write it makes, whoever asks for it (an approval, or Build's own fields and
// Make secret through `edit`), and puts the entry back on his press, under the same check.
//
// The writes themselves are the adapter's (`LoreBookWrites`) and Build's (`LoreWorldWrites`); this keeps the
// proposals and the writes' record (`lore_proposal`, `lore_write_log`), and gives the Lore page its lists, a page at a time.

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

/** A world's own entry as the world's head holds it: its fields, and its revision (`worldRevision`, the one `lore_read` gives it). */
export interface WorldEntryNow {
  fields: LoreEntryFields;
  stamp: string;
}

/** RPE's writes to an entry of the user's own worlds: a new revision of the world, through Build's write path, each refused where the entry is no longer at the revision given. */
export interface LoreWorldWrites {
  /** The entry as the world's head holds it; null where the world or the entry is gone. */
  entry(user: string, world: string, key: string): Promise<WorldEntryNow | null>;
  /** Sets the entry's fields as the world's next revision: the entry as written; refused where it is not at `stamp`, is gone, or he holds a draft of the world he has not committed. */
  update(user: string, world: string, key: string, fields: LoreEntryFields, stamp: string): Promise<{ written: WorldEntryNow } | { refused: Refusal }>;
}

export type ProposalStatus = "open" | "approved" | "rejected" | "refused";

/** Why a write was not made: the entry changed after the draft (or after the write being put back), it is not there, or a draft of his own of the world stands uncommitted. */
export type Refusal = "changed" | "missing" | "draft";

/** The fixed values of the proposals, each a setting with this default. */
export interface LoreProposalSettings {
  /** Rows a page of the proposals' queue and of the writes' record holds. */
  page: number;
}

export const LORE_PROPOSAL_DEFAULTS: Readonly<LoreProposalSettings> = Object.freeze({ page: 50 });

/** A proposal, as the Lore page lists it. */
export interface LoreProposalView {
  id: number;
  chat: string;
  turn: string | null;
  /** The definition of the agent that drafted it. */
  agent: string;
  /** The entry it edits, by RPE's id as the agent named it; null for a new entry. */
  target: string | null;
  /** The text proposed: a new entry's, or what an edit puts in place of its passage (the whole entry's text where it names no passage). */
  text: string;
  /** For an edit: the passage as it stands, which `text` replaces. */
  was: string | null;
  /** For a new entry: the book, the title and the keys the agent drafted. */
  book: string | null;
  title: string | null;
  keys: string[] | null;
  /** For an entry of his world: the world's id. */
  world: string | null;
  reason: string;
  status: ProposalStatus;
  /** For a refused proposal: why. */
  refused: Refusal | null;
  created: number;
  decided: number | null;
  /** The write an approval made. */
  write: number | null;
}

/** A write RPE made to his lore, as the Lore page lists it. */
export interface LoreWriteView {
  id: number;
  proposal: number | null;
  /** `edit` and `create` write; `put_back` undoes an earlier write. */
  kind: "edit" | "create" | "put_back";
  /** Lumiverse's id of the entry, or for an entry of his world its key there. */
  entry: string;
  /** Its book's id in Lumiverse; empty for an entry of his world. */
  book: string;
  /** The world's id, for an entry of his world. */
  world: string | null;
  /** The entry's fields before and after; null where there was no entry. */
  before: LoreEntryFields | null;
  after: LoreEntryFields | null;
  /** For a put-back: the write it undid. */
  of: number | null;
  /** The write that put this one back, once one has. */
  putBack: number | null;
  at: number;
}

/** The user's changes to a draft as they approve it. A new entry needs the book it goes in, where the agent drafted none. */
export interface ApprovalEdit {
  text?: string;
  title?: string;
  keys?: string[];
  book?: string;
}

export type ApprovalOutcome = { written: LoreWriteView } | { refused: Refusal } | { problem: "not_open" | "no_book" | "no_world_writes" };
export type PutBackOutcome = { written: LoreWriteView } | { refused: Refusal } | { problem: "no_write" | "put_back_already" | "not_undoable" | "no_world_writes" };

/** A page of a list: its items, and where the next page starts (null at the end). */
export interface LorePage<T> {
  items: T[];
  next: string | null;
}

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
  book: string | null;
  title: string | null;
  keys: string | null;
  was: string | null;
  world: string | null;
  stamp: string | null;
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
  world: string | null;
  stamp: string | null;
}

function fieldsOf(entry: LoreBookEntry): LoreEntryFields {
  return { content: entry.content, comment: entry.comment, keys: [...entry.keys] };
}

function parsedFields(raw: string | null): LoreEntryFields | null {
  return raw === null ? null : (JSON.parse(raw) as LoreEntryFields);
}

function proposalView(row: ProposalRow): LoreProposalView {
  const refused = row.said === "changed" || row.said === "missing" || row.said === "draft" ? row.said : null;
  return { id: row.id, chat: row.chat, turn: row.turn, agent: row.agent, target: row.target, text: row.text, was: row.was, book: row.book, title: row.title, keys: row.keys === null ? null : (JSON.parse(row.keys) as string[]), world: row.world, reason: row.reason, status: row.status, refused, created: row.created, decided: row.decided, write: row.write };
}

function writeView(row: WriteRow): LoreWriteView {
  return { id: row.id, proposal: row.proposal, kind: row.kind, entry: row.entry, book: row.book, world: row.world, before: parsedFields(row.before), after: parsedFields(row.after), of: row.of, putBack: row.put_back, at: row.at };
}

/** `text` with its first `passage` put in place of it: an entry's text with the part an agent named changed and the rest as it was; null where the passage is no longer in the text. */
function replaced(text: string, passage: string, by: string): string | null {
  const at = text.indexOf(passage);
  return at < 0 ? null : `${text.slice(0, at)}${by}${text.slice(at + passage.length)}`;
}

export interface LoreProposalsDeps {
  db: Database;
  writes: LoreWrites;
  books: LoreBooks;
  numbers: EntryNumbers;
  /** The adapter's writes to Lumiverse, as the signed-in user. */
  write: LoreBookWrites;
  /** Build's write path to his worlds' own entries; absent, a proposal for one cannot be approved. */
  worlds?: LoreWorldWrites;
  settings?: Partial<LoreProposalSettings>;
  now?: () => number;
}

export class LoreProposals {
  readonly settings: Readonly<LoreProposalSettings>;

  constructor(private readonly deps: LoreProposalsDeps) {
    this.settings = Object.freeze({ ...LORE_PROPOSAL_DEFAULTS, ...deps.settings });
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /**
   * Keeps an agent's suggestion about lore as an open proposal with the draft it made: a new entry (its book, title and keys), or an
   * edit to the entry it names (the passage as it stands), with that entry's revision now. A suggestion about a file is not the lore's: null.
   */
  async suggested(scope: Scope, agent: AgentRef, suggestion: Suggestion): Promise<LoreProposalView | null> {
    const { target } = suggestion;
    if ("file" in target) return null;
    const named = "lore" in target ? target.lore : null;
    const ref = named === null ? null : loreRefOf(named);
    // A book entry RPE has numbered is one of the user's books; a world entry by its number is one of his world's own. Anything else is kept as asked, under the id the agent used, and refused at approval.
    const entry = ref?.kind === "book" ? this.deps.numbers.entry(scope.user, ref.n) : null;
    const current = entry === null ? null : await this.deps.books.entry(scope.user, entry);
    const placed = ref?.kind === "world" ? this.deps.numbers.worldEntry(scope.user, ref.n) : null;
    const now = placed === null ? null : ((await this.deps.worlds?.entry(scope.user, placed.world, placed.key)) ?? null);
    const draft = suggestion.draft;
    const id = await this.deps.writes.run(
      (db) =>
        db
          .query<{ id: number }, [string, string, string | null, string, string | null, string | null, number | null, string, string, number, string | null, string | null, string | null, string | null, string | null, string | null]>(
            "INSERT INTO lore_proposal (user, chat, turn, agent, target, entry, revision, text, reason, status, created, book, title, keys, was, world, stamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?) RETURNING id",
          )
          .get(
            scope.user,
            scope.chat,
            scope.turn ?? null,
            agent.definition,
            named,
            current !== null ? current.id : (placed?.key ?? null),
            current?.revision ?? null,
            suggestion.text,
            suggestion.reason,
            this.now(),
            draft?.book ?? null,
            draft?.title ?? null,
            draft?.keys === undefined ? null : JSON.stringify(draft.keys),
            suggestion.was ?? null,
            placed?.world ?? null,
            now?.stamp ?? null,
          )?.id ?? 0,
      "keeping a lore proposal",
    );
    return this.one(scope.user, id);
  }

  /** The user's proposals, newest first, a page at a time: those of one chat or all, and only those in `status` when it is given. */
  proposals(user: string, page: { chat?: string; status?: ProposalStatus; after?: number; limit?: number } = {}): LorePage<LoreProposalView> {
    const limit = page.limit ?? this.settings.page;
    const rows = this.deps.db
      .query<ProposalRow, [string, string | null, string | null, string | null, string | null, number | null, number | null, number]>("SELECT * FROM lore_proposal WHERE user = ? AND (? IS NULL OR chat = ?) AND (? IS NULL OR status = ?) AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?")
      .all(user, page.chat ?? null, page.chat ?? null, page.status ?? null, page.status ?? null, page.after ?? null, page.after ?? null, limit + 1);
    const items = rows.slice(0, limit).map(proposalView);
    return { items, next: rows.length > limit ? String(items[items.length - 1]?.id) : null };
  }

  /** Every write RPE made to his lore, newest first, a page at a time. */
  writesMade(user: string, page: { after?: number; limit?: number } = {}): LorePage<LoreWriteView> {
    const limit = page.limit ?? this.settings.page;
    const rows = this.deps.db.query<WriteRow, [string, number | null, number | null, number]>("SELECT * FROM lore_write_log WHERE user = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?").all(user, page.after ?? null, page.after ?? null, limit + 1);
    const items = rows.slice(0, limit).map(writeView);
    return { items, next: rows.length > limit ? String(items[items.length - 1]?.id) : null };
  }

  /** The user rejects an open proposal: nothing is written. */
  async reject(user: string, id: number): Promise<LoreProposalView | null> {
    const at = this.now();
    await this.deps.writes.run((db) => db.run("UPDATE lore_proposal SET status = 'rejected', decided = ? WHERE user = ? AND id = ? AND status = 'open'", [at, user, id]), "rejecting a lore proposal");
    return this.one(user, id);
  }

  /**
   * The user approves an open proposal, with any changes of theirs: one write. An edit changes the passage it names and nothing else of
   * the entry, and is refused when its entry is gone, is no longer at the revision the draft was made against, or no longer holds the
   * passage; a new entry takes the book, title and keys drafted, or his own, and needs a book.
   */
  async approve(user: string, id: number, edit: ApprovalEdit = {}): Promise<ApprovalOutcome> {
    const row = this.row(user, id);
    if (row === null || row.status !== "open") return { problem: "not_open" };
    const text = edit.text ?? row.text;
    if (row.target === null) {
      const book = edit.book ?? row.book;
      if (book === null) return { problem: "no_book" };
      const drafted: string[] = row.keys === null ? [] : (JSON.parse(row.keys) as string[]);
      return { written: await this.create(user, book, { content: text, comment: edit.title ?? row.title ?? "", keys: edit.keys ?? drafted }, id) };
    }
    if (row.world !== null) return this.approveWorld(user, row, text, edit);
    const current = row.entry === null ? null : await this.deps.books.entry(user, row.entry);
    if (current === null) return this.refuse(user, id, "missing");
    if (current.revision !== row.revision) return this.refuse(user, id, "changed");
    const content = row.was === null ? text : replaced(current.content, row.was, text);
    if (content === null) return this.refuse(user, id, "changed");
    const done = await this.writeEntry(user, current, { content, comment: edit.title ?? current.comment, keys: edit.keys ?? [...current.keys] }, id);
    return "refused" in done ? this.refuse(user, id, done.refused) : { written: done.written };
  }

  /**
   * A write to an entry of his books made outside the queue (Build's own fields and Make secret): through the one recorded writer, kept with
   * the entry before and after, so it can be put back. Refused where the entry is gone or is no longer at `revision`.
   */
  async edit(user: string, entry: string, fields: LoreEntryFields, revision: number): Promise<{ written: LoreWriteView } | { refused: Refusal }> {
    const current = await this.deps.books.entry(user, entry);
    if (current === null) return { refused: "missing" };
    if (current.revision !== revision) return { refused: "changed" };
    return this.writeEntry(user, current, fields, null);
  }

  /** A new entry in one of his books, through the one recorded writer; `proposal` is the one it settles. */
  async create(user: string, book: string, fields: LoreEntryFields, proposal: number | null = null): Promise<LoreWriteView> {
    const made = await this.deps.write.create(user, book, fields);
    return this.record(user, { proposal, kind: "create", entry: made.id, book: made.book, world: null, before: null, after: fieldsOf(made), revision: made.revision, stamp: null, of: null });
  }

  /**
   * Puts an entry back as it was before one of RPE's writes: the fields it had, or for an entry RPE made, no entry. An entry of his world
   * goes back as a new revision of the world. Refused when the entry has changed since that write.
   */
  async putBack(user: string, writeId: number): Promise<PutBackOutcome> {
    const w = this.deps.db.query<WriteRow, [string, number]>("SELECT * FROM lore_write_log WHERE user = ? AND id = ?").get(user, writeId);
    if (w === null) return { problem: "no_write" };
    if (w.put_back !== null) return { problem: "put_back_already" };
    if (w.kind === "put_back") return { problem: "not_undoable" };
    const was = parsedFields(w.before);
    if (w.world !== null) return this.putBackWorld(user, w, was);
    const current = await this.deps.books.entry(user, w.entry);
    if (current === null) return { refused: "missing" };
    if (current.revision !== w.revision) return { refused: "changed" };
    const now = fieldsOf(current);
    if (was === null) {
      const done = await this.deps.write.remove(user, current.id, current.revision);
      if ("refused" in done) return { refused: done.refused === null ? "missing" : "changed" };
      return { written: await this.record(user, { proposal: w.proposal, kind: "put_back", entry: w.entry, book: w.book, world: null, before: now, after: null, revision: null, stamp: null, of: w.id }) };
    }
    const done = await this.deps.write.update(user, current.id, was, current.revision);
    if ("refused" in done) return { refused: done.refused === null ? "missing" : "changed" };
    return { written: await this.record(user, { proposal: w.proposal, kind: "put_back", entry: w.entry, book: w.book, world: null, before: now, after: fieldsOf(done.written), revision: done.written.revision, stamp: null, of: w.id }) };
  }

  /** One write to an entry as it stands, kept with it before and after; what `current` held is taken before the write, whatever the reader hands back for it afterwards. */
  private async writeEntry(user: string, current: LoreBookEntry, fields: LoreEntryFields, proposal: number | null): Promise<{ written: LoreWriteView } | { refused: Refusal }> {
    const before = fieldsOf(current);
    const done = await this.deps.write.update(user, current.id, fields, current.revision);
    if ("refused" in done) return { refused: done.refused === null ? "missing" : "changed" };
    return { written: await this.record(user, { proposal, kind: "edit", entry: current.id, book: current.book, world: null, before, after: fieldsOf(done.written), revision: done.written.revision, stamp: null, of: null }) };
  }

  /** An approval of a proposal for an entry of his world: checked against the entry's revision when drafted, written as a new revision of the world. */
  private async approveWorld(user: string, row: ProposalRow, text: string, edit: ApprovalEdit): Promise<ApprovalOutcome> {
    const { worlds } = this.deps;
    if (worlds === undefined) return { problem: "no_world_writes" };
    const now = row.world === null || row.entry === null ? null : await worlds.entry(user, row.world, row.entry);
    if (now === null || row.world === null || row.entry === null) return this.refuse(user, row.id, "missing");
    if (now.stamp !== row.stamp) return this.refuse(user, row.id, "changed");
    const content = row.was === null ? text : replaced(now.fields.content, row.was, text);
    if (content === null) return this.refuse(user, row.id, "changed");
    const done = await worlds.update(user, row.world, row.entry, { content, comment: edit.title ?? now.fields.comment, keys: edit.keys ?? now.fields.keys }, now.stamp);
    if ("refused" in done) return this.refuse(user, row.id, done.refused);
    return { written: await this.record(user, { proposal: row.id, kind: "edit", entry: row.entry, book: "", world: row.world, before: now.fields, after: done.written.fields, revision: null, stamp: done.written.stamp, of: null }) };
  }

  private async putBackWorld(user: string, w: WriteRow, was: LoreEntryFields | null): Promise<PutBackOutcome> {
    const { worlds } = this.deps;
    if (worlds === undefined) return { problem: "no_world_writes" };
    if (was === null || w.world === null) return { problem: "not_undoable" };
    const now = await worlds.entry(user, w.world, w.entry);
    if (now === null) return { refused: "missing" };
    if (now.stamp !== w.stamp) return { refused: "changed" };
    const done = await worlds.update(user, w.world, w.entry, was, now.stamp);
    if ("refused" in done) return { refused: done.refused };
    return { written: await this.record(user, { proposal: w.proposal, kind: "put_back", entry: w.entry, book: "", world: w.world, before: now.fields, after: done.written.fields, revision: null, stamp: done.written.stamp, of: w.id }) };
  }

  private row(user: string, id: number): ProposalRow | null {
    return this.deps.db.query<ProposalRow, [string, number]>("SELECT * FROM lore_proposal WHERE user = ? AND id = ?").get(user, id);
  }

  /** One of his proposals as it stands; null where he has none by that number. */
  one(user: string, id: number): LoreProposalView | null {
    const row = this.row(user, id);
    return row === null ? null : proposalView(row);
  }

  /** One of the writes RPE made to his lore as it stands; null where he has none by that number. */
  writeOne(user: string, id: number): LoreWriteView | null {
    const row = this.deps.db.query<WriteRow, [string, number]>("SELECT * FROM lore_write_log WHERE user = ? AND id = ?").get(user, id);
    return row === null ? null : writeView(row);
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
          .query<{ id: number }, [string, number | null, string, string, string, string | null, string | null, number | null, number | null, number, string | null, string | null]>(
            "INSERT INTO lore_write_log (user, proposal, kind, entry, book, before, after, revision, of, at, world, stamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
          )
          .get(user, w.proposal, w.kind, w.entry, w.book, w.before === null ? null : JSON.stringify(w.before), w.after === null ? null : JSON.stringify(w.after), w.revision, w.of, at, w.world, w.stamp)?.id ?? 0;
      if (w.kind === "put_back") db.run("UPDATE lore_write_log SET put_back = ? WHERE user = ? AND id = ?", [made, user, w.of]);
      else if (w.proposal !== null) db.run("UPDATE lore_proposal SET status = 'approved', decided = ?, write = ? WHERE user = ? AND id = ?", [at, made, user, w.proposal]);
      return made;
    }, "keeping a write to the user's lore");
    const row = this.deps.db.query<WriteRow, [string, number]>("SELECT * FROM lore_write_log WHERE user = ? AND id = ?").get(user, id);
    if (row === null) throw new Error(`The write ${id} to the user's lore was kept and cannot be read back.`);
    return writeView(row);
  }
}
