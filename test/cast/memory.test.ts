import { describe, expect, test } from "bun:test";
import type { AgentRef, JsonObject } from "rp-harness/contract";
import { CAST_DEFAULTS, type CastSettings } from "../../src/cast/kit";
import { memoriesNow, type MemoryNow } from "../../src/cast/memory";
import { engine, tick } from "../store/fixtures";
import { type Bench, dataOf, openBench, texts, wordsFromFiles } from "./rig";

const BRAM: AgentRef = { id: "bram-1", definition: "character", plays: "Bram" };
const DAY = 24 * 60;

/** Bram cast as a principal, with one perception of the turn that cast him. */
async function bram(b: Bench): Promise<string> {
  const turn = await b.t.begin();
  await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id);
  const r = await b.call("perceive", { perceptions: [{ who: "Bram", reach: "part", content: "Wren breaks a seal and goes pale.", missed: "What the letter says." }] }, turn.id);
  await b.t.tie(turn);
  return String(((dataOf(r).perceptions as JsonObject[])[0] as JsonObject).id);
}

/** A turn on which story time moves on by `days`. */
async function days(b: Bench, n: number): Promise<void> {
  const turn = await b.t.begin();
  await b.t.writes.run(() => b.t.s.addChanges(turn.id, engine(tick(n * DAY))));
  await b.t.tie(turn);
}

/** Bram's memories as code reads them at the chat's head, by gist. */
function now(b: Bench, settings: CastSettings = CAST_DEFAULTS): Map<string, MemoryNow> {
  const id = b.t.record().items.values().find((i) => i.part === "casting")?.character ?? "";
  const clock = b.t.s.headState("chat-a").state.world.clock;
  return new Map(memoriesNow(b.t.record(), id, clock, settings).map((m) => [String(m.item.fields.gist), m]));
}

async function remember(b: Bench, memories: JsonObject[]): Promise<JsonObject[]> {
  const turn = await b.t.begin();
  const r = await b.call("remember", { memories }, turn.id, BRAM);
  expect(wordsFromFiles(r)).toBe(true);
  expect(r.error).toBeUndefined();
  await b.t.tie(turn);
  return dataOf(r).memories as JsonObject[];
}

describe("a character's memory", () => {
  test("a memory fades to its gist with story time, slower the more it weighs, and comes back to mind in full when recalled", async () => {
    const b = await openBench();
    const seen = await bram(b);
    const [light, heavy] = await remember(b, [
      { text: "She went pale at the letter, and I poured her cider as if I had not seen.", gist: "Pretended not to see her go pale.", who: ["Wren"], about: ["the letter"], from: [seen] },
      { text: "The reeve's man stood in my doorway and did not come in.", gist: "The reeve's man in the doorway.", weight: 3, who: ["the reeve"] },
    ]);
    expect(light).toMatchObject({ tier: "short", text: "She went pale at the letter, and I poured her cider as if I had not seen.", from: [seen] });
    expect(heavy).toMatchObject({ tier: "short", weight: 3 });

    await days(b, 10);
    let mind = now(b);
    // Weight 1, three story days to half: after ten, under the faint mark. Weight 3 halves over twelve.
    expect(mind.get("Pretended not to see her go pale.")).toMatchObject({ tier: "long", faint: true });
    expect(mind.get("Pretended not to see her go pale.")?.strength).toBeCloseTo(0.5 ** (10 / 3), 5);
    expect(mind.get("The reeve's man in the doorway.")).toMatchObject({ tier: "long", faint: false });

    const turn = await b.t.begin();
    const r = await b.call("recall", { cue: "wren" }, turn.id, BRAM);
    expect(wordsFromFiles(r)).toBe(true);
    expect(dataOf(r).memories).toEqual([expect.objectContaining({ gist: "Pretended not to see her go pale.", text: "She went pale at the letter, and I poured her cider as if I had not seen.", recalls: 1, tier: "long" })]);
    await b.t.tie(turn);
    mind = now(b);
    expect(mind.get("Pretended not to see her go pale.")).toMatchObject({ faint: false, strength: 1 });

    // Recalled once, it takes twice as long to fade: after six more days it is at a half.
    await days(b, 6);
    expect(now(b).get("Pretended not to see her go pale.")?.strength).toBeCloseTo(0.5, 5);
    expect(texts(await b.call("recall", { cue: "the harbour" }, (await b.t.begin()).id, BRAM)).join("\n")).toBe("Nothing comes back for the harbour.");
  });

  test("top of mind holds the newest it was given, as many as the setting; a dream settles the rest into long term, weighs what it keeps and lets go of what it fades", async () => {
    const b = await openBench({ settings: { topOfMind: 2 } });
    await bram(b);
    const made = await remember(b, [
      { text: "The letter.", gist: "The letter.", top: true },
      { text: "The cellar bolt.", gist: "The cellar bolt.", top: true },
      { text: "Rain on the shutters.", gist: "Rain on the shutters." },
    ]);
    const [, , rain] = made.map((m) => String(m.id));
    await remember(b, [{ text: "The reeve's seal.", gist: "The reeve's seal.", top: true }]);
    const settings = { ...CAST_DEFAULTS, topOfMind: 2 };
    let mind = now(b, settings);
    expect([...mind.values()].filter((m) => m.tier === "top").map((m) => m.item.fields.gist)).toEqual(["The cellar bolt.", "The reeve's seal."]);
    expect(mind.get("The letter.")?.tier).toBe("short");

    const turn = await b.t.begin();
    const letter = String(mind.get("The letter.")?.item.id);
    const r = await b.call("dream", { keep: [letter], fade: [rain ?? ""], connect: [{ memories: [letter, rain ?? ""], text: "The rain came the night the letter did.", gist: "Rain and the letter." }] }, turn.id, BRAM);
    expect(wordsFromFiles(r)).toBe(true);
    expect(dataOf(r)).toMatchObject({ settled: [letter, rain], kept: [letter], faded: [rain] });
    await b.t.tie(turn);
    mind = now(b, settings);
    expect(mind.get("The letter.")).toMatchObject({ tier: "long" });
    expect(mind.get("The letter.")?.item.fields.weight).toBe(2);
    expect(mind.get("Rain on the shutters.")?.item.fields.weight).toBe(1);
    expect(mind.get("The cellar bolt.")?.tier).toBe("top");
    expect(mind.get("Rain and the letter.")).toMatchObject({ tier: "short" });
    expect(mind.get("Rain and the letter.")?.item.fields).toMatchObject({ kind: "connection", memories: [letter, rain] });
  });

  test("a reflection is a memory of the memories it came from; the growth it proposes counts once the Author accepts it", async () => {
    const b = await openBench();
    await bram(b);
    const made = await remember(b, [
      { text: "The reeve's seal on Wren's letter.", gist: "The seal on her letter." },
      { text: "The reeve's man in my doorway.", gist: "The man in the doorway." },
    ]);
    const turn = await b.t.begin();
    const r = await b.call("reflect", { from: made.map((m) => String(m.id)), text: "Whatever the reeve sends, someone gets hurt.", gist: "The reeve's errands hurt people.", weight: 3, growth: "Reads every seal before he passes a letter on." }, turn.id, BRAM);
    expect(wordsFromFiles(r)).toBe(true);
    const data = dataOf(r);
    expect(data.realization).toMatchObject({ kind: "realization", memories: made.map((m) => String(m.id)), weight: 3 });
    const growth = async () => dataOf(await b.call("cast_query", { who: "Bram", part: "growth" }, turn.id)).growth as JsonObject[];
    expect(await growth()).toEqual([expect.objectContaining({ id: data.proposed_growth, proposed: true, cause: (data.realization as JsonObject).id })]);
    const accepted = await b.call("cast_update", { operations: [{ op: "growth", who: "Bram", id: String(data.proposed_growth), accept: true }] }, turn.id);
    expect(accepted.error).toBeUndefined();
    expect(await growth()).toEqual([expect.objectContaining({ proposed: false, text: "Reads every seal before he passes a letter on." })]);
  });

  test("a memory written in a turn is gone once that turn is swiped, and back when the swipe is shown again; an agent that plays no one has no memory to write", async () => {
    const b = await openBench();
    await bram(b);
    const turn = await b.t.begin();
    await b.call("remember", { memories: [{ text: "Wren paid in old coin.", gist: "Old coin." }] }, turn.id, BRAM);
    const played = await b.t.tie(turn);
    expect(now(b).has("Old coin.")).toBe(true);
    await b.t.tie(await b.t.swipe());
    expect(now(b).has("Old coin.")).toBe(false);
    await b.t.showSwipe(played);
    expect(now(b).has("Old coin.")).toBe(true);

    const r = await b.call("remember", { memories: [{ text: "x", gist: "x" }] }, (await b.t.begin()).id);
    expect(r.error).toBe(true);
    expect(texts(r).join("\n")).toBe("remember is a character's own, and this agent plays no one.");
  });
});
