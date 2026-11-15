// The floor's own trials, found before the first pair (PlanGates-4-fix1 item 4; findings 3, 10): the
// runner's standing governs, and the floor adds its own reasons, guidance in a user layer, a shipped file
// switched off by an `off:` list, a shipped tree not the build's, a lead that is not the Author. With any
// of them every measured part, the conditions of the whole test with them, goes to the runner as not
// judged, "trial: " and the reason, never met or failed, and the table prints the trial first and no
// verdict; the two parts seen on screen claim only what their screens show (PlanGates-4-fix2 item 5).

import { describe, expect, test } from "bun:test";
import { floorTrials, sha256 } from "../../../scripts/proof/lib/record";
import { floorHead, floorTable, tableText } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";
import { factsOf, LEADS, partOf, playReplay, recordOf, SERVED } from "./replay";

const MEASURED = ["conditions", "first-words", "per-token", "calls", "sent", "lore", "intake", "tools", "stack", "after-reply"];
const OFF = "shipped guidance is switched off by an off: list: .prompts/reply-contract.md (off in chat)";

describe("the floor's own trials", () => {
  test("a run with the reply contract switched off by the chat's off: list gives no verdict in the runner's report or in the table", async () => {
    const played = await playReplay({ run: recordedRun({ form: "tag" }), ground: { observed: { plain: null, shipped: SERVED, layers: [], off: [{ path: ".prompts/reply-contract.md", offIn: ["chat"] }], leads: LEADS } } });
    for (const id of MEASURED) {
      const instances = partOf(played, id);
      expect(instances).toHaveLength(1);
      expect(instances[0]?.outcome).toBe("not judged");
      expect(instances[0]?.why.startsWith(`trial: ${OFF}`)).toBe(true);
    }
    // No part goes to the runner as met. The floor's sentence is a part judged by code, and it is not judged; the two parts seen on screen claim only what their screens show.
    const passed = played.report.split("\n").filter((line) => line.includes("Passed"));
    expect(passed).toHaveLength(2);
    expect(passed[0]).toContain('"The chat page shows RPE\'s last reply, whole, as the chat\'s last message"');
    expect(passed[1]).toContain('"The Files page\'s stack view of the floor\'s chat shows the Author\'s parts in its opening block"');
    expect(played.report).not.toContain("where the Author writes. Plain generation against a simple turn: ten pairs, interleaved, each turn sent after the previous one has finished\" (code): Passed");
    expect(played.report).toContain("- Gate floor: not judged\n");
    expect(played.report.split("\n").filter((line) => line.includes(`trial: ${OFF}`))).toHaveLength(MEASURED.length);
    expect(played.table).toContain(`TRIAL: no verdict. ${OFF}.`);
    expect(played.table.indexOf("TRIAL")).toBeLessThan(played.table.indexOf("First words on screen"));
    expect(played.table).not.toMatch(/: (PASS|FAIL|REPORTED|NOT JUDGED)$/m);
  });

  test("guidance in a user layer, and a shipped tree not the build's, are the floor's trials too; none on the build's shipped guidance", () => {
    const run = recordOf(factsOf(recordedRun({ form: "tag" })));
    expect(floorTrials(run, { shipped: SERVED, layers: [], off: [], leads: LEADS }, null)).toEqual([]);
    expect(floorTrials(run, { shipped: SERVED, layers: [{ level: "chat", files: [{ path: "TURN.md", sha256: sha256("a turn of the user's own") }, { path: "RPE.yml", sha256: sha256("history:\n  window: 40\n") }] }], off: [], leads: LEADS }, null)).toEqual(["a layer of the user's own holds guidance: TURN.md"]);
    const changed = SERVED.map((f) => (f.path === "TURN.md" ? { ...f, sha256: sha256("changed on the server") } : f));
    expect(floorTrials(run, { shipped: changed, layers: [], off: [], leads: LEADS }, null)[0]).toMatch(/^the shipped tree RPE serves the floor's chat \([0-9a-f]{12}\) is not the build's \([0-9a-f]{12}, run\.json\)$/);
  });

  test("tableText over a trial prints trial and no verdict on any row", () => {
    const run = { ...recordedRun({ form: "tag" }), trials: [OFF] };
    const text = tableText(floorTable(run), floorHead(run), "trial", []);
    expect(text).toContain(`TRIAL: no verdict. ${OFF}.`);
    expect(text).toContain("First words on screen: no verdict (trial)");
    expect(text).not.toMatch(/: (PASS|FAIL|REPORTED|NOT JUDGED)$/m);
  });
});
