// The migration's report (STANDALONE-PLAN §15.5): printed by the rehearsal and by the real run, and
// shown on the Migration page. Counts and checksums, never content: every thing found, by where it
// is and its path, with its size, its SHA-256, its row and its fate; per row the sums; per chat its
// turns and what waits on the user; what couldn't be read; what the read-only stand-in kept from
// today's own readers; the disk the real run will take. A run may be compared with the one before
// it, since each is a full read of today's data: what was added, changed and gone since.

import type { AttemptedWrite } from "./stand-in";
import type { Unreadable } from "./inside";
import type { LumiverseMarks } from "./lumiverse-db";
import { type Fate, type Found, NO_PLACE_YET, ROW, type RowId } from "./rows";
import type { ChatEngine, JournalRead } from "./chats";
import type { CarriedReport, Place } from "./carry";
import { goingBack, swapSteps } from "./going-back";
import type { RuntimeFolders } from "./runtime-folders";
import type { Sources } from "./today";

export const REPORT_FORMAT = "rpe-migration-report-v1";

export type Where = "user storage" | "extension storage" | "runtime" | "Lumiverse database";

/** One thing found: a file, or an entry of Lumiverse's database. */
export interface Item {
  where: Where;
  path: string;
  bytes: number;
  sha256: string;
  /** Null: found, not classified. */
  row: RowId | null;
  fate: Fate | null;
  note?: string;
}

/** The fourth count, never "carried" and never "archived": things of a row this build has no place for in RPE yet (`NO_PLACE_YET`). */
const KEPT = "kept in the backup only";
export const BACKUP_ONLY = `${KEPT}: this build has no place for it yet`;

export interface RowReport {
  row: RowId;
  what: string;
  found: Found;
  /** Why the migration doesn't read this row, where it doesn't. */
  why?: string;
  /**
   * Where the row's things go in this run: carried or attached into RPE, archived as the plan has
   * it, or kept in the backup only (`BACKUP_ONLY`). Found must equal the four together; a thing this
   * run has no place for, of a row this build carries, is in none of them (`stranded`).
   */
  count: { found: number; carried: number; attached: number; archived: number; backup: number };
  /** Things of the row this build carries that this run has no place for, and why: the gate refuses the run for them. */
  stranded: { count: number; why: string[] } | null;
  bytes: number;
  /** One SHA-256 over every item's where, path and checksum, in order: equal digests, equal rows. */
  digest: string;
  /**
   * What the row's things inside other rows' files and entries count to, and what is counted. For a
   * row found only inside other rows' things, its own three ends too, counted from where the run puts
   * them (`ends`), and those it has no place for, with why (`stranded`): the gate checks that the
   * ends add up to the count. Both absent from a report kept before runs counted them.
   */
  inside: { count: number; unit: string; ends?: { carried: number; attached: number; archived: number }; stranded?: { count: number; why: string[] } | null } | null;
}

export interface ChatReport {
  chatId: string;
  engine: ChatEngine | null;
  worldId: string | null;
  messages: number;
  replies: number;
  /** What its records hold of the rows found inside chats' things (pack state, knowledge, its places, story entries, unplayed replies, departures), by row. Absent from a report kept before runs counted them by chat. */
  inside?: Partial<Record<RowId, number>>;
  turns: number;
  /** Entries its records' story parts hold, as stored: what the story-record row counts inside it. */
  story: number;
  journal: JournalRead;
  notOpened: string | null;
  deletedTurns: number;
  underWay: number;
  waiting: { questions: number; staged: number; chips: number; reviewCards: number; rollback: boolean };
  /**
   * The writes its journal held (a GM edit, a ✎ fix, a keep, a discard, an undo) over today's own open of the chat: landed on their
   * turns as today's build lands them, refused with a notice, or still held for a window that stays open, which no fold applies;
   * each of those is listed by its kind. Absent from a report kept before runs counted them.
   */
  held?: { landed: number; refused: number; waiting: { kind: string; windows: number }[] };
}

/** What came of a chat a run did not import, as the run's outcome for it says, and whether an earlier run's import of it stands in RPE. */
export interface ChatFate {
  why: string;
  kept: boolean;
}

/** What of a row found inside chats' things a run did not carry for the chats it did not import, grouped by what came of them: kept from an earlier run where an earlier import of them stands, else in the backup only. */
export interface Apart extends ChatFate {
  chats: number;
  count: number;
}

/** Counts by chat, grouped by what came of each chat (`fate`); a chat that counts none is left out. */
export function apartBy(counts: Iterable<readonly [chat: string, count: number]>, fate: (chat: string) => ChatFate): Apart[] {
  const out = new Map<string, Apart>();
  for (const [chat, count] of counts) {
    if (count === 0) continue;
    const f = fate(chat);
    const key = `${f.kept}\u0000${f.why}`;
    const was = out.get(key) ?? { ...f, chats: 0, count: 0 };
    out.set(key, { ...was, chats: was.chats + 1, count: was.count + count });
  }
  return [...out.values()];
}

/** Each group of what a run did not carry, in words: `unit` counted, of how many chats, what came of them, and where it is. */
export function apartText(apart: readonly Apart[], unit: string): string[] {
  return apart.map((a) => `${a.count} ${unit} of ${a.chats} chat(s) this run did not import (${a.why}): ${a.kept ? "kept from an earlier run" : "in the backup only"}`);
}

/** What changed since an earlier run: things by where and path, rows by their digest, chats by their turns. */
export interface Changes {
  since: string;
  added: string[];
  changed: string[];
  gone: string[];
  rows: { row: RowId; found: number; was: number }[];
  chats: { chatId: string; turns: number; was: number | null }[];
}

/** Where RPE's fold of a chat's imported changes differs from today's fold: at a swipe (its message and number) or at the chat's head; the values that differ, by path, never their content. */
export interface Difference {
  at: { message: string; swipe: number } | "head";
  turn: string;
  values: string[];
  /**
   * Whether today's state there is now the turn's starting state, so nothing is lost. False only for
   * a swipe's own path in a chat whose showing replies were placed where they stand: going back to
   * that swipe in RPE gives RPE's own fold there, and this lists how it differs from today's.
   */
  kept: boolean;
}

/** What the real run did with one chat (§15.5: its turns found and imported, and whether its state matched at the head and at every swipe). */
export interface ChatImportReport {
  chatId: string;
  outcome:
    | "imported"
    | "replaced"
    | "played on RPE: left alone"
    | "a chat made from it was played on RPE: left alone"
    | "gone from Lumiverse: removed"
    | "gone from Lumiverse, played on RPE: left alone"
    | "gone from Lumiverse, a chat made from it was played on RPE: left alone"
    | "not imported";
  /** Why a chat was not imported, in fixed words. */
  why?: string;
  /** Turns imported: one per swipe of every reply the chat holds itself. */
  turns: number;
  /**
   * Where its swipes were folded: on their own recorded path (`own`); where they show now, having no
   * turn path of their own (`shown`) or one an edit or a deletion made impossible to rebuild (`lost`).
   */
  placed: { own: number; shown: number; lost: number };
  /** A branch's messages that share the turns of the chat it was made from. */
  shares: { chat: string; messages: number } | null;
  /** Whether RPE's fold matched today's before any starting state was kept: at the head, and at how many of its swipes. */
  matched: { head: boolean; swipes: number; of: number };
  /** Where it didn't: the chat is marked, and today's state there is the turn's starting state. */
  differences: Difference[];
  /** Events today's fold dropped on rebased views, and on-path events that failed to apply again, over its swipes. */
  dropped: number;
  violations: number;
  /**
   * Swipes it carried that were edited after today's build read them: each is tied to what that build
   * read, so the first turn on RPE that finds it showing tells the chat's agents it was edited after its
   * turn. Absent from a report kept before runs counted them.
   */
  edited?: number;
  /**
   * What a replaced chat held of his own changes and his jobs' (R-79), written again just before the turns now tied to the replies they
   * stood before: how many were, and how many had lost their place (their reply is gone) and stay in the backup only. Absent where none.
   */
  own?: { placed: number; lost: number };
}

export interface MigrationReport {
  format: typeof REPORT_FORMAT;
  /** When the run read today's data. */
  at: string;
  mode: "rehearsal" | "real run";
  /** How the extension is installed, as Lumiverse's row of it says, and which storage folders were found. */
  layout: { scope: "operator" | "user" | "not installed"; userFolder: boolean; extensionFolder: boolean };
  /** How Lumiverse's database was opened (`LumiverseDb.opened`). */
  database: "locked" | "immutable";
  rows: RowReport[];
  items: Item[];
  notClassified: Item[];
  chats: ChatReport[];
  unreadable: Unreadable[];
  /** Per runtime: what its working copy hadn't sent, and whether it is taken. */
  unsent: { runtime: string; files: number; kept: boolean; why: string }[];
  /**
   * Today's runtime the run took (the one this user registered with this Lumiverse), why, the unit
   * that runs it and the file it was set up from; and every other runtime here, left alone, with why.
   * Absent from a report kept before runs told runtimes apart.
   */
  runtime?: { taken: { name: string; why: string; unit: string | null; source: string | null } | null; leftAlone: { name: string; why: string }[]; archived?: { name: string; why: string }[] };
  /** The rows he gave (`migration.rows`) to what no row names: each with what was found under it. Absent where he gave none. */
  given?: { path: string; fate: "archived" | "attached"; line: string; found: number }[];
  /** What today's readers tried to write, kept in memory by the stand-in; and their log lines, counted by level. */
  standIn: { writes: AttemptedWrite[]; logged: Record<"debug" | "info" | "warn" | "error", number> };
  /** What today's build put in Lumiverse itself, which stays as it is. */
  lumiverse: LumiverseMarks;
  /** Bytes: the backup's archive, what the import copies (what is carried and attached), both, and what is free where the run writes (null: not asked). */
  disk: { backup: number; import: number; total: number; free: number | null };
  /** Turns under way in today's build as the run read it, over every chat. */
  underWay: number;
  /** What the real run did with each chat; null for a rehearsal. */
  imports: ChatImportReport[] | null;
  /** The backup the real run took before it wrote anything: where, its size and its checksum; null for a rehearsal. */
  backup: { path: string; bytes: number; sha256: string } | null;
  /** Where each row's things now are in RPE, by row; null for a rehearsal (`carry.ts`). */
  landed: Partial<Record<RowId, string>> | null;
  /** What the real run carried besides the chats: the worlds, the settings and those with no home in RPE yet, the settings that name a connection in Lumiverse, the connections; null for a rehearsal. */
  carried: CarriedReport | null;
  /**
   * The worlds the run carried, as RPE's store now keeps them, which Build and play read (`followWorlds`):
   * revisions added, kept already, and left out as not a world document (each listed under what could not
   * be read); and, by world id, worlds new to RPE, each index, draft or history followed from today's side,
   * each kept as RPE has it (changed there since a run put it; `newer`, changed on today's side too), and
   * each world he removed in RPE, which stays removed. The lists are absent from a report kept before runs
   * kept them. Null for a rehearsal.
   */
  worldsInStore: { added: number; held: number; unreadable: number; copied?: string[]; followed?: string[]; kept?: { world: string; file: string; newer: boolean }[]; removed?: string[] } | null;
  changes: Changes | null;
  /** The extension's identifier in Lumiverse, which the swap's steps and going back's name. Absent from a report kept before runs named it. */
  identifier?: string;
  /** The folders the run read (Lumiverse's data folder, today's runtime's two, and what he said of runtime folders): where a rehearsal started from the Migration page reads again. Absent from a report kept before runs named them. */
  sources?: Omit<Sources, "identifier" | "userId">;
  /**
   * Each chat that was on today and is on none of RPE's connections once swapped (N-14, R-109): RPE's are every connection in
   * Lumiverse that reaches the runtime the run takes. By id, with the connection it is pinned to in Lumiverse (null: none, so it
   * follows the connection active for him). RPE writes nothing into his chats: choosing one of RPE's for it puts it on RPE.
   * Absent from a report kept before runs listed them.
   */
  offRpe?: { chat: string; pinned: string | null }[];
  /**
   * Where the tidy-up's settings were found, level by level (R-201), nothing assumed of a level from its type: the chats whose own
   * choices hold its switch or leave-alone list (carried into each chat's RPE.yml), the worlds whose head revision holds its switch
   * (kept in the world document, carried with the world), and a user-level `tidy` in settings.json, as today's own reader reads
   * it (carried into `things.tidyRunMost`); null where none is stored. Absent from a report kept before runs looked.
   */
  tidy?: { chats: string[]; worlds: string[]; user: number | null };
  /** Why the real run won't start on this report; none: it may. After a real run, what of it did not balance once counted from what the run did, which the swap reads. */
  refusals: string[];
}

/**
 * Whose RPE a run writes into: the user whose data moves and whether Lumiverse's database knows them,
 * the Lumiverse user RPE's config says it belongs to (null: none yet), and the users whose data
 * earlier runs carried into its data folder.
 */
export interface Whose {
  user: string;
  known: boolean;
  owner: string | null;
  earlier: readonly string[];
}

/**
 * Whether the real run may start on a report, and if not, why: the rows' sums, nothing unclassified,
 * the user known and the RPE theirs, the runtime where the run looks for it and which one is the
 * user's told, the disk. `runtime.missing` is the runtime's folders where neither is there
 * (`Today.runtimeMissing`); `runtime.undecided` why the run can't tell which runtime is the user's.
 */
export function refusalsOf(report: Pick<MigrationReport, "rows" | "notClassified" | "disk">, whose: Whose, runtime: { missing: RuntimeFolders | null; undecided: string | null }): string[] {
  const out: string[] = [];
  if (!whose.known) out.push("Lumiverse's database has no such user.");
  // One RPE serves one Lumiverse user: its keys, settings and files are that user's alone.
  if (whose.owner !== null && whose.owner !== whose.user) out.push(`This RPE belongs to the Lumiverse user ${whose.owner}, and this run is for ${whose.user}: one RPE serves one Lumiverse user.`);
  for (const other of whose.earlier) if (other !== whose.user) out.push(`An earlier run carried the data of the Lumiverse user ${other} into this data folder, and this run is for ${whose.user}: one RPE serves one Lumiverse user.`);
  // Without its folders the run would carry no unsent writes and no keys, and the backup would lack what going back needs: it says so rather than run as if there were none.
  if (runtime.missing !== null) out.push(`The runtime's folders are not where this run looks: neither ${runtime.missing.configDir} nor ${runtime.missing.dataDir} is there. Say where they are, or that the server runs no runtime of today's build (--no-runtime).`);
  if (runtime.undecided !== null) out.push(runtime.undecided);
  for (const r of report.rows) {
    const { found, carried, attached, archived, backup } = r.count;
    if (found !== carried + attached + archived + backup) out.push(`Row "${r.what}": ${found} found, but ${carried} carried, ${attached} attached, ${archived} archived and ${backup} ${KEPT}${r.stranded ? `; ${r.stranded.count} have no place in this run: ${r.stranded.why.join("; ")}` : ""}.`);
    // A row found only inside other rows' things has its own three ends, which must add up to what was found of it.
    const i = r.inside;
    if (r.found === "inside" && i !== null && i.ends !== undefined) {
      const e = i.ends;
      if (i.count !== e.carried + e.attached + e.archived) out.push(`Row "${r.what}": ${i.count} found inside other rows' things, but ${e.carried} carried, ${e.attached} attached and ${e.archived} archived${i.stranded ? `; ${i.stranded.count} have no place in this run: ${i.stranded.why.join("; ")}` : ""}.`);
    }
  }
  if (report.notClassified.length > 0) out.push(`${report.notClassified.length} found, not classified: ${report.notClassified.map((i) => `${i.where}: ${i.path}`).join("; ")}.`);
  if (report.disk.free !== null && report.disk.free < report.disk.total) out.push(`The real run needs ${report.disk.total} bytes where it writes, and ${report.disk.free} are free.`);
  return out;
}

/** Where a run's things of one chat end: carried (the run imported it, or an earlier run's import of it stands in RPE), or not, with why. */
export type ChatEnd = { carried: true } | { carried: false; why: string };

/** The chat an item belongs to, by its path: its entries in Lumiverse's database, its run data, its area of the harness's docs; null for one of no chat. */
export function chatOfItem(item: Pick<Item, "path">): string | null {
  return /^(?:chats|runs|harness\/docs\/chats)\/([^/]+)\//.exec(item.path)?.[1] ?? null;
}

/**
 * How each chat's things end in a run, as its import's outcome says: a chat it imported, or one an
 * earlier run's import of which stands (`stands`), is carried; one it did not import is not, with
 * the outcome's words. A chat the run has no outcome for (before the import, or a rehearsal) is
 * taken as the import would take it: carried.
 */
export function chatEndOf(report: Pick<MigrationReport, "imports">, stands: (chat: string) => boolean): (chat: string) => ChatEnd {
  const imports = new Map((report.imports ?? []).map((c) => [c.chatId, c]));
  return (chat) => {
    const c = imports.get(chat);
    if (c === undefined || c.outcome === "imported" || c.outcome === "replaced" || stands(chat)) return { carried: true };
    return { carried: false, why: `${c.outcome}${c.why ? `: ${c.why}` : ""}` };
  };
}

/**
 * A row's own things counted by where the run puts each (`place`; undefined for one archived or not
 * classified): carried and attached where they land, archived, kept in the backup only where the
 * row may be (`NO_PLACE_YET`), and those with no place, with why.
 */
export function countRow(row: RowId, own: readonly Item[], place: (item: Item) => Place | undefined): Pick<RowReport, "count" | "stranded"> {
  const landing = (fate: "carried" | "attached"): number => own.filter((i) => i.fate === fate && place(i) === "lands").length;
  const mayWait = Object.hasOwn(NO_PLACE_YET, row);
  const later = mayWait ? own.filter((i) => place(i) === "later").length : 0;
  const none = own.flatMap((i) => {
    const at = place(i);
    if (at === undefined || at === "lands") return [];
    return at === "later" ? (mayWait ? [] : ["this build has no place for it, and its row is not one that may be kept in the backup only"]) : [at.none];
  });
  return {
    count: { found: own.length, carried: landing("carried"), attached: landing("attached"), archived: own.filter((i) => i.fate === "archived").length, backup: later },
    stranded: none.length === 0 ? null : { count: none.length, why: [...new Set(none)] },
  };
}

/**
 * Counts each row's own things again from what the run did (R-320): a thing of a chat the run did not
 * carry is not carried, whatever was planned for it, and is named with why.
 */
export function recountRows(report: Pick<MigrationReport, "rows" | "items">, place: (item: Item) => Place | undefined, end: (chat: string) => ChatEnd): void {
  const after = (item: Item): Place | undefined => {
    const at = place(item);
    const chat = at === "lands" ? chatOfItem(item) : null;
    if (chat === null) return at;
    const e = end(chat);
    return e.carried ? at : { none: `chat ${chat} was not carried (${e.why})` };
  };
  for (const r of report.rows) Object.assign(r, countRow(r.row, report.items.filter((i) => i.row === r.row), after));
}

/** The rows found inside chats' records, counted chat by chat (`ChatReport.inside`). */
export const CHAT_HELD: readonly RowId[] = ["pack-state", "secret-holdings", "chat-places", "story-record", "unplayed", "departures"];

/**
 * Each row found only inside other rows' things gets its three ends (R-321): before the run, where
 * the run would put them; after a real run (`report.carried` set), from what it did. Of the mind
 * files and the story record the carry's own counts say; of the rest held in chats' records, each
 * chat's count ends where its chat does; of the rest, the row's fate where its things have a place.
 * `tree`: whether the run is given the file tree's places, where GUIDANCE.md and his own agents go.
 */
export function insideEnds(report: Pick<MigrationReport, "rows" | "chats" | "carried">, end: (chat: string) => ChatEnd, tree: boolean): void {
  const c = report.carried;
  for (const r of report.rows) {
    const inside = r.inside;
    if (r.found !== "inside" || inside === null) continue;
    const fate = ROW[r.row].fate;
    const ends = { carried: 0, attached: 0, archived: 0 };
    const none: string[] = [];
    let stranded = 0;
    const put = (n: number, to: Fate | { none: string }): void => {
      if (n <= 0) return;
      if (typeof to === "string") ends[to] += n;
      else {
        stranded += n;
        none.push(to.none);
      }
    };
    const apart = (list: readonly Apart[]): void => {
      for (const a of list) put(a.count, a.kept ? fate : { none: `${a.chats} chat(s) this run did not import (${a.why})` });
    };
    if (r.row === "mind-files" && c !== null) {
      const m = c.minds;
      put(m.versions - m.unlisted + m.shared, "attached");
      // Versions no imported turn ended with, and those whose text today's clean-up had removed (listed as not read): kept in the backup, and listed.
      put(m.untied + m.gone, "archived");
      apart(m.apart);
    } else if (r.row === "story-record" && c !== null) {
      const s = c.story;
      put(s.beats + s.struck + s.futures + s.castings + s.shared, "carried");
      // Damaged entries today's reader leaves out are kept word for word beside their turns; those on records no imported turn holds are kept in the backup, and listed.
      put(s.leftOut, "attached");
      put(s.unheld, "archived");
      apart(s.apart);
    } else if (CHAT_HELD.includes(r.row)) {
      let seen = 0;
      for (const chat of report.chats) {
        const n = chat.inside?.[r.row] ?? 0;
        seen += n;
        const e = end(chat.chatId);
        put(n, e.carried ? fate : { none: `chat ${chat.chatId} was not carried (${e.why})` });
      }
      put(inside.count - seen, fate);
    } else if ((r.row === "guidance" || r.row === "own-agents") && !tree) put(inside.count, { none: "this run was not given the file tree's places" });
    else put(inside.count, fate);
    inside.ends = ends;
    inside.stranded = stranded === 0 ? null : { count: stranded, why: [...new Set(none)] };
  }
}

/** What changed between an earlier report and this one. */
export function changesSince(before: MigrationReport, now: Pick<MigrationReport, "items" | "rows" | "chats">): Changes {
  const key = (i: Item): string => `${i.where}: ${i.path}`;
  const was = new Map(before.items.map((i) => [key(i), i.sha256]));
  const is = new Map(now.items.map((i) => [key(i), i.sha256]));
  const added: string[] = [];
  const changed: string[] = [];
  for (const [k, sha] of is) {
    const old = was.get(k);
    if (old === undefined) added.push(k);
    else if (old !== sha) changed.push(k);
  }
  const gone = [...was.keys()].filter((k) => !is.has(k));
  const oldRows = new Map(before.rows.map((r) => [r.row, r]));
  const rows = now.rows.flatMap((r) => {
    const old = oldRows.get(r.row);
    return old && old.digest === r.digest ? [] : [{ row: r.row, found: r.count.found, was: old?.count.found ?? 0 }];
  });
  const oldChats = new Map(before.chats.map((c) => [c.chatId, c.turns]));
  const chats = now.chats.flatMap((c) => {
    const old = oldChats.get(c.chatId);
    return old === c.turns ? [] : [{ chatId: c.chatId, turns: c.turns, was: old ?? null }];
  });
  return { since: before.at, added, changed, gone, rows, chats };
}

/** A row's count inside other rows' things, with its own three ends where it is found only there. */
function insideWords(r: RowReport): string {
  const i = r.inside;
  if (i === null) return "";
  const e = i.ends;
  const ends = r.found === "inside" && e !== undefined ? ` = ${e.carried} + ${e.attached} + ${e.archived}${i.stranded ? `, and ${i.stranded.count} with no place (${i.stranded.why.join("; ")})` : ""}` : "";
  return `; inside: ${i.count} ${i.unit}${ends}`;
}

/** The report in plain words, as the rehearsal prints it. */
export function reportText(report: MigrationReport): string {
  const lines: string[] = [];
  lines.push(`Migration ${report.mode}, read at ${report.at}.`);
  lines.push(`Extension installed ${report.layout.scope === "not installed" ? "nowhere Lumiverse knows of" : `per ${report.layout.scope === "user" ? "user" : "extension"}`}; Lumiverse's database opened ${report.database === "locked" ? "read-only, under its own locks" : "as an unchanging file"}.`);
  lines.push(report.refusals.length === 0 ? "The real run may start." : "The real run won't start:");
  for (const r of report.refusals) lines.push(`  - ${r}`);
  lines.push("", `Row: found = carried + attached + archived + ${KEPT} (bytes)`);
  for (const r of report.rows) {
    const c = r.count;
    const own = r.found === "not read" ? `not read: ${r.why ?? ""}` : `${c.found} = ${c.carried} + ${c.attached} + ${c.archived} + ${c.backup} (${r.bytes})`;
    lines.push(`  ${r.what}: ${own}${insideWords(r)}`);
  }
  if (report.notClassified.length > 0) {
    lines.push("", "Found, not classified:");
    for (const i of report.notClassified) lines.push(`  ${i.where}: ${i.path} (${i.bytes} bytes, ${i.sha256})`);
  }
  lines.push("", "Chats: turns, and what waits on you");
  for (const c of report.chats) {
    const held = c.held ?? { landed: 0, refused: 0, waiting: [] };
    const waits = [c.waiting.questions > 0 ? `${c.waiting.questions} keep-or-discard question(s)` : "", c.waiting.staged > 0 ? "a staged action" : "", c.waiting.chips > 0 ? `${c.waiting.chips} chip(s), ${c.waiting.reviewCards} of them review cards` : "", c.waiting.rollback ? "a rollback that was never applied" : "", held.waiting.length > 0 ? `${held.waiting.length} held write(s) still waiting for a reply that is under way (${held.waiting.map((w) => w.kind).join(", ")}), which no fold applies` : ""].filter((w) => w !== "");
    const landed = [held.landed > 0 ? `${held.landed} held write(s) landed on their turns` : "", held.refused > 0 ? `${held.refused} held write(s) refused as their window closed` : ""].filter((w) => w !== "");
    lines.push(`  ${c.chatId} (${c.engine ?? "no world"}): ${c.turns} turns over ${c.replies} replies; journal ${c.journal}${c.underWay > 0 ? `; ${c.underWay} turn(s) under way` : ""}${landed.length > 0 ? `; ${landed.join(", ")}` : ""}${waits.length > 0 ? `; waiting: ${waits.join(", ")}` : ""}`);
  }
  // The chats he must put on RPE himself (N-14): RPE plays only what reaches it on its own connections, and writes nothing into his chats.
  if ((report.offRpe ?? []).length > 0) {
    lines.push("", "Chats that were on today and are on none of RPE's connections once swapped (every connection that reaches today's runtime becomes RPE's): in Lumiverse, choose one of RPE's connections for each, and it is on RPE.");
    for (const c of report.offRpe ?? []) lines.push(`  ${c.chat}: ${c.pinned === null ? "pinned to no connection, so it follows the one active for you" : `pinned to connection ${c.pinned}`}`);
  }
  if (report.imports !== null) {
    lines.push("", "Chats into RPE: turns, where each swipe was folded, and the check against today's fold");
    for (const c of report.imports) {
      if (c.outcome !== "imported" && c.outcome !== "replaced") {
        lines.push(`  ${c.chatId}: ${c.outcome}${c.why ? ` (${c.why})` : ""}`);
        continue;
      }
      const p = c.placed;
      const where = `${p.own} on their own path, ${p.shown} where they show (no turn path of their own), ${p.lost} where they show (their own path lost to an edit or a deletion)`;
      const check = `matched at the head ${c.matched.head ? "yes" : "no"}, at ${c.matched.swipes} of ${c.matched.of} swipes`;
      lines.push(`  ${c.chatId}: ${c.outcome}, ${c.turns} turns (${where})${c.shares ? `; shares ${c.shares.messages} message(s) with ${c.shares.chat}` : ""}; ${check}${c.differences.length > 0 ? "; MARKED: today's state is kept as the start where they differ" : ""}`);
      for (const d of c.differences) lines.push(`    ${d.kept ? "differs" : "differs (not kept: the turn is the chat it was made from's)"} at ${d.at === "head" ? "the head" : `message ${d.at.message}, swipe ${d.at.swipe}`}: ${d.values.join(", ")}`);
      if ((c.edited ?? 0) > 0) lines.push(`    ${c.edited} swipe(s) edited since today's build read them: each is told to the chat's agents as a reply edited after its turn, at the first turn on RPE that finds it showing`);
      if (c.own !== undefined) lines.push(`    ${c.own.placed} change(s) of his own and his jobs' made in RPE since an earlier run are kept, tied to the same replies${c.own.lost > 0 ? `; ${c.own.lost} had lost their place (their reply is gone) and are not kept` : ""}`);
    }
  }
  if (report.unreadable.length > 0) {
    lines.push("", "Could not be read:");
    for (const u of report.unreadable) lines.push(`  ${u.path}: ${u.why}`);
  }
  if (report.unsent.length > 0) {
    lines.push("", "Not yet sent by the runtime:");
    for (const u of report.unsent) lines.push(`  ${u.runtime}: ${u.files} file(s), ${u.kept ? "taken" : "not taken"}: ${u.why}`);
  }
  if (report.runtime !== undefined && (report.runtime.taken !== null || report.runtime.leftAlone.length > 0 || (report.runtime.archived ?? []).length > 0)) {
    const { taken, leftAlone } = report.runtime;
    lines.push("", taken === null ? "Today's runtime: none of this user's taken." : `Today's runtime: took ${taken.name}, ${taken.why}.`);
    for (const r of leftAlone) lines.push(`  Left alone: ${r.name}, ${r.why}.`);
    for (const r of report.runtime.archived ?? []) lines.push(`  Runtime folder ${r.name}: ${r.why}; its files are counted under the working copy and archived in the backup.`);
  }
  if ((report.given ?? []).length > 0) {
    lines.push("", "Rows you gave to what no row names (migration.rows):");
    for (const g of report.given ?? []) lines.push(`  ${g.path}: ${g.fate}, ${g.line} (${g.found} thing(s) found${g.found === 0 ? ": nothing found under that path" : ""})`);
  }
  lines.push("", `Today's readers tried ${report.standIn.writes.length} write(s), kept in memory and never made:`);
  for (const w of report.standIn.writes) lines.push(`  ${w.store}: ${w.op} ${w.path}${w.to ? ` to ${w.to}` : ""}`);
  const m = report.lumiverse;
  lines.push("", `In Lumiverse, left as they are: ${m.engineBooks} engine book(s) with ${m.engineEntries} entries, attached to ${m.chatsWithEngineBook} chat(s); ${m.markedEntries} entries of your own books with engine fields; ${m.regexScripts} regex script(s); ${m.presetBlocks} preset block(s) and ${m.outletReferences} outlet reference(s); ${m.panelMessages} message(s) the panels put in your chats; ${m.chatsPinned} chat(s) pinned to the engine's connection, ${m.chatsPinnedToModel} of them to a model too; ${m.schedulerExclusions === null ? "no scheduler exclusions set" : `${m.schedulerExclusions.listed} origin(s) on the scheduler's exclusions, ${m.schedulerExclusions.engine} of them the engine's address`}.`);
  lines.push("", `Disk: the backup takes ${report.disk.backup} bytes and the import ${report.disk.import}, ${report.disk.total} in all${report.disk.free === null ? "" : `; ${report.disk.free} are free`}.`);
  if (report.backup) lines.push(`Backup taken: ${report.backup.path} (${report.backup.bytes} bytes, sha256 ${report.backup.sha256}).`);
  // Each world revision, by its path, with its checksum: what the real run copies into RPE byte for byte.
  const revisions = report.items.filter((i) => i.row === "worlds" && /^worlds\/[^/]+\/rev\/[^/]+\.json$/.test(i.path));
  if (revisions.length > 0) {
    lines.push("", `World revisions ${report.mode === "real run" ? "copied" : "the real run copies"}, byte for byte, with their checksums:`);
    for (const i of revisions) lines.push(`  ${i.path}: sha256 ${i.sha256}`);
  }
  // What the depth engine left, kind by kind (N-6): archived, kept in the backup, and nothing of it loaded.
  const depth = new Map<string, number>();
  for (const i of report.items) if (i.row === "depth-engine") depth.set(i.note ?? "", (depth.get(i.note ?? "") ?? 0) + 1);
  if (depth.size > 0) {
    lines.push("", "What the depth engine left, archived in the backup and not loaded, by kind:");
    for (const [kind, n] of depth) lines.push(`  ${n} × ${kind}`);
  }
  // The swap's steps, and going back's with the previous build's permissions by name (R-80), as the swap and going back say them.
  if (report.identifier !== undefined) {
    const taken = report.runtime?.taken ?? null;
    lines.push("", "The swap, once you choose to make it:", ...swapSteps({ identifier: report.identifier }));
    lines.push("", ...goingBack({ identifier: report.identifier, runtime: taken === null ? null : { name: taken.name, source: taken.source }, downRun: false }));
  }
  if (report.landed) {
    lines.push("", "Where each row's things are now in RPE:");
    for (const r of report.rows) {
      const at = report.landed[r.row];
      if (at !== undefined) lines.push(`  ${r.what}: ${at}`);
      else if (r.count.backup > 0) lines.push(`  ${r.what}: ${BACKUP_ONLY}`);
      else if (r.count.archived > 0) lines.push(`  ${r.what}: archived, kept in the backup for good, as the plan has it`);
    }
  }
  if (report.worldsInStore) {
    const w = report.worldsInStore;
    lines.push("", `World revisions RPE's store keeps for Build and play: ${w.added} added, ${w.held} kept already, ${w.unreadable} left out as not a world document${w.unreadable > 0 ? " (listed under what could not be read)" : ""}.`);
    if ((w.copied ?? []).length > 0) lines.push(`Worlds new to RPE, put whole: ${(w.copied ?? []).join(", ")}.`);
    if ((w.followed ?? []).length > 0) lines.push(`Changed on today's side since a run put them, and followed in RPE (RPE's copy was still the run's): ${(w.followed ?? []).join(", ")}.`);
    for (const k of w.kept ?? []) lines.push(`The world ${k.world}: its ${k.file} was changed in RPE since a run put it, and is kept as RPE has it${k.newer ? "; today's side changed it too, and today's newer file is in RPE's copy of today's worlds and in the backup" : ""}.`);
    for (const id of w.removed ?? []) lines.push(`The world ${id} was removed in RPE since a run put it, and stays removed; its revisions are kept for the chats that play them.`);
  }
  if (report.carried) {
    const { settings, connections, ownFiles } = report.carried;
    // Waiting on you, first: your GUIDANCE.md, switched off; then the settings naming a connection RPE can't use.
    if (ownFiles !== null && ownFiles.guidance > 0) lines.push("", "Waiting on you: your GUIDANCE.md is in the file tree under imported/, switched off, since it was written for agents that are gone or changed. Switch it on as an AGENTS.md at the same level, or copy from it.");
    if (ownFiles === null) lines.push("", "Your own agents, skills, texts, GUIDANCE.md, notes and learned files were not carried: this run was not given the file tree's places. They are in the backup.");
    else if (ownFiles.leftOut > 0) lines.push("", `${ownFiles.leftOut} of your own file(s) have names that would leave the folder they go in: not written, in the backup.`);
    if (ownFiles !== null && ownFiles.removed + ownFiles.changed > 0) lines.push("", `Files an earlier run wrote into the file tree that today's side no longer has: ${ownFiles.removed} removed${ownFiles.changed > 0 ? `; ${ownFiles.changed} changed in RPE since, left as they are` : ""}.`);
    for (const g of report.carried.worlds.gone ?? []) lines.push("", g.kept ? `The world ${g.world} was deleted on today's side since an earlier run: RPE keeps its copy, since a chat carried from today's side plays it.` : `The world ${g.world} was deleted on today's side since an earlier run, and no chat carried from today's side plays it: RPE's copy of it is gone too.`);
    // Every place that names a connection (R-80, row 128): carried to one of RPE's connections, or with no match, by name, for him to pick.
    const choices = report.carried.modelChoices ?? [];
    if (choices.length > 0) {
      lines.push("", "Model choices, each where today's build kept it:");
      for (const c of choices) lines.push(`  ${c.where} (connection ${c.connection}${c.model === null ? "" : `, model ${c.model}`}): ${c.carried !== null ? `RPE's connection ${c.carried.id} (${c.carried.how})` : `no match in RPE${c.to === null ? "; RPE has no place for that work, which its default connection does" : `; pick one of RPE's for his agent ${c.to.agent} on the Migration page, until then its default connection does that work`}`}`);
    }
    // His texts and his agents' tools with no counterpart, by name.
    if (ownFiles !== null) {
      const apart = ownFiles.textsSetApart ?? [];
      if (apart.length > 0) {
        lines.push("", "His texts that today's build would not send, or whose id no build had, attached as set apart:");
        for (const t of apart) lines.push(`  ${t.id}: ${t.reason.replaceAll("_", " ")}${t.missing.length > 0 ? ` (${t.missing.join(", ")})` : ""}`);
      }
      if ((ownFiles.textsNotText ?? []).length > 0) lines.push("", `Texts that are no text, kept in the backup: ${(ownFiles.textsNotText ?? []).join(", ")}.`);
      const dead = ownFiles.deadTools ?? [];
      if (dead.length > 0) {
        lines.push("", "Tools his agents name that no longer exist:");
        for (const d of dead) lines.push(`  ${d.agent}: ${d.tool}`);
      } else if (ownFiles.toolsChecked === false && ownFiles.agents > 0) lines.push("", "His agents' tools were not checked: this run was not given the tree's list of tools.");
    }
    // Pins whose agent is not the one they were pinned for in today's build, each said with the file (R-174): none is lost, each is still used in play or waits on a switch.
    const pinned = report.carried.pins ?? null;
    if (pinned !== null && pinned.forAuthor.length > 0) {
      lines.push("", "Pins for a role RPE has no agent for, pinned for the Author so they are still used in play:");
      for (const p of pinned.forAuthor) lines.push(`  ${p.file}: pinned for ${p.role} in today's build`);
    }
    if (pinned !== null && pinned.forOwn.length > 0) {
      lines.push("", "Pins for one of his own agents, which is carried switched off, so the file is handed to it once he switches it on:");
      for (const p of pinned.forOwn) lines.push(`  ${p.file}: ${p.agent}`);
    }
    if (pinned !== null && pinned.carried + pinned.removed + pinned.takenOut > 0) lines.push("", "Today's pin budgets (how much of a pin the old engines gave) are not carried: RPE hands a pinned file whole, and the budgets are archived with the old engines' settings.");
    if (connections !== null) lines.push("", "why" in connections ? `Connections: none carried, as ${connections.why}.` : `Connections carried from runtime ${connections.runtime}: ${connections.connections.join(", ") || "none"}; ${connections.keys} key(s), ${connections.signins} sign-in(s), ${connections.headerValues} header value(s); the default ${connections.default ?? "not set"}${connections.defaultKept === true ? " (chosen in RPE: kept over today's)" : ""}${connections.kept > 0 ? `; ${connections.kept} key(s), sign-in(s) and header value(s) RPE already held, which differ from today's, kept as RPE's` : ""}${connections.leftOut > 0 ? `; ${connections.leftOut} entry(s) left out, as today's runtime leaves them out` : ""}.`);
    if (connections !== null && !("why" in connections) && (connections.changedInRpe ?? []).length > 0) lines.push(`Connections changed or removed in RPE since a run carried them, left as RPE has them (today's copy not taken): ${(connections.changedInRpe ?? []).join(", ")}.`);
    // What today's side reset, removed or rotated since an earlier run: followed in RPE where RPE's copy was still what a run put there; else left as RPE has it.
    const own = report.carried.chatSettings;
    const followed = [...(connections !== null && !("why" in connections) ? (connections.followed ?? []) : []), ...(settings.followed ?? []), ...(own?.followed ?? [])];
    if (followed.length > 0) {
      lines.push("", "Changed on today's side since an earlier run, and what this run did about each:");
      for (const f of followed) lines.push(`  ${f.what}: ${f.change}; ${f.followed ? "followed in RPE" : "RPE's copy is not what a run put there, left as RPE has it"}`);
    }
    // Each chat's own choices, in its own RPE.yml: carried, left as RPE has them, or not carried with why.
    if (own !== null) {
      lines.push("", `Each chat's own choices (its knowledge switch, narrator view, story and tidy-up) in its RPE.yml: ${own.carried.length} carried${own.keptInRpe.length > 0 ? `, ${own.keptInRpe.length} changed in RPE since a run put them and left as RPE has them` : ""}${own.notCarried.length > 0 ? `, ${own.notCarried.length} not carried (kept in the backup)` : ""}.`);
      for (const n of own.notCarried) lines.push(`  ${n.chat}: ${n.from} (${n.to}: ${n.why})`);
      for (const t of own.tidyCut) lines.push(`  ${t.chat}: ${t.left} older key(s) of what it told the tidy-up to leave alone are left out, as the list holds at most the number things.tidyLeftMost says`);
    }
    lines.push("", "Settings carried into RPE's config:");
    for (const s of settings.carried) lines.push(`  ${s.from} → ${s.to}`);
    if (settings.carried.length === 0) lines.push("  none");
    if ((settings.keptInRpe ?? []).length > 0) {
      lines.push("", "Settings a run carried before and changed in RPE since, left as RPE has them (today's value not taken):");
      for (const s of settings.keptInRpe ?? []) lines.push(`  ${s.to} (today's ${s.from})`);
    }
    if ((settings.notCarried ?? []).length > 0) {
      lines.push("", "Settings RPE has a like setting for that means something else or takes no such value, not carried (kept in the backup):");
      for (const s of settings.notCarried ?? []) lines.push(`  ${s.from} (RPE's ${s.to}: ${s.why})`);
    }
    if ((settings.archived ?? []).length > 0) {
      lines.push("", "Settings that steered only an old engine, archived (kept in the backup):");
      for (const s of settings.archived ?? []) lines.push(`  ${s.from} (${s.why})`);
    }
    lines.push("", "Settings with no setting of the same meaning in RPE (kept in the backup):");
    for (const s of settings.noHome) lines.push(`  ${s}`);
  }
  // Where the tidy-up's settings were found, level by level, and no level where none was (R-201).
  if (report.tidy !== undefined) {
    const t = report.tidy;
    const found = [
      t.chats.length > 0 ? `at the chat's level, in ${t.chats.length} chat(s): ${t.chats.join(", ")} (each carried into its RPE.yml)` : "",
      t.worlds.length > 0 ? `at the world's level, in ${t.worlds.length} world(s): ${t.worlds.join(", ")} (packs.gear.config.tidy.auto, kept in the world document)` : "",
      t.user !== null ? `at the user's level: ${t.user} finding(s) a Tidy up run shows (carried into things.tidyRunMost)` : "",
    ].filter((s) => s !== "");
    lines.push("", found.length === 0 ? "The tidy-up's settings: found at no level." : `The tidy-up's settings were found ${found.join("; ")}.`);
  }
  if (report.changes) {
    const c = report.changes;
    lines.push("", `Since the run of ${c.since}: ${c.added.length} added, ${c.changed.length} changed, ${c.gone.length} gone; ${c.rows.length} row(s) and ${c.chats.length} chat(s) differ.`);
  }
  // Last, so that nobody reads such a run as complete: what it keeps in the backup only, by row.
  const kept = report.rows.filter((r) => r.count.backup > 0);
  if (kept.length > 0) {
    lines.push("", report.mode !== "real run" ? "The real run will keep these in the backup only, as this build has no place for them in RPE yet:" : "Kept in the backup only, as this build has no place for them in RPE yet: this run did not carry everything. A later run carries them once it has a place for them.");
    for (const r of kept) lines.push(`  ${r.what}: ${r.count.backup} thing(s)`);
    lines.push(`  In all: ${kept.reduce((n, r) => n + r.count.backup, 0)} thing(s), of ${kept.length} row(s).`);
  }
  return `${lines.join("\n")}\n`;
}
