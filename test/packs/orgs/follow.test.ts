// The Plan's follow-through off screen (assess-party §6.2-6.3, ORG-SPEC §11 Phase 4 Life): Port Alder
// at Cast life 3 with Danny a companion. An order with a place and a time is laid into his day at his
// tier's priority; he takes it up as time runs; while it is under way his routine gives way to it until
// its time; it keeps him from following the player character elsewhere, and one with the player
// character on its team brings a hired hand along; once its laid block has ended a slot's end marks it
// lived (which closes nothing, and a change of its time clears); a standing order under way holds him
// through each day's waking hours around his shifts, and a slot's marking lays it only `plan_days`
// ahead however far its goal is; the skip brief and the Montage tell of it; and it makes him
// involved, pending with the player character and first in catch-up after the scene.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { PLAN_SECTION, type OrgPlanView } from "../../../src/shared/org-feed";
import { ROUTINE_EVENTS, type RoutineRole } from "../../../src/shared/routines";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal, formatStamp } from "../../../src/engine/calendar";
import { applyEffects } from "../../../src/engine/effects";
import { createRegistry } from "../../../src/engine/registry-impl";
import { partyAt } from "../../../src/engine/relocate";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { placeOfEntity } from "../../../src/engine/scope";
import { advance, ALL_NOTE, catchUp } from "../../../src/engine/simulate";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { commitments } from "../../../src/packs/castlife/core/commitments";
import { routineYields, skipLifeOf } from "../../../src/packs/castlife/core/routines";
import { skipPlanBrief } from "../../../src/packs/castlife/core/skip-plan";
import { fidelityOf, involved } from "../../../src/packs/minds/core/fidelity";
import { planNarratorLines, planOf } from "../../../src/packs/orgs/core/agenda";
import { orderPlans, PLAN_DAYS, stepOrders } from "../../../src/packs/orgs/core/follow";
import { buildOrgView } from "../../../src/packs/orgs/core/view";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const DANNY = "danny_okafor";
const PRIYA = "priya_nair";
const PARTY = "party_pov";
const MARINA = "alder_harbor_marina";
const HOME = "harbor_street_114";

/** Port Alder at Cast life 3, Danny a companion in the party; `edit` changes the world first. */
function alder(edit?: (world: WorldDoc) => void): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world: WorldDoc = make("mo", "Port Alder");
  world.realism.levels.castlife = 3;
  edit?.(world);
  const w = new Working(reg, world, startState(world, reg));
  effect(w, "orgs.party_tier", { who: DANNY, tier: "companion" });
  return w;
}

function effect(w: Working, type: string, args: JsonObject): LedgerEvent[] {
  const out = applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) });
  if (out.rejected.length > 0) throw new Error(out.rejected.map((r) => r.rejection.reason).join("; "));
  return out.applied;
}

function act(w: Working, action: string, params: JsonObject, actor = "pov"): Resolution {
  const res = resolveAction(reg, w, { action, params, actor }, createRng(`${action}:${w.events.length}`));
  const why = res.failed?.reason ?? res.rejected.map((r) => r.rejection.reason).join("; ");
  if (why !== "") throw new Error(why);
  return res;
}

/** A clock reading of Monday 14 September 2026 in Port Alder's calendar. */
function at(w: Working, hhmm: string): number {
  return clockOfLocal(calendarOf(w.world), `2026-09-14T${hhmm}`);
}

/** How someone follows their routine in this chat (the GM's `routine_follow`). */
function follow(w: Working, who: string, role: RoutineRole, awareness: "story_first" | null = null): void {
  w.apply({ type: ROUTINE_EVENTS.follow, data: { entity: who, follow: { mode: null, awareness, role, skips: null } } });
}

/** Danny's one order on the party's plan. */
function order(w: Working, text: string, extra: JsonObject = {}): string {
  act(w, "org_order", { org: PARTY, to: DANNY, text, ...extra });
  const id = planOf(w.state, PARTY).orders.find((o) => o.text === text)?.id;
  if (!id) throw new Error(`no order ${text}`);
  return id;
}

function plan(w: Working): OrgPlanView {
  return buildOrgView(w.ctx, PARTY, "pov")?.sections[PLAN_SECTION] as unknown as OrgPlanView;
}

describe("orders laid and lived off screen (assess-party §6.2)", () => {
  test("an order with a place and a time is laid as an hour of his day at a companion's priority; he takes it up as time runs; its routine gives way while it's under way; once its block has ended it's marked lived, which closes nothing", () => {
    const w = alder();
    // His routine lived (enforced), with the story first, so only what the story sets keeps it from moving him.
    follow(w, DANNY, "enforced", "story_first");
    const id = order(w, "Check the boat's moorings", { where: MARINA, when: "2026-09-14 11:00" });
    const [p] = orderPlans(w.ctx, DANNY);
    expect(p).toMatchObject({ plan: `order:${PARTY}:${id}`, priority: 4, place: MARINA, hold: false, window: { from: at(w, "06:16"), to: at(w, "11:00") } });
    // The laid block: an hour from the minute after it was given, cutting his shift (a companion's order takes its time from routine).
    const day = commitments(w.ctx, DANNY, at(w, "00:00"), at(w, "23:59"));
    const laid = day.filter((c) => c.plan === p?.plan);
    expect(laid.map((c) => [c.start, c.end, c.place, c.activity, c.label, c.reason])).toEqual([[at(w, "06:16"), at(w, "07:16"), MARINA, "work", "On an order: Check the boat's moorings", "an order"]]);
    expect(day.find((c) => c.kind === "work")?.start).toBe(at(w, "07:16"));
    // Danny moves it under way himself, then time runs: he goes to the marina, works there, and stays on past his block as his shift and lunch come and go.
    act(w, "org_plan_status", { org: PARTY, id, status: "under_way" }, DANNY);
    advance(reg, w, at(w, "09:00"), { runSeed: "follow", mode: "timelapse", interrupts: ALL_NOTE });
    expect(placeOfEntity(w.state, DANNY)).toBe(MARINA);
    expect(w.state.entities[DANNY]?.fields.activity).toBe("work");
    // While time runs on its own (no scene holds anyone), the order still keeps his routine off him until its time.
    expect(routineYields(w.ctx, DANNY, "place", MARINA, { edge: true, scene: false, at: at(w, "10:00") })).toBe(true);
    // Past its time, his routine has him again.
    expect(routineYields(w.ctx, DANNY, "place", MARINA, { edge: true, scene: false, at: at(w, "11:00") })).toBe(false);
    expect(planOf(w.state, PARTY).orders[0]).toMatchObject({ status: "under_way", lived: at(w, "07:16") });
    expect(plan(w).orders[0]).toMatchObject({ status: "under_way", lived: true });
    expect(planNarratorLines(w.ctx).join("\n")).toContain("Check the boat's moorings, at Alder Harbor Marina, by");
    expect(planNarratorLines(w.ctx).join("\n")).toContain("By the day as laid it should be done; not told yet.");
    // A new time clears the marker.
    act(w, "org_order", { org: PARTY, id, when: "2026-09-14 18:00" });
    expect(planOf(w.state, PARTY).orders[0]?.lived).toBeUndefined();
  });

  test("without the order under way, his routine takes him to his shift once the block ends", () => {
    const w = alder();
    follow(w, DANNY, "enforced", "story_first");
    order(w, "Check the boat's moorings", { where: MARINA, when: "2026-09-14 11:00" });
    advance(reg, w, at(w, "09:00"), { runSeed: "follow", mode: "timelapse", interrupts: ALL_NOTE });
    expect(placeOfEntity(w.state, DANNY)).toBe("alder_automotive");
    expect(routineYields(w.ctx, DANNY, "place", "alder_automotive", { edge: true, scene: false, at: at(w, "10:00") })).toBe(false);
  });

  test("a standing order under way holds him through each day's waking hours, around his shifts, until it is done or dropped, and is never marked lived", () => {
    const w = alder();
    const id = order(w, "Keep watch on the marina", { where: MARINA });
    act(w, "org_plan_status", { org: PARTY, id, status: "under_way" });
    const [p] = orderPlans(w.ctx, DANNY);
    expect(p).toMatchObject({ hold: true, window: { from: at(w, "06:16"), to: null } });
    const blocks = (from: number, to: number): number[][] => commitments(w.ctx, DANNY, from, to).filter((c) => c.plan === p?.plan).map((c) => [c.start, c.end]);
    const tuesday = at(w, "00:00") + 1440;
    expect(blocks(at(w, "00:00"), at(w, "23:59"))).toEqual([[at(w, "06:16"), at(w, "07:00")], [at(w, "15:30"), at(w, "22:00")]]);
    expect(blocks(tuesday, tuesday + 1440)).toEqual([[tuesday + 360, tuesday + 420], [tuesday + 930, tuesday + 1320]]);
    // Each day lands alike whatever span is asked about.
    expect(blocks(at(w, "16:00"), at(w, "17:00"))).toEqual([[at(w, "15:30"), at(w, "22:00")]]);
    advance(reg, w, tuesday + 600, { runSeed: "hold", mode: "timelapse", interrupts: ALL_NOTE });
    expect(planOf(w.state, PARTY).orders[0]?.lived).toBeUndefined();
    act(w, "org_plan_status", { org: PARTY, id, status: "done" });
    expect(blocks(tuesday + 900, tuesday + 1440)).toEqual([]);
  });

  test("below Cast life 3 nothing is laid", () => {
    const w = alder((world) => {
      world.realism.levels.castlife = 2;
    });
    order(w, "Check the boat's moorings", { where: MARINA, when: "2026-09-14 11:00" });
    expect(commitments(w.ctx, DANNY, at(w, "00:00"), at(w, "23:59")).filter((c) => c.plan !== undefined)).toEqual([]);
  });

  test("a standing order under way for a goal thirty years off is laid only so far past each slot: 14 days, or the world's plan_days", () => {
    const furthest = (edit?: (world: WorldDoc) => void): number => {
      const w = alder(edit);
      act(w, "org_goal", { org: PARTY, text: "Keep the marina", window: "2056-09-14" });
      const goal = planOf(w.state, PARTY).goals[0]?.id ?? "";
      const id = order(w, "Keep watch on the marina", { where: MARINA, goal });
      act(w, "org_plan_status", { org: PARTY, id, status: "under_way" });
      expect(orderPlans(w.ctx, DANNY)[0]?.window?.to).toBeGreaterThan(w.state.clock + 29 * 365 * 1440);
      // The planner as the slot's marking asks it, every span it is asked for watched.
      const real = w.ctx.query("castlife.commitments");
      let asked = 0;
      const ctx = reg.context(w.world, w.state, {
        "castlife.commitments": (c, who, start, end) => {
          asked = Math.max(asked, end);
          return real(c, who, start, end);
        },
      });
      const slot = { start: w.state.clock, end: w.state.clock + 60, index: 0 };
      expect(stepOrders(slot, ctx)).toEqual([]);
      return (asked - slot.end) / 1440;
    };
    expect(furthest()).toBe(PLAN_DAYS);
    expect(
      furthest((world) => {
        world.packs.orgs = { version: 1, config: { plan_days: 3 } };
      }),
    ).toBe(3);
  });
});

describe("travel, the skip, the Montage and attention (assess-party §6.2)", () => {
  test("an order bound to the marina keeps Danny from following the player character elsewhere while it runs; a hired hand on an order with the player character on its team comes along", () => {
    // Danny isn't stepped (no agent), so he stays home with the player character while the order runs.
    const w = alder((world) => {
      const danny = world.entities[DANNY];
      if (danny) danny.agent = false;
    });
    follow(w, DANNY, "informative");
    advance(reg, w, at(w, "16:00"), { runSeed: "travel", mode: "turn" });
    expect(partyAt(w.ctx, HOME, "rusty_anchor")).toContain(DANNY);
    const id = order(w, "Check the boat's moorings", { where: MARINA, when: "2026-09-14 21:00" });
    advance(reg, w, at(w, "17:30"), { runSeed: "travel", mode: "turn" });
    expect(placeOfEntity(w.state, DANNY)).toBe(HOME);
    expect(partyAt(w.ctx, HOME, "rusty_anchor")).not.toContain(DANNY);
    expect(partyAt(w.ctx, HOME, MARINA)).toContain(DANNY);
    act(w, "org_plan_status", { org: PARTY, id, status: "dropped" });
    expect(partyAt(w.ctx, HOME, "rusty_anchor")).toContain(DANNY);
    // Priya, hired, comes along only on an order with the player character on its team.
    effect(w, "orgs.party_tier", { who: PRIYA, tier: "hired" });
    effect(w, "set", { entity: PRIYA, field: "place", value: HOME });
    expect(partyAt(w.ctx, HOME, "rusty_anchor")).not.toContain(PRIYA);
    act(w, "org_order", { org: PARTY, to: `${PRIYA},pov`, text: "Come with me to the Anchor" });
    expect(partyAt(w.ctx, HOME, "rusty_anchor")).toContain(PRIYA);
  });

  test("the skip brief lists the order in the player's words in place of its laid block, and the model plans his skip while he's on it", () => {
    const w = alder();
    follow(w, DANNY, "informative");
    order(w, "Check the boat's moorings", { where: MARINA, when: "2026-09-14 11:00" });
    expect(skipLifeOf(w.ctx, DANNY)).toBe("model");
    const brief = skipPlanBrief(w.ctx, [DANNY], at(w, "06:15"), at(w, "18:00"));
    const story = brief.people[0]?.story ?? [];
    expect(story).toEqual([`Order from ${w.state.entities.pov?.name} (the player character): Check the boat's moorings, at Alder Harbor Marina (${MARINA}), by ${formatStamp(calendarOf(w.world), at(w, "11:00"))}; open`]);
    expect(story.join("\n")).not.toContain("On an order");
  });

  test("the Montage of a skip says who worked on what", () => {
    const w = alder();
    order(w, "Check the boat's moorings", { where: MARINA, when: "2026-09-14 11:00" });
    const out = runTimelapse(reg, w, { type: "duration", minutes: 180 }, { runSeed: "montage", overrides: ALL_NOTE });
    if ("code" in out) throw new Error(out.reason);
    expect(out.montage.groups[0]).toEqual({ label: "Orders", lines: ["Danny Okafor worked on: Check the boat's moorings"] });
  });

  test("an order still on the plan makes its person involved and pending with the player character, and puts them first in catch-up after the scene", () => {
    const w = alder();
    // Jess has no agenda of her own under way, so nothing else makes her involved.
    const jess = "jess_kowalczyk";
    const pending = (): string[] => (fidelityOf(w.ctx, { user: "", reply: "" }).find((s) => s.entity === jess)?.reasons ?? []).map((r) => r.label);
    expect(involved(w.ctx, jess)).toBe(false);
    expect(pending()).not.toContain("1 pending with you");
    act(w, "org_order", { org: PARTY, to: jess, text: "Bring the invoices round" });
    expect(involved(w.ctx, jess)).toBe(true);
    expect(pending()).toContain("1 pending with you");
    // Catch-up, one agent this turn: round-robin starts with Dale, until Priya has an order.
    advance(reg, w, at(w, "18:00"), { runSeed: "late", mode: "turn" });
    const first = (): string | undefined => catchUp(reg, new Working(reg, w.world, w.state), { runSeed: "catch", agents: 1 }).stepped[0]?.agent;
    expect(first()).toBe("dale_whitcomb");
    act(w, "org_order", { org: PARTY, to: PRIYA, text: "Ring the parts supplier" });
    expect(first()).toBe(PRIYA);
    expect(catchUp(reg, new Working(reg, w.world, w.state), { runSeed: "catch", agents: 2, onScreen: [DANNY] }).stepped.map((s) => s.agent)).toEqual([DANNY, PRIYA]);
  });
});
