// An organization op (ORG-SPEC §7.2) as the GM edit `{op: "org", change}` runs it, on Port Alder:
// the History lines its ops write name the people they are about by id, so with Danny hidden from
// Jordan, Jordan's Alder Automotive reads "someone" where the GM's reads Danny Okafor; an entry
// change's line says a key Jordan can't see as "a key"; dues changed by their amount alone keep
// the cadence and the day they fall on; and a company admitted as a trust's Director (an officer
// that is an entity, DESIGN §29.1) sits in it, its owner acting through it.

import { describe, expect, test } from "bun:test";
import type { JsonValue } from "../../../src/shared/json";
import type { OrgOp } from "../../../src/shared/org-ops";
import type { EditOp } from "../../../src/shared/protocol";
import type { WorldDoc } from "../../../src/shared/world";
import { resolveEdit } from "../../../src/engine/edits";
import { orgPower } from "../../../src/engine/org";
import { createRegistry } from "../../../src/engine/registry-impl";
import { Working } from "../../../src/engine/working";
import { orgHistory } from "../../../src/packs/orgs/core/log";
import { buildOrgView } from "../../../src/packs/orgs/core/view";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const HOUSEHOLD = "household_kowalczyk";
const DANNY = "danny_okafor";

/** Port Alder as Jordan plays it, with the world changes a test makes. */
function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

/** GM edits applied, as GM → Orgs, `gm_org` and `lre_gm_edit` send them. */
function edit(w: Working, ops: EditOp[]): void {
  const out = resolveEdit(reg, w.world, w.state, ops, { gm: true, runSeed: "orgs-ops" });
  if ("rejection" in out && out.rejection) throw new Error(`refused: ${out.rejection.reason}`);
  for (const e of "events" in out ? out.events : []) {
    const refused = w.apply(e);
    if (refused) throw new Error(`dropped: ${refused.reason}`);
  }
}

function org(w: Working, change: OrgOp): void {
  edit(w, [{ op: "org", change }]);
}

/** An organization's History as `viewer` reads it (null: the GM), newest first. */
function history(w: Working, id: string, viewer: string | null): string[] {
  return (buildOrgView(w.ctx, id, viewer)?.history ?? []).map((l) => l.text);
}

describe("the History an op writes (ORG-SPEC §4.4, §7.2)", () => {
  test("with Danny hidden from Jordan, the lines of his pay, his delegation, his firing and his hiring read someone to Jordan and his name to the GM", () => {
    const w = portAlder((world) => {
      const danny = world.entities[DANNY];
      if (danny) danny.visibility = "secret";
    });
    org(w, { do: "pay", job: "job_danny_mechanic", rate: 2600 });
    org(w, { do: "delegate", org: SHOP, to: DANNY, powers: ["money.view"], by: "marcus_delgado" });
    org(w, { do: "fire", job: "job_danny_mechanic", why: "the shop is slow" });
    org(w, { do: "hire", org: SHOP, who: DANNY, title: "Detailer" });
    const gm = history(w, SHOP, null).slice(0, 4);
    expect(gm).toEqual(["Hired Danny Okafor as Detailer", "Let Danny Okafor go: the shop is slow", "Marcus Delgado let Danny Okafor see its money", "Set Danny Okafor's pay to $26.00"]);
    const jordan = history(w, SHOP, "pov").slice(0, 4);
    expect(jordan).toEqual(["Hired someone as Detailer", "Let someone go: the shop is slow", "Marcus Delgado let someone see its money", "Set someone's pay to $26.00"]);
    expect(JSON.stringify(buildOrgView(w.ctx, SHOP, "pov")?.history)).not.toContain("Danny");
    // Each line keeps whom it names, by id.
    expect(orgHistory(w.state, SHOP)[2]?.names?.map((n) => n.id)).toEqual(["marcus_delgado", DANNY]);
  });

  test("an entry change's line says a key Jordan can't see as a key, never its name", () => {
    const w = portAlder((world) => {
      world.entities.back_door_key = { id: "back_door_key", kind: "item", name: "Back door key", tier: "background", visibility: "secret", fields: { owner: "marcus_delgado" }, relations: [{ type: "in", to: "marcus_delgado" }] };
    });
    org(w, { do: "entry", place: "alder_automotive", entry: "staff", keys: ["back_door_key"] });
    const [line] = history(w, SHOP, null);
    expect(line).toContain("keys: a key");
    expect(line).not.toContain("Back door key");
    expect(history(w, SHOP, "pov")[0]).toBe(line);
  });
});

describe("dues (ORG-SPEC §3.8, §7.2)", () => {
  test("an amount alone keeps the cadence and the day; a new cadence takes its own day; none ends them", () => {
    const w = portAlder();
    edit(w, [{ op: "set", entity: HOUSEHOLD, field: "dues", value: [{ cents: 1500, every: "week", day: 5 }] }]);
    const dues = (): JsonValue | undefined => w.state.entities[HOUSEHOLD]?.fields.dues;
    org(w, { do: "dues", org: HOUSEHOLD, cents: 2000 });
    expect(dues()).toEqual([{ cents: 2000, every: "week", day: 5 }]);
    expect(orgHistory(w.state, HOUSEHOLD)[0]?.text).toBe("Set dues of $20.00 a week");
    org(w, { do: "dues", org: HOUSEHOLD, cents: 2500, every: "week" });
    expect(dues()).toEqual([{ cents: 2500, every: "week", day: 5 }]);
    org(w, { do: "dues", org: HOUSEHOLD, cents: 6000, every: "month" });
    expect(dues()).toEqual([{ cents: 6000, every: "month" }]);
    expect(orgHistory(w.state, HOUSEHOLD)[0]?.text).toBe("Set dues of $60.00 a month");
    org(w, { do: "dues", org: HOUSEHOLD, cents: null });
    expect(dues()).toBeNull();
  });
});

describe("an organization as an officer (DESIGN §29.1)", () => {
  test("Alder Automotive admitted as a trust's Director: seated by its membership, on the trust's page as a company, its owner acting for the trust through it", () => {
    const w = portAlder((world) => {
      world.entities.alder_trust = { id: "alder_trust", kind: "trust", name: "Alder Family Trust", tier: "background", fields: { owners: [{ party: "pov", role: "beneficiary", share: 100 }], positions: [{ id: "director", title: "Director", powers: ["money.view", "money.spend", "members.admit"] }] }, relations: [] };
    });
    org(w, { do: "admit", org: "alder_trust", who: SHOP, position: "director", why: "the shop sits on its board" });
    expect(w.state.entities[SHOP]?.relations.find((r) => r.type === "member_of" && r.to === "alder_trust")?.fields).toMatchObject({ position: "director" });
    expect(history(w, "alder_trust", null)[0]).toBe("Admitted Alder Automotive as Director: the shop sits on its board");
    const page = buildOrgView(w.ctx, "alder_trust", null);
    expect(page?.people.find((p) => p.id === SHOP)).toMatchObject({ org: "company", position: { id: "director", title: "Director" } });
    expect(page?.positions.find((p) => p.id === "director")?.holders).toEqual([SHOP]);
    expect(page?.above).toEqual([{ id: SHOP, name: "Alder Automotive", type: "company", share: null, votes: null, controlled: false, role: null, position: { id: "director", title: "Director" }, delegation: false }]);
    expect(orgPower(w.ctx, "marcus_delgado", "alder_trust", "money.spend")).toEqual({ basis: "control", id: SHOP, through: [SHOP] });
    // Removed, it holds nothing there.
    org(w, { do: "remove", org: "alder_trust", who: SHOP, why: "it stepped down" });
    expect(orgPower(w.ctx, "marcus_delgado", "alder_trust", "money.spend")).toBeNull();
  });
});
