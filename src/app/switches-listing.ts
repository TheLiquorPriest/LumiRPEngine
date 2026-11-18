// What runs a command or calls out is listed the moment anything looks for it (plan §5.4, §16): a hook, a rule's command, a command
// tool, an MCP server or an HTTP address written in a file, added on a page, or typed into a file with an editor on the server, is
// listed as waiting before any agent loads it, and runs only once `rpe allow` on the server switches it on. RPH lists what a
// scope's files name (`Harness.external.list`) and asks the registry (`switches.ts`) for each, which lists a thing it has not seen
// for the user as waiting. This asks it to look at the files as they stand now: when RPE starts, before every read of the list
// (`rpe allow`, `rpe status`, the page's list), and after a file of the kinds that can name such a thing is written through RPE's own
// routes. A run asks the registry itself, as RPH reads the files for it, so what it would run is listed at that moment too.

import type { ExternalApi, Log, Scope } from "rp-harness/contract";

/** A file of the user's that landed through RPE's Files routes, as the tree's `written` hook tells it. */
export interface SavedFile {
  user: string;
  chat: string | null;
  path: string;
  level: string;
}

export interface SwitchesListingDeps {
  /** RPH's list of what a scope's files name that runs a command or calls out, once the turn lane is mounted. */
  external(): Pick<ExternalApi, "list">;
  /** The user this RPE belongs to; null before one is set. */
  owner(): string | null;
  /** The scope the user's files are read at: a chat's, or with no chat the levels every chat shares. */
  scope(user: string, chat: string | null): Scope;
  /** Every chat RPE keeps a folder for, for the user, that Lumiverse has not deleted: each has files of its own and its character's. */
  chats(user: string): readonly string[];
  log(): Log;
}

/** How many chats' files are looked at at once. */
const AT_ONCE = 8;

/** Where a file that may name something that runs or calls out lives: the hooks, rules and tools folders of any level, and a hooks file. */
const KINDS = /(^|\/)(\.?(rules|hooks)|\.tools)(\/|$)|(^|\/)hooks\.yml$/;

/** Whether a file written at `path` (in the agents' view) can add or change what runs a command or calls out. */
export function namesWhatRuns(path: string): boolean {
  return KINDS.test(path);
}

export interface SwitchesListing {
  /** Lists what the user's files name, the shared levels and every chat's, as they stand now; resolves once it has looked, whatever it found. */
  look(): Promise<void>;
  /** Lists what a chat's (or the shared levels') files name after one was written, when it can have named something. */
  written(saved: SavedFile): Promise<void>;
}

export function switchesListing(deps: SwitchesListingDeps): SwitchesListing {
  const list = async (user: string, chat: string | null): Promise<void> => {
    try {
      await deps.external().list(deps.scope(user, chat));
    } catch (error) {
      // The read that asked has what it has whatever this finds: a listing that failed is told, and made again at the next look.
      deps.log().warn("What the files name that runs a command or calls out could not be listed.", { chat, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const lookAll = async (): Promise<void> => {
    const user = deps.owner();
    if (user === null) return;
    await list(user, null);
    const chats = [...deps.chats(user)];
    await Promise.all(
      Array.from({ length: Math.min(AT_ONCE, chats.length) }, async () => {
        for (let chat = chats.pop(); chat !== undefined; chat = chats.pop()) await list(user, chat);
      }),
    );
  };
  // One look at a time. A call that comes while one is under way may have written its file after that look read it: it waits for a look that starts after it, which every call that comes meanwhile shares.
  let under: Promise<void> | null = null;
  let after: Promise<void> | null = null;
  const look = (): Promise<void> => {
    if (under === null) {
      const done = lookAll().finally(() => {
        under = null;
      });
      under = done;
      return done;
    }
    after ??= under.then(() => {
      after = null;
      return look();
    });
    return after;
  };
  return {
    look,
    written: async (saved) => {
      if (namesWhatRuns(saved.path)) await list(saved.user, saved.chat);
    },
  };
}
