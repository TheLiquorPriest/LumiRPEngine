// The floor's row "Activated lore: every activated entry appears in the lore map" (§17.1 l.1765;
// PlanGates-4-fix1 item 10), over invented recorded turns: what Lumiverse activated is its own account,
// the generation's WORLD_INFO_ACTIVATED event; a turn passes only when every entry that event names has a
// lore-map id its map shows; each entry that does not is named with how it came in; the run fails on one
// bad turn of ten and names it; the floor's book is held to the lines it was made for, so an entry not
// played on its line is reported "not played", never a pass; and the vector kind is always said: "not
// played: no embeddings connection" (N-21), "pending", or how often it came in.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareLore, loreFold, type ActivatedEntry, type BookDesign, type LoreTurn } from "../../../scripts/proof/lib/lore";
import type { LoreEntry } from "../../../scripts/proof/lib/read";

/** One RPE turn as a floor run records it: Lumiverse's activated entries, the turn route's lore map, and the lore route's entries. */
interface RecordedTurn {
  turn: string;
  line: string;
  lore: { activated: string[]; map: string[] };
  entries: LoreEntry[];
}

const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", name), "utf8")) as T;
const book = fixture<{ book: BookDesign }>("lore-book.json").book;
/** The book with no embeddings connection in Lumiverse: its vector entry never made. */
const unvectored: BookDesign = { ...book, entries: book.entries.filter((e) => e.kind !== "vector"), vectorBlockers: ["embeddings are off in Lumiverse's settings"] };

/** Lumiverse's own event for a recorded turn: each activated entry with its book and title as the turn's entries give them, keyword or vector. */
const eventOf = (t: RecordedTurn): ActivatedEntry[] =>
  t.lore.activated.map((id) => {
    const e = t.entries.find((x) => x.entry === id);
    return { id, book: e?.book ?? null, title: e?.title ?? "an entry of another book", source: e?.how === "vector" ? "vector" : "keyword" };
  });
const input = (t: RecordedTurn) => ({ lumiverse: eventOf(t), map: t.lore.map, entries: t.entries });
const oneTurn = (name: string) => input(fixture<{ turn: RecordedTurn }>(name).turn);
const run = (name: string) => fixture<{ turns: RecordedTurn[] }>(name).turns;
/** The run's turns judged, each on the floor's line it played: the RPE turns play the even lines. */
const judged = (turns: readonly RecordedTurn[]): LoreTurn[] => turns.map((t, i) => ({ turn: t.turn, line: 2 * (i + 1), verdict: compareLore(input(t)), why: null }));

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

  test("an entry in Lumiverse's event and not in the map fails the turn, by its name and kind, though RPE's lore route never listed it", () => {
    const verdict = compareLore(oneTurn("lore-turn-unlisted.json"));
    expect(verdict.pass).toBe(false);
    expect(verdict.missing).toEqual([{ entry: SHOALS, title: "an entry of another book", book: null, id: null, how: "keyword", listed: false }]);
    expect(verdict.hows.unlisted).toBe(1);
    expect(verdict.words).toBe(`1 of 2 activated entries is not in the lore map: "an entry of another book" (book not said, Lumiverse entry ${SHOALS}, came in by keyword): the lore route does not list it, so it has no lore-map id.`);
  });

  test("RPE's own record of the tag is not what Lumiverse activated: an entry the event names fails though RPE's record left it out", () => {
    const turn = fixture<{ turn: RecordedTurn }>("lore-turn-every-kind.json").turn;
    // The lore route and the map know nothing of the shoals; only Lumiverse's event names it.
    const verdict = compareLore({ ...input(turn), lumiverse: [...eventOf(turn), { id: SHOALS, book: "6c3d9e2b-0f4a-4a71-b8e5-1d7c2a9f3b60", title: "The Gull Shoals", source: "keyword" }] });
    expect(verdict.pass).toBe(false);
    expect(verdict.missing.map((m) => [m.title, m.how])).toEqual([["The Gull Shoals", "keyword"]]);
  });

  test("an entry the lore route lists that Lumiverse's event lacks fails the turn: the two accounts disagree", () => {
    const turn = oneTurn("lore-turn-every-kind.json");
    const verdict = compareLore({ ...turn, lumiverse: turn.lumiverse.filter((e) => e.id !== LAMP) });
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
    expect(row.measured).toBe('9 of 10 turns with every activated entry in the lore map, 1 failed; 18 activated entries in the turns judged (10 constant, 2 keyword, 2 vector, 4 sticky). vector: "The lamp" activated in 2 turns.');
  });

  test("the same run with that turn mapped passes, every entry of the book played on the lines it was made for", () => {
    const turns = run("lore-run-ten.json").map((t) => (t.turn === "turn-06" ? { ...t, lore: { ...t.lore, map: [...t.lore.map, "e-31"] } } : t));
    const row = loreFold(judged(turns), book);
    expect(row.verdict).toBe("pass");
    expect(row.why).toEqual([]);
    expect(row.notes).toContain(`Every entry of the floor's book "${book.name}" activated on the lines it was made for and came in as it was made to: "Skerry Rock" as a constant in 10 turns, "The keeper's logbook" by keyword in 1 turn, "The storm" still sticky from an earlier turn in 4 turns, "The lamp" by vector search in 2 turns.`);
  });

  test("an entry of the book Lumiverse did not activate on its line is not played, with its kind and line, and the row is no pass", () => {
    const turns = run("lore-run-ten.json").map((t) => (t.turn === "turn-06" ? { ...t, lore: { ...t.lore, map: [...t.lore.map, "e-31"] } } : t.turn === "turn-02" ? { ...t, lore: { activated: t.lore.activated.filter((id) => id !== STORM), map: t.lore.map }, entries: t.entries.filter((e) => e.entry !== STORM) } : t));
    const row = loreFold(judged(turns), book);
    expect(row.verdict).toBe("not judged");
    expect(row.why).toEqual(['entries of the floor\'s book not played: "The storm" (sticky) on line 4']);
    expect(row.notes).toContain('not played: "The storm" (sticky) on line 4.');
  });

  test("with no embeddings connection the row says the vector kind was not played, and still passes on what was played", () => {
    const row = loreFold(judged(run("lore-run-never-sticky.json")), unvectored);
    expect(row.verdict).toBe("pass");
    expect(row.measured).toContain("vector: not played: no embeddings connection (embeddings are off in Lumiverse's settings).");
    expect(row.notes).toContain('"The storm" of the floor\'s book was made to stay by its sticky count; it activated in 4 turns and never came in still sticky from an earlier turn (4 keyword).');
  });

  test("a vector entry made and not yet indexed is pending; one indexed that never activated is not played, and the row no pass", () => {
    const pending: BookDesign = { ...book, entries: book.entries.map((e) => (e.kind === "vector" ? { ...e, vectorIndex: "pending" } : e)) };
    const never = loreFold(judged(run("lore-run-never-sticky.json")), pending);
    expect(never.measured).toContain('vector: pending ("The lamp" is pending in Lumiverse\'s index, so its vector search cannot find it yet).');
    expect(never.verdict).toBe("pass");
    const indexed = loreFold(judged(run("lore-run-never-sticky.json")), book);
    expect(indexed.verdict).toBe("not judged");
    expect(indexed.measured).toContain("vector: not played: Lumiverse's vector search activated \"The lamp\" on no RPE line.");
  });

  test("a turn with no reading leaves the row not judged and is named; a failing turn still fails the row", () => {
    const unread: LoreTurn = { turn: "turn-11", line: 22, verdict: null, why: "RPE's lore route is not served (PlanLore-13)" };
    const row = loreFold([...judged(run("lore-run-never-sticky.json")), unread], unvectored);
    expect(row.verdict).toBe("not judged");
    expect(row.notes).toContain("Turn turn-11 was not judged: RPE's lore route is not served (PlanLore-13).");
    expect(row.measured).toContain("10 of 11 turns with every activated entry in the lore map, 1 not judged");
    expect(loreFold([...judged(run("lore-run-ten.json")), unread], book).verdict).toBe("fail");
  });

  test("a run whose book activated nothing is not judged, never a pass of empty lists", () => {
    const empty = run("lore-run-never-sticky.json").map((t) => ({ ...t, lore: { activated: [], map: ["w-3"] }, entries: [] }));
    const nothing = loreFold(judged(empty), unvectored);
    expect(nothing.verdict).toBe("not judged");
    expect(nothing.why).toContain("Lumiverse activated no entry in any turn, so nothing was there to find in a lore map");
    expect(nothing.why.join(" ")).toContain('"Skerry Rock" (constant) on line 2');
    // Another book's entry, mapped, does not stand in for the floor's own.
    const shoals: LoreEntry = { id: "e-31", entry: SHOALS, book: "6c3d9e2b-0f4a-4a71-b8e5-1d7c2a9f3b60", title: "The Gull Shoals", how: "keyword" };
    const others = empty.map((t) => ({ ...t, lore: { activated: [SHOALS], map: ["e-31"] }, entries: [shoals] }));
    const notOurs = loreFold(judged(others), unvectored);
    expect(notOurs.verdict).toBe("not judged");
    expect(notOurs.why.join(" ")).toContain('"The storm" (sticky) on line 4');
    expect(loreFold([], unvectored)).toMatchObject({ verdict: "not judged", why: ["no RPE turn was played"] });
  });
});
