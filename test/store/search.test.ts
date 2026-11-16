// The state search (plan §4.7, §6.8): a thing found by any word said of it, from an index of tokens kept in step with each chat's head.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineLog } from "../../src/app";
import { IndexFile } from "../../src/app/index-file/index-file";
import { Workers } from "../../src/app/workers/pool";
import { indexedSearch, stateScan } from "../../src/iface/search";
import { factStore } from "../../src/store/facts";
import { StateIndex } from "../../src/store/search";
import { STORE_OPS, type ChangeInput } from "../../src/store/types";
import { bigWorld } from "./measure";
import { engine, goTo, hashOf, make, play, POV, shown, testStore, type TestStore, USER } from "./fixtures";

let dir = "";
let workers: Workers;
let index: IndexFile;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "rpe-state-search-"));
  const log = lineLog(() => undefined);
  workers = new Workers({ threads: 1, name: "the state search test's pool", log });
  index = await IndexFile.open({ path: join(dir, "index.db"), workers, batch: 500, log });
});

afterEach(async () => {
  await index.close();
  await workers.close();
  rmSync(dir, { recursive: true, force: true });
});

const fact = (about: string, key: string, value: string): ChangeInput => ({ lane: "engine", ...factStore.change({ about, key, value }), by: "gm", source: "prose" });
const note = (at: string, text: string): ChangeInput => ({ lane: "engine", op: STORE_OPS.note, value: { at, text }, by: "gm", source: "prose" });

function follower(ts: TestStore, settle = 0): StateIndex {
  const found = new StateIndex({ store: ts.store, index, settle });
  ts.store.onWrite((user, chats) => found.notify(user, chats));
  return found;
}

const names = async (found: StateIndex, ts: TestStore, words: string, chat = "c"): Promise<string[]> => {
  const head = ts.s.headState(chat).state;
  return (await found.search(USER, chat, head, ts.store.env, words, { limit: 10 })).map((f) => f.ref);
};

describe("the state search", () => {
  test("a thing is found by a word in one of its facts, a note on it, its kind, and by its names first", async () => {
    const ts = testStore();
    ts.s.createChat({ id: "c", revision: ts.revision });
    play(ts.s, "c", "m1", "Bram pours.", 1, [fact("entity:bram", "feud", "he owes the miller for barley"), note("entity:odile", "hums while she works"), fact("place:cellar", "smell", "damp straw")]);
    const found = follower(ts);
    expect(await names(found, ts, "barley")).toEqual(["entity:bram"]);
    expect(await names(found, ts, "hums")).toEqual(["entity:odile"]);
    expect(await names(found, ts, "straw")).toEqual(["place:cellar"]);
    // Whole names first, then names holding every word, then some, then the rest of what is said.
    expect((await names(found, ts, "cask of cider"))[0]).toBe("entity:cask");
    expect(await names(found, ts, "grey cloak")).toEqual(["entity:cloak"]);
    const head = ts.s.headState("c").state;
    expect((await found.search(USER, "c", head, ts.store.env, "wren coin", { limit: 10 })).map((f) => [f.ref, f.score])).toEqual([["entity:acct_wren", 4], ["entity:purse", 2], ["entity:wren", 2]]);
    // The scan of the state, with no index, says the same.
    expect(stateScan.search(head, ts.store.env, "wren coin", { limit: 10 }).map((h) => h.ref)).toEqual(["entity:acct_wren", "entity:purse", "entity:wren"]);
    expect(await indexedSearch(found, { user: USER, chat: "c" }).search(head, ts.store.env, "barley", { limit: 10 })).toEqual(stateScan.search(head, ts.store.env, "barley", { limit: 10 }));
  });

  test("the index follows the head after a turn, a swipe and a delete", async () => {
    const ts = testStore();
    const { s } = ts;
    s.createChat({ id: "c", revision: ts.revision });
    const t1 = play(s, "c", "m1", "Bram pours.", 1, engine(make("lantern", "Lantern", POV)));
    const found = follower(ts);
    expect(await names(found, ts, "lantern")).toEqual(["entity:lantern"]);
    // A turn: a fact on the lantern, found once the index has followed the head.
    play(s, "c", "m2", "She trims it.", 2, [fact("entity:lantern", "wick", "newly trimmed")]);
    await found.settle();
    expect(await index.search("facts", USER, "trimmed", { scope: "c\u0000s", limit: 5 })).toHaveLength(1);
    expect(await names(found, ts, "trimmed")).toEqual(["entity:lantern"]);
    // A swipe of the second reply with no such fact: the head's index follows it.
    const swipe = s.beginTurn({ chat: "c", kind: "swipe", on: t1.node });
    s.addChanges(swipe.id, engine(make("candle", "Candle", POV)));
    s.tieTurn(swipe.id, { message: "m2", hash: hashOf("She puts it out."), date: 3 });
    s.sync("c", shown(["u1", "go"], ["m1", "Bram pours.", 1], ["u2", "light"], ["m2", "She puts it out.", 3]));
    await found.settle();
    expect(await index.search("facts", USER, "trimmed", { scope: "c\u0000s", limit: 5 })).toHaveLength(0);
    expect(await names(found, ts, "trimmed")).toEqual([]);
    expect(await names(found, ts, "candle")).toEqual(["entity:candle"]);
    // A delete of the last reply: the candle is no more.
    s.sync("c", shown(["u1", "go"], ["m1", "Bram pours.", 1]));
    await found.settle();
    expect(await index.search("facts", USER, "candle", { scope: "c\u0000n", limit: 5 })).toHaveLength(0);
    expect(await names(found, ts, "candle")).toEqual([]);
    expect(await names(found, ts, "lantern")).toEqual(["entity:lantern"]);
  });

  test("what a turn in progress changed is found at once, before the index has followed", async () => {
    const ts = testStore();
    ts.s.createChat({ id: "c", revision: ts.revision });
    play(ts.s, "c", "m1", "Bram pours.", 1, engine(goTo(POV, "cellar")));
    const found = follower(ts);
    expect(await names(found, ts, "barley")).toEqual([]);
    const t = ts.s.beginTurn({ chat: "c", kind: "normal" });
    const { state } = ts.s.addChanges(t.id, [fact("entity:bram", "feud", "owes for barley")]);
    expect((await found.search(USER, "c", state, ts.store.env, "barley", { limit: 10 })).map((f) => f.ref)).toEqual(["entity:bram"]);
    expect(hashOf("never")).not.toBe(hashOf("seen"));
  });

  test("search on 5,000 things within its guard", async () => {
    const ts = testStore({ world: bigWorld() });
    ts.s.createChat({ id: "c", revision: ts.revision });
    play(ts.s, "c", "m1", "A quiet day.", 1, [fact("entity:person_77", "habit", "keeps bees on the roof"), fact("entity:person_912", "habit", "never keeps a promise")]);
    // A long quiet time, so that the pass after the turn is the one `settle` makes below, and is the one timed.
    const found = follower(ts, 60_000);
    const head = () => ts.s.headState("c");
    const t0 = performance.now();
    const first = await found.search(USER, "c", head().state, ts.store.env, "bees", { limit: 10 });
    const fed = performance.now() - t0;
    expect(first.map((f) => f.ref)).toEqual(["entity:person_77"]);
    const t1 = performance.now();
    for (let i = 0; i < 20; i++) await found.search(USER, "c", head().state, ts.store.env, "bees roof", { limit: 10 });
    const search = (performance.now() - t1) / 20;
    play(ts.s, "c", "m2", "A bee stings.", 2, [fact("entity:person_77", "mood", "stung and cross")]);
    const t2 = performance.now();
    await found.settle();
    const followed = performance.now() - t2;
    expect((await found.search(USER, "c", head().state, ts.store.env, "cross", { limit: 10 })).map((f) => f.ref)).toEqual(["entity:person_77"]);
    console.log(`state search on 5,000 things: first read and feed ${fed.toFixed(0)} ms, a search ${search.toFixed(1)} ms, following a turn ${followed.toFixed(1)} ms`);
    // Guards (R-15), not targets: a search far inside a second, a turn followed far inside a search of the whole state.
    expect(search).toBeLessThan(250);
    expect(followed).toBeLessThan(1000);
  });
});
