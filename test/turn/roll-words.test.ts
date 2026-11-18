// A roll on the turn's card (`changeWords`), as the GM view, the Author's view and the journal say it, from the event's one line
// (`ev_check`, history-records.md): who rolled, for what, the dice and the numbers they showed, the total against what, and the
// outcome. The roll tool's dice roll (its purpose, no check of the world's) and a check of the world's both. People are invented.

import { expect, test } from "bun:test";
import { ENGINE_EVENTS } from "../../src/engine/engine-pack";
import { kindIs } from "../../src/engine/scope";
import { playAnswers } from "../../src/play/service";
import { RPE_GUIDANCE } from "../../src/tree";
import { changeWords } from "../../src/turn/card-words";
import { rig } from "../play/undo-rig";

test("the card says a roll whole: who rolled, for what, the dice, against what, and how it came out", async () => {
  const r = await rig();
  const pov = r.doc.pov;
  const world = r.world();
  // Someone else, by name; the player's own character is "You", as the card says it.
  const [other, them] = Object.entries(world.entities).find(([id, e]) => id !== pov && kindIs(r.store.env.registry, r.doc, e.kind, "person")) ?? ["", undefined];
  const words = await playAnswers(RPE_GUIDANCE);
  const card = (data: Record<string, unknown>): string => changeWords(words, r.store.env.registry, r.doc, world, { op: ENGINE_EVENTS.check, value: { type: ENGINE_EVENTS.check, data } as never });
  // The roll tool's: dice by their notation, for a purpose, against a difficulty (the walk's "…: , success (rolled 19 against 11)").
  expect(card({ actor: other, for: "a punch at you on the park path", check: "", notation: "1d20+3", dice: [16], natural: 16, total: 19, dc: 11, outcome: "success" })).toBe(
    `${them?.name} rolled for a punch at you on the park path (1d20+3): 16, 19 in all against 11, success`,
  );
  // Dice with no difficulty: rolled, and no outcome of its own.
  expect(card({ actor: pov, for: "damage", check: "", notation: "1d4+1", dice: [3], natural: 3, total: 4, dc: null, outcome: "rolled" })).toBe("You rolled for damage (1d4+1): 3, 4 in all");
  // A check of the world's, as an action rolls it.
  expect(card({ check: "mechanics_check", actor: pov, notation: "1d20+3", natural: 12, total: 15, dc: 12, outcome: "success" })).toBe("You rolled mechanics check (1d20+3): 12, 15 in all against 12, success");
});
