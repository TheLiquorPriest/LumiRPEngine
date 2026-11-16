// Where a world's files are kept (plan §4.5, §15.2; PlanChatUI-B1 item 2). A world is four kinds of file in its folder,
// as today's world store names them: `index.json`, `draft.json`, `history.json` and `rev/<revision>.json`. The world
// store reads and writes them through this port, and two things stand behind it:
//
//   - the store's own table (`storeBacking`): every world he built is kept once, in `UserStore.worlds`, each write one
//     transaction of the application's write queue and the draft written on the version it was read at, so a second
//     writer finds the draft moved, whoever it is;
//   - a folder of files by path (`hostBacking`): the way today's side keeps them, which the migration reads through
//     today's own world store and an old runtime still writes.

import type { Store } from "../store";
import type { UserWorlds } from "../store/worlds";
import type { WriteQueue } from "../app";
import type { HostPort } from "../shared/host";
import type { RevisionId, UserId, WorldId } from "../shared/ids";
import { pathSafe } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { RevisionNote } from "../shared/world";

/** A draft write or drop: done, at the version the draft is at now; or not done, the draft having moved on. */
export type DraftOutcome = { done: true; version: number } | { done: false };

/** What lands when a revision becomes the head: the document, the index that names it, the history note when the head moved, and the draft it settles. */
export interface CommitParts {
  revision: RevisionId;
  document: string;
  index: string;
  /** The note the head's move adds to the world's history; null where the head did not move. */
  note: RevisionNote | null;
  /** The history file whole with that note in it, for a folder of files that keeps it as one file. */
  history: string | null;
  /** The stored draft goes with the commit (the index it writes already counts it as dropped). */
  dropDraft: boolean;
  /** The draft version the commit was worked out on: a store holding the draft at another version lands nothing. */
  madeOn?: number;
}

export interface WorldBacking {
  /** A file of the world as text; null where it has none. */
  read(user: UserId, world: WorldId, file: string): Promise<string | null>;
  /** Every world the user has an index of. */
  worlds(user: UserId): Promise<WorldId[]>;
  /** Writes the index, a history or a revision file. The draft goes by `writeDraft`. */
  write(user: UserId, world: WorldId, file: string, text: string): Promise<void>;
  /** A commit's files, landing together where the backing can; false where the draft had moved on (nothing landed). */
  commit(user: UserId, world: WorldId, parts: CommitParts): Promise<boolean>;
  /** Writes the draft made on version `madeOn`; the text carries the version it makes. Not written where the draft is at another version now. */
  writeDraft(user: UserId, world: WorldId, text: string, madeOn: number): Promise<DraftOutcome>;
  /** Drops the draft made on version `madeOn` (a discard): the world's count takes the next version and the draft goes. */
  dropDraft(user: UserId, world: WorldId, madeOn: number): Promise<DraftOutcome>;
  /** Takes every file of the world away. */
  remove(user: UserId, world: WorldId): Promise<void>;
  /** Keeps a damaged file as `<file>.corrupt-<epoch ms>` beside it, so a fresh one can be written; null where it could not be kept. */
  setAside(user: UserId, world: WorldId, file: string, what: string, why: string): Promise<string | null>;
}

const decoder = new TextDecoder();

/** What a damaged file's kept copy appends to its name, before the epoch milliseconds of the set-aside. */
export const CORRUPT_SUFFIX = ".corrupt-";

// ---------------------------------------------------------------- the store's table

/** The store's own table, through the application's one write queue. */
export function storeBacking(store: Pick<Store, "user">, writes: WriteQueue, log: (message: string, fields: Record<string, string>) => void = () => undefined): WorldBacking {
  const of = (user: UserId): UserWorlds => store.user(user).worlds;
  const text = (bytes: Uint8Array | null): string | null => (bytes === null ? null : decoder.decode(bytes));
  return {
    read: async (user, world, file) => text(of(user).part(world, file)?.bytes ?? null),
    worlds: async (user) => of(user).worlds(),
    async write(user, world, file, body) {
      const w = of(user);
      if (file === "index.json") await writes.run(() => w.putIndex(world, body), "keeping a world's index");
      else if (file === "history.json") throw new Error("a world's history grows by a commit's note alone");
      else {
        const match = /^rev\/([^/]+)\.json$/.exec(file);
        if (match === null) throw new Error(`"${file}" is no file of a world's`);
        await writes.run(() => w.putRevision(world, body, match[1]), "keeping a world revision");
      }
    },
    async commit(user, world, parts) {
      const w = of(user);
      return await writes.run(() => {
        if (parts.madeOn !== undefined && w.index(world) !== null && w.draft(world).version !== parts.madeOn) return false;
        w.putRevision(world, parts.document, parts.revision);
        w.putIndex(world, parts.index);
        if (parts.note !== null) w.appendHistory(world, parts.note);
        if (parts.dropDraft) w.removeDraft(world);
        return true;
      }, "committing a world's revision");
    },
    writeDraft: async (user, world, body, madeOn) => {
      const out = await writes.run(() => of(user).writeDraft(world, body, madeOn), "keeping a world's draft");
      return out.done ? { done: true, version: out.version } : { done: false };
    },
    dropDraft: async (user, world, madeOn) => {
      const out = await writes.run(() => of(user).dropDraft(world, madeOn), "discarding a world's draft");
      return out.done ? { done: true, version: out.version } : { done: false };
    },
    remove: (user, world) => writes.run(() => of(user).remove(world), "removing a world"),
    // A row of the store is written whole by RPE alone: a damaged one is said, and the next commit's note starts the history afresh.
    setAside: async (user, _world, file, what, why) => {
      log(`the ${what} file was ${why}; a fresh one is used`, { user, file });
      return null;
    },
  };
}

// ---------------------------------------------------------------- a folder of files by path

function dir(world: WorldId): string {
  if (!pathSafe(world)) throw new Error("invalid world id");
  return `worlds/${world}/`;
}

function draftCount(index: string | null): number {
  try {
    const raw: unknown = JSON.parse(index ?? "null");
    return isRecord(raw) && typeof raw.draftVersion === "number" && Number.isSafeInteger(raw.draftVersion) && raw.draftVersion > 0 ? raw.draftVersion : 0;
  } catch {
    return 0;
  }
}

/**
 * Files by storage path as today's world store writes them, each temp-then-move: the host's storage. No version is held beside
 * the draft here (the host has one writer at a time, the world store's own queue), so a draft write is always done.
 */
export function hostBacking(host: Pick<HostPort, "storage" | "log">): WorldBacking {
  const put = async (path: string, text: string, user: UserId): Promise<void> => {
    await host.storage.write(`${path}.tmp`, text, user);
    await host.storage.move(`${path}.tmp`, path, user);
  };
  const dropped = async (world: WorldId, user: UserId): Promise<void> => {
    try {
      await host.storage.remove(`${dir(world)}draft.json`, user);
    } catch (error) {
      throw new Error(`the draft is dropped, but its file couldn't be removed (${error instanceof Error ? error.message : String(error)}); it no longer reads as the draft`);
    }
  };
  return {
    read: (user, world, file) => host.storage.read(`${dir(world)}${file}`, user),
    async worlds(user) {
      const ids = new Set<string>();
      for (const path of await host.storage.list("worlds/", user)) {
        const match = /^worlds\/([^/]+)\/index\.json$/.exec(path);
        if (match?.[1]) ids.add(match[1]);
      }
      return [...ids];
    },
    write: (user, world, file, text) => put(`${dir(world)}${file}`, text, user),
    async commit(user, world, parts) {
      await put(`${dir(world)}rev/${parts.revision}.json`, parts.document, user);
      await put(`${dir(world)}index.json`, parts.index, user);
      if (parts.history !== null) await put(`${dir(world)}history.json`, parts.history, user);
      if (parts.dropDraft) await dropped(world, user);
      return true;
    },
    writeDraft: async (user, world, text, madeOn) => {
      await put(`${dir(world)}draft.json`, text, user);
      return { done: true, version: madeOn + 1 };
    },
    async dropDraft(user, world, madeOn) {
      const index = await host.storage.read(`${dir(world)}index.json`, user);
      if (index === null) throw new Error(`world ${world} not found`);
      const count = Math.max(draftCount(index), madeOn) + 1;
      let raw: unknown;
      try {
        raw = JSON.parse(index);
      } catch {
        raw = {};
      }
      await put(`${dir(world)}index.json`, JSON.stringify({ ...(isRecord(raw) ? raw : {}), draftVersion: count }), user);
      await dropped(world, user);
      return { done: true, version: count };
    },
    async remove(user, world) {
      for (const path of await host.storage.list(dir(world), user)) await host.storage.remove(path, user);
    },
    async setAside(user, world, file, what, why) {
      const path = `${dir(world)}${file}`;
      try {
        let at = Date.now();
        while ((await host.storage.read(`${path}${CORRUPT_SUFFIX}${at}`, user)) !== null) at++;
        const aside = `${path}${CORRUPT_SUFFIX}${at}`;
        await host.storage.move(path, aside, user);
        host.log("warn", `[LumiRPEngine] the ${what} file was ${why}; it is kept as ${aside} and a fresh one is used`, user);
        return aside;
      } catch (error) {
        host.log("warn", `[LumiRPEngine] the ${what} file was ${why} and could not be set aside (${error instanceof Error ? error.message : String(error)}); a fresh one is used`, user);
        return null;
      }
    },
  };
}
