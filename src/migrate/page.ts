// The Migration page's data (STANDALONE-PLAN §15.5, §15.6, §15.2), in one read a route serves whole:
// the last real run's report and its text as the run printed it; each chat's check, what came of it
// and what was carried of it; the backup with its checksum, and whether it is still there; what is
// waiting on the user, in the order the plan lists it (GUIDANCE.md first); and the four steps of
// going back, with the permissions the previous build asks for, by name. It reads RPE's database
// only, and writes nothing.

import { existsSync, statSync } from "node:fs";
import type { Database } from "bun:sqlite";
import type { ChatCarried } from "./briefing";
import { goingBack, PREVIOUS_PERMISSIONS } from "./going-back";
import type { LumiverseMarks } from "./lumiverse-db";
import { type ChatImportReport, type MigrationReport, reportText } from "./report";
import { chatRecord, lastReport } from "./tables";

/** One chat as the last run left it: what came of it, the check against today's fold, and what was carried of it. */
export interface PageChat {
  chat: string;
  outcome: ChatImportReport["outcome"];
  why: string | null;
  /** Turns imported of its own: one per swipe of every reply it holds itself. */
  turns: number;
  /** A branch's messages that share the turns of the chat it was made from, and that chat; null for a chat that shares none. */
  shares: ChatImportReport["shares"];
  /** Whether RPE's fold matched today's: at the head, and at how many of its swipes; where it differed, today's state is kept as the turn's start. */
  check: Pick<ChatImportReport, "matched" | "differences" | "placed">;
  /** What the run that imported it carried of it, over its whole path; null for a chat no run of this build imported. */
  carried: ChatCarried | null;
}

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
  | { kind: "filing"; chat: string; characters: number; notes: boolean }
  /** A world changed in RPE's Build and on today's side too since a run put it into Build: Build keeps its own, and today's newer files are in RPE's copy of today's worlds and in the backup, not in Build. Its name as today's index gives it, null where it gives none. */
  | { kind: "world"; world: string; name: string | null };

export interface MigrationPage {
  /** The user's last real run's report, whole (counts and checksums, never content), and its text as the run printed it; null before any run. */
  report: MigrationReport | null;
  text: string | null;
  chats: PageChat[];
  /** The backup the last run took before it wrote anything: where, its size and checksum, and whether a file of that size is still there. */
  backup: { path: string; bytes: number; sha256: string; present: boolean } | null;
  waiting: Waiting[];
  /** Going back to the previous build: the four steps, and the permissions it asks for, by name. */
  goingBack: { steps: string[]; permissions: string[] };
  /** What today's build put in Lumiverse, left as it is until the user says they will not go back. */
  lumiverse: LumiverseMarks | null;
}

/** The Migration page's data for `user`, from RPE's database. `identifier` is the extension's identifier in Lumiverse, which the steps of going back name. */
export function migrationPage(input: { db: Database; user: string; identifier: string }): MigrationPage {
  const report = lastReport(input.db, input.user);
  const taken = report?.runtime?.taken ?? null;
  const [, ...steps] = goingBack({ identifier: input.identifier, runtime: taken === null ? null : { name: taken.name, source: taken.source }, downRun: false });
  const going = { steps: steps.map((s) => s.trim()), permissions: [...PREVIOUS_PERMISSIONS] };
  if (report === null) return { report: null, text: null, chats: [], backup: null, waiting: [], goingBack: going, lumiverse: null };

  const chats: PageChat[] = (report.imports ?? []).map((c) => ({
    chat: c.chatId,
    outcome: c.outcome,
    why: c.why ?? null,
    turns: c.turns,
    shares: c.shares,
    check: { matched: c.matched, differences: c.differences, placed: c.placed },
    carried: chatRecord(input.db, input.user, c.chatId)?.carried ?? null,
  }));
  const own = report.carried?.ownFiles ?? null;
  const waiting: Waiting[] = [];
  if (own !== null && own.guidance > 0) waiting.push({ kind: "guidance", path: "imported/GUIDANCE.md" });
  for (const c of report.carried?.settings.lumiverseConnections ?? []) waiting.push({ kind: "connection", setting: c.setting, connection: c.connection });
  for (const c of report.chats) {
    const w = c.waiting;
    if (w.questions + w.staged + w.chips > 0 || w.rollback) waiting.push({ kind: "chat", chat: c.chatId, ...w });
  }
  if (own !== null && own.agents + own.skills + own.texts > 0) waiting.push({ kind: "own", agents: own.agents, skills: own.skills, texts: own.texts });
  for (const c of chats) {
    const carried = c.carried;
    if (carried !== null && (carried.characters.length > 0 || carried.notes !== null)) waiting.push({ kind: "filing", chat: c.chat, characters: carried.characters.length, notes: carried.notes !== null });
  }
  for (const world of report.worldsInBuild?.newer ?? []) waiting.push({ kind: "world", world, name: report.worldsInBuild?.names?.[world] ?? null });
  const b = report.backup;
  const backup = b === null ? null : { ...b, present: existsSync(b.path) && statSync(b.path).size === b.bytes };
  return { report, text: reportText(report), chats, backup, waiting, goingBack: going, lumiverse: report.lumiverse };
}
