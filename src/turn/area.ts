// The turn lane's registration with the application (plan §4.1): its tables, its settings (RPH's among
// them), its routes, the lane itself built over the other areas' ports, and what it fills of the door's
// lanes: the tagged reply it plays, the changes it hears, the history window, the stretches a chat
// names, and the model layer's pass.
//
// What it takes from other areas is named in `TurnTakes`: the door's reads of Lumiverse and what a
// migration carried of a chat. The views an agent is given by name come from every area's `fills`,
// through the app's hook (`App.hooks.views`), not from one area's alone.

import type { Clock, CreateHarnessOptions } from "rp-harness";
import { loreBooks } from "../adapter/lumiverse/books";
import { connectionRoutes, storedKey, type App, type Area } from "../app";
import { harnessSettings } from "../app/setting-list";
import type { LoreBooks } from "../lore";
import type { Store } from "../store";
import { storyCoverage } from "../story";
import { historyWindow } from "../story/window";
import { buildTurns, MACHINE_CLOCK, openAppStore, type Turns, type TurnsOptions } from "./lane";
import { turnRoutes } from "./routes";
import { passConnection, TURN_SETTINGS, turnSettings } from "./settings";
import { namedStretches } from "./stage";
import { HARNESS_MIGRATIONS, PROMPT_MIGRATIONS } from "./tables";
import { NO_SESSION, type MigratedSource } from "./turns";

/** What the turn lane takes from the composition. */
export interface TurnTakes {
  /** The door's parts, once it is set up for a Lumiverse (the adapter's reads, its chat port, Lumiverse's Stop); null before, or when RPE is not set up for one. */
  lumiverse: TurnsOptions["lumiverse"];
  /** What a migration carried of a chat, for its first briefing on RPE, over the store the lane made. */
  migrated(app: App, store: Store): MigratedSource;
  clock?: Clock;
  /** Tests only: the models agents run on, in place of the model layer's, and RPH's ids. */
  harness?: Pick<CreateHarnessOptions, "models" | "ids">;
}

/** The turn area, and the lane it builds when it is mounted. */
export interface TurnArea {
  readonly area: Area;
  /** The turn lane and the harness, once mounted; null before. */
  turns(): Turns | null;
}

export function turnArea(takes: TurnTakes): TurnArea {
  const clock = takes.clock ?? MACHINE_CLOCK;
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
  /** The user's books as the lore reads them: through the door's reads, once it is set up for a Lumiverse. */
  const booksNow = (): LoreBooks => {
    const parts = takes.lumiverse();
    if (parts === null) throw new Error("RPE is not set up for a Lumiverse, so it has no books to read.");
    return loreBooks(parts.reads, owner());
  };
  const books: LoreBooks = {
    attached: (user, chat) => booksNow().attached(user, chat),
    book: (user, id) => booksNow().book(user, id),
    entries: (user, book) => booksNow().entries(user, book),
    entry: (user, id) => booksNow().entry(user, id),
  };

  const area: Area = {
    name: "turn",
    tables: [
      { area: "prompt", migrations: PROMPT_MIGRATIONS },
      { area: "harness", migrations: HARNESS_MIGRATIONS },
    ],
    settings: [...harnessSettings(), ...TURN_SETTINGS],
    fills: {
      door: {
        turns: { play: (turn, out, signal) => made().lane.play(turn, out, signal) },
        changes: { changed: (change) => made().lane.changed(change), reopened: () => made().lane.reopened() },
        // The history window on the chat's settings: the first history message the prompt keeps; with the window off the chat's path is never read.
        window: async (ask) => {
          const { window } = await chatSettings(ask.chat);
          return window.size === null ? null : historyWindow(await ask.path(), window, covered(ask.chat)).first;
        },
        hiddenReadable: async (chat) => (await chatSettings(chat)).hiddenReadable,
        ranges: async (chat) => namedStretches(made().store, owner(), chat),
        summarized: async (chat) => made().prompts.summarized(owner(), chat),
        // The model layer's pass, given the user this RPE belongs to: the door names no user of its own.
        models: { pass: (request, sink, signal) => made().harness.models.pass(owner(), request, sink, signal) },
        passConnection: () => (app === null ? null : passConnection(app.paths.files, app.log)),
      },
    },
    async mount(at) {
      app = at;
      const store = openAppStore(at, () => turns?.runs.chatsGoing() ?? []);
      turns = buildTurns(at, {
        store,
        lumiverse: takes.lumiverse,
        books,
        migrated: takes.migrated(at, store),
        clock,
        views: at.hooks.views,
        ...(takes.harness !== undefined ? { harness: takes.harness } : {}),
      });
      at.routes.add("connections", connectionRoutes(turns.harness.models, storedKey(at.models), owner));
      const { harness, lane, runs } = turns;
      // A restart onto a new app file waits for the turns and the jobs that run, and for a request whose turn is still being taken in.
      at.builds.counts(async () => runs.chatsGoing().length + lane.intakesGoing() + (await harness.jobs.list({ user: owner(), states: ["running", "queued"] })).jobs.length);
      at.routes.add("turn", turnRoutes({ turns, chatName: async (chat) => (await takes.lumiverse()?.reads.chat(chat))?.name ?? null }));
      await lane.preload();
    },
    stopping: () => turns?.harness.close(),
  };
  return { area, turns: () => turns };
}
