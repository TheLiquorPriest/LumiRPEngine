// The `knows`, `spawn` and `quantity` narration channels exist for every extraction type the
// settings list, and each is bounded: public facts only; capped, deduplicated spawns with a
// validated kind and place; quantity steps capped per field.
import { describe, expect, test } from "bun:test";
import { EXTRACTION_TYPES } from "../../src/shared/settings";
import { applyEffects } from "../../src/engine/effects";
import { SPAWN_CAP, spawnId } from "../../src/engine/narration-channels";
import { createRegistry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

function setup(): Working {
  const world = modernUsWorld("n", "R");
  return new Working(reg, world, startState(world));
}

/** The rejection code, or "ok" once the channel's effects applied cleanly. */
function propose(w: Working, type: string, p: Record<string, string | number>): string {
  const ch = reg.proposals.get(type);
  if (!ch) return "no_channel";
  const bad = ch.validate(p, w.ctx);
  if (bad) return bad.code;
  const out = applyEffects(reg, w, ch.toEffects(p, w.ctx), { bindings: {}, rng: createRng(`${type}:${JSON.stringify(p)}`) });
  return out.rejected[0]?.rejection.code ?? "ok";
}

const knowsOf = (w: Working, id: string): boolean => w.state.entities.you?.relations.some((r) => r.type === "knows" && r.to === id) ?? false;

describe("narration channels", () => {
  test("every extraction type but time_advance has a channel", () => {
    expect(EXTRACTION_TYPES.filter((t) => t !== "time_advance" && !reg.proposals.has(t))).toEqual([]);
  });

  test("knows: the player character learns a public person once and hears of a known_by place; never a secret or known_by person, a public or secret place, a track or secret lore", () => {
    const w = setup();
    expect(propose(w, "knows", { who: "you", fact: "rosa" })).toBe("ok");
    expect(knowsOf(w, "rosa")).toBe(true);
    expect(propose(w, "knows", { fact: "rosa" })).toBe("already_known");
    expect(propose(w, "knows", { who: "maya", fact: "jordan" })).toBe("not_pov");
    w.world.entities.jordan!.visibility = "secret";
    expect(propose(w, "knows", { fact: "jordan" })).toBe("not_public");
    w.state.entities.maya!.fields.visibility = "known_by";
    expect(propose(w, "knows", { fact: "maya" })).toBe("not_public");
    expect(propose(w, "knows", { fact: "park" })).toBe("already_known");
    w.world.places.lake!.visibility = "known_by";
    expect(propose(w, "knows", { fact: "lake" })).toBe("ok");
    expect(propose(w, "knows", { fact: "lake" })).toBe("already_known");
    w.world.places.trailhead!.visibility = "secret";
    expect(propose(w, "knows", { fact: "trailhead" })).toBe("not_public");
    expect(propose(w, "knows", { fact: "first_week" })).toBe("not_public");
    w.world.lore.ledger = { id: "ledger", title: "The second ledger", content: "cue", keys: [], links: [], secret: true, gate: "stage.first_week == 'done'" };
    expect(propose(w, "knows", { fact: "ledger" })).toBe("not_public");
    expect(propose(w, "knows", { fact: "the moon is made of cheese" })).toBe("unknown_fact");
    expect(knowsOf(w, "jordan") || knowsOf(w, "maya") || knowsOf(w, "trailhead")).toBe(false);
    expect(knowsOf(w, "lake")).toBe(true);
  });

  test("spawn: a named character at a real place, known to the player, deduplicated, validated and capped", () => {
    const w = setup();
    expect(propose(w, "spawn", { kind: "person", name: "Ellie Park", role: "barista" })).toBe("ok");
    const ellie = w.state.entities[spawnId("Ellie Park")];
    expect(ellie?.name).toBe("Ellie Park");
    expect(ellie?.tier).toBe("background");
    expect(ellie?.fields.place).toBe("apartment");
    expect(ellie?.fields.role).toBe("barista");
    expect(knowsOf(w, spawnId("Ellie Park"))).toBe(true);
    expect(propose(w, "spawn", { kind: "person", name: "ellie park" })).toBe("duplicate");
    expect(propose(w, "spawn", { kind: "person", name: w.state.entities.maya!.name })).toBe("duplicate");
    expect(propose(w, "spawn", { kind: "dragon", name: "Smaug" })).toBe("missing_kind");
    expect(propose(w, "spawn", { kind: "account", name: "Secret Fund" })).toBe("not_a_character");
    expect(propose(w, "spawn", { kind: "person", name: "Wanderer", place: "atlantis" })).toBe("missing_place");
    expect(propose(w, "spawn", { kind: "person", name: "{{char}}" })).toBe("bad_name");
    expect(propose(w, "spawn", { kind: "person", name: "x".repeat(61) })).toBe("bad_name");
    expect(propose(w, "spawn", { kind: "person", name: "Dock Hand", place: "lake" })).toBe("ok");
    expect(w.state.entities[spawnId("Dock Hand")]?.fields.place).toBe("lake");
    for (let i = 2; i < SPAWN_CAP; i++) expect(propose(w, "spawn", { kind: "person", name: `Extra ${i}` })).toBe("ok");
    expect(propose(w, "spawn", { kind: "person", name: "One Too Many" })).toBe("spawn_cap");
  });

  test("quantity: whole steps on an item its holder has, capped by the field's bound", () => {
    const w = setup();
    expect(propose(w, "quantity", { entity: "you", item: "phone", delta: 2 })).toBe("ok");
    expect(w.state.entities.phone?.fields.qty).toBe(3);
    expect(propose(w, "quantity", { entity: "you", item: "phone", delta: 50 })).toBe("over_bound");
    expect(propose(w, "quantity", { entity: "you", item: "phone", delta: 1.5 })).toBe("bad_proposal");
    expect(propose(w, "quantity", { entity: "you", item: "phone", delta: 0 })).toBe("bad_proposal");
    expect(propose(w, "quantity", { entity: "maya", item: "phone", delta: 1 })).toBe("not_holder");
    expect(propose(w, "quantity", { entity: "you", item: "maya", delta: 1 })).toBe("missing_entity");
    expect(propose(w, "quantity", { entity: "you", item: "phone", delta: -10 })).toBe("ok");
    expect(w.state.entities.phone?.fields.qty).toBe(0);
  });
});
