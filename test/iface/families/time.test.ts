// Time on an invented world: each tool is found by its own words, is called, applies and answers in
// full; taking someone off a schedule they do not follow is applied as nothing and reported.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { WorldDoc } from "../../../src/shared/world";
import { TIME_TOOLS } from "../../../src/iface/families/time";
import { appliedInFull, descriptions, eachFoundByItsWords, familyRig, opOf, searchByWords, SRC } from "./kit";

const NAMES = TIME_TOOLS.map((t) => t.name);

/** Bram keeps the market's hours. */
function marketHours(w: WorldDoc): void {
  w.schedules.market_days = { id: "market_days", owner: "bram", target: "place", recurrence: { every: "day" }, slots: [{ start: "08:00", end: "12:00", value: "market_square" }] };
}

describe("time", () => {
  test("every tool is found by a search on its own words, and the weather and a routine by the word", async () => {
    expect(NAMES).toEqual(["gm_routine_edit", "weather_set", "weather_clear"]);
    await eachFoundByItsWords(NAMES);
    const docs = await descriptions();
    expect(searchByWords("weather", docs)).toContain("weather_set");
    expect(searchByWords("routine", docs)).toContain("gm_routine_edit");
    expect(searchByWords("schedules", docs)).toContain("gm_routine_edit");
  });

  test("each tool is called, applies, and answers with what changed and how it stands", async () => {
    const t = await familyRig(marketHours);
    const world = () => t.s.stateAt(t.turn.id).state.world;

    const follow = await t.call("gm_routine_edit", { op: "routine_follow", person: "bram", mode: "no_invitations", ...SRC });
    appliedInFull(follow, "engine", false);
    expect((opOf(follow).routine as JsonObject).mode).toBe("no_invitations");
    expect(t.s.changes(t.turn.id).length).toBe(1);

    const off = await t.call("gm_routine_edit", { op: "schedule_override", person: "bram", schedule: "market_days", value: { off: true, until: null }, ...SRC });
    appliedInFull(off, "engine", false);
    expect(t.s.changes(t.turn.id).length).toBe(2);

    const fog = appliedInFull(await t.call("weather_set", { region: "Thornbury", state: "fog", minutes: 120, ...SRC }), "engine");
    expect((fog.changed as JsonObject[]).some((c) => c.at === "entity:region_vale" && (c.now as JsonObject).weather === "fog")).toBe(true);
    expect(world().entities.region_vale?.fields.weather).toBe("fog");

    appliedInFull(await t.call("weather_clear", { region: "region_vale", state: "clear", ...SRC }), "engine");
    expect(world().entities.region_vale?.fields.weather).toBe("clear");
  });

  test("taking someone off a schedule they do not follow is applied as nothing and reported", async () => {
    const t = await familyRig(marketHours);
    const r = await t.call("gm_routine_edit", { op: "schedule_override", person: "tam", schedule: "market_days", value: { off: true, until: null }, ...SRC });
    appliedInFull(r, "engine", false);
    expect((r.reports ?? []).some((x) => x.includes("was already so"))).toBe(true);
    expect(t.s.changes(t.turn.id).length).toBe(0);
  });
});
