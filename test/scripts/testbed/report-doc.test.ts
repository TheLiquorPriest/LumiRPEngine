import { describe, expect, test } from "bun:test";
import { canonical, checksum, failures, type ReportDoc } from "../../../scripts/testbed/lib/instance/report-doc";

function doc(): ReportDoc {
  return {
    run: { build: "1111111", branch: "main", lumiverse: "2222222", ids: { owner: "u-1", other: "u-2" } },
    world: { parts: { sections: 1, steps: 1 }, empty: [], unknown: [], revisions: 3, played: { classic: 2, harness: 1 }, draft: true, ids: { worldId: "w_1" } },
    rows: {
      journal: { today: "Each chat's ledger", made: "play", via: "lre.state.get", found: 4, facts: { paused: true }, ids: ["c-1"] },
      registration: { today: "RPE's own registration", made: "play", via: "disk: no read", found: 0, facts: null, absentBy: "only once the new extension has run" },
    },
  };
}

describe("the instance's read-back", () => {
  test("stands when every part holds something and every row read something back", () => {
    expect(failures(doc())).toEqual([]);
  });

  test("fails on a world part that holds nothing, and names it", () => {
    const d = doc();
    d.world.empty = ["suppressed"];
    expect(failures(d)).toEqual(['the world\'s part "suppressed" holds nothing']);
  });

  test("fails on a row with nothing read back, unless the row is empty by its own definition", () => {
    const d = doc();
    d.rows.journal = { ...d.rows.journal, found: 0 } as ReportDoc["rows"][string];
    expect(failures(d)).toEqual(['row "journal" (Each chat\'s ledger): nothing read back']);
  });

  test("fails on a read that failed, whatever it counted", () => {
    const d = doc();
    d.rows.journal = { ...d.rows.journal, error: "the event socket closed" } as ReportDoc["rows"][string];
    expect(failures(d)).toHaveLength(1);
  });

  test("fails on a chat whose revision the history does not hold", () => {
    const d = doc();
    d.world.played.branch = 0;
    expect(failures(d)).toEqual(['the chat "branch" plays a revision the world\'s history does not hold']);
  });

  test("the checksum is the same for the same instance read in another key order, and moves with any value", () => {
    const d = doc();
    const reordered = JSON.parse(JSON.stringify({ rows: d.rows, world: d.world, run: d.run })) as ReportDoc;
    expect(checksum(reordered)).toBe(checksum(d));
    expect(canonical(reordered)).toBe(canonical(d));
    const moved = doc();
    moved.world.played.classic = 3;
    expect(checksum(moved)).not.toBe(checksum(d));
  });
});
