// RPE's own newest log lines, kept for the Runtime page (plan §4.4 the `service` group, §14): each with its level, its time, the
// area that said it and the chat, turn or job it names, so a page can show the lines of one job or one turn. The kept lines are the
// newest `service.logLines`; the log itself goes on to wherever it was going (standard error, in the server). Never a secret: a field
// that is named like one is kept as hidden, and so is a text in any field that looks like a key or a token RPE made.

import type { Log } from "rp-harness/contract";
import type { JsonValue } from "../shared/json";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/** One kept line. */
export interface LogLine {
  /** Its time, in milliseconds since 1970. */
  at: number;
  level: LogLevel;
  message: string;
  /** The area that said it (the field `area`), none where it named none. */
  area: string | null;
  chat: string | null;
  turn: string | null;
  job: string | null;
  /** Every field it carried, with what is secret hidden. */
  fields: Record<string, JsonValue>;
}

/** Which of the kept lines a page asks for. */
export interface LogFilter {
  area?: string | undefined;
  chat?: string | undefined;
  turn?: string | undefined;
  job?: string | undefined;
  /** This level and the worse. */
  level?: LogLevel | undefined;
  /** At most this many, newest first. */
  limit: number;
}

/** A field named like a secret. */
const SECRET_NAME = /key|token|secret|password|passphrase|authorization|credential|cookie|signature/i;
/** A text that is a key or a token RPE or a provider makes. */
const SECRET_TEXT = /\b(?:rpe_[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,})/g;
const HIDDEN = "[hidden]";

/** A value with each secret in it hidden, to any depth. */
function hidden(value: JsonValue, name: string | null): JsonValue {
  if (name !== null && SECRET_NAME.test(name)) return HIDDEN;
  if (typeof value === "string") return value.replace(SECRET_TEXT, HIDDEN);
  if (Array.isArray(value)) return value.map((v) => hidden(v, null));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hidden(v, k)]));
  return value;
}

const idOf = (fields: Record<string, JsonValue>, name: string): string | null => {
  const value = fields[name];
  return typeof value === "string" ? value : null;
};

export class ServiceLog {
  /** The log to use in place of the one wrapped: it says every line to that one, and keeps it. */
  readonly log: Log;
  readonly #kept: number;
  readonly #lines: LogLine[] = [];
  /** How many of the oldest lines are never let go: the line that says why RPE started, which a page that reads the log after a restart looks for. */
  readonly #pinned: number;

  constructor(inner: Log, kept: number, now: () => number, pinned = 0) {
    this.#kept = kept;
    this.#pinned = Math.min(pinned, kept);
    const say =
      (level: LogLevel) =>
      (message: string, fields?: Record<string, JsonValue>): void => {
        inner[level](message, fields);
        const seen = fields === undefined ? {} : (hidden(fields, null) as Record<string, JsonValue>);
        this.#lines.push({ at: now(), level, message: message.replace(SECRET_TEXT, HIDDEN), area: idOf(seen, "area"), chat: idOf(seen, "chat"), turn: idOf(seen, "turn"), job: idOf(seen, "job"), fields: seen });
        if (this.#lines.length > this.#kept) this.#lines.splice(this.#pinned, this.#lines.length - this.#kept);
      };
    this.log = { debug: say("debug"), info: say("info"), warn: say("warn"), error: say("error") };
  }

  /** How many lines are kept now. */
  get size(): number {
    return this.#lines.length;
  }

  /** The kept lines that match, newest first. */
  lines(filter: LogFilter): LogLine[] {
    const worst = filter.level === undefined ? 0 : LEVELS.indexOf(filter.level);
    const out: LogLine[] = [];
    for (let i = this.#lines.length - 1; i >= 0 && out.length < filter.limit; i--) {
      const line = this.#lines[i];
      if (line === undefined || LEVELS.indexOf(line.level) < worst) continue;
      if (filter.area !== undefined && line.area !== filter.area) continue;
      if (filter.chat !== undefined && line.chat !== filter.chat) continue;
      if (filter.turn !== undefined && line.turn !== filter.turn) continue;
      if (filter.job !== undefined && line.job !== filter.job) continue;
      out.push(line);
    }
    return out;
  }
}
