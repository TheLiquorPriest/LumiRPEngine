// The coverage table (src/cli/coverage.ts): the typecheck makes it name every request and op; this
// holds it to tools that exist, this client's own or LumiRPEngine's served ones, and to reasons that
// say something.

import { expect, test } from "bun:test";
import { SERVED_NAMES } from "../../src/backend/agents/tools/outside";
import type { CoverageRow } from "../../src/cli/coverage";
import { COVERAGE } from "../../src/cli/coverage";
import { findTool } from "../../src/cli/tools";

const isRow = (value: object): value is CoverageRow => "tools" in value || "excluded" in value;

/** Every row, named "type" or "type op". */
function rows(): [string, CoverageRow][] {
  return Object.entries(COVERAGE).flatMap(([type, row]: [string, object]): [string, CoverageRow][] => (isRow(row) ? [[type, row]] : Object.entries(row).flatMap(([op, r]: [string, object]): [string, CoverageRow][] => (isRow(r) ? [[`${type} ${op}`, r]] : []))));
}

test("every tool the coverage table names exists, and every exclusion says why", () => {
  const all = rows();
  expect(all.length).toBeGreaterThan(40);
  for (const [request, row] of all) {
    if ("tools" in row) {
      expect([request, row.tools.length]).not.toEqual([request, 0]);
      for (const name of row.tools) expect([request, name, findTool(name) !== undefined || SERVED_NAMES.has(name)]).toEqual([request, name, true]);
    } else expect([request, row.excluded.length > 40]).toEqual([request, true]);
  }
});
