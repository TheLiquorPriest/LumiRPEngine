// The story time a briefing shows (plan §10.2): a chat that names no world plays on the blank one, whose
// clock nobody has set; its briefing shows no time while play only moves the clock on, and the time
// once play has set it to a date and time. Played through the stand-in Lumiverse on the scripted
// model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

test("on a chat that names no world, the briefing shows no story time while play only moves the clock, and shows it once play has set the clock to a date and time", async () => {
  const b = await openTurnBed({
    answers: [
      { pieces: [{ text: "<intent>Two hours go by.</intent>" }, { call: "world_apply", args: { operations: [{ op: "pass_time", minutes: 120, source: { from: "prose" } }] } }] },
      { pieces: [{ text: "<reply>The evening wears on.</reply>" }] },
      { pieces: [{ text: "<intent>The bells ring six.</intent>" }, { call: "world_apply", args: { operations: [{ op: "pass_time", until: "2026-01-01 18:00", source: { from: "prose" } }] } }] },
      { pieces: [{ text: "<reply>Six bells, and the lamps are lit.</reply>" }] },
      replying("The lamp turns."),
    ],
  });
  beds.push(b);
  for (const said of ["I wait two hours.", "I wait for the bells.", "I look at the sky."]) {
    b.host.send(CHAT, said);
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    expect(out.error).toBeNull();
    await settledTurn(b, out.generationId!);
  }
  const storyTime = (n: number): string | undefined => b.requests[n]!.briefing.find((block) => block.name === "turn-facts")?.text.split("\n").find((line) => line.includes("Story time:"));
  expect(storyTime(0)).toBeUndefined();
  expect(storyTime(1)).toBeUndefined();
  expect(storyTime(2)).toContain("Thu 1 Jan 2026, 6:00 PM");
});
