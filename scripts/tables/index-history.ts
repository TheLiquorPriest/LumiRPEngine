// The stock index's history (`data-src/us/index-history.json`, DESIGN §27.2) from the Thrift
// Savings Plan's share price history: the C Fund's close on the last trading day of each month.
// The C Fund tracks the S&P 500 Index and never distributes, so its share price is the index's
// total return, net of the fund's small costs. TSP data is published by a U.S. federal agency
// (the Federal Retirement Thrift Investment Board), so it is in the public domain (17 U.S.C. §105).
//
//   curl -A 'Mozilla/5.0' -o fund-price-history.csv '<SOURCE_URL>'
//   bun scripts/tables/index-history.ts fund-price-history.csv
//
// Run once against the pinned download: it checks the file's SHA-256 against the pinned one, so the
// data file can be verified from the source at any time, and refuses any other file. Then
// `bun run tables` builds `economy.index_history` from the data file.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./build";

/** The pinned download: the query (its dates fixed, so the same bytes come back), when it was fetched, and its SHA-256. */
export const SOURCE_URL = "https://www.tsp.gov/data/fund-price-history.csv?startdate=2003-06-02&enddate=2026-10-31&Lfunds=0&InvFunds=1&download=1";
export const RETRIEVED = "2026-11-02";
export const SOURCE_SHA256 = "1e8e6671b10dbc046c51e2918cabcc7f4536d211a1f316a04ec7ef657da17423";
const COLUMN = "C Fund";
/** The last month the pinned download covers whole. */
const LAST_MONTH = "2026-10";

interface Close {
  id: string;
  date: string;
  level: number;
}

/** Each month's last close in the CSV (rows in any order), oldest first, through `LAST_MONTH`. */
export function monthEndCloses(csv: string): Close[] {
  const [head = "", ...rows] = csv.split(/\r?\n/);
  const column = head.split(",").indexOf(COLUMN);
  if (column < 0) throw new Error(`no "${COLUMN}" column`);
  const last = new Map<string, { date: string; level: number }>();
  for (const row of rows) {
    const cells = row.split(",");
    const date = cells[0] ?? "";
    const cell = cells[column] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || cell === "") continue;
    const level = Number(cell);
    if (!Number.isFinite(level) || level <= 0) throw new Error(`a price that isn't one on ${date}: ${cell}`);
    const month = date.slice(0, 7);
    if (month > LAST_MONTH) continue;
    const seen = last.get(month);
    if (!seen || seen.date < date) last.set(month, { date, level });
  }
  return [...last].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, c]) => ({ id, date: c.date, level: c.level }));
}

/** The data file's text: its header, its provenance and the closes. */
export function historyFile(closes: readonly Close[]): string {
  const first = closes[0]?.id ?? "";
  const doc = {
    schema: "lre-data-src/us/index-history/v1",
    table: "index_history",
    approximate: false,
    country: "US",
    currency: "USD",
    money_unit: "an index level: the fund's share price in dollars, read only as a ratio",
    reflects_period: `${first} to ${LAST_MONTH} (month-end closes)`,
    basis: {
      series: "The total return of a broad US stock index: the Thrift Savings Plan's C Fund, which tracks the S&P 500 Index and reinvests what it earns, net of its small costs.",
      source: "Thrift Savings Plan (Federal Retirement Thrift Investment Board), share price history, C Fund",
      page: "https://www.tsp.gov/share-price-history/",
      url: SOURCE_URL,
      retrieved: RETRIEVED,
      sha256: SOURCE_SHA256,
      license: "Public domain: published by a U.S. federal agency (17 U.S.C. §105); the figures are facts.",
      method: `Each month's close on its last trading day, as published (four decimals); ${first} is the fund's $10.0000 base of 31 May 2003, when daily share prices began. Converted by scripts/tables/index-history.ts.`,
    },
    fields: {
      "months[].id": "The month, YYYY-MM.",
      "months[].date": "The trading day of its last close, YYYY-MM-DD.",
      "months[].level": "The close: a total-return level, compared only with another month's.",
    },
    months: closes,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function main(): void {
  const path = process.argv[2];
  if (!path) throw new Error("give the downloaded CSV's path");
  const bytes = readFileSync(path);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== SOURCE_SHA256) throw new Error(`${path} isn't the pinned download (SHA-256 ${sha}, pinned ${SOURCE_SHA256})`);
  const closes = monthEndCloses(bytes.toString("utf8"));
  const out = join(DATA_DIR, "us", "index-history.json");
  writeFileSync(out, historyFile(closes));
  console.log(`${out}: ${closes.length} months, ${closes[0]?.id} to ${closes.at(-1)?.id}`);
}

if (import.meta.main) main();
