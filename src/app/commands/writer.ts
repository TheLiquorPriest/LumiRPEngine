// How a command of `rpe` that changes something gets it written, with one writer at a time (plan
// §4.1): while RPE runs, by the server, asked over the socket only its owner can open; while RPE is
// stopped, by the command itself, which takes the data folder's lock first (the server takes it too)
// and is then the one writer, the migrations it applies included. Two commands at once write one
// after the other.

import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { isRecord } from "../../shared/json";
import { STATUS_PATH } from "../app";
import type { CliIO } from "../cli";
import type { CommandOps, CommandSink } from "../command-routes";
import { COMMAND_PATHS, commandOps, CommandRefused, commandStatus, keyMade, switched } from "../command-routes";
import type { AppConfig, DataPaths } from "../config";
import { prepareDataFolder } from "../config";
import { commandSocketPath, DataFolderBusy, type FolderLock, type LockHolder, takeFolderLock } from "../data-folder";
import { NO_OWNER } from "../auth";
import { SecretsFile } from "../secrets";
import { type AnyShape, type Infer, problemsOf } from "../routes";
import { commandLineDatabase } from "./database";

/** What a writer needs of the command it serves. */
export interface WriterContext {
  paths: DataPaths;
  config: AppConfig;
  io: CliIO;
  version: string;
  /** The command, in the words that name it to a process that waits for it: `rpe key`. */
  what: string;
}

/** A call to the running server's API on its socket: as its owner, with no token. */
export type Api = (method: string, path: string, body?: unknown) => Promise<Response>;

/** `value`, which must be what `of` says; the server's own answer is checked as any caller's is. */
function readAs<S extends AnyShape>(of: S, value: unknown, what: string): Infer<S> {
  const problems = problemsOf(of, value, what);
  if (problems.length > 0) throw new Error(`RPE's answer to ${what} is not what this build reads: ${problems.join(" ")}`);
  // problemsOf found none: the value has the shape `of` describes.
  const checked = value as Infer<S>;
  return checked;
}

/** Calls on the running server's socket, which only the owner's account can open: every route of the API answers there as the owner. */
function socketApi(paths: DataPaths, config: AppConfig, io: CliIO): Api {
  const socket = commandSocketPath(paths.root);
  return (method, path, body) =>
    io.fetch(`http://rpe.local${path}`, {
      method,
      unix: socket,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(config.commandLine.waitMs),
    });
}

/** The server's answer to a call, or its refusal as an error in its own words. */
type SocketCall = (method: string, path: string, body?: unknown) => Promise<unknown>;

function socketCall(api: Api): SocketCall {
  return async (method, path, body) => {
    const res = await api(method, path, body);
    const text = await res.text();
    const answer: unknown = text === "" ? undefined : JSON.parse(text);
    if (!res.ok) throw new Error(isRecord(answer) && typeof answer.error === "string" ? answer.error : `RPE answered ${res.status}.`);
    return answer;
  };
}

/** Whether RPE runs: whether something answers as RPE on its command socket. */
async function serverRuns(api: Api, paths: DataPaths): Promise<boolean> {
  if (!existsSync(commandSocketPath(paths.root))) return false;
  try {
    const answer: unknown = await (await api("GET", STATUS_PATH)).json();
    return isRecord(answer) && answer.name === "rpe";
  } catch {
    // A socket nobody listens on is what a server that was killed leaves behind.
    return false;
  }
}

/** The running server, as the command line reaches it: its whole API as the owner, and the changes only the command line asks of it; null where RPE does not run. */
export async function runningServer(paths: DataPaths, config: AppConfig, io: CliIO): Promise<{ api: Api; ops: CommandOps } | null> {
  const api = socketApi(paths, config, io);
  return (await serverRuns(api, paths)) ? { api, ops: socketOps(socketCall(api)) } : null;
}

/** The command line's changes, asked of the running server. */
export function socketOps(call: SocketCall): CommandOps {
  return {
    async makeKey(ask) {
      return readAs(keyMade, await call("POST", COMMAND_PATHS.keys, ask), "a new key");
    },
    async takeKey(hash) {
      await call("POST", COMMAND_PATHS.takenKeys, { hash });
    },
    async setSwitch(name, state) {
      return readAs(switched, await call("PUT", COMMAND_PATHS.switches.replace(":name", encodeURIComponent(name)), { state }), "the switch");
    },
    async saveLumiverse(save) {
      await call("PUT", COMMAND_PATHS.lumiverse, save);
    },
    async status() {
      return readAs(commandStatus, await call("GET", COMMAND_PATHS.status), "the status");
    },
  };
}

/** What a process that waits says to the user: who has the data folder. */
function waitingWords(holder: LockHolder | null): string {
  return holder === null ? "Waiting for another rpe process that holds the data folder to finish..." : `Waiting for ${holder.what} (process ${holder.pid}), which holds the data folder, to finish...`;
}

/**
 * Takes the data folder's lock for `ctx.what`, waiting up to `commandLine.waitMs` and saying why on
 * the first wait; throws what `DataFolderBusy` says where it is still held then. For a command that
 * needs RPE stopped, or that must be the data folder's one writer for as long as it runs.
 */
export async function takeLock(ctx: WriterContext): Promise<FolderLock> {
  return await takeFolderLock(ctx.paths.root, ctx.what, { waitMs: ctx.config.commandLine.waitMs, now: ctx.io.now, onWait: (holder) => ctx.io.err(waitingWords(holder)) });
}

/**
 * A sink over a database and secrets file of the command's own: only under the lock. The database is
 * opened when a change needs it, so that a change of the secrets file or the config alone (the
 * sign-in, which is what names the user) opens none.
 */
function folderSink(ctx: WriterContext): { sink: CommandSink; close(): void } {
  let opened: Database | null = null;
  const open = (): Database => (opened ??= commandLineDatabase(ctx.paths, ctx.config, ctx.version, ctx.io.now));
  return {
    sink: {
      paths: ctx.paths,
      secrets: new SecretsFile(ctx.paths.secrets),
      user: ctx.config.lumiverse.user,
      get db() {
        return open();
      },
      run: async (write) => {
        const db = open();
        return db.transaction(() => write(db)).immediate();
      },
      now: ctx.io.now,
    },
    close: () => opened?.close(),
  };
}

/**
 * Runs `use` with the command line's changes: written by the running server where one answers on
 * its socket, else by this process under the data folder's lock. While it waits for a holder that
 * is not yet answering (a server that is starting, another command), it asks again, and says why it
 * waits once; past `commandLine.waitMs` it fails with who holds the folder. `forUser`: the change
 * is of the user's own rows, which are written for no one before the install has named him.
 */
export async function withWriter<T>(ctx: WriterContext, use: (ops: CommandOps, via: "server" | "folder") => Promise<T>, options: { forUser?: true } = {}): Promise<T> {
  const { paths, config, io } = ctx;
  // A change of the user's own rows before the install names him writes nothing, not even a lock (R-179).
  if (options.forUser === true && config.lumiverse.user === null) throw new Error(NO_OWNER);
  const began = performance.now();
  let lock: FolderLock | null = null;
  let said = false;
  for (;;) {
    const server = await runningServer(paths, config, io);
    if (server !== null) return await use(server.ops, "server");
    try {
      lock = await takeFolderLock(paths.root, ctx.what, { waitMs: 0, now: io.now });
      break;
    } catch (error) {
      if (!(error instanceof DataFolderBusy)) throw error;
      if (!said) {
        said = true;
        io.err(waitingWords(error.holder));
      }
      const waited = performance.now() - began;
      if (waited >= config.commandLine.waitMs) throw new DataFolderBusy(paths.root, error.holder, config.commandLine.waitMs);
      await Bun.sleep(Math.min(25, config.commandLine.waitMs - waited));
    }
  }
  try {
    await prepareDataFolder(paths);
    const { sink, close } = folderSink(ctx);
    try {
      return await use(commandOps(sink), "folder");
    } finally {
      close();
    }
  } finally {
    lock.release();
  }
}

export { CommandRefused };
