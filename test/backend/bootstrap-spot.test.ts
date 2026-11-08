import { describe, expect, test } from "bun:test";
import { buildSpotCard } from "../../src/backend/bootstrap/spot";
import { beatId, type Beat } from "../../src/shared/story";

const beat = (id: string): Beat => ({ id, what: `h:${id}`, by: { bootstrap: { message: "m1" } }, exposure: [] }) as unknown as Beat;

describe("the spot-check card", () => {
  test("lists flagged items first, carries the author's flags, matches the notebook's citations of real beat ids and names a contradiction's beat by its words", () => {
    const [a, b, c] = [beatId("t", "0"), beatId("t", "1"), beatId("t", "2")];
    const beats = [beat(a), beat(b), beat(c)];
    const blobs = { [`h:${a}`]: "Danny opens the shop.", [`h:${b}`]: "Priya pays.", [`h:${c}`]: "The lamp breaks.", nb: `The lamp [${c}] matters; so does [${a}].` };
    const card = buildSpotCard({
      id: "c0000",
      chapter: 0,
      now: 1,
      sample: 1,
      seed: 7,
      beats,
      blobs,
      uncertain: [`Was it ${c} that broke the lamp?`, "Whether Danny trusts Priya."],
      prose: new Map(),
      minds: [],
      povs: {},
      notebook: { events: [{ type: "notebook.revised", data: { path: "notebook/threads.md", blob: "nb" } }], blobs, chapterEnds: true, cast: [], uncertain: [] } as never,
      contradictions: [{ entry: "e1", against: a, why: "The entry says the shop was closed." }],
      entries: [],
    });
    expect(card.items[0]?.flagged).toBe(true);
    expect(card.items.findIndex((i) => !i.flagged)).toBeGreaterThan(card.items.findLastIndex((i) => i.flagged));
    expect(card.items.some((i) => i.kind === "beat" && i.beat === c && i.flagged)).toBe(true);
    expect(card.uncertain).toEqual(["Whether Danny trusts Priya."]);
    const note = card.items.find((i) => i.kind === "notebook");
    expect(note?.kind === "notebook" ? note.cites : null).toEqual([
      { beat: c, what: "The lamp breaks." },
      { beat: a, what: "Danny opens the shop." },
    ]);
    const contra = card.items.find((i) => i.kind === "contradiction");
    expect(contra?.kind === "contradiction" ? contra.against : null).toBe("Danny opens the shop.");
  });
});
