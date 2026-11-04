// The Orgs tab's views (ORG-SPEC §4, §11 Phase 1 Views), on Port Alder: Jordan's home lists his
// party (him alone), Alder Automotive (Mechanic) under where he belongs and the Kowalczyks under
// those he knows; his Alder Automotive page reads "Mechanic since 12 Jan 2026, Marcus Delgado runs
// it", lists Marcus (Owner), Danny (Mechanic) and him (Mechanic), and has no money section, while
// Marcus's has money, ownership and taxes; a member Jordan can't see is counted under an opaque id.

import { describe, expect, test } from "bun:test";
import { opaqueId } from "../../../src/shared/hash";
import type { JsonValue } from "../../../src/shared/json";
import type { OrgListView, OrgView } from "../../../src/shared/org-view";
import type { WorldDoc } from "../../../src/shared/world";
import { createRegistry } from "../../../src/engine/registry-impl";
import { readPass } from "../../../src/engine/read-pass";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const HOUSEHOLD = "household_kowalczyk";

/** Port Alder as `pov` sees it, with the world changes a test makes. */
function portAlder(pov: string, patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.pov = pov;
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

/** A panel as the state view builds it, in one read pass. */
function panel(w: Working, id: string): JsonValue {
  const view = reg.views.find((v) => v.panel === id);
  if (!view) throw new Error(`no panel ${id}`);
  return readPass(() => view.build(w.ctx, { mapDisplay: null }));
}

function page(w: Working, org: string): OrgView {
  const pages = panel(w, "orgs.org") as unknown as Record<string, OrgView>;
  const view = pages[org];
  if (!view) throw new Error(`no page for ${org}`);
  return view;
}

describe("the Orgs views on Port Alder", () => {
  test("Jordan's home: his party (him alone), Alder Automotive (Mechanic) where he belongs, the Kowalczyks among those he knows", () => {
    const list = panel(portAlder("pov"), "orgs.list") as unknown as OrgListView;
    expect(list.party).toEqual({ id: "party_pov", name: "Your party", exists: false, members: [], hidden: 0, purse: null });
    expect(list.belong.map((o) => [o.id, o.type, o.title])).toEqual([[SHOP, "company", "Mechanic"]]);
    expect(list.belong[0]?.figure).toBeNull();
    expect(list.known.map((o) => [o.id, o.type, o.title])).toEqual([[HOUSEHOLD, "household", null]]);
    expect(list.known[0]?.whom.map((p) => p.id)).toEqual(["helen_kowalczyk", "jess_kowalczyk", "maddie_kowalczyk"]);
  });

  test("Jordan's Alder Automotive: his place, who runs it, its people, and no money section", () => {
    const view = page(portAlder("pov"), SHOP);
    expect([view.name, view.badge, view.type, view.exists]).toEqual(["Alder Automotive", "Company · LLC", "company", true]);
    expect([view.you.belongs, view.you.title, view.you.since, view.you.powers]).toEqual([true, "Mechanic", "12 Jan 2026", []]);
    expect(view.runBy).toEqual([{ id: "marcus_delgado", name: "Marcus Delgado" }]);
    expect(view.people.map((p) => [p.name, p.title, p.hows])).toEqual([
      ["Danny Okafor", "Mechanic", ["staff"]],
      ["Marcus Delgado", "Owner", ["owner"]],
      ["Jordan Ellis", "Mechanic", ["staff"]],
    ]);
    expect(view.people.find((p) => p.you)?.job).toBe("job_pov_mechanic");
    expect(view.hidden).toEqual({ count: 0, ids: [] });
    // No money section: only the Premises (lane X), which anyone who may see the company reads, and Coming up with his own payday there (lane L).
    expect(Object.keys(view.sections)).toEqual(["premises", "orgs.coming"]);
  });

  test("Marcus's Alder Automotive has its money, ownership and taxes", () => {
    const view = page(portAlder("marcus_delgado"), SHOP);
    expect(view.you.title).toBe("Owner");
    expect(view.you.powers).toHaveLength(21);
    expect(Object.keys(view.sections)).toEqual(expect.arrayContaining(["money", "ownership", "taxes"]));
    const ownership = view.sections.ownership as { owners: { party: string | null; share: number }[] };
    expect(ownership.owners.map((o) => [o.party, o.share])).toEqual([["marcus_delgado", 100]]);
    // His list shows the month's profit, which he may see.
    const list = panel(portAlder("marcus_delgado"), "orgs.list") as unknown as OrgListView;
    expect(list.belong.find((o) => o.id === SHOP)?.figure).toMatch(/^(Profit|Loss) this month: \$/);
  });

  test("a member Jordan can't see is counted, under an opaque id", () => {
    const view = page(
      portAlder("pov", (world) => {
        const danny = world.entities.danny_okafor;
        if (danny) danny.visibility = "secret";
      }),
      SHOP,
    );
    expect(view.people.map((p) => p.id)).toEqual(["marcus_delgado", "pov"]);
    expect(view.hidden).toEqual({ count: 1, ids: [opaqueId("danny_okafor")] });
    expect(JSON.stringify(view)).not.toContain("danny_okafor");
    expect(JSON.stringify(view)).not.toContain("Danny");
  });

  test("Helen's Kowalczyks: she heads them, by her title, and sees their shared costs", () => {
    const view = page(portAlder("helen_kowalczyk"), HOUSEHOLD);
    expect([view.badge, view.you.title, view.you.position]).toEqual(["Household", "head", { id: "head", title: "Head" }]);
    expect(view.runBy).toEqual([{ id: "helen_kowalczyk", name: "Helen Kowalczyk" }]);
    expect(view.positions.map((p) => [p.id, p.implied, p.holders])).toEqual([["head", true, ["helen_kowalczyk"]]]);
    // Her Plan too: as the Head she may give orders there (lane L).
    expect(Object.keys(view.sections)).toEqual(["money", "premises", "orgs.plan"]);
  });

  test("the party's page reads its roster before it has an entity", () => {
    const w = portAlder("pov", (world) => {
      world.entities.danny_okafor?.relations.push({ type: "travels_with", to: "pov", fields: { tier: "companion" } });
    });
    const list = panel(w, "orgs.list") as unknown as OrgListView;
    expect(list.party.members.map((m) => [m.id, m.tier])).toEqual([["danny_okafor", "companion"]]);
    const view = page(w, "party_pov");
    expect([view.badge, view.exists, view.you.title, view.runBy.map((r) => r.id)]).toEqual(["Party", false, "Leader", ["pov"]]);
    expect(view.people.map((p) => [p.id, p.title])).toEqual([
      ["danny_okafor", "Companion"],
      ["pov", "Leader"],
    ]);
    expect(view.you.powers).toHaveLength(21);
  });
});
