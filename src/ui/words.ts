// Numbers, times and counts as the pages say them.

import type { Usage } from "rp-harness/contract";

const NUMBER = new Intl.NumberFormat("en");

export function num(n: number): string {
  return NUMBER.format(n);
}

/** "1 call", "3 calls". */
export function counted(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

/** A file's size: "512 bytes", "2.0 KB", "1.4 MB". */
export function bytesWords(n: number): string {
  if (n < 1024) return counted(n, "byte");
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A length of time: "850 ms", "12.4 s", "3 min 05 s", "1 h 02 min". */
export function duration(ms: number): string {
  const whole = Math.max(0, ms);
  if (whole < 1000) return `${Math.round(whole)} ms`;
  if (whole < 60_000) return `${(whole / 1000).toFixed(1)} s`;
  const seconds = Math.round(whole / 1000);
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** A moment as a clock shows it, in the page's own time zone: "20:15:04". */
export function clock(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** A moment with its day: "12 Nov 2026, 20:15". */
export function when(at: number): string {
  return new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Tokens in and out: "12,345 in (8,000 cached) · 456 out (120 reasoning)". */
export function tokenWords(usage: Usage): string {
  const cached = usage.cacheRead > 0 ? ` (${num(usage.cacheRead)} cached)` : "";
  const reasoning = usage.reasoning !== undefined && usage.reasoning > 0 ? ` (${num(usage.reasoning)} reasoning)` : "";
  return `${num(usage.input)} in${cached} · ${num(usage.output)} out${reasoning}`;
}

/** A value as JSON, laid out to read. */
export function json(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value);
}

/** An error's own words. */
export function errorWords(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
