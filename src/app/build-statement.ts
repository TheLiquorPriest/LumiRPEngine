// What a build states of itself (plan §4.6; READINGS R-12): `bun run build` writes, beside the app file in
// `dist/`, the hash of the app file and of every file of the folders it reads beside it, and stamps the
// hash of that statement into the extension's backend, so the extension can state it when it tells RPE
// a new app file has arrived. RPE checks the files it will run against the statement, and the statement
// against the hash the extension stated, before it takes them.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { isRecord } from "../shared/json";

/** The statement's file, beside the app file. */
export const STATEMENT_FILE = "rpe.files.json";
/** The app file and the folders it reads beside it, which the statement covers. */
export const COVERED = ["rpe.js", "guidance", "guidance-harness", "ui"] as const;

export interface Statement {
  /** The build's id. */
  build: string;
  /** Each file's SHA-256, in hex, by its path from the app file's folder, `/` between parts. */
  files: Record<string, string>;
}

export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** The statement as it is written: the files in order, so the same build gives the same text. */
export function statementText(statement: Statement): string {
  const files = Object.fromEntries(Object.entries(statement.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${JSON.stringify({ build: statement.build, files }, null, 2)}\n`;
}

/** The hash the extension states for a build: the statement's own text hashed. */
export const statedHash = (text: string): string => sha256(text);

/** Every file of the covered names under `dir`, by its path from `dir`. */
export async function coveredFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of COVERED) {
    const entries = await readdir(join(dir, name), { recursive: true, withFileTypes: true }).catch(() => null);
    if (entries === null) {
      // The app file itself, or a folder that is not there.
      if (await Bun.file(join(dir, name)).exists()) found.push(name);
      continue;
    }
    for (const entry of entries) if (entry.isFile()) found.push(relative(dir, join(entry.parentPath, entry.name)).split("\\").join("/"));
  }
  return found.sort();
}

/** The statement of the build in `dir`, made from its files as they are. */
export async function statementOf(dir: string, build: string): Promise<Statement> {
  const files: Record<string, string> = {};
  for (const path of await coveredFiles(dir)) files[path] = sha256(await readFile(join(dir, path)));
  return { build, files };
}

/** The statement a file holds; null where it is not one this build reads. */
export function readStatement(text: string): Statement | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.build !== "string" || !isRecord(parsed.files)) return null;
  const files: Record<string, string> = {};
  for (const [path, hash] of Object.entries(parsed.files)) {
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return null;
    files[path] = hash;
  }
  return files["rpe.js"] === undefined ? null : { build: parsed.build, files };
}

/** A build checked against what was stated for it: its statement, or why it is not taken. */
export type Verified = { statement: Statement; hash: string } | { refused: string };

/**
 * Checks the build whose files are in `dir` against the hash stated for it: the statement there must
 * hash to what was stated, and every file it lists must be there as listed, with no file of the
 * covered folders left out of it. A build is taken only when every one matches.
 */
export async function verifyBuild(dir: string, stated: string): Promise<Verified> {
  let text: string;
  try {
    text = await readFile(join(dir, STATEMENT_FILE), "utf8");
  } catch {
    return { refused: `the build's statement of its files (${STATEMENT_FILE}) is not beside its app file, so there is nothing to check its files against` };
  }
  const hash = statedHash(text);
  if (hash !== stated.toLowerCase()) return { refused: `the extension stated the hash ${stated.slice(0, 12)}…, and the build's statement of its files hashes to ${hash.slice(0, 12)}…: they are not the same build` };
  const statement = readStatement(text);
  if (statement === null) return { refused: `the build's statement of its files (${STATEMENT_FILE}) is not one this RPE reads` };
  const there = await coveredFiles(dir);
  const extra = there.filter((path) => statement.files[path] === undefined);
  if (extra.length > 0) return { refused: `${extra[0]} is in the build's folders and not in its statement` };
  for (const [path, want] of Object.entries(statement.files)) {
    const have = await readFile(join(dir, path)).then(sha256, () => null);
    if (have === null) return { refused: `${path} is in the build's statement and not there` };
    if (have !== want) return { refused: `${path} is not the file the build stated: its hash is ${have.slice(0, 12)}…, and the statement says ${want.slice(0, 12)}…` };
  }
  return { statement, hash };
}
