// Numbers, times, counts and the tree's levels as the pages say them.

import type { LayerLevel, LimitHit, Usage } from "../shared/api";

/** The levels of the agents' tree, as the Files and Settings pages name them. */
export const LEVEL_WORDS: Readonly<Record<LayerLevel, string>> = { shipped: "Shipped", global: "Yours", character: "This character's", chat: "This chat's" };

const NUMBER = new Intl.NumberFormat("en");

export function num(n: number): string {
  return NUMBER.format(n);
}

/** "1 call", "3 calls". */
export function counted(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

/** A text cut to `most` characters, the cut shown by an ellipsis in the last of them. */
export function cut(text: string, most: number): string {
  return text.length > most ? `${text.slice(0, most - 1)}…` : text;
}

/** A size: "512 bytes", "2.0 KB", "1.4 MB", "2.0 GB". */
export function bytesWords(n: number): string {
  if (n < 1024) return counted(n, "byte");
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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

const LIMIT_OF: Readonly<Record<LimitHit["limit"], string>> = {
  calls: "model calls",
  tokensIn: "tokens sent",
  tokensOut: "tokens written",
  tokens: "tokens sent and written",
  time: "time",
  depth: "depth of sub-agents",
  agents: "sub-agents started",
  jobs: "jobs started",
  callTokensIn: "tokens sent in one call",
  callTokensOut: "tokens written in one answer",
  callTime: "time of one call",
  toolRounds: "rounds of tool calls",
  repeats: "the same tool call in a row",
  tokensPerMinute: "tokens in a minute",
};

const LIMIT_OVER: Readonly<Record<LimitHit["per"], string>> = { turn: "in a turn", agent: "by one agent", job: "in one job", day: "in a day", connection: "on a connection" };

/** What a limit reached was a limit on, in plain words: "model calls in a turn", "tokens sent in a day". */
export function limitName(hit: Pick<LimitHit, "limit" | "per" | "connection">): string {
  const over = hit.connection === undefined ? LIMIT_OVER[hit.per] : hit.per === "connection" ? `on ${hit.connection}` : `${LIMIT_OVER[hit.per]}, on ${hit.connection}`;
  return `${LIMIT_OF[hit.limit]} ${over}`;
}

/** The count against a limit reached: "6 of 5", a time as its length. */
export function limitCount(hit: Pick<LimitHit, "limit" | "max" | "value">): string {
  const say = hit.limit === "time" || hit.limit === "callTime" ? duration : num;
  return `${say(hit.value)} of ${say(hit.max)}`;
}

/** A value as JSON, laid out to read. */
export function json(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value);
}

/** An error's own words. */
export function errorWords(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
