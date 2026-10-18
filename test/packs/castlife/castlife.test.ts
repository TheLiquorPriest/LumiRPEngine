import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockAt, dateAt } from "../../../src/engine/calendar";
import { applyEffects } from "../../../src/engine/effects";
import { createRegistry } from "../../../src/engine/registry-impl";
import { actionOdds, paramCandidates, resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { advance, ALL_NOTE } from "../../../src/engine/simulate";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { buildCastView, commitments, dayPlan, needValue, planFor } from "../../../src/packs/castlife/core/index";
import { modernUsWorld } from "../riverton";
import { fold, startState } from "../support";

function objOfTrip(v: unknown): { from: number; until: number } | null {
  const t: unknown = Array.isArray(v) ? v[0] : null;
  if (!t || typeof t !== "object") return null;
  const from: unknown = Reflect.get(t, "from");
  const until: unknown = Reflect.get(t, "until");
  return typeof from === "number" && typeof until === "number" ? { from, until } : null;
}

const reg = createRegistry(ALL_PACKS);

function setup(level: 1 | 2 | 3 | 4, patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "R");
  world.realism.levels.castlife = level;
  world.realism.levels.relationships = 4;
  patch(world);
  return new Working(reg, world, startState(world));
}

function lapse(w: Working, minutes: number): void {
  const out = runTimelapse(reg, w, { type: "duration", minutes }, { runSeed: "seed", overrides: ALL_NOTE });
  if ("code" in out) throw new Error(out.reason);
}

/** The next day (from the world start) whose weekday is in `weekdays`. */
function dayWith(w: Working, weekdays: number[]): number {
  const cal = calendarOf(w.world);
  let day = dateAt(cal, w.state.clock).dayIndex + 1;
  while (!weekdays.includes(dateAt(cal, clockAt(cal, day, 0)).weekday)) day++;
  return day;
}

describe("castlife: commitments and the day planner", () => {
  test("a work day keeps the shift fixed at its place, fills free time, never double-books, and is deterministic", () => {
    const w = setup(3);
    const day = dayWith(w, [3]);
    const plan = planFor(w.ctx, "maya", day, createRng("p"));
    const shift = plan.blocks.find((b) => b.fixed && b.activity === "work_shift");
    const cal = calendarOf(w.world);
    expect(shift).toMatchObject({ place: "cafe", start: clockAt(cal, day, 360), end: clockAt(cal, day, 840) });
    for (let i = 1; i < plan.blocks.length; i++) expect(plan.blocks[i]!.start).toBeGreaterThanOrEqual(plan.blocks[i - 1]!.end);
    expect(plan.blocks.some((b) => b.activity === "sleep")).toBe(true);
    expect(plan.blocks.some((b) => b.activity === "dinner")).toBe(true);
    // Utility reasons: chosen blocks say why and with what utility; commitments say what they are.
    expect(plan.blocks.find((b) => b.activity === "dinner")?.reasons).toEqual(expect.arrayContaining(["evening meal", expect.stringMatching(/^utility \d/)]));
    expect(shift?.reasons.some((r) => r.startsWith("utility"))).toBe(false);
    expect(planFor(w.ctx, "maya", day, createRng("p"))).toEqual(plan);
  });

  test("appointments and trips are commitments; a trip holds the person away and brings them home after", () => {
    const w = setup(3);
    const cal = calendarOf(w.world);
    const day = dateAt(cal, w.state.clock).dayIndex + 1;
    const from = clockAt(cal, day, 9 * 60);
    const until = clockAt(cal, day + 2, 18 * 60);
    w.state.entities.rosa!.fields.appointments = [{ at: clockAt(cal, day + 3, 600), minutes: 60, place: "office", label: "Dentist" }];
    w.state.entities.rosa!.fields.trips = [{ from, until, place: "lake", label: "Fishing trip" }];
    expect(commitments(w.ctx, "rosa", clockAt(cal, day + 3, 0), clockAt(cal, day + 4, 0)).map((c) => c.label)).toEqual(["Dentist"]);
    lapse(w, from + 6 * 60 - w.state.clock);
    expect(w.state.entities.rosa?.fields.place).toBe("lake");
    expect(w.state.entities.rosa?.fields.activity).toBe("trip");
    lapse(w, until + 3 * 60 - w.state.clock);
    expect(w.state.entities.rosa?.fields.place).not.toBe("lake");
  });

  /** Riverton at Cast life 1 with Rosa's routine gone, so only trips move anyone, and a day's trip from the coming hour. */
  function tripping(who: string, place: string): Working {
    const w = setup(1, (wd) => {
      delete wd.schedules.rosa_routine;
    });
    const from = w.state.clock + 60;
    w.state.entities[who]!.fields.trips = [{ from, until: from + 1440, place, label: "Weekend away" }];
    return w;
  }
  function set(w: Working, who: string, field: string, value: string): void {
    const rejected = w.apply({ type: "set", entity: who, field, value });
    if (rejected) throw new Error(rejected.reason);
  }

  test("a trip that is over lets go: back at its place days later, no one is sent home from there, the player character in an ordinary turn least of all", () => {
    for (const who of ["rosa", "you"]) {
      const w = tripping(who, "lake");
      lapse(w, 3 * 1440);
      expect(w.state.entities[who]?.fields.place).toBe(w.state.entities[who]?.fields.home);
      // Back at the lake (a narrated move, a rule, a GM edit), where time passes: off screen for Rosa,
      // an ordinary turn's for the player character, which leaves them where the player took them.
      set(w, who, "place", "lake");
      if (who === "you") advance(reg, w, w.state.clock + 6 * 60, { runSeed: "seed", mode: "turn" });
      else lapse(w, 6 * 60);
      expect(w.state.entities[who]?.fields.place).toBe("lake");
    }
  });

  test("a trip that ended while nothing could end it lets go wherever they are, and takes them home only from its place", () => {
    const w = tripping("rosa", "lake");
    lapse(w, 12 * 60);
    expect(w.state.entities.rosa?.fields.place).toBe("lake");
    // Cast life is off as the trip ends, and meanwhile something takes her to the café.
    w.state.realism.levels.castlife = 0;
    lapse(w, 2 * 1440);
    set(w, "rosa", "place", "cafe");
    w.state.realism.levels.castlife = 1;
    lapse(w, 6 * 60);
    expect(w.state.entities.rosa?.fields.place).toBe("cafe");
    set(w, "rosa", "place", "lake");
    lapse(w, 6 * 60);
    expect(w.state.entities.rosa?.fields.place).toBe("lake");
  });

  test("a trip spent at home ends once: what they do there afterwards isn't reset to idle at every slot", () => {
    const w = tripping("rosa", "apartment_hall");
    lapse(w, 3 * 1440);
    set(w, "rosa", "activity", "reading");
    lapse(w, 1440);
    expect(w.state.entities.rosa?.fields.activity).toBe("reading");
  });

  test("off-screen agents live their plans: Maya is at the café during her shift", () => {
    const w = setup(3);
    w.apply({ type: "link", rel: "knows", from: "you", to: "maya" });
    const cal = calendarOf(w.world);
    const day = dayWith(w, [3]);
    lapse(w, clockAt(cal, day, 10 * 60) - w.state.clock);
    expect(w.state.entities.maya?.fields.place).toBe("cafe");
    expect(dayPlan(w.ctx, "maya").blocks.some((b) => b.fixed && b.activity === "work_shift")).toBe(true);
    // The POV knows her but is elsewhere: Cast lists her without her whereabouts or her day.
    const maya = buildCastView(w.ctx).people.find((p) => p.id === "maya");
    expect(maya).toMatchObject({ here: false });
    expect([maya?.place, maya?.activity, maya?.timeline, maya?.next]).toEqual([undefined, undefined, undefined, undefined]);
    expect(fold(reg, w.world, startState(w.world), w.events)).toEqual(w.state);
  });

  test("the owner's retrieval plan brings an overdue use grant back", () => {
    const w = setup(3, (wd) => {
      wd.entities.toolbox!.fields.owner = "jordan";
    });
    const lent = applyEffects(reg, w, [{ type: "gear.lend", args: { item: "toolbox", to: "rosa", until: w.state.clock + 60 } }], { bindings: {}, rng: createRng("l") });
    expect(lent.rejected).toEqual([]);
    lapse(w, 2 * 1440);
    const planned = w.events.some((e) => e.type === "engine.note" && "data" in e && String(e.data.text).includes("got Mechanic's toolbox back"));
    expect(planned).toBe(true);
    expect(w.state.entities.rosa?.relations.some((r) => r.type === "uses" && r.to === "toolbox")).toBe(false);
    expect(w.state.entities.toolbox?.fields.overdue).toBe(false);
  });
});

describe("castlife: needs, encounters and invitations (level 4)", () => {
  test("needs rise closed-form and activities reset them", () => {
    const w = setup(4);
    const h0 = needValue(w.ctx, "you", "hunger");
    w.apply({ type: "clock", minutes: 300, cause: "advance" });
    expect(needValue(w.ctx, "you", "hunger")).toBeCloseTo(Math.min(100, h0 + 20), 5);
    const ate = resolveAction(reg, w, { action: "eat", params: {} }, createRng("e"));
    expect(ate.rejected).toEqual([]);
    expect(needValue(w.ctx, "you", "hunger")).toBe(0);
  });

  test("NPCs who share a place meet, which changes regard; a fond NPC invites the POV via a recorded tie", () => {
    const w = setup(4, (wd) => {
      wd.entities.maya!.relations.push({ type: "regard", to: "you", fields: { warmth: 60, trust: 50, respect: 40, t: 0 } });
      wd.entities.maya!.fields.home = "cafe";
      wd.entities.rosa!.fields.home = "cafe";
    });
    lapse(w, 4 * 1440);
    const regard = w.events.filter((e) => e.type === "relationships.regard" && String(e.data.why).startsWith("encounter") || (e.type === "relationships.regard" && String(e.data.why).startsWith("argument")));
    expect(regard.length).toBeGreaterThan(0);
    const invites = w.events.filter((e) => e.type === "castlife.invitation");
    expect(invites.length).toBeGreaterThan(0);
    expect(fold(reg, w.world, startState(w.world), w.events)).toEqual(w.state);
    // An npc.choose decision recorded for that choice point overrides the planner's own choice.
    const key = w.events.flatMap((e) => (e.type === "castlife.invitation" ? [String(e.data.key)] : []))[0] ?? "";
    const again = setup(4, (wd) => {
      wd.entities.maya!.relations.push({ type: "regard", to: "you", fields: { warmth: 60, trust: 50, respect: 40, t: 0 } });
      wd.entities.maya!.fields.home = "cafe";
      wd.entities.rosa!.fields.home = "cafe";
    });
    applyEffects(reg, again, [{ type: "castlife.decide", args: { key, choice: "stay" } }], { bindings: {}, rng: createRng("d") });
    lapse(again, 4 * 1440);
    expect(again.events.some((e) => e.type === "castlife.invitation" && e.data.key === key)).toBe(false);
    expect(again.events.some((e) => e.type === "engine.choice" && e.data.key === key && e.data.via === "recorded")).toBe(true);
  });

  test("a trip preempts the routine it overlaps and starts on time (Danny's Friday drinks give way to Chicago)", () => {
    const make = STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc;
    const world = make("w", "Port Alder");
    world.realism.levels.castlife = 3;
    const w = new Working(reg, world, startState(world));
    const trip = objOfTrip(w.state.entities.danny_okafor?.fields.trips);
    expect(trip).not.toBeNull();
    if (!trip) return;
    const day = dateAt(calendarOf(world), trip.from).dayIndex;
    const plan = planFor(w.ctx, "danny_okafor", day, createRng("d"));
    const at = plan.blocks.find((b) => b.start <= trip.from && trip.from < b.end);
    expect(at?.activity).toBe("trip");
    expect(plan.blocks.some((b) => b.activity !== "trip" && b.start < trip.until && b.end > trip.from)).toBe(false);
    runTimelapse(reg, w, { type: "duration", minutes: trip.from - w.state.clock }, { runSeed: "seed", overrides: ALL_NOTE });
    expect(w.state.entities.danny_okafor?.fields.place).toBe("chicago_il");
    // Home again by the end of the slot the trip ends in (slots are stepped when they complete).
    runTimelapse(reg, w, { type: "duration", minutes: trip.until - w.state.clock + 240 }, { runSeed: "seed", overrides: ALL_NOTE });
    expect(w.state.entities.danny_okafor?.fields.place).not.toBe("chicago_il");
  });

  test("a close call reads as such; once the person's choice is recorded it says they chose", () => {
    const make = STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc;
    const world = make("w", "Port Alder");
    const w = new Working(reg, world, startState(world));
    let found: { who: string; day: number; key: string; options: string[]; at: number } | null = null;
    for (const who of Object.keys(w.state.entities).filter((id) => w.state.entities[id]?.agent).sort()) {
      for (let day = 0; day < 7 && !found; day++) {
        const plan = planFor(w.ctx, who, day, createRng(`t:${who}:${day}`));
        const tie = plan.ties.find((t) => t.via === "seed");
        const block = tie ? plan.blocks.find((b) => b.reasons.includes("close call")) : undefined;
        if (tie && block) found = { who, day, key: tie.key, options: tie.options, at: block.start };
      }
    }
    expect(found).not.toBeNull();
    if (!found) return;
    w.apply({ type: "castlife.decision", data: { key: found.key, choice: found.options[1] ?? found.options[0] ?? "" } });
    const after = planFor(w.ctx, found.who, found.day, createRng(`t:${found.who}:${found.day}`));
    const first = w.state.entities[found.who]?.name.split(" ")[0];
    expect(after.blocks.some((b) => b.reasons.includes(`close call, ${first} chose`))).toBe(true);
  });

  test("Accept invitation is offered only for a host whose invitation is still open", () => {
    const w = setup(3);
    w.state.entities.maya!.fields.place = w.state.entities.you!.fields.place ?? null;
    const req = { action: "accept_invitation", params: { host: "maya" } };
    expect(actionOdds(reg, w.world, w.state, req).available).toBe(false);
    w.apply({ type: "castlife.invitation", data: { agent: "maya", place: "cafe", at: w.state.clock + 120, text: "Maya invites you to the café." } });
    expect(actionOdds(reg, w.world, w.state, req).available).toBe(true);
    w.apply({ type: "clock", minutes: 6 * 60, cause: "advance" });
    expect(actionOdds(reg, w.world, w.state, req).available).toBe(false);
  });

  test("the palette offers Accept invitation only for hosts who invited you", () => {
    const w = setup(3);
    const accept = reg.actions.get("accept_invitation");
    if (!accept) throw new Error("no accept_invitation");
    for (const id of ["maya", "rosa"]) w.state.entities[id]!.fields.place = w.state.entities.you!.fields.place ?? null;
    expect(paramCandidates(reg, w.world, w.state, accept, "host")).toEqual([]);
    w.apply({ type: "castlife.invitation", data: { agent: "maya", place: "cafe", at: w.state.clock + 120, text: "Maya invites you to the café." } });
    expect(paramCandidates(reg, w.world, w.state, accept, "host")).toEqual(["maya"]);
  });
});
