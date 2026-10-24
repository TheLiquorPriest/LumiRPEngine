// Who is with the player character (DESIGN §6.6, §24.1): the one presence test the Minds, People
// and Stance sections share. Someone in a room inside the POV's place is with it; the room next door,
// or somewhere in a town routes run through, isn't. People names the POV before anyone else.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import { together } from "../../../src/engine/presence";
import { createRegistry } from "../../../src/engine/registry-impl";
import type { WorldState } from "../../../src/engine/state";
import { ALL_PACKS } from "../../../src/packs/index";
import { mindLines } from "../../../src/packs/minds/core/section";
import { modernUsWorld } from "../riverton";
import { fold, startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function at(w: WorldDoc, state: WorldState, who: string, place: string): WorldState {
  return fold(reg, w, state, [{ type: "set", entity: who, field: "place", value: place }]);
}

/** A minds round in which `who` thought, where they stand. */
function thought(w: WorldDoc, state: WorldState, who: string): WorldState {
  const round: LedgerEvent = { type: "minds.round", data: { at: state.clock, on: true } };
  const mind: LedgerEvent = { type: "minds.mind", data: { entity: who, at: state.clock, place: null, level: "live", moment: "turn", reason: "live", monologue: "Where did I leave my keys?", depiction: "pats down her coat pockets", intent: "Find the keys.", reactions: [], mood: "flustered", interrupt: null, withheld: false } };
  return fold(reg, w, state, [round, mind]);
}

/** The People section's lines, every renderer's in order (its hints aside). */
function people(w: WorldDoc, state: WorldState): string[] {
  const ctx = reg.context(w, state);
  return reg.renderers.filter((r) => r.slot === "people" && !r.hint).flatMap((r) => r.render(ctx));
}

describe("who is with the player character", () => {
  test("a companion in a room inside the player character's place is with them: Minds and People tell of her", () => {
    const w = modernUsWorld("w", "R");
    // The POV placed coarsely, somewhere in Elm Street Apartments; Maya in the apartment inside it.
    const s = thought(w, at(w, at(w, startState(w), w.pov, "apartment_bldg"), "maya", "apartment"), "maya");
    expect(mindLines(reg.context(w, s)).map((l) => l.entity)).toEqual(["maya"]);
    expect(people(w, s).some((l) => l.includes("Maya Chen"))).toBe(true);
  });

  test("People's first line names the player character", () => {
    const w = modernUsWorld("w", "R");
    const s = at(w, startState(w), "maya", "apartment");
    expect(people(w, s)[0]).toContain(w.entities[w.pov]?.name ?? "no POV");
  });

  test("a character in the room next door isn't with them, nor is anyone somewhere in town", () => {
    const w = modernUsWorld("w", "R");
    // Rosa is in Apartment 2B, beside the POV's apartment in the same building.
    const s = thought(w, startState(w), "rosa");
    expect(together(w, "apartment", "apartment_hall")).toBe(false);
    expect(together(w, "apartment", "riverton")).toBe(false);
    expect(together(w, "apartment", "apartment_bldg")).toBe(true);
    expect(mindLines(reg.context(w, s))).toEqual([]);
    expect(people(w, s).some((l) => l.includes("Rosa Delgado"))).toBe(false);
  });
});
