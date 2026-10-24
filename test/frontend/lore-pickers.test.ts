// Build's lore pickers (DESIGN §4.2, §24.5): books that share a name read apart, a secret's helpers
// leave out those that write for the player, and the gates offered as examples are ones Save takes,
// made of the world's own names.

import { describe, expect, test } from "bun:test";
import { bookLoreProblem } from "../../src/backend/book-lore";
import { loreGateReader } from "../../src/engine/visibility";
import { audienceChoices, bookLabels, gateExamples } from "../../src/frontend/build/book-lore";
import { exprReads } from "../../src/frontend/build/expr-editor";
import { LORE_AUDIENCE, PROSE_STEPS } from "../../src/shared/lore";
import type { LoreBookView } from "../../src/shared/protocol";
import { STARTER_WORLDS } from "../../src/packs/starters/index";
import { Play, registry } from "../packs/templates/play";

const book = (id: string, name: string, over: Partial<LoreBookView> = {}): LoreBookView => ({ id, name, attached: false, character: false, added: null, ...over });
const DAY = 86_400;

describe("book pickers", () => {
  test("books that share a name each read differently, by where they came from or when they were added before their ids; a name no other book has reads as it is", () => {
    const told: LoreBookView[][] = [
      [book("own-7f3", "Core", { added: 1_000 * DAY }), book("copy-9c1", "Core", { character: true, added: 1_000 * DAY })],
      [book("own-7f3", "Core", { added: 1_000 * DAY }), book("copy-9c1", "Core", { added: 1_200 * DAY })],
      [book("own-7f3", "Core", { added: 1_000 * DAY }), book("copy-9c1", "Core", { added: 1_000 * DAY + 3_600 })],
    ];
    // Nothing but the id sets these apart.
    const alike = [book("own-7f3", "Core"), book("copy-9c1", "Core"), book("third-2e5", "core ")];
    for (const books of [...told, alike]) {
      const labels = bookLabels([...books, book("x", "Harbor lore")]);
      expect(new Set(books.map((b) => labels[b.id])).size).toBe(books.length);
      for (const b of books) expect(labels[b.id]?.startsWith(b.name)).toBe(true);
      for (const b of books) expect(labels[b.id]?.includes(b.id)).toBe(books === alike);
      expect(labels.x).toBe("Harbor lore");
    }
  });
});

describe("a secret's helpers", () => {
  test("those that write for the player aren't offered, unless the entry names one already, so it can be unticked", () => {
    const offered = audienceChoices([]);
    expect(offered.filter((p) => PROSE_STEPS.includes(p))).toEqual([]);
    expect(offered).toEqual(LORE_AUDIENCE.filter((p) => !PROSE_STEPS.includes(p)));
    expect(audienceChoices(["brief", "judge"])).toContain("brief");
  });
});

describe.each(Object.keys(STARTER_WORLDS))("%s's example gates", (starter) => {
  const play = new Play(starter);
  const examples = gateExamples(play.world);

  test("each is a gate Save takes, reading only what the world has", () => {
    expect(examples.length).toBeGreaterThan(0);
    for (const x of examples) {
      expect(bookLoreProblem({ secret: true, gate: x.formula })).toBeNull();
      expect(exprReads(x.formula, play.world).reads.filter((r) => r.what === "param")).toEqual([]);
    }
  });

  test("they read the world's state: being where the story starts holds at the start", () => {
    const holds = loreGateReader(registry, play.world, play.state);
    const read = (gate: string) => holds({ id: "x", title: "x", content: "", keys: [], links: [], secret: true, gate });
    expect(examples.filter((x) => read(x.formula)).length).toBeGreaterThan(0);
  });
});
