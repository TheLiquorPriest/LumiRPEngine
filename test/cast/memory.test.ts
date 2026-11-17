import { describe, expect, test } from "bun:test";
import type { AgentRef, JsonObject } from "rp-harness/contract";
import { CAST_DEFAULTS, type CastSettings } from "../../src/cast/kit";
import { memoriesNow, type MemoryNow } from "../../src/cast/memory";
import { settingClock } from "../../src/store/blank";
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

  test("with the story lane on Never recall still answers and nothing is strengthened; on Confirm nothing is asked during the turn", async () => {
    for (const permission of ["never", "confirm"] as const) {
      const lanes: string[] = [];
      const asked: unknown[] = [];
      const approvals = {
        permission: async (_scope: unknown, lane: string) => {
          lanes.push(lane);
          return permission;
        },
        ask: async (...said: unknown[]) => {
          asked.push(said);
          return { go: true };
        },
      };
      const b = await openBench({ ...({ approvals } as object) });
      const seen = await bram(b);
      await remember(b, [{ text: "She went pale at the letter.", gist: "Saw her go pale.", from: [seen] }]);
      await days(b, 10);
      const turn = await b.t.begin();
      const r = await b.call("recall", { cue: "letter", top: true }, turn.id, BRAM);
      expect(wordsFromFiles(r)).toBe(true);
      expect(r.error).toBeUndefined();
      expect(dataOf(r).memories).toEqual([expect.objectContaining({ gist: "Saw her go pale." })]);
      expect(asked).toEqual([]);
      expect(lanes).toEqual(["story"]);
      await b.t.tie(turn);
      const held = now(b).get("Saw her go pale.");
      if (permission === "never") {
        expect(texts(r).join("\n")).toContain("so recalling changed nothing");
        expect(held?.item.fields.recalls).toBeUndefined();
        expect(held?.tier).not.toBe("top");
      } else {
        expect(held?.item.fields.recalls).toBe(1);
        expect(held?.tier).toBe("top");
      }
    }
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
    expect(dataOf(r)).toMatchObject({ settled: [letter, mind.get("The cellar bolt.")?.item.id, rain, mind.get("The reeve's seal.")?.item.id], kept: [letter], faded: [rain] });
    await b.t.tie(turn);
    mind = now(b, settings);
    expect(mind.get("The letter.")).toMatchObject({ tier: "long" });
    expect(mind.get("The letter.")?.item.fields.weight).toBe(2);
    expect(mind.get("Rain on the shutters.")?.strength).toBe(0.5);
    expect(mind.get("The cellar bolt.")?.tier).toBe("top");
    expect(mind.get("Rain and the letter.")).toMatchObject({ tier: "short" });
    expect(mind.get("Rain and the letter.")?.item.fields).toMatchObject({ kind: "connection", memories: [letter, rain] });
  });

  test("recall with top puts what it brings back at top of mind and the weakest there leave, said; a memory is dated at the moment it comes from; a dream lets the weak of its stretch fade at once, and what it is told to, and nothing else", async () => {
    const b = await openBench({ settings: { topOfMind: 2 } });
    const seen = await bram(b);
    await days(b, 5);
    const [letter, bolt, rain, pale] = (await remember(b, [
      { text: "The letter.", gist: "The letter.", top: true },
      { text: "The cellar bolt.", gist: "The cellar bolt.", top: true },
      { text: "Rain on the shutters.", gist: "Rain on the shutters." },
      { text: "Wren went pale.", gist: "Wren went pale.", from: [seen] },
    ])).map((m) => String(m.id));
    const settings = { ...CAST_DEFAULTS, topOfMind: 2 };
    // Written five story days after the moment it comes from, it is of that moment, and long term at once.
    expect(now(b, settings).get("Wren went pale.")).toMatchObject({ tier: "long" });
    expect(now(b, settings).get("Wren went pale.")?.item.at).toBeLessThan(now(b, settings).get("Rain on the shutters.")?.item.at ?? 0);

    const turn = await b.t.begin();
    const r = await b.call("recall", { cue: "shutters", top: true }, turn.id, BRAM);
    expect(wordsFromFiles(r)).toBe(true);
    expect(texts(r).join("\n")).toContain(`the weakest first: ${letter}`);
    await b.t.tie(turn);
    expect([...now(b, settings).values()].filter((m) => m.tier === "top").map((m) => m.item.id)).toEqual([bolt, rain]);

    // Ten more days: the stretch since no dream is all weak; the dream lets each fade at once, and says which.
    await days(b, 10);
    const before = now(b, settings).get("The letter.")?.strength ?? 0;
    const dreamt = await b.t.begin();
    const first = await b.call("dream", {}, dreamt.id, BRAM);
    expect(dataOf(first).faded).toEqual([letter, bolt, rain, pale]);
    await b.t.tie(dreamt);
    expect(now(b, settings).get("The letter.")?.strength).toBeCloseTo(before / 2, 5);
    // A dream does not clear the top of the mind.
    expect(now(b, settings).get("The cellar bolt.")?.tier).toBe("top");

    // Nothing is left of that stretch: only what the character names fades now, and the words stay.
    const next = await b.t.begin();
    const second = await b.call("dream", { fade: [letter] }, next.id, BRAM);
    expect(dataOf(second)).toMatchObject({ faded: [letter], settled: [] });
    await b.t.tie(next);
    expect(now(b, settings).get("The letter.")?.strength).toBeCloseTo(before / 4, 5);
    expect(now(b, settings).get("The letter.")?.item.fields.text).toBe("The letter.");
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

  test("a chat that names no world keeps story time on the blank world it plays on: a memory is dated when written, leaves short term and fades, with no date shown while play has only moved the clock", async () => {
    const b = await openBench({}, null);
    await bram(b);
    const written = b.t.s.headState("chat-a").state.world.clock;
    await remember(b, [{ text: "Wren paid in old coin.", gist: "Old coin.", who: ["Wren"] }]);
    expect(now(b).get("Old coin.")?.item.at).toBe(written);

    await days(b, 10);
    expect(now(b).get("Old coin.")).toMatchObject({ tier: "long", faint: true });
    const r = await b.call("recall", { cue: "Wren" }, (await b.t.begin()).id, BRAM);
    const [recalled] = dataOf(r).memories as JsonObject[];
    expect(recalled).toMatchObject({ gist: "Old coin.", tier: "long" });
    expect(recalled).not.toHaveProperty("date");
  });

  test("a date nobody set is shown to nobody: in a chat with no world, until play sets the clock, a memory and a history entry carry no date", async () => {
    const b = await openBench({}, null);
    await bram(b);
    const [made] = await remember(b, [{ text: "Wren paid in old coin.", gist: "Old coin." }]);
    expect(made).not.toHaveProperty("date");
    const turn = await b.t.begin();
    const r = await b.call("cast_update", { operations: [{ op: "history", who: "Bram", text: "Took the inn over from his aunt." }] }, turn.id);
    expect((dataOf(r).operations as JsonObject[])[0]?.now).not.toHaveProperty("date");
    // Its minutes are kept all the same, so it ages with the story.
    expect(now(b).get("Old coin.")?.item.at).toBe(b.t.s.headState("chat-a").state.world.clock);
  });

  test("once play has set the clock to a date and time in a chat with no world, dates are shown; a move alone shows none", async () => {
    const b = await openBench({}, null);
    await bram(b);
    await days(b, 1);
    const [moved] = await remember(b, [{ text: "Wren paid in old coin.", gist: "Old coin.", who: ["Wren"] }]);
    expect(moved).not.toHaveProperty("date");
    const turn = await b.t.begin();
    await b.t.writes.run(() => b.t.s.addChanges(turn.id, engine(settingClock(tick(DAY)))));
    await b.t.tie(turn);
    const [made] = await remember(b, [{ text: "Tam keeps the ferry.", gist: "The ferry.", who: ["Wren"] }]);
    expect(made).toMatchObject({ date: expect.any(String) });
    const r = await b.call("recall", { cue: "Wren" }, (await b.t.begin()).id, BRAM);
    expect(dataOf(r).memories).toEqual(expect.arrayContaining([expect.objectContaining({ gist: "The ferry.", date: made?.date }), expect.objectContaining({ gist: "Old coin.", date: expect.any(String) })]));
  });
});
