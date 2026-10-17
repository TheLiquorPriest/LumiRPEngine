// The touched record (DESIGN §4.3 `migrate`): what applied events wrote of entities' definitions,
// kept inside event apply, names only.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../src/shared/world";
import { applyMarker, EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { createRegistry } from "../../src/engine/registry-impl";
import type { WorldState } from "../../src/engine/state";
import { touchedAspect, touchedField, touchedRelation } from "../../src/engine/touched";
import { ALL_PACKS } from "../../src/packs/index";
import { baseWorld, fold, POV, startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

/** The base world with a checking account for Sam. */
function world(): WorldDoc {
  const w = baseWorld();
  w.entities.acct = { id: "acct", kind: "account", name: "Sam's checking", tier: "background", fields: { owner: POV, type: "checking", opening: 5000 }, relations: [] };
  return w;
}

function played(events: Parameters<typeof fold>[3]): WorldState {
  const w = world();
  return fold(reg, w, startState(w, reg), events);
}

describe("the touched record", () => {
  test("names the fields, relations, levels, new entities and balances applied events wrote, never values", () => {
    const state = played([
      { type: "set", entity: "dev", field: "place", value: "home" },
      { type: "add", entity: POV, field: "cash", delta: -10 },
      { type: "link", rel: "knows", from: POV, to: "dev" },
      { type: "spawn", entity: { id: "coin", kind: "person", name: "Coin", tier: "background", fields: {}, relations: [] } },
      { type: "engine.entity", data: { entity: "dev", tier: "supporting" } },
      { type: "post", lines: [{ account: "acct", amount: -300 }, { account: `${EXTERNAL_ACCOUNT_PREFIX}shop`, amount: 300 }], memo: "Bought a lamp" },
    ]);
    applyMarker(state, { kind: "resolve", domain: "money", scope: { entity: POV }, to: 2 });
    expect(touchedField(state, "dev", "place")).toBe(true);
    expect(touchedField(state, "dev", "home")).toBe(false);
    expect(touchedField(state, POV, "cash")).toBe(true);
    expect(touchedRelation(state, POV, "knows", "dev")).toBe(true);
    expect(touchedAspect(state, "coin", "spawned")).toBe(true);
    expect(touchedAspect(state, "dev", "tier")).toBe(true);
    expect(touchedAspect(state, "dev", "agent")).toBe(false);
    expect(touchedAspect(state, POV, "levels")).toBe(true);
    expect(touchedAspect(state, "acct", "posted")).toBe(true);
    // Names only: none of the values written is in it.
    for (const value of ['"home"', "supporting", "lamp"]) expect(JSON.stringify(state.packs.engine?.touched)).not.toContain(value);
  });

  test("a change that went back to where it was still counts", () => {
    const state = played([
      { type: "add", entity: "dev", field: "cash", delta: 5 },
      { type: "add", entity: "dev", field: "cash", delta: -5 },
    ]);
    expect(state.entities.dev?.fields.cash).toBe(900);
    expect(touchedField(state, "dev", "cash")).toBe(true);
  });

  test("a materialization's opening posting leaves the balance untouched; its generated detail counts", () => {
    const state = played([
      {
        type: "materialize",
        entity: POV,
        domain: "money",
        generatorVersion: 1,
        tablesRevision: "t",
        events: [
          { type: "post", lines: [{ account: "acct", amount: 5000 }, { account: `${EXTERNAL_ACCOUNT_PREFIX}${POV}`, amount: -5000 }], memo: "Opening balances" },
          { type: "set", entity: POV, field: "skill", value: 3 },
        ],
      },
    ]);
    expect(touchedAspect(state, "acct", "posted")).toBe(false);
    expect(touchedField(state, POV, "skill")).toBe(true);
  });
});
