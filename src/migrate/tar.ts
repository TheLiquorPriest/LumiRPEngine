// The backup's archive format: a POSIX tar (ustar, with a pax header for any name that doesn't fit
// ustar's own field), written one file at a time, so a backup of many files never holds more than
// one of them in memory. Plain tar so that `tar -xf` restores it on any server without RPE.

import { createHash, type Hash } from "node:crypto";
import type { FileSink } from "bun";

const BLOCK = 512;
/** The largest size ustar's own field holds (eleven octal digits); a larger file says its size in its pax header. */
const USTAR_MAX_SIZE = 0o77777777777;
const ENCODER = new TextEncoder();

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

/** The pax records a file needs: its name when ustar can't hold it, its size when ustar can't. */
function paxRecords(name: string, bytes: number): string {
  return (fitsUstar(name) ? "" : paxRecord("path", name)) + (bytes > USTAR_MAX_SIZE ? paxRecord("size", String(bytes)) : "");
}

/** The bytes one file takes in the archive, headers included. */
export function tarEntrySize(name: string, bytes: number): number {
  const pax = paxRecords(name, bytes);
  return (pax === "" ? 0 : BLOCK + padded(ENCODER.encode(pax).length)) + BLOCK + padded(bytes);
}

/** The end of an archive: two empty blocks. */
export const TAR_END_BYTES = 2 * BLOCK;

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

/** The archive as it is written, file by file, with the SHA-256 and size of everything written. */
export class TarWriter {
  private readonly hash: Hash = createHash("sha256");
  private bytes = 0;

  private constructor(private readonly sink: FileSink) {}

  /** A new archive at `path`, which must not hold one already: an existing file there is replaced. */
  static open(path: string): TarWriter {
    return new TarWriter(Bun.file(path).writer());
  }

  private async put(chunk: Uint8Array): Promise<void> {
    this.hash.update(chunk);
    this.bytes += chunk.length;
    this.sink.write(chunk);
    await this.sink.flush();
  }

  /** Adds one file: its path in the archive, its bytes, when it was last changed (seconds) and its mode. */
  async add(name: string, data: Uint8Array, mtimeSeconds: number, mode: number): Promise<void> {
    const pax = paxRecords(name, data.length);
    if (pax !== "") {
      const records = ENCODER.encode(pax);
      await this.put(header(`PaxHeaders/${name.split("/").pop() ?? "file"}`, records.length, mtimeSeconds, 0o644, "x"));
      await this.put(records);
      if (padded(records.length) > records.length) await this.put(new Uint8Array(padded(records.length) - records.length));
    }
    await this.put(header(name, data.length, mtimeSeconds, mode, "0"));
    await this.put(data);
    if (padded(data.length) > data.length) await this.put(new Uint8Array(padded(data.length) - data.length));
  }

  /** Ends the archive; its size and its SHA-256. */
  async close(): Promise<{ bytes: number; sha256: string }> {
    await this.put(new Uint8Array(TAR_END_BYTES));
    await this.sink.end();
    return { bytes: this.bytes, sha256: this.hash.digest("hex") };
  }
}
