// What a turn's time brought due on the World page: each thing by the name a person knows it by, and each
// change of the turn that concerns it as a line of its own. Every chat, person and place here is invented.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { turnDue } from "../../src/play/due";
import { readPart } from "../../src/store";
import { GUIDANCE, makeBed, USER } from "./bed";

const SAID = { source: { from: "prose", message: "msg-said-1" } };

const part = readPart(readFileSync(join(GUIDANCE, ".prompts", "play-answers.md"), "utf8"));
const say = (line: string, fields: Record<string, unknown> = {}): string => part.lines.get(line)?.render(part.header, fields) ?? "";

describe("what a turn's time brought due", () => {
  test("each is shown by its name, whose it is and what, and each change is a line of its own", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const turn = await bed.turn(async (apply) => {
      await apply([{ op: "pass_time", minutes: 600, ...SAID }, { op: "move", who: "marcus_delgado", to: "alder_automotive", ...SAID }, { op: "move", who: "marcus_delgado", to: "bluebird_coffee", ...SAID }]);
    });
    const read = turnDue(bed.store, USER, turn.id, 50, say);
    expect(read.items.length).toBeGreaterThan(0);
    // No raw id of a routine block, no id of anyone or anywhere, in what is shown.
    for (const item of read.items) expect(`${item.label} ${item.words}`).not.toMatch(/_/);
    const marcus = read.items.find((item) => item.words.startsWith("Marcus Delgado is due at "));
    expect(marcus?.words).toBe("Marcus Delgado is due at Alder Automotive");
    expect(marcus?.label).toBe("Where");
    // Each change is a line of its own, in the GM view's words, and only the ones that concern him.
    expect(marcus?.changes).toHaveLength(2);
    expect(marcus?.changes.every((line) => line.startsWith("Marcus Delgado is now at ") && !line.includes(";"))).toBe(true);
    const danny = read.items.find((item) => item.words.startsWith("Danny Okafor is due at "));
    expect(danny?.changes).toEqual([]);
  });
});
