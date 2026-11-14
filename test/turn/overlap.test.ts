// Requests that meet at intake (plan §10.1, §10.10 "Stop"): two requests for one chat are taken in one
// after the other, so the chat opens one session and one lead runs at a time; and a request Lumiverse
// stops listening to while it waits for the previous turn's run ends there, having begun nothing, the
// previous run going on. Played through the stand-in Lumiverse as the player would. Every name is invented.

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

/** The message a generation's reply goes into, as Lumiverse announced it when the generation started. */
function targetOf(b: TurnBed, generation: string): string {
  for (const { event, payload: p } of b.host.events) {
    if (event !== "GENERATION_STARTED" || typeof p !== "object" || p === null || !("generationId" in p) || p.generationId !== generation) continue;
    if ("targetMessageId" in p && typeof p.targetMessageId === "string") return p.targetMessageId;
  }
  throw new Error(`generation ${generation} was not announced with a message`);
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
  test("a second request for the chat while the first is still being taken in waits for it: its turn begins once the first one's run is over", async () => {
    const after = gate();
    const held = gate();
    /** The message the first request's reply goes into, once known: its run holds before its reply, any other replies at once. */
    let first = "";
    const routed: Answer = (request) =>
      first !== "" && JSON.stringify(request.messages).includes(first)
        ? { pieces: [{ text: "<intent>One exchange.</intent>" }, { hold: held }, { text: "<reply>Wren looks up.</reply>" }] }
        : { pieces: [{ text: "<intent>One exchange.</intent>" }, { text: "<reply>Wren looks away.</reply>" }] };
    const b = await bed({ answers: [...replyThenWork(after), routed, routed], global: "limits:\n  previousRun: 5\n" });
    await firstTurnAtWork(b);

    // The first request waits for the turn before's run; while it does, a second request for the chat comes, and is shown the wait.
    b.host.send(CHAT, "I ask about the boat.");
    const one = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    const oneId = await b.until("the first request to be shown the wait", () => waitingOne(b, []));
    first = targetOf(b, oneId);
    const two = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    const twoId = await b.until("the second request to be shown the wait", () => waitingOne(b, [oneId]));

    // The turn before's run ends: the first request's turn begins, its run holding before its reply. The second waits for that run.
    after.open();
    await b.until("the first request's run to be at work", () => b.turns.runs.byGeneration(USER, oneId));
    const next = await Promise.race([two.then(() => "answered"), b.until("the second request to wait for the first one's run", () => waits(b, twoId) >= 2 && "waiting")]);
    expect(next).toBe("waiting");
    held.open();
    expect((await Promise.all([one, two])).map((o) => o.error)).toEqual([null, null]);
    const runs = [await settledTurn(b, oneId), await settledTurn(b, twoId)].map((t) => b.turns.runs.record(USER, t.id)!);
    expect(runs[1]!.started!).toBeGreaterThanOrEqual(runs[0]!.ended!);
    expect(b.turns.store.user(USER).sessions(CHAT).filter((s) => s.closedBy === null)).toHaveLength(1);
  });

  test("a request Lumiverse stops while it waits for the previous turn's run ends there: no turn is begun, and the previous run goes on", async () => {
    const after = gate();
    const b = await bed({ answers: [...replyThenWork(after), replying("Wren looks up.")], global: "limits:\n  previousRun: 0.5\n" });
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
