// A job's own readings (plan §10.9): what a job records is recorded with the turn that started it, and
// until the job ends only the job sees it. The job's reading of the state has its own changes so far on
// top of that turn's, in the order it recorded them, and each change it records is checked there; the
// turn's own reading, and a turn begun since, have none of it until the job ends on the path.

import { describe, expect, test } from "bun:test";
import type { ReadContext } from "../../src/engine/registry";
import type { WorldState } from "../../src/engine/state";
import { mindEdit } from "../../src/packs/minds/core/edit";
import { readKnowledge } from "../../src/packs/minds/core/state";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { MINDS_EVENTS } from "../../src/shared/minds";
import type { ChangeInput, UserStore } from "../../src/store";
import { carried, engine, hand, make, play, testStore } from "./fixtures";

const JOB = "job-cellar";

/** Engine changes as a job's agent records them: with the job. */
const asJob = (events: LedgerEvent[]): ChangeInput[] => engine(...events).map((c) => ({ ...c, job: JOB }));

/** The world as a reading of `turn` holds it, as the engine reads one: the job's reading where one is named. */
function contextOf(s: UserStore, env: { registry: ReadContext["registry"]; worlds: (r: string) => ReadContext["world"] | undefined }, turn: string, job: string | null): ReadContext {
  const state = s.stateFor(turn, job).state.world;
  return env.registry.context(env.worlds(state.revision)!, state);
}

describe("a job's own readings", () => {
  test("a job reads what it recorded on top of the turn it started from, and checks its next change there; the turn and a turn begun since do not, until it ends", () => {
    let now = 0;
    const { s, revision } = testStore({ now: () => ++now });
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "Odile goes down to the cellar.", 1, []);
    // The job lights a lamp for Odile, then has her hand it to Bram: the second holds only where the first is.
    expect(s.addChanges(t1.id, asJob([make("lamp", "Lamp", "odile")])).changes.map((c) => c.applied)).toEqual([true]);
    expect(carried(s.stateFor(t1.id, JOB).state.world, "odile")).toContain("lamp");
    const handed = s.addChanges(t1.id, asJob(hand("lamp", "odile", "bram")));
    expect(handed.changes.map((c) => c.applied)).toEqual([true, true]);
    expect(carried(handed.state.world, "bram")).toContain("lamp");
    expect(carried(s.stateFor(t1.id, JOB).state.world, "bram")).toContain("lamp");

    // Nobody else sees it: not the turn's own reading, nor a turn begun while the job runs, nor the head.
    expect(s.stateAt(t1.id).state.world.entities.lamp).toBeUndefined();
    const t2 = s.beginTurn({ chat: "c", kind: "normal" });
    expect(s.stateAt(t2.id).state.world.entities.lamp).toBeUndefined();
    expect(s.stateFor(t2.id, null).state.world.entities.lamp).toBeUndefined();
    s.tieTurn(t2.id, { message: "m2", hash: "h2", date: 2 });
    expect(s.headState("c").state.world.entities.lamp).toBeUndefined();

    // Once it ends, its changes take effect where they always have: before the first turn begun after.
    s.endJob(JOB);
    expect(s.stateAt(t2.id).state.world.entities.lamp).toBeUndefined();
    const t3 = s.beginTurn({ chat: "c", kind: "normal" });
    expect(carried(s.stateAt(t3.id).state.world, "bram")).toContain("lamp");
  });

  test("a job that has someone learn a secret and then forget it within the same job ends with them not holding it", () => {
    let now = 0;
    const { s, store, revision } = testStore({ now: () => ++now });
    s.createChat({ id: "c", revision });
    const t1 = play(s, "c", "m1", "Bram counts the casks.", 1, []);
    const fact = "lore:short_cask";
    const said: JsonObject = { id: fact, kind: "lore", claim: "One cask in the cellar is watered.", about: [], truth: "true" };
    const learned = mindEdit(contextOf(s, store.env, t1.id, null), { op: "mind_knowledge", entity: "bram", fact, holding: null });
    // The chat holds no such fact yet, so nobody can hold it: the job records the fact first, then Bram's holding of it.
    expect(learned).toMatchObject({ code: "missing_fact" });
    s.addChanges(t1.id, asJob([{ type: MINDS_EVENTS.fact, data: { fact: said } } as unknown as LedgerEvent]));
    const holding = { how: "witnessed", by: null, evidence: [], since: { msg: null, at: 0 }, belief: "true", confidence: 0.9 };
    const hold = mindEdit(contextOf(s, store.env, t1.id, JOB), { op: "mind_knowledge", entity: "bram", fact, holding: holding as never });
    expect(Array.isArray(hold)).toBe(true);
    s.addChanges(t1.id, asJob(hold as LedgerEvent[]));

    // The job strikes it again, worked out on its own reading, where Bram holds it.
    const forget = mindEdit(contextOf(s, store.env, t1.id, JOB), { op: "mind_knowledge", entity: "bram", fact, holding: null });
    expect(forget).toEqual([{ type: MINDS_EVENTS.forget, data: { who: ["bram"], fact } }]);
    s.addChanges(t1.id, asJob(forget as LedgerEvent[]));
    s.endJob(JOB);
    const t2 = s.beginTurn({ chat: "c", kind: "normal" });
    const knowledge = readKnowledge(s.stateAt(t2.id).state.world as WorldState);
    expect(knowledge.facts[fact]).toBeDefined();
    expect(knowledge.holdings.bram?.[fact]).toBeUndefined();
  });
});
