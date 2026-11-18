// A name that fits two things, a place and a company called Alder Automotive (the second walk's N16): where the kind wanted is known
// (an action's own argument, a tool's field for an organization) the name is looked up among that kind alone and the call goes ahead;
// where it is not (a fact's `about`), the refusal says each thing the name fits by its kind and name, so the caller can say which.
// Every name here is invented.

import { expect, test } from "bun:test";
import type { WorldDoc } from "../../src/shared/world";
import { familyRig, SRC } from "./families/kit";
import { dataOf, texts } from "./rig";

const twoOfOneName = (w: WorldDoc): void => {
  w.realism.levels.money = 3;
  w.entities.alder_co = { id: "alder_co", kind: "business", name: "Alder Automotive", tier: "background", fields: { owners: [{ party: "bram", role: "owner" }] }, relations: [] };
  w.places.alder_garage = { id: "alder_garage", name: "Alder Automotive", parent: "thornbury", fields: {} };
};

test("an action's organization and a who-may read find the company; a fact about the name is refused naming both by kind", async () => {
  const t = await familyRig(twoOfOneName);
  const admitted = await t.call("world_apply", { operations: [{ op: "act", action: "org_admit", who: "Bram", params: { org: "Alder Automotive", who: "Tam", title: "Mechanic" }, ...SRC }] });
  expect(admitted.error).toBeUndefined();
  expect(t.s.stateAt(t.turn.id).state.world.entities.tam?.relations.some((r) => r.type === "member_of" && r.to === "alder_co")).toBe(true);

  const may = await t.call("orgs_who_may", { org: "Alder Automotive", power: "members.admit", who: "Bram" });
  expect(may.error).toBeUndefined();
  expect(dataOf(may).org).toBe("Alder Automotive [alder_co]");

  const fact = await t.call("world_apply", { operations: [{ op: "fact", about: "Alder Automotive", key: "smell", value: "Engine oil.", ...SRC }] });
  expect(fact.error).toBe(true);
  expect(texts(fact)[0]).toBe("Operation 1 (fact): Alder Automotive fits more than one: Alder Automotive [alder_co] (Business), Alder Automotive [alder_garage] (place). Name one by its id.");
});
