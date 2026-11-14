// The facts `turn.owes.record` and `turn.owes.reply` (plan §5.4 "Facts"): what a run that owes the player a
// reply still owes at the end of the Author's run, which the shipped rules `turn-unrecorded` and
// `reply-missing` name. A turn that recorded nothing is given the first rule's text and one more call; one
// that called `story_record` or `world_apply` is not. A turn whose Author ends with no reply is given the
// second's, and writes its reply in the call after. Played through the composed application on the
// stand-in Lumiverse and the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { Answer } from "rp-harness/testing/rig";
import { CHAT, CONNECTION, openTurnBed, PRESET, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** The rule's own words, as shipped. */
const RULE = "This turn is about to end with nothing recorded";

const say = (text: string): Answer => ({ pieces: [{ text }] });

test("a turn that records nothing is given the rule's text and one more call at its end; one that called story_record or world_apply is not", async () => {
  const b = await openTurnBed({
    off: [],
    answers: [
      // Nothing recorded: the rule fires at the run's end, and the Author answers it.
      say("<intent>Only words.</intent><reply>The lamp turns.</reply>"),
      say("Nothing moved."),
      // A beat recorded with the reply.
      { pieces: [{ text: "<intent>Keep the record.</intent><reply>Wren lights the lamp.</reply>" }, { call: "story_record", args: { operations: [{ op: "beat", text: "Wren lit the lamp.", message: 1 }] } }] },
      say("Recorded."),
      // Time passed in the world.
      { pieces: [{ text: "<intent>Time passes.</intent>" }, { call: "world_apply", args: { operations: [{ op: "pass_time", minutes: 30, source: { from: "prose" } }] } }] },
      say("<reply>The tide turns.</reply>"),
    ],
  });
  beds.push(b);
  for (const said of ["I climb the stairs.", "I watch her work.", "I wait."]) {
    b.host.send(CHAT, said);
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    expect(out.error).toBeNull();
    const turn = await settledTurn(b, out.generationId!);
    await b.until("the turn's run to be over", () => b.turns.runs.record(USER, turn.id)?.ended !== null && b.turns.runs.ofChat(USER, CHAT).length === 0);
  }

  // Two calls each: the first turn's second is the rule's; the others' second follows their tool's answer.
  const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
  expect(sent).toHaveLength(6);
  expect(sent.map((text) => text.includes(RULE))).toEqual([false, true, false, false, false, false]);
});

test("a turn whose Author ends with no reply is given the rule's text and one more call, and its reply then reaches the chat", async () => {
  const b = await openTurnBed({ answers: [say("<intent>One exchange.</intent>The lamp is lit; now the reply."), say("<reply>The lamp turns.</reply>")] });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  const turn = await settledTurn(b, out.generationId!);

  const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
  expect(sent.map((text) => text.includes("You are about to end the turn and the player has no reply."))).toEqual([false, true]);
  expect(b.turns.runs.record(USER, turn.id)).toMatchObject({ status: "released", reply: "The lamp turns." });
});
