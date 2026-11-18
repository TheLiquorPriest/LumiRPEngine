// The progress lines of a turn, as the chat's thinking block shows them, name things as a person does (the owner's word of 18 Nov):
// an agent as RPE calls it (the GM, another GM for the turn's second), a tool by what it is doing; never a handle such as gm-2, nor a
// tool's own name where its file says what it does. Played through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

test("a turn's progress lines name each agent as a person calls it and each tool by what it is doing, with no handle and no raw id", async () => {
  const b = await openTurnBed({
    off: ["rules/unsourced"],
    answers: [
      { pieces: [{ text: "<intent>Two rulings.</intent>" }, { call: "delegate", args: { agent: "gm", brief: "Rule on the jump." } }] },
      { pieces: [{ call: "file_read", args: { path: "persistent-workspace/rulings.md" } }] },
      { pieces: [{ text: "The jump fails." }] },
      { pieces: [{ call: "delegate", args: { agent: "gm", brief: "Rule on the climb." } }] },
      { pieces: [{ text: "The climb holds." }] },
      replying("She falls short, then climbs."),
    ],
  });
  beds.push(b);
  b.host.send(CHAT, "I jump for the ledge.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  await settledTurn(b, out.generationId!);

  const lines = (b.host.streams.get(out.generationId!)?.reasoning ?? "").split("\n").filter((line) => line !== "");
  expect(lines).toEqual(expect.arrayContaining(["The Author is giving another agent a task.", "Asking the GM.", "The GM is reading a file.", "Asking another GM."]));
  // No handle (gm-1, author-1), and no tool's own name, which is written with an underscore.
  expect(lines.filter((line) => /\b[a-z]+-\d+\b|\b[a-z]+_[a-z_]+\b/.test(line))).toEqual([]);
});
