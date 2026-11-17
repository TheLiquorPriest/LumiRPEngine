// A character carried over from the earlier build: its old mind files, attached by the migration as
// rows of its mind, are given whole to its agent until the Author marks them filed with
// `cast_update`; the mark belongs to its turn, and the files stay on the record. Every name and
// every word here is made up.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TemplatePart } from "../../src/app/guidance";
import type { JsonObject, JsonValue } from "rp-harness/contract";
import { charactersOf, type CastWrite } from "../../src/cast/record";
import { type CastViewInput, type CastViewName, castViews } from "../../src/cast/views";
import { type Bench, CHAT, dataOf, openBench, shippedLayouts, texts, tokensOf, USER, wordsFromFiles } from "./rig";

let layouts: Partial<Record<CastViewName, TemplatePart>> = {};
let dispose = (): void => undefined;

beforeAll(async () => {
  ({ layouts, dispose } = await shippedLayouts());
});

afterAll(() => dispose());

const CORE = "# Bram\nKeeps the Gilded Hart.\n\nOwes the reeve two seasons of rent.";
const NOW_OLD = "Wiping the same cup.";
const NOW_NEW = "Watching the door for Wren.";
const PLANS = "Sell the cellar wine before the tax.";

/** The migration's row of one file of Bram's, as `src/migrate/minds.ts` stores it. */
function carried(id: string, file: string, text: string | null): CastWrite {
  const item = `imported:${id}:${file}`;
  return { character: id, part: "mind", item, value: text === null ? { drop: true } : { kind: "imported", file, text, entity: "e-bram", filed: false } };
}

/** Bram, a principal carried over: three files on the first turn; the second turn changes one and removes another. */
async function carriedOver(): Promise<{ b: Bench; id: string }> {
  const b = await openBench();
  const first = await b.t.begin();
  expect((await b.play("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, first.id)).error).toBeUndefined();
  const id = charactersOf(b.t.db, USER, [CHAT]).find((c) => c.name === "Bram")?.id ?? "";
  await b.t.write(first, [carried(id, "core.md", CORE), carried(id, "now.md", NOW_OLD), carried(id, "plans.md", PLANS)], "migration");
  await b.t.tie(first);
  const second = await b.t.begin();
  await b.t.write(second, [carried(id, "now.md", NOW_NEW), carried(id, "plans.md", null)], "migration");
  await b.t.tie(second);
  return { b, id };
}

function input(b: Bench, turn: string | null = null): CastViewInput {
  return { store: b.t.store, user: USER, chat: CHAT, turn, character: "Bram", present: [], sources: b.t.shelf.reader, layouts, tokens: tokensOf };
}

const BOTH = ["### Bram's old mind files, as they were written", "", "#### core.md", "", CORE, "", "#### now.md", "", NOW_NEW].join("\n");
const NOW_ONLY = ["### Bram's old mind files, as they were written", "", "#### now.md", "", NOW_NEW].join("\n");

describe("a migrated character's old mind files", () => {
  test("are given to its agent whole, each as its path last left it, and never as an empty heading of its mind", async () => {
    const { b } = await carriedOver();
    expect(await castViews(["mind", "imported"], input(b))).toEqual([
      { name: "mind", text: "" },
      { name: "imported", text: BOTH },
    ]);
  });

  test("filing marks them on its turn: no longer given, still on the record; a name that is none of theirs is left out and said once", async () => {
    const { b } = await carriedOver();
    const third = await b.t.begin();
    const r = await b.play("cast_update", { operations: [{ op: "filed", who: "Bram", files: ["core.md", "diary.md"] }] }, third.id);
    expect(r.error).toBeUndefined();
    expect(wordsFromFiles(r)).toBe(true);
    expect(r.reports).toEqual(["Operation 1 (filed): Bram has no old mind file diary.md on this path. Theirs are: core.md, now.md."]);
    const [op] = dataOf(r).operations as JsonObject[];
    expect(op?.wrote).toEqual({ files: ["core.md"] });
    expect(op?.now).toEqual({
      files: [
        { file: "core.md", filed: true },
        { file: "now.md", filed: false },
      ],
    });
    expect((await castViews(["imported"], input(b, third.id)))[0]?.text).toBe(NOW_ONLY);

    // The original stays attached, word for word.
    const mind = dataOf(await b.call("cast_query", { who: "Bram", part: "mind" }, third.id)).mind as JsonObject[];
    expect(mind.find((m) => m.file === "core.md")).toMatchObject({ text: CORE, filed: true });

    // One file named by its name alone, sent as a single text: the last is filed, and nothing is given.
    expect((await b.play("cast_update", { operations: [{ op: "filed", who: "Bram", files: "now" }] }, third.id)).error).toBeUndefined();
    expect(await castViews(["imported"], input(b, third.id))).toEqual([{ name: "imported", text: "" }]);
  });

  test("a filing that names none of their files writes nothing, and says what would work", async () => {
    const { b } = await carriedOver();
    const third = await b.t.begin();
    const r = await b.play("cast_update", { operations: [{ op: "filed", who: "Bram", files: ["diary.md"] }, { op: "filed", who: "Bram" }] }, third.id);
    expect(r.error).toBe(true);
    expect(wordsFromFiles(r)).toBe(true);
    expect(texts(r)).toEqual([
      "Operation 1 (filed): Bram has no old mind file diary.md on this path. Theirs are: core.md, now.md.",
      "filed reads who, files, drop, and needs who, files.",
      "Operation 2 (filed) needs files.",
      "filed reads who, files, drop, and needs who, files.",
      "Nothing was written. Send the call again with that put right.",
    ]);
    expect((await castViews(["imported"], input(b, third.id)))[0]?.text).toBe(BOTH);
  });

  test("a swipe of the turn that filed them gives them again, and showing that swipe again takes them away", async () => {
    const { b } = await carriedOver();
    const third = await b.t.begin();
    expect((await b.play("cast_update", { operations: [{ op: "filed", who: "Bram", files: ["core.md", "now.md"] }] }, third.id)).error).toBeUndefined();
    const filed = await b.t.tie(third);
    expect((await castViews(["imported"], input(b)))[0]?.text).toBe("");
    const again = await b.t.swipe();
    await b.t.tie(again, "another reply");
    expect((await castViews(["imported"], input(b)))[0]?.text).toBe(BOTH);
    await b.t.showSwipe(filed);
    expect((await castViews(["imported"], input(b)))[0]?.text).toBe("");
  });

  test("the older minds pack's notes of the character are given with them until filed, as that turn's state kept them; filing and taking it back works through cast_update", async () => {
    const { b } = await carriedOver();
    const memory = (summary: string): { lane: "engine"; op: string; value: JsonValue } => ({ lane: "engine", op: "minds.memory", value: { type: "minds.memory", data: { entity: "bram", at: 0, notes: [{ id: "n1", text: "The reeve counts twice.", salience: 4, at: 0 }], commitments: [], resolved: [], plans: [], told: [], summary } } as unknown as JsonValue });
    const third = await b.t.begin();
    await b.t.writes.run(() => b.t.s.addChanges(third.id, [memory("Keeps the Gilded Hart.")]));
    await b.t.tie(third);
    const fourth = await b.t.begin();
    await b.t.writes.run(() => b.t.s.addChanges(fourth.id, [memory("Sold the Gilded Hart.")]));
    await b.t.tie(fourth);
    const text = async (turn: string | null) => (await castViews(["imported"], input(b, turn)))[0]?.text ?? "";
    expect(await text(third.id)).toContain("Summary: Keeps the Gilded Hart.");
    expect(await text(third.id)).toContain("Note (mattered 4 of 5");
    expect(await text(null)).toContain("Summary: Sold the Gilded Hart.");
    expect(await text(null)).toContain(BOTH);

    // Marked filed on a turn, it is no longer given; named again with drop, it is.
    const fifth = await b.t.begin();
    expect((await b.play("cast_update", { operations: [{ op: "filed", who: "Bram", files: ["minds"] }] }, fifth.id)).error).toBeUndefined();
    expect(await text(fifth.id)).toBe(BOTH);
    const back = await b.play("cast_update", { operations: [{ op: "filed", who: "Bram", files: ["minds"], drop: true }] }, fifth.id);
    expect(back.error).toBeUndefined();
    expect(await text(fifth.id)).toContain("Summary: Sold the Gilded Hart.");
  });

  test("a file marked filed by mistake is unfiled through cast_update", async () => {
    const { b } = await carriedOver();
    const third = await b.t.begin();
    expect((await b.play("cast_update", { operations: [{ op: "filed", who: "Bram", files: ["core.md", "now.md"] }] }, third.id)).error).toBeUndefined();
    expect((await castViews(["imported"], input(b, third.id)))[0]?.text).toBe("");
    const r = await b.play("cast_update", { operations: [{ op: "filed", who: "Bram", files: ["core.md"], drop: true }] }, third.id);
    expect(r.error).toBeUndefined();
    expect(((dataOf(r).operations as JsonObject[])[0] as JsonObject).now).toEqual({
      files: [
        { file: "core.md", filed: false },
        { file: "now.md", filed: true },
      ],
    });
    expect((await castViews(["imported"], input(b, third.id)))[0]?.text).toBe(["### Bram's old mind files, as they were written", "", "#### core.md", "", CORE].join("\n"));
  });
});
