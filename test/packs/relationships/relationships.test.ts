import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { buildGmWorld } from "../../../src/engine/gm-view";
import { applyEffects } from "../../../src/engine/effects";
import { createRegistry } from "../../../src/engine/registry-impl";
import { createRng } from "../../../src/engine/rng";
import { resolveAction } from "../../../src/engine/resolve";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { regardAxes, regardBand, regardValue, voiceLine } from "../../../src/packs/relationships/core/index";
import { modernUsWorld } from "../riverton";
import { fold, startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function setup(level: 1 | 2 | 3 | 4, patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "R");
  world.realism.levels.relationships = level;
  patch(world);
  return new Working(reg, world, startState(world));
}

function appraise(w: Working, from: string, to: string, appraisal: string): void {
  const r = applyEffects(reg, w, [{ type: "relationships.appraise", args: { from, to, appraisal } }], { bindings: {}, rng: createRng("a") });
  expect(r.rejected).toEqual([]);
}

describe("relationships", () => {
  test("level 3+: appraisals move each axis by the rule; levels 1–2 move all axes by the mean", () => {
    const w3 = setup(3);
    appraise(w3, "maya", "you", "help");
    expect(regardAxes(w3.ctx, "maya", "you")).toEqual({ warmth: 5, trust: 5, respect: 3 });
    const w1 = setup(1);
    appraise(w1, "maya", "you", "help");
    expect(regardAxes(w1.ctx, "maya", "you")).toEqual({ warmth: 4.3, trust: 4.3, respect: 4.3 });
    expect(regardBand(w1.ctx, "maya", "you")).toBe("neutral");
  });

  test("regard is an accumulator: deltas re-fold, clamp to the axis range, and keep a bounded history", () => {
    const w = setup(4);
    for (let i = 0; i < 12; i++) appraise(w, "maya", "you", "betrayal");
    expect(regardValue(w.ctx, "maya", "you", "trust")).toBe(-100);
    expect(regardBand(w.ctx, "maya", "you")).toBe("hostile");
    const rel = w.state.entities.maya?.relations.find((r) => r.type === "regard" && r.to === "you");
    expect(Array.isArray(rel?.fields?.history) ? rel.fields.history.length : 0).toBe(8);
    expect(fold(reg, w.world, startState(w.world), w.events)).toEqual(w.state);
  });

  test("level 4 decays closed-form at read time (half-life 30 days); lower levels don't", () => {
    const w = setup(4);
    applyEffects(reg, w, [{ type: "relationships.adjust", args: { from: "maya", to: "you", axis: "warmth", delta: 40 } }], { bindings: {}, rng: createRng("x") });
    w.apply({ type: "clock", minutes: 30 * 1440, cause: "advance" });
    expect(regardValue(w.ctx, "maya", "you", "warmth")).toBe(20);
    w.state.realism.levels.relationships = 3;
    expect(regardValue(w.ctx, "maya", "you", "warmth")).toBe(40);
  });

  test("the GM view lists each agent's current regard, NPC↔NPC included; a player line words it with 'you'", () => {
    const w = setup(4);
    w.state.entities.maya!.agent = true;
    appraise(w, "maya", "jordan", "help");
    const gm = buildGmWorld(reg, w.world, w.state);
    const maya = gm.entities.find((e) => e.id === "maya");
    expect(maya?.relations.some((r) => r.type === "regard" && r.to === "jordan" && typeof r.value === "number")).toBe(true);
    const ev = w.events.find((e) => e.type === "relationships.regard");
    expect(ev ? reg.get(ev.type)?.describe(ev, w.ctx) : "").toBe(`${w.state.entities.maya?.name} → ${w.state.entities.jordan?.name}: warmth +5, trust +5, respect +3`);
    appraise(w, "maya", "you", "help");
    const toYou = w.events.filter((e) => e.type === "relationships.regard").at(-1);
    expect(toYou ? reg.get(toYou.type)?.describe(toYou, w.ctx) : "").toBe(`${w.state.entities.maya?.name} → you: warmth +5, trust +5, respect +3`);
  });

  test("faction regard is the members' mean unless the faction has its own; the narrator voice uses bands", () => {
    const w = setup(4, (wd) => {
      wd.entities.crew = { id: "crew", kind: "faction", name: "Café crew", tier: "background", fields: {}, relations: [] };
      wd.entities.maya!.relations.push({ type: "member_of", to: "crew" });
      wd.entities.jordan!.relations.push({ type: "member_of", to: "crew" });
    });
    applyEffects(reg, w, [{ type: "relationships.adjust", args: { from: "maya", to: "you", delta: 50 } }], { bindings: {}, rng: createRng("f") });
    expect(w.ctx.query("relationships.faction_regard")(w.ctx, "crew", "you")).toBe(25);
    w.state.entities.you!.fields.place = "cafe";
    expect(voiceLine(w.ctx, "maya")).toBe("Maya Chen is warm toward you (warmth 50, trust 50, respect 50).");
  });

  test("the regard channel is capped per proposal; level 0 makes appraisals no-ops", () => {
    const w = setup(3);
    const ch = reg.proposals.get("regard");
    const effects = ch?.toEffects({ from: "maya", to: "you", delta: 60 }, w.ctx) ?? [];
    expect(effects[0]?.args.delta).toBe(10);
    w.state.realism.levels.relationships = 0;
    expect(w.ctx.service("relationship.appraise")(w.ctx, "maya", "you", "gift")).toEqual([]);
  });
});

describe("relationships without Cast life", () => {
  test("Chat with plays in a registry that has no Cast life: relationships needs nothing of it", () => {
    const lean = createRegistry(ALL_PACKS.filter((p) => p.id !== "castlife"));
    const world = modernUsWorld("w", "R");
    world.entities.you!.fields.place = "apartment_hall";
    const w = new Working(lean, world, startState(world));
    const chat = resolveAction(lean, w, { action: "chat_with", params: { target: "rosa", minutes: 30 } }, createRng("c"));
    expect(chat.ok).toBe(true);
    expect(chat.rejected).toEqual([]);
    expect(chat.duration).toBe(30);
    expect(w.events.some((e) => e.type === "relationships.regard")).toBe(true);
  });
});
