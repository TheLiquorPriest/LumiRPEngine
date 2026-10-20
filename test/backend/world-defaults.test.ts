// A world's own realism and time defaults seed a new chat; the user's settings fill in what the
// world leaves out, or replace it with "Use my settings" on (DESIGN §9.1, §9.2).

import { describe, expect, test } from "bun:test";
import { isWorldDoc } from "../../src/engine/authoring";
import { REALISM_PRESETS } from "../../src/engine/realism";
import { STARTER_WORLDS } from "../../src/packs/index";
import type { ControlsView } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { SPEED_ACTIVITIES, SPEED_DEFAULT } from "../../src/shared/settings";
import { newWorld } from "../../src/studio-api";
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

  test("the user's time settings fill in the scale and scene types the world doesn't set", async () => {
    const rig = new Rig({ shipped: true });
    const controls = await newChat(rig, "modern_slice_of_life");
    const doc = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Port Alder");
    const [type, tick] = Object.entries(doc.time.sceneTicks)[0] ?? ["", 0];
    rig.body(await rig.send({ type: "lre.settings.set", patch: { time: { scale: 2, sceneTicks: { [type]: Math.round(tick) + 5, harbor_chat: 4 } } } }));
    const t = (await controls())?.time;
    expect([t?.scale, t?.sceneTicks.harbor_chat, t?.sceneTicks[type]]).toEqual([2, 4, Math.round(tick)]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { overrideWorldDefaults: true } }));
    expect((await controls())?.time.sceneTicks[type]).toBe(Math.round(tick) + 5);
  });

  test("NPC model calls per timelapse are gone: an older settings file still loads, new chats don't carry them, and a chat can't set them", async () => {
    const rig = new Rig({ shipped: true });
    const old = rig.body(await rig.send({ type: "lre.settings.get" })).settings as Record<string, Record<string, unknown>>;
    await rig.host.storage.write("settings.json", JSON.stringify({ ...old, time: { ...old.time, scale: 3, npcCallsPerTimelapse: 4 } }), rig.host.userId);
    const reloaded = rig.restart();
    const settings = reloaded.body(await reloaded.send({ type: "lre.settings.get" })).settings as Record<string, Record<string, unknown>>;
    expect(settings.time?.scale).toBe(3);
    expect(settings.time).not.toHaveProperty("npcCallsPerTimelapse");
    const worldId = await reloaded.newWorld("World", "modern_slice_of_life");
    const chatId = reloaded.host.createChat("Morning.");
    reloaded.body(await reloaded.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await reloaded.turn(chatId, "I look around.", "The street is quiet.");
    expect(JSON.stringify((await reloaded.rt.ledger.core(chatId, reloaded.host.userId))?.journal)).not.toContain("npc_calls");
    expect(await reloaded.send({ type: "lre.marker", chatId, kind: "time", control: "npc_calls", scope: { all: true }, to: 2 })).toMatchObject({ type: "lre.error", code: "bad_request" });
  });

  test("Settings → Time holds a policy for every Speed through activity it lists, and a tick between minutes keeps its row as the minute it plays", async () => {
    const rig = new Rig();
    const settings = rig.body(await rig.send({ type: "lre.settings.set", patch: { time: { sceneTicks: { action: 2.5 } } } })).settings as { time: { sceneTicks: Record<string, number>; speedThrough: Record<string, unknown> } };
    expect(Object.keys(settings.time.speedThrough).sort()).toEqual([...SPEED_ACTIVITIES].sort());
    for (const policy of Object.values(settings.time.speedThrough)) expect(policy).toEqual(SPEED_DEFAULT);
    expect(settings.time.sceneTicks.action).toBe(3);
  });
});

describe("a world made from nothing carries the default tables, as a starter does", () => {
  test("Build's blank world and the studio's new world pin every default table at its revision", async () => {
    const rig = new Rig({ shipped: true });
    const created = rig.body(await rig.send({ type: "lre.world", op: "create", name: "Blank" })).world;
    if (!isWorldDoc(created)) throw new Error("no world");
    const starter = STARTER_WORLDS.modern_slice_of_life?.("w_starter", "Starter");
    for (const world of [created, newWorld("w_blank", "Blank")]) {
      expect(Object.keys(world.tables).sort()).toEqual(Object.keys(starter?.tables ?? {}).sort());
      expect(world.pins.tables).toEqual(Object.fromEntries(Object.entries(world.tables).map(([id, t]) => [id, t.revision])));
      expect(world.tables["economy.finance"]?.rows.credit_card).toBeDefined();
    }
  });
});
