import { describe, expect, test } from "bun:test";
import { checkOdds, fixedCheck, NO_BAND, rollCheck } from "../../src/engine/checks";
import { withAdvantage } from "../../src/engine/dice";
import { resolveEdit } from "../../src/engine/edits";
import { applyEffects } from "../../src/engine/effects";
import { buildGmWorld } from "../../src/engine/gm-view";
import { actionOdds, resolveOn } from "../../src/engine/resolve";
import { createRegistry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { buildEntitySheet } from "../../src/engine/ruleset";
import { lintStructure } from "../../src/engine/world-lint";
import { Working } from "../../src/engine/working";
import { migrateWorld, previewSheet } from "../../src/engine/authoring";
import { ALL_PACKS } from "../../src/packs/index";
import { buildSheetView } from "../../src/packs/sheets/core/index";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { CheckDef, WorldDoc } from "../../src/shared/world";
import { validate } from "../../src/cli/local-engine";
import { enumerateOutcomes, withoutAmbient } from "./support";
import { baseWorld, POV, registryOf, startState } from "../packs/support";

/** Every (natural, total) a notation can roll, by brute force over its faces, read through bands. */
function bruteOdds(check: CheckDef, inputs: Parameters<typeof fixedCheck>[1]): Map<number, number> {
  const ready = fixedCheck(check, inputs);
  const outcomes = [...new Set([...ready.bands.map((b) => b.outcome), NO_BAND])];
  const tally = enumerateOutcomes((rng) => outcomes.indexOf(rollCheck(ready, rng).outcome));
  const shown = checkOdds(ready);
  for (const [i, name] of outcomes.entries()) expect(tally.get(i) ?? 0).toBeCloseTo(shown[name] ?? 0, 12);
  expect(Object.values(shown).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  return tally;
}

describe("checks: exact odds match a brute-force enumeration", () => {
  const crit: CheckDef = {
    id: "crit",
    dice: "d20",
    bands: [
      { outcome: "fumble", natural: { max: 1 } },
      { outcome: "triumph", natural: { min: 20 } },
      { outcome: "fail", max: 14 },
      { outcome: "pass", min: 15 },
    ],
  };

  test("a natural-20 band is matched before the total bands", () => {
    bruteOdds(crit, { modifier: 3 });
    const odds = checkOdds(fixedCheck(crit, { modifier: 30 }));
    expect(odds.triumph).toBeCloseTo(1 / 20, 12);
    expect(odds.fumble).toBeCloseTo(1 / 20, 12);
    expect(odds.pass).toBeCloseTo(18 / 20, 12);
  });

  test("advantage and disadvantage change the dice, with exact odds", () => {
    expect(withAdvantage("d20", 1)).toBe("2d20kh1");
    expect(withAdvantage("1d20+2", -1)).toBe("2d20kl1+2");
    expect(withAdvantage("2d20kh1", -1)).toBe("1d20");
    expect(withAdvantage("2d20kh1", 1)).toBe("3d20kh1");
    expect(withAdvantage("d100", 1)).toBe("2d100kh1");
    expect(withAdvantage("3d6", 1)).toBeNull();
    bruteOdds(crit, { modifier: 2, advantage: 1 });
    bruteOdds(crit, { modifier: 2, advantage: -1 });
    expect(checkOdds(fixedCheck(crit, { modifier: 30, advantage: 1 })).triumph).toBeCloseTo(1 - (19 / 20) ** 2, 12);
    expect(checkOdds(fixedCheck(crit, { modifier: 30, advantage: -1 })).triumph).toBeCloseTo(1 / 400, 12);
  });

  test("DC margins: the default bands and margin bands", () => {
    const plain: CheckDef = { id: "dc", dice: "d20", dc: "12" };
    bruteOdds(plain, { modifier: 1, dc: 12 });
    expect(checkOdds(fixedCheck(plain, { modifier: 1, dc: 12 })).success).toBeCloseTo(10 / 20, 12);
    const degrees: CheckDef = { id: "deg", dice: "2d6", bands: [{ outcome: "great", margin: { min: 5 } }, { outcome: "ok", margin: { min: 0 } }, { outcome: "bad", margin: { max: -1 } }] };
    bruteOdds(degrees, { modifier: 2, dc: 8 });
  });

  test("an opposed roll folds into one notation with exact odds; ties go to the roller", () => {
    const contest: CheckDef = { id: "c", dice: "d20", bands: [{ outcome: "crit", natural: { min: 20 }, margin: { min: 0 } }] };
    const tally = bruteOdds(contest, { modifier: 2, against: { dice: "d20", modifier: 1 } });
    expect(tally.size).toBeGreaterThan(1);
    const ready = fixedCheck({ id: "o", dice: "d20" }, { modifier: 2, against: { dice: "d20", modifier: 1 } });
    expect(ready.notation).toBe("1d20-1d20");
    expect(ready.modifier).toBe(1);
    expect(ready.dc).toBe(0);
    // P(A + 1 ≥ B) for two d20s.
    let wins = 0;
    for (let a = 1; a <= 20; a++) for (let b = 1; b <= 20; b++) if (a + 1 >= b) wins++;
    expect(checkOdds(ready).success).toBeCloseTo(wins / 400, 12);
  });
});

function rulesWorld(): WorldDoc {
  const world = baseWorld();
  const person = world.kinds.person!;
  person.fields.might = { type: "number", default: 10 };
  person.fields.max_hp = { type: "number", derived: "10 + self.level * 5" };
  person.fields.hp = { type: "number", pool: { max: "max_hp", recover: "3" } };
  person.fields.xp = { type: "number", default: 0 };
  person.fields.level = { type: "number", default: 1 };
  person.fields.perks = { type: "number", default: 0 };
  world.checks.sneak = { id: "sneak", dice: "d20", modifier: "self.might - 10", advantage: "self.skill >= 2 ? 1 : 0", dc: "12" };
  world.checks.notice = { id: "notice", dice: "d20", modifier: "1", bands: [{ outcome: "spotted", min: 11 }, { outcome: "missed", max: 10 }] };
  world.actions.sneak_past = { id: "sneak_past", label: "Sneak past", params: { target: { type: "ref", ref: "person" } }, requires: [], check: { id: "contest", dice: "d20", modifier: "self.skill", vs: { check: "notice" }, bands: [] }, outcomes: { success: [{ type: "add", args: { entity: "self", field: "perks", delta: "=roll.margin" } }], failure: [] }, duration: "1" };
  world.actions.sneak = { id: "sneak", label: "Sneak", params: {}, requires: [], check: "sneak", outcomes: { success: [], failure: [] }, duration: "1" };
  world.ruleset = {
    progression: { character: { label: "Level", xpField: "xp", levelField: "level", thresholds: [0, 300, 900, 2700], onLevel: [{ type: "add", args: { entity: "self", field: "perks", delta: "=level * 10 + from" } }] } },
    sheet: { sections: [{ id: "vitals", label: "Vitals", rows: [{ pool: "hp" }, { progression: "character" }, { field: "might" }, { formula: "self.max_hp", label: "Max HP" }] }] },
  };
  return world;
}

describe("checks in actions and effects", () => {
  test("the palette shows the advantage the roll has, and the roll uses it", () => {
    const world = rulesWorld();
    const reg = registryOf();
    const state = startState(world);
    const shown = actionOdds(reg, world, state, { action: "sneak" });
    expect(shown.check).toEqual({ notation: "2d20kh1", advantage: 1, dc: 12, opponent: null });
    const { resolution } = resolveOn(reg, world, state, { action: "sneak" }, createRng("s"));
    expect(resolution.check?.roll.dice.length).toBe(2);
    expect(resolution.check?.odds).toEqual(shown.odds ?? {});
  });

  test("an opposed action rolls against the target, and outcome effects read roll.*", () => {
    const world = rulesWorld();
    const reg = registryOf();
    const state = startState(world);
    expect(actionOdds(reg, world, state, { action: "sneak_past", params: { target: "dev" } }).check?.notation).toBe("1d20-1d20");
    for (let i = 0; i < 20; i++) {
      const { resolution, state: after } = resolveOn(reg, world, state, { action: "sneak_past", params: { target: "dev" } }, createRng(`o${i}`));
      const margin = resolution.check?.margin ?? 0;
      if (resolution.outcome === "success") expect(after.entities[POV]?.fields.perks).toBe(margin);
    }
  });

  test("same seed, same outcome; an NPC check never moves the POV's roll", () => {
    const world = rulesWorld();
    const reg = registryOf();
    const state = startState(world);
    const a = withoutAmbient(() => resolveOn(reg, world, state, { action: "sneak" }, createRng("seed")));
    const b = withoutAmbient(() => resolveOn(reg, world, state, { action: "sneak" }, createRng("seed")));
    expect(a).toEqual(b);
    const npcCheck = { type: "check", args: { check: "notice", actor: "dev", outcomes: { spotted: [{ type: "set", args: { entity: "self", field: "activity", value: "alert" } }] } } };
    const withNpc = structuredClone(world);
    withNpc.actions.sneak!.outcomes = { success: [npcCheck], failure: [npcCheck] };
    const c = resolveOn(reg, withNpc, state, { action: "sneak" }, createRng("seed"));
    expect(c.resolution.check?.total).toBe(a.resolution.check?.total);
    expect(c.resolution.check?.roll.dice).toEqual(a.resolution.check?.roll.dice ?? []);
    expect(c.resolution.events.some((e) => e.type === "engine.check")).toBe(true);
  });
});

describe("roll() is for effect arguments only", () => {
  test("an effect argument rolls on the effect's generator and its event stores the result", () => {
    const world = rulesWorld();
    const reg = registryOf();
    const w = new Working(reg, world, startState(world));
    const out = applyEffects(reg, w, [{ type: "add", args: { entity: "self", field: "perks", delta: "=roll('3d6')" } }], { bindings: { self: POV }, rng: createRng("r") });
    const ev = out.applied[0];
    expect(ev?.type).toBe("add");
    const delta = ev && ev.type === "add" ? ev.delta : 0;
    expect(delta).toBeGreaterThanOrEqual(3);
    expect(delta).toBeLessThanOrEqual(18);
  });

  test("anywhere else it is a lint error", () => {
    const world = rulesWorld();
    world.checks.sneak!.modifier = "roll('1d4')";
    world.actions.sneak!.requires = ["roll('1d6') > 2"];
    world.kinds.person!.fields.luck = { type: "number", derived: "roll('1d6')" };
    world.rules.r = { id: "r", on: { tick: "turn" }, when: "roll('1d2') == 1", do: [{ type: "add", args: { entity: "self", field: "perks", delta: "=roll('1d6')" } }] };
    world.ruleset!.sheet!.sections[0]!.rows.push({ formula: "roll('1d6')", label: "Luck" });
    const issues = lintStructure(world, registryOf()).filter((i) => i.code === "roll_outside_effect");
    expect(issues.map((i) => i.path).sort()).toEqual(["actions.sneak.requires.0", "checks.sneak.modifier", "kinds.person.fields.luck.derived", "rules.r.when", "ruleset.sheet.sections.0.rows.4.formula"]);
  });
});

describe("pools", () => {
  test("set and add clamp to the evaluated max; an unset pool is full; recover restores", () => {
    const world = rulesWorld();
    const reg = registryOf();
    const w = new Working(reg, world, startState(world));
    const scope = { bindings: { self: POV }, rng: createRng("p") };
    applyEffects(reg, w, [{ type: "add", args: { entity: "self", field: "hp", delta: -9 } }], scope);
    expect(w.state.entities[POV]?.fields.hp).toBe(6);
    applyEffects(reg, w, [{ type: "set", args: { entity: "self", field: "hp", value: 99 } }], scope);
    expect(w.state.entities[POV]?.fields.hp).toBe(15);
    applyEffects(reg, w, [{ type: "add", args: { entity: "self", field: "hp", delta: -100 } }], scope);
    expect(w.state.entities[POV]?.fields.hp).toBe(0);
    applyEffects(reg, w, [{ type: "recover", args: { entity: "self", field: "hp" } }], scope);
    expect(w.state.entities[POV]?.fields.hp).toBe(3);
    applyEffects(reg, w, [{ type: "recover", args: { entity: "self", field: "hp", full: true } }], scope);
    expect(w.state.entities[POV]?.fields.hp).toBe(15);
  });
});

describe("progression", () => {
  test("an award crossing two thresholds levels up twice and runs onLevel twice", () => {
    const world = rulesWorld();
    const reg = registryOf();
    const w = new Working(reg, world, startState(world));
    const out = applyEffects(reg, w, [{ type: "award", args: { entity: "self", progression: "character", amount: 1000 } }], { bindings: { self: POV }, rng: createRng("a") });
    expect(out.rejected).toEqual([]);
    expect(w.state.entities[POV]?.fields.level).toBe(3);
    // level 2 (from 1): 21; level 3 (from 1): 31.
    expect(w.state.entities[POV]?.fields.perks).toBe(52);
    expect(out.applied.filter((e) => e.type === "set" && e.field === "level").map((e) => (e.type === "set" ? e.value : null))).toEqual([2, 3]);
    expect(out.applied.some((e) => e.type === "engine.note")).toBe(true);
    // Recorded events replay to the same state, with no second level-up.
    const replay = new Working(reg, world, startState(world));
    replay.applyAll(out.applied);
    expect(replay.state).toEqual(w.state);
  });

  /** What the events write to the level and XP fields, and the Journal lines they add. */
  const progress = (events: readonly LedgerEvent[]): (string | number)[][] => events.flatMap((e) => (e.type === "set" && (e.field === "level" || e.field === "xp") ? [[e.field, Number(e.value)]] : e.type === "engine.note" ? [[String(e.data.text)]] : []));

  test("lowering XP lowers the level straight to the one it reaches, running nothing, and gaining it back levels up again", () => {
    const world = rulesWorld();
    const reg = registryOf();
    const w = new Working(reg, world, startState(world));
    const scope = { bindings: { self: POV }, rng: createRng("down") };
    applyEffects(reg, w, [{ type: "award", args: { entity: "self", progression: "character", amount: 1000 } }], scope);
    expect([w.state.entities[POV]?.fields.level, w.state.entities[POV]?.fields.perks]).toEqual([3, 52]);
    const down = applyEffects(reg, w, [{ type: "add", args: { entity: "self", field: "xp", delta: -800 } }], scope);
    expect(down.rejected).toEqual([]);
    expect(progress(down.applied)).toEqual([["level", 1], ["You dropped to Level 1 (from 3)."]]);
    // What levels 2 and 3 gave stays: falling runs no onLevel.
    expect([w.state.entities[POV]?.fields.xp, w.state.entities[POV]?.fields.level, w.state.entities[POV]?.fields.perks]).toEqual([200, 1, 52]);
    applyEffects(reg, w, [{ type: "add", args: { entity: "self", field: "xp", delta: 100 } }], scope);
    expect([w.state.entities[POV]?.fields.level, w.state.entities[POV]?.fields.perks]).toEqual([2, 73]);
  });

  test("only XP moves the level: a fix or a GM edit to XP takes it along, and anything that writes the level is refused", () => {
    const world = rulesWorld();
    const reg = registryOf();
    const state = startState(world);
    state.entities[POV]!.fields.xp = 1000;
    state.entities[POV]!.fields.level = 3;
    for (const gm of [false, true]) {
      const fixed = resolveEdit(reg, world, state, [{ op: "set", entity: POV, field: "xp", value: 300 }], { gm, runSeed: "r" });
      expect("events" in fixed ? progress(fixed.events) : fixed.rejection.reason).toEqual([["xp", 300], ["level", 2], ["You dropped to Level 2 (from 3)."]]);
      for (const write of [{ op: "set", entity: POV, field: "level", value: 5 }, { op: "add", entity: POV, field: "level", delta: 1 }] as const) {
        const refused = resolveEdit(reg, world, state, [write], { gm, runSeed: "r" });
        expect("rejection" in refused ? refused.rejection.code : "applied").toBe("follows_xp");
      }
    }
    const w = new Working(reg, world, state);
    const effect = applyEffects(reg, w, [{ type: "set", args: { entity: "self", field: "level", value: 9 } }], { bindings: { self: POV }, rng: createRng("set") });
    expect(effect.rejected.map((r) => r.rejection.code)).toEqual(["follows_xp"]);
    expect(w.state.entities[POV]?.fields.level).toBe(3);
  });

  test("someone new starts at the level their XP reaches, and a spawn can't name a level", () => {
    const world = rulesWorld();
    const reg = registryOf();
    const w = new Working(reg, world, startState(world));
    const scope = { bindings: { self: POV }, rng: createRng("spawn") };
    const vet = applyEffects(reg, w, [{ type: "spawn", args: { id: "vet", kind: "person", name: "Vet", fields: { xp: 1000 } } }], scope);
    expect(vet.rejected).toEqual([]);
    // Level 3 from the start: nothing was gained, so no onLevel ran and the Journal says nothing.
    expect([w.state.entities.vet?.fields.level, w.state.entities.vet?.fields.perks ?? 0]).toEqual([3, 0]);
    expect(vet.applied.some((e) => e.type === "engine.note")).toBe(false);
    const boss = applyEffects(reg, w, [{ type: "spawn", args: { id: "boss", kind: "person", name: "Boss", fields: { level: 4 } } }], scope);
    expect(boss.rejected.map((r) => r.rejection.code)).toEqual(["follows_xp"]);
    expect(w.state.entities.boss).toBeUndefined();
  });

  test("the GM view and the sheet show the level as set from XP, with nothing to edit", () => {
    const world = rulesWorld();
    world.ruleset!.sheet!.sections[0]!.rows.push({ field: "level" });
    const reg = registryOf();
    const state = startState(world);
    const fields = buildGmWorld(reg, world, state).entities.find((e) => e.id === POV)?.fields ?? [];
    expect(fields.find((f) => f.id === "level")?.follows).toBe("xp");
    expect(fields.find((f) => f.id === "xp")?.follows).toBeUndefined();
    const rows = buildEntitySheet(reg.context(world, state), POV, { fixes: true })?.[0]?.rows ?? [];
    expect(rows.find((r) => r.label === "Level" && !r.progress)?.fix).toBeUndefined();
    // The progression's own row corrects XP.
    expect(rows.find((r) => r.progress)?.fix?.field).toBe("xp");
  });

  test("lint names a person whose level isn't the one their XP reaches", () => {
    const world = rulesWorld();
    world.entities[POV]!.fields.level = 3;
    world.entities.dev!.fields.xp = 300;
    world.entities.dev!.fields.level = 2;
    const issues = lintStructure(world, registryOf()).filter((i) => i.code === "progression_level");
    expect(issues.map((i) => [i.severity, i.path])).toEqual([["warning", `entities.${POV}.fields.level`]]);
    expect(issues[0]?.message).toContain("Level 1");
  });
});

describe("the sheet and the ruleset container", () => {
  test("the designed sheet reads pools and progressions, and Play → You shows it", () => {
    const world = rulesWorld();
    world.ruleset!.minLevels = { sheets: 2 };
    const reg = registryOf();
    const ctx = reg.context(world, startState(world));
    const sections = buildEntitySheet(ctx, POV);
    expect(sections?.[0]?.rows.map((r) => r.label)).toEqual(["Hp", "Level", "Might", "Max HP"]);
    expect(sections?.[0]?.rows[0]?.pool).toEqual({ current: 15, min: 0, max: 15 });
    expect(sections?.[0]?.rows[1]?.progress).toEqual({ level: 1, xp: 0, from: 0, next: 300 });
    expect(buildSheetView(ctx).sections).toEqual(buildEntitySheet(ctx, POV, { fixes: true }) ?? []);
    expect(previewSheet(reg, world)).toEqual(sections);
  });

  test("a Sheets 3 floor makes stat modifiers apply under the Story preset", () => {
    const reg = createRegistry(ALL_PACKS);
    const world = rulesWorld();
    world.entities[POV]!.fields.might = 18;
    world.packs.sheets = { version: 1, config: {} };
    const plain = actionOdds(reg, world, startState(world), { action: "attempt", params: { stat: "might" } });
    world.ruleset!.minLevels = { sheets: 3 };
    const floored = actionOdds(reg, world, startState(world), { action: "attempt", params: { stat: "might" } });
    // 1d20 + stat_mod + conditions − difficulty (moderate 10) + 10: the stat counts only from Sheets 3.
    expect(plain.modifier).toBe(0);
    expect(floored.modifier).toBe(4);
  });

  test("worlds without a ruleset keep none; lint and the local engine's validate read it", () => {
    const world = baseWorld();
    expect("ruleset" in migrateWorld(world)).toBe(false);
    const bad = rulesWorld();
    bad.ruleset!.progression!.character!.thresholds = [0, 900, 300];
    expect(lintStructure(bad, registryOf()).some((i) => i.path === "ruleset.progression.character.thresholds")).toBe(true);
    expect(validate({ ...rulesWorld(), ruleset: "x" }).some((i) => i.path === "ruleset")).toBe(true);
  });
});
