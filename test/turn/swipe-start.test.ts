// A swipe begins where the attempt it replaces began (plan §10.1 step 4, §10.10): its briefing's story
// time and the turn lane's facts are those of its own line, not of the replaced attempt that the chat's
// path still shows while the swipe is written. Played through the stand-in Lumiverse on the scripted
// model, on a chat that plays an invented world. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { gate } from "rp-harness/testing/rig";
import { world } from "../iface/rig";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function play(b: TurnBed, said: string): Promise<string> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

test("a swipe's briefing shows the story time it starts at, and its facts count the turns of its own line", async () => {
  const held = gate();
  const b = await openTurnBed({
    answers: [
      replying("Bram wipes the bar."),
      { pieces: [{ text: "<intent>Two hours go by.</intent>" }, { call: "world_apply", args: { operations: [{ op: "pass_time", minutes: 120, source: { from: "prose" } }] } }] },
      { pieces: [{ text: "<reply>The evening wears on.</reply>" }] },
      { pieces: [{ hold: held }, { text: "<intent>The evening, again.</intent>" }, { text: "<reply>Bram yawns.</reply>" }] },
    ],
  });
  beds.push(b);
  await playsWorld(b, world());
  await play(b, "I sit at the bar.");
  const second = await play(b, "I wait two hours.");
  expect(b.turns.store.user(USER).changes(second).some((c) => c.lane === "engine")).toBe(true);

  const swiping = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type: "swipe" });
  const swipe = await b.until("the swipe's run", () => b.turns.runs.ofChat(USER, CHAT).find((r) => r.kind === "swipe"));
  // The attempt it replaces recorded an engine change; the turn before it on its own line did not.
  const facts = await b.turns.facts.read({ user: USER, chat: CHAT, session: swipe.session, turn: swipe.turn }, ["turns.since.engine.change"]);
  expect(facts["turns.since.engine.change"]).toEqual({ count: 1 });
  held.open();
  await settledTurn(b, (await swiping).generationId!);

  const storyTime = (n: number): string | undefined => b.requests[n]!.briefing.find((block) => block.name === "turn-facts")?.text.split("\n").find((line) => line.includes("Story time:"));
  expect(storyTime(1)).toBeDefined();
  expect(storyTime(2)).toBe(storyTime(1));
});
