// The stock index's history (DESIGN §27.2): a broad US stock index's total return at each month's
// last close (`economy.index_history`, the Thrift Savings Plan's C Fund), which the equity market
// follows where a world keeps the table and a Gregorian calendar. Its monthly log returns give the
// stock index recipe its drift and volatility (§27.1). Inside the history's months a month's return
// is the history's own; before and after them it is a seeded draw with the history's mean and
// spread, the world's own walk. Either way it is spread over the month's trading days by a seeded
// Brownian bridge, so the market's last close of a month stands to the one before as the month's
// return says, and every chat of the world sees the same market. A world without the history keeps
// the seeded market it had.

import type { IndexView } from "../../../shared/finance";
import { hashParts } from "../../../shared/hash";
import { isRecord } from "../../../shared/json";
import type { DataTable } from "../../../shared/tables";
import { calendarOf, clockAt, dateAt, dayIndexOf, slotIndexAt, slotOf, type Calendar } from "../../../engine/calendar";
import { objOf } from "../../../engine/pack-kit";
import { passMemo } from "../../../engine/read-pass";
import type { ReadContext } from "../../../engine/registry";
import { createRng } from "../../../engine/rng";
import { isBusinessDay } from "./flows";
import { gbmShock, MARKET_CLOSE, normal, TRADING_DAYS } from "./pricing";

/** The table of the stock index's month-end closes: a row a month (`YYYY-MM`), each with the close's date and level. */
export const INDEX_HISTORY_TABLE = "economy.index_history";

/** What a world reads off the history: its months and the market its monthly returns make. */
export interface IndexHistory {
  /** Its first and last months, `YYYY-MM`. */
  first: string;
  last: string;
  /** The mean and the standard deviation (a sample's) of its monthly log returns. */
  monthlyMean: number;
  monthlyVol: number;
  /** The yearly drift and volatility of the geometric Brownian motion they make, percent. */
  driftPct: number;
  volPct: number;
}

/** What a read of the history needs: the world (its calendar, id and tables). */
type HistoryBooks = Pick<ReadContext, "world" | "tables">;

// ---------------------------------------------------------------- months

/** A month as a number (`months` a year: 12 on the Gregorian calendar), so months step and compare as numbers. */
export function monthNumber(year: number, month: number, months = 12): number {
  return year * months + month - 1;
}

/** A month number as the month it is, `YYYY-MM`. */
export function monthText(n: number, months = 12): string {
  const year = Math.floor(n / months);
  return `${year < 0 ? "-" : ""}${String(Math.abs(year)).padStart(4, "0")}-${String(n - year * months + 1).padStart(2, "0")}`;
}

/** A `YYYY-MM` as its month number; null when it isn't a month the calendar has. */
export function monthOfText(text: string, months = 12): number | null {
  const m = /^(-?\d{4,})-(\d{2})$/.exec(text);
  const month = Number(m?.[2]);
  return m && month >= 1 && month <= months ? monthNumber(Number(m[1]), month, months) : null;
}

// ---------------------------------------------------------------- the history

/** The history as read from its table: its closes month by month, and what they make. */
interface Series {
  revision: string;
  /** The month numbers of its first and last closes; `levels[i]` is month `first + i`'s. */
  first: number;
  last: number;
  levels: number[];
  calibration: IndexHistory;
  source: string;
}

/** Each table's series as read (null: not a history the market can follow), kept by the table's identity while its revision holds. */
const SERIES = new WeakMap<DataTable, { revision: string; series: Series | null }>();

/**
 * The series a table holds: a close for every month from its first to its last, each above
 * nothing, at least three of them (two returns make a spread). Anything else (a world's copy with a
 * month taken out) is no history, and the market keeps its seeded draws.
 */
function readSeries(table: DataTable): Series | null {
  const entries = isRecord(table.rows) ? Object.entries(table.rows) : [];
  const rows = entries.flatMap(([key, row]) => {
    const n = monthOfText(key);
    const level = objOf(row).level;
    return n !== null && typeof level === "number" && Number.isFinite(level) && level > 0 ? [{ n, level }] : [];
  });
  if (rows.length < 3 || rows.length !== entries.length) return null;
  rows.sort((a, b) => a.n - b.n);
  const first = rows[0]?.n ?? 0;
  if (rows.some((r, i) => r.n !== first + i)) return null;
  const levels = rows.map((r) => r.level);
  const logs = levels.slice(1).map((level, i) => Math.log(level / (levels[i] ?? level)));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / (logs.length - 1));
  const last = first + levels.length - 1;
  const basis = table.source?.basis;
  return {
    revision: table.revision,
    first,
    last,
    levels,
    // A geometric Brownian motion's monthly log returns have mean (μ − σ²/2)/12 and variance σ²/12.
    calibration: { first: monthText(first), last: monthText(last), monthlyMean: mean, monthlyVol: sd, driftPct: (12 * mean + (12 * sd * sd) / 2) * 100, volPct: sd * Math.sqrt(12) * 100 },
    source: (typeof basis === "object" ? basis.source : undefined) ?? table.label,
  };
}

/** The world's history: its table on a Gregorian calendar, read once per table revision. */
function seriesFor(ctx: HistoryBooks): Series | null {
  if (ctx.world.calendar.system !== "gregorian") return null;
  const table = ctx.tables.get(INDEX_HISTORY_TABLE);
  if (!table) return null;
  const known = SERIES.get(table);
  if (known && known.revision === table.revision) return known.series;
  const series = readSeries(table);
  SERIES.set(table, { revision: table.revision, series });
  return series;
}

/** The stock index's history as the world keeps it; null unless it keeps the table and a Gregorian calendar. */
export function indexHistory(ctx: HistoryBooks): IndexHistory | null {
  return seriesFor(ctx)?.calibration ?? null;
}

/** Whether a month's return is the history's own: a month after its first and up to its last. */
function inside(s: Series, n: number): boolean {
  return n > s.first && n <= s.last;
}

/**
 * The index's log return over a month: the history's own inside its months; else a draw with its
 * monthly mean and spread, seeded by the history's revision, the world and the month.
 */
function monthReturn(s: Series, world: string, n: number): number {
  if (inside(s, n)) return Math.log((s.levels[n - s.first] ?? 1) / (s.levels[n - 1 - s.first] ?? 1));
  return s.calibration.monthlyMean + s.calibration.monthlyVol * normal(createRng(hashParts("lre-index-walk-v1", s.revision, world, monthText(n))));
}

/** The stock index's log return over a month (`YYYY-MM`): the history's, else the world's walk; null without the history. */
export function indexMonthReturn(ctx: HistoryBooks, month: string): number | null {
  const s = seriesFor(ctx);
  const n = monthOfText(month);
  return s && n !== null ? monthReturn(s, ctx.world.id, n) : null;
}

/** Each world's walked month-end levels, by month number, kept as they are reached. */
const WALKS = new WeakMap<Series, Map<string, Map<number, number>>>();

/**
 * The index's level at a month's last close: the history's own inside its months, else walked out
 * from its nearest end month by month (forward by each month's return, back by undoing it), each
 * month kept on the way, so a level is the same whichever month was asked for first.
 */
function monthEndLevel(s: Series, world: string, n: number): number {
  if (n >= s.first && n <= s.last) return s.levels[n - s.first] ?? 1;
  let byWorld = WALKS.get(s);
  if (!byWorld) {
    byWorld = new Map();
    WALKS.set(s, byWorld);
  }
  let walked = byWorld.get(world);
  if (!walked) {
    walked = new Map();
    byWorld.set(world, walked);
  }
  const known = walked.get(n);
  if (known !== undefined) return known;
  const forward = n > s.last;
  const end = forward ? s.last : s.first;
  let from = n;
  while (from !== end && !walked.has(from)) from += forward ? -1 : 1;
  let level = from === end ? (s.levels[end - s.first] ?? 1) : (walked.get(from) ?? 1);
  while (from !== n) {
    if (forward) {
      from++;
      level *= Math.exp(monthReturn(s, world, from));
    } else {
      level /= Math.exp(monthReturn(s, world, from));
      from--;
    }
    walked.set(from, level);
  }
  return level;
}

/**
 * A month's trading days (the world's business days, DESIGN §25.5) and the index's log return on
 * each: the month's return spread by a Brownian bridge, `G/n + (σ/√n)(zᵢ − z̄)` with σ the history's
 * monthly spread, so they add up to the month's. Its draws are seeded by the month, and outside the
 * history's months by its revision and the world too.
 */
function bridgeOf(s: Series, world: string, cal: Calendar, n: number): { days: number[]; returns: number[] } {
  const year = Math.floor(n / 12);
  const month = n - year * 12 + 1;
  const start = dayIndexOf(cal, year, month, 1);
  const days: number[] = [];
  for (let d = start; d < start + cal.system.monthLength(year, month); d++) if (isBusinessDay(cal, d)) days.push(d);
  if (days.length === 0) return { days, returns: [] };
  const rng = createRng(inside(s, n) ? hashParts("lre-index-bridge-v1", monthText(n)) : hashParts("lre-index-bridge-v1", s.revision, world, monthText(n)));
  const z = days.map(() => normal(rng));
  const zMean = z.reduce((a, b) => a + b, 0) / z.length;
  const each = monthReturn(s, world, n) / days.length;
  const swing = s.calibration.monthlyVol / Math.sqrt(days.length);
  return { days, returns: z.map((x) => each + swing * (x - zMean)) };
}

/**
 * The equity market's shock on a day (DESIGN §27.2): the standard normal draw that makes a
 * geometric Brownian step at the history's drift and volatility move as far as the index did that
 * day, so a fund that is the market (moving with it wholly, paying nothing) closes each month where
 * the history does. A day the market is shut moves it nothing. Null where the world doesn't keep the
 * history: the market draws its own shock.
 */
export function equityShock(ctx: HistoryBooks, day: number): number | null {
  const s = seriesFor(ctx);
  if (!s) return null;
  const cal = calendarOf(ctx.world);
  const date = dateAt(cal, clockAt(cal, day, 0));
  const b = bridgeOf(s, ctx.world.id, cal, monthNumber(date.year, date.month));
  const r = b.returns[b.days.indexOf(day)];
  return r === undefined ? 0 : gbmShock(r, s.calibration.driftPct, s.calibration.volPct, 1 / TRADING_DAYS);
}

/**
 * The stock market as an investments view shows it (DESIGN §27.11): the index at the last thirteen
 * month-ends and now (last month's level carried by this month's closes the market has marked, each
 * as the slot holding it ends, as the day's marks are), and its change this month, this year and
 * over the twelve months to last month's end. Null without the history.
 */
export function indexView(ctx: Pick<ReadContext, "world" | "state" | "tables">): IndexView | null {
  const s = seriesFor(ctx);
  if (!s) return null;
  return passMemo([ctx.state, ctx.world], "economy.index", () => {
    const cal = calendarOf(ctx.world);
    const world = ctx.world.id;
    const now = dateAt(cal, ctx.state.clock);
    const n = monthNumber(now.year, now.month);
    const level = (m: number): number => monthEndLevel(s, world, m);
    const b = bridgeOf(s, world, cal, n);
    const closed = b.days.reduce((sum, d, i) => (slotOf(cal, slotIndexAt(cal, clockAt(cal, d, MARKET_CLOSE))).end <= ctx.state.clock ? sum + (b.returns[i] ?? 0) : sum), 0);
    const lastMonth = level(n - 1);
    const today = lastMonth * Math.exp(closed);
    const points: IndexView["points"] = [];
    for (let m = n - 13; m < n; m++) points.push({ at: monthText(m), level: level(m) });
    points.push({ at: `${monthText(n)}-${String(now.day).padStart(2, "0")}`, level: today });
    return {
      history: inside(s, n),
      from: s.calibration.first,
      to: s.calibration.last,
      source: s.source,
      points,
      month: (today / lastMonth - 1) * 100,
      year: (today / level(monthNumber(now.year, 1) - 1) - 1) * 100,
      twelve: (lastMonth / level(n - 13) - 1) * 100,
    };
  });
}
