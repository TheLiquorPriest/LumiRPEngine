// The shipped character definition names its tools and the views it is given by name. Each must be
// there under exactly that name: a tool the cast offers with its file, or one of RPH's own; a view
// of `cast:self(…)` the cast lays out with its shipped part.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_TOOL_NAMES } from "rp-harness/testing/kit";
import { CAST_VIEWS } from "../../src/cast/views";
import { SHIPPED_GUIDANCE, splitFile } from "../../src/iface/texts";
import { openBench, shippedLayouts } from "./rig";

const DEFINITION = splitFile(readFileSync(join(SHIPPED_GUIDANCE, ".agents", "character.md"), "utf8"), "character.md").header;

describe("the shipped character definition", () => {
  test("every tool it names is offered: the cast's with its file, or RPH's own", async () => {
    const named = DEFINITION.tools as string[];
    const b = await openBench();
    expect(named.filter((name) => !b.tools.has(name) && !BASE_TOOL_NAMES.includes(name))).toEqual([]);
    // The character's own writes are the cast's, not RPH's.
    expect(["mind_set", "relate"].filter((name) => !b.tools.has(name))).toEqual([]);
  });

  test("every view its `cast:self(…)` names is the cast's, with its shipped layout", async () => {
    const self = (DEFINITION.given as string[]).map((g) => /^cast:self\((.*)\)$/.exec(g)?.[1]).find((inner) => inner !== undefined);
    const named = (self ?? "").split(",").map((name) => name.trim());
    expect(named).toContain("imported");
    expect(named.filter((name) => !Object.hasOwn(CAST_VIEWS, name))).toEqual([]);
    const { layouts, dispose } = await shippedLayouts();
    dispose();
    expect(named.filter((name) => layouts[name as keyof typeof CAST_VIEWS] === undefined)).toEqual([]);
  });
});
