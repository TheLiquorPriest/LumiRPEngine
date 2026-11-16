// The Turn page's sections: each a module of its own under `pages/turns/sections/`, listed by the order
// each declares, and what each shows of a turn's read.

import { describe, expect, test } from "bun:test";
import { sectionListSource, sectionModules } from "../../scripts/ui/pages";
import { TURN_SECTIONS } from "../../src/ui/pages/turns";

describe("the Turn page's sections", () => {
  test("a section file added appears in the list, and the list stands in the order the sections declare", () => {
    const source = sectionListSource([...sectionModules(), "lanes"]);
    expect(source).toContain('import { section as lanesSection } from "./lanes";');
    expect(source).toContain("lanesSection]");
    expect(TURN_SECTIONS.map((s) => s.order)).toEqual([...TURN_SECTIONS.map((s) => s.order)].sort((a, b) => a - b));
    expect(new Set(TURN_SECTIONS.map((s) => s.id)).size).toBe(TURN_SECTIONS.length);
  });
});
