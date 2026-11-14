// The reminder of a missing intent record (plan §10.3, §17.2): a reply that went out with no intent record
// written before it is said at the next turn's start by a rule of its own, `intent-missing`, which counts
// on the fact `turn.last.without.intent` and needs TURN.md; with TURN.md switched off nothing is said.
// Played through the composed application on the stand-in Lumiverse and the scripted model. Every name
// is invented.

import { afterEach, expect, test } from "bun:test";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** The rule's own words, as shipped. */
const REMINDER = "Your last turn's reply went out with no intent record written before it.";

/** Three turns, the first replying with no intent record and the two after with one; what the Author was sent in each call, as text. */
async function threeTurns(off: string[]): Promise<string[]> {
  const b = await openTurnBed({ off, answers: [{ pieces: [{ text: "<reply>The lamp turns.</reply>" }] }, replying("Wren looks up."), replying("Wren nods.")] });
  beds.push(b);
  for (const said of ["I climb the stairs.", "I wave.", "I sit down."]) {
    b.host.send(CHAT, said);
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    expect(out.error).toBeNull();
    await settledTurn(b, out.generationId!);
  }
  return b.model.requests.map((r) => JSON.stringify(r.messages));
}

test("a reply that went out with no intent record before it is said at the next turn's start, and to no turn after", async () => {
  expect((await threeTurns(["rules/turn-unrecorded"])).map((sent) => sent.includes(REMINDER))).toEqual([false, true, false]);
});

test("with TURN.md switched off, a reply with no intent record before it is said to no turn", async () => {
  expect((await threeTurns(["rules/turn-unrecorded", "TURN"])).map((sent) => sent.includes(REMINDER))).toEqual([false, false, false]);
});
