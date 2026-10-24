// Who gets a mind (DESIGN §24.1): everyone in the player character's scene, and someone elsewhere
// only while they're in something that could surface soon. Being named, idling or living a routine
// calls no mind, but a mind that comes due uncalled still records its level, so the tier a routine
// role reads doesn't move with who thinks.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { RoutineGmView } from "../../src/shared/routines";
import { fakeModels, type Seen, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

const MARINA = "alder_harbor_marina";

/** Port Alder with `minds` as the world's minds config and `people` added, idle, at the marina, away from the POV. */
async function alder(rig: Rig, minds: JsonObject, people: readonly [string, string][]): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: minds }));
  for (const [id, name] of people) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id, value: { id, kind: "person", name, tier: "background", fields: { place: MARINA }, relations: [] } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

/** Whose minds a turn called, by name. */
async function thinkers(rig: Rig, seen: Seen, chatId: string, user: string): Promise<string[]> {
  const before = seen.minds.length;
  await rig.turn(chatId, user, "The morning goes on.");
  return seen.minds.slice(before).map((m) => m.name);
}

describe("who gets a mind", () => {
  test("a character named but away and idle gets no mind", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    // Low thresholds: naming her makes her Live on the ladder, and every Live mind could run.
    const chatId = await alder(rig, { thresholds: { live: 30, near: 20, far: 10 } }, [["vera_drift", "Vera Drift"]]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { liveLimit: "none", refreshLimit: 0 } } }));
    expect(await thinkers(rig, seen, chatId, "I wonder what Vera Drift is up to.")).not.toContain("Vera Drift");
  });

  test("an off-scene character with an appointment with the player character in a few hours gets a mind and isn't shown", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    // Nobody is on the ladder but those the GM pins, and one refresh may run a turn.
    const chatId = await alder(rig, { thresholds: { live: 900, near: 900, far: 900 } }, [
      ["vera_drift", "Vera Drift"],
      ["ana_reyes", "Ana Reyes"],
    ]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 1 } } }));
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "mind_pin", entity: "vera_drift", level: "near" }] }));
    await thinkers(rig, seen, chatId, "Good morning.");
    // Ana means to meet the player character in three hours; Vera, only named, would take the one refresh first.
    const { state } = await stateOf(rig, chatId);
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "mind_pin", entity: "ana_reyes", level: "near" }, { op: "mind_memory", entity: "ana_reyes", part: "plan", id: null, value: { what: "Meet Jordan at the coffee shop", kind: "meet", when: { from: state.clock + 180, to: state.clock + 240 }, with: ["pov"], priority: 4 } }] }));
    expect(await thinkers(rig, seen, chatId, "Has anyone seen Vera Drift?")).toEqual(["Ana Reyes"]);
    expect(rig.host.section("Minds")).not.toContain("Ana Reyes");
  });

  test("an off-scene Near character who isn't involved gets no call, but keeps the tier the ladder gives them, so their routine role doesn't change", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    // Everyone on the ladder is Near at least, and no refresh may run: only those at hand would think.
    const chatId = await alder(rig, { thresholds: { live: 900, near: 1, far: 0 } }, [["vera_drift", "Vera Drift"]]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 0 } } }));
    expect(await thinkers(rig, seen, chatId, "Good morning.")).not.toContain("Vera Drift");
    const gm = rig.body(await rig.send({ type: "lre.routine", chatId, op: "day", entity: "vera_drift", view: "gm" })).gm as RoutineGmView;
    expect(gm.tier).toBe("near");
    expect(gm.follow.role).toBe(gm.settings.roles.near);
  });
});
