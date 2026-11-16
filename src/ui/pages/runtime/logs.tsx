// RPE's own log (plan §4.4 the `service` group, §14 Runtime): its newest lines first, a page at a time, narrowed by level,
// area, chat, turn and job; a line opens whole with the chat, turn and job it names. The filter is part of the page's
// address (`runtime/log/job/<id>/area/bootstrap`), so the Jobs page and the Turn page link to the log of one job or turn.

import type { ServiceLog } from "../../../shared/api";
import { Badge, Banner, Button, Fold, Section } from "../../atoms";
import { clock, counted, when } from "../../words";

export type LogLevel = ServiceLog["lines"][number]["level"];
export type LogLine = ServiceLog["lines"][number];

export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/** What narrows the log: a line must meet every one that is given (a level means that level and the worse). */
export interface LogFilter {
  level?: LogLevel;
  area?: string;
  chat?: string;
  turn?: string;
  job?: string;
}

const KEYS = ["area", "chat", "job", "level", "turn"] as const;

/** The filter an address holds (`log`, then names and values in pairs), or null where the address is not the log's. */
export function logFilterOf(at: readonly string[] | undefined): LogFilter | null {
  if (at === undefined || at[0] !== "log") return null;
  const filter: Record<string, string> = {};
  for (let i = 1; i + 1 < at.length; i += 2) {
    const key = at[i] as (typeof KEYS)[number];
    const value = at[i + 1] as string;
    if (!KEYS.includes(key) || value === "") continue;
    if (key === "level" && !LOG_LEVELS.includes(value as LogLevel)) continue;
    filter[key] = value;
  }
  return filter as LogFilter;
}

/** The address of the log narrowed so. */
export function logAt(filter: LogFilter): string[] {
  const at = ["log"];
  for (const key of KEYS) {
    const value = filter[key];
    if (value !== undefined && value !== "") at.push(key, value);
  }
  return at;
}

const LEVEL_TONE: Readonly<Record<LogLevel, "neg" | "warn" | undefined>> = { error: "neg", warn: "warn", info: undefined, debug: undefined };

function Line(props: { line: LogLine; onTurn(chat: string, turn: string): void; onFilter(filter: LogFilter): void }) {
  const { line } = props;
  const named = [line.chat === null ? null : `chat ${line.chat}`, line.turn === null ? null : `turn ${line.turn}`, line.job === null ? null : `job ${line.job}`].filter((s) => s !== null);
  const fields = typeof line.fields === "object" && line.fields !== null && !Array.isArray(line.fields) ? Object.entries(line.fields) : [];
  return (
    <li class="rpe-entry" data-log-line data-level={line.level}>
      <Fold
        summary={
          <span class="rpe-log-head">
            <Badge tone={LEVEL_TONE[line.level]}>{line.level}</Badge> <span class="rpe-meta">{clock(line.at)}</span>
            {line.area === null ? null : <span class="rpe-meta"> {line.area}</span>} <span class="rpe-log-text">{line.message}</span>
          </span>
        }
      >
        <div class="lre-stack" data-log-whole>
          <p class="rpe-line">{line.message}</p>
          <p class="rpe-meta">
            {when(line.at)}
            {line.area === null ? "" : ` · ${line.area}`}
            {named.length === 0 ? "" : ` · ${named.join(" · ")}`}
          </p>
          {fields.length === 0 ? null : (
            <dl class="rpe-fields">
              {fields.map(([key, value]) => (
                <div key={key} class="rpe-field">
                  <dt>{key}</dt>
                  <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          <div class="lre-inline rpe-wrap">
            {line.chat !== null && line.turn !== null ? (
              <Button small kind="ghost" onClick={() => props.onTurn(line.chat as string, line.turn as string)}>
                Open its turn
              </Button>
            ) : null}
            {line.job !== null ? (
              <Button small kind="ghost" onClick={() => props.onFilter({ job: line.job as string })}>
                Lines of this job
              </Button>
            ) : null}
            {line.turn !== null ? (
              <Button small kind="ghost" onClick={() => props.onFilter({ turn: line.turn as string })}>
                Lines of this turn
              </Button>
            ) : null}
          </div>
        </div>
      </Fold>
    </li>
  );
}

export interface LogViewProps {
  filter: LogFilter;
  /** The log as the last read answered; null before any did. */
  log: ServiceLog | null;
  /** How many lines the last read asked for. */
  asked: number;
  loading: boolean;
  problem: string | null;
  onFilter(filter: LogFilter): void;
  onMore(): void;
  onTurn(chat: string, turn: string): void;
}

const FIELD_WORDS: Readonly<Record<"area" | "chat" | "turn" | "job", string>> = { area: "Area", chat: "Chat", turn: "Turn", job: "Job" };

/** Whether lines older than those shown are kept: the read gave all it was asked for, and RPE keeps more than that. */
export function moreLines(log: ServiceLog | null, asked: number): boolean {
  return log !== null && log.lines.length >= asked && asked < log.kept;
}

export function LogView(props: LogViewProps) {
  const { filter, log } = props;
  const narrowed = Object.keys(filter).length > 0;
  return (
    <Section id="log" title="RPE's log" actions={narrowed ? <Button small kind="ghost" onClick={() => props.onFilter({})}>Show every line</Button> : undefined}>
      <form
        class="lre-stack"
        data-log-filter
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget as HTMLFormElement;
          const text = (name: string): string | undefined => {
            const value = ((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "").trim();
            return value === "" ? undefined : value;
          };
          const level = text("level") as LogLevel | undefined;
          props.onFilter({ ...(level === undefined ? {} : { level }), ...(["area", "chat", "turn", "job"] as const).reduce<LogFilter>((made, name) => ({ ...made, ...(text(name) === undefined ? {} : { [name]: text(name) }) }), {}) });
        }}
      >
        <div class="rpe-log-filters">
          <label class="lre-field">
            <span class="label">Level</span>
            <select class="lre-input" name="level" value={filter.level ?? ""} key={`level-${filter.level ?? ""}`}>
              <option value="">every level</option>
              {LOG_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level === "debug" ? "debug and worse" : `${level}${level === "error" ? "" : " and worse"}`}
                </option>
              ))}
            </select>
          </label>
          {(["area", "chat", "turn", "job"] as const).map((name) => (
            <label key={`${name}-${filter[name] ?? ""}`} class="lre-field">
              <span class="label">{FIELD_WORDS[name]}</span>
              <input class="lre-input" name={name} defaultValue={filter[name] ?? ""} spellcheck={false} autoComplete="off" />
            </label>
          ))}
        </div>
        <div class="lre-inline">
          <button type="submit" class="lre-btn small">
            Show
          </button>
        </div>
      </form>
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The log could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {log === null ? (
        props.problem === null ? <p class="lre-muted rpe-line">Reading the log…</p> : null
      ) : log.lines.length === 0 ? (
        <p class="lre-muted rpe-line" data-log-empty>{narrowed ? "No line kept names that." : "RPE has kept no line."}</p>
      ) : (
        <>
          <p class="rpe-meta">
            {counted(log.lines.length, "line")}, the newest first; RPE keeps the last {log.kept}.
          </p>
          <ul class="rpe-plain lre-stack" data-log>
            {log.lines.map((line, i) => (
              <Line key={`${line.at}-${i}`} line={line} onTurn={props.onTurn} onFilter={props.onFilter} />
            ))}
          </ul>
        </>
      )}
      {moreLines(log, props.asked) ? (
        <Button busy={props.loading} onClick={props.onMore}>
          Older lines
        </Button>
      ) : null}
    </Section>
  );
}
