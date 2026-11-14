// The application after an update of the extension (plan §4.6: "After the cutover, updates are the
// ones you already do: update the extension in Lumiverse. The extension tells RPE a new app file has
// arrived; RPE checks its hash, tests that it starts, swaps and restarts. 'Update now' stays in the
// UI."). Lumiverse replaces the files in the extension's folder, and the app file the service `rpe up`
// installed runs is one of them, so the running build goes on until the process starts again.
//
// The app keeps its file's hash from the start. When the extension registers as another build, and
// whenever it is asked, it reads the file again; a file that has changed is asked its build
// (`<file> --version`). Where the file is another build that starts, the app waits until no turn and
// no job runs, closes as it does on a stop, and exits, and its service starts it again on the new
// file. It never restarts onto a file that does not start, nor where nothing would start it again
// (run by hand), nor, unless the user asks ("Update now"), with the setting `update.restart` off.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { JsonValue, Log } from "rp-harness/contract";
import { isMapping, type Mapping, mergedConfig, type SettingDef, settingIn } from "./setting-list";

/** What a file says its build is, or why it said none. */
export type BuildOf = { build: string } | { failed: string };

/** The update's settings, read from the global level alone: they are RPE's, not a chat's. */
const DEFS = {
  restart: { key: "update.restart", default: true, takes: { type: "yesNo" }, levels: ["shipped", "global"], perConnection: false },
  versionWait: { key: "update.versionWait", default: 10, takes: { type: "whole", least: 1 }, levels: ["shipped", "global"], perConnection: false },
  lookEvery: { key: "update.lookEvery", default: 2, takes: { type: "whole", least: 1 }, levels: ["shipped", "global"], perConnection: false },
} as const satisfies Record<string, SettingDef>;

/** Every setting the update reads, as the global config file writes it. */
export const UPDATE_SETTINGS: readonly SettingDef[] = Object.values(DEFS);

export interface UpdateSettings {
  /** RPE restarts on a new build by itself. */
  restart: boolean;
  /** How long a new app file is given to say its build, in milliseconds. */
  versionWaitMs: number;
  /** How long a restart waits before it looks again whether turns or jobs still run, in milliseconds. */
  lookEveryMs: number;
}

/** The update's settings from the global level's config files (YAML texts, farthest first; null for a file that is not there). */
export function updateSettings(texts: readonly (string | null)[], log: Log): UpdateSettings {
  let config: Mapping = {};
  for (const text of texts) {
    if (text === null || text.trim() === "") continue;
    try {
      const parsed: unknown = Bun.YAML.parse(text);
      if (isMapping(parsed)) config = mergedConfig(config, parsed);
    } catch (error) {
      log.warn("A config file does not parse; the update's settings in it are passed over.", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  const value = (def: SettingDef): JsonValue => {
    const read = settingIn(config, def);
    if (read.passed !== null) log.warn("A setting has a value it does not take; its default holds.", { setting: def.key, value: read.passed.value });
    return read.value;
  };
  // Each value is one its setting takes, so of the type its `takes` says.
  return { restart: value(DEFS.restart) as boolean, versionWaitMs: (value(DEFS.versionWait) as number) * 1000, lookEveryMs: (value(DEFS.lookEvery) as number) * 1000 };
}

/** `bun <file> --version`, as the build writes it (`rpe <build>`); a file that does not answer within `waitMs` is stopped and counts as not starting. */
export async function versionOf(bun: string, file: string, waitMs: number): Promise<BuildOf> {
  try {
    const proc = Bun.spawn([bun, file, "--version"], { stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: waitMs, killSignal: "SIGKILL" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    const said = /^rpe (\S+)\n?$/.exec(out);
    if (code === 0 && said?.[1] !== undefined) return { build: said[1] };
    if (proc.signalCode !== null) return { failed: `it did not say its build within ${waitMs / 1000} s` };
    // Bun ends what it writes of an error with its own version and the machine's: the error's own line says why.
    const lines = (err.trim() || out.trim()).split("\n").map((line) => line.trim());
    const why = lines.find((line) => /^\w*error:/i.test(line)) ?? lines.at(-1) ?? "";
    return { failed: code === 0 ? `it said "${out.trim()}" for its build` : `it exited with ${code}${why === "" ? "" : `: ${why}`}` };
  } catch (error) {
    return { failed: error instanceof Error ? error.message : String(error) };
  }
}

async function hashOf(file: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await readFile(file)).digest("hex");
  } catch {
    return null;
  }
}

/** Where a restart onto the file on disk stands. */
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

/** The builds that meet at RPE, as `rpe status` and the status route give them. */
export interface BuildsStatus {
  /** The build this process runs. */
  running: string;
  /** The build of the app file on disk: the running one while the file is as it was at the start; null where there is no file, or it gives none. */
  disk: string | null;
  /** Why the file on disk gave no build: it is not there, does not start, or says something else. Never restarted onto. */
  broken: string | null;
  /** The extension's build as it said at its last registration; null before it has. */
  extension: string | null;
  /** Every build known is the running one, and the file on disk starts. */
  agree: boolean;
  restart: RestartState;
  /** All of it in a sentence or two, as `rpe status` prints it and a page shows it. */
  words: string;
}

/** The app file this process was started from, and what a restart onto another build of it needs. */
export interface AppFile {
  path: string;
  /** Asks a file its build (`versionOf`), giving it `waitMs` to say it. */
  buildOf(path: string, waitMs: number): Promise<BuildOf>;
  /** The update's settings as they stand now. */
  settings(): Promise<UpdateSettings>;
  /** Whether this process runs as its service, which starts it again when it exits. */
  service(): Promise<boolean>;
  /** Closes the app as on a stop and ends the process, for its service to start it again. */
  restart(): void;
  sleep(ms: number): Promise<void>;
}

export interface BuildsDeps {
  version: string;
  /** Null where the process runs from no single file: it then reads none, and never restarts. */
  file: AppFile | null;
  log: Log;
}

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

  constructor(private readonly deps: BuildsDeps) {}

  /** Keeps the app file's hash as it is at the start. */
  async start(): Promise<void> {
    if (this.deps.file !== null) this.#started = await hashOf(this.deps.file.path);
  }

  /** An area's turns or jobs, counted each time a restart waits for them to end. */
  counts(running: () => number | Promise<number>): void {
    this.#running.push(running);
  }

  /** The extension registered, as `build`; null where it did not say. Another build than the running one has the file read again. */
  registered(build: string | null): void {
    this.#extension = build;
    if (build !== null && build !== this.deps.version) void this.check().catch((error: unknown) => this.deps.log.error("RPE's app file could not be read again", { error: error instanceof Error ? error.message : String(error) }));
  }

  /** Reads the app file again, and restarts onto a new build where its settings let it; what it found. */
  check(): Promise<BuildsStatus> {
    this.#checking ??= this.#read(false).finally(() => {
      this.#checking = null;
    });
    return this.#checking;
  }

  /**
   * "Update now": reads the file again, and restarts onto a new build whatever `update.restart` says,
   * once no turn or job runs; what it will do. Run by hand, it cannot.
   */
  async now(): Promise<BuildsStatus> {
    await this.check();
    return await this.#read(true);
  }

  /** As known now, without reading the file. */
  status(): BuildsStatus {
    const { version } = this.deps;
    const seen = this.#seen?.result ?? null;
    const disk = this.deps.file === null ? null : seen === null ? version : "build" in seen ? seen.build : null;
    const broken = seen !== null && "failed" in seen ? seen.failed : null;
    const extension = this.#extension;
    const agree = broken === null && (disk === null || disk === version) && (extension === null || extension === version);
    return { running: version, disk, broken, extension, agree, restart: this.#restart, words: wordsOf({ running: version, disk, broken, extension, agree, restart: this.#restart }) };
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
    if (!asked && !settings.restart) this.#restart = "off";
    else if (!(await file.service())) this.#restart = "by hand";
    else {
      this.#restart = "waiting";
      void this.#waitThenRestart(file).catch((error: unknown) => {
        this.#restart = "none";
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
    const result: BuildOf = hash === null ? { failed: "the file is not there" } : await file.buildOf(file.path, settings.versionWaitMs);
    this.#seen = { hash, result };
    if ("failed" in result) log.warn("RPE's app file on disk was replaced by one that does not start; RPE goes on running its build and does not restart onto it.", { running: version, why: result.failed });
    else if (result.build !== version) log.info("RPE's app file on disk is another build.", { running: version, disk: result.build });
  }

  /** Waits until no turn or job runs, then restarts, the file read again first: given up where it is the running build again, or does not start. */
  async #waitThenRestart(file: AppFile): Promise<void> {
    if (this.#waiting) return;
    this.#waiting = true;
    try {
      for (;;) {
        const settings = await file.settings();
        await this.#readFile(file, settings);
        const disk = this.status().disk;
        if (disk === null || disk === this.deps.version) {
          this.#restart = "none";
          return;
        }
        const counts = await Promise.all(this.#running.map(async (count) => await count()));
        if (counts.every((n) => n === 0)) break;
        await file.sleep(settings.lookEveryMs);
      }
      this.#restart = "restarting";
      this.deps.log.info("RPE restarts on the new build of its app file.", { running: this.deps.version, disk: this.status().disk });
      file.restart();
    } finally {
      this.#waiting = false;
    }
  }
}

/** The builds in a sentence or two, as `rpe status` prints them and a page shows them. */
function wordsOf(s: Omit<BuildsStatus, "words">): string {
  const extension = s.extension === null ? "the extension has not said its build yet" : `the extension is build ${s.extension}`;
  if (s.broken !== null) return `RPE runs build ${s.running}. Its app file on disk was replaced by one that does not start (${s.broken}), so RPE goes on running build ${s.running}; ${extension}.`;
  if (s.disk === null) return `RPE runs build ${s.running}, from no single app file; ${extension}.`;
  if (s.disk === s.running) return s.agree ? `RPE runs build ${s.running}, the build of its app file on disk${s.extension === null ? `; ${extension}` : " and of the extension"}.` : `RPE runs build ${s.running}, the build of its app file on disk; ${extension}.`;
  const head = `RPE runs build ${s.running}; its app file on disk is build ${s.disk}; ${extension}.`;
  switch (s.restart) {
    case "waiting":
      return `${head} RPE restarts on build ${s.disk} once no turn or job is running.`;
    case "restarting":
      return `${head} RPE is restarting on build ${s.disk}.`;
    case "off":
      return `${head} A restart is needed to run build ${s.disk}: RPE does not restart by itself while update.restart is off. Choose "Update now", or restart RPE's service.`;
    case "by hand":
      return `${head} A restart is needed to run build ${s.disk}: RPE was started by hand, so nothing would start it again. Stop it, and start it again.`;
    case "none":
      return `${head} A restart is needed to run build ${s.disk}.`;
  }
}
