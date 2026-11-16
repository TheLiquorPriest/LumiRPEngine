// The operation reference (`docs/operations.md`) says what the engine's tools take now: it is what
// the registry and the tools' files make, and every everyday operation and every searchable tool is
// in it with a worked example.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildOperations, OPERATIONS_PATH } from "../../scripts/operations";
import { OPERATIONS } from "../../src/iface/apply";
import { ENGINE_TOOLS } from "../../src/iface/tools";

test("the operation reference is current, with every operation and engine tool and a worked example of each", async () => {
  const built = await buildOperations();
  expect(readFileSync(OPERATIONS_PATH, "utf8")).toBe(built);
  const headings = new Set(built.split("\n").filter((l) => /^#{3,4} /.test(l)).map((l) => l.replace(/^#+ /, "")));
  // `world_apply` is the thirteen operations; every other engine tool, fixed, searchable or map, has its own entry.
  const tools = ENGINE_TOOLS.filter((t) => t.name !== "world_apply");
  expect([...OPERATIONS.map((o) => o.name), ...tools.map((t) => t.name)].filter((name) => !headings.has(name))).toEqual([]);
  expect(built.split("\n").filter((l) => l === "Worked example:").length).toBe(OPERATIONS.length + tools.length);
  // Each domain skill's section says what it names.
  for (const skill of ["economy", "items-and-wardrobe", "vehicles", "ruleset-and-sheets", "combat", "places-and-maps", "quests", "time", "groups"]) expect(headings.has(skill)).toBe(true);
});
