// The empty swipe a swipe or a regenerate stages for its generation to write (plan §6.3, §10.10) is heard before Lumiverse tells
// the generation begun: Lumiverse adds the swipe, shown, then tears down the chat's background work, for up to two seconds, and only
// then announces the generation (`services/generate.service.ts:1699-1727`, `:2036-2055`). Played through the stand-in Lumiverse,
// with the chat's background work holding that teardown until RPE has done all it does on hearing the swipe. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { ChatChange } from "../../src/adapter/lumiverse/events";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

for (const type of ["swipe", "regenerate"] as const) {
  test(`a ${type}'s own empty swipe, heard before its generation is told begun, is never told as another of the reply's swipes`, async () => {
    const b = await openTurnBed({ answers: [replying("The lamp turns."), replying("The lamp gutters.")] });
    beds.push(b);
    b.host.send(CHAT, "I climb the stairs.");
    const first = await settledTurn(b, (await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).generationId!);
    const heard: ChatChange[] = [];
    const lane = b.turns.lane;
    const changed = lane.changed.bind(lane);
    lane.changed = (change) => {
      heard.push(change);
      changed(change);
    };
    const teardown = Promise.withResolvers<void>();
    b.host.background.set(CHAT, new Set([teardown.promise]));

    const going = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type });
    await b.until("the staged swipe to be heard", () => heard.some((c) => c.kind === "message-swiped" && c.message === first.message));
    await lane.settled();
    expect(heard.some((c) => c.kind === "generation-started")).toBe(false);
    teardown.resolve();
    const out = await going;
    expect(out.error).toBeNull();
    await settledTurn(b, out.generationId!);

    expect(b.requests[1]!.since.map((s) => s.kind)).not.toContain("swiped");
    expect(JSON.stringify(b.model.requests[1]!.messages)).not.toContain("now shows another of its swipes");
  });
}
