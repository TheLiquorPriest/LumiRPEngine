// Requests that meet at intake (plan §10.1, §10.10 "Stop"): Lumiverse runs one generation of a chat at a time, so a second request for a chat
// stops the first, which RPE was holding until the previous turn's run was over: the first ends there, having begun nothing, and the second's turn
// begins once that run is over; and a request the player stops while it waits ends there the same way, the previous run going on. Played through the
// stand-in Lumiverse as the player would. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { type Answer, type Gate, gate } from "rp-harness/testing/rig";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  return b;
}

/** The reply, then work after it that holds at `after` until it opens. */
function replyThenWork(after: Gate): Answer[] {
  return [
    { pieces: [{ text: "<intent>One exchange, then a note.</intent>" }, { text: "<reply>The lamp turns.</reply>" }, { call: "todo", args: { items: [{ text: "note the storm", done: false }] } }] },
    { pieces: [{ hold: after }, { text: "Noted." }] },
  ];
}

const WAITING = "Finishing the last turn's work first.";

/** How often the player of a generation was shown the wait so far. */
function waits(b: TurnBed, generation: string): number {
  return (b.host.streams.get(generation)?.reasoning ?? "").split(WAITING).length - 1;
}

/** The generation, other than those given, whose player was shown the wait. */
function waitingOne(b: TurnBed, others: readonly string[]): string | undefined {
  return [...b.host.streams.keys()].find((g) => !others.includes(g) && waits(b, g) > 0);
}

/** The first turn played and saved, its run still at work after its reply until `after` opens. */
async function firstTurnAtWork(b: TurnBed): Promise<string> {
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return await b.until("the first turn to be tied while its run goes on", () => {
    const run = b.turns.runs.byGeneration(USER, out.generationId!);
    return run !== null && b.turns.store.user(USER).turn(run.turn)?.status === "done" && b.turns.runs.running(USER, run.turn) !== undefined ? run.turn : null;
  });
}

describe("requests that meet at intake", () => {
  test("a second request for the chat stops the first in Lumiverse while RPE holds it: the first ends there with no turn begun, and the second's turn begins once the turn before's run is over", async () => {
    const after = gate();
    const b = await bed({ answers: [...replyThenWork(after), replying("Wren looks away.")], global: "limits:\n  previousRunSeconds: 5\n" });
    const before = await firstTurnAtWork(b);

    // The first request waits for the turn before's run, and the player is shown the wait. A second request for the chat comes, and Lumiverse stops the first before it takes the chat.
    b.host.send(CHAT, "I ask about the boat.");
    const one = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    const oneId = await b.until("the first request to be shown the wait", () => waitingOne(b, []));
    const two = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    expect((await one).stopped).toBe(true);
    const twoId = await b.until("the second request to be shown the wait", () => waitingOne(b, [oneId]));
    expect(b.turns.runs.byGeneration(USER, oneId)).toBeNull();

    // The turn before's run ends: the second request's turn begins, and no turn is ever begun for the first.
    after.open();
    expect((await two).error).toBeNull();
    const turn = await settledTurn(b, twoId);
    expect(b.turns.runs.byGeneration(USER, oneId)).toBeNull();
    expect(b.turns.runs.record(USER, turn.id)!.started!).toBeGreaterThanOrEqual(b.turns.runs.record(USER, before)!.ended!);
    expect(b.turns.store.user(USER).sessions(CHAT).filter((s) => s.closedBy === null)).toHaveLength(1);
    // The turn before's two answers, and the second request's one: the first never reached the model.
    expect(b.model.requests).toHaveLength(3);
  });

  test("a request Lumiverse stops while it waits for the previous turn's run ends there: no turn is begun, and the previous run goes on", async () => {
    const after = gate();
    const b = await bed({ answers: [...replyThenWork(after), replying("Wren looks up.")], global: "limits:\n  previousRunSeconds: 0.5\n" });
    const first = await firstTurnAtWork(b);

    b.host.send(CHAT, "I ask about the boat.");
    const generating = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    const waiting = await b.until("the player to be shown the wait", () => waitingOne(b, []));
    // The player's Stop in Lumiverse.
    expect(b.host.stop(USER, { generation: waiting })).toBe(true);
    expect((await generating).stopped).toBe(true);
    // The bed runs on the machine's clock, with Lumiverse's requests over the network: past the previous run's time (0.5 s), a request
    // still waiting would have stopped that run and begun its turn. Nothing else marks that it did not, so the test waits that long.
    await Bun.sleep(800);
    expect(b.turns.runs.byGeneration(USER, waiting)).toBeNull();
    expect(b.turns.runs.running(USER, first)).toBeDefined();

    after.open();
    await b.until("the previous run to end", () => b.turns.runs.running(USER, first) === undefined);
    expect(b.turns.runs.record(USER, first)?.status).toBe("released");
    expect(b.model.requests).toHaveLength(2);
  });
});
