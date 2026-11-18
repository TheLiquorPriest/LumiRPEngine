// The agents' thinking in the chat's thinking block (the owner's word of 18 Nov: nothing runs silent): as the Author's model writes it,
// under the progress part's line that names it, after the turn's first progress line and before its reply; none with the progress
// lines alone. And none of what went there reaches an agent's prompt again, though Lumiverse sends it back with the earlier reply.
// Played through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { textOf } from "../../src/turn/request";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

const THINKING = { pieces: [{ thinking: "Wren is at the lamp." }, { thinking: " The stair comes next." }, { text: "<intent>One exchange.</intent>" }, { text: "<reply>The lamp turns.</reply>" }] };

test("the Author's thinking goes into the thinking block as it is written, under its name and in order, and no agent is given it again", async () => {
  const b = await openTurnBed({ answers: [THINKING, replying("Wren nods.")] });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const first = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  const reasoning = b.host.streams.get(first.generationId!)?.reasoning ?? "";
  expect(reasoning).toContain("The Author thinks:\nWren is at the lamp. The stair comes next.");
  expect(reasoning.indexOf("Reading the turn.")).toBeLessThan(reasoning.indexOf("The Author thinks:"));
  const turn = await settledTurn(b, first.generationId!);
  // Lumiverse keeps it with the message, and sends it back with that reply in the next prompt.
  const kept = JSON.parse(String(b.db.rows("SELECT extra FROM messages WHERE id = ?", first.messageId!)[0]!.extra)) as { reasoningBySwipe: string[] };
  expect(kept.reasoningBySwipe[0]).toContain("Wren is at the lamp.");

  b.host.send(CHAT, "I ask about the boat.");
  const second = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  const next = await settledTurn(b, second.generationId!);
  expect(next.id).not.toBe(turn.id);
  const sentBack = b.turns.prompts.carried(USER, next.id)?.layout.messages.filter((m) => m.thinking !== undefined) ?? [];
  expect(sentBack.length).toBeGreaterThan(0);
  // The prompt the second turn's agents were given holds none of it.
  const given = b.requests.at(-1)!.prompt.map(textOf).join("\n");
  expect(given).not.toContain("Wren is at the lamp.");
  expect(given).not.toContain("The Author thinks:");
});

test("with the progress lines alone, no thinking goes into the thinking block", async () => {
  const b = await openTurnBed({ answers: [THINKING], global: "progress:\n  thinking: lines\n" });
  beds.push(b);
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  const reasoning = b.host.streams.get(out.generationId!)?.reasoning ?? "";
  expect(reasoning).toContain("Reading the turn.");
  expect(reasoning).not.toContain("Wren is at the lamp.");
  expect(reasoning).not.toContain("thinks:");
});
