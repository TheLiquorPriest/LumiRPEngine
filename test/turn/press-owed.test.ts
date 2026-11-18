// A press from a panel kept for the player's next message (plan §10.10 "A panel action", TURN.md "A request from a panel"): the turn
// told of it carries it out with `act`, or the world refuses it and says why. The shipped reminder `press-owed` says, by what was
// pressed, each such press that no `act` of its action reached the world for when the run is about to end; an `act` of it, carried out
// or refused, answers it, and the press is kept as answered. Played through the stand-in Lumiverse on the scripted model, on a starter
// world. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { Answer } from "rp-harness/testing/rig";
import { STARTER_WORLDS } from "../../src/packs/index";
import { TIMELAPSE_ACTION } from "../../src/play/state/palette";
import { toldRows } from "../../src/turn/events";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

const OWED = "The player pressed these from a panel for this turn, and no `act` of theirs has reached the world yet: Walk here.";

async function bed(answers: Answer[]): Promise<TurnBed> {
  const b = await openTurnBed({ answers });
  beds.push(b);
  await playsWorld(b, STARTER_WORLDS.fantasy_town("w-harbour", "Harbour"));
  return b;
}

async function play(b: TurnBed, said: string): Promise<string> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

/** A panel's press for the next message: the Timelapse, which the palette offers, by its label. */
async function press(b: TurnBed): Promise<string> {
  const held = await b.page<{ request: { id: string } }>("POST", `/api/v1/chats/${CHAT}/requests/panel`, { action: TIMELAPSE_ACTION, values: { label: "Walk here" }, from: "palette" });
  expect(held.status).toBe(200);
  return held.body.request.id;
}

/** The Author's `act` of the press's action, with its intent record first where one is given. */
const acting = (intent?: string): Answer => ({ pieces: [...(intent !== undefined ? [{ text: `<intent>${intent}</intent>` }] : []), { call: "world_apply", args: { operations: [{ op: "act", action: TIMELAPSE_ACTION, params: { label: "Walk here" }, source: "player" }] } }] });
const fired = (b: TurnBed, turn: string): string[] => toldRows(b.app.db, USER, "rule", { turn }).map((r) => r.body.rule);
const told = (b: TurnBed, from: number): boolean[] => b.model.requests.slice(from).map((r) => JSON.stringify(r.messages).includes(OWED));
const answered = (b: TurnBed, id: string): number | undefined => b.app.db.query<{ answered: number }, [string, string]>("SELECT answered FROM request WHERE user = ? AND id = ?").get(USER, id)?.answered;

test("a press the run ended without acting on is said by what was pressed, once; the act it then makes answers it", async () => {
  const b = await bed([replying("The square is quiet."), replying("You look about."), acting(), { pieces: [{ text: "Walked." }] }, replying("Evening comes.")]);
  await play(b, "I wait in the square.");
  const id = await press(b);
  let from = b.model.requests.length;
  const turn = await play(b, "I look about.");
  // The reply went out with no act: at the run's end the reminder is said, and the act that follows answers the press.
  expect(told(b, from)).toEqual([false, true, true]);
  expect(fired(b, turn)).toEqual(["press-owed"]);
  expect(answered(b, id)).toBe(1);
  // The next turn was told no press, and nothing is said.
  from = b.model.requests.length;
  const next = await play(b, "I wait.");
  expect(told(b, from)).toEqual([false]);
  expect(fired(b, next)).toEqual([]);
});

test("a press the turn acts on before its run ends is answered, and nothing is said", async () => {
  const b = await bed([replying("The square is quiet."), acting("The press is the player's move: walk."), replying("You walk across the square.")]);
  await play(b, "I wait in the square.");
  const id = await press(b);
  const from = b.model.requests.length;
  const turn = await play(b, "I go.");
  expect(told(b, from)).toEqual([false, false]);
  expect(fired(b, turn)).toEqual([]);
  expect(answered(b, id)).toBe(1);
});
