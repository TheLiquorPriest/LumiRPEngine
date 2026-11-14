// A turn that ends with no reply after its progress line went out (plan §10.7): Lumiverse shows the player the line from
// `reply-errors.md` in its notice, and keeps the generation's message with its thinking. The line goes into that thinking too, so the
// kept message says why; but filled with no detail, since the provider's or an error's own words in kept thinking can reach a later
// prompt. Played through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { CHAT, CONNECTION, openTurnBed, PRESET, type TurnBed } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

test("a provider that fails before the reply: the notice carries the provider's words, the thinking Lumiverse keeps the same line without them", async () => {
  const b = await openTurnBed({ answers: [{ pieces: [], end: { error: "UPSTREAM-WORDS The gateway at relay-7 answered 502." } }] });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });

  expect(out.error).toContain("The model's provider failed before a reply was written: ");
  expect(out.error).toContain("UPSTREAM-WORDS");
  const seen = b.host.streams.get(out.generationId!);
  expect(seen?.reasoning).toContain("The model's provider failed before a reply was written.");
  expect(seen?.reasoning).not.toContain("UPSTREAM-WORDS");
  expect(seen?.reasoning).not.toContain("relay-7");
});
