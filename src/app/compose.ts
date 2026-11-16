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
import type { SessionView } from "rp-harness/contract";
import { doorArea } from "../adapter/lumiverse/area";
import { loreBooks } from "../adapter/lumiverse/books";
import { EXTENSION_IDENTIFIER } from "../adapter/lumiverse/pipe-wire";
import { bunSocket } from "../adapter/lumiverse/socket";
import type { AdapterDeps, LumiverseDoor } from "../adapter/lumiverse/mount";
import { agentsArea } from "../agents/area";
import { buildArea } from "../build/area";
import { worldsArea } from "../worlds/area";
import { castArea } from "../cast/area";
import { ifaceArea } from "../iface/area";
import { loreArea } from "../lore/area";
import { EntryNumbers, type LoreBooks, LoreProposals, type LoreWorldWrites, worldEntryWrites } from "../lore";
import { LORE_PROPOSAL_SETTING_DEFS } from "../lore/settings";
import { MIGRATED_NOTICE, MIGRATED_PART, migratedChat } from "../migrate/briefing";
import { oldRecord } from "../migrate/old-records";
import { migrateArea } from "../migrate/area";
import { lastReport } from "../migrate/tables";
import { playArea } from "../play/area";
import { storeArea } from "../store/area";
import { storyArea } from "../story/area";
import { treeArea } from "../tree/area";
import { levelFiles, MOUNTS, NO_CHAT, OwnFiles, RPE_GUIDANCE, treeReader } from "../tree";
import { MACHINE_CLOCK, NO_SESSION, turnSettings, type Turns } from "../turn";
import { turnArea } from "../turn/area";
import { globalConfig } from "../turn/settings";
import { bootstrapArea } from "../turn/bootstrap/area";
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
    // The earlier engine's record of a carried turn, as the migration kept it, for the engine's tools: the turn lane may not import the migration.
    carried: (app) => ({ record: (user, turn) => oldRecord(app.db, user, turn) }),
    proposals: () => proposals(),
    // The projection book is written to his books through the door's writes, once it is set up for a Lumiverse.
    projectionBooks: {
      create: (user, chat, name) => lumiverse().writes.createProjection(user, chat, name),
      replace: (user, book, entries) => lumiverse().writes.replaceProjection(user, book, entries),
      remove: (user, book) => lumiverse().writes.removeProjection(user, book),
    },
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.harness !== undefined ? { harness: options.harness } : {}),
  });
  const made = (): Turns => {
    const turns = turn.turns();
    if (turns === null) throw new Error("RPE's turn lane is not mounted yet.");
    return turns;
  };
  // The user's books as the lore reads them, and what RPE writes to them, through the door's parts once it is set up for a Lumiverse.
  const lumiverse = () => {
    const parts = door.lumiverse();
    if (parts === null) throw new Error("RPE is not set up for a Lumiverse, so it has no books to read or write.");
    return parts;
  };
  const booksNow = (): LoreBooks => loreBooks(lumiverse().reads, app().config.lumiverse.user ?? "");
  const books: LoreBooks = {
    attached: (user, chat, at) => booksNow().attached(user, chat, at),
    book: (user, id) => booksNow().book(user, id),
    entries: (user, book) => booksNow().entries(user, book),
    entry: (user, id) => booksNow().entry(user, id),
    list: async (user, chat) => {
      const now = booksNow();
      if (now.list === undefined) throw new Error("The door's books give no list of the user's books.");
      return await now.list(user, chat);
    },
  };
  // His worlds, kept by the worlds area: Build edits them through its service, and a proposal for a world's entry is approved through its store, once mounted.
  // The chats that play his worlds are listed with Lumiverse's name for each, where RPE is set up for a Lumiverse.
  const worlds = worldsArea(() => ({ store: made().store, turning, chatName: async (chat) => (await door.lumiverse()?.reads.chat(chat))?.name ?? null }));
  const build = buildArea(() => ({ store: made().store, worlds: worlds.service(), guidance: RPE_GUIDANCE }));
  const worldWrites = (): LoreWorldWrites => worldEntryWrites(worlds.service().worlds);
  // The agents' suggestions about lore, kept as proposals and written to his books only on his approval: one queue, made when first asked for.
  let proposed: LoreProposals | null = null;
  const proposals = (): LoreProposals =>
    (proposed ??= new LoreProposals({
      db: app().db,
      writes: app().writes,
      numbers: new EntryNumbers(app().db, app().writes),
      books,
      write: {
        update: (user, entry, fields, revision) => lumiverse().writes.update(user, entry, fields, revision),
        create: (user, book, fields) => lumiverse().writes.create(user, book, fields),
        remove: (user, entry, revision) => lumiverse().writes.remove(user, entry, revision),
      },
      worlds: {
        entry: (user, world, key) => worldWrites().entry(user, world, key),
        update: (user, world, key, fields, stamp) => worldWrites().update(user, world, key, fields, stamp),
      },
      settings: globalConfig(app().paths.files, app().log).numbers(LORE_PROPOSAL_SETTING_DEFS),
    }));
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
  const sessionsOf = async (user: string, chat: string): Promise<SessionView[]> => {
    const all: SessionView[] = [];
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
      // What the files name that runs a command or calls out is listed as waiting when RPE starts.
      listing,
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
    loreArea(() => ({
      store: made().store,
      turns: made().prompts.lore,
      indexing: { index: made().loreIndex, jobs: made().harness.jobs, definitions: made().harness.definitions, scope: (user, chat) => scope(user, chat) },
      secrecy: { settingsFor: made().secretSettings, wording: made().secretMarks, log: (message) => made().env.log.warn(message) },
      proposals: proposals(),
      projection: made().projection,
    })),
    ifaceArea(() => ({ store: made().store })),
    migrateArea({
      identifier: EXTENSION_IDENTIFIER,
      // His own file at the global level of the tree, written as he writes one on the Files page: `path` below the level's folder (`.agents/x.md`).
      writeAsUser: (user, path, text) => {
        const own = new OwnFiles({ files: app().paths.files, chats: made().chats, writes: app().writes, now: app().now });
        return own.writeAsUser(user, own.locationOf(user, null), `${MOUNTS.global}${path}`, "global", text);
      },
    }),
    // The tree lays the shipped files before the areas after it read them.
    treeArea(() => ({
      chats: made().chats,
      suggestions: made().suggestions,
      turning,
      // With no chat named, the stack the shipped and global levels give: a chat that is never placed has no levels of its own.
      stack: (user, chat, agent) => made().harness.definitions.stack(scope(user, chat ?? NO_CHAT), agent),
      // A part as RPH renders it for the chat, with the values of its last use there, for the Files page's preview.
      preview: async (user, chat, kind, name, text) => {
        const at = scope(user, chat ?? NO_CHAT);
        const { parts } = made().harness;
        const [part, values] = await Promise.all([parts.preview(at, kind, name, text), parts.lastFields(at, kind, name)]);
        return { part, values: values ?? null };
      },
      apply,
      place,
      openSessions,
      // A deleted chat's turns, changes and snapshots go the store's own way: kept where a branch reads them.
      // The snapshots of a living chat's folds are derived: the fold makes them again when next due, every answer the same.
      // The vectors of search by meaning and the state search's tokens are derived too: kept in the index file, made again from their sources when next searched.
      derived: [
        { name: "snapshots", keeps: ["snapshot"], drop: async (user, chat) => void (await app().writes.run(() => made().store.user(user).dropSnapshots(chat), "dropping a chat's snapshots")) },
        { name: "search by meaning", keeps: [], held: (user, chat) => made().meaning.held(user, chat), drop: (user, chat) => made().meaning.dropChat(user, chat) },
        { name: "state search", keeps: [], drop: async (user, chat) => void (await made().stateIndex.forget(user, chat)) },
      ],
      dropStored: (user, chat) => app().writes.run(() => made().store.user(user).deleteChat(chat), "removing a deleted chat's turns"),
      // What RPH itself makes of the files of a chat's view, for the Files page.
      guidance: (user, chat) => {
        const at = scope(user, chat ?? NO_CHAT);
        const { definitions, external, rules } = made().harness;
        return {
          rules: () => rules.list(at),
          definitions: () => definitions.list(at),
          stack: (agent) => definitions.stack(at, agent),
          // What the files name that runs or calls out, the hooks in force among them, as RPH lists it: RPH lists no other file's problems for a host.
          external: () => external.list(at),
        };
      },
      written: (saved) => listing.written(saved),
    })),
    turn.area,
    // The Agents page: his definitions with what each runs on, and the tools an agent's requests declare, as the harness gives them.
    agentsArea(() => ({ definitions: made().harness.definitions, scope: (user, chat) => scope(user, chat ?? NO_CHAT) })),
    bootstrapArea({
      turns: made,
      carried: async (app, user) => (lastReport(app.db, user)?.imports ?? []).filter((c) => c.outcome === "imported" || c.outcome === "replaced").map((c) => c.chatId),
    }),
    castArea(() => ({ store: made().store, files, settings: async (user, chat) => (await settings(user, chat)).cast, sources: made().sources })),
    storyArea(() => ({
      store: made().store,
      files,
      settings: async (user, chat) => (await settings(user, chat)).story,
      // The history window the last prompt kept and the story so far at the head, as the next briefing works them out.
      window: (user, chat) => made().lane.windowOf(user, chat),
      soFar: (user, chat) => made().lane.soFarAt(user, chat),
      // The places' settings for the chat, and the lore a place is bound to, each entry as Lumiverse holds it now.
      places: { settings: async (user, chat) => (await settings(user, chat)).places, sources: made().placeSources },
      // The quests' settings for the chat: how many records a page of them holds.
      quests: async (user, chat) => (await settings(user, chat)).quests,
    })),
    worlds,
    build,
    playArea(() => ({
      store: made().store,
      turning,
      guidance: RPE_GUIDANCE,
      settings: async (user: string, chat: string) => {
        const s = await settings(user, chat);
        return { dueItems: s.engine.dueItems, editOps: s.engine.editOps, taps: s.taps, map: s.map };
      },
      requests: made().requests,
      // What RPE writes to Lumiverse through the door, once it is set up for a Lumiverse.
      lumiverse: () => lumiverse().writes,
    })),
    door.area,
  ];

  return { areas, door, turns: turn.turns, settings: reader };
}
