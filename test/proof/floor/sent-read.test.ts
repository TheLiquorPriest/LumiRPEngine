// What the model was sent, as the floor's table reads each RPE turn's reads (PlanGates-4-fix2 item 3): the
// chat's rows give the window, the hidden rows and the joined messages, so a failed read of them leaves
// the row not judged for that turn, by name; never a pass of a turn compared without them.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatRow, StoredMessage } from "../../../scripts/proof/lib/sent";
import { floorTable, type FloorRun } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";

interface Recorded {
  request: { messages: { role: string; text: string }[] };
  breakdown: { messages: StoredMessage[] };
  rows: ChatRow[];
  keep: number;
}

/** RPH's own blocks after the prompt, named as an RPH that names its blocks keeps them (`block`). */
const blockOf = (text: string): string | null => (text.startsWith("What this scene has carried so far") ? "carry" : text.startsWith("Turn facts:") ? "briefing" : null);

/** The recorded pair: what the window kept sent as it is, or with one of the three oldest messages the window left out sent all the same. */
function recordedPair(withLeftOut: boolean): { recorded: Recorded; messages: { role: string; text: string; block: string | null }[] } {
  const recorded = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "sent-window.json"), "utf8")) as Recorded;
  const left = recorded.breakdown.messages[5] as StoredMessage;
  const sent = withLeftOut ? [...recorded.request.messages.slice(0, 4), { role: left.role, text: left.content ?? "" }, ...recorded.request.messages.slice(4)] : recorded.request.messages;
  return { recorded, messages: sent.map((m) => ({ ...m, block: blockOf(m.text) })) };
}

/** Ten RPE turns of the recorded pair, the chat's rows read or not. */
function windowRun(rowsRead: boolean, withLeftOut = true): FloorRun {
  const { recorded, messages } = recordedPair(withLeftOut);
  const run = recordedRun({ form: "tag" });
  for (const t of run.turns) {
    if (t.rpe === null) continue;
    t.rpe.request = { messages, tools: null };
    t.rpe.stored = recorded.breakdown.messages;
    t.rpe.history = { keep: recorded.keep, step: null, hold: null, framing: null, framingNote: null, framingWhy: null };
    if (rowsRead) t.rpe.rows = recorded.rows;
    else {
      t.rpe.rows = null;
      t.rpe.missing = { rows: "the chat's rows could not be read: 500" };
    }
  }
  return run;
}

const sentRow = (run: FloorRun) => floorTable(run).find((r) => r.id === "sent");

describe("a failed read of the chat's rows", () => {
  test("with the rows, a message sent though the window left it out fails the row", () => {
    const row = sentRow(windowRun(true));
    expect(row?.verdict).toBe("fail");
    expect(row?.measured).toContain("0 of 10 RPE turns held every message");
  });

  test("without them the same turns are not judged, by name, and never pass: the window cannot be told", () => {
    const row = sentRow(windowRun(false));
    expect(row?.verdict).toBe("not judged");
    expect(row?.why).toEqual(["10 RPE turn(s): the chat's rows could not be read: 500"]);
    expect(row?.stands).toBe("0 of 10 RPE turn(s) compared");
  });

  test("one turn whose rows failed leaves the row not judged where the others pass", () => {
    // Every turn sent what the window kept, and one turn's rows could not be read.
    const run = windowRun(true, false);
    expect(sentRow(run)?.verdict).toBe("pass");
    const third = run.turns.find((t) => t.arm === "rpe" && t.pair === 3)?.rpe;
    if (third === undefined || third === null) throw new Error("no third RPE turn");
    third.rows = null;
    third.missing = { rows: "the chat's rows could not be read: 500" };
    const row = sentRow(run);
    expect(row?.verdict).toBe("not judged");
    expect(row?.why).toEqual(["1 RPE turn(s): the chat's rows could not be read: 500"]);
  });
});
