// The organization model (ORG-SPEC §3, §11 Phase 1 Model), on the starter worlds: who holds which
// power in Alder Automotive and the Kowalczyks and why, who works where (a place employer too), the
// places that are an organization's, the household Head by her title, a company's things never its
// staff's, membership through a job, the party and position selectors, a position's and a
// delegation's limits; and, on every starter, Cast's groups change only by the companies people own
// or work for, and every schedule's owners are unchanged.

import { describe, expect, test } from "bun:test";
import { ownersIn } from "../../src/shared/finance";
import type { JsonObject } from "../../src/shared/json";
import type { EntityDef, WorldDoc } from "../../src/shared/world";
import { owns } from "../../src/engine/access";
import { migrateWorld } from "../../src/engine/authoring";
import { acts } from "../../src/engine/life";
import { headOf, isStaff, mayAct, membersOfOrg, orgPlaces, orgPower, orgPowers, orgTitle, orgTypeOf } from "../../src/engine/org";
import { createRegistry } from "../../src/engine/registry-impl";
import { allSchedules, scheduleOwners } from "../../src/engine/schedules";
import { isGone, kindIs } from "../../src/engine/scope";
import { GROUP_KIND, isMemberOf, linkedMemberOf, selectEntities } from "../../src/engine/selector";
import { canSeeEntity } from "../../src/engine/visibility";
import { Working } from "../../src/engine/working";
import { buildCastView } from "../../src/packs/castlife/core/index";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const HOUSEHOLD = "household_kowalczyk";
const MARCUS = "marcus_delgado";
const DANNY = "danny_okafor";
const JORDAN = "pov";

/** Port Alder, with the world changes a test makes. */
function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

function entity(world: WorldDoc, id: string): EntityDef {
  const e = world.entities[id];
  if (!e) throw new Error(`no ${id}`);
  return e;
}

/** Puts Danny's job in a position Alder Automotive defines. */
function foreman(world: WorldDoc, position: JsonObject): void {
  entity(world, SHOP).fields.positions = [position];
  const job = entity(world, "job_danny_mechanic");
  job.fields = { ...job.fields, position: "shop_foreman" };
}

describe("the organization model on Port Alder", () => {
  test("Marcus may hire for Alder Automotive as its owner; Jordan, its mechanic, holds no power there", () => {
    const w = portAlder();
    expect(orgTypeOf(w.ctx, SHOP)).toBe("company");
    expect(orgPower(w.ctx, MARCUS, SHOP, "staff.hire")).toEqual({ basis: "owner" });
    expect(orgPower(w.ctx, JORDAN, SHOP, "staff.hire")).toBeNull();
    expect(orgPowers(w.ctx, JORDAN, SHOP)).toEqual([]);
    expect(orgPowers(w.ctx, MARCUS, SHOP)).toHaveLength(21);
  });

  test("Jordan works at Alder Automotive, and Jess at the Rusty Anchor, a place employer", () => {
    const w = portAlder();
    expect(isStaff(w.ctx, JORDAN, SHOP)).toEqual({ basis: "job", id: "job_pov_mechanic" });
    expect(isStaff(w.ctx, "jess_kowalczyk", "rusty_anchor")).toEqual({ basis: "job", id: "job_jess_kowalczyk" });
    expect(isStaff(w.ctx, "maddie_kowalczyk", "rusty_anchor")).toBeNull();
  });

  test("the shop's places are its own, and the Kowalczyks' is their home", () => {
    const w = portAlder();
    expect(orgPlaces(w.ctx, SHOP)).toEqual(["alder_automotive"]);
    expect(orgPlaces(w.ctx, HOUSEHOLD)).toEqual(["harbor_street_114"]);
  });

  test("Helen heads the Kowalczyks by her title, with every power; Jess sees their money and uses their things", () => {
    const w = portAlder();
    expect(headOf(w.ctx, HOUSEHOLD)).toBe("helen_kowalczyk");
    expect(orgPower(w.ctx, "helen_kowalczyk", HOUSEHOLD, "money.spend")).toEqual({ basis: "position", id: "head" });
    expect(orgPowers(w.ctx, "helen_kowalczyk", HOUSEHOLD)).toHaveLength(21);
    expect(orgPowers(w.ctx, "jess_kowalczyk", HOUSEHOLD).map((p) => p.power)).toEqual(["money.view", "assets.use"]);
    expect(orgTitle(w.ctx, "helen_kowalczyk", HOUSEHOLD)).toBe("head");
    expect(orgTitle(w.ctx, "jess_kowalczyk", HOUSEHOLD)).toBe("member");
    // A household that defines its own Head position heads by it, with the powers it gives.
    const own = portAlder((world) => {
      entity(world, HOUSEHOLD).fields.positions = [{ id: "head", title: "Head of the house", powers: ["money.view", "money.spend"] }];
      const jess = entity(world, "jess_kowalczyk").relations.find((r) => r.type === "member_of");
      if (jess) jess.fields = { ...jess.fields, position: "head" };
    });
    expect(headOf(own.ctx, HOUSEHOLD)).toBe("jess_kowalczyk");
    expect(orgPower(own.ctx, "jess_kowalczyk", HOUSEHOLD, "money.spend")).toEqual({ basis: "position", id: "head" });
    expect(orgPower(own.ctx, "helen_kowalczyk", HOUSEHOLD, "money.spend")).toBeNull();
  });

  test("a thing Alder Automotive owns isn't Jordan's, though he works there and belongs to it", () => {
    const jack = (fields: JsonObject): EntityDef => ({ id: "shop_jack", kind: "item", name: "Floor jack", tier: "background", fields, relations: [] });
    const w = portAlder((world) => {
      world.entities.shop_jack = jack({ owner: SHOP, place: "alder_automotive" });
    });
    expect(isMemberOf(w.ctx, JORDAN, SHOP)).toBe(true);
    expect(owns(w.ctx, JORDAN, "shop_jack")).toBe(false);
    expect(owns(w.ctx, MARCUS, "shop_jack")).toBe(false);
    // Nor an officer's (a member by `member_of`), now that a business is a group.
    const officer = portAlder((world) => {
      world.entities.shop_jack = jack({ owner: SHOP });
      entity(world, DANNY).relations.push({ type: "member_of", to: SHOP, fields: { role: "Director" } });
    });
    expect(isMemberOf(officer.ctx, DANNY, SHOP)).toBe(true);
    expect(owns(officer.ctx, DANNY, "shop_jack")).toBe(false);
    expect(orgTitle(officer.ctx, DANNY, SHOP)).toBe("Director");
  });

  test("Jordan is a member of Alder Automotive through his job, and its people are its owner and its staff", () => {
    const w = portAlder();
    expect(isMemberOf(w.ctx, JORDAN, SHOP)).toBe(true);
    expect(isMemberOf(w.ctx, MARCUS, SHOP)).toBe(true);
    expect(isMemberOf(w.ctx, "jess_kowalczyk", SHOP)).toBe(false);
    expect(selectEntities(reg, w.world, w.state, { memberOf: [SHOP] })).toEqual([DANNY, MARCUS, JORDAN]);
    expect(membersOfOrg(w.ctx, SHOP).map((r) => [r.who, r.how, r.title ?? null])).toEqual([
      [MARCUS, "owner", null],
      [DANNY, "staff", "Mechanic"],
      [JORDAN, "staff", "Mechanic"],
    ]);
    expect(orgTitle(w.ctx, MARCUS, SHOP)).toBe("Owner");
    expect(orgTitle(w.ctx, JORDAN, SHOP)).toBe("Mechanic");
  });

  test("a company in a family brings its owners and staff into it", () => {
    const w = portAlder((world) => {
      world.entities.delgado_family = { id: "delgado_family", kind: "family", name: "The Delgados", tier: "background", fields: {}, relations: [] };
      entity(world, SHOP).relations.push({ type: "member_of", to: "delgado_family" });
    });
    expect(isMemberOf(w.ctx, JORDAN, "delgado_family")).toBe(true);
    expect(membersOfOrg(w.ctx, "delgado_family").map((r) => [r.who, r.how, r.via ?? null])).toEqual([
      [SHOP, "member", null],
      [MARCUS, "owner", SHOP],
      [DANNY, "staff", SHOP],
      [JORDAN, "staff", SHOP],
    ]);
  });

  test("the party selector picks the player character's people by tier, and the position selector the holders of a position", () => {
    const w = portAlder((world) => {
      entity(world, DANNY).relations.push({ type: "travels_with", to: JORDAN });
      entity(world, "priya_nair").relations.push({ type: "travels_with", to: JORDAN, fields: { tier: "ally" } });
      foreman(world, { title: "Shop foreman", powers: ["staff.hire", "money.spend"] });
    });
    expect(selectEntities(reg, w.world, w.state, { party: ["core"] })).toEqual([DANNY]);
    expect(selectEntities(reg, w.world, w.state, { party: ["core", "ally"] })).toEqual([DANNY, "priya_nair"]);
    expect(selectEntities(reg, w.world, w.state, { position: ["shop_foreman"] })).toEqual([DANNY]);
    expect(selectEntities(reg, w.world, w.state, { memberOf: [HOUSEHOLD], position: ["shop_foreman"] })).toEqual([]);
    expect(orgPower(w.ctx, DANNY, SHOP, "staff.hire")).toEqual({ basis: "position", id: "shop_foreman" });
    // Spending implies seeing the money it reaches.
    expect(orgPower(w.ctx, DANNY, SHOP, "money.view")).toEqual({ basis: "position", id: "shop_foreman" });
    expect(orgTitle(w.ctx, DANNY, SHOP)).toBe("Shop foreman");
  });

  test("a position's and a delegation's limits refuse in their words; a delegation ends at its until", () => {
    const w = portAlder((world) => {
      foreman(world, { title: "Shop foreman", powers: ["staff.hire", "staff.pay", "money.view", "money.spend"], limits: { payment: 50000 } });
      entity(world, JORDAN).relations.push({ type: "acts_for", to: SHOP, fields: { powers: ["money.spend"], payment: 20000, by: MARCUS }, until: 7 * 1440 });
    });
    expect(mayAct(w.ctx, DANNY, SHOP, "money.spend", { amount: 60000 })).toEqual({ ok: false, reason: "Over your limit of $500.00 a payment for Alder Automotive" });
    expect(mayAct(w.ctx, DANNY, SHOP, "money.spend", { amount: 40000 })).toEqual({ ok: true, grant: { basis: "position", id: "shop_foreman" } });
    expect(mayAct(w.ctx, DANNY, SHOP, "money.spend", { amount: 10000, target: DANNY })).toEqual({ ok: false, reason: "Alder Automotive's money pays for Alder Automotive, not for Danny Okafor" });
    expect(mayAct(w.ctx, JORDAN, SHOP, "money.spend", { amount: 15000 })).toEqual({ ok: true, grant: { basis: "delegate", id: MARCUS } });
    expect(mayAct(w.ctx, JORDAN, SHOP, "money.spend", { amount: 25000 })).toEqual({ ok: false, reason: "Over your limit of $200.00 a payment for Alder Automotive" });
    expect(mayAct(w.ctx, JORDAN, SHOP, "delegate")).toEqual({ ok: false, reason: "Alder Automotive: you may not delegate its powers" });
    // Marcus pays himself from what is his: the fiduciary rule guards money one only manages.
    expect(mayAct(w.ctx, MARCUS, SHOP, "money.spend", { amount: 10000, target: MARCUS }).ok).toBe(true);
    const later = new Working(reg, w.world, { ...w.state, clock: 8 * 1440 });
    expect(orgPower(later.ctx, JORDAN, SHOP, "money.spend")).toBeNull();
  });
});

describe("on every starter, membership follows organizations and schedules keep their owners", () => {
  for (const [template, make] of Object.entries(STARTER_WORLDS)) {
    test(`${template}: Cast's groups change only by the companies people own or work for; every schedule's owners are unchanged`, () => {
      const world = make("w", template);
      const w = new Working(reg, world, startState(world, reg));
      const { state } = w;
      const company = (id: string): boolean => orgTypeOf(w.ctx, id) === "company";
      const shown = (id: string): boolean => canSeeEntity(reg, w.world, state, world.pov, id) && !isGone(state, id);
      const groupBefore = (id: string): boolean => kindIs(reg, w.world, state.entities[id]?.kind ?? "", GROUP_KIND) && !company(id);
      const theirs = (who: string, org: string): boolean => ownersIn(state.entities[org]?.fields ?? {}).some((o) => o.party === who) || isStaff(w.ctx, who, org) !== null;
      const expected = (who: string): string[] =>
        Object.keys(state.entities)
          .filter((g) => shown(g) && ((groupBefore(g) && linkedMemberOf(state, who, g)) || (company(g) && theirs(who, g))))
          .sort();
      const cast = buildCastView(w.ctx);
      expect(cast.people.length).toBeGreaterThan(0);
      for (const p of cast.people) expect([p.id, p.groups.map((g) => g.id).sort()]).toEqual([p.id, expected(p.id)]);
      if (template === "modern_slice_of_life") expect(cast.mine.map((m) => m.id)).toContain(SHOP);
      expect(cast.mine.map((m) => m.id).sort()).toEqual(expected(world.pov));
      // A schedule a business owns stays its own; a group's goes to its members by their links, as before.
      const before = (owner: unknown): string[] | null => {
        const e = typeof owner === "string" ? state.entities[owner] : undefined;
        if (typeof owner !== "string" || !e) return null;
        if (isGone(state, owner)) return [];
        const ids = !groupBefore(owner)
          ? [owner]
          : Object.keys(state.entities)
              .sort()
              .filter((id) => id !== owner && !kindIs(reg, w.world, state.entities[id]?.kind ?? "", GROUP_KIND) && !isGone(state, id) && linkedMemberOf(state, id, owner));
        return ids.filter((id) => acts(w.world, state, id));
      };
      for (const s of [...allSchedules(reg, w.world), ...Object.values(w.world.routines ?? {})]) {
        const was = before(s.owner);
        if (was !== null) expect([s.id, scheduleOwners(reg, w.world, state, s)]).toEqual([s.id, was]);
      }
    });
  }
});

describe("old worlds read as they were written", () => {
  for (const [template, make] of Object.entries(STARTER_WORLDS)) {
    test(`${template}: migrateWorld returns the very world`, () => {
      const world = make("w", template);
      expect(migrateWorld(world)).toBe(world);
    });
  }
});
