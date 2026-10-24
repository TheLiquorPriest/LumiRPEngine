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

/**
 * Riverton and, apart from it, Eastport: a town whose two halves only a drive joins, with a mill in
 * its north drawn room by room, every room a one-minute walk from the next and the floors joined by
 * stairs, and on the top floor a suite with a bath in it. A bakery stands beside the mill in North
 * Eastport with no route to it: the half's sites are each their own island.
 */
function eastport(): WorldDoc {
  const w = modernUsWorld("w", "R");
  const place = (id: string, name: string, parent?: string): void => {
    w.places[id] = { id, name, ...(parent ? { parent } : {}), fields: {} };
  };
  const walk = (from: string, to: string): void => {
    const id = `walk_${from}_${to}`;
    w.routes[id] = { id, from, to, modes: { walk: { minutes: 1 } }, bidirectional: true };
  };
  place("eastport", "Eastport");
  place("eastport_north", "North Eastport", "eastport");
  place("eastport_south", "South Eastport", "eastport");
  w.routes.eastport_drive = { id: "eastport_drive", from: "eastport_north", to: "eastport_south", modes: { road: { minutes: 9, distanceKm: 7 } }, bidirectional: true };
  place("mill", "The Mill", "eastport_north");
  place("bakery", "The Bakery", "eastport_north");
  for (const floor of ["f1", "f2"]) {
    place(`mill_${floor}`, `Floor ${floor}`, "mill");
    for (let i = 1; i <= 6; i++) place(`mill_${floor}_room${i}`, `Room ${i}`, `mill_${floor}`);
    for (let i = 1; i < 6; i++) walk(`mill_${floor}_room${i}`, `mill_${floor}_room${i + 1}`);
  }
  walk("mill_f1_room1", "mill_f2_room1");
  place("mill_f2_suite", "The suite", "mill_f2");
  place("mill_f2_bath", "The bath", "mill_f2_suite");
  walk("mill_f2_room6", "mill_f2_suite");
  walk("mill_f2_suite", "mill_f2_bath");
  return w;
}

describe("who is with the player character", () => {
  test("in a building drawn room by room, someone on the floor is with the player character in the bath of a suite on it; someone at the building isn't, nor is anyone across a town a drive joins", () => {
    const w = eastport();
    expect(together(w, "mill_f2_bath", "mill_f2")).toBe(true);
    expect(together(w, "mill_f2_bath", "mill")).toBe(false);
    expect(together(w, "eastport_north", "eastport")).toBe(false);
    expect(together(w, "mill", "eastport")).toBe(false);
    // As People reads it: Maya on the floor is with the POV in the bath, Jordan somewhere in the mill isn't.
    const s = at(w, at(w, at(w, startState(w), w.pov, "mill_f2_bath"), "maya", "mill_f2"), "jordan", "mill");
    const lines = people(w, s);
    expect(lines.some((l) => l.includes("Maya Chen"))).toBe(true);
    expect(lines.some((l) => l.includes("Jordan Price"))).toBe(false);
  });

  test("someone placed at a town whose sites are each their own island isn't with the player character at one of them, nor on a floor of it", () => {
    const w = eastport();
    // No walk joins the mill and the bakery: being somewhere in North Eastport isn't being at the mill.
    expect(together(w, "mill", "eastport_north")).toBe(false);
    expect(together(w, "mill_f2", "eastport_north")).toBe(false);
    // Short walks join the mill's floors and the floor's rooms, so the mill stays one building.
    expect(together(w, "mill_f2", "mill")).toBe(true);
    expect(together(w, "mill_f2_bath", "mill_f2")).toBe(true);
  });

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
