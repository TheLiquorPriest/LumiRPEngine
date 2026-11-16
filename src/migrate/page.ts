// The Migration page's data (STANDALONE-PLAN §15.5, §15.6, §15.2; R-80, R-327, R-328): a summary, and the rest a page at
// a time. The summary holds the last real run's report and the page's own rehearsal in brief (counts, refusals, the disk,
// the backup), the folders a rehearsal reads, the backup with its checksum and whether it is still there, what is waiting on
// the user in the order the plan lists it (GUIDANCE.md first), the swap's steps, and going back's with the permissions the
// previous build asks for, by name: before any run as after. The rows, the chats (by their names in Lumiverse, searchable),
// the things found and each chat's differences are read in pages. It reads RPE's database and the rehearsal held in memory,
// and writes nothing.

import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { Database } from "bun:sqlite";
import type { ChatCarried } from "./briefing";
import type { ChatEngine, JournalRead } from "./chats";
import { goingBack, PREVIOUS_PERMISSIONS, swapSteps } from "./going-back";
import type { LumiverseMarks } from "./lumiverse-db";
import type { Rehearsals } from "./rehearse-job";
import type { ChatImportReport, ChatReport, Difference, Item, MigrationReport, RowReport } from "./report";
import type { RuntimeFolders } from "./runtime-folders";
import { chatRecord, lastReport } from "./tables";

/** Which report a page reads: the last real run's, or the rehearsal started from the page. */
export type ReportOf = "run" | "rehearsal";

/** A report in brief: when and how it was read, why the real run would not start (or, after one, what did not balance), and how much there is to page through. */
export interface ReportSummary {
  mode: MigrationReport["mode"];
  at: string;
  refusals: string[];
  counts: { rows: number; chats: number; items: number; notClassified: number; unreadable: number; differences: number; offRpe: number };
  disk: MigrationReport["disk"];
  backup: MigrationReport["backup"];
}

/** The page's rehearsal as it stands: none since RPE started, under way, read (in brief), or failed. */
export type RehearsalShown = { state: "none" } | { state: "running"; since: number } | { state: "ready"; summary: ReportSummary } | { state: "failed"; why: string };

/** One thing waiting on the user, by what it is. */
export type Waiting =
  /** Their GUIDANCE.md, attached under `imported/`, switched off: switch it on as an AGENTS.md at the same level, or copy from it. */
  | { kind: "guidance"; path: string }
  /** A setting that names a connection living in Lumiverse: pick one of RPE's for it; until then that work uses RPE's default connection. */
  | { kind: "connection"; setting: string; connection: string }
  /** A chat's changes waiting on the user, as today's build left them: an edit waiting on keep or discard, a staged action to apply or drop, chips and review cards, a rollback never applied. */
  | { kind: "chat"; chat: string; questions: number; staged: number; chips: number; reviewCards: number; rollback: boolean }
  /** Their own agents, skills and texts, attached under `imported/` and switched off: one press switches one on. */
  | { kind: "own"; agents: number; skills: number; texts: number }
  /** A chat whose characters' mind files and notes are attached and not yet filed: the filing job is the user's to start. */
  | { kind: "filing"; chat: string; characters: number; notes: boolean };

export interface MigrationPage {
  run: ReportSummary | null;
  rehearsal: RehearsalShown;
  /** The folders a rehearsal started from the page reads: the last run's, else Lumiverse's database's folder as RPE's config names it and today's runtime's own; null where none is known. */
  sources: { lumiverse: string | null; runtime: RuntimeFolders | null };
  /** The backup the last real run took before it wrote anything: where, its size and checksum, and whether a file of that size is still there. */
  backup: { path: string; bytes: number; sha256: string; present: boolean } | null;
  waiting: Waiting[];
  /** The swap's steps, before it as after. */
  swap: string[];
  /** Going back to the previous build: its steps, and the permissions it asks for, by name. */
  goingBack: { steps: string[]; permissions: string[] };
  /** What today's build put in Lumiverse, left as it is until the user says they will not go back; null before any run. */
  lumiverse: LumiverseMarks | null;
}

export interface MigrationPageInput {
  db: Database;
  user: string;
  /** The extension's identifier in Lumiverse, which the swap's and going back's steps name. */
  identifier: string;
  rehearsals: Rehearsals;
  /** Lumiverse's database file as RPE's config names it (`lumiverse.database`); null where it names none. */
  database: string | null;
  /** Today's runtime's own folders, as it finds them on this machine. */
  runtime: RuntimeFolders;
}

export function summaryOf(report: MigrationReport): ReportSummary {
  return {
    mode: report.mode,
    at: report.at,
    refusals: report.refusals,
    counts: {
      rows: report.rows.length,
      chats: chatIds(report).length,
      items: report.items.length,
      notClassified: report.notClassified.length,
      unreadable: report.unreadable.length,
      differences: (report.imports ?? []).reduce((n, c) => n + c.differences.length, 0),
      offRpe: (report.offRpe ?? []).length,
    },
    disk: report.disk,
    backup: report.backup,
  };
}

/** The report a page's route reads; null where there is none (no real run yet, no rehearsal read). */
export function reportFor(input: Pick<MigrationPageInput, "db" | "user" | "rehearsals">, of: ReportOf): MigrationReport | null {
  if (of === "run") return lastReport(input.db, input.user);
  const held = input.rehearsals.held(input.user);
  return held.state === "ready" ? held.report : null;
}

/** The report's printed text: the rehearsal's as it was made, the run's as the run printed it. */
export function textFor(input: Pick<MigrationPageInput, "db" | "user" | "rehearsals">, of: ReportOf, print: (report: MigrationReport) => string): string | null {
  const held = input.rehearsals.held(input.user);
  if (of === "rehearsal") return held.state === "ready" ? held.text : null;
  const report = lastReport(input.db, input.user);
  return report === null ? null : print(report);
}

/** The Migration page's summary for `user`. */
export function migrationPage(input: MigrationPageInput): MigrationPage {
  const report = lastReport(input.db, input.user);
  const held = input.rehearsals.held(input.user);
  const rehearsal: RehearsalShown = held.state === "ready" ? { state: "ready", summary: summaryOf(held.report) } : held;
  const taken = report?.runtime?.taken ?? null;
  const [, ...steps] = goingBack({ identifier: input.identifier, runtime: taken === null ? null : { name: taken.name, source: taken.source }, downRun: false });
  const sources = report?.sources ?? null;
  const out: MigrationPage = {
    run: report === null ? null : summaryOf(report),
    rehearsal,
    sources: sources === null ? { lumiverse: input.database === null ? null : dirname(input.database), runtime: input.runtime } : { lumiverse: sources.lumiverse, runtime: sources.runtime },
    backup: null,
    waiting: [],
    swap: swapSteps({ identifier: input.identifier }).map((s) => s.trim()),
    goingBack: { steps: steps.map((s) => s.trim()), permissions: [...PREVIOUS_PERMISSIONS] },
    lumiverse: report?.lumiverse ?? null,
  };
  if (report === null) return out;
  const own = report.carried?.ownFiles ?? null;
  if (own !== null && own.guidance > 0) out.waiting.push({ kind: "guidance", path: "imported/GUIDANCE.md" });
  for (const c of report.carried?.settings.lumiverseConnections ?? []) out.waiting.push({ kind: "connection", setting: c.setting, connection: c.connection });
  for (const c of report.chats) {
    const w = c.waiting;
    if (w.questions + w.staged + w.chips > 0 || w.rollback) out.waiting.push({ kind: "chat", chat: c.chatId, ...w });
  }
  if (own !== null && own.agents + own.skills + own.texts > 0) out.waiting.push({ kind: "own", agents: own.agents, skills: own.skills, texts: own.texts });
  for (const c of report.imports ?? []) {
    if (c.outcome !== "imported" && c.outcome !== "replaced") continue;
    const carried = chatRecord(input.db, input.user, c.chatId)?.carried ?? null;
    if (carried !== null && (carried.characters.length > 0 || carried.notes !== null)) out.waiting.push({ kind: "filing", chat: c.chatId, characters: carried.characters.length, notes: carried.notes !== null });
  }
  const b = report.backup;
  out.backup = b === null ? null : { ...b, present: existsSync(b.path) && statSync(b.path).size === b.bytes };
  return out;
}

/** A row of the report, with where its things now are in RPE after a real run. */
export interface PageRow extends RowReport {
  landed: string | null;
}

export function rowsOf(report: MigrationReport): PageRow[] {
  return report.rows.map((r) => ({ ...r, landed: report.landed?.[r.row] ?? null }));
}

/** One chat of a report: its name in Lumiverse, what today's readers found of it, and after a real run what came of it and its check (its differences counted; they are read a page at a time). */
export interface PageChat {
  chat: string;
  /** Its name in Lumiverse, read through the door; null where Lumiverse's database can't be read. */
  name: string | null;
  engine: ChatEngine | null;
  /** Replies and swipes that hold a record, as today's readers found them. */
  turns: number;
  replies: number;
  journal: JournalRead | null;
  waiting: ChatReport["waiting"] | null;
  /** What the real run did with it; null for a rehearsal, or a chat the run looked at no further. */
  outcome: ChatImportReport["outcome"] | null;
  why: string | null;
  /** Turns imported of its own: one per swipe of every reply it holds itself. */
  imported: number;
  shares: ChatImportReport["shares"];
  check: { matched: ChatImportReport["matched"]; placed: ChatImportReport["placed"]; differences: number } | null;
  /** Whether it was on today and is on none of RPE's connections once swapped: his to put on RPE. */
  offRpe: boolean;
}

/** Every chat a report names: those today's readers read, then those only the import names. */
function chatIds(report: MigrationReport): string[] {
  const ids = report.chats.map((c) => c.chatId);
  const seen = new Set(ids);
  for (const c of report.imports ?? []) if (!seen.has(c.chatId)) ids.push(c.chatId);
  return ids;
}

/** Each chat of a report, by its name where Lumiverse holds one, and those `q` finds (in its name or its id, any case). */
export function chatsOf(report: MigrationReport, names: ReadonlyMap<string, string>, q: string | null): PageChat[] {
  const read = new Map(report.chats.map((c) => [c.chatId, c]));
  const imports = new Map((report.imports ?? []).map((c) => [c.chatId, c]));
  const off = new Set((report.offRpe ?? []).map((c) => c.chat));
  const find = q === null || q.trim() === "" ? null : q.trim().toLowerCase();
  return chatIds(report).flatMap((id) => {
    const name = names.get(id) ?? null;
    if (find !== null && !id.toLowerCase().includes(find) && !(name ?? "").toLowerCase().includes(find)) return [];
    const r = read.get(id);
    const c = imports.get(id);
    return [
      {
        chat: id,
        name,
        engine: r?.engine ?? null,
        turns: r?.turns ?? 0,
        replies: r?.replies ?? 0,
        journal: r?.journal ?? null,
        waiting: r?.waiting ?? null,
        outcome: c?.outcome ?? null,
        why: c?.why ?? null,
        imported: c?.turns ?? 0,
        shares: c?.shares ?? null,
        check: c === undefined || (c.outcome !== "imported" && c.outcome !== "replaced") ? null : { matched: c.matched, placed: c.placed, differences: c.differences.length },
        offRpe: off.has(id),
      },
    ];
  });
}

/** One chat of a report in full: as listed, what today's readers found of it, and what the last real run that imported it carried of it. */
export interface PageChatOne extends PageChat {
  read: ChatReport | null;
  carried: ChatCarried | null;
}

export function chatOne(input: Pick<MigrationPageInput, "db" | "user">, report: MigrationReport, names: ReadonlyMap<string, string>, chat: string, of: ReportOf): PageChatOne | null {
  const listed = chatsOf(report, names, null).find((c) => c.chat === chat);
  if (listed === undefined) return null;
  return { ...listed, read: report.chats.find((c) => c.chatId === chat) ?? null, carried: of === "run" ? (chatRecord(input.db, input.user, chat)?.carried ?? null) : null };
}

/** Where a chat's state differed from today's fold, in the order the run checked it. */
export function differencesOf(report: MigrationReport, chat: string): Difference[] {
  return report.imports?.find((c) => c.chatId === chat)?.differences ?? [];
}

/** The things a report found, and those `q` finds (in where they are, their path, their row or their note, any case); `row` keeps one row's, "none" those found, not classified. */
export function itemsOf(report: MigrationReport, q: string | null, row: string | null): Item[] {
  const find = q === null || q.trim() === "" ? null : q.trim().toLowerCase();
  return report.items.filter((i) => {
    if (row !== null && (row === "none" ? i.row !== null : i.row !== row)) return false;
    return find === null || `${i.where}: ${i.path} ${i.row ?? ""} ${i.note ?? ""}`.toLowerCase().includes(find);
  });
}
