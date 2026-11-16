// What RPE knows of a file it has written or read whole once: its hash so far, its size and its lines (plan §4.7, §5.1). An
// append to a session file or a transcript, which RPE makes at every turn, then costs what the append is and no more, and
// answers the same `hash` and `before` as hashing the whole file would; and a read of a range of such a file need not read
// past the range for the file's size, lines and hash. The state is trusted only while the file is as RPE left it (its size and
// its time of change as noted after RPE's last touch); a file changed by another hand is read whole once more.

import { createHash, type Hash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { scan } from "./ranged";

export interface Running {
  /** The hash of the file's bytes so far, not finished: a copy of it is. */
  hash: Hash;
  bytes: number;
  /** The line breaks in it. */
  breaks: number;
  /** Whether the file is empty or ends in a line break, so that text appended starts a new line. */
  complete: boolean;
  mtimeMs: number;
}

/** A file's lines: its breaks, and the last line if it has none after it. */
export function linesOf(state: Running): number {
  return state.breaks + (state.complete ? 0 : 1);
}

/** How many files' states are kept: the ones touched last. */
const KEPT = 256;

export class RunningFiles {
  readonly #kept = new Map<string, Running>();

  /** The state of the file if it is still as RPE left it. */
  valid(disk: string, info: { size: number; mtimeMs: number }): Running | undefined {
    const known = this.#kept.get(disk);
    if (known === undefined) return undefined;
    this.#kept.delete(disk);
    if (known.bytes !== info.size || known.mtimeMs !== info.mtimeMs) return undefined;
    this.#kept.set(disk, known);
    return known;
  }

  keep(disk: string, state: Running): void {
    this.#kept.delete(disk);
    this.#kept.set(disk, state);
    if (this.#kept.size > KEPT) this.#kept.delete(this.#kept.keys().next().value as string);
  }

  /** Reads the file whole once, as a stream, for its hash and its lines; the state is kept. */
  async seed(disk: string): Promise<Running> {
    const hash = createHash("sha256");
    const read = await scan(disk, 1, 0, { hash });
    const info = await stat(disk);
    const complete = info.size === 0 || (await endsWithBreak(disk, info.size));
    const state: Running = { hash, bytes: info.size, breaks: complete ? (read.lines ?? 0) : (read.lines ?? 1) - 1, complete, mtimeMs: info.mtimeMs };
    this.keep(disk, state);
    return state;
  }

  /**
   * What the file is now that `text` was appended to it (the file's state before, none for a file that was not there): the hash of it
   * before and after, as hashing the whole file would give them, its size and its lines. The state moves on.
   */
  async appended(disk: string, before: Running | null, text: string): Promise<{ before: string | null; after: string; bytes: number; lines: number }> {
    const state = before ?? { hash: createHash("sha256"), bytes: 0, breaks: 0, complete: true, mtimeMs: 0 };
    const was = before === null ? null : state.hash.copy().digest("hex");
    const data = Buffer.from(text, "utf8");
    state.hash.update(data);
    for (let at = data.indexOf(10); at !== -1; at = data.indexOf(10, at + 1)) state.breaks++;
    if (data.length > 0) state.complete = data.at(-1) === 10;
    const info = await stat(disk);
    state.bytes = info.size;
    state.mtimeMs = info.mtimeMs;
    this.keep(disk, state);
    return { before: was, after: state.hash.copy().digest("hex"), bytes: info.size, lines: linesOf(state) };
  }
}

async function endsWithBreak(disk: string, size: number): Promise<boolean> {
  const handle = await open(disk, "r");
  try {
    const one = Buffer.alloc(1);
    await handle.read(one, 0, 1, size - 1);
    return one[0] === 10;
  } finally {
    await handle.close();
  }
}
