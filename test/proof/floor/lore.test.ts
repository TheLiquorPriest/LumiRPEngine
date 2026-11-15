// The floor's row "Activated lore: every activated entry appears in the lore map" (§17.1 l.1765), over
// invented recorded turns: a turn passes only when every entry Lumiverse activated has a lore-map id its
// map shows; each entry that does not is named with how it came in; the run fails on one bad turn of ten
// and names it; and the floor's book is held to its design, so an entry that never activated, a sticky
// entry never seen sticky, or a run that activated nothing is reported and never passes for an empty list.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareLore, loreFold, type BookDesign, type LoreTurn } from "../../../scripts/proof/lib/lore";
import type { LoreEntry } from "../../../scripts/proof/lib/read";

/** One RPE turn as a floor run records it: the turn route's `lore` and the lore route's entries. */
interface RecordedTurn {
  turn: string;
  line: string;
  lore: { activated: string[]; map: string[] };
  entries: LoreEntry[];
}

const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", name), "utf8")) as T;
const book = fixture<{ book: BookDesign }>("lore-book.json").book;
/** What `compareLore` reads of a recorded turn. */
const input = (t: RecordedTurn) => ({ activated: t.lore.activated, map: t.lore.map, entries: t.entries });
const oneTurn = (name: string) => input(fixture<{ turn: RecordedTurn }>(name).turn);
const run = (name: string) => fixture<{ turns: RecordedTurn[] }>(name).turns;
const judged = (turns: readonly RecordedTurn[]): LoreTurn[] => turns.map((t) => ({ turn: t.turn, verdict: compareLore(input(t)), why: null }));

const STORM = "c90e5a37-1f4b-4d8a-a6c2-73b5f0e2d918";
const LAMP = "d4a8f2c6-9e31-4b07-8d5a-0c6e3f7b1a29";
const SHOALS = "e5b90c14-6d2f-4e8b-9a37-4f1c8e2d7b05";

describe("one RPE turn", () => {
  test("a turn with one activated entry missing from its lore map fails, and names it with how it came in", () => {
    const verdict = compareLore(oneTurn("lore-turn-missing.json"));
    expect(verdict.pass).toBe(false);
    expect(verdict.missing).toEqual([{ entry: STORM, title: "The storm", book: book.id, id: "e-14", how: "sticky", listed: true }]);
    expect(verdict.words).toBe(`1 of 4 activated entries is not in the lore map: "The storm" (book ${book.id}, Lumiverse entry ${STORM}, came in still sticky from an earlier turn): its lore-map id e-14 is not in the map.`);
  });

  test("a turn whose every activated entry, one of each kind, is in its lore map passes", () => {
    const verdict = compareLore(oneTurn("lore-turn-every-kind.json"));
    expect(verdict.pass).toBe(true);
    expect(verdict.missing).toEqual([]);
    expect(verdict.hows).toEqual({ constant: 1, keyword: 1, vector: 1, sticky: 1, unsaid: 0, unlisted: 0 });
    expect(verdict.words).toBe("All 4 activated entries are in the lore map (1 constant, 1 keyword, 1 vector, 1 sticky).");
  });

  test("an activated entry the lore route does not list fails the turn, named as having no lore-map id", () => {
    const verdict = compareLore(oneTurn("lore-turn-unlisted.json"));
    expect(verdict.pass).toBe(false);
    expect(verdict.missing).toEqual([{ entry: SHOALS, title: null, book: null, id: null, how: null, listed: false }]);
    expect(verdict.hows.unlisted).toBe(1);
    expect(verdict.words).toBe(`1 of 2 activated entries is not in the lore map: Lumiverse entry ${SHOALS}: the lore route does not list it, so it has no lore-map id.`);
  });

  test("an entry the lore route lists that the turn's activated list lacks fails the turn: the two accounts disagree", () => {
    const turn = oneTurn("lore-turn-every-kind.json");
    const verdict = compareLore({ ...turn, activated: turn.activated.filter((id) => id !== LAMP) });
    expect(verdict.pass).toBe(false);
    expect(verdict.missing).toEqual([]);
    expect(verdict.unmatched.map((e) => e.entry)).toEqual([LAMP]);
    expect(verdict.words).toContain('"The lamp" (Lumiverse entry');
  });
});

describe("the run", () => {
  test("the row fails on one bad turn of ten, and names that turn alone with the entry it misses and how it came in", () => {
    const row = loreFold(judged(run("lore-run-ten.json")), book);
    expect(row.verdict).toBe("fail");
    const failed = row.notes.filter((n) => / failed: /.test(n));
    expect(failed).toEqual([`Turn turn-06 failed: 1 of 2 activated entries is not in the lore map: "The Gull Shoals" (book 6c3d9e2b-0f4a-4a71-b8e5-1d7c2a9f3b60, Lumiverse entry ${SHOALS}, came in by keyword): its lore-map id e-31 is not in the map.`]);
    expect(row.measured).toBe("9 of 10 turns with every activated entry in the lore map, 1 failed; 18 activated entries in the turns judged (10 constant, 2 keyword, 2 vector, 4 sticky).");
    expect(row.notes).toContain(`Every entry of the floor's book "${book.name}" came in as it was made to: "Skerry Rock" as a constant in 10 turns, "The keeper's logbook" by keyword in 1 turn, "The storm" still sticky from an earlier turn in 4 turns, "The lamp" by vector search in 2 turns.`);
  });

  test("the same run with that turn mapped passes", () => {
    const turns = run("lore-run-ten.json").map((t) => (t.turn === "turn-06" ? { ...t, lore: { ...t.lore, map: [...t.lore.map, "e-31"] } } : t));
    const row = loreFold(judged(turns), book);
    expect(row.verdict).toBe("pass");
    expect(row.notes.some((n) => / failed: /.test(n))).toBe(false);
  });

  test("a run in which the sticky entry never showed as sticky is reported, as is the book's entry that never activated", () => {
    const row = loreFold(judged(run("lore-run-never-sticky.json")), book);
    expect(row.verdict).toBe("pass");
    expect(row.notes).toContain('"The storm" of the floor\'s book was made to stay by its sticky count; it activated in 4 turns and never came in still sticky from an earlier turn (4 keyword).');
    expect(row.notes).toContain(`Of the floor's book "${book.name}", never activated: "The lamp" (made to come in by vector search).`);
  });

  test("a turn with no reading leaves the row not judged and is named; a failing turn still fails the row", () => {
    const unread: LoreTurn = { turn: "turn-11", verdict: null, why: "RPE's lore route answered 404" };
    const row = loreFold([...judged(run("lore-run-never-sticky.json")), unread], book);
    expect(row.verdict).toBe("not judged");
    expect(row.notes).toContain("Turn turn-11 was not judged: RPE's lore route answered 404.");
    expect(row.measured).toContain("10 of 11 turns with every activated entry in the lore map, 1 not judged");
    expect(loreFold([...judged(run("lore-run-ten.json")), unread], book).verdict).toBe("fail");
  });

  test("a run whose book activated nothing is not judged, never a pass of empty lists", () => {
    const empty = run("lore-run-never-sticky.json").map((t) => ({ ...t, lore: { activated: [], map: ["w-3"] }, entries: [] }));
    const nothing = loreFold(judged(empty), book);
    expect(nothing.verdict).toBe("not judged");
    expect(nothing.notes).toContain("Lumiverse activated no entry in any turn, so nothing was there to find in a lore map.");
    expect(nothing.notes).toContain(`Of the floor's book "${book.name}", never activated: "Skerry Rock" (made to be constant), "The keeper's logbook" (made to come in by keyword), "The storm" (made to stay by its sticky count), "The lamp" (made to come in by vector search).`);
    // Another book's entry, mapped, does not stand in for the floor's own.
    const shoals: LoreEntry = { id: "e-31", entry: SHOALS, book: "6c3d9e2b-0f4a-4a71-b8e5-1d7c2a9f3b60", title: "The Gull Shoals", how: "keyword" };
    const others = empty.map((t) => ({ ...t, lore: { activated: [SHOALS], map: ["e-31"] }, entries: [shoals] }));
    const notOurs = loreFold(judged(others), book);
    expect(notOurs.verdict).toBe("not judged");
    expect(notOurs.notes).toContain("None of the floor's book's entries activated, so the ways an entry comes in were not tried.");
    expect(loreFold([], book)).toMatchObject({ verdict: "not judged", measured: "No RPE turn was played." });
  });
});
