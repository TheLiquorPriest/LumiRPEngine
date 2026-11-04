// Motions (ORG-SPEC Phase 5, the acceptance in DESIGN §29.19) on Port Alder. Jordan founds Ellis
// Mobile Repair in 1,000 units and the GM brings Danny (875) and Priya (625) in, so the votes are
// Jordan 40 %, Danny 35 %, Priya 25 %. Jordan's issue of 100 units to Danny is refused alone; asked
// with `vote` it opens a motion instead, carried at once when Danny votes for it (the vote, the close
// and the issue one unit, which a rebased view where Danny can't pay drops whole), failed at once
// when Danny and Priya vote against, and, with only Jordan voting, failed at its close for want of
// quorum or passed there under a lower quorum. Standing votes follow or are cast as it opens; a
// company counting by members gives each holder one vote; a change of structure goes the same way;
// the GM closes or withdraws; the reply's vote fact lands a vote the story tells; and the records fold
// the same on replay.

import { describe, expect, test } from "bun:test";
import { FINANCE_ACTIONS, ownersIn, type Owner } from "../../../src/shared/finance";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { formatMoney, type WorldDoc } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { applyValidUnits } from "../../../src/engine/events";
import { materializeAll } from "../../../src/engine/materialize";
import { sliceOf } from "../../../src/engine/pack-kit";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import type { WorldState } from "../../../src/engine/state";
import { Working } from "../../../src/engine/working";
import { decisionLabel } from "../../../src/packs/orgs/core/decisions";
import { orgHistory } from "../../../src/packs/orgs/core/log";
import { motionsOf, stepMotions } from "../../../src/packs/orgs/core/motions";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const DANNY = "danny_okafor";
const PRIYA = "priya_nair";
const MARCUS = "marcus_delgado";
const SAVINGS = "acct_pov_savings";
const DANNY_CHECKING = "acct_danny_checking";
const EMR = "ellis_mobile_repair_co";

function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  for (const id of [JORDAN, DANNY, PRIYA, MARCUS]) materializeAll(reg, w, id, "motions");
  return w;
}

function act(w: Working, actor: string, action: string, params: JsonObject): Resolution {
  return resolveAction(reg, w, { action, actor, params }, createRng(`${action}:${actor}:${w.events.length}`), { runSeed: "motions" });
}

/** Why it didn't play: the requirement or the effect's refusal; "" when it played. */
function why(r: Resolution): string {
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

function gm(w: Working, type: string, args: Record<string, JsonValue>): string {
  return applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) }).rejected.map((r) => r.rejection.reason).join("; ");
}

function unitsOf(w: Working, who: string): number {
  return ownersIn(w.state.entities[EMR]?.fields ?? {})
    .filter((o) => o.party === who)
    .reduce((a, o) => a + (o.units ?? 0), 0);
}

/** Ellis Mobile Repair, Jordan's, with Danny's 875 units and Priya's 625 given by the GM: 40 %, 35 % and 25 % of the votes. */
function threeHolders(patch?: (world: WorldDoc) => void): Working {
  const w = portAlder(patch);
  expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: SAVINGS, units: 1000 }))).toBe("");
  expect(gm(w, "economy.shares_issue", { business: EMR, to: DANNY, units: 875, price: 0 })).toBe("");
  expect(gm(w, "economy.shares_issue", { business: EMR, to: PRIYA, units: 625, price: 0 })).toBe("");
  return w;
}

const ISSUE = { business: EMR, to: DANNY, units: 100, price: 500 };

function account(w: Working): string {
  return String(w.state.entities[EMR]?.fields.operating_account ?? "");
}

/** Jordan's motion to issue Danny 100 units at $5, opened; its id. */
function opened(w: Working): string {
  const r = act(w, JORDAN, FINANCE_ACTIONS.sharesIssue, { ...ISSUE, vote: true });
  expect(why(r)).toBe("");
  const m = motionsOf(w.state, EMR)[0];
  if (!m) throw new Error("no motion");
  return m.id;
}

describe("a decision short of the decider's votes, put to a vote", () => {
  test("alone, Jordan's issue is refused for want of votes", () => {
    const w = threeHolders();
    expect(why(act(w, JORDAN, FINANCE_ACTIONS.sharesIssue, ISSUE))).toContain("needs more than half the votes; Jordan Ellis holds 40%");
    expect(motionsOf(w.state, EMR)).toEqual([]);
  });

  test("asked with `vote`, it opens a motion instead, one unit, and nothing is issued", () => {
    const w = threeHolders();
    const r = act(w, JORDAN, FINANCE_ACTIONS.sharesIssue, { ...ISSUE, vote: true });
    expect(why(r)).toBe("");
    const [m] = motionsOf(w.state, EMR);
    expect(m).toMatchObject({ status: "open", by: JORDAN, basis: "shares", quorum: 50, pass: 50, text: `Issue 100 units of Ellis Mobile Repair to Danny Okafor at ${formatMoney(500, w.world.currency)} a unit` });
    expect(m?.electorate[JORDAN]).toBeCloseTo(40);
    expect(m?.electorate[DANNY]).toBeCloseTo(35);
    expect(m?.electorate[PRIYA]).toBeCloseTo(25);
    expect(m?.votes[JORDAN]).toMatchObject({ vote: "for", how: "own" });
    expect(m?.what.type).toBe("economy.shares_issue");
    expect(unitsOf(w, DANNY)).toBe(875);
    const group = r.events.find((e) => e.type === "orgs.motion")?.group;
    expect(group).toBeDefined();
    expect(r.events.every((e) => e.group === group)).toBe(true);
    expect(orgHistory(w.state, EMR)[0]?.text).toStartWith("Jordan Ellis put to a vote: Issue 100 units");
  });

  test("Danny votes for: it carries at once, the vote, the close and the issue in one unit", () => {
    const w = threeHolders();
    const id = opened(w);
    const cash = w.state.accounts[account(w)] ?? 0;
    const danny = w.state.accounts[DANNY_CHECKING] ?? 0;
    const r = act(w, DANNY, "org_vote", { org: EMR, motion: id, vote: "for" });
    expect(why(r)).toBe("");
    expect(motionsOf(w.state, EMR)[0]).toMatchObject({ status: "passed", why: "carried: 75% for, 0% against" });
    expect(unitsOf(w, DANNY)).toBe(975);
    expect(w.state.accounts[account(w)]).toBe(cash + 50_000);
    expect(w.state.accounts[DANNY_CHECKING]).toBe(danny - 50_000);
    const groups = new Set(r.events.map((e) => e.group));
    expect(groups.size).toBe(1);
    expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(["orgs.vote", "orgs.motion_end", "set", "post", "orgs.log"]));
    expect(orgHistory(w.state, EMR).map((l) => l.text)).toEqual(expect.arrayContaining([expect.stringMatching(/^Carried by vote \(75% for, 0% against\): Issue 100 units/), expect.stringMatching(/^Issued 100 units to Danny Okafor/)]));
  });

  test("Danny and Priya vote against: it fails at once, voted down, and nothing is issued", () => {
    const w = threeHolders();
    const id = opened(w);
    expect(why(act(w, DANNY, "org_vote", { org: EMR, motion: id, vote: "against" }))).toBe("");
    expect(motionsOf(w.state, EMR)[0]?.status).toBe("open");
    expect(why(act(w, PRIYA, "org_vote", { org: EMR, motion: id, vote: "against" }))).toBe("");
    expect(motionsOf(w.state, EMR)[0]).toMatchObject({ status: "failed", why: "voted down: 40% for, 60% against" });
    expect(unitsOf(w, DANNY)).toBe(875);
    // Closed: no more votes.
    expect(why(act(w, DANNY, "org_vote", { org: EMR, motion: id, vote: "for" }))).toContain("failed already");
  });

  test("only Jordan voting, it fails at its close for want of quorum; under a quorum of 30 % it passes there and issues", () => {
    for (const quorum of [undefined, 30]) {
      const w = threeHolders();
      if (quorum !== undefined) expect(why(act(w, JORDAN, "org_decisions", { org: EMR, quorum }))).toBe("");
      const id = opened(w);
      const m = motionsOf(w.state, EMR).find((x) => x.id === id);
      if (!m) throw new Error("no motion");
      expect(m.closes - m.at).toBe(7 * 1440);
      // Before it closes, a slot leaves it open.
      expect(stepMotions(reg.context(w.world, w.state), (e) => createRng(`slot:${e}`))).toEqual([]);
      w.state.clock = m.closes + 60;
      const events = stepMotions(reg.context(w.world, w.state), (e) => createRng(`slot:${e}`));
      for (const e of events) expect(w.apply(e)).toBeNull();
      if (quorum === undefined) {
        expect(motionsOf(w.state, EMR)[0]).toMatchObject({ status: "failed", why: "no quorum: 40% took part, 50% needed" });
        expect(unitsOf(w, DANNY)).toBe(875);
      } else {
        expect(motionsOf(w.state, EMR)[0]).toMatchObject({ status: "passed", why: "carried: 40% for, 0% against" });
        expect(unitsOf(w, DANNY)).toBe(975);
      }
      expect(new Set(events.map((e) => e.group)).size).toBe(1);
    }
  });
});

describe("standing votes, counting by members, and other decisions", () => {
  test("Priya votes with Danny by rule, and a standing vote against is cast as a motion opens", () => {
    const w = threeHolders();
    expect(gm(w, "orgs.vote_rule", { org: EMR, who: PRIYA, vote: "with", with: DANNY })).toBe("");
    const id = opened(w);
    expect(motionsOf(w.state, EMR)[0]?.votes[PRIYA]).toBeUndefined();
    expect(why(act(w, DANNY, "org_vote", { org: EMR, motion: id, vote: "for" }))).toBe("");
    const m = motionsOf(w.state, EMR)[0];
    expect(m?.votes[PRIYA]).toMatchObject({ vote: "for", how: "rule" });
    expect(m?.status).toBe("passed");

    const v = threeHolders();
    expect(gm(v, "orgs.vote_rule", { org: EMR, who: DANNY, vote: "against" })).toBe("");
    opened(v);
    expect(motionsOf(v.state, EMR)[0]?.votes[DANNY]).toMatchObject({ vote: "against", how: "rule" });
  });

  test("counting by members, each holder has one vote: Jordan and Danny carry it, and Jordan alone with 80 % of the units is refused", () => {
    const w = threeHolders();
    expect(gm(w, "orgs.decisions", { org: EMR, vote_by: "members" })).toBe("");
    expect(why(act(w, JORDAN, FINANCE_ACTIONS.sharesIssue, ISSUE))).toContain("Jordan Ellis holds 33.33%");
    const id = opened(w);
    expect(motionsOf(w.state, EMR)[0]?.basis).toBe("members");
    expect(why(act(w, DANNY, "org_vote", { org: EMR, motion: id, vote: "for" }))).toBe("");
    expect(motionsOf(w.state, EMR)[0]).toMatchObject({ status: "passed", why: "carried: 66.7% for, 0% against" });

    const two = portAlder();
    expect(why(act(two, JORDAN, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: SAVINGS, units: 1000 }))).toBe("");
    expect(gm(two, "economy.shares_issue", { business: EMR, to: DANNY, units: 250, price: 0 })).toBe("");
    expect(why(act(two, JORDAN, FINANCE_ACTIONS.sharesIssue, ISSUE))).toBe("");
    expect(gm(two, "orgs.decisions", { org: EMR, vote_by: "members" })).toBe("");
    expect(why(act(two, JORDAN, FINANCE_ACTIONS.sharesIssue, ISSUE))).toContain("needs more than half the votes; Jordan Ellis holds 50%");
  });

  test("a change of structure put to a vote is carried out when it passes", () => {
    const w = threeHolders();
    expect(why(act(w, JORDAN, "org_restructure", { org: EMR, structure: "c_corp" }))).toContain("needs more than half the votes");
    expect(why(act(w, JORDAN, "org_restructure", { org: EMR, structure: "c_corp", vote: true }))).toBe("");
    const [m] = motionsOf(w.state, EMR);
    expect(m?.text).toBe("Make Ellis Mobile Repair a C corporation");
    // Priya's 25 % with Jordan's 40 % carries it whatever Danny does.
    expect(why(act(w, PRIYA, "org_vote", { org: EMR, motion: m?.id ?? "", vote: "for" }))).toBe("");
    expect(motionsOf(w.state, EMR)[0]).toMatchObject({ status: "passed", why: "carried: 65% for, 0% against" });
    expect(w.state.entities[EMR]?.fields.structure).toBe("c_corp");
  });

  test("the GM closes a motion on the votes cast, votes for someone, and its proposer withdraws one", () => {
    const w = threeHolders();
    const id = opened(w);
    expect(gm(w, "orgs.motion_end", { org: EMR, motion: id, how: "close" })).toBe("");
    expect(motionsOf(w.state, EMR)[0]).toMatchObject({ status: "failed", why: "no quorum: 40% took part, 50% needed" });

    const u = threeHolders();
    const next = opened(u);
    // Priya abstaining brings 65 % in; 40 % for beats the most Danny's 35 % could put against it.
    expect(gm(u, "orgs.vote", { org: EMR, motion: next, who: PRIYA, vote: "abstain" })).toBe("");
    expect(motionsOf(u.state, EMR)[0]?.votes[PRIYA]).toMatchObject({ vote: "abstain", how: "gm" });
    expect(motionsOf(u.state, EMR)[0]?.status).toBe("passed");

    const v = threeHolders();
    const other = opened(v);
    expect(why(act(v, DANNY, "org_motion_end", { org: EMR, motion: other }))).toContain("Only Jordan Ellis may withdraw it");
    expect(why(act(v, JORDAN, "org_motion_end", { org: EMR, motion: other }))).toBe("");
    expect(motionsOf(v.state, EMR)[0]?.status).toBe("withdrawn");
  });

  test("an act that couldn't be carried out isn't put to a vote, and a voter's vote is theirs to cast", () => {
    const w = threeHolders();
    expect(why(act(w, JORDAN, FINANCE_ACTIONS.sharesBuyBack, { business: EMR, from: PRIYA, units: 5000, price: 0, vote: true }))).toContain("holds 625 units of Ellis Mobile Repair, not 5000");
    expect(motionsOf(w.state, EMR)).toEqual([]);
    const id = opened(w);
    expect(why(act(w, DANNY, "org_vote", { org: EMR, motion: id, vote: "maybe" }))).toContain("for, against or abstain");
    expect(why(act(w, MARCUS, "org_vote", { org: EMR, motion: id, vote: "for" }))).toContain("Marcus Delgado has no vote on it");
  });

  test("the reply's vote fact for Danny lands his vote; one naming a motion that isn't open, or hedged, is refused", () => {
    const w = threeHolders();
    const id = opened(w);
    const vote = reg.proposals.get("vote");
    if (!vote) throw new Error("no vote channel");
    const fact: JsonObject = { type: "vote", who: "Danny", org: "Ellis Mobile Repair", motion: id, vote: "for", said: "Danny raises his hand for the issue" };
    expect(vote.validate({ ...fact, said: "Danny says he might vote for it" }, w.ctx)?.code).toBe("not_stated");
    expect(vote.validate({ ...fact, motion: "m_none" }, w.ctx)?.code).toBe("missing_motion");
    expect(vote.validate(fact, w.ctx)).toBeNull();
    expect(decisionLabel(w.ctx, { ...fact, who: DANNY })).toBe(`Danny Okafor votes for: Issue 100 units of Ellis Mobile Repair to Danny Okafor at ${formatMoney(500, w.world.currency)} a unit`);
    expect(applyEffects(reg, w, vote.toEffects(fact, w.ctx), { bindings: {}, rng: createRng("story-vote") }).rejected).toEqual([]);
    expect(motionsOf(w.state, EMR)[0]).toMatchObject({ status: "passed", votes: { [DANNY]: { vote: "for", how: "story" } } });
    expect(unitsOf(w, DANNY)).toBe(975);
    // Carried, it is open no more: the same fact again is refused.
    expect(vote.validate(fact, w.ctx)?.code).toBe("closed");
  });
});

describe("motions closing in the same slot", () => {
  test("each is settled on what the one before it left: Marcus can pay for one issue, so the second fails whole", () => {
    const TOW = "ellis_towing_co";
    const MARCUS_CHECKING = "acct_marcus_checking";
    const w = threeHolders();
    // Ellis Towing, held 40 / 35 / 25 the same way; each closes a motion with Jordan's 40 % under a quorum of 30 %.
    expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Towing", amount: 50_000, from: SAVINGS, units: 1000 }))).toBe("");
    expect(gm(w, "economy.shares_issue", { business: TOW, to: DANNY, units: 875, price: 0 })).toBe("");
    expect(gm(w, "economy.shares_issue", { business: TOW, to: PRIYA, units: 625, price: 0 })).toBe("");
    // Marcus's checking holds $1,000: one issue of 100 units at $8, not two.
    const extra = (w.state.accounts[MARCUS_CHECKING] ?? 0) - 100_000;
    expect(w.apply({ type: "post", lines: [{ account: MARCUS_CHECKING, amount: -extra }, { account: "economy.external:elsewhere", amount: extra }], memo: "Spent elsewhere" })).toBeNull();
    for (const org of [EMR, TOW]) {
      expect(why(act(w, JORDAN, "org_decisions", { org, quorum: 30 }))).toBe("");
      expect(why(act(w, JORDAN, FINANCE_ACTIONS.sharesIssue, { business: org, to: MARCUS, units: 100, price: 800, from: MARCUS_CHECKING, vote: true }))).toBe("");
    }
    const tow = (): Owner[] => ownersIn(w.state.entities[TOW]?.fields ?? {});
    const owners = tow();
    w.state.clock = Math.max(...[EMR, TOW].map((org) => motionsOf(w.state, org)[0]?.closes ?? 0)) + 60;
    const events = stepMotions(reg.context(w.world, w.state), (e) => createRng(`slot:${e}`));
    for (const e of events) expect(w.apply(e)).toBeNull();
    // Ellis Mobile Repair's comes first and issues; Ellis Towing's then can't be paid, so nothing of it applies.
    expect(motionsOf(w.state, EMR)[0]).toMatchObject({ status: "passed" });
    expect(unitsOf(w, MARCUS)).toBe(100);
    expect(motionsOf(w.state, TOW)[0]).toMatchObject({ status: "failed" });
    expect(motionsOf(w.state, TOW)[0]?.why).toStartWith("couldn't be carried out: ");
    expect(tow()).toEqual(owners);
    expect(w.state.accounts[MARCUS_CHECKING]).toBe(20_000);
    expect(orgHistory(w.state, TOW)[0]?.text).toStartWith("The motion failed (couldn't be carried out: ");
    // Each its own unit.
    expect(new Set(events.map((e) => e.group)).size).toBe(2);
  });

  test("its History lines name whom the act names, so a reader who can't see them reads someone", () => {
    const w = threeHolders();
    opened(w);
    const [line] = orgHistory(w.state, EMR);
    expect(line?.text).toContain("Issue 100 units of Ellis Mobile Repair to Danny Okafor");
    expect(line?.names?.map((n) => n.id)).toContain(DANNY);
  });
});

describe("replay", () => {
  test("a rebased view where Danny can't pay drops the carrying vote's unit whole", () => {
    const w = threeHolders();
    const id = opened(w);
    const before = structuredClone(w.state) as WorldState;
    const r = act(w, DANNY, "org_vote", { org: EMR, motion: id, vote: "for" });
    expect(why(r)).toBe("");
    const unit: LedgerEvent[] = [...r.events];
    const rich = new Working(reg, w.world, structuredClone(before));
    expect(applyValidUnits(reg, unit, rich.state, (s) => reg.context(rich.world, s))).toHaveLength(unit.length);
    const poor = new Working(reg, w.world, structuredClone(before));
    const left = poor.state.accounts[DANNY_CHECKING] ?? 0;
    expect(poor.apply({ type: "post", lines: [{ account: DANNY_CHECKING, amount: -left }, { account: "economy.external:elsewhere", amount: left }], memo: "Spent elsewhere" })).toBeNull();
    expect(applyValidUnits(reg, unit, poor.state, (s) => reg.context(poor.world, s))).toEqual([]);
    expect(motionsOf(poor.state, EMR)[0]?.status).toBe("open");
    expect(motionsOf(poor.state, EMR)[0]?.votes[DANNY]).toBeUndefined();
  });

  test("the whole ledger folds to the same records and owners again", () => {
    const w = threeHolders();
    const id = opened(w);
    expect(why(act(w, DANNY, "org_vote", { org: EMR, motion: id, vote: "for" }))).toBe("");
    const again = startState(w.world, reg);
    expect(applyValidUnits(reg, w.events, again, (s) => reg.context(w.world, s))).toHaveLength(w.events.length);
    expect(sliceOf(again, "orgs").motions).toEqual(sliceOf(w.state, "orgs").motions);
    expect(again.entities[EMR]?.fields.owners).toEqual(w.state.entities[EMR]?.fields.owners);
  });
});
