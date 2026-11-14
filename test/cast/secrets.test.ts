// A lore secret on a chat that never ran today's build: the chat holds no fact of it, so the first
// holding asked for records the fact first, from the lore's own words, on the same turn, the way
// today's seeding records one; striking the perception or the knowledge that gave a holding takes it
// back, unless other knowledge still gives it. Every name, book and word here is made up.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { BookReader } from "../../src/cast/secrets";
import { knowersOf } from "../../src/packs/minds/core/knowledge";
import { heldSecrets } from "../../src/shared/minds";
import { type Bench, CHAT, dataOf, openBench, wordsFromFiles } from "./rig";
import { inventedWorld } from "../store/fixtures";

/** An invented book's entry with two marks: the first, `wi:vale-book:e-7:0`, is the reeve's forgery. */
const ENTRY = "The Hart's cellar runs under the square.\n{{// Secret (known to Bram): The reeve   forged the seal.}}\nNobody goes down there.\n{{// Secret: Odile keeps the only key.}}";
const SECRET = "wi:vale-book:e-7:0";
const SECRET_LIVE = "book:vale-book/e-7#1";

/** The book entries Lumiverse holds, read live; what was read, in order. */
function shelf(): { read: BookReader; asked: string[] } {
  const asked: string[] = [];
  const read: BookReader = async (_scope, book, entry) => {
    asked.push(`${book}/${entry}`);
    return book === "vale-book" && entry === "e-7" ? ENTRY : null;
  };
  return { read, asked };
}

/** The minds slice of the engine's state at the chat's head, as today's code keeps it; none before anything is in it. */
const minds = (b: Bench): { knowledge?: { facts: Record<string, JsonObject> } } => (b.t.s.headState(CHAT).state.world.packs.minds ?? {}) as never;

/** Bram, Odile and Wren cast in one played turn; the chat holds no fact of any secret. */
async function cast(b: Bench): Promise<void> {
  const turn = await b.t.begin();
  const r = await b.call("cast_update", { operations: ["Bram", "Odile", "Wren"].map((who) => ({ op: "cast", who, as: "principal" })) }, turn.id);
  expect(r.error).toBeUndefined();
  await b.t.tie(turn);
  expect(minds(b).knowledge?.facts ?? {}).toEqual({});
}

describe("a secret the chat holds no fact of yet", () => {
  test("a marked secret is recorded from its book's own words when a holding is first asked for, read once; the holding is today's; a swipe takes both back", async () => {
    const books = shelf();
    const b = await openBench({ books: books.read });
    await cast(b);
    const turn = await b.t.begin();
    const r = await b.call(
      "perceive",
      {
        perceptions: [
          { who: "Odile", reach: "told", content: "Bram whispers that the reeve forged the seal.", told_by: "Bram", secrets: [SECRET_LIVE] },
          { who: "Wren", reach: "whole", content: "She sees the seal is wrong.", secrets: [SECRET] },
        ],
      },
      turn.id,
    );
    expect(r.error).toBeUndefined();
    expect(wordsFromFiles(r)).toBe(true);
    expect((dataOf(r).perceptions as JsonObject[]).map((p) => p.holds)).toEqual([[SECRET], [SECRET]]);
    expect(books.asked).toEqual(["vale-book/e-7"]);
    const played = await b.t.tie(turn);

    expect(minds(b).knowledge?.facts[SECRET]).toMatchObject({ id: SECRET, kind: "wi", claim: "The reeve forged the seal.", truth: "true" });
    expect(knowersOf(minds(b) as never, SECRET)).toEqual(["odile", "wren"]);
    expect(heldSecrets(minds(b), "odile").lore).toEqual([SECRET_LIVE]);
    expect(heldSecrets(minds(b), "bram").lore).toEqual([]);

    await b.t.tie(await b.t.swipe());
    expect(minds(b).knowledge?.facts[SECRET]).toBeUndefined();
    expect(knowersOf(minds(b) as never, SECRET)).toEqual([]);
    await b.t.showSwipe(played);
    expect(knowersOf(minds(b) as never, SECRET)).toEqual(["odile", "wren"]);
  });

  test("a secret of the world's own lore is recorded from its entry", async () => {
    const world = inventedWorld();
    world.lore["reeve-debt"] = { id: "reeve-debt", title: "The reeve's debt", content: "The reeve owes the Lamplighters\nforty crowns.", keys: [], links: ["bram"], secret: true };
    const b = await openBench({}, world);
    await cast(b);
    const turn = await b.t.begin();
    const r = await b.call("perceive", { perceptions: [{ who: "Bram", reach: "whole", content: "The ledger falls open at the reeve's page.", secrets: ["lore:reeve-debt"] }] }, turn.id);
    expect(r.error).toBeUndefined();
    await b.t.tie(turn);
    expect(minds(b).knowledge?.facts["lore:reeve-debt"]).toMatchObject({ kind: "lore", claim: "The reeve owes the Lamplighters forty crowns.", about: ["bram"] });
    expect(heldSecrets(minds(b), "bram").lore).toEqual(["reeve-debt"]);
  });

  test("a secret the lore does not hold is left out and said: the perception is written, and no fact is recorded", async () => {
    const b = await openBench({ books: shelf().read });
    await cast(b);
    const turn = await b.t.begin();
    const r = await b.call("perceive", { perceptions: [{ who: "Bram", reach: "whole", content: "He reads the cellar door.", secrets: ["wi:vale-book:e-7:5", "lore:no-such-entry"] }] }, turn.id);
    expect(r.error).toBeUndefined();
    expect(wordsFromFiles(r)).toBe(true);
    expect(r.reports).toContain("Operation 1 (perception): this chat holds no secret wi:vale-book:e-7:5.");
    expect(r.reports).toContain("Operation 1 (perception): this chat holds no secret lore:no-such-entry.");
    await b.t.tie(turn);
    expect(minds(b).knowledge?.facts ?? {}).toEqual({});
  });
});

describe("striking what gave a holding", () => {
  test("striking a perception strikes its knowledge and lets its secret go unless other knowledge gives it; striking that knowledge lets it go; a swipe brings it back", async () => {
    const b = await openBench({ books: shelf().read });
    await cast(b);
    const first = await b.t.begin();
    const told = await b.call("perceive", { perceptions: [{ who: "Odile", reach: "told", content: "Bram whispers it.", told_by: "Bram", knows: ["Bram saw the letter."], secrets: [SECRET] }] }, first.id);
    const [p1] = dataOf(told).perceptions as JsonObject[];
    await b.t.tie(first);
    const second = await b.t.begin();
    const saw = await b.call("perceive", { perceptions: [{ who: "Odile", reach: "whole", content: "She finds the forger's tools.", secrets: [SECRET] }] }, second.id);
    const [p2] = dataOf(saw).perceptions as JsonObject[];
    await b.t.tie(second);

    const third = await b.t.begin();
    const struck = await b.call("perceive", { perceptions: [{ who: "Odile", id: String(p1?.id), drop: true, why: "Bram never said it." }] }, third.id);
    expect(struck.error).toBeUndefined();
    const [s] = dataOf(struck).perceptions as JsonObject[];
    expect(s?.struck).toEqual(p1?.knowledge);
    expect(s?.lets_go).toBeUndefined();
    // Her own finding still gives it.
    expect(knowersOf(minds(b) as never, SECRET)).toEqual(["odile"]);

    const [k2] = p2?.knowledge as string[];
    const r = await b.call("cast_update", { operations: [{ op: "knowledge", who: "Odile", id: k2, drop: true, why: "The tools were someone else's." }] }, third.id);
    expect(r.error).toBeUndefined();
    expect(wordsFromFiles(r)).toBe(true);
    expect((dataOf(r).operations as JsonObject[])[0]?.lets_go).toEqual([SECRET]);
    const done = await b.t.tie(third);
    expect(knowersOf(minds(b) as never, SECRET)).toEqual([]);
    expect(heldSecrets(minds(b), "odile").lore).toEqual([]);
    const known = dataOf(await b.call("cast_query", { who: "Odile", part: "knowledge" }, null)).knowledge as JsonObject[];
    expect(known).toEqual([]);

    await b.t.tie(await b.t.swipe());
    expect(knowersOf(minds(b) as never, SECRET)).toEqual(["odile"]);
    await b.t.showSwipe(done);
    expect(knowersOf(minds(b) as never, SECRET)).toEqual([]);
  });
});
