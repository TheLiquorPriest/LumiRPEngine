// The fence (PlanSwap-4 item 2): nothing that stays imports a file whose fate is "removed", by value
// or by type, but the imports listed as not yet moved; LumiAH is reached through none of what stays;
// and the list only shrinks. Each planted file below is read as if it stood in today's tree.

import { describe, expect, test } from "bun:test";
import { readFates, ROOT } from "./fates";
import { edgesOf, fence, lumiah, readList, stale } from "./fence";

/** How many imports the list held when PlanSwap-4 made it (15 Nov). It may only fall. */
const STARTED_WITH = 195;

describe("the fence around today's engines", () => {
  const fates = readFates();
  const { entries, problems } = readList();
  const edges = edgesOf();
  const planted = (files: Record<string, string>) => edgesOf(ROOT, new Map(Object.entries(files)));

  test("the list reads cleanly", () => {
    expect(problems).toEqual([]);
  });

  test("nothing that stays imports a removed file but the imports listed", () => {
    expect(fence(edges, fates, entries)).toEqual([]);
  });

  test("LumiAH is reached by nothing that stays but through the imports listed", () => {
    expect(lumiah(edges, fates, entries)).toEqual([]);
  });

  test("every listed import still stands, so the list shrinks with the code", () => {
    expect(stale(edges, fates, entries)).toEqual([]);
    const gone = { from: "src/play/view.ts", to: "src/backend/runtime.ts", line: 0 };
    expect(stale(edges, fates, [...entries, gone])).toEqual(["not-yet-moved.tsv:0: src/play/view.ts → src/backend/runtime.ts no longer stands; take the line out"]);
  });

  test("the list only shrinks", () => {
    expect(entries.length).toBeLessThanOrEqual(STARTED_WITH);
  });

  test("a planted import of src/backend/runtime.ts from src/play/ fails, by value or by type", () => {
    const value = fence(planted({ "src/play/planted.ts": 'import { readRun } from "../backend/runtime";' }), fates, entries);
    expect(value).toHaveLength(1);
    expect(value[0]).toStartWith("src/play/planted.ts imports src/backend/runtime.ts, which PlanSwap-8 removes");
    expect(value[0]).toContain("readRun (runtime.ts:270-274) → src/migrate/today/ (PlanSwap-5)");
    const types = fence(planted({ "src/turn/planted.ts": 'import type { ChatRun } from "../backend/runtime";' }), fates, entries);
    expect(types).toEqual([expect.stringContaining("src/turn/planted.ts imports src/backend/runtime.ts (types)")]);
  });

  test("a kept file and a kept test are fenced too, not only the new zones", () => {
    const found = fence(planted({ "src/engine/planted.ts": 'export { agentMetaOf } from "../backend/chat-agent-meta";', "test/engine/planted.test.ts": 'import { readRun } from "../../src/backend/runtime";' }), fates, entries);
    expect(found).toEqual([expect.stringContaining("src/engine/planted.ts imports src/backend/chat-agent-meta.ts"), expect.stringContaining("test/engine/planted.test.ts imports src/backend/runtime.ts")]);
  });

  test("LumiAH reached through a kept file fails, with the chain that reaches it", () => {
    const found = lumiah(planted({ "src/shared/planted-link.ts": 'import { runtimeBase } from "lumi-ah/link";', "src/play/planted.ts": 'import { base } from "../shared/planted-link";' }), fates, entries);
    expect(found).toEqual(["src/shared/planted-link.ts imports lumi-ah/link, and LumiAH is no dependency of what stays; the application reaches it: src/play/planted.ts → src/shared/planted-link.ts → lumi-ah/link"]);
  });

  test("a file that goes may go on importing what goes with it", () => {
    expect(fence(planted({ "src/backend/main.ts": 'import { readRun } from "./runtime";\nimport { Dispatch } from "./dispatch";' }), fates, entries)).toEqual([]);
  });

  test("a file that moves in part may still be imported until its parts have moved", () => {
    // Build's and the panels' call files take the kept UI's request types from the old protocol until PlanSwap-13 moves them.
    expect(fence(planted({ "src/ui/kept/calls/planted.ts": 'import type { ResultBodies } from "../../../shared/protocol";' }), fates, entries)).toEqual([]);
  });
});
