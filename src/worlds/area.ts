// The worlds' registration with the application (plan §4.1, §14; PlanChatUI-B1): its settings (the world store's limits), the live kind
// that tells every open page of a change to a world, and the world service every caller of his worlds is handed. Its routes (B6, B4) are
// added here as their packages land. His worlds are kept in the store's own table; this area adds no table.
//
// A change to a world, from any writer (a page, a tool of an agent, a job's Apply, a chat's map kept in its world, an approved lore
// proposal), is told once the store has it, to every page of the user: kind `world` on the user's own channel.

import { type Area, type App, LIVE_USER, liveKind, shape } from "../app";
import { diskTexts, readConfig } from "../app/config-read";
import type { Store } from "../store";
import { WORLD_SETTING_DEFS, WORLD_SETTINGS, type WorldLimits } from "./limits";
import { WorldService } from "./service";

const T = shape.text();

/** A change to a world, told to every page of its user: which part, and where the draft stands after a change of the draft. */
export const WORLD_KIND = liveKind("world", {
  data: shape.named(
    "WorldChanged",
    "A change to one of his worlds, once it is kept: the world, what was written (a revision, the index, the draft, a history note, or the whole world removed), and for the draft its version and whether one is stored now.",
    shape.object({
      world: shape.field(T, "The world's id."),
      part: shape.field(shape.oneOf("revision", "index", "draft", "history", "removed"), "What was written."),
      revision: shape.optional(T, "For a revision: the revision kept."),
      version: shape.optional(shape.whole(), "For the draft: its version after the write."),
      stored: shape.optional(shape.yesNo(), "For the draft: whether one is stored now (false once it is discarded or committed)."),
    }),
  ),
  does: "A world of his changed: the page reads what it shows of that world again.",
});

/** What the area takes from the composition: the store his worlds are kept in, once the turn lane has made it. */
export interface WorldsTakes {
  store: Store;
}

export interface WorldsArea extends Area {
  /** The world service, once the area is mounted; the one write path to his worlds. */
  service(): WorldService;
}

/** The limits `worlds.*` give now, read from the global level's file at each use. */
export async function worldLimitsOf(app: Pick<App, "paths" | "log">): Promise<WorldLimits> {
  const file = app.paths.globalConfig;
  return readConfig(await diskTexts([{ level: "global", file, disk: file }]), app.log, WORLD_SETTINGS).numbers(WORLD_SETTING_DEFS);
}

/** `takes` is asked once the turn lane is mounted, whose store his worlds are kept in: the service is made then. */
export function worldsArea(takes: () => WorldsTakes): WorldsArea {
  let made: WorldService | null = null;
  return {
    name: "worlds",
    settings: WORLD_SETTINGS,
    liveKinds: [WORLD_KIND],
    mounted: (at) => {
      const { store } = takes();
      made = new WorldService({ store, writes: at.writes, log: at.log, limits: () => worldLimitsOf(at) });
      store.onWorld((change) => {
        const { user, ...told } = change;
        // The store's change notice names the user whose world changed; this RPE belongs to one, whose pages these are.
        if (user === at.config.lumiverse.user) WORLD_KIND.publish(at.live, LIVE_USER, told);
      });
    },
    service() {
      if (made === null) throw new Error("The worlds area is not mounted yet, so his worlds cannot be read or written.");
      return made;
    },
  };
}
