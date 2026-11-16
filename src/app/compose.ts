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

import { type Clock, type CreateHarnessOptions, loadGuidance } from "rp-harness";
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
import { levelFiles, NO_CHAT, RPE_GUIDANCE, treeReader } from "../tree";
import { MACHINE_CLOCK, NO_SESSION, turnSettings, type Turns } from "../turn";
import { turnArea } from "../turn/area";
import { bootstrapArea } from "../turn/bootstrap/area";
import { sessionRoutes } from "../turn/session-routes";
import { guidanceTexts } from "../turn/texts";
import { switchesListing } from "./switches-listing";
import { appArea } from "./area";
import type { TurnTimes } from "./service-timings";
import type { App, Area } from "./app";
import type { SettingsReader } from "./config-read";
import { RouteError } from "./routes";

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
  const files = (user: string, chat: string) => guidanceTexts(made().files, scope(user, chat), made().env.log);
  const settings = (user: string, chat: string) => turnSettings(made().files, scope(user, chat), made().env.log);
  // What a file written through the Files routes names that runs a command or calls out is listed as waiting at once.
  const listing = switchesListing({ external: () => made().harness.external, owner: () => app().config.lumiverse.user, scope: (user, chat) => scope(user, chat ?? NO_CHAT), log: () => app().log });
  // A chat RPE has not played yet, placed as its first turn places it: under its character, by Lumiverse's own names for both.
  const place = async (owner: string, chat: string) => {
    const known = made().chats.folders(owner, chat);
    if (known !== null) return known;
    const reads = door.lumiverse()?.reads;
    if (reads === undefined) throw new RouteError(503, "RPE is not connected to Lumiverse, so it cannot make that chat's folder yet: try again once it is.");
    const lv = await reads.chat(chat);
    if (lv === null) throw new RouteError(404, `Lumiverse has no chat ${chat} of yours.`);
    const character = lv.character === null ? null : await reads.character(lv.character);
    return await made().chats.place(owner, chat, { character: character === null ? null : { id: character.id, name: character.name }, chat: { name: lv.name } });
  };
  // Every session of a chat, page by page.
  const sessionsOf = async (user: string, chat: string) => {
    const all: Awaited<ReturnType<ReturnType<typeof made>["harness"]["sessions"]["list"]>>["sessions"] = [];
    for (let after: string | undefined; ; ) {
      const page = await made().harness.sessions.list(user, chat, after === undefined ? undefined : { after });
      all.push(...page.sessions);
      if (page.next === undefined) return all;
      after = page.next;
    }
  };
  // "Apply now" (R-119): the chat's open session starts its opening block afresh; none open, nothing to renew.
  const apply = async (user: string, chat: string): Promise<{ session: string | null }> => {
    const open = (await sessionsOf(user, chat)).find((s) => s.state === "open");
    if (open === undefined) return { session: null };
    await made().harness.definitions.apply({ user, chat, session: open.id });
    return { session: open.id };
  };
  // The sessions of a chat that are open now: a prune of the chat's files leaves them.
  const openSessions = async (user: string, chat: string): Promise<string[]> => (await sessionsOf(user, chat)).filter((s) => s.state === "open").map((s) => s.id);

  const areas: Area[] = [
    appArea({
      opened: (at) => {
        opened = at;
      },
      settings: (at) => {
        const owner = at.config.lumiverse.user ?? "";
        // A chat RPE has not played yet, placed as its first turn places it: under its character, by Lumiverse's own names for both.
        const placed = (chat: string) => place(owner, chat);
        return {
          // The levels of the agents' tree that have a config file, where they are on disk; a chat's own once it has its folder, or made for a write.
          levels: async (chat, make = false) => {
            const folders = chat === null ? null : make ? await placed(chat) : made().chats.folders(owner, chat);
            return levelFiles({ files: at.paths.files, character: folders?.character ?? null, chat: folders?.chat ?? null });
          },
          connections: async () => (await made().harness.models.list(owner)).connections.map((c) => ({ id: c.id, name: c.name })),
        };
      },
      // The web app's sign-in with a Lumiverse account asks Lumiverse through the door.
      accounts: door.accounts,
      // The Runtime page's timings: the latest turns' moments, as the turn lane keeps them, of one chat or the newest across chats.
      turns: async (user, chat, limit) => {
        const runs = made().runs;
        const out: TurnTimes[] = [];
        for (const c of chat === null ? runs.chats(user) : [{ chat, last: Number.POSITIVE_INFINITY }]) {
          const oldest = out.length < limit ? Number.NEGATIVE_INFINITY : (out[limit - 1]?.received ?? Number.NEGATIVE_INFINITY);
          if (c.last < oldest) break;
          for (const r of runs.ofChatKept(user, c.chat, limit)) out.push({ chat: c.chat, turn: r.turn, received: r.received, started: r.started, firstWord: r.firstWord, released: r.released, ended: r.ended, intent: r.intent, thinking: r.thinking, intake: r.intake, wait: r.wait });
          out.sort((a, b) => b.received - a.received);
        }
        return out.slice(0, limit);
      },
    }),
    storeArea(),
    loreArea(() => ({ store: made().store, turns: made().prompts.lore, indexing: { index: made().loreIndex, jobs: made().harness.jobs, definitions: made().harness.definitions, scope: (user, chat) => scope(user, chat) }, secrecy: { settingsFor: made().secretSettings, wording: made().secretMarks, log: (message) => made().env.log.warn(message) } })),
    ifaceArea(() => ({ store: made().store })),
    migrateArea({ identifier: EXTENSION_IDENTIFIER }),
    // The tree lays the shipped files before the areas after it read them.
    treeArea(() => ({
      chats: made().chats,
      suggestions: made().suggestions,
      turning,
      // With no chat named, the stack the shipped and global levels give: a chat that is never placed has no levels of its own.
      stack: (user, chat, agent) => made().harness.definitions.stack(scope(user, chat ?? NO_CHAT), agent),
      apply,
      place,
      openSessions,
      // A deleted chat's turns, changes and snapshots go the store's own way: kept where a branch reads them.
      // The snapshots of a living chat's folds are derived: the fold makes them again when next due, every answer the same.
      derived: [{ name: "snapshots", keeps: ["snapshot"], drop: async (user, chat) => void (await app().writes.run(() => made().store.user(user).dropSnapshots(chat), "dropping a chat's snapshots")) }],
      dropStored: (user, chat) => app().writes.run(() => made().store.user(user).deleteChat(chat), "removing a deleted chat's turns"),
      // What RPH itself makes of the files of a chat's view, for the Files page.
      guidance: (user, chat) => loadGuidance(made().files, scope(user, chat ?? NO_CHAT)),
      written: (saved) => listing.written(saved),
    })),
    turn.area,
    bootstrapArea({
      turns: made,
      carried: async (app, user) => (lastReport(app.db, user)?.imports ?? []).filter((c) => c.outcome === "imported" || c.outcome === "replaced").map((c) => c.chatId),
    }),
    castArea(() => ({ store: made().store, turning, files, settings: async (user, chat) => (await settings(user, chat)).cast })),
    storyArea(() => ({ store: made().store, turning, files, settings: async (user, chat) => (await settings(user, chat)).story })),
    buildArea(() => ({ store: made().store, guidance: RPE_GUIDANCE })),
    playArea(() => ({
      store: made().store,
      turning,
      guidance: RPE_GUIDANCE,
      settings: async (user: string, chat: string) => {
        const s = await settings(user, chat);
        return { dueItems: s.engine.dueItems, editOps: s.engine.editOps, taps: s.taps };
      },
    })),
    { name: "switches", started: () => listing.start() },
    // The Sessions page's routes, over the turn lane's harness and store once the turn area is mounted.
    {
      name: "sessions",
      mounted: (at) => {
        at.routes.add("sessions", sessionRoutes({ turns: made(), writes: at.writes }));
      },
    },
    door.area,
  ];

  return { areas, door, turns: turn.turns, settings: reader };
}
