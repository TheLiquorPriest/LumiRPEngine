// The migration's report (STANDALONE-PLAN §15.5): printed by the rehearsal and by the real run, and
// shown on the Migration page. Counts and checksums, never content: every thing found, by where it
// is and its path, with its size, its SHA-256, its row and its fate; per row the sums; per chat its
// turns and what waits on the user; what couldn't be read; what the read-only stand-in kept from
// today's own readers; the disk the real run will take. A run may be compared with the one before
// it, since each is a full read of today's data: what was added, changed and gone since.

import type { AttemptedWrite } from "./stand-in";
import type { Unreadable } from "./inside";
import type { LumiverseMarks } from "./lumiverse-db";
import type { Fate, Found, RowId } from "./rows";
import type { ChatEngine, JournalRead } from "./chats";

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

export interface RowReport {
  row: RowId;
  what: string;
  found: Found;
  /** Why the migration doesn't read this row, where it doesn't. */
  why?: string;
  count: { found: number; carried: number; attached: number; archived: number };
  bytes: number;
  /** One SHA-256 over every item's where, path and checksum, in order: equal digests, equal rows. */
  digest: string;
  /** What the row's things inside other rows' files and entries count to, and what is counted. */
  inside: { count: number; unit: string } | null;
}

export interface ChatReport {
  chatId: string;
  engine: ChatEngine | null;
  worldId: string | null;
  messages: number;
  replies: number;
  turns: number;
  journal: JournalRead;
  notOpened: string | null;
  deletedTurns: number;
  underWay: number;
  waiting: { questions: number; staged: number; chips: number; reviewCards: number; rollback: boolean };
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
   * turn path of their own (`shown`) or one an edit or a deletion made impossible to rebuild (`lost`);
   * a showing reply placed where it stands (`head`, when `placedAsShown`).
   */
  placed: { own: number; shown: number; lost: number; head: number };
  /** A branch's messages that share the turns of the chat it was made from. */
  shares: { chat: string; messages: number } | null;
  /** Its head stood rebased and differed, so its showing replies were placed where they stand. */
  placedAsShown: boolean;
  /** Whether RPE's fold matched today's before any starting state was kept: at the head, and at how many of its swipes. */
  matched: { head: boolean; swipes: number; of: number };
  /** Where it didn't: the chat is marked, and today's state there is the turn's starting state. */
  differences: Difference[];
  /** Events today's fold dropped on rebased views, and on-path events that failed to apply again, over its swipes. */
  dropped: number;
  violations: number;
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
  changes: Changes | null;
  /** Why the real run won't start on this report; none: it may. */
  refusals: string[];
}

/** Whether the real run may start on a report, and if not, why: the rows' sums, nothing unclassified, the user known, the disk. */
export function refusalsOf(report: Pick<MigrationReport, "rows" | "notClassified" | "disk">, userKnown: boolean): string[] {
  const out: string[] = [];
  if (!userKnown) out.push("Lumiverse's database has no such user.");
  for (const r of report.rows) {
    const { found, carried, attached, archived } = r.count;
    if (found !== carried + attached + archived) out.push(`Row "${r.what}": ${found} found, but ${carried} carried, ${attached} attached and ${archived} archived.`);
  }
  if (report.notClassified.length > 0) out.push(`${report.notClassified.length} found, not classified: ${report.notClassified.map((i) => `${i.where}: ${i.path}`).join("; ")}.`);
  if (report.disk.free !== null && report.disk.free < report.disk.total) out.push(`The real run needs ${report.disk.total} bytes where it writes, and ${report.disk.free} are free.`);
  return out;
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

/** The report in plain words, as the rehearsal prints it. */
export function reportText(report: MigrationReport): string {
  const lines: string[] = [];
  lines.push(`Migration ${report.mode}, read at ${report.at}.`);
  lines.push(`Extension installed ${report.layout.scope === "not installed" ? "nowhere Lumiverse knows of" : `per ${report.layout.scope === "user" ? "user" : "extension"}`}; Lumiverse's database opened ${report.database === "locked" ? "read-only, under its own locks" : "as an unchanging file"}.`);
  lines.push(report.refusals.length === 0 ? "The real run may start." : "The real run won't start:");
  for (const r of report.refusals) lines.push(`  - ${r}`);
  lines.push("", "Row: found = carried + attached + archived (bytes)");
  for (const r of report.rows) {
    const c = r.count;
    const own = r.found === "not read" ? `not read: ${r.why ?? ""}` : `${c.found} = ${c.carried} + ${c.attached} + ${c.archived} (${r.bytes})`;
    lines.push(`  ${r.what}: ${own}${r.inside ? `; inside: ${r.inside.count} ${r.inside.unit}` : ""}`);
  }
  if (report.notClassified.length > 0) {
    lines.push("", "Found, not classified:");
    for (const i of report.notClassified) lines.push(`  ${i.where}: ${i.path} (${i.bytes} bytes, ${i.sha256})`);
  }
  lines.push("", "Chats: turns, and what waits on you");
  for (const c of report.chats) {
    const waits = [c.waiting.questions > 0 ? `${c.waiting.questions} keep-or-discard question(s)` : "", c.waiting.staged > 0 ? "a staged action" : "", c.waiting.chips > 0 ? `${c.waiting.chips} chip(s), ${c.waiting.reviewCards} of them review cards` : "", c.waiting.rollback ? "a rollback that was never applied" : ""].filter((w) => w !== "");
    lines.push(`  ${c.chatId} (${c.engine ?? "no world"}): ${c.turns} turns over ${c.replies} replies; journal ${c.journal}${c.underWay > 0 ? `; ${c.underWay} turn(s) under way` : ""}${waits.length > 0 ? `; waiting: ${waits.join(", ")}` : ""}`);
  }
  if (report.imports !== null) {
    lines.push("", "Chats into RPE: turns, where each swipe was folded, and the check against today's fold");
    for (const c of report.imports) {
      if (c.outcome !== "imported" && c.outcome !== "replaced") {
        lines.push(`  ${c.chatId}: ${c.outcome}${c.why ? ` (${c.why})` : ""}`);
        continue;
      }
      const p = c.placed;
      const where = `${p.own} on their own path, ${p.shown} where they show (no turn path of their own), ${p.lost} where they show (their own path lost to an edit or a deletion)${p.head > 0 ? `, ${p.head} showing replies where they stand` : ""}`;
      const check = `matched at the head ${c.matched.head ? "yes" : "no"}, at ${c.matched.swipes} of ${c.matched.of} swipes`;
      lines.push(`  ${c.chatId}: ${c.outcome}, ${c.turns} turns (${where})${c.shares ? `; shares ${c.shares.messages} message(s) with ${c.shares.chat}` : ""}; ${check}${c.differences.length > 0 ? "; MARKED: today's state is kept as the start where they differ" : ""}`);
      for (const d of c.differences) lines.push(`    ${d.kept ? "differs" : "going back differs (not kept)"} at ${d.at === "head" ? "the head" : `message ${d.at.message}, swipe ${d.at.swipe}`}: ${d.values.join(", ")}`);
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
  lines.push("", `Today's readers tried ${report.standIn.writes.length} write(s), kept in memory and never made:`);
  for (const w of report.standIn.writes) lines.push(`  ${w.store}: ${w.op} ${w.path}${w.to ? ` to ${w.to}` : ""}`);
  const m = report.lumiverse;
  lines.push("", `In Lumiverse, left as they are: ${m.engineBooks} engine book(s) with ${m.engineEntries} entries, attached to ${m.chatsWithEngineBook} chat(s); ${m.markedEntries} entries of your own books with engine fields; ${m.regexScripts} regex script(s); ${m.presetBlocks} preset block(s) and ${m.outletReferences} outlet reference(s).`);
  lines.push("", `Disk: the backup takes ${report.disk.backup} bytes and the import ${report.disk.import}, ${report.disk.total} in all${report.disk.free === null ? "" : `; ${report.disk.free} are free`}.`);
  if (report.backup) lines.push(`Backup taken: ${report.backup.path} (${report.backup.bytes} bytes, sha256 ${report.backup.sha256}).`);
  if (report.landed) {
    lines.push("", "Where each row's things are now in RPE:");
    for (const r of report.rows) {
      const at = report.landed[r.row];
      if (at !== undefined) lines.push(`  ${r.what}: ${at}`);
    }
  }
  if (report.changes) {
    const c = report.changes;
    lines.push("", `Since the run of ${c.since}: ${c.added.length} added, ${c.changed.length} changed, ${c.gone.length} gone; ${c.rows.length} row(s) and ${c.chats.length} chat(s) differ.`);
  }
  return `${lines.join("\n")}\n`;
}
