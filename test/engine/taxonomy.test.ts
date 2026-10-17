// Classifications, groups, kinship and selectors end to end on the shipped packs: lint, the
// taxonomy formulas, spawned classes and tags, two-sided kinship and relation constraints,
// schedule precedence and overlaps, param selectors, and group regard.

import { describe, expect, test } from "bun:test";
import { lintWorld } from "../../src/engine/authoring";
import { applyEffects } from "../../src/engine/effects";
import { createRegistry } from "../../src/engine/registry-impl";
import { actionOdds, paramCandidates } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { allSchedules, instantEvents, scheduleInstants, scheduleOverlaps } from "../../src/engine/schedules";
import { evalExpr, scopeEnv } from "../../src/engine/scope";
import { selectEntities } from "../../src/engine/selector";
import { Working } from "../../src/engine/working";
import type { EntityDef, WorldDoc } from "../../src/shared/world";
import { ALL_PACKS } from "../../src/packs/index";
import { baseWorld, POV, startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

function person(id: string, name: string, patch: Partial<EntityDef> = {}): EntityDef {
  return { id, kind: "person", name, tier: "supporting", fields: { place: "home", home: "home" }, relations: [], ...patch };
}

/** Sam, Dev and Mara; Dev and Mara in the Harlow household, which is in the Harlow family. */
function world(patch: Partial<WorldDoc> = {}): WorldDoc {
  const base = baseWorld();
  return baseWorld({
    classifications: {
      role: { id: "role", label: "Story role", multiple: false, values: { ally: { label: "Ally" }, antagonist: { label: "Antagonist" }, villain: { label: "Villain", parent: "antagonist" } } },
    },
    entities: {
      ...base.entities,
      dev: { ...person("dev", "Dev", { class: { role: ["villain"] }, tags: ["smuggler"] }), relations: [{ type: "member_of", to: "harlow_home", fields: { role: "uncle" } }, { type: "regard", to: POV, fields: { warmth: 40, trust: 40, respect: 40 } }] },
      mara: { ...person("mara", "Mara", { class: { role: ["ally"] } }), relations: [{ type: "member_of", to: "harlow_home" }, { type: "regard", to: POV, fields: { warmth: 20, trust: 20, respect: 20 } }] },
      harlow_home: { id: "harlow_home", kind: "household", name: "Harlow household", tier: "background", fields: {}, relations: [{ type: "member_of", to: "harlows" }] },
      harlows: { id: "harlows", kind: "family", name: "The Harlows", tier: "background", fields: {}, relations: [] },
    },
    ...patch,
  });
}

const evalIn = (w: WorldDoc, src: string) => evalExpr(src, scopeEnv({ reg, ctx: reg.context(w, startState(w, reg)) }), null);

describe("classifications", () => {
  test("lint: unknown facets and values, several values on a single facet, parent cycles and unknown parents", () => {
    const w = world();
    w.classifications.loop = { id: "loop", label: "Loop", multiple: true, values: { a: { label: "A", parent: "b" }, b: { label: "B", parent: "a" }, c: { label: "C", parent: "nope" } } };
    w.entities.dev = { ...w.entities.dev!, class: { role: ["ally", "villain"], mood: ["grim"] } };
    w.entities.mara = { ...w.entities.mara!, class: { role: ["hero"] } };
    const codes = lintWorld(w, reg).map((i) => `${i.path} ${i.code}`);
    expect(codes).toEqual(expect.arrayContaining(["entities.dev.class single_class", "entities.dev.class unknown_facet", "entities.mara.class unknown_class", "classifications.loop.values.a.parent cycles", "classifications.loop.values.c.parent refs"]));
    expect(lintWorld(world(), reg).filter((i) => i.severity === "error")).toEqual([]);
  });

  test("formulas: kind_is, in_class (nested), has_tag, member_of (through groups), tier_of, band_of", () => {
    const w = world();
    expect(evalIn(w, "kind_is(dev, 'person') and kind_is(harlows, 'group') and not kind_is(dev, 'group')")).toBe(true);
    expect(evalIn(w, "in_class(dev, 'role', 'antagonist') and not in_class(mara, 'role', 'antagonist')")).toBe(true);
    expect(evalIn(w, "has_tag(dev, 'smuggler') and not has_tag(mara, 'smuggler')")).toBe(true);
    expect(evalIn(w, "member_of(dev, harlows) and member_of(dev, harlow_home) and not member_of(sam, harlows)")).toBe(true);
    expect(evalIn(w, "tier_of(dev)")).toBe("supporting");
    expect(evalIn(w, "band_of(sam)")).toBe("principal");
  });

  test("a spawned entity keeps its class and tags in state, and selectors match them", () => {
    const w = world();
    const work = new Working(reg, w, startState(w, reg));
    const out = applyEffects(reg, work, [{ type: "spawn", args: { id: "npc_fen", kind: "person", name: "Fen", class: { role: "villain" }, tags: ["smuggler"] } }], { bindings: {}, rng: createRng("s") });
    expect(out.rejected).toEqual([]);
    expect(selectEntities(reg, w, work.state, { class: { role: ["antagonist"] }, tag: ["smuggler"] })).toEqual(["dev", "npc_fen"]);
    const bad = applyEffects(reg, work, [{ type: "spawn", args: { id: "npc_bad", kind: "person", name: "Bad", class: { role: ["nobody"] } } }], { bindings: {}, rng: createRng("t") });
    expect(bad.rejected[0]?.rejection.code).toBe("unknown_class");
  });
});

describe("kinship and relation integrity", () => {
  test("link writes the inverse in the same group and unlink removes it; a symmetric link is two-sided", () => {
    const w = world();
    const work = new Working(reg, w, startState(w, reg));
    const linked = applyEffects(reg, work, [{ type: "link", args: { rel: "parent_of", from: "dev", to: "mara" } }], { bindings: {}, rng: createRng("l") });
    expect(linked.applied.map((e) => (e.type === "link" ? `${e.from} ${e.rel} ${e.to}` : e.type))).toEqual(["dev parent_of mara", "mara child_of dev"]);
    expect(new Set(linked.applied.map((e) => e.group)).size).toBe(1);
    applyEffects(reg, work, [{ type: "link", args: { rel: "sibling_of", from: POV, to: "dev" } }], { bindings: {}, rng: createRng("m") });
    expect(work.state.entities.dev?.relations.some((r) => r.type === "sibling_of" && r.to === POV)).toBe(true);
    applyEffects(reg, work, [{ type: "unlink", args: { rel: "child_of", from: "mara", to: "dev" } }], { bindings: {}, rng: createRng("u") });
    expect(work.state.entities.dev?.relations.some((r) => r.type === "parent_of")).toBe(false);
    expect(work.state.entities.mara?.relations.some((r) => r.type === "child_of")).toBe(false);
  });

  test("a one-sided authored kinship link is completed in the start state, with a warning naming the missing side", () => {
    const w = world();
    w.entities.mara = { ...w.entities.mara!, relations: [...w.entities.mara!.relations, { type: "spouse_of", to: "dev" }] };
    expect(startState(w, reg).entities.dev?.relations.some((r) => r.type === "spouse_of" && r.to === "mara")).toBe(true);
    const warning = lintWorld(w, reg).find((i) => i.code === "one_sided");
    expect(warning?.path).toBe("entities.mara.relations");
    expect(warning?.message).toContain("Dev has no “Spouse of” link back to Mara");
  });

  test("cardinality and kinds: the effect refuses with a reason, and authored breaches are lint errors", () => {
    const w = world({ relations: { betrothed_to: { id: "betrothed_to", label: "Betrothed to", from: "person", to: "person", cardinality: "one_one", symmetric: true, fields: {} } } });
    const work = new Working(reg, w, startState(w, reg));
    expect(applyEffects(reg, work, [{ type: "link", args: { rel: "betrothed_to", from: "dev", to: "mara" } }], { bindings: {}, rng: createRng("a") }).rejected).toEqual([]);
    const second = applyEffects(reg, work, [{ type: "link", args: { rel: "betrothed_to", from: POV, to: "mara" } }], { bindings: {}, rng: createRng("b") });
    expect(second.rejected[0]?.rejection).toMatchObject({ code: "cardinality" });
    expect(second.rejected[0]?.rejection.reason).toContain("Dev is already betrothed to Mara");
    const wrongKind = applyEffects(reg, work, [{ type: "link", args: { rel: "member_of", from: "dev", to: "mara" } }], { bindings: {}, rng: createRng("c") });
    expect(wrongKind.rejected[0]?.rejection.code).toBe("relation_kind");
    w.entities.dev = { ...w.entities.dev!, relations: [...w.entities.dev!.relations, { type: "betrothed_to", to: "mara" }, { type: "betrothed_to", to: POV }] };
    expect(lintWorld(w, reg).some((i) => i.code === "cardinality" && i.severity === "error")).toBe(true);
  });
});

describe("group schedules and selectors", () => {
  test("precedence: the entity's own schedule, then its group's, then its kind's; a field returns to the slot still running", () => {
    const w = world({
      schedules: {
        days: { id: "days", owner: "person", target: "place", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "21:00", value: "cafe" }] },
        dinner: { id: "dinner", owner: "harlows", target: "place", recurrence: { every: "day" }, slots: [{ start: "18:00", end: "19:00", value: "home" }] },
        late: { id: "late", owner: "dev", target: "place", recurrence: { every: "day" }, slots: [{ start: "17:00", end: "22:00", value: "cafe" }] },
      },
    });
    const work = new Working(reg, w, startState(w, reg));
    const moves: string[] = [];
    for (const inst of scheduleInstants(w, allSchedules(reg, w), work.state.clock, work.state.clock + 15 * 60)) {
      for (const ev of instantEvents(reg, work.ctx, inst, "seed")) {
        if (ev.type === "set" && ev.entity !== POV) moves.push(`${ev.entity}:${String(ev.value)}`);
        work.apply(ev);
      }
    }
    expect(moves).toEqual(["dev:cafe", "mara:cafe", "mara:home", "mara:cafe", "mara:home", "dev:home"]);
  });

  test("overlap lint: two schedules for the same people and field at the same precedence", () => {
    const w = world({
      schedules: {
        a: { id: "a", owner: "harlows", target: "activity", recurrence: { every: "week", weekdays: [1, 2, 3] }, slots: [{ start: "18:00", end: "19:00", value: "dinner" }] },
        b: { id: "b", owner: "harlows", target: "activity", recurrence: { every: "week", weekdays: [3] }, slots: [{ start: "18:30", end: "20:00", value: "chores" }] },
        c: { id: "c", owner: "dev", target: "activity", recurrence: { every: "day" }, slots: [{ start: "18:00", end: "20:00", value: "work" }] },
      },
    });
    expect(scheduleOverlaps(reg, w).map((i) => i.path)).toEqual(["schedules.b"]);
  });

  test("a param's selector filters the candidates and the resolver refuses others", () => {
    const w = world({ actions: { confide: { id: "confide", label: "Confide in", params: { target: { type: "ref", ref: "person", of: { class: { role: ["ally"] } } } }, requires: [], outcomes: { default: [] }, duration: "5" } } });
    w.entities.dev = { ...w.entities.dev!, fields: { place: "home", home: "home" } };
    const s = startState(w, reg);
    const action = w.actions.confide!;
    expect(paramCandidates(reg, w, s, action, "target")).toEqual(["mara"]);
    expect(actionOdds(reg, w, s, { action, params: { target: "dev" } }).failed?.code).toBe("bad_param");
    expect(actionOdds(reg, w, s, { action, params: { target: "mara" } }).available).toBe(true);
  });

  test("group regard over a family: the members' mean, through the household", () => {
    expect(evalIn(world(), "faction_regard(harlows, sam)")).toBe(30);
  });
});
