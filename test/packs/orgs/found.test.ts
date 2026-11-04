// Founding an organization (ORG-SPEC §3.13; Orgs → Start something…, §4.2), on Port Alder. A
// company, from Money 3: the business with Jordan its only owner, a business checking account it
// owns, and his capital moved into it, all one unit. A trust settled (DESIGN §29.1): its trustee and
// beneficiary, its terms and one vote a trustee, a trust account it owns and what he puts in; a
// company settles one as itself, its trustee, so its owner acts for the trust through it; what an
// organization puts in is spent as the actor's money powers there allow. A nonprofit: no owners of
// its worth, Jordan its Director, his gift in its account, and no restructure out of it. A group of
// one of the world's group kinds, with Jordan its Leader holding every power. The home offers each.

import { describe, expect, test } from "bun:test";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { ORG_POWERS } from "../../../src/shared/org";
import type { OrgListView, OrgView } from "../../../src/shared/org-view";
import type { WorldDoc } from "../../../src/shared/world";
import { orgPower } from "../../../src/engine/org";
import { readPass } from "../../../src/engine/read-pass";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

function act(w: Working, params: JsonObject): Resolution {
  return resolveAction(reg, w, { action: "org_found", actor: "pov", params }, createRng(`found:${JSON.stringify(params)}`), { runSeed: "found" });
}

function refusal(r: Resolution): string {
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

function panel(w: Working, id: string): JsonValue {
  const view = reg.views.find((v) => v.panel === id);
  if (!view) throw new Error(`no panel ${id}`);
  return readPass(() => view.build(w.ctx, { mapDisplay: null }));
}

function spawned(r: Resolution, kind: string): Extract<LedgerEvent, { type: "spawn" }>["entity"] | undefined {
  return r.events.flatMap((ev) => (ev.type === "spawn" && ev.entity.kind === kind ? [ev.entity] : []))[0];
}

describe("founding an organization", () => {
  test("Start a company: the business with Jordan its only owner, a checking account it owns and his capital in it, in one unit; refused below Money 3 or with no capital", () => {
    const w = portAlder();
    const list = panel(w, "orgs.list") as unknown as OrgListView;
    expect(list.start.company.why).toBeNull();
    // $2,000 from his savings (§11 Phase 3), the source he picks.
    const from = list.start.company.sources.find((s) => /savings/i.test(s.name))?.id ?? "";
    expect(refusal(act(w, { type: "company", name: "Ellis Mobile Repair", amount: 0 }))).toContain("capital above nothing");
    const founded = act(w, { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from });
    expect(refusal(founded)).toBe("");
    const business = spawned(founded, "business");
    const account = spawned(founded, "account");
    expect([business?.id, business?.name, business?.fields.owners, business?.fields.structure]).toEqual(["ellis_mobile_repair_co", "Ellis Mobile Repair", [{ party: "pov", role: "owner", share: 100 }], "llc"]);
    expect((account?.fields.owners as JsonObject[] | undefined)?.[0]).toEqual({ party: "ellis_mobile_repair_co", role: "owner" });
    // One unit: the spawns, the opening, the posting, the operating account and its History line.
    const group = founded.events.find((ev) => ev.type === "spawn")?.group;
    expect(group).toBeDefined();
    expect(founded.events.filter((ev) => ev.group === group).map((ev) => ev.type)).toEqual(expect.arrayContaining(["spawn", "post", "set", "orgs.log"]));
    expect(w.state.entities.ellis_mobile_repair_co?.fields.operating_account).toBe(account?.id ?? "");
    expect(w.state.accounts[account?.id ?? ""]).toBe(200_000);
    const moved = founded.events.flatMap((ev) => (ev.type === "post" ? ev.lines.filter((l) => l.account === from || l.account === account?.id).map((l) => [l.account, l.amount]) : []));
    expect(moved).toEqual([
      [from, -200_000],
      [account?.id ?? "", 200_000],
    ]);
    expect(orgPower(w.ctx, "pov", "ellis_mobile_repair_co", "org.govern")?.basis).toBe("owner");
    const home = panel(w, "orgs.list") as unknown as OrgListView;
    expect(home.belong.map((o) => [o.id, o.type, o.title])).toContainEqual(["ellis_mobile_repair_co", "company", "Owner"]);
    // Below Money 3 it isn't open.
    const low = portAlder((world) => {
      if (world.realism) world.realism.levels.money = 2;
    });
    const why = (panel(low, "orgs.list") as unknown as OrgListView).start.company.why;
    expect(why).toContain("Money 3");
    expect(refusal(act(low, { type: "company", name: "Ellis Mobile Repair", amount: 200_000 }))).toBe(why ?? "");
  });

  test("Start a group: one of the world's group kinds, Jordan its Leader with every power since today", () => {
    const w = portAlder();
    const kinds = (panel(w, "orgs.list") as unknown as OrgListView).start.group?.kinds.map((k) => k.id) ?? [];
    expect(kinds).toEqual(expect.arrayContaining(["faction", "family"]));
    expect(kinds).not.toContain("household");
    expect(kinds).not.toContain("business");
    expect(refusal(act(w, { type: "group", name: "The Harbor Crew", kind: "household" }))).toContain("a group is one of");
    const founded = act(w, { type: "group", name: "The Harbor Crew", kind: "faction" });
    expect(refusal(founded)).toBe("");
    const crew = spawned(founded, "faction");
    expect(crew?.id).toBe("the_harbor_crew");
    expect(w.state.entities.pov?.relations.find((r) => r.type === "member_of" && r.to === "the_harbor_crew")?.fields).toEqual({ position: "leader", since: "2026-09-14" });
    expect(ORG_POWERS.every((p) => orgPower(w.ctx, "pov", "the_harbor_crew", p)?.basis === "position")).toBe(true);
    const pages = panel(w, "orgs.org") as unknown as Record<string, OrgView>;
    expect([pages.the_harbor_crew?.badge, pages.the_harbor_crew?.you.title]).toEqual(["Group · Faction", "Leader"]);
  });

  test("Settle a trust: its trustee and beneficiary, its settlor and terms, one vote a trustee, a trust account it owns and what goes in; a company settles one as itself", () => {
    const w = portAlder();
    const list = panel(w, "orgs.list") as unknown as OrgListView;
    expect([list.start.trust.why, list.start.nonprofit.why]).toEqual([null, null]);
    const from = list.start.trust.sources.find((s) => /savings/i.test(s.name))?.id ?? "";
    expect(refusal(act(w, { type: "trust", name: "Ellis Family Trust", until: "2020-01-01" }))).toContain("ends after today");
    const settled = act(w, { type: "trust", name: "Ellis Family Trust", amount: 50_000, from, beneficiary: "marcus_delgado", revocable: true, purpose: "For the shop's apprentices", until: "2040-06-30" });
    expect(refusal(settled)).toBe("");
    const trust = spawned(settled, "trust");
    const account = spawned(settled, "account");
    expect(trust?.id).toBe("ellis_family_trust");
    expect(trust?.fields).toEqual({
      owners: [
        { party: "pov", role: "trustee" },
        { party: "marcus_delgado", role: "beneficiary", share: 100 },
      ],
      settlor: "pov",
      revocable: true,
      purpose: "For the shop's apprentices",
      until: "2040-06-30",
      trustees_decide: "each",
      vote_by: "trustees",
    });
    expect([(account?.fields.owners as JsonObject[] | undefined)?.[0], w.state.accounts[account?.id ?? ""]]).toEqual([{ party: "ellis_family_trust", role: "owner" }, 50_000]);
    expect(orgPower(w.ctx, "pov", "ellis_family_trust", "money.spend")).toEqual({ basis: "owner" });
    expect(orgPower(w.ctx, "marcus_delgado", "ellis_family_trust", "money.spend")).toBeNull();
    const pages = panel(w, "orgs.org") as unknown as Record<string, OrgView>;
    expect(pages.ellis_family_trust?.trust).toEqual({ settlor: { id: "pov", name: "Jordan Ellis" }, revocable: true, purpose: "For the shop's apprentices", until: "30 Jun 2040", decide: "each" });

    // Ellis Mobile Repair settles a trust as itself: it is the trustee and the beneficiary, and Jordan acts for the trust through it.
    expect(refusal(act(w, { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from }))).toBe("");
    const staff = act(w, { type: "trust", name: "Ellis Staff Trust", amount: 10_000, as: "ellis_mobile_repair_co" });
    expect(refusal(staff)).toBe("");
    expect(spawned(staff, "trust")?.fields.owners).toEqual([
      { party: "ellis_mobile_repair_co", role: "trustee" },
      { party: "ellis_mobile_repair_co", role: "beneficiary", share: 100 },
    ]);
    expect(orgPower(w.ctx, "pov", "ellis_staff_trust", "money.spend")).toEqual({ basis: "control", id: "ellis_mobile_repair_co", through: ["ellis_mobile_repair_co"] });
    const posting = staff.events.find((e) => e.type === "economy.txn");
    expect(posting).toMatchObject({ data: { by: "pov", as: "ellis_mobile_repair_co", category: "investment" } });
  });

  test("regression: the shop's money into a trust or a nonprofit is spent as Danny's money powers there allow: never on governing it alone, for himself, or past his limits, and it counts toward his month", () => {
    // Danny, Alder Automotive's Shop foreman, settles for it: governing it alone, then spending up to $500 a payment and $600 a month.
    const foreman = (powers: string[]): Working =>
      portAlder((world) => {
        world.entities.alder_automotive_co!.fields.positions = [{ id: "shop_foreman", title: "Shop foreman", powers, limits: { payment: 50_000, month: 60_000 } }];
        world.entities.job_danny_mechanic!.fields = { ...world.entities.job_danny_mechanic!.fields, position: "shop_foreman" };
      });
    const settle = (w: Working, params: JsonObject): Resolution => resolveAction(reg, w, { action: "org_found", actor: "danny_okafor", params: { type: "trust", as: "alder_automotive_co", ...params } }, createRng(`found:${JSON.stringify(params)}`), { runSeed: "found" });
    /** What a resolution moved out of the shop's till. */
    const fromTill = (r: Resolution): number[] => r.events.flatMap((e) => (e.type === "post" ? e.lines.filter((l) => l.account === "acct_marcus_shop").map((l) => l.amount) : []));
    const governs = foreman(["org.govern"]);
    for (const r of [settle(governs, { name: "Okafor Family Trust", amount: 10_000, beneficiary: "danny_okafor", trustee: "danny_okafor" }), settle(governs, { type: "nonprofit", name: "Harbor Food Bank", amount: 10_000 })]) {
      expect(refusal(r)).toBe("Alder Automotive: you may not spend its money");
      expect(fromTill(r)).toEqual([]);
    }
    const spends = foreman(["org.govern", "money.spend"]);
    // Money he only manages never pays for him; then each payment's limit, and the month's, the first trust counted in it.
    expect(refusal(settle(spends, { name: "Okafor Family Trust", amount: 10_000, beneficiary: "danny_okafor" }))).toBe("Alder Automotive's money pays for Alder Automotive, not for Danny Okafor");
    expect(refusal(settle(spends, { name: "Nair Family Trust", amount: 60_000, beneficiary: "priya_nair" }))).toBe("Over your limit of $500.00 a payment for Alder Automotive");
    const settled = settle(spends, { name: "Nair Family Trust", amount: 40_000, beneficiary: "priya_nair" });
    expect(refusal(settled)).toBe("");
    expect(fromTill(settled)).toEqual([-40_000]);
    expect(refusal(settle(spends, { name: "Nair Second Trust", amount: 40_000, beneficiary: "priya_nair" }))).toBe("Over your limit of $600.00 a month for Alder Automotive");
  });

  test("Start a nonprofit: no owners of its worth, Jordan its Director with every power, his gift in its account; it never restructures out of being one", () => {
    const w = portAlder();
    const started = act(w, { type: "nonprofit", name: "Harbor Food Bank", amount: 20_000 });
    expect(refusal(started)).toBe("");
    const org = spawned(started, "business");
    expect(org?.id).toBe("harbor_food_bank_org");
    expect(org?.fields).toMatchObject({ owners: [], structure: "nonprofit" });
    expect(w.state.entities.pov?.relations.find((r) => r.type === "member_of" && r.to === "harbor_food_bank_org")?.fields).toEqual({ position: "director", since: "2026-09-14" });
    expect(ORG_POWERS.every((p) => orgPower(w.ctx, "pov", "harbor_food_bank_org", p)?.basis === "position")).toBe(true);
    const account = String(w.state.entities.harbor_food_bank_org?.fields.operating_account ?? "");
    expect(w.state.accounts[account]).toBe(20_000);
    expect(started.events.find((e) => e.type === "economy.txn")).toMatchObject({ data: { category: "donations" } });
    const page = (panel(w, "orgs.org") as unknown as Record<string, OrgView>).harbor_food_bank_org;
    expect([page?.badge, page?.structure, page?.nonprofit, page?.you.title]).toEqual(["Nonprofit", "Nonprofit", true, "Director"]);
    const restructured = resolveAction(reg, w, { action: "org_restructure", actor: "pov", params: { org: "harbor_food_bank_org", structure: "llc" } }, createRng("restructure"), { runSeed: "found" });
    expect(refusal(restructured)).toBe("Harbor Food Bank stops being a nonprofit only by changing what it is in Build");
  });
});
