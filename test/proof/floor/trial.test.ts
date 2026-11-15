// The floor's own trials, found before the first pair (PlanGates-4-fix1 item 4; findings 3, 10): the
// runner's standing governs, and the floor adds its own reasons, guidance in a user layer, a shipped file
// switched off by an `off:` list, a shipped tree not the build's. With any of them every measured part
// goes to the runner as not judged, "trial: " and the reason, never met or failed, and the table prints
// the trial first and no verdict.

import { describe, expect, test } from "bun:test";
import { floorTrials, sha256 } from "../../../scripts/proof/lib/record";
import { floorHead, floorTable, tableText } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";
import { factsOf, partOf, playReplay, recordOf, SERVED } from "./replay";

const MEASURED = ["first-words", "per-token", "calls", "sent", "lore", "intake", "tools", "stack", "after-reply"];
const OFF = "shipped guidance is switched off by an off: list: .prompts/reply-contract.md (off in chat)";

describe("the floor's own trials", () => {
  test("a run with the reply contract switched off by the chat's off: list gives no verdict in the runner's report or in the table", async () => {
    const played = await playReplay({ run: recordedRun({ form: "tag" }), ground: { observed: { plain: null, shipped: SERVED, layers: [], off: [{ path: ".prompts/reply-contract.md", offIn: ["chat"] }] } } });
    for (const id of MEASURED) {
      const instances = partOf(played, id);
      expect(instances).toHaveLength(1);
      expect(instances[0]?.outcome).toBe("not judged");
      expect(instances[0]?.why.startsWith(`trial: ${OFF}`)).toBe(true);
    }
    expect(played.report).toContain("- Gate floor: not judged\n");
    // Every measured part's line in the report is a trial not judged; only the parts seen on screen pass.
    expect(played.report.split("\n").filter((line) => line.includes(`: Not judged: trial: ${OFF}`))).toHaveLength(MEASURED.length);
    expect(played.table).toContain(`TRIAL: no verdict. ${OFF}.`);
    expect(played.table.indexOf("TRIAL")).toBeLessThan(played.table.indexOf("First words on screen"));
    expect(played.table).not.toMatch(/: (PASS|FAIL|REPORTED|NOT JUDGED)$/m);
  });

  test("guidance in a user layer, and a shipped tree not the build's, are the floor's trials too; none on the build's shipped guidance", () => {
    const run = recordOf(factsOf(recordedRun({ form: "tag" })));
    expect(floorTrials(run, { shipped: SERVED, layers: [], off: [] }, null)).toEqual([]);
    expect(floorTrials(run, { shipped: SERVED, layers: [{ level: "chat", files: [{ path: "TURN.md", sha256: sha256("a turn of the user's own") }, { path: "RPE.yml", sha256: sha256("history:\n  window: 40\n") }] }], off: [] }, null)).toEqual(["a layer of the user's own holds guidance: TURN.md"]);
    const changed = SERVED.map((f) => (f.path === "TURN.md" ? { ...f, sha256: sha256("changed on the server") } : f));
    expect(floorTrials(run, { shipped: changed, layers: [], off: [] }, null)[0]).toMatch(/^the shipped tree RPE serves the floor's chat \([0-9a-f]{12}\) is not the build's \([0-9a-f]{12}, run\.json\)$/);
  });

  test("tableText over a trial prints trial and no verdict on any row", () => {
    const run = { ...recordedRun({ form: "tag" }), trials: [OFF] };
    const text = tableText(floorTable(run), floorHead(run), true, []);
    expect(text).toContain(`TRIAL: no verdict. ${OFF}.`);
    expect(text).toContain("First words on screen: no verdict (trial)");
    expect(text).not.toMatch(/: (PASS|FAIL|REPORTED|NOT JUDGED)$/m);
  });
});
