// Control (DESIGN §29.3 Control, BUILDS-N3 B1) on Port Alder: powers flow down chains of
// organization holders, read when asked. Jordan owns Harbor Holdings, which owns Harbor Towing, which
// owns Harbor Salvage: Jordan holds every power in both through it, as the last basis (`control`), so
// no grant he held before changes. Danny, Harbor Holdings' finance chief, spends for Harbor Towing
// within his position's limit. Once Harbor Towing seats its own Manager, she takes the staff powers
// (and passes them down to Harbor Salvage) while Jordan keeps seeing its money and changing its board.
// A 40% stake shows its money only; cross-holdings stop, and a chain stops at eight organizations.
// With Harbor Holdings as a trust's trustee, Jordan acts for the trust. A controller never pays
// himself from what he controls, and a trust whose trustees decide together holds one trustee's
// payment for a co-trustee's approval.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import { controlThrough, mayAct, orgPower } from "../../../src/engine/org";
import { createRegistry } from "../../../src/engine/registry-impl";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const MARCUS = "marcus_delgado";
const PRIYA = "priya_nair";
const DANNY = "danny_okafor";
const HOLD = "harbor_holdings";
const TOW = "harbor_towing";
const SALVAGE = "harbor_salvage";
const DINER = "bayside_diner";
const TRUST = "harbor_trust";

function company(id: string, name: string, owners: JsonObject[], fields: JsonObject = {}): EntityDef {
  return { id, kind: "business", name, tier: "background", fields: { owners, structure: "llc", ...fields }, relations: [] };
}

function link(world: WorldDoc, who: string, org: string, position: string): void {
  const e = world.entities[who];
  if (!e) throw new Error(`no ${who}`);
  e.relations.push({ type: "member_of", to: org, fields: { position } });
}

/** Port Alder with Jordan's chain of companies, a diner Harbor Holdings holds 40% of, and a trust it is trustee of. */
function harbor(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.entities[HOLD] = company(HOLD, "Harbor Holdings", [{ party: JORDAN, role: "owner", share: 100 }], { positions: [{ id: "cfo", title: "Finance chief", powers: ["money.spend"], limits: { payment: 50_000 } }] });
  world.entities[TOW] = company(TOW, "Harbor Towing", [{ party: HOLD, role: "owner", share: 100 }]);
  world.entities[SALVAGE] = company(SALVAGE, "Harbor Salvage", [{ party: TOW, role: "owner", share: 100 }]);
  world.entities[DINER] = company(DINER, "Bayside Diner", [
    { party: HOLD, role: "owner", share: 40 },
    { party: MARCUS, role: "owner", share: 60 },
  ]);
  world.entities[TRUST] = { id: TRUST, kind: "trust", name: "Harbor Trust", tier: "background", fields: { owners: [{ party: HOLD, role: "trustee" }, { party: PRIYA, role: "beneficiary", share: 100 }] }, relations: [] };
  link(world, DANNY, HOLD, "cfo");
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

describe("powers down a chain", () => {
  test("a founder holds every power in his company's subsidiary, and its own, through it", () => {
    const w = harbor();
    expect(orgPower(w.ctx, JORDAN, HOLD, "money.spend")).toEqual({ basis: "owner" });
    expect(orgPower(w.ctx, JORDAN, TOW, "money.spend")).toEqual({ basis: "control", id: HOLD, through: [HOLD] });
    expect(orgPower(w.ctx, JORDAN, SALVAGE, "org.govern")).toEqual({ basis: "control", id: HOLD, through: [HOLD, TOW] });
    expect(controlThrough(w.ctx, JORDAN, SALVAGE)).toEqual([HOLD, TOW]);
    expect(mayAct(w.ctx, JORDAN, SALVAGE, "staff.hire")).toMatchObject({ ok: true, grant: { basis: "control" } });
    // Nobody outside the chain holds anything there.
    expect(orgPower(w.ctx, MARCUS, TOW, "money.view")).toBeNull();
  });

  test("a parent's officer acts in the subsidiary within his position's powers and limits", () => {
    const w = harbor();
    expect(mayAct(w.ctx, DANNY, TOW, "money.spend", { amount: 40_000 })).toMatchObject({ ok: true, grant: { basis: "control", id: HOLD } });
    const over = mayAct(w.ctx, DANNY, TOW, "money.spend", { amount: 60_000 });
    expect(over).toMatchObject({ ok: false, limit: true });
    expect(over.ok ? "" : over.reason).toContain("$500.00");
    expect(orgPower(w.ctx, DANNY, TOW, "staff.hire")).toBeNull();
  });

  test("the subsidiary's own Manager takes the staff powers; money view and board changes still flow", () => {
    const w = harbor((world) => {
      const tow = world.entities[TOW];
      if (tow) tow.fields.positions = [{ id: "manager", title: "Manager", powers: ["staff.hire", "staff.fire", "staff.pay"] }];
      link(world, PRIYA, TOW, "manager");
    });
    expect(orgPower(w.ctx, JORDAN, TOW, "staff.hire")).toBeNull();
    expect(orgPower(w.ctx, PRIYA, TOW, "staff.hire")).toEqual({ basis: "position", id: "manager" });
    expect(orgPower(w.ctx, JORDAN, TOW, "money.view")?.basis).toBe("control");
    expect(orgPower(w.ctx, JORDAN, TOW, "members.appoint")?.basis).toBe("control");
    expect(orgPower(w.ctx, JORDAN, TOW, "money.spend")?.basis).toBe("control");
    // Below it, the staff powers flow from its Manager, not from Jordan.
    expect(orgPower(w.ctx, PRIYA, SALVAGE, "staff.hire")).toEqual({ basis: "control", id: TOW, through: [TOW] });
    expect(orgPower(w.ctx, JORDAN, SALVAGE, "staff.hire")).toBeNull();
  });

  test("a 40% holder's people see its money and nothing more", () => {
    const w = harbor();
    expect(orgPower(w.ctx, JORDAN, DINER, "money.view")).toEqual({ basis: "control", id: HOLD, through: [HOLD] });
    expect(orgPower(w.ctx, JORDAN, DINER, "money.spend")).toBeNull();
    expect(orgPower(w.ctx, JORDAN, DINER, "assets.use")).toBeNull();
  });

  test("cross-holdings stop, and a chain stops at eight organizations", () => {
    const w = harbor((world) => {
      world.entities.loop_a = company("loop_a", "Loop A", [{ party: "loop_b", role: "owner", share: 100 }]);
      world.entities.loop_b = company("loop_b", "Loop B", [{ party: "loop_a", role: "owner", share: 100 }]);
      for (let n = 1; n <= 9; n++) world.entities[`link_${n}`] = company(`link_${n}`, `Link ${n}`, [{ party: n === 1 ? JORDAN : `link_${n - 1}`, role: "owner", share: 100 }]);
    });
    expect(orgPower(w.ctx, JORDAN, "loop_a", "money.view")).toBeNull();
    expect(orgPower(w.ctx, JORDAN, "link_8", "money.view")).toMatchObject({ basis: "control", id: "link_1" });
    expect(orgPower(w.ctx, JORDAN, "link_8", "money.view")?.through).toHaveLength(7);
    expect(orgPower(w.ctx, JORDAN, "link_9", "money.view")).toBeNull();
  });

  test("with a company as a trust's trustee, its owner acts for the trust", () => {
    const w = harbor();
    expect(mayAct(w.ctx, JORDAN, TRUST, "money.spend")).toMatchObject({ ok: true, grant: { basis: "control", id: HOLD } });
    expect(orgPower(w.ctx, PRIYA, TRUST, "money.view")).toEqual({ basis: "owner" });
    expect(orgPower(w.ctx, PRIYA, TRUST, "money.spend")).toBeNull();
  });

  test("a controller can't pay himself from what he controls", () => {
    const w = harbor();
    const own = mayAct(w.ctx, JORDAN, TOW, "money.spend", { target: JORDAN, amount: 1_000 });
    expect(own.ok).toBe(false);
    expect(own.ok ? "" : own.reason).toBe("Harbor Towing's money pays for Harbor Towing, not for Jordan Ellis");
    // At Harbor Holdings, his own stake in its worth, he may.
    expect(mayAct(w.ctx, JORDAN, HOLD, "money.spend", { target: JORDAN, amount: 1_000 }).ok).toBe(true);
  });

  test("a trust whose trustees decide together holds one trustee's payment for a co-trustee's approval", () => {
    const w = harbor((world) => {
      const trust = world.entities[TRUST];
      if (trust) trust.fields = { ...trust.fields, trustees_decide: "together", owners: [{ party: HOLD, role: "trustee" }, { party: MARCUS, role: "trustee" }, { party: PRIYA, role: "beneficiary", share: 100 }] };
    });
    const held = mayAct(w.ctx, MARCUS, TRUST, "money.spend", { amount: 1_000 });
    expect(held).toEqual({ ok: false, reason: "The trustees of Harbor Trust decide together: another trustee approves this", limit: true });
    // Through the company that is the other trustee, the same.
    expect(mayAct(w.ctx, JORDAN, TRUST, "money.payout")).toMatchObject({ ok: false, limit: true });
    // Seeing its money needs no one else.
    expect(mayAct(w.ctx, MARCUS, TRUST, "money.view").ok).toBe(true);
  });
});
