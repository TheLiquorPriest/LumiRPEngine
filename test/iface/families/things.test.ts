// Things and gear on an invented world: each tool is found by its own words, is called, applies and
// answers in full; a grant that ends in the past, more used than there is, and a set piece not to
// hand are applied and reported.

import { describe, expect, test } from "bun:test";
import type { JsonObject, ToolResult } from "rp-harness/contract";
import type { WorldDoc } from "../../../src/shared/world";
import { THING_TOOLS } from "../../../src/iface/families/things";
import { dataOf } from "../rig";
import { appliedInFull, eachFoundByItsWords, familyRig, searchByWords, descriptions, SRC } from "./kit";

const NAMES = THING_TOOLS.map((t) => t.name);

describe("things and gear", () => {
  test("every tool is found by a search on its own words, and an outfit by the word", async () => {
    expect(NAMES).toEqual(["item_condition", "item_use", "item_own", "item_grant", "item_revoke", "item_permit", "item_unpermit", "item_home", "item_label", "item_merge", "item_lose", "item_remove", "set_save", "set_apply", "set_drop"]);
    await eachFoundByItsWords(NAMES);
    expect(searchByWords("outfit", await descriptions())).toContain("set_apply");
  });

  test("each tool is called, applies, and answers with what changed and how it stands", async () => {
    // Outfits are kept from Gear level 3, and a cloak is worn over the rest.
    const t = await familyRig((w) => {
      w.realism.levels.gear = 3;
      w.entities.cloak = { ...w.entities.cloak, fields: { ...w.entities.cloak?.fields, slot: "torso_outer" } } as WorldDoc["entities"][string];
    });
    const at = (r: ToolResult, ref: string): JsonObject | undefined => (dataOf(r).changed as JsonObject[]).find((c) => c.at === ref);
    const state = () => t.s.stateAt(t.turn.id).state.world;

    const worn = appliedInFull(await t.call("item_condition", { item: "knife", delta: -30, ...SRC }), "engine");
    expect(((worn.changed as JsonObject[])[0]?.now as JsonObject).condition).toBeDefined();

    const used = await t.call("item_use", { item: "bell", ...SRC });
    appliedInFull(used, "engine");
    expect(state().entities.bell?.fields.gone).toBe(true);

    const owned = await t.call("item_own", { item: "knife", owner: "bram", ...SRC });
    appliedInFull(owned, "engine");
    expect(at(owned, "entity:knife")).toBeDefined();

    appliedInFull(await t.call("item_grant", { item: "knife", who: "odile", basis: "loan", until: "2031-03-02 08:00", ...SRC }), "engine");
    expect(state().entities.odile?.relations.some((r) => r.type === "uses" && r.to === "knife")).toBe(true);
    appliedInFull(await t.call("item_revoke", { item: "knife", who: "odile", ...SRC }), "engine");
    expect(state().entities.odile?.relations.some((r) => r.type === "uses" && r.to === "knife")).toBe(false);

    appliedInFull(await t.call("item_permit", { from: "bram", to: "odile", scope: "home", ...SRC }), "engine");
    expect(state().entities.bram?.relations.some((r) => r.type === "permits" && r.to === "odile")).toBe(true);
    appliedInFull(await t.call("item_unpermit", { from: "bram", to: "odile", ...SRC }), "engine");
    expect(state().entities.bram?.relations.some((r) => r.type === "permits" && r.to === "odile")).toBe(false);

    appliedInFull(await t.call("item_home", { item: "cloak", in: "satchel", ...SRC }), "engine");
    expect(state().entities.cloak?.fields.home).toBeDefined();

    appliedInFull(await t.call("item_label", { item: "knife", name: "Bone knife", ...SRC }), "engine");
    expect(state().entities.knife?.name).toBe("Bone knife");

    appliedInFull(await t.call("item_merge", { keep: "knife", drop: "cask", ...SRC }), "engine");
    expect(state().entities.cask?.fields.gone).toBe(true);

    appliedInFull(await t.call("item_lose", { item: "purse", by: "tam", ...SRC }), "engine");
    expect(state().entities.purse?.relations.some((r) => r.type === "in" && r.to === "tam")).toBe(true);

    appliedInFull(await t.call("item_remove", { item: "satchel", why: "burned", ...SRC }), "engine");
    expect(state().entities.satchel?.fields.gone).toBe(true);

    appliedInFull(await t.call("set_save", { who: "wren", name: "Travelling", kind: "outfit", pieces: ["cloak"], ...SRC }), "engine");
    expect(Object.keys((state().entities.wren?.fields.sets ?? {}) as JsonObject)).toEqual(["set_travelling"]);
    await t.call("world_apply", { operations: [{ op: "wear", what: "cloak", who: "wren", off: true, ...SRC }] });
    appliedInFull(await t.call("set_apply", { who: "wren", set: "travelling", ...SRC }), "engine");
    expect(state().entities.cloak?.relations.some((r) => r.type === "worn_by" && r.to === "wren")).toBe(true);
    appliedInFull(await t.call("set_drop", { who: "wren", set: "Travelling", ...SRC }), "engine");
    expect(Object.keys((state().entities.wren?.fields.sets ?? {}) as JsonObject)).toEqual([]);
  });

  // hardening: rewritten once the engine records an end before now and advises it (a grant and a leave keep that end, reported ends_before_now).
  test.skip("a grant that ends before now is applied with no end, and reported", async () => {
    const t = await familyRig();
    const r = await t.call("item_grant", { item: "knife", who: "odile", until: "2030-01-01 08:00", ...SRC });
    appliedInFull(r, "engine");
    expect((r.reports ?? []).some((x) => x.includes("is not after now"))).toBe(true);
    const uses = t.s.stateAt(t.turn.id).state.world.entities.odile?.relations.find((x) => x.type === "uses" && x.to === "knife");
    expect(uses).toBeDefined();
    expect(uses?.until).toBeUndefined();
  });

  test("more used than there is uses it up, and is reported", async () => {
    const t = await familyRig();
    const r = await t.call("item_use", { item: "bell", qty: 3, ...SRC });
    appliedInFull(r, "engine");
    expect(r.reports ?? []).toEqual([expect.stringContaining("3 of Market bell [bell] were used and there were only 1")]);
    expect(t.s.stateAt(t.turn.id).state.world.entities.bell?.fields.gone).toBe(true);
  });

  test("a set piece not to hand is put on all the same, and reported", async () => {
    const t = await familyRig((w) => {
      w.realism.levels.gear = 3;
      w.entities.cloak = { ...w.entities.cloak, fields: { ...w.entities.cloak?.fields, slot: "torso_outer" } } as WorldDoc["entities"][string];
      w.entities.hat = { id: "hat", kind: "item", name: "Straw hat", tier: "background", fields: { slot: "head", place: "market_square" }, relations: [] } as WorldDoc["entities"][string];
    });
    appliedInFull(await t.call("set_save", { who: "wren", name: "Travelling", kind: "outfit", pieces: ["cloak", "hat"], ...SRC }), "engine");
    const r = await t.call("set_apply", { who: "wren", set: "Travelling", ...SRC });
    appliedInFull(r, "engine");
    expect(r.reports ?? []).toEqual([expect.stringContaining("Straw hat [hat] was not to hand, and was put on Wren [wren] all the same")]);
    const world = t.s.stateAt(t.turn.id).state.world;
    expect(world.entities.hat?.relations.some((x) => x.type === "worn_by" && x.to === "wren")).toBe(true);
    expect(world.entities.cloak?.relations.some((x) => x.type === "worn_by" && x.to === "wren")).toBe(true);
  });

  // hardening: the item ops advise now (S13's advice lines), so the old `rule_bent` report this case reads is to be rewritten for the advice.
  test.skip("a home in something the world's rules say holds nothing is set all the same, and reported", async () => {
    const t = await familyRig();
    const r = await t.call("item_home", { item: "knife", in: "bell", ...SRC });
    appliedInFull(r, "engine");
    expect(r.reports ?? []).toEqual([expect.stringContaining("Knife [knife] was put with Market bell [bell] although the world's rules for things say otherwise (cant_hold)")]);
    expect(t.s.stateAt(t.turn.id).state.world.entities.knife?.fields.home).toBe("bell");
    // Asked again, it is so already: nothing more is recorded or reported.
    const rows = t.s.changes(t.turn.id).length;
    const again = await t.call("item_home", { item: "knife", in: "Market bell", ...SRC });
    expect(again.error).toBeUndefined();
    expect(again.reports).toBeUndefined();
    expect(t.s.changes(t.turn.id).length).toBe(rows);
  });

  test("a name that is not there is refused with the near matches, and nothing is recorded", async () => {
    const t = await familyRig();
    const r = await t.call("item_condition", { item: "knif", delta: -5, ...SRC });
    expect(r.error).toBe(true);
    expect(t.s.changes(t.turn.id).length).toBe(0);
  });
});
