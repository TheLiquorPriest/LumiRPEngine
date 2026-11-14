// The application's archives (plan §4.5): the walk of a folder, and a writer of plain POSIX tar
// (ustar, with a pax header for a name or a size ustar's own fields cannot hold) that reads each file
// from the disk a piece at a time, so an archive of a large database never holds a whole file in
// memory. Plain tar, so that `tar -xf` restores it on any machine without RPE.

import { createHash, type Hash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { lstat, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isMissing, OWNER_ONLY_FILE } from "./disk";

const BLOCK = 512;
/** The largest size ustar's own field holds (eleven octal digits); a larger file says its size in its pax header. */
const USTAR_MAX_SIZE = 0o77777777777;
const ENCODER = new TextEncoder();

/** The end of an archive: two empty blocks. */
export const TAR_END_BYTES = 2 * BLOCK;
/** How much of a file is read, and written, at a time. */
export const ARCHIVE_PIECE_BYTES = 1024 * 1024;

/** A file found under a folder: its path there (with `/`), its size, its mode and when it was last changed. `link`: a symbolic link, which is never followed. */
export interface FoundFile {
  path: string;
  bytes: number;
  mode: number;
  mtimeMs: number;
  link: boolean;
}

/**
 * Every file under `root`, at any depth, sorted by path; none when there is no such folder. A
 * folder's entries that cannot be listed throw: a walk that cannot see a folder must not report it
 * as empty.
 */
export async function walk(root: string): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  const visit = async (dir: string, prefix: string): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (prefix === "" && isMissing(error)) return;
      throw error;
    }
    for (const name of names) {
      const full = join(dir, name);
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const info = await lstat(full);
      if (info.isDirectory()) await visit(full, path);
      else out.push({ path, bytes: info.size, mode: info.mode, mtimeMs: info.mtimeMs, link: info.isSymbolicLink() });
    }
  };
  await visit(root, "");
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The bytes a file of `bytes` takes in the archive after its header: its data, padded to whole blocks. */
function padded(bytes: number): number {
  return Math.ceil(bytes / BLOCK) * BLOCK;
}

/** Whether a name fits ustar's own name field: ASCII, at most 100 bytes. */
function fitsUstar(name: string): boolean {
  return name.length <= 100 && /^[\x20-\x7e]*$/.test(name);
}

/** One pax record, `<length> <key>=<value>\n`, where the length counts the whole record, itself included. */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  const bodyBytes = ENCODER.encode(body).length;
  let length = bodyBytes + 1;
  while (String(length).length + bodyBytes !== length) length = String(length).length + bodyBytes;
  return `${length}${body}`;
}

/** The pax records a file needs: its name when ustar cannot hold it, its size when ustar cannot. */
function paxRecords(name: string, bytes: number): string {
  return (fitsUstar(name) ? "" : paxRecord("path", name)) + (bytes > USTAR_MAX_SIZE ? paxRecord("size", String(bytes)) : "");
}

/** The bytes one file takes in the archive, headers included. */
export function tarEntrySize(name: string, bytes: number): number {
  const pax = paxRecords(name, bytes);
  return (pax === "" ? 0 : BLOCK + padded(ENCODER.encode(pax).length)) + BLOCK + padded(bytes);
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0");
}

/** A ustar header block. `name` is cut to what fits when a pax header carries the whole name. */
function header(name: string, bytes: number, mtimeSeconds: number, mode: number, type: "0" | "x"): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const put = (text: string, at: number, width: number): void => {
    block.set(ENCODER.encode(text).subarray(0, width), at);
  };
  put(fitsUstar(name) ? name : name.replace(/[^\x20-\x7e]/g, "_").slice(-100), 0, 100);
  put(octal(mode & 0o7777, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(Math.min(bytes, USTAR_MAX_SIZE), 12), 124, 12);
  put(octal(Math.max(0, Math.floor(mtimeSeconds)), 12), 136, 12);
  put("        ", 148, 8);
  put(type, 156, 1);
  put("ustar\u0000", 257, 6);
  put("00", 263, 2);
  let sum = 0;
  for (const byte of block) sum += byte;
  put(`${octal(sum, 7)}\u0000`, 148, 8);
  return block;
}

/**
 * An archive as it is written, entry by entry, with the size and SHA-256 of everything written. A
 * writer is ended by `close`, or given up by `discard` (an `add` or `addFile` that threw leaves a
 * broken entry behind, so its archive is discarded, never closed).
 */
export class TarWriter {
  private readonly hash: Hash = createHash("sha256");
  private bytes = 0;
  private ended = false;

  private constructor(
    readonly path: string,
    private readonly out: Promise<FileHandle>,
    private readonly piece: Uint8Array,
  ) {}

  /** A new archive at `path`, readable by its owner alone; a file already there is replaced. Files are read `pieceBytes` at a time. */
  static open(path: string, pieceBytes: number = ARCHIVE_PIECE_BYTES): TarWriter {
    const out = open(path, "w", OWNER_ONLY_FILE);
    // A failure to open is answered by the first write, which waits on it.
    out.catch(() => undefined);
    return new TarWriter(path, out, new Uint8Array(pieceBytes));
  }

  private async put(chunk: Uint8Array): Promise<void> {
    const out = await this.out;
    this.hash.update(chunk);
    this.bytes += chunk.length;
    for (let at = 0; at < chunk.length; ) at += (await out.write(chunk, at, chunk.length - at)).bytesWritten;
  }

  /** An entry's headers: a pax header first when ustar's own fields cannot hold its name or size. */
  private async head(name: string, bytes: number, mtimeSeconds: number, mode: number): Promise<void> {
    const pax = paxRecords(name, bytes);
    if (pax !== "") {
      const records = ENCODER.encode(pax);
      await this.put(header(`PaxHeaders/${name.split("/").pop() ?? "file"}`, records.length, mtimeSeconds, 0o644, "x"));
      await this.put(records);
      if (padded(records.length) > records.length) await this.put(new Uint8Array(padded(records.length) - records.length));
    }
    await this.put(header(name, bytes, mtimeSeconds, mode, "0"));
  }

  /** Adds one file held in memory: its path in the archive, its bytes, when it was last changed (seconds) and its mode. */
  async add(name: string, data: Uint8Array, mtimeSeconds: number, mode: number): Promise<void> {
    await this.head(name, data.length, mtimeSeconds, mode);
    await this.put(data);
    if (padded(data.length) > data.length) await this.put(new Uint8Array(padded(data.length) - data.length));
  }

  /**
   * Adds the file at `disk` as `name`, read a piece at a time, with its own time and mode. Returns its
   * size and SHA-256 as archived. A file that changes while it is read is refused, since its entry
   * would hold part of each version.
   */
  async addFile(name: string, disk: string): Promise<{ bytes: number; sha256: string }> {
    const file = await open(disk, "r");
    try {
      const before = await file.stat();
      await this.head(name, before.size, before.mtimeMs / 1000, before.mode);
      const hash = createHash("sha256");
      let done = 0;
      while (done < before.size) {
        const { bytesRead } = await file.read(this.piece, 0, Math.min(this.piece.length, before.size - done), done);
        if (bytesRead === 0) break;
        const chunk = this.piece.subarray(0, bytesRead);
        hash.update(chunk);
        await this.put(chunk);
        done += bytesRead;
      }
      const after = await file.stat();
      if (done !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error(`${disk} changed while it was being archived: make the archive again.`);
      if (padded(done) > done) await this.put(new Uint8Array(padded(done) - done));
      return { bytes: done, sha256: hash.digest("hex") };
    } finally {
      await file.close();
    }
  }

  /** Ends the archive; its size and its SHA-256. */
  async close(): Promise<{ bytes: number; sha256: string }> {
    await this.put(new Uint8Array(TAR_END_BYTES));
    const out = await this.out;
    this.ended = true;
    try {
      await out.sync();
    } finally {
      await out.close();
    }
    return { bytes: this.bytes, sha256: this.hash.digest("hex") };
  }

  /** Gives the archive up: closes it and removes what was written of it. */
  async discard(): Promise<void> {
    if (!this.ended) {
      this.ended = true;
      const out = await this.out.catch(() => null);
      await out?.close();
    }
    await rm(this.path, { force: true });
  }
}
