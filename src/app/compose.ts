// RPE put together (plan §4.1): every area, in the order it is mounted, over one application. The store,
// the cast, the story record and the lore bring their tables; the tree lays out the shipped level of the agents' files; the turn
// lane builds RPH's environment and the harness, and adds the connections' and the Turn page's routes;
// the door to Lumiverse mounts last, playing each tagged reply through the turn lane, and opens its
// sockets once the server listens.
//
// No lane works out the secrecy of lore entries: asked, the composition says so, and the extension's
// own fail-closed verdict keeps every marked secret out.

import { SHIPPED_GUIDANCE } from "rp-harness";
import type { Clock, CreateHarnessOptions } from "rp-harness";
import { loreBooks } from "../adapter/lumiverse/books";
import { lumiverseDoor, type AdapterDeps, type LumiverseDoor } from "../adapter/lumiverse/mount";
import { bunSocket } from "../adapter/lumiverse/socket";
import { CAST_MIGRATIONS } from "../cast";
import { type LoreBooks, LORE_MIGRATIONS } from "../lore";
import { STORE_MIGRATIONS } from "../store";
import { STORY_MIGRATIONS, storyCoverage } from "../story";
import { historyWindow } from "../story/window";
import { layShipped, RPE_GUIDANCE, TREE_MIGRATIONS } from "../tree";
import { buildTurns, HARNESS_MIGRATIONS, MACHINE_CLOCK, namedStretches, NO_SESSION, openAppStore, passConnection, PROMPT_MIGRATIONS, turnRoutes, turnSettings, type Turns } from "../turn";
import type { App, Area } from "./app";
import { connectionRoutes } from "./connections";

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
      models: { pass: (request, sink, signal) => made().harness.models.pass(request, sink, signal) },
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
    { name: "lore", tables: { area: "lore", migrations: LORE_MIGRATIONS } },
    { name: "prompt", tables: { area: "prompt", migrations: PROMPT_MIGRATIONS } },
    {
      name: "tree",
      tables: { area: "files", migrations: TREE_MIGRATIONS },
      mount: (at) => layShipped(at.paths.files, at.paths.root, { rph: SHIPPED_GUIDANCE, rpe: RPE_GUIDANCE }),
    },
    {
      name: "turn",
      tables: { area: "harness", migrations: HARNESS_MIGRATIONS },
      async mount(at) {
        app = at;
        turns = buildTurns(at, {
          store: openAppStore(at),
          lumiverse: () => {
            const parts = door.lumiverse();
            return parts === null ? null : { reads: parts.reads, chat: parts.chat, stopGeneration: parts.stopGeneration };
          },
          books,
          clock,
          ...(options.harness !== undefined ? { harness: options.harness } : {}),
        });
        at.routes.add("connections", connectionRoutes(turns.harness.models));
        at.routes.add(
          "turn",
          turnRoutes({
            turns,
            chatName: async (chat) => (await door.lumiverse()?.reads.chat(chat))?.name ?? null,
          }),
        );
        await turns.lane.preload();
      },
      stopping: () => turns?.harness.close(),
    },
    door.area,
  ];

  return { areas, door, turns: () => turns };
}
