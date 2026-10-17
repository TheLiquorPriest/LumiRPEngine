import { describe, expect, test } from "bun:test";
import { boundProposal, combineBounds, strictest } from "../../src/engine/bounds";
import { buildGmWorld } from "../../src/engine/gm-view";
import { isMaterialized, materializeIfNeeded, pinnedVersion, previewMaterialization } from "../../src/engine/materialize";
import type { PackDef } from "../../src/engine/registry";
import { canSeeEntity, canSeeField, eventVisible, findLeaks, playerTrack } from "../../src/engine/visibility";
import { Working } from "../../src/engine/working";
import { outline } from "../../src/engine/beats";
import { createRng } from "../../src/engine/rng";
import { baseWorld, POV, registryOf, startState } from "../packs/support";
import type { LedgerEvent } from "../../src/shared/ledger";

describe("visibility", () => {
  test("public, known_by through knows relations, and secret", () => {
    const world = baseWorld();
    world.entities.spy = { id: "spy", kind: "person", name: "Spy", tier: "supporting", fields: { place: "cafe", secret_note: "works for the rival" }, relations: [], visibility: "known_by" };
    world.entities.ghost = { id: "ghost", kind: "person", name: "Ghost", tier: "background", fields: {}, relations: [], visibility: "secret" };
    const reg = registryOf();
    const s = startState(world);
    expect(canSeeEntity(reg, world, s, POV, "dev")).toBe(true);
    expect(canSeeEntity(reg, world, s, POV, "spy")).toBe(false);
    expect(canSeeEntity(reg, world, s, POV, "ghost")).toBe(false);
    s.entities[POV]!.relations.push({ type: "knows", to: "spy" });
    expect(canSeeEntity(reg, world, s, POV, "spy")).toBe(true);
    expect(canSeeField(reg, world, s, POV, "spy", "secret_note")).toBe(false);
    expect(eventVisible(reg, world, s, POV, { type: "set", entity: "spy", field: "secret_note", value: "x" })).toBe(false);
    expect(eventVisible(reg, world, s, POV, { type: "add", entity: "dev", field: "cash", delta: 1 })).toBe(true);
    expect(eventVisible(reg, world, s, POV, { type: "engine.note", data: { text: "gm", visibility: "secret" } })).toBe(false);
    expect(findLeaks({ a: ["Works for the RIVAL!"] }, ["works for the rival"])).toEqual(["Works for the RIVAL!"]);
  });

  test("the GM view sees everything: secret people and every track's truths; it is no panel the state pushes", () => {
    const world = baseWorld();
    world.tracks.t = { id: "t", kind: "secret", label: "T", start: "a", visibility: "secret", stages: { a: { label: "A", truth: "the truth", next: [] } } };
    world.entities.ghost = { id: "ghost", kind: "person", name: "Ghost", tier: "background", fields: {}, relations: [], visibility: "secret" };
    const reg = registryOf();
    const view = buildGmWorld(reg, world, startState(world));
    expect(view.tracks.find((t) => t.id === "t")?.stages.map((s) => s.truth)).toEqual(["the truth"]);
    expect(view.entities.find((e) => e.id === "ghost")?.visibility).toBe("secret");
    expect(reg.views.some((v) => v.panel === "core.gm")).toBe(false);
  });

  test("a quest waiting on a bare start stage is dormant; once it moves on, and when done, it shows", () => {
    const world = baseWorld();
    world.tracks.storm = {
      id: "storm",
      kind: "quest",
      label: "Cut off",
      start: "before",
      visibility: "public",
      stages: { before: { label: "Before", next: [{ to: "cut", when: "flag('storm')" }] }, cut: { label: "No telephone", cue: "The line is dead.", next: [{ to: "done", when: "flag('fixed')" }] }, done: { label: "Help is coming", next: [] } },
    };
    const reg = registryOf();
    const s = startState(world);
    expect(playerTrack(reg, world, s, POV, "storm")).toBeNull();
    s.tracks.storm = { stage: "cut", since: 0 };
    expect(playerTrack(reg, world, s, POV, "storm")?.cue).toBe("The line is dead.");
    s.tracks.storm = { stage: "done", since: 0 };
    expect(playerTrack(reg, world, s, POV, "storm")?.status).toBe("done");
  });
});

describe("bounds", () => {
  test("the most restrictive mode and the smallest max delta win", () => {
    expect(strictest("auto", "confirm", undefined)).toBe("confirm");
    expect(strictest("confirm", "never")).toBe("never");
    expect(combineBounds({ mode: "auto", maxDelta: 20 }, { mode: "confirm", maxDelta: -5 }, undefined)).toEqual({ mode: "confirm", maxDelta: 5 });
  });

  test("a proposal is capped by field, type and channel bounds and the field's range; locked fields are never", () => {
    const world = baseWorld();
    world.kinds.person!.fields.stress = { ...world.kinds.person!.fields.stress!, bound: { mode: "auto", maxDelta: 30 } };
    world.kinds.person!.fields.skill = { type: "number", locked: true };
    const reg = registryOf();
    const s = startState(world);
    const b = boundProposal(reg, world, s, { type: "condition", entity: POV, field: "stress", delta: 50 }, { typeMode: "auto", channelCap: 20 });
    expect([b.mode, b.delta, b.capped]).toEqual(["auto", 20, true]);
    const range = boundProposal(reg, world, s, { type: "condition", entity: POV, field: "stress", delta: -10 }, { typeMode: "confirm" });
    expect([range.mode, range.delta, range.capped]).toEqual(["confirm", 0, true]);
    expect(boundProposal(reg, world, s, { type: "quantity", entity: POV, field: "skill", delta: 1 }, { typeMode: "auto" }).mode).toBe("never");
  });
});

describe("materialization", () => {
  const pack = (version: number): PackDef => ({
    id: "detail",
    label: "Detail",
    version: 1,
    domain: "money",
    requires: [],
    register(r) {
      r.materializer({
        domain: "money",
        version,
        // Samples within the current representation: the entity's stress band bounds the draw.
        materialize: (entity, ctx, rng) => {
          const stress = ctx.state.entities[entity]?.fields.stress;
          const lo = typeof stress === "number" && stress >= 50 ? 50 : 0;
          return [{ type: "set", entity, field: "skill", value: lo + rng.int(0, 49) }];
        },
      });
    },
  });

  test("seeded by (runSeed, entity, domain): previews equal the recorded detail and record nothing", () => {
    const world = baseWorld();
    const reg = registryOf([pack(1)]);
    const s = startState(world);
    const preview = previewMaterialization(reg, world, s, "dev", "money", "run");
    const w = new Working(reg, world, s);
    const ev = materializeIfNeeded(reg, w, "dev", "money", "run");
    expect(ev?.events).toEqual(preview);
    expect(isMaterialized(s, "dev", "money")).toBe(false);
    expect(isMaterialized(w.state, "dev", "money")).toBe(true);
    expect(materializeIfNeeded(reg, w, "dev", "money", "run")).toBeNull();
  });

  test("detail lands inside the current representation", () => {
    const world = baseWorld();
    world.entities.dev!.fields.stress = 80;
    const reg = registryOf([pack(1)]);
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const v = previewMaterialization(reg, world, startState(world), "dev", "money", seed)[0];
      expect(v?.type === "set" && typeof v.value === "number" && v.value >= 50).toBe(true);
    }
  });

  test("a pinned generator version the build doesn't carry is refused", () => {
    const world = baseWorld();
    world.pins.generators.money = 1;
    expect(typeof pinnedVersion(world, registryOf([pack(1)]), "money")).toBe("number");
    expect(typeof pinnedVersion(world, registryOf([pack(2)]), "money")).toBe("object");
  });
});

describe("beats", () => {
  test("the outline is deterministic and never shows secret signals", () => {
    const world = baseWorld();
    const reg = registryOf();
    const s = startState(world);
    const events: LedgerEvent[] = [
      { type: "engine.beat" as const, data: { hint: "A stranger watches.", weight: 1 } },
      { type: "engine.beat" as const, data: { hint: "The radio crackles.", weight: 3 } },
      { type: "engine.beat" as const, data: { hint: "Rain begins.", weight: 1 } },
      { type: "engine.signal" as const, data: { class: "incident", text: "secret plot", visibility: "secret" } },
    ];
    const a = outline(reg, world, s, { events }, createRng("x"));
    expect(a).toEqual(outline(reg, world, s, { events }, createRng("x")));
    expect(a.filter((l) => ["A stranger watches.", "The radio crackles.", "Rain begins."].includes(l))).toHaveLength(2);
    expect(a.join(" ")).not.toContain("secret plot");
  });
});
