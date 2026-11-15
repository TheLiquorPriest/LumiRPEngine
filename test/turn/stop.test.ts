// The turn before, and Stop (plan §10.9, §10.10, Appendix D.1): a new turn waits for the previous turn's
// run, still at work after its reply, for as long as the user's setting gives it, and stops it then; and
// the Turn page's Stop stops a turn's run and tells Lumiverse to stop its generation. Played through the
// stand-in Lumiverse as the player would. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { type Answer, type Gate, gate } from "rp-harness/testing/rig";
import type { StopReply } from "../../src/shared/api";
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

/** The reply, then work after it that holds at `after` until it opens, or the run is stopped. */
function replyThenWork(after: Gate): Answer[] {
  return [
    { pieces: [{ text: "<intent>One exchange, then a note.</intent>" }, { text: "<reply>The lamp turns.</reply>" }, { call: "todo", args: { items: [{ text: "note the storm", done: false }] } }] },
    { pieces: [{ hold: after }, { text: "Noted." }] },
  ];
}

/** The first turn played and saved, its run still at work after its reply. */
async function firstTurnAtWork(b: TurnBed): Promise<string> {
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  const store = b.turns.store.user(USER);
  const turn = await b.until("the first turn to be tied while its run goes on", () => {
    const run = b.turns.runs.byGeneration(USER, out.generationId!);
    return run !== null && store.turn(run.turn)?.status === "done" && b.turns.runs.running(USER, run.turn) !== undefined ? run.turn : null;
  });
  // Its work after the reply waits on its own call, so the answer held for it is its own.
  await b.until("the work after the reply to call its model", () => b.model.requests.length >= 2);
  return turn;
}

const WAITING = "Finishing the last turn's work first.";

describe("the turn before", () => {
  test("a new message waits for the previous turn's run as long as the setting gives it, then stops it and goes on", async () => {
    const after = gate();
    const b = await bed({ answers: [...replyThenWork(after), replying("Wren looks up.")], global: "limits:\n  previousRun: 0.3\n" });
    const first = await firstTurnAtWork(b);

    b.host.send(CHAT, "I ask about the boat.");
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    expect(out.error).toBeNull();
    expect(out.reply?.content).toBe("Wren looks up.");
    // The player was shown why the reply waited.
    expect(out.reply?.reasoning).toContain(WAITING);
    expect(after.isOpen).toBe(false);
    expect(b.turns.runs.record(USER, first)?.status).toBe("stopped");
    const second = await settledTurn(b, out.generationId!);
    const timings = b.turns.runs.record(USER, second.id)!;
    expect(timings.started! - timings.received).toBeGreaterThanOrEqual(300);
  });

  test("a previous run that ends within its time is waited for and not stopped", async () => {
    const after = gate();
    const b = await bed({ answers: [...replyThenWork(after), replying("Wren looks up.")], global: "limits:\n  previousRun: 5\n" });
    const first = await firstTurnAtWork(b);

    b.host.send(CHAT, "I ask about the boat.");
    const generating = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    // The player is shown that the reply waits; the first run's work ends then, inside its time.
    await b.until("the player to be shown the wait", () => [...b.host.streams.values()].some((s) => s.reasoning.includes(WAITING)));
    expect(b.model.requests).toHaveLength(2);
    after.open();
    const out = await generating;
    expect(out.reply?.content).toBe("Wren looks up.");
    const ran = b.turns.runs.record(USER, first)!;
    expect(ran.status).toBe("released");
    const second = await settledTurn(b, out.generationId!);
    expect(b.turns.runs.record(USER, second.id)!.started).toBeGreaterThanOrEqual(ran.ended!);
  });
});

describe("Stop, from the Turn page", () => {
  test("stops the turn's run and tells Lumiverse, whose generation ends as stopped; the attempt that saved nothing is dropped", async () => {
    const hold = gate();
    const b = await bed({ answers: [{ pieces: [{ text: "<intent>One exchange.</intent>" }, { hold }, { text: "<reply>Too late.</reply>" }] }] });
    b.host.send(CHAT, "I climb the stairs.");
    const generating = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    const turn = await b.until("the turn's run to be at work", () => b.turns.runs.ofChat(USER, CHAT)[0]?.turn);

    const stopped = await b.page<StopReply>("POST", `/api/v1/chats/${CHAT}/turns/${turn}/stop`);
    expect(stopped).toEqual({ status: 200, body: { stopped: true } });
    const out = await generating;
    expect(out.stopped).toBe(true);
    expect(out.reply?.content).toBe("");
    expect(b.host.events.filter((e) => e.event === "GENERATION_STOPPED").map((e) => e.payload)).toEqual([{ generationId: out.generationId, chatId: CHAT, content: "" }]);
    expect(hold.isOpen).toBe(false);

    const dropped = await settledTurn(b, out.generationId!);
    expect(dropped).toMatchObject({ id: turn, status: "dropped", message: null });
    expect(b.turns.runs.record(USER, turn)?.status).toBe("stopped");
    expect(b.turns.store.user(USER).path(CHAT).every((e) => e.turn === null)).toBe(true);
    // A turn no longer going is not stopped again.
    expect((await b.page<StopReply>("POST", `/api/v1/chats/${CHAT}/turns/${turn}/stop`)).body).toEqual({ stopped: false });
  });
});
