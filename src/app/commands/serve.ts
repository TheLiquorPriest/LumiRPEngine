// `rpe serve`: RPE in the foreground.

import { lineLog, openApp } from "../app";
import { copyUpdate, isInstalledCopy, recordedSource } from "../app-copy";
import { currentKeys } from "../auth";
import type { CliIO, CliOptions } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import { accountSystemctl, rpeServiceOf } from "../up";
import { type AppFile, startCheck, versionOf } from "../update";
import { runLine } from "./run-line";
import { updateSettingsOf } from "./update-settings";
import { takeLock } from "./writer";

/** Whether this process is the one RPE's service runs (its unit's main process), which the account's manager starts again when it exits. */
async function runByService(paths: DataPaths, io: CliIO): Promise<boolean> {
  const service = await rpeServiceOf(paths.root, io.env, io.home);
  if (service === null) return false;
  const ran = await accountSystemctl(io.env, process.getuid?.() ?? null)(["show", "--property=MainPID", "--value", service.unit]);
  return ran.code === 0 && Number(ran.out.trim()) === process.pid;
}

/**
 * RPE in the foreground. It holds the data folder's lock for as long as it runs: it is the one writer,
 * and a command that changes something asks it, on its socket. A command that holds the lock when it
 * starts (one that is writing with RPE stopped) is waited for, and the wait is said.
 */
export async function serveCommand(paths: DataPaths, config: AppConfig, io: CliIO, options: CliOptions): Promise<number> {
  const lock = await takeLock({ paths, config, io, version: options.version, what: "rpe serve" });
  try {
    return await serving(paths, config, io, options);
  } finally {
    lock.release();
  }
}

async function serving(paths: DataPaths, config: AppConfig, io: CliIO, options: CliOptions): Promise<number> {
  const log = lineLog(io.err, io.now);
  // A restart onto a new build ends `serve` as a stop does, and RPE's service starts the new file; a swap into RPE's own copy is made once the app has closed.
  const restart = Promise.withResolvers<void>();
  const after: { run: (() => Promise<void>) | null } = { run: null };
  const startsOn = (path: string, waitMs: number): Promise<string | null> => startCheck(process.execPath, path, paths.root, waitMs);
  // Run as RPE's own installed copy, it takes a new build from the one file the install recorded, on the extension's word alone.
  const source = options.appFile !== undefined && isInstalledCopy(options.appFile, paths.root) ? await recordedSource(paths.root) : null;
  const appFile: AppFile | null =
    options.appFile === undefined
      ? null
      : {
          path: options.appFile,
          buildOf: (path, waitMs) => versionOf(process.execPath, path, waitMs),
          startsOn,
          settings: () => updateSettingsOf(paths, log),
          service: () => runByService(paths, io),
          restart: (then) => {
            after.run = then ?? null;
            restart.resolve();
          },
          sleep: (ms) => Bun.sleep(ms),
          ...(source === null ? {} : { copy: copyUpdate(paths.root, source, startsOn) }),
        };
  const app = await openApp({ paths, config, version: options.version, areas: options.areas ?? [], now: io.now, log, appFile });
  try {
    const running = await app.start();
    // A swapped-in build that is up and listening has come up: the service's pre-start step counts its starts no more.
    await app.builds.cameUp();
    // Told to stop from here on, RPE closes and ends cleanly: the wait begins before anything else that takes time.
    const stop = io.stopped();
    io.out(`RPE ${options.version} listens on ${running.url} (data folder: ${paths.root}).`);
    if (!currentKeys(app.db, app.auth.owner).some((k) => k.kind === "provider")) io.out(`There is no provider key yet: make one with ${runLine(io, paths, "key", "provider")}`);
    const waiting = app.switches.list().filter((s) => s.state === "waiting").length;
    if (waiting > 0) io.out(`${waiting} waiting to be switched on: \`${runLine(io, paths, "status")}\` lists them.`);
    // The file as it is once RPE listens: a build put there while it started is noticed now.
    await Promise.race([app.builds.check(), stop]);
    await Promise.race([stop, restart.promise]);
  } finally {
    await app.close();
  }
  await after.run?.();
  return 0;
}
