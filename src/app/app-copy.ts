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
import { ownerOnlyFolder, readText, writeWhole } from "./disk";

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
