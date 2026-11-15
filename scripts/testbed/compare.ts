// Two read-backs of the test instance, each from a run made from nothing into fresh folders, compared
// item by item with ids set aside (`lib/instance/compare-core.ts` says how): PlanScenarios-4 item 1's
// test that the instance is made the same way each time.
//
//   bun compare.ts <first report.json> <second report.json>
//
// Prints every difference with its path and exits 1 when there is one; prints "the same" and exits 0
// when there is none.

import { readFileSync } from "node:fs";
import { compareReports } from "./lib/instance/compare-core";

const [first, second] = process.argv.slice(2);
if (first === undefined || second === undefined) {
  console.error("usage: bun compare.ts <first report.json> <second report.json>");
  process.exit(2);
}
const differences = compareReports(JSON.parse(readFileSync(first, "utf8")), JSON.parse(readFileSync(second, "utf8")));
for (const line of differences) console.log(line);
console.log(differences.length === 0 ? "the same, ids aside" : `${differences.length} difference(s)`);
process.exit(differences.length === 0 ? 0 : 1);
