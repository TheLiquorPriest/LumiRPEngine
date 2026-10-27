// The `knows`, `spawn` and `quantity` narration channels exist for every extraction type the
// settings list, and each is bounded: public facts only; capped, deduplicated spawns with a
// validated kind and place; quantity steps of any size the story tells, kept in the field's range.
import { describe, expect, test } from "bun:test";
import { EXTRACTION_TYPES } from "../../src/shared/settings";
import { applyEffects } from "../../src/engine/effects";
import { DEFAULT_SPAWN_CAP } from "../../src/shared/world";
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

/** What a decline chip would say of a refusal: its code and reason, never the GM's. */
function refusal(w: Working, type: string, p: Record<string, string>): { code: string; reason: string } | null {
  const bad = reg.proposals.get(type)?.validate(p, w.ctx);
  return bad ? { code: bad.code, reason: bad.reason } : null;
}

/** The id of the character a reply introduced by `name`, if one was. */
const newcomer = (w: Working, name: string): string | undefined => Object.keys(w.state.entities).find((id) => w.state.entities[id]?.name === name && w.state.entities[id]?.fields.spawned === "narration");

describe("narration channels", () => {
  test("every extraction type but time_advance has a channel", () => {
    expect(EXTRACTION_TYPES.filter((t) => t !== "time_advance" && !reg.proposals.has(t))).toEqual([]);
  });

  test("knows: the player character learns a public person once and hears of a known_by place; never a known_by person it knows, a public place, a track or gated lore", () => {
    const w = setup();
    expect(propose(w, "knows", { who: "you", fact: "rosa" })).toBe("ok");
    expect(knowsOf(w, "rosa")).toBe(true);
    expect(propose(w, "knows", { fact: "rosa" })).toBe("already_known");
    expect(propose(w, "knows", { who: "maya", fact: "jordan" })).toBe("not_pov");
    w.state.entities.maya!.fields.visibility = "known_by";
    w.state.entities.you!.relations.push({ type: "knows", to: "maya" });
    expect(propose(w, "knows", { fact: "maya" })).toBe("not_public");
    expect(propose(w, "knows", { fact: "park" })).toBe("already_known");
    w.world.places.lake!.visibility = "known_by";
    expect(propose(w, "knows", { fact: "lake" })).toBe("ok");
    expect(propose(w, "knows", { fact: "lake" })).toBe("already_known");
    expect(propose(w, "knows", { fact: "first_week" })).toBe("not_public");
    w.world.lore.notes = { id: "notes", title: "The shop's notes", content: "cue", keys: [], links: [], gate: "stage.first_week == 'done'" };
    expect(propose(w, "knows", { fact: "notes" })).toBe("not_public");
    expect(propose(w, "knows", { fact: "the moon is made of cheese" })).toBe("unknown_fact");
    expect(knowsOf(w, "lake")).toBe(true);
  });

  test("knows: whatever the POV may not know of is refused in the words of a fact no world has, so no refusal tells it exists", () => {
    const w = setup();
    const none = (said: string) => ({ code: "unknown_fact", reason: `no world fact ${said}` });
    expect(refusal(w, "knows", { fact: "Old Quarry ledger" })).toEqual(none("Old Quarry ledger"));
    w.world.entities.jordan!.visibility = "secret";
    expect(refusal(w, "knows", { fact: "jordan" })).toEqual(none("jordan"));
    w.state.entities.maya!.fields.visibility = "known_by";
    expect(refusal(w, "knows", { fact: "maya" })).toEqual(none("maya"));
    w.world.places.trailhead!.visibility = "secret";
    expect(refusal(w, "knows", { fact: "trailhead" })).toEqual(none("trailhead"));
    // By its name, as a reply would call it.
    expect(refusal(w, "knows", { fact: "Old Quarry trailhead" })).toEqual(none("Old Quarry trailhead"));
    w.world.lore.ledger = { id: "ledger", title: "The second ledger", content: "cue", keys: [], links: [], secret: true, gate: "stage.first_week == 'done'" };
    expect(refusal(w, "knows", { fact: "ledger" })).toEqual(none("ledger"));
    w.world.tracks.first_week!.visibility = "secret";
    expect(refusal(w, "knows", { fact: "first_week" })).toEqual(none("first week"));
    expect(knowsOf(w, "jordan") || knowsOf(w, "maya") || knowsOf(w, "trailhead")).toBe(false);
  });

  test("spawn: a named character at a real place, known to the player, deduplicated, validated and capped", () => {
    const w = setup();
    expect(propose(w, "spawn", { kind: "person", name: "Ellie Park", role: "barista" })).toBe("ok");
    const ellieId = newcomer(w, "Ellie Park") ?? "";
    const ellie = w.state.entities[ellieId];
    expect(ellie?.name).toBe("Ellie Park");
    expect(ellie?.tier).toBe("background");
    expect(ellie?.fields.place).toBe("apartment");
    expect(ellie?.fields.role).toBe("barista");
    expect(knowsOf(w, ellieId)).toBe(true);
    expect(propose(w, "spawn", { kind: "person", name: "ellie park" })).toBe("duplicate");
    expect(propose(w, "spawn", { kind: "person", name: w.state.entities.maya!.name })).toBe("duplicate");
    expect(propose(w, "spawn", { kind: "dragon", name: "Smaug" })).toBe("missing_kind");
    expect(propose(w, "spawn", { kind: "account", name: "Secret Fund" })).toBe("not_a_character");
    expect(propose(w, "spawn", { kind: "person", name: "Wanderer", place: "atlantis" })).toBe("missing_place");
    expect(propose(w, "spawn", { kind: "person", name: "{{char}}" })).toBe("bad_name");
    expect(propose(w, "spawn", { kind: "person", name: "x".repeat(61) })).toBe("bad_name");
    expect(propose(w, "spawn", { kind: "person", name: "Dock Hand", place: "lake" })).toBe("ok");
    expect(w.state.entities[newcomer(w, "Dock Hand") ?? ""]?.fields.place).toBe("lake");
    for (let i = 2; i < DEFAULT_SPAWN_CAP; i++) expect(propose(w, "spawn", { kind: "person", name: `Extra ${i}` })).toBe("ok");
    expect(propose(w, "spawn", { kind: "person", name: "One Too Many" })).toBe("spawn_cap");
  });

  test("spawn: a name only someone the POV may not know has is refused unseen, after every refusal the player sees", () => {
    const w = setup();
    const spawn = reg.proposals.get("spawn");
    w.world.entities.jordan!.visibility = "secret";
    const jordan = w.state.entities.jordan!.name;
    expect(spawn?.validate({ kind: "person", name: jordan }, w.ctx)).toMatchObject({ code: "duplicate", unseen: true });
    // Past the cap, the player is told so whether or not someone has the name.
    w.world.spawnCap = 0;
    expect(refusal(w, "spawn", { kind: "person", name: jordan })).toEqual(refusal(w, "spawn", { kind: "person", name: "Nobody Else" }));
  });

  test("spawn: a newcomer's id isn't made from the name alone, so an authored id can't be it; the same story gives the same id", () => {
    const a = setup();
    a.world.entities.npc_ellie_park = { id: "npc_ellie_park", kind: "person", name: "Someone Else", tier: "background", fields: { place: "office" }, relations: [], visibility: "secret" };
    a.state.entities.npc_ellie_park = { kind: "person", name: "Someone Else", tier: "background", fields: { place: "office", visibility: "secret" }, relations: [], levels: {}, agent: false };
    expect(propose(a, "spawn", { kind: "person", name: "Ellie Park" })).toBe("ok");
    expect(a.state.entities.npc_ellie_park?.name).toBe("Someone Else");
    const b = setup();
    expect(propose(b, "spawn", { kind: "person", name: "Ellie Park" })).toBe("ok");
    expect(newcomer(a, "Ellie Park")).toBe(newcomer(b, "Ellie Park") ?? "");
  });

  test("spawn: the world's own cap replaces the default; 0 lets no reply introduce anyone", () => {
    const w = setup();
    w.world.spawnCap = 60;
    for (let i = 1; i <= DEFAULT_SPAWN_CAP; i++) expect(propose(w, "spawn", { kind: "person", name: `Extra ${i}` })).toBe("ok");
    expect(propose(w, "spawn", { kind: "person", name: "The Twenty Fifth" })).toBe("ok");
    expect(w.state.entities[newcomer(w, "The Twenty Fifth") ?? ""]?.fields.place).toBe("apartment");
    const none = setup();
    none.world.spawnCap = 0;
    expect(propose(none, "spawn", { kind: "person", name: "Ellie Park" })).toBe("spawn_cap");
    expect(newcomer(none, "Ellie Park")).toBeUndefined();
  });

  test("quantity: whole steps on an item its holder has, as many as the story tells, kept in the field's range", () => {
    const w = setup();
    expect(propose(w, "quantity", { entity: "you", item: "phone", delta: 2 })).toBe("ok");
    expect(w.state.entities.phone?.fields.qty).toBe(3);
    expect(propose(w, "quantity", { entity: "you", item: "phone", delta: 50 })).toBe("ok");
    expect(w.state.entities.phone?.fields.qty).toBe(53);
    expect(propose(w, "quantity", { entity: "you", item: "phone", delta: 1.5 })).toBe("bad_proposal");
    expect(propose(w, "quantity", { entity: "you", item: "phone", delta: 0 })).toBe("bad_proposal");
    expect(propose(w, "quantity", { entity: "maya", item: "phone", delta: 1 })).toBe("not_holder");
    expect(propose(w, "quantity", { entity: "you", item: "maya", delta: 1 })).toBe("missing_entity");
    expect(propose(w, "quantity", { entity: "you", item: "phone", delta: -60 })).toBe("ok");
    expect(w.state.entities.phone?.fields.qty).toBe(0);
  });
});
