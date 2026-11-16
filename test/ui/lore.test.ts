// The Lore page: the index a page at a time with each entry's kind, line and what it defines, entries no run has
// indexed shown by title and keys, a search over the entries, "Index now" naming its connection, and the
// overlays of the chat's path.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { LoreIndexRow } from "../../src/shared/api";
import { type IndexingShown, loreMatches, LoreView, type LoreViewProps } from "../../src/ui/pages/lore";
import { readIndex, startIndexing } from "../../src/ui/pages/lore/read";
import { askingClient, settle } from "./asking";
import { expand, press, textOf } from "./vnodes";

const row = (n: number, over: Partial<LoreIndexRow> = {}): LoreIndexRow => ({ id: `e-${n}`, title: `Entry ${n}`, source: "The Book", book: "b1", keys: [`key${n}`], size: 100 + n, activation: ["keyword"], revision: "r", kind: "place", line: `Line ${n}`, defines: [{ what: "place", aspect: "town" }], related: [], fields: {}, indexed: true, stale: false, edited: [], links: [], ...over });

function view(over: Partial<LoreViewProps> = {}) {
  const asked: string[] = [];
  const indexing: IndexingShown = { busy: false, job: null, problem: null };
  const props: LoreViewProps = {
    index: { items: Array.from({ length: 60 }, (_, i) => row(i + 1)), more: false, loading: false, problem: null },
    query: "",
    status: { entries: 60, unindexed: 0, agent: "indexer", connection: { id: "c1", name: "Flash" }, model: "deepseek-v4-flash" },
    statusProblem: null,
    overlays: { overlays: [{ id: 1, entry: "e-3", title: "Entry 3", note: "The inn burned down.", turn: 4, turnId: "t-4", by: "the Author", agent: null }] },
    overlaysProblem: null,
    indexing,
    onQuery: (q) => void asked.push(`query:${q}`),
    onMore: () => void asked.push("more"),
    onIndex: () => void asked.push("index"),
    onTurn: (t) => void asked.push(`turn:${t}`),
    ...over,
  };
  const tree = expand(h(LoreView, props));
  return { tree, text: textOf(tree), asked };
}

describe("the Lore page", () => {
  test("a 60-entry book lists 60 entries with kinds and what each defines", () => {
    const { text } = view();
    expect(text.match(/Defines: place \(town\)/g)?.length).toBe(60);
    expect(text).toContain("Entry 60");
    expect(text).toContain("Line 7");
  });

  test("an entry no run has indexed is shown by its title and keys", () => {
    const { text } = view({ index: { items: [row(1, { indexed: false, kind: null, line: null, defines: [], keys: ["inn", "tavern"] })], more: false, loading: false, problem: null } });
    expect(text).toContain("Not indexed yet; its keys: inn, tavern.");
    expect(text).toContain("Entry 1");
  });

  test("the search matches title, key, kind, line and what it defines", () => {
    expect(loreMatches(row(1), "key1")).toBe(true);
    expect(loreMatches(row(1), "TOWN")).toBe(true);
    expect(loreMatches(row(1), "nothing like it")).toBe(false);
  });

  test("Index now names the connection the indexer runs on, and an overlay opens its turn", () => {
    const page = view();
    expect(page.text).toContain("on the connection Flash, model deepseek-v4-flash");
    press(page.tree, "Index now");
    press(page.tree, "Open turn 4");
    expect(page.asked).toEqual(["index", "turn:t-4"]);
    expect(page.text).toContain("The inn burned down.");
  });

  test("with no connection there is none to index on, and RPE's refusal is shown in its words", () => {
    const { text } = view({ status: { entries: 3, unindexed: 3, agent: "indexer", connection: null, model: null }, indexing: { busy: false, job: null, problem: "Jobs are off." } });
    expect(text).toContain("No connection is there for the indexer to run on");
    expect(text).toContain("Jobs are off.");
  });

  test("the routes are read from the chat, a page at a time, and the job is started as a post", async () => {
    const { client, asked } = askingClient();
    const first = readIndex(client, "c-1", undefined);
    asked.find((a) => a.key === "GET /api/v1/chats/:chat/lore/index")?.answer({ items: [row(1)], next: "n1" });
    expect((await first).next).toBe("n1");
    const started = startIndexing(client, "c-1");
    asked.find((a) => a.key === "POST /api/v1/chats/:chat/lore/index/jobs")?.answer({ job: "j-1", state: "queued" });
    await settle();
    expect((await started).job).toBe("j-1");
  });
});
