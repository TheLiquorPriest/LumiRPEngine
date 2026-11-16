// What runs a command or calls out is listed the moment it is written (plan §5.4, §16): a hook, a rule's command, a command
// tool, an MCP server or an HTTP address written in a file, or added on a page, is listed as waiting at once, before any agent
// loads it, and runs only once `rpe allow` on the server switches it on. RPH lists what a scope's files name (`Harness.external.list`)
// and asks the registry (`switches.ts`) for each, which lists a thing it has not seen for the user as waiting; this asks it to look
// when RPE starts, and whenever a file of the kinds that can name such a thing is written through RPE's own routes. A change made on
// disk by other means is listed when RPH next reads the files.

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
  log(): Log;
}

/** Where a file that may name something that runs or calls out lives: the hooks, rules and tools folders of any level, and a hooks file. */
const KINDS = /(^|\/)(\.?(rules|hooks)|\.tools)(\/|$)|(^|\/)hooks\.yml$/;

/** Whether a file written at `path` (in the agents' view) can add or change what runs a command or calls out. */
export function namesWhatRuns(path: string): boolean {
  return KINDS.test(path);
}

export interface SwitchesListing {
  /** Lists what the user's shared levels name, when RPE starts. */
  start(): Promise<void>;
  /** Lists what a chat's (or the shared levels') files name after one was written, when it can have named something. */
  written(saved: SavedFile): Promise<void>;
}

export function switchesListing(deps: SwitchesListingDeps): SwitchesListing {
  const list = async (user: string, chat: string | null): Promise<void> => {
    try {
      await deps.external().list(deps.scope(user, chat));
    } catch (error) {
      // The write that asked has landed whatever this finds: a listing that failed is told, and made again at the next write.
      deps.log().warn("What the files name that runs a command or calls out could not be listed.", { chat, error: error instanceof Error ? error.message : String(error) });
    }
  };
  return {
    start: async () => {
      const user = deps.owner();
      if (user !== null) await list(user, null);
    },
    written: async (saved) => {
      if (namesWhatRuns(saved.path)) await list(saved.user, saved.chat);
    },
  };
}
