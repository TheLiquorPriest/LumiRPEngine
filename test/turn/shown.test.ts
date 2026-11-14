// An earlier attempt shown again (plan §6.3, §11): when the player flips an earlier reply back to an
// attempt it held before, RPH is told that attempt is on the path again in place of the one it replaced,
// so the turns after it follow it and the next turn's session carries its work, not the work of the
// attempt left. Played through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed } from "./bed";

let bed: TurnBed | null = null;
afterEach(async () => {
  await bed?.close();
  bed = null;
});

/** The player says something, unless it is a swipe, and asks for a reply; gives the generation's id. */
async function play(b: TurnBed, type: "normal" | "swipe", said?: string): Promise<string> {
  if (said !== undefined) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type });
  expect(out.error).toBeNull();
  return out.generationId!;
}

test("after an earlier reply is flipped back to its first attempt, the next turn carries that attempt's work and not the other's", async () => {
  const b = (bed = await openTurnBed({
    answers: [
      replying("The lamp turns.", "Begin the watch."),
      replying("Wren trims the wick.", "FIRST-ATTEMPT Show her hands."),
      replying("Wren lets the wick smoke.", "SECOND-ATTEMPT Show her tired."),
      replying("Wren waits with you.", "Wait for the light."),
      replying("The sea is grey.", "Watch the sea."),
    ],
  }));
  await settledTurn(b, await play(b, "normal", "I climb the stairs."));
  const attempt = await settledTurn(b, await play(b, "normal", "I trim the wick."));
  await settledTurn(b, await play(b, "swipe"));
  await settledTurn(b, await play(b, "normal", "I wait for the light."));

  b.host.cycleSwipe(CHAT, attempt.message!, "left");
  await settledTurn(b, await play(b, "normal", "I watch the sea."));
  const carried = JSON.stringify(b.model.requests.at(-1)?.messages);
  expect(carried).toContain("FIRST-ATTEMPT Show her hands.");
  expect(carried).toContain("Wait for the light.");
  expect(carried).not.toContain("SECOND-ATTEMPT");
});
