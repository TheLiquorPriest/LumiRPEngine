// The cast, plugged into the turn (plan §7.1, §5.4): the Author writes a character's record with
// `cast_update`, and an agent that plays that character is given its views by the name its definition
// lists (`cast:self(…)`), laid out by their parts. Played through the stand-in Lumiverse on the
// scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { CHAT, CONNECTION, openTurnBed, PRESET, settledTurn, type TurnBed } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

test("the Author casts a character with cast_update, and the agent that plays her is given her base by the name its definition lists", async () => {
  const b = await openTurnBed({
    answers: [
      {
        pieces: [
          { text: "<intent>Wren answers for herself.</intent>" },
          {
            call: "cast_update",
            args: {
              operations: [
                { op: "cast", who: "Wren Hale", as: "principal", line: "The keeper of the light." },
                { op: "base", who: "Wren Hale", seed: "SEED-WREN She keeps the Gannet Rock light alone.", soul: "SOUL-WREN The lamp must never go dark." },
              ],
            },
          },
        ],
      },
      { pieces: [{ call: "delegate", args: { agent: "character", brief: "The player asks whether the boat came.", plays: "Wren Hale" } }] },
      { pieces: [{ text: "I look past him at the sea. It is late." }] },
      { pieces: [{ text: "<reply>Wren looks past you at the sea. \"It's late.\"</reply>" }] },
    ],
  });
  beds.push(b);
  b.host.send(CHAT, "I ask whether the boat came.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  await settledTurn(b, out.generationId!);

  // The Author's own requests hold no view of hers; the request of the agent that plays her (which knows nothing of the Author's
  // call that wrote her) holds her base, as its layout lays it out.
  const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
  expect(sent).toHaveLength(4);
  expect(sent[0]).not.toContain("SEED-WREN");
  expect(sent[2]).not.toContain("cast_update");
  expect(sent[2]).toContain("Seed: SEED-WREN She keeps the Gannet Rock light alone.");
  expect(sent[2]).toContain("SOUL-WREN The lamp must never go dark.");
});
