// The organizations' presses and what each one records: every kind of event the orgs' out-of-play actions record (a membership, a title, a
// position, a delegation, the dues, the decision rules, a motion, a vote, a motion's end, a request and its answer, a plan, who may enter a
// place, a trespass, a setting, the party) is taken back by its Undo, and the world reads as it did before the press. The requests
// and the place's entry are asked of the world as a reply's events, since a press makes a request only when its act is over a limit and an
// entry only for a thing a business holds; they are taken back by the same Undo of a change. Every name is the starter world's own, invented.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { action, diffs, essence, listAt, pressed, type Rig, rig } from "../../play/undo-rig";

interface Step {
  label: string;
  id: string;
  params: JsonObject;
  keep?: true;
}

/** Each step pressed and taken back: it applied, its Undo said nothing was left, and the world is what it was. */
async function play(r: Rig, steps: readonly Step[]): Promise<void> {
  for (const step of steps) {
    const done = await pressed(r, action(step.id, step.params));
    expect(done.tap.applied, `${step.label}: ${done.tap.words}`).toBe(true);
    expect(done.undo?.words, `${step.label}: the Undo`).toBe("");
    expect(done.differs, `${step.label}: what the Undo gave back`).toEqual([]);
    if (step.keep) expect((await r.tap(action(step.id, step.params))).applied, `${step.label}: again`).toBe(true);
  }
}

const idOf = (r: Rig, name: string): string => Object.entries(r.world().entities).find(([, e]) => e.name === name && e.fields.gone !== true)?.[0] ?? "";
const ev = (type: string, data: JsonObject): LedgerEvent => ({ type, data }) as unknown as LedgerEvent;

describe("the organizations' presses are taken back whole", () => {
  test("a group's members, titles, positions, delegations, dues, rules, plan and name", async () => {
    const r = await rig("pov");
    await play(r, [{ label: "start a group", id: "org_found", params: { type: "group", name: "Zed Lodge", kind: "faction" }, keep: true }]);
    const lodge = idOf(r, "Zed Lodge");
    await play(r, [
      { label: "admit someone", id: "org_admit", params: { org: lodge, who: "danny_okafor" }, keep: true },
      { label: "a title", id: "org_title", params: { org: lodge, who: "pov", title: "Chair" } },
      { label: "a position", id: "org_position", params: { org: lodge, title: "Treasurer", id: "treasurer", powers: "money.spend" }, keep: true },
      { label: "appoint to it", id: "org_appoint", params: { org: lodge, who: "danny_okafor", position: "treasurer" } },
      { label: "delegate", id: "org_delegate", params: { org: lodge, to: "danny_okafor", powers: "money.spend" }, keep: true },
      { label: "revoke it", id: "org_revoke", params: { org: lodge, to: "danny_okafor" } },
      { label: "dues", id: "org_dues", params: { org: lodge, amount: 500, every: "month" } },
      { label: "how decisions are made", id: "org_decisions", params: { org: lodge, vote_by: "members", quorum: 1 } },
      { label: "a standing vote", id: "org_vote_rule", params: { org: lodge, vote: "for" } },
      { label: "a goal", id: "org_goal", params: { org: lodge, text: "Do a thing" }, keep: true },
    ]);
    const goal = String(listAt(r, ["orgs", "plan", lodge, "goals"])[0]?.id ?? "");
    expect(goal).not.toBe("");
    await play(r, [
      { label: "an order", id: "org_order", params: { org: lodge, to: "danny_okafor", text: "Fetch tea", goal }, keep: true },
      { label: "a goal done", id: "org_plan_status", params: { org: lodge, id: goal, status: "done" } },
      { label: "rename it", id: "org_rename", params: { org: lodge, name: "Zed Lodge No. 2" } },
      { label: "remove a member", id: "org_remove", params: { org: lodge, who: "danny_okafor" } },
    ]);
  });

  test("the party: its name, a hand's tier, its purse and a hired hand", async () => {
    await play(await rig("pov"), [
      { label: "name the party", id: "party_name", params: { name: "Crew" }, keep: true },
      { label: "a tier", id: "party_tier", params: { who: "danny_okafor", tier: "companion" } },
      { label: "a purse", id: "party_purse", params: { amount: 5000 }, keep: true },
      { label: "hire a hand", id: "party_hire", params: { worker: "danny_okafor", title: "Hand", basis: "hourly", rate: 2000, hours_per_week: 5, pay_every: "week" } },
    ]);
  });

  test("a motion put to the members, a vote cast and changed, and the motion withdrawn", async () => {
    const r = await rig("pov");
    await play(r, [{ label: "shares to be voted on", id: "shares_issue", params: { business: "alder_automotive_co", to: "nora_whitfield", units: 10, vote: true }, keep: true }]);
    const motion = String(listAt(r, ["orgs", "motions", "alder_automotive_co"])[0]?.id ?? "");
    expect(motion).not.toBe("");
    await play(r, [
      { label: "a vote", id: "org_vote", params: { org: "alder_automotive_co", motion, vote: "for" }, keep: true },
      { label: "the vote changed", id: "org_vote", params: { org: "alder_automotive_co", motion, vote: "against" }, keep: true },
      { label: "the motion withdrawn", id: "org_motion_end", params: { org: "alder_automotive_co", motion } },
    ]);
  });

  test("a request and its answer, who may enter a place, a trespass and a setting, each as a reply tells of it", async () => {
    const r = await rig("pov");
    const clock = r.world().clock;
    const before = essence(r.world());
    const ask = ev("orgs.ask", { org: "alder_automotive_co", request: { id: "r_test1", by: "pov", power: "money.spend", cents: 5000, text: "Pay a bill", why: "over my limit", what: { type: "economy.transfer", args: {} }, approvers: ["marcus_delgado"], at: clock, until: clock + 100_000, status: "asked" } });
    const answer = ev("orgs.answer", { org: "alder_automotive_co", id: "r_test1", status: "denied", by: "marcus_delgado", at: clock });
    const changes = await r.record([ask, answer, ev("orgs.entry", { place: "alder_automotive", entry: "members" }), ev("orgs.trespass", { entity: "pov", place: "alder_automotive", at: clock }), ev("orgs.config", { key: "succession", value: true })]);
    expect(changes.map((c) => c.applied)).toEqual([true, true, true, true, true]);
    expect(diffs(before, essence(r.world())).length).toBeGreaterThan(0);
    // Newest first: each is taken back with nothing left, and the world reads as it did.
    for (const change of [...changes].reverse()) expect((await r.take(change.id)).left).toEqual([]);
    expect(diffs(before, essence(r.world()))).toEqual([]);
  });

  test("a change a later change has written over stays, and the Undo names it", async () => {
    const r = await rig("pov");
    const [first] = await r.record([ev("orgs.entry", { place: "alder_automotive", entry: "members" })]);
    await r.record([ev("orgs.entry", { place: "alder_automotive", entry: "public" })]);
    const done = await r.take(first?.id ?? 0);
    expect(done.left.map((l) => l.code)).toEqual(["changed_since"]);
    expect(done.left[0]?.values?.op).toBe("orgs.entry");
  });
});
