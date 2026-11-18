// The memory RPE's service may hold (`service.memory`, `rpe up --memory`): the size its systemd unit
// holds it to (`MemoryMax`). Only a size systemd reads is taken, so no limit makes a unit systemd
// refuses, and none is so small that RPE cannot start under it. And what RPE holds now, for the
// Runtime page: as the process counts it, split into the engine's heap and the rest, as the kernel
// counts it against the service's limit, and what RPE and its harness keep that can grow with play.

import { memoryUsage as allocatorUsage } from "bun:jsc";
import { readFile } from "node:fs/promises";

/** The process's own figures, in bytes: what tells the engine's heap from the rest. */
export interface MemoryFigures {
  /** The resident size now: what the process holds in the machine's memory. */
  holds: number;
  /** The engine's heap: the objects in it, and the heap's whole size with its free room. */
  heap: { used: number; total: number };
  /** Memory the heap's objects own outside it (the text of long strings, the bytes of buffers), and of that the buffers. */
  outside: number;
  buffers: number;
  /** What the allocator outside the heap holds from the system: what freed memory it has not yet given back shows here. */
  allocator: number;
}

/** What RPE keeps that can grow with play, by its name: how many, and the characters of text they hold where that is counted. */
export interface KeptCount {
  name: string;
  count: number;
  chars: number | null;
}

/**
 * What each part of RPE keeps in memory that can grow with play, each told once under its name, read when the Runtime page asks: a
 * part counts what it holds itself (how many, and the characters of their text where it has them), so the count costs no more than a
 * walk of the part's own map. A count that throws is left out of that read.
 */
export class KeptCounts {
  readonly #counts = new Map<string, () => { count: number; chars?: number | null }>();
  readonly #groups: (() => readonly KeptCount[])[] = [];

  /** A part's count under `name`, which says in plain words what is kept ("Session files kept read"). */
  add(name: string, read: () => { count: number; chars?: number | null }): void {
    this.#counts.set(name, read);
  }

  /** A part that names its own counts, read whole at each read (the harness's `kept()`). */
  addAll(read: () => readonly KeptCount[]): void {
    this.#groups.push(read);
  }

  read(): KeptCount[] {
    const out: KeptCount[] = [];
    for (const [name, read] of this.#counts) {
      try {
        const { count, chars } = read();
        out.push({ name, count, chars: chars ?? null });
      } catch {
        // A part that cannot count now is left out of this read; the next read asks it again.
      }
    }
    for (const read of this.#groups) {
      try {
        out.push(...read());
      } catch {
        // As above.
      }
    }
    return out;
  }
}

/** What RPE holds now, in bytes: the process's figures, its highest resident size, its worker threads, what it keeps by name, and its service's own count where it has one. */
export interface MemoryHeld extends MemoryFigures {
  peak: number;
  threads: number;
  kept: KeptCount[];
  /**
   * What the kernel counts against the service's limit (its cgroup's `memory.current` and `memory.peak`, which take in the pages of the
   * files RPE wrote that the system keeps in memory and gives back before the limit is reached), and the limit itself (`memory.max`:
   * the unit's MemoryMax; null for none); null where RPE does not run as a service, or its count cannot be read.
   */
  service: { holds: number; peak: number | null; limit: number | null } | null;
}

/** A cgroup file's count in bytes; null for one that cannot be read or holds no number ("max", no limit). */
async function cgroupBytes(folder: string, name: string): Promise<number | null> {
  const text = await readFile(`${folder}/${name}`, "utf8").catch(() => null);
  return text !== null && /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

/** The service's count and limit as its cgroup (v2) keeps them; null where the process's cgroup or its count cannot be read (not Linux, cgroup v1). */
async function serviceCount(): Promise<MemoryHeld["service"]> {
  const own = (await readFile("/proc/self/cgroup", "utf8").catch(() => "")).split("\n").find((line) => line.startsWith("0::"));
  if (own === undefined) return null;
  const folder = `/sys/fs/cgroup${own.slice(3).trim()}`;
  const [holds, peak, limit] = await Promise.all([cgroupBytes(folder, "memory.current"), cgroupBytes(folder, "memory.peak"), cgroupBytes(folder, "memory.max")]);
  return holds === null ? null : { holds, peak, limit };
}

/** The process's own figures now. */
export function memoryFigures(): MemoryFigures {
  const used = process.memoryUsage();
  return { holds: used.rss, heap: { used: used.heapUsed, total: used.heapTotal }, outside: used.external, buffers: used.arrayBuffers, allocator: allocatorUsage().currentCommit };
}

/** What RPE holds now; `asService`: it runs under its own service unit, whose cgroup is its own (one started by hand shares its terminal's). */
export async function memoryHeld(threads: number, asService: boolean, kept: readonly KeptCount[] = []): Promise<MemoryHeld> {
  // `maxRSS` is in kilobytes.
  return { ...memoryFigures(), peak: process.resourceUsage().maxRSS * 1024, threads, kept: [...kept], service: asService ? await serviceCount() : null };
}

/**
 * A full collection now, the memory outside the heap freed with it, and the figures before and after: where they fall far, the engine
 * was slow to collect what nothing held; where they do not, something holds it.
 */
export function freeNow(): { before: MemoryFigures; after: MemoryFigures; ms: number } {
  const before = memoryFigures();
  const started = performance.now();
  Bun.gc(true);
  return { before, after: memoryFigures(), ms: Math.round(performance.now() - started) };
}

/** The least RPE may be given: Bun alone holds about 35M once started, and RPE serves, holds its stores and runs agents on top. */
export const MEMORY_FLOOR = "256M";

/** A whole number of bytes, or of K, M, G or T (powers of 1024), as systemd reads a size. */
const SIZE = /^([0-9]+)([KMGT]?)$/;
const FACTOR: Readonly<Record<string, bigint>> = { "": 1n, K: 1024n, M: 1024n ** 2n, G: 1024n ** 3n, T: 1024n ** 4n };
/** systemd keeps a size in 64 bits and refuses one that does not fit. */
const MOST = 2n ** 64n - 1n;

/** A limit's size in bytes; null for `infinity` (no limit); undefined for a value that is not a size systemd reads. */
export function memoryBytes(value: string): bigint | null | undefined {
  if (value === "infinity") return null;
  const size = SIZE.exec(value);
  if (size === null) return undefined;
  return BigInt(size[1] ?? "0") * (FACTOR[size[2] ?? ""] ?? 1n);
}

const FLOOR = memoryBytes(MEMORY_FLOOR) ?? 0n;

/** Why a value cannot be RPE's limit, in words that follow its name (`--memory is "12Q": …`); null when it can. */
export function memoryRefusal(value: string): string | null {
  const bytes = memoryBytes(value);
  if (bytes === undefined) return "give a size as systemd reads one, such as 768M or 2G, or infinity for no limit";
  if (bytes === null) return null;
  if (bytes < FLOOR) return `RPE needs at least ${MEMORY_FLOOR} to start: give ${MEMORY_FLOOR} or more`;
  if (bytes > MOST) return "that is more than systemd can count: give a size such as 2G, or infinity for no limit";
  return null;
}
