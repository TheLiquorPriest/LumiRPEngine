// What a job writes in the cast (plan §10.9): recorded with the turn that started the job, it takes
// effect where the store places the job's changes, just before the first turn to begin after the job
// has ended, so no turn has its starting state changed under it; the job's own agents read it at
// once. A turn's write since the job's own turn keeps its value. Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { AgentRef, JsonObject, JsonValue } from "rp-harness/contract";
import { heldSecrets } from "../../src/shared/minds";
import { type Bench, CHAT, dataOf, openBench } from "./rig";

const JOB: AgentRef & { job: string } = { id: "gm-1", definition: "gm", job: "job-1" };
const SECRET = "wi:vale-book:e-7:0";
const SECRET_LIVE = "book:vale-book/e-7#1";

/** What Bram's perceptions say as a reading at `turn` (null: the chat's head) sees them, by the Author or by the agent given. */
async function contents(b: Bench, turn: string | null, agent?: AgentRef): Promise<unknown[]> {
  return (dataOf(await b.call("cast_query", { who: "Bram", part: "perceptions" }, turn, agent))["perceptions"] as JsonObject[]).map((p) => p.content);
}

/** Bram cast in one played turn, the chat holding the secret as a fact. */
async function cast(b: Bench): Promise<string> {
  const turn = await b.t.begin();
  await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id);
  const fact = { type: "minds.fact", data: { fact: { id: SECRET, kind: "wi", claim: "The reeve forged the seal.", about: [], truth: "true" } } };
  await b.t.writes.run(() => b.t.s.addChanges(turn.id, [{ lane: "engine", op: "minds.fact", value: fact as unknown as JsonValue }]));
  return (await b.t.tie(turn)).id;
}

describe("a job's cast rows", () => {
  test("take effect where the store places the job's changes: not before it ends, then just before the first turn to begin after its end, with the secret it made theirs", async () => {
    const b = await openBench();
    const first = await cast(b);
    const r = await b.call("perceive", { perceptions: [{ who: "Bram", reach: "whole", content: "The ledger shows the forgery.", knows: ["The seal is forged."], secrets: [SECRET] }] }, first, JOB);
    expect(r.error).toBeUndefined();
    // The job's own agents read what it wrote at once.
    expect(await contents(b, first, JOB)).toEqual(["The ledger shows the forgery."]);

    // A turn begun while the job runs has none of it, and neither has the chat's head.
    const during = await b.t.begin();
    expect(await contents(b, during.id)).toEqual([]);
    expect(await contents(b, null)).toEqual([]);

    // The job ends after that turn began: that turn still has none of it, nor does the head it is tied at.
    await b.t.writes.run(() => b.t.s.endJob(JOB.job));
    expect(await contents(b, during.id)).toEqual([]);
    await b.t.tie(during);
    expect(await contents(b, null)).toEqual([]);
    expect(heldSecrets(b.t.s.headState(CHAT).state.world.packs.minds, "bram").lore).toEqual([]);

    // The first turn to begin after its end has it, and so does every reading after, with the holding the store placed there.
    const next = await b.t.begin();
    expect(await contents(b, next.id)).toEqual(["The ledger shows the forgery."]);
    expect(dataOf(await b.call("cast_query", { who: "Bram", part: "knowledge" }, next.id))["knowledge"]).toEqual([
      expect.objectContaining({ text: "The seal is forged." }),
      expect.objectContaining({ secret: SECRET }),
    ]);
    await b.t.tie(next);
    expect(await contents(b, null)).toEqual(["The ledger shows the forgery."]);
    expect(heldSecrets(b.t.s.headState(CHAT).state.world.packs.minds, "bram").lore).toEqual([SECRET_LIVE]);
  });

  test("a field a turn has written since the job's own keeps that turn's value; what only the job wrote takes effect", async () => {
    const b = await openBench();
    await cast(b);
    const seen = await b.t.begin();
    const made = await b.call("perceive", { perceptions: [{ who: "Bram", reach: "part", content: "Wren at the door." }] }, seen.id);
    const id = String(((dataOf(made).perceptions as JsonObject[])[0] as JsonObject).id);
    const started = (await b.t.tie(seen)).id;

    // The job, started by that turn, corrects the perception; a turn begun meanwhile corrects it too, after the job's turn.
    expect((await b.call("perceive", { perceptions: [{ who: "Bram", id, content: "Wren at the door, soaked.", missed: "The letter in her coat." }] }, started, JOB)).error).toBeUndefined();
    const later = await b.t.begin();
    expect((await b.call("perceive", { perceptions: [{ who: "Bram", id, content: "Wren at the door, with a satchel." }] }, later.id)).error).toBeUndefined();
    await b.t.writes.run(() => b.t.s.endJob(JOB.job));
    await b.t.tie(later);

    const next = await b.t.begin();
    expect(dataOf(await b.call("cast_query", { who: "Bram", part: "perceptions" }, next.id))["perceptions"]).toEqual([expect.objectContaining({ id, content: "Wren at the door, with a satchel.", missed: "The letter in her coat." })]);
  });

  test("a job that has someone learn a secret and then strikes what gave it, through the cast's tools, ends with them not holding it", async () => {
    const b = await openBench();
    const started = await cast(b);
    // The job's agent has Bram learn the secret from a perception, then strikes the perception and the knowledge it gave.
    const learnt = await b.call("perceive", { perceptions: [{ who: "Bram", reach: "whole", content: "The ledger shows the forgery.", knows: ["The seal is forged."], secrets: [SECRET] }] }, started, JOB);
    expect(learnt.error).toBeUndefined();
    const [p] = dataOf(learnt).perceptions as JsonObject[];
    const struck = await b.call("perceive", { perceptions: [{ who: "Bram", id: String(p?.id), drop: true, why: "He never opened the ledger." }] }, started, JOB);
    expect(struck.error).toBeUndefined();
    expect(dataOf(await b.call("cast_query", { who: "Bram", part: "knowledge" }, started, JOB))["knowledge"]).toEqual([]);

    // Once the job has ended, the first turn to begin after it, and the chat's head, have Bram holding nothing.
    await b.t.writes.run(() => b.t.s.endJob(JOB.job));
    await b.t.tie(await b.t.begin());
    expect(heldSecrets(b.t.s.headState(CHAT).state.world.packs.minds, "bram").lore).toEqual([]);
  });

  test("a job that has someone learn a secret through cast_update and then strikes that knowledge ends with them not holding it", async () => {
    const b = await openBench();
    const started = await cast(b);
    const learnt = await b.call("cast_update", { operations: [{ op: "knowledge", who: "Bram", text: "The reeve's seal is forged.", secret: SECRET }] }, started, JOB);
    expect(learnt.error).toBeUndefined();
    const id = String((dataOf(learnt).operations as JsonObject[])[0]?.id);
    const struck = await b.call("cast_update", { operations: [{ op: "knowledge", who: "Bram", id, drop: true, why: "He only guessed." }] }, started, JOB);
    expect(struck.error).toBeUndefined();
    expect((dataOf(struck).operations as JsonObject[])[0]?.lets_go).toEqual([SECRET]);

    await b.t.writes.run(() => b.t.s.endJob(JOB.job));
    await b.t.tie(await b.t.begin());
    expect(heldSecrets(b.t.s.headState(CHAT).state.world.packs.minds, "bram").lore).toEqual([]);
  });
});
