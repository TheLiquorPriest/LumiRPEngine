// A file read a part at a time (plan §5, §14: a session file or a transcript opened on a phone): lines
// from one on, or bytes from an offset, read as a stream so that no more of the file than the part is
// held. The file's size and its count of lines come with it, for the page to say where it is in the file.

import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";

/** A part of a file, as whole lines. */
export interface LinesRead {
  text: string;
  /** The first line it holds (from 1) and the last (`from - 1` when it holds none). */
  from: number;
  to: number;
  /** The file's lines in all: a last line without its break counts. */
  lines: number;
  /** The file's size in bytes. */
  bytes: number;
}

/** A part of a file, as bytes (a part that cuts a character shows the break as the replacement character). */
export interface BytesRead {
  text: string;
  offset: number;
  length: number;
  lines: number;
  bytes: number;
}

const NEWLINE = 10;

/** The lines `from` to `from + count - 1` of a file (count 0 reads none, and counts the lines), and how many lines it has. */
export async function readLines(disk: string, from: number, count: number): Promise<LinesRead> {
  const bytes = (await stat(disk)).size;
  const parts: Buffer[] = [];
  let line = 1;
  let last = -1;
  for await (const chunk of createReadStream(disk, { highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>) {
    let at = 0;
    while (at < chunk.length) {
      const found = chunk.indexOf(NEWLINE, at);
      const end = found === -1 ? chunk.length : found + 1;
      if (line >= from && line < from + count) parts.push(chunk.subarray(at, end));
      if (found !== -1) line++;
      at = end;
    }
    last = chunk.at(-1) ?? last;
  }
  const lines = bytes === 0 ? 0 : last === NEWLINE ? line - 1 : line;
  return { text: Buffer.concat(parts).toString("utf8"), from, to: Math.min(from + count - 1, lines), lines, bytes };
}

/** `length` bytes of a file from `offset`, and how many lines the file has. */
export async function readBytes(disk: string, offset: number, length: number): Promise<BytesRead> {
  const bytes = (await stat(disk)).size;
  const handle = await open(disk, "r");
  try {
    const buffer = Buffer.alloc(Math.max(0, Math.min(length, bytes - offset)));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    return { text: buffer.subarray(0, bytesRead).toString("utf8"), offset, length: bytesRead, lines: (await readLines(disk, 1, 0)).lines, bytes };
  } finally {
    await handle.close();
  }
}
