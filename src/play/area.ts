// The play panels' registration with the application (plan §4.1): their routes. They bring no
// tables: they read and write the chat's state through the store.

import type { Area } from "../app";
import { mapWalkRoutes } from "./map-walk";
import { playRoutes } from "./routes";
import { thingsRoutes } from "./things";
import { PlayService, type PlayDeps } from "./service";

/**
 * What the play panels take from the composition: the store each chat's state is in, whether a turn of a chat goes on, the guidance
 * folder holding their words, the chat's settings they read, the turn lane's requests, Lumiverse's own routes as him, and a writer of
 * one setting at a chat's level (the old route's tidy-up switch).
 */
export type PlayTakes = Pick<PlayDeps, "store" | "turning" | "guidance" | "settings" | "requests" | "lumiverse" | "writeChatSetting">;

/** `takes` is asked once the turn lane is mounted, whose store the panels read: the routes are made then. */
export function playArea(takes: () => PlayTakes): Area {
  return {
    name: "play",
    mounted: (at) => {
      const taken = takes();
      at.routes.add("play", playRoutes(new PlayService({ writes: at.writes, live: at.live, log: at.log, ...taken })));
      at.routes.add("play-things", thingsRoutes(taken.store));
      at.routes.add("play-map-walk", mapWalkRoutes(taken.store));
    },
  };
}
