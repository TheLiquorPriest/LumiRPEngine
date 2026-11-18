// Going back on the Migration page, and what follows his word that he will not (STANDALONE-PLAN §15.6 l.1728, §15.2
// l.1650-1651; READINGS R-90, N-17's default). The page reads going back's steps as they stand (the configured branch,
// the chats moved onto RPE's connections since the swap, RPE's own earlier connection, a key to put back), what today's
// build put in Lumiverse, and his word. Until he has said it, nothing here touches Lumiverse. Once he has, each engine
// book is listed with the chats it is attached to, and a press beside each removes that book and its attachment to each
// chat, through Lumiverse's own routes as him by the adapter's door: one book per press, what it will remove shown
// before, what it removed and anything it could not after. The regex scripts are never offered. The press, its route and
// the list it rests on are in this one file, so that if the owner rules for the list alone (N-17) the press comes out here.

import type { Database } from "bun:sqlite";
import { type Area, route, RouteError, shape } from "../app";
import type { AppConfig } from "../app/config";
import type { WriteQueue } from "../app/database";
import { type ChatNow, goingBack, goingBackFacts, noGoingBack, PREVIOUS_BRANCH_SETTING, PREVIOUS_PERMISSIONS, previousBranch, sayNoGoingBack } from "./going-back";
import { MIGRATION_PATH } from "./routes";
import { lastReport } from "./tables";

/** What the press reaches Lumiverse through: the door's reads of his books and chats, and its removal of a book. */
export interface EngineBookDoor {
  books(): Promise<readonly { id: string; name: string; metadata: Record<string, unknown> }[]>;
  chats(): Promise<readonly ChatNow[]>;
  entries(book: string): Promise<readonly unknown[]>;
  removeBook(user: string, book: string): Promise<{ book: string; detached: string[]; removed: boolean }>;
}

export interface GoingBackDeps {
  db: Database;
  writes: WriteQueue;
  config: AppConfig;
  globalConfig: string;
  /** The extension's identifier in Lumiverse, where no swap recorded the one it used. */
  identifier: string;
  /** The adapter's door, once RPE is set up for a Lumiverse; null before. */
  door: () => EngineBookDoor | null;
  now: () => number;
}

/** A book today's build made for its worlds: its metadata says so (`lumi_rp_engine`). */
const isEngineBook = (book: { metadata: Record<string, unknown> }): boolean => book.metadata.lumi_rp_engine === true;

/** The chats that have `book` attached (`chat_world_book_ids`). */
function attachedTo(book: string, chats: readonly ChatNow[]): { chat: string; name: string }[] {
  return chats.flatMap((c) => (Array.isArray(c.metadata.chat_world_book_ids) && c.metadata.chat_world_book_ids.includes(book) ? [{ chat: c.id, name: c.name }] : []));
}

const T = shape.text();
const N = shape.whole({ least: 0 });
const field = shape.field;
const nullable = shape.nullable;

const engineBook = shape.named(
  "EngineBookShown",
  "A book today's build made for its worlds, as the press beside it would remove it: its entries, and every chat it is attached to, by name.",
  shape.object({
    book: T,
    name: T,
    entries: field(N, "How many entries the book holds, all removed with it."),
    chats: field(shape.list(shape.object({ chat: T, name: T })), "The chats it is attached to: the press takes it out of each, and changes nothing else of them."),
  }),
);

export const goingBackReply = shape.named(
  "GoingBackShown",
  "Going back as it stands, and his word: the steps with the configured branch and what the swap recorded, the permissions by name, what today's build put in Lumiverse, and, only once he has said he will not go back, each engine book with a press.",
  shape.object({
    branch: field(T, "The branch the previous build is kept on (`migration.previousBranch`)."),
    steps: field(shape.list(T), "The steps of going back, as rpe down prints them."),
    permissions: field(shape.list(T), "The permissions the previous build asks for, by name."),
    said: field(nullable(T), "When he said he will not go back; null where he has not."),
    lumiverse: field(nullable(shape.json()), "What today's build put in Lumiverse, counted, as the last real run found it; null before any run."),
    books: field(nullable(shape.list(engineBook)), "The engine books in Lumiverse now, each with a press: null until he has said he will not go back."),
    booksWhy: field(nullable(T), "Why no engine book is listed where he has said it: RPE is not set up for a Lumiverse, or Lumiverse could not be read."),
  }),
);

const wordBody = shape.named("NoGoingBackAsk", "His word that he will not go back, confirmed.", shape.object({ sure: field(shape.yesNo(), "true: he confirmed he will not go back; kept once, and the first time stands.") }));
const wordReply = shape.named("NoGoingBackSaid", "When he said he will not go back.", shape.object({ said: T }));

const removedReply = shape.named(
  "EngineBookRemoved",
  "What the press removed: the book, the chats it was taken out of, whether the book itself was deleted, and what could not be done.",
  shape.object({
    book: T,
    detached: field(shape.list(T), "The chats the book was taken out of."),
    removed: field(shape.yesNo(), "The book was deleted; false where Lumiverse had it no longer, or the removal stopped."),
    failed: field(nullable(T), "Why the removal stopped part way, in Lumiverse's words; null where it went through."),
  }),
);

export function goingBackRoutes(deps: GoingBackDeps) {
  return [
    route({
      method: "GET",
      path: `${MIGRATION_PATH}/going-back`,
      access: "page",
      group: "migration",
      does: "Going back as it stands: its steps with the configured branch, the chats moved onto RPE's connections since the swap, RPE's own earlier connection and a key to put back; the permissions by name; what today's build put in Lumiverse; his word that he will not go back; and, only once he has said it, each engine book with the chats it is attached to.",
      reply: goingBackReply,
      long: true,
      handle: async ({ user }) => {
        const at = noGoingBack(deps.db, user);
        const d = deps.door();
        let chats: readonly ChatNow[] | null = null;
        let books: { book: string; name: string; entries: number; chats: { chat: string; name: string }[] }[] | null = null;
        let booksWhy: string | null = null;
        try {
          if (d !== null) chats = await d.chats();
          if (at !== null) {
            if (d === null || chats === null) booksWhy = "RPE is not set up for a Lumiverse, so it reaches no book of yours.";
            else {
              const found = (await d.books()).filter(isEngineBook);
              books = [];
              for (const b of found) books.push({ book: b.id, name: b.name, entries: (await d.entries(b.id)).length, chats: attachedTo(b.id, chats) });
            }
          }
        } catch (error) {
          booksWhy = `Lumiverse could not be read: ${error instanceof Error ? error.message : String(error)}`;
        }
        const branch = await previousBranch(deps.globalConfig);
        const facts = goingBackFacts(deps.db, user, { identifier: deps.identifier, branch, rpe: deps.config.lumiverse.connections, own: null, chats });
        const [, ...steps] = goingBack({ ...facts, downRun: false });
        const left = lastReport(deps.db, user)?.lumiverse ?? null;
        return { branch, steps: steps.map((s) => s.trim()), permissions: [...PREVIOUS_PERMISSIONS], said: at, lumiverse: left === null ? null : { ...left }, books, booksWhy };
      },
    }),
    route({
      method: "POST",
      path: `${MIGRATION_PATH}/going-back`,
      access: "page",
      group: "migration",
      does: "Keeps his word that he will not go back, once confirmed, with its time; said again, the first time stands. Only after it does the page offer to remove what today's build put in Lumiverse.",
      body: wordBody,
      reply: wordReply,
      handle: async ({ user, body }) => {
        if (!body.sure) throw new RouteError(400, "Confirm that you will not go back: nothing is kept otherwise.");
        const at = new Date(deps.now()).toISOString();
        return { said: await deps.writes.run((db) => sayNoGoingBack(db, user, at), "your word that you will not go back") };
      },
    }),
    route({
      method: "POST",
      path: `${MIGRATION_PATH}/engine-books/:book/removal`,
      access: "page",
      group: "migration",
      does: "Removes one engine book of today's build and takes it out of every chat it is attached to, through Lumiverse's own routes as him, changing nothing else of any chat; only after he has said he will not go back. What it removed, and what it could not.",
      reply: removedReply,
      long: true,
      handle: async ({ user, params }) => {
        if (noGoingBack(deps.db, user) === null) throw new RouteError(409, "Nothing that the previous build put in Lumiverse is removed until you have said, on this page, that you will not go back.");
        const d = deps.door();
        if (d === null) throw new RouteError(409, "RPE is not set up for a Lumiverse, so it reaches no book of yours.");
        const book = (await d.books()).find((b) => b.id === params.book);
        if (book === undefined || !isEngineBook(book)) throw new RouteError(404, `${params.book} is no engine book of the previous build in Lumiverse: only those are removed here.`);
        try {
          return { ...(await d.removeBook(user, book.id)), failed: null };
        } catch (error) {
          // What it took out before it stopped is read again: the press is pressed again to finish.
          const left = attachedTo(book.id, await d.chats().catch(() => []));
          return { book: book.id, detached: [], removed: false, failed: `${error instanceof Error ? error.message : String(error)}${left.length > 0 ? ` (still attached to ${left.length} chat(s))` : ""}` };
        }
      },
    }),
  ] as const;
}

export interface GoingBackTakes {
  identifier: string;
  door: () => EngineBookDoor | null;
}

/** Going back's area: its setting (the previous build's branch) and its routes on the Migration page. */
export function goingBackArea(takes: GoingBackTakes): Area {
  return {
    name: "going-back",
    settings: [PREVIOUS_BRANCH_SETTING],
    mount: (at) => at.routes.add("going-back", goingBackRoutes({ db: at.db, writes: at.writes, config: at.config, globalConfig: at.paths.globalConfig, identifier: takes.identifier, door: takes.door, now: at.now })),
  };
}
