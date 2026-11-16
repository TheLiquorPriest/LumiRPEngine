// Memories found by words through the index file: the index only narrows what is read, and what is found is what a scan of every memory finds.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRef, JsonObject, ToolResult } from "rp-harness/contract";
import { lineLog } from "../../src/app";
import { IndexFile } from "../../src/app/index-file/index-file";
import { Workers } from "../../src/app/workers/pool";
import { CAST_DEFAULTS } from "../../src/cast/kit";
import { memoriesNow, strongestFirst, touches } from "../../src/cast/memory";
import { type CastWrite } from "../../src/cast/record";
import { type MemoryIndexPort, MemorySearch } from "../../src/cast/search";
import { type Bench, dataOf, openBench, texts, USER } from "./rig";

const BRAM: AgentRef = { id: "bram-1", definition: "character", plays: "Bram" };

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** The index file on a folder of its own, with what is sent to it and asked of it counted. */
async function openIndex(): Promise<{ port: MemoryIndexPort; sent: { docs: number; searches: number } }> {
  const dir = mkdtempSync(join(tmpdir(), "rpe-cast-search-"));
  const log = lineLog(() => undefined);
  const workers = new Workers({ threads: 1, name: "the cast search test's pool", log });
  const index = await IndexFile.open({ path: join(dir, "index.db"), workers, batch: 200, log });
  closers.push(async () => {
    await index.close();
    await workers.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const sent = { docs: 0, searches: 0 };
  const port: MemoryIndexPort = {
    put: (name, user, docs) => {
      sent.docs += docs.length;
      return index.put(name, user, docs);
    },
    search: (name, user, query, options) => {
      sent.searches += 1;
      return index.search(name, user, query, options);
    },
  };
  return { port, sent };
}

/** Bram cast as a principal; his character id. */
async function bram(b: Bench): Promise<string> {
  const turn = await b.t.begin();
  await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id);
  await b.t.tie(turn);
  return b.t.record().items.values().find((i) => i.part === "casting")?.character ?? "";
}

/** Memories written on one turn of their own. */
async function write(b: Bench, writes: readonly CastWrite[]): Promise<void> {
  const turn = await b.t.begin();
  await b.t.write(turn, writes);
  await b.t.tie(turn);
}

const memory = (character: string, value: JsonObject, item: string | null = null): CastWrite => ({ character, part: "memory", item, value });

/** What a recall of `cue` brings back, by text, in the order it comes. */
async function recalled(b: Bench, cue: string): Promise<string[]> {
  const turn = await b.t.begin();
  const r: ToolResult = await b.call("recall", { cue }, turn.id, BRAM);
  await b.t.tie(turn);
  return r.error === undefined && texts(r)[0]?.startsWith("Nothing comes back") !== true ? (dataOf(r).memories as JsonObject[]).map((m) => String(m.text)) : [];
}

describe("memories found by words through the index", () => {
  test("a memory written, changed and struck is found, found by its new words, and not found", async () => {
    const { port } = await openIndex();
    const b = await openBench({ search: new MemorySearch(port) });
    const who = await bram(b);
    await write(b, [memory(who, { text: "The ferryman owes me a coin.", gist: "Ferryman's debt." })]);
    expect(await recalled(b, "ferryman")).toEqual(["The ferryman owes me a coin."]);

    const id = b.t.record().of(who, "memory")[0]?.id ?? "";
    await write(b, [memory(who, { text: "The miller owes me a coin.", gist: "Miller's debt." }, id)]);
    expect(await recalled(b, "miller")).toEqual(["The miller owes me a coin."]);
    expect(await recalled(b, "ferryman")).toEqual([]);

    await write(b, [memory(who, { drop: true }, id)]);
    expect(await recalled(b, "miller")).toEqual([]);
  });

  test("with 800 memories, recall of a word finds the same memories the scan finds", async () => {
    const { port } = await openIndex();
    const search = new MemorySearch(port);
    const b = await openBench({ search });
    const who = await bram(b);
    const nouns = ["lantern", "ferry", "anvil", "granary", "bell", "kiln", "orchard", "weir", "chapel", "tannery", "well", "loom", "forge", "stile", "barn", "quay", "mill", "apiary", "cooper", "ford"];
    const places = ["hollow", "market", "bridge", "green", "shore", "gate", "crossroads"];
    await write(
      b,
      Array.from({ length: 800 }, (_, i) =>
        memory(who, { text: `Tale ${i}: the ${nouns[i % nouns.length]} waited by the ${places[i % places.length]}, and ${i % 40 === 0 ? "Wren Hale spoke" : "no one spoke"}.`, gist: `Tale ${i}`, ...(i % 40 === 0 ? { who: ["Wren"] } : {}) }),
      ),
    );
    const record = b.t.record();
    const clock = b.t.s.headState("chat-a").state.world.clock;
    const standing = memoriesNow(record, who, clock, CAST_DEFAULTS);
    expect(standing).toHaveLength(800);
    for (const cue of ["lantern", "Wren Hale", "the kiln by the hollow", "granary", "dragon", "Wren"]) {
      const scanned = standing.filter((m) => touches(m.item, [cue])).map((m) => m.item.id).sort();
      const found = await search.candidates(USER, record, who, [cue]);
      const read = standing.filter((m) => found!.has(m.item.id) && touches(m.item, [cue])).map((m) => m.item.id).sort();
      expect(read).toEqual(scanned);
      // The index narrows what is read: a rare word reads a few of the 800.
      if (cue === "lantern") expect(found!.size).toBeLessThan(100);
    }
    const first = standing.filter((m) => touches(m.item, ["ford"])).sort(strongestFirst).slice(0, CAST_DEFAULTS.recallItems);
    const back = await recalled(b, "ford");
    expect(back).toEqual(first.map((m) => String(m.item.fields.text)));
  });

  test("recall over 800 memories reads the index, not every memory: each text goes to the index once, and a recall asks it once for each word", async () => {
    const { port, sent } = await openIndex();
    const b = await openBench({ search: new MemorySearch(port) });
    const who = await bram(b);
    await write(
      b,
      Array.from({ length: 800 }, (_, i) => memory(who, { text: `Tale ${i} of the ${i % 2 === 0 ? "lantern" : "anvil"}.`, gist: `Tale ${i}` })),
    );
    expect((await recalled(b, "lantern")).length).toBe(CAST_DEFAULTS.recallItems);
    expect(sent.docs).toBe(800);
    expect(sent.searches).toBe(1);
    // The ten it brought back were recalled, so each is written again; nothing else is sent to the index.
    expect((await recalled(b, "the anvil")).length).toBe(CAST_DEFAULTS.recallItems);
    expect(sent.docs).toBe(800 + CAST_DEFAULTS.recallItems);
    expect(sent.searches).toBe(3);
  });
});
