// Moving a World Info book from LRE's old secrecy to secret marks (DESIGN §4.2), book by book, each
// step on the user's own press in Build → Lore → Secrecy in your World Info (PlanChatUI-B3 item 5: his books are read through the door and written through
// the lore's one recorded writer, each write checked against the revision read; a book's undo copies are a row of the application's own table). LRE used to keep a
// secret by storing its own fields on the entry (`lumi_rp_engine.lore`, with `secret`) and switching
// the entry off, and kept each twin of a secret (an entry of the same text) switched off as its copy,
// with a note of how the twin stood before (`lumi_rp_engine.secretCopyOf`). A move of a book:
// - Preview reads the book and writes nothing: each LRE secret and the one secret mark its whole text
//   becomes (`writeSecretMark`, known to its holders), with what no longer applies once it is a mark
//   (its gate, its audience); each twin, the same mark it becomes, and how its note says it stood;
//   the old fields Confirm takes off entries that keep nothing secret; and each secret or twin whose
//   text can't be a mark (`secretMarkProblem`), which keeps its old secrecy;
// - Apply first backs up every entry it lists, whole as a restore needs it (text, keywords, on or off,
//   extension data), in the undo copy, then writes each secret's mark and each twin's. A twin's
//   text is its secret's, so it becomes the same mark before it goes back on or off as its note says:
//   the host strips a mark from every prompt, so a prompt LRE's interceptor never sees, or one that
//   reads the twin without its secret's book, still gets no secret, as when LRE kept the twin off. A
//   twin whose text can't be a mark stays off as LRE kept it, listed. An entry LRE switched off stays
//   off, listed for the user to switch on: nothing says how it stood before. The old fields stay on the
//   entries, but an entry that holds a mark reads its secrecy from its marks (`hasSecretMarks`), so a
//   moved secret reads as its mark;
// - Confirm, once the book reads right, takes the old secrecy fields off (`SECRECY_FIELDS`; links,
//   aliases and Known by stay, which marks don't carry). The backup stays;
// - Restore secrecy as it was puts every backed-up entry back as it stood before the move, byte for
//   byte, after keeping in the backup what the user changed since.
// Each step reads the book afresh and acts only on it as the page last read it (`version`), and a
// user's steps run one at a time. A book's undo copy keeps every move of it, oldest first.

import type { Database } from "bun:sqlite";
import type { Log } from "rp-harness/contract";
import type { WriteQueue } from "../../app";
import { hashParts } from "../../shared/hash";
import type { UserId } from "../../shared/ids";
import { isRecord, type JsonObject } from "../../shared/json";
import { LEDGER_NAMESPACE } from "../../shared/ledger";
import { bookLoreFieldsOf, engineWroteEntry, loreIsSecret, secretCopyOf, type BookLoreFields } from "../../shared/lore";
import type { SecrecyBookPlan, SecrecyBookView, SecrecyEntryView, SecrecyState } from "../../shared/lore-views";
import { hasSecretMarks, secretMarkProblem, writeSecretMark } from "../../shared/secret-marks";
import { bookEntryTitle } from "../../secrecy/book-lore";
import { type BookEntry, type BuildBooks, type BuildWrites, listBooks } from "./books";

/** The old fields Confirm takes off an entry: what a secret mark stands for. Links, aliases and Known by stay, which marks don't carry. */
const SECRECY_FIELDS = ["secret", "gate", "audience", "holders"] as const;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A step this page can't take as asked, with the protocol's code for why. */
export class SecrecyError extends Error {
  constructor(
    readonly code: "bad_request" | "conflict" | "not_found" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "SecrecyError";
  }
}

/** The parts of an entry a move writes, as one stood: what Restore puts back, byte for byte. */
interface EntryParts {
  content: string;
  keys: string[];
  disabled: boolean;
  extensions: JsonObject;
}

type Kind = SecrecyEntryView["kind"];

/** One entry of a move: what it does with the entry, how the entry stood before, and which of its steps landed. */
interface Backup {
  id: string;
  title: string;
  kind: Kind;
  /** LRE switched it off and nothing says how it stood before: the move leaves it off, listed. */
  switchedOff: boolean;
  /** As it stood before the move: what Restore puts back. */
  before: EntryParts;
  /** As Apply leaves it; Confirm then takes the old fields off it. */
  after: EntryParts;
  /** Why its text can't be a mark (`refused`). */
  reason?: string;
  /** Whether Apply's write landed (one with nothing to write lands at once): one that didn't never moved, so Confirm leaves its old fields on. */
  applied: boolean;
  /** Whether Confirm took its old fields off. */
  confirmed: boolean;
  /** The last step whose write to it failed, and why. */
  error?: { step: "apply" | "confirm" | "restore"; message: string };
  /** As it stood when Restore put it back, once the user had changed it since the move: kept here, never written back. */
  replaced?: EntryParts;
}

/** One move of a book (Unix ms): applied, then confirmed or put back; `restoring` once a restore of it started. */
interface Move {
  applied: number;
  confirmed: number | null;
  restored: number | null;
  restoring: boolean;
  entries: Backup[];
}

/** A book's backup file: every move of it, oldest first. */
interface SecrecyFile {
  v: 1;
  bookId: string;
  name: string;
  moves: Move[];
}

// ---------------------------------------------------------------- the backup file

function isParts(v: unknown): v is EntryParts {
  return isRecord(v) && typeof v.content === "string" && Array.isArray(v.keys) && v.keys.every((k) => typeof k === "string") && typeof v.disabled === "boolean" && isRecord(v.extensions);
}

const KINDS: readonly string[] = ["mark", "marked", "twin", "fields", "refused"] satisfies Kind[];
const STEPS: readonly string[] = ["apply", "confirm", "restore"];

function isBackup(v: unknown): v is Backup {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.title !== "string" || typeof v.kind !== "string" || !KINDS.includes(v.kind)) return false;
  if (typeof v.switchedOff !== "boolean" || typeof v.applied !== "boolean" || typeof v.confirmed !== "boolean" || (v.reason !== undefined && typeof v.reason !== "string")) return false;
  if (!isParts(v.before) || !isParts(v.after) || (v.replaced !== undefined && !isParts(v.replaced))) return false;
  return v.error === undefined || (isRecord(v.error) && typeof v.error.step === "string" && STEPS.includes(v.error.step) && typeof v.error.message === "string");
}

function isMove(v: unknown): v is Move {
  return isRecord(v) && typeof v.applied === "number" && Number.isFinite(v.applied) && [v.confirmed, v.restored].every((t) => t === null || (typeof t === "number" && Number.isFinite(t))) && typeof v.restoring === "boolean" && Array.isArray(v.entries) && v.entries.every(isBackup);
}

function isFile(v: unknown, bookId: string): v is SecrecyFile {
  return isRecord(v) && v.v === 1 && v.bookId === bookId && typeof v.name === "string" && Array.isArray(v.moves) && v.moves.every(isMove);
}

/** Where a book's moves stand: its latest move, the move under way (applied and not put back), and the state the page shows. */
function standing(file: SecrecyFile | null): { last: Move | null; move: Move | null; state: SecrecyState } {
  const last = file?.moves.at(-1) ?? null;
  const move = last !== null && last.restored === null ? last : null;
  return { last, move, state: move === null ? "legacy" : move.restoring ? "restoring" : move.confirmed !== null ? "confirmed" : "applied" };
}

// ---------------------------------------------------------------- an entry's parts

function partsOf(e: BookEntry): EntryParts {
  return { content: e.content, keys: [...e.keys], disabled: e.disabled, extensions: JSON.parse(JSON.stringify(e.extensions)) as JsonObject };
}

/** The parts of an entry a write sets. */
type EntryPatch = Partial<Pick<EntryParts, "content" | "keys" | "disabled" | "extensions">>;

/** The writes that turn `from` into `to`: only the parts that differ, since the host indexes an entry afresh when its text or its switch is written; null when they are alike. */
function patchTo(from: EntryParts, to: EntryParts): EntryPatch | null {
  const patch: EntryPatch = {
    ...(from.content !== to.content ? { content: to.content } : {}),
    ...(JSON.stringify(from.keys) !== JSON.stringify(to.keys) ? { keys: [...to.keys] } : {}),
    ...(from.disabled !== to.disabled ? { disabled: to.disabled } : {}),
    ...(JSON.stringify(from.extensions) !== JSON.stringify(to.extensions) ? { extensions: to.extensions } : {}),
  };
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Extension data with LRE's namespace as `edit` leaves a copy of it, dropped once nothing is left in it; everything else as it was, in its order. */
function withNamespace(extensions: JsonObject, edit: (ns: JsonObject) => void): JsonObject {
  const held = extensions[LEDGER_NAMESPACE];
  const ns: JsonObject = isRecord(held) ? { ...held } : {};
  edit(ns);
  const out: JsonObject = { ...extensions };
  if (Object.keys(ns).length === 0) delete out[LEDGER_NAMESPACE];
  else out[LEDGER_NAMESPACE] = ns;
  return out;
}

/** Extension data without the old secrecy fields (`SECRECY_FIELDS`): what Confirm leaves of an entry's. */
function withoutOldSecrecy(extensions: JsonObject): JsonObject {
  return withNamespace(extensions, (ns) => {
    if (!isRecord(ns.lore)) return;
    const lore: JsonObject = { ...ns.lore };
    for (const key of SECRECY_FIELDS) delete lore[key];
    if (Object.keys(lore).length === 0) delete ns.lore;
    else ns.lore = lore;
  });
}

/** A twin's extension data as its note says it stood before LRE kept it as a copy: its own LRE fields, or none, and no note. */
function asNoted(extensions: JsonObject, fields: BookLoreFields | null): JsonObject {
  return withNamespace(extensions, (ns) => {
    delete ns.secretCopyOf;
    if (fields === null) delete ns.lore;
    else ns.lore = JSON.parse(JSON.stringify(fields)) as JsonObject;
  });
}

// ---------------------------------------------------------------- the plan

/**
 * What a move does with a book entry, by what LRE left on it (see the header), as the entry of the
 * move it would be; null for one it leaves alone: an entry the engine wrote, or one with nothing of
 * LRE's old secrecy on it.
 */
function planEntry(e: BookEntry): Backup | null {
  if (engineWroteEntry(e.extensions)) return null;
  const before = partsOf(e);
  const entry = { id: e.id, title: bookEntryTitle(e), before, applied: false, confirmed: false };
  const note = secretCopyOf(e.extensions);
  if (note) {
    // A twin's text is its secret's: the same mark, known to whom LRE held the twin to (the stricter of its keepers' fields, its original's holders among them).
    const mark = { text: e.content.trim(), knownTo: bookLoreFieldsOf(e.extensions)?.holders ?? [], keptFrom: "everyone" as const };
    const reason = secretMarkProblem(mark);
    // Switched on as plain text, it would send its secret to any prompt that reads it unmarked: it keeps its old secrecy, off.
    if (reason !== null) return { ...entry, kind: "refused", switchedOff: false, after: before, reason };
    return { ...entry, kind: "twin", switchedOff: false, after: { content: writeSecretMark(mark), keys: before.keys, disabled: note.off, extensions: asNoted(e.extensions, note.fields) } };
  }
  const fields = bookLoreFieldsOf(e.extensions);
  if (fields === null || !loreIsSecret(fields)) return JSON.stringify(withoutOldSecrecy(e.extensions)) === JSON.stringify(e.extensions) ? null : { ...entry, kind: "fields", switchedOff: false, after: before };
  if (hasSecretMarks(e.content)) return { ...entry, kind: "marked", switchedOff: e.disabled, after: before };
  // LRE's secret is the whole entry, kept from everyone but its holders: one mark holding all of its text.
  const mark = { text: e.content.trim(), knownTo: fields.holders ?? [], keptFrom: "everyone" as const };
  const reason = secretMarkProblem(mark);
  if (reason !== null) return { ...entry, kind: "refused", switchedOff: false, after: before, reason };
  return { ...entry, kind: "mark", switchedOff: e.disabled, after: { ...before, content: writeSecretMark(mark) } };
}

/** What LRE left an entry as, by its move: as it stood before where Apply's write didn't land; without the old fields once Confirm took them off. */
function leftAs(b: Backup): EntryParts {
  if (!b.applied) return b.before;
  return b.confirmed ? { ...b.after, extensions: withoutOldSecrecy(b.after.extensions) } : b.after;
}

/** An entry's line on the page, by its kind, from how it stood before the move and how Apply leaves it; `off`, whether it is stored off now. */
function entryView(b: Backup, off: boolean): SecrecyEntryView {
  const view: SecrecyEntryView = { id: b.id, title: b.title, kind: b.kind, off };
  if (b.kind === "fields") {
    const ns = b.before.extensions[LEDGER_NAMESPACE];
    const lore: Record<string, unknown> = isRecord(ns) && isRecord(ns.lore) ? ns.lore : {};
    return { ...view, removes: SECRECY_FIELDS.filter((key) => lore[key] !== undefined) };
  }
  // A secret or a twin of one: the secret it copies, the mark it becomes, whom it is known to, and what a mark doesn't carry, its gate and audience.
  const note = secretCopyOf(b.before.extensions);
  const slash = note ? note.entry.indexOf("/") : -1;
  const fields = bookLoreFieldsOf(b.before.extensions);
  return {
    ...view,
    ...(note ? { original: { bookId: note.entry.slice(0, Math.max(0, slash)), entryId: note.entry.slice(slash + 1) }, was: { off: note.off, fields: note.fields !== null } } : {}),
    ...(b.kind === "mark" || b.kind === "twin" ? { mark: b.after.content } : {}),
    ...(fields?.holders && fields.holders.length > 0 ? { knownTo: fields.holders } : {}),
    ...(fields?.gate !== undefined && fields.gate.trim() !== "" ? { gate: fields.gate } : {}),
    ...(fields?.audience && fields.audience.length > 0 ? { audience: fields.audience } : {}),
    ...(b.switchedOff ? { switchedOff: true } : {}),
    ...(b.reason !== undefined ? { reason: b.reason } : {}),
  };
}

/** A book read now: its entries, its backup file, and the page's view of them. */
interface Look {
  name: string;
  file: SecrecyFile | null;
  /** The move under way: applied and not put back. */
  move: Move | null;
  /** What a move would do with the book, while none is under way. */
  planned: Backup[];
  byId: Map<string, BookEntry>;
  plan: SecrecyBookPlan;
}

/** Moving the user's books to secret marks, one step of a user's at a time (see the header). */
export class SecrecyMoves {
  /** Each user's latest step: the next one waits for it. */
  private readonly chains = new Map<UserId, Promise<unknown>>();

  constructor(
    private readonly deps: {
      db: Database;
      queue: WriteQueue;
      log: Log;
      books: BuildBooks;
      writes: BuildWrites;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** One entry's parts written back, through the one recorded writer, checked against the revision `e` was read at. Throws the words of a refusal. */
  private async put(userId: UserId, e: BookEntry, patch: EntryPatch): Promise<void> {
    const done = await this.deps.writes.edit(userId, e.id, { content: patch.content ?? e.content, comment: e.comment, keys: patch.keys ?? e.keys, ...(patch.disabled === undefined ? {} : { disabled: patch.disabled }), ...(patch.extensions === undefined ? {} : { extensions: patch.extensions }) }, e.revision);
    if ("refused" in done) throw new Error(done.refused === "missing" ? "the entry is gone from its book" : "the entry changed in Lumiverse since this page read it");
  }

  /** Runs `step` once every earlier step of the user's is over, however it ended (the chain holds only settled steps). */
  private serial<T>(userId: UserId, step: () => Promise<T>): Promise<T> {
    const run = (this.chains.get(userId) ?? Promise.resolve()).then(step);
    const settled = run.catch(() => undefined);
    this.chains.set(userId, settled);
    void settled.then(() => {
      if (this.chains.get(userId) === settled) this.chains.delete(userId);
    });
    return run;
  }

  /**
   * The book's undo copy: null when it has none. One that doesn't read is kept as it is, and `damaged` says so at every read, so the page
   * keeps saying why the book reads as never moved and no move writes over it.
   */
  private read(bookId: string, userId: UserId): { file: SecrecyFile | null; damaged: string | null } {
    const row = this.deps.db.query<{ body: string }, [string, string]>("SELECT body FROM build_secrecy WHERE user = ? AND book = ?").get(userId, bookId);
    if (row === null) return { file: null, damaged: null };
    let raw: unknown;
    try {
      raw = JSON.parse(row.body);
    } catch {
      raw = undefined;
    }
    return isFile(raw, bookId) ? { file: raw, damaged: null } : { file: null, damaged: raw === undefined ? "unreadable" : "malformed" };
  }

  private async write(file: SecrecyFile, userId: UserId): Promise<void> {
    await this.deps.queue.run((db) => db.query("INSERT OR REPLACE INTO build_secrecy (user, book, body) VALUES (?, ?, ?)").run(userId, file.bookId, JSON.stringify(file)), "a book's secrecy move kept");
  }

  private async look(bookId: string, userId: UserId): Promise<Look> {
    const book = (await listBooks(this.deps.books, userId, null)).find((b) => b.id === bookId);
    if (!book) throw new SecrecyError("not_found", "that World Info book is gone");
    const entries = await this.deps.books.entries(userId, bookId);
    const { file, damaged } = this.read(bookId, userId);
    const { last, move, state } = standing(file);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const planned = move ? [] : entries.flatMap((e) => planEntry(e) ?? []);
    const views = move
      ? move.entries.map((b) => {
          const e = byId.get(b.id);
          const parts = e ? partsOf(e) : null;
          const now = parts === null ? "gone" : patchTo(parts, leftAs(b)) === null ? "moved" : patchTo(parts, b.before) === null ? "before" : "changed";
          // Titled as it is now, should the user have renamed it since; one titled by its text keeps the words it had before its mark.
          return { ...entryView(b, e?.disabled ?? b.before.disabled), ...(e && e.comment.trim() !== "" ? { title: bookEntryTitle(e) } : {}), now, ...(b.kind === "mark" && e ? { marked: hasSecretMarks(e.content) } : {}), ...(b.error ? { error: b.error } : {}) } satisfies SecrecyEntryView;
        })
      : planned.map((b) => entryView(b, b.before.disabled));
    // What a step must find unchanged: the move under way, if any, and every entry it lists (or would), as it is now.
    const ids = (move ? move.entries : planned).map((b) => b.id);
    const version = hashParts(
      "lre-secrecy-v1",
      bookId,
      move ? JSON.stringify(move) : null,
      ...ids.flatMap((id) => {
        const e = byId.get(id);
        return [id, e ? JSON.stringify(partsOf(e)) : null];
      }),
    );
    const plan: SecrecyBookPlan = { bookId, name: book.name, state, applied: last?.applied ?? null, confirmed: last?.confirmed ?? null, restored: last?.restored ?? null, version, entries: views, damaged };
    return { name: book.name, file, move, planned, byId, plan };
  }

  /** The book read now, refused as a conflict unless it stands as the page read it (`version`). */
  private async current(bookId: string, version: string, userId: UserId): Promise<Look> {
    const look = await this.look(bookId, userId);
    if (look.plan.version !== version) throw new SecrecyError("conflict", "the book changed since this page read it: look at it again before you go on");
    return look;
  }

  /** The user's World Info books, the engine's own left out, and where each one's move stands. */
  async books(userId: UserId): Promise<SecrecyBookView[]> {
    const out: SecrecyBookView[] = [];
    for (const book of await listBooks(this.deps.books, userId, null)) {
      const { last, state } = standing(this.read(book.id, userId).file);
      out.push({ ...book, state, applied: last?.applied ?? null, restored: last?.restored ?? null });
    }
    return out;
  }

  /** One book as it stands now: what Apply would do with it, or what its move did. Writes nothing. */
  preview(bookId: string, userId: UserId): Promise<SecrecyBookPlan> {
    return this.serial(userId, async () => (await this.look(bookId, userId)).plan);
  }

  /** Apply (see the header): the backup first, then each mark and each twin, the old fields left on. */
  apply(bookId: string, version: string, userId: UserId): Promise<SecrecyBookPlan> {
    return this.serial(userId, async () => {
      const look = await this.current(bookId, version, userId);
      if (look.move) throw new SecrecyError("bad_request", "this book's move is under way: confirm it, or restore it first");
      if (look.plan.damaged !== null) throw new SecrecyError("unavailable", "the book's undo copy can't be read, and is kept as it is: nothing was moved");
      if (!look.planned.some((b) => b.kind !== "refused")) throw new SecrecyError("bad_request", "nothing in this book moves to secret marks");
      const move: Move = { applied: this.now(), confirmed: null, restored: null, restoring: false, entries: look.planned };
      const file: SecrecyFile = { v: 1, bookId, name: look.name, moves: [...(look.file?.moves ?? []), move] };
      // The backup is kept before anything is written: a move whose backup can't be written writes nothing in the book.
      await this.write(file, userId);
      for (const b of move.entries) {
        const patch = patchTo(b.before, b.after);
        try {
          const e = look.byId.get(b.id);
          if (patch !== null) {
            if (!e) throw new Error("the entry is gone from its book");
            await this.put(userId, e, patch);
          }
          b.applied = true;
        } catch (error) {
          b.error = { step: "apply", message: message(error) };
          this.deps.log.warn(`[LumiRPEngine] World Info entry ${bookId}/${b.id} wasn't moved to secret marks: ${message(error)}`);
        }
      }
      await this.write(file, userId);
      return (await this.look(bookId, userId)).plan;
    });
  }

  /** Confirm (see the header): the old secrecy fields off every moved entry; the backup stays. */
  confirm(bookId: string, version: string, userId: UserId): Promise<SecrecyBookPlan> {
    return this.serial(userId, async () => {
      const look = await this.current(bookId, version, userId);
      const move = look.move;
      if (!look.file || !move || move.confirmed !== null || move.restoring) throw new SecrecyError("bad_request", "only a move waiting for your check can be confirmed");
      let done = true;
      for (const b of move.entries) {
        const e = look.byId.get(b.id);
        // A refused secret, and one Apply couldn't write, keep their old secrecy: they never moved.
        if (b.kind === "refused" || !b.applied || b.confirmed || !e) continue;
        const extensions = withoutOldSecrecy(e.extensions);
        try {
          if (JSON.stringify(extensions) !== JSON.stringify(e.extensions)) await this.put(userId, e, { extensions });
          b.confirmed = true;
          if (b.error?.step === "confirm") delete b.error;
        } catch (error) {
          done = false;
          b.error = { step: "confirm", message: message(error) };
          this.deps.log.warn(`[LumiRPEngine] World Info entry ${bookId}/${b.id} kept LRE's old secrecy fields: ${message(error)}`);
        }
      }
      if (done) move.confirmed = this.now();
      await this.write(look.file, userId);
      return (await this.look(bookId, userId)).plan;
    });
  }

  /** Restore secrecy as it was (see the header): every backed-up entry back as it stood before the move. */
  restore(bookId: string, version: string, userId: UserId): Promise<SecrecyBookPlan> {
    return this.serial(userId, async () => {
      const look = await this.current(bookId, version, userId);
      const move = look.move;
      if (!look.file || !move) throw new SecrecyError("bad_request", "this book has no move to put back");
      // What the user changed since the move is kept before anything is written over it.
      for (const b of move.entries) {
        const e = look.byId.get(b.id);
        if (e && b.replaced === undefined && patchTo(partsOf(e), leftAs(b)) !== null && patchTo(partsOf(e), b.before) !== null) b.replaced = partsOf(e);
      }
      move.restoring = true;
      await this.write(look.file, userId);
      let done = true;
      for (const b of move.entries) {
        const e = look.byId.get(b.id);
        // One the user deleted since stays deleted: nothing is left to write back to.
        if (!e) continue;
        const patch = patchTo(partsOf(e), b.before);
        try {
          if (patch !== null) await this.put(userId, e, patch);
          if (b.error?.step === "restore") delete b.error;
        } catch (error) {
          done = false;
          b.error = { step: "restore", message: message(error) };
          this.deps.log.warn(`[LumiRPEngine] World Info entry ${bookId}/${b.id} wasn't put back as it stood: ${message(error)}`);
        }
      }
      if (done) move.restored = this.now();
      await this.write(look.file, userId);
      return (await this.look(bookId, userId)).plan;
    });
  }
}
