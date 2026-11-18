// The actions a chat is offered: the tabletop rules' are gone from the player's actions sheet, from what the agents are told the world has and
// from what a typed sentence may mean while the chat's level of their domain is off, and back when it is on; nothing else of the packs' goes.

import { expect, test } from "bun:test";
import { offeredActions } from "../../src/engine/offered";
import { typedIntent } from "../../src/engine/typed-intent";
import { palette } from "../../src/play/state/palette";
import { inventedWorld, play, testStore } from "../store/fixtures";

test("the tabletop rules' actions are offered only while the chat's level of their domain is on", () => {
  const ts = testStore({ world: inventedWorld() });
  ts.s.createChat({ id: "c", revision: ts.revision });
  play(ts.s, "c", "m1", "Wren sits by the fire.", 1, []);
  const reg = ts.store.env.registry;
  const state = structuredClone(ts.s.headState("c").state.world);
  const layer = [...reg.actions].filter(([, a]) => a.pack === "d20").map(([id]) => id);
  expect(layer.length).toBeGreaterThan(0);
  const others = [...reg.actions].filter(([, a]) => a.pack !== "d20").map(([id]) => id);

  const off = (): string[] => [...offeredActions(reg, reg.context(ts.world, state)).keys()];
  expect(off().filter((id) => layer.includes(id))).toEqual([]);
  expect(off().filter((id) => others.includes(id)).length).toBe(others.length);
  const sheet = (): string[] => palette(ts.world, state, reg).entries.map((e) => e.action);
  expect(sheet().filter((id) => layer.includes(id))).toEqual([]);
  expect(typedIntent(reg, ts.world, state, "I roll a check")?.action ?? null).not.toBe("check");

  // On, they are all there; switched off again, they go, and nothing else does.
  state.realism.levels.d20 = 1;
  expect(off().filter((id) => layer.includes(id))).toEqual(layer);
  expect(sheet().filter((id) => layer.includes(id)).length).toBeGreaterThan(0);
  state.realism.levels.d20 = 0;
  expect(off().filter((id) => layer.includes(id))).toEqual([]);
  expect(sheet().filter((id) => layer.includes(id))).toEqual([]);
});
