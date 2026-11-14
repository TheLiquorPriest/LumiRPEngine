// RPE as RPH's host: the `Environment`, assembled from one port per area, and the harness built over
// it, with the turn lane that plays each tagged reply. What each port is, and who gives it:
//
//   files    the tree (`src/tree/`)                 prompt   this lane: the layout each request carried, maps by preset
//   chat     the adapter's chat port                lore     the lore lane's `Lore`, through its port
//   tools    the engine's (`src/iface/`), each worded by its file in force for the chat
//   facts    a registry each area adds to; this lane's own counts are in it
//   models   the app's connections                  store    this lane: `kv` in RPE's database
//   trace    the live hub and the turn's folder     events   this lane: kept with the turn
//   clock    the machine's                          log      the app's
//
// Left out, as the contract allows: `approvals` (every lane is Auto) and `switches` (everything that
// runs a command or calls out is off), and `stores` (RPE reaches no other stores yet).

import { createHarness, type CreateHarnessOptions, loadGuidance } from "rp-harness";
import type { Clock, Environment, FilesPort, Harness, Scope } from "rp-harness/contract";
import type { ChatReads } from "../adapter/lumiverse/chat";
import type { LumiverseReads } from "../adapter/lumiverse/reads";
import type { App } from "../app";
import { createRegistry } from "../engine/registry-impl";
import { engineTools, type GuidanceFiles, stateScan } from "../iface";
import { EntryNumbers, Lore, type LoreBooks, lorePort, storeWorlds } from "../lore";
import { ALL_PACKS } from "../packs/index";
import { openStore, type Store } from "../store";
import { TreeChats, type TreeFiles, treeFiles, turnFolderName } from "../tree";
import { turnEvents } from "./events";
import { FactsRegistry, turnFacts } from "./facts";
import { kvStore, servedUser } from "./kv";
import { type TurnPrompts, turnPrompts } from "./prompt";
import { Runs } from "./runs";
import { type TurnTrace, turnTrace } from "./trace";
import { TurnLane } from "./turns";

/**
 * The engine's tools' files as they are in force for a scope: RPH's guidance finds the nearest level's
 * file of the name, passing over one switched off, and its text is read as the agents would read it.
 */
function guidanceTexts(files: FilesPort, scope: Scope): GuidanceFiles {
  const guidance = loadGuidance(files, scope);
  return {
    async read(kind, name) {
      const part = kind === "tools" ? await guidance.tool(name) : await guidance.part(name);
      if (part === undefined) return undefined;
      const read = await files.read(scope, part.source.path);
      return read.status === "read" ? read.text : undefined;
    },
  };
}

/**
 * RPE's file port for the one user it serves, that user read each time the port is asked, since it may
 * be set after the lane is built: before one is set every call is refused, and the tree's own port
 * refuses a scope of anyone else, an empty user's included.
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
    turnDisk: async (scope) => now().turnDisk(scope),
    sessionDisk: async (scope) => now().sessionDisk(scope),
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

/** RPE's store over the application's database: the shipped packs' handlers fold its changes, and its snapshots are this build's. */
export function openAppStore(app: Pick<App, "db" | "version">): Store {
  // No world documents are kept by RPE yet: a chat starts with no world, and its state has none to fold until the world lane gives them.
  return openStore({ db: app.db, registry: createRegistry(ALL_PACKS), worlds: () => undefined, fingerprint: app.version });
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
  trace: TurnTrace;
  lore: Lore;
}

export function buildTurns(app: App, options: TurnsOptions): Turns {
  const owner = (): string | null => app.config.lumiverse.user;
  const clock = options.clock ?? MACHINE_CLOCK;
  const { store } = options;
  const chats = new TreeChats(app.db, app.writes, app.paths.files);
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
  const lore = new Lore({ books: options.books, worlds: storeWorlds(store), turns: prompts.lore, numbers: new EntryNumbers(app.db, app.writes) });
  const facts = new FactsRegistry();
  facts.add(turnFacts(store));
  const trace = turnTrace({ live: app.live, files, chatOfRun: (run) => runs.chatOfRun(run), log: app.log });
  const chatNow = (): ChatReads => {
    const parts = options.lumiverse();
    if (parts === null) throw new Error("RPE is not set up for a Lumiverse, so it has no chat to read.");
    return parts.chat;
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
    tools: { all: (scope) => engineTools({ store: store.user(scope.user), env: store.env, writes: app.writes, files: guidanceTexts(files, scope), search: stateScan }) },
    searchers: [],
    facts,
    models: app.models,
    store: kvStore(app.db, app.writes, owner),
    trace,
    events: turnEvents({ db: app.db, writes: app.writes, store, runs, now: () => clock.now(), log: app.log }),
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
    runs,
    live: app.live,
    reads: () => options.lumiverse()?.reads ?? null,
    stopGeneration: async (generation) => (await options.lumiverse()?.stopGeneration(generation)) ?? false,
    harness: () => harness,
    owner,
    clock,
    log: app.log,
  });
  return { lane, store, harness, env, facts, files, chats, prompts, runs, trace, lore };
}
