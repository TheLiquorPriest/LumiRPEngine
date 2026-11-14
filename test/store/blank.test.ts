// A chat with no world works from its first turn (plan §12: the card, the lore and the first message
// seed it). It plays on a blank world, the packs as shipped with nothing in them: reads give an
// empty tree, play records into it from the first turn, and a world attached later goes on from
// what play recorded.

import { describe, expect, test } from "bun:test";
import { draftEvent, NO_DRAFT } from "../../src/engine/world-draft";
import { BLANK_REVISION } from "../../src/store/blank";
import { factStore } from "../../src/store/facts";
import type { ChangeInput } from "../../src/store/types";
import { engine, goTo, hashOf, play, say, testStore } from "./fixtures";

function chat() {
  const ts = testStore();
  ts.s.createChat({ id: "c" });
  const blank = ts.store.env.worlds(BLANK_REVISION);
  if (!blank) throw new Error("no blank world");
  // What the first turn records: a place laid in play, someone in it, and a fact about her.
  const first: ChangeInput[] = [
    ...engine(
      draftEvent(blank, NO_DRAFT, { collection: "places", id: "loft", value: { id: "loft", name: "The Hayloft", fields: {} } }),
      { type: "spawn", entity: { id: "mara", kind: "person", name: "Mara", tier: "principal", fields: {}, relations: [] } },
      goTo("mara", "loft"),
    ),
    { lane: "engine", ...factStore.change({ about: "entity:mara", key: "hair", value: "cropped short" }), by: "gm", source: "prose", precision: "exact" },
  ];
  return { ...ts, first };
}

describe("a chat with no world", () => {
  test("reads an empty tree, takes a place, a spawn, a move and a fact in its first turn, reads them back, and loses them when that turn is swiped", () => {
    const { s, first } = chat();
    expect(s.chat("c")?.revision).toBeNull();
    expect(say(s.view("c"), "world", 1).split("\n")[0]).toBe("[world] (world) — nothing is recorded in it yet");
    const t = s.beginTurn({ chat: "c", kind: "normal" });
    const { changes, state } = s.addChanges(t.id, first);
    expect(changes.map((c) => [c.op, c.applied, c.reports])).toEqual(first.map((c) => [c.op, true, []]));
    expect(state.world.entities.mara?.fields.place).toBe("loft");
    s.tieTurn(t.id, { message: "m1", hash: hashOf("Mara climbs into the hayloft."), date: 1 });
    const read = say(s.view("c"), "world", "full").split("\n");
    expect(read[0]).toBe("[world] (world) — 1 person (Mara), 1 place, changed turn 1");
    expect(read).toContain("  The Hayloft [loft] (place) — 1 person (Mara), changed turn 1");
    expect(read.some((l) => /^ {4}Mara \[mara\] \(Person\)/.test(l))).toBe(true);
    expect(read.some((l) => /^ {6}· hair: "cropped short" \(exact, turn 1\) \[f-[0-9a-f]{12}\]$/.test(l))).toBe(true);
    // Another swipe of that first reply: none of it was recorded there.
    play(s, "c", "m1", "Mara stays in the yard.", 2, [], { target: "m1" });
    expect(say(s.view("c"), "world", "full")).not.toMatch(/Hayloft|Mara|cropped short/);
    expect(say(s.view("c"), "world", 1).split("\n")[0]).toBe("[world] (world) — nothing is recorded in it yet");
    expect(s.view("c").node("mara")).toBeNull();
  });

  test("a world attached later goes on from what play recorded", () => {
    const { s, first, revision, world } = chat();
    play(s, "c", "m1", "Mara climbs into the hayloft.", 1, first);
    // Attaching a world is today's Upgrade to its revision, taking in its people and things.
    const merge = Object.fromEntries(Object.keys(world.entities).map((id) => [id, { entity: "take" }]));
    const attach: ChangeInput = { lane: "engine", op: "store.marker", value: { kind: "migrate", to: revision, merge }, by: "player", source: "player" };
    const t2 = play(s, "c", "m2", "The vale comes into view.", 2, [attach]);
    expect(s.changes(t2.id).map((c) => c.applied)).toEqual([true]);
    const view = s.view("c");
    // The world's own people and places, and what play made before it came, side by side.
    expect(view.node("thornbury")?.name).toBe("Thornbury");
    expect(view.node("wren")?.name).toBe("Wren");
    expect(view.node("mara")?.parent).toBe("place:loft");
    expect(view.node("mara")?.facts.map((f) => f.value)).toEqual(["cropped short"]);
  });
});
