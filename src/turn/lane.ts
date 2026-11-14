// RPE as RPH's host: the `Environment`, assembled from one port per area, and the harness built over
// it, with the turn lane that plays each tagged reply. What each port is, and who gives it:
//
//   files    the tree (`src/tree/`)                 prompt   this lane: the layout each request carried, maps by preset
//   chat     the adapter's chat port                lore     the lore lane's `Lore`, through its port
//   tools    none yet (the engine's come with `src/iface/`)
//   facts    a registry each area adds to; this lane's own counts are in it
//   models   the app's connections                  store    this lane: `kv` in RPE's database
//   trace    the live hub and the turn's folder     events   this lane: kept with the turn
//   clock    the machine's                          log      the app's
//
// Left out, as the contract allows: `approvals` (every lane is Auto) and `switches` (everything that
// runs a command or calls out is off), and `stores` (RPE reaches no other stores yet).

import { createHarness, type CreateHarnessOptions } from "rp-harness";
import type { Clock, Environment, Harness } from "rp-harness/contract";
import type { ChatReads } from "../adapter/lumiverse/chat";
import type { LumiverseReads } from "../adapter/lumiverse/reads";
import type { App } from "../app";
import { createRegistry } from "../engine/registry-impl";
import { EntryNumbers, Lore, type LoreBooks, lorePort, storeWorlds } from "../lore";
import { ALL_PACKS } from "../packs/index";
import { openStore, type Store } from "../store";
import { TreeChats, type TreeFiles, treeFiles, turnFolderName } from "../tree";
import { turnEvents } from "./events";
import { FactsRegistry, turnFacts } from "./facts";
import { kvStore } from "./kv";
import { type TurnPrompts, turnPrompts } from "./prompt";
import { Runs } from "./runs";
import { type TurnTrace, turnTrace } from "./trace";
import { TurnLane } from "./turns";

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
  /** The adapter's reads of Lumiverse and its chat port; null before it is mounted, or when RPE is not set up for a Lumiverse. */
  lumiverse(): { reads: LumiverseReads; chat: ChatReads } | null;
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
  const files = treeFiles({
    files: app.paths.files,
    user: owner() ?? "",
    chats,
    async turnFolder(scope) {
      const turn = scope.turn === undefined ? null : store.user(scope.user).turn(scope.turn);
      return turn === null || turn.chat !== scope.chat ? null : turnFolderName(turn.depth + 1, turn.id);
    },
    writes: app.writes,
    now: () => clock.now(),
  });
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
    tools: { all: async () => [] },
    searchers: [],
    facts,
    models: app.models,
    store: kvStore(app.db, app.writes, owner() ?? ""),
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
    harness: () => harness,
    owner,
    clock,
    log: app.log,
  });
  return { lane, store, harness, env, facts, files, chats, prompts, runs, trace, lore };
}
