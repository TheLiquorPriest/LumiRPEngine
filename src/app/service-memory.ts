// The memory RPE's service may hold (`service.memory`, `rpe up --memory`): the size its systemd unit
// holds it to (`MemoryMax`). Only a size systemd reads is taken, so no limit makes a unit systemd
// refuses, and none is so small that RPE cannot start under it. And what RPE holds now, for the
// Runtime page: as the process counts it, and as the kernel counts it against the service's limit.

import { readFile } from "node:fs/promises";

/** What RPE holds now, in bytes: the process's resident size now and at its highest, its worker threads, and its service's own count where it has one. */
export interface MemoryHeld {
  holds: number;
  peak: number;
  threads: number;
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

/** What RPE holds now; `asService`: it runs under its own service unit, whose cgroup is its own (one started by hand shares its terminal's). */
export async function memoryHeld(threads: number, asService: boolean): Promise<MemoryHeld> {
  // `maxRSS` is in kilobytes.
  return { holds: process.memoryUsage.rss(), peak: process.resourceUsage().maxRSS * 1024, threads, service: asService ? await serviceCount() : null };
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
