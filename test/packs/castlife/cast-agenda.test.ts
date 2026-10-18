// Cast shows agendas only when public (DESIGN §7): each agenda on its own, so a secret one never
// shows behind a public one, and a day block spent on a secret one reads as busy.

import { expect, test } from "bun:test";
import { createRegistry } from "../../../src/engine/registry-impl";
import { placeOfEntity } from "../../../src/engine/scope";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { buildCastView, dayPlan } from "../../../src/packs/castlife/core/index";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

test("a secret agenda shows nowhere in Cast, not behind a public one, nor in the day's plan", () => {
  const world = modernUsWorld("w", "R");
  world.realism.levels.castlife = 3;
  world.tracks.a_public = { id: "a_public", kind: "agenda", label: "Open a bakery", owner: "maya", start: "save", visibility: "public", stages: { save: { label: "Save money", priority: 5, next: [] } } };
  world.tracks.b_secret = { id: "b_secret", kind: "agenda", label: "Poison the mayor", owner: "maya", start: "buy", visibility: "secret", stages: { buy: { label: "Buy arsenic", priority: 9, next: [] } } };
  const state = startState(world);
  const here = placeOfEntity(state, world.pov);
  if (!here) throw new Error("the POV has no place");
  state.entities.maya!.fields.place = here;
  const w = new Working(reg, world, state);
  // The secret agenda is in Maya's day: the planner, which isn't the player's, still pursues it.
  expect(dayPlan(w.ctx, "maya").blocks.some((b) => b.label === "Buy arsenic")).toBe(true);
  const maya = buildCastView(w.ctx).people.find((p) => p.id === "maya");
  expect(maya?.agenda).toEqual([{ label: "Open a bakery", stage: "Save money" }]);
  expect(maya?.timeline?.some((b) => b.label === "Busy")).toBe(true);
  for (const secret of ["Poison the mayor", "Buy arsenic", "b_secret"]) expect(JSON.stringify(maya)).not.toContain(secret);
});
