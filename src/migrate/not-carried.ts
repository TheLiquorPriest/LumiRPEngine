// The chats a run did not carry that hold records of the previous build (`ChatImportReport.notCarried`), made impossible to miss: what
// `rpe migrate` and `rpe up` print names them first, ahead of the report, each with why, what of it RPE holds and what it does not, and what to
// do; the command's last line says it again, and the command ends with exit code 1; and the Migration page says the same at its top while the
// last real run's report holds one. Each chat is named by its name and its character's as Lumiverse's database holds them, read through the
// migration's door as the page's list of chats reads them, and its id. Every word is a line of the migration's own part of the history lines
// (`.prompts/history-migration.md`).

import { say } from "../shared/lines";
import { LumiverseDb } from "./lumiverse-db";
import type { MigrationReport, NotCarriedCause } from "./report";

/** One chat a run did not carry: its id, why, and whether what an earlier run carried of it stands in RPE. */
export interface NotCarried {
  chat: string;
  cause: NotCarriedCause;
  stands: boolean;
}

/** What to do of them, as the command or the page gives it: the line that runs the migration again; the line that goes back, where a switch was made (null: none was, so the previous build plays on as it did). */
export interface NotCarriedSteps {
  again: string;
  back: string | null;
}

/** The chats a report says a run did not carry; none for a rehearsal, or a report kept before runs said so. */
export function notCarriedOf(report: MigrationReport | null): NotCarried[] {
  return (report?.imports ?? []).flatMap((c) => (c.notCarried === undefined ? [] : [{ chat: c.chatId, ...c.notCarried }]));
}

const WHY: Readonly<Record<NotCarriedCause, string>> = { fold: "migration_not_carried_fold", store: "migration_not_carried_store", unopened: "migration_not_carried_unopened" };

/** Where the chats' names are read: the Lumiverse data folder the run read (null: none known, so each chat is named by its id alone), for the user whose chats they are. */
export interface NamesFrom {
  lumiverse: string | null;
  user: string;
}

/** Each chat's name and its character's, as Lumiverse's database holds them; none where it cannot be read, and each chat is then named by its id. */
function chatNames(from: NamesFrom): ReadonlyMap<string, { name: string | null; character: string | null }> {
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

/** One chat's line: its name, its character's and its id, with why it was not carried. */
function chatLine(c: NotCarried, names: ReadonlyMap<string, { name: string | null; character: string | null }>): string {
  const named = names.get(c.chat);
  return say("migration_not_carried_chat", { label: say("migration_not_carried_label", { name: named?.name ?? null, character: named?.character ?? null, chat: c.chat }), why: say(WHY[c.cause]) });
}

/** What one chat's lines say after why: what of it RPE holds and what it does not, that the previous build's data holds it all, and what to do. Lines the user deleted say nothing and are left out. */
export function notCarriedSteps(c: NotCarried, steps: NotCarriedSteps): string[] {
  const again = steps.back === null ? say("migration_not_carried_again", { line: steps.again }) : say("migration_not_carried_again_switched", { line: steps.again });
  const back = steps.back === null ? "" : say("migration_not_carried_back", { line: steps.back });
  return [say(c.stands ? "migration_not_carried_stands" : "migration_not_carried_none"), say("migration_not_carried_kept"), again, back].filter((line) => line !== "");
}

/** What a command prints first, ahead of the report: the head, then each chat by its name, its character's and its id, with why, and its steps under it. None where every chat was carried. */
export function notCarriedLines(list: readonly NotCarried[], steps: NotCarriedSteps, from: NamesFrom): string[] {
  if (list.length === 0) return [];
  const names = chatNames(from);
  return [say("migration_not_carried_head", { count: list.length }), ...list.flatMap((c) => [`  ${chatLine(c, names)}`, ...notCarriedSteps(c, steps).map((line) => `    ${line}`)]), ""];
}

/** A command's closing line where it ends with exit code 1 for them: the switch's says it went through all the same. */
export function notCarriedEnd(list: readonly NotCarried[], switched: boolean): string {
  return say(switched ? "migration_not_carried_end_switch" : "migration_not_carried_end", { count: list.length });
}

/** What the top of the Migration page says of them: the head, and each chat's line (as the command prints it) and steps, with its id. */
export interface NotCarriedShown {
  head: string;
  chats: { chat: string; line: string; lines: string[] }[];
}

/** The top of the Migration page while the last real run's report holds a chat not carried; null where it holds none. */
export function notCarriedShown(list: readonly NotCarried[], steps: NotCarriedSteps, from: NamesFrom): NotCarriedShown | null {
  if (list.length === 0) return null;
  const names = chatNames(from);
  return { head: say("migration_not_carried_page", { count: list.length }), chats: list.map((c) => ({ chat: c.chat, line: chatLine(c, names), lines: notCarriedSteps(c, steps) })) };
}
