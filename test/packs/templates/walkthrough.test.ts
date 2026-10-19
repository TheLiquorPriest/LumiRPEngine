// Plays each starter world through its headline story with the real action, rule and track code:
// the quests can be finished, the secrets stay hidden until found, and scripted events fire.

import { describe, expect, test } from "bun:test";
import type { TravelOption } from "../../../src/packs/vehicles/core/index";
import { balance, priceOf } from "../../../src/packs/economy/core/model";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { commitments } from "../../../src/packs/castlife/core/index";
import { coreEventTypes, type EventTypes } from "../../../src/engine/events";
import type { EventTypeDef } from "../../../src/engine/registry";
import { runRulesOnEvents } from "../../../src/engine/rules";
import { knowing, lifeKnownTo, lifeOf } from "../../../src/engine/life";
import { unobserved } from "../../../src/engine/seen";
import { dropTouches } from "../../../src/engine/touched";
import type { WorldState } from "../../../src/engine/state";
import { buildQuestLog } from "../../../src/packs/story/core/index";
import { playerTrack } from "../../../src/engine/visibility";
import { hashJson } from "../../../src/shared/hash";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import { STARTER_WORLDS } from "../../../src/packs/starters/index";
import { fold, startState } from "../support";
import { Play, registry } from "./play";

const DAY = 1440;

describe("Brindlemere (fantasy_town)", () => {
  test("Far Bank Fever: agree, cross, deliver, done", () => {
    const p = new Play("fantasy_town");
    expect(p.stage("q_far_bank_fever")).toBe("offer");
    p.at("pov", "wren_cottage");
    p.at("wren_aldous", "wren_cottage");
    expect(p.act("agree_carry").ok).toBe(true);
    expect(p.stage("q_far_bank_fever")).toBe("carry");
    p.at("pov", "ferry_landing");
    p.settle();
    expect(p.stage("q_far_bank_fever")).toBe("cross");
    p.at("pov", "far_bank_waystation");
    p.at("bram_hesketh", "far_bank_waystation");
    p.settle();
    expect(p.stage("q_far_bank_fever")).toBe("deliver");
    const handed = p.act("give", { item: "fever_poultice", to: "bram_hesketh" });
    expect(handed.ok).toBe(true);
    expect(handed.rejected).toEqual([]);
    expect(p.stage("q_far_bank_fever")).toBe("done");
  });

  test("the storm closes the ferry and, hours later, the sky and the ferry recover", () => {
    const p = new Play("fantasy_town");
    expect(p.eval("route_open('rt_landing_farbank')")).toBe(true);
    p.lapseTo(3960 + 120);
    expect(p.flag("storm_active")).toBe(true);
    expect(p.flag("ferry_running")).toBe(false);
    expect(p.eval("route_open('rt_landing_farbank')")).toBe(false);
    expect(p.eval("weather('wend_vale')")).toBe("storm");
    p.lapseTo(3960 + 1260 + 60 * 8);
    expect(p.flag("storm_active")).toBe(false);
    expect(p.flag("ferry_running")).toBe(true);
    expect(p.eval("route_open('rt_landing_farbank')")).toBe(true);
    expect(p.eval("weather('wend_vale')")).not.toBe("storm");
  });

  test("the next Marketday takes ten percent off prices in the square until 15:00 and only there", () => {
    const p = new Play("fantasy_town");
    // Clothing, priced in whole bits, is dear enough for a tenth off to show.
    const unit = (place: string) => priceOf(p.w.ctx, { category: "clothing", place })?.unitCents ?? 0;
    p.lapseTo(7 * DAY + 10 * 60); // the Marketday a week after the start, 10:00
    expect(unit("wend_mill")).toBeGreaterThan(0);
    expect(Math.abs(unit("market_square") - Math.round(unit("wend_mill") * 0.9))).toBeLessThanOrEqual(1);
    expect(unit("market_square")).toBeLessThan(unit("wend_mill"));
    p.lapseTo(7 * DAY + 16 * 60); // after the stalls close
    expect(unit("market_square")).toBe(unit("wend_mill"));
  });

  test("the vestry tiles show in Quests once the vestry floor is found, and not before", () => {
    const p = new Play("fantasy_town");
    expect(playerTrack(registry, p.world, p.state, "pov", "p_vestry_tiles")).toBeNull();
    p.w.apply({ type: "story.flag", data: { name: "bell_asks", value: 2 } });
    p.settle();
    expect(p.stage("s_quiet_bell")).toBe("rumor");
    expect(playerTrack(registry, p.world, p.state, "pov", "p_vestry_tiles")).toBeNull();
    p.at("pov", "chapel_quiet_bell");
    p.settle();
    expect(p.stage("s_quiet_bell")).toBe("vestry");
    expect(playerTrack(registry, p.world, p.state, "pov", "p_vestry_tiles")?.cue).toContain("The lintel reads");
  });

  test("the original charter is a hidden item until the bell secret reveals it", () => {
    const p = new Play("fantasy_town");
    expect(p.state.entities.charter_original).toBeUndefined();
  });
});

describe("Harrowmere Hall (mystery_manor)", () => {
  test("the whole inquiry: clues, the safe, the accusation and the truth", () => {
    const p = new Play("mystery_manor");
    expect(p.state.entities.trust_ledger).toBeUndefined();
    expect(p.stage("s_thorne_death")).toBe("before");
    expect(playerTrack(registry, p.world, p.state, "pov", "s_thorne_death")).toBeNull();

    // Friday evening, before the body is found: the tincture window is open.
    p.lapseTo(1320);
    p.at("pov", "drawing_room");
    expect(p.act("find_tincture_bottle").ok).toBe(true);
    expect(p.act("accuse", { who: "julian_ashcombe" }).failed?.code).toBe("requirement");
    // Nobody has died yet, so the Quests panel shows nothing of the secret track, even holding the bottle.
    expect(p.stage("s_thorne_death")).toBe("before");
    expect(playerTrack(registry, p.world, p.state, "pov", "s_thorne_death")).toBeNull();

    // Saturday morning: the body is found and the inquiry opens.
    p.lapseTo(DAY + 8 * 60 + 30);
    expect(p.flag("body_found")).toBe(true);
    // Holding the bottle, the inquiry moves straight on from the first cue.
    expect(p.stage("s_thorne_death")).toBe("s1_unnatural");
    expect(playerTrack(registry, p.world, p.state, "pov", "s_thorne_death")?.cue).toContain("tincture");
    expect(p.flag("alaric_alive")).toBe(false);
    p.at("pov", "library");
    expect(p.act("find_second_glass").ok).toBe(true);
    expect(p.act("find_burnt_page").ok).toBe(true);
    p.at("pov", "conservatory");
    expect(p.act("find_muddy_prints").ok).toBe(true);
    p.at("pov", "upper_floor");
    p.at("julian_ashcombe", "dining_room");
    expect(p.act("find_ashcombe_shoes").ok).toBe(true);
    p.at("pov", "kitchen");
    p.at("mrs_marsh", "kitchen");
    expect(p.act("sit_with_mrs_marsh").ok).toBe(true);
    expect(p.act("find_marsh_testimony").ok).toBe(true);

    p.at("pov", "study");
    expect(p.act("find_trust_ledger").failed?.code).toBe("requirement");
    expect(p.state.entities.trust_ledger).toBeUndefined();
    const opened = p.answer("p_study_safe", "1887");
    expect(opened.correct).toBe(true);
    expect(p.stage("p_study_safe")).toBe("open");
    expect(p.act("find_trust_ledger").ok).toBe(true);
    expect(p.state.entities.trust_ledger).toBeDefined();
    expect(p.stage("s_thorne_death")).toBe("s4_culprit");

    expect(p.stage("q_find_the_truth")).toBe("accuse");
    expect(p.act("accuse", { who: "julian_ashcombe" }).ok).toBe(true);
    expect(p.stage("q_find_the_truth")).toBe("solved");
    expect(p.stage("s_thorne_death")).toBe("truth");
  });

  test("the first cue about the death shows only once the body is found", () => {
    const p = new Play("mystery_manor");
    p.lapseTo(1320);
    expect(playerTrack(registry, p.world, p.state, "pov", "s_thorne_death")).toBeNull();
    p.lapseTo(DAY + 8 * 60 + 30);
    expect(p.stage("s_thorne_death")).toBe("cue");
    expect(playerTrack(registry, p.world, p.state, "pov", "s_thorne_death")?.cue).toContain("heart gave out");
  });

  test("Cut Off waits out of the quest log until the 21:30 gale has put the telephone out", () => {
    const p = new Play("mystery_manor");
    const active = () => buildQuestLog(p.w.ctx).active.map((t) => t.id);
    expect(active()).toContain("q_find_the_truth");
    expect(active()).not.toContain("q_call_for_help");
    p.lapseTo(21 * 60 + 15); // Friday evening, the line still works
    expect(active()).not.toContain("q_call_for_help");
    p.lapseTo(22 * 60 + 30); // the gale broke at 21:30
    expect(p.stage("q_call_for_help")).toBe("cut_off");
    expect(active()).toContain("q_call_for_help");
  });

  test("Sir Alaric dies in the library on Friday night: his body stays there, off every timetable, and only those with him or told know", () => {
    const p = new Play("mystery_manor");
    const alaric = () => p.state.entities.sir_alaric?.fields;
    expect(alaric()?.place).toBe("library");
    expect(alaric()?.activity).toBe("among his collection");
    // Rules fire at slot ticks: by half past six on Saturday he is dead; Ashcombe, with him, knows, and the player hasn't heard.
    p.lapseTo(DAY + 6 * 60 + 30);
    expect([lifeOf(p.state, "sir_alaric"), lifeKnownTo(p.state, "sir_alaric", "julian_ashcombe"), lifeKnownTo(p.state, "sir_alaric", "pov")]).toEqual(["dead", "dead", "alive"]);
    // Nell's scream at 07:20 tells the household and the player.
    p.lapseTo(DAY + 8 * 60 + 30);
    expect(p.flag("body_found")).toBe(true);
    expect([lifeKnownTo(p.state, "sir_alaric", "pov"), lifeKnownTo(p.state, "sir_alaric", "lady_honoria")]).toEqual(["dead", "dead"]);
    for (const [clock, what] of [[DAY + 9 * 60 + 43, "Saturday 09:43"], [2 * DAY + 10 * 60, "Sunday 10:00"], [7 * DAY + 20 * 60, "the next Friday at dinner"]] as const) {
      p.lapseTo(clock);
      expect([what, alaric()?.place, lifeOf(p.state, "sir_alaric")]).toEqual([what, "library", "dead"]);
    }
  });

  test("the study safe shows in Quests once the player steps into the study, and not before", () => {
    const p = new Play("mystery_manor");
    expect(playerTrack(registry, p.world, p.state, "pov", "p_study_safe")).toBeNull();
    const move = { type: "set" as const, entity: "pov", field: "place", value: "study" };
    p.w.apply(move);
    expect(runRulesOnEvents(registry, p.w, [move], { seed: "walk" }).map((f) => f.rule)).toContain("r_study_safe_noticed");
    expect(playerTrack(registry, p.world, p.state, "pov", "p_study_safe")?.cue).toContain("The dial takes four digits");
  });

  test("with no accusation the constable arrives on Sunday and the question stays open", () => {
    const p = new Play("mystery_manor");
    p.lapseTo(2 * DAY + 14 * 60);
    expect(p.flag("storm_active")).toBe(false);
    expect(p.flag("causeway_open")).toBe(true);
    expect(p.flag("constable_arrived")).toBe(true);
    expect(p.stage("q_find_the_truth")).toBe("unresolved");
  });
});

describe("Port Alder (modern_slice_of_life)", () => {
  test("Maddie's school term runs 31 August to 20 November and 30 November to 18 December, with Thanksgiving week and winter break off", () => {
    const p = new Play("modern_slice_of_life");
    const cal = calendarOf(p.world);
    const at = (iso: string) => clockOfLocal(cal, iso);
    const school = (date: string) => commitments(p.w.ctx, "maddie_kowalczyk", at(`${date}T00:00`), at(`${date}T23:59`)).filter((c) => c.kind === "school");
    for (const date of ["2026-09-14", "2026-09-16", "2026-11-20", "2026-11-30", "2026-12-18"]) {
      const day = school(date);
      expect(day.length).toBe(1);
      expect(day[0]?.start).toBe(at(`${date}T08:00`));
      expect(day[0]?.end).toBe(at(`${date}T15:10`));
      expect(day[0]?.place).toBe("lakeshore_school");
    }
    // Saturday, the week of Thanksgiving (Monday to Friday), and the first Monday of winter break.
    for (const date of ["2026-09-19", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-12-19", "2026-12-21"]) expect(school(date)).toEqual([]);
    // She is a cast member the planner runs, and she is in class on a term weekday.
    expect(p.world.entities.maddie_kowalczyk?.agent).toBe(true);
    p.lapseTo(at("2026-09-16T10:00"));
    expect(p.state.entities.maddie_kowalczyk?.fields.place).toBe("lakeshore_school");
    expect(p.state.entities.maddie_kowalczyk?.fields.activity).toBe("school");
  });

  test("Danny's weekend in Chicago holds him away from Friday evening 25 September to Sunday evening 27 September", () => {
    const p = new Play("modern_slice_of_life");
    const at = (iso: string) => clockOfLocal(calendarOf(p.world), iso);
    expect(p.world.entities.danny_okafor?.fields.trips).toEqual([{ from: at("2026-09-25T17:30"), until: at("2026-09-27T19:00"), place: "chicago_il", label: "Visiting family in Chicago" }]);
    p.lapseTo(at("2026-09-24T12:00"));
    expect(p.state.entities.danny_okafor?.fields.place).not.toBe("chicago_il");
    p.lapseTo(at("2026-09-26T08:00"));
    expect(p.state.entities.danny_okafor?.fields.place).toBe("chicago_il");
    p.lapseTo(at("2026-09-27T23:00"));
    expect(p.state.entities.danny_okafor?.fields.place).not.toBe("chicago_il");
  });

  test("the player's index-fund account holds $3,125.00 of the broad US index, takes an investment from checking and moves on the seeded price path", () => {
    const fund = "acct_pov_brokerage";
    const run = () => {
      const p = new Play("modern_slice_of_life");
      expect(p.state.entities[fund]?.fields.symbol).toBe("broad_us_equity_index");
      // Pins the converter's starting price (100 per unit) to the economy pack's default.
      expect(balance(p.state, fund)).toBe(312500);
      expect(balance(p.state, fund)).toBe(0);
      const checking = balance(p.state, "acct_pov_checking");
      expect(p.act("invest", { amount: 50000 }).ok).toBe(true);
      expect(balance(p.state, "acct_pov_checking")).toBe(checking - 50000);
      expect(balance(p.state, fund)).toBe(362500);
      p.lapse(14 * DAY);
      return balance(p.state, fund);
    };
    const after = run();
    expect(after).not.toBe(362500);
    expect(after).toBeGreaterThan(250000);
    expect(after).toBeLessThan(500000);
    expect(run()).toBe(after); // the same run seed gives the same path
  });

  test("the township truck puzzle shows in Quests once the shop takes the job", () => {
    const p = new Play("modern_slice_of_life");
    expect(playerTrack(registry, p.world, p.state, "pov", "p_township_truck")).toBeNull();
    p.w.apply({ type: "story.flag", data: { name: "fleet_deal_accepted", value: true } });
    p.settle();
    expect(p.stage("q_fleet_contract")).toBe("trial");
    expect(playerTrack(registry, p.world, p.state, "pov", "p_township_truck")?.cue).toContain("turns over fine but never fires");
  });

  test("the fleet contract: the repair, the walk-through, the signing and the service run", () => {
    const p = new Play("modern_slice_of_life");
    p.at("pov", "alder_automotive");
    p.at("marcus_delgado", "alder_automotive");
    p.at("priya_nair", "alder_automotive");
    expect(p.act("accept_fleet_job").ok).toBe(true);
    expect(p.stage("q_fleet_contract")).toBe("trial");
    expect(p.act("replace_fuel_pump_relay").ok).toBe(true);
    expect(p.stage("p_township_truck")).toBe("fixed");
    expect(p.stage("q_fleet_contract")).toBe("inspection");
    expect(p.act("walk_priya_through_repair").ok).toBe(true);
    p.at("pov", "township_hall");
    p.at("priya_nair", "township_hall");
    expect(p.act("sign_fleet_contract").ok).toBe(true);
    expect(p.stage("q_fleet_contract")).toBe("service_run");
    p.at("pov", "alder_automotive");
    expect(p.act("service_township_fleet").ok).toBe(true);
    expect(p.stage("q_fleet_contract")).toBe("done");
  });

  test("the player's own fishing boat offers the Gull Island crossing from the marina and sails it", () => {
    const p = new Play("modern_slice_of_life");
    expect(p.state.entities.pov_boat?.fields.owner).toBe("pov");
    expect(p.state.entities.pov_boat?.fields.place).toBe("alder_harbor_marina");
    const options = () => (p.w.ctx.query("vehicles.travel_options") as (ctx: unknown, from: string) => TravelOption[])(p.w.ctx, "alder_harbor_marina");
    const crossing = options().find((o) => o.to === "gull_island" && o.vehicle === "Your fishing boat");
    expect(crossing?.mode).toBe("water");
    expect(crossing?.minutes).toBe(25);
    expect(crossing?.label).toContain("Gull Island");
    expect(crossing?.disabled).toBeUndefined();
    // Dale's pontoon belongs to Dale, so it is not offered to the player.
    expect(options().some((o) => o.vehicle === "Dale's pontoon")).toBe(false);
    p.at("pov", "alder_harbor_marina");
    const fuel = Number(p.state.entities.pov_boat?.fields.fuel_pct);
    const sailed = p.act(crossing?.action ?? "drive", crossing?.params);
    expect(sailed.ok).toBe(true);
    expect(p.state.entities.pov?.fields.place).toBe("gull_island");
    expect(p.state.entities.pov_boat?.fields.place).toBe("gull_island");
    expect(Number(p.state.entities.pov_boat?.fields.fuel_pct)).toBeLessThan(fuel);
  });

  test("the pontoon weekend: diagnose, repair, sea trial, the loan and the return", () => {
    const p = new Play("modern_slice_of_life");
    p.at("pov", "alder_harbor_marina");
    p.at("dale_whitcomb", "alder_harbor_marina");
    for (const step of ["look_at_pontoon", "diagnose_pontoon", "repair_pontoon", "run_sea_trial"]) expect(p.act(step).ok).toBe(true);
    expect(p.stage("q_pontoon_weekend")).toBe("loan");
    expect(p.flag("pontoon_loaned")).toBe(true);
    p.set("marina_pontoon", "place", "gull_island");
    p.lapse(360);
    expect(p.flag("pontoon_out")).toBe(true);
    p.set("marina_pontoon", "place", "alder_harbor_marina");
    p.set("marina_pontoon", "fuel_pct", 95);
    p.settle();
    expect(p.stage("q_pontoon_weekend")).toBe("done");
  });

  test("the gale closes the Gull Island ferry and the advisory is lifted the next morning", () => {
    const p = new Play("modern_slice_of_life");
    expect(p.eval("route_open('rt_marina_gull')")).toBe(true);
    p.lapseTo(9 * DAY + 16 * 60); // 23 September, 16:00: two hours into the gale
    expect(p.flag("small_craft_advisory")).toBe(true);
    expect(p.flag("ferry_running")).toBe(false);
    expect(p.eval("route_open('rt_marina_gull')")).toBe(false);
    p.lapseTo(10 * DAY + 12 * 60); // 24 September, noon: the advisory ended at 10:00
    expect(p.flag("small_craft_advisory")).toBe(false);
    expect(p.flag("ferry_running")).toBe(true);
    expect(p.eval("route_open('rt_marina_gull')")).toBe(true);
  });
});

/**
 * Folds events with the core event types as they were before the POV's observations (`space.seen`)
 * and the touched record were kept; what moving teaches about the dead (`engine/life`) is the world's.
 */
function foldUnobserving(world: WorldDoc, start: Readonly<WorldState>, events: readonly LedgerEvent[]): WorldState {
  const types: EventTypes = { get: (type) => plain.get(type) ?? registry.get(type) };
  const plain = new Map<string, EventTypeDef>(coreEventTypes(() => types).map((d) => [d.type, knowing(d)]));
  const state = structuredClone(start) as WorldState;
  for (const e of events) types.get(e.type)?.apply(e, state, registry.context(world, state));
  return state;
}

/** The world itself: the state without the POV's observations and without the touched record. */
function worldOnly(state: Readonly<WorldState>): string {
  const copy = unobserved(state);
  dropTouches(copy);
  return hashJson(copy);
}

describe("the POV's observations and the touched record are all that keeping them changes", () => {
  for (const starter of Object.keys(STARTER_WORLDS)) {
    test(`${starter}: a walk and two days fold to the same world as without them`, () => {
      const p = new Play(starter);
      const start = startState(p.world);
      const here = p.state.entities[p.world.pov]?.fields.place;
      for (const place of Object.values(p.world.places).filter((x) => x.visibility !== "secret" && x.id !== here).slice(0, 3)) {
        p.at(p.world.pov, place.id);
        p.lapse(90);
      }
      p.lapse(2 * DAY);
      expect(hashJson(fold(registry, p.world, start, p.w.events))).toBe(hashJson(p.state));
      expect(worldOnly(foldUnobserving(p.world, start, p.w.events))).toBe(worldOnly(p.state));
    });
  }
});
