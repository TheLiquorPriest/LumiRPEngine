// The rest of today's people tools on an invented world: each is found by its own words, is called,
// applies and answers in full; someone taken out of the world twice changes nothing the second time
// and is reported.

import { describe, expect, test } from "bun:test";
import { PEOPLE_TOOLS } from "../../../src/iface/families/people";
import { saidNotReported } from "../rig";
import { appliedInFull, eachFoundByItsWords, familyRig, opOf, SRC } from "./kit";

const NAMES = PEOPLE_TOOLS.map((t) => t.name);

describe("people", () => {
  test("every tool is found by a search on its own words", async () => {
    expect(NAMES).toEqual(["gm_set_life", "gm_despawn", "gm_restore", "gm_classify", "gm_set_entity", "gm_link", "gm_unlink"]);
    await eachFoundByItsWords(NAMES);
  });

  test("each tool is called, applies, and answers with what changed and how it stands", async () => {
    const t = await familyRig();
    const world = () => t.s.stateAt(t.turn.id).state.world;

    appliedInFull(await t.call("gm_set_life", { person: "Tam", state: "dead", tell: ["Bram"], ...SRC }), "engine");
    expect(world().entities.tam?.life).toBe("dead");

    appliedInFull(await t.call("gm_despawn", { entity: "Market bell", ...SRC }), "engine");
    expect(world().entities.bell?.fields.gone).toBe(true);
    appliedInFull(await t.call("gm_restore", { entity: "bell", ...SRC }), "engine");
    expect(world().entities.bell?.fields.gone).not.toBe(true);

    const classed = await t.call("gm_classify", { entity: "bram", class: {}, tags: ["regular"], ...SRC });
    appliedInFull(classed, "engine", false);
    expect(opOf(classed).tags).toEqual(["regular"]);

    appliedInFull(await t.call("gm_set_entity", { entity: "odile", tier: "principal", ...SRC }), "engine");
    expect(world().entities.odile?.tier).toBe("principal");

    appliedInFull(await t.call("gm_link", { relation: "member_of", from: "tam", to: "The Lamplighters", fields: { role: "runner" }, ...SRC }), "engine");
    expect(world().entities.tam?.relations.some((r) => r.type === "member_of" && r.to === "lamplighters")).toBe(true);
    appliedInFull(await t.call("gm_unlink", { relation: "member_of", from: "tam", to: "lamplighters", ...SRC }), "engine");
    expect(world().entities.tam?.relations.some((r) => r.type === "member_of" && r.to === "lamplighters")).toBe(false);
  });

  test("something taken out of the world twice changes nothing the second time, and says so with no report", async () => {
    const t = await familyRig();
    await t.call("gm_despawn", { entity: "bell", ...SRC });
    const changes = t.s.changes(t.turn.id).length;
    const r = await t.call("gm_despawn", { entity: "bell", ...SRC });
    appliedInFull(r, "engine", false);
    saidNotReported(r, "was already so");
    expect(t.s.changes(t.turn.id).length).toBe(changes);
  });
});
