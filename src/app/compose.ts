// RPE put together (plan §4.1): every area, in the order it is mounted, over one application. The store,
// the cast, the story record, the migration and the lore bring their tables, and the migration its
// page's route; the tree lays out the shipped level of the agents' files, keeping what an update
// changed of it; the turn lane builds RPH's environment and the harness, and adds the connections', the
// Turn page's and the Files page's routes; Build serves its page's messages over the turn lane's store;
// the door to Lumiverse mounts last, playing each tagged reply through the turn lane, and opens its
// sockets once the server listens.
//
// The migration's tables are made by the running application as by the migration itself, so every
// install's database holds them at this build's version whether or not a migration ever ran there. The
// turn lane reads no migration: what one carried of a chat is handed to it from here.
//
// No lane works out the secrecy of lore entries: asked, the composition says so, and the extension's
// own fail-closed verdict keeps every marked secret out.

import { join } from "node:path";
import { SHIPPED_GUIDANCE } from "rp-harness";
import type { Clock, CreateHarnessOptions } from "rp-harness";
import { loreBooks } from "../adapter/lumiverse/books";
import { lumiverseDoor, type AdapterDeps, type LumiverseDoor } from "../adapter/lumiverse/mount";
import { EXTENSION_IDENTIFIER } from "../adapter/lumiverse/pipe-wire";
import { bunSocket } from "../adapter/lumiverse/socket";
import { BUILD_MIGRATIONS, buildRoutes, BuildService } from "../build";
import { CAST_MIGRATIONS, CAST_SETTINGS, castRoutes } from "../cast";
import { IFACE_SETTINGS } from "../iface";
import { type LoreBooks, LORE_MIGRATIONS, LORE_SETTINGS } from "../lore";
import { MIGRATED_NOTICE, MIGRATED_PART, migratedChat } from "../migrate/briefing";
import { migrateRoutes } from "../migrate/routes";
import { lastReport, MIGRATE_TABLES } from "../migrate/tables";
import { playRoutes, PlayService } from "../play";
import { STORE_MIGRATIONS, STORE_SETTINGS } from "../store";
import { STORY_MIGRATIONS, STORY_SETTINGS, storyCoverage, storyRoutes } from "../story";
import { historyWindow } from "../story/window";
import { layDefaults, RPE_GUIDANCE, TREE_MIGRATIONS, TREE_SETTINGS, treeLayers, treeRoutes } from "../tree";
import { levelBase } from "../tree/view";
import { buildTurns, HARNESS_MIGRATIONS, MACHINE_CLOCK, namedStretches, NO_SESSION, openAppStore, passConnection, PROMPT_MIGRATIONS, turnRoutes, TURN_SETTINGS, turnSettings, type Turns } from "../turn";
import { BOOTSTRAP_SETTINGS, BootstrapJobs, bootstrapRoutes } from "../turn/bootstrap";
import { guidanceTexts } from "../turn/texts";
import type { App, Area } from "./app";
import { connectionRoutes, storedKey } from "./connections";
import { HARNESS_SETTINGS } from "./harness-settings";
import { type LevelFile, settingsRoutes } from "./settings-routes";
import { UPDATE_SETTINGS } from "./update";

export interface ComposeOptions {
  /** Lumiverse's network as the door reaches it: the machine's when absent. */
  fetch?: AdapterDeps["fetch"];
  open?: AdapterDeps["open"];
  sleep?: AdapterDeps["sleep"];
  clock?: Clock;
  /** Tests only: the models agents run on, in place of the model layer's, and RPH's ids. */
  harness?: Pick<CreateHarnessOptions, "models" | "ids">;
}

export interface Composition {
  /** Every area, in the order it is mounted. */
  readonly areas: readonly Area[];
  readonly door: LumiverseDoor;
  /** The turn lane and the harness, once mounted; null before. */
  turns(): Turns | null;
}

export function compose(options: ComposeOptions = {}): Composition {
  const clock = options.clock ?? MACHINE_CLOCK;
  let app: App | null = null;
  let turns: Turns | null = null;
  const made = (): Turns => {
    if (turns === null) throw new Error("RPE's turn lane is not mounted yet.");
    return turns;
  };
  /** Taking on a story with a past: the job the player starts, and what its agents are given. */
  const bootstrap = new BootstrapJobs({ turns: made });
  const owner = (): string => app?.config.lumiverse.user ?? "";
  /** A chat's settings as its levels' config files set them, read outside any session. */
  const chatSettings = (chat: string) => turnSettings(made().files, { user: owner(), chat, session: NO_SESSION }, made().env.log);
  /** The messages the story record covers at the chat's head, for the window's hold: none for a chat RPE has not played, which has no record. */
  const covered = (chat: string): ReadonlySet<string> => {
    const { store } = made();
    return store.user(owner()).chat(chat) === null ? new Set() : storyCoverage({ store, user: owner(), chat, turn: null }).covered;
  };

  const door = lumiverseDoor(
    {
      turns: { play: (turn, out, signal) => made().lane.play(turn, out, signal), standbyLine: (turn) => made().lane.standbyLine(turn) },
      changes: { changed: (change) => made().lane.changed(change), reopened: () => made().lane.reopened() },
      // The history window on the chat's settings: the first history message the prompt keeps.
      window: async (ask) => historyWindow(ask.path, (await chatSettings(ask.chat)).window, covered(ask.chat)).first,
      secrecy: async () => {
        throw new Error("RPE works out no secrecy of its lore, so the extension keeps every marked secret out.");
      },
      hiddenReadable: async (chat) => (await chatSettings(chat)).hiddenReadable,
      ranges: async (chat) => namedStretches(made().store, owner(), chat),
      summarized: async (chat) => made().prompts.summarized(owner(), chat),
      // The model layer's pass, given the user this RPE belongs to: the door names no user of its own.
      models: { pass: (request, sink, signal) => made().harness.models.pass(owner(), request, sink, signal) },
      passConnection: () => (app === null ? null : passConnection(app.paths.files, app.log)),
    },
    {
      fetch: options.fetch ?? ((url, init) => fetch(url, init)),
      open: options.open ?? bunSocket,
      clock,
      sleep: options.sleep ?? ((ms) => Bun.sleep(ms)),
    },
  );

  /** The user's books as the lore reads them: through the door's reads, once it is set up for a Lumiverse. */
  const books: LoreBooks = {
    attached: (user, chat) => booksNow().attached(user, chat),
    book: (user, id) => booksNow().book(user, id),
    entries: (user, book) => booksNow().entries(user, book),
    entry: (user, id) => booksNow().entry(user, id),
  };
  const booksNow = (): LoreBooks => {
    const parts = door.lumiverse();
    if (parts === null) throw new Error("RPE is not set up for a Lumiverse, so it has no books to read.");
    return loreBooks(parts.reads, owner());
  };

  const areas: Area[] = [
    { name: "store", tables: { area: "store", migrations: STORE_MIGRATIONS } },
    { name: "cast", tables: { area: "cast", migrations: CAST_MIGRATIONS } },
    { name: "story", tables: { area: "story", migrations: STORY_MIGRATIONS } },
    { name: "migrate", tables: { area: "migrate", migrations: MIGRATE_TABLES }, mount: (at) => at.routes.add("migration", migrateRoutes({ db: at.db, identifier: EXTENSION_IDENTIFIER })) },
    { name: "lore", tables: { area: "lore", migrations: LORE_MIGRATIONS } },
    { name: "prompt", tables: { area: "prompt", migrations: PROMPT_MIGRATIONS } },
    {
      name: "tree",
      tables: { area: "files", migrations: TREE_MIGRATIONS },
      mount: async (at) => {
        await layDefaults({ files: at.paths.files, scratch: at.paths.root, sources: { rph: SHIPPED_GUIDANCE, rpe: RPE_GUIDANCE }, writes: at.writes, now: at.now });
      },
    },
    {
      name: "turn",
      tables: { area: "harness", migrations: HARNESS_MIGRATIONS },
      async mount(at) {
        app = at;
        turns = buildTurns(at, {
          store: openAppStore(at, () => turns?.runs.chatsGoing() ?? []),
          lumiverse: () => {
            const parts = door.lumiverse();
            return parts === null ? null : { reads: parts.reads, chat: parts.chat, stopGeneration: parts.stopGeneration };
          },
          books,
          migrated: { part: MIGRATED_PART, notice: MIGRATED_NOTICE, fields: (user, chat) => migratedChat({ db: at.db, store: made().store, user, chat }) },
          clock,
          views: (scope, agent, ref) => bootstrap.view(scope, agent, ref),
          ...(options.harness !== undefined ? { harness: options.harness } : {}),
        });
        at.routes.add("connections", connectionRoutes(turns.harness.models, storedKey(at.models), owner));
        const { chats, harness, lane, runs } = turns;
        // A restart onto a new app file waits for the turns and the jobs that run, and for a request whose turn is still being taken in.
        at.builds.counts(async () => runs.chatsGoing().length + lane.intakesGoing() + ((await harness.jobs?.list({ user: owner(), states: ["running", "queued"] })) ?? []).length);
        at.routes.add(
          "settings",
          settingsRoutes({
            settings: [...HARNESS_SETTINGS, ...TURN_SETTINGS, ...BOOTSTRAP_SETTINGS, ...UPDATE_SETTINGS, ...TREE_SETTINGS, ...CAST_SETTINGS, ...STORY_SETTINGS, ...LORE_SETTINGS, ...STORE_SETTINGS, ...IFACE_SETTINGS],
            // The levels of the agents' tree that have a config file, where they are on disk; a chat's own once it has its folder.
            levels: async (chat): Promise<LevelFile[]> => {
              const folders = chat === null ? null : chats.folders(owner(), chat);
              const where = { files: at.paths.files, character: folders?.character ?? null, chat: folders?.chat ?? null };
              return treeLayers().flatMap((layer) => {
                const base = levelBase(where, layer.level);
                return layer.config === undefined || base === null ? [] : [{ level: layer.level, file: `${layer.mount}${layer.config}`, disk: join(where.files, ...base, layer.config) }];
              });
            },
            connections: async () => (await harness.models.list(owner())).connections.map((c) => ({ id: c.id, name: c.name })),
          }),
        );
        at.routes.add(
          "turn",
          turnRoutes({
            turns,
            chatName: async (chat) => (await door.lumiverse()?.reads.chat(chat))?.name ?? null,
          }),
        );
        // The chats the last migration carried are the ones the Migration page offers a bootstrap for.
        at.routes.add(
          "bootstrap",
          bootstrapRoutes({
            jobs: bootstrap,
            carried: async (user) => (lastReport(at.db, user)?.imports ?? []).filter((c) => c.outcome === "imported" || c.outcome === "replaced").map((c) => c.chatId),
          }),
        );
        at.routes.add(
          "tree",
          treeRoutes({
            files: at.paths.files,
            chats: turns.chats,
            db: at.db,
            suggestions: turns.suggestions,
            turning: (user, chat) => made().runs.ofChat(user, chat).length > 0,
            stack: (user, chat, agent) => made().harness.definitions.stack({ user, chat, session: NO_SESSION }, agent),
          }),
        );
        await turns.lane.preload();
      },
      stopping: () => turns?.harness.close(),
    },
    // After the turn lane: Attach goes through its store, so the folds it holds are dropped.
    {
      name: "build",
      tables: { area: "build", migrations: BUILD_MIGRATIONS },
      mount: (at) => at.routes.add("build", buildRoutes(new BuildService({ db: at.db, writes: at.writes, store: made().store, log: at.log, guidance: RPE_GUIDANCE }))),
    },
    // After the turn lane too: today's play panels read the chat's state from its store and record a managing tap there.
    {
      name: "play",
      mount: (at) =>
        at.routes.add("play", playRoutes(new PlayService({ store: made().store, writes: at.writes, live: at.live, guidance: RPE_GUIDANCE, turning: (user, chat) => made().runs.ofChat(user, chat).length > 0, log: at.log }))),
    },
    // After the turn lane too: the Cast and Story pages read the records from its store, and a strike is the player's change on the chat's newest turn.
    {
      name: "records",
      mount: (at) => {
        const scope = (user: string, chat: string) => ({ user, chat, session: NO_SESSION });
        const turning = (user: string, chat: string): boolean => made().runs.ofChat(user, chat).length > 0;
        const files = (user: string, chat: string) => guidanceTexts(made().files, scope(user, chat));
        const settings = (user: string, chat: string) => turnSettings(made().files, scope(user, chat), made().env.log);
        at.routes.add("cast", castRoutes({ store: made().store, writes: at.writes, turning, files, settings: async (user, chat) => (await settings(user, chat)).cast }));
        at.routes.add("story", storyRoutes({ store: made().store, writes: at.writes, turning, files, settings: async (user, chat) => (await settings(user, chat)).story }));
      },
    },
    door.area,
  ];

  return { areas, door, turns: () => turns };
}
