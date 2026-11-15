// The file tree's registration with the application (plan §4.1): its tables, its settings, the
// shipped level of the agents' files laid in the data folder, and its routes.

import { SHIPPED_GUIDANCE } from "rp-harness";
import { type Area, NO_OWNER } from "../app";
import { TREE_MIGRATIONS } from "./chats";
import { layDefaults } from "./defaults";
import { treeRoutes, type TreeRoutesDeps } from "./routes";
import { TREE_SETTINGS } from "./settings";
import { RPE_GUIDANCE } from "./shipped";

/** What the tree takes from the turn lane: its chats and suggestions, whether a turn of a chat goes on, and the stack an agent gets. */
export type TreeTakes = Omit<TreeRoutesDeps, "files" | "db">;

/**
 * The shipped files are laid when the tree mounts, before the areas after it: the turn lane reads them as it is made. The
 * routes are made once the turn lane is mounted, from `takes`.
 */
export function treeArea(takes: () => TreeTakes): Area {
  return {
    name: "tree",
    tables: [{ area: "files", migrations: TREE_MIGRATIONS }],
    settings: TREE_SETTINGS,
    mount: async (at) => {
      // The record of what an update changed of the shipped files is the user's: the app opens only for one.
      const user = at.config.lumiverse.user;
      if (user === null) throw new Error(NO_OWNER);
      await layDefaults({ files: at.paths.files, scratch: at.paths.root, sources: { rph: SHIPPED_GUIDANCE, rpe: RPE_GUIDANCE }, writes: at.writes, user, now: at.now });
    },
    mounted: (at) => at.routes.add("tree", treeRoutes({ files: at.paths.files, db: at.db, ...takes() })),
  };
}
