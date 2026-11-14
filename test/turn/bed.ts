// What the turn's end-to-end tests share: the stand-in Lumiverse (`test/standin/`) writing its chats'
// rows to its database file and sending its events to the user's sockets, with the light extension
// installed and running in it; RPE signed in as `rpe lumiverse` leaves it; and RPE's app (`openApp`) with
// every area `compose()` mounts, listening on a free loopback port, its agents on one scripted model.
// Lumiverse's requests to RPE (the extension's road, the connection's calls) go over the real network to
// that port, and RPE reads Lumiverse's rows from the database file. Every name is invented.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonValue, Log, Scope } from "rp-harness/contract";
import { type Answer, scriptedModel, type ScriptedModel } from "rp-harness/testing/rig";
import { dataPaths, openApp, SecretsFile, type App, type RunningServer } from "../../src/app";
import { compose, type Composition } from "../../src/app/compose";
import { configOf, prepareDataFolder } from "../../src/app/config";
import { EXTENSION_IDENTIFIER, readRegistration, REGISTRATION_FILE } from "../../src/adapter/lumiverse/pipe-wire";
import { LumiverseSession } from "../../src/adapter/lumiverse/session";
import { startExtension } from "../../src/ext/start";
import type { TurnRow } from "../../src/store";
import type { Turns } from "../../src/turn";
import { ALL, REAL_CLOCK } from "../ext/rig";
import { StandInDb } from "../standin/db";
import { LumiverseServer } from "../standin/http";
import { type ChatMessage, StandIn } from "../standin/lumiverse";

export const USER = "user-marlow";
const PASSWORD = "brass and lamp oil";
export const CHAT = "chat-gannet";
export const CHARACTER = { id: "char-wren", name: "Wren Hale" };
export const CONNECTION = "conn-rpe";
export const PRESET = "preset-lamp";
export const GREETING = "The lamp turns above you; the sea is loud tonight.";

/** A line of RPE's log. */
export interface Logged {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  fields?: Record<string, JsonValue>;
}

export interface TurnBed {
  app: App;
  listening: RunningServer;
  composition: Composition;
  /** The turn lane and the harness, as mounted. */
  turns: Turns;
  host: StandIn;
  server: LumiverseServer;
  db: StandInDb;
  /** The one model every agent runs on. */
  model: ScriptedModel;
  logged: Logged[];
  /** Each turn the harness was told left the chat's path (`Harness.turnLeft`), in order. */
  left: Scope[];
  /** A Turn page's call to RPE, with a page token of RPE's user: its status and its JSON. */
  page<T>(method: "GET" | "POST", path: string): Promise<{ status: number; body: T }>;
  /** Waits until `check` gives something, in real time: Lumiverse's requests to RPE go over the network. */
  until<T>(what: string, check: () => T | null | undefined | false | Promise<T | null | undefined | false>): Promise<T>;
  close(): Promise<void>;
}

export interface TurnBedOptions {
  /** Every model call's answer, in order, whichever agent makes it. */
  answers: Answer[];
  /** The user's own `RPE-global.yml`, over the shipped one. */
  global?: string;
  /** The chat's messages before the test plays: the character's greeting when not given. */
  messages?: ChatMessage[];
}

/** The Author's answer in one call: its intent record, then its reply. */
export function replying(reply: string, intent = "One exchange."): Answer {
  return { pieces: [{ text: `<intent>${intent}</intent>` }, { text: `<reply>${reply}</reply>` }] };
}

/** The turn a generation was played as, once Lumiverse's end of it is recorded (tied, or dropped) and no run of the chat goes on. */
export async function settledTurn(b: TurnBed, generation: string): Promise<TurnRow> {
  const store = b.turns.store.user(USER);
  return await b.until(`the turn of generation ${generation} to be settled`, () => {
    const run = b.turns.runs.byGeneration(USER, generation);
    const turn = run === null ? null : store.turn(run.turn);
    return turn !== null && turn.status !== "open" && b.turns.runs.ofChat(USER, CHAT).length === 0 ? turn : null;
  });
}

function recordingLog(logged: Logged[]): Log {
  const line = (level: Logged["level"]) => (message: string, fields?: Record<string, JsonValue>) => {
    logged.push({ level, message, ...(fields !== undefined ? { fields } : {}) });
  };
  return { debug: line("debug"), info: line("info"), warn: line("warn"), error: line("error") };
}

export async function openTurnBed(options: TurnBedOptions): Promise<TurnBed> {
  const cleanups: (() => Promise<void> | void)[] = [];
  const close = async (): Promise<void> => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  };
  try {
    const root = await mkdtemp(join(tmpdir(), "rpe-turn-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const db = new StandInDb();
    cleanups.push(() => db.close());
    db.write({ user: [{ id: USER, name: "Marlow", email: "marlow@example.invalid", username: "marlow" }], characters: [], chats: [], messages: [], world_books: [], world_book_entries: [], personas: [], presets: [], settings: [], message_breakdowns: [] });
    const host = new StandIn();
    host.db = db;
    const server = new LumiverseServer({ clock: REAL_CLOCK, db, host, accounts: [{ id: USER, username: "marlow", password: PASSWORD }] });
    cleanups.push(() => server.stop());
    const running = await startExtension(server.install(EXTENSION_IDENTIFIER, ALL));
    cleanups.push(() => running.stop());

    // RPE signed in as `rpe lumiverse` leaves it: the session's token in RPE's secrets.
    const paths = dataPaths(join(root, "rpe"));
    await prepareDataFolder(paths);
    const signIn = await new LumiverseSession({ base: server.base, fetch: server.fetch, signIn: null, save: async () => undefined, owner: () => USER, clock: REAL_CLOCK, log: () => undefined }).signIn("marlow", PASSWORD);
    await new SecretsFile(paths.secrets).write("lumiverse", { ...signIn });
    if (options.global !== undefined) await writeFile(paths.globalConfig, options.global, "utf8");

    const model = scriptedModel(options.answers, { contextWindow: 64_000, maxTokens: 4_000 });
    const composition = compose({ fetch: server.fetch, open: server.open, harness: { models: { agentModel: async () => model.agentModel() } } });
    const logged: Logged[] = [];
    const config = configOf({ port: 0, lumiverse: { url: server.base, user: USER, database: db.path, connection: CONNECTION } }, {}, "the test's config");
    const app = await openApp({ paths, config, version: "build-9", areas: composition.areas, ui: null, log: recordingLog(logged) });
    cleanups.push(() => app.close());
    const turns = composition.turns();
    if (turns === null) throw new Error("the turn lane did not mount");
    // What the harness is told of turns that left the path, recorded on the way to it.
    const left: Scope[] = [];
    const turnLeft = turns.harness.turnLeft.bind(turns.harness);
    turns.harness.turnLeft = (scope) => {
      left.push(scope);
      return turnLeft(scope);
    };
    const providerKey = (await app.auth.makeKey("provider")).key;
    const pageToken = (await app.auth.mintPageToken(USER, "extension")).token;

    const until = async <T>(what: string, check: () => T | null | undefined | false | Promise<T | null | undefined | false>): Promise<T> => {
      const end = Date.now() + 5_000;
      for (;;) {
        const got = await check();
        if (got) return got;
        if (Date.now() > end) throw new Error(`waited five seconds for ${what}`);
        await Bun.sleep(2);
      }
    };

    // Listening starts the door: its sockets open, and its relay socket registers with the extension.
    const listening = await app.start();
    host.servers.set(new URL(listening.url).origin, (request) => fetch(request));
    await until("the extension's answer to RPE's registration", () => readRegistration(JSON.parse(host.storage.get(`${USER}\u0000${REGISTRATION_FILE}`) ?? "null")));
    await until("RPE's event socket to open", () => composition.door.lumiverse()?.events.open);

    // Lumiverse's side: RPE's connection, a preset, and the chat as the character's greeting leaves it.
    host.connections.set(CONNECTION, { id: CONNECTION, base: `${listening.url}/v1`, key: providerKey, model: "rpe" });
    host.presets.set(PRESET, { id: PRESET, name: "Lamp", blocks: [{ id: "b-main", name: "Main", role: "system", content: "You narrate a lighthouse on Gannet Rock, one scene at a time." }] });
    host.addChat({ id: CHAT, user: USER, name: "The lighthouse", character: CHARACTER, messages: options.messages ?? [{ id: "m-greeting", role: "assistant", content: GREETING }], books: [] });

    const page = async <T>(method: "GET" | "POST", path: string): Promise<{ status: number; body: T }> => {
      const res = await fetch(`${listening.url}${path}`, { method, headers: { authorization: `Bearer ${pageToken}` } });
      return { status: res.status, body: (await res.json()) as T };
    };
    return { app, listening, composition, turns, host, server, db, model, logged, left, page, until, close };
  } catch (error) {
    await close();
    throw error;
  }
}
