import { describe, expect, test } from "bun:test";
import { compareReports, presenceOnly } from "../../../scripts/testbed/lib/instance/compare-core";

function run(ids: string, overrides: { [row: string]: unknown } = {}) {
  return {
    run: { build: "abc1234", lumiverse: "a70f4ed", ids: { owner: `owner-${ids}`, other: `other-${ids}` } },
    world: { revisions: 3, chatRevision: { classic: 2, harness: 1 }, ids: { worldId: `w_${ids}`, head: `rev-${ids}` } },
    rows: {
      journal: { via: "lre.state.get", found: 3, facts: { paused: true, held: 1 }, ids: [`chat-${ids}`] },
      minds: { via: "lah.ws.list", found: 4, facts: { principal: true }, played: { files: 4, cast: ["Dale", "Marcus"] }, ids: [`chat-${ids}`] },
      ...overrides,
    },
  };
}

describe("two runs from nothing compared item by item", () => {
  test("the same instance made twice is the same, ids aside", () => {
    expect(compareReports(run("one"), run("two"))).toEqual([]);
  });

  test("a fact the script made that differs is named with its path", () => {
    const second = run("two", { journal: { via: "lre.state.get", found: 3, facts: { paused: false, held: 1 }, ids: [] } });
    expect(compareReports(run("one"), second)).toEqual(["rows.journal.facts.paused: true in the first, false in the second"]);
  });

  test("what the model chose is compared only for being there", () => {
    const other = run("two", { minds: { via: "lah.ws.list", found: 6, facts: { principal: true }, played: { files: 6, cast: ["Dale"] }, ids: [] } });
    expect(compareReports(run("one"), other)).toEqual([]);
    const missing = run("two", { minds: { via: "lah.ws.list", found: 0, facts: { principal: true }, played: { files: 0, cast: [] }, ids: [] } });
    expect(compareReports(run("one"), missing)).toEqual([
      "rows.minds.found: 4 in the first, 0 in the second",
      "rows.minds.played.cast: there in the first, missing in the second",
      "rows.minds.played.files: there in the first, missing in the second",
    ]);
  });

  test("a count of what the script made must be equal", () => {
    const second = run("two", { journal: { via: "lre.state.get", found: 2, facts: { paused: true, held: 1 }, ids: [] } });
    expect(compareReports(run("one"), second)).toEqual(["rows.journal.found: 3 in the first, 2 in the second"]);
  });

  test("a row one run has and the other lacks is a difference", () => {
    const first = run("one");
    const { journal: _left, ...rest } = run("two").rows;
    const second = { ...run("two"), rows: rest };
    expect(compareReports(first, second)).toEqual(['rows.journal: {"via":"lre.state.get","found":3,"facts":{"paused":true,"held":1},"ids":["chat-one"]} in the first, nothing in the second']);
  });
});

describe("what the comparison says it compared for presence only", () => {
  test("names each field the model chose, and the counts beside them, and nothing the script made or any id", () => {
    expect(presenceOnly(run("one"), run("two"))).toEqual(["rows.minds.found (above zero)", "rows.minds.played.cast", "rows.minds.played.files"]);
  });
});
