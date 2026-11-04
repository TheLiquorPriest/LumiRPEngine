// Powers and limits (ORG-SPEC §11 Phase 2) on Port Alder: Danny holds a "Shop foreman" position
// with the staff powers, money.view and money.spend, up to $500 a payment; paying as Alder
// Automotive keeps to that limit and the fiduciary rule, names him on the shop's journal line and
// counts toward his month; Marcus delegates money.spend to Jordan, up to $200 a payment, until
// Friday, which Jordan may not pass on and which ends with Friday; on a rebased view where the shop's
// account can't pay, a payment, its spending record and its History line drop together (L41). And
// the organization's own actions: a position set at once, an appointment within its seats, a rename.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { formatMoney, type WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockAt, dateAt } from "../../../src/engine/calendar";
import { applyEffects } from "../../../src/engine/effects";
import { applyValidUnits } from "../../../src/engine/events";
import { materializeAll } from "../../../src/engine/materialize";
import { heldPositions, orgPower, spendMonth } from "../../../src/engine/org";
import { objOf, sliceOf } from "../../../src/engine/pack-kit";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import type { WorldState } from "../../../src/engine/state";
import { Working } from "../../../src/engine/working";
import { journalOf } from "../../../src/packs/economy/core/journal";
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

/** Port Alder with Danny's job in the Shop foreman position: staff.hire, staff.pay, money.view and money.spend, up to $500 a payment; everyone a test pays or acts as, with their accounts. */
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
  for (const id of [SHOP, MARCUS, DANNY, JORDAN, PRIYA, JESS]) materializeAll(reg, w, id, "acting-for");
  return w;
}

function act(w: Working, actor: string, action: string, params: JsonObject): Resolution {
  return resolveAction(reg, w, { action, params, actor }, createRng(`${action}:${actor}:${w.events.length}`));
}

/** Why it didn't play: the requirement or the effect's refusal; "" when it played. */
function why(res: Resolution): string {
  return res.failed?.reason ?? res.rejected.map((r) => r.rejection.reason).join("; ");
}

function spent(state: Readonly<WorldState>, world: WorldDoc, who: string): number {
  return Number(objOf(objOf(objOf(sliceOf(state, "orgs").spent)[SHOP])[who])[spendMonth(world, state.clock)] ?? 0);
}

/** The date of the coming Friday (`YYYY-MM-DD`), and a clock on the Saturday after it. */
function friday(w: Working): { date: string; after: number } {
  const cal = calendarOf(w.world);
  const now = dateAt(cal, w.state.clock);
  const days = (5 - now.weekday + 7) % 7;
  const d = dateAt(cal, w.state.clock + days * DAY);
  return { date: `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`, after: clockAt(cal, d.dayIndex + 1, 9 * 60) };
}

function money(w: Working, cents: number): string {
  return formatMoney(cents, w.world.currency);
}

describe("Danny, Shop foreman, acts for Alder Automotive within his position", () => {
  test("he hires Jess into Alder Automotive", () => {
    const w = portAlder();
    const hired = act(w, DANNY, "job_hire", { business: SHOP, worker: JESS, title: "Receptionist", rate: 1800 });
    expect(why(hired)).toBe("");
    expect(hired.ok).toBe(true);
  });

  test("hiring himself is refused in the payroll's words", () => {
    const w = portAlder();
    const out = applyEffects(reg, w, [{ type: "economy.hire", args: { business: SHOP, worker: DANNY, title: "Foreman", rate: 3000, by: DANNY } }], { bindings: {}, rng: createRng("hire") });
    expect(out.rejected.map((r) => r.rejection.reason).join("; ")).toContain("can't put themselves on its payroll");
  });

  test("$600 as Alder Automotive is over his limit; $400 posts with him on the shop's journal line and counts toward his month; paying himself is refused", () => {
    const w = portAlder();
    const till = w.state.accounts[TILL] ?? 0;
    const over = act(w, DANNY, "pay", { to: PRIYA, amount: 60000, as: SHOP });
    expect(why(over)).toBe(`Over your limit of ${money(w, 50000)} a payment for Alder Automotive`);
    expect(w.state.accounts[TILL]).toBe(till);

    const paid = act(w, DANNY, "pay", { to: PRIYA, amount: 40000, as: SHOP });
    expect(why(paid)).toBe("");
    expect(w.state.accounts[TILL]).toBe(till - 40000);
    expect(journalOf(w.state, TILL).find((j) => j.cents === -40000)?.by).toBe(DANNY);
    expect(spent(w.state, w.world, DANNY)).toBe(40000);
    expect(orgHistory(w.state, SHOP)[0]).toMatchObject({ text: `Paid Priya Nair ${money(w, 40000)}`, by: DANNY, power: "money.spend" });
    // His own checking paid nothing: the shop did.
    expect(w.state.accounts.acct_danny_checking).toBe(195000);

    const himself = act(w, DANNY, "pay", { to: DANNY, amount: 10000, as: SHOP });
    expect(why(himself)).toBe("Alder Automotive's money pays for Alder Automotive, not for Danny Okafor");
    expect(spent(w.state, w.world, DANNY)).toBe(40000);
  });

  test("acting for himself pays as he always did, with no record of the shop's", () => {
    const w = portAlder();
    const paid = act(w, DANNY, "pay", { to: PRIYA, amount: 1000 });
    expect(why(paid)).toBe("");
    expect(w.state.accounts[TILL]).toBe(2340000);
    expect(paid.events.some((e) => e.type === "orgs.log" || e.type === "orgs.spent")).toBe(false);
  });
});

describe("Marcus delegates money.spend to Jordan, up to $200 a payment, until Friday", () => {
  test("Jordan pays $150 as the shop, not $250; he may not pass it on; after Friday he may not pay", () => {
    const w = portAlder();
    const { date, after } = friday(w);
    const granted = act(w, MARCUS, "org_delegate", { org: SHOP, to: JORDAN, powers: "money.spend", payment: 20000, until: date });
    expect(why(granted)).toBe("");
    expect(orgPower(w.ctx, JORDAN, SHOP, "money.spend")).toEqual({ basis: "delegate", id: MARCUS });

    const paid = act(w, JORDAN, "pay", { to: PRIYA, amount: 15000, as: SHOP });
    expect(why(paid)).toBe("");
    expect(journalOf(w.state, TILL).find((j) => j.cents === -15000)?.by).toBe(JORDAN);
    expect(spent(w.state, w.world, JORDAN)).toBe(15000);
    expect(why(act(w, JORDAN, "pay", { to: PRIYA, amount: 25000, as: SHOP }))).toBe(`Over your limit of ${money(w, 20000)} a payment for Alder Automotive`);

    // He holds no `delegate`, so he can't give the shop's money on.
    const onward = act(w, JORDAN, "org_delegate", { org: SHOP, to: DANNY, powers: "money.spend" });
    expect(onward.ok).toBe(false);
    expect(onward.failed?.code).toBe("requirement");
    expect(orgPower(w.ctx, DANNY, SHOP, "delegate")).toBeNull();

    const saturday = new Working(reg, w.world, { ...w.state, clock: after });
    const late = act(saturday, JORDAN, "pay", { to: PRIYA, amount: 1000, as: SHOP });
    expect(late.ok).toBe(false);
    expect(late.failed?.code).toBe("requirement");
    expect(saturday.state.accounts[TILL]).toBe(w.state.accounts[TILL]);
  });

  test("a delegate's limits are no wider than the granter's: Danny gives his money.spend on at his own $500", () => {
    const w = portAlder();
    const shop = w.state.entities[SHOP];
    if (!shop) throw new Error("no shop");
    shop.fields.positions = [{ id: "shop_foreman", title: "Shop foreman", powers: ["money.spend", "delegate"], limits: { payment: 50000 } }];
    expect(why(act(w, DANNY, "org_delegate", { org: SHOP, to: JORDAN, powers: "money.spend, staff.fire" }))).toBe("Danny Okafor may not let staff go for Alder Automotive, so can't give that");
    expect(why(act(w, DANNY, "org_delegate", { org: SHOP, to: JORDAN, powers: "money.spend", payment: 90000 }))).toBe("");
    expect(why(act(w, JORDAN, "pay", { to: PRIYA, amount: 60000, as: SHOP }))).toBe(`Over your limit of ${money(w, 50000)} a payment for Alder Automotive`);
  });
});

describe("a rebased view keeps or drops a payment as the shop whole (L41)", () => {
  test("where the shop's account can't pay, the payment, its orgs.spent and its orgs.log drop together", () => {
    const w = portAlder();
    const before = structuredClone(w.state) as WorldState;
    const paid = act(w, DANNY, "pay", { to: PRIYA, amount: 40000, as: SHOP });
    expect(why(paid)).toBe("");
    const group = paid.events.find((e) => e.type === "orgs.spent")?.group;
    expect(group).toBeDefined();
    const unit: LedgerEvent[] = paid.events.filter((e) => e.group === group);
    expect(unit.map((e) => e.type)).toEqual(expect.arrayContaining(["post", "economy.txn", "orgs.spent", "orgs.log"]));

    const rich = new Working(reg, w.world, structuredClone(before));
    expect(applyValidUnits(reg, unit, rich.state, (s) => reg.context(rich.world, s))).toHaveLength(unit.length);
    expect(spent(rich.state, rich.world, DANNY)).toBe(40000);

    const poor = new Working(reg, w.world, structuredClone(before));
    const till = poor.state.accounts[TILL] ?? 0;
    expect(poor.apply({ type: "post", lines: [{ account: TILL, amount: -till }, { account: "economy.external:elsewhere", amount: till }], memo: "Spent elsewhere" })).toBeNull();
    expect(applyValidUnits(reg, unit, poor.state, (s) => reg.context(poor.world, s))).toEqual([]);
    expect(spent(poor.state, poor.world, DANNY)).toBe(0);
    expect(orgHistory(poor.state, SHOP)).toEqual([]);
  });
});

describe("the organization's own actions", () => {
  test("Marcus sets a position at once, appoints Jordan within its seats, and renames the shop, each in its History", () => {
    const w = portAlder();
    expect(why(act(w, MARCUS, "org_position", { org: SHOP, title: "Head Mechanic", powers: "staff.hire, staff.pay", seats: 1, payment: 30000 }))).toBe("");
    expect(w.state.entities[SHOP]?.fields.positions).toEqual(expect.arrayContaining([expect.objectContaining({ id: "head_mechanic", title: "Head Mechanic", powers: ["staff.hire", "staff.pay"], seats: 1, limits: { payment: 30000 } })]));

    expect(why(act(w, MARCUS, "org_appoint", { org: SHOP, who: JORDAN, position: "head_mechanic" }))).toBe("");
    expect(heldPositions(w.ctx, JORDAN, SHOP).map((h) => h.position.id)).toContain("head_mechanic");
    // One seat, taken.
    expect(why(act(w, MARCUS, "org_appoint", { org: SHOP, who: DANNY, position: "head_mechanic" }))).toBe("Head Mechanic at Alder Automotive has no seat free");
    // Jordan holds no members.appoint there.
    expect(act(w, JORDAN, "org_appoint", { org: SHOP, who: DANNY, position: "head_mechanic" }).failed?.code).toBe("requirement");

    expect(why(act(w, MARCUS, "org_rename", { org: SHOP, name: "Alder Auto & Marine" }))).toBe("");
    expect(w.state.entities[SHOP]?.name).toBe("Alder Auto & Marine");
    expect(orgHistory(w.state, SHOP).map((l) => l.text)).toEqual(["Renamed from Alder Automotive to Alder Auto & Marine", "Appointed Jordan Ellis Head Mechanic", "Added the position Head Mechanic"]);
    // Renaming is the GM's or a governor's: Jordan's is refused.
    expect(act(w, JORDAN, "org_rename", { org: SHOP, name: "Jordan's" }).failed?.code).toBe("requirement");
  });
});
