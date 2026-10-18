// Selectors: every constraint must hold, lists match any value, class values nest, kinds follow
// inheritance, and group membership follows groups that are themselves members.

import { describe, expect, test } from "bun:test";
import { membersOf, selectEntities, selectorMatches } from "../../src/engine/selector";
import type { WorldDoc } from "../../src/shared/world";
import { baseWorld, POV, registryOf, startState } from "../packs/support";

function world(): WorldDoc {
  const base = baseWorld();
  return baseWorld({
    kinds: {
      ...base.kinds,
      group: { id: "group", label: "Group", fields: {} },
      guild: { id: "guild", label: "Guild", extends: "group", fields: {} },
    },
    classifications: {
      role: { id: "role", label: "Story role", multiple: false, values: { main: { label: "Main cast" }, extra: { label: "Extra" } } },
      disposition: {
        id: "disposition",
        label: "Disposition",
        multiple: true,
        values: { antagonist: { label: "Antagonist" }, villain: { label: "Villain", parent: "antagonist" }, ally: { label: "Ally" } },
      },
    },
    entities: {
      ...base.entities,
      [POV]: { ...base.entities[POV]!, class: { role: ["main"] }, tags: ["local"] },
      dev: { ...base.entities.dev!, class: { role: ["main"], disposition: ["villain"] }, relations: [{ type: "member_of", to: "crew" }] },
      crew: { id: "crew", kind: "group", name: "Dock crew", tier: "background", fields: {}, relations: [{ type: "member_of", to: "guild_hall" }] },
      guild_hall: { id: "guild_hall", kind: "guild", name: "Harbor guild", tier: "background", fields: {}, relations: [], tags: ["local"] },
    },
  });
}

describe("selectors", () => {
  const reg = registryOf();
  const w = world();
  const s = startState(w);

  test("an empty selector matches every entity; an unknown id matches nothing", () => {
    expect(selectEntities(reg, w, s, {})).toEqual(["crew", "dev", "guild_hall", POV]);
    expect(selectorMatches(reg, w, s, {}, "nobody")).toBe(false);
  });

  test("kinds follow inheritance", () => {
    expect(selectEntities(reg, w, s, { kind: ["group"] })).toEqual(["crew", "guild_hall"]);
    expect(selectEntities(reg, w, s, { kind: ["guild"] })).toEqual(["guild_hall"]);
  });

  test("a class value matches the values nested under it", () => {
    expect(selectEntities(reg, w, s, { class: { disposition: ["antagonist"] } })).toEqual(["dev"]);
    expect(selectEntities(reg, w, s, { class: { disposition: ["ally"] } })).toEqual([]);
  });

  test("every constraint must hold, and a list matches any of its values", () => {
    expect(selectEntities(reg, w, s, { class: { role: ["main"] }, tag: ["local"] })).toEqual([POV]);
    expect(selectEntities(reg, w, s, { tier: ["principal", "background"], tag: ["local"] })).toEqual(["guild_hall", POV]);
  });

  test("membership follows groups that are members of larger groups", () => {
    expect(selectEntities(reg, w, s, { memberOf: ["guild_hall"] })).toEqual(["crew", "dev"]);
    expect(selectEntities(reg, w, s, { memberOf: ["crew"] })).toEqual(["dev"]);
  });

  test("membership comes from state, so play can change it", () => {
    const later = structuredClone(s);
    later.entities.dev!.relations = [];
    expect(selectorMatches(reg, w, later, { memberOf: ["guild_hall"] }, "dev")).toBe(false);
  });

  test("a removed entity matches no selector and is no group's member", () => {
    const later = structuredClone(s);
    later.entities.dev!.fields.gone = true;
    expect(selectEntities(reg, w, later, {})).toEqual(["crew", "guild_hall", POV]);
    expect(selectorMatches(reg, w, later, { ids: ["dev"] }, "dev")).toBe(false);
    expect(membersOf(reg, w, later, "guild_hall")).toEqual([]);
  });
});
