// The application after an update of the extension (plan §4.6: "After the cutover, updates are the
// ones you already do: update the extension in Lumiverse. The extension tells RPE a new app file has
// arrived; RPE checks its hash, tests that it starts, swaps and restarts. 'Update now' stays in the
// UI."). Lumiverse replaces the files in the extension's folder, and the app file the service `rpe up`
// installed runs is one of them, so the running build goes on until the process starts again.
//
// The app keeps its file's hash from the start. When the extension registers as another build, and
// whenever it is asked, it reads the file again; a file that has changed is asked its build
// (`<file> --version`), and another build is asked whether it starts on this RPE's data (`<file>
// check`: RPE's config read, the build's migrations applied to a copy of RPE's database). Where the
// file is another build that starts, the app waits until no turn and no job runs, closes as it does
// on a stop, and exits, and its service starts it again on the new file. It never restarts onto a
// file that does not start, nor where nothing would start it again (run by hand), nor, unless the
// user asks ("Update now"), with the setting `update.restart` off. Should a build start and then fail
// all the same, the service's unit stops starting it after `update.startTries` starts within
// `update.startWindowSeconds` seconds (`rpe up` writes them into it).
//
// Each update is kept stage by stage (`UpdateProgress`): its arrival, its check, its start and the restart onto
// it, each under way, passed or where it stopped and why, so the Runtime page shows it from its arrival to the
// restart and a refused one beside the build that goes on running.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import type { JsonValue, Log } from "rp-harness/contract";
import type { ConfigRead } from "./config-read";
import type { Setting } from "./setting-list";

/** What a file says its build is, or why it said none. */
export type BuildOf = { build: string } | { failed: string };

/** The update's settings, read from the global level alone: they are RPE's, not a chat's. */
const DEFS = {
  restart: { key: "update.restart", name: "Restart onto a new build", about: "RPE restarts by itself onto a new app file the extension brings, once no turn or job runs.", effect: "use", default: true, takes: { type: "yesNo" }, levels: ["shipped", "global"], perConnection: false },
  versionWait: { key: "update.versionWaitSeconds", name: "Wait for a new build to say its version", about: "Seconds a new app file is given to say its build.", effect: "use", default: 10, takes: { type: "whole", least: 1 }, levels: ["shipped", "global"], perConnection: false },
  lookEvery: { key: "update.lookEverySeconds", name: "Look again for running work", about: "Seconds a waiting restart waits before it looks again whether turns or jobs still run.", effect: "use", default: 2, takes: { type: "whole", least: 1 }, levels: ["shipped", "global"], perConnection: false },
  startTries: { key: "update.startTries", name: "Starts allowed in the start window", about: "Starts of RPE's service its unit allows within the start window before the service manager stops starting it; rpe up writes it into the unit.", effect: "use", default: 5, takes: { type: "whole", least: 1 }, levels: ["shipped", "global"], perConnection: false },
  startWindow: { key: "update.startWindowSeconds", name: "Start window", about: "Seconds within which the starts of RPE's service are counted.", effect: "use", default: 60, takes: { type: "whole", least: 1 }, levels: ["shipped", "global"], perConnection: false },
  keepCopies: { key: "update.keepCopies", name: "Known-good copies kept", about: "Copies of RPE's own build kept beside the one that runs, the newest first, for the service's pre-start step to put back when a swapped-in build does not come up.", effect: "use", default: 1, takes: { type: "whole", least: 1 }, levels: ["shipped", "global"], perConnection: false },
  checkWait: { key: "update.checkWaitSeconds", name: "Wait for a new build's check", about: "Seconds a new app file is given to check that it starts on this RPE's data.", effect: "use", default: 120, takes: { type: "whole", least: 1 }, levels: ["shipped", "global"], perConnection: false },
} as const satisfies Record<string, Setting>;

/** Every setting the update reads, as the global config file writes it. */
export const UPDATE_SETTINGS: readonly Setting[] = Object.values(DEFS);

export interface UpdateSettings {
  /** RPE restarts on a new build by itself. */
  restart: boolean;
  /** How long a new app file is given to say its build, in milliseconds. */
  versionWaitMs: number;
  /** How long a restart waits before it looks again whether turns or jobs still run, in milliseconds. */
  lookEveryMs: number;
  /** How many starts of RPE's service its unit allows within `startWindowMs` before the account's service manager stops starting it: a build that cannot serve is not started over and over. `rpe up` writes it into the unit. */
  startTries: number;
  startWindowMs: number;
  /** How long a new app file is given to check that it starts on this RPE's data, in milliseconds. */
  checkWaitMs: number;
  /** How many copies of RPE's own build are kept beside the one that runs, for the service's pre-start step to put back. */
  keepCopies: number;
}

/** The update's settings as the one reader of the config files gives them (the global level's, the shipped file's and the user's own over it). */
export function updateSettings(read: ConfigRead): UpdateSettings {
  // Each value is one its setting takes, so of the type its `takes` says.
  const value = (def: Setting): JsonValue => read.value(def);
  return { restart: value(DEFS.restart) as boolean, versionWaitMs: (value(DEFS.versionWait) as number) * 1000, lookEveryMs: (value(DEFS.lookEvery) as number) * 1000, startTries: value(DEFS.startTries) as number, startWindowMs: (value(DEFS.startWindow) as number) * 1000, checkWaitMs: (value(DEFS.checkWait) as number) * 1000, keepCopies: value(DEFS.keepCopies) as number };
}

/** A regular expression's text that matches `text` as it is. */
function literally(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `words` with every absolute path in them named by its place under the install, the folder the app file
 * is in (`folders`: as given, and as the system resolves it), and any other by its last part: what a build
 * says of itself reaches a page, which is told no absolute path.
 */
function placedIn(words: string, folders: readonly string[]): string {
  // A file's URL is its path.
  let out = words.replace(/file:\/\//g, "");
  // The longest first, so that a folder inside another's path is not taken for it.
  for (const folder of [...new Set(folders)].sort((a, b) => b.length - a.length)) out = out.replace(new RegExp(`(^|[\\s'"(=])${literally(`${folder}${sep}`)}`, "g"), "$1");
  return out.replace(/(^|[\s'"(=])(\/[^\s'"():]+)/g, (_all, before: string, path: string) => `${before}${basename(path)}`);
}

/** `bun <file> --version`, as the build writes it (`rpe <build>`); a file that does not answer within `waitMs` is stopped and counts as not starting. Why it gave none names no absolute path. */
export async function versionOf(bun: string, file: string, waitMs: number): Promise<BuildOf> {
  const install = dirname(file);
  const folders = [install, await realpath(install).catch(() => install)];
  try {
    const proc = Bun.spawn([bun, file, "--version"], { stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: waitMs, killSignal: "SIGKILL" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    const said = /^rpe (\S+)\n?$/.exec(out);
    if (code === 0 && said?.[1] !== undefined) return { build: said[1] };
    if (proc.signalCode !== null) return { failed: `it did not say its build within ${waitMs / 1000} s` };
    // Bun ends what it writes of an error with its own version and the machine's: the error's own line says why.
    const lines = (err.trim() || out.trim()).split("\n").map((line) => line.trim());
    const why = lines.find((line) => /^\w*error:/i.test(line)) ?? lines.at(-1) ?? "";
    return { failed: placedIn(code === 0 ? `it said "${out.trim()}" for its build` : `it exited with ${code}${why === "" ? "" : `: ${why}`}`, folders) };
  } catch (error) {
    return { failed: placedIn(error instanceof Error ? error.message : String(error), folders) };
  }
}

/**
 * Whether the app file `file` starts on RPE's data folder `data`, as far as can be told without
 * serving: `bun <file> check`, which reads RPE's config and applies the file's migrations to a copy
 * of RPE's database, in a folder made here for it and removed once it ends, whichever way it ends. A
 * check that hasn't ended within `waitMs` is stopped, and counts as failed. Null where it starts;
 * else why not.
 */
export async function startCheck(bun: string, file: string, data: string, waitMs: number): Promise<string | null> {
  let into: string | null = null;
  try {
    into = await mkdtemp(join(tmpdir(), "rpe-check-"));
    const proc = Bun.spawn([bun, file, "check", "--data", data, "--into", into, "--within", String(Math.max(1, Math.floor(waitMs / 1000) - 1))], { stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: waitMs, killSignal: "SIGKILL" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code === 0) return null;
    if (proc.signalCode !== null) return `it did not finish checking that it starts on this RPE's data within ${waitMs / 1000} s`;
    // The command line writes its refusal first; Bun's own error line says why where it threw.
    const lines = (err.trim() || out.trim()).split("\n").map((line) => line.trim()).filter((line) => line !== "");
    const why = lines.find((line) => /^\w*error:/i.test(line)) ?? lines[0] ?? "";
    return `it does not start on this RPE's data (its check exited with ${code}${why === "" ? "" : `: ${why}`})`;
  } catch (error) {
    return `its check that it starts on this RPE's data could not run: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (into !== null) await rm(into, { recursive: true, force: true });
  }
}

async function hashOf(file: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await readFile(file)).digest("hex");
  } catch {
    return null;
  }
}

/** Where a restart onto a new build stands. */
export type RestartState =
  /** There is nothing to restart onto. */
  | "none"
  /** It waits for the turns and jobs running to end. */
  | "waiting"
  | "restarting"
  /** A restart is needed, and RPE does not make it: `update.restart` is off. */
  | "off"
  /** A restart is needed, and nothing would start RPE again: it runs by hand. */
  | "by hand";

/**
 * A stage of an update (plan §4.6: "RPE checks its hash, tests that it starts, swaps and restarts"): its arrival (the extension's word with the
 * hash stated, or the app file on disk found changed), its check (every file copied against the hash stated for it, or the file asked its
 * build), its start (for real on a scratch copy of the data, or this RPE's config and migrations on a copy of its database), and the restart
 * onto it, which `RestartState` says more of.
 */
export type UpdateStageName = "arrived" | "checked" | "started" | "restart";

/** One stage an update reached: under way, passed, or where the update stopped, and why. */
export interface UpdateStage {
  stage: UpdateStageName;
  state: "going" | "done" | "refused";
  /** When it began, in milliseconds since 1970. */
  at: number;
  /** Why the update stopped here; null where it did not. */
  why: string | null;
}

/** The newest update this process heard of, stage by stage from its arrival to the restart onto it. */
export interface UpdateProgress {
  /** The build it brings, once its check said it; null before, or where the check refused it. */
  build: string | null;
  stages: UpdateStage[];
}

/** The builds that meet at RPE, as `rpe status` and the status route give them. */
export interface BuildsStatus {
  /** The build this process runs. */
  running: string;
  /** The build waiting to be run: the app file's on disk, or, for an installed copy, the one the extension told RPE of; the running one while there is none. Null where there is no file, or it gives none. */
  disk: string | null;
  /** Why the new build was not taken: the file is not there, does not start, does not match what was stated for it, or the extension stated nothing. Never restarted onto. */
  broken: string | null;
  /** The extension's build as it said at its last registration; null before it has. */
  extension: string | null;
  /** Every build known is the running one, and the file on disk starts. */
  agree: boolean;
  restart: RestartState;
  /** The newest update this process heard of, stage by stage; null before any. */
  update: UpdateProgress | null;
  /** All of it in a sentence or two, as `rpe status` prints it and a page shows it. */
  words: string;
}

/**
 * What RPE does about a new build when it runs as its own installed copy (READINGS R-13): the one file
 * updates come from was recorded at install, and a new build is taken from it only on the extension's
 * word, with the hash stated for it; it is copied beside the installed copy, checked against that hash,
 * started for real on a scratch copy of the data, and swapped in with the one it replaces kept as
 * known-good.
 */
export interface CopyUpdate {
  /** The file updates come from, as the install recorded it. */
  source: string;
  /** The hash of the statement of the build the installed copy holds; null where it holds none. */
  installed(): Promise<string | null>;
  /** Copies the build beside the source app file next to the installed copy and checks the copy against the hash stated for the build: its build id, or why it is not taken. */
  fetch(hash: string): Promise<{ build: string } | { refused: string }>;
  /** Starts the copy fetched on a scratch copy of the data, giving it `waitMs`; null where it starts, else why not. */
  tryStart(waitMs: number): Promise<string | null>;
  /** Drops the copy fetched. */
  drop(): Promise<void>;
  /** Once the app has closed: the copy fetched takes the installed copy's place, the `keep` that it replaces kept as known-good, and the swap is marked until the new build comes up. */
  swapIn(from: string, to: string, keep: number): Promise<void>;
  /** What the unit's pre-start step did last when a swapped-in build did not come up, in words; null where it did nothing. */
  fellBack(): Promise<string | null>;
  /** This build has come up: the mark of a swap is let go. */
  cameUp(): Promise<void>;
}

/** The app file this process was started from, and what a restart onto another build of it needs. */
export interface AppFile {
  path: string;
  /** Asks a file its build (`versionOf`), giving it `waitMs` to say it. */
  buildOf(path: string, waitMs: number): Promise<BuildOf>;
  /** Asks a file whether it starts on this RPE's data (`startCheck`), giving it `waitMs`; null where it does, else why not. */
  startsOn(path: string, waitMs: number): Promise<string | null>;
  /** The update's settings as they stand now. */
  settings(): Promise<UpdateSettings>;
  /** Whether this process runs as its service, which starts it again when it exits. */
  service(): Promise<boolean>;
  /** The name of the service's unit where this process runs as it, for a page to say; null where it runs by hand. */
  unit?(): Promise<string | null>;
  /** Closes the app as on a stop and ends the process, for its service to start it again; `after` runs once the app has closed, before the process ends. */
  restart(after?: () => Promise<void>): void;
  sleep(ms: number): Promise<void>;
  /** Set where this process runs as RPE's installed copy and the install recorded where updates come from. */
  copy?: CopyUpdate;
}

export interface BuildsDeps {
  version: string;
  /** Null where the process runs from no single file: it then reads none, and never restarts. */
  file: AppFile | null;
  log: Log;
  /** The clock an update's stages are timed by; the system's where absent. */
  now?: () => number;
}

/** What `rpe status` and a page say of a new build the extension has not told RPE of, or that was not taken. */
const NOT_TOLD = "The extension's build is not the running one, and the extension has not told RPE that a new app file arrived with the hash stated for it, so RPE has taken none: an update of the extension that does not state its hash is not taken.";

/** The app's file and builds: the start's hash, the file as read last, the extension's build, and a restart onto a new one. */
export class Builds {
  #started: string | null = null;
  /** The file as read last: its hash, and what it said of its build. */
  #seen: { hash: string | null; result: BuildOf } | null = null;
  #extension: string | null = null;
  #restart: RestartState = "none";
  #checking: Promise<BuildsStatus> | null = null;
  #waiting = false;
  /** What may be running, by area: each gives how many of its turns or jobs run now. */
  readonly #running: (() => number | Promise<number>)[] = [];
  /** For an installed copy: the build of the source last told of, why it was not taken, the build checked and waiting, and what the pre-start step did. */
  #sourceBuild: string | null = null;
  #refused: string | null = null;
  #ready: { build: string; hash: string } | null = null;
  #fellBack: string | null = null;
  #arriving: Promise<unknown> = Promise.resolve();
  /** The newest update heard of, stage by stage. */
  #update: UpdateProgress | null = null;

  constructor(private readonly deps: BuildsDeps) {}

  /** A new update has arrived: its stages start again from its arrival, which `why` says was refused at once. */
  #arrivedNow(why: string | null = null): void {
    this.#update = { build: null, stages: [{ stage: "arrived", state: why === null ? "done" : "refused", at: (this.deps.now ?? Date.now)(), why }] };
  }

  /** The update goes into `stage`. */
  #enter(stage: UpdateStageName): void {
    this.#update?.stages.push({ stage, state: "going", at: (this.deps.now ?? Date.now)(), why: null });
  }

  /** The stage under way has ended: passed, or the update stopped there because of `why`. */
  #leave(why: string | null = null): void {
    const last = this.#update?.stages.at(-1);
    if (last === undefined || last.state !== "going") return;
    last.state = why === null ? "done" : "refused";
    last.why = why;
  }

  /** Keeps the app file's hash as it is at the start; an installed copy keeps what happened to the last swap. */
  async start(): Promise<void> {
    const copy = this.deps.file?.copy;
    if (copy !== undefined) {
      this.#fellBack = await copy.fellBack();
      if (this.#fellBack !== null) this.deps.log.warn("RPE's service put back the known-good copy.", { why: this.#fellBack });
      return;
    }
    if (this.deps.file !== null) this.#started = await hashOf(this.deps.file.path);
  }

  /** This build is up and listening: the mark of the swap that brought it is let go. */
  async cameUp(): Promise<void> {
    await this.deps.file?.copy?.cameUp();
  }

  /** An area's turns or jobs, counted each time a restart waits for them to end. */
  counts(running: () => number | Promise<number>): void {
    this.#running.push(running);
  }

  /** How many turns and jobs run now, over every area that counts them: what a restart of RPE's service waits to be none. */
  async busy(): Promise<number> {
    return (await Promise.all(this.#running.map(async (count) => await count()))).reduce((sum, n) => sum + n, 0);
  }

  /** The extension registered, as `build`; null where it did not say. A file that is its own source reads the file again where it is another build; an installed copy takes nothing on a registration, which states no hash. */
  registered(build: string | null): void {
    this.#extension = build;
    if (this.deps.file?.copy !== undefined) return;
    if (build !== null && build !== this.deps.version) void this.check().catch((error: unknown) => this.deps.log.error("RPE's app file could not be read again", { error: error instanceof Error ? error.message : String(error) }));
  }

  /** Reads the app file again, and restarts onto a new build where its settings let it; what it found. An installed copy reads nothing: it takes a build only on the extension's word (`arrived`). */
  check(): Promise<BuildsStatus> {
    if (this.deps.file?.copy !== undefined) return Promise.resolve(this.status());
    this.#checking ??= this.#read(false).finally(() => {
      this.#checking = null;
    });
    return this.#checking;
  }

  /**
   * The extension's word that a new app file has arrived, with the hash stated for it (installed copy
   * only). RPE copies the source it was set up from beside its own copy, takes the build only when
   * every file matches what was stated, starts it for real on a scratch copy of its data, and then
   * restarts onto it once no turn or job runs, or at once where `now` says so. A word with no stated
   * hash is not taken. Whether it was taken, and where it stands, in words.
   */
  arrived(hash: string | null, now = false): Promise<{ taken: boolean; words: string }> {
    const run = this.#arriving.then(() => this.#arrive(hash, now));
    this.#arriving = run.catch(() => undefined);
    return run;
  }

  async #arrive(hash: string | null, now: boolean): Promise<{ taken: boolean; words: string }> {
    const { file, log, version } = this.deps;
    const copy = file?.copy;
    const answer = (taken: boolean): { taken: boolean; words: string } => ({ taken, words: this.status().words });
    if (file === null || copy === undefined) {
      this.#refused = "RPE runs from no installed copy of its own, so it takes no app file the extension brings: restart it onto a new one by hand";
      this.#arrivedNow(this.#refused);
      return answer(false);
    }
    if (hash === null || hash === "") {
      this.#refused = "the extension said an app file arrived and stated no hash for it, so RPE takes none";
      this.#arrivedNow(this.#refused);
      log.warn("RPE did not take the app file the extension brought: no hash was stated for it.");
      return answer(false);
    }
    const settings = await file.settings();
    const stated = hash.toLowerCase();
    if ((await copy.installed()) === stated && this.#ready === null) {
      this.#refused = null;
      this.#sourceBuild = null;
      return answer(false);
    }
    this.#arrivedNow();
    this.#enter("checked");
    const fetched = await copy.fetch(stated);
    if ("refused" in fetched) {
      await copy.drop();
      this.#refused = fetched.refused;
      this.#sourceBuild = null;
      this.#leave(fetched.refused);
      log.warn("RPE did not take the app file the extension brought; it goes on running its own build.", { running: version, why: fetched.refused });
      return answer(false);
    }
    this.#sourceBuild = fetched.build;
    if (this.#update !== null) this.#update.build = fetched.build;
    this.#leave();
    this.#enter("started");
    const why = await copy.tryStart(settings.checkWaitMs);
    if (why !== null) {
      await copy.drop();
      this.#refused = why;
      this.#leave(why);
      log.warn("RPE did not take the app file the extension brought: the build does not start; it goes on running its own build.", { running: version, build: fetched.build, why });
      return answer(false);
    }
    this.#leave();
    this.#refused = null;
    this.#ready = { build: fetched.build, hash: stated };
    this.#enter("restart");
    log.info("RPE has a new build that starts, and will swap onto it.", { running: version, build: fetched.build });
    if (!settings.restart && !now) this.#restart = "off";
    else if (!(await file.service())) this.#restart = "by hand";
    else {
      this.#restart = "waiting";
      void this.#waitThenRestart(file, copy, now).catch((error: unknown) => {
        this.#restart = "none";
        this.#leave(error instanceof Error ? error.message : String(error));
        log.error("RPE's restart onto its new build failed; it goes on running its build", { error: error instanceof Error ? error.message : String(error) });
      });
    }
    return answer(true);
  }

  /**
   * "Update now": reads the file again, and restarts onto a new build whatever `update.restart` says,
   * once no turn or job runs; an installed copy restarts at once onto the build checked and waiting.
   * Run by hand, it cannot.
   */
  async now(): Promise<BuildsStatus> {
    const { file } = this.deps;
    if (file?.copy !== undefined) {
      const ready = this.#ready;
      if (ready === null) return this.status();
      if (!(await file.service())) this.#restart = "by hand";
      else if (this.#restart !== "restarting") {
        this.#restart = "restarting";
        this.#swap(file, file.copy);
      }
      return this.status();
    }
    // Asked by the user, a file whose check failed is checked again: the check may have failed for a reason that has passed (a full temporary folder, a machine under load).
    if (this.#seen !== null && "failed" in this.#seen.result) this.#seen = null;
    await this.check();
    return await this.#read(true);
  }

  /** As known now, without reading the file. */
  status(): BuildsStatus {
    const { version } = this.deps;
    const copy = this.deps.file?.copy !== undefined;
    const seen = this.#seen?.result ?? null;
    const disk = this.deps.file === null ? null : copy ? (this.#ready?.build ?? this.#sourceBuild ?? version) : seen === null ? version : "build" in seen ? seen.build : null;
    const broken = copy ? this.#refused : seen !== null && "failed" in seen ? seen.failed : null;
    const extension = this.#extension;
    const agree = broken === null && (disk === null || disk === version) && (extension === null || extension === version);
    const parts = { running: version, disk, broken, extension, agree, restart: this.#restart };
    const update = this.#update === null ? null : { build: this.#update.build, stages: this.#update.stages.map((s) => ({ ...s })) };
    return { ...parts, update, words: wordsOf(parts, copy, this.#extras(copy, disk)) };
  }

  /** What an installed copy adds to the words: that the extension's build is not taken until it says so with its hash, and what the pre-start step did. */
  #extras(copy: boolean, disk: string | null): string[] {
    if (!copy) return [];
    const { version } = this.deps;
    const extras: string[] = [];
    if (this.#extension !== null && this.#extension !== version && this.#ready === null && this.#refused === null && (disk === null || disk === version)) extras.push(NOT_TOLD);
    if (this.#fellBack !== null) extras.push(this.#fellBack);
    return extras;
  }

  async #read(asked: boolean): Promise<BuildsStatus> {
    const { file, version } = this.deps;
    if (file === null) return this.status();
    const settings = await file.settings();
    await this.#readFile(file, settings);
    const status = this.status();
    if (status.disk === null || status.disk === version) {
      this.#restart = "none";
      return this.status();
    }
    if (this.#restart === "waiting" || this.#restart === "restarting") return status;
    if (this.#update !== null && this.#update.stages.at(-1)?.stage !== "restart") this.#enter("restart");
    if (!asked && !settings.restart) this.#restart = "off";
    else if (!(await file.service())) this.#restart = "by hand";
    else {
      this.#restart = "waiting";
      void this.#waitThenRestart(file, undefined, false).catch((error: unknown) => {
        this.#restart = "none";
        this.#leave(error instanceof Error ? error.message : String(error));
        this.deps.log.error("RPE's restart onto its new app file failed; it goes on running its build", { error: error instanceof Error ? error.message : String(error) });
      });
    }
    return this.status();
  }

  /** The file's hash now and, for a file other than the one at the start, what it says of its build: asked once for each file. */
  async #readFile(file: AppFile, settings: UpdateSettings): Promise<void> {
    const { version, log } = this.deps;
    const hash = await hashOf(file.path);
    if (hash !== null && hash === this.#started) {
      this.#seen = null;
      return;
    }
    if (this.#seen !== null && this.#seen.hash === hash) return;
    // A file other than the one at the start, or than the one read last, is an update: its stages are kept from here.
    this.#arrivedNow();
    this.#enter("checked");
    let result: BuildOf = hash === null ? { failed: "the file is not there" } : await file.buildOf(file.path, settings.versionWaitMs);
    if ("failed" in result) this.#leave(result.failed);
    else if (result.build === version) this.#update = null;
    else {
      if (this.#update !== null) this.#update.build = result.build;
      this.#leave();
      // Another build is restarted onto only once it is known to start on this RPE's data: its config read, its migrations applied to a copy of the database.
      this.#enter("started");
      const why = await file.startsOn(file.path, settings.checkWaitMs);
      this.#leave(why);
      if (why !== null) result = { failed: why };
    }
    this.#seen = { hash, result };
    if ("failed" in result) log.warn("RPE's app file on disk was replaced by one that does not start; RPE goes on running its build and does not restart onto it.", { running: version, why: result.failed });
    else if (result.build !== version) log.info("RPE's app file on disk is another build.", { running: version, disk: result.build });
  }

  /** Closes the app and ends the process for its service to start it again; an installed copy first swaps the build checked into the copy's place, once the app has closed. */
  #swap(file: AppFile, copy: CopyUpdate | undefined): void {
    const ready = this.#ready;
    this.deps.log.info("RPE restarts on the new build.", { running: this.deps.version, build: ready?.build ?? this.status().disk });
    if (copy === undefined || ready === null) file.restart();
    else
      file.restart(async () => {
        const settings = await file.settings();
        await copy.swapIn(this.deps.version, ready.build, settings.keepCopies);
      });
  }

  /** Waits until no turn or job runs (at once where `now`), then restarts; a file read again first, and given up where it is the running build again, or does not start. */
  async #waitThenRestart(file: AppFile, copy: CopyUpdate | undefined, now: boolean): Promise<void> {
    if (this.#waiting) return;
    this.#waiting = true;
    try {
      for (;;) {
        const settings = await file.settings();
        if (copy === undefined) {
          await this.#readFile(file, settings);
          const disk = this.status().disk;
          if (disk === null || disk === this.deps.version) {
            this.#restart = "none";
            return;
          }
          if (this.#update !== null && this.#update.stages.at(-1)?.stage !== "restart") this.#enter("restart");
        } else if (this.#ready === null) {
          this.#restart = "none";
          return;
        }
        if (now) break;
        const counts = await Promise.all(this.#running.map(async (count) => await count()));
        if (counts.every((n) => n === 0)) break;
        await file.sleep(settings.lookEveryMs);
      }
      this.#restart = "restarting";
      this.#swap(file, copy);
    } finally {
      this.#waiting = false;
    }
  }

  /** How this process runs: as its service (its unit's name), or by hand; and what the unit's pre-start step did when a swapped-in build did not come up, in words, if it did. */
  async runs(): Promise<{ service: boolean; unit: string | null; fellBack: string | null }> {
    const { file } = this.deps;
    const service = file !== null && (await file.service());
    return { service, unit: service ? ((await file?.unit?.()) ?? null) : null, fellBack: this.#fellBack };
  }

  /**
   * A restart onto the same files, for values that hold only at a restart: once no turn and no job runs, as "Update now" restarts. Run by
   * hand, it cannot, and says so; while one is waiting or under way it is not asked twice.
   */
  async restartHere(): Promise<BuildsStatus> {
    const { file, log } = this.deps;
    if (file === null || !(await file.service())) {
      this.#restart = "by hand";
      return this.status();
    }
    if (this.#restart === "waiting" || this.#restart === "restarting") return this.status();
    this.#restart = "waiting";
    void this.#waitIdle(file).catch((error: unknown) => {
      this.#restart = "none";
      log.error("RPE's restart asked from a page failed; it goes on running", { error: error instanceof Error ? error.message : String(error) });
    });
    return this.status();
  }

  /** Waits until no turn or job runs, then restarts onto the same files. */
  async #waitIdle(file: AppFile): Promise<void> {
    if (this.#waiting) return;
    this.#waiting = true;
    try {
      for (;;) {
        const counts = await Promise.all(this.#running.map(async (count) => await count()));
        if (counts.every((n) => n === 0)) break;
        await file.sleep((await file.settings()).lookEveryMs);
      }
      this.#restart = "restarting";
      this.deps.log.info("RPE restarts, as it was asked from a page.", { running: this.deps.version });
      file.restart();
    } finally {
      this.#waiting = false;
    }
  }
}

/** What a restart onto the same files says of itself where it is asked for: that RPE is restarting and its page is back in a few seconds, or that nothing would start RPE again. */
function restarting(state: BuildsStatus["restart"]): string {
  switch (state) {
    case "waiting":
      return " RPE is restarting: it waits until no turn or job is running, and this page is back a few seconds after.";
    case "restarting":
      return " RPE is restarting now; this page is back in a few seconds.";
    case "by hand":
      return " RPE was started by hand, so nothing would start it again: it did not restart. Stop it, and start it again.";
    default:
      return "";
  }
}

/** The builds in a sentence or two, as `rpe status` prints them and a page shows them; `extras` are what an installed copy adds. */
function wordsOf(s: Omit<BuildsStatus, "words" | "update">, copy: boolean, extras: readonly string[] = []): string {
  const more = extras.length === 0 ? "" : ` ${extras.join(" ")}`;
  const extension = s.extension === null ? "the extension has not said its build yet" : `the extension is build ${s.extension}`;
  if (s.broken !== null) return `RPE runs build ${s.running}. ${copy ? `A new app file was not taken (${s.broken})` : `Its app file on disk was replaced by one that does not start (${s.broken})`}, so RPE goes on running build ${s.running}; ${extension}.${more}`;
  if (s.disk === null) return `RPE runs build ${s.running}, from no single app file; ${extension}.${restarting(s.restart)}${more}`;
  if (s.disk === s.running) return `${s.agree ? `RPE runs build ${s.running}, the build of its app file on disk${s.extension === null ? `; ${extension}` : " and of the extension"}.` : `RPE runs build ${s.running}, the build of its app file on disk; ${extension}.`}${restarting(s.restart)}${more}`;
  const head = `RPE runs build ${s.running}; its app file on disk is build ${s.disk}; ${extension}.`;
  switch (s.restart) {
    case "waiting":
      return `${head} RPE restarts on build ${s.disk} once no turn or job is running.${more}`;
    case "restarting":
      return `${head} RPE is restarting on build ${s.disk}.${more}`;
    case "off":
      return `${head} A restart is needed to run build ${s.disk}: RPE does not restart by itself while update.restart is off. Choose "Update now", or restart RPE's service.${more}`;
    case "by hand":
      return `${head} A restart is needed to run build ${s.disk}: RPE was started by hand, so nothing would start it again. Stop it, and start it again.${more}`;
    case "none":
      return `${head} A restart is needed to run build ${s.disk}.${more}`;
  }
}
