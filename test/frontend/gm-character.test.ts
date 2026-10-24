// GM's Character sheet (the Character model, DESIGN §7): a person opens it in place of the generic
// entity sheet, its controls send one edit each, and a link between a character's GM pages opens
// the page asked for once.

import { describe, expect, test } from "bun:test";
import { initialUi } from "../../src/frontend/app";
import { bedOp, gmPageFor, homeOp, moveOp, partySwitchOp, relationRows, routineStanding } from "../../src/frontend/gm/character-ops";
import { focusTaken, gmOpen, revealTruth } from "../../src/frontend/gm/gate";
import type { PlaceRef, ThingRef } from "../../src/shared/character";
import { PARTY_RELATION } from "../../src/shared/party";
import type { GmEntity } from "../../src/shared/state-view";

const person = (id: string, more: Partial<GmEntity> = {}): GmEntity => ({ id, name: id, kind: "person", tier: "supporting", agent: true, pov: false, person: true, gone: false, spawned: false, visibility: "public", place: "diner", holder: null, claimed: false, fields: [], relations: [], levels: [], class: {}, tags: [], sheet: null, life: { state: "alive", label: "Alive", acts: true, everyone: true, aware: [], unaware: [] }, ...more });
const place = (id: string, path: string[] = []): PlaceRef => ({ id, name: id, path, parent: null, visibility: "public" });
const sofa: ThingRef = { id: "sofa", name: "Sofa", kind: "furniture", place: place("flat") };

describe("the GM character sheet", () => {
  test("a person opens the character sheet; anything else, the entity sheet", () => {
    expect(gmPageFor(person("rosie"))).toBe("character");
    expect(gmPageFor({ person: false })).toBe("entity");
  });

  test("Move them… sends a move to the place picked, and nothing for where they already are", () => {
    expect(moveOp(person("rosie"), place("back_office", ["Rosie's Diner"]))).toEqual({ op: "move", entity: "rosie", to: "back_office" });
    expect(moveOp(person("rosie"), place("diner"))).toBeNull();
    expect(moveOp(person("rosie"), null)).toBeNull();
  });

  test("choosing a bed writes `bed`: a thing's or a place's id, or none to sleep at home; home is set or cleared", () => {
    expect(bedOp(person("rosie"), { kind: "item", place: null, item: sofa })).toEqual({ op: "set", entity: "rosie", field: "bed", value: "sofa" });
    expect(bedOp(person("rosie"), { kind: "place", place: place("guest_room"), item: null })).toEqual({ op: "set", entity: "rosie", field: "bed", value: "guest_room" });
    expect(bedOp(person("rosie"), { kind: "home", place: null, item: null })).toEqual({ op: "set", entity: "rosie", field: "bed", value: null });
    expect(homeOp(person("rosie"), place("flat"))).toEqual({ op: "set", entity: "rosie", field: "home", value: "flat" });
  });

  test("the party switch sends the link on and the unlink off, and nothing when it's already so", () => {
    const pov = person("sam", { pov: true });
    const rosie = person("rosie");
    const gm = { entities: [pov, rosie] };
    expect(partySwitchOp(rosie, gm, true)).toEqual({ op: "link", rel: PARTY_RELATION, from: "rosie", to: "sam" });
    expect(partySwitchOp(rosie, gm, false)).toBeNull();
    const along = person("rosie", { relations: [{ type: PARTY_RELATION, to: "sam", toName: "Sam" }] });
    expect(partySwitchOp(along, { entities: [pov, along] }, false)).toEqual({ op: "unlink", rel: PARTY_RELATION, from: "rosie", to: "sam" });
  });

  test("a link to a character's mind opens Minds on them once, the gate left as it is", () => {
    const linked = gmOpen(revealTruth(initialUi(false)), "minds.gm", "rosie");
    expect(linked.gm).toEqual({ revealed: true, section: "minds.gm", focus: "rosie" });
    expect(focusTaken(linked).gm).toEqual({ revealed: true, section: "minds.gm" });
  });

  test("the Routine section says why their routine and what they're doing differ", () => {
    const places = [
      { id: "diner", parent: null },
      { id: "counter", parent: "diner" },
      { id: "home", parent: null },
    ];
    // Informative and off never move them, wherever they are.
    expect(routineStanding("informative", false, "diner", "home", places)).toBe("context");
    expect(routineStanding("off", true, "diner", "home", places)).toBe("off");
    // Enforced: a story hold comes first; a room inside the block's place is there.
    expect(routineStanding("enforced", true, "diner", "home", places)).toBe("held");
    expect(routineStanding("enforced", false, "diner", "counter", places)).toBe("living");
    expect(routineStanding("enforced", false, "diner", "home", places)).toBe("elsewhere");
    expect(routineStanding("enforced", false, null, "home", places)).toBe("living");
  });

  test("relations read as the world's words on the sheet, and an undeclared field never shows on either page", () => {
    const regard = { type: "regard", to: "priya", toName: "Priya", fields: { warmth: 25, t: 0 }, value: 27.7 };
    const party = { type: PARTY_RELATION, to: "sam", toName: "Sam" };
    const knows = { type: "knows", to: "dev", toName: "Dev" };
    const gm = { relationTypes: [{ id: "regard", label: "Regard", from: "person", to: "person", fields: [{ id: "warmth", label: "warmth", type: "number" as const }] }] };
    const rosie = person("rosie", { relations: [knows, regard, party] });
    // The sheet: the model's words first, in its order; one it has no words for still listed after;
    // the party, shown as its switch, left out.
    const sheet = relationRows(rosie, gm, [{ type: "regard", typeLabel: "Regard", group: "feelings", to: { id: "priya", name: "Priya" }, words: "warm" }]);
    expect(sheet.map((r) => r.relation)).toEqual([regard, knows]);
    expect(sheet[0]?.detail).toBe("warm");
    // An entity's page: every relation, its declared fields and value, never the bookkeeping `t`.
    const page = relationRows(rosie, gm);
    expect(page.map((r) => r.relation.type)).toEqual(["knows", "regard", PARTY_RELATION]);
    expect(page[1]?.detail).toContain("25");
    expect(page[1]?.detail).not.toMatch(/\bt\b/);
    expect(page[2]?.detail).toBeUndefined();
  });
});
