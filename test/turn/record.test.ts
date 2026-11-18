// The Author's record of a turn as a file in the turn's folder (plan §8.1, §11): once a turn whose
// Author wrote its record is tied, the record is at the path the carried part names, so a chat that
// carries records gives it to every later turn of the session; a turn with no record leaves no file.
// Played through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** The turn's record file as the agents would read it: its text, or null when there is none. */
async function recordFile(b: TurnBed, turn: string): Promise<string | null> {
  const session = b.turns.runs.record(USER, turn)?.session;
  if (session === undefined) throw new Error(`no run kept for turn ${turn}`);
  const scope = { user: USER, chat: CHAT, session, turn };
  const places = await b.turns.files.places(scope);
  const read = await b.turns.files.read(scope, `${places.turn}output/record.md`);
  return read.status === "read" ? read.text : null;
}

test("a turn's record is written to its folder once it is tied, and carried by the next turns in the records mode; a turn with no record has no file", async () => {
  const b = await openTurnBed({
    off: ["rules/unsourced"],
    global: "sessions:\n  carry: records\n",
    answers: [
      {
        pieces: [
          { text: "<intent>Answer, then keep the record.</intent>" },
          { text: "<reply>The lamp turns.</reply>" },
          { call: "story_record", args: { operations: [{ op: "record", intent: "News of the boat.", decided: "RECORD-DECIDED The boat's fate stays unknown tonight.", next: "Let the storm arrive." }] } },
        ],
      },
      { pieces: [{ text: "Recorded." }] },
      replying("Wren checks the glass."),
      replying("The wind rises."),
    ],
  });
  beds.push(b);
  const play = async (said: string) => {
    b.host.send(CHAT, said);
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    expect(out.error).toBeNull();
    return await settledTurn(b, out.generationId!);
  };
  const first = await play("I ask whether the boat came.");
  const second = await play("I look at the barometer.");
  await play("I listen to the wind.");

  expect(await recordFile(b, first.id)).toContain("RECORD-DECIDED The boat's fate stays unknown tonight.");
  expect(await recordFile(b, second.id)).toBeNull();
  // The first turn's own request carried nothing; each later one carries its record.
  expect(JSON.stringify(b.model.requests[0]!.messages)).not.toContain("RECORD-DECIDED");
  expect(JSON.stringify(b.model.requests[2]!.messages)).toContain("RECORD-DECIDED");
  expect(JSON.stringify(b.model.requests[3]!.messages)).toContain("RECORD-DECIDED");
});
