// The operation reference (`docs/operations.md`) says what the engine's tools take now: it is what
// the registry and the tools' files make, and every everyday operation and every searchable tool is
// in it with a worked example.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildOperations, OPERATIONS_PATH } from "../../scripts/operations";
import { OPERATIONS } from "../../src/iface/apply";
import { SEARCHABLE_TOOLS } from "../../src/iface/searchable";

test("the operation reference is current, with every operation and searchable tool and a worked example of each", async () => {
  const built = await buildOperations();
  expect(readFileSync(OPERATIONS_PATH, "utf8")).toBe(built);
  const headings = new Set(built.split("\n").filter((l) => /^#{3,4} /.test(l)).map((l) => l.replace(/^#+ /, "")));
  expect([...OPERATIONS.map((o) => o.name), ...SEARCHABLE_TOOLS.map((t) => t.name)].filter((name) => !headings.has(name))).toEqual([]);
  expect(built.split("\n").filter((l) => l === "Worked example:").length).toBe(OPERATIONS.length + SEARCHABLE_TOOLS.length);
});
