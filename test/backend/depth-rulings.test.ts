// The owner's 8 Nov rulings (DEPTH-PLAN, Round 2 item 4). W5: a settlement past its pins' bound reads
// them a page at a time in story order, the archive to hand, each page's verdict going on to the next,
// and the author decides with them all; a page that found the draft contradicted refuses a settlement
// that changes nothing. W17: the on-screen allowance counts a story interval's turns with someone
// playing as their own agent, is said to the author, and is honoured as it casts.

import { describe, expect, test } from "bun:test";
import { budgetWords, onScreenAllowance, type TurnBudget } from "../../src/backend/depth/budget";
import { DepthAnswerError } from "../../src/backend/depth/common";
import { settleRead } from "../../src/backend/depth/offscreen/author";
import { PINS_MOST, readDraft } from "../../src/backend/depth/offscreen/settle";
import { readPaged } from "../../src/backend/depth/paging";
import type { ModelPort, PortAnswer } from "../../src/backend/depth/port";
import { authorSetup } from "../../src/backend/depth/scene/author";
import { onScreenSpent } from "../../src/backend/depth/spend";
import type { SpendData } from "../../src/shared/author";
import type { DraftData } from "../../src/shared/episodes";
import { AUTHOR_DROP } from "../../src/shared/episodes";
import type { Misread } from "../../src/shared/misread";
import type { Beat } from "../../src/shared/story";
import { modernUsWorld } from "../packs/riverton";
import { registryOf, startState } from "../packs/support";

const w = modernUsWorld("w", "R");
const s = startState(w);
const EPISODE = { id: "e1", span: [600, 660] as [number, number], places: [], people: [], why: "Maya counts the till.", parts: [] };

/** A port answering each call with the next answer (an object as its JSON), keeping what each call was sent. */
function scripted(calls: string[], told: Misread[], ...answers: unknown[]): ModelPort {
  return async (_role, messages) => {
    calls.push(messages.map((m) => m.content).join("\n"));
    const next = answers.shift() ?? {};
    const reply: PortAnswer = { text: JSON.stringify(next) };
    return { ...reply, misread: (fields) => void told.push(...fields) };
  };
}

describe("W5: the settle read past its pins' bound", () => {
  test("the paging helper reads pages in order, each with every verdict before it", async () => {
    const seen: string[] = [];
    const out = await readPaged([1, 2, 3, 4, 5], 2, async (page, before) => {
      seen.push(`${page.index}/${page.of}:${page.items.join(",")} after ${before.join("|") || "-"}`);
      return `v${page.index}`;
    });
    expect(seen).toEqual(["1/3:1,2 after -", "2/3:3,4 after v1", "3/3:5 after v1|v2"]);
    expect(out).toEqual(["v1", "v2", "v3"]);
  });

  test("pages are read in story order with the archive to hand, verdicts accumulate, and the author decides with them all", async () => {
    const count = PINS_MOST * 2 + 50;
    // Pins given out of story order: the pages read them by their minutes.
    const pins: Beat[] = Array.from({ length: count }, (_, i) => ({ id: `b${i}`, at: 700 + ((i * 7) % count), order: 0, scene: "s1", place: "home", actors: [], act: "happened", about: [], what: `what-${i}`, surface: `surface-${i}`, exposure: [], by: { entry: "test" } }));
    const draft: DraftData = { id: "d1", episode: EPISODE, at: 600, inputs: {}, beats: [], effects: [], touches: [], summary: "Maya takes two twenties." };
    const calls: string[] = [];
    const told: Misread[] = [];
    const searched: string[] = [];
    const model = scripted(
      calls,
      told,
      { archive: [{ tool: "archive_search", text: "twenties" }] },
      { verdict: "holds", why: "Nothing here touches the till.", forces: [] },
      { verdict: "contradicts", why: "Maya was at the bank all afternoon.", forces: ["d1 can't have happened at the register"] },
      { verdict: "holds", why: "", forces: [] },
      { verdict: "drop", why: "She was elsewhere." },
    );
    const read = await readDraft({
      registry: registryOf(),
      world: w,
      state: s,
      userId: "u",
      blobs: { get: async (_u, hash) => hash },
      draft,
      pins,
      notebook: { files: {}, pinned: [] },
      texts: {},
      model,
      plugs: { resolveAttempt: async () => { throw new Error("no attempt"); } },
      runSeed: "r",
      seed: "s",
      archive: { search: async (q) => (searched.push(q.text ?? ""), { hits: [], total: 0 }), quote: async () => null },
    });
    expect(searched).toEqual(["twenties"]);
    // Three pages and the final reading: never refused for size.
    expect(calls).toHaveLength(5);
    expect(calls[0]).toContain("Page 1 of 3");
    expect(calls[0]).toContain("archive_search");
    // Story order: the first page opens with the earliest minutes, whatever order the chain gave them in.
    expect(calls[0]).toMatch(/\(p1\)[^\n]*what-0 /);
    expect(calls[0]).toMatch(/\(p2\)[^\n]*what-193 /);
    expect(calls[2]).toContain("Page 2 of 3");
    expect(calls[2]).toContain("Nothing here touches the till.");
    expect(calls[3]).toContain("Maya was at the bank all afternoon.");
    expect(calls[4]).toContain("Page 2 of 3");
    expect(calls[4]).toContain("d1 can't have happened at the register");
    expect(read.verdict).toBe("drop");
    expect(read.pages?.map((p) => p.verdict)).toEqual(["holds", "contradicts", "holds"]);
    expect(read.events.map((e) => e.type)).toEqual([AUTHOR_DROP]);
  });

  test("a contradiction on any page refuses a settlement that changes nothing", async () => {
    const told: Misread[] = [];
    const pages = [{ page: 1, of: 2, span: "a to b", verdict: "holds" as const, why: "", forces: [] }, { page: 2, of: 2, span: "b to c", verdict: "contradicts" as const, why: "She was at the bank.", forces: [] }];
    const settling = settleRead({ world: w, state: s, texts: {}, pov: w.pov, model: scripted([], told, { verdict: "settle", why: "Fine." }), notebook: { files: {}, pinned: [] }, episode: EPISODE, summary: "", at: 600, beats: [], effects: [], pins: [], pages });
    await expect(settling).rejects.toBeInstanceOf(DepthAnswerError);
    expect(told.map((m) => m.field)).toEqual(["verdict"]);
    // Dropping it, the author's own call, stands.
    const dropped = await settleRead({ world: w, state: s, texts: {}, pov: w.pov, model: scripted([], [], { verdict: "drop", why: "Overtaken." }), notebook: { files: {}, pinned: [] }, episode: EPISODE, summary: "", at: 600, beats: [], effects: [], pins: [], pages });
    expect(dropped.verdict).toBe("drop");
  });
});

describe("W17: the on-screen allowance", () => {
  const spend = (o: { at: number; character?: number; realtime?: number; treatment?: SpendData["treatment"] }): SpendData => ({
    treatment: o.treatment ?? "scene",
    interval: { unit: "week", from: Math.floor(o.at / (7 * 24 * 60)) * 7 * 24 * 60 },
    cost: { calls: 1, tokensIn: 1, tokensOut: 1 },
    roles: { author: { calls: 1, tokensIn: 1, tokensOut: 1 }, ...(o.character ? { character: { calls: o.character, tokensIn: 1, tokensOut: 1 } } : {}), ...(o.realtime ? { realtime: { calls: o.realtime, tokensIn: 1, tokensOut: 1 } } : {}) },
    day: "2026-11-08",
    for: "t",
  });

  test("it counts this story interval's turns with someone playing as their own agent, and the author reads it", () => {
    const week = 7 * 24 * 60;
    const spends = [spend({ at: 10, character: 2 }), spend({ at: 20, realtime: 1 }), spend({ at: 30 }), spend({ at: 40, character: 1, treatment: "after" }), spend({ at: week + 5, character: 1 })];
    expect(onScreenSpent(spends, "week", 50)).toBe(2);
    const a = onScreenAllowance({ onScreen: 2, interval: "week" }, spends, 50);
    expect(a).toEqual({ limit: 2, spent: 2, interval: "week" });
    expect(onScreenAllowance({ onScreen: "none", interval: "week" }, spends, 50)).toBeNull();
    const none: TurnBudget = { binds: () => null, left: () => ({ turn: null, day: null }) };
    expect(budgetWords({ ...none, onScreen: a }, 0)).toContain("The on-screen allowance is spent");
    expect(budgetWords({ ...none, onScreen: { limit: 5, spent: 2, interval: "week" } }, 0)).toContain("3 of 5 turns");
    expect(budgetWords(none, 0)).toBeNull();
  });

  test("spent, the scene's author is told and sets the scene again; a cast that still gives someone their own agent slides to the author's playing", async () => {
    const maya = Object.keys(s.entities).find((id) => id !== w.pov) ?? "";
    const cast = { scene: { place: Object.keys(w.places)[0] }, cast: [{ who: maya, effort: "agent", why: "She matters." }], staging: [], beats: [], next: [] };
    const calls: string[] = [];
    const out = await authorSetup({
      world: w,
      state: s,
      texts: {},
      pov: w.pov,
      model: scripted(calls, [], cast, cast),
      notebook: { files: {}, pinned: [] },
      input: "Hello.",
      playerBeats: [],
      resolved: [],
      signals: [],
      scene: null,
      present: [{ who: w.pov, mind: false }, { who: maya, mind: true }],
      place: null,
      realtime: "judged",
      onScreen: { limit: 3, spent: 3, interval: "week" },
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("The on-screen allowance is spent");
    expect(out.redone.some((r) => r.includes("on-screen allowance is spent"))).toBe(true);
    expect(out.cast.find((c) => c.who === maya)?.effort).toBe("author");
    expect(out.refused.some((r) => r.includes("you play yourself"))).toBe(true);
  });
});
