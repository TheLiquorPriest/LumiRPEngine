// A lore secret on a chat that never ran today's build: the chat holds no fact of it, so the first
// holding asked for records the fact first, from the lore's own words, on the same turn, the way
// today's seeding records one; striking the perception or the knowledge that gave a holding takes it
// back, unless other knowledge still gives it. Every name, book and word here is made up.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { BookReader } from "../../src/cast/secrets";
import { knowersOf } from "../../src/packs/minds/core/knowledge";
import { heldSecrets } from "../../src/shared/minds";
import { type Bench, CHAT, dataOf, openBench, texts, wordsFromFiles } from "./rig";
import { inventedWorld } from "../store/fixtures";

/** An invented book's entry with two marks: the first, `wi:vale-book:e-7:0`, is the reeve's forgery; the second, `wi:vale-book:e-7:1`, Odile's key. */
const ENTRY = "The Hart's cellar runs under the square.\n{{// Secret (known to Bram): The reeve   forged the seal.}}\nNobody goes down there.\n{{// Secret: Odile keeps the only key.}}";
const SECRET = "wi:vale-book:e-7:0";
const SECRET_LIVE = "book:vale-book/e-7#1";
const KEY = "wi:vale-book:e-7:1";
const KEY_LIVE = "book:vale-book/e-7#2";

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

  test("correcting a perception with what they now know, or the secrets they hold, strikes the knowledge the old version gave and no longer gives, lets its secret go, and says so", async () => {
    const b = await openBench({ books: shelf().read });
    await cast(b);
    const first = await b.t.begin();
    const read = await b.call("perceive", { perceptions: [{ who: "Bram", reach: "whole", content: "He reads the letter.", knows: ["The letter is from the reeve.", "Wren had a sealed letter."], secrets: [SECRET] }] }, first.id);
    const [p] = dataOf(read).perceptions as JsonObject[];
    const [fromReeve, sealed, forgery] = p?.knowledge as string[];
    await b.t.tie(first);

    // The reply went out otherwise: he only saw her hold it, and what he found was the cellar's key.
    const second = await b.t.begin();
    const fix = await b.call("perceive", { perceptions: [{ who: "Bram", id: String(p?.id), content: "He sees Wren holding a sealed letter.", knows: ["Wren had a sealed letter."], secrets: [KEY] }] }, second.id);
    expect(fix.error).toBeUndefined();
    expect(wordsFromFiles(fix)).toBe(true);
    const [c] = dataOf(fix).perceptions as JsonObject[];
    expect(c).toMatchObject({ struck: [fromReeve, forgery], lets_go: [SECRET], holds: [KEY] });
    expect(c?.knowledge).toHaveLength(1);
    await b.t.tie(second);

    const known = dataOf(await b.call("cast_query", { who: "Bram", part: "knowledge" }, null)).knowledge as JsonObject[];
    expect(known.map((k) => [k.id, k.text ?? k.secret])).toEqual([
      [sealed, "Wren had a sealed letter."],
      [(c?.knowledge as string[])[0], KEY],
    ]);
    expect(heldSecrets(minds(b), "bram").lore).toEqual([KEY_LIVE]);
    expect(knowersOf(minds(b) as never, SECRET)).toEqual([]);

    // A correction that sends neither leaves their knowledge as it stands.
    const third = await b.t.begin();
    const again = await b.call("perceive", { perceptions: [{ who: "Bram", id: String(p?.id), moment: "At the bar" }] }, third.id);
    expect((dataOf(again).perceptions as JsonObject[])[0]).not.toHaveProperty("struck");
    await b.t.tie(third);
    expect(dataOf(await b.call("cast_query", { who: "Bram", part: "knowledge" }, null)).knowledge).toHaveLength(2);
  });
});

describe("a holding written through cast_update", () => {
  test("knowledge that names a secret makes the character its holder, the secret recorded first from the lore when the chat holds none; a swipe takes the holding back", async () => {
    const books = shelf();
    const b = await openBench({ books: books.read });
    await cast(b);
    const turn = await b.t.begin();
    const r = await b.call(
      "cast_update",
      {
        operations: [
          { op: "knowledge", who: "Odile", secret: KEY_LIVE, how: "She had the key cut herself." },
          { op: "knowledge", who: "Bram", text: "The reeve's seal is forged.", secret: SECRET },
        ],
      },
      turn.id,
    );
    expect(r.error).toBeUndefined();
    expect(wordsFromFiles(r)).toBe(true);
    expect(r.reports ?? []).toEqual([]);
    const [odile, bram] = dataOf(r).operations as JsonObject[];
    expect(odile).toMatchObject({ holds: [KEY], now: { secret: KEY, how: "She had the key cut herself." } });
    expect(bram).toMatchObject({ holds: [SECRET], now: { text: "The reeve's seal is forged.", secret: SECRET } });
    const played = await b.t.tie(turn);
    expect(minds(b).knowledge?.facts[KEY]).toMatchObject({ claim: "Odile keeps the only key." });
    expect(minds(b).knowledge?.facts[SECRET]).toMatchObject({ claim: "The reeve forged the seal." });
    expect(heldSecrets(minds(b), "odile").lore).toEqual([KEY_LIVE]);
    expect(heldSecrets(minds(b), "bram").lore).toEqual([SECRET_LIVE]);

    await b.t.tie(await b.t.swipe());
    expect(knowersOf(minds(b) as never, KEY)).toEqual([]);
    await b.t.showSwipe(played);
    expect(knowersOf(minds(b) as never, KEY)).toEqual(["odile"]);
  });

  test("knowledge given another secret holds the new one and lets the old go; a secret that cannot be held is left out and said, and knowledge with nothing else is not written", async () => {
    const b = await openBench({ books: shelf().read });
    await cast(b);
    const first = await b.t.begin();
    const made = await b.call("cast_update", { operations: [{ op: "knowledge", who: "Bram", text: "Someone forged a seal.", secret: SECRET }] }, first.id);
    const id = String((dataOf(made).operations as JsonObject[])[0]?.id);
    await b.t.tie(first);

    const second = await b.t.begin();
    const moved = await b.call("cast_update", { operations: [{ op: "knowledge", who: "Bram", id, text: "Odile has a key.", secret: KEY }] }, second.id);
    expect(moved.error).toBeUndefined();
    expect((dataOf(moved).operations as JsonObject[])[0]).toMatchObject({ holds: [KEY], lets_go: [SECRET] });
    await b.t.tie(second);
    expect(heldSecrets(minds(b), "bram").lore).toEqual([KEY_LIVE]);

    const third = await b.t.begin();
    const half = await b.call("cast_update", { operations: [{ op: "knowledge", who: "Odile", text: "The cellar floods in spring.", secret: "wi:vale-book:e-7:5" }] }, third.id);
    expect(half.error).toBeUndefined();
    expect(wordsFromFiles(half)).toBe(true);
    expect(half.reports).toContain("Operation 1 (knowledge): this chat holds no secret wi:vale-book:e-7:5.");
    expect(half.reports).toContain("Operation 1 (knowledge) was written without secret. It reads who, id, text, secret, how, drop, why.");
    const none = await b.call("cast_update", { operations: [{ op: "knowledge", who: "Odile", secret: "the cellar's secret" }] }, third.id);
    expect(none.error).toBe(true);
    expect(wordsFromFiles(none)).toBe(true);
    expect(texts(none)).toContain("Operation 1 (knowledge): the cellar's secret is not a secret's id. A secret is named by the id the lore map shows it with.");
    expect(texts(none)).toContain("Nothing was written. Send the call again with that put right.");
    await b.t.tie(third);
    expect((dataOf(await b.call("cast_query", { who: "Odile", part: "knowledge" }, null)).knowledge as JsonObject[]).map((k) => k.text)).toEqual(["The cellar floods in spring."]);
    expect(heldSecrets(minds(b), "odile").lore).toEqual([]);
  });
});
