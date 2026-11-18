// The chats a run did not carry that hold records of the previous build (`ChatImportReport.notCarried`), made impossible to miss and enough
// to mend: what `rpe migrate` and `rpe up` print names them first, ahead of the report, each with the cause in one plain sentence made from
// its record of why (`failures.ts`: the stage, the error's own words, the message it stood at by its place in the chat, and where the record
// is), what of it RPE holds and what it does not, and what to do; the head says where the records are kept; the command's last line says it
// again, and the command ends with exit code 1; and the Migration page says the same at its top while a record is kept, with the chats a
// later run carried and when. Each chat is named by its name and its character's as Lumiverse's database holds them, read through the
// migration's door as the page's list of chats reads them, and its id. Every word is a line of the migration's own part of the history lines
// (`.prompts/history-migration.md`).

import { say } from "../shared/lines";
import { type ChatFailure, type FailureStage, failedChats, failureFile, failuresFolder, readFailure } from "./failures";
import { LumiverseDb } from "./lumiverse-db";
import type { MigrationReport } from "./report";

/** One chat a run did not carry: its id, the stage it failed in, and whether what an earlier run carried of it stands in RPE. */
export interface NotCarried {
  chat: string;
  stage: FailureStage;
  stands: boolean;
}

/**
 * What to do of them, as the command or the page gives it: the line that runs the migration again; the line that carries one chat alone
 * (null where the line given was already one); the line that goes back, where a switch was made (null: none was, so the previous build
 * plays on as it did).
 */
export interface NotCarriedSteps {
  again: string;
  one: ((chat: string) => string) | null;
  back: string | null;
}

/** The chats a report says a run did not carry; none for a rehearsal, or a report kept before runs said so. */
export function notCarriedOf(report: MigrationReport | null): NotCarried[] {
  return (report?.imports ?? []).flatMap((c) => (c.notCarried === undefined ? [] : [{ chat: c.chatId, ...c.notCarried }]));
}

const WHY: Readonly<Record<FailureStage, string>> = { read: "migration_not_carried_read", fold: "migration_not_carried_fold", store: "migration_not_carried_store", check: "migration_not_carried_check" };

/** Where the chats' names are read: the Lumiverse data folder the run read (null: none known, so each chat is named by its id alone), for the user whose chats they are. */
export interface NamesFrom {
  lumiverse: string | null;
  user: string;
}

type Names = ReadonlyMap<string, { name: string | null; character: string | null }>;

/** Each chat's name and its character's, as Lumiverse's database holds them; none where it cannot be read, and each chat is then named by its id. */
function chatNames(from: NamesFrom): Names {
  if (from.lumiverse === null) return new Map();
  try {
    const db = LumiverseDb.open(from.lumiverse, from.user);
    try {
      return new Map(db.chats().map((c) => [c.id, { name: c.name === "" ? null : c.name, character: c.character === null ? null : (db.character(c.character)?.name ?? null) }]));
    } finally {
      db.close();
    }
  } catch {
    return new Map();
  }
}

/** A chat as the notice names it: its name, its character's and its id. */
function label(chat: string, names: Names): string {
  const named = names.get(chat);
  return say("migration_not_carried_label", { name: named?.name ?? null, character: named?.character ?? null, chat });
}

/**
 * One chat's cause in a plain sentence, made from its record of why: the stage, the message it stood at (its place in the chat) and swipe,
 * the error's own words (their first line), and the record's file for the rest. A chat whose record is not there (he removed it) has the
 * stage alone.
 */
function chatLine(c: NotCarried, names: Names, root: string): string {
  const record: ChatFailure | null = readFailure(root, c.chat);
  const at = record?.message ?? null;
  const words = record?.error.message.split("\n")[0]?.trim() ?? "";
  return say("migration_not_carried_chat", {
    label: label(c.chat, names),
    why: say(WHY[record?.stage ?? c.stage]),
    number: at === null ? null : String(at.number),
    swipe: at === null ? null : String(at.swipe),
    error: words === "" ? null : words,
    file: record === null ? null : failureFile(root, c.chat),
  });
}

/** What one chat's lines say after its cause: what of it RPE holds and what it does not, that the previous build's data holds it all, and what to do. Lines the user deleted say nothing and are left out. */
export function notCarriedSteps(c: NotCarried, steps: NotCarriedSteps): string[] {
  const again = steps.back === null ? say("migration_not_carried_again", { line: steps.again }) : say("migration_not_carried_again_switched", { line: steps.again });
  const one = steps.one === null ? "" : say("migration_not_carried_one", { line: steps.one(c.chat) });
  const back = steps.back === null ? "" : say("migration_not_carried_back", { line: steps.back });
  return [say(c.stands ? "migration_not_carried_stands" : "migration_not_carried_none"), say("migration_not_carried_kept"), again, one, back].filter((line) => line !== "");
}

/**
 * What a command prints first, ahead of the report: the chats it carried that an earlier run could not, each once; then the head, with where
 * the records are kept (RPE's data folder `root`), and each chat it did not carry with its cause, its steps under it; then how many other
 * chats' records of why are still kept there (a run asked for one chat, or a chat left alone, leaves them). None where none of these is.
 */
export function notCarriedLines(report: MigrationReport, steps: NotCarriedSteps, from: NamesFrom, root: string): string[] {
  const list = notCarriedOf(report);
  const closed = report.closed ?? [];
  const open = failedChats(root).filter((chat) => !list.some((c) => c.chat === chat));
  if (list.length === 0 && closed.length === 0 && open.length === 0) return [];
  const names = chatNames(from);
  const carried = closed.map((c) => say("migration_carried_now", { label: label(c.chat, names), failed: c.failed }));
  const failed = list.length === 0 ? [] : [say("migration_not_carried_head", { count: list.length, folder: failuresFolder(root) }), ...list.flatMap((c) => [`  ${chatLine(c, names, root)}`, ...notCarriedSteps(c, steps).map((line) => `    ${line}`)])];
  const still = open.length === 0 ? "" : say("migration_still_open", { count: open.length, folder: failuresFolder(root), chats: open.map((chat) => label(chat, names)).join(", ") });
  return [...carried, ...failed, still, ""].filter((line, i, all) => line !== "" || i === all.length - 1);
}

/** A command's closing line where it ends with exit code 1 for them: the switch's says it went through all the same. */
export function notCarriedEnd(list: readonly NotCarried[], switched: boolean): string {
  return say(switched ? "migration_not_carried_end_switch" : "migration_not_carried_end", { count: list.length });
}

/** What the top of the Migration page says of them: the head, each chat's line (as the command prints it), its steps and the file of its record; and the chats the last run carried that an earlier one could not, with when. */
export interface NotCarriedShown {
  head: string;
  chats: { chat: string; line: string; lines: string[]; record: string | null }[];
  carried: { chat: string; line: string }[];
}

/**
 * The top of the Migration page: each chat whose record of why is kept (`kept`, with whether what an earlier run carried of it stands),
 * while it is kept; and the chats the last real run (`report`) carried that an earlier run could not. Null where there is neither.
 */
export function notCarriedShown(kept: readonly NotCarried[], report: MigrationReport | null, steps: NotCarriedSteps, from: NamesFrom, root: string): NotCarriedShown | null {
  const closed = report?.closed ?? [];
  if (kept.length === 0 && closed.length === 0) return null;
  const names = chatNames(from);
  return {
    head: kept.length === 0 ? "" : say("migration_not_carried_page", { count: kept.length, folder: failuresFolder(root) }),
    chats: kept.map((c) => ({ chat: c.chat, line: chatLine(c, names, root), lines: notCarriedSteps(c, steps), record: readFailure(root, c.chat) === null ? null : failureFile(root, c.chat) })),
    carried: closed.map((c) => ({ chat: c.chat, line: say("migration_carried_page", { label: label(c.chat, names), at: report?.at ?? "", failed: c.failed }) })),
  };
}
