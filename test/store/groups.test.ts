// A group's values reach its members (plan §6.4): "a guard takes what the town watch sets for its
// members". In the tree, a member shows each value its groups set and it does not, with the group
// it comes from, the nearest group first, as a place's values reach the places in it.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../src/shared/ledger";
import { engine, play, say, testStore } from "./fixtures";

const set = (entity: string, field: string, value: string): LedgerEvent => ({ type: "set", entity, field, value });

function chat() {
  const ts = testStore();
  ts.s.createChat({ id: "c", revision: ts.revision });
  // The Lamplighters set what their members wear and when they walk; the vale's guild above them sets an oath; Bram wears his own.
  play(ts.s, "c", "m1", "The lamplighters muster.", 1, engine(
    { type: "spawn", entity: { id: "guild", kind: "faction", name: "The Vale Guild", tier: "background", fields: { oath: "keep every light burning", uniform: "a guild sash" }, relations: [] } },
    { type: "link", rel: "member_of", from: "lamplighters", to: "guild" },
    set("lamplighters", "uniform", "a brass lamp badge"),
    set("lamplighters", "rounds", "dusk to dawn"),
    set("bram", "uniform", "a warden's chain"),
  ));
  return ts;
}

describe("a group's values reach its members", () => {
  test("a member shows its group's value with where it is from, and its own where it has one", () => {
    const { s } = chat();
    const view = s.view("c");
    const odile = say(view, "odile", 0).split("\n");
    expect(odile).toContain("  · uniform: a brass lamp badge (from The Lamplighters)");
    expect(odile).toContain("  · rounds: dusk to dawn (from The Lamplighters)");
    // From the group above the group, what neither the member nor the nearer group sets.
    expect(odile).toContain("  · oath: keep every light burning (from The Vale Guild)");
    expect(odile.some((l) => l.includes("a guild sash"))).toBe(false);
    // What only describes the group stays with it.
    expect(odile.some((l) => l.includes("Keepers of the town's lamps"))).toBe(false);
    const bram = say(view, "bram", 0).split("\n");
    expect(bram).toContain("  · uniform: a warden's chain");
    expect(bram.some((l) => l.includes("a brass lamp badge"))).toBe(false);
    expect(bram).toContain("  · rounds: dusk to dawn (from The Lamplighters)");
    // As data: the value, and the level it comes from.
    expect(view.node("odile")?.values.find((v) => v.key === "uniform")).toEqual({ key: "uniform", value: "a brass lamp badge", from: { ref: "entity:lamplighters", name: "The Lamplighters" } });
    // Someone in no group takes nothing from one.
    expect(say(view, "tam", 0).includes("from The Lamplighters")).toBe(false);
  });

  test("a value set on the group changes it for every member that sets none, and leaving the group takes it away", () => {
    const { s } = chat();
    play(s, "c", "m2", "The rounds change for winter.", 2, engine(set("lamplighters", "rounds", "from the fourth bell")));
    expect(say(s.view("c"), "odile", 0).split("\n")).toContain("  · rounds: from the fourth bell (from The Lamplighters)");
    expect(say(s.view("c"), "bram", 0).split("\n")).toContain("  · rounds: from the fourth bell (from The Lamplighters)");
    play(s, "c", "m3", "Odile hands in her badge.", 3, engine({ type: "unlink", rel: "member_of", from: "odile", to: "lamplighters" }));
    expect(say(s.view("c"), "odile", 0).includes("The Lamplighters")).toBe(false);
  });
});
