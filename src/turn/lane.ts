// RPE as RPH's host: the `Environment`, assembled from one port per area, and the harness built over
// it, with the turn lane that plays each tagged reply. What each port is, and who gives it:
//
//   files    the tree (`src/tree/`)                 prompt   this lane: the layout each request carried, maps by preset
//   chat     the adapter's chat port                lore     the lore lane's `Lore`, through its port; its index, its tool
//                                                            (`lore_index_write`) and the next batch given by name (`index:batch`)
//   tools    the engine's (`src/iface/`), the cast's (`src/cast/`) and the story's (`src/story/`), each
//            worded by its file in force for the chat, each writing through the write queue under the
//            environment's approvals
//   facts    a registry each area adds to; this lane's own counts are in it
//   models   the app's connections                  store    this lane: `kv` in RPE's database
//   trace    the live hub and the turn's folder     events   this lane: kept with the turn; the turn's own views,
//                                                            a host's and the cast's given by name
//   clock    the machine's                          log      the app's
//
// Left out, as the contract allows: `stores` (RPE reaches no store but its own). `approvals` is this lane's (`approvals.ts`: each lane Auto,
// Confirm or Never as he set it for the chat, and the questions a Confirm waits on, kept with the turn's card). `switches` is the app's
// registry (`src/app/switches.ts`): RPH asks it, for the run's user, before anything that runs a command or calls out, and before a
// provider key goes to a connection whose place changed.

import { join } from "node:path";
import { createHarness, type CreateHarnessOptions } from "rp-harness";
import { SETTINGS as RPH_SETTINGS } from "rp-harness/helpers";
import { type LinesPart, loadGuidance } from "../app/guidance";
import type { AgentRef, AttachMoment, Clock, Environment, GapQuery, Harness, HostTool, JsonValue, RunScope, Scope, StoresPort, UserScope, UserSessionScope } from "rp-harness/contract";
import type { ChatReads } from "../adapter/lumiverse/chat";
import { forkOf } from "../adapter/lumiverse/events";
import type { Hints } from "../adapter/lumiverse/hint";
import type { IndexFeed } from "../adapter/lumiverse/index-feed";
import type { LumiverseReads } from "../adapter/lumiverse/reads";
import type { Stores } from "../adapter/lumiverse/stores";
import type { Writes as LumiverseWrites } from "../adapter/lumiverse/writes";
import { type App, LIVE_JOBS, RouteError } from "../app";
import { portTexts, readConfig } from "../app/config-read";
import { type BookReader, CAST_PLAYER_MIND, castFacts, CastRecord, castTools, chatLine, findCharacter, MemorySearch, playerMindOf, type SourceReader } from "../cast";
import { castAt } from "../cast/path";
import { charactersOf } from "../cast/record";
import { holdersOf } from "../quests/holders";
import { createRegistry } from "../engine/registry-impl";
import { engineTools, gridMoves, mapView, mapWording } from "../iface";
import type { CarriedPort, EngineDeps, LastUseKeeper } from "../iface/kit";
import { indexedSearch } from "../iface/search";
import { bindingsInForce, EntryNumbers, Lore, type LoreBooks, LoreIndex, LORE_INDEX_SETTING_DEFS, LORE_SETTINGS, LoreProjection, type LoreProposals, type LoreScope, loreLines, lorePort, loreSettingsFor, loreTools, overlayCheck, type ProjectionBooks, secretIds, secretMarkLines, type SecretSettingsFor, secretSettingsFor, storedBindings, storePath, storeWorlds } from "../lore";
import type { CastKnowledge, PlaceSourcesReader } from "../places";
import { madeOf } from "../lore/made";
import { ALL_PACKS } from "../packs/index";
import { MeaningIndex } from "../search/meaning";
import { hashJson } from "../shared/hash";
import { type ChatRow, openStore, STATE_SEARCH_SETTING_DEFS, StateIndex, type Store, STORE_SETTING_DEFS, storedWorlds, timeDue, WORLD_DOCS_SETTING_DEFS } from "../store";
import type { StoreFailure } from "../store/store";
import type { FoldJob, StoreBrief } from "../store/away";
import { STORY_FACT_SETTING_DEFS, storyFacts, storyTools } from "../story";
import { type ChatFolders, chatPlacer, CHATS_FOLDER, GeneratedFiles, NO_CHAT, promptMapFields, pruneChat, retentionOf, TreeChats, type TreeFiles, treeFiles, TreeNotes, TreeSuggestions, turnFolderName } from "../tree";
import { Approvals } from "./approvals";
import { type EventsDeps, givenViews, turnEvents } from "./events";
import { FactsRegistry, turnFacts } from "./facts";
import { JOB_KIND } from "./jobs";
import { kvStore, servedUser, storeUsers, type Writes } from "./kv";
import { PROMPT_MAP_FILE, PROMPT_MAP_FILENAME, type TurnPrompts, turnPrompts } from "./prompt";
import { TurnMarks } from "./marks";
import { FOLDER_KIND } from "./live-routes";
import { Requests, REQUESTS_KIND } from "./requests";
import { Runs } from "./runs";
import { stateSearcher, storySearcher } from "./searchers";
import { webSearcher } from "./web";
import { STORE_AREAS } from "./store-areas";
import { RunTimes } from "./spans";
import { globalConfig, turnSettings } from "./settings";
import { SinceKept } from "./since";
import { stagesAt } from "./stage";
import { guidanceTexts } from "./texts";
import { type TurnTrace, turnTrace } from "./trace";
import { type MigratedSource, NO_SESSION, turnErrorWords, TurnLane } from "./turns";

/**
 * RPE's file port for the one user it serves, that user read each time the port is asked, since it may
 * be set after the lane is built: before one is set every call is refused, and the tree's own port
 * refuses a scope of anyone else, an empty user's included. A pattern that parses is never refused for
 * being slow (R-55): the tree's grep stops a slow one itself, under `files.grepMs`. Each file written
 * is told to `written`, so a turn's folder growing is told live.
 */
function servedFiles(owner: () => string | null, make: (user: string) => TreeFiles, written: (scope: Scope | UserScope, path: string) => void): TreeFiles {
  let made: { user: string; files: TreeFiles } | null = null;
  const now = (): TreeFiles => {
    const user = servedUser(owner);
    if (made === null || made.user !== user) made = { user, files: make(user) };
    return made.files;
  };
  return {
    layers: async (scope) => now().layers(scope),
    places: async (scope) => now().places(scope),
    read: async (scope, path, range) => now().read(scope, path, range),
    find: async (scope, query) => now().find(scope, query),
    write: async (scope, path, op, by) => {
      const out = await now().write(scope, path, op, by);
      if (out.status === "written") written(scope, out.path);
      return out;
    },
    update: async (scope, path, change) => {
      const out = await now().update(scope, path, change);
      if (out.status === "written") written(scope, out.path);
      return out;
    },
    turnDisk: async (scope) => now().turnDisk(scope),
    sessionDisk: async (scope) => now().sessionDisk(scope),
  };
}

/**
 * The harness, its jobs placing the chat a job is started in before it starts (`chatPlacer`), so a job started before the chat's first
 * message (the lore's indexing, the prompt's mapper, a bootstrap, the Jobs page's own form) has its chat's folder for its session, its
 * transcripts and the results it keeps; a chat Lumiverse does not have starts no job and is refused in words. A job of no chat places
 * nothing.
 */
function placingJobs(harness: Harness, place: (user: string, chat: string) => Promise<unknown>): Harness {
  const { jobs } = harness;
  return {
    ...harness,
    jobs: {
      list: (filter) => jobs.list(filter),
      get: (user, id) => jobs.get(user, id),
      switches: (user) => jobs.switches(user),
      start: async (scope, start) => {
        if ("chat" in scope && scope.chat !== NO_CHAT) await place(scope.user, scope.chat);
        return await jobs.start(scope, start);
      },
      cancel: (user, id) => jobs.cancel(user, id),
      setSwitches: (user, change) => jobs.setSwitches(user, change),
      hold: (user, id) => jobs.hold(user, id),
      letGo: (user, id) => jobs.letGo(user, id),
      again: (user, id) => jobs.again(user, id),
      carryOn: (user, id, more) => jobs.carryOn(user, id, more),
      resume: (user, id) => jobs.resume(user, id),
      answer: (user, id, answer) => jobs.answer(user, id, answer),
      tagCheck: (user, connection) => jobs.tagCheck(user, connection),
      tagChecks: (user) => jobs.tagChecks(user),
    },
  };
}

/** How RPE takes a chat on: its row in the store, and that and its folders. */
export interface ChatTaker {
  /** The chat's row, made the first time anything names the chat. */
  take(user: string, chat: string): Promise<ChatRow>;
  /** The chat taken on, and its folders, laid again should one have gone. */
  place(user: string, chat: string): Promise<ChatFolders>;
}

/**
 * The one way RPE takes a chat on (plan §4.2: "A reply in a chat RPE has never seen: the chat is created on the spot. Nothing has to be
 * prepared first"): whatever names the chat first (a page's route, its first turn, a job started in it, a write at its levels) makes its
 * row in the store by what Lumiverse says of it, a branch sharing the tree of the chat it was made from where RPE holds that one, and
 * its folders by Lumiverse's names for it (`chatPlacer`). A chat the store holds is as it is, whether or not Lumiverse still has it. A
 * chat Lumiverse does not have is refused in words, and so is a chat RPE does not hold while it cannot reach Lumiverse to look it up.
 */
export function chatTaker(d: { store: Store; writes: Writes; chats: TreeChats; reads: () => LumiverseReads | null }): ChatTaker {
  const folders = chatPlacer(d.chats, d.reads);
  const take = async (user: string, chat: string): Promise<ChatRow> => {
    const store = d.store.user(user);
    const held = store.chat(chat);
    if (held !== null) return held;
    const reads = d.reads();
    if (reads === null) throw new RouteError(503, "RPE is not connected to Lumiverse, so it cannot look this chat up yet: try again once it is.");
    const lv = await reads.chat(chat);
    if (lv === null) throw new RouteError(404, "Lumiverse has no such chat of yours, so RPE holds nothing of it.");
    const fork = await forkOf(reads, chat);
    const at = lv.metadata.branch_at_message;
    await d.writes.run(() => {
      if (store.chat(chat) !== null) return;
      if (fork !== null && store.chat(fork.from) !== null) store.branchChat({ id: chat, from: fork.from, map: fork.ids, at: typeof at === "string" ? at : null });
      else store.createChat({ id: chat });
    }, "taking a chat on");
    await folders(user, chat);
    return store.chat(chat) as ChatRow;
  };
  return {
    take,
    place: async (user, chat) => {
      await take(user, chat);
      return await folders(user, chat);
    },
  };
}

/**
 * A character's sources as Lumiverse holds them now (the cast's `SourceReader`): a card or a persona
 * through the adapter's reads, a lore entry through the lore, a memory entity through the adapter's
 * stores, each with a revision that changes whenever its text does: an entry's is the lore's own
 * (the one the catalog, `lore_read` and the index give), a memory entity's Lumiverse's own. A memory
 * entity is a chat's, so a job of no chat finds none. A read that cannot be made fails in the words
 * of the turn-errors part in force for the chat.
 */
function liveSources(lumiverse: () => { reads: LumiverseReads; stores: Stores } | null, lore: Lore, files: TreeFiles): SourceReader {
  const parts = async (scope: { user: string; chat: string }): Promise<{ reads: LumiverseReads; stores: Stores }> => {
    const now = lumiverse();
    if (now === null) throw new Error(await turnErrorWords(files, scope, "no_lumiverse_sources"));
    return now;
  };
  return async (scope, source) => {
    switch (source.kind) {
      case "entry": {
        const [entry] = await lore.read({ user: scope.user, chat: scope.chat }, [source.ref]);
        if (entry === undefined) return null;
        if (entry.revision === undefined) throw new Error(`The lore gave no revision for ${source.ref}.`);
        return { title: entry.title, revision: entry.revision };
      }
      case "card": {
        const card = await (await parts(scope)).reads.character(source.ref);
        return card === null ? null : { title: card.name, revision: hashJson([card.name, card.description, card.personality, card.scenario, card.firstMessage, card.exampleMessages, card.systemPrompt, card.postHistoryInstructions]) };
      }
      case "persona": {
        const persona = await (await parts(scope)).reads.persona(source.ref);
        return persona === null ? null : { title: persona.name, revision: hashJson([persona.name, persona.title, persona.description]) };
      }
      case "memory": {
        const { stores } = await parts(scope);
        if (scope.chat === "") return null;
        const entity = await stores.entity(scope.chat, source.ref);
        return entity === null ? null : { title: entity.name, revision: String(entity.revision) };
      }
    }
  };
}

/**
 * A Lumiverse book entry's text as its book holds it, its secret marks in it (the cast's `BookReader`, for a secret a book marks), read
 * through the lore's reader of the user's books: only of a book the chat has attached, as Lumiverse scans them for it, so a secret is
 * read from no book the chat does not have. Null when the chat has no such book, or the book no such entry.
 */
function bookTexts(books: LoreBooks): BookReader {
  return async ({ user, chat }, book, entry) => {
    if (!(await books.attached(user, chat)).includes(book)) return null;
    const found = await books.entry(user, entry);
    return found === null || found.book !== book ? null : found.content;
  };
}

/** The machine's clock. */
export const MACHINE_CLOCK: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as Timer),
};

/**
 * RPE's store over the application's database: the shipped packs' handlers fold its changes, a chat on a
 * real world folds over the revision's document the store keeps, and its snapshots are this build's. A
 * handler that throws is an error in the engine, not in the story: its text goes to the log, and to the
 * live view of the chat whose change failed, with the turn and the change, and of no other chat, whether
 * or not a run goes on there; the change's report, all a model is shown, says only that it failed. Its
 * limits are the global level's settings, read once: the store is made once for every chat.
 */
export function openAppStore(app: Pick<App, "db" | "version" | "log" | "live" | "paths" | "workers">): Store {
  const handlerFailed = (failure: StoreFailure): void => {
    const { op, chat, turn, change, user } = failure;
    const error = failure.error instanceof Error ? failure.error.message : String(failure.error);
    app.log.error("An engine handler failed on a change, which is recorded as not applied.", { op, error, user, chat: chat ?? null, turn, change });
    if (chat !== undefined) app.live.publish(chat, { kind: "handler_failed", data: { op, error, turn, change } });
  };
  const global = globalConfig(app.paths.files, app.log);
  const worlds = storedWorlds(app.db, global.numbers(WORLD_DOCS_SETTING_DEFS));
  // A walk the store's settings cut short (`engine.maxKindChain`, `maxHolderDepth`, `places.maxVisitDepth`) is logged, once for each chain.
  // A fold over more changes than `store.workerFoldAt` runs on a worker thread, which reads the same file and folds with the same areas (`workers/tasks.ts`).
  const away = { path: app.paths.database, run: (brief: StoreBrief, job: FoldJob) => app.workers.run("fold", { brief, job }) };
  return openStore({ db: app.db, registry: createRegistry(ALL_PACKS), worlds, fingerprint: app.version, handlerFailed, log: (message, data) => app.log.warn(message, data as Record<string, JsonValue>), areas: STORE_AREAS, away, ...global.numbers(STORE_SETTING_DEFS) });
}

export interface TurnsOptions {
  store: Store;
  /**
   * The adapter's reads of Lumiverse, its chat port, and Lumiverse's Stop of one generation of the
   * user's (false when it was not going on), the search index's feed the lore searches books by, the
   * names of a chat's prompt's blocks found since a turn's layout was made (`Hints`), and the door's
   * writes a turn's end makes (the empty reply it staged, taken away); null before it is mounted, or
   * when RPE is not set up for a Lumiverse.
   */
  lumiverse(): { reads: LumiverseReads; chat: ChatReads; stores: Stores; stopGeneration(generation: string): Promise<boolean>; feed?: Pick<IndexFeed, "foundEntries">; hints?: Pick<Hints, "named">; writes?: Pick<LumiverseWrites, "dropEmptyReply"> } | null;
  /** The user's books, as the lore reads them. */
  books: LoreBooks;
  /** What a migration carried of a chat, for its first briefing on RPE. */
  migrated: MigratedSource;
  /** The lore's proposals, where an agent's suggestion about lore is kept for his approval. */
  proposals: () => Pick<LoreProposals, "suggested">;
  /** What RPE writes to his books for the projection book (`lore.projection`), through the door's writes. */
  projectionBooks: ProjectionBooks;
  /** A view of the host's that an agent is given by name, beyond the turn's own (a job of no chat's too): its text; null for a name that is none of its own. */
  views?: (scope: RunScope, agent: AgentRef, ref: string) => Promise<string | null>;
  /** The host's tools for a job of no chat (C-23: Build's model jobs); none where absent. */
  jobTools?: (scope: UserSessionScope) => Promise<HostTool[]>;
  /** In tests: the models agents run on, in place of the model layer's, and RPH's ids. */
  harness?: Pick<CreateHarnessOptions, "models" | "ids">;
  clock?: Clock;
  /** A migrated turn's record as the old engine kept it, which the agents read (supplied by the composition from the migration's records). */
  carried?: CarriedPort;
  /** The world service Build's routes call, for the agents' world tools (supplied by the composition). */
  worlds?: NonNullable<EngineDeps["worlds"]>;
}

/** Everything the turn lane made, for the composition and the routes. */
export interface Turns {
  lane: TurnLane;
  store: Store;
  harness: Harness;
  env: Environment;
  facts: FactsRegistry;
  files: TreeFiles;
  /** The tree's record of where each chat's folders are; `place` is the one way a chat gets them (`chatTaker`), by whatever writes at its levels first. */
  chats: TreeChats;
  /** The one way RPE takes a chat on, by whatever names it first (`chatTaker`): its row in the store, and with `place` its folders too. */
  take: ChatTaker["take"];
  place: ChatTaker["place"];
  prompts: TurnPrompts;
  runs: Runs;
  /** What he asks for beside his words, waiting or kept with the turn that answered it. */
  requests: Requests;
  /** The one home of the decision whether a write goes ahead, and the questions a lane set to Confirm waits on: what the card's routes read and answer. */
  approvals: Approvals;
  /** The application's write queue: what the routes that record something (an undo from the card) write through. */
  writes: App["writes"];
  /** The marks each turn carries apart from its run's status. */
  marks: TurnMarks;
  trace: TurnTrace;
  lore: Lore;
  /** A chat's secrecy settings, as the turn's start records them and the lore's secrecy lane reads them. */
  secretSettings: SecretSettingsFor;
  /** The words of the secrecy marks in force for a chat (`.prompts/secret-marks.md`); undefined where the part is off. */
  secretMarks: (at: LoreScope) => Promise<LinesPart | undefined>;
  /** The lore index: what indexing runs wrote of each entry of a chat's lore, beside what the database holds. */
  loreIndex: LoreIndex;
  /** The notes agents write, which follow the turn. */
  notes: TreeNotes;
  /** The suggestions agents file of the tree's files. */
  suggestions: TreeSuggestions;
  /** The projection book of each chat's world, kept in step with the story (`lore.projection`). */
  projection: LoreProjection;
  /** The vectors of search by meaning (plan §9.4, §10.5), in the index file: what a prune of a living chat's derived rows drops (`dropChat`). */
  meaning: MeaningIndex;
  /** A world search's index of tokens in the index file: what a prune of a living chat's derived rows forgets (`forget`). */
  stateIndex: StateIndex;
  /** What RPE gives by each name an agent is given, at a scope as a run's would be joined (`givenViews`): the resolver the turn uses, for the Agents page. */
  given(scope: Scope, agent: AgentRef, refs: readonly string[], moment: AttachMoment): Promise<{ ref: string; text: string | null }[]>;
  /** A character's sources as Lumiverse holds them now, the cast's reader: what the Cast page marks each bound source by. */
  sources: SourceReader;
  /** A place's lore as it is bound and as Lumiverse holds it now, the places' reader: what a place shows as its sources and a base is drawn against. */
  placeSources: PlaceSourcesReader;
  /** The cast as a place's or a quest's record reads it at a turn of the chat (the head where none is named): every character's items and names. */
  castKnowledge(user: string, chat: string, turn: string | null): CastKnowledge;
}

export function buildTurns(app: App, options: TurnsOptions): Turns {
  const owner = (): string | null => app.config.lumiverse.user;
  const clock = options.clock ?? MACHINE_CLOCK;
  const { store } = options;
  const chats = new TreeChats(app.db, app.writes, app.paths.files);
  // A chat is taken on by whatever names it first, by what Lumiverse says of it: its row in the store and its folders, by Lumiverse's own names.
  const { take, place } = chatTaker({ store, writes: app.writes, chats, reads: () => options.lumiverse()?.reads ?? null });
  const notes = new TreeNotes({ files: app.paths.files, db: app.db, writes: app.writes, chats });
  const suggestions = new TreeSuggestions({ db: app.db, writes: app.writes, now: () => clock.now(), limits: (user, chat) => chats.suggestionLimits(user, chat) });
  // A file written with a turn named is told on the chat's live socket, so the Live page shows the turn's folder as it is written.
  const files = servedFiles(
    owner,
    (user) =>
      treeFiles({
        files: app.paths.files,
        user,
        chats,
        place,
        // A grep's pattern runs on the worker pool, ended at `files.grepMs` even inside one line.
        workers: app.workers,
        async turnFolder(scope) {
          const turn = scope.turn === undefined ? null : store.user(scope.user).turn(scope.turn);
          return turn === null || turn.chat !== scope.chat ? null : turnFolderName(turn.depth + 1, turn.id);
        },
        writes: app.writes,
        now: () => clock.now(),
      }),
    (scope, path) => {
      if ("chat" in scope && scope.turn !== undefined) FOLDER_KIND.publish(app.live, scope.chat, { turn: scope.turn, path });
    },
  );
  // Each chat's PROMPT-MAP.md, laid out by the part `prompt-map-file` in force for the chat; switched off, none is written.
  const generated = new GeneratedFiles({ files: app.paths.files, chats });
  const prompts = turnPrompts(
    app.db,
    app.writes,
    () => clock.now(),
    async (user, chat, map, layout) => {
      const part = await loadGuidance(files, { user, chat, session: NO_SESSION }).part(PROMPT_MAP_FILE);
      if (part?.format !== "template") return;
      await generated.write(user, chat, PROMPT_MAP_FILENAME, `${part.render(promptMapFields(map, layout)).text.trim()}\n`);
    },
    app.log,
    (chat, layout, prompt) => options.lumiverse()?.hints?.named(chat, layout, prompt) ?? layout,
  );
  const runs = new Runs(app.db, app.writes);
  const requests = new Requests(app.db, app.writes, (chat, waiting) => REQUESTS_KIND.publish(app.live, chat, { waiting }));
  const marks = new TurnMarks(app.db, app.writes);
  const since = new SinceKept(app.db);
  const approvals = new Approvals({ db: app.db, writes: app.writes, files, log: app.log, now: () => clock.now() });
  // Search by meaning (plan §9.4, §10.5): one vector per lore entry, chat message, state thing and story item in the index file, made on
  // his embedding connection through the model layer; with none set, nothing is embedded and every search is by words alone.
  const meaning = new MeaningIndex({ index: app.index, embed: (user, texts) => harness.models.embed(user, texts) });
  // The lore may not reach the cast: a character's agent named by the cast's id is found in the world by the cast's name for it.
  const worlds = storeWorlds(store, (user, chat, said) => findCharacter(store.db, user, chatLine(store.user(user), chat), said)?.name ?? null);
  // What is made once for every chat takes its limits from the global level's settings, read once.
  const global = globalConfig(app.paths.files, app.log);
  // A world search's index of tokens in the index file (`store/search.ts`), following each chat's head as the store's writes change it.
  const stateIndex = new StateIndex({ store, index: app.index, log: (message) => app.log.warn(message), ...global.numbers(STATE_SEARCH_SETTING_DEFS) });
  store.onWrite((user, chats) => stateIndex.notify(user, chats));
  // A character's memories found by the words of a cue through the same index file (`cast/search.ts`), fed as they are searched.
  const memorySearch = new MemorySearch(app.index);
  // The lore's settings and lines are its chat's levels, read at no turn: a lore call that names a turn never carries it under a session it did not play in.
  const chatLevels = (at: LoreScope): Scope => ({ user: at.user, chat: at.chat, session: NO_SESSION });
  // The lore's settings for a chat, read once for the lore, its index and the secrecy a turn starts with.
  const config = async (at: LoreScope) => readConfig(await portTexts(files, chatLevels(at)), app.log, LORE_SETTINGS);
  const loreSettings = loreSettingsFor(config);
  const secretSettings = secretSettingsFor(config);
  // The lore-answers lines in force for the chat word the secrets in an entry's text when an agent reads it.
  // A library past `lore.workerCatalogueAt` entries has its catalogue made on a worker thread (`workers/tasks.ts`).
  // A lore search adds what is nearest in meaning where he has an embedding connection: each entry of the chat's catalogue its own vector,
  // its title and readable text embedded again when its revision changes.
  // The ids the lore shows a secret by (`e-112#2`, `w-31`) are the numbers of its entries: the cast reads them with the lore's own resolver.
  const entryNumbers = new EntryNumbers(app.db, app.writes);
  const secretFacts = secretIds({ numbers: entryNumbers, books: options.books });
  const lore = new Lore({
    books: options.books,
    worlds,
    turns: prompts.lore,
    numbers: entryNumbers,
    settingsFor: loreSettings,
    lines: (at) => loreLines(loadGuidance(files, chatLevels(at))),
    away: (input) => app.workers.run("catalogue", input),
    meaning: {
      find: (at, text, limit) =>
        meaning.nearest(at.user, at.chat, "lore", text, limit, async () => (await lore.catalog(at)).map((e) => ({ id: e.id, revision: hashJson([e.revision, e.title, e.text]), text: `${e.title}\n${e.text}` }))),
    },
  });
  // The index's readable file is written at the top of the chat's folder, worded by the lore's lines in force for the chat.
  const loreIndex = new LoreIndex({
    lore,
    db: app.db,
    writes: app.writes,
    path: storePath(store),
    settings: global.numbers(LORE_INDEX_SETTING_DEFS),
    file: {
      folder: (user, chat) => {
        const folders = chats.folders(user, chat);
        return folders === null ? null : join(app.paths.files, CHATS_FOLDER, folders.character, folders.chat);
      },
      lines: (at) => loreLines(loadGuidance(files, chatLevels(at))),
    },
    now: () => clock.now(),
    // His own index entry heading the index's file (`lore.index.entry`), read for the chat at each write.
    settingsFor: loreSettings,
    log: app.log,
    // A batch handed to a job is held for it while the job may still write it.
    jobRunning: async (user, job) => {
      const view = await harness.jobs.get(user, job);
      return view !== undefined && ["queued", "held", "running", "asking"].includes(view.state);
    },
  });
  // The projection book: the world's entries written to a book of his, after a run's reply and at every change of the path, when the
  // chat's `lore.projection` is on; with it off, a book made while it was on is taken away.
  const projection = new LoreProjection({
    db: app.db,
    writes: app.writes,
    lore,
    path: storePath(store),
    books: options.projectionBooks,
    enabled: async (user, chat) => (await loreSettings({ user, chat })).projection,
    made: madeOf({ store, lore }),
    lines: (at) => loreLines(loadGuidance(files, chatLevels(at))),
    now: () => clock.now(),
  });
  const overlay = overlayCheck(worlds);
  const facts = new FactsRegistry();
  facts.add(
    turnFacts(store, {
      runs: (user, turn) => runs.ofTurn(user, turn),
      stopped: (user, turn) => lane.stoppedAt(user, turn),
      story: async (scope) => {
        const s = await turnSettings(files, scope, app.log);
        return { from: s.storyFrom, newest: s.storyNewest };
      },
    }),
  );
  facts.add(loreIndex.facts());
  // The story's counts work out the history window as the prompt's is cut, on the chat's own settings.
  facts.add(storyFacts({ store, window: async (scope) => (await turnSettings(files, scope, app.log)).window, settings: global.numbers(STORY_FACT_SETTING_DEFS) }));
  const trace = turnTrace({ live: app.live, files, runs: new RunTimes(runs), log: app.log });
  // The chat port's reads of Lumiverse; one that cannot be made fails in the words of the turn-errors part in force for the chat.
  const chatNow = async (scope: Scope): Promise<ChatReads> => {
    const parts = options.lumiverse();
    if (parts === null) throw new Error(await turnErrorWords(files, scope, "no_lumiverse_chat"));
    return parts.chat;
  };
  // Lumiverse's memory (its entities and arcs), the chat's summaries and its databanks, as stores `archive_search` finds and reads (§6.8).
  const storesNow = async (scope: Scope): Promise<StoresPort> => {
    const parts = options.lumiverse();
    if (parts === null) throw new Error(await turnErrorWords(files, scope, "no_lumiverse_chat"));
    return parts.stores;
  };
  const sources = liveSources(() => options.lumiverse(), lore, files);
  // A place's bound entries in force (the lore's bindings to `place:<id>`), and each entry as the lore reads it now, by the revision `liveSources` gives it.
  // The entries bound in force to a record by its full ref (`place:<id>`, `quest:<id>`).
  const recordBindings = (user: string, record: string) => [...storedBindings(app.db, user)].flatMap(([entry, rows]) => bindingsInForce(rows).filter((r) => r.record === record).map((r) => ({ entry, aspect: r.aspect, by: r.by })));
  const placeSources: PlaceSourcesReader = {
    bindings: (user, place) => recordBindings(user, `place:${place}`),
    recordBindings,
    entry: async (scope, entry) => {
      const [e] = await lore.read({ user: scope.user, chat: scope.chat }, [entry]);
      return e === undefined ? null : { title: e.title, revision: e.revision ?? hashJson([e.title, e.keys, e.text]) };
    },
  };
  // The cast as a place's or a quest's record reads it at a point of the path: every item of every character's record along the chat's
  // line at the turn (the head where none is named), and each character's name.
  const castKnowledge = (user: string, chat: string, turn: string | null): CastKnowledge => {
    const u = store.user(user);
    const chars = charactersOf(store.db, user, chatLine(u, chat));
    return { items: CastRecord.read(store, user, castAt(u, chat, turn)).items.values(), nameOf: (id) => chars.find((c) => c.id === id)?.name };
  };
  // Who holds a quest's secret: the cast's items at the turn, each holder by the character's name.
  const questHolders = (user: string, chat: string, turn: string | null, quest: string) => {
    const known = castKnowledge(user, chat, turn);
    return holdersOf(known.items, (id) => known.nameOf(id), quest);
  };
  // Who was on stage at each turn the cast counts, and how that was read (R-56): the open scene there and who the state places in its place; with none recorded, who the state places where the owner's character stands; with neither, nobody.
  // Whether his own character has a mind is his setting for the chat (`cast.playerMind`), read at each use.
  facts.add(
    castFacts({
      store,
      sources,
      onStage: async ({ user, chat }, turns) => new Map([...stagesAt(store, user, chat, turns)].map(([turn, stage]) => [turn, { who: stage.who, how: stage.how }])),
      playerMind: async (scope) => playerMindOf(readConfig(await portTexts(files, scope), app.log, [CAST_PLAYER_MIND])),
    }),
  );
  // What time brings due over the store's states: listed by the world state's due section and by an answer that lets time pass.
  const due = timeDue(store);
  /** Keeps the values each line a tool's call said was filled with as its answers part's last use in the chat, over the use before, where the Prompts preview reads them. */
  const lastUse: LastUseKeeper = async (scope, part, lines) => {
    const last = (await harness.parts.lastFields(scope, "prompt", part)) ?? {};
    await harness.parts.keep(scope, "prompt", part, { ...last, ...lines });
  };
  /**
   * The host's tools for a scope: one list for its session (the contract's `ToolsPort`), every family's in it, each on the chat's own
   * settings. The engine's are given squares on a map for the operations that name one, and the map that `world_query` shows, both
   * worded by the map's lines in force, and what time brings due; the story's `overlay` operation writes the lore's overlays.
   */
  const hostTools = async (scope: Scope): Promise<HostTool[]> => {
    const texts = guidanceTexts(files, scope, app.log);
    const asked = env.approvals === undefined ? {} : { approvals: env.approvals };
    const [wording, settings] = await Promise.all([mapWording(texts), turnSettings(files, scope, app.log)]);
    const [engine, cast, story, indexing] = await Promise.all([
      engineTools({ store: store.user(scope.user), env: store.env, writes: app.writes, files: texts, search: indexedSearch(stateIndex, { user: scope.user, chat: scope.chat }), grid: gridMoves(wording.lines, settings.map), map: mapView(wording, settings.map), mapSettings: settings.map, due, dueAhead: settings.worldState.dueAhead, settings: settings.engine, places: settings.places, quests: settings.quests, placeSources, questHolders, lastUse, ...(options.carried !== undefined ? { carried: options.carried } : {}), ...(options.worlds !== undefined ? { worlds: options.worlds } : {}), ...asked }),
      castTools({ store, writes: app.writes, files: texts, sources, books: bookTexts(options.books), secretFact: (user, shown) => secretFacts.secretFactOf(user, shown), search: memorySearch, now: () => clock.now(), settings: settings.cast, lastUse, ...asked }),
      storyTools({ store, writes: app.writes, files: texts, overlay, settings: settings.story, lastUse }),
      loreTools({ index: loreIndex, guidance: loadGuidance(files, scope), log: app.log }),
    ]);
    return [...engine, ...cast, ...story, ...indexing];
  };
  /**
   * The one place a joined turn is resolved (R-192 (f)): a scope that names a continue's held turn, joined to the turn Lumiverse's end
   * decided it extended, names that turn, for every port and host tool that reads or writes the state at a turn: the host's tools at
   * each call, the facts, the lore's reads, the views given by name and what RPH tells of the turn's work. A job the continue started,
   * still running, so writes on the turn it extended. The held turn's own folder, its prompt, its trace, the lore that activated for
   * its prompt and its intent record stay its own: they are its run's.
   */
  const joined = <S extends RunScope>(scope: S): S => {
    if (scope.turn === undefined) return scope;
    const turns = store.user(scope.user);
    const into = turns.turn(scope.turn) === null ? null : turns.joinedTo(scope.turn);
    return into === null ? scope : { ...scope, turn: into };
  };
  const lorePorts = lorePort(lore, loreIndex);
  // A job's end is told through `events.job`, which records it; the lane, made below, brings the sessions of its turn up to date. Each
  // change of a job's state is told to every page that follows his jobs.
  const eventsDeps: EventsDeps = { db: app.db, writes: app.writes, store, runs, files, sources, search: memorySearch, loreIndex, notes, suggestions, proposals: options.proposals, due, ...(options.views !== undefined ? { views: options.views } : {}), now: () => clock.now(), jobEnded: (user, chat, turn) => lane.sessionsAfter(user, chat, turn), jobTold: (job) => JOB_KIND.publish(app.live, LIVE_JOBS, { job }), log: app.log };
  const events = turnEvents(eventsDeps);
  const env: Environment = {
    id: "rpe",
    version: app.version,
    files,
    chat: {
      info: async (scope) => (await chatNow(scope)).info(scope),
      read: async (scope, range) => (await chatNow(scope)).read(scope, range),
      position: async (scope, id) => (await chatNow(scope)).position(scope, id),
      search: async (scope, query) => (await chatNow(scope)).search(scope, query),
    },
    lore: { ...lorePorts, read: (scope, ids, reader) => lorePorts.read(joined(scope), ids, reader), search: (scope, query, reader) => lorePorts.search(joined(scope), query, reader) },
    prompt: prompts,
    stores: {
      list: async (scope) => (await storesNow(scope)).list(scope),
      search: async (scope, query) => (await storesNow(scope)).search(scope, query),
      read: async (scope, ref) => (await storesNow(scope)).read(scope, ref),
    },
    // `web_search` over the provider he sets on the Connections page; off until he sets one.
    web: webSearcher({ secrets: app.secrets, config: () => globalConfig(app.paths.files, app.log) }),
    // RPE's tools are a chat's: a job of no chat is given none of them.
    tools: { all: async (scope) => (scope.chat === undefined ? ((await options.jobTools?.(scope)) ?? []) : (await hostTools(joined(scope))).map((tool) => ({ ...tool, run: (args, ctx) => tool.run(args, { ...ctx, scope: joined(ctx.scope) }) }))) },
    // `gap_check`'s places beside the chat and the lore: the folded state and the story record, at the check's turn as it is joined.
    searchers: [stateSearcher, storySearcher].map((make) => {
      const searcher = make({ store, meaning, personPlayed: (at, plays) => lore.personPlayed(at, plays), snippet: async (scope) => (await turnSettings(files, scope, app.log)).gapSnippet });
      return { name: searcher.name, search: (scope: Scope, query: GapQuery) => searcher.search(joined(scope), query) };
    }),
    // Every fact RPE counts is a chat's: a job of no chat has none of them.
    facts: { defs: () => facts.defs(), read: async (scope, names) => (scope.chat === undefined ? {} : await facts.read(joined(scope), names)) },
    models: app.models,
    // The one home of the decision whether a write goes ahead: each lane Auto, Confirm or Never as he set it for the chat. A continue's held turn is the turn it was joined to.
    approvals: { permission: (scope, lane) => approvals.permission(joined(scope), lane), ask: (scope, ask, signal) => approvals.ask(joined(scope), ask, signal) },
    switches: app.switches,
    store: kvStore(app.db, app.writes),
    trace,
    events: {
      intent: (scope, text) => events.intent(scope, text),
      attachments: (scope, agent, refs, moment) => events.attachments(joined(scope), agent, refs, moment),
      consent: (scope, grant) => events.consent(joined(scope), grant),
      gapCheck: (scope, check) => events.gapCheck(joined(scope), check),
      dropStaged: (scope, agent) => events.dropStaged(joined(scope), agent),
      ruleFired: (scope, firing) => events.ruleFired(joined(scope), firing),
      suggestion: (scope, agent, suggestion) => events.suggestion(joined(scope), agent, suggestion),
      released: (scope, release) => events.released(joined(scope), release),
      ended: (scope, outcome) => events.ended(joined(scope), outcome),
      job: async (scope, job) => events.job?.(joined(scope), job),
    },
    clock,
    // RPE's own setting keys, as its list declares them: they share sections with RPH's (`turn.*`, `limits.*`, `tools.*`), and RPH
    // passes them over where it logs a key in its sections that none of its settings names.
    settingKeys: app.settings.filter((s) => !RPH_SETTINGS.some((rph) => rph.key === s.key)).map((s) => s.key),
    log: app.log,
  };
  const harness = placingJobs(createHarness(env, { appName: "RPE", ...options.harness }), place);
  const lane = new TurnLane({
    store,
    writes: app.writes,
    files,
    chats,
    place,
    prompts,
    lore,
    loreIndex,
    secretSettings,
    runs,
    requests,
    marks,
    since,
    approvals,
    notes,
    projection,
    // A chat deleted in Lumiverse: what is derived of it in the index file goes (rebuilt from its sources were it ever played again).
    forgetChat: async (user, chat) => {
      await Promise.all([stateIndex.forget(user, chat), meaning.dropChat(user, chat)]);
    },
    // The older turn folders, and with them the prompt each of their turns carried and where its slices were (plan §5.5, App. B): kept
    // for as many of the chat's newest turns as its folders are, a turn going on kept whatever its age.
    pruneTurns: async (user, chat, spare) => {
      const pruned = await pruneChat({ files: app.paths.files, chats }, user, chat, spare);
      const folders = chats.folders(user, chat);
      if (folders !== null) {
        const { turnFolders } = await retentionOf({ files: app.paths.files, character: folders.character, chat: folders.chat });
        const going = new Set(runs.ofChat(user, chat).map((r) => r.turn));
        await app.writes.run((db) => prompts.prune(db, user, chat, turnFolders, going), "pruning the prompts of older turns");
      }
      return pruned;
    },
    due,
    migrated: options.migrated,
    sources,
    search: memorySearch,
    live: app.live,
    reads: () => options.lumiverse()?.reads ?? null,
    stopGeneration: async (generation) => (await options.lumiverse()?.stopGeneration(generation)) ?? false,
    dropEmptyReply: async (user, chat, message, swipe) => (await options.lumiverse()?.writes?.dropEmptyReply(user, chat, message, swipe)) ?? false,
    harness: () => harness,
    owner,
    clock,
    log: app.log,
  });
  // A job a restart cut off is kept as interrupted, and told, on its user's first call of the jobs (§13.5): each user the store holds is
  // listed once now that the harness and the lane its end is told to are made, so his are shown as interrupted at once, before he calls.
  // A list that fails is logged, and the start goes on.
  for (const user of storeUsers(app.db)) {
    harness.jobs.list({ user, limit: 1 }).catch((error: unknown) => app.log.error("the jobs a restart cut off could not be listed at RPE's start", { user, error: error instanceof Error ? error.message : String(error) }));
  }
  const secretMarks = (at: LoreScope): Promise<LinesPart | undefined> => secretMarkLines(loadGuidance(files, chatLevels(at)));
  const given = (scope: Scope, agent: AgentRef, refs: readonly string[], moment: AttachMoment) => givenViews(eventsDeps, joined(scope), agent, refs, moment);
  return { lane, store, harness, env, facts, files, chats, take, place, prompts, runs, requests, approvals, writes: app.writes, marks, trace, lore, secretSettings, secretMarks, loreIndex, notes, suggestions, projection, meaning, stateIndex, given, sources, placeSources, castKnowledge };
}
