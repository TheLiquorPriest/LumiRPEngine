// The lore index's routes (plan §9.1, §14), for the Lore page: the index a page at a time, with the lines each entry
// has and how it stands; where indexing stands and which model it runs on; and the owner's press that starts an
// indexing job. Declared in the route form (`src/app/routes.ts`). They answer only for the user this RPE belongs to.
//
// The job is the `indexer` definition run as a job through RPH's own start (`JobsApi.start`): one the owner starts
// belongs to no turn (R-27), runs on the model its definition names (else his default connection's), and writes its lines
// through `lore_index_write`. Code never starts one itself (plan §13.5): this is his press. The jobs are listed with the
// chat's others by the jobs routes, the indexer's by its definition's name.

import type { DefinitionsApi, JobRefusal, JobsApi, Scope } from "rp-harness/contract";
import { RouteError, route, shape } from "../app";
import { BINDING_BYS } from "./bindings";
import { type IndexedEntry, LORE_INDEX_FIELDS, type LoreIndex, type LoreIndexEdit } from "./indexing";
import type { LoreAt } from "./lore";
import { loreLine } from "./tools";

const T = shape.text();
const field = shape.field;

/** The definition an indexing job runs: the shipped `.agents/indexer.md` (plan Appendix C). */
export const LORE_INDEXER = "indexer";

export const LORE_INDEX_PATH = "/api/v1/chats/:chat/lore/index";
export const LORE_INDEX_STATUS_PATH = "/api/v1/chats/:chat/lore/index/status";
export const LORE_INDEX_JOBS_PATH = "/api/v1/chats/:chat/lore/index/jobs";
export const LORE_INDEX_ENTRY_PATH = "/api/v1/chats/:chat/lore/index/:entry";
export const LORE_OVERLAYS_PATH = "/api/v1/chats/:chat/lore/overlays";

const binding = shape.object({ what: field(T, "The record it defines, by its id (`entity:sefa`, `place:harbor`), its name or as written."), aspect: field(T, "Which side of it the entry defines; empty where none was said.") });

const link = shape.object({
  record: field(T, "The record's id in the tree (`entity:<id>`, `place:<id>`, `quest:<id>`, `cast:<id>`), or, where none exists, what its writer wrote."),
  linked: field(shape.yesNo(), "Whether the record exists; false shows the binding as unlinked."),
  aspect: field(T, "Which side of it the entry defines; empty where none was said."),
  by: field(shape.oneOf(...BINDING_BYS, "pin"), "Who bound it: an indexing run, casting, bootstrap, the owner, or the world's own pin (read from the world, never copied)."),
});

const indexRow = shape.named(
  "LoreIndexRow",
  "An entry of a chat's lore with what the database holds of it and what the index says of it: the user's own lines where he wrote them, else the latest indexing run's, an earlier revision's marked stale.",
  shape.object({
    id: field(T, "The id the lore map gives the entry: `e-` or `w-` and its number."),
    title: field(T, "Its title."),
    source: field(T, "Its book's name, or its world's."),
    book: field(shape.nullable(T), "Its book's id in Lumiverse; null for a world entry."),
    keys: field(shape.list(T), "The keys that activate it."),
    size: field(shape.whole({ least: 0 }), "Characters in its text."),
    activation: field(shape.list(shape.oneOf("constant", "keyword", "vector")), "How it comes into the prompt by itself; none for one that never does."),
    revision: field(T, "Its revision: Lumiverse's for a book entry, a hash of its words for a world entry."),
    kind: field(shape.nullable(T), "What kind of thing it is, where a run or the user has said."),
    line: field(shape.nullable(T), "One line saying what it is, where a run or the user has said."),
    defines: field(shape.list(binding), "What it defines."),
    related: field(shape.list(T), "Related entries, by id."),
    fields: field(shape.record(shape.union(T, shape.list(T))), "The fields beside those that the indexer's file asks an index line to hold, by name."),
    indexed: field(shape.yesNo(), "Whether a run has written lines for the entry as it stands now."),
    stale: field(shape.yesNo(), "Whether the lines shown were written for an earlier revision of it."),
    edited: field(shape.list(shape.oneOf(...LORE_INDEX_FIELDS)), "Which of the lines are the user's own."),
    links: field(shape.list(link), "What the entry is bound to: each binding in force, the owner's over an indexing run's, and the world's own pins of it, each to a record by its id."),
  }),
);

const statusReply = shape.named(
  "LoreIndexStatus",
  "Where a chat's lore indexing stands, and what it runs on: how many entries the chat's lore holds, how many no run has indexed as they stand now, and the model the indexer's definition runs on.",
  shape.object({
    entries: field(shape.whole({ least: 0 }), "Entries in the chat's lore."),
    unindexed: field(shape.whole({ least: 0 }), "Entries no run has written lines for as they stand now."),
    agent: field(T, "The definition indexing runs as."),
    connection: field(shape.nullable(shape.object({ id: field(T, "The connection's id."), name: field(T, "Its name.") })), "The connection the definition runs on: the one it names, else his default; null where none is there."),
    model: field(shape.nullable(T), "That connection's model; null where none resolves."),
  }),
);

const startReply = shape.named("LoreIndexJob", "The indexing job the owner started.", shape.object({ job: field(T, "Its id in the jobs."), state: field(T, "Its state as RPH keeps it.") }));

const overlaysReply = shape.named(
  "LoreOverlays",
  "The overlays on a chat's path: the Author's notes that the story has moved past part of an entry, each tied to the turn that wrote it.",
  shape.object({
    overlays: field(
      shape.list(
        shape.object({
          id: field(shape.whole({ least: 1 }), "The overlay's id."),
          entry: field(T, "The id the lore map gives the entry."),
          title: field(shape.nullable(T), "The entry's title where the chat's lore holds it; null where it does not."),
          note: field(T, "What the story has moved past in it."),
          turn: field(shape.whole({ least: 1 }), "The turn that wrote it, by its place on the chat's path, counted from 1."),
          turnId: field(T, "That turn's id."),
          by: field(shape.nullable(T), "The definition of the agent that wrote it."),
          agent: field(shape.nullable(T), "Its handle in its run."),
        }),
      ),
      "In the path's order, and within a turn in the order they were written.",
    ),
  }),
);
const editBody = shape.object({
  kind: shape.optional(shape.nullable(T), "What kind of thing it is; null takes his own off."),
  line: shape.optional(shape.nullable(T), "One line saying what it is; null takes his own off."),
  defines: shape.optional(shape.nullable(shape.list(binding)), "What it defines, each by a record's id, its name or as written; null takes his own off, and the run's show again."),
  related: shape.optional(shape.nullable(shape.list(T)), "Related entries, by id; null takes his own off."),
});

function rowOf(e: IndexedEntry) {
  return {
    id: e.id,
    title: e.title,
    source: e.source,
    book: e.book,
    keys: e.keys,
    size: e.size,
    activation: e.activation,
    revision: e.revision,
    kind: e.kind,
    line: e.line,
    defines: e.defines.map((b) => ({ what: b.what, aspect: b.aspect })),
    related: e.related,
    fields: e.fields,
    indexed: e.indexed,
    stale: e.stale,
    edited: e.edited,
    links: e.links.map((l) => ({ record: l.record, linked: l.linked, aspect: l.aspect, by: l.by })),
  };
}

export interface LoreIndexRoutesDeps {
  index: LoreIndex;
  /** RPH's jobs, of which the routes start one. */
  jobs: Pick<JobsApi, "start">;
  /** RPH's definitions, for what the indexer runs on. */
  definitions: Pick<DefinitionsApi, "list">;
  /** The scope RPH asks a chat's definitions and jobs in. */
  scope(user: string, chat: string): Scope;
}

/** A job that was not started, in the words of the lore's lines: the line of its cause (`job_refused_day_count`), else the general one; its facts where the part has neither. */
function refusedWords(lines: Parameters<typeof loreLine>[0], refusal: JobRefusal): string {
  const { refused, ...facts } = refusal;
  const fields: Record<string, string | number> = { refused, ...Object.fromEntries(Object.entries(facts).filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number")) };
  return loreLine(lines, `job_refused_${refused.replaceAll("-", "_")}`, fields) ?? loreLine(lines, "job_refused", fields) ?? JSON.stringify(refusal);
}

export function loreIndexRoutes(deps: LoreIndexRoutesDeps) {
  const settings = deps.index.settings;
  return [
    route({
      method: "GET",
      path: LORE_INDEX_PATH,
      access: "page",
      group: "lore",
      does: "The lore index of a chat, a page at a time in the order of the lore map's catalog: each entry of its books and its world with its id, keys, size, how it activates and revision, and the lines the index holds of it (the user's own, else the latest run's, an earlier revision's marked stale) with whether they are current.",
      reply: shape.page(indexRow),
      paged: { sizes: () => ({ default: settings.page, most: settings.page * 10 }) },
      handle: async ({ user, params, query }) => {
        const all = await deps.index.entries({ user, chat: params.chat });
        const from = query.after === undefined ? 0 : all.findIndex((e) => e.id === query.after) + 1;
        const items = all.slice(from, from + (query.limit ?? settings.page)).map(rowOf);
        return { items, next: from + items.length < all.length ? (items[items.length - 1]?.id ?? null) : null };
      },
    }),
    route({
      method: "GET",
      path: LORE_INDEX_STATUS_PATH,
      access: "page",
      group: "lore",
      does: "Where a chat's lore indexing stands: its entries and how many no run has indexed as they stand now, and the connection and model the indexer's definition runs on (its own, else his default).",
      reply: statusReply,
      handle: async ({ user, params }) => {
        const at: LoreAt = { user, chat: params.chat };
        const [entries, unindexed, listed] = await Promise.all([deps.index.entries(at), deps.index.unindexed(at), deps.definitions.list(deps.scope(user, params.chat))]);
        const runsOn = listed.find((d) => d.name === LORE_INDEXER)?.runsOn;
        return { entries: entries.length, unindexed, agent: LORE_INDEXER, connection: runsOn?.connection ?? null, model: runsOn?.model ?? null };
      },
    }),
    route({
      method: "POST",
      path: LORE_INDEX_JOBS_PATH,
      access: "page",
      group: "lore",
      does: "Starts a lore indexing job for a chat: the indexer's definition as a job of the owner's own, tied to no turn, handed the entries no run has indexed as they stand now a batch at a time. Refused, with the fact, where jobs are off or a limit of the day is reached.",
      reply: startReply,
      handle: async ({ user, params }) => {
        const at: LoreAt = { user, chat: params.chat };
        // The brief is a line of the lore's answers, which the user may reword or take off; the job is handed its batches by name.
        const brief = loreLine(await deps.index.lines(at), "job_brief", { chat: params.chat }) ?? "";
        const started = await deps.jobs.start(deps.scope(user, params.chat), { agent: LORE_INDEXER, brief });
        if ("refused" in started) throw new RouteError(409, refusedWords(await deps.index.lines(at), started));
        return { job: started.id, state: started.state };
      },
    }),
    route({
      method: "GET",
      path: LORE_OVERLAYS_PATH,
      access: "page",
      group: "lore",
      does: "The overlays on a chat's path, in the path's order: each with its entry and the entry's title, the note, the turn that wrote it (its place on the path, from 1, and its id) and who wrote it. A turn that was swiped away or deleted has none on the path.",
      reply: overlaysReply,
      handle: async ({ user, params }) => ({ overlays: (await deps.index.overlays({ user, chat: params.chat })).map((o) => ({ id: o.id, entry: o.entry, title: o.title, note: o.note, turn: o.number, turnId: o.turn, by: o.by, agent: o.agent })) }),
    }),
    route({
      method: "PUT",
      path: LORE_INDEX_ENTRY_PATH,
      access: "page",
      group: "lore",
      does: "The owner's own lines for one entry of a chat's lore: its kind, its line, what it defines (each to a record by its id, a name given resolving to the one record of that name, else kept as written and shown unlinked) and its related entries. What he sets stands over an indexing run's and outlives a run that redoes the entry; null takes his own off, and the run's shows again. Answers the entry as it now stands.",
      body: editBody,
      reply: indexRow,
      handle: async ({ user, params, body }) => {
        const edit: LoreIndexEdit = {};
        if (body.kind !== undefined) edit.kind = body.kind;
        if (body.line !== undefined) edit.line = body.line;
        if (body.defines !== undefined) edit.defines = body.defines;
        if (body.related !== undefined) edit.related = body.related;
        const row = await deps.index.edit({ user, chat: params.chat }, params.entry, edit);
        if (row === null) throw new RouteError(404, `There is no entry ${params.entry} in this chat's lore.`);
        return rowOf(row);
      },
    }),
  ] as const;
}
