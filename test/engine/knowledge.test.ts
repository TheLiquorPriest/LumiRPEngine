// What the player layer may know (DESIGN §7): people and places the POV can see, through `knows`
// relations, `knownBy` selectors and its own observations (`space.seen`).

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import type { WorldDoc } from "../../src/shared/world";
import { applyEffects } from "../../src/engine/effects";
import { ENGINE_EVENTS } from "../../src/engine/engine-pack";
import { paramCandidates } from "../../src/engine/resolve";
import { createRegistry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { lastSighting, placeVisit } from "../../src/engine/seen";
import { ALL_NOTE, coarsen } from "../../src/engine/simulate";
import { runTimelapse } from "../../src/engine/time";
import { canSeeEntity, canSeeField, canSeePlace, eventVisible, playerTrack } from "../../src/engine/visibility";
import { lintStructure } from "../../src/engine/world-lint";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { fold, startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

function riverton(patch: (world: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("k", "Riverton");
  // Someone the player can't see, standing in the player's apartment.
  world.entities.lurker = { id: "lurker", kind: "person", name: "The Lurker", tier: "background", fields: { place: "apartment" }, relations: [], visibility: "secret" };
  world.entities.stranger = { id: "stranger", kind: "person", name: "Quiet Stranger", tier: "background", fields: { place: "apartment" }, relations: [], visibility: "known_by" };
  world.entities.maya!.fields.place = "apartment";
  patch(world);
  return new Working(reg, world, startState(world));
}

describe("palette targets", () => {
  test("a secret or unknown person at the player's place is never a target", () => {
    const w = riverton();
    const chat = reg.actions.get("chat_with");
    if (!chat) throw new Error("no chat_with");
    expect(paramCandidates(reg, w.world, w.state, chat, "target")).toEqual(["maya"]);
    w.apply({ type: "link", rel: "knows", from: "you", to: "stranger" });
    expect(paramCandidates(reg, w.world, w.state, chat, "target")).toEqual(["maya", "stranger"]);
  });
});

/** The Night Watch: a group whose members know its informant, his codename, its safehouse and its orders. */
function watch(world: WorldDoc): void {
  const members = { memberOf: ["night_watch"] };
  world.entities.night_watch = { id: "night_watch", kind: "faction", name: "The Night Watch", tier: "background", fields: {}, relations: [] };
  world.kinds.watcher = { id: "watcher", label: "Watcher", extends: "person", fields: { codename: { type: "text", visibility: "known_by", knownBy: members } } };
  world.entities.informant = { id: "informant", kind: "watcher", name: "Ned Fisk", tier: "background", fields: { place: "cafe", codename: "Magpie" }, relations: [], visibility: "known_by", knownBy: members };
  world.places.safehouse = { id: "safehouse", name: "The safehouse", parent: "riverton", fields: {}, visibility: "known_by", knownBy: members };
  world.tracks.orders = { id: "orders", kind: "quest", label: "Watch orders", start: "brief", visibility: "known_by", knownBy: members, stages: { brief: { label: "Briefing", cue: "Meet Magpie at the safehouse.", next: [] } } };
}

describe("knownBy selectors", () => {
  test("matching a known_by subject's selector is knowing it, as a knows relation is", () => {
    const w = riverton(watch);
    const seen = () => ({
      entity: canSeeEntity(reg, w.world, w.state, "you", "informant"),
      field: canSeeField(reg, w.world, w.state, "you", "informant", "codename"),
      place: canSeePlace(reg, w.world, w.state, "you", "safehouse"),
      track: playerTrack(reg, w.world, w.state, "you", "orders") !== null,
    });
    expect(seen()).toEqual({ entity: false, field: false, place: false, track: false });
    w.apply({ type: "link", rel: "member_of", from: "you", to: "night_watch" });
    expect(seen()).toEqual({ entity: true, field: true, place: true, track: true });
    const go = reg.actions.get("go");
    expect(go ? paramCandidates(reg, w.world, w.state, go, "to") : []).toContain("safehouse");
  });

  test("a selector the engine can't read fully, or one with no constraint, grants nobody", () => {
    const w = riverton(watch);
    w.apply({ type: "link", rel: "member_of", from: "you", to: "night_watch" });
    const informant = w.world.entities.informant!;
    for (const knownBy of [{ memberOf: ["night_watch"], rank: ["captain"] }, {}, { memberOf: "night_watch" }, { class: {} }]) {
      Object.assign(informant, { knownBy });
      expect(canSeeEntity(reg, w.world, w.state, "you", "informant")).toBe(false);
    }
    const issues = lintStructure(w.world, reg).filter((i) => i.path === "entities.informant.knownBy");
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });

  test("a visibility value the engine doesn't know hides its subject, even from someone who knows it", () => {
    const w = riverton((world) => {
      world.entities.rosa!.visibility = "hidden" as "secret";
    });
    w.apply({ type: "link", rel: "knows", from: "you", to: "rosa" });
    expect(canSeeEntity(reg, w.world, w.state, "you", "rosa")).toBe(false);
    expect(eventVisible(reg, w.world, w.state, "you", { type: "engine.signal", data: { class: "quest", text: "A sign", visibility: "discoverable" } })).toBe(false);
    expect(lintStructure(w.world, reg).some((i) => i.path === "entities.rosa.visibility" && i.severity === "error")).toBe(true);
  });
});


describe("space.seen: where the POV has been and whom it saw", () => {
  const move = (w: Working, entity: string, to: string) => applyEffects(reg, w, [{ type: "move", args: { entity, to } }], { bindings: {}, rng: createRng(`${entity}:${to}`) });

  test("a move records the places left and reached, and who parted and who met, at that clock", () => {
    const w = riverton();
    const t0 = w.state.clock;
    // The start counts as a visit, to the place and the places around it.
    expect(placeVisit(w.state, "apartment")).toEqual({ first: t0, last: t0 });
    expect(placeVisit(w.state, "riverton")).toEqual({ first: t0, last: t0 });
    expect(placeVisit(w.state, "cafe")).toBeNull();
    w.apply({ type: "clock", minutes: 30, cause: "advance" });
    move(w, "you", "cafe");
    expect(placeVisit(w.state, "apartment")).toEqual({ first: t0, last: t0 + 30 });
    expect(placeVisit(w.state, "cafe")).toEqual({ first: t0 + 30, last: t0 + 30 });
    // Maya stayed behind; the secret and the unknown person were never seen.
    expect(lastSighting(w.state, "maya")).toEqual({ place: "apartment", at: t0 + 30 });
    expect(lastSighting(w.state, "lurker")).toBeNull();
    expect(lastSighting(w.state, "stranger")).toBeNull();
    move(w, "jordan", "cafe");
    w.apply({ type: "spawn", entity: { id: "npc_ellie", kind: "person", name: "Ellie", tier: "background", fields: { place: "cafe" }, relations: [] } });
    w.apply({ type: "clock", minutes: 15, cause: "advance" });
    move(w, "jordan", "office");
    expect(lastSighting(w.state, "jordan")).toEqual({ place: "cafe", at: t0 + 45 });
    expect(lastSighting(w.state, "npc_ellie")).toEqual({ place: "cafe", at: t0 + 30 });
    // Replaying the events rebuilds the same record.
    expect(hashJson(fold(reg, w.world, startState(w.world), w.events))).toBe(hashJson(w.state));
  });

  test("a coarsened Timelapse keeps what the POV saw on the way, and still folds exactly", () => {
    const w = riverton();
    const s0 = structuredClone(w.state);
    const out = runTimelapse(reg, w, { type: "duration", minutes: 2 * 1440 }, { runSeed: "seen", overrides: ALL_NOTE });
    if ("code" in out) throw new Error(out.reason);
    const coarse = coarsen(reg, w.world, s0, w.events);
    expect(coarse.length).toBeLessThan(w.events.length);
    expect(coarse.some((e) => e.type === ENGINE_EVENTS.observed)).toBe(true);
    const folded = fold(reg, w.world, s0, coarse);
    expect(hashJson(folded)).toBe(hashJson(w.state));
    expect(lastSighting(folded, "maya")).toEqual(lastSighting(w.state, "maya"));
  });

  test("from Space 3, the POV arriving at a place with a cell stands on it; others keep theirs", () => {
    const w = riverton((world) => {
      world.realism.levels.space = 3;
      world.places.cafe!.cell = { x: 3, y: 4 };
      world.entities.you!.fields.x = 9;
      world.entities.you!.fields.y = 9;
    });
    move(w, "you", "cafe");
    expect([w.state.entities.you?.fields.x, w.state.entities.you?.fields.y]).toEqual([3, 4]);
    move(w, "rosa", "cafe");
    expect(w.state.entities.rosa?.fields.x).toBeUndefined();
  });
});