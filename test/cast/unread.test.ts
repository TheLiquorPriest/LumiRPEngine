// The cast's tools as the Author and a character's agent meet them: calls carrying what they do not
// read, and values in the shapes a model sends them, played as the harness plays a call (checked and
// coerced by pi, then run). Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { AgentRef, JsonObject } from "rp-harness/contract";
import { type Bench, dataOf, openBench, texts, wordsFromFiles } from "./rig";

const BRAM: AgentRef = { id: "bram-1", definition: "character", plays: "Bram" };

/** Bram cast as a principal, in a played turn. */
async function bench(): Promise<Bench> {
  const b = await openBench();
  const turn = await b.t.begin();
  expect((await b.play("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id)).error).toBeUndefined();
  await b.t.tie(turn);
  return b;
}

describe("the cast's tools, never refused for what they do not read", () => {
  test("a perception sent with what it does not read is written with the rest, and the answer names what was left out once, with what a perception reads", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const r = await b.play(
      "perceive",
      { perceptions: [{ who: "Bram", moment: "Wren comes in from the gale", reach: "whole", content: "The door bangs; Wren drips on the boards.", knows: "Wren walked the causeway.", feeling: "uneasy", where: "behind the bar" }] },
      turn.id,
    );
    expect(r.error).toBeUndefined();
    expect(wordsFromFiles(r)).toBe(true);
    expect(r.reports).toEqual(["Operation 1 (perception) was written without feeling, where. It reads id, who, message, moment, reach, content, missed, knows, secrets, told_by, reliability, drop, why."]);
    const [p] = dataOf(r).perceptions as JsonObject[];
    expect((p?.now as JsonObject).content).toBe("The door bangs; Wren drips on the boards.");
    expect(p?.knowledge).toHaveLength(1);
  });

  test("cast_update writes each operation with what it reads, a number sent as text read as the number; what it does not read is named once", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const r = await b.play(
      "cast_update",
      {
        operations: [
          { op: "relationship", who: "Bram", with: "Wren", text: "She owes him for the lamp oil.", trust: "35", mood: "wary" },
          { op: "knowledge", who: "Bram", text: "The causeway floods at the spring tide.", source: "Wren" },
        ],
      },
      turn.id,
    );
    expect(r.error).toBeUndefined();
    expect(wordsFromFiles(r)).toBe(true);
    expect(r.reports).toEqual([
      "Operation 1 (relationship) was written without mood. It reads who, with, text, trust, warmth, respect, fear, drop, why.",
      "Operation 2 (knowledge) was written without source. It reads who, id, text, secret, how, drop, why.",
    ]);
    const [rel, known] = dataOf(r).operations as JsonObject[];
    expect(rel?.wrote).toEqual({ with: "Wren", text: "She owes him for the lamp oil.", trust: 35 });
    expect(known?.wrote).toEqual({ text: "The causeway floods at the spring tide." });
  });

  test("an operation that cannot be read at all is answered in the file's words with what it reads, never with the call or the schema, and nothing is written", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const r = await b.play("cast_update", { operations: [{ op: "knowledge", who: "Bram", text: "Wren's boat is moored at the light." }, { op: "growth", who: "Bram", cause: "The gale.", weight: 3 }] }, turn.id);
    expect(r.error).toBe(true);
    expect(wordsFromFiles(r)).toBe(true);
    expect(texts(r)).toEqual(["Operation 2 (growth) needs text.", "growth reads who, id, text, cause, accept, drop, why, and needs who, and a new one needs text. It does not read weight.", "Nothing was written. Send the call again with that put right."]);
    expect(b.t.record(turn).items.size).toBe(1);
    expect(texts(await b.play("cast_update", {}, turn.id))).toEqual(["operations cannot be read: send a list of operations."]);
  });

  test("a character's memory actions write what they read and name what they left out; an id that is none of theirs is left out of what it came from", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const remembered = await b.play("remember", { memories: [{ text: "Wren came in soaked and would not say from where.", gist: "Wren's silence about the causeway.", weight: "2", mood: "uneasy" }] }, turn.id, BRAM);
    expect(remembered.error).toBeUndefined();
    expect(wordsFromFiles(remembered)).toBe(true);
    expect(remembered.reports).toEqual(["Operation 1 (memory) was written without mood. It reads id, text, gist, weight, tone, who, about, from, top."]);
    const [memory] = dataOf(remembered).memories as JsonObject[];
    expect(memory?.weight).toBe(2);
    const reflected = await b.play("reflect", { from: [String(memory?.id), "mem-404"], text: "She is hiding the crossing from me.", gist: "Wren hides the crossing." }, turn.id, BRAM);
    expect(reflected.error).toBeUndefined();
    expect(wordsFromFiles(reflected)).toBe(true);
    // The memory it named that is Bram's is kept; the one that is not is left out and said.
    expect(reflected.reports).toEqual(['Operation 1 (reflect): Bram has no memory "mem-404" on this path.']);
    expect(((dataOf(reflected).realization as JsonObject).memories as string[]).length).toBe(1);
  });
});
