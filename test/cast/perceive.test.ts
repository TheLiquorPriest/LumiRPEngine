import { describe, expect, test } from "bun:test";
import type { JsonObject, JsonValue } from "rp-harness/contract";
import { knowersOf } from "../../src/packs/minds/core/knowledge";
import { heldSecrets } from "../../src/shared/minds";
import { type Bench, CHAT, dataOf, openBench, wordsFromFiles } from "./rig";

/** A secret of an invented book's entry, as today's seeding records it: its first mark, `wi:<book>:<entry>:0`, live id `book:<book>/<entry>#1`. */
const SECRET = "wi:vale-book:e-7:0";
const SECRET_LIVE = "book:vale-book/e-7#1";

/** Bram and Odile cast, Wren too (the player's character, bound to her persona), and the chat holding the secret as a fact, in one played turn. */
async function cast(b: Bench): Promise<void> {
  const turn = await b.t.begin();
  const r = await b.call(
    "cast_update",
    {
      operations: [
        { op: "cast", who: "Bram", as: "principal" },
        { op: "cast", who: "Odile", as: "supporting" },
        { op: "cast", who: "Wren", as: "principal" },
      ],
    },
    turn.id,
  );
  expect(r.error).toBeUndefined();
  const fact = { type: "minds.fact", data: { fact: { id: SECRET, kind: "wi", claim: "The reeve forged the seal.", about: [], truth: "true" } } };
  await b.t.writes.run(() => b.t.s.addChanges(turn.id, [{ lane: "engine", op: "minds.fact", value: fact as unknown as JsonValue }]));
  await b.t.tie(turn);
}

/** The minds slice of the engine's state at the chat's head, as today's code keeps it. */
const minds = (b: Bench): unknown => b.t.s.headState(CHAT).state.world.packs.minds;

async function perceptions(b: Bench, who: string): Promise<JsonObject[]> {
  return dataOf(await b.call("cast_query", { who, part: "perceptions" }, null))["perceptions"] as JsonObject[];
}

async function knowledge(b: Bench, who: string): Promise<JsonObject[]> {
  return dataOf(await b.call("cast_query", { who, part: "knowledge" }, null))["knowledge"] as JsonObject[];
}

describe("perceive", () => {
  test("records each field of a perception for a character and a moment of the turn, adds what they now know, and a swipe takes all of it back", async () => {
    const b = await openBench();
    await cast(b);
    const turn = await b.t.begin();
    const r = await b.call(
      "perceive",
      {
        perceptions: [
          { who: "Bram", moment: "Wren opens the letter", reach: "part", content: "From behind the bar: Wren breaks a seal and goes pale.", missed: "What the letter says.", knows: ["Wren carries a sealed letter."] },
          { who: "Odile", moment: "Wren opens the letter", reach: "none", content: "Nothing: she was in the cellar." },
        ],
      },
      turn.id,
    );
    expect(wordsFromFiles(r)).toBe(true);
    expect(r.error).toBeUndefined();
    const played = await b.t.tie(turn);

    const bram = await perceptions(b, "Bram");
    expect(bram).toEqual([
      expect.objectContaining({ moment: "Wren opens the letter", reach: "part", content: "From behind the bar: Wren breaks a seal and goes pale.", missed: "What the letter says.", knows: ["Wren carries a sealed letter."], message: 3 }),
    ]);
    expect(await perceptions(b, "Odile")).toEqual([expect.objectContaining({ reach: "none", content: "Nothing: she was in the cellar." })]);
    expect(await knowledge(b, "Bram")).toEqual([expect.objectContaining({ text: "Wren carries a sealed letter.", from: bram[0]?.id ?? "" })]);
    expect(await knowledge(b, "Odile")).toEqual([]);

    await b.t.tie(await b.t.swipe());
    expect(await perceptions(b, "Bram")).toEqual([]);
    expect(await knowledge(b, "Bram")).toEqual([]);
    await b.t.showSwipe(played);
    expect(await perceptions(b, "Bram")).toHaveLength(1);
    expect(await knowledge(b, "Bram")).toHaveLength(1);
  });

  test("a perception that names a secret makes that character a holder as today's code reads it, and nobody else; a swipe takes the holding back", async () => {
    const b = await openBench();
    await cast(b);
    const turn = await b.t.begin();
    const r = await b.call(
      "perceive",
      { perceptions: [{ who: "Odile", moment: "In the cellar", reach: "told", content: "Bram whispers that the reeve forged the seal.", told_by: "Bram", reliability: "He saw the letter.", secrets: [SECRET_LIVE] }] },
      turn.id,
    );
    expect(wordsFromFiles(r)).toBe(true);
    expect(r.error).toBeUndefined();
    const played = await b.t.tie(turn);

    expect(knowersOf(minds(b) as never, SECRET)).toEqual(["odile"]);
    expect(heldSecrets(minds(b), "odile").lore).toEqual([SECRET_LIVE]);
    for (const other of ["bram", "wren", "tam"]) expect(heldSecrets(minds(b), other).lore).toEqual([]);
    expect(await knowledge(b, "Odile")).toEqual([expect.objectContaining({ secret: SECRET, told_by: "Bram" })]);

    await b.t.tie(await b.t.swipe());
    expect(knowersOf(minds(b) as never, SECRET)).toEqual([]);
    expect(heldSecrets(minds(b), "odile").lore).toEqual([]);
    await b.t.showSwipe(played);
    expect(heldSecrets(minds(b), "odile").lore).toEqual([SECRET_LIVE]);
  });

  test("the player's character, cast, can be made a secret's holder: the secret is no longer kept from the player", async () => {
    const b = await openBench();
    await cast(b);
    const turn = await b.t.begin();
    const r = await b.call("perceive", { perceptions: [{ who: "Wren", reach: "whole", content: "She reads the forged seal for what it is.", secrets: [SECRET] }] }, turn.id);
    expect(r.error).toBeUndefined();
    await b.t.tie(turn);
    expect(heldSecrets(minds(b), "wren").lore).toEqual([SECRET_LIVE]);
  });

  test("a secret the chat does not hold, or an id that is no secret's, is left out: the perception is written, nobody holds it, and the answer says so", async () => {
    const b = await openBench();
    await cast(b);
    const turn = await b.t.begin();
    const r = await b.call(
      "perceive",
      {
        perceptions: [
          { who: "Bram", reach: "whole", content: "He reads it.", knows: ["The seal is forged."], secrets: ["wi:vale-book:e-9:2"] },
          { who: "Odile", reach: "whole", secrets: ["the reeve's secret"] },
        ],
      },
      turn.id,
    );
    expect(wordsFromFiles(r)).toBe(true);
    expect(r.error).toBeUndefined();
    const said = (r.reports ?? []).join("\n");
    expect(said).toContain("this chat holds no secret wi:vale-book:e-9:2");
    expect(said).toContain("the reeve's secret is not a secret's id");
    expect(said).toContain("Operation 2 (perception) was written without secrets.");
    await b.t.tie(turn);
    expect((await perceptions(b, "Bram")).map((p) => p.content)).toEqual(["He reads it."]);
    expect((await knowledge(b, "Bram")).map((k) => k.text)).toEqual(["The seal is forged."]);
    expect(knowersOf(minds(b) as never, "wi:vale-book:e-9:2")).toEqual([]);
  });

  test("a perception written later for an earlier reply is of that reply, and can be corrected by id", async () => {
    const b = await openBench();
    await cast(b);
    const first = await b.t.play();
    const turn = await b.t.begin();
    const r = await b.call("perceive", { perceptions: [{ who: "Bram", message: 3, reach: "whole", content: "Wren came in soaked." }] }, turn.id);
    expect(r.error).toBeUndefined();
    const id = ((dataOf(r)["perceptions"] as JsonObject[])[0] as JsonObject)["id"] as string;
    const fix = await b.call("perceive", { perceptions: [{ who: "Bram", id, content: "Wren came in soaked, with a satchel." }] }, turn.id);
    expect(fix.error).toBeUndefined();
    await b.t.tie(turn);
    expect(first.message).toBe("m3");
    expect(await perceptions(b, "Bram")).toEqual([expect.objectContaining({ id, message: 3, reach: "whole", content: "Wren came in soaked, with a satchel." })]);
    // A reply the path does not have is left out, and the perception is of this turn.
    const later = await b.call("perceive", { perceptions: [{ who: "Bram", message: 40, reach: "none" }] }, turn.id);
    expect(later.error).toBeUndefined();
    expect((later.reports ?? []).join("\n")).toContain("there is no reply 40 on this path");
  });
});
