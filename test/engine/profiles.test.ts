// Ruleset profiles (DESIGN §11) on the starter worlds. Each profile applied to each starter lints
// without errors and conforms to the world schema, shows the POV's sheet, offers a skill attempt
// with exact odds, levels up through its progression when XP crosses a threshold, and fights.
// Applying twice changes nothing, conflicts are kept or taken as chosen, people read the new
// fields' defaults, and a stored value changes only when a taken field can't hold it.

import { describe, expect, test } from "bun:test";
import schemaJson from "../../schemas/lre-world-v1.schema.json";
import { presetAdjudication } from "../../src/shared/adjudication";
import { hashJson } from "../../src/shared/hash";
import { MAP_SCHEMA } from "../../src/shared/maps";
import { applyProfile, planProfile, PROFILE_IDS, PROFILES, profileChoices, type ProfileId } from "../../src/shared/profiles/index";
import { checkSchema, pathText, type Schema } from "../../src/shared/schema-check";
import type { WorldDoc } from "../../src/shared/world";
import { lintWorld, previewSheet } from "../../src/engine/authoring";
import { applyEffects } from "../../src/engine/effects";
import { createRegistry } from "../../src/engine/registry-impl";
import { actionOdds, resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { kindIs, placeOfEntity, scopeEnv } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { planTurn } from "../../src/engine/turn";
import { Working } from "../../src/engine/working";
import { initialState } from "../../src/engine/world-state";
import { encounterOf } from "../../src/packs/combat/core/model";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { baseWorld, POV } from "../packs/support";
import { withoutAmbient } from "./support";

const reg = createRegistry(ALL_PACKS);
const packKinds = Object.fromEntries(reg.kinds);
// A JSON module's inferred type spells out every node, which `Schema` describes in general.
const WORLD_SCHEMA = schemaJson as unknown as Schema;

function startOf(world: WorldDoc): WorldState {
  return initialState(world, hashJson(world), reg);
}

/** The value a formula reads on an entity in a state. */
function read(world: WorldDoc, state: WorldState, entity: string, field: string): unknown {
  return scopeEnv({ reg, ctx: reg.context(world, state), bindings: { self: entity } }).lookup(["self", field]);
}

/** Each profile's skill attempt, and the stats that give the POV +3 on it (Fifth: +2 Dexterity, +2 proficiency). */
const ATTEMPT: Record<ProfileId, { action: string; params: Record<string, string>; stats: Record<string, number>; mod: number; degrees: boolean }> = {
  modern: { action: "skill_check", params: { skill: "stealth" }, stats: { dex: 12, stealth: 2 }, mod: 3, degrees: true },
  classic: { action: "skill_check", params: { skill: "stealth" }, stats: { dex: 12, stealth: 2 }, mod: 3, degrees: true },
  fifth: { action: "skill_check", params: { skill: "stealth" }, stats: { dex: 14, stealth: 1 }, mod: 4, degrees: true },
  custom: { action: "try_something", params: {}, stats: { skill: 3 }, mod: 3, degrees: false },
};

/** The exact odds of d20 + `mod` against DC 10: short of it, made, and (with degrees) beaten by 10 or more. */
function d20Odds(mod: number, degrees: boolean): Record<string, number> {
  const out: Record<string, number> = degrees ? { failure: 0, success: 0, great: 0 } : { failure: 0, success: 0 };
  for (let face = 1; face <= 20; face++) {
    const margin = face + mod - 10;
    const outcome = margin < 0 ? "failure" : degrees && margin >= 10 ? "great" : "success";
    out[outcome] = (out[outcome] ?? 0) + 1 / 20;
  }
  return out;
}

/** The XP that reaches level 2 on each profile; Custom has none until its author adds a threshold. */
const LEVEL_TWO: Record<ProfileId, number> = { modern: 1000, classic: 1000, fifth: 300, custom: 100 };

/** A person to fight where the POV starts: the first one there, else the first one moved there; tough enough to see a round out. */
function withFoe(world: WorldDoc): string {
  const state = startOf(world);
  const here = placeOfEntity(state, world.pov);
  const people = Object.keys(world.entities)
    .sort()
    .filter((id) => id !== world.pov && kindIs(reg, world, world.entities[id]?.kind ?? "", "person"));
  const foe = people.find((id) => placeOfEntity(state, id) === here) ?? people[0];
  const e = foe ? world.entities[foe] : undefined;
  if (!foe || !e || here === null) throw new Error("no one to fight");
  e.fields = { ...e.fields, place: here, con: 30, skill: 10 };
  e.relations = e.relations.filter((r) => r.type !== "in");
  return foe;
}

describe("each profile on each starter world", () => {
  for (const [starter, make] of Object.entries(STARTER_WORLDS)) {
    for (const id of PROFILE_IDS) {
      const profile = PROFILES[id];
      const applied = () => applyProfile(make(starter, starter), profile, packKinds);

      test(`${id} on ${starter}: no lint errors, the schema holds, and the POV's sheet shows`, () => {
        const world = applied();
        expect(lintWorld(world, reg).filter((i) => i.severity === "error")).toEqual([]);
        expect(checkSchema(WORLD_SCHEMA, world, [MAP_SCHEMA]).map((p) => `${pathText(p.path)}: ${p.message}`)).toEqual([]);
        const sheet = previewSheet(reg, world);
        expect(sheet?.map((s) => s.title)).toEqual(profile.ruleset.sheet.sections.map((s) => s.label));
        // Every row reads on the POV: a field, a pool, the progression or a formula.
        expect(sheet?.map((s) => s.rows.length)).toEqual(profile.ruleset.sheet.sections.map((s) => s.rows.length));
        expect(sheet?.flatMap((s) => s.rows).find((r) => r.label === "HP")?.pool?.current).toBeGreaterThan(0);
      });

      test(`${id} on ${starter}: a skill attempt shows exact odds and resolves`, () => {
        const world = applied();
        const attempt = ATTEMPT[id];
        const plain = actionOdds(reg, world, startOf(world), { action: attempt.action, params: attempt.params });
        expect(plain.available).toBe(true);
        for (const [outcome, p] of Object.entries(d20Odds(0, attempt.degrees))) expect(plain.odds?.[outcome] ?? 0).toBeCloseTo(p, 12);
        Object.assign(world.entities[world.pov]?.fields ?? {}, attempt.stats);
        const trained = actionOdds(reg, world, startOf(world), { action: attempt.action, params: attempt.params });
        expect(trained.modifier).toBe(attempt.mod);
        for (const [outcome, p] of Object.entries(d20Odds(attempt.mod, attempt.degrees))) expect(trained.odds?.[outcome] ?? 0).toBeCloseTo(p, 12);
        const w = new Working(reg, world, startOf(world));
        const res = resolveAction(reg, w, { action: attempt.action, params: attempt.params }, createRng(`${id}:${starter}`), { runSeed: "test" });
        expect(res.ok).toBe(true);
        expect(Object.keys(d20Odds(0, attempt.degrees))).toContain(res.outcome ?? "");
      });

      test(`${id} on ${starter}: XP crossing a threshold levels up through the progression`, () => {
        const world = applied();
        // Custom's progression has level 1 only; its author levels up their own way.
        if (id === "custom") world.ruleset!.progression!.level!.thresholds = [0, 100, 250];
        const pov = world.pov;
        const w = new Working(reg, world, startOf(world));
        const award = (amount: number) => applyEffects(reg, w, [{ type: "award", args: { entity: pov, progression: "level", amount } }], { bindings: { self: pov }, rng: createRng("xp") });
        expect(award(LEVEL_TWO[id] - 1).rejected).toEqual([]);
        expect(read(world, w.state, pov, "level")).toBe(1);
        expect(award(1).rejected).toEqual([]);
        expect(w.state.entities[pov]?.fields.level).toBe(2);
        expect(read(world, w.state, pov, "xp")).toBe(LEVEL_TWO[id]);
      });

      test(`${id} on ${starter}: a fight starts and an attack resolves`, () => {
        const world = applied();
        const foe = withFoe(world);
        const w = new Working(reg, world, startOf(world));
        const start = applyEffects(reg, w, [{ type: "combat.start", args: { foes: [foe] } }], { bindings: { self: world.pov }, rng: createRng("fight") });
        expect(start.rejected).toEqual([]);
        expect(encounterOf(w.state)?.order.map((f) => f.id).sort()).toEqual([foe, world.pov].sort());
        const plan = withoutAmbient(() => planTurn({ registry: reg, world, state: w.state, runSeed: "run", seed: "turn", kind: "normal", userTexts: ["attack"], intent: { action: "attack", params: { target: foe }, probabilities: { attack: 1 } } }));
        const acts = plan.events.flatMap((e) => (e.type === "combat.act" ? [e.data] : []));
        const mine = acts.find((a) => a.actor === world.pov);
        expect(mine?.action).toBe("attack");
        expect(id === "custom" ? ["success", "failure"] : ["hit", "miss", "critical"]).toContain(String(mine?.outcome));
        if (id === "modern") {
          // A whole round: the foe takes its own turn with the profile's attack, and the turns move on.
          expect(acts.some((a) => a.actor === foe && a.action === "attack")).toBe(true);
          expect(plan.events.some((e) => e.type === "combat.turn")).toBe(true);
        }
      });

      test(`${id} on ${starter}: applying it twice changes nothing, and people keep their values`, () => {
        const before = make(starter, starter);
        const once = applied();
        expect(applyProfile(once, profile, packKinds)).toEqual(once);
        expect(planProfile(once, profile, packKinds).items.filter((i) => i.status !== "same")).toEqual([]);
        // Nobody's stored values change; everyone of the kind reads the new fields' defaults.
        expect(once.entities).toEqual(before.entities);
        const npc = Object.keys(once.entities).find((e) => e !== once.pov && once.entities[e]?.kind === once.entities[once.pov]?.kind) ?? "";
        const field = Object.entries(profile.fields).find(([, f]) => f.default !== undefined)?.[0] ?? "";
        expect(read(once, startOf(once), npc, field)).toEqual(profile.fields[field]?.default);
      });
    }
  }
});

describe("applying a profile", () => {
  /** The test world with a field, a check and a policy of its own where the Modern profile has others. */
  function crowded(): WorldDoc {
    const world = baseWorld();
    world.kinds.person!.fields.hp = { type: "number", label: "Health", default: 5 };
    world.checks.initiative = { id: "initiative", dice: "1d6" };
    world.ruleset = { adjudication: presetAdjudication("crunchy") };
    return world;
  }

  test("existing ids with different content are conflicts, kept unless the profile's is taken", () => {
    const world = crowded();
    const conflicts = planProfile(world, PROFILES.modern, packKinds).items.filter((i) => i.status === "conflict");
    expect(conflicts.map((c) => c.path).sort()).toEqual(["checks.initiative", "kinds.person.fields.hp", "ruleset.adjudication"]);
    const kept = applyProfile(world, PROFILES.modern, packKinds);
    expect(kept.kinds.person?.fields.hp).toEqual(world.kinds.person?.fields.hp);
    expect(kept.checks.initiative).toEqual(world.checks.initiative);
    expect(kept.ruleset?.adjudication).toEqual(presetAdjudication("crunchy"));
    // The rest is added all the same.
    expect(kept.kinds.person?.fields.defense).toEqual(PROFILES.modern.fields.defense);
    const taken = applyProfile(world, PROFILES.modern, packKinds, { "kinds.person.fields.hp": "profile", "checks.initiative": "profile" });
    expect(taken.kinds.person?.fields.hp).toEqual(PROFILES.modern.fields.hp);
    expect(taken.checks.initiative).toEqual(PROFILES.modern.checks.initiative);
    expect(taken.ruleset?.adjudication).toEqual(presetAdjudication("crunchy"));
    expect(taken.ruleset?.profile).toBe("modern");
    // Choices that name nothing, or say neither, are dropped.
    expect(profileChoices({ "checks.initiative": "profile", "checks.save": "maybe", "": "mine", hp: 1 })).toEqual({ "checks.initiative": "profile" });
  });

  test("a stored value changes only when a field taken from the profile can't hold it", () => {
    const world = baseWorld();
    world.entities[POV]!.fields.level = 0;
    world.entities.dev!.fields.str = "strong";
    world.entities.dev!.fields.int = 12;
    const plan = planProfile(world, PROFILES.modern, packKinds);
    expect(plan.people).toBe(2);
    expect(plan.values).toEqual([
      { entity: POV, name: "Sam", field: "level", from: 0, to: 1 },
      { entity: "dev", name: "Dev", field: "str", from: "strong", to: null },
    ]);
    const applied = applyProfile(world, PROFILES.modern, packKinds);
    expect(applied.entities[POV]?.fields.level).toBe(1);
    expect(applied.entities.dev?.fields.int).toBe(12);
    expect(read(applied, startOf(applied), "dev", "str")).toBe(10);
    expect(applied.entities[POV]?.fields.cash).toBe(5000);
  });

  test("a point of view of a pack's kind gets the world's own copy of it, every pack field kept", () => {
    const world = baseWorld();
    delete world.kinds.person;
    const plan = planProfile(world, PROFILES.custom, packKinds);
    expect(plan.kind).toEqual({ id: "person", label: "Person", copied: true });
    const applied = applyProfile(world, PROFILES.custom, packKinds);
    const person = applied.kinds.person;
    expect(person?.extends).toBe(packKinds.person?.extends);
    for (const [field, def] of Object.entries(packKinds.person?.fields ?? {})) expect(person?.fields[field]).toEqual(def);
    expect(person?.fields.skill).toEqual(PROFILES.custom.fields.skill);
    expect(lintWorld(applied, reg).filter((i) => i.severity === "error")).toEqual([]);
    expect(applyProfile(applied, PROFILES.custom, packKinds)).toEqual(applied);
  });

  test("a skill names a row of the skills table, by id or label; anything else is refused", () => {
    const world = applyProfile(STARTER_WORLDS.fantasy_town!("w", "w"), PROFILES.modern, packKinds);
    const w = new Working(reg, world, startOf(world));
    const res = resolveAction(reg, w, { action: "skill_check", params: { skill: "Sense Motive" } }, createRng("label"), { runSeed: "test" });
    expect(res.ok).toBe(true);
    const odds = actionOdds(reg, world, startOf(world), { action: "skill_check", params: { skill: "climbing" } });
    expect(odds.failed).toMatchObject({ code: "bad_param" });
    const broken = structuredClone(world);
    delete broken.tables["modern.skills"];
    expect(lintWorld(broken, reg).filter((i) => i.path === "actions.skill_check.params.skill.table").map((i) => i.severity)).toEqual(["error"]);
  });
});
