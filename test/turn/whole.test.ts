// A reply asked for whole (plan §4.2, READINGS N-1): nothing of it reaches Lumiverse before its end, and Lumiverse cuts a generation that
// sent nothing for ten minutes. So its turn is stopped where it stands at the whole-reply hold (`TaggedTurn.hold`, counted from the
// request's arrival) unless the chat's own limit on a turn's time ends it first: what the Author has written of the reply goes out as the
// whole reply, or, with none, the line from `reply-errors.md`, and the run records what ended it. Played through the stand-in Lumiverse
// on the scripted model, whose answer never ends; the turn is handed `whole` and its hold as the door hands them. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { gate } from "rp-harness/testing/rig";
import { CHAT, CONNECTION, openTurnBed, PRESET, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** A bed whose every reply is asked for whole with the given hold, as the door hands a request with streaming off to the turn. */
async function wholeBed(hold: number, options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  const play = b.turns.lane.play.bind(b.turns.lane);
  b.turns.lane.play = (turn, out, signal) => play({ ...turn, whole: true, hold }, out, signal);
  return b;
}

test("a whole request ends at the hold: what the Author has written of the reply goes out as the whole reply, and the run says the hold ended it", async () => {
  const never = gate();
  const b = await wholeBed(300, { answers: [{ pieces: [{ text: "<intent>One exchange.</intent>" }, { text: "<reply>The lamp turns. The sea is loud tonight. " }, { hold: never }] }] });
  b.host.send(CHAT, "I climb the stairs.");
  const asked = Date.now();
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });

  expect(Date.now() - asked).toBeLessThan(3_000);
  expect(out.error).toBeNull();
  await b.until("the run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
  const run = b.turns.runs.byGeneration(USER, out.generationId!);
  expect(run).toMatchObject({ status: "stopped", stoppedBy: { hold: 300 } });
  expect(run?.reply).toStartWith("The lamp turns.");
  expect(out.reply?.content).toBe(run?.reply);
});

test("the chat's lower limit ends it first: a turn's time of one second under a longer hold, with nothing of the reply written, ends with the limit's line", async () => {
  const never = gate();
  const b = await wholeBed(30_000, { answers: [{ pieces: [{ text: "<intent>One exchange.</intent>" }, { hold: never }] }], global: "limits:\n  turn:\n    seconds: 1\n" });
  b.host.send(CHAT, "I climb the stairs.");
  const asked = Date.now();
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });

  expect(Date.now() - asked).toBeLessThan(10_000);
  expect(out.error).toStartWith("The turn reached your limit of ");
  await b.until("the run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
  const run = b.turns.runs.byGeneration(USER, out.generationId!);
  expect(run).toMatchObject({ status: "limit", stoppedBy: { limit: { limit: "time", per: "turn" } }, reply: "" });
});

test("a whole request its hold stops while its call is being made again, with nothing of the reply written, says so: the hold, the tries and what broke the last", async () => {
  const never = gate();
  // The first try meets a fault of the provider's server and is made again at once; the second never answers.
  const b = await wholeBed(2_000, { answers: [{ pieces: [], end: { error: "502: Bad gateway." } }, { pieces: [{ hold: never }] }], global: "calls:\n  retryWaitSeconds: 0\n" });
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });

  const said = 'No reply came within 2 seconds, your setting "Whole reply hold" for a reply asked for whole, so the turn was stopped there: the model\'s call had been made 2 times, and the last try that failed met a fault of the provider\'s server, and the model\'s provider had sent nothing yet for the call under way.';
  expect(out.error).toBe(said);
  await b.until("the run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
  const run = b.turns.runs.byGeneration(USER, out.generationId!);
  expect(run).toMatchObject({ status: "stopped", stoppedBy: { hold: 2_000 }, reply: "" });
  expect(b.logged.filter((l) => l.fields?.run === run?.id && l.level === "warn").map((l) => l.message)).toEqual([`A turn's run ended stopped where it stood: ${said}`]);
});
