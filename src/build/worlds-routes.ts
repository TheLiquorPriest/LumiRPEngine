// Build's editor on RPE's own typed routes (plan §4.4, §14; PlanChatUI-B6): his worlds and their revisions, the draft, lint, commit, import
// and export, Things and a character in Build's scope, each over the world service (`src/worlds/service.ts`), in the route form
// (`src/app/routes.ts`). No body carries today's `lre`, `type` or `reqId`. A write to a draft names the draft version it read; one made
// on a draft that has moved on is not written and is answered with the draft as it now stands (`moved: true`). A commit the world's
// errors block is answered with them (`message` and `lint`), and its source is the agent's when the command line or the MCP server made
// it, Build's when a page did. Every route answers only for the user this RPE belongs to.

import { type CallAuth, route, RouteError, shape } from "../app";
import type { WorldCollection, WorldPart } from "../shared/world";
import type { WorldService } from "../worlds/service";
import { DraftMoved, type EditorResult, WorldError } from "../worlds/worlds";

const T = shape.text();
const field = shape.field;
const opt = shape.optional;
const N = shape.whole();

export const WORLDS_PATH = "/api/v1/worlds";
export const WORLD_PATH = "/api/v1/worlds/:world";
export const DRAFT_PATH = "/api/v1/worlds/:world/draft";

const lintIssue = shape.named(
  "WorldLintIssue",
  "One thing the lint found in a world: its severity, where in the document, a code, the words, and a fix Problems offers in one press (its label and the draft patch that does it).",
  shape.object({
    severity: field(shape.oneOf("error", "warning", "info"), "How serious it is."),
    path: field(T, "Where in the document, e.g. `entities.npc_dev.fields.cash`."),
    code: field(T, "What kind of finding it is."),
    message: field(T, "The words."),
    fix: opt(shape.object({ label: field(T, "What the fix does."), ops: field(shape.json(), "The draft patch (a list of RFC 6902 operations) that does it.") }), "A fix Problems offers in one press."),
  }),
);
const lintList = shape.list(lintIssue);

const worldIndex = shape.named(
  "WorldIndexRow",
  "One of his worlds: its id and name, its head revision and every revision, and where its working copy's count stands.",
  shape.object({
    id: field(T, "The world's id."),
    name: field(T, "Its name."),
    head: field(T, "Its head revision."),
    loreBookId: field(shape.nullable(T), "The World Info book an earlier build kept for it; null for none."),
    revisions: field(shape.list(T), "Every revision, oldest first."),
    draftVersion: opt(N, "The count of its working copy while no draft is stored."),
  }),
);

const revisionNote = shape.named(
  "WorldRevisionNote",
  "How a revision became the head: when, what made it (a new world, a commit from Build or from an outside agent, an import) and the note given with the commit.",
  shape.object({ revision: field(T, "The revision."), at: field(shape.number(), "When, in ms since 1970."), source: field(shape.oneOf("create", "build", "agent", "import"), "What made it head."), note: opt(T, "The commit's note.") }),
);

const worldRead = shape.named(
  "WorldRead",
  "A world at a revision: its document, which revision that is, how each revision became head, and what the packs give the editors (the kinds and relations they bring and the formula functions).",
  shape.object({
    world: field(shape.json(), "The world document."),
    revision: field(T, "The revision it is."),
    history: field(shape.list(revisionNote), "How each revision became head, oldest first."),
    packKinds: field(shape.json(), "The kinds the packs bring, by id."),
    packRelations: field(shape.json(), "The relation types the packs bring, by id."),
    functions: field(shape.list(T), "The formula functions."),
  }),
);

const created = shape.named("WorldCreated", "A new world as made, and its first revision.", shape.object({ world: field(shape.json(), "The world document."), revision: field(T, "Its first revision.") }));
const imported = shape.named(
  "WorldImported",
  "A world file brought in as a new world, its first revision, and the macros in it to review before playing it.",
  shape.object({ world: field(shape.json(), "The world document."), revision: field(T, "Its first revision."), lint: field(lintList, "The macros to review, as warnings.") }),
);
const committed = shape.named(
  "WorldCommitted",
  "The draft as the world's next revision. Where the world's errors block it, `revision` is null and `message` and `lint` say what blocks.",
  shape.object({ revision: field(shape.nullable(T), "The new revision; null where it was not made."), lint: field(lintList, "The lint of the committed world, or what blocks."), message: field(shape.nullable(T), "Why it was not made; null where it was.") }),
);
const revisionRow = shape.named(
  "WorldRevisionRow",
  "One revision of a world as its history lists it: when it became head and what made it, its note, how many things it changed against the revision before it, whether it is the head now, and the chats that play it.",
  shape.object({
    revision: field(T, "The revision."),
    at: opt(shape.number(), "When it became head, in ms since 1970; left out for a revision that became head before the world kept a history."),
    source: opt(shape.oneOf("create", "build", "agent", "import"), "What made it head."),
    note: opt(T, "The note given with the commit."),
    head: field(shape.yesNo(), "It is the world's head now."),
    changed: field(shape.nullable(N), "How many things it changed against the revision before it; null for the world's first revision, and for one whose file is gone."),
    chats: field(shape.list(shape.object({ chat: field(T, "The chat's id."), name: field(T, "Its name in Lumiverse; its id where Lumiverse gives none.") })), "The chats that play it now."),
  }),
);
const worldChanges = shape.named(
  "WorldChanges",
  "What changed from one version of a world to another, part by part.",
  shape.object({
    from: field(T, "The revision it is compared against."),
    to: field(shape.nullable(T), "The revision it is compared to; null for the draft."),
    total: field(N, "How many things changed in all."),
    parts: field(
      shape.list(
        shape.object({
          part: field(T, "The collection (`entities`, `places`…) or the part (`calendar`, `ruleset`…) of the world's document."),
          added: field(N, "Things added."),
          changed: field(N, "Things changed."),
          removed: field(N, "Things removed."),
          things: field(shape.list(shape.object({ id: field(T, "Its id."), name: field(shape.nullable(T), "Its name; null where it has none."), kind: field(shape.oneOf("added", "changed", "removed"), "How it changed.") })), "The first things the part changed, named; none for a part that holds no things of its own (the calendar)."),
          more: field(N, "How many more changed than are named."),
        }),
      ),
      "Each part that changed, in the order of the document.",
    ),
  }),
);
const draftReply = shape.named(
  "WorldDraft",
  "A world's draft as it stands after the call, with its lint, the revision it began from, whether one is stored and its version. `moved` is true where the write named a version the draft was no longer at: nothing was written, and this is the draft as it now stands.",
  shape.object({
    draft: field(shape.json(), "The draft document."),
    lint: field(lintList, "Its lint."),
    base: field(shape.nullable(T), "The revision the draft began from."),
    stored: field(shape.yesNo(), "Whether a draft is stored (else it is the head)."),
    version: field(N, "The draft's version."),
    moved: field(shape.yesNo(), "The draft had moved on: this is what is there now and nothing of the write was kept."),
  }),
);

/** The status each kind of the world service's refusal answers with. */
const STATUS: Readonly<Record<WorldError["code"], number>> = { not_found: 404, conflict: 409, validation: 422, bad_request: 400 };

/** A refusal of the world service as a route's: its status and its words, the first findings of the lint added to them. */
export function refusalOf(error: unknown): never {
  if (!(error instanceof WorldError)) throw error;
  const found = error.lint.filter((i) => i.severity === "error").slice(0, 3);
  throw new RouteError(STATUS[error.code], found.length === 0 ? error.message : `${error.message}: ${found.map((i) => i.message).join("; ")}`);
}

async function guarded<A>(work: () => Promise<A>): Promise<A> {
  try {
    return await work();
  } catch (error) {
    return refusalOf(error);
  }
}

/** A draft write's answer: the draft as it stands, or where the write found it moved, the draft as it now stands. */
async function drafted(work: () => Promise<EditorResult>): Promise<EditorResult & { moved: boolean }> {
  try {
    return { ...(await work()), moved: false };
  } catch (error) {
    if (error instanceof DraftMoved) return { ...error.current, moved: true };
    return refusalOf(error);
  }
}

/** Who made a commit: the agent where the command line or the MCP server did, Build where a page did. */
export function sourceOf(auth: CallAuth): "build" | "agent" {
  return auth.listener === "command" || auth.credential?.madeBy === "command line" || auth.credential?.madeBy === "mcp server" ? "agent" : "build";
}

const writeBase = { base: field(shape.nullable(T), "The revision the draft began from, as the writer read it; null for none."), version: opt(N, "The draft version the writer read; a write on another version is not written.") };

/** What the draft's writes take of the caller, apart from the write itself. */
function by(body: { base: string | null; version?: number }): { base: string | null; version?: number } {
  return { base: body.base, ...(body.version !== undefined ? { version: body.version } : {}) };
}

/** `bodyBytes` is `worlds.maxBodyBytes`: the largest body a route that takes one answers. */
export function worldsRoutes(service: WorldService, bodyBytes: number) {
  return [
    route({ method: "GET", path: WORLDS_PATH, access: "page", group: "worlds", does: "His worlds, by name.", reply: shape.object({ worlds: shape.list(worldIndex) }), handle: async ({ user }) => ({ worlds: await service.list(user) }) }),
    route({
      method: "GET",
      path: `${WORLDS_PATH}/templates`,
      access: "page",
      group: "worlds",
      does: "The starter worlds a new world can be made from.",
      reply: shape.object({ templates: shape.list(shape.object({ id: field(T, "The starter's id."), name: field(T, "Its name."), summary: field(T, "What it holds.") })) }),
      handle: () => ({ templates: service.templates() }),
    }),
    route({
      method: "POST",
      path: WORLDS_PATH,
      access: "page",
      group: "worlds",
      does: "A new world, from a starter or blank.",
      maxBody: bodyBytes,
      body: shape.object({ name: field(T, "Its name."), template: field(shape.nullable(T), "The starter's id; null for a blank world.") }),
      reply: created,
      handle: ({ body, user }) => guarded(async () => (await service.create(user, body.name, body.template)) as never),
    }),
    route({
      method: "POST",
      path: `${WORLDS_PATH}/import`,
      access: "page",
      group: "worlds",
      does: "A world file brought in as a new world; the macros in its lore and templates come back as warnings to review before playing it.",
      maxBody: bodyBytes,
      long: true,
      body: shape.object({ file: field(shape.json(), "The exported world file, or a world document.") }),
      reply: imported,
      handle: ({ body, user }) => guarded(async () => (await service.importFile(user, body.file)) as never),
    }),
    route({
      method: "GET",
      path: WORLD_PATH,
      access: "page",
      group: "worlds",
      does: "A world at a revision (its head by default), with how each revision became head and what the packs give the editors.",
      query: { revision: opt(T, "A revision of the world; its head by default.") },
      reply: worldRead,
      handle: ({ params, query, user }) => guarded(async () => (await service.read(user, params.world, query.revision)) as never),
    }),
    route({
      method: "DELETE",
      path: WORLD_PATH,
      access: "page",
      group: "worlds",
      does: "A world gone, with every revision, its draft and its history; his worlds as they stand after.",
      reply: shape.object({ worlds: shape.list(worldIndex) }),
      handle: ({ params, user }) => guarded(async () => ({ worlds: (await service.remove(user, params.world)) as never })),
    }),
    route({
      method: "GET",
      path: `${WORLD_PATH}/export`,
      access: "page",
      group: "worlds",
      does: "A world at a revision as an export file.",
      query: { revision: opt(T, "A revision of the world; its head by default.") },
      reply: shape.object({ file: field(shape.json(), "The export file.") }),
      handle: ({ params, query, user }) => guarded(async () => ({ file: await service.exportFile(user, params.world, query.revision) })),
    }),
    route({
      method: "GET",
      path: `${WORLD_PATH}/lint`,
      access: "page",
      group: "worlds",
      does: "The lint of a world at a revision (its head by default).",
      query: { revision: opt(T, "A revision of the world; its head by default.") },
      reply: shape.object({ lint: lintList }),
      handle: ({ params, query, user }) => guarded(async () => ({ lint: (await service.lint(user, params.world, query.revision)) as never })),
    }),
    route({
      method: "POST",
      path: `${WORLD_PATH}/sheet`,
      access: "page",
      group: "worlds",
      does: "The Sheet Designer's live preview: the draft with an unsaved ruleset in place of its own, read on an entity (the point of view by default) as a new chat would start; nothing is saved.",
      maxBody: bodyBytes,
      body: shape.object({ ruleset: field(shape.json(), "The unsaved ruleset."), entity: opt(T, "The entity to read the sheet on.") }),
      reply: shape.object({ sheet: field(shape.json(), "The sheet's sections; null where the world has none."), skills: field(shape.json(), "The skills it shows.") }),
      handle: ({ params, body, user }) =>
        guarded(async () => {
          const previewed = await service.sheet(user, params.world, body.ruleset, body.entity);
          return { sheet: (previewed.sheet ?? null) as never, skills: (previewed.skills ?? []) as never };
        }),
    }),
    route({
      method: "GET",
      path: `${WORLD_PATH}/updates`,
      access: "page",
      group: "worlds",
      does: "The data tables this build ships newer than the world's copies, for its draft or one of its revisions.",
      query: { revision: opt(T, "A revision of the world; its draft by default.") },
      reply: shape.object({ updates: field(shape.json(), "Each table with a newer shipped version, as Data updates lists it.") }),
      handle: ({ params, query, user }) => guarded(async () => ({ updates: (await service.updates(user, params.world, query.revision)) as never })),
    }),
    route({
      method: "POST",
      path: `${WORLD_PATH}/commit`,
      access: "page",
      group: "worlds",
      does: "The draft as the world's next revision, with its note; one made on a draft that has moved on, or on a head that has, is refused. The source is the agent's where the command line or the MCP server made it, Build's where a page did.",
      long: true,
      body: shape.object({ base: field(shape.nullable(T), "The revision the draft began from; null to skip the check."), note: opt(T, "The note the history keeps."), version: opt(N, "The draft version the writer read.") }),
      reply: committed,
      handle: async ({ params, body, user, auth }) => {
        try {
          const made = await service.commit(user, params.world, { base: body.base, source: sourceOf(auth), ...(body.note !== undefined ? { note: body.note } : {}), ...(body.version !== undefined ? { version: body.version } : {}) });
          return { revision: made.revision, lint: made.lint as never, message: null };
        } catch (error) {
          // The world's errors block it: the answer says what blocks, as a fault of the draft and not as a failure.
          if (error instanceof WorldError && error.code === "validation" && error.lint.length > 0) return { revision: null, lint: error.lint as never, message: error.message };
          if (error instanceof DraftMoved) throw new RouteError(409, error.message);
          return refusalOf(error);
        }
      },
    }),
    // ---------------------------------------------------------------- the history
    route({
      method: "GET",
      path: `${WORLD_PATH}/revisions`,
      access: "page",
      group: "worlds",
      does: "A page of the world's revisions, newest first: when each became head and what made it, the note given with it, how many things it changed against the revision before it, and the chats that play it now. The settings `worlds.revisionsPage` and `worlds.maxRevisionsPage` give a page's length.",
      reply: shape.page(revisionRow),
      paged: {
        sizes: async () => {
          const limits = await service.limits();
          return { default: limits.revisionsPage, most: limits.revisionsPageMost };
        },
      },
      handle: ({ params, query, user }) => guarded(async () => (await service.revisions(user, params.world, { limit: query.limit, ...(query.after === undefined ? {} : { after: query.after }) })) as never),
    }),
    route({
      method: "GET",
      path: `${WORLD_PATH}/changes`,
      access: "page",
      group: "worlds",
      does: "What changed from one version of a world to another, part by part: for each part how many things were added, changed and removed, and the first of them named (the setting `worlds.maxChangesListed` says how many). From the world's head to its draft by default.",
      query: { from: opt(T, "A revision of the world to compare against; its head by default."), to: opt(T, "A revision of the world to compare; its draft by default.") },
      reply: worldChanges,
      handle: ({ params, query, user }) => guarded(async () => (await service.changes(user, params.world, query.from, query.to)) as never),
    }),
    // ---------------------------------------------------------------- the draft
    route({ method: "GET", path: DRAFT_PATH, access: "page", group: "worlds", does: "A world's draft as it stands (the head while none is stored), with its lint, base and version.", reply: draftReply, handle: ({ params, user }) => drafted(() => service.draft(user, params.world, { op: "get" })) as never }),
    route({
      method: "POST",
      path: `${DRAFT_PATH}/discard`,
      access: "page",
      group: "worlds",
      does: "Discards the stored draft: the world goes back to its head.",
      body: shape.object({ version: opt(N, "The draft version the writer read.") }),
      reply: draftReply,
      handle: ({ params, body, user }) => drafted(() => service.draft(user, params.world, { op: "discard" }, body.version !== undefined ? { version: body.version } : {})) as never,
    }),
    route({
      method: "PUT",
      path: `${DRAFT_PATH}/items/:collection/:id`,
      access: "page",
      group: "worlds",
      does: "Puts one item of a collection into the draft (a new one without its id takes its key); what a map draws is edited in its map.",
      maxBody: bodyBytes,
      body: shape.object({ value: field(shape.json(), "The item."), ...writeBase }),
      reply: draftReply,
      handle: ({ params, body, user }) => drafted(() => service.draft(user, params.world, { op: "put", collection: params.collection as WorldCollection, id: params.id, value: body.value }, by(body))) as never,
    }),
    route({
      method: "DELETE",
      path: `${DRAFT_PATH}/items/:collection/:id`,
      access: "page",
      group: "worlds",
      does: "Takes one item of a collection out of the draft.",
      query: { base: opt(T, "The revision the draft began from, as the writer read it."), version: opt(N, "The draft version the writer read.") },
      reply: draftReply,
      handle: ({ params, query, user }) => drafted(() => service.draft(user, params.world, { op: "remove", collection: params.collection as WorldCollection, id: params.id }, by({ base: query.base ?? null, ...(query.version !== undefined ? { version: query.version } : {}) }))) as never,
    }),
    route({
      method: "PUT",
      path: `${DRAFT_PATH}/parts/:part`,
      access: "page",
      group: "worlds",
      does: "Sets one part of the draft (the world's name and start, its calendar, its ruleset, its tiers, its minds, its lookup table…) whole, as its editor sends it.",
      maxBody: bodyBytes,
      body: shape.object({ value: field(shape.json(), "The part."), ...writeBase }),
      reply: draftReply,
      handle: ({ params, body, user }) => drafted(() => service.draft(user, params.world, { op: "set", part: params.part as WorldPart, value: body.value }, by(body))) as never,
    }),
    route({
      method: "POST",
      path: `${DRAFT_PATH}/profile`,
      access: "page",
      group: "worlds",
      does: "Brings a ruleset profile into the draft in one write, each choice taking the author's own or the profile's.",
      body: shape.object({ profile: field(T, "The profile's id."), choices: field(shape.record(shape.oneOf("mine", "profile")), "For each part both have, whose to keep."), ...writeBase }),
      reply: draftReply,
      handle: ({ params, body, user }) => drafted(() => service.draft(user, params.world, { op: "profile", profile: body.profile, choices: body.choices }, by(body))) as never,
    }),
    route({
      method: "POST",
      path: `${DRAFT_PATH}/patch`,
      access: "page",
      group: "worlds",
      does: "Applies an RFC 6902 patch to the draft, all of it or none; at most `worlds.maxPatchOps` operations bringing in at most `worlds.maxPatchChars`.",
      maxBody: bodyBytes,
      body: shape.object({ ops: field(shape.json(), "The operations."), ...writeBase }),
      reply: draftReply,
      handle: ({ params, body, user }) => drafted(() => service.draft(user, params.world, { op: "patch", ops: body.ops as never }, by(body))) as never,
    }),
    route({
      method: "POST",
      path: `${DRAFT_PATH}/restore`,
      access: "page",
      group: "worlds",
      does: "Puts a copy of one of the world's revisions into the draft; committing it makes that content the head again.",
      body: shape.object({ revision: field(T, "The revision to restore."), ...writeBase }),
      reply: draftReply,
      handle: ({ params, body, user }) => drafted(() => service.draft(user, params.world, { op: "restore", revision: body.revision }, by(body))) as never,
    }),
    route({
      method: "POST",
      path: `${DRAFT_PATH}/shipped`,
      access: "page",
      group: "worlds",
      does: "Takes the version this build ships of each named data table into the draft.",
      body: shape.object({ tables: field(shape.list(T), "The tables to take."), ...writeBase }),
      reply: draftReply,
      handle: ({ params, body, user }) => drafted(() => service.draft(user, params.world, { op: "shipped", tables: body.tables }, by(body))) as never,
    }),
    // ---------------------------------------------------------------- Things and a character, in the draft's scope
    route({
      method: "GET",
      path: `${WORLD_PATH}/things`,
      access: "page",
      group: "worlds",
      does: "Every thing of the draft as a chat would start from it, with its size, where it is and whose it is, and the same by owner. A draft whose calendar or start does not read is refused naming which.",
      reply: shape.json(),
      handle: ({ params, user }) => guarded(async () => (await service.things(user, params.world, { op: "list" })) as never),
    }),
    route({
      method: "GET",
      path: `${WORLD_PATH}/things/types`,
      access: "page",
      group: "worlds",
      does: "The catalog's types of thing with the sizes they give.",
      reply: shape.json(),
      handle: ({ params, user }) => guarded(async () => (await service.things(user, params.world, { op: "types" })) as never),
    }),
    route({
      method: "GET",
      path: `${WORLD_PATH}/things/find`,
      access: "page",
      group: "worlds",
      does: "The things and people whose names words name, or start with.",
      query: { words: field(T, "The words to find.") },
      reply: shape.json(),
      handle: ({ params, query, user }) => guarded(async () => (await service.things(user, params.world, { op: "find", words: query.words })) as never),
    }),
    route({
      method: "GET",
      path: `${WORLD_PATH}/things/:entity`,
      access: "page",
      group: "worlds",
      does: "One thing's page: where it is kept, who may use it and what it holds.",
      reply: shape.json(),
      handle: ({ params, user }) => guarded(async () => (await service.things(user, params.world, { op: "thing", entity: params.entity })) as never),
    }),
    route({
      method: "GET",
      path: `${WORLD_PATH}/people/:entity/things`,
      access: "page",
      group: "worlds",
      does: "A person's things, in the Character page's groups.",
      reply: shape.json(),
      handle: ({ params, user }) => guarded(async () => (await service.things(user, params.world, { op: "person", entity: params.entity })) as never),
    }),
    route({
      method: "GET",
      path: `${WORLD_PATH}/characters/:entity`,
      access: "page",
      group: "worlds",
      does: "A character as its own model, from the world's draft.",
      reply: shape.json(),
      handle: ({ params, user }) => guarded(async () => (await service.character(user, params.world, params.entity)) as never),
    }),
  ] as const;
}
