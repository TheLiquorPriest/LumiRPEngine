// Founding an organization (ORG-SPEC §3.13; Orgs → Start something…, §4.2), on Port Alder. A
// company, from Money 3: the business with Jordan its only owner, a business checking account it
// owns, and his capital moved into it, all one unit. A group of one of the world's group kinds, with
// Jordan its Leader holding every power. The home offers both.

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
});
