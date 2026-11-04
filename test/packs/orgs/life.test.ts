// An organization's life (ORG-SPEC §11 Phase 4, Life; §3.14-3.15): in Harrowmere, when the GM sets
// Sir Alaric's life to dead, Captain Rupert holds Master from the next slot as its named successor,
// the Thornes' History says so and the People line reads "(master of Harrowmere)", and the signal to
// a member names him only where the player character may see him; succession follows the world's
// switch and this chat's own; Danny's mind reads Your organizations: his position, whom he reports to
// and his limit. Alerts (a vacancy, the seat of a company wound up falling vacant, a delegation
// ending, someone's hidden by name and id) and the Plan (assess-party §6.2): goals and orders set at
// once, moved along by those they're asked of, read by the page, the narrator and the minds they
// name, and from the player's own message.

import { describe, expect, test } from "bun:test";
import { opaqueId } from "../../../src/shared/hash";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { ALERTS_SECTION, PLAN_SECTION, type OrgAlertView, type OrgPlanView } from "../../../src/shared/org-feed";
import type { WorldDoc } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { heldPositions, orgPower } from "../../../src/engine/org";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { placeOfEntity } from "../../../src/engine/scope";
import { advance } from "../../../src/engine/simulate";
import { Working } from "../../../src/engine/working";
import { peopleLines } from "../../../src/packs/castlife/core/index";
import { agendaAsks, agendaLabel, planExtractLines, planMemoryLines, planMindLines, planNarratorLines, planRead } from "../../../src/packs/orgs/core/agenda";
import { orgMindLines, personTitles } from "../../../src/packs/orgs/core/feed";
import { orgHistory } from "../../../src/packs/orgs/core/log";
import { buildOrgView } from "../../../src/packs/orgs/core/view";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const THORNES = "household_thorne";
const ALARIC = "sir_alaric";
const RUPERT = "rupert_thorne";
const SHOP = "alder_automotive_co";
const MARCUS = "marcus_delgado";
const DANNY = "danny_okafor";
const DAY = 1440;

function starter(id: string, name: string, edit?: (world: WorldDoc) => void): Working {
  const make = STARTER_WORLDS[id];
  if (!make) throw new Error(`no ${id} starter`);
  const world: WorldDoc = make(id.slice(0, 2), name);
  edit?.(world);
  return new Working(reg, world, startState(world, reg));
}

function effect(w: Working, type: string, args: JsonObject): LedgerEvent[] {
  const out = applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) });
  if (out.rejected.length > 0) throw new Error(out.rejected.map((r) => r.rejection.reason).join("; "));
  return out.applied;
}

function act(w: Working, action: string, params: JsonObject, actor = "pov"): Resolution {
  return resolveAction(reg, w, { action, params, actor }, createRng(`${action}:${w.events.length}`));
}

function why(res: Resolution): string {
  return res.failed?.reason ?? res.rejected.map((r) => r.rejection.reason).join("; ");
}

/** Sir Alaric dies, and time runs on past the next slot. */
function alaricDies(w: Working): void {
  effect(w, "life", { entity: ALARIC, to: "dead" });
  advance(reg, w, w.state.clock + 12 * 60, { runSeed: "life", mode: "turn" });
}

describe("succession (ORG-SPEC §3.14)", () => {
  test("Sir Alaric dies: from the next slot Captain Rupert holds Master as its named successor, the History says so and the People line reads (master of Harrowmere)", () => {
    const w = starter("mystery_manor", "Harrowmere");
    expect(heldPositions(w.ctx, RUPERT, THORNES).map((h) => h.position.id)).toEqual([]);
    alaricDies(w);
    expect(heldPositions(w.ctx, RUPERT, THORNES).map((h) => h.position.title)).toEqual(["Master"]);
    // The title held with the seat passes with it.
    const link = w.state.entities[RUPERT]?.relations.find((r) => r.type === "member_of" && r.to === THORNES);
    expect(link?.fields).toMatchObject({ position: "head", role: "Master of Harrowmere" });
    expect(orgHistory(w.state, THORNES).map((l) => l.text)).toContain("Captain Rupert Thorne succeeds Sir Alaric Thorne as Master");
    // Filled once: the next slots leave it as it is.
    const after = w.events.length;
    advance(reg, w, w.state.clock + 12 * 60, { runSeed: "life2", mode: "turn" });
    expect(w.events.slice(after).filter((e) => e.type === "orgs.log")).toEqual([]);
    // The player character in the room with him reads his title.
    effect(w, "set", { entity: "pov", field: "place", value: placeOfEntity(w.state, RUPERT) ?? "" });
    const line = peopleLines(w.ctx, "player").find((l) => l.text.startsWith("Captain Rupert Thorne"));
    expect(line?.text).toStartWith("Captain Rupert Thorne (master of Harrowmere)");
    expect(personTitles(w.ctx, RUPERT)).toEqual(["master of Harrowmere"]);
  });

  test("off in the world's orgs config, or by this chat's own switch, nobody succeeds; the chat's switch on wins over the world's off", () => {
    const off = starter("mystery_manor", "Harrowmere", (world) => {
      world.packs.orgs = { version: 1, config: { succession: false } };
    });
    alaricDies(off);
    expect(heldPositions(off.ctx, RUPERT, THORNES)).toEqual([]);
    effect(off, "orgs.succession", { on: true });
    advance(reg, off, off.state.clock + 12 * 60, { runSeed: "on", mode: "turn" });
    expect(heldPositions(off.ctx, RUPERT, THORNES).map((h) => h.position.id)).toEqual(["head"]);
    const chat = starter("mystery_manor", "Harrowmere");
    effect(chat, "orgs.succession", { on: false });
    alaricDies(chat);
    expect(heldPositions(chat.ctx, RUPERT, THORNES)).toEqual([]);
  });

  test("a seat whose successor is next goes to the senior holder of a position reporting to it", () => {
    const w = starter("fantasy_town", "Brindlemere");
    const crew = "ferry_crew";
    const hand = w.state.entities.pip_marlow ? "pip_marlow" : (Object.keys(w.state.entities).find((id) => w.state.entities[id]?.relations.some((r) => r.type === "member_of" && r.to === crew && r.fields?.position === "ferry_hand")) ?? "");
    const boss = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.relations.some((r) => r.type === "member_of" && r.to === crew && r.fields?.position === "ferrywoman")) ?? "";
    expect(boss).not.toBe("");
    effect(w, "life", { entity: boss, to: "dead" });
    advance(reg, w, w.state.clock + 12 * 60, { runSeed: "ferry", mode: "turn" });
    expect(heldPositions(w.ctx, hand, crew).map((h) => h.position.id)).toEqual(["ferrywoman"]);
  });

  test("the signal that tells a member names the successor only where the player character may see them", () => {
    const signals = (secret: boolean): string[] => {
      const w = starter("mystery_manor", "Harrowmere", (world) => {
        world.entities.pov?.relations.push({ type: "member_of", to: THORNES });
        const rupert = world.entities[RUPERT];
        if (rupert && secret) rupert.visibility = "secret";
      });
      const from = w.events.length;
      alaricDies(w);
      return w.events.slice(from).flatMap((e) => (e.type === "engine.signal" && "data" in e && typeof e.data.text === "string" ? [e.data.text] : []));
    };
    expect(signals(false)).toContain("Captain Rupert Thorne now holds Master for The Thornes.");
    const hidden = signals(true);
    expect(hidden).toContain("Someone now holds Master for The Thornes.");
    expect(hidden.join("\n")).not.toContain("Rupert");
  });
});

/** Port Alder with Marcus as Manager and Danny's job in Shop foreman, reporting to him, up to $500 a payment. */
function foremanShop(): Working {
  return starter("modern_slice_of_life", "Port Alder", (world) => {
    const shop = world.entities[SHOP];
    const job = world.entities.job_danny_mechanic;
    const marcus = world.entities[MARCUS];
    if (!shop || !job || !marcus) throw new Error("no shop, job or Marcus");
    shop.fields.positions = [
      { id: "manager", title: "Manager", powers: ["staff.hire", "staff.fire", "staff.pay", "money.view", "money.spend", "orders.give"] },
      { id: "shop_foreman", title: "Shop foreman", powers: ["staff.hire", "staff.pay", "money.view", "money.spend"], limits: { payment: 50000 }, reports_to: "manager" },
    ] as unknown as JsonValue;
    job.fields = { ...job.fields, position: "shop_foreman" };
    marcus.relations.push({ type: "member_of", to: SHOP, fields: { position: "manager" } });
  });
}

describe("a mind's Your organizations (ORG-SPEC §3.15)", () => {
  test("Danny's lists his position, whom he reports to and his limit", () => {
    const w = foremanShop();
    const lines = orgMindLines(w.ctx, DANNY);
    const shop = lines.find((l) => l.includes("Alder Automotive"));
    expect(shop).toContain("Shop foreman");
    expect(shop).toContain("you report to Marcus Delgado");
    expect(shop).toContain("up to $500.00 a payment");
  });
});

describe("alerts (ORG-SPEC §3.14)", () => {
  test("a vacant seat needs whoever may appoint; a delegation ending within 3 days needs its delegate", () => {
    const w = starter("mystery_manor", "Harrowmere", (world) => {
      world.packs.orgs = { version: 1, config: { succession: false } };
    });
    alaricDies(w);
    const alerts = (who: string | null): OrgAlertView[] => (buildOrgView(w.ctx, THORNES, who)?.sections[ALERTS_SECTION] ?? []) as unknown as OrgAlertView[];
    expect(alerts(null).map((a) => a.text)).toContain("Master is vacant.");
    // Lady Honoria may appoint? Only through the Master's powers, which no one acting holds: her delegation has the staff and spending powers.
    expect(alerts("lady_honoria").find((a) => a.kind === "vacancy")?.needsYou).toBe(false);
    effect(w, "orgs.delegate", { org: THORNES, to: "verity_lorne", powers: "money.view", until: w.state.clock + 2 * DAY });
    const verity = alerts("verity_lorne").find((a) => a.kind === "delegation_ending");
    expect(verity).toMatchObject({ needsYou: true, tab: "overview" });
    expect(verity?.text).toStartWith("Your delegation to act for it ends");
  });

  test("a delegation ending for someone the reader can't see reads Someone's, and its alert carries no id of theirs", () => {
    const w = starter("mystery_manor", "Harrowmere", (world) => {
      const verity = world.entities.verity_lorne;
      if (verity) verity.visibility = "secret";
    });
    effect(w, "orgs.delegate", { org: THORNES, to: "verity_lorne", powers: "money.view", until: w.state.clock + 2 * DAY });
    const ending = (who: string | null): OrgAlertView | undefined => ((buildOrgView(w.ctx, THORNES, who)?.sections[ALERTS_SECTION] ?? []) as unknown as OrgAlertView[]).find((a) => a.kind === "delegation_ending");
    // Sir Alaric, the Master, may delegate: he is told, without her name or her id.
    const alaric = ending(ALARIC);
    expect(alaric?.text).toStartWith("Someone's delegation ends");
    expect(alaric?.id).toBe(`delegation:${opaqueId("verity_lorne")}`);
    expect(JSON.stringify(alaric)).not.toMatch(/verity/i);
    // The GM reads whose it is.
    expect(ending(null)).toMatchObject({ id: "delegation:verity_lorne", text: expect.stringMatching(/^Verity Lorne's delegation ends/) });
  });

  test("a company seated as the Thorne Trust's Director holds the seat while it stands; wound up, its seat falls vacant and its owner's powers there end", () => {
    const w = starter("mystery_manor", "Harrowmere", (world) => {
      world.entities.thorne_estates = { id: "thorne_estates", kind: "business", name: "Thorne Estates", tier: "background", fields: { owners: [{ party: RUPERT, role: "owner", share: 100 }], structure: "llc" }, relations: [{ type: "member_of", to: "thorne_trust", fields: { position: "director" } }] };
      const trust = world.entities.thorne_trust;
      if (trust) trust.fields = { ...trust.fields, positions: [{ id: "director", title: "Director", powers: ["money.view", "money.spend"] }] };
    });
    const alerts = (): string[] => ((buildOrgView(w.ctx, "thorne_trust", null)?.sections[ALERTS_SECTION] ?? []) as unknown as OrgAlertView[]).map((a) => a.text);
    expect(heldPositions(w.ctx, "thorne_estates", "thorne_trust").map((h) => h.position.id)).toEqual(["director"]);
    expect(alerts()).not.toContain("Director is vacant.");
    expect(orgPower(w.ctx, RUPERT, "thorne_trust", "money.spend")).toEqual({ basis: "control", id: "thorne_estates", through: ["thorne_estates"] });
    effect(w, "set", { entity: "thorne_estates", field: "dissolved", value: "2026-09-14" });
    expect(heldPositions(w.ctx, "thorne_estates", "thorne_trust")).toEqual([]);
    expect(alerts()).toContain("Director is vacant.");
    expect(orgPower(w.ctx, RUPERT, "thorne_trust", "money.spend")).toBeNull();
  });
});

describe("the Plan (assess-party §6.2)", () => {
  test("the leader sets a goal and orders at once; the page, the narrator, the minds and the memory step read them; an order's own people move it along", () => {
    const w = starter("modern_slice_of_life", "Port Alder");
    effect(w, "orgs.party_tier", { who: DANNY, tier: "companion" });
    const party = "party_pov";
    const goal = act(w, "org_goal", { org: party, text: "Get the shop ready for the inspection", window: "today" });
    expect(why(goal)).toBe("");
    const view = (who: string | null): OrgPlanView | null => (buildOrgView(w.ctx, party, who)?.sections[PLAN_SECTION] ?? null) as unknown as OrgPlanView | null;
    const goalId = view("pov")?.goals[0]?.id ?? "";
    expect(goalId).toStartWith("g_");
    expect(why(act(w, "org_order", { org: party, to: DANNY, text: "Sweep the bays and stack the tyres", goal: goalId }))).toBe("");
    const plan = view("pov");
    expect(plan?.mayGive).toBe(true);
    expect(plan?.goals[0]?.orders.map((o) => [o.text, o.to.map((t) => t.name)])).toEqual([["Sweep the bays and stack the tyres", ["Danny Okafor"]]]);
    const orderId = plan?.goals[0]?.orders[0]?.id ?? "";
    // The narrator, Danny's mind (a companion weighs it) and his memory step.
    expect(planNarratorLines(w.ctx).join("\n")).toContain("Danny Okafor: Sweep the bays and stack the tyres.");
    expect(planNarratorLines(w.ctx).at(-1)).toContain("never mark anything done");
    expect(planMindLines(w.ctx, DANNY)[0]).toContain("Sweep the bays and stack the tyres");
    expect(planMindLines(w.ctx, DANNY)[0]).toContain("you may take it on or refuse");
    expect(planMemoryLines(w.ctx, DANNY)).toEqual([`- [${orderId}] Sweep the bays and stack the tyres`]);
    // Danny moves his own order along; he may not drop it, which is the giver's.
    expect(why(act(w, "org_plan_status", { org: party, id: orderId, status: "under_way" }, DANNY))).toBe("");
    expect(view("pov")?.goals[0]?.orders[0]?.status).toBe("under_way");
    expect(why(act(w, "org_plan_status", { org: party, id: orderId, status: "dropped" }, DANNY))).not.toBe("");
    expect(why(act(w, "org_plan_status", { org: party, id: orderId, status: "done" }, DANNY))).toBe("");
    expect(view("pov")?.goals[0]?.ordersDone).toBe(true);
    // Someone outside the party sees none of it, and may give it no orders.
    expect(view(MARCUS)).toBeNull();
    expect(why(act(w, "org_goal", { org: party, text: "Take over" }, MARCUS))).not.toBe("");
  });

  test("the player's own message adds to the party's plan, each item in its own words; words not in the message are refused", () => {
    const w = starter("modern_slice_of_life", "Port Alder");
    effect(w, "orgs.party_tier", { who: DANNY, tier: "core" });
    const message = "Danny, you're on the brake job for the Civic tonight. We need the shop clean by Friday.";
    const read = planRead(w.ctx, { goals: [{ text: "The shop clean by Friday", said: "We need the shop clean by Friday" }], orders: [{ to: ["Danny"], text: "The brake job for the Civic", said: "you're on the brake job for the Civic" }] }, message);
    if ("code" in read) throw new Error(read.reason);
    expect({ org: read.org, goals: read.goals, orders: read.orders }).toEqual({ org: "party_pov", goals: 1, orders: 1 });
    expect(read.events.map((e) => e.type)).toEqual(["orgs.goal", "orgs.order"]);
    const refused = planRead(w.ctx, { orders: [{ to: ["Danny"], text: "Paint the van", said: "paint the van" }] }, message);
    expect("code" in refused ? refused.code : "").toBe("not_said");
  });

  test("someone volunteering in the reply asks Add to the plan?; a yes is their order, given by the player character, quoting the reply; a status finds its item by id", () => {
    const w = starter("modern_slice_of_life", "Port Alder");
    effect(w, "orgs.party_tier", { who: DANNY, tier: "companion" });
    const channel = reg.proposals.get("agenda");
    if (!channel) throw new Error("no agenda channel");
    const offer: JsonObject = { type: "agenda", who: "Danny", offer: "Handle the permits", said: "I'll handle the permits" };
    expect(agendaAsks(offer)).toBe(true);
    expect(channel.validate(offer, w.ctx)).toBeNull();
    expect(agendaLabel(w.ctx, { ...offer, who: DANNY })).toBe("Add to the plan? Danny Okafor: Handle the permits");
    // Nobody the player character knows, or the player character, can't offer.
    expect(channel.validate({ ...offer, who: "Nobody Atall" }, w.ctx)?.code).toBe("not_found");
    expect(channel.validate({ ...offer, who: "pov" }, w.ctx)?.code).toBe("not_found");
    for (const spec of channel.toEffects(offer, w.ctx)) effect(w, spec.type, spec.args as JsonObject);
    const plan = buildOrgView(w.ctx, "party_pov", "pov")?.sections[PLAN_SECTION] as unknown as OrgPlanView;
    expect(plan.orders.map((o) => [o.text, o.to.map((t) => t.name), o.set, o.last?.note])).toEqual([["Handle the permits", ["Danny Okafor"], expect.stringMatching(/^Set by you .*, from the story$/), "I'll handle the permits"]]);
    // Offered again, it is on the plan already.
    expect(channel.validate(offer, w.ctx)?.code).toBe("already");
    const id = plan.orders[0]?.id ?? "";
    expect(planExtractLines(w.ctx)).toEqual([`- [${id}] your party (party_pov), order for Danny Okafor: Handle the permits (open)`]);
    // A status names the item; the organization may be left out or named by its name.
    const done: JsonObject = { type: "agenda", org: "your party", id, status: "done", said: "Danny drops the signed permits on the desk" };
    expect(agendaAsks(done)).toBe(false);
    expect(channel.validate(done, w.ctx)).toBeNull();
    expect(agendaLabel(w.ctx, done)).toBe("Done: Handle the permits");
    for (const spec of channel.toEffects(done, w.ctx)) effect(w, spec.type, spec.args as JsonObject);
    expect((buildOrgView(w.ctx, "party_pov", "pov")?.sections[PLAN_SECTION] as unknown as OrgPlanView | undefined)?.orders ?? []).toEqual([]);
    expect(channel.validate(done, w.ctx)?.code).toBe("closed");
  });
});
