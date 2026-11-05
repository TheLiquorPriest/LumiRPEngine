// The Decisions tab (ORG-SPEC Phase 5, DESIGN §29.19-29.20): what each control sends (a vote for
// oneself or as a holder, a withdrawal, the GM's close, an answer, the rules, a standing vote) and how
// GM → Orgs plays it as one edit; a motion's card with the reader's vote, and the GM's vote for every
// voter; and the board with nothing open.

import { describe, expect, test } from "bun:test";
import { Button, Empty, Seg } from "../../src/frontend/components";
import { answerChange, decisionOps, DecisionsBoard, endChange, MotionCard, RequestCard, rulesChange, rulesDraft, rulesProblem, standingChange, voteChange, type DecisionChange } from "../../src/packs/orgs/ui/decisions";
import { DECISION_ACTIONS, type DecisionsView, type MotionView, type RequestView } from "../../src/shared/org-motions";
import { offstageGroupOf, playsOffstage } from "../../src/shared/offstage";
import { labelled, press, propsOf } from "../support/tree";

const ORG = { id: "ellis_mobile_repair_co", name: "Ellis Mobile Repair" };

const motion: MotionView = {
  id: "m_1",
  text: "Issue 100 units of Ellis Mobile Repair to Danny Okafor at $5.00 a unit",
  by: { id: "pov", name: "Jordan Ellis" },
  at: 0,
  closes: 7 * 1440,
  closesText: "Tue 10 Nov 2026, 09:00",
  status: "open",
  why: null,
  basis: "shares",
  quorum: 50,
  pass: 50,
  tally: { for: 40, against: 0, abstain: 0, cast: 40, remaining: 60, quorumMet: false },
  voters: [
    { who: { id: "danny_okafor", name: "Danny Okafor" }, weight: 35, vote: null, how: null },
    { who: { id: "pov", name: "Jordan Ellis" }, weight: 40, vote: "for", how: "own" },
  ],
  public: 0,
  cast: [{ voter: "danny_okafor", name: "You", vote: null }],
  mayWithdraw: false,
};

const request: RequestView = {
  id: "r_1",
  text: "Paid Priya Nair $600.00",
  why: "Over your limit of $500.00 a payment for Alder Automotive",
  by: { id: "danny_okafor", name: "Danny Okafor" },
  power: "money.spend",
  cents: 60000,
  at: 0,
  until: 7 * 1440,
  untilText: "Tue 10 Nov 2026, 09:00",
  state: "asked",
  approvers: [{ id: "marcus_delgado", name: "Marcus Delgado" }],
  answered: null,
  mayAnswer: true,
  mayWithdraw: false,
};

const view: DecisionsView = { rules: { basis: "shares", quorum: 50, pass: 50, days: 7, approvalDays: 7, standing: [] }, open: [motion], closed: [], waiting: [request], answered: [], rulesWhy: null, standing: null };

describe("what each control sends", () => {
  test("a vote, a withdrawal, the GM's close, an answer, the rules and a standing vote", () => {
    expect(voteChange(ORG.id, motion, "danny_okafor", "for")).toEqual({ action: "org_vote", params: { org: ORG.id, motion: "m_1", vote: "for" }, effect: "orgs.vote", gm: { org: ORG.id, motion: "m_1", vote: "for", who: "danny_okafor" } });
    expect(voteChange(ORG.id, motion, "ellis_towing_co", "against", "ellis_towing_co").params).toEqual({ org: ORG.id, motion: "m_1", vote: "against", as: "ellis_towing_co" });
    expect(endChange(ORG.id, motion, "close").gm).toEqual({ org: ORG.id, motion: "m_1", how: "close" });
    expect(answerChange(ORG.id, request, "deny", " Wait ")).toEqual({ action: "org_deny", params: { org: ORG.id, request: "r_1", why: "Wait" }, effect: "orgs.answer", gm: { org: ORG.id, request: "r_1", answer: "deny", why: "Wait" } });
    expect(answerChange(ORG.id, request, "approve").action).toBe("org_approve");
    expect(rulesChange(ORG.id, view, rulesDraft(view))).toBeNull();
    expect(rulesChange(ORG.id, view, { ...rulesDraft(view), basis: "members", quorum: "30", days: "" })?.params).toEqual({ org: ORG.id, vote_by: "members", quorum: 30, days: "default" });
    expect(rulesProblem({ ...rulesDraft(view), pass: "100" })).toBe("Passes with more than: a percentage from 0 to 99.9.");
    expect(rulesProblem({ ...rulesDraft(view), days: "0" })).toBe("Days: a whole number from 1 to 365.");
    expect(standingChange(ORG.id, "priya_nair", "with", "danny_okafor")).toEqual({ action: "org_vote_rule", params: { org: ORG.id, vote: "with", with: "danny_okafor" }, effect: "orgs.vote_rule", gm: { org: ORG.id, vote: "with", with: "danny_okafor", who: "priya_nair" } });
    expect(decisionOps(voteChange(ORG.id, motion, "danny_okafor", "for"))).toEqual([{ op: "effect", effect: "orgs.vote", args: { org: ORG.id, motion: "m_1", vote: "for", who: "danny_okafor" } }]);
  });

  test("every action the tab sends is done at once, off screen, as governance: Deny as Approve is, never queued for the next message", () => {
    for (const action of Object.values(DECISION_ACTIONS)) expect([action, offstageGroupOf(action), playsOffstage(action, {}, false)]).toEqual([action, "governance", true]);
    expect(answerChange(ORG.id, request, "deny").action).toBe(DECISION_ACTIONS.deny);
  });
});

describe("a motion's card", () => {
  test("the reader's vote plays their vote; the GM sets every voter's and may close it", () => {
    const sent: DecisionChange[] = [];
    const tree = MotionCard({ org: ORG, view, busy: false, gm: false, onChange: (c) => sent.push(c), motion });
    press(labelled(tree, Seg, "Your vote"), "against");
    expect(sent).toEqual([voteChange(ORG.id, motion, "danny_okafor", "against")]);
    expect(propsOf(tree, Button)).toEqual([]);

    const gmSent: DecisionChange[] = [];
    const gmTree = MotionCard({ org: ORG, view, busy: false, gm: true, onChange: (c) => gmSent.push(c), motion });
    press(labelled(gmTree, Seg, "Danny Okafor's vote"), "for");
    expect(gmSent[0]?.gm).toEqual({ org: ORG.id, motion: "m_1", vote: "for", who: "danny_okafor" });
    const close = propsOf(gmTree, Button).find((b) => b.children === "Close it now");
    (close?.onClick as () => void)();
    expect(gmSent[1]?.gm).toEqual({ org: ORG.id, motion: "m_1", how: "close" });
  });

  test("the board says so when nothing is open, and lays out each motion and request", () => {
    const empty = DecisionsBoard({ org: ORG, view: { ...view, open: [], waiting: [] }, busy: false, gm: false, reader: "pov", onChange: () => undefined });
    expect(propsOf(empty, Empty)).toHaveLength(1);
    const full = DecisionsBoard({ org: ORG, view, busy: false, gm: false, reader: "pov", onChange: () => undefined });
    expect(propsOf(full, MotionCard)).toHaveLength(1);
    expect(propsOf(full, RequestCard)).toHaveLength(1);
  });
});
