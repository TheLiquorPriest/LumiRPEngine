// The scripts run on the test bed from a copy of `scripts/testbed/` alone, so they import nothing
// from the repository's `src/`.

/** A parsed JSON value that is an object (not null, not a list). */
export function isRecord(value: unknown): value is { [key: string]: unknown } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
