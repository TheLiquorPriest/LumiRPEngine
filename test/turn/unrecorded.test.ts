// The shipped rule `reply-missing` (plan §5.4 "Facts", E.3): a turn whose Author ends with no reply is
// given the rule's text and one more call, and writes its reply in the call after. The rule tests RPH's
// own fact `reply.owed`, 1 while the request owes a reply and none has gone out (R-204). A turn that
// recorded nothing is asked nothing more: the shipped `turn-unrecorded` rule is an example now, and
// `TURN.md` is the one home of what is recorded after a reply. Played through the composed application
// on the stand-in Lumiverse and the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { Answer } from "rp-harness/testing/rig";
import { CHAT, CONNECTION, openTurnBed, PRESET, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

const say = (text: string): Answer => ({ pieces: [{ text }] });

test("a turn that records nothing is given no rule's text at its end, and the call count is the reply's alone", async () => {
  const b = await openTurnBed({ answers: [say("<intent>Only words.</intent><reply>The lamp turns.</reply>")] });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  const turn = await settledTurn(b, out.generationId!);
  await b.until("the turn's run to be over", () => b.turns.runs.record(USER, turn.id)?.ended !== null && b.turns.runs.ofChat(USER, CHAT).length === 0);
  expect(b.model.requests).toHaveLength(1);
  expect(b.turns.runs.record(USER, turn.id)).toMatchObject({ status: "released", reply: "The lamp turns." });
});

test("a turn whose Author ends with no reply is given the rule's text and one more call, and its reply then reaches the chat", async () => {
  const b = await openTurnBed({ answers: [say("<intent>One exchange.</intent>The lamp is lit; now the reply."), say("<reply>The lamp turns.</reply>")] });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  const turn = await settledTurn(b, out.generationId!);

  const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
  expect(sent.map((text) => text.includes("This turn is about to end, and the player has no reply. The reply is still owed"))).toEqual([false, true]);
  expect(b.turns.runs.record(USER, turn.id)).toMatchObject({ status: "released", reply: "The lamp turns." });
});
