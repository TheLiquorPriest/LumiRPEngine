// What the door's end-to-end tests share: the stand-in Lumiverse (`test/standin/http.ts`) with the
// light extension installed and running in it, RPE signed in as `rpe lumiverse` leaves it, and RPE's
// app (`openApp`) with the door mounted, listening on a free port (loopback unless the test sets an
// address). Lumiverse's requests to RPE (the extension's road, the chat connection) go over the real
// network to that port; everything else runs on the clock the test gives. Every name is invented.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clock, PassRequest } from "rp-harness/contract";
import { type Area, dataPaths, lineLog, openApp, SecretsFile, type App, type RunningServer } from "../../src/app";
import { configOf, prepareDataFolder } from "../../src/app/config";
import type { SecrecyAsk, WindowAsk } from "../../src/adapter/lumiverse/answer";
import { lumiverseDoor, type AdapterLanes, type LumiverseDoor } from "../../src/adapter/lumiverse/mount";
import { EXTENSION_IDENTIFIER, readRegistration, REGISTRATION_FILE, type Registration } from "../../src/adapter/lumiverse/pipe-wire";
import type { TaggedTurn } from "../../src/adapter/lumiverse/provider";
import { LUMIVERSE_SETTINGS } from "../../src/adapter/lumiverse/settings";
import { LumiverseSession } from "../../src/adapter/lumiverse/session";
import { startExtension } from "../../src/ext/start";
import { treeReader } from "../../src/tree/settings";
import { ALL } from "../ext/rig";
import { ADMIN, installRpe } from "../standin/install";
import { StandInDb } from "../standin/db";
import { LumiverseServer } from "../standin/http";
import { StandIn, type Installed } from "../standin/lumiverse";

export const USER = "user-tamsin";
const PASSWORD = "salt and lantern";

/** A clock the test runs by hand (`FakeClock`), or the process's own. */
export type BedClock = Pick<Clock, "now" | "setTimeout" | "clearTimeout"> & { advance?(ms: number): Promise<void> };

export interface DoorBed {
  app: App;
  listening: RunningServer;
  door: LumiverseDoor;
  host: StandIn;
  server: LumiverseServer;
  /** The extension as installed in the stand-in: Spindle's API as its worker sees it. */
  installed: Installed;
  /** Lumiverse's id for the extension. */
  extension: string;
  /** An admin grants the extension a permission: its worker hears it on a later task, which `until` runs. */
  grant(permission: string): void;
  providerKey: string;
  /** What RPE told its extension of itself. */
  registration: Registration;
  /** The registration the extension keeps for RPE's user now; null when it keeps none. */
  kept(): Registration | null;
  /** RPE's log, a line each. */
  logs: string[];
  heard: { turns: TaggedTurn[]; passed: PassRequest[]; questions: SecrecyAsk[]; windows: WindowAsk[] };
  /**
   * Waits until `check` gives something: moving the test's clock where it has one, and letting
   * Lumiverse's requests to RPE, which go over the real network, finish in real time.
   */
  until<T>(what: string, check: () => T | null | undefined | false): Promise<T>;
  /** Moves the test's clock on by `ms` in steps, each step's requests to RPE finished before the next. */
  run(ms: number, step: number): Promise<void>;
  close(): Promise<void>;
}

export interface DoorOptions {
  clock: BedClock;
  handlerMs?: number;
  /** The `lumiverse:` group of `RPE-global.yml`, as the bed writes it there for the door to read. */
  lumiverse?: Record<string, unknown>;
  /** Areas the test adds after the door's own. */
  areas?: readonly Area[];
  /** RPE's config over the bed's own. */
  config?: Record<string, unknown>;
  /** What the extension is granted; all it asks for unless said. */
  granted?: readonly string[];
}

export async function openDoor(options: DoorOptions): Promise<DoorBed> {
  const { clock } = options;
  const cleanups: (() => Promise<void> | void)[] = [];
  const close = async (): Promise<void> => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  };
  try {
    const root = await mkdtemp(join(tmpdir(), "rpe-door-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const db = new StandInDb();
    cleanups.push(() => db.close());
    db.write({ user: [{ id: USER, name: "Tamsin", email: "tamsin@example.invalid", username: "tamsin" }], characters: [], chats: [], messages: [], world_books: [], world_book_entries: [], personas: [], presets: [], settings: [], message_breakdowns: [] });
    const host = new StandIn();
    const server = new LumiverseServer({ clock, db, host, accounts: [{ id: USER, username: "tamsin", password: PASSWORD }], ...(options.handlerMs !== undefined ? { handlerMs: options.handlerMs } : {}) });
    cleanups.push(() => server.stop());
    const { id, worker: installed } = await installRpe(host, { granted: options.granted ?? ALL, code: (api) => startExtension(api) });
    cleanups.push(() => host.spindle.disable(ADMIN, id));

    // RPE signed in as `rpe lumiverse` leaves it: the session's token in RPE's secrets.
    const paths = dataPaths(join(root, "data"));
    await prepareDataFolder(paths);
    const signIn = await new LumiverseSession({ base: server.base, fetch: server.fetch, signIn: null, save: async () => undefined, owner: () => USER, clock, log: () => undefined }).signIn("tamsin", PASSWORD);
    await new SecretsFile(paths.secrets).write("lumiverse", { ...signIn });

    const heard: DoorBed["heard"] = { turns: [], passed: [], questions: [], windows: [] };
    const lanes: AdapterLanes = {
      turns: {
        play: async (turn, out) => {
          heard.turns.push(turn);
          out.reasoning("Reading the harbor.");
          out.content("The tide turns.");
        },
      },
      changes: { changed: () => undefined, reopened: () => undefined },
      window: async (ask) => {
        heard.windows.push(ask);
        return null;
      },
      start: async ({ path, point }) => ({ messages: path.filter((s) => s.id !== point.replaces).map((s) => ({ ...s, hidden: false })), at: null, known: true }),
      room: async () => ({ room: null, count: async () => 0, covered: async () => false }),
      secrecy: async (ask) => {
        heard.questions.push(ask);
        return { disabled: [], enabled: [], mutated: [] };
      },
      hiddenReadable: async () => false,
      ranges: async () => ({}),
      summarized: async () => new Set(),
      models: {
        pass: async (request, sink) => {
          heard.passed.push(request);
          sink.content("A title for the chat.");
          sink.finish({ content: "A title for the chat.", finishReason: "stop", usage: { calls: 1, input: 5, cacheRead: 0, cacheWrite: 0, output: 5 } });
        },
      },
      passConnection: () => "conn-author",
      passWords: async (key) => key,
      storeLine: async (store) => store,
    };
    if (options.lumiverse !== undefined) await Bun.write(paths.globalConfig, JSON.stringify({ lumiverse: options.lumiverse }));
    const logs: string[] = [];
    const log = lineLog((line) => logs.push(line), () => clock.now());
    const settings = treeReader({ files: () => paths.files, folders: () => null, log: () => log, known: () => LUMIVERSE_SETTINGS });
    const door = lumiverseDoor(lanes, { fetch: server.fetch, open: server.open, clock, sleep: (ms) => Bun.sleep(ms), settings });
    const config = configOf({ port: 0, lumiverse: { url: server.base, user: USER, database: db.path, connection: "conn-rpe" }, ...options.config }, {}, "the test's config");
    const app = await openApp({ paths, config, version: "build-7", areas: [door.area, ...(options.areas ?? [])], now: () => clock.now(), log });
    cleanups.push(() => app.close());
    const providerKey = (await app.auth.makeKey("provider")).key;

    // Lumiverse's requests to RPE go over the real network: counted, so a step of the test's clock can wait for them.
    let inflight = 0;
    const until = async <T>(what: string, check: () => T | null | undefined | false): Promise<T> => {
      const end = Date.now() + 5_000;
      for (;;) {
        const got = check();
        if (got) return got;
        if (Date.now() > end) throw new Error(`waited five seconds for ${what}`);
        if (clock.advance && inflight === 0) await clock.advance(10);
        // The real network answers in real time: there is no clock to move for it.
        else await Bun.sleep(1);
      }
    };
    const run = async (ms: number, step: number): Promise<void> => {
      if (!clock.advance) throw new Error("run needs a clock the test moves");
      for (let gone = 0; gone < ms; gone += step) {
        await clock.advance(step);
        while (inflight > 0) await Bun.sleep(1);
      }
    };

    // Listening starts the door: its sockets open, and its relay socket registers with the extension,
    // which reaches RPE on loopback; Lumiverse's chat connection reaches it at its address.
    const listening = await app.start();
    const forward = async (request: Request): Promise<Response> => {
      inflight++;
      try {
        return await fetch(request);
      } finally {
        inflight--;
      }
    };
    for (const at of new Set([listening.url, listening.loopback])) host.servers.set(new URL(at).origin, forward);
    // Taken or refused, the extension's answer says what it is missing.
    await until("the extension's answer to RPE's registration", () => door.extension().missing !== null);
    const registration = door.registration();
    if (registration === null) throw new Error("RPE made no registration");
    const kept = (): Registration | null => readRegistration(JSON.parse(host.readFile(`users/${USER}/extensions/${EXTENSION_IDENTIFIER}/${REGISTRATION_FILE}`) ?? "null"));
    return { app, listening, door, host, server, installed, extension: id, grant: (permission) => void host.spindle.setPermissions(ADMIN, id, { grant: [permission] }), providerKey, registration, kept, logs, heard, until, run, close };
  } catch (error) {
    await close();
    throw error;
  }
}
