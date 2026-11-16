// The fixed state tools say what they did: a depth or a limit that cannot be read is refused naming it, a search says how many
// more it found, a number sent as text counts, a roll names the near checks, refuses a difficulty that is no number, and works out
// a sum; and a write's answer shows what the packs keep apart (an account's status, a fight, a routine, classes and tags).

import { describe, expect, test } from "bun:test";
import type { JsonObject, ToolResult } from "rp-harness/contract";
import { dataOf, rig, texts, wordsFromFiles } from "./rig";

const SRC = { source: { from: "prose", message: "m-1" } };

/** The `now` of what a write's answer says changed at `at`. */
function nowAt(r: ToolResult, at: string): JsonObject {
  const entry = (dataOf(r).changed as JsonObject[]).find((c) => c.at === at);
  return (entry?.now as JsonObject | undefined) ?? {};
}

describe("the reads say what they did", () => {
  test("a depth that cannot be read is refused naming depth; a search says how many more it found", async () => {
    const t = await rig();
    const q = await t.call("world_query", { at: "world", depth: "deep" });
    expect(q.error).toBe(true);
    expect(texts(q)[0]).toContain("depth");
    wordsFromFiles(q);
    expect((await t.call("world_query", { at: "world", depth: "2" })).error).toBeUndefined();
    const s = await t.call("world_search", { words: "the", limit: 1 });
    expect(texts(s)[0]).toMatch(/^Only the first 1 of what the matches are listed; \d+ more were found/);
    expect((dataOf(s).hits as JsonObject[]).length).toBe(1);
    wordsFromFiles(s);
    const bad = await t.call("world_search", { words: "the", limit: "many" });
    expect(bad.error).toBe(true);
    expect(texts(bad)[0]).toContain("limit");
  });

  test("a number sent as text counts; text that is no number is refused naming the field", async () => {
    const t = await rig();
    const set = await t.call("world_apply", { operations: [{ op: "set", at: "wren", key: "cash", value: "40", ...SRC }] });
    expect(set.error).toBeUndefined();
    expect(t.s.stateAt(t.turn.id).state.world.accounts.acct_wren).toBe(4000);
    const forty = await t.call("world_apply", { operations: [{ op: "set", at: "wren", key: "cash", value: "forty", ...SRC }] });
    expect(forty.error).toBe(true);
    expect(texts(forty)[0]).toContain("value cannot be read");
    const add = await t.call("world_apply", { operations: [{ op: "set", at: "wren", key: "cash", add: "forty", ...SRC }] });
    expect(add.error).toBe(true);
    expect(texts(add)[0]).toContain("add cannot be read");
  });
});

describe("roll", () => {
  test("a check nobody has is refused with the near ones, a difficulty that is no number is refused naming it, and a sum is worked out and recorded with nothing", async () => {
    const t = await rig();
    const unknown = await t.call("roll", { who: "wren", for: "to see", check: "nonesuch" });
    expect(unknown.error).toBe(true);
    expect(texts(unknown)[0]).toContain("nothing called nonesuch");
    wordsFromFiles(unknown);
    const against = await t.call("roll", { who: "wren", for: "to climb", dice: "1d20", against: "hard" });
    expect(against.error).toBe(true);
    expect(texts(against)[0]).toContain("against cannot be read");
    const sum = await t.call("roll", { sum: "12.50 * 3 * 1.08" });
    expect(sum.error).toBeUndefined();
    expect(dataOf(sum).sum).toEqual({ expression: "12.50 * 3 * 1.08", total: 40.5 });
    expect(t.s.changes(t.turn.id)).toEqual([]);
    const half = await t.call("roll", { who: "wren", for: "to climb", dice: "1d20", sum: "2 + 3" });
    expect(((dataOf(half).roll as JsonObject).sum as JsonObject).total).toBe(5);
    const bad = await t.call("roll", { sum: "2 +" });
    expect(bad.error).toBe(true);
  });
});

describe("a write's answer shows what the packs keep apart", () => {
  test("closing an account, starting a fight, editing a routine and classifying someone each show was and now", async () => {
    const t = await rig();
    const closed = await t.call("close_account", { account: "acct_wren", ...SRC });
    expect(closed.error).toBeUndefined();
    expect(nowAt(closed, "entity:acct_wren").status).toBe("closed");
    const fight = await t.call("fight_start", { with: ["wren"], foes: ["bram"], ...SRC });
    expect(fight.error).toBeUndefined();
    expect(String(nowAt(fight, "entity:wren").fight)).toContain("(party)");
    const routine = await t.call("gm_routine_edit", { op: "routine_follow", person: "bram", mode: "no_invitations", ...SRC });
    expect(routine.error).toBeUndefined();
    expect(String(nowAt(routine, "entity:bram").routine)).toContain("no_invitations");
    const classed = await t.call("gm_classify", { entity: "odile", class: {}, tags: ["local"], ...SRC });
    expect(classed.error).toBeUndefined();
    expect(nowAt(classed, "entity:odile")).toMatchObject({ tags: "local" });
  });
});
