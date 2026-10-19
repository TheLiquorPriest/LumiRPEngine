// The user's realism examples (original requirements), one deterministic scenario each, asserted on
// the panel view models the UI renders and on the narrator slots — not only on internal state.
import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../src/shared/world";
import { hashJson } from "../../src/shared/hash";
import { calendarOf, clockOfLocal } from "../../src/engine/calendar";
import { applyEffects } from "../../src/engine/effects";
import { materializeAll, pinnedVersion, previewMaterialization } from "../../src/engine/materialize";
import { REALISM_PRESETS } from "../../src/engine/realism";
import { authorLines, playerLines } from "../../src/engine/player-events";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { ALL_NOTE } from "../../src/engine/simulate";
import { runTimelapse } from "../../src/engine/time";
import { planTurn, timelapseIntent } from "../../src/engine/turn";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import economyPack from "../../src/packs/economy/core/index";
import { buildCastView } from "../../src/packs/castlife/core/index";
import type { PackDef, ReadContext } from "../../src/engine/registry";
import { buildGearView } from "../../src/packs/gear/core/view";
import { buildGarageView } from "../../src/packs/vehicles/core/view";
import { modernUsWorld } from "../packs/riverton";
import { fold, startState, trialBalance } from "../packs/support";
import { reg } from "./harness";

/** The POV's money as the Money panel shows it. */
const moneyView = (ctx: ReadContext) => ctx.query("economy.finance")(ctx, ctx.world.pov, true);

function setup(patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("ex", "Riverton");
  patch(world);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

function lapse(w: Working, minutes: number, seed = "ex"): void {
  const out = runTimelapse(reg, w, { type: "duration", minutes }, { runSeed: seed, overrides: ALL_NOTE });
  if ("code" in out) throw new Error(out.reason);
}

function effects(w: Working, list: { type: string; args: Record<string, string | number | boolean> }[]): ReturnType<typeof applyEffects> {
  return applyEffects(reg, w, list, { bindings: {}, rng: createRng("fx") });
}

/** A narrator slot's lines. */
function slot(w: Working, name: string): string[] {
  return reg.renderers.filter((r) => r.slot === name).flatMap((r) => r.render(w.ctx));
}

function account(w: Working, id: string): number | undefined {
  return moneyView(w.ctx).accounts.find((a) => a.id === id)?.cents;
}

function until(w: Working, local: string): number {
  return clockOfLocal(calendarOf(w.world), local) - w.state.clock;
}

describe("realism examples: money", () => {

  test("a savings transfer moves money between the POV's accounts", () => {
    const w = setup();
    const [c, s] = [account(w, "checking") ?? 0, account(w, "savings") ?? 0];
    const r = resolveAction(reg, w, { action: "move_money", params: { from: "checking", to: "savings", amount: 50000 } }, createRng("t"));
    expect(r.ok).toBe(true);
    expect([account(w, "checking"), account(w, "savings")]).toEqual([c - 50000, s + 50000]);
    expect(moneyView(w.ctx).recent.filter((t) => t.memo === "Transfer").map((t) => t.cents).sort((a, b) => a - b)).toEqual([-50000, 50000]);
  });

  test("a card statement shows interest and a minimum at level 4; at level 3 autopay settles the card", () => {
    const w4 = setup((wd) => {
      wd.realism.levels.money = 4;
    });
    lapse(w4, until(w4, "2026-11-03T12:00"));
    const card = moneyView(w4.ctx).accounts.find((a) => a.id === "card");
    expect(card?.due?.label).toMatch(/^Minimum due/);
    expect(card?.cents).toBeLessThan(-38000);
    const w3 = setup((wd) => {
      wd.realism.levels.money = 3;
    });
    lapse(w3, until(w3, "2026-11-03T12:00"));
    expect(account(w3, "card")).toBe(0);
  });

  test("wallet cash is lost with the wallet, and stolen with it", () => {
    const w = setup((wd) => {
      wd.realism.levels.gear = 3;
    });
    expect(moneyView(w.ctx).cash).toEqual({ cents: 8400 });
    effects(w, [{ type: "gear.drop", args: { item: "wallet", place: "apartment" } }, { type: "economy.lose", args: { item: "wallet" } }]);
    expect(moneyView(w.ctx).cash).toEqual({ cents: 0 });
    expect(buildGearView(w.ctx).carried.some((i) => i.id === "wallet")).toBe(false);
    expect(trialBalance(w.state)).toBe(0);
    const t = setup();
    effects(t, [{ type: "economy.lose", args: { item: "wallet", thief: "rosa" } }]);
    expect(moneyView(t.ctx).recent.some((r) => r.memo === "Stolen with Wallet" && r.cents === -8400)).toBe(true);
  });

  test("a narrated off-catalog purchase is priced inside its category band; one the POV can't afford is declined after the fact", () => {
    const w = setup();
    const ch = reg.proposals.get("purchase");
    const fx = ch?.toEffects({ category: "electronics", name: "a used drone" }, w.ctx) ?? [];
    expect(applyEffects(reg, w, fx, { bindings: {}, rng: createRng("d") }).rejected).toEqual([]);
    const bought = moneyView(w.ctx).recent.find((r) => r.memo === "Bought a used drone");
    const band = w.ctx.query("economy.price")(w.ctx, { category: "electronics" })?.band;
    expect(-(bought?.cents ?? 0)).toBeGreaterThanOrEqual(band?.min ?? 0);
    expect(-(bought?.cents ?? 0)).toBeLessThanOrEqual(band?.max ?? 0);
    const broke = setup((wd) => {
      for (const id of ["cash", "checking", "savings"]) wd.entities[id]!.fields.opening = 100;
      wd.entities.card!.fields.limit = 0;
      wd.entities.card!.fields.opening = 0;
    });
    const before = hashJson(moneyView(broke.ctx));
    const declined = applyEffects(reg, broke, ch?.toEffects({ category: "electronics", name: "a new laptop" }, broke.ctx) ?? [], { bindings: {}, rng: createRng("x") });
    expect(declined.rejected[0]?.rejection.code).toBe("declined");
    expect(hashJson(moneyView(broke.ctx))).toBe(before);
  });

  test("after a 30-day timelapse the books balance and the Montage's money equals the record", () => {
    const world = modernUsWorld("ex", "Riverton");
    world.realism.levels.money = 4;
    const s0 = startState(world);
    const plan = planTurn({ registry: reg, world, state: s0, runSeed: "books", seed: "s", kind: "normal", userTexts: [""], intent: timelapseIntent({ type: "duration", minutes: 30 * 1440 }, ALL_NOTE) });
    const after = fold(reg, world, s0, plan.events);
    expect(trialBalance(after)).toBe(0);
    for (const m of plan.montage?.money ?? []) {
      const lines = plan.events.flatMap((e) => (e.type === "post" ? e.lines.filter((l) => l.account === m.account) : []));
      expect(m.in - m.out).toBe(lines.reduce((a, l) => a + l.amount, 0));
    }
  });
});

describe("realism examples: vehicles", () => {
  const drive = (patch: (w: WorldDoc) => void): number => {
    const w = setup((wd) => {
      wd.realism.levels.vehicles = 4;
      patch(wd);
    });
    const before = buildGarageView(w.ctx).vehicles.find((v) => v.id === "truck")?.fuelPct ?? 0;
    expect(effects(w, [{ type: "vehicles.drive", args: { vehicle: "truck", to: "lake", driver: "you" } }]).rejected).toEqual([]);
    const v = buildGarageView(w.ctx).vehicles.find((x) => x.id === "truck");
    expect(v?.place).toBe("Lake Erie marina");
    return before - (v?.fuelPct ?? 0);
  };

  test("a road trip burns fuel by route and terrain: gravel costs more than pavement", () => {
    const paved = drive(() => undefined);
    const gravel = drive((wd) => {
      wd.routes.town_lake!.modes.road!.terrain = "gravel";
    });
    expect(paved).toBeGreaterThan(0);
    expect(gravel).toBeGreaterThan(paved);
  });

  test("marine and off-road routes: a boat crosses the lake and an ATV takes the trail", () => {
    const w = setup((wd) => {
      wd.realism.levels.vehicles = 3;
      wd.entities.boat = { id: "boat", kind: "vehicle", name: "Bass boat", tier: "background", fields: { owner: "you", class: "bass_boat_outboard", place: "lake", fuel_pct: 80, engine_hours: 120 }, relations: [] };
      wd.entities.atv = { id: "atv", kind: "vehicle", name: "ATV", tier: "background", fields: { owner: "you", class: "atv_utility", place: "trailhead", fuel_pct: 80, engine_hours: 40 }, relations: [] };
    });
    expect(effects(w, [{ type: "vehicles.drive", args: { vehicle: "boat", to: "trailhead" } }, { type: "vehicles.drive", args: { vehicle: "atv", to: "riverton" } }]).rejected).toEqual([]);
    const garage = buildGarageView(w.ctx).vehicles;
    expect(garage.find((v) => v.id === "boat")).toMatchObject({ kind: "marine", place: "Old Quarry trailhead" });
    expect(garage.find((v) => v.id === "atv")).toMatchObject({ kind: "offroad", place: "Riverton" });
    expect(garage.find((v) => v.id === "boat")?.fuelPct).toBeLessThan(80);
    expect(garage.find((v) => v.id === "boat")?.odometerLabel).toMatch(/ h$/);
  });

  test("an assigned-to grant expires to overdue, the owner's retrieval plan takes it back, and it returns to its home base", () => {
    const w = setup((wd) => {
      wd.entities.jordan_car = { id: "jordan_car", kind: "vehicle", name: "Jordan's sedan", tier: "background", fields: { owner: "jordan", class: "midsize_sedan", place: "garage", home: "jordan_house", fuel_pct: 70 }, relations: [] };
    });
    expect(effects(w, [{ type: "gear.lend", args: { item: "jordan_car", to: "you", until: w.state.clock + 60 } }]).rejected).toEqual([]);
    expect(buildGarageView(w.ctx).vehicles.find((v) => v.id === "jordan_car")?.assignedTo).toMatchObject({ name: "Alex Rivera", overdue: false });
    lapse(w, 2 * 1440);
    expect(buildGarageView(w.ctx).vehicles.some((v) => v.id === "jordan_car")).toBe(false);
    expect(w.state.entities.jordan_car?.fields.place).toBe("jordan_house");
    expect(w.events.some((e) => e.type === "engine.signal" && "data" in e && e.data.class === "overdue")).toBe(true);
  });

  test("refuel and service are charged through economy.charge", () => {
    const w = setup((wd) => {
      wd.entities.you!.fields.place = "garage";
    });
    expect(resolveAction(reg, w, { action: "refuel", params: { vehicle: "truck" } }, createRng("f")).ok).toBe(true);
    expect(buildGarageView(w.ctx).vehicles.find((v) => v.id === "truck")?.fuelPct).toBe(100);
    expect(resolveAction(reg, w, { action: "service_vehicle", params: { vehicle: "truck" } }, createRng("s")).ok).toBe(true);
    const memos = moneyView(w.ctx).recent.map((r) => r.memo);
    expect(memos.some((m) => m.startsWith("Fuel for Pickup truck"))).toBe(true);
    expect(memos).toContain("Service: Pickup truck");
    expect(slot(w, "vehicles").join(" ")).toContain("fuel 100%");
  });
});

describe("realism examples: gear", () => {
  test("owned vs worn vs lent", () => {
    const w = setup((wd) => {
      wd.realism.levels.gear = 3;
      wd.entities.hoodie = { id: "hoodie", kind: "item", name: "Hoodie", tier: "background", fields: { owner: "you", catalog: "hoodie", slot: "torso_mid", weight_g: 600 }, relations: [{ type: "in", to: "you" }] };
    });
    effects(w, [{ type: "gear.wear", args: { item: "hoodie", wearer: "you" } }, { type: "gear.lend", args: { item: "toolbox", to: "rosa", until: w.state.clock + 1440 } }]);
    const v = buildGearView(w.ctx);
    expect(v.worn.map((i) => i.id)).toEqual(["hoodie"]);
    expect(v.owned.map((i) => i.id)).toEqual(expect.arrayContaining(["hoodie", "phone", "toolbox", "wallet"]));
    expect(v.owned.find((i) => i.id === "toolbox")?.lent).toMatchObject({ to: "Rosa Delgado", overdue: false });
  });

  test("the toolbox shows 44/45 after a wrench is taken, and the wrench is its own item", () => {
    const w = setup((wd) => {
      wd.entities.you!.fields.place = "garage";
    });
    expect(resolveAction(reg, w, { action: "take_piece", params: { kit: "toolbox", piece: "wrench" } }, createRng("t")).ok).toBe(true);
    const v = buildGearView(w.ctx);
    expect(v.stored.find((i) => i.id === "toolbox")?.kit).toMatchObject({ present: 44, total: 45, complete: false });
    expect(v.carried.some((i) => /wrench/i.test(i.name))).toBe(true);
  });

  test("containers and weight: loads show in the panel and an oversized item doesn't fit", () => {
    const w = setup();
    const wallet = buildGearView(w.ctx).carried.find((i) => i.id === "wallet");
    expect(wallet?.load).toMatchObject({ capacity: 0.08, unit: "l" });
    expect(effects(w, [{ type: "gear.transfer", args: { item: "toolbox", to: "wallet" } }]).rejected.length).toBe(1);
    expect(Number(w.ctx.query("has_item")(w.ctx, "you", "phone"))).toBe(1);
  });
});

describe("realism examples: NPC lives", () => {
  test("a job schedule: Maya is at the café, working, in the Cast panel", () => {
    // Cast shows what someone is doing only to a POV that is with them.
    const w = setup();
    lapse(w, until(w, "2026-10-21T10:00"));
    w.apply({ type: "set", entity: "you", field: "place", value: "cafe" });
    expect(buildCastView(w.ctx).people.find((p) => p.id === "maya")).toMatchObject({ here: true, place: "Daybreak Café", activity: "work shift" });
  });

  test("a school term and a vacation change the day plans", () => {
    const w = setup((wd) => {
      wd.realism.levels.castlife = 3;
      wd.schedules.rosa_school = { id: "rosa_school", owner: "rosa", target: "activity", recurrence: { every: "week", weekdays: [1, 2, 3, 4, 5], from: "2026-10-19", until: "2026-10-23" }, slots: [{ start: "09:00", end: "15:00", value: "school" }] };
    });
    lapse(w, until(w, "2026-10-21T08:00"));
    // Rosa's day shows in Cast while the POV is with her: at her place, then at the lake.
    w.apply({ type: "set", entity: "you", field: "place", value: "apartment_hall" });
    expect(buildCastView(w.ctx).people.find((p) => p.id === "rosa")?.timeline?.some((b) => b.label === "school")).toBe(true);
    const cal = calendarOf(w.world);
    w.state.entities.rosa!.fields.trips = [{ from: clockOfLocal(cal, "2026-10-28T08:00"), until: clockOfLocal(cal, "2026-10-30T20:00"), place: "lake", label: "Fishing trip" }];
    lapse(w, until(w, "2026-10-28T13:00"));
    w.apply({ type: "set", entity: "you", field: "place", value: "lake" });
    const rosa = buildCastView(w.ctx).people.find((p) => p.id === "rosa");
    expect(rosa?.timeline?.some((b) => b.label === "school")).toBe(false);
    expect(rosa?.timeline?.some((b) => b.label === "Fishing trip")).toBe(true);
    expect(rosa?.place).toBe("Lake Erie marina");
  });

  test("agenda progress shows in the Cast panel", () => {
    const w = setup((wd) => {
      // A public agenda shows for someone the POV knows, here or away.
      wd.entities.you!.relations.push({ type: "knows", to: "jordan" });
      wd.tracks.jordan_plan = {
        id: "jordan_plan",
        kind: "agenda",
        label: "Open a second office",
        owner: "jordan",
        start: "scout",
        visibility: "public",
        stages: {
          scout: { label: "Scout a location", priority: 2, objectives: ["flag('scouted')"], next: [{ to: "lease", when: "track.complete" }] },
          lease: { label: "Sign the lease", priority: 3, next: [] },
        },
      };
    });
    expect(buildCastView(w.ctx).people.find((p) => p.id === "jordan")?.agenda).toEqual([{ label: "Open a second office", stage: "Scout a location" }]);
    effects(w, [{ type: "story.flag", args: { name: "scouted" } }]);
    lapse(w, 360);
    expect(buildCastView(w.ctx).people.find((p) => p.id === "jordan")?.agenda).toEqual([{ label: "Open a second office", stage: "Sign the lease" }]);
  });

  test("an invitation in the tie zone reaches the Montage, and a recorded decision overrides it", () => {
    const world = modernUsWorld("inv", "Riverton");
    world.realism.levels.castlife = 4;
    world.realism.levels.relationships = 4;
    world.entities.maya!.relations.push({ type: "regard", to: "you", fields: { warmth: 60, trust: 50, respect: 40, t: 0 } });
    const plan = planTurn({ registry: reg, world, state: startState(world), runSeed: "inv", seed: "s", kind: "normal", userTexts: [""], intent: timelapseIntent({ type: "duration", minutes: 4 * 1440 }, ALL_NOTE) });
    const lines = (plan.montage?.groups ?? []).flatMap((g) => g.lines);
    expect(lines.some((l) => /^Maya Chen invites you/.test(l))).toBe(true);
    const choice = plan.events.find((e) => e.type === "engine.choice" && "data" in e && String(e.data.key).startsWith("maya:invite:"));
    expect(choice).toBeDefined();
  });

  test("an invitation to a place the POV can't see names it in no player line or Montage, only in the GM's line", () => {
    const world = modernUsWorld("inv", "Riverton");
    world.realism.levels.castlife = 4;
    world.realism.levels.relationships = 4;
    world.entities.maya!.relations.push({ type: "regard", to: "you", fields: { warmth: 60, trust: 50, respect: 40, t: 0 } });
    // Away from the POV's own building, every place is one it doesn't know.
    const own = new Set(["riverton", "apartment_bldg", "apartment", "apartment_hall", "garage"]);
    for (const p of Object.values(world.places)) if (!own.has(p.id)) p.visibility = "secret";
    const hidden = Object.values(world.places).flatMap((p) => (own.has(p.id) ? [] : [p.name]));
    const state = startState(world);
    const plan = planTurn({ registry: reg, world, state, runSeed: "inv", seed: "s", kind: "normal", userTexts: [""], intent: timelapseIntent({ type: "duration", minutes: 4 * 1440 }, ALL_NOTE) });
    const invitations = plan.events.filter((e) => e.type === "castlife.invitation");
    const montage = (plan.montage?.groups ?? []).flatMap((g) => g.lines).filter((l) => l.includes("invites you"));
    const player = playerLines(reg, world, state, world.pov, plan.events, 1000).filter((l) => l.includes("invites you"));
    expect([invitations.length > 0, montage.length > 0]).toEqual([true, true]);
    for (const line of [...montage, ...player]) {
      expect(line).toMatch(/invites you to meet up at \d/);
      for (const name of hidden) expect(line).not.toContain(name);
    }
    // The GM's lines, worded for no one, still say where.
    const first = invitations[0];
    const where = first && "data" in first && typeof first.data.place === "string" ? (world.places[first.data.place]?.name ?? "") : "";
    expect(where).not.toBe("");
    expect(authorLines(reg, world, state, invitations, 10).some((l) => l.includes(where))).toBe(true);
  });

  test("an NPC↔NPC encounter changes their regard (what rules and predicates read)", () => {
    const w = setup((wd) => {
      wd.realism.levels.castlife = 4;
      wd.realism.levels.relationships = 3;
      wd.entities.maya!.fields.home = "cafe";
      wd.entities.rosa!.fields.home = "cafe";
      wd.entities.rosa!.relations.push({ type: "regard", to: "maya", fields: { warmth: 10, trust: 10, respect: 10 } });
    });
    lapse(w, 4 * 1440);
    expect(w.ctx.query("regard")(w.ctx, "rosa", "maya")).not.toBe(10);
  });

  test("feelings decay over time without contact (Relationships 4)", () => {
    const w = setup((wd) => {
      wd.realism.levels.relationships = 4;
      wd.entities.maya!.relations.push({ type: "regard", to: "you", fields: { warmth: 60, trust: 60, respect: 60, t: 0 } });
    });
    effects(w, [{ type: "relationships.adjust", args: { from: "maya", to: "you", delta: 1 } }]);
    const at = (): number | undefined => buildCastView(w.ctx).people.find((p) => p.id === "maya")?.regard?.find((r) => r.axis === "Warmth")?.value;
    const v0 = at() ?? 0;
    expect(v0).toBeGreaterThan(60);
    w.apply({ type: "clock", minutes: 30 * 1440, cause: "advance" });
    expect(at()).toBeCloseTo(v0 / 2, 1);
  });

  test("NPC↔NPC feelings decay too (Relationships 4), from the anchor a coarsened record leaves", () => {
    const world = modernUsWorld("npc", "Riverton");
    world.realism.levels.relationships = 4;
    world.realism.tierCaps = { principal: {}, supporting: {}, background: {} };
    world.realism.levels.castlife = 2;
    world.entities.rosa!.relations.push({ type: "regard", to: "maya", fields: { warmth: 40, trust: 20, respect: 20, t: 450 } });
    const s0 = startState(world);
    const plan = planTurn({ registry: reg, world, state: s0, runSeed: "npc", seed: "s", kind: "normal", userTexts: [""], intent: timelapseIntent({ type: "duration", minutes: 30 * 1440 }, ALL_NOTE) });
    const after = fold(reg, world, s0, plan.events);
    const ctx = reg.context(world, after);
    expect(ctx.query("regard")(ctx, "rosa", "maya", "warmth")).toBeCloseTo(20, 0);
    expect(ctx.query("regard_band")(ctx, "rosa", "maya")).toBe("neutral");
  });
});

describe("realism examples: mixed tiers and defaults", () => {
  test("cast at level 4 and background at level 1 in one world; the Story preset's defaults", () => {
    const w = setup((wd) => {
      wd.realism.levels.relationships = 4;
      wd.realism.tierCaps.background = { relationships: 1 };
      wd.entities.barista = { id: "barista", kind: "person", name: "Sam the barista", tier: "background", fields: { place: "apartment", home: "cafe" }, relations: [{ type: "regard", to: "you", fields: { warmth: 30, trust: 30, respect: 30 } }] };
      // `t` is the world start (07:30 on the epoch day), so nothing has decayed yet.
      wd.entities.maya!.relations.push({ type: "regard", to: "you", fields: { warmth: 30, trust: 20, respect: 10, t: 450 } });
    });
    const cast = buildCastView(w.ctx).people;
    expect(cast.find((p) => p.id === "maya")?.regard).toEqual([
      { axis: "Warmth", band: "warm", value: 30 },
      { axis: "Trust", band: "warm", value: 20 },
      { axis: "Respect", band: "neutral", value: 10 },
    ]);
    expect(cast.find((p) => p.id === "barista")?.regard).toEqual([{ axis: "overall", band: "warm" }]);
    expect(slot(w, "people")).toContain("Sam the barista is warm toward you.");
    const story = modernUsWorld("story", "Riverton (Story)");
    story.realism = { preset: "story", ...structuredClone(REALISM_PRESETS.story) };
    const s = new Working(reg, story, startState(story));
    materializeAll(reg, s, story.pov, "run");
    const money = moneyView(s.ctx);
    expect(money.level).toBe(story.realism.levels.money);
    if (money.level === 1 && money.band) expect(money.cash).toEqual({ band: money.band });
  });
});

describe("realism examples: materialization persistence", () => {
  test("detail shown once stays identical after a reload, a Re-run of a later turn and an extension update with pinned versions", () => {
    const world = modernUsWorld("mat", "Riverton");
    for (const id of ["cash", "checking", "savings", "card"]) delete world.entities[id];
    world.realism.levels.money = 3;
    world.pins.generators.money = 1;
    const s0 = startState(world);
    const t1 = planTurn({ registry: reg, world, state: s0, runSeed: "r", seed: "t1", kind: "normal", userTexts: [""], intent: null });
    const s1 = fold(reg, world, s0, t1.events);
    const shown = moneyView(reg.context(world, s1)).accounts;
    expect(shown.length).toBeGreaterThan(0);
    // Reload: the ledger folds to the same panel.
    expect(moneyView(reg.context(world, fold(reg, world, s0, t1.events))).accounts).toEqual(shown);
    // Re-run of a later turn with a fresh seed: what turn 1 materialized doesn't change.
    for (const seed of ["t2-a", "t2-b"]) {
      const t2 = planTurn({ registry: reg, world, state: s1, runSeed: "r", seed, kind: "normal", userTexts: [""], intent: null });
      expect(moneyView(reg.context(world, fold(reg, world, s1, t2.events))).accounts.map((a) => [a.id, a.name, a.cents])).toEqual(shown.map((a) => [a.id, a.name, a.cents]));
    }
    // Extension update: a build with economy generator v2 folds the same ledger to the same panel,
    // and never samples new detail for the world pinned to v1.
    const v2: PackDef = {
      ...economyPack,
      version: 2,
      register(r) {
        economyPack.register({ ...r, materializer: (def) => r.materializer({ ...def, version: 2, materialize: () => [] }) });
      },
    };
    const updated = createRegistry(ALL_PACKS.map((p) => (p.id === "economy" ? v2 : p)));
    expect(moneyView(updated.context(world, fold(updated, world, s0, t1.events))).accounts).toEqual(shown);
    expect(pinnedVersion(world, updated, "money")).toMatchObject({ code: "generator_pin" });
    expect(previewMaterialization(updated, world, s0, "you", "money", "r")).toEqual([]);
  });
});
