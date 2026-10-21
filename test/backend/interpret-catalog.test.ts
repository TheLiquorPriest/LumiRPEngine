// What interpret is offered (DESIGN §9.4, §11): the actions that fit the fight's state, as the Combat
// tab lists them, and a table param's rows kept inside that param.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { Rig } from "../support/rig";

describe("interpret's catalog", () => {
  test("outside a fight it offers Fight but no attack, and a table param's rows stay inside the param", async () => {
    const rig = new Rig({ shipped: true });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "lean" } } }));
    const worldId = await rig.newWorld("Brindlemere", "fantasy_town");
    rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "profile", profile: "modern", choices: {} }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Good morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const prompts: string[] = [];
    rig.host.quietReply = (req: QuietRequest) => {
      const system = req.messages[0]?.content ?? "";
      if (!system.includes("You map a player's typed input")) return JSON.stringify({ proposals: [] });
      prompts.push(system);
      return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    };
    await rig.turn(chatId, "I attack Wren.", "Wren steps back.");
    const catalog = prompts[0]?.split("Action catalog:\n")[1]?.split("\nRules:")[0]?.split("\n") ?? [];
    const ids = catalog.map((line) => line.split(" — ")[0]);
    expect(ids).toContain("fight");
    expect(ids).not.toContain("attack");
    // The rows are one param's choices, so the param after them can't read as another row. Try
    // something stands in for Use a skill (DESIGN §11), while Push a skill keeps its own.
    expect(ids).toContain("try");
    expect(ids).not.toContain("skill_check");
    expect(catalog.find((line) => line.startsWith("push_skill"))).toMatch(/Params: skill \(one of: athletics \| [^()]*\), difficulty\? \(/);
  });
});
