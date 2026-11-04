// The Decisions section, its alerts and what minds and the narrator are told (ORG-SPEC Phase 5,
// DESIGN §29.19-29.20), on Port Alder: Ellis Mobile Repair's motion as each voter reads it (whom they
// may vote for, who may withdraw it), not at all for someone with no tie to it, and the same through
// the frontend's decoder; the alert that wants a vote; a voter's mind told of it; Danny's request
// over his limit as Marcus (who may answer it) and Danny (who may withdraw it) read it; and none of
// it for a stockholder in the world, who votes but has no part in it.

import { describe, expect, test } from "bun:test";
import { FINANCE_ACTIONS } from "../../../src/shared/finance";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { WorldDoc } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { Working } from "../../../src/engine/working";
import { buildDecisionsView, decisionMindLines, decisionNarratorLines } from "../../../src/packs/orgs/core/decisions";
import { orgAlerts } from "../../../src/packs/orgs/core/feed";
import { decodeDecisions } from "../../../src/packs/orgs/ui/decode";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const DANNY = "danny_okafor";
const PRIYA = "priya_nair";
const MARCUS = "marcus_delgado";
const EMR = "ellis_mobile_repair_co";
const SHOP = "alder_automotive_co";

function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  for (const id of [JORDAN, DANNY, PRIYA, MARCUS, SHOP]) materializeAll(reg, w, id, "decisions");
  return w;
}

function act(w: Working, actor: string, action: string, params: JsonObject): Resolution {
  const r = resolveAction(reg, w, { action, actor, params }, createRng(`${action}:${actor}:${w.events.length}`), { runSeed: "decisions" });
  expect([r.failed?.reason ?? "", ...r.rejected.map((x) => x.rejection.reason)].join("")).toBe("");
  return r;
}

function gm(w: Working, type: string, args: Record<string, JsonValue>): void {
  expect(applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) }).rejected).toEqual([]);
}

/** Ellis Mobile Repair, 40 / 35 / 25, with Jordan's motion to issue Danny 100 units at $5 open. */
function motionOpen(): Working {
  const w = portAlder();
  act(w, JORDAN, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: "acct_pov_savings", units: 1000 });
  gm(w, "economy.shares_issue", { business: EMR, to: DANNY, units: 875, price: 0 });
  gm(w, "economy.shares_issue", { business: EMR, to: PRIYA, units: 625, price: 0 });
  act(w, JORDAN, FINANCE_ACTIONS.sharesIssue, { business: EMR, to: DANNY, units: 100, price: 500, vote: true });
  return w;
}

describe("a motion as each reader reads it", () => {
  test("Jordan may withdraw it, Danny may vote, Marcus doesn't read it; the decoder keeps it all", () => {
    const w = motionOpen();
    const ctx = reg.context(w.world, w.state);
    const jordan = buildDecisionsView(ctx, EMR, JORDAN);
    expect(jordan?.open).toHaveLength(1);
    expect(jordan?.open[0]).toMatchObject({ mayWithdraw: true, cast: [{ voter: JORDAN, name: "You", vote: "for" }], basis: "shares", quorum: 50, pass: 50 });
    expect(jordan?.open[0]?.voters.map((v) => [v.who.id, v.vote])).toEqual([
      [DANNY, null],
      [JORDAN, "for"],
      [PRIYA, null],
    ]);
    expect(jordan?.rules).toMatchObject({ basis: "shares", quorum: 50, pass: 50, days: 7, approvalDays: 7, standing: [] });
    expect(jordan?.rulesWhy).toBeNull();
    expect(jordan?.standing).toBeNull();
    const danny = buildDecisionsView(ctx, EMR, DANNY);
    expect(danny?.open[0]).toMatchObject({ mayWithdraw: false, cast: [{ voter: DANNY, name: "You", vote: null }] });
    expect(buildDecisionsView(ctx, EMR, MARCUS)).toBeNull();
    expect(decodeDecisions(JSON.parse(JSON.stringify(jordan)))).toEqual(jordan);
  });

  test("Danny's alert wants his vote; his mind and the narrator are told how it stands", () => {
    const w = motionOpen();
    const ctx = reg.context(w.world, w.state);
    expect(orgAlerts(ctx, EMR, DANNY)?.find((a) => a.kind === "motion_open")).toMatchObject({ tab: "decisions", needsYou: true, short: "your vote is wanted" });
    expect(orgAlerts(ctx, EMR, JORDAN)?.find((a) => a.kind === "motion_open")?.needsYou).toBe(false);
    const mind = decisionMindLines(ctx, DANNY);
    expect(mind).toHaveLength(1);
    expect(mind[0]).toContain("A vote at Ellis Mobile Repair, put by Jordan Ellis: Issue 100 units of Ellis Mobile Repair to Danny Okafor");
    expect(mind[0]).toContain("You hold 35% of the votes; you haven't voted");
    expect(mind[0]).toContain("counts only when the story tells it");
    const told = decisionNarratorLines(ctx);
    expect(told[0]).toContain("To a vote at Ellis Mobile Repair: Issue 100 units");
    expect(told[0]).toContain("40% for, 0% against");
    expect(told.at(-1)).toContain("never decide one for anyone");
  });
});

describe("a request as its asker and its approver read it", () => {
  test("Marcus may answer Danny's request; Danny may withdraw it; Marcus's alert needs him", () => {
    const w = portAlder((world) => {
      const shop = world.entities[SHOP];
      const job = world.entities.job_danny_mechanic;
      if (!shop || !job) throw new Error("no shop or job");
      shop.fields.positions = [{ id: "shop_foreman", title: "Shop foreman", powers: ["money.view", "money.spend"], limits: { payment: 50000 } }];
      job.fields = { ...job.fields, position: "shop_foreman" };
    });
    act(w, DANNY, "pay", { to: PRIYA, amount: 60000, as: SHOP, ask: true });
    const ctx = reg.context(w.world, w.state);
    const marcus = buildDecisionsView(ctx, SHOP, MARCUS);
    expect(marcus?.waiting[0]).toMatchObject({ state: "asked", mayAnswer: true, mayWithdraw: false, by: { id: DANNY }, approvers: [{ id: MARCUS, name: "Marcus Delgado" }], cents: 60000 });
    expect(buildDecisionsView(ctx, SHOP, DANNY)?.waiting[0]).toMatchObject({ mayAnswer: false, mayWithdraw: true });
    expect(orgAlerts(ctx, SHOP, MARCUS)?.find((a) => a.kind === "approval_waiting")).toMatchObject({ needsYou: true, tab: "decisions" });
    expect(decisionMindLines(ctx, MARCUS)[0]).toContain("Danny Okafor asks your approval for Alder Automotive");
    expect(decodeDecisions(JSON.parse(JSON.stringify(marcus)))).toEqual(marcus);
  });
});

describe("a request as a voter with no part in it reads it", () => {
  test("Priya, who bought the listed shop's stock, votes on its decisions but reads none of its requests; Marcus and Danny read Danny's", () => {
    const w = portAlder((world) => {
      const shop = world.entities[SHOP];
      const job = world.entities.job_danny_mechanic;
      if (!shop || !job) throw new Error("no shop or job");
      // A C corporation valued at $20,000, so its 1,000 units list at $20.
      shop.fields = { ...shop.fields, structure: "c_corp", value: 2_000_000, positions: [{ id: "shop_foreman", title: "Shop foreman", powers: ["money.view", "money.spend"], limits: { payment: 50000 } }] };
      job.fields = { ...job.fields, position: "shop_foreman" };
    });
    gm(w, "economy.list", { business: SHOP, units: 500, price: 2000 });
    act(w, PRIYA, "trade", { side: "buy", asset: `stock:${SHOP}`, qty: 10 });
    act(w, DANNY, "pay", { to: JORDAN, amount: 60000, as: SHOP, ask: true });
    const ctx = reg.context(w.world, w.state);
    const priya = buildDecisionsView(ctx, SHOP, PRIYA);
    expect(priya).not.toBeNull();
    expect(priya?.waiting).toEqual([]);
    expect(priya?.answered).toEqual([]);
    expect(buildDecisionsView(ctx, SHOP, MARCUS)?.waiting.map((r) => r.text)).toEqual([expect.stringContaining("Paid Jordan Ellis")]);
    expect(buildDecisionsView(ctx, SHOP, DANNY)?.waiting).toHaveLength(1);
  });
});
