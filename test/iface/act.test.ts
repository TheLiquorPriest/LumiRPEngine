// `world_apply`'s `act` (plan §6.5, §6.8): one action of each pack carried out as an agent calls it, with the state read back; a
// requirement that does not hold is said and the action is carried out all the same. Every name here is invented.

import { describe, expect, test } from "bun:test";
import type { JsonObject, ToolResult } from "rp-harness/contract";
import type { WorldDoc } from "../../src/shared/world";
import { needValue } from "../../src/packs/castlife/core/index";
import { fightsOf } from "../../src/packs/combat/core/model";
import { regardAxes } from "../../src/packs/relationships/core/index";
import { POV } from "../store/fixtures";
import { familyRig, SRC } from "./families/kit";
import { dataOf, type Rig, registry, world as rigWorld, wordsFromFiles } from "./rig";

/** The rig over its world changed by `edit`, and that world, to read the state with. */
async function rigOf(edit: (w: WorldDoc) => void = () => undefined): Promise<{ t: Rig; doc: WorldDoc }> {
  const doc = rigWorld();
  edit(doc);
  return { t: await familyRig(edit), doc };
}

function stateOf(t: Rig) {
  return t.s.stateAt(t.turn.id).state.world;
}

async function apply(t: Rig, ...operations: JsonObject[]): Promise<ToolResult> {
  const r = await t.call("world_apply", { operations: operations.map((o) => ({ ...o, ...SRC })) });
  expect(r.error).toBeUndefined();
  wordsFromFiles(r);
  return r;
}

function entry(r: ToolResult, n = 0): JsonObject {
  return (dataOf(r).operations as JsonObject[])[n] ?? {};
}

const lived = (w: WorldDoc): void => {
  w.realism.levels.castlife = 4;
};

describe("act", () => {
  test("castlife: a thirty-minute meal brings hunger down, and a night's sleep meets fatigue by 07:00", async () => {
    const { t, doc } = await rigOf(lived);
    const need = (n: string): number => needValue(registry().context(doc, stateOf(t)), POV, n);
    await apply(t, { op: "pass_time", minutes: 120 });
    const hungry = need("hunger");
    expect(hungry).toBeGreaterThan(0);
    const meal = await apply(t, { op: "act", action: "eat", who: "Wren", params: { minutes: 30 } }, { op: "pass_time", minutes: 30 });
    expect(entry(meal)).toMatchObject({ applied: true, minutes: 30, outcome: "default" });
    expect(need("hunger")).toBeLessThan(hungry);
    expect(stateOf(t).entities[POV]?.fields.activity).toBe("meal");

    const tired = need("fatigue");
    expect(tired).toBeGreaterThan(0);
    const night = await apply(t, { op: "act", action: "sleep" }, { op: "pass_time", until: "07:00" });
    expect(entry(night)).toMatchObject({ applied: true, activity: "sleep" });
    expect(stateOf(t).entities[POV]?.fields.activity).toBe("sleep");
    expect(need("fatigue")).toBe(0);
  });

  test("castlife: getting up when no one is asleep is said in the answer and carried out all the same", async () => {
    const { t } = await rigOf(lived);
    const r = await apply(t, { op: "act", action: "get_up", who: "Wren" });
    expect(entry(r).applied).toBe(true);
    expect((r.reports ?? []).some((x) => x.includes("requirements does not hold"))).toBe(true);
    expect(stateOf(t).entities[POV]?.fields.activity).toBe("idle");
  });

  test("orgs: someone admitted with a title by one who may not admit is a member with the title, and the answer says so", async () => {
    const { t } = await rigOf();
    const r = await apply(t, { op: "act", action: "org_admit", params: { org: "The Lamplighters", who: "Tam", title: "Lamplighter" } });
    expect(entry(r).applied).toBe(true);
    expect((r.reports ?? []).some((x) => x.includes("members.admit"))).toBe(true);
    const link = stateOf(t).entities.tam?.relations.find((x) => x.type === "member_of" && x.to === "lamplighters");
    expect(link?.fields?.role).toBe("Lamplighter");
  });

  test("space: going to a place puts the one who goes there", async () => {
    const { t } = await rigOf();
    await apply(t, { op: "act", action: "go", params: { to: "Market Square" } });
    expect(stateOf(t).entities[POV]?.fields.place).toBe("market_square");
  });

  test("economy: paying someone takes it from the payer's money", async () => {
    const { t } = await rigOf();
    await apply(t, { op: "act", action: "pay", params: { to: "Bram", amount: 5, method: "cash" } });
    expect(stateOf(t).accounts.acct_wren).toBe(700);
  });

  test("gear: a thing dropped lies where its carrier stands", async () => {
    const { t } = await rigOf();
    await apply(t, { op: "act", action: "drop", params: { item: "Knife" } });
    expect(stateOf(t).entities.knife?.fields.place).toBe("common_room");
  });

  test("vehicles: a van driven to a place is there", async () => {
    const { t } = await rigOf();
    await apply(t, { op: "spawn", name: "Old van", class: "minivan", at: "common_room", owner: POV });
    const r = await apply(t, { op: "act", action: "drive", params: { vehicle: "Old van", to: "The Far Road" } });
    expect(entry(r, 0).applied).toBe(true);
    expect(stateOf(t).entities[POV]?.fields.place).toBe("far_road");
  });

  test("relationships: a gift raises the regard of the one given it", async () => {
    const { t, doc } = await rigOf();
    const regard = (): number => Object.values(regardAxes(registry().context(doc, stateOf(t)), "bram", POV)).reduce((a, b) => a + b, 0);
    const before = regard();
    await apply(t, { op: "act", action: "give_gift", params: { target: "Bram" } });
    expect(regard()).toBeGreaterThan(before);
  });

  test("sheets: an attempt takes the outcome the GM ruled, and rolls none", async () => {
    const { t } = await rigOf();
    const r = await apply(t, { op: "act", action: "attempt", params: { stat: "strength" }, outcome: "great" });
    expect(entry(r)).toMatchObject({ outcome: "great" });
    expect(entry(r).roll).toBeUndefined();
  });

  test("story: a puzzle answered right is recorded as solved", async () => {
    const { t } = await rigOf((w) => {
      w.tracks.p_door = { id: "p_door", kind: "puzzle", label: "The cellar door", owner: POV, start: "riddle", visibility: "public", stages: { riddle: { label: "The riddle", answer: { expect: ["echo"], normalize: true }, next: [{ to: "open", when: "false" }] }, open: { label: "Open", next: [] } } } as WorldDoc["tracks"][string];
    });
    const r = await apply(t, { op: "act", action: "answer", params: { puzzle: "The cellar door", answer: "echo" } });
    expect(entry(r).applied).toBe(true);
    expect(JSON.stringify(stateOf(t).packs.engine)).toContain(`"solved":{"p_door":"riddle"}`);
  });

  test("combat: a fight picked with someone is under way", async () => {
    const { t } = await rigOf((w) => {
      const kind = w.kinds.character;
      if (kind === undefined) throw new Error("no character kind");
      Object.assign(kind.fields, { max_hp: { type: "number", default: 12 }, hp: { type: "number", label: "HP", pool: { max: "max_hp" } }, dex: { type: "number", default: 0 } });
      w.checks.initiative = { id: "initiative", dice: "d20", modifier: "self.dex" };
      w.ruleset = { ...w.ruleset, combat: { initiative: "initiative", economy: { action: { label: "Action" } }, hp: "hp" } } as WorldDoc["ruleset"];
      w.entities.wolf = { id: "wolf", kind: "character", name: "Grey wolf", tier: "background", fields: { place: "common_room", max_hp: 7 }, relations: [] };
    });
    await apply(t, { op: "act", action: "fight", params: { target: "Grey wolf" } });
    expect(fightsOf(stateOf(t))).toHaveLength(1);
  });

  test("an action that is none of the world's is refused with the nearest, and nothing is recorded", async () => {
    const { t } = await rigOf();
    const changes = t.s.changes(t.turn.id).length;
    const r = await t.call("world_apply", { operations: [{ op: "act", action: "eats", ...SRC }] });
    expect(r.error).toBeDefined();
    expect(JSON.stringify(r.content)).toContain("eat");
    expect(t.s.changes(t.turn.id).length).toBe(changes);
  });
});
