// The backup the real run takes before anything else (STANDALONE-PLAN §15.3 step 4), and again at
// the swap: one archive of today's extension storage (the user's folder, and the extension's own
// where it is another), the runtime's own files with its installed copy and its service unit, and
// the list of chats with engine records. Each file is read once, hashed as it goes into the archive,
// and its checksum kept in the archive's manifest, which comes last; the archive's own checksum is
// reported beside it. Each run makes a new archive and never writes over one.

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readBytes, sha256, walk } from "./files";
import type { RuntimeFile } from "./runtime-folders";
import { TAR_END_BYTES, tarEntrySize, TarWriter } from "./tar";

export const BACKUP_FORMAT = "rpe-migration-backup-v1";
const MANIFEST = "MANIFEST.json";
const CHATS = "chats.json";

/** A chat with engine records, as the backup lists it: enough to find it again in Lumiverse. */
export interface BackupChat {
  chatId: string;
  name: string;
  engine: string | null;
  worldId: string | null;
  messages: number;
  turns: number;
}

/** A file to archive: its name in the archive and where it is on the disk. */
export interface BackupSource {
  name: string;
  disk: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  made: string;
  /** Where each part was on the server, for putting it back. */
  roots: { user: string | null; extension: string | null; runtime: { configDir: string; dataDir: string } | null };
  files: { name: string; bytes: number; sha256: string }[];
  /** `chats.json`'s own checksum. */
  chats: { bytes: number; sha256: string };
}

export interface BackupResult {
  path: string;
  bytes: number;
  sha256: string;
  manifest: BackupManifest;
}

/** What the backup takes: the storage folders whole, and the runtime's files as the migration found them. */
export async function backupSources(folders: { user: string | null; extension: string | null }, runtime: readonly RuntimeFile[]): Promise<BackupSource[]> {
  const out: BackupSource[] = [];
  if (folders.user !== null) for (const f of await walk(folders.user)) if (!f.link) out.push({ name: `user/${f.path}`, disk: join(folders.user, f.path) });
  if (folders.extension !== null && folders.extension !== folders.user) for (const f of await walk(folders.extension)) if (!f.link) out.push({ name: `extension/${f.path}`, disk: join(folders.extension, f.path) });
  for (const f of runtime) if (!f.link) out.push({ name: `runtime/${f.path}`, disk: f.disk });
  return out;
}

/** The archive's size for files of these sizes, the chat list and a manifest naming them: what the backup will take. */
export function backupSize(files: readonly { name: string; bytes: number }[], chats: readonly BackupChat[]): number {
  const chatsBytes = new TextEncoder().encode(JSON.stringify(chats, null, 2)).length;
  // Each manifest line holds a name, a size and a 64-hex checksum: its size is known before the checksums are.
  const manifestBytes = 512 + files.reduce((n, f) => n + new TextEncoder().encode(f.name).length + 120, 0);
  return files.reduce((n, f) => n + tarEntrySize(f.name, f.bytes), 0) + tarEntrySize(CHATS, chatsBytes) + tarEntrySize(MANIFEST, manifestBytes) + TAR_END_BYTES;
}

/** Makes the backup in `dest` (made if missing); never over an archive already there. */
export async function makeBackup(input: { dest: string; sources: readonly BackupSource[]; chats: readonly BackupChat[]; roots: BackupManifest["roots"]; now?: () => Date }): Promise<BackupResult> {
  const made = (input.now?.() ?? new Date()).toISOString();
  await mkdir(input.dest, { recursive: true });
  const path = join(input.dest, `rpe-migration-backup-${made.replace(/[:.]/g, "-")}.tar`);
  if (existsSync(path)) throw new Error(`A backup is already at ${path}; the migration never writes over one.`);
  const tar = TarWriter.open(path);
  const files: BackupManifest["files"] = [];
  for (const source of input.sources) {
    const data = await readBytes(source.disk);
    // A file gone since it was listed (today's build moved it into place, or removed it) is no file of the backup's.
    if (data === null) continue;
    const info = Bun.file(source.disk);
    await tar.add(source.name, data, info.lastModified / 1000, 0o600);
    files.push({ name: source.name, bytes: data.length, sha256: sha256(data) });
  }
  const chatsText = new TextEncoder().encode(JSON.stringify(input.chats, null, 2));
  await tar.add(CHATS, chatsText, Date.parse(made) / 1000, 0o600);
  const manifest: BackupManifest = { format: BACKUP_FORMAT, made, roots: input.roots, files, chats: { bytes: chatsText.length, sha256: sha256(chatsText) } };
  await tar.add(MANIFEST, new TextEncoder().encode(JSON.stringify(manifest, null, 2)), Date.parse(made) / 1000, 0o600);
  const { bytes, sha256: sum } = await tar.close();
  return { path, bytes, sha256: sum, manifest };
}

/**
 * Reads a backup back and checks it: the archive's own checksum when one is given, every file
 * against the manifest's checksum, and the chat list. Problems in plain words; none when it holds.
 */
export async function verifyBackup(path: string, expectedSha256?: string): Promise<string[]> {
  const problems: string[] = [];
  const bytes = new Uint8Array(await readFile(path));
  if (expectedSha256 !== undefined && sha256(bytes) !== expectedSha256) problems.push("The archive's checksum differs from the one reported when it was made.");
  const entries = await new Bun.Archive(bytes).files();
  const text = async (name: string): Promise<Uint8Array | null> => {
    const file = entries.get(name);
    return file ? new Uint8Array(await file.arrayBuffer()) : null;
  };
  const manifestBytes = await text(MANIFEST);
  if (manifestBytes === null) return [...problems, "The archive holds no manifest."];
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as BackupManifest;
  for (const f of manifest.files) {
    const data = await text(f.name);
    if (data === null) problems.push(`${f.name} is missing from the archive.`);
    else if (data.length !== f.bytes || sha256(data) !== f.sha256) problems.push(`${f.name} doesn't match its checksum.`);
  }
  const chats = await text(CHATS);
  if (chats === null || sha256(chats) !== manifest.chats.sha256) problems.push("The list of chats doesn't match its checksum.");
  const named = new Set([...manifest.files.map((f) => f.name), CHATS, MANIFEST]);
  for (const name of entries.keys()) if (!named.has(name)) problems.push(`${name} is in the archive but not in its manifest.`);
  return problems;
}
