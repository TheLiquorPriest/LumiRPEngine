// Carried unchanged from LumiAH (MIT; notice in THIRD-PARTY-NOTICES.md), src/runtime/update/memory.ts at commit 6a38779a5e33fe563f0c8c617640343473617569.

// A runtime's memory limit: the size its systemd unit holds it to (MemoryMax). It is kept in the
// runtime's config, so setting the runtime up again never resets it, and the Runtime page changes
// it. Only values systemd reads are taken, so no limit makes a unit systemd refuses, and none is so
// small that the runtime can't start under it.

/** A runtime's limit until one is given: `up --memory`, or the Runtime page. */
export const DEFAULT_MEMORY = "1G";

/**
 * The least a runtime may be given. Bun alone holds about 35M once it has started (measured on the
 * runtime's own `--version` and on a bare server); a runtime that serves holds its link, the core
 * and its connections on top. Under this it could be stopped before it has linked, and its unit
 * would start it again every two seconds, for ever.
 */
export const MEMORY_FLOOR = "256M";

/** A whole number of bytes, or of K, M, G or T (powers of 1024), as systemd reads a size. */
const SIZE = /^([0-9]+)([KMGT]?)$/;
const FACTOR: Readonly<Record<string, bigint>> = { "": 1n, K: 1024n, M: 1024n ** 2n, G: 1024n ** 3n, T: 1024n ** 4n };
/** systemd keeps a size in 64 bits and refuses one that doesn't fit. */
const MOST = 2n ** 64n - 1n;

/** A limit's size in bytes; null for `infinity` (no limit); undefined for a value that isn't a size systemd reads. */
export function memoryBytes(value: string): bigint | null | undefined {
  if (value === "infinity") return null;
  const size = SIZE.exec(value);
  if (size === null) return undefined;
  return BigInt(size[1] ?? "0") * (FACTOR[size[2] ?? ""] ?? 1n);
}

const FLOOR = memoryBytes(MEMORY_FLOOR) ?? 0n;

/** Why a value can't be a runtime's limit, in words that follow its name (`--memory is "12Q": …`); null when it can. */
export function memoryRefusal(value: string): string | null {
  const bytes = memoryBytes(value);
  if (bytes === undefined) return "give a size as systemd reads one, such as 768M or 2G, or infinity for no limit";
  if (bytes === null) return null;
  if (bytes < FLOOR) return `the runtime needs at least ${MEMORY_FLOOR} to start: give ${MEMORY_FLOOR} or more`;
  if (bytes > MOST) return "that is more than systemd can count: give a size such as 2G, or infinity for no limit";
  return null;
}
