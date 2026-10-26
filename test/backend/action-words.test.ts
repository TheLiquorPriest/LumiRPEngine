// The intent gate's chip says the read action's picks in words (DESIGN §5.1, §7): a quest by the
// label its quest log row shows, a stat by its label, and nothing written as an id.

import { describe, expect, test } from "bun:test";
import { actionWords } from "../../src/engine/action-words";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

function setup() {
  const world = modernUsWorld("w", "R");
  world.tracks.cellar_lock_riddle = {
    id: "cellar_lock_riddle",
    kind: "puzzle",
    label: "The cellar lock",
    start: "riddle",
    visibility: "public",
    stages: {
      riddle: { label: "Answer the riddle", next: [{ to: "open", when: "true" }], answer: { expect: ["An echo"], normalize: true }, hints: [] },
      open: { label: "The cellar is open", next: [] },
    },
  };
  return { world, state: new Working(reg, world, startState(world)).state };
}

function action(id: string) {
  const def = reg.actions.get(id);
  if (!def) throw new Error(`no action ${id}`);
  return def;
}

describe("the read action in words", () => {
  test("Answer names its puzzle as the quest log does, with the player's answer, and no id", () => {
    const { world, state } = setup();
    const words = actionWords(reg, world, state, action("answer"), { puzzle: "cellar_lock_riddle", answer: "An echo" });
    expect(words).toContain("The cellar lock");
    expect(words).toContain("An echo");
    expect(words).not.toContain("cellar_lock_riddle");
  });

  test("Attempt names its stat by its label, and a pick written as an id that names nothing is left out", () => {
    const { world, state } = setup();
    const words = actionWords(reg, world, state, action("attempt"), { stat: "wits", difficulty: "hard" });
    expect(words).toContain("Wits");
    expect(words).not.toContain("wits");
    expect(actionWords(reg, world, state, action("answer"), { puzzle: "the_mayor_is_the_smuggler", answer: "1234" })).toBe("1234");
  });

  test("what the player typed is theirs to see again: a code written as an id, and a thing they say is there", () => {
    const { world, state } = setup();
    expect(actionWords(reg, world, state, action("answer"), { puzzle: "cellar_lock_riddle", answer: "red_door" }, "I answer red_door.")).toBe("The cellar lock, red_door");
    // Read back with "_" for the player's spaces, it shows as they typed it.
    expect(actionWords(reg, world, state, action("answer"), { puzzle: "cellar_lock_riddle", answer: "red_door" }, "I say: Red Door.")).toBe("The cellar lock, Red Door");
    // Nothing in the world goes by "letter"; the player said it is there.
    expect(actionWords(reg, world, state, action("take"), { item: "letter" }, "I take the letter from the clerk.")).toBe("letter");
    // An id the player didn't type stays out.
    expect(actionWords(reg, world, state, action("answer"), { puzzle: "cellar_lock_riddle", answer: "the_mayor_is_the_smuggler" }, "I answer the riddle.")).toBe("The cellar lock");
  });
});
