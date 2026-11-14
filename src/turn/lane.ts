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
//   trace    the live hub and the turn's folder     events   this lane: kept with the turn; the cast's views given
//   clock    the machine's                          log      the app's
//
// Left out, as the contract allows: `approvals` (every lane is Auto) and `switches` (everything that
// runs a command or calls out is off), and `stores` (RPE reaches no other stores yet).

import { join } from "node:path";
import { createHarness, type CreateHarnessOptions, loadGuidance } from "rp-harness";
import type { Clock, Environment, Harness, HostTool, Scope } from "rp-harness/contract";
import type { ChatReads } from "../adapter/lumiverse/chat";
import type { LumiverseReads } from "../adapter/lumiverse/reads";
import type { App } from "../app";
import { castFacts, castTools, type SourceReader } from "../cast";
import { createRegistry } from "../engine/registry-impl";
import { engineTools, gridMoves, mapLines, mapView, stateScan } from "../iface";
import { EntryNumbers, Lore, type LoreBooks, LoreIndex, loreLines, lorePort, loreTools, overlayWrite, storePath, storeWorlds } from "../lore";
import { ALL_PACKS } from "../packs/index";
import { hashJson } from "../shared/hash";
import { openStore, type Store, storedWorlds, timeDue } from "../store";
import { storyFacts, storyTools } from "../story";
import { CHATS_FOLDER, pruneChat, TreeChats, type TreeFiles, treeFiles, TreeNotes, TreeSuggestions, turnFolderName } from "../tree";
import { turnEvents } from "./events";
import { FactsRegistry, turnFacts } from "./facts";
import { kvStore, servedUser } from "./kv";
import { riskyPattern } from "./pattern";
import { PlayerSide } from "./player";
import { type TurnPrompts, turnPrompts } from "./prompt";
import { Runs } from "./runs";
import { turnSettings } from "./settings";
import { SinceKept } from "./since";
import { stagesAt } from "./stage";
import { guidanceTexts } from "./texts";
import { type TurnTrace, turnTrace } from "./trace";
import { type MigratedSource, NO_SESSION, TurnLane } from "./turns";

/**
 * RPE's file port for the one user it serves, that user read each time the port is asked, since it may
 * be set after the lane is built: before one is set every call is refused, and the tree's own port
 * refuses a scope of anyone else, an empty user's included. A search pattern that could take time
 * without end on some text is refused as no pattern at all, which the harness words from its notice
 * line: it would hold every chat and every Stop while it ran (`pattern.ts`).
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
    find: async (scope, query) => {
      if (query.by === "grep" && query.literal !== true && riskyPattern(query.pattern)) throw new SyntaxError(`The pattern ${query.pattern} could take time without end on some text.`);
      return now().find(scope, query);
    },
    write: async (scope, path, op, by) => now().write(scope, path, op, by),
    turnDisk: async (scope) => now().turnDisk(scope),
    sessionDisk: async (scope) => now().sessionDisk(scope),
  };
}

/**
 * A character's sources as Lumiverse holds them now (the cast's `SourceReader`): a card or a persona
 * through the adapter's reads, a lore entry through the lore, each with a revision that changes
 * whenever its text does. RPE has no read of Lumiverse's memory entities, so a memory source fails.
 */
function liveSources(reads: () => LumiverseReads | null, lore: Lore): SourceReader {
  const lumiverse = (): LumiverseReads => {
    const now = reads();
    if (now === null) throw new Error("RPE is not set up for a Lumiverse, so it cannot read a character's sources.");
    return now;
  };
  return async (scope, source) => {
    switch (source.kind) {
      case "entry": {
        const [entry] = await lore.read({ user: scope.user, chat: scope.chat }, [source.ref]);
        return entry === undefined ? null : { title: entry.title, revision: entry.revision ?? hashJson([entry.title, entry.keys, entry.text]) };
      }
      case "card": {
        const card = await lumiverse().character(source.ref);
        return card === null ? null : { title: card.name, revision: hashJson([card.name, card.description, card.personality, card.scenario, card.firstMessage, card.exampleMessages, card.systemPrompt, card.postHistoryInstructions]) };
      }
      case "persona": {
        const persona = await lumiverse().persona(source.ref);
        return persona === null ? null : { title: persona.name, revision: hashJson([persona.name, persona.title, persona.description]) };
      }
      case "memory":
        throw new Error("RPE cannot read Lumiverse's memory entities yet, so a memory source cannot be read.");
    }
  };
}

/** The machine's clock, its day in the machine's own time zone. */
export const MACHINE_CLOCK: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as Timer),
  day: (at) => {
    const d = new Date(at ?? Date.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },
};

/**
 * RPE's store over the application's database: the shipped packs' handlers fold its changes, a chat on a
 * real world folds over the revision's document the store keeps, and its snapshots are this build's. A
 * handler that throws is an error in the engine, not in the story: its text goes to the log, and to the
 * live view of each chat with a run going on (`going`), the one place a player watches RPE work; the
 * change's report, all a model is shown, says only that it failed.
 */
export function openAppStore(app: Pick<App, "db" | "version" | "log" | "live">, going: () => readonly string[]): Store {
  const handlerFailed = ({ op, error }: { op: string; error: unknown }): void => {
    const text = error instanceof Error ? error.message : String(error);
    app.log.error("An engine handler failed on a change, which is recorded as not applied.", { op, error: text });
    for (const chat of going()) app.live.publish(chat, { kind: "handler_failed", data: { op, error: text } });
  };
  return openStore({ db: app.db, registry: createRegistry(ALL_PACKS), worlds: storedWorlds(app.db), fingerprint: app.version, handlerFailed });
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
  player: PlayerSide;
  trace: TurnTrace;
  lore: Lore;
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
  const suggestions = new TreeSuggestions({ db: app.db, writes: app.writes, now: () => clock.now() });
  const files = servedFiles(owner, (user) =>
    treeFiles({
      files: app.paths.files,
      user,
      chats,
      async turnFolder(scope) {
        const turn = scope.turn === undefined ? null : store.user(scope.user).turn(scope.turn);
        return turn === null || turn.chat !== scope.chat ? null : turnFolderName(turn.depth + 1, turn.id);
      },
      writes: app.writes,
      now: () => clock.now(),
    }),
  );
  const prompts = turnPrompts(app.db, app.writes, () => clock.now());
  const runs = new Runs(app.db, app.writes);
  const player = new PlayerSide(app.db, app.writes);
  const since = new SinceKept(app.db);
  const worlds = storeWorlds(store);
  const lore = new Lore({ books: options.books, worlds, turns: prompts.lore, numbers: new EntryNumbers(app.db, app.writes) });
  // The index's readable file is written at the top of the chat's folder, worded by the lore's lines in force for the chat.
  const loreIndex = new LoreIndex({
    lore,
    db: app.db,
    writes: app.writes,
    path: storePath(store),
    file: {
      folder: (user, chat) => {
        const folders = chats.folders(user, chat);
        return folders === null ? null : join(app.paths.files, CHATS_FOLDER, folders.character, folders.chat);
      },
      lines: (at) => loreLines(loadGuidance(files, { ...at, session: NO_SESSION })),
    },
    now: () => clock.now(),
  });
  const overlay = overlayWrite(worlds, () => clock.now());
  const facts = new FactsRegistry();
  facts.add(turnFacts(store, (user, turn) => runs.record(user, turn)));
  facts.add(loreIndex.facts());
  // Who was on stage at each turn the cast counts: the open scene there, as the story record holds it; a turn with none, nobody.
  facts.add(castFacts({ store, onStage: async ({ user, chat }, turns) => new Map([...stagesAt(store, user, chat, turns)].map(([turn, stage]) => [turn, stage.who])) }));
  // The story's counts work out the history window as the prompt's is cut, on the chat's own settings.
  facts.add(storyFacts({ store, window: async (scope) => (await turnSettings(files, scope, app.log)).window }));
  const trace = turnTrace({ live: app.live, files, chatOfRun: (run) => runs.chatOfRun(run), log: app.log });
  const chatNow = (): ChatReads => {
    const parts = options.lumiverse();
    if (parts === null) throw new Error("RPE is not set up for a Lumiverse, so it has no chat to read.");
    return parts.chat;
  };
  const sources = liveSources(() => options.lumiverse()?.reads ?? null, lore);
  // What time brings due over the store's states: listed by the world state's due section and by an answer that lets time pass.
  const due = timeDue(store);
  /**
   * The host's tools for a scope: one list for its session (the contract's `ToolsPort`), every family's in it. The engine's are given
   * squares on a map for the operations that name one, and the map that `world_query` shows, both worded by the map's lines in force,
   * and what time brings due; the story's `overlay` operation writes the lore's overlays.
   */
  const hostTools = async (scope: Scope): Promise<HostTool[]> => {
    const texts = guidanceTexts(files, scope);
    const asked = env.approvals === undefined ? {} : { approvals: env.approvals };
    const lines = await mapLines(texts);
    const [engine, cast, story, indexing] = await Promise.all([
      engineTools({ store: store.user(scope.user), env: store.env, writes: app.writes, files: texts, search: stateScan, grid: gridMoves(lines), map: mapView(lines), due, ...asked }),
      castTools({ store, writes: app.writes, files: texts, sources, now: () => clock.now() }),
      storyTools({ store, writes: app.writes, files: texts, overlay, now: () => clock.now() }),
      loreTools({ index: loreIndex, guidance: loadGuidance(files, scope) }),
    ]);
    return [...engine, ...cast, ...story, ...indexing];
  };
  const env: Environment = {
    id: "rpe",
    version: app.version,
    files,
    chat: {
      info: (scope) => chatNow().info(scope),
      read: (scope, range) => chatNow().read(scope, range),
      search: (scope, query) => chatNow().search(scope, query),
    },
    lore: lorePort(lore),
    prompt: prompts,
    tools: { all: hostTools },
    searchers: [],
    facts,
    models: app.models,
    store: kvStore(app.db, app.writes, owner),
    trace,
    // A job's end is told through `events.job`, which keeps it; the lane, made below, brings the sessions of its turn up to date.
    events: turnEvents({ db: app.db, writes: app.writes, store, runs, files, sources, loreIndex, notes, suggestions, now: () => clock.now(), jobEnded: (user, chat, turn) => lane.sessionsAfter(user, chat, turn), log: app.log }),
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
    runs,
    player,
    since,
    notes,
    pruneTurns: (user, chat, spare) => pruneChat({ files: app.paths.files, chats }, user, chat, spare),
    due,
    migrated: options.migrated,
    live: app.live,
    reads: () => options.lumiverse()?.reads ?? null,
    stopGeneration: async (generation) => (await options.lumiverse()?.stopGeneration(generation)) ?? false,
    harness: () => harness,
    owner,
    clock,
    log: app.log,
  });
  return { lane, store, harness, env, facts, files, chats, prompts, runs, player, trace, lore, loreIndex, notes, suggestions };
}
