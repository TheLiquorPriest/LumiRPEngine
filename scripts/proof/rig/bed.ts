// The rig's footing for one play (PlanScenarios-2 items 1, 4, 6): the stand-in Lumiverse (`test/standin/`)
// with its server, its database file and the light extension installed and running in it; RPE signed in
// as `rpe lumiverse` leaves it; and RPE's app with every area `compose()` mounts, listening on a free
// loopback port, serving its built web pages at `/ui/`, its agents answering from scripts (`script.ts`).
// Lumiverse's requests to RPE go over the real network to that port, and RPE reads Lumiverse's rows from
// the database file, as on the bed. Every name is invented.
//
// It is not `test/turn/bed.ts` (the turn's own, which has no pages and one script for every agent): the
// rig needs RPE's real pages, a script for each agent, and a clock the pages can measure. It is built
// the same way, from the same parts.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataPaths, openApp, SecretsFile, type App, type RunningServer } from "../../../src/app";
import { compose, type Composition } from "../../../src/app/compose";
import { configOf, prepareDataFolder } from "../../../src/app/config";
import { EXTENSION_IDENTIFIER, readRegistration, REGISTRATION_FILE } from "../../../src/adapter/lumiverse/pipe-wire";
import { LumiverseSession } from "../../../src/adapter/lumiverse/session";
import { startExtension } from "../../../src/ext/start";
import type { Turns } from "../../../src/turn";
import { REAL_CLOCK } from "../../../test/ext/rig";
import { ADMIN, installRpe } from "../../../test/standin/install";
import { StandInDb } from "../../../test/standin/db";
import { LumiverseServer } from "../../../test/standin/http";
import { type ChatMessage, StandIn } from "../../../test/standin/lumiverse";
import type { ModelSource } from "rp-harness/testing/rig";
import { SCRIPTED_MODEL } from "./scripts";

/** The invented names of the rig's one player and the chat the rig starts with. */
export const RIG_USER = "user-marlow";
export const RIG_PASSWORD = "brass and lamp oil";
export const RIG_CHAT = "chat-gannet";
export const RIG_CHARACTER = { id: "char-wren", name: "Wren Hale" };
/** The Lumiverse connection that points at RPE. */
export const RIG_RPE_CONNECTION = "conn-rpe";
/** The models of the two connections: Lumiverse counts the tokens of a reply and of the shown text for each (the stand-in has a tokenizer only for models it is told of). The plain connection is on the model the agents' scripts stand in for, as the floor's pairs are. */
export const RIG_RPE_MODEL = "rpe";
export const RIG_PLAIN_MODEL = SCRIPTED_MODEL;
export const RIG_PRESET = "preset-lamp";
export const RIG_GREETING = "The lamp turns above you; the sea is loud tonight.";
export const RIG_CHAT_NAME = "The lighthouse";

export interface RigBedOptions {
  /** What RPE's agents run on: the rig's scripts, in the model layer's place. */
  models: ModelSource;
  /** The folder of the built web pages RPE serves at `/ui/`. */
  ui: string;
  /** The user's own `RPE-global.yml`, over the shipped one (a play that lays user-layer guidance says so by it). */
  global?: string;
  /** What the user switched off in their own `RPE-global.yml` (`stack.off`): nothing, unless a play names it. */
  off?: readonly string[];
  /** The starting chat's messages: the character's greeting when not given; null makes no chat. */
  messages?: ChatMessage[] | null;
  /** How long a wait on what the rig shows lasts, as the suite's runner sets it for a test (`RPE_TEST_LIMIT_MS`). */
  limitMs?: number;
  /** The build id RPE says it runs (`/api/v1/status/builds`): the host stamps the checkout's commit on it, so a run's record can be held to the checkout; "rig-1" when not given. */
  version?: string;
}

/** One play's footing. */
export interface RigBed {
  readonly app: App;
  readonly listening: RunningServer;
  readonly composition: Composition;
  readonly turns: Turns;
  readonly host: StandIn;
  readonly server: LumiverseServer;
  readonly db: StandInDb;
  /** The folder of RPE's data (`RPE-global.yml`, its store and secrets). */
  readonly data: string;
  /** A page token of RPE's user, which RPE's pages and the rig's acts speak with. */
  readonly pageToken: string;
  /** The web UI's token (`rpe key web`), asked for once by the web shell's sign-in field. */
  readonly webToken: string;
  /** Waits until `check` gives something, in real time, at the rig's limit. */
  until<T>(what: string, check: () => T | null | undefined | false | Promise<T | null | undefined | false>): Promise<T>;
  close(): Promise<void>;
}

/** Opens one footing; everything it opened is closed again if it cannot be finished. */
export async function openRigBed(options: RigBedOptions): Promise<RigBed> {
  const cleanups: (() => Promise<void> | void)[] = [];
  const close = async (): Promise<void> => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  };
  try {
    const root = await mkdtemp(join(tmpdir(), "rpe-rig-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const db = new StandInDb();
    cleanups.push(() => db.close());
    db.write({ user: [{ id: RIG_USER, name: "Marlow", email: "marlow@example.invalid", username: "marlow" }], characters: [], chats: [], messages: [], world_books: [], world_book_entries: [], personas: [], presets: [], settings: [], message_breakdowns: [] });
    const host = new StandIn();
    host.db = db;
    // Lumiverse counts the tokens of a reply (the completion's count, else its own tokenizer's) only for a model it has a tokenizer for.
    for (const model of [RIG_PLAIN_MODEL, RIG_RPE_MODEL]) host.tokenizedModels.add(model);
    const server = new LumiverseServer({ clock: REAL_CLOCK, db, host, accounts: [{ id: RIG_USER, username: "marlow", password: RIG_PASSWORD }], tokenizedModels: [RIG_PLAIN_MODEL, RIG_RPE_MODEL] });
    cleanups.push(() => server.stop());
    const { id: extensionId } = await installRpe(host, { code: (api) => startExtension(api) });
    cleanups.push(() => host.spindle.disable(ADMIN, extensionId));

    // RPE signed in as `rpe lumiverse` leaves it: the session's token in RPE's secrets.
    const data = join(root, "rpe");
    const paths = dataPaths(data);
    await prepareDataFolder(paths);
    const signIn = await new LumiverseSession({ base: server.base, fetch: server.fetch, signIn: null, save: async () => undefined, owner: () => RIG_USER, clock: REAL_CLOCK, log: () => undefined }).signIn("marlow", RIG_PASSWORD);
    await new SecretsFile(paths.secrets).write("lumiverse", { ...signIn });
    await writeFile(paths.globalConfig, `stack: { off: [${(options.off ?? []).join(", ")}] }\n${options.global ?? ""}`, "utf8");

    const config = configOf({ port: 0, lumiverse: { url: server.base, user: RIG_USER, database: db.path, connection: RIG_RPE_CONNECTION } }, {}, "the rig's config");
    const limitMs = options.limitMs ?? (Number(process.env.RPE_TEST_LIMIT_MS) || 15_000);
    const until = async <T>(what: string, check: () => T | null | undefined | false | Promise<T | null | undefined | false>): Promise<T> => {
      const end = Date.now() + limitMs;
      for (;;) {
        const got = await check();
        if (got) return got;
        if (Date.now() > end) throw new Error(`waited the rig's limit of ${limitMs} ms for ${what}`);
        await Bun.sleep(2);
      }
    };

    const composition = compose({ fetch: server.fetch, open: server.open, harness: { models: options.models } });
    const app = await openApp({ paths, config, version: options.version ?? "rig-1", areas: composition.areas, ui: options.ui, log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } });
    cleanups.push(() => app.close());
    const turns = composition.turns();
    if (turns === null) throw new Error("the turn lane did not mount");
    const providerKey = (await app.auth.makeKey("provider")).key;
    const webToken = (await app.auth.makeKey("web")).key;
    const pageToken = (await app.auth.mintPageToken(RIG_USER, "extension")).token;
    // Listening starts the door: its sockets open, and its relay socket registers with the extension.
    const listening = await app.start();
    cleanups.push(() => listening.stop());
    const origins = new Set([new URL(listening.url).origin, new URL(listening.loopback).origin]);
    for (const origin of origins) host.servers.set(origin, (request) => fetch(request));
    await until("the extension's answer to this RPE's registration", () => {
      const registered = readRegistration(JSON.parse(host.readFile(`users/${RIG_USER}/extensions/${EXTENSION_IDENTIFIER}/${REGISTRATION_FILE}`) ?? "null"));
      return registered !== null && origins.has(new URL(registered.base).origin) ? registered : null;
    });
    await until("RPE's event socket to open", () => composition.door.lumiverse()?.events.open);
    host.connections.set(RIG_RPE_CONNECTION, { id: RIG_RPE_CONNECTION, base: `${listening.url}/v1`, key: providerKey, model: RIG_RPE_MODEL });

    // Lumiverse's side: a preset, and the chat as the character's greeting leaves it.
    host.presets.set(RIG_PRESET, {
      id: RIG_PRESET,
      name: "Lamp",
      blocks: [
        { id: "b-main", name: "Main", role: "system", content: "You narrate a lighthouse on Gannet Rock, one scene at a time." },
        // The stand-in sends the chat's history only where a block carries this marker, as Lumiverse does.
        { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" },
      ],
    });
    // Generation reads the preset from the host's map; Lumiverse's own routes (the drawer's Preset tab, the floor's reader) read its row: both are kept.
    db.run("INSERT INTO presets (id, name, provider, user_id) VALUES (?, ?, 'custom', ?)", RIG_PRESET, "Lamp", RIG_USER);
    if (options.messages !== null) host.addChat({ id: RIG_CHAT, user: RIG_USER, name: RIG_CHAT_NAME, character: RIG_CHARACTER, messages: options.messages ?? [{ id: "m-greeting", role: "assistant", content: RIG_GREETING }] });

    return { app, listening, composition, turns, host, server, db, data, pageToken, webToken, until, close };
  } catch (error) {
    await close();
    throw error;
  }
}
