// The Lore page: the index a page at a time with each entry's kind, line and what it defines, entries no run has
// indexed shown by title and keys, a search over the entries, "Index now" naming its connection, and the
// overlays of the chat's path.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { LoreIndexRow, LoreProposal } from "../../src/shared/api";
import { refreshedWords } from "../../src/ui/pages/lore/projection";
import { approvalOf } from "../../src/ui/pages/lore/proposals";
import { type IndexingShown, loreMatches, LoreView, type LoreViewProps } from "../../src/ui/pages/lore";
import { kindChoices } from "../../src/ui/pages/lore/entry-lines";
import { readIndex, startIndexing } from "../../src/ui/pages/lore/read";
import { askingClient, settle } from "./asking";
import { expand, press, textOf } from "./vnodes";

const row = (n: number, over: Partial<LoreIndexRow> = {}): LoreIndexRow => ({ id: `e-${n}`, title: `Entry ${n}`, source: "The Book", book: "b1", keys: [`key${n}`], size: 100 + n, activation: ["keyword"], revision: "r", kind: "place", line: `Line ${n}`, defines: [{ what: "place", aspect: "town" }], related: [], fields: {}, indexed: true, stale: false, edited: [], links: [], ...over });

function view(over: Partial<LoreViewProps> = {}) {
  const asked: string[] = [];
  const indexing: IndexingShown = { busy: false, job: null, problem: null };
  const props: LoreViewProps = {
    chat: "c-1",
    index: { items: Array.from({ length: 60 }, (_, i) => row(i + 1)), more: false, loading: false, problem: null },
    query: "",
    status: { entries: 60, unindexed: 0, stale: 0, kinds: ["place"], agent: "indexer", connection: { id: "c1", name: "Flash" }, model: "deepseek-v4-flash" },
    statusProblem: null,
    overlays: { overlays: [{ id: 1, entry: "e-3", title: "Entry 3", note: "The inn burned down.", turn: 4, turnId: "t-4", by: "the Author", agent: null }] },
    overlaysProblem: null,
    indexing,
    onQuery: (q) => void asked.push(`query:${q}`),
    onMore: () => void asked.push("more"),
    onIndex: () => void asked.push("index"),
    onIndexEnded: () => void asked.push("indexed"),
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
    const { text } = view({ status: { entries: 3, unindexed: 3, stale: 0, kinds: [], agent: "indexer", connection: null, model: null }, indexing: { busy: false, job: null, problem: "Jobs are off." } });
    expect(text).toContain("No connection is there for the indexer to run on");
    expect(text).toContain("Jobs are off.");
  });

  test("an entry changed after it was indexed says so, shows the line it has as of the earlier text and offers indexing again", () => {
    const page = view({
      status: { entries: 2, unindexed: 1, stale: 1, kinds: [], agent: "indexer", connection: { id: "c1", name: "Flash" }, model: null },
      index: { items: [row(1, { indexed: false, stale: true, line: "The old gate keeper." }), row(2)], more: false, loading: false, problem: null },
    });
    expect(page.text).toContain("The old gate keeper.");
    expect(page.text).toContain("out of date");
    expect(page.text).toContain("Indexed at an earlier revision; the entry has changed since, so the line above is of its earlier text.");
    expect(page.text).not.toContain("Not indexed yet");
    expect(page.text).toContain("2 entries; 1 not indexed as it stands now, it was indexed at an earlier revision and has changed since.");
    press(page.tree, "Index again");
    expect(page.asked).toEqual(["index"]);
  });

  test("the choices of a kind are the shipped indexer's kinds, then every other kind the chat's index holds, then the entry's own, none held to any", () => {
    const choices = kindChoices(["place", "Wandering Guild", "relic"], "Seeker's rite");
    expect(choices.slice(0, 8)).toEqual(["character", "place", "item", "faction", "rule", "event", "concept", "style"]);
    expect(choices.slice(8)).toEqual(["Wandering Guild", "relic", "Seeker's rite"]);
    expect(kindChoices([], null)).toHaveLength(8);
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

describe("proposals, writes and the projection", () => {
  const proposal = (over: Partial<LoreProposal> = {}): LoreProposal => ({ id: 3, chat: "c1", turn: "t-2", agent: "historian", target: "e-1", text: "The ferry runs at dawn.", was: "The ferry runs at noon.", book: null, title: null, keys: null, world: null, reason: "The story moved it.", status: "open", refused: null, created: 1, decided: null, write: null, ...over });

  test("an approval sends only what he changed of the draft", () => {
    const p = proposal();
    expect(approvalOf(p, { text: p.text, title: "", keys: "", book: "" })).toEqual({});
    expect(approvalOf(p, { text: "The ferry runs at dusk.", title: "x", keys: "a", book: "b" })).toEqual({ text: "The ferry runs at dusk." });
    const made = proposal({ target: null, was: null, title: "Ferry", keys: ["ferry"], book: "bk" });
    expect(approvalOf(made, { text: made.text, title: "The ferry", keys: "ferry, river", book: "bk" })).toEqual({ title: "The ferry", keys: ["ferry", "river"] });
  });

  test("what an Apply now did is said in words", () => {
    expect(refreshedWords({ on: false, book: null, written: false, removed: "bk" })).toContain("taken away");
    expect(refreshedWords({ on: true, book: "bk", written: true, removed: null })).toContain("written again");
  });
});
