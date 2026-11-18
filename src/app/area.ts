// The app's own registration (plan §4.1): what the application itself adds to the areas' lists, its
// settings (the update's and the app's own limits), and the Settings routes over the whole registry.
// Its other routes are its own (`appRoutes`), made where the app opens. Mounted first, it tells the
// composition the app it is mounted in (`opened`), for what the composition hands the other areas.

import type { LumiverseAccounts } from "./accounts";
import type { App, Area } from "./app";
import { backupsRoute } from "./backups-route";
import { installFacts, SERVER_SETTINGS } from "./config";
import { PAGE_SETTINGS } from "./page-settings";
import { serviceRoutes, type TurnsTimed } from "./service-routes";
import { signinDeps, signinRoutes } from "./signin-routes";
import { type SettingsDeps, settingsRoutes } from "./settings-routes";
import { switchesRoutes } from "./switches-routes";
import type { SwitchesListing } from "./switches-listing";
import { UPDATE_SETTINGS } from "./update";

/** What the app area takes from the composition. */
export interface AppTakes {
  /** Told the app once it is mounted in it. */
  opened(app: App): void;
  /** Where a chat's levels are on disk, the model layer's connections and the agent definitions in force, from the areas that know them, for the Settings routes. */
  settings(app: App): Pick<SettingsDeps, "levels" | "connections" | "definitions">;
  /** What RPE asks of Lumiverse to sign a user in to the web app, from the door; none where RPE reaches no Lumiverse, and the sign-in with a Lumiverse account then says so. */
  accounts?: LumiverseAccounts;
  /** The latest turns' moments of a chat, or of all chats, for the Runtime page's timings. */
  turns?: TurnsTimed;
  /** What the files name that runs a command or calls out, looked at when RPE starts and before the list of what waits is read. */
  listing?: Pick<SwitchesListing, "look">;
}

export function appArea(takes?: AppTakes): Area {
  const listing = takes?.listing;
  return {
    name: "app",
    settings: [...UPDATE_SETTINGS, ...SERVER_SETTINGS, ...PAGE_SETTINGS],
    // The app asks every area to look at the files before it reads the list of switches (the command line's, the page's).
    ...(listing === undefined ? {} : { fills: { listFiles: () => listing.look() } }),
    ...(takes === undefined
      ? {}
      : {
          mount: (at: App) => {
            takes.opened(at);
            at.routes.add("service", serviceRoutes(at, takes.turns));
            at.routes.add("backups", [backupsRoute(at.paths.backups)]);
            at.routes.add("switches", switchesRoutes(at.db, () => at.hooks.listFiles()));
            at.routes.add("signin", signinRoutes(signinDeps(at, takes.accounts ?? null)));
          },
          // Once every area is mounted: the levels and connections come from the tree and the turn lane.
          mounted: (at: App) => at.routes.add("settings", settingsRoutes({ settings: at.settings, facts: () => installFacts(at.config, at.paths), ...takes.settings(at) })),
          // The server listens: what the user's files already name that runs a command or calls out is listed as waiting.
          started: async () => void (await listing?.look()),
        }),
  };
}
