// The story record, plugged into the turn (plan §8.1, §10.2): the Author writes it with `story_record`
// in a turn, and what it wrote reaches the next turn's briefing, as the story brief and, for the history
// the window leaves out, as the story so far; a swipe of the turn that wrote it takes it away. Played
// through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { Answer } from "rp-harness/testing/rig";
import { calendarOf, formatClock } from "../../src/engine/calendar";
import type { ChatMessage } from "../standin/lumiverse";
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

/** The player says something and asks for a reply of this kind; gives the generation's id. */
async function play(b: TurnBed, type: "normal" | "swipe", said?: string): Promise<string> {
  if (said !== undefined) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type });
  expect(out.error).toBeNull();
  return out.generationId!;
}

/** The briefing the Author was given in a model call, as sent: empty when the call held none. */
function briefingOf(b: TurnBed, call: number): string {
  return (b.model.requests[call]?.messages ?? []).map((m) => JSON.stringify(m)).find((text) => text.includes("# Briefing for this turn")) ?? "";
}

/** Seven messages before the player's next one, each marked by its place. */
const HISTORY: ChatMessage[] = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, role: i % 2 === 0 ? "assistant" : "user", content: `HIST-0${i} ${i % 2 === 0 ? "The sea is loud." : "I listen."}` }));

/** The Author replies, then records the turn: a hot thread, and a beat at message 1. Then its run ends. */
const RECORDING: Answer[] = [
  {
    pieces: [
      { text: "<intent>Answer, then keep the record.</intent>" },
      { text: "<reply>The lamp turns.</reply>" },
      {
        call: "story_record",
        args: {
          operations: [
            { op: "thread", text: "THREAD-STORM Will the supply boat beat the storm?", kind: "question", hot: true },
            { op: "beat", text: "BEAT-LAMP Wren lit the lamp before dusk.", message: 1 },
          ],
        },
      },
    ],
  },
  { pieces: [{ text: "Recorded." }] },
];

describe("the story record in the turn", () => {
  test("what the Author records in a turn is in the next turn's story brief, and its beats outside the window in the story so far", async () => {
    const b = await bed({ answers: [...RECORDING, replying("Wren checks the glass.")], messages: HISTORY, global: "history:\n  window: 3\n" });
    await settledTurn(b, await play(b, "normal", "I ask whether the boat came."));
    await settledTurn(b, await play(b, "normal", "I look at the barometer."));

    // The turn that recorded saw no record yet; the next one sees what it recorded.
    expect(briefingOf(b, 0)).not.toBe("");
    expect(briefingOf(b, 0)).not.toContain("THREAD-STORM");
    const next = briefingOf(b, 2);
    expect(next).toContain("## Story brief");
    expect(next).toContain("THREAD-STORM Will the supply boat beat the storm?");
    expect(next).toContain("## The story so far");
    expect(next).toContain("Message 1: BEAT-LAMP Wren lit the lamp before dusk.");
  });

  test("a swipe of the turn that recorded is briefed without what that turn recorded", async () => {
    const b = await bed({ answers: [...RECORDING, replying("Wren says nothing.")] });
    await settledTurn(b, await play(b, "normal", "I ask whether the boat came."));
    await settledTurn(b, await play(b, "swipe"));

    const swiped = briefingOf(b, 2);
    expect(swiped).not.toBe("");
    expect(swiped).not.toContain("THREAD-STORM");
    expect(swiped).not.toContain("## Story brief");
  });

  test("a live turn keeps its story time", async () => {
    const b = await bed({
      answers: [
        { pieces: [{ text: "<intent>The bells ring six.</intent>" }, { call: "world_apply", args: { operations: [{ op: "pass_time", until: "2026-01-01 18:00", source: { from: "prose" } }] } }] },
        { pieces: [{ text: "<reply>Six bells, and the lamps are lit.</reply>" }] },
        replying("The lamp turns."),
      ],
    });
    const first = await settledTurn(b, await play(b, "normal", "I wait for the bells."));
    const second = await settledTurn(b, await play(b, "normal", "I look at the sky."));
    const store = b.turns.store.user(USER);

    // The first turn began before anyone set the clock: its briefing gave no story time, and its row keeps none.
    expect(store.turn(first.id)?.storyTime).toBeNull();
    // The second keeps the time its briefing gave: the clock where it started, which its turn's facts showed as six in the evening.
    const kept = store.turn(second.id)?.storyTime ?? null;
    const { state } = store.startOf(second.id);
    expect(kept).toBe(state.world.clock);
    const world = b.turns.store.env.worlds(state.world.revision);
    if (kept === null || world === undefined) throw new Error("the second turn kept no story time, or its world cannot be read");
    const facts = b.requests[1]!.briefing.find((block) => block.name === "turn-facts")?.text ?? "";
    expect(facts).toContain(`Story time: ${formatClock(calendarOf(world), kept)}.`);
    expect(facts).toContain("6:00 PM");
  });
});
