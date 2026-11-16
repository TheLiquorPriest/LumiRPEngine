// The file tree's registration with the application (plan §4.1): its tables, its settings, the
// shipped level of the agents' files laid in the data folder, and its routes. The sizes of the chats'
// folders are kept as the tree is written, and checked against the disk in the background: once when the
// server starts for every chat not yet kept, and then every `storage.recheckHours`.

import { SHIPPED_GUIDANCE } from "rp-harness/helpers";
import { type Area, NO_OWNER } from "../app";
import { TREE_TABLES } from "./chats";
import { layDefaults } from "./defaults";
import { treeRoutes, type TreeRoutesDeps } from "./routes";
import { treeSettingsOf, TREE_SETTINGS } from "./settings";
import { RPE_GUIDANCE } from "./shipped";
import { ChatMeasurer } from "./storage";

/** What the tree takes from the turn lane: its chats and suggestions, whether a turn of a chat goes on, and the stack an agent gets. */
export type TreeTakes = Omit<TreeRoutesDeps, "files" | "db" | "writes" | "now" | "backups" | "copiesKept" | "measurer">;

/**
 * The shipped files are laid when the tree mounts, before the areas after it: the turn lane reads them as it is made. The
 * routes are made once the turn lane is mounted, from `takes`.
 */
export function treeArea(takes: () => TreeTakes): Area {
  let measurer: ChatMeasurer | null = null;
  let timer: Timer | undefined;
  return {
    name: "tree",
    tables: [TREE_TABLES],
    settings: TREE_SETTINGS,
    mount: async (at) => {
      // The record of what an update changed of the shipped files is the user's: the app opens only for one.
      const user = at.config.lumiverse.user;
      if (user === null) throw new Error(NO_OWNER);
      await layDefaults({ files: at.paths.files, scratch: at.paths.root, sources: { rph: SHIPPED_GUIDANCE, rpe: RPE_GUIDANCE }, writes: at.writes, user, now: at.now });
    },
    mounted: (at) => {
      const taken = takes();
      measurer = new ChatMeasurer({ files: at.paths.files, chats: taken.chats, now: at.now, failed: (chat, error) => at.log.warn("A chat's folder could not be measured for the Storage page.", { chat, error: error instanceof Error ? error.message : String(error) }) });
      at.routes.add("tree", treeRoutes({ files: at.paths.files, db: at.db, writes: at.writes, now: at.now, backups: at.paths.backups, copiesKept: at.config.database.copiesKept, measurer, ...taken }));
    },
    started: async (at) => {
      const user = at.config.lumiverse.user;
      if (user === null || measurer === null) return;
      const check = async (): Promise<void> => {
        const { recheckHours } = await treeSettingsOf({ files: at.paths.files, character: null, chat: null }, at.log);
        measurer?.requestStale(user, recheckHours * 3_600_000);
      };
      await check();
      timer = setInterval(() => void check(), 3_600_000);
      timer.unref();
    },
    stopping: () => {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
