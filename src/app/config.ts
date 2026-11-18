// RPE's data folder, its config file and the app's own limits (plan §4.4, §4.5, §5.4, §16; R-133).
// One folder holds everything RPE keeps: the database, the index file beside it, the file tree agents
// work in, the secrets file and the config file, and a folder for backups.
//
// The config file, `config.json`, holds only the install's facts: which Lumiverse (its address and,
// where it is read, its database file), which of its users this RPE belongs to, the port RPE's
// connection in Lumiverse points at (on loopback), and that connection with its model names. The
// command line writes them (`rpe up`, `rpe lumiverse`); no page does. Three can be given by the
// environment instead, which wins over the file, so a service unit or a container can set them.
//
// Every limit the app keeps (the address it listens on besides loopback, the origins and names allowed,
// the body limits and the preflight's life, the lives of tokens, the live socket's bounds, the
// database's waits, the command line's waits, the worker threads and the index file's batches) is a
// setting in `RPE-global.yml`, at the global
// level alone (`SERVER_SETTINGS`), shown and written on the Settings page and in force from RPE's next
// start. The app's config (`AppConfig`), which the server, auth, the live socket, the database and the
// command line read, is put together from the facts and those settings when it is loaded.
//
// An install whose config.json still holds limits, as builds before this one wrote them, has them
// moved into `RPE-global.yml` at its first start on this build (`moveLimits`), each value kept; until
// then the file's own are in force. Every write of config.json takes the config's lock, so the command
// line's write and that move never lose each other's change.

import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JsonValue, Log } from "rp-harness/contract";
import { isRecord } from "../shared/json";
import { type ConfigRead, diskTexts, readConfig } from "./config-read";
import { takeFolderLock } from "./data-folder";
import { isMissing, oneFileAtATime, OWNER_ONLY_FILE, ownerOnlyFolder, readText, writeWhole } from "./disk";
import type { Setting } from "./setting-list";
import { memoryRefusal } from "./service-memory";
import { withKeyAt } from "./yaml";

export const CONFIG_FILE = "config.json";
export const SECRETS_FILE = "secrets.json";
export const DATABASE_FILE = "rpe.db";
/** The index file (plan Appendix B), beside the database: rebuilt from its sources, so not in a backup (R-14). */
export const INDEX_FILE = "index.db";
export const FILES_FOLDER = "files";
export const BACKUPS_FOLDER = "backups";
/** The file tree's global config (plan §5): connection profiles live in it, beside what other areas keep there. */
export const GLOBAL_CONFIG_FILE = "RPE-global.yml";
/** The shipped level's folder under the file tree's root: every shipped file, read-only. */
export const SHIPPED_FOLDER = "defaults";
/** The folder of the config's lock, which every writer of config.json takes. */
export const CONFIG_LOCK_FOLDER = "config-lock";

/** Where each thing RPE keeps is, under one data folder. */
export interface DataPaths {
  root: string;
  config: string;
  secrets: string;
  database: string;
  /** The index file: contentless full-text indexes, written by its own worker thread. */
  index: string;
  /** The file tree agents work in (plan §5). */
  files: string;
  /** The user's own global config, and the shipped copy it is read over. */
  globalConfig: string;
  shippedConfig: string;
  backups: string;
}

export function dataPaths(root: string): DataPaths {
  const files = join(root, FILES_FOLDER);
  return {
    root,
    config: join(root, CONFIG_FILE),
    secrets: join(root, SECRETS_FILE),
    database: join(root, DATABASE_FILE),
    index: join(root, INDEX_FILE),
    files,
    globalConfig: join(files, GLOBAL_CONFIG_FILE),
    shippedConfig: join(files, SHIPPED_FOLDER, GLOBAL_CONFIG_FILE),
    backups: join(root, BACKUPS_FOLDER),
  };
}

export type Env = Readonly<Record<string, string | undefined>>;

/** The data folder: `RPE_DATA` when set, else `rpe` in the user's data folder (`XDG_DATA_HOME`, else `~/.local/share`). */
export function defaultDataFolder(env: Env, home: string = homedir()): string {
  const chosen = env.RPE_DATA?.trim();
  if (chosen) return chosen;
  const data = env.XDG_DATA_HOME?.trim();
  return join(data ? data : join(home, ".local", "share"), "rpe");
}

export interface AppConfig {
  /** The address RPE listens on besides loopback: loopback unless one is set (the setting `server.address`). */
  address: string;
  /** Its port, which RPE's connection in Lumiverse points at; 0 takes any free one. An install's fact. */
  port: number;
  lumiverse: {
    /** Lumiverse's address as RPE reaches it; pages from its origin may call RPE. */
    url: string | null;
    /** The id of the Lumiverse user this RPE belongs to. Pages act for that user alone. */
    user: string | null;
    /** Lumiverse's database file, which the adapter reads read-only; null where it cannot be reached and Lumiverse is read over HTTP. */
    database: string | null;
    /** The ids of RPE's connections in Lumiverse: its own, made by `rpe up`, and every one the swap took over from today's runtime (R-109); none before one is made. A config.json from before the list holds the one id as `connection`, which reads as a list of one. */
    connections: string[];
    /** The model names RPE's connection is offered (`/v1/models`). */
    models: string[];
  };
  /** The install's facts the environment gave, by their keys in config.json (`port`, `lumiverse.url`, `lumiverse.user`). */
  fromEnvironment: string[];
  /** Origins besides RPE's own and Lumiverse's whose pages may call RPE: an address either is published at. */
  origins: string[];
  /** Names besides RPE's own address that requests may reach it by (a published address's host name; `name:port` to hold it to a port). */
  hosts: string[];
  server: {
    /** The largest request body a route takes unless the route says otherwise, in bytes. */
    bodyBytes: number;
    /** The largest request the provider endpoint takes: a whole assembled prompt, pictures included. */
    providerBodyBytes: number;
    /** How long a browser may keep RPE's answer to a page's preflight, in seconds. */
    preflightSeconds: number;
    /** A request body larger than this, in bytes, is parsed on a worker thread. */
    workerParseBytes: number;
    /** Seconds a connection may send and be sent nothing before it is closed; 0: no bound. */
    idleSeconds: number;
    /** Bytes above the largest route limit at which Bun itself refuses a body, before any route's words. */
    headroomBytes: number;
    /** Seconds the answer of a long request, given by id, is kept for reading once ready. */
    answerKeepSeconds: number;
  };
  auth: {
    /** How long a page token holds, in minutes. */
    pageTokenMinutes: number;
    /** How long the token the command line makes to call the running server holds, in seconds. */
    commandLineSeconds: number;
    /** How long the web UI's key holds after it is made, in days; null: it has no end, and holds until a new one replaces it. */
    webKeyDays: number | null;
    /** How long a session of the web app holds, in minutes (renewed while a page is open). */
    webSessionMinutes: number;
    /** How long RPE remembers a nonce a page sent for its proof, in seconds; the same nonce is not answered twice within it. */
    nonceSeconds: number;
    /** How many wrong Lumiverse passwords RPE sends Lumiverse before it pauses (held below Lumiverse's own lockout). */
    signInTries: number;
    /** How long RPE sends no password to Lumiverse after `signInTries` wrong ones, in minutes. */
    signInPauseMinutes: number;
    /** Seconds over which the sign-ins to the web app that one address was refused are told as one line of the log, with their count. */
    refusedSignInSeconds: number;
  };
  live: {
    /** Events held for one slow reader of one chat; past it the oldest it has not taken are dropped, and it is told which. */
    queueEvents: number;
    /** The largest message a page may send on the live socket, in bytes. */
    messageBytes: number;
    /** The most chats one live socket may follow at once. */
    follows: number;
    /** The most characters of a chat id a page may follow. */
    chatIdChars: number;
    /** The most live sockets open at once. */
    sockets: number;
  };
  database: {
    /** How long a write waits for another program's write to the file (the command line's) to finish, in milliseconds. */
    busyMs: number;
    /** How long the write queue runs writes before it lets other work in, in milliseconds. */
    sliceMs: number;
    /** How many copies of the file taken before migrations are kept (`database.copiesKept`); the oldest go once a new version has started. */
    copiesKept: number;
    /** The piece, in bytes, an archive (`rpe backup`'s, the migration's) reads each file in (`backup.pieceBytes`). */
    pieceBytes: number;
  };
  commandLine: {
    /** How long `rpe status` and `rpe connection` wait for the running server, and a command for the data folder's lock, in milliseconds. */
    waitMs: number;
    /** How long `rpe lumiverse` waits for Lumiverse to answer its sign-in, in milliseconds. */
    signInMs: number;
    /** How long `rpe up` waits for RPE to answer once it has started RPE's service, before it puts back what it did, in milliseconds. */
    startMs: number;
    /** How often `rpe up` asks whether RPE answers yet while it waits for RPE's service to start, in milliseconds. */
    askEveryMs: number;
  };
  service: {
    /** The highest port `rpe up` tries when the configured one is taken (`service.lastPort`). */
    portLast: number;
    /** The most memory RPE's service may hold, as systemd reads a size (`service.memory`): its unit's `MemoryMax`. */
    memory: string;
    /** Seconds the service manager waits before it starts RPE again (`service.restartWaitSeconds`): its unit's `RestartSec`. */
    restartWait: number;
    /** How long a later `rpe up` waits for the turns under way to end before it restarts RPE's service, in milliseconds (`service.drainWaitSeconds`). */
    drainWaitMs: number;
    /** How many of its own newest log lines RPE keeps for the Runtime page (`service.logLines`). */
    logLines: number;
    /** How many of the latest turns the Runtime page's timings take in (`service.timingsTurns`). */
    timingsTurns: number;
  };
  switches: {
    /** The longest name of a thing that runs a command or calls out the registry takes, in characters (`switches.maxNameChars`). */
    nameLength: number;
  };
  workers: {
    /** The most worker threads RPE runs heavy work on at once; null: the machine's cores less one, at least one. */
    threads: number | null;
    /** Seconds a worker thread with no task is kept before it ends and lets go of its memory; null: kept until RPE stops. */
    idleSeconds: number | null;
  };
  index: {
    /** Rows the index file's writer writes in one transaction. */
    batch: number;
  };
}

/** The app's limits: everything of its config but the install's facts. */
export type AppLimits = Pick<AppConfig, "address" | "origins" | "hosts" | "server" | "auth" | "live" | "database" | "commandLine" | "service" | "switches" | "workers" | "index">;

/** Loopback, where RPE always listens and where its connection in Lumiverse reaches it. */
export const LOOPBACK = "127.0.0.1";

export const CONFIG_DEFAULTS: Readonly<AppConfig> = Object.freeze({
  address: LOOPBACK,
  port: 7871,
  lumiverse: { url: null, user: null, database: null, connections: [], models: ["rpe"] },
  fromEnvironment: [],
  origins: [],
  hosts: [],
  server: { bodyBytes: 1024 * 1024, providerBodyBytes: 32 * 1024 * 1024, preflightSeconds: 600, workerParseBytes: 1024 * 1024, idleSeconds: 60, headroomBytes: 1024 * 1024, answerKeepSeconds: 300 },
  auth: { pageTokenMinutes: 30, commandLineSeconds: 60, webKeyDays: null, webSessionMinutes: 30, nonceSeconds: 60, signInTries: 4, signInPauseMinutes: 15, refusedSignInSeconds: 60 },
  live: { queueEvents: 512, messageBytes: 64 * 1024, follows: 64, chatIdChars: 200, sockets: 64 },
  database: { busyMs: 5000, sliceMs: 10, copiesKept: 3, pieceBytes: 1024 * 1024 },
  commandLine: { waitMs: 3000, signInMs: 30_000, startMs: 30_000, askEveryMs: 250 },
  service: { portLast: 7899, memory: "1G", restartWait: 2, drainWaitMs: 5 * 60_000, logLines: 2000, timingsTurns: 100 },
  switches: { nameLength: 200 },
  workers: { threads: null, idleSeconds: 300 },
  index: { batch: 500 },
});

/** The environment's names for the facts it may give. */
export const CONFIG_ENV = Object.freeze({ port: "RPE_PORT", lumiverseUrl: "RPE_LUMIVERSE_URL", lumiverseUser: "RPE_LUMIVERSE_USER" });

export class ConfigError extends Error {
  override name = "ConfigError";
}

// ---------------------------------------------------------------- the app's limits as settings

const D = CONFIG_DEFAULTS;
const GLOBAL = ["shipped", "global"] as const;
const whole = (least: number) => ({ type: "whole", least }) as const;
const GIB = 1024 * 1024 * 1024;

/**
 * The app's limits, each a setting of `RPE-global.yml` read from the global level alone, when RPE
 * starts (the command line's own when a command starts): a change is in force from the next start.
 * Each is set where its config.json key of earlier builds was (`OLD_KEYS`).
 */
export const SERVER_SETTING_DEFS = {
  address: { key: "server.address", default: D.address, takes: { type: "text" }, levels: GLOBAL, perConnection: false, name: "RPE listens on", about: "The address RPE listens on besides loopback; an address other than loopback lets other machines reach RPE.", effect: "start", row: "RPE listens on" },
  origins: { key: "server.origins", default: D.origins, takes: { type: "texts" }, levels: GLOBAL, perConnection: false, name: "Origins allowed", about: "Origins besides RPE's own and Lumiverse's whose pages may call RPE: an address RPE or Lumiverse is published at, such as https://rpe.example.", effect: "start" },
  hosts: { key: "server.hosts", default: D.hosts, takes: { type: "texts" }, levels: GLOBAL, perConnection: false, name: "Names allowed", about: "Names besides RPE's own address that requests may reach it by: a published address's host name, with :port to hold it to a port.", effect: "start" },
  bodyBytes: { key: "server.maxBodyBytes", default: D.server.bodyBytes, takes: whole(1), advice: [{ below: 1024, says: "Under 1 KiB most requests a page sends are refused." }, { above: GIB, says: "A request this large is held in memory whole while it is read." }], levels: GLOBAL, perConnection: false, name: "Largest request", about: "Bytes of the largest request body a route takes, unless the route says otherwise.", effect: "start" },
  providerBodyBytes: { key: "server.maxProviderBodyBytes", default: D.server.providerBodyBytes, takes: whole(1), advice: [{ below: 1024, says: "Under 1 KiB every assembled prompt is refused." }, { above: GIB, says: "A prompt this large is held in memory whole while it is read." }], levels: GLOBAL, perConnection: false, name: "Largest prompt", about: "Bytes of the largest request Lumiverse's generations may send RPE: a whole assembled prompt, its pictures included.", effect: "start" },
  preflightSeconds: { key: "server.preflightSeconds", default: D.server.preflightSeconds, takes: whole(0), advice: [{ above: 86_400, says: "Browsers keep a preflight's answer a day at most (Chrome two hours): a longer time changes nothing." }], levels: GLOBAL, perConnection: false, name: "Preflight kept", about: "Seconds a browser may keep RPE's answer to a page's preflight before it asks again.", effect: "start" },
  pageTokenMinutes: { key: "auth.pageTokenMinutes", default: D.auth.pageTokenMinutes, takes: whole(1), advice: [{ above: 7 * 24 * 60, says: "A page token that holds over a week lets a page lost or copied in that time call RPE." }], levels: GLOBAL, perConnection: false, name: "A page token holds", about: "Minutes a page token holds before the page needs a new one.", effect: "start" },
  commandLineSeconds: { key: "auth.commandLineSeconds", default: D.auth.commandLineSeconds, takes: whole(1), advice: [{ below: 5, says: "A slow command may find its token run out before RPE answers it." }, { above: 3600, says: "The command line's token holds over an hour after the command that made it." }], levels: GLOBAL, perConnection: false, name: "The command line's token holds", about: "Seconds the token the command line makes to call the running server holds.", effect: "start" },
  webKeyDays: { key: "auth.webKeyDays", default: D.auth.webKeyDays, takes: whole(1), advice: [{ above: 36_500, says: "Over a hundred years: none makes a key that holds until a new one replaces it." }], orNone: true, none: "no end: it holds until a new one replaces it", levels: GLOBAL, perConnection: false, name: "The web app's key holds", about: "Days the web app's key holds after it is made.", effect: "start" },
  webSessionMinutes: { key: "auth.webSessionMinutes", default: D.auth.webSessionMinutes, takes: whole(1), advice: [{ above: 7 * 24 * 60, says: "A web session left open holds over a week." }], levels: GLOBAL, perConnection: false, name: "A web session holds", about: "Minutes a session of the web app holds, which the printed token or a Lumiverse sign-in opens; it is renewed while a page is open.", effect: "start" },
  nonceSeconds: { key: "auth.nonceSeconds", default: D.auth.nonceSeconds, takes: whole(1), advice: [{ above: 3600, says: "RPE remembers every page's nonces for over an hour." }], levels: GLOBAL, perConnection: false, name: "A page's nonce is remembered", about: "Seconds RPE remembers a nonce a page sent for its proof that this is RPE; the same nonce is not answered twice within them.", effect: "start" },
  signInTries: { key: "auth.signInTries", default: D.auth.signInTries, takes: whole(1), advice: [{ above: 4, says: "Lumiverse locks RPE's own address out after 5 wrong passwords." }], levels: GLOBAL, perConnection: false, name: "Wrong Lumiverse passwords tried", about: "Wrong Lumiverse passwords RPE sends Lumiverse before it pauses; at most 4, below the 5 after which Lumiverse locks RPE's own address out.", effect: "start" },
  signInPauseMinutes: { key: "auth.signInPauseMinutes", default: D.auth.signInPauseMinutes, takes: whole(1), advice: [{ above: 24 * 60, says: "After wrong passwords RPE sends Lumiverse none for over a day." }], levels: GLOBAL, perConnection: false, name: "Pause after wrong Lumiverse passwords", about: "Minutes RPE sends Lumiverse no password after the wrong ones the setting before allows.", effect: "start" },
  refusedSignInSeconds: { key: "auth.refusedSignInSeconds", default: D.auth.refusedSignInSeconds, takes: whole(1), advice: [{ above: 24 * 3600, says: "A sign-in that was refused is told in the log only after over a day." }], levels: GLOBAL, perConnection: false, name: "Refused sign-ins in one log line", about: "Seconds over which the sign-ins to the web app that one address was refused are told in one line of RPE's log, with how many there were.", effect: "start" },
  queueEvents: { key: "liveSocket.queueEvents", default: D.live.queueEvents, takes: whole(1), advice: [{ above: 1_000_000, says: "Over a million events are held in RPE's memory for one slow page." }], levels: GLOBAL, perConnection: false, name: "Events held for a slow page", about: "Events the live socket holds for one slow page following one chat; past it the oldest are dropped, and the page is told which.", effect: "start" },
  messageBytes: { key: "liveSocket.maxMessageBytes", default: D.live.messageBytes, takes: whole(1), advice: [{ below: 256, says: "A page's own messages on the live socket (a follow, a renewal) take up to 256 bytes, and are refused." }, { above: 16 * 1024 * 1024, says: "A page may send a message this large, held whole in memory." }], levels: GLOBAL, perConnection: false, name: "Largest live message", about: "Bytes of the largest message a page may send on the live socket.", effect: "start" },
  follows: { key: "liveSocket.maxFollows", default: D.live.follows, takes: whole(1), advice: [{ above: 100_000, says: "One page may follow over 100,000 chats at once." }], levels: GLOBAL, perConnection: false, name: "Chats one live socket follows", about: "The most chats one page's live socket may follow at once; your jobs and your own events count as one each.", effect: "start" },
  chatIdChars: { key: "liveSocket.maxChatIdChars", default: D.live.chatIdChars, takes: whole(1), advice: [{ above: 10_000, says: "A chat id this long is held for each follow." }], levels: GLOBAL, perConnection: false, name: "Longest chat id followed", about: "The most characters of a chat id a page may follow on the live socket; a longer one is refused.", effect: "start" },
  sockets: { key: "liveSocket.atOnce", default: D.live.sockets, takes: whole(1), advice: [{ above: 100_000, says: "Over 100,000 live sockets may stay open at once." }], levels: GLOBAL, perConnection: false, name: "Live sockets open at once", about: "The most live sockets RPE keeps open at once; one more is closed at once with the reason.", effect: "start" },
  // Bun's server takes an idle time of at most 255 seconds: past it the value has no meaning (plan §2.1 point 5 keeps such a bound).
  idleSeconds: { key: "server.idleSeconds", default: D.server.idleSeconds, takes: { type: "whole", least: 0, most: 255 }, levels: GLOBAL, perConnection: false, name: "Idle connection closed after", about: "Seconds a connection may send and be sent nothing before RPE closes it; 0 for no bound. A reply's stream and the live socket stay open by what they send.", effect: "start" },
  headroomBytes: { key: "server.headroomBytes", default: D.server.headroomBytes, takes: whole(0), advice: [{ above: GIB, says: "The server reads over 1 GiB past a route's limit before it refuses a request." }], levels: GLOBAL, perConnection: false, name: "Room above the largest request", about: "Bytes above the largest body any route takes at which the server itself refuses a request, so that each route refuses a body over its own limit in its own words first.", effect: "start" },
  answerKeepSeconds: { key: "server.answerKeepSeconds", default: D.server.answerKeepSeconds, takes: whole(1), advice: [{ above: 86_400, says: "An answer never read is kept over a day." }], levels: GLOBAL, perConnection: false, name: "A long request's answer kept", about: "Seconds the answer of a request RPE answered at once with an id is kept, once ready, for the page to read; one never read is dropped then.", effect: "start" },
  busyMs: { key: "database.busyMs", default: D.database.busyMs, takes: whole(0), advice: [{ above: 600_000, says: "A write waits over ten minutes for another program's write." }], levels: GLOBAL, perConnection: false, name: "Wait for another writer", about: "Milliseconds a write waits for another program's write to RPE's database file to finish.", effect: "start" },
  sliceMs: { key: "database.sliceMs", default: D.database.sliceMs, takes: whole(1), advice: [{ above: 10_000, says: "The write queue runs writes over ten seconds at a time while other work waits." }], levels: GLOBAL, perConnection: false, name: "Writes run at a time", about: "Milliseconds the write queue runs writes before it lets other work in.", effect: "start" },
  waitMs: { key: "commandLine.waitMs", default: D.commandLine.waitMs, takes: whole(1), advice: [{ below: 100, says: "A command seldom finds the running server within a tenth of a second." }, { above: 600_000, says: "A command waits over ten minutes for the running server." }], levels: GLOBAL, perConnection: false, name: "The command line waits for RPE", about: "Milliseconds rpe status and rpe connection wait for the running server, and a command waits for the data folder's lock.", effect: "start" },
  signInMs: { key: "commandLine.signInMs", default: D.commandLine.signInMs, takes: whole(1), advice: [{ below: 1000, says: "Lumiverse seldom answers a sign-in within a second." }, { above: 600_000, says: "rpe lumiverse waits over ten minutes for a sign-in." }], levels: GLOBAL, perConnection: false, name: "The command line waits for a sign-in", about: "Milliseconds rpe lumiverse waits for Lumiverse to answer its sign-in.", effect: "start" },
  startMs: { key: "commandLine.startMs", default: D.commandLine.startMs, takes: whole(1), advice: [{ below: 1000, says: "RPE seldom starts within a second, and rpe up then puts back what it did." }, { above: 600_000, says: "rpe up waits over ten minutes for RPE to start." }], levels: GLOBAL, perConnection: false, name: "rpe up waits for RPE to start", about: "Milliseconds rpe up waits for RPE to answer once it has started RPE's service, before it puts back what it did.", effect: "start" },
  askEveryMs: { key: "commandLine.askEveryMs", default: D.commandLine.askEveryMs, takes: whole(1), advice: [{ below: 10, says: "rpe up asks over a hundred times a second." }, { above: 60_000, says: "rpe up asks less than once a minute, so it sees RPE up late." }], levels: GLOBAL, perConnection: false, name: "rpe up asks whether RPE answers every", about: "Milliseconds between rpe up's asks whether RPE answers yet, while it waits for RPE's service to start.", effect: "start" },
  // No port is above 65,535: past it the value has no meaning.
  portLast: { key: "service.lastPort", default: D.service.portLast, takes: { type: "whole", least: 1, most: 65_535 }, levels: GLOBAL, perConnection: false, name: "The highest port rpe up tries", about: "The highest port rpe up tries when RPE's port is taken, counting up from it; rpe up then keeps the first free one.", effect: "start" },
  memory: { key: "service.memory", default: D.service.memory, takes: { type: "text" }, levels: GLOBAL, perConnection: false, name: "Memory RPE's service may hold", about: "The most memory RPE's service may hold, as systemd reads a size (768M, 2G) or infinity for none, at least 256M: the unit's MemoryMax. rpe up --memory sets it; the service holds to it from the next rpe up --systemd.", effect: "start" },
  restartWait: { key: "service.restartWaitSeconds", default: D.service.restartWait, takes: whole(1), advice: [{ above: 3600, says: "The service waits over an hour before it starts RPE again." }], levels: GLOBAL, perConnection: false, name: "Wait before the service starts RPE again", about: "Seconds the service manager waits before it starts RPE again once it has stopped: the unit's RestartSec, written by rpe up --systemd.", effect: "start" },
  logLines: { key: "service.logLines", default: D.service.logLines, takes: whole(1), advice: [{ below: 100, says: "Fewer than 100 log lines keep little of what happened." }, { above: 1_000_000, says: "Over a million log lines are held in RPE's memory." }], levels: GLOBAL, perConnection: false, name: "Log lines RPE keeps", about: "How many of its own newest log lines RPE keeps for the Runtime page, each with its level, time, area and the chat, turn or job it names; older ones are let go.", effect: "start" },
  timingsTurns: { key: "service.timingsTurns", default: D.service.timingsTurns, takes: whole(1), advice: [{ above: 10_000, says: "The timings are worked out over more than 10,000 turns at each read." }], levels: GLOBAL, perConnection: false, name: "Turns the timings take in", about: "How many of the latest turns, of a chat or of all chats, the Runtime page's timings of the parts of a turn are taken over.", effect: "start" },
  drainWait: { key: "service.drainWaitSeconds", default: D.service.drainWaitMs / 1000, takes: whole(0), advice: [{ above: 86_400, says: "A later rpe up waits over a day for turns to end." }], levels: GLOBAL, perConnection: false, name: "A later rpe up waits for turns to end", about: "Seconds a later rpe up waits for the turns under way to end before it restarts RPE's service; it restarts it at the end of the wait all the same.", effect: "start" },
  nameLength: { key: "switches.maxNameChars", default: D.switches.nameLength, takes: whole(1), advice: [{ above: 10_000, says: "A name this long is kept for every switch." }], levels: GLOBAL, perConnection: false, name: "The longest name a switch takes", about: "Characters in the longest name of a hook, a command, an MCP server or a connection's place that RPE's registry of what is switched on takes; a longer name is refused.", effect: "start" },
  workerParseBytes: { key: "server.workerParseBytes", default: D.server.workerParseBytes, takes: whole(1), advice: [{ below: 1024, says: "Nearly every request's body is parsed on a worker, which costs more than it saves." }, { above: GIB, says: "No request's body is parsed on a worker: a long prompt's parse holds up the others." }], levels: GLOBAL, perConnection: false, name: "Parsed on a worker from", about: "Bytes from which a request's body is parsed on a worker thread, so that a long prompt's parse never holds up another request.", effect: "start" },
  threads: { key: "workers.threads", default: D.workers.threads, takes: whole(1), advice: [{ above: 256, says: "Over 256 worker threads at once, more than a machine has cores." }], orNone: true, none: "the machine's cores less one, at least one", levels: GLOBAL, perConnection: false, name: "Worker threads", about: "The most worker threads RPE runs its heavy work on at once: parsing very large requests, searching.", effect: "start" },
  threadIdle: { key: "workers.idleSeconds", default: D.workers.idleSeconds, takes: whole(1), advice: [{ below: 10, says: "A thread may end between two tasks of one turn, and each start takes about a fifth of a second." }, { above: 86_400, says: "A thread with nothing to do keeps its memory over a day." }], orNone: true, none: "a thread is kept until RPE stops", levels: GLOBAL, perConnection: false, name: "Idle worker thread ended after", about: "Seconds a worker thread with no task is kept before it ends and lets go of its memory, about 50 MB for each; the next task starts one again, which takes about a fifth of a second.", effect: "start" },
  batch: { key: "database.indexBatch", default: D.index.batch, takes: whole(1), advice: [{ above: 100_000, says: "Over 100,000 rows are written in one transaction, which holds the index file that long." }], levels: GLOBAL, perConnection: false, name: "Index rows written at once", about: "Rows the index file's writer writes in one transaction.", effect: "start" },
  copiesKept: { key: "database.copiesKept", default: D.database.copiesKept, takes: whole(0), advice: [{ above: 1000, says: "Over 1000 copies of RPE's database are kept on disk." }], levels: GLOBAL, perConnection: false, name: "Copies before migrations kept", about: "Copies of RPE's database taken before a new version's migrations that are kept; the oldest are removed once a new version has started. rpe backup's archives and the migration's backups are never removed.", effect: "start" },
  pieceBytes: { key: "backup.pieceBytes", default: D.database.pieceBytes, takes: whole(1), advice: [{ below: 4096, says: "An archive reads each file a few bytes at a time." }, { above: 64 * 1024 * 1024, says: "An archive holds over 64 MiB of a file in memory at once." }], levels: GLOBAL, perConnection: false, name: "Archive piece", about: "Bytes an archive (rpe backup's, the migration's backup) reads each file in at a time.", effect: "start" },
} as const satisfies Record<string, Setting>;

/** Every setting of the app's own limits. */
export const SERVER_SETTINGS: readonly Setting[] = Object.values(SERVER_SETTING_DEFS);

/** Each limit's key in config.json as builds before this one wrote it, and the setting it is now. */
const OLD_KEYS: readonly (readonly [string, Setting])[] = [
  ["address", SERVER_SETTING_DEFS.address],
  ["origins", SERVER_SETTING_DEFS.origins],
  ["hosts", SERVER_SETTING_DEFS.hosts],
  ["server.bodyBytes", SERVER_SETTING_DEFS.bodyBytes],
  ["server.providerBodyBytes", SERVER_SETTING_DEFS.providerBodyBytes],
  ["server.preflightSeconds", SERVER_SETTING_DEFS.preflightSeconds],
  ["auth.pageTokenMinutes", SERVER_SETTING_DEFS.pageTokenMinutes],
  ["auth.commandLineSeconds", SERVER_SETTING_DEFS.commandLineSeconds],
  ["auth.webKeyDays", SERVER_SETTING_DEFS.webKeyDays],
  ["live.queueEvents", SERVER_SETTING_DEFS.queueEvents],
  ["live.messageBytes", SERVER_SETTING_DEFS.messageBytes],
  ["live.follows", SERVER_SETTING_DEFS.follows],
  ["database.busyMs", SERVER_SETTING_DEFS.busyMs],
  ["database.sliceMs", SERVER_SETTING_DEFS.sliceMs],
  ["commandLine.waitMs", SERVER_SETTING_DEFS.waitMs],
  ["commandLine.signInMs", SERVER_SETTING_DEFS.signInMs],
  ["commandLine.startMs", SERVER_SETTING_DEFS.startMs],
];

/** The top-level keys of config.json that hold the install's facts. */
const FACT_KEYS = ["v", "port", "lumiverse"] as const;

// ---------------------------------------------------------------- reading values

type Reader<T> = (value: unknown, where: string) => T;

const wholeIn =
  (min: number, max: number): Reader<number> =>
  (value, where) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new ConfigError(`${where} must be a whole number from ${min} to ${max}.`);
    return value;
  };

/** A value `read` takes, or null for none. */
const orNull =
  <T>(read: Reader<T>): Reader<T | null> =>
  (value, where) =>
    value === null ? null : read(value, where);

/** One line of text with no space at either end. */
export const plainText: Reader<string> = (value, where) => {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) throw new ConfigError(`${where} must be text, with no space at either end.`);
  return value;
};

/** An http or https address, without the slashes it ends in. */
export const webAddress: Reader<string> = (value, where) => {
  const text = plainText(value, where);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ConfigError(`${where} must be an address such as http://127.0.0.1:7860.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ConfigError(`${where} must start with http:// or https://.`);
  return text.replace(/\/+$/, "");
};

/** An origin as a browser sends it: scheme, host and a port only when it is not the scheme's own. */
const origin: Reader<string> = (value, where) => {
  const text = webAddress(value, where);
  const parsed = new URL(text);
  if (parsed.origin !== text.toLowerCase()) throw new ConfigError(`${where} must be an origin alone, such as https://lumiverse.example: no path, and no port the scheme already implies.`);
  return parsed.origin;
};

const listOf =
  <T>(read: Reader<T>): Reader<T[]> =>
  (value, where) => {
    if (!Array.isArray(value)) throw new ConfigError(`${where} must be a list.`);
    return value.map((item, i) => read(item, `${where}[${i}]`));
  };

/** A size systemd reads, at least what RPE needs to start (`service.memory`). */
const memoryText: Reader<string> = (value, where) => {
  const text = plainText(value, where);
  const why = memoryRefusal(text);
  if (why !== null) throw new ConfigError(`${where} is "${text}": ${why}.`);
  return text;
};

const hostName: Reader<string> = (value, where) => {
  const text = plainText(value, where).toLowerCase();
  if (/[\s/@]/.test(text)) throw new ConfigError(`${where} must be a host name, with a port after a colon if it should hold to one.`);
  return text;
};

/** The keys an object of the file may hold, each with its reader and its default. */
type Shape<T> = { [K in keyof T]: [Reader<T[K]>, T[K]] };

function readGroup<T>(raw: unknown, where: string, shape: Shape<T>): T {
  if (raw === undefined) raw = {};
  if (!isRecord(raw)) throw new ConfigError(`${where} must be an object.`);
  const known = Object.keys(shape);
  const unknown = Object.keys(raw).filter((k) => !known.includes(k));
  if (unknown.length > 0) throw new ConfigError(`${where} has ${unknown.map((k) => `"${k}"`).join(", ")}, which RPE does not know. It takes ${known.join(", ")}.`);
  const out = {} as T;
  for (const key of known as (keyof T & string)[]) {
    const [read, fallback] = shape[key];
    out[key] = raw[key] === undefined ? structuredClone(fallback) : read(raw[key], `${where}.${key}`);
  }
  return out;
}

/** The address, origins and names a read of the settings gives, each checked as the server takes it: one it does not take is logged, and its default holds. */
function checkedSetting<T>(read: ConfigRead, def: Setting, check: Reader<T>, fallback: T, log: Log | null): T {
  const value = read.value(def);
  try {
    return check(value, def.key);
  } catch (error) {
    log?.warn("A setting has a value it does not take; its default holds.", { setting: def.key, value, why: error instanceof Error ? error.message : String(error) });
    return structuredClone(fallback);
  }
}

/** The app's limits as the settings of the levels every chat shares set them over their defaults. */
export function limitsOf(read: ConfigRead, log: Log | null = null): AppLimits {
  const s = SERVER_SETTING_DEFS;
  // Every value is one its setting takes (`ConfigRead.value`), of the type its `takes` says.
  const n = (def: Setting): number => read.value(def) as number;
  return {
    address: checkedSetting(read, s.address, hostName, D.address, log),
    origins: checkedSetting(read, s.origins, listOf(origin), D.origins, log),
    hosts: checkedSetting(read, s.hosts, listOf(hostName), D.hosts, log),
    server: { bodyBytes: n(s.bodyBytes), providerBodyBytes: n(s.providerBodyBytes), preflightSeconds: n(s.preflightSeconds), workerParseBytes: n(s.workerParseBytes), idleSeconds: n(s.idleSeconds), headroomBytes: n(s.headroomBytes), answerKeepSeconds: n(s.answerKeepSeconds) },
    auth: { pageTokenMinutes: n(s.pageTokenMinutes), commandLineSeconds: n(s.commandLineSeconds), webKeyDays: read.value(s.webKeyDays) as number | null, webSessionMinutes: n(s.webSessionMinutes), nonceSeconds: n(s.nonceSeconds), signInTries: n(s.signInTries), signInPauseMinutes: n(s.signInPauseMinutes), refusedSignInSeconds: n(s.refusedSignInSeconds) },
    live: { queueEvents: n(s.queueEvents), messageBytes: n(s.messageBytes), follows: n(s.follows), chatIdChars: n(s.chatIdChars), sockets: n(s.sockets) },
    database: { busyMs: n(s.busyMs), sliceMs: n(s.sliceMs), copiesKept: n(s.copiesKept), pieceBytes: n(s.pieceBytes) },
    commandLine: { waitMs: n(s.waitMs), signInMs: n(s.signInMs), startMs: n(s.startMs), askEveryMs: n(s.askEveryMs) },
    service: { portLast: n(s.portLast), memory: checkedSetting(read, s.memory, memoryText, D.service.memory, log), restartWait: n(s.restartWait), drainWaitMs: n(s.drainWait) * 1000, logLines: n(s.logLines), timingsTurns: n(s.timingsTurns) },
    switches: { nameLength: n(s.nameLength) },
    workers: { threads: read.value(s.threads) as number | null, idleSeconds: read.value(s.threadIdle) as number | null },
    index: { batch: n(s.batch) },
  };
}

/** The limits where no file sets them. */
export const LIMIT_DEFAULTS: Readonly<AppLimits> = Object.freeze(limitsOf(readConfig([], null)));

/**
 * The config the file `raw`, the environment `env` and the app's limits give. `where` names the file
 * in what is refused. A config.json of an earlier build may still hold limits of its own, which are in
 * force over the settings' until they are moved (`moveLimits`).
 */
export function configOf(raw: unknown, env: Env, where: string, limits: AppLimits = LIMIT_DEFAULTS): AppConfig {
  const l = limits;
  if (isRecord(raw) && raw.v !== undefined && raw.v !== 1) throw new ConfigError(`${where} is of a format this RPE does not read (v ${String(raw.v)}).`);
  const { v: _v, ...rest } = isRecord(raw) ? raw : ({} as Record<string, unknown>);
  const read = readGroup<Omit<AppConfig, "fromEnvironment" | "service" | "switches" | "workers" | "index" | "auth"> & { auth: Pick<AppConfig["auth"], "pageTokenMinutes" | "commandLineSeconds" | "webKeyDays"> }>(isRecord(raw) ? rest : raw, where, {
    address: [hostName, l.address],
    port: [wholeIn(0, 65535), D.port],
    lumiverse: [
      (value, at) => {
        const block = readGroup<Omit<AppConfig["lumiverse"], "connections"> & { connection: string | null; connections: string[] }>(value, at, {
          url: [(url, where) => (url === null ? null : webAddress(url, where)), D.lumiverse.url],
          user: [(user, where) => (user === null ? null : plainText(user, where)), D.lumiverse.user],
          database: [(file, where) => (file === null ? null : plainText(file, where)), D.lumiverse.database],
          // The one id of a config.json from before the list: a list of one.
          connection: [(id, where) => (id === null ? null : plainText(id, where)), null],
          connections: [listOf(plainText), D.lumiverse.connections],
          models: [listOf(plainText), D.lumiverse.models],
        });
        const { connection, connections, ...facts } = block;
        return { ...facts, connections: connections.length > 0 || connection === null ? connections : [connection] };
      },
      D.lumiverse,
    ],
    origins: [listOf(origin), l.origins],
    hosts: [listOf(hostName), l.hosts],
    server: [
      (value, at) => ({
        // No build before this one wrote these to config.json: they are the settings' alone.
        workerParseBytes: l.server.workerParseBytes,
        idleSeconds: l.server.idleSeconds,
        headroomBytes: l.server.headroomBytes,
        answerKeepSeconds: l.server.answerKeepSeconds,
        ...readGroup(value, at, {
          bodyBytes: [wholeIn(1024, 1024 * 1024 * 1024), l.server.bodyBytes],
          providerBodyBytes: [wholeIn(1024, 1024 * 1024 * 1024), l.server.providerBodyBytes],
          preflightSeconds: [wholeIn(0, 86_400), l.server.preflightSeconds],
        }),
      }),
      l.server,
    ],
    auth: [
      (value, at) =>
        readGroup(value, at, {
          pageTokenMinutes: [wholeIn(1, 7 * 24 * 60), l.auth.pageTokenMinutes],
          commandLineSeconds: [wholeIn(5, 3600), l.auth.commandLineSeconds],
          webKeyDays: [orNull(wholeIn(1, 36_500)), l.auth.webKeyDays],
        }),
      l.auth,
    ],
    live: [
      (value, at) => ({
        chatIdChars: l.live.chatIdChars,
        sockets: l.live.sockets,
        ...readGroup(value, at, {
          queueEvents: [wholeIn(1, 1_000_000), l.live.queueEvents],
          messageBytes: [wholeIn(256, 16 * 1024 * 1024), l.live.messageBytes],
          follows: [wholeIn(1, 100_000), l.live.follows],
        }),
      }),
      l.live,
    ],
    database: [
      (value, at) => ({
        // No build before this one wrote these to config.json: they are the settings' alone.
        copiesKept: l.database.copiesKept,
        pieceBytes: l.database.pieceBytes,
        ...readGroup(value, at, {
          busyMs: [wholeIn(0, 600_000), l.database.busyMs],
          sliceMs: [wholeIn(1, 10_000), l.database.sliceMs],
        }),
      }),
      l.database,
    ],
    commandLine: [
      (value, at) => ({
        // No build before this one wrote it to config.json: it is the setting's alone.
        askEveryMs: l.commandLine.askEveryMs,
        ...readGroup(value, at, {
          waitMs: [wholeIn(100, 600_000), l.commandLine.waitMs],
          signInMs: [wholeIn(1000, 600_000), l.commandLine.signInMs],
          startMs: [wholeIn(1000, 600_000), l.commandLine.startMs],
        }),
      }),
      l.commandLine,
    ],
  });
  // The web sessions' own settings were never in config.json: they are the settings' alone.
  const { webSessionMinutes, nonceSeconds, signInTries, signInPauseMinutes, refusedSignInSeconds } = l.auth;
  const config: AppConfig = { ...read, auth: { ...read.auth, webSessionMinutes, nonceSeconds, signInTries, signInPauseMinutes, refusedSignInSeconds }, service: structuredClone(l.service), switches: { ...l.switches }, workers: { ...l.workers }, index: { ...l.index }, fromEnvironment: [] };
  const set = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === undefined || value === "" ? undefined : value;
  };
  const port = set(CONFIG_ENV.port);
  if (port !== undefined) {
    config.port = wholeIn(0, 65535)(/^\d+$/.test(port) ? Number(port) : port, CONFIG_ENV.port);
    config.fromEnvironment.push("port");
  }
  const url = set(CONFIG_ENV.lumiverseUrl);
  if (url !== undefined) {
    config.lumiverse.url = webAddress(url, CONFIG_ENV.lumiverseUrl);
    config.fromEnvironment.push("lumiverse.url");
  }
  const user = set(CONFIG_ENV.lumiverseUser);
  if (user !== undefined) {
    config.lumiverse.user = plainText(user, CONFIG_ENV.lumiverseUser);
    config.fromEnvironment.push("lumiverse.user");
  }
  return config;
}

/** The config file's JSON as it is; `{}` where there is none. */
async function configFile(paths: DataPaths): Promise<unknown> {
  const text = await readText(paths.config);
  if (text === null) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${paths.config} is not JSON (${error instanceof Error ? error.message : String(error)}): fix it, or remove it to start from the defaults.`);
  }
}

/** The app's limits as the shipped and the user's `RPE-global.yml` set them, through the one reader of the config levels; `log` hears of what is passed over. */
export async function settingsLimits(paths: DataPaths, log: Log | null = null): Promise<AppLimits> {
  const files = [
    { level: "shipped" as const, file: paths.shippedConfig, disk: paths.shippedConfig },
    { level: "global" as const, file: paths.globalConfig, disk: paths.globalConfig },
  ];
  return limitsOf(readConfig(await diskTexts(files), log, SERVER_SETTINGS), log);
}

/** The app's config: the install's facts in the data folder's config.json and from the environment, and its limits from `RPE-global.yml`. */
export async function loadConfig(paths: DataPaths, env: Env, log: Log | null = null): Promise<AppConfig> {
  return configOf(await configFile(paths), env, paths.config, await settingsLimits(paths, log));
}

/** Runs `write` holding the config's lock, which every writer of config.json takes; a lock left by a writer that ended is let go by the system, so it never waits on a dead one. */
async function underConfigLock<T>(paths: DataPaths, what: string, write: () => Promise<T>): Promise<T> {
  const lock = await takeFolderLock(join(paths.root, CONFIG_LOCK_FOLDER), what, { waitMs: Number.POSITIVE_INFINITY, pollMs: 5 });
  try {
    return await write();
  } finally {
    lock.release();
  }
}

/**
 * Changes the config file in place, holding the config's lock: `change` is given its JSON, and
 * everything else the file holds is kept as it was. The file is written only when RPE reads the result.
 */
export async function updateConfigFile(paths: DataPaths, change: (raw: Record<string, unknown>) => void): Promise<void> {
  await underConfigLock(paths, "a change to config.json", async () => {
    const raw = await configFile(paths);
    if (!isRecord(raw)) throw new ConfigError(`${paths.config} must hold one JSON object.`);
    change(raw);
    configOf(raw, {}, paths.config);
    await writeWhole(paths.config, `${JSON.stringify(raw, null, 2)}\n`);
  });
}

/** What config.json holds at a dotted key; undefined where it holds nothing. */
function rawAt(raw: Record<string, unknown>, key: string): unknown {
  let at: unknown = raw;
  for (const part of key.split(".")) at = isRecord(at) ? at[part] : undefined;
  return at;
}

/** Whether an address is loopback's own. */
function isLoopback(address: string): boolean {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(address.toLowerCase());
}

/**
 * Moves the limits an earlier build's config.json holds into the user's `RPE-global.yml`, each value
 * kept as its setting, and leaves config.json the install's facts alone; holding the config's lock.
 * An address there other than loopback is the address chosen to listen on, so it becomes
 * `server.address`; RPE's connection in Lumiverse still reaches it on loopback. The settings are
 * written first, so a move cut short is made again at the next start, with the same values. Gives the
 * keys moved, which it logs; none for a config.json that holds none.
 */
export async function moveLimits(paths: DataPaths, log: Log): Promise<string[]> {
  return await underConfigLock(paths, "moving config.json's limits to RPE-global.yml", async () => {
    const raw = await configFile(paths);
    if (!isRecord(raw)) return [];
    const held = OLD_KEYS.flatMap(([old, def]) => {
      const value = rawAt(raw, old);
      return value === undefined ? [] : [{ old, def, value: value as JsonValue }];
    });
    if (held.length === 0) return [];
    // Each value as the file held it, checked as it always was before it is moved.
    configOf(raw, {}, paths.config);
    const moving = held.filter((h) => !(h.def === SERVER_SETTING_DEFS.address && typeof h.value === "string" && isLoopback(h.value)));
    if (moving.length > 0) {
      await oneFileAtATime(paths.globalConfig, async () => {
        let text = (await readText(paths.globalConfig)) ?? "";
        for (const h of moving) text = withKeyAt(text, h.def.key.split("."), h.value, paths.globalConfig);
        await mkdir(paths.files, { recursive: true });
        await writeWhole(paths.globalConfig, text);
      });
    }
    const facts = Object.fromEntries(FACT_KEYS.flatMap((key) => (raw[key] === undefined ? [] : [[key, raw[key]]])));
    await writeWhole(paths.config, `${JSON.stringify(facts, null, 2)}\n`);
    const moved = held.map((h) => h.old);
    log.info("config.json's limits are settings in RPE-global.yml now, each value kept", { moved, to: moving.map((h) => h.def.key) });
    return moved;
  });
}

/** One of the install's facts as the Settings page lists it: its key in config.json, what it is, its value, and where it was given. */
export interface InstallFact {
  key: string;
  name: string;
  value: JsonValue;
  /** config.json, the environment, or where the install put the data folder. */
  from: "config.json" | "environment" | "install";
}

/** The install's facts: which Lumiverse, which user, the port RPE's connection points at, that connection and its models, and where RPE keeps its data. */
export function installFacts(config: AppConfig, paths: DataPaths): InstallFact[] {
  const from = (key: string): InstallFact["from"] => (config.fromEnvironment.includes(key) ? "environment" : "config.json");
  return [
    { key: "lumiverse.url", name: "Lumiverse's address", value: config.lumiverse.url, from: from("lumiverse.url") },
    { key: "lumiverse.user", name: "Your Lumiverse user", value: config.lumiverse.user, from: from("lumiverse.user") },
    { key: "lumiverse.database", name: "Lumiverse's database file", value: config.lumiverse.database, from: from("lumiverse.database") },
    { key: "port", name: "RPE's port, on loopback, that its connection in Lumiverse points at", value: config.port, from: from("port") },
    { key: "lumiverse.connections", name: "RPE's connections in Lumiverse", value: config.lumiverse.connections, from: from("lumiverse.connections") },
    { key: "lumiverse.models", name: "The models that connection offers", value: config.lumiverse.models, from: from("lumiverse.models") },
    { key: "data", name: "RPE's data folder", value: paths.root, from: "install" },
    { key: "database", name: "RPE's database file", value: paths.database, from: "install" },
  ];
}

/**
 * Makes the data folder ready: the folder and the backups folder enterable by their owner alone, the
 * file tree's folder, and a config file holding the install's facts as they stand at first (no
 * Lumiverse and no user yet), when there is none.
 */
export async function prepareDataFolder(paths: DataPaths): Promise<void> {
  await ownerOnlyFolder(paths.root);
  await ownerOnlyFolder(paths.backups);
  await mkdir(paths.files, { recursive: true });
  if ((await readText(paths.config)) === null) {
    const first = { v: 1, port: CONFIG_DEFAULTS.port, lumiverse: { url: null, user: null } };
    await writeWhole(paths.config, `${JSON.stringify(first, null, 2)}\n`);
  }
  // A secrets file someone made readable to others is made private again before RPE reads it.
  try {
    await chmod(paths.secrets, OWNER_ONLY_FILE);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}
