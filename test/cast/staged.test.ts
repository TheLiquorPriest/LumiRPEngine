import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { castMark, dropCastStaged, takeBackCast } from "../../src/cast/index";
import { castingItemId, charactersOf } from "../../src/cast/record";
import { StoreInputError } from "../../src/store";
import { CHAT, dataOf, openBench, USER } from "./rig";

const KEEPER = { id: "keeper-1", definition: "keeper", parent: "author-1" };

async function perceptionsOf(call: (name: string, args: JsonObject, turn: string | null) => Promise<{ content: unknown }>, who: string): Promise<JsonObject[]> {
  return dataOf((await call("cast_query", { who, part: "perceptions" }, null)) as never)["perceptions"] as JsonObject[];
}

describe("taking cast rows back with the store's changes", () => {
  test("the lead drops a sub-agent's writes: that agent's cast rows on the open turn go, the lead's stay, and the reply ties without them", async () => {
    const b = await openBench();
    const first = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, first.id);
    await b.t.tie(first);
    const turn = await b.t.begin();
    await b.call("perceive", { perceptions: [{ who: "Bram", reach: "whole", content: "The lead's own." }] }, turn.id);
    await b.call("perceive", { perceptions: [{ who: "Bram", reach: "part", content: "The keeper's.", knows: ["The keeper's knowledge."] }] }, turn.id, KEEPER);

    const gone = await b.t.writes.run(() => dropCastStaged(b.t.store, USER, turn.id, KEEPER.id));
    expect(gone).toBe(2);
    await b.t.tie(turn);
    const call = (name: string, args: JsonObject, at: string | null) => b.call(name, args, at);
    expect((await perceptionsOf(call, "Bram")).map((p) => p.content)).toEqual(["The lead's own."]);
    expect(dataOf(await b.call("cast_query", { who: "Bram", part: "knowledge" }, null))["knowledge"]).toEqual([]);
    // A turn whose reply is tied has nothing staged to drop, as the store says.
    expect(() => dropCastStaged(b.t.store, USER, turn.id, "author-1")).toThrow(StoreInputError);
  });

  test("a continue that saved nothing takes back the cast rows written after the mark, and a job's rows stay", async () => {
    const b = await openBench();
    const turn = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id);
    await b.call("perceive", { perceptions: [{ who: "Bram", reach: "whole", content: "Before the continue." }] }, turn.id);
    await b.t.tie(turn);

    const mark = castMark(b.t.db, USER, turn.id);
    await b.call("perceive", { perceptions: [{ who: "Bram", reach: "whole", content: "Written by the continue." }] }, turn.id);
    await b.call("perceive", { perceptions: [{ who: "Bram", reach: "part", content: "A job's." }] }, turn.id, { id: "gm-1", definition: "gm", job: "job-1" });
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "supporting" }] }, turn.id);

    const gone = await b.t.writes.run(() => takeBackCast(b.t.db, USER, turn.id, mark));
    expect(gone).toBe(2);
    const call = (name: string, args: JsonObject, at: string | null) => b.call(name, args, at);
    expect((await perceptionsOf(call, "Bram")).map((p) => p.content)).toEqual(["Before the continue.", "A job's."]);
    const bram = charactersOf(b.t.db, USER, [CHAT])[0]?.id ?? "";
    expect(b.t.record().items.get(castingItemId(bram))?.fields.as).toBe("principal");
    // With nothing written after it, the mark takes nothing back.
    expect(await b.t.writes.run(() => takeBackCast(b.t.db, USER, turn.id, castMark(b.t.db, USER, turn.id)))).toBe(0);
  });
});
