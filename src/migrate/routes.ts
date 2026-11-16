// The Migration page's routes (plan §14, §15.5, §15.6; R-4, R-80, R-180, R-327, R-328): the summary of the last real run
// and of the page's own rehearsal, before any run as after; a report's rows, chats (by name, searchable), a chat's
// differences and the things found, a page at a time (`migration.page`, at most `migration.pageMost`); a chat's own
// summary; the printed text; the report whole, to be saved as a file; the rehearsal started from the page, a long route
// whose report the running RPE holds in memory, writing nothing; and, for a migrated chat, its carried turns with what each
// old engine recorded of the reply. Every route but the rehearsal's start is a read of RPE's database or of what RPE holds.

import { join } from "node:path";
import { dirname } from "node:path";
import type { Database } from "bun:sqlite";
import { route, RouteError, shape } from "../app";
import { type AppConfig, type DataPaths, SHIPPED_FOLDER } from "../app/config";
import { readText } from "../app/disk";
import type { Registry } from "../engine/registry-impl";
import type { Store } from "../store";
import { answerPaused, NotPaused } from "./answers";
import { rowsGiven } from "./migrate";
import { oldRecord, oldRecords } from "./old-records";
import { IMPORTED, IMPORTED_AGENTS } from "./own-files";
import { chatOne, chatsOf, differencesOf, itemsOf, migrationPage, type MigrationPageInput, reportFor, type ReportOf, rowsOf, summaryOf, textFor } from "./page";
import { RehearsalRunning, type Rehearsals } from "./rehearse-job";
import { type MigrationReport, reportText } from "./report";
import { runtimeFoldersOf } from "./runtime-folders";
import { carriedPage } from "./setting-list";
import {
  answerBody,
  answerReply,
  carriedTurnReply,
  carriedTurnsReply,
  migrationChatReply,
  migrationChatsReply,
  migrationDifferencesReply,
  migrationFileReply,
  migrationItemsReply,
  migrationReply,
  migrationRowsReply,
  migrationTextReply,
  pickBody,
  pickReply,
  rehearsalBody,
  rehearsalReply,
  switchOnBody,
  switchOnReply,
} from "./shapes";
import { switchOn, SwitchOnRefused } from "./switch-on";
import { lastReport } from "./tables";

/** What the presses of the waiting list take from the app: its clock, its one writer of the database, the packs, and what the composition gives (the store, the tree's writer as him and its folder names); a press whose part is not given is refused in words. */
export interface MigratePresses {
  now(): number;
  write<T>(work: () => T, label: string): Promise<T>;
  registry: Registry;
  store?(): Store;
  writeAsUser?(user: string, path: string, text: string): Promise<string>;
  /** The folders agents, skills and prompts are read from at a level of the file tree. */
  folders?: { agents: string; skills: string; prompts: string };
}

export interface MigrateRoutesDeps {
  /** RPE's database. */
  db: Database;
  /** The extension's identifier in Lumiverse, which the steps of the swap and of going back name. */
  identifier: string;
  /** RPE's data folder, where a rehearsal weighs the disk the real run would take and reads the rows he gave; its `RPE-global.yml` sets the page sizes. */
  paths: DataPaths;
  /** RPE's config: Lumiverse's database file, where a rehearsal reads today's data when no run has named its folder; RPE's connections in Lumiverse. */
  config: AppConfig;
  /** The page's rehearsals, held in memory. */
  rehearsals: Rehearsals;
  /** The presses of what waits on him; absent: the page reads only. */
  presses?: MigratePresses;
  /** The environment and home folder today's runtime finds its folders by; the server's own when left out. */
  env?: Readonly<Record<string, string | undefined>>;
  home?: string;
}

/** An agent file's text with its header's `model:` naming `connection`, the rest word for word. */
function withModel(text: string, connection: string): string {
  const head = /^---\n([\s\S]*?)\n---/.exec(text);
  if (head === null) return `---\nmodel: ${connection}\n---\n${text}`;
  const lines = (head[1] ?? "").split("\n");
  const at = lines.findIndex((l) => /^model:/.test(l));
  if (at >= 0) lines[at] = `model: ${connection}`;
  else lines.push(`model: ${connection}`);
  return `---\n${lines.join("\n")}\n---${text.slice(head[0].length)}`;
}

export const MIGRATION_PATH = "/api/v1/migration";

/** Which report a route's `:of` names. */
function reportOf(of: string): ReportOf {
  if (of === "run" || of === "rehearsal") return of;
  throw new RouteError(404, `No report is named ${of}: the last real run's is "run", the page's rehearsal's "rehearsal".`);
}

/** A list's page after the place `after` (an item's key in the list's own order), `limit` long, with the key of its last item as the next page's place. */
function pageAfter<T>(list: readonly T[], key: (item: T) => string, after: string | undefined, limit: number): { items: T[]; next: string | null } {
  const start = after === undefined ? 0 : list.findIndex((item) => key(item) === after) + 1;
  if (after !== undefined && start === 0) throw new RouteError(409, "The list changed since its last page was read: read it again from the start.");
  const items = list.slice(start, start + limit);
  const last = items.at(-1);
  return { items, next: last !== undefined && start + items.length < list.length ? key(last) : null };
}

/** The migration's routes: the page's, and the carried turns' of a chat. */
export function migrateRoutes(deps: MigrateRoutesDeps) {
  const presses = deps.presses;
  const page = (user: string): MigrationPageInput => ({
    db: deps.db,
    user,
    identifier: deps.identifier,
    rehearsals: deps.rehearsals,
    database: deps.config.lumiverse.database,
    runtime: runtimeFoldersOf(deps.env ?? process.env, deps.home ?? (process.env.HOME ?? "")),
    rpeConnections: deps.config.lumiverse.connections,
    ...(presses?.folders === undefined ? {} : { tree: { files: deps.paths.files, ...presses.folders } }),
  });
  /** A press's part the composition gives, or the press refused in words. */
  const needs = <T>(part: T | undefined, what: string): T => {
    if (part === undefined) throw new RouteError(503, `This RPE was not given ${what}, so the press can't be made here.`);
    return part;
  };
  const sizes = async (): Promise<{ default: number; most: number }> => {
    const p = await carriedPage(deps.paths.globalConfig);
    return { default: p.size, most: p.most };
  };
  const report = (user: string, of: string): MigrationReport => {
    const which = reportOf(of);
    const found = reportFor(page(user), which);
    if (found === null) throw new RouteError(404, which === "run" ? "No real run of the migration has been made in this data folder yet." : "No rehearsal has been read from this page since RPE started.");
    return found;
  };
  /** The chats' names Lumiverse holds, for a report: read through the door from the folder it read, or the one RPE's config names. */
  const names = (user: string, r: MigrationReport): ReadonlyMap<string, string> => deps.rehearsals.names(user, r.sources?.lumiverse ?? (deps.config.lumiverse.database === null ? null : dirname(deps.config.lumiverse.database)));
  return [
    route({
      method: "GET",
      path: MIGRATION_PATH,
      access: "page",
      group: "migration",
      does: "The Migration page's summary: the last real run and the page's rehearsal in brief, the folders a rehearsal reads, the backup, what waits on the user, the swap's steps and going back's with the permissions by name; before any run as after.",
      reply: migrationReply,
      handle: async ({ user }) => {
        const p = migrationPage({ ...page(user), given: await rowsGiven(deps.paths) });
        // What today's build put in Lumiverse is a document the migration kept as JSON; it is carried as it is.
        return { ...p, lumiverse: p.lumiverse === null ? null : { ...p.lumiverse } };
      },
    }),
    route({
      method: "POST",
      path: `${MIGRATION_PATH}/switch-on`,
      access: "page",
      group: "migration",
      does: "One press switches one of his attached files on (R-81): GUIDANCE.md as AGENTS.md at the user's level, an agent where agents are read, a skill where skills are read; the attached file and its original stay under imported/ word for word. A file of that name already in force there is never written over: it is answered beside the attached one.",
      body: switchOnBody,
      reply: switchOnReply,
      handle: async ({ user, body }) => {
        const folders = needs(presses?.folders, "the file tree's folders");
        const write = needs(presses?.writeAsUser, "the file tree's writer");
        try {
          return await switchOn(body.path, { root: deps.paths.files, shipped: join(deps.paths.files, SHIPPED_FOLDER), folders, write: (path, text) => write(user, path, text) });
        } catch (error) {
          if (error instanceof SwitchOnRefused) throw new RouteError(400, error.message);
          throw error;
        }
      },
    }),
    route({
      method: "POST",
      path: `${MIGRATION_PATH}/connection`,
      access: "page",
      group: "migration",
      does: "Picks one of RPE's connections for the work one of his own agents does, where today's choice named a connection that lives in Lumiverse: written as the `model:` of the agent's attached file, and of the one in force where it is switched on, so that work uses it from then on.",
      body: pickBody,
      reply: pickReply,
      handle: async ({ user, body }) => {
        const folders = needs(presses?.folders, "the file tree's folders");
        const write = needs(presses?.writeAsUser, "the file tree's writer");
        if (!/^[^/\\]+$/.test(body.agent)) throw new RouteError(400, `${body.agent} names no agent of his.`);
        const written: string[] = [];
        for (const path of [`${IMPORTED}/${IMPORTED_AGENTS}/${body.agent}.md`, `${folders.agents}/${body.agent}.md`]) {
          const text = await readText(join(deps.paths.files, path));
          if (text !== null) written.push(await write(user, path, withModel(text, body.connection)));
        }
        if (written.length === 0) throw new RouteError(404, `No attached agent ${body.agent} is under ${IMPORTED}/${IMPORTED_AGENTS}/.`);
        return { written };
      },
    }),
    route({
      method: "POST",
      path: `${MIGRATION_PATH}/chats/:chat/answer`,
      access: "page",
      group: "migration",
      does: "Answers the keep-or-discard question today's build left the chat paused on (R-54): kept in RPE's database, written at every later run as today's pause chip writes it, and at once the held turns' changes land on their own turns, the later turns applied again on top, what no longer applies reported and the stretch named in the chat's next briefing. Today's data is never written.",
      body: answerBody,
      reply: answerReply,
      long: true,
      handle: async ({ user, params, body }) => {
        const p = needs(presses, "the presses");
        const store = needs(p.store, "RPE's store")();
        const last = lastReport(deps.db, user);
        const lumiverse = last?.sources?.lumiverse ?? migrationPage(page(user)).sources.lumiverse;
        if (lumiverse === null) throw new RouteError(409, "No run has read today's data here, and RPE's config names no Lumiverse database: run the migration first.");
        try {
          const done = await answerPaused({
            db: deps.db,
            s: store.user(user),
            registry: p.registry,
            sources: { lumiverse, identifier: deps.identifier, userId: user, runtime: last?.sources?.runtime ?? null, ...(last?.sources?.runtimeName !== undefined ? { runtimeName: last.sources.runtimeName } : {}), ...(last?.sources?.runtimeFolders !== undefined ? { runtimeFolders: last.sources.runtimeFolders } : {}) },
            chat: params.chat,
            ...(body.message === undefined ? {} : { message: body.message }),
            choice: body.choice,
            now: p.now(),
            write: (work) => p.write(work, "landing his answer to a paused chat"),
          });
          return { ...done, landed: JSON.parse(JSON.stringify(done.landed)) };
        } catch (error) {
          if (error instanceof NotPaused) throw new RouteError(409, error.message);
          throw error;
        }
      },
    }),
    route({
      method: "POST",
      path: `${MIGRATION_PATH}/rehearsals`,
      access: "page",
      group: "migration",
      does: "Starts a rehearsal over today's data, read-only as `rpe migrate --rehearse` reads it, and answers its report in brief once read; the running RPE holds the report in memory beside the last real run's, and nothing of it is written, RPE's database included. One under way is refused.",
      body: rehearsalBody,
      reply: rehearsalReply,
      long: true,
      handle: async ({ user, body }) => {
        const p = migrationPage(page(user));
        const lumiverse = body.lumiverse?.trim() || p.sources.lumiverse;
        if (lumiverse === null) throw new RouteError(400, "Say where Lumiverse's data folder is (the one holding lumiverse.db): RPE's config names no Lumiverse database, and no run has read one yet.");
        const last = lastReport(deps.db, user)?.sources;
        const runtime = body.runtime === undefined ? p.sources.runtime : body.runtime;
        try {
          const read = await deps.rehearsals.start({ lumiverse, identifier: deps.identifier, userId: user, runtime, ...(last?.runtimeName !== undefined ? { runtimeName: last.runtimeName } : {}), ...(last?.runtimeFolders !== undefined ? { runtimeFolders: last.runtimeFolders } : {}) });
          return { summary: summaryOf(read) };
        } catch (error) {
          if (error instanceof RehearsalRunning) throw new RouteError(409, error.message);
          throw new RouteError(422, `The rehearsal stopped: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    }),
    route({
      method: "GET",
      path: `${MIGRATION_PATH}/:of/rows`,
      access: "page",
      group: "migration",
      does: "A page of a report's rows (`run`: the last real run's; `rehearsal`: the page's), in the plan's order: each row's things counted to their ends, those with no place and why, and after a real run where they now are.",
      reply: migrationRowsReply,
      paged: { sizes },
      handle: ({ user, params, query }) => pageAfter(rowsOf(report(user, params.of)), (r) => r.row, query.after, query.limit),
    }),
    route({
      method: "GET",
      path: `${MIGRATION_PATH}/:of/chats`,
      access: "page",
      group: "migration",
      does: "A page of a report's chats, each by its name in Lumiverse: what today's readers found, what the real run did with it and its check, and whether it is still off RPE. `q` keeps those whose name or id holds it.",
      query: { q: shape.optional(shape.text(), "Words a chat's name or id holds, any case; all chats when left out.") },
      reply: migrationChatsReply,
      paged: { sizes },
      handle: ({ user, params, query }) => {
        const r = report(user, params.of);
        return pageAfter(chatsOf(r, names(user, r), query.q ?? null), (c) => c.chat, query.after, query.limit);
      },
    }),
    route({
      method: "GET",
      path: `${MIGRATION_PATH}/:of/chats/:chat`,
      access: "page",
      group: "migration",
      does: "One chat of a report in full: as the chats' list gives it, what today's readers found of it, and what the last real run that imported it carried of it.",
      reply: migrationChatReply,
      handle: ({ user, params }) => {
        const which = reportOf(params.of);
        const r = report(user, which);
        const one = chatOne(page(user), r, names(user, r), params.chat, which);
        if (one === null) throw new RouteError(404, `The report names no chat ${params.chat}.`);
        const { read, carried, ...chat } = one;
        // What today's readers found of it and what was carried of it are documents the migration made; they are carried as they are.
        return { chat, read: read === null ? null : JSON.parse(JSON.stringify(read)), carried: carried === null ? null : JSON.parse(JSON.stringify(carried)) };
      },
    }),
    route({
      method: "GET",
      path: `${MIGRATION_PATH}/:of/chats/:chat/differences`,
      access: "page",
      group: "migration",
      does: "A page of where a chat's state differed from today's fold, in the order the run checked it: at a swipe or at the head, the values that differ by path, and whether today's state there is kept as the turn's start.",
      reply: migrationDifferencesReply,
      paged: { sizes },
      handle: ({ user, params, query }) => pageAfter(differencesOf(report(user, params.of), params.chat), (d) => `${d.turn} ${d.at === "head" ? "head" : `${d.at.message}:${d.at.swipe}`}`, query.after, query.limit),
    }),
    route({
      method: "GET",
      path: `${MIGRATION_PATH}/:of/items`,
      access: "page",
      group: "migration",
      does: "A page of the things a report found, in the order it found them: where each is, its path, size and SHA-256, its row and fate. `q` keeps those whose place, path, row or note holds it; `row` those of one row (`none`: found, not classified).",
      query: { q: shape.optional(shape.text(), "Words a thing's place, path, row or note holds, any case."), row: shape.optional(shape.text(), "One row's id; `none` for what was found, not classified.") },
      reply: migrationItemsReply,
      paged: { sizes },
      handle: ({ user, params, query }) => pageAfter(itemsOf(report(user, params.of), query.q ?? null, query.row ?? null), (i) => `${i.where}: ${i.path}`, query.after, query.limit),
    }),
    route({
      method: "GET",
      path: `${MIGRATION_PATH}/:of/text`,
      access: "page",
      group: "migration",
      does: "A report's printed text, as the rehearsal or the run printed it.",
      reply: migrationTextReply,
      handle: ({ user, params }) => {
        const text = textFor(page(user), reportOf(params.of), reportText);
        if (text === null) throw new RouteError(404, "There is no such report yet.");
        return { text };
      },
    }),
    route({
      method: "GET",
      path: `${MIGRATION_PATH}/:of/file`,
      access: "page",
      group: "migration",
      does: "A report whole, with its printed text and the name to save it under, for the page to save as a file: counts, paths and checksums, never content.",
      reply: migrationFileReply,
      handle: ({ user, params }) => {
        const r = report(user, params.of);
        return { name: `rpe-migration-${r.mode === "real run" ? "run" : "rehearsal"}-${r.at.replace(/[^0-9TZ]/g, "")}.json`, report: JSON.parse(JSON.stringify(r)), text: reportText(r) };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/carried",
      access: "page",
      group: "migration",
      does: "A migrated chat's carried turns, in the order the run imported them, each tied to its message and swipe, with the engine that played it, why it stood with no turn played, and how many departures and texts of the old engine it holds. `from` is how many to pass over; `limit` how many to give (the setting `migration.page` when left out, at most `migration.pageMost`).",
      query: {
        from: shape.optional(shape.whole({ least: 0 }), "How many carried turns to pass over; none when left out."),
        limit: shape.optional(shape.whole({ least: 1 }), "How many carried turns to give: the setting `migration.page` when left out, and at most `migration.pageMost`."),
      },
      reply: carriedTurnsReply,
      handle: async ({ user, params, query }) => {
        const p = await carriedPage(deps.paths.globalConfig);
        const from = query.from ?? 0;
        const read = oldRecords(deps.db, user, params.chat, { from, limit: Math.min(query.limit ?? p.size, p.most) });
        return { ...read, more: from + read.turns.length < read.total };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/turns/:turn/carried",
      access: "page",
      group: "migration",
      does: "What an old engine recorded on a reply the migration carried, for the reply's Turn page: the engine that played the chat, each part of the record by name, every text it names word for word, why the reply stood with no turn played, and each line where it says something against its turn.",
      reply: carriedTurnReply,
      joined: true,
      handle: ({ user, params }) => {
        const found = oldRecord(deps.db, user, params.turn);
        if (found === null || found.chat !== params.chat) throw new RouteError(404, `Turn ${params.turn} of chat ${params.chat} is not one a migration carried.`);
        return found;
      },
    }),
  ] as const;
}
