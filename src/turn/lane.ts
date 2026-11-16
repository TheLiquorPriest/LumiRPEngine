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
// Left out, as the contract allows: `approvals` (every lane is Auto) and `stores` (RPE reaches no store but its
// own). `switches` is the app's registry (`src/app/switches.ts`): RPH asks it, for the run's user, before
// anything that runs a command or calls out, and before a provider key goes to a connection whose place changed.

import { join } from "node:path";
import { createHarness, type CreateHarnessOptions, type LinesPart, loadGuidance } from "rp-harness";
import type { AgentRef, Clock, Environment, Harness, HostTool, JsonValue, Scope } from "rp-harness/contract";
import type { ChatReads } from "../adapter/lumiverse/chat";
import type { LumiverseReads } from "../adapter/lumiverse/reads";
import type { App } from "../app";
import { portTexts, readConfig } from "../app/config-read";
import { type BookReader, castFacts, castTools, chatLine, findCharacter, type SourceReader } from "../cast";
import { createRegistry } from "../engine/registry-impl";
import { engineTools, gridMoves, mapView, mapWording, stateScan } from "../iface";
import { EntryNumbers, Lore, type LoreBooks, LoreIndex, LORE_INDEX_SETTING_DEFS, LORE_SETTINGS, type LoreProposals, type LoreScope, loreLines, lorePort, loreSettingsFor, loreTools, overlayCheck, secretMarkLines, type SecretSettingsFor, secretSettingsFor, storePath, storeWorlds } from "../lore";
import { ALL_PACKS } from "../packs/index";
import { hashJson } from "../shared/hash";
import { openStore, type Store, STORE_SETTING_DEFS, storedWorlds, timeDue, WORLD_DOCS_SETTING_DEFS } from "../store";
import type { StoreFailure } from "../store/store";
import { STORY_FACT_SETTING_DEFS, STORY_STORE_AREA, storyFacts, storyTools } from "../story";
import { CHATS_FOLDER, GeneratedFiles, promptMapFields, pruneChat, retentionOf, TreeChats, type TreeFiles, treeFiles, TreeNotes, TreeSuggestions, turnFolderName } from "../tree";
import { turnEvents } from "./events";
import { FactsRegistry, turnFacts } from "./facts";
import { kvStore, servedUser, storeUsers } from "./kv";
import { PROMPT_MAP_FILE, PROMPT_MAP_FILENAME, type TurnPrompts, turnPrompts } from "./prompt";
import { TurnMarks } from "./marks";
import { Requests, REQUESTS_KIND } from "./requests";
import { Runs } from "./runs";
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
 * being slow (R-55): the tree's grep stops a slow one itself, under `files.grepMs`.
 */
function servedFiles(owner: () => string | null, make: (user: string) => TreeFiles): TreeFiles {
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
    write: async (scope, path, op, by) => now().write(scope, path, op, by),
    update: async (scope, path, change) => now().update(scope, path, change),
    turnDisk: async (scope) => now().turnDisk(scope),
    sessionDisk: async (scope) => now().sessionDisk(scope),
  };
}

/**
 * A character's sources as Lumiverse holds them now (the cast's `SourceReader`): a card or a persona
 * through the adapter's reads, a lore entry through the lore, each with a revision that changes
 * whenever its text does. RPE has no read of Lumiverse's memory entities, so a memory source fails.
 * A read that cannot be made fails in the words of the turn-errors part in force for the chat.
 */
function liveSources(reads: () => LumiverseReads | null, lore: Lore, files: TreeFiles): SourceReader {
  const lumiverse = async (scope: { user: string; chat: string }): Promise<LumiverseReads> => {
    const now = reads();
    if (now === null) throw new Error(await turnErrorWords(files, scope, "no_lumiverse_sources"));
    return now;
  };
  return async (scope, source) => {
    switch (source.kind) {
      case "entry": {
        const [entry] = await lore.read({ user: scope.user, chat: scope.chat }, [source.ref]);
        return entry === undefined ? null : { title: entry.title, revision: entry.revision ?? hashJson([entry.title, entry.keys, entry.text]) };
      }
      case "card": {
        const card = await (await lumiverse(scope)).character(source.ref);
        return card === null ? null : { title: card.name, revision: hashJson([card.name, card.description, card.personality, card.scenario, card.firstMessage, card.exampleMessages, card.systemPrompt, card.postHistoryInstructions]) };
      }
      case "persona": {
        const persona = await (await lumiverse(scope)).persona(source.ref);
        return persona === null ? null : { title: persona.name, revision: hashJson([persona.name, persona.title, persona.description]) };
      }
      case "memory":
        throw new Error(await turnErrorWords(files, scope, "memory_source"));
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
export function openAppStore(app: Pick<App, "db" | "version" | "log" | "live" | "paths">): Store {
  const handlerFailed = (failure: StoreFailure): void => {
    const { op, chat, turn, change, user } = failure;
    const error = failure.error instanceof Error ? failure.error.message : String(failure.error);
    app.log.error("An engine handler failed on a change, which is recorded as not applied.", { op, error, user, chat: chat ?? null, turn, change });
    if (chat !== undefined) app.live.publish(chat, { kind: "handler_failed", data: { op, error, turn, change } });
  };
  const global = globalConfig(app.paths.files, app.log);
  const worlds = storedWorlds(app.db, global.numbers(WORLD_DOCS_SETTING_DEFS));
  // A walk the store's settings cut short (`engine.kindChain`, `holderDepth`, `space.visitDepth`) is logged, once for each chain.
  return openStore({ db: app.db, registry: createRegistry(ALL_PACKS), worlds, fingerprint: app.version, handlerFailed, log: (message, data) => app.log.warn(message, data as Record<string, JsonValue>), ...global.numbers(STORE_SETTING_DEFS) });
}

export interface TurnsOptions {
  store: Store;
  /**
   * The adapter's reads of Lumiverse, its chat port, and Lumiverse's Stop of one generation of the
   * user's (false when it was not going on); null before it is mounted, or when RPE is not set up for a
   * Lumiverse.
   */
  lumiverse(): { reads: LumiverseReads; chat: ChatReads; stopGeneration(generation: string): Promise<boolean> } | null;
  /** The user's books, as the lore reads them. */
  books: LoreBooks;
  /** What a migration carried of a chat, for its first briefing on RPE. */
  migrated: MigratedSource;
  /** The lore's proposals, where an agent's suggestion about lore is kept for his approval. */
  proposals: () => Pick<LoreProposals, "suggested">;
  /** A view of the host's that an agent is given by name, beyond the turn's own: its text; null for a name that is none of its own. */
  views?: (scope: Scope, agent: AgentRef, ref: string) => Promise<string | null>;
  /** In tests: the models agents run on, in place of the model layer's, and RPH's ids. */
  harness?: Pick<CreateHarnessOptions, "models" | "ids">;
  clock?: Clock;
}

/** Everything the turn lane made, for the composition and the routes. */
export interface Turns {
  lane: TurnLane;
  store: Store;
  harness: Harness;
  env: Environment;
  facts: FactsRegistry;
  files: TreeFiles;
  chats: TreeChats;
  prompts: TurnPrompts;
  runs: Runs;
  /** What he asks for beside his words, waiting or kept with the turn that answered it. */
  requests: Requests;
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
}

export function buildTurns(app: App, options: TurnsOptions): Turns {
  const owner = (): string | null => app.config.lumiverse.user;
  const clock = options.clock ?? MACHINE_CLOCK;
  const { store } = options;
  const chats = new TreeChats(app.db, app.writes, app.paths.files);
  const notes = new TreeNotes({ files: app.paths.files, db: app.db, writes: app.writes, chats });
  const suggestions = new TreeSuggestions({ db: app.db, writes: app.writes, now: () => clock.now(), limits: (user, chat) => chats.suggestionLimits(user, chat) });
  const files = servedFiles(owner, (user) =>
    treeFiles({
      files: app.paths.files,
      user,
      chats,
      // A grep's pattern runs on the worker pool, ended at `files.grepMs` even inside one line.
      workers: app.workers,
      async turnFolder(scope) {
        const turn = scope.turn === undefined ? null : store.user(scope.user).turn(scope.turn);
        return turn === null || turn.chat !== scope.chat ? null : turnFolderName(turn.depth + 1, turn.id);
      },
      writes: app.writes,
      now: () => clock.now(),
    }),
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
  );
  const runs = new Runs(app.db, app.writes);
  const requests = new Requests(app.db, app.writes, (chat, waiting) => REQUESTS_KIND.publish(app.live, chat, { waiting }));
  const marks = new TurnMarks(app.db, app.writes);
  const since = new SinceKept(app.db);
  // The lore may not reach the cast: a character's agent named by the cast's id is found in the world by the cast's name for it.
  const worlds = storeWorlds(store, (user, chat, said) => findCharacter(store.db, user, chatLine(store.user(user), chat), said)?.name ?? null);
  // What is made once for every chat takes its limits from the global level's settings, read once.
  const global = globalConfig(app.paths.files, app.log);
  // The lore's settings for a chat, read once for the lore, its index and the secrecy a turn starts with.
  const config = async (at: LoreScope) => readConfig(await portTexts(files, { ...at, session: NO_SESSION }), app.log, LORE_SETTINGS);
  const loreSettings = loreSettingsFor(config);
  const secretSettings = secretSettingsFor(config);
  // The lore-answers lines in force for the chat word the secrets in an entry's text when an agent reads it.
  const lore = new Lore({ books: options.books, worlds, turns: prompts.lore, numbers: new EntryNumbers(app.db, app.writes), settingsFor: loreSettings, lines: (at) => loreLines(loadGuidance(files, { ...at, session: NO_SESSION })) });
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
      lines: (at) => loreLines(loadGuidance(files, { ...at, session: NO_SESSION })),
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
  const overlay = overlayCheck(worlds);
  const facts = new FactsRegistry();
  facts.add(turnFacts(store, (user, turn) => runs.ofTurn(user, turn)));
  facts.add(loreIndex.facts());
  // Who was on stage at each turn the cast counts: the open scene there, as the story record holds it; a turn with none, nobody.
  facts.add(castFacts({ store, onStage: async ({ user, chat }, turns) => new Map([...stagesAt(store, user, chat, turns)].map(([turn, stage]) => [turn, stage.who])) }));
  // The story's counts work out the history window as the prompt's is cut, on the chat's own settings.
  facts.add(storyFacts({ store, window: async (scope) => (await turnSettings(files, scope, app.log)).window, settings: global.numbers(STORY_FACT_SETTING_DEFS) }));
  const trace = turnTrace({ live: app.live, files, runs: new RunTimes(runs), log: app.log });
  // The chat port's reads of Lumiverse; one that cannot be made fails in the words of the turn-errors part in force for the chat.
  const chatNow = async (scope: Scope): Promise<ChatReads> => {
    const parts = options.lumiverse();
    if (parts === null) throw new Error(await turnErrorWords(files, scope, "no_lumiverse_chat"));
    return parts.chat;
  };
  const sources = liveSources(() => options.lumiverse()?.reads ?? null, lore, files);
  // What time brings due over the store's states: listed by the world state's due section and by an answer that lets time pass.
  const due = timeDue(store);
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
      engineTools({ store: store.user(scope.user), env: store.env, writes: app.writes, files: texts, search: stateScan, grid: gridMoves(wording.lines, settings.map), map: mapView(wording, settings.map), mapSettings: settings.map, due, dueAhead: settings.worldState.dueAhead, settings: settings.engine, ...asked }),
      castTools({ store, writes: app.writes, files: texts, sources, books: bookTexts(options.books), now: () => clock.now(), settings: settings.cast }),
      storyTools({ store, writes: app.writes, files: texts, overlay, settings: settings.story }),
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
  const joined = <S extends Scope>(scope: S): S => {
    if (scope.turn === undefined) return scope;
    const turns = store.user(scope.user);
    const into = turns.turn(scope.turn) === null ? null : turns.joinedTo(scope.turn);
    return into === null ? scope : { ...scope, turn: into };
  };
  const lorePorts = lorePort(lore, loreIndex);
  // A job's end is told through `events.job`, which keeps it; the lane, made below, brings the sessions of its turn up to date.
  const events = turnEvents({ db: app.db, writes: app.writes, store, runs, files, sources, loreIndex, notes, suggestions, proposals: options.proposals, due, ...(options.views !== undefined ? { views: options.views } : {}), now: () => clock.now(), jobEnded: (user, chat, turn) => lane.sessionsAfter(user, chat, turn), log: app.log });
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
    tools: { all: async (scope) => (await hostTools(joined(scope))).map((tool) => ({ ...tool, run: (args, ctx) => tool.run(args, { ...ctx, scope: joined(ctx.scope) }) })) },
    searchers: [],
    facts: { defs: () => facts.defs(), read: (scope, names) => facts.read(joined(scope), names) },
    models: app.models,
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
    log: app.log,
  };
  const harness = createHarness(env, { appName: "RPE", ...options.harness });
  const lane = new TurnLane({
    store,
    writes: app.writes,
    files,
    chats,
    prompts,
    lore,
    loreIndex,
    secretSettings,
    runs,
    requests,
    marks,
    since,
    notes,
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
    live: app.live,
    reads: () => options.lumiverse()?.reads ?? null,
    stopGeneration: async (generation) => (await options.lumiverse()?.stopGeneration(generation)) ?? false,
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
  const secretMarks = (at: LoreScope): Promise<LinesPart | undefined> => secretMarkLines(loadGuidance(files, { ...at, session: NO_SESSION }));
  return { lane, store, harness, env, facts, files, chats, prompts, runs, requests, marks, trace, lore, secretSettings, secretMarks, loreIndex, notes, suggestions };
}
