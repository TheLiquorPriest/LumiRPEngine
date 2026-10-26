// The intent gate's chip and the narrator's lines say the read action's picks in words (DESIGN
// §5.1, §6.2, §7): a quest by the label its quest log row shows, a stat by its label, nothing written
// as an id, and nothing that names anyone or anything hidden that the reader hasn't seen said.

import { describe, expect, test } from "bun:test";
import { actionWords } from "../../src/engine/action-words";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import type { WorldDoc } from "../../src/shared/world";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

/** The Riverton world with a puzzle open, and what `more` adds to it, at its start. */
function setup(more: (world: WorldDoc) => void = () => {}) {
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
  more(world);
  return { world, state: new Working(reg, world, startState(world)).state };
}

/** Vex Morrow, someone the player character doesn't know of. */
function vex(world: WorldDoc): void {
  world.entities.vex = { id: "vex", kind: "person", name: "Vex Morrow", tier: "supporting", fields: {}, relations: [], visibility: "secret" };
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

  test("the player's words show as typed, whatever their letters do in lower case", () => {
    const { world, state } = setup();
    // "İ" lower-cases to two characters: the words are found in the message as written, never read off the model's id.
    expect(actionWords(reg, world, state, action("answer"), { puzzle: "cellar_lock_riddle", answer: "red_door" }, "I tell İlker the code is red door.")).toBe("The cellar lock, red door");
  });
});

describe("the read action never names anyone or anything hidden", () => {
  const ANSWER = { puzzle: "cellar_lock_riddle", answer: "Vex Morrow" };

  test("a free-text pick naming someone hidden is never told the narrator, and the card shows it only when the player typed it", () => {
    const { world, state } = setup(vex);
    // The narrator is told no words the player typed.
    expect(actionWords(reg, world, state, action("answer"), ANSWER)).toBe("The cellar lock");
    // A read that wrote her for "whoever was in the shop last night" doesn't name her on the card.
    expect(actionWords(reg, world, state, action("answer"), ANSWER, "I give my answer: whoever was in the shop last night.")).toBe("The cellar lock");
    // The player's own words are theirs to see again.
    expect(actionWords(reg, world, state, action("answer"), ANSWER, "I answer: Vex Morrow did it.")).toBe("The cellar lock, Vex Morrow");
  });

  test("a pick that is a hidden thing's id reads as one nothing has", () => {
    const hidden = setup((world) => {
      world.entities.lantern = { id: "lantern", kind: "item", name: "Lantern", tier: "background", fields: {}, relations: [], visibility: "secret" };
    });
    const none = setup();
    for (const typed of ["I take the lantern.", "I take it.", ""]) {
      const words = actionWords(reg, hidden.world, hidden.state, action("take"), { item: "lantern" }, typed);
      expect({ typed, words }).toEqual({ typed, words: actionWords(reg, none.world, none.state, action("take"), { item: "lantern" }, typed) });
    }
    expect(actionWords(reg, hidden.world, hidden.state, action("take"), { item: "lantern" }, "I take the lantern.")).toBe("lantern");
  });
});
