// What the turn's end-to-end tests share: the stand-in Lumiverse (`test/standin/`) writing its chats'
// rows to its database file and sending its events to the user's sockets, with the light extension
// installed and running in it; RPE signed in as `rpe lumiverse` leaves it; and RPE's app (`openApp`) with
// every area `compose()` mounts, listening on a free loopback port, its agents on one scripted model.
// Lumiverse's requests to RPE (the extension's road, the connection's calls) go over the real network to
// that port, and RPE reads Lumiverse's rows from the database file. Every name is invented.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateHarnessOptions } from "rp-harness";
import type { JsonValue, Log, Scope, TurnRequest } from "rp-harness/contract";
import { type Answer, scriptedModel, type ScriptedModel } from "rp-harness/testing/rig";
import { dataPaths, openApp, SecretsFile, type App, type Area, type RunningServer } from "../../src/app";
import { compose, type Composition } from "../../src/app/compose";
import { configOf, prepareDataFolder } from "../../src/app/config";
import { EXTENSION_IDENTIFIER, readRegistration, REGISTRATION_FILE } from "../../src/adapter/lumiverse/pipe-wire";
import { LumiverseSession } from "../../src/adapter/lumiverse/session";
import { startExtension } from "../../src/ext/start";
import { hashJson } from "../../src/shared/hash";
import type { WorldDoc } from "../../src/shared/world";
import type { TurnRow } from "../../src/store";
import type { Turns } from "../../src/turn";
import { REAL_CLOCK } from "../ext/rig";
import { StandInDb } from "../standin/db";
import { LumiverseServer } from "../standin/http";
import { ADMIN, installRpe } from "../standin/install";
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

/** What a turn's test plays through: the stand-in Lumiverse, and RPE, whose side (`app` to `turns`) is the new RPE's after a restart. */
export interface TurnBed {
  readonly app: App;
  readonly listening: RunningServer;
  readonly composition: Composition;
  /** The turn lane and the harness, as mounted. */
  readonly turns: Turns;
  host: StandIn;
  server: LumiverseServer;
  db: StandInDb;
  /** The one model every agent runs on. */
  model: ScriptedModel;
  logged: Logged[];
  /** Each turn the harness was told left the chat's path (`Harness.turnLeft`), in order. */
  left: Scope[];
  /** Each request the harness was asked to answer (`Harness.answer`), in order. */
  requests: TurnRequest[];
  /** A Turn page's call to RPE, with a page token of RPE's user, and the JSON body given: its status and its JSON. */
  page<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: T }>;
  /** Waits until `check` gives something, in real time: Lumiverse's requests to RPE go over the network. */
  until<T>(what: string, check: () => T | null | undefined | false | Promise<T | null | undefined | false>): Promise<T>;
  /**
   * RPE stops at once, as when its process ends: nothing more of it reaches Lumiverse or hears it, and what it was doing is left
   * where it stood, recorded no further. Then an RPE starts again on the same data folder, and the bed's RPE side is the new one.
   */
  restart(): Promise<void>;
  close(): Promise<void>;
}

export interface TurnBedOptions {
  /** Every model call's answer, in order, whichever agent makes it. */
  answers: Answer[];
  /** The user's own `RPE-global.yml`, over the shipped one. */
  global?: string;
  /** What the user switched off in their own `RPE-global.yml` (`stack.off`): nothing, unless a test names it. */
  off?: readonly string[];
  /** The chat's messages before the test plays: the character's greeting when not given. */
  messages?: ChatMessage[];
  /** Areas a test adds after the composition's own, made from the composition (its door, its turn lane). */
  areas?: (composition: Composition) => readonly Area[];
  /** The scripted model's context window in tokens: 64,000 when not given. */
  contextWindow?: number;
  /** What the agents run on: the one scripted model (the default), or RPH's own model layer, on the connections made through RPE's routes. */
  models?: "scripted" | "layer";
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

/** The bed's chat plays `doc` from before its first turn: the store keeps the world's revision, and the chat starts on it. */
export async function playsWorld(b: TurnBed, doc: WorldDoc): Promise<void> {
  const revision = hashJson(doc);
  const store = b.turns.store.user(USER);
  await b.app.writes.run(() => {
    store.putWorld(revision, doc);
    store.createChat({ id: CHAT, world: doc.id, revision });
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
    const { id } = await installRpe(host, { code: (api) => startExtension(api) });
    cleanups.push(() => host.spindle.disable(ADMIN, id));

    // RPE signed in as `rpe lumiverse` leaves it: the session's token in RPE's secrets.
    const paths = dataPaths(join(root, "rpe"));
    await prepareDataFolder(paths);
    const signIn = await new LumiverseSession({ base: server.base, fetch: server.fetch, signIn: null, save: async () => undefined, owner: () => USER, clock: REAL_CLOCK, log: () => undefined }).signIn("marlow", PASSWORD);
    await new SecretsFile(paths.secrets).write("lumiverse", { ...signIn });
    const off = options.off ?? [];
    await writeFile(paths.globalConfig, `stack: { off: [${off.join(", ")}] }\n${options.global ?? ""}`, "utf8");

    const model = scriptedModel(options.answers, { contextWindow: options.contextWindow ?? 64_000, maxTokens: 4_000 });
    const logged: Logged[] = [];
    const config = configOf({ port: 0, lumiverse: { url: server.base, user: USER, database: db.path, connection: CONNECTION } }, {}, "the test's config");
    // What the harness is told of turns that left the path, and what it is asked to answer, recorded on the way to it.
    const left: Scope[] = [];
    const requests: TurnRequest[] = [];
    let providerKey: string | null = null;

    // A wait on what is shown, bounded by the test's own limit: the one the suite's runner gives Bun and tells the file in
    // `RPE_TEST_LIMIT_MS`, else Bun's own 5 seconds, which bound a file run alone; so a busy machine does not fail it sooner.
    const limitMs = Number(process.env.RPE_TEST_LIMIT_MS) || 5_000;
    const until = async <T>(what: string, check: () => T | null | undefined | false | Promise<T | null | undefined | false>): Promise<T> => {
      const end = Date.now() + limitMs;
      for (;;) {
        const got = await check();
        if (got) return got;
        if (Date.now() > end) throw new Error(`waited the test's limit of ${limitMs} ms for ${what}`);
        await Bun.sleep(2);
      }
    };

    /** An RPE on the bed's data folder: listening, registered with the extension, and the connection in Lumiverse pointing at it. */
    const startRpe = async () => {
      // Each agent starts on the effort its definition names, as the model layer gives it: `auto` and `inherit` are the connection's own, which the one scripted model has none of.
      const scripted: Pick<CreateHarnessOptions, "models"> = { models: { agentModel: async (choice) => model.agentModel(choice.effort === undefined || choice.effort === "inherit" || choice.effort === "auto" ? "off" : choice.effort) } };
      const composition = compose({ fetch: server.fetch, open: server.open, ...(options.models === "layer" ? {} : { harness: scripted }) });
      const app = await openApp({ paths, config, version: "build-9", areas: [...composition.areas, ...(options.areas?.(composition) ?? [])], ui: null, log: recordingLog(logged) });
      cleanups.push(() => app.close());
      const turns = composition.turns();
      if (turns === null) throw new Error("the turn lane did not mount");
      const turnLeft = turns.harness.turnLeft.bind(turns.harness);
      turns.harness.turnLeft = (scope) => {
        left.push(scope);
        return turnLeft(scope);
      };
      const answer = turns.harness.answer.bind(turns.harness);
      turns.harness.answer = (request, sink, signal) => {
        requests.push(request);
        return answer(request, sink, signal);
      };
      // The connection's key is kept in RPE's database, so an RPE started again on it takes the same one.
      providerKey ??= (await app.auth.makeKey("provider")).key;
      const pageToken = (await app.auth.mintPageToken(USER, "extension")).token;
      // Listening starts the door: its sockets open, and its relay socket registers with the extension.
      const listening = await app.start();
      const origins = new Set([new URL(listening.url).origin, new URL(listening.loopback).origin]);
      for (const origin of origins) host.servers.set(origin, (request) => fetch(request));
      await until("the extension's answer to this RPE's registration", () => {
        const registered = readRegistration(JSON.parse(host.readFile(`users/${USER}/extensions/${EXTENSION_IDENTIFIER}/${REGISTRATION_FILE}`) ?? "null"));
        return registered !== null && origins.has(new URL(registered.base).origin) ? registered : null;
      });
      await until("RPE's event socket to open", () => composition.door.lumiverse()?.events.open);
      host.connections.set(CONNECTION, { id: CONNECTION, base: `${listening.url}/v1`, key: providerKey, model: "rpe" });
      return { app, listening, composition, turns, pageToken };
    };
    let rpe = await startRpe();

    // Lumiverse's side: a preset, and the chat as the character's greeting leaves it.
    host.presets.set(PRESET, { id: PRESET, name: "Lamp", blocks: [{ id: "b-main", name: "Main", role: "system", content: "You narrate a lighthouse on Gannet Rock, one scene at a time." }, { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" }] });
    host.addChat({ id: CHAT, user: USER, name: "The lighthouse", character: CHARACTER, messages: options.messages ?? [{ id: "m-greeting", role: "assistant", content: GREETING }] });

    const page = async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: T }> => {
      const sent = body === undefined ? {} : { body: JSON.stringify(body), headers: { authorization: `Bearer ${rpe.pageToken}`, "content-type": "application/json" } };
      const res = await fetch(`${rpe.listening.url}${path}`, { method, headers: { authorization: `Bearer ${rpe.pageToken}` }, ...sent });
      return { status: res.status, body: (await res.json()) as T };
    };
    const restart = async (): Promise<void> => {
      const before = rpe;
      // Nothing it does from now on is recorded, as a process that has ended records nothing: each write it asks for fails.
      before.app.writes.run = () => Promise.reject(new Error("this RPE has stopped"));
      // Its door stops, so it hears nothing more from Lumiverse, and its server closes every connection. Its runs are not stopped.
      await before.composition.door.area.stopping?.(before.app);
      await before.listening.stop();
      rpe = await startRpe();
    };
    return {
      get app() {
        return rpe.app;
      },
      get listening() {
        return rpe.listening;
      },
      get composition() {
        return rpe.composition;
      },
      get turns() {
        return rpe.turns;
      },
      host,
      server,
      db,
      model,
      logged,
      left,
      requests,
      page,
      until,
      restart,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
