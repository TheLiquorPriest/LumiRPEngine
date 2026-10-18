// `{{brief}}` and `{{recent}}` in a world's step templates (DESIGN §5.2): the brief is the turn's
// brief once its step has run (an outline template naming it waits for it; the steps after the
// reply read the plan's), and recent is the Journal's latest turn lines as the player sees them.

import { describe, expect, test } from "bun:test";
import { Rig } from "../support/rig";

const BRIEF = "Sam is in the kitchen with a cold coffee.";

async function world(steps: { id: string; purpose: string; template: string; output: string }[]) {
  const rig = new Rig();
  const worldId = await rig.newWorld("Kitchen");
  for (const s of steps) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "steps", id: s.id, value: { ...s, signals: ["always"] } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning, Sam.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").startsWith("BRIEF ") ? JSON.stringify({ text: BRIEF }) : "{}");
  return { rig, chatId };
}

/** The system prompt of the last helper call whose template starts with `mark`. */
function prompt(rig: Rig, mark: string): string {
  return rig.host.quietCalls.findLast((c) => (c.messages[0]?.content ?? "").startsWith(mark))?.messages[0]?.content ?? "";
}

describe("step template placeholders", () => {
  test("{{recent}} holds the Journal's turn lines before the turn, as the Journal shows them", async () => {
    const { rig, chatId } = await world([
      { id: "b", purpose: "brief", template: "BRIEF recent=[{{recent}}]", output: "text" },
      { id: "fx", purpose: "extract", template: "FX recent=[{{recent}}]", output: "effects" },
    ]);
    await rig.turn(chatId, "look around", "The kitchen is quiet.");
    const shown = (await rig.rt.view(chatId, rig.host.userId)).journal.map((n) => n.text);
    expect(shown.length).toBeGreaterThan(0);
    // The first turn has nothing before it.
    expect(prompt(rig, "BRIEF ")).toContain("recent=[]");
    await rig.turn(chatId, "look around", "Still quiet.");
    expect(prompt(rig, "BRIEF ")).toContain(`recent=[${shown.join("\n")}]`);
    expect(prompt(rig, "FX ")).toContain(`recent=[${shown.join("\n")}]`);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("{{brief}} is the turn's brief: an outline template naming it waits for it, and the steps after the reply read it", async () => {
    const { rig, chatId } = await world([
      { id: "b", purpose: "brief", template: "BRIEF write it", output: "text" },
      { id: "o", purpose: "outline", template: "OUTLINE brief=[{{brief}}]", output: "text" },
      { id: "fx", purpose: "extract", template: "FX brief=[{{brief}}]", output: "effects" },
    ]);
    await rig.turn(chatId, "look around", "The kitchen is quiet.");
    expect(prompt(rig, "OUTLINE ")).toContain(`brief=[${BRIEF}]`);
    expect(prompt(rig, "FX ")).toContain(`brief=[${BRIEF}]`);
    // The brief step itself is what writes it.
    expect(prompt(rig, "BRIEF ")).not.toContain(BRIEF);
  });
});
