// The shipped reminder `intent-owed` (plan §5.4): as the calls of the Author's message come back, while it has written no intent record
// for the turn and its reply has not gone out, it is told so with its next call, once in the turn, and the record it then writes is
// taken; a turn whose first message carries the record, and one whose reply is already out, are told nothing. The text counts the
// turns before that went without one (`turns.without.intent`). Played through the stand-in Lumiverse on the scripted model.

import { afterEach, expect, test } from "bun:test";
import type { Answer } from "rp-harness/testing/rig";
import { toldRows } from "../../src/turn/events";
import { CHAT, CONNECTION, openTurnBed, PRESET, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

const REMINDER = "You have not written an intent record for this turn";
const LOOK: Answer = { pieces: [{ call: "cast_query", args: {} }] };

async function play(b: TurnBed, said: string): Promise<string> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

const fired = (b: TurnBed, turn: string): string[] => toldRows(b.app.db, USER, "rule", { turn }).map((r) => r.body.rule);
/** The requests that hold the reminder, from the `from`th on. */
const reminded = (b: TurnBed, from = 0): string[] => b.model.requests.slice(from).flatMap((r) => (JSON.stringify(r.messages).includes(REMINDER) ? [JSON.stringify(r.messages)] : []));

test("the Author is told it has written no intent record before its reply, once, and only while its reply has not gone out", async () => {
  const b = await openTurnBed({
    answers: [
      // 1: the first message only calls; told, it writes the record and the reply.
      LOOK,
      { pieces: [{ text: "<intent>The bell is the player's question; I answer it.</intent><reply>The bell rings twice.</reply>" }] },
      // 2: the record heads the first message: nothing is said.
      { pieces: [{ text: "<intent>The player waits; the harbour answers.</intent>" }, { call: "cast_query", args: {} }] },
      { pieces: [{ text: "<reply>A gull answers from the harbour.</reply>" }] },
      // 3: the reply goes out in the first message with no record: too late to shape it, nothing is said.
      { pieces: [{ text: "<reply>The fog thickens.</reply>" }, { call: "cast_query", args: {} }] },
      { pieces: [{ text: "Nothing more." }] },
      // 4: the first message only calls again: told, with the one turn before that went without.
      LOOK,
      { pieces: [{ text: "<intent>The lamp is lit; I show it.</intent><reply>Someone lights the lamp.</reply>" }] },
    ],
  });
  beds.push(b);

  const first = await play(b, "I ring the bell.");
  expect(fired(b, first)).toEqual(["intent-owed"]);
  expect(reminded(b)).toHaveLength(1);
  const turn1 = b.turns.store.user(USER).turn(first);
  expect(turn1?.intent).toBe("The bell is the player's question; I answer it.");
  // Told with the call after the first message's, before the reply: the first request holds none of it.
  expect(JSON.stringify(b.model.requests[0]?.messages)).not.toContain(REMINDER);

  const seen = b.model.requests.length;
  const second = await play(b, "I wait.");
  expect(fired(b, second)).toEqual([]);
  const third = await play(b, "I look at the fog.");
  expect(fired(b, third)).toEqual([]);
  expect(reminded(b, seen)).toHaveLength(0);

  const fourth = await play(b, "I light the lamp.");
  expect(fired(b, fourth)).toEqual(["intent-owed"]);
  const [told] = reminded(b, seen);
  expect(told).toContain("The 1 turns before this one went without one too.");
});
