// The line diff behind Settings → Agents → Prompts' Compare with shipped (`shared/text-diff.ts`): its
// kept and taken-out lines are the text before and its kept and added ones the text after, whatever
// the two texts; it keeps as many lines as any diff could (a longest common subsequence), each
// change's lines taken out before those added in their place, even past the table it searches with;
// and it reads with a few unchanged lines around each change, the longer runs folded to a count.

import { describe, expect, test } from "bun:test";
import { diffCounts, diffRows, type DiffLine, lineDiff } from "../../src/shared/text-diff";

/** The text a diff's lines make on one side: the kept and taken-out lines before, the kept and added ones after. */
function side(lines: readonly DiffLine[], which: "before" | "after"): string {
  return lines
    .filter((l) => l.kind === "same" || l.kind === (which === "before" ? "del" : "add"))
    .map((l) => l.text)
    .join("\n");
}

/** The longest common subsequence of two texts' lines, by the plain table. */
function lcsLength(a: string, b: string): number {
  const x = a === "" ? [] : a.split("\n");
  const y = b === "" ? [] : b.split("\n");
  const t: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  return t[0][0];
}

/** A seeded run of small texts over few line values, so lines repeat and changes interleave. */
function* randomPairs(seed: number, count: number): Generator<[string, string]> {
  let s = seed >>> 0;
  const next = (n: number): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s % n;
  };
  const text = (): string => Array.from({ length: next(9) }, () => ["a", "b", "c", "", "d"][next(5)]).join("\n");
  for (let k = 0; k < count; k++) yield [text(), text()];
}

/** Whether every change's taken-out lines come before its added ones: no taken-out line straight after an added one. */
function delsFirst(lines: readonly DiffLine[]): boolean {
  return lines.every((l, i) => !(l.kind === "del" && lines[i - 1]?.kind === "add"));
}

describe("lineDiff", () => {
  test("reads a changed line as taken out and added, around the lines both keep", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
    expect(diffCounts(lineDiff("a\nb\nc", "a\nB\nc\nd"))).toEqual({ removed: 1, added: 2 });
  });

  test("an empty text has no lines; a last line break makes an empty last line", () => {
    expect(lineDiff("", "")).toEqual([]);
    expect(lineDiff("", "a")).toEqual([{ kind: "add", text: "a" }]);
    expect(lineDiff("a", "")).toEqual([{ kind: "del", text: "a" }]);
    expect(lineDiff("a", "a\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "add", text: "" },
    ]);
    expect(lineDiff("same\ntext", "same\ntext")).toEqual([
      { kind: "same", text: "same" },
      { kind: "same", text: "text" },
    ]);
  });

  test("makes both texts back, keeps as many lines as can be kept, and takes out before it adds, on any texts", () => {
    for (const [before, after] of randomPairs(7, 400)) {
      const lines = lineDiff(before, after);
      expect({ before, after, made: [side(lines, "before"), side(lines, "after")] }).toEqual({ before, after, made: [before, after] });
      expect({ before, after, kept: lines.filter((l) => l.kind === "same").length }).toEqual({ before, after, kept: lcsLength(before, after) });
      expect({ before, after, delsFirst: delsFirst(lines) }).toEqual({ before, after, delsFirst: true });
    }
  });

  test("past its table a change reads as every line taken out, then added, between the lines both start and end with", () => {
    const middle = (tag: string) => Array.from({ length: 1200 }, (_, i) => `${tag} ${i}`).join("\n");
    const before = `start\n${middle("old")}\nend`;
    const after = `start\n${middle("new")}\nend`;
    const lines = lineDiff(before, after);
    expect([side(lines, "before"), side(lines, "after")]).toEqual([before, after]);
    expect(lines[0]).toEqual({ kind: "same", text: "start" });
    expect(lines.at(-1)).toEqual({ kind: "same", text: "end" });
    expect(lines.slice(1, -1).map((l) => l.kind)).toEqual([...new Array<DiffLine["kind"]>(1200).fill("del"), ...new Array<DiffLine["kind"]>(1200).fill("add")]);
  });
});

describe("diffRows", () => {
  const same = (n: number, from = 0): DiffLine[] => Array.from({ length: n }, (_, i) => ({ kind: "same", text: `line ${from + i}` }));

  test("shows two unchanged lines either side of a change and folds the runs beyond to their count", () => {
    const lines: DiffLine[] = [...same(10), { kind: "del", text: "old" }, { kind: "add", text: "new" }, ...same(10, 10)];
    expect(diffRows(lines)).toEqual([{ kind: "skip", count: 8 }, ...same(2, 8), { kind: "del", text: "old" }, { kind: "add", text: "new" }, ...same(2, 10), { kind: "skip", count: 8 }]);
  });

  test("never folds a lone unchanged line, and shows the lines between close changes whole", () => {
    const lines: DiffLine[] = [{ kind: "add", text: "x" }, ...same(5), { kind: "add", text: "y" }];
    expect(diffRows(lines)).toEqual([{ kind: "add", text: "x" }, ...same(2), { kind: "same", text: "line 2" }, ...same(2, 3), { kind: "add", text: "y" }]);
    expect(diffRows([...same(3)], 1)).toEqual([{ kind: "skip", count: 3 }]);
    expect(diffRows([...same(1)])).toEqual(same(1));
  });
});
