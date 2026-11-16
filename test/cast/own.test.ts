// A character's own writes besides its memory: what is on its mind (`mind_set`) and how it feels about
// people (`relate`), each for the character its agent plays, on the call's turn, read in whatever shape
// a model sends them, played as the harness plays a call. Every name and word here is made up.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TemplatePart } from "rp-harness";
import type { AgentRef, JsonObject } from "rp-harness/contract";
import { charactersOf } from "../../src/cast/record";
import { type CastViewInput, type CastViewName, castViews } from "../../src/cast/views";
import { type Bench, CHAT, dataOf, openBench, shippedLayouts, texts, tokensOf, USER, wordsFromFiles } from "./rig";

let layouts: Partial<Record<CastViewName, TemplatePart>> = {};
let dispose = (): void => undefined;

beforeAll(async () => {
  ({ layouts, dispose } = await shippedLayouts());
});

afterAll(() => dispose());

const BRAM: AgentRef = { id: "bram-1", definition: "character", plays: "Bram" };

/** Bram cast as a principal, in a played turn. */
async function bench(): Promise<Bench> {
  const b = await openBench();
  const turn = await b.t.begin();
  expect((await b.play("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id)).error).toBeUndefined();
  await b.t.tie(turn);
  return b;
}

async function view(b: Bench, name: CastViewName, present: string[] = []): Promise<string> {
  const input: CastViewInput = { store: b.t.store, user: USER, chat: CHAT, turn: null, character: "Bram", present, sources: b.t.shelf.reader, layouts, tokens: tokensOf };
  return (await castViews([name], input))[0]?.text ?? "";
}

describe("mind_set", () => {
  test("writes what is on the character's own mind, by kind, with what it read and what it left out said once; an entry is changed or let go by its id", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const r = await b.play("mind_set", { entries: [{ kind: "feeling", text: "Cornered.", about: "the reeve" }, { kind: "plan", text: "Read the next letter before passing it on.", mood: "grim" }] }, turn.id, BRAM);
    expect(r.error).toBeUndefined();
    expect(wordsFromFiles(r)).toBe(true);
    expect(r.reports).toEqual(["Operation 2 (mind) was written without mood. It reads id, kind, text, about, from, drop, why."]);
    const [feeling, plan] = dataOf(r).entries as JsonObject[];
    expect(feeling).toMatchObject({ kind: "feeling", text: "Cornered.", about: ["the reeve"] });
    expect(plan).toMatchObject({ kind: "plan", text: "Read the next letter before passing it on." });
    await b.t.tie(turn);
    expect(await view(b, "mind")).toBe(["### On Bram's mind", "", "Feeling:", "- Cornered. (about the reeve)", "", "Plans:", "- Read the next letter before passing it on."].join("\n"));

    const later = await b.t.begin();
    const changed = await b.play("mind_set", { entries: [{ id: String(feeling?.id), drop: "true", why: "The reeve left town." }] }, later.id, BRAM);
    expect(changed.error).toBeUndefined();
    expect((dataOf(changed).entries as JsonObject[])[0]).toMatchObject({ id: feeling?.id, dropped: true, why: "The reeve left town." });
    await b.t.tie(later);
    expect(await view(b, "mind")).toBe(["### On Bram's mind", "", "Plans:", "- Read the next letter before passing it on."].join("\n"));

    // A swipe of the turn that let it go brings it back.
    await b.t.tie(await b.t.swipe(), "another reply");
    expect(await view(b, "mind")).toContain("- Cornered. (about the reeve)");
  });

  test("an entry that cannot be read at all answers the call in the file's words, and nothing is written; another's entry, or a carried file, is not theirs to set", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const odile = await b.play("cast_update", { operations: [{ op: "cast", who: "Odile", as: "principal" }] }, turn.id);
    expect(odile.error).toBeUndefined();
    const hers = await b.play("mind_set", { entries: [{ kind: "want", text: "The key back." }] }, turn.id, { id: "odile-1", definition: "character", plays: "Odile" });
    const hersId = String((dataOf(hers).entries as JsonObject[])[0]?.id);
    const bram = charactersOf(b.t.db, USER, [CHAT]).find((c) => c.name === "Bram")?.id ?? "";
    await b.t.write(turn, [{ character: bram, part: "mind", item: `imported:${bram}:core.md`, value: { kind: "imported", file: "core.md", text: "Keeps the inn.", entity: "e-bram", filed: false } }], "migration");

    const r = await b.play(
      "mind_set",
      { entries: [{ kind: "dread", text: "The cellar." }, { id: hersId, text: "Mine now." }, { id: `imported:${bram}:core.md`, text: "Rewritten." }, { text: "No kind." }] },
      turn.id,
      BRAM,
    );
    expect(r.error).toBe(true);
    expect(wordsFromFiles(r)).toBe(true);
    expect(texts(r)).toEqual([
      'Operation 1 (mind): kind cannot be read, you sent "dread". It is one of: attention, feeling, belief, want, plan, hiding.',
      "mind reads id, kind, text, about, from, drop, why, and a new one needs kind, text.",
      `Operation 2 (mind): Bram has no mind "${hersId}" on this path.`,
      "mind reads id, kind, text, about, from, drop, why, and a new one needs kind, text.",
      `Operation 3 (mind): Bram has no mind "imported:${bram}:core.md" on this path.`,
      "mind reads id, kind, text, about, from, drop, why, and a new one needs kind, text.",
      "Operation 4 (mind) needs kind.",
      "mind reads id, kind, text, about, from, drop, why, and a new one needs kind, text.",
      "Nothing was written. Send the call again with that put right.",
    ]);
    expect(b.t.record(turn).of(bram, "mind").map((m) => m.fields.kind)).toEqual(["imported"]);
    expect(texts(await b.play("mind_set", { entries: [{ kind: "want", text: "Quiet." }] }, turn.id, { id: "author-1", definition: "author" }))).toEqual(["mind_set is a character's own, and this agent plays no one."]);
    expect(texts(await b.play("mind_set", { entries: [{ kind: "want", text: "Quiet." }] }, null, BRAM))).toEqual(["What mind_set writes is kept with a turn, and this call belongs to none."]);
  });
});

describe("relate", () => {
  test("writes how the character feels about each person, a number sent as text read as the number, one off its scale left out and said; a later word stands over the earlier one", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const r = await b.play(
      "relate",
      {
        relationships: [
          { with: "Wren", text: "She lied about the causeway, and I still want her safe.", trust: "-10", warmth: 30, mood: "torn" },
          { with: "Hale", text: "A cheat with a badge.", fear: 140 },
        ],
      },
      turn.id,
      BRAM,
    );
    expect(r.error).toBeUndefined();
    expect(wordsFromFiles(r)).toBe(true);
    expect(r.reports).toEqual([
      "Operation 1 (relationship) was written without mood. It reads with, text, trust, warmth, respect, fear, from, drop, why.",
      "Operation 2 (relationship): fear runs from -100 to 100, and you sent 140.",
      "Operation 2 (relationship) was written without fear. It reads with, text, trust, warmth, respect, fear, from, drop, why.",
    ]);
    const [wren, hale] = dataOf(r).relationships as JsonObject[];
    expect(wren).toMatchObject({ with: "Wren", trust: -10, warmth: 30 });
    expect(hale).toMatchObject({ with: "Hale", text: "A cheat with a badge." });
    expect(hale?.fear).toBeUndefined();
    await b.t.tie(turn);

    const later = await b.t.begin();
    expect((await b.play("relate", { relationships: { with: "Wren", warmth: 0 } }, later.id, BRAM)).error).toBeUndefined();
    await b.t.tie(later);
    expect(await view(b, "relationships:present", ["Wren", "Bram"])).toBe("### How Bram feels about those here\n\n- Wren: She lied about the causeway, and I still want her safe. Trust -10. Warmth 0.");
  });

  test("a relationship toward no one, or with nothing said, answers the call, and nothing is written", async () => {
    const b = await bench();
    const turn = await b.t.begin();
    const r = await b.play("relate", { relationships: [{ text: "Someone." }, { with: "Wren", why: "No reason." }] }, turn.id, BRAM);
    expect(r.error).toBe(true);
    expect(wordsFromFiles(r)).toBe(true);
    expect(texts(r)).toEqual([
      "Operation 1 (relationship) needs with.",
      "relationship reads with, text, trust, warmth, respect, fear, from, drop, why, and needs with.",
      "Operation 2 (relationship) needs at least one of text, trust, warmth, respect, fear, from, drop.",
      "relationship reads with, text, trust, warmth, respect, fear, from, drop, why, and needs with.",
      "Nothing was written. Send the call again with that put right.",
    ]);
    expect(b.t.record(turn).items.size).toBe(1);
    expect(texts(await b.play("relate", {}, turn.id, BRAM))).toEqual(["relationships cannot be read: send a list of the people you feel something about."]);
  });
});
