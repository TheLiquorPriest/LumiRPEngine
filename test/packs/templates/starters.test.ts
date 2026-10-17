import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { REALISM_PRESETS } from "../../../src/backend/settings-store";
import { isWorldDoc, lintWorld } from "../../../src/engine/authoring";
import { compile, runProgram } from "../../../src/engine/expr";
import { materializeAll } from "../../../src/engine/materialize";
import { scopeEnv } from "../../../src/engine/scope";
import { ALL_NOTE } from "../../../src/engine/simulate";
import { playerTrack } from "../../../src/engine/visibility";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS, defaultTables } from "../../../src/packs/index";
import { hashJson } from "../../../src/shared/hash";
import type { JsonValue } from "../../../src/shared/json";
import { objectiveWhen, type EffectSpec, type WorldDoc } from "../../../src/shared/world";
import { buildAll } from "../../../scripts/templates/build";
import { startState, trialBalance } from "../support";
import { registry } from "./play";

const EXPECTED: Record<string, { preset: "story" | "grounded" | "simulation"; currency: string }> = {
  fantasy_town: { preset: "story", currency: "BIT" },
  mystery_manor: { preset: "grounded", currency: "GBP" },
  modern_slice_of_life: { preset: "simulation", currency: "USD" },
};
const IDS = Object.keys(EXPECTED);

const fresh = buildAll();
const worlds = Object.fromEntries(IDS.map((id) => [id, (STARTER_WORLDS[id] as (id: string, name: string) => WorldDoc)("w", id)]));

describe("the starter-template converter", () => {
  test("a build is deterministic", () => {
    expect(buildAll().map((b) => b.text)).toEqual(fresh.map((b) => b.text));
  });

  test("it builds exactly the three starters, in the Build tab's template ids", () => {
    expect(fresh.map((b) => b.id)).toEqual(IDS);
    expect(Object.keys(STARTER_WORLDS).sort()).toEqual([...IDS].sort());
  });

  test("the committed worlds equal a fresh build", () => {
    for (const b of fresh) expect(readFileSync(b.path, "utf8") === b.text).toBe(true);
  });

  test("every output validates: zero lint errors or warnings", () => {
    for (const b of fresh) expect(b.issues).toEqual([]);
    for (const [id, world] of Object.entries(worlds)) {
      expect(isWorldDoc(world)).toBe(true);
      expect(lintWorld(world, registry)).toEqual([]);
      expect(world.id).toBe("w");
      expect(world.name).toBe(id);
    }
  });

  test("each factory returns an independent copy that takes the id and name it is given", () => {
    const make = STARTER_WORLDS.fantasy_town as (id: string, name: string) => WorldDoc;
    const a = make("a", "A");
    const b = make("b", "B");
    expect([a.id, a.name, b.id, b.name]).toEqual(["a", "A", "b", "B"]);
    a.entities.pov = { ...(a.entities.pov as WorldDoc["entities"][string]), name: "changed" };
    expect(b.entities.pov?.name).not.toBe("changed");
  });
});

describe.each(IDS)("%s", (id) => {
  const world = worlds[id] as WorldDoc;
  const expected = EXPECTED[id] as (typeof EXPECTED)[string];

  test("the realism preset matches the template", () => {
    expect(world.realism.preset).toBe(expected.preset);
    expect(world.realism.levels).toEqual(REALISM_PRESETS[expected.preset].levels);
    const template = JSON.parse(readFileSync(new URL(`../../../data-src/templates/${id.replace(/_/g, "-")}.json`, import.meta.url), "utf8")) as { realism: { preset: string }; name: string };
    expect(world.realism.tierCaps).toEqual(REALISM_PRESETS[expected.preset].tierCaps);
    expect(template.realism.preset).toBe(expected.preset);
    expect(template.name.length).toBeGreaterThan(0);
  });

  test("the currency is set", () => {
    expect(world.currency.code).toBe(expected.currency);
    expect(world.currency.format).toContain("{amount}");
    expect(Number.isInteger(world.currency.decimals)).toBe(true);
  });

  test("every known_by track names a thing the player is linked as knowing, and stays hidden until then", () => {
    const linked = new Set<string>();
    const scan = (effects: readonly EffectSpec[] | undefined): void => {
      for (const e of effects ?? []) if (e.type === "link" && e.args.rel === "knows" && e.args.from === "pov" && typeof e.args.to === "string") linked.add(e.args.to);
    };
    for (const t of Object.values(world.tracks)) for (const s of Object.values(t.stages)) scan(s.effects);
    for (const r of Object.values(world.rules)) scan(r.do);
    const state = startState(world);
    for (const t of Object.values(world.tracks)) {
      if (t.visibility !== "known_by") continue;
      expect(t.owner, `${t.id} has no owner, so it never shows in Quests`).toBeDefined();
      expect(world.entities[t.owner ?? ""] ?? state.entities[t.owner ?? ""], `${t.id}'s owner exists`).toBeDefined();
      expect(linked.has(t.owner ?? ""), `${t.id}: nothing ever links the player as knowing ${t.owner}`).toBe(true);
      expect(playerTrack(registry, world, state, "pov", t.id), `${t.id} is hidden until the player comes to know ${t.owner}`).toBeNull();
    }
  });

  test("the template's lore is in the world as public cue text, linked to things that exist, with no secret truth", () => {
    const template = JSON.parse(readFileSync(new URL(`../../../data-src/templates/${id.replace(/_/g, "-")}.json`, import.meta.url), "utf8")) as {
      lore: { id: string; title: string; text: string; keys: string[] }[];
      tracks: { stages: Record<string, { leakTerms?: string[] }> }[];
    };
    expect(template.lore.length).toBeGreaterThan(15);
    expect(Object.keys(world.lore).sort()).toEqual(template.lore.map((l) => l.id).sort());
    const leaks = template.tracks.flatMap((t) => Object.values(t.stages).flatMap((s) => s.leakTerms ?? [])).map((s) => s.toLowerCase());
    expect(leaks.length).toBeGreaterThan(0);
    for (const l of template.lore) {
      const entry = world.lore[l.id];
      expect(entry?.title).toBe(l.title);
      expect(entry?.content).toBe(l.text);
      expect(entry?.keys).toEqual(l.keys);
      expect(entry?.secret).toBeUndefined();
      for (const link of entry?.links ?? []) expect(world.entities[link] ?? world.places[link]).toBeDefined();
      for (const term of leaks) expect(l.text.toLowerCase().includes(term)).toBe(false);
    }
  });

  test("a stocked container is sampled from the world's own item table when it is first opened", () => {
    const stocked = Object.values(world.entities).filter((e) => typeof e.fields.stock === "string");
    expect(stocked.length).toBeGreaterThanOrEqual(1);
    const rows = world.tables["gear.items"]?.rows ?? {};
    const defaults = defaultTables(ALL_PACKS)["gear.items"]?.rows ?? {};
    const template = JSON.parse(readFileSync(new URL(`../../../data-src/templates/${id.replace(/_/g, "-")}.json`, import.meta.url), "utf8")) as { gearItems?: { id: string; name: string }[] };
    if (template.gearItems) {
      // A world with its own era carries only its own items: no phones or LED bulbs in a chest at the inn.
      expect(Object.keys(rows).sort()).toEqual(template.gearItems.map((g) => g.id).sort());
      for (const g of template.gearItems) expect(String(rows[g.id]?.name)).toBe(g.name);
    } else {
      expect(Object.keys(rows).sort()).toEqual(Object.keys(defaults).sort());
    }
    for (const e of stocked) {
      const same = Object.values(rows).filter((r) => r.category === e.fields.stock);
      expect(same.length).toBeGreaterThanOrEqual(2);
    }
    // Opened at Gear 2 or more: two to four items appear inside, owned as the container is, drawn from that category.
    const raised = (STARTER_WORLDS[id] as (id: string, name: string) => WorldDoc)("w", id);
    raised.realism.levels.gear = 2;
    const w = new Working(registry, raised, startState(raised));
    for (const e of stocked) {
      const insideOf = () => Object.entries(w.state.entities).filter(([, x]) => x.relations.some((r) => r.type === "in" && r.to === e.id));
      const authored = new Set(insideOf().map(([entityId]) => entityId));
      materializeAll(registry, w, e.id, "stock");
      const sampled = insideOf().filter(([entityId]) => !authored.has(entityId));
      expect(sampled.length).toBeGreaterThanOrEqual(2);
      expect(sampled.length).toBeLessThanOrEqual(4);
      expect(w.state.entities[e.id]?.fields.sampled).toBe(true);
      for (const [, x] of sampled) {
        const row = rows[String(x.fields.catalog)];
        expect(row?.category).toBe(e.fields.stock);
        expect(x.fields.owner ?? null).toBe(e.fields.owner ?? null);
      }
    }
  });

  test("every default table is copied, re-hashed and pinned", () => {
    const defaults = defaultTables(ALL_PACKS);
    expect(Object.keys(world.tables).sort()).toEqual(Object.keys(defaults).sort());
    for (const [tableId, table] of Object.entries(world.tables)) {
      expect(table.revision).toBe(hashJson({ schema: table.schema, columns: table.columns, rows: table.rows } as unknown as JsonValue));
      expect(world.pins.tables[tableId]).toBe(table.revision);
    }
    expect(Object.keys(world.pins.generators).length).toBeGreaterThan(0);
  });

  test("every pack in the registry is listed with its version", () => {
    for (const pack of ALL_PACKS) expect(world.packs[pack.id]).toEqual({ version: pack.version, config: expect.any(Object) });
  });

  test("every formula compiles and names only things the engine can resolve", () => {
    const state = startState(world);
    const ctx = registry.context(world, state);
    const bad: string[] = [];
    let checked = 0;
    const check = (where: string, src: unknown, bindings: Record<string, string> = {}): void => {
      if (typeof src !== "string") return;
      checked++;
      const unknown = new Set<string>();
      try {
        runProgram(compile(src), scopeEnv({ reg: registry, ctx, bindings }), { unknown, all: true });
      } catch (e) {
        bad.push(`${where}: ${e instanceof Error ? e.message : "?"} in ${src}`);
        return;
      }
      for (const name of unknown) bad.push(`${where}: unknown ${name} in ${src}`);
    };
    const effects = (where: string, list: readonly EffectSpec[], bindings: Record<string, string>): void => {
      for (const [i, e] of list.entries()) for (const [key, value] of Object.entries(e.args)) if (typeof value === "string" && value.startsWith("=")) check(`${where}[${i}].${e.type}.${key}`, value.slice(1), bindings);
    };
    for (const rule of Object.values(world.rules)) {
      check(`rule ${rule.id}.when`, rule.when);
      if ("at" in rule.on) check(`rule ${rule.id}.on.at`, rule.on.at);
      effects(`rule ${rule.id}.do`, rule.do, {});
    }
    for (const action of Object.values(world.actions)) {
      const bindings: Record<string, string> = {};
      for (const [name, param] of Object.entries(action.params)) bindings[name] = Object.entries(state.entities).find(([, e]) => param.ref !== undefined && e.kind === param.ref)?.[0] ?? world.pov;
      check(`action ${action.id}.duration`, action.duration, bindings);
      for (const [i, r] of action.requires.entries()) check(`action ${action.id}.requires[${i}]`, r, bindings);
      for (const [outcome, list] of Object.entries(action.outcomes)) effects(`action ${action.id}.${outcome}`, list, bindings);
    }
    for (const [trackId, track] of Object.entries(world.tracks)) {
      for (const [stageId, stage] of Object.entries(track.stages ?? {})) {
        const where = `track ${trackId}.${stageId}`;
        for (const [i, n] of stage.next.entries()) check(`${where}.next[${i}]`, n.when);
        check(`${where}.gate`, stage.gate);
        check(`${where}.fail`, stage.fail?.when);
        for (const [i, o] of (stage.objectives ?? []).entries()) check(`${where}.objectives[${i}]`, objectiveWhen(o));
        effects(`${where}.effects`, stage.effects ?? [], {});
        effects(`${where}.rewards`, stage.rewards ?? [], {});
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBeGreaterThan(60);
  });

  test("eight days pass with the books balanced, no dropped events and no refused timelapse", () => {
    const w = new Working(registry, world, startState(world));
    for (const entityId of Object.keys(world.entities)) if (world.entities[entityId]?.kind === "character") materializeAll(registry, w, entityId, "smoke");
    expect(trialBalance(w.state)).toBe(0);
    const start = w.state.clock;
    const out = runTimelapse(registry, w, { type: "duration", minutes: 8 * 1440 }, { runSeed: "smoke", overrides: ALL_NOTE });
    expect("code" in out).toBe(false);
    expect(w.state.clock - start).toBe(8 * 1440);
    expect(trialBalance(w.state)).toBe(0);
    expect(w.dropped?.length ?? 0).toBe(0);
  });
});
