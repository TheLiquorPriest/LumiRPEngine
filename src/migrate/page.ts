// The Migration page's data (STANDALONE-PLAN §15.5, §15.6, §15.2; R-80, R-327, R-328): a summary, and the rest a page at
// a time. The summary holds the last real run's report and the page's own rehearsal in brief (counts, refusals, the disk,
// the backup), the folders a rehearsal reads, the backup with its checksum and whether it is still there, what is waiting on
// the user in the order the plan lists it (GUIDANCE.md first), the swap's steps, and going back's with the permissions the
// previous build asks for, by name: before any run as after. The rows, the chats (by their names in Lumiverse, searchable),
// the things found and each chat's differences are read in pages. It reads RPE's database and the rehearsal held in memory,
// and writes nothing.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Database } from "bun:sqlite";
import type { JsonObject } from "../shared/json";
import type { Store } from "../store";
import type { ChatCarried } from "./briefing";
import type { ChatEngine, JournalRead } from "./chats";
import { goingBack, PREVIOUS_PERMISSIONS, swapSteps } from "./going-back";
import type { LumiverseMarks } from "./lumiverse-db";
import { IMPORTED, IMPORTED_AGENTS, IMPORTED_SKILLS, SET_APART } from "./own-files";
import type { LumiverseNow, Rehearsals } from "./rehearse-job";
import type { ChatImportReport, ChatReport, Difference, Item, MigrationReport, RowReport } from "./report";
import { disownedLines } from "./no-runtime";
import type { RuntimeFolders } from "./runtime-folders";
import type { OwnerRow } from "./setting-list";
import { answersOf, chatRecord, lastReport } from "./tables";

/** Which report a page reads: the last real run's, or the rehearsal started from the page. */
export type ReportOf = "run" | "rehearsal";

/** A report in brief: when and how it was read, why the real run would not start (or, after one, what did not balance), and how much there is to page through. */
export interface ReportSummary {
  mode: MigrationReport["mode"];
  at: string;
  /** Where you said there is no runtime and this user's is found all the same: what was found and what is therefore not carried, a line each; none where it was not said or nothing is found. */
  disowned: string[];
  refusals: string[];
  counts: { rows: number; chats: number; items: number; notClassified: number; unreadable: number; differences: number; offRpe: number };
  disk: MigrationReport["disk"];
  backup: MigrationReport["backup"];
}

/** The page's rehearsal as it stands: none since RPE started, under way, read (in brief), or failed. */
export type RehearsalShown = { state: "none" } | { state: "running"; since: number } | { state: "ready"; summary: ReportSummary } | { state: "failed"; why: string };

/**
 * A chat that was on today's build and was on none of RPE's connections when the run read it (N-14, R-109): the head of the page, a
 * group of its own, and the chat's own line in the report's chat list: one read of where the chat stands now, for both. RPE changes
 * nothing in his chats; the one step that puts a chat on RPE is his, in Lumiverse: choose one of RPE's connections for it. `done`
 * once it is on RPE: pinned to one of RPE's connections, or pinned to none while the connection active for him is one of RPE's.
 */
export interface OffRpe {
  chat: string;
  /** The connection it is pinned to in Lumiverse now (as the report read it where Lumiverse can't be read now); null: none, so it follows the one active for him. */
  pinned: string | null;
  /** That connection's name in Lumiverse; null where it is none or Lumiverse can't say. */
  pinnedName: string | null;
  /** Where it is pinned to none: the connection active for him in Lumiverse now, its name and whether it is one of RPE's; null where none is selected or Lumiverse can't be read. */
  active: { id: string; name: string | null; rpe: boolean } | null;
  /** Whether RPE has played a turn of it. */
  played: boolean;
  done: boolean;
}

/** One thing waiting on the user, by what it is, each with the press that does it; `done` where it is done and its line is struck. */
export type Waiting =
  /** His GUIDANCE.md, attached under `imported/`, switched off: one press puts it in force as AGENTS.md at the same level; or he copies from it. */
  | { kind: "guidance"; path: string; done: boolean }
  /** One of his own agents, attached and switched off: one press puts it where agents are read; the pins carried for it, and the tools it names that no longer exist. */
  | { kind: "agent"; id: string; path: string; done: boolean; pins: string[]; deadTools: string[] }
  /** One of his own skills, attached and switched off: one press puts it where skills are read. */
  | { kind: "skill"; id: string; path: string; done: boolean }
  /** A model choice with no matching connection of RPE's: where it was, the Lumiverse connection it named, and his agent whose `model:` takes the pick (null: RPE has no place for that work, listed only). */
  | { kind: "connection"; where: string; connection: string; agent: string | null; path: string | null; done: boolean }
  /** A chat today's build held paused on a keep-or-discard question: keep or discard from here (`answerPaused`); his answer, once given. */
  | { kind: "paused"; chat: string; questions: number; answered: "keep" | "discard" | null; done: boolean }
  /** A chat whose staged change waits for his next message, carried as a held request: keep leaves it held; drop takes it back. */
  | { kind: "staged"; chat: string; staged: number; done: boolean }
  /** A chat's chips, review cards and a rollback never applied, as today's build left them: on its turns (the rollback archived). */
  | { kind: "chat"; chat: string; chips: number; reviewCards: number; rollback: boolean; done: boolean }
  /** A chat whose characters' mind files and notes are attached and not yet filed: the filing job and bootstrap are his to start. */
  | { kind: "filing"; chat: string; characters: number; notes: boolean; done: boolean }
  /** A file found that no row names: one press gives it a row (`migration.rows`), which the next rehearsal uses. */
  | { kind: "row"; path: string; done: boolean }
  /** A file pinned in today's build for a role RPE has no agent for, now pinned for the Author: he pins and unpins on the Files page. */
  | { kind: "pin"; file: string; role: string; done: boolean }
  /** One of his texts attached as set apart, with why today's build did not use it, at its file. */
  | { kind: "text"; id: string; reason: string; missing: string[]; path: string; done: boolean };

export interface MigrationPage {
  run: ReportSummary | null;
  rehearsal: RehearsalShown;
  /** The folders a rehearsal started from the page reads: the last run's, else Lumiverse's database's folder as RPE's config names it and today's runtime's own; null where none is known. */
  sources: { lumiverse: string | null; runtime: RuntimeFolders | null };
  /** The backup the last real run took before it wrote anything: where, its size and checksum, and whether a file of that size is still there. */
  backup: { path: string; bytes: number; sha256: string; present: boolean } | null;
  /** The chats still off RPE, ahead of everything else. */
  offRpe: OffRpe[];
  /** What waits on him, GUIDANCE.md first, in the plan's order. */
  waiting: Waiting[];
  /** The rows he has given (`migration.rows`), which a row press adds to. */
  given: OwnerRow[];
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
  /** The file tree's folder (the global level) and the folders agents, skills and prompts are read from there; absent: nothing is looked up in it. */
  tree?: { files: string; agents: string; skills: string; prompts: string };
  /** The rows he has given (`migration.rows`). */
  given?: readonly OwnerRow[];
  /** RPE's connections in Lumiverse (`lumiverse.connections`). */
  rpeConnections?: readonly string[];
  /** RPE's store, where it holds what RPE did with a chat: whether it played a turn there. Absent: no chat counts as played. */
  store?: Store;
}

export function summaryOf(report: MigrationReport): ReportSummary {
  return {
    mode: report.mode,
    at: report.at,
    disowned: report.disowned === undefined ? [] : disownedLines(report.disowned),
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

/** The pin a chat has in Lumiverse: its connection's id, or null. */
function pinOf(metadata: JsonObject): string | null {
  const pin = metadata.connection_profile_id;
  return typeof pin === "string" && pin.trim() !== "" ? pin.trim() : null;
}

/** What decides where a chat is played, as it stands now: Lumiverse (null where it can't be read), the ids of RPE's connections, and whether RPE has played a turn of a chat. */
interface Placing {
  now: LumiverseNow | null;
  rpe: ReadonlySet<string>;
  played(chat: string): boolean;
}

/** Where each chat the report found off RPE stands now, read once: the same for the head of the page and for a chat's own line. */
export function offRpeOf(report: MigrationReport, at: Placing): OffRpe[] {
  return (report.offRpe ?? []).map((c) => {
    const pinned = at.now === null ? c.pinned : pinOf(at.now.chats.get(c.chat) ?? {});
    const follows = pinned === null ? (at.now?.active ?? null) : null;
    const active = follows === null ? null : { id: follows, name: at.now?.connections.get(follows) ?? null, rpe: at.rpe.has(follows) };
    return { chat: c.chat, pinned, pinnedName: pinned === null ? null : (at.now?.connections.get(pinned) ?? null), active, played: at.played(c.chat), done: pinned === null ? active?.rpe === true : at.rpe.has(pinned) };
  });
}

/** `offRpeOf` as Lumiverse and RPE hold the chats now. */
export function offRpeNow(input: Pick<MigrationPageInput, "user" | "database" | "rehearsals" | "rpeConnections" | "store">, report: MigrationReport): OffRpe[] {
  const mine = input.store?.user(input.user);
  const lumiverse = report.sources?.lumiverse ?? (input.database === null ? null : dirname(input.database));
  return offRpeOf(report, { now: input.rehearsals.lumiverseNow(input.user, lumiverse), rpe: new Set(input.rpeConnections ?? []), played: (chat) => mine?.playedIn(chat) ?? false });
}

/** The ids of the folders (`<id>/`) or files (`<id>.md`) of a folder, in name order; none where it is not there. */
function idsIn(folder: string, files: boolean): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .flatMap((e) => (files ? (e.isFile() && e.name.endsWith(".md") ? [e.name.slice(0, -3)] : []) : e.isDirectory() ? [e.name] : []))
      .sort();
  } catch {
    return [];
  }
}

/** The `model:` an agent file's header names; null where it names none. */
function headerModel(file: string): string | null {
  try {
    const text = readFileSync(file, "utf8");
    const head = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    return /^model:\s*(.+)$/m.exec(head)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
  } catch {
    return null;
  }
}

/** The Migration page's summary for `user`. */
export function migrationPage(input: MigrationPageInput): MigrationPage {
  const report = lastReport(input.db, input.user);
  const held = input.rehearsals.held(input.user);
  const rehearsal: RehearsalShown = held.state === "ready" ? { state: "ready", summary: summaryOf(held.report) } : held;
  const taken = report?.runtime?.taken ?? null;
  const [, ...steps] = goingBack({ identifier: input.identifier, runtime: taken === null ? null : { name: taken.name, source: taken.source }, downRun: false });
  const sources = report?.sources ?? null;
  const given = [...(input.given ?? [])];
  const out: MigrationPage = {
    run: report === null ? null : summaryOf(report),
    rehearsal,
    sources: sources === null ? { lumiverse: input.database === null ? null : dirname(input.database), runtime: input.runtime } : { lumiverse: sources.lumiverse, runtime: sources.runtime },
    backup: null,
    offRpe: [],
    waiting: [],
    given,
    swap: swapSteps({ identifier: input.identifier }).map((s) => s.trim()),
    goingBack: { steps: steps.map((s) => s.trim()), permissions: [...PREVIOUS_PERMISSIONS] },
    lumiverse: report?.lumiverse ?? null,
  };
  // What no row names, of the last run and of the page's rehearsal: a row given to its path is used by the next rehearsal.
  const unnamed = new Set([...(report?.notClassified ?? []), ...(held.state === "ready" ? held.report.notClassified : [])].map((i) => `${i.where}: ${i.path}`));
  const rows: Waiting[] = [...unnamed].map((path) => ({ kind: "row", path, done: given.some((g) => g.path === path || path.endsWith(`: ${g.path}`) || (g.path.endsWith("/") && (path.includes(`: ${g.path}`) || path.startsWith(g.path)))) }));
  if (report === null) {
    out.waiting.push(...rows);
    return out;
  }
  // The chats the run found off RPE, as Lumiverse and RPE hold them now.
  out.offRpe.push(...offRpeNow(input, report));
  if (out.run !== null) out.run.counts.offRpe = out.offRpe.filter((c) => !c.done).length;
  const tree = input.tree;
  const at = (path: string): boolean => tree !== undefined && existsSync(join(tree.files, path));
  const own = report.carried?.ownFiles ?? null;
  const pins = report.carried?.pins ?? null;
  if (own !== null && own.guidance > 0) out.waiting.push({ kind: "guidance", path: `${IMPORTED}/GUIDANCE.md`, done: at("AGENTS.md") });
  if (tree !== undefined) {
    for (const id of idsIn(join(tree.files, IMPORTED, IMPORTED_AGENTS), true)) {
      out.waiting.push({ kind: "agent", id, path: `${IMPORTED}/${IMPORTED_AGENTS}/${id}.md`, done: at(`${tree.agents}/${id}.md`), pins: (pins?.forOwn ?? []).filter((p) => p.agent === id).map((p) => p.file), deadTools: (own?.deadTools ?? []).filter((t) => t.agent === id).map((t) => t.tool) });
    }
    for (const id of idsIn(join(tree.files, IMPORTED, IMPORTED_SKILLS), false)) out.waiting.push({ kind: "skill", id, path: `${IMPORTED}/${IMPORTED_SKILLS}/${id}/SKILL.md`, done: at(`${tree.skills}/${id}/SKILL.md`) });
  }
  for (const c of report.carried?.modelChoices ?? []) {
    if (c.carried !== null) continue;
    const file = c.to === null || tree === undefined ? null : join(tree.files, IMPORTED, c.to.path);
    const model = file === null ? null : headerModel(file);
    out.waiting.push({ kind: "connection", where: c.where, connection: c.connection, agent: c.to?.agent ?? null, path: c.to === null ? null : `${IMPORTED}/${c.to.path}`, done: model !== null && model !== "default" });
  }
  const answers = answersOf(input.db, input.user);
  for (const c of report.chats) {
    const w = c.waiting;
    if (w.questions > 0) {
      const answer = answers.filter((a) => a.chat === c.chatId).at(-1) ?? null;
      out.waiting.push({ kind: "paused", chat: c.chatId, questions: w.questions, answered: answer?.choice ?? null, done: answer !== null });
    }
  }
  for (const c of report.chats) if (c.waiting.staged > 0) out.waiting.push({ kind: "staged", chat: c.chatId, staged: c.waiting.staged, done: false });
  for (const c of report.chats) {
    const w = c.waiting;
    if (w.chips > 0 || w.rollback) out.waiting.push({ kind: "chat", chat: c.chatId, chips: w.chips, reviewCards: w.reviewCards, rollback: w.rollback, done: false });
  }
  for (const c of report.imports ?? []) {
    if (c.outcome !== "imported" && c.outcome !== "replaced") continue;
    const carried = chatRecord(input.db, input.user, c.chatId)?.carried ?? null;
    if (carried !== null && (carried.characters.length > 0 || carried.notes !== null)) out.waiting.push({ kind: "filing", chat: c.chatId, characters: carried.characters.length, notes: carried.notes !== null, done: false });
  }
  out.waiting.push(...rows);
  for (const p of pins?.forAuthor ?? []) out.waiting.push({ kind: "pin", file: p.file, role: p.role, done: false });
  for (const t of own?.textsSetApart ?? []) out.waiting.push({ kind: "text", id: t.id, reason: t.reason, missing: t.missing, path: `${IMPORTED}/${tree?.prompts ?? ""}/${SET_APART}/${t.reason.replaceAll("_", "-")}/${t.id}.md`, done: false });
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
  /** Where it stands now, if the report found it off RPE (`offRpeOf`, the same read as the list at the head of the page); null where it did not. */
  offRpe: OffRpe | null;
}

/** Every chat a report names: those today's readers read, then those only the import names. */
function chatIds(report: MigrationReport): string[] {
  const ids = report.chats.map((c) => c.chatId);
  const seen = new Set(ids);
  for (const c of report.imports ?? []) if (!seen.has(c.chatId)) ids.push(c.chatId);
  return ids;
}

/** A placing that read nothing: where a report is shown alone, each chat off RPE as the run read it. */
const AS_RUN: Placing = { now: null, rpe: new Set(), played: () => false };

/** Each chat of a report, by its name where Lumiverse holds one, and those `q` finds (in its name or its id, any case); `off` is where the chats found off RPE stand now. */
export function chatsOf(report: MigrationReport, names: ReadonlyMap<string, string>, q: string | null, off: readonly OffRpe[] = offRpeOf(report, AS_RUN)): PageChat[] {
  const read = new Map(report.chats.map((c) => [c.chatId, c]));
  const imports = new Map((report.imports ?? []).map((c) => [c.chatId, c]));
  const standing = new Map(off.map((o) => [o.chat, o]));
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
        offRpe: standing.get(id) ?? null,
      },
    ];
  });
}

/** One chat of a report in full: as listed, what today's readers found of it, and what the last real run that imported it carried of it. */
export interface PageChatOne extends PageChat {
  read: ChatReport | null;
  carried: ChatCarried | null;
}

export function chatOne(input: Pick<MigrationPageInput, "db" | "user">, report: MigrationReport, names: ReadonlyMap<string, string>, chat: string, of: ReportOf, off?: readonly OffRpe[]): PageChatOne | null {
  const listed = chatsOf(report, names, null, off).find((c) => c.chat === chat);
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
