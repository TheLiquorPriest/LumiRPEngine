// The recipes in docs/RECIPES.md, built from the page itself: each fragment, merged into a new
// world, loads through the studio API, lints clean, conforms to the published schema and plays as
// its "Try it" says through the engine.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import schemaJson from "../../schemas/lre-world-v1.schema.json";
import { checkWorldDay, playtestStart, playtestTurn } from "../../src/engine/authoring";
import { readEngineSlice } from "../../src/engine/engine-pack";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { runRulesOnEvents } from "../../src/engine/rules";
import { evalExpr, scopeEnv } from "../../src/engine/scope";
import { selectorMatches } from "../../src/engine/selector";
import type { WorldState } from "../../src/engine/state";
import { planTurn, postTurn, timelapseIntent } from "../../src/engine/turn";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { hashJson } from "../../src/shared/hash";
import { isRecord } from "../../src/shared/json";
import type { Value } from "../../src/engine/expr";
import type { WorldDoc } from "../../src/shared/world";
import { checkSchema, checkWorld, lint, load, MAP_SCHEMA, newWorld, pathText, revisionOf, type Schema } from "../../src/studio-api";

const PAGE = readFileSync(join(import.meta.dir, "../../docs/RECIPES.md"), "utf8");
// A JSON module's inferred type spells out every node, which `Schema` describes in general.
const WORLD_SCHEMA = schemaJson as unknown as Schema;
const TITLES = ["XP and levels", "A skill challenge", "A shop with a priced catalog", "Secret lore behind a track", "A room on the grid", "A family"];
const reg = createRegistry(ALL_PACKS);
const pipeline = { plan: planTurn, post: postTurn };

/** The JSON fragment under the recipe heading that starts with `title`. */
function fragment(title: string): unknown {
  const json = PAGE.split("\n## ")
    .find((section) => section.startsWith(title))
    ?.match(/```json\n([\s\S]*?)\n```/)?.[1];
  if (json === undefined) throw new Error(`docs/RECIPES.md has no recipe "${title}" with a JSON fragment`);
  return JSON.parse(json);
}

/** The page's merge: object by object, a list or a value replacing what was there. */
function merge(base: unknown, patch: unknown): unknown {
  if (!isRecord(base) || !isRecord(patch)) return structuredClone(patch);
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = Object.hasOwn(base, key) ? merge(base[key], value) : structuredClone(value);
  return out;
}

/** A new world with the recipe merged in, loaded as a studio loads it. */
function recipe(title: string): WorldDoc {
  const loaded = load(JSON.stringify(merge(newWorld("recipe", title), fragment(title))));
  if (!loaded.ok) throw new Error(loaded.issues.map((i) => `${i.path}: ${i.message}`).join("\n"));
  return loaded.world;
}

/** Typed turns through the engine, as Playtest plays them; the state after the last. */
function play(world: WorldDoc, turns: readonly string[]): WorldState {
  let state = playtestStart(reg, world, revisionOf(world));
  turns.forEach((text, i) => {
    state = playtestTurn(reg, pipeline, world, state, text, "recipes", i).state;
  });
  return state;
}

/** A formula read on a state, with the POV as `self`. */
function read(world: WorldDoc, state: WorldState, formula: string): Value {
  return evalExpr(formula, scopeEnv({ reg, ctx: reg.context(world, state) }), null);
}

describe("recipes", () => {
  test("every recipe loads, lints without errors or warnings and conforms to the world schema", () => {
    for (const title of TITLES) {
      const world = recipe(title);
      const problems = [...lint(world).filter((i) => i.severity !== "info").map((i) => `${i.path}: ${i.message}`), ...checkSchema(WORLD_SCHEMA, world, [MAP_SCHEMA]).map((p) => `${pathText(p.path)}: ${p.message}`)];
      expect({ title, problems }).toEqual({ title, problems: [] });
    }
  });

  test("XP and levels: the second spar reaches Level 2, with its Grit and a bigger pool", () => {
    const world = recipe("XP and levels");
    const stats = ["self.xp", "self.level", "self.grit", "self.hp_max", "self.hp"];
    expect(stats.map((f) => read(world, play(world, ["I spar"]), f))).toEqual([150, 1, 10, 12, 12]);
    expect(stats.map((f) => read(world, play(world, ["I spar", "I spar", "I spar"]), f))).toEqual([450, 2, 11, 16, 16]);
  });

  test("a skill challenge: a sure thing passes without a roll, a hopeless lock fails without one, anything between rolls", () => {
    const world = recipe("A skill challenge");
    const attempt = (finesse: number): { rolled: unknown; outcome: unknown; stage: unknown; locks: unknown } => {
      const w = structuredClone(world);
      if (w.entities.you) w.entities.you.fields.finesse = finesse;
      const first = new Working(reg, w, playtestStart(reg, w, revisionOf(w)));
      const adjudged = resolveAction(reg, first, { action: "work_lock", params: {} }, createRng("lock")).events.find((e) => e.type === "engine.adjudged");
      const after = play(w, ["I work the lock", "I work the lock", "I work the lock"]);
      return { rolled: adjudged && "data" in adjudged ? adjudged.data.rolled : null, outcome: adjudged && "data" in adjudged ? adjudged.data.outcome : null, stage: after.tracks.vault_door?.stage, locks: after.entities.you?.fields.locks_open ?? 0 };
    };
    expect(attempt(15)).toEqual({ rolled: false, outcome: "success", stage: "open", locks: 3 });
    expect(attempt(-30)).toEqual({ rolled: false, outcome: "failure", stage: "locked", locks: 0 });
    expect(attempt(4).rolled).toBe(true);
  });

  test("a shop: catalog prices come out of the purse, bought things land in your hands, and what you can't cover is declined", () => {
    const world = recipe("A shop with a priced catalog");
    const table = world.tables["economy.catalog"];
    expect(table?.revision).toBe(hashJson({ schema: table?.schema, columns: table?.columns, rows: table?.rows }));
    const state = play(world, ["I buy a brass lantern", "I buy beef jerky", "I buy a brass lantern"]);
    expect(state.accounts.purse).toBe(2000 - 1250 - 350);
    const held = Object.values(state.entities).filter((e) => e.relations.some((r) => r.type === "in" && r.to === "you"));
    expect(held.map((e) => e.name).sort()).toEqual(["Beef jerky", "Brass lantern"]);
    const rope = 2000 - (play(world, ["I buy hemp rope"]).accounts.purse ?? 0);
    expect(rope >= 736 && rope <= 864).toBe(true);
  });

  test("secret lore: shut until the track reveals it, never leaked, and guarded by lint", () => {
    const world = recipe("Secret lore behind a track");
    const gate = world.lore.hale_debt?.gate ?? "";
    expect(read(world, playtestStart(reg, world, revisionOf(world)), gate)).toBe(false);
    expect(checkWorld(world, 1).turns.flatMap((t) => t.notes).filter((n) => n.startsWith("leak"))).toEqual([]);
    const after = play(world, ["I go to the mill office"]);
    expect([after.tracks.hale_debt?.stage, read(world, after, gate)]).toEqual(["revealed", true]);
    const codes = (change: (w: WorldDoc) => void): string[] => {
      const w = structuredClone(world);
      change(w);
      return lint(w).map((i) => i.code);
    };
    expect(codes((w) => void (w.lore.hale_debt && (w.lore.hale_debt.secret = false)))).toContain("secret_truth");
    expect(codes((w) => void (w.lore.hale_debt && delete w.lore.hale_debt.gate))).toContain("no_gate");
    expect(codes((w) => void (w.lore.hale_debt && (w.lore.hale_debt.audience = ["npc.choose", "brief"])))).toContain("prose_audience");
  });

  test("a room on the grid: the fountain fires once per visit, the key is in reach from it, and the shed is behind its door", () => {
    const world = recipe("A room on the grid");
    const w = new Working(reg, world, playtestStart(reg, world, revisionOf(world)));
    const you = () => w.state.entities.you?.fields;
    expect([you()?.x, you()?.y]).toEqual([6, 4]);
    const act = (action: string, params: Record<string, string | number>): boolean => {
      const r = resolveAction(reg, w, { action, params }, createRng(`${action}:${JSON.stringify(params)}`));
      if (r.ok) runRulesOnEvents(reg, w, r.events, { seed: action });
      return r.ok;
    };
    const fired = () => readEngineSlice(w.state).fired.fountain_coins?.n ?? 0;
    expect([act("step", { x: 6, y: 2 }), fired()]).toEqual([true, 1]);
    expect([act("take", { item: "key" }), fired()]).toEqual([true, 1]);
    expect(w.state.entities.key?.relations).toContainEqual({ type: "in", to: "you" });
    expect([act("step", { x: 6, y: 1 }), act("step", { x: 6, y: 2 }), fired()]).toEqual([true, true, 2]);
    expect([act("step", { x: 2, y: 2 }), you()?.place]).toEqual([true, "shed"]);
  });

  test("a family: kinship both ways, one selector for all of them, and the group's schedule brings them home", () => {
    const world = recipe("A family");
    const start = playtestStart(reg, world, revisionOf(world));
    expect(read(world, start, "member_of(tobi, 'okafors') and has_rel(ada, 'parent_of', 'tobi') and has_rel(tobi, 'child_of', 'emeka') and has_rel(emeka, 'spouse_of', 'ada')")).toBe(true);
    expect(Object.keys(start.entities).filter((id) => selectorMatches(reg, world, start, { memberOf: ["okafors"] }, id)).sort()).toEqual(["ada", "emeka", "tobi"]);
    const evening = checkWorldDay(reg, pipeline, world, start, "recipes", 0, timelapseIntent({ type: "duration", minutes: 90 })).state;
    expect(["ada", "emeka", "tobi"].map((id) => evening.entities[id]?.fields.place)).toEqual(["okafor_house", "okafor_house", "okafor_house"]);
  });
});
