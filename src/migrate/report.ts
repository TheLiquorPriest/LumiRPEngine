// The migration's report (STANDALONE-PLAN §15.5): printed by the rehearsal and by the real run, and
// shown on the Migration page. Counts and checksums, never content: every thing found, by where it
// is and its path, with its size, its SHA-256, its row and its fate; per row the sums; per chat its
// turns and what waits on the user; what couldn't be read; what the read-only stand-in kept from
// today's own readers; the disk the real run will take. A run may be compared with the one before
// it, since each is a full read of today's data: what was added, changed and gone since.

import type { AttemptedWrite } from "./stand-in";
import type { Unreadable } from "./inside";
import type { LumiverseMarks } from "./lumiverse-db";
import { type Fate, type Found, NO_PLACE_YET, type RowId } from "./rows";
import type { ChatEngine, JournalRead } from "./chats";
import type { CarriedReport } from "./carry";
import type { RuntimeFolders } from "./runtime-folders";

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
  /** Entries its records' story parts hold, as stored: what the story-record row counts inside it. */
  story: number;
  journal: JournalRead;
  notOpened: string | null;
  deletedTurns: number;
  underWay: number;
  waiting: { questions: number; staged: number; chips: number; reviewCards: number; rollback: boolean };
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
  /**
   * Today's runtime the run took (the one this user registered with this Lumiverse), why, the unit
   * that runs it and the file it was set up from; and every other runtime here, left alone, with why.
   * Absent from a report kept before runs told runtimes apart.
   */
  runtime?: { taken: { name: string; why: string; unit: string | null; source: string | null } | null; leftAlone: { name: string; why: string }[] };
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
   * The world revisions the run carried that RPE's store now keeps for the chats it imported, so a
   * migrated chat's world can be read and written to (`UserStore.copyMigratedWorlds`): added, kept
   * already, and left out as not a world document (each listed under what could not be read); null
   * for a rehearsal.
   */
  worldsInStore: { added: number; held: number; unreadable: number } | null;
  changes: Changes | null;
  /** Why the real run won't start on this report; none: it may. */
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

/** Whether a row keeps anything in the backup only: things of its own there, or, for a row found only inside other rows' things and with no place yet, any it holds. */
function keptOnly(r: RowReport): boolean {
  return r.count.backup > 0 || (r.found === "inside" && Object.hasOwn(NO_PLACE_YET, r.row) && (r.inside?.count ?? 0) > 0);
}

/**
 * What of the rows found inside chats' things a real run keeps in the backup only, by row: what is of
 * chats it did not import and no earlier run's import of which stands, and of the chats it did
 * import, what no imported turn ended with or holds. (A report kept by an earlier build has none.)
 */
function keptInside(report: MigrationReport): { row: RowId; text: string }[] {
  const c = report.carried;
  if (c === null) return [];
  const apart = (row: RowId, list: readonly Apart[] | undefined, unit: string) => (list ?? []).filter((a) => !a.kept).map((a) => ({ row, text: `${a.count} ${unit} of ${a.chats} chat(s) this run did not import (${a.why})` }));
  return [
    ...apart("mind-files", c.minds.apart, "version(s)"),
    ...(c.minds.untied > 0 ? [{ row: "mind-files" as const, text: `${c.minds.untied} version(s) in areas no imported turn ended with` }] : []),
    ...apart("story-record", c.story.apart, "entr(ies)"),
    ...(c.story.unheld > 0 ? [{ row: "story-record" as const, text: `${c.story.unheld} entr(ies) on records no imported turn holds` }] : []),
  ];
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
  if (report.runtime !== undefined && (report.runtime.taken !== null || report.runtime.leftAlone.length > 0)) {
    const { taken, leftAlone } = report.runtime;
    lines.push("", taken === null ? "Today's runtime: none of this user's taken." : `Today's runtime: took ${taken.name}, ${taken.why}.`);
    for (const r of leftAlone) lines.push(`  Left alone: ${r.name}, ${r.why}.`);
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
      else if (keptOnly(r)) lines.push(`  ${r.what}: ${BACKUP_ONLY}`);
      else if (r.count.archived > 0) lines.push(`  ${r.what}: archived, kept in the backup for good, as the plan has it`);
    }
  }
  if (report.worldsInStore) {
    const w = report.worldsInStore;
    lines.push("", `World revisions RPE's store keeps for the imported chats: ${w.added} added, ${w.held} kept already, ${w.unreadable} left out as not a world document${w.unreadable > 0 ? " (listed under what could not be read)" : ""}.`);
  }
  if (report.carried) {
    const { settings, connections, ownFiles } = report.carried;
    // Waiting on you, first: your GUIDANCE.md, switched off; then the settings naming a connection RPE can't use.
    if (ownFiles !== null && ownFiles.guidance > 0) lines.push("", "Waiting on you: your GUIDANCE.md is in the file tree under imported/, switched off, since it was written for agents that are gone or changed. Switch it on as an AGENTS.md at the same level, or copy from it.");
    if (ownFiles === null) lines.push("", "Your own agents, skills, texts, GUIDANCE.md, notes and learned files were not carried: this run was not given the file tree's places. They are in the backup.");
    else if (ownFiles.leftOut > 0) lines.push("", `${ownFiles.leftOut} of your own file(s) have names that would leave the folder they go in: not written, in the backup.`);
    if (ownFiles !== null && ownFiles.removed + ownFiles.changed > 0) lines.push("", `Files an earlier run wrote into the file tree that today's side no longer has: ${ownFiles.removed} removed${ownFiles.changed > 0 ? `; ${ownFiles.changed} changed in RPE since, left as they are` : ""}.`);
    if (settings.lumiverseConnections.length > 0) {
      lines.push("", "Settings that name a connection living in Lumiverse, which RPE can't use: pick one of RPE's connections for each; until you do, that work uses RPE's default connection.");
      for (const c of settings.lumiverseConnections) lines.push(`  ${c.setting} (connection ${c.connection} in Lumiverse)`);
    }
    if (connections !== null) lines.push("", "why" in connections ? `Connections: none carried, as ${connections.why}.` : `Connections carried from runtime ${connections.runtime}: ${connections.connections.join(", ") || "none"}; ${connections.keys} key(s), ${connections.signins} sign-in(s), ${connections.headerValues} header value(s); the default ${connections.default ?? "not set"}${connections.kept > 0 ? `; ${connections.kept} key(s), sign-in(s) and header value(s) RPE already held, which differ from today's, kept as RPE's` : ""}${connections.leftOut > 0 ? `; ${connections.leftOut} entry(s) left out, as today's runtime leaves them out` : ""}.`);
    lines.push("", "Settings carried into RPE's config:");
    for (const s of settings.carried) lines.push(`  ${s.from} → ${s.to}`);
    if (settings.carried.length === 0) lines.push("  none");
    lines.push("", "Settings with no setting of the same meaning in RPE yet (kept in the backup):");
    for (const s of settings.noHome) lines.push(`  ${s}`);
  }
  if (report.changes) {
    const c = report.changes;
    lines.push("", `Since the run of ${c.since}: ${c.added.length} added, ${c.changed.length} changed, ${c.gone.length} gone; ${c.rows.length} row(s) and ${c.chats.length} chat(s) differ.`);
  }
  // Last, so that nobody reads such a run as complete: what it keeps in the backup only, by row; and what of the rows found inside chats' things it did not carry.
  const kept = report.rows.filter(keptOnly);
  const inside = keptInside(report);
  if (kept.length + inside.length > 0) {
    const total = kept.reduce((n, r) => n + r.count.backup, 0);
    const header = report.mode !== "real run" ? "The real run will keep these in the backup only, as this build has no place for them in RPE yet:" : inside.length === 0 ? "Kept in the backup only, as this build has no place for them in RPE yet: this run did not carry everything. A later run carries them once it has a place for them." : "Kept in the backup only: this run did not carry everything. A later run carries them once this build has a place for them, or once it imports the chats they are in.";
    lines.push("", header);
    for (const r of kept) lines.push(`  ${r.what}: ${r.count.backup > 0 ? `${r.count.backup} thing(s)` : `${r.inside?.count ?? 0} ${r.inside?.unit ?? ""}, inside other rows' things`}`);
    for (const i of inside) lines.push(`  ${report.rows.find((r) => r.row === i.row)?.what ?? i.row}: ${i.text}, inside other rows' things`);
    lines.push(`  In all: ${total} thing(s), of ${kept.length} row(s).`);
  }
  return `${lines.join("\n")}\n`;
}
