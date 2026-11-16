// RPE's own installed copy (plan §4.6; READINGS R-13): the service never runs the file inside the
// extension's folder, which an update of the extension replaces under it. `rpe up --systemd` copies the
// app file and the folders it reads beside it into RPE's data folder, and records the file it ran from
// as the one source of updates. An update replaces the copy only after the new file has passed, keeping
// the copy it replaces as known-good; a unit's pre-start step, written here once and never replaced by
// an update, puts the known-good copy back when a swapped-in build does not come up.
//
//   <data>/app/current/      the copy the service runs: rpe.js, guidance/, guidance-harness/, ui/
//   <data>/app/known-good/   the copy the last swap replaced
//   <data>/app/next/         a build being checked; gone once it is swapped in or refused
//   <data>/app/source.json   the file updates come from: { file, recorded }
//   <data>/app/swapped.json  a build swapped in that has not yet come up: { from, to, starts }
//   <data>/app/fell-back.json  what the pre-start step did when it did not come up: { from, to, starts, at }
//   <data>/app/before-start.mjs  the pre-start step

import { existsSync } from "node:fs";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isRecord } from "../shared/json";
import { statedHash, STATEMENT_FILE, verifyBuild } from "./build-statement";
import { ownerOnlyFolder, readText, writeWhole } from "./disk";
import type { CopyUpdate } from "./update";

/** The app file in a build's folder, and the folders the app reads beside it. */
export const APP_FILE = "rpe.js";
export const BESIDE_APP = ["guidance", "guidance-harness", "ui"] as const;
/** The folders without which a build cannot run. */
const REQUIRED = ["guidance", "guidance-harness"] as const;

export interface AppCopyPlaces {
  root: string;
  current: string;
  knownGood: string;
  next: string;
  source: string;
  swapped: string;
  fellBack: string;
  beforeStart: string;
}

/** Where each part of the installed copy is, under RPE's data folder. */
export function appCopyPlaces(data: string): AppCopyPlaces {
  const root = join(resolve(data), "app");
  return { root, current: join(root, "current"), knownGood: join(root, "known-good"), next: join(root, "next"), source: join(root, "source.json"), swapped: join(root, "swapped.json"), fellBack: join(root, "fell-back.json"), beforeStart: join(root, "before-start.mjs") };
}

/** The app file the service runs. */
export const copiedFile = (data: string): string => join(appCopyPlaces(data).current, APP_FILE);

/** Whether `file` is the app file of RPE's installed copy for `data`. */
export function isInstalledCopy(file: string, data: string): boolean {
  return resolve(file) === copiedFile(data);
}

/**
 * The step the unit runs before each start. Plain JavaScript on its own, so it runs whatever the build
 * in `current/` is: while a swapped-in build has not come up, each start counts, and the start after
 * the `tries`th puts the known-good copy back in `current/` and says so in `fell-back.json`.
 */
export const BEFORE_START = `// Written by \`rpe up --systemd\`; an update of RPE does not replace it. It runs before each start of RPE's service.
// A swapped-in build (swapped.json) that has not come up within the starts allowed is put back to the known-good copy.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [, , data, tries] = process.argv;
const app = join(data, "app");
const marker = join(app, "swapped.json");
if (existsSync(marker)) {
  let swapped = null;
  try {
    swapped = JSON.parse(readFileSync(marker, "utf8"));
  } catch {}
  const starts = Number.isInteger(swapped?.starts) ? swapped.starts : 0;
  if (swapped !== null && starts >= Number(tries) && existsSync(join(app, "known-good"))) {
    const failed = join(app, "failed");
    rmSync(failed, { recursive: true, force: true });
    renameSync(join(app, "current"), failed);
    renameSync(join(app, "known-good"), join(app, "current"));
    rmSync(failed, { recursive: true, force: true });
    rmSync(marker, { force: true });
    writeFileSync(join(app, "fell-back.json"), JSON.stringify({ from: swapped.to ?? null, to: swapped.from ?? null, starts, at: Date.now() }));
  } else if (swapped !== null) {
    writeFileSync(marker, JSON.stringify({ ...swapped, starts: starts + 1 }));
  }
}
`;

/** Why a folder holds no build RPE can run: its app file or a folder it reads is not there; null where it does. */
export function buildRefusal(appFile: string): string | null {
  if (!existsSync(appFile)) return `${appFile} is not there.`;
  const folder = dirname(appFile);
  const missing = REQUIRED.filter((name) => !existsSync(join(folder, name)));
  return missing.length === 0 ? null : `${folder} has no ${missing.join(" and no ")} beside ${basename(appFile)}: RPE reads its shipped files from there, so this is not a whole build. Build it first (bun run build).`;
}

/** Copies the build whose app file is `appFile` (the file and the folders it reads beside it) into `into`, made new. */
export async function copyBuild(appFile: string, into: string): Promise<void> {
  const why = buildRefusal(appFile);
  if (why !== null) throw new Error(why);
  await rm(into, { recursive: true, force: true });
  await mkdir(into, { recursive: true });
  await cp(appFile, join(into, APP_FILE));
  if (existsSync(join(dirname(appFile), STATEMENT_FILE))) await cp(join(dirname(appFile), STATEMENT_FILE), join(into, STATEMENT_FILE));
  for (const name of BESIDE_APP) if (existsSync(join(dirname(appFile), name))) await cp(join(dirname(appFile), name), join(into, name), { recursive: true });
}

/** The file updates come from, as the install recorded it; null where none is recorded. */
export async function recordedSource(data: string): Promise<string | null> {
  const text = await readText(appCopyPlaces(data).source);
  if (text === null) return null;
  try {
    const record: unknown = JSON.parse(text);
    return isRecord(record) && typeof record.file === "string" ? record.file : null;
  } catch {
    return null;
  }
}

/**
 * Installs the copy of the build whose app file is `appFile` as the one the service runs, and records
 * that file as the only source of updates (unless it is the installed copy itself, which makes no
 * source). A copy made before is replaced; a swap marker of an earlier update is let go. The unit's
 * pre-start step is written. Run from the installed copy itself, it leaves the copy and the source as
 * they are.
 */
export async function installCopy(data: string, appFile: string, now: number): Promise<void> {
  const places = appCopyPlaces(data);
  await ownerOnlyFolder(places.root);
  await writeWhole(places.beforeStart, BEFORE_START, 0o600);
  if (isInstalledCopy(appFile, data)) return;
  const staging = join(places.root, "installing");
  await copyBuild(appFile, staging);
  await rm(places.current, { recursive: true, force: true });
  await rename(staging, places.current);
  await rm(places.swapped, { force: true });
  await rm(places.fellBack, { force: true });
  await writeWhole(places.source, `${JSON.stringify({ file: resolve(appFile), recorded: now }, null, 2)}\n`);
}

/** What the unit's pre-start step wrote when a swapped-in build did not come up, as words; null where it did nothing. */
export async function fellBackWords(places: AppCopyPlaces): Promise<string | null> {
  const text = await readText(places.fellBack);
  if (text === null) return null;
  try {
    const said: unknown = JSON.parse(text);
    if (!isRecord(said)) return null;
    const build = (value: unknown): string => (typeof value === "string" ? `build ${value}` : "the build before it");
    const when = typeof said.at === "number" ? ` at ${new Date(said.at).toISOString().slice(0, 16).replace("T", " ")} UTC` : "";
    return `${build(said.from).replace(/^./, (c) => c.toUpperCase())} did not come up within the ${typeof said.starts === "number" ? `${said.starts} ` : ""}starts it was allowed after it was swapped in, so RPE's service put back the known-good copy${when}, and RPE runs ${build(said.to)}.`;
  } catch {
    return null;
  }
}

/** Keeps `keep` copies of RPE's own build as `known-good`, `known-good-2`, and so on, the newest first, making room for the one the swap is about to put there. */
async function makeRoomForKnownGood(places: AppCopyPlaces, keep: number): Promise<void> {
  const named = (n: number): string => (n === 1 ? places.knownGood : `${places.knownGood}-${n}`);
  await rm(named(keep), { recursive: true, force: true });
  for (let n = keep - 1; n >= 1; n--) if (existsSync(named(n))) await rename(named(n), named(n + 1));
}

/**
 * What RPE does about a new build as its own installed copy (`CopyUpdate`, update.ts): the build is
 * copied from the recorded `source` into `next/` and checked there, against the hash stated for it, so
 * that what is started and swapped in is what was checked; `startsOn` starts it for real on a scratch
 * copy of the data.
 */
export function copyUpdate(data: string, source: string, startsOn: (file: string, waitMs: number) => Promise<string | null>): CopyUpdate {
  const places = appCopyPlaces(data);
  return {
    source,
    async installed() {
      const text = await readText(join(places.current, STATEMENT_FILE));
      return text === null ? null : statedHash(text);
    },
    async fetch(hash) {
      const why = buildRefusal(source);
      if (why !== null) return { refused: "the folder the extension updates holds no whole build beside its app file (its guidance folders are not there), so there is nothing to take" };
      try {
        await copyBuild(source, places.next);
      } catch (error) {
        return { refused: `the build could not be copied beside RPE's own copy (${error instanceof Error ? error.message.replace(/\s\S*\/\S+/g, "") : String(error)})` };
      }
      const verified = await verifyBuild(places.next, hash);
      return "refused" in verified ? verified : { build: verified.statement.build };
    },
    tryStart: (waitMs) => startsOn(join(places.next, APP_FILE), waitMs),
    drop: () => rm(places.next, { recursive: true, force: true }),
    async swapIn(from, to, keep) {
      await makeRoomForKnownGood(places, keep);
      await rename(places.current, places.knownGood);
      await rename(places.next, places.current);
      await rm(places.fellBack, { force: true });
      await writeWhole(places.swapped, `${JSON.stringify({ from, to, starts: 0, at: Date.now() })}\n`);
    },
    fellBack: () => fellBackWords(places),
    cameUp: () => rm(places.swapped, { force: true }),
  };
}
