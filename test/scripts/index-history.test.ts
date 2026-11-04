// The stock index's history converter (scripts/tables/index-history.ts): each month's last close of
// the C Fund column, in month order, whatever order the download lists its days in; and the data
// file it wrote is what it writes for the pinned download, its provenance included.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../../scripts/tables/build";
import { historyFile, monthEndCloses, RETRIEVED, SOURCE_SHA256, SOURCE_URL } from "../../scripts/tables/index-history";

const CSV = [
  "Date,L Income,G Fund,C Fund,S Fund",
  "2008-11-03,,12.70,11.2001,13.0",
  "2008-10-31,,12.67,11.1223,13.12",
  "2008-10-30,,12.66,10.9999,13.0",
  "2008-09-30,,12.60,13.3723,15.1",
  "2008-09-29,,12.59,12.9000,14.9",
  ",,,,",
  "",
].join("\n");

describe("the stock index's history from the TSP download", () => {
  test("each month's last close of the C Fund, oldest first, newest-first rows and blank lines aside", () => {
    expect(monthEndCloses(CSV)).toEqual([
      { id: "2008-09", date: "2008-09-30", level: 13.3723 },
      { id: "2008-10", date: "2008-10-31", level: 11.1223 },
      { id: "2008-11", date: "2008-11-03", level: 11.2001 },
    ]);
    expect(() => monthEndCloses("Date,G Fund\n2008-10-31,12.67")).toThrow("C Fund");
  });

  test("the data file is the converter's own output, citing the pinned download", () => {
    const committed = readFileSync(join(DATA_DIR, "us", "index-history.json"), "utf8");
    const doc = JSON.parse(committed) as { months: { id: string; date: string; level: number }[]; basis: Record<string, string>; approximate: boolean };
    expect(committed).toBe(historyFile(doc.months));
    expect(doc.approximate).toBe(false);
    expect(doc.basis).toMatchObject({ url: SOURCE_URL, retrieved: RETRIEVED, sha256: SOURCE_SHA256 });
  });
});
