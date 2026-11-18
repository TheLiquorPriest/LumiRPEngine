// Every action of every shipped starter world, carried out with `world_apply`'s `act` in a new chat of its world, as the GM calls
// it: the engine refuses none (a requirement that does not hold is told, never a gate), each is recorded, and a story flag its
// outcome sets reads as set (an engine event named like the story area's operations is the engine's).

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { STARTER_WORLDS } from "../../src/packs/index";
import { paramCandidates } from "../../src/engine/resolve";
import { dataOf, registry, rig, texts } from "./rig";

describe("the starters' actions", () => {
  for (const [starter, make] of Object.entries(STARTER_WORLDS)) {
    const doc = make(`w_${starter}`, starter);
    test(`${starter}: each of its ${Object.keys(doc.actions).length} actions is carried out in a new chat of its world`, async () => {
      for (const [id, action] of Object.entries(doc.actions)) {
        const t = await rig({}, doc);
        const state = t.s.stateAt(t.turn.id).state.world;
        // Each argument it takes, as the palette offers it to the player's character.
        const params = Object.fromEntries(Object.keys(action.params).flatMap((name) => paramCandidates(registry(), doc, state, action, name, doc.pov).slice(0, 1).map((pick) => [name, pick])));
        const r = await t.call("world_apply", { operations: [{ op: "act", action: id, params, source: { from: "gm" } }] });
        expect({ action: id, refused: r.error === true ? texts(r) : null }).toEqual({ action: id, refused: null });
        expect((dataOf(r).operations as JsonObject[])[0]?.applied).toBe(true);
        const flags = t.s.stateAt(t.turn.id).state.world.packs.story?.flags as JsonObject | undefined;
        for (const effect of action.outcomes.default ?? []) {
          const name = effect.type === "story.flag" ? effect.args?.name : undefined;
          if (typeof name !== "string" || name.startsWith("=")) continue;
          // A value the action writes as a formula (`=who`, a count) is worked out; one written plainly is set as written.
          const value = effect.args?.value ?? true;
          if (typeof value === "string" && value.startsWith("=")) expect({ action: id, flag: name, set: flags?.[name] !== undefined }).toEqual({ action: id, flag: name, set: true });
          else expect({ action: id, flag: name, value: flags?.[name] }).toEqual({ action: id, flag: name, value });
        }
      }
    });
  }
});
