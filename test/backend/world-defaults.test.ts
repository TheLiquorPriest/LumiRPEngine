// A world's own realism and time defaults seed a new chat; the user's settings fill in what the
// world leaves out, or replace it with "Use my settings" on (DESIGN §9.1, §9.2).

import { describe, expect, test } from "bun:test";
import { REALISM_PRESETS } from "../../src/engine/realism";
import { STARTER_WORLDS } from "../../src/packs/index";
import type { ControlsView } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";

/** A new chat on a starter; its controls before the first turn are the levels that turn will use. */
async function newChat(rig: Rig, template: string): Promise<() => Promise<ControlsView | null>> {
  const worldId = await rig.newWorld("World", template);
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return async () => (await rig.rt.view(chatId, rig.host.userId)).controls;
}

describe("new chats start from the world's realism and time defaults", () => {
  for (const [template, preset] of [
    ["modern_slice_of_life", "simulation"],
    ["mystery_manor", "grounded"],
  ] as const) {
    test(`${template} runs at its authored ${preset} levels, or the user's with Use my settings on`, async () => {
      const rig = new Rig({ shipped: true });
      const controls = await newChat(rig, template);
      const authored = await controls();
      expect(authored?.realism.preset).toBe(preset);
      expect(authored?.realism.levels).toEqual(REALISM_PRESETS[preset].levels);
      expect(authored?.realism.tierCaps.background.money).toBe(preset === "simulation" ? 2 : 1);
      rig.body(await rig.send({ type: "lre.settings.set", patch: { overrideWorldDefaults: true } }));
      const mine = await controls();
      expect(mine?.realism.levels).toEqual(REALISM_PRESETS.story.levels);
      // The world's caps are lifted too, so the chat is the user's Story.
      expect(mine?.realism.preset).toBe("story");
    });
  }

  test("the user's time settings fill in the scale, NPC calls and scene types the world doesn't set", async () => {
    const rig = new Rig({ shipped: true });
    const controls = await newChat(rig, "modern_slice_of_life");
    const doc = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Port Alder");
    const [type, tick] = Object.entries(doc.time.sceneTicks)[0] ?? ["", 0];
    rig.body(await rig.send({ type: "lre.settings.set", patch: { time: { scale: 2, npcCallsPerTimelapse: 3, sceneTicks: { [type]: Math.round(tick) + 5, harbor_chat: 4 } } } }));
    const t = (await controls())?.time;
    expect([t?.scale, t?.npcCalls, t?.sceneTicks.harbor_chat, t?.sceneTicks[type]]).toEqual([2, 3, 4, Math.round(tick)]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { overrideWorldDefaults: true } }));
    expect((await controls())?.time.sceneTicks[type]).toBe(Math.round(tick) + 5);
  });
});
