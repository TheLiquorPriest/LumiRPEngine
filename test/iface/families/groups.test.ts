// Groups on an invented world: each tool is found by its own words, is called, applies (or reads,
// changing nothing) and answers in full; a member admitted twice changes nothing and is reported.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { GROUP_TOOLS } from "../../../src/iface/families/groups";
import { dataOf } from "../rig";
import { appliedInFull, descriptions, eachFoundByItsWords, familyRig, searchByWords, SRC, wordsFromFiles } from "./kit";

const NAMES = GROUP_TOOLS.map((t) => t.name);

describe("groups", () => {
  test("every tool is found by a search on its own words, and a member, a position and who may by the words", async () => {
    expect(NAMES).toEqual(["gm_org", "orgs_who_may"]);
    await eachFoundByItsWords(NAMES);
    const docs = await descriptions();
    expect(searchByWords("member", docs)).toContain("gm_org");
    expect(searchByWords("position", docs)).toContain("gm_org");
    expect(searchByWords("who may", docs)).toContain("orgs_who_may");
  });

  test("each tool is called, applies, and answers with what changed and how it stands", async () => {
    const t = await familyRig();
    const world = () => t.s.stateAt(t.turn.id).state.world;
    const joined = appliedInFull(await t.call("gm_org", { change: { do: "admit", org: "The Lamplighters", who: "Tam", title: "Apprentice", why: "sworn in" }, ...SRC }), "engine");
    expect((joined.changed as JsonObject[]).some((c) => c.at === "entity:tam")).toBe(true);
    expect(world().entities.tam?.relations.some((r) => r.type === "member_of" && r.to === "lamplighters")).toBe(true);

    appliedInFull(await t.call("gm_org", { change: { do: "remove", org: "lamplighters", who: "odile", why: "left the watch" }, ...SRC }), "engine");
    expect(world().entities.odile?.relations.some((r) => r.type === "member_of" && r.to === "lamplighters")).toBe(false);

    const changes = t.s.changes(t.turn.id).length;
    const asked = await t.call("orgs_who_may", { org: "The Lamplighters", power: "org.govern", who: "Tam" });
    expect(asked.error).toBeUndefined();
    expect(typeof dataOf(asked).may).toBe("boolean");
    expect(Array.isArray(dataOf(asked).holders)).toBe(true);
    expect(t.s.changes(t.turn.id).length).toBe(changes);
    wordsFromFiles(asked);
  });

  test("a member admitted twice is applied as nothing and reported", async () => {
    const t = await familyRig();
    const r = await t.call("gm_org", { change: { do: "admit", org: "lamplighters", who: "bram", why: "again" }, ...SRC });
    appliedInFull(r, "engine", false);
    expect((r.reports ?? []).some((x) => x.includes("was already so"))).toBe(true);
  });
});
