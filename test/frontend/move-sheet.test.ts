// Move to… (Play → Me → Belongings; ITEMS-SPEC §10.3): the player-safe choices built from what the
// player sees (places by their paths, the player character, holders nested in what holds them), the
// chat's recent targets first among the suggestions, a holder too small or already full held back
// with why, and one ✎ fix for three things moved at once.

import { describe, expect, test } from "bun:test";
import { biggestSize, moveChoices, moveRequest, moveWords } from "../../src/frontend/things/move-sheet";
import { fullWhy, moveSuggestions, playWhere, recentMoves, rememberMove, RECENT_MAX, type RecentStore } from "../../src/frontend/things/play-where";
import { cannotHold } from "../../src/frontend/things/where";

const memory = (): RecentStore => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
};

const choices = playWhere({
  pov: { id: "pov", name: "You" },
  ceiling: "armful",
  places: [
    { id: "town", name: "Port Alder", path: [], parent: null, visibility: "public" },
    { id: "home", name: "114 Harbor Street", path: ["Port Alder"], parent: "town", visibility: "public" },
  ],
  here: "home",
  holders: [
    { id: "bag", name: "Backpack", holds: "hand", load: { used: 10, capacity: 10 }, in: "pov", place: null },
    { id: "wallet", name: "Wallet", holds: "pocket", in: "bag", place: null },
    { id: "closet", name: "Closet", holds: null, in: null, place: "home" },
  ],
  people: [{ id: "dev", name: "Dev Patel" }],
});

describe("Move to…", () => {
  test("the choices: places by their paths, the player character and the people here, holders under what holds them", () => {
    const wallet = choices.find((c) => c.id === "wallet");
    expect(wallet?.path.map((s) => s.name)).toEqual(["Port Alder", "114 Harbor Street", "You", "Backpack"]);
    expect(wallet?.parent).toBe("bag");
    expect(choices.find((c) => c.id === "home")?.path.map((s) => s.id)).toEqual(["town"]);
    expect(choices.filter((c) => c.is === "person").map((c) => c.id)).toEqual(["pov", "dev"]);
    // Never into one of the things moved, or anything inside one.
    expect(moveChoices(choices, [{ id: "bag", name: "Backpack" }]).map((c) => c.id)).not.toContain("wallet");
  });

  test("recent targets, newest first and at most five, lead the suggestions; then On you, Here and Home, each once", () => {
    const store = memory();
    for (const id of ["closet", "bag", "wallet", "closet", "home", "town", "dev"]) rememberMove(store, "chat_1", id);
    expect(recentMoves(store, "chat_1")).toEqual(["dev", "town", "home", "closet", "wallet"].slice(0, RECENT_MAX));
    expect(recentMoves(store, "chat_2")).toEqual([]);
    const suggestions = moveSuggestions(choices, { recent: ["closet"], pov: "pov", here: "home", home: "home" });
    expect(suggestions.map((s) => s.label)).toEqual(["Recent: Closet", "On you", "Here: 114 Harbor Street"]);
  });

  test("a holder too small or already full is held back with why", () => {
    const wallet = choices.find((c) => c.id === "wallet")!;
    expect(cannotHold(wallet, biggestSize([{ id: "a", name: "Book", size: "hand" }, { id: "b", name: "Key", size: "pocket" }]))).toBe("Takes things up to Pocket");
    expect(fullWhy({ load: { used: 10, capacity: 10 } })).toBe("Full: 10 of 10 l");
    expect(fullWhy({ load: { used: 4, capacity: 10 } })).toBeNull();
    expect(fullWhy({})).toBeNull();
  });

  test("three things moved at once are one ✎ fix with one label; a person here holds them; Where it's kept puts each away", () => {
    const things = [
      { id: "book", name: "Paperback" },
      { id: "torch", name: "Flashlight" },
      { id: "mug", name: "Mug" },
    ];
    const closet = choices.find((c) => c.id === "closet")!;
    expect(moveRequest("chat_1", things, { choice: closet }, "pov")).toEqual({ type: "lre.fix", chatId: "chat_1", things: things.map((t) => ({ do: "move", item: t.id, to: { in: "closet" } })), label: "Paperback, Flashlight and Mug are in Closet now." });
    const dev = choices.find((c) => c.id === "dev")!;
    expect(moveRequest("chat_1", things.slice(0, 1), { choice: dev }, "pov").things).toEqual([{ do: "hand", item: "book", to: "dev", basis: "hold" }]);
    expect(moveRequest("chat_1", things, { extra: "kept" }, "pov").things).toEqual(things.map((t) => ({ do: "away", item: t.id })));
    expect(moveWords(things.slice(0, 1), { choice: choices.find((c) => c.id === "pov")! }, "pov")).toBe("Paperback is on you now.");
  });
});
