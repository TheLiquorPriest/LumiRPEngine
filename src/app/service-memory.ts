// The memory RPE's service may hold (`service.memory`, `rpe up --memory`): the size its systemd unit
// holds it to (`MemoryMax`). Only a size systemd reads is taken, so no limit makes a unit systemd
// refuses, and none is so small that RPE cannot start under it.

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
