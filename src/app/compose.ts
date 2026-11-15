// RPE put together (plan §4.1): every area, in the order it is mounted, over one application. Each area
// names its own tables, settings, routes and hooks in a file of its own (`area.ts` in its folder), and
// this file names each area once and hands it what it takes from the others: the turn lane's store and
// guidance to the areas that read them, the door's reads of Lumiverse to the turn lane, and what a
// migration carried of a chat. A route, a table, a setting or a view added later is added in its area's
// file; a new area is one more name here.
//
// The shipped level of the agents' files is laid by the tree, the first of the areas that read them,
// and the turn lane builds RPH's environment and the harness over the areas before it. The areas that
// serve over the turn lane (the cast, the story, Build, the play panels, the tree's routes, bootstrap)
// add their routes once every area is mounted. The door to Lumiverse mounts last, playing each tagged
// reply through the turn lane, and opens its sockets once the server listens.
//
// The migration's tables are made by the running application as by the migration itself, so every
// install's database holds them at this build's version whether or not a migration ever ran there. The
// turn lane reads no migration: what one carried of a chat is handed to it from here.

import type { Clock, CreateHarnessOptions } from "rp-harness";
import { doorArea } from "../adapter/lumiverse/area";
import { EXTENSION_IDENTIFIER } from "../adapter/lumiverse/pipe-wire";
import { bunSocket } from "../adapter/lumiverse/socket";
import type { AdapterDeps, LumiverseDoor } from "../adapter/lumiverse/mount";
import { buildArea } from "../build/area";
import { castArea } from "../cast/area";
import { ifaceArea } from "../iface/area";
import { loreArea } from "../lore/area";
import { MIGRATED_NOTICE, MIGRATED_PART, migratedChat } from "../migrate/briefing";
import { migrateArea } from "../migrate/area";
import { lastReport } from "../migrate/tables";
import { playArea } from "../play/area";
import { storeArea } from "../store/area";
import { storyArea } from "../story/area";
import { treeArea } from "../tree/area";
import { RPE_GUIDANCE, treeReader } from "../tree";
import { MACHINE_CLOCK, NO_SESSION, turnSettings, type Turns } from "../turn";
import { turnArea } from "../turn/area";
import { bootstrapArea } from "../turn/bootstrap/area";
import { guidanceTexts } from "../turn/texts";
import { appArea } from "./area";
import type { App, Area } from "./app";
import type { SettingsReader } from "./config-read";

export interface ComposeOptions {
  /** Lumiverse's network as the door reaches it: the machine's when absent. */
  fetch?: AdapterDeps["fetch"];
  open?: AdapterDeps["open"];
  sleep?: AdapterDeps["sleep"];
  clock?: Clock;
  /** Tests only: the models agents run on, in place of the model layer's, and RPH's ids. */
  harness?: Pick<CreateHarnessOptions, "models" | "ids">;
}

export interface Composition {
  /** Every area, in the order it is mounted. */
  readonly areas: readonly Area[];
  readonly door: LumiverseDoor;
  /** The turn lane and the harness, once mounted; null before. */
  turns(): Turns | null;
  /** The one reader of the config levels every area is handed, once the app is open. */
  readonly settings: SettingsReader;
}

export function compose(options: ComposeOptions = {}): Composition {
  let opened: App | null = null;
  const app = (): App => {
    if (opened === null) throw new Error("RPE is not open yet, so its settings are not read.");
    return opened;
  };
  // The one reader of the config levels, every area's: over the tree's levels, a chat's placed by the turn lane's chats.
  const reader = treeReader({ files: () => app().paths.files, folders: (user, chat) => made().chats.folders(user, chat), log: () => app().log, known: () => app().settings });
  const door = doorArea({
    fetch: options.fetch ?? ((url, init) => fetch(url, init)),
    open: options.open ?? bunSocket,
    clock: options.clock ?? MACHINE_CLOCK,
    sleep: options.sleep ?? ((ms) => Bun.sleep(ms)),
    settings: reader,
  });
  const turn = turnArea({
    lumiverse: door.lumiverse,
    migrated: (app, store) => ({ part: MIGRATED_PART, notice: MIGRATED_NOTICE, fields: (user, chat) => migratedChat({ db: app.db, store, user, chat }) }),
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.harness !== undefined ? { harness: options.harness } : {}),
  });
  const made = (): Turns => {
    const turns = turn.turns();
    if (turns === null) throw new Error("RPE's turn lane is not mounted yet.");
    return turns;
  };
  // What the areas that read the turn lane's store are handed: whether a turn of a chat goes on, and the guidance files and settings in force for it.
  const scope = (user: string, chat: string) => ({ user, chat, session: NO_SESSION });
  const turning = (user: string, chat: string): boolean => made().runs.ofChat(user, chat).length > 0;
  const files = (user: string, chat: string) => guidanceTexts(made().files, scope(user, chat));
  const settings = (user: string, chat: string) => turnSettings(made().files, scope(user, chat), made().env.log);

  const areas: Area[] = [
    appArea((at) => {
      opened = at;
    }),
    storeArea(),
    loreArea(),
    ifaceArea(),
    migrateArea({ identifier: EXTENSION_IDENTIFIER }),
    // The tree lays the shipped files before the areas after it read them.
    treeArea(() => ({ chats: made().chats, suggestions: made().suggestions, turning, stack: (user, chat, agent) => made().harness.definitions.stack(scope(user, chat), agent) })),
    turn.area,
    bootstrapArea({
      turns: made,
      carried: async (app, user) => (lastReport(app.db, user)?.imports ?? []).filter((c) => c.outcome === "imported" || c.outcome === "replaced").map((c) => c.chatId),
    }),
    castArea(() => ({ store: made().store, turning, files, settings: async (user, chat) => (await settings(user, chat)).cast })),
    storyArea(() => ({ store: made().store, turning, files, settings: async (user, chat) => (await settings(user, chat)).story })),
    buildArea(() => ({ store: made().store, guidance: RPE_GUIDANCE })),
    playArea(() => ({ store: made().store, turning, guidance: RPE_GUIDANCE })),
    door.area,
  ];

  return { areas, door, turns: turn.turns, settings: reader };
}
