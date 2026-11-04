// Requests for approval over limits (ORG-SPEC Phase 5, the acceptance in DESIGN §29.20) on Port
// Alder. Danny holds Shop foreman (money.spend up to $500 a payment): paying $600 as Alder Automotive
// is refused in the limit's words; asked with `ask`, it is put to Marcus instead, and nothing moves;
// approved, the $600 posts then, as Danny's (his journal line, his month), with Marcus named, in the
// approval's unit, which a rebased view where the shop can't pay drops whole; denied or withdrawn,
// it closes; after its days it lapses. Only those up the requester's chain of command may answer it,
// each within their own limits: a delegate's request goes to whoever granted the delegation and the
// holders of the positions above theirs, never to someone else with a high enough limit.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { formatMoney, type WorldDoc } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { applyValidUnits } from "../../../src/engine/events";
import { materializeAll } from "../../../src/engine/materialize";
import { spendMonth } from "../../../src/engine/org";
import { objOf, sliceOf } from "../../../src/engine/pack-kit";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import type { WorldState } from "../../../src/engine/state";
import { Working } from "../../../src/engine/working";
import { journalOf } from "../../../src/packs/economy/core/journal";
import { requestState, requestsOf } from "../../../src/packs/orgs/core/approvals";
import { orgHistory } from "../../../src/packs/orgs/core/log";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const TILL = "acct_marcus_shop";
const MARCUS = "marcus_delgado";
const DANNY = "danny_okafor";
const JORDAN = "pov";
const JESS = "jess_kowalczyk";
const PRIYA = "priya_nair";
const DAY = 1440;

/** Port Alder with Danny's job in the Shop foreman position: money.view and money.spend, up to $500 a payment. */
function portAlder(): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world: WorldDoc = make("pa", "Port Alder");
  const shop = world.entities[SHOP];
  const job = world.entities.job_danny_mechanic;
  if (!shop || !job) throw new Error("no shop or no job for Danny");
  shop.fields.positions = [{ id: "shop_foreman", title: "Shop foreman", powers: ["staff.hire", "staff.pay", "money.view", "money.spend"], limits: { payment: 50000 } }];
  job.fields = { ...job.fields, position: "shop_foreman" };
  const w = new Working(reg, world, startState(world, reg));
  for (const id of [SHOP, MARCUS, DANNY, JORDAN, PRIYA, JESS]) materializeAll(reg, w, id, "approvals");
  return w;
}

function act(w: Working, actor: string, action: string, params: JsonObject): Resolution {
  return resolveAction(reg, w, { action, params, actor }, createRng(`${action}:${actor}:${w.events.length}`));
}

function why(res: Resolution): string {
  return res.failed?.reason ?? res.rejected.map((r) => r.rejection.reason).join("; ");
}

function spent(state: Readonly<WorldState>, world: WorldDoc, who: string): number {
  return Number(objOf(objOf(objOf(sliceOf(state, "orgs").spent)[SHOP])[who])[spendMonth(world, state.clock)] ?? 0);
}

function money(w: Working, cents: number): string {
  return formatMoney(cents, w.world.currency);
}

/** Danny's $600 payment to Priya as the shop, asked for approval; its id. */
function asked(w: Working): string {
  const r = act(w, DANNY, "pay", { to: PRIYA, amount: 60000, as: SHOP, ask: true });
  expect(why(r)).toBe("");
  const req = requestsOf(w.state, SHOP)[0];
  if (!req) throw new Error("no request");
  return req.id;
}

describe("an act over a limit, put to whoever holds the power above", () => {
  test("$600 as Alder Automotive is refused in the limit's words; asked, it waits on Marcus and nothing moves", () => {
    const w = portAlder();
    const till = w.state.accounts[TILL] ?? 0;
    expect(why(act(w, DANNY, "pay", { to: PRIYA, amount: 60000, as: SHOP }))).toBe(`Over your limit of ${money(w, 50000)} a payment for Alder Automotive`);
    const r = act(w, DANNY, "pay", { to: PRIYA, amount: 60000, as: SHOP, ask: true });
    expect(why(r)).toBe("");
    const [req] = requestsOf(w.state, SHOP);
    expect(req).toMatchObject({ by: DANNY, power: "money.spend", cents: 60000, text: `Paid Priya Nair ${money(w, 60000)}`, why: `Over your limit of ${money(w, 50000)} a payment for Alder Automotive`, approvers: [MARCUS], status: "asked" });
    expect(req?.what.type).toBe("economy.transfer");
    expect(req ? req.until - req.at : 0).toBe(7 * DAY);
    expect(w.state.accounts[TILL]).toBe(till);
    expect(spent(w.state, w.world, DANNY)).toBe(0);
    expect(orgHistory(w.state, SHOP)[0]?.text).toBe(`Danny Okafor asked Marcus Delgado to approve: Paid Priya Nair ${money(w, 60000)} (Over your limit of ${money(w, 50000)} a payment for Alder Automotive)`);
    // Within the limit, asking changes nothing: it is paid.
    expect(why(act(w, DANNY, "pay", { to: PRIYA, amount: 10000, as: SHOP, ask: true }))).toBe("");
    expect(w.state.accounts[TILL]).toBe(till - 10000);
    expect(requestsOf(w.state, SHOP)).toHaveLength(1);
  });

  test("Marcus approves: the $600 posts as Danny's, counted to his month, with Marcus named, in one unit", () => {
    const w = portAlder();
    const id = asked(w);
    const till = w.state.accounts[TILL] ?? 0;
    const r = act(w, MARCUS, "org_approve", { org: SHOP, request: id });
    expect(why(r)).toBe("");
    expect(w.state.accounts[TILL]).toBe(till - 60000);
    expect(journalOf(w.state, TILL).find((j) => j.cents === -60000)?.by).toBe(DANNY);
    expect(spent(w.state, w.world, DANNY)).toBe(60000);
    expect(orgHistory(w.state, SHOP)[0]).toMatchObject({ text: `Paid Priya Nair ${money(w, 60000)} (approved by Marcus Delgado)`, by: DANNY, power: "money.spend" });
    expect(requestsOf(w.state, SHOP)[0]).toMatchObject({ status: "approved", answered: { by: MARCUS } });
    expect(new Set(r.events.map((e) => e.group)).size).toBe(1);
    expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(["post", "economy.txn", "orgs.spent", "orgs.log", "orgs.answer"]));
    // Answered: no second approval.
    expect(why(act(w, MARCUS, "org_approve", { org: SHOP, request: id }))).toContain("approved already");
  });

  test("denied, it closes with nothing paid; Danny's own deny withdraws it", () => {
    const w = portAlder();
    const till = w.state.accounts[TILL] ?? 0;
    const id = asked(w);
    expect(why(act(w, MARCUS, "org_deny", { org: SHOP, request: id, why: "Wait for the next order" }))).toBe("");
    expect(requestsOf(w.state, SHOP)[0]).toMatchObject({ status: "denied", answered: { by: MARCUS, why: "Wait for the next order" } });
    expect(w.state.accounts[TILL]).toBe(till);
    expect(orgHistory(w.state, SHOP)[0]?.text).toBe(`Marcus Delgado denied Danny Okafor's request: Paid Priya Nair ${money(w, 60000)}: Wait for the next order`);

    const v = portAlder();
    const other = asked(v);
    expect(why(act(v, DANNY, "org_deny", { org: SHOP, request: other }))).toBe("");
    expect(requestsOf(v.state, SHOP)[0]?.status).toBe("withdrawn");
  });

  test("after its 7 days it lapses, and approving it is refused", () => {
    const w = portAlder();
    const id = asked(w);
    const req = requestsOf(w.state, SHOP)[0];
    if (!req) throw new Error("no request");
    w.state.clock = req.until + 1;
    expect(requestState(w, req)).toBe("lapsed");
    expect(why(act(w, MARCUS, "org_approve", { org: SHOP, request: id }))).toStartWith("It lapsed on");
  });

  test("lapsed requests aren't kept forever: the last 20 answered or lapsed, and every one still waiting", () => {
    const w = portAlder();
    for (let i = 0; i < 25; i++) {
      expect(why(act(w, DANNY, "pay", { to: PRIYA, amount: 60000, as: SHOP, ask: true }))).toBe("");
      const all = requestsOf(w.state, SHOP);
      const last = all[all.length - 1];
      if (!last) throw new Error("no request");
      if (i < 24) w.state.clock = last.until + 1;
    }
    const kept = requestsOf(w.state, SHOP);
    expect(kept).toHaveLength(21);
    expect(kept.filter((r) => requestState(w, r) === "lapsed")).toHaveLength(20);
    expect(kept.map((r) => requestState(w, r)).at(-1)).toBe("asked");
  });

  test("its History lines name whom the act pays, so a reader who can't see them reads someone", () => {
    const w = portAlder();
    const id = asked(w);
    expect(orgHistory(w.state, SHOP)[0]?.names?.map((n) => n.id)).toEqual(expect.arrayContaining([DANNY, MARCUS, PRIYA]));
    expect(why(act(w, MARCUS, "org_deny", { org: SHOP, request: id }))).toBe("");
    expect(orgHistory(w.state, SHOP)[0]?.names?.map((n) => n.id)).toEqual(expect.arrayContaining([DANNY, MARCUS, PRIYA]));
  });

  test("only those above may answer it: not Jess, nor Danny on Jordan's request over Marcus's $200 delegation, until Jordan's position reports to his", () => {
    const w = portAlder();
    const id = asked(w);
    expect(why(act(w, JESS, "org_approve", { org: SHOP, request: id }))).toBe("Jess Kowalczyk may not approve it: they aren't above Danny Okafor at Alder Automotive");
    expect(why(act(w, MARCUS, "org_delegate", { org: SHOP, to: JORDAN, powers: "money.spend", payment: 20000 }))).toBe("");
    expect(why(act(w, JORDAN, "pay", { to: PRIYA, amount: 25000, as: SHOP, ask: true }))).toBe("");
    const mine = requestsOf(w.state, SHOP).find((r) => r.by === JORDAN);
    expect(mine?.why).toBe(`Over your limit of ${money(w, 20000)} a payment for Alder Automotive`);
    // Danny's own $500 a payment would cover $250, but he isn't above Jordan: only the granter, the shop's owner, may.
    expect(mine?.approvers).toEqual([MARCUS]);
    expect(why(act(w, DANNY, "org_approve", { org: SHOP, request: mine?.id ?? "" }))).toBe("Danny Okafor may not approve it: they aren't above Jordan Ellis at Alder Automotive");

    // Jordan's Mechanic position reporting to Shop foreman puts Danny up his chain, after the granter, within Danny's own limit.
    const v = portAlder();
    const shop = v.state.entities[SHOP];
    if (!shop) throw new Error("no shop");
    shop.fields.positions = [{ id: "mechanic", title: "Mechanic", powers: [], reports_to: "shop_foreman" }, ...(Array.isArray(shop.fields.positions) ? shop.fields.positions : [])];
    expect(why(act(v, MARCUS, "org_delegate", { org: SHOP, to: JORDAN, powers: "money.spend", payment: 20000 }))).toBe("");
    expect(why(act(v, JORDAN, "pay", { to: PRIYA, amount: 25000, as: SHOP, ask: true }))).toBe("");
    expect(why(act(v, JORDAN, "pay", { to: PRIYA, amount: 60000, as: SHOP, ask: true }))).toBe("");
    expect(requestsOf(v.state, SHOP).map((r) => r.approvers)).toEqual([[MARCUS, DANNY], [MARCUS]]);
  });

  test("the reply's approval fact for Marcus approves it; Danny's own, or a hedged one, is refused", () => {
    const w = portAlder();
    const id = asked(w);
    const approval = reg.proposals.get("approval");
    if (!approval) throw new Error("no approval channel");
    const fact: JsonObject = { type: "approval", who: "Marcus", org: "Alder Automotive", request: id, answer: "approve", said: "Marcus signs off on the order" };
    expect(approval.validate({ ...fact, who: "Danny" }, w.ctx)?.reason).toBe("Danny Okafor may not approve it: it's their own request");
    expect(approval.validate({ ...fact, said: "Marcus says he might sign off on it" }, w.ctx)?.code).toBe("not_stated");
    expect(approval.validate(fact, w.ctx)).toBeNull();
    expect(applyEffects(reg, w, approval.toEffects(fact, w.ctx), { bindings: {}, rng: createRng("story-approval") }).rejected).toEqual([]);
    expect(requestsOf(w.state, SHOP)[0]).toMatchObject({ status: "approved", answered: { by: MARCUS } });
  });

  test("a rebased view where the shop's account can't pay drops the approval's unit whole", () => {
    const w = portAlder();
    const id = asked(w);
    const before = structuredClone(w.state) as WorldState;
    const r = act(w, MARCUS, "org_approve", { org: SHOP, request: id });
    expect(why(r)).toBe("");
    const unit: LedgerEvent[] = [...r.events];
    const rich = new Working(reg, w.world, structuredClone(before));
    expect(applyValidUnits(reg, unit, rich.state, (s) => reg.context(rich.world, s))).toHaveLength(unit.length);
    const poor = new Working(reg, w.world, structuredClone(before));
    const left = poor.state.accounts[TILL] ?? 0;
    expect(poor.apply({ type: "post", lines: [{ account: TILL, amount: -left }, { account: "economy.external:elsewhere", amount: left }], memo: "Spent elsewhere" })).toBeNull();
    expect(applyValidUnits(reg, unit, poor.state, (s) => reg.context(poor.world, s))).toEqual([]);
    expect(requestsOf(poor.state, SHOP)[0]?.status).toBe("asked");
    expect(spent(poor.state, poor.world, DANNY)).toBe(0);
  });

  test("the whole ledger folds to the same records again", () => {
    const w = portAlder();
    const id = asked(w);
    expect(why(act(w, MARCUS, "org_approve", { org: SHOP, request: id }))).toBe("");
    const again = startState(w.world, reg);
    expect(applyValidUnits(reg, w.events, again, (s) => reg.context(w.world, s))).toHaveLength(w.events.length);
    expect(sliceOf(again, "orgs").asks).toEqual(sliceOf(w.state, "orgs").asks);
    expect(again.accounts[TILL]).toBe(w.state.accounts[TILL]);
  });
});
