// What the lead gets when shipped rules fire at the end of a run whose message was the reply and nothing else (plan §5.4, the moment
// "at a run's end: the text is added and the agent gets another call"; §10.7): every rule due is said together, in one more call; a
// call that acts goes on as any work does, and a call that only writes ends the run, each rule having fired once in the turn. The
// walk's turn in another language is played as it was recorded: the intent record's tag translated (no intent is taken), and with the
// reply's tag translated too, nothing going out until the call after the run-end rules. Among them `intent-owed-end`, the twin at a
// run's end of `intent-owed`: it asks for the record before the reply where none went out, and for the record alone where one did;
// whichever of the two is said first in a run, the other keeps quiet. Played through the stand-in Lumiverse on the scripted model.
// Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { Answer } from "rp-harness/testing/rig";
import { CastRecord, chatLine, findCharacter } from "../../src/cast";
import { castAt } from "../../src/cast/path";
import { toldRows } from "../../src/turn/events";
import { CHAT, CONNECTION, openTurnBed, PRESET, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

const WREN = "Wren Hale";
const OWED = "These characters were on stage this turn and have no perception recorded for it: Wren Hale.";
const UNTAKEN = "were on stage this turn and hold perceptions their own agent has not taken in: Wren Hale.";
const NO_REPLY = "This turn is about to end, and the player has no reply";
/** `intent-owed-end`'s words before the reply went out, and after; `intent-owed`'s. */
const TWIN_BEFORE = "Write the record now, the way the reply contract says an intent record is written, then the reply.";
const TWIN_AFTER = "Your reply has gone out, and you wrote no intent record for this turn.";
const AFTER_MESSAGE = "Write it now, the way the reply contract says an intent record is written, before you go on.";
/** Which of the rules' words each request holds, in that order. */
const WORDS = [OWED, UNTAKEN, NO_REPLY, TWIN_BEFORE, TWIN_AFTER, AFTER_MESSAGE];

const calling = (call: string, args: JsonObject, intent?: string): Answer => ({ pieces: [...(intent !== undefined ? [{ text: `<intent>${intent}</intent>` }] : []), { call, args }] });
const say = (text: string): Answer => ({ pieces: [{ text }] });
const perceiving = (content: string): Answer => calling("perceive", { perceptions: [{ who: WREN, reach: "whole", content }] });

/** The first turn: Wren cast a principal, on stage in the open scene, voiced in the reply and given her perception; the run ends with it not taken in. */
const FIRST: Answer[] = [
  calling("cast_update", { operations: [{ op: "cast", who: WREN, as: "principal", line: "The keeper of the light." }] }, "Wren answers; I voice her."),
  calling("story_record", { operations: [{ op: "scene", new: true, title: "Night watch", place: "the lamp room", who: [WREN] }] }),
  { pieces: [{ text: '<reply>Wren looks past you at the sea. "The boat is late."</reply>' }, { call: "perceive", args: { perceptions: [{ who: WREN, reach: "whole", content: "A stranger asked whether the boat came." }] } }] },
  say("Nothing more."),
  say("It waits."),
];

async function play(b: TurnBed, said: string): Promise<string> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

const fired = (b: TurnBed, turn: string): string[] => toldRows(b.app.db, USER, "rule", { turn }).map((r) => r.body.rule).sort();
/** The model's requests from the `from`th on, each as one text. */
const sentFrom = (b: TurnBed, from: number): string[] => b.model.requests.slice(from).map((r) => JSON.stringify(r.messages));
/** Wren's perceptions of `turn`. */
function perceivedIn(b: TurnBed, turn: string): number {
  const u = b.turns.store.user(USER);
  const wren = findCharacter(b.turns.store.db, USER, chatLine(u, CHAT), WREN)!;
  return CastRecord.read(b.turns.store, USER, castAt(u, CHAT, turn))
    .of(wren.id, "perception")
    .filter((p) => p.opened === turn).length;
}

test("rules due at the end of a reply-only run are said together in one more call: a call that acts goes on, one that only writes ends the run; the intent record is asked for once a run", async () => {
  const b = await openTurnBed({
    // Only the moment of a run's end is this test's: the reminders at a turn's start, and one of story hours, are off.
    off: ["rules/unsourced", "rules/memory-late", "rules/memory-scene-end", "rules/perceptions-missing", "rules/dream-due"],
    answers: [
      ...FIRST,
      // The walk's turn with only the intent record's tag translated: the reply goes out in the first call, which makes no other.
      say("<意图>她回答。</意图><reply>门第二次咔哒一声关上。</reply>"),
      // The rules' text, in one more call: it acts on them, the run goes on, and ends when a call only writes.
      perceiving("The stranger came back and asked what she remembered."),
      say("Recorded."),
      // The walk's turn as its record has it: both tags translated, so nothing goes out until the call after the rules.
      say("<意图>她回答。</意图><回复>门第二次咔哒一声关上。</回复>"),
      // Told, it writes the record, then the reply, and makes no call.
      say("<intent>She answers what he asks; the stranger's question stays with her.</intent><reply>The door clicks shut a second time.</reply>"),
      // A turn whose first call acts with no record: `intent-owed` says it then, and the run's end says it no more.
      perceiving("The stranger asks once more."),
      say("<reply>Wren shakes her head.</reply>"),
      say("It waits."),
    ],
  });
  beds.push(b);
  const first = await play(b, "I ask whether the boat came.");
  expect(fired(b, first)).toEqual(["memory-owed"]);

  let from = b.model.requests.length;
  const second = await play(b, "I ask her what she remembers.");
  // The first call holds no rule's text; the second holds those due, the record asked for alone (the reply went out), and no
  // `reply-missing`; the third, after the call that acted, holds nothing more.
  expect(sentFrom(b, from).map((s) => WORDS.map((w) => s.includes(w)))).toEqual([
    [false, false, false, false, false, false],
    [true, true, false, false, true, false],
    [true, true, false, false, true, false],
  ]);
  expect(fired(b, second)).toEqual(["intent-owed-end", "memory-owed", "perceptions-owed"]);
  // The translated tag is no intent record; the reply is the turn's; what it did on the rules' text is recorded.
  expect(b.turns.store.user(USER).turn(second)?.intent).toBeNull();
  expect(b.turns.runs.record(USER, second)).toMatchObject({ status: "released", reply: "门第二次咔哒一声关上。" });
  expect(perceivedIn(b, second)).toBe(1);

  from = b.model.requests.length;
  const third = await play(b, "I ask her again.");
  // Two calls, as the walk's: the first wrote nothing that goes out; the second is told all four, the record asked for before the
  // reply, writes both and makes no call.
  expect(sentFrom(b, from).map((s) => WORDS.map((w) => s.includes(w)))).toEqual([
    [false, false, false, false, false, false],
    [true, true, true, true, false, false],
  ]);
  expect(fired(b, third)).toEqual(["intent-owed-end", "memory-owed", "perceptions-owed", "reply-missing"]);
  expect(b.turns.store.user(USER).turn(third)?.intent).toBe("She answers what he asks; the stranger's question stays with her.");
  expect(b.turns.runs.record(USER, third)).toMatchObject({ status: "released", reply: "The door clicks shut a second time." });
  // Each rule fired once in the turn: the perception it asked for is still owed when the run ends.
  expect(perceivedIn(b, third)).toBe(0);

  from = b.model.requests.length;
  const fourth = await play(b, "I wait for her answer.");
  // Said after the first call acted; at the run's end the twin keeps quiet, though no record was written.
  expect(sentFrom(b, from).map((s) => WORDS.map((w) => s.includes(w)))).toEqual([
    [false, false, false, false, false, false],
    [false, false, false, false, false, true],
    [false, true, false, false, false, true],
  ]);
  expect(fired(b, fourth)).toEqual(["intent-owed", "memory-owed"]);
  expect(b.turns.store.user(USER).turn(fourth)?.intent).toBeNull();
});
