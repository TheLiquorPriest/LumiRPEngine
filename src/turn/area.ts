// The turn lane's registration with the application (plan §4.1): its tables, its settings (RPH's among
// them), its routes, the lane itself built over the other areas' ports, and what it fills of the door's
// lanes: the tagged reply it plays, the changes it hears, the history window, the stretches a chat
// names, and the model layer's pass.
//
// What it takes from other areas is named in `TurnTakes`: the door's reads of Lumiverse and what a
// migration carried of a chat. The views an agent is given by name come from every area's `fills`,
// through the app's hook (`App.hooks.views`), not from one area's alone.

import type { Clock, CreateHarnessOptions } from "rp-harness";
import { loadGuidance } from "../app/guidance";
import { loreBooks } from "../adapter/lumiverse/books";
import { connectionRoutes, type App, type Area } from "../app";
import { harnessSettings } from "../app/setting-list";
import type { LoreBooks, LoreProposals, ProjectionBooks } from "../lore";
import { MEANING_TABLE } from "../search/meaning";
import type { Store } from "../store";
import { storyCoverage } from "../story";
import { historyWindow } from "../story/window";
import { buildTurns, MACHINE_CLOCK, openAppStore, type Turns, type TurnsOptions } from "./lane";
import { promptOf } from "./request";
import { REQUESTS_KIND } from "./requests";
import { turnRoutes } from "./routes";
import { sessionRoutes } from "./session-routes";
import { passConnection, TURN_SETTINGS, turnSettings } from "./settings";
import { namedStretches } from "./stage";
import { HARNESS_MIGRATIONS, PROMPT_MIGRATIONS } from "./tables";
import { leadConnection, NO_SESSION, type MigratedSource } from "./turns";

/** What the turn lane takes from the composition. */
export interface TurnTakes {
  /** The door's parts, once it is set up for a Lumiverse (the adapter's reads, its chat port, Lumiverse's Stop); null before, or when RPE is not set up for one. */
  lumiverse: TurnsOptions["lumiverse"];
  /** What a migration carried of a chat, for its first briefing on RPE, over the store the lane made. */
  migrated(app: App, store: Store): MigratedSource;
  /** The lore's proposals, where an agent's suggestion about lore is kept for his approval. */
  proposals: () => Pick<LoreProposals, "suggested">;
  /** What RPE writes to his books for the projection book, through the door's writes once it is set up for a Lumiverse. */
  projectionBooks: ProjectionBooks;
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
    attached: (user, chat, at) => booksNow().attached(user, chat, at),
    book: (user, id) => booksNow().book(user, id),
    entries: (user, book) => booksNow().entries(user, book),
    entry: (user, id) => booksNow().entry(user, id),
    list: async (user, chat) => {
      const now = booksNow();
      if (now.list === undefined) throw new Error("The door's books give no list of the user's books.");
      return await now.list(user, chat);
    },
  };

  const area: Area = {
    name: "turn",
    tables: [
      { area: "prompt", migrations: PROMPT_MIGRATIONS },
      { area: "harness", migrations: HARNESS_MIGRATIONS },
    ],
    settings: [...harnessSettings(), ...TURN_SETTINGS],
    liveKinds: [REQUESTS_KIND],
    fills: {
      door: {
        turns: { play: (turn, out, signal) => made().lane.play(turn, out, signal) },
        changes: { changed: (change) => made().lane.changed(change), reopened: () => made().lane.reopened() },
        // The history window on the chat's settings: the first history message the prompt keeps; with the window off the chat's path is never read.
        window: async (ask) => {
          const { window } = await chatSettings(ask.chat);
          return window.size === null ? null : historyWindow(await ask.path(), window, covered(ask.chat)).first;
        },
        // Where a turn not yet begun will start on the question's path, from RPE's own store alone (R-5): the hidden marks it holds laid on
        // the path. A long fold runs on a worker (`afar`), so the question never stalls other chats.
        start: async (ask) => {
          const { store } = made();
          return await store.afar(() => store.user(owner()).turnStart(ask.chat, ask.path, ask.point));
        },
        hiddenReadable: async (chat) => (await chatSettings(chat)).hiddenReadable,
        ranges: async (chat) => namedStretches(made().store, owner(), chat),
        summarized: async (chat) => made().prompts.summarized(owner(), chat),
        // `chat_search` by meaning: the chat's messages in the index of vectors (`src/search/meaning.ts`), on his embedding connection.
        meaning: (chat, text, limit, docs) => made().meaning.nearest(owner(), chat, "chat", text, limit, docs),
        // The prompt RPE passed on for the attempt a regenerate or a swipe replaces: the turn tied to the message as the chat's path shows
        // it (its newest attempt where the path no longer holds it), as its request record keeps it; null where none is kept.
        replaced: async (tag) => {
          const message = tag.target.message;
          if (message === null) return null;
          const s = made().store.user(owner());
          const turn = s.path(tag.chat).find((e) => e.message === message)?.turn ?? s.swipes(tag.chat, message).at(-1)?.id ?? null;
          const kept = turn === null ? null : made().prompts.carried(owner(), turn);
          return kept === null || kept.prompt === null ? null : { prompt: kept.prompt, layout: kept.layout };
        },
        // The model layer's pass, given the user this RPE belongs to: the door names no user of its own.
        models: { pass: (request, sink, signal) => made().harness.models.pass(owner(), request, sink, signal) },
        passConnection: () => (app === null ? null : passConnection(app.paths.files, app.log)),
        // A passed request's failure in the shipped file's words, from the levels every chat shares; its key alone where it has none or cannot be read.
        passWords: async (key, fields) => {
          try {
            const part = await loadGuidance(made().files, { user: owner() }).part("reply-errors");
            return (part?.format === "lines" ? part.line(key, fields) : undefined) ?? key;
          } catch {
            return key;
          }
        },
        // The Author's model's room for a chat's prompt (plan §4.2): its window as the model layer gives it, less the reply's room (the
        // request's own, else RPH's room kept for the answer); the model layer's count of a prompt as the Author's model takes it; and
        // whether the story record covers messages.
        room: async (chat, reply) => {
          const scope = { user: owner(), chat, session: NO_SESSION };
          const settings = await chatSettings(chat);
          const { models, definitions } = made().harness;
          const connection = await leadConnection(definitions, scope, settings.lead);
          const limits = await models.limits(owner(), connection);
          const window = limits.contextWindow?.tokens ?? null;
          return {
            room: window === null ? null : window - (reply ?? settings.reserve),
            count: async (prompt) => models.count(scope, connection, promptOf(prompt as Parameters<typeof promptOf>[0], limits.pictures?.takes === true).messages),
            covered: async (ids) => {
              const held = covered(chat);
              return ids.every((id) => held.has(id));
            },
          };
        },
      },
    },
    async mount(at) {
      app = at;
      // The index file's table of vectors for search by meaning (`src/search/meaning.ts`), made by the index's own writer.
      await at.index.table(MEANING_TABLE);
      const store = openAppStore(at);
      turns = buildTurns(at, {
        store,
        lumiverse: takes.lumiverse,
        books,
        migrated: takes.migrated(at, store),
        clock,
        views: at.hooks.views,
        proposals: takes.proposals,
        projectionBooks: takes.projectionBooks,
        ...(takes.harness !== undefined ? { harness: takes.harness } : {}),
      });
      at.routes.add("connections", connectionRoutes(turns.harness.models, owner, at.log));
      const { harness, lane, runs } = turns;
      // A restart onto a new app file waits for the turns and the jobs that run, and for a request whose turn is still being taken in.
      at.builds.counts(async () => runs.chatsGoing().length + lane.intakesGoing() + (await harness.jobs.list({ user: owner(), states: ["running", "queued"] })).jobs.length);
      at.routes.add("turn", turnRoutes({ turns, chatName: async (chat) => (await takes.lumiverse()?.reads.chat(chat))?.name ?? null }));
      at.routes.add("sessions", sessionRoutes({ turns, writes: at.writes, files: at.paths.files, log: at.log }));
      await lane.preload();
    },
    stopping: () => turns?.harness.close(),
  };
  return { area, turns: () => turns };
}
