// Life states (DESIGN §8): someone who doesn't act follows no schedule or day plan, is asked no
// npc.choose and takes no combat turn; the body stays where it lies; the POV learns of a change by
// seeing it, by walking in on it or by being told, and until then every player surface shows what
// it last knew; the GM view shows the truth and who knows it.

import { describe, expect, test } from "bun:test";
import type { JsonValue } from "../../src/shared/json";
import { applyProposals } from "../../src/backend/turn-model";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import { calendarOf, clockAt, dateAt } from "../../src/engine/calendar";
import { parseEditOps, resolveEdit } from "../../src/engine/edits";
import { applyEffects } from "../../src/engine/effects";
import { buildGmWorld } from "../../src/engine/gm-view";
import { lifeKnownTo, lifeOf } from "../../src/engine/life";
import { optionalQuery } from "../../src/engine/pack-kit";
import { playerLines } from "../../src/engine/player-events";
import { createRegistry, type Registry } from "../../src/engine/registry-impl";
import { paramCandidates } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { placeOfEntity } from "../../src/engine/scope";
import { agentCursor, ALL_NOTE, completedSlot, lod1Agents } from "../../src/engine/simulate";
import { runTimelapse } from "../../src/engine/time";
import { canSeeEntity } from "../../src/engine/visibility";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { buildCastView } from "../../src/packs/castlife/core/index";
import { fightChoices } from "../../src/packs/combat/core/flow";
import { encounterOf } from "../../src/packs/combat/core/model";
import { fightWorld, plan, povFirst, reg as combatReg, started } from "../packs/combat/support";
import { modernUsWorld } from "../packs/riverton";
import { fold, POV, startState, baseWorld } from "../packs/support";
import { Play, registry as templateReg } from "../packs/templates/play";
import { hashJson } from "../../src/shared/hash";
import { applyMarker } from "../../src/engine/events";
import { initialState } from "../../src/engine/world-state";

const reg = createRegistry(ALL_PACKS);
const YOU = "you";

/** Riverton at a Cast life level: Alex at home, Maya at the café, Jordan at the office, Rosa next door. */
function riverton(level: 1 | 3, patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "R");
  world.realism.levels.castlife = level;
  patch(world);
  return new Working(reg, world, startState(world));
}

/** The `life` effect as a rule runs it; a refusal fails the test. */
function life(w: Working, args: Record<string, JsonValue>, registry: Registry = reg): void {
  const out = applyEffects(registry, w, [{ type: "life", args }], { bindings: {}, rng: createRng(JSON.stringify(args)) });
  const refused = out.rejected[0];
  if (refused) throw new Error(refused.rejection.reason);
}

function move(w: Working, who: string, place: string): void {
  const refused = w.apply({ type: "set", entity: who, field: "place", value: place });
  if (refused) throw new Error(refused.reason);
}

function lapse(w: Working, minutes: number): void {
  const out = runTimelapse(reg, w, { type: "duration", minutes }, { runSeed: "seed", overrides: ALL_NOTE });
  if ("code" in out) throw new Error(out.reason);
}

/** Minutes from now to the next `weekday` (0 = Sunday) at `minuteOfDay`. */
function untilNext(w: Working, weekday: number, minuteOfDay: number): number {
  const cal = calendarOf(w.world);
  let day = dateAt(cal, w.state.clock).dayIndex + 1;
  while (dateAt(cal, clockAt(cal, day, 0)).weekday !== weekday) day++;
  return clockAt(cal, day, minuteOfDay) - w.state.clock;
}

/** The narrator's people lines (the Cast life pack's `people` slot). */
function peopleLines(w: Working): string[] {
  return reg.renderers.filter((r) => r.slot === "people").flatMap((r) => r.render(w.ctx));
}

function castLife(w: Working, id: string): string | undefined {
  return buildCastView(w.ctx).people.find((p) => p.id === id)?.life;
}

/** Who acted in a fight: each `combat.act`'s actor. */
function actors(events: readonly LedgerEvent[]): string[] {
  return events.flatMap((e) => (e.type === "combat.act" && "data" in e && typeof e.data.actor === "string" ? [e.data.actor] : []));
}

/** The fight's world with the POV acting first and nothing to do but act once a turn. */
function oneActFight(patch: (w: WorldDoc) => void = () => undefined): WorldDoc {
  return fightWorld((w) => {
    povFirst(w);
    delete w.ruleset!.combat!.economy.move;
    patch(w);
  });
}

describe("life states: who still acts", () => {
  test("a dead NPC follows no schedule and no day plan, and is no one the planner asks npc.choose about", () => {
    const routine = (wd: WorldDoc): void => {
      wd.schedules.rosa_mornings = { id: "rosa_mornings", owner: "rosa", target: "place", recurrence: { every: "day" }, slots: [{ start: "08:00", end: "09:30", value: "garage" }] };
    };
    const working = riverton(1, routine);
    lapse(working, 90);
    expect(working.state.entities.rosa?.fields.place).toBe("garage");
    const dead = riverton(1, routine);
    life(dead, { entity: "rosa", to: "dead" });
    lapse(dead, 90);
    expect([lifeOf(dead.state, "rosa"), dead.state.entities.rosa?.fields.place]).toEqual(["dead", "apartment_hall"]);

    // Cast life 3: Maya's day plan takes her to her Wednesday shift; dead, she stays where she fell.
    const planned = riverton(3);
    move(planned, "maya", "park");
    lapse(planned, untilNext(planned, 3, 10 * 60));
    expect(planned.state.entities.maya?.fields.place).toBe("cafe");
    const fallen = riverton(3);
    move(fallen, "maya", "park");
    life(fallen, { entity: "maya", to: "dead" });
    lapse(fallen, untilNext(fallen, 3, 10 * 60));
    expect(fallen.state.entities.maya?.fields.place).toBe("park");
    expect(lod1Agents(fallen.world, fallen.state)).not.toContain("maya");
    expect((optionalQuery(fallen.ctx, "castlife.tie_zones")?.(fallen.ctx) ?? []).some((t) => t.agent === "maya")).toBe(false);
    // Both folds keep it alike: a replay gets the same state, who knows what included.
    expect(fold(reg, fallen.world, startState(fallen.world), fallen.events)).toEqual(fallen.state);
  });

  test("a dead fighter rolls no initiative, takes no turn and is asked no npc.choose", () => {
    const world = oneActFight((w) => {
      w.entities.bandit!.life = "dead";
    });
    const w = new Working(combatReg, world, startState(world, combatReg));
    const out = applyEffects(combatReg, w, [{ type: "combat.start", args: { foes: { ids: ["goblin", "bandit"] } } }], { bindings: { self: POV }, rng: createRng("start") });
    expect(out.rejected).toEqual([]);
    expect(encounterOf(w.state)?.order.map((f) => f.id)).toEqual([POV, "goblin"]);

    const alive = started(oneActFight());
    expect(fightChoices(alive.ctx).map((c) => c.agent)).toEqual(["goblin", "bandit"]);
    expect(actors(plan(alive.world, alive.state, "guard").events)).toEqual([POV, "goblin", "bandit"]);
    const killed = started(oneActFight());
    life(killed, { entity: "goblin", to: "dead" }, combatReg);
    expect(fightChoices(killed.ctx).map((c) => c.agent)).toEqual(["bandit"]);
    expect(actors(plan(killed.world, killed.state, "guard").events)).toEqual([POV, "bandit"]);
  });

  test("combat's down rule can lead to a life state, and getting back up ends it", () => {
    const world = oneActFight((w) => {
      w.ruleset!.combat!.down = { life: "dying" };
    });
    const w = started(world);
    w.apply({ type: "set", entity: "goblin", field: "hp", value: 0 });
    const fallen = new Working(combatReg, world, w.state);
    fallen.applyAll(plan(world, w.state, "guard").events);
    expect(lifeOf(fallen.state, "goblin")).toBe("dying");
    fallen.apply({ type: "set", entity: "goblin", field: "hp", value: 5 });
    const up = new Working(combatReg, world, fallen.state);
    up.applyAll(plan(world, fallen.state, "guard").events);
    expect(lifeOf(up.state, "goblin")).toBe("alive");
  });
});

describe("life states: the body", () => {
  test("a body stays a findable thing in its place, unlike Remove from the world", () => {
    const w = riverton(1);
    move(w, "maya", "apartment");
    life(w, { entity: "maya", to: "dead" });
    expect(placeOfEntity(w.state, "maya")).toBe("apartment");
    expect(canSeeEntity(reg, w.world, w.state, YOU, "maya")).toBe(true);
    const persuade = w.world.actions.persuade;
    if (!persuade) throw new Error("no persuade action");
    expect(paramCandidates(reg, w.world, w.state, persuade, "target")).toContain("maya");
    expect(peopleLines(w)).toContain("Maya Chen lies dead.");
    expect(buildCastView(w.ctx).people.find((p) => p.id === "maya")).toMatchObject({ here: true, life: "Dead" });
    const removed = resolveEdit(reg, w.world, w.state, [{ op: "despawn", entity: "maya" }], { gm: true, runSeed: "r" });
    if (!("events" in removed)) throw new Error(removed.rejection.reason);
    const gone = new Working(reg, w.world, w.state);
    gone.applyAll(removed.events);
    expect(canSeeEntity(reg, gone.world, gone.state, YOU, "maya")).toBe(false);
    expect(paramCandidates(reg, gone.world, gone.state, persuade, "target")).not.toContain("maya");
  });
});

describe("life states: who knows", () => {
  test("the POV learns by witnessing, by walking in and by being told; NPCs learn the same ways", () => {
    const w = riverton(1);
    // Witnessing: Maya dies in the room with Alex.
    move(w, "maya", "apartment");
    life(w, { entity: "maya", to: "dead" });
    expect(lifeKnownTo(w.state, "maya", YOU)).toBe("dead");
    expect(lifeKnownTo(w.state, "maya", "rosa")).toBe("alive");
    // Walking in: Jordan dies at the office; Alex knows once there, and so does Rosa.
    life(w, { entity: "jordan", to: "dead" });
    expect(lifeKnownTo(w.state, "jordan", YOU)).toBe("alive");
    move(w, YOU, "office");
    move(w, "rosa", "office");
    expect([lifeKnownTo(w.state, "jordan", YOU), lifeKnownTo(w.state, "jordan", "rosa")]).toEqual(["dead", "dead"]);
    // Told: Rosa is dying next door; a rule tells Alex, and a GM edit tells Rosa what became of Maya.
    move(w, "rosa", "apartment_hall");
    life(w, { entity: "rosa", to: "dying" });
    expect(lifeKnownTo(w.state, "rosa", YOU)).toBe("alive");
    life(w, { entity: "rosa", tell: [YOU] });
    expect(lifeKnownTo(w.state, "rosa", YOU)).toBe("dying");
    expect(lifeKnownTo(w.state, "maya", "rosa")).toBe("alive");
    const told = resolveEdit(reg, w.world, w.state, parseEditOps([{ op: "life", entity: "maya", tell: ["rosa"] }]) ?? [], { gm: true, runSeed: "r" });
    if (!("events" in told)) throw new Error(told.rejection.reason);
    w.applyAll(told.events);
    expect(lifeKnownTo(w.state, "maya", "rosa")).toBe("dead");
    expect(fold(reg, w.world, startState(w.world), w.events)).toEqual(w.state);
  });

  test("a reply that says someone died tells the POV: a change, or the truth it hadn't heard; never what it knows", () => {
    const w = riverton(1);
    const channel = reg.proposals.get("life");
    if (!channel) throw new Error("no life channel");
    life(w, { entity: "jordan", to: "dead" });
    // The player hadn't heard: the proposal stands, and applying it only tells them.
    expect(channel.validate({ entity: "jordan", state: "dead" }, w.ctx)).toBeNull();
    const out = applyEffects(reg, w, channel.toEffects({ entity: "jordan", state: "Dead" }, w.ctx), { bindings: {}, rng: createRng("x") });
    expect(out.applied.map((e) => e.type)).toEqual(["engine.told"]);
    expect(lifeKnownTo(w.state, "jordan", YOU)).toBe("dead");
    expect(channel.validate({ entity: "jordan", state: "dead" }, w.ctx)?.code).toBe("already");
    // A narrated collapse changes the state, and the POV knows it.
    expect(channel.validate({ entity: "rosa", state: "dying" }, w.ctx)).toBeNull();
    applyEffects(reg, w, channel.toEffects({ entity: "rosa", state: "dying" }, w.ctx), { bindings: {}, rng: createRng("y") });
    expect([lifeOf(w.state, "rosa"), lifeKnownTo(w.state, "rosa", YOU)]).toEqual(["dying", "dying"]);
    expect(channel.validate({ entity: "rosa", state: "asleep" }, w.ctx)?.code).toBe("bad_life");
  });

  test("Cast, the narrator and the Journal show a life state only once the POV knows it, and then what it last knew; the GM sees the truth and who knows", () => {
    const w = riverton(1);
    w.apply({ type: "link", rel: "knows", from: YOU, to: "jordan" });
    const mark = w.events.length;
    life(w, { entity: "jordan", to: "dead" });
    const death = w.events.slice(mark);
    expect(castLife(w, "jordan")).toBeUndefined();
    expect(playerLines(reg, w.world, w.state, YOU, death).join(" ")).not.toContain("Jordan");
    expect(peopleLines(w).join(" ")).not.toContain("dead");
    const gm = buildGmWorld(reg, w.world, w.state).entities.find((e) => e.id === "jordan")?.life;
    expect(gm).toMatchObject({ state: "dead", label: "Dead", acts: false, everyone: false, aware: [] });

    // Told: Cast shows it away from the body, and the Journal says so.
    const told = w.events.length;
    life(w, { entity: "jordan", tell: [YOU] });
    expect(castLife(w, "jordan")).toBe("Dead");
    expect(playerLines(reg, w.world, w.state, YOU, w.events.slice(told))).toEqual(["Jordan Price lies dead"]);
    // The turn it happened on stays without a line: the Journal never dates a death the POV only heard of.
    expect(playerLines(reg, w.world, w.state, YOU, death)).toEqual([]);
    expect(buildGmWorld(reg, w.world, w.state).entities.find((e) => e.id === "jordan")?.life.aware.map((p) => p.id)).toEqual([YOU]);

    // Brought back while Alex is away: Alex still takes him for dead, with no hint, until it sees him.
    life(w, { entity: "jordan", to: "alive" });
    expect(castLife(w, "jordan")).toBe("Dead");
    move(w, YOU, "office");
    expect(castLife(w, "jordan")).toBeUndefined();
    expect(peopleLines(w).join(" ")).toContain("Jordan Price");
    expect(peopleLines(w).join(" ")).not.toContain("dead");

    // Seen: a death in front of Alex is that turn's news, however much later the Journal is read.
    const seen = w.events.length;
    life(w, { entity: "jordan", to: "dead" });
    move(w, YOU, "apartment");
    expect(playerLines(reg, w.world, w.state, YOU, w.events.slice(seen, seen + 1))).toEqual(["Jordan Price lies dead"]);
  });

  test("a reply can't carry a body somewhere, and its refusal says nothing of why", () => {
    const w = riverton(1);
    w.apply({ type: "link", rel: "knows", from: YOU, to: "jordan" });
    life(w, { entity: "jordan", to: "dead" });
    const [outcome] = applyProposals(reg, w, [{ type: "location", entity: "jordan", place: "apartment" }], "seed", "run");
    expect(outcome?.rejection).toBeDefined();
    expect((outcome?.rejection?.reason ?? "").toLowerCase()).not.toContain("dead");
    expect(placeOfEntity(w.state, "jordan")).toBe("office");
    expect(lifeKnownTo(w.state, "jordan", YOU)).toBe("alive");
  });
});

describe("life states: a death during a time skip", () => {
  /** Riverton at Cast life 3, Maya at the park, and a rule that kills her at the first slot's end. */
  function dying(): Working {
    const w = riverton(3, (wd) => {
      wd.rules.kill = { id: "kill", on: { tick: "slot" }, do: [{ type: "life", args: { entity: "maya", to: "dead" } }], once: true };
    });
    move(w, "maya", "park");
    return w;
  }

  test("someone who dies during a time skip lives none of the rest of it", () => {
    const w = dying();
    const from = w.events.length;
    lapse(w, 2 * 24 * 60);
    const events = w.events.slice(from);
    const death = events.findIndex((e) => e.type === "engine.life");
    expect(death).toBeGreaterThan(-1);
    const lived = events.slice(death + 1).filter((e) => e.type === "set" && e.entity === "maya" && (e.field === "place" || e.field === "activity"));
    expect(lived).toEqual([]);
  });

  test("a two-day skip in which someone dies ends as two one-day skips do", () => {
    const once = dying();
    lapse(once, 2 * 24 * 60);
    const twice = dying();
    lapse(twice, 24 * 60);
    lapse(twice, 24 * 60);
    expect(lifeOf(twice.state, "maya")).toBe("dead");
    expect(once.state.entities).toEqual(twice.state.entities);
    const cursors = (w: Working): number[] => Object.keys(w.state.entities).sort().filter((id) => w.state.entities[id]?.agent).map((id) => agentCursor(w.world, w.state, id));
    expect(cursors(once)).toEqual(cursors(twice));
  });
});

describe("life states: People and an Upgrade", () => {
  test("a body the POV knows of has no regard voiced in People", () => {
    const p = new Play("mystery_manor");
    p.lapseTo(24 * 60 + 8 * 60 + 30);
    move(p.w, "pov", "library");
    expect(lifeKnownTo(p.state, "sir_alaric", "pov")).toBe("dead");
    const alaric = templateReg.renderers.filter((r) => r.slot === "people").flatMap((r) => r.render(p.w.ctx)).filter((l) => l.includes("Sir Alaric"));
    expect(alaric.length).toBeGreaterThan(0);
    expect(alaric.filter((l) => !l.includes("dead"))).toEqual([]);
  });

  test("a revision that brings someone back to a state that acts picks them up from now, as a revival in play does", () => {
    const a = baseWorld();
    a.lifeStates = { lost: { label: "Lost", reads: "is lost", acts: false } };
    a.entities.rosa = { id: "rosa", kind: "person", name: "Rosa", tier: "supporting", agent: true, life: "dead", fields: { place: "cafe" }, relations: [] };
    a.entities.vic = { id: "vic", kind: "person", name: "Vic", tier: "supporting", agent: true, life: "lost", fields: { place: "cafe" }, relations: [] };
    const b = structuredClone(a);
    delete b.entities.rosa!.life;
    b.lifeStates = { lost: { label: "Lost", reads: "is lost", acts: true } };
    b.name = `${a.name}, revised`;
    const [ra, rb] = [hashJson(a), hashJson(b)];
    const docs = new Map([[ra, a], [rb, b]]);
    const state = fold(reg, a, initialState(a, ra, reg), [{ type: "clock", minutes: 10 * 1440, cause: "tick" }]);
    applyMarker(state, { kind: "migrate", to: rb, merge: {} }, { worlds: (r) => docs.get(r), types: reg });
    expect(lifeOf(state, "rosa")).toBe("alive");
    for (const id of ["rosa", "vic"]) expect(agentCursor(b, state, id)).toBeGreaterThanOrEqual(completedSlot(b, state));
  });

  test("someone else's routine reads the same in the Journal whether or not they died unseen", () => {
    const journal = (dies: boolean): string[] => {
      const w = riverton(1, (wd) => {
        wd.realism.levels.castlife = 2;
      });
      w.apply({ type: "link", rel: "knows", from: YOU, to: "jordan" });
      if (dies) life(w, { entity: "jordan", to: "dead" });
      const from = w.events.length;
      lapse(w, 10 * 60);
      return playerLines(reg, w.world, w.state, YOU, w.events.slice(from)).filter((l) => l.includes("Jordan"));
    };
    expect(journal(true)).toEqual(journal(false));
  });
});
