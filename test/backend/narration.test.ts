// The narrator's render (DEPTH-PLAN §1.3, §9.2 A2) with recorded model answers: each moment is
// rendered from what reached the player character, checked by the GM before it streams and redrafted
// when it fails; a Stop keeps only the moments whose prose streamed; a Re-narrate renders its
// source's beats again exactly and decides nothing. `story.passage` is the rendering, never canon.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent, Rec } from "../../src/shared/ledger";
import { passageEvent, passagesIn, STORY_PASSAGE, STORY_UNRENDERED, unfaithfulChip, unrenderedIn } from "../../src/shared/passage";
import { blobHash } from "../../src/shared/stores";
import { type Beat, beatEvent, type BeatDecider, beatId, beatOf, type Exposure, stagingEvent, storyBlobs } from "../../src/shared/story";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import type { ModelPort, PortAnswer, PortMessage } from "../../src/backend/depth/port";
import type { Moment, NarrationInput, RenderBeat, TurnSink } from "../../src/backend/depth/scene/contract";
import { Narration, renarrateMoments } from "../../src/backend/depth/scene/narration";
import { depthPort } from "../../src/backend/depth-model-host";
import type { QuietResult } from "../../src/backend/host";
import { defaultSettings } from "../../src/backend/settings-store";
import { reporting } from "../../src/backend/depth/scene/reporting";
import { sceneView, type SceneViewRt } from "../../src/backend/depth/scene/scene-view";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import type { LedgerCore, TurnModel } from "../../src/engine/ledger/journal";
import { activeRecord } from "../../src/engine/ledger/path";
import storyPack from "../../src/packs/story/core/index";
import { modernUsWorld } from "../packs/riverton";
import { fold, startState } from "../packs/support";
import { Harness } from "../support/harness";

const reg = createRegistry(ALL_PACKS);
const world = modernUsWorld("w", "R");
const state = startState(world);

/** A beat with its texts, as the scene hands it over: `id: what happened`, `id: what there was to sense`, and the player character's own point of view where `pov` is given. */
function beat(id: string, o: { decided?: BeatDecider; actors?: string[]; exposure?: Exposure[]; quotes?: string; pov?: string; order?: number }): RenderBeat {
  const what = `${id}: what happened`;
  const surface = `${id}: what there was to sense`;
  const b: Beat = { id, at: 600, order: o.order ?? 0, place: "cafe", actors: o.actors ?? ["maya"], act: o.quotes ? "said" : "did", about: [], what: blobHash(what), surface: blobHash(surface), ...(o.quotes ? { quotes: blobHash(o.quotes) } : {}), exposure: o.exposure ?? [], by: { turn: "t1", decided: o.decided ?? "character" } };
  return { beat: b, what, surface, ...(o.quotes ? { quotes: o.quotes } : {}), ...(o.pov ? { pov: o.pov } : {}) };
}

const WHOLE: Exposure[] = [{ who: "you", channel: "hearing", reach: "whole" }];

/** The thinking block and the reply, as the bridge would get them. */
function sinkLog(): { sink: TurnSink; log: { kind: string; text: string }[]; content: () => string[] } {
  const log: { kind: string; text: string }[] = [];
  const sink: TurnSink = {
    progress: (text) => log.push({ kind: "progress", text }),
    reasoning: (text) => log.push({ kind: "reasoning", text }),
    content: (text) => log.push({ kind: "content", text }),
    call: () => {},
  };
  return { sink, log, content: () => log.filter((l) => l.kind === "content").map((l) => l.text) };
}

type ScriptedPort = ModelPort & { calls: { role: string; messages: PortMessage[] }[] };

/**
 * A model answering each role in turn: the narrator each passage, the check its verdicts. A narrator
 * answer given as a function is awaited first: a call still running while the scene goes on, or one
 * the player stops.
 */
function scripted(script: { narrator: (string | (() => Promise<string>))[]; check: unknown[] }): ScriptedPort {
  const calls: { role: string; messages: PortMessage[] }[] = [];
  const port = (async (role, messages, opts) => {
    calls.push({ role, messages });
    if (opts?.signal?.aborted) throw new Error("aborted");
    if (role === "check") return { text: typeof script.check[0] === "string" ? String(script.check.shift()) : JSON.stringify(script.check.shift() ?? { faithful: true }) };
    const next = script.narrator.shift() ?? "";
    const text = typeof next === "string" ? next : await next();
    if (opts?.signal?.aborted) throw new Error("aborted");
    return { text };
  }) as ScriptedPort;
  port.calls = calls;
  return port;
}

function input(signal: AbortSignal, o: Partial<NarrationInput> = {}): NarrationInput {
  return { world, state, texts: {}, pov: "you", settings: { redrafts: 2, thinking: "whole" }, asks: true, signal, ...o };
}

function said(port: ScriptedPort, role: string): string[] {
  return port.calls.filter((c) => c.role === role).map((c) => c.messages.map((m) => m.content).join("\n"));
}

describe("the narrator's render", () => {
  test("each moment renders from what reached the player character, is checked before it streams, and streams in order while the scene goes on", async () => {
    const held = Promise.withResolvers<string>();
    const entered = Promise.withResolvers<void>();
    const model = scripted({
      narrator: [
        () => {
          entered.resolve();
          return held.promise;
        },
        "A shape shifts by the door.",
      ],
      check: [{ faithful: true }, { faithful: true }],
    });
    const { sink, log, content } = sinkLog();
    const n = new Narration({ model, sink, throughOf: (mark) => 10 + mark }, input(new AbortController().signal));
    const own = beat("b0", { decided: "player", actors: ["you"], exposure: WHOLE, quotes: "Coffee, please." });
    const hello = beat("b1", { exposure: WHOLE, quotes: "We're closed." });
    const shape = beat("b2", { actors: ["jordan"], exposure: [{ who: "you", channel: "sight", reach: "partial" }], pov: "Something moves at the edge of sight, by the door." });
    n.add({ beats: [own, hello], mark: 0 });
    // The scene goes on while the first passage renders: the next moment queues, and nothing has streamed.
    n.add({ beats: [shape], mark: 1 });
    await entered.promise;
    expect(content()).toEqual([]);
    held.resolve("Maya looks up from the till. “We're closed.”");
    const out = await n.drain();
    expect(content()).toEqual(["Maya looks up from the till. “We're closed.”", "\n\nA shape shifts by the door."]);
    expect(log.findIndex((l) => l.text.includes("checking passage 1"))).toBeLessThan(log.findIndex((l) => l.kind === "content"));
    expect(log.some((l) => l.kind === "reasoning" && l.text.includes("GM's check of passage 1: faithful."))).toBe(true);
    // What the narrator sees: the surface and exact words where the reach was whole, his own point of
    // view where it was partial, the player's own beat as he wrote it; never another beat's truth.
    const [first, second] = said(model, "narrator");
    expect(first).toContain("b1: what there was to sense");
    expect(first).toContain("“We're closed.”");
    expect(first).toContain("b0: what happened");
    expect(first).not.toContain("b1: what happened");
    expect(second).toContain("Something moves at the edge of sight");
    expect(second).not.toContain("b2: what");
    expect(second).toContain("Maya looks up from the till.");
    // The check reads the whole beats, out of world.
    expect(said(model, "check")[0]).toContain("b1: what happened");
    expect(out.told.map((p) => [p.mark, p.beats, p.faithful, p.redrafts])).toEqual([
      [0, ["b0", "b1"], true, 0],
      [1, ["b2"], true, 0],
    ]);
    expect(out.streamedThrough).toBe(1);
    expect(passagesIn(out.events).map((p) => [p.moment, p.through])).toEqual([
      [0, 10],
      [1, 11],
    ]);
  });

  test("a passage that fails its check goes back with the GM's notes, and one that still fails streams with its chip", async () => {
    const failed = { faithful: false, problems: [{ words: "Maya smiles", beat: "b1", problem: "the beat has her turned away", change: "she keeps her back to him" }], departs: "The passage has Maya smiling; the beat has her turned away." };
    const model = scripted({ narrator: ["Maya smiles.", "Maya smiles again.", "Maya grins."], check: [failed, failed, failed] });
    const { sink, content } = sinkLog();
    const n = new Narration({ model, sink, throughOf: () => 3 }, input(new AbortController().signal));
    n.add({ beats: [beat("b1", { exposure: WHOLE })], mark: 0 });
    const out = await n.drain();
    const asked = said(model, "narrator");
    expect(asked.length).toBe(3);
    expect(asked[1]).toContain("Your draft");
    expect(asked[1]).toContain("she keeps her back to him");
    expect(content()).toEqual(["Maya grins."]);
    expect(out.told[0]).toMatchObject({ faithful: false, redrafts: 2, departs: "The passage has Maya smiling; the beat has her turned away." });
    const [p] = passagesIn(out.events);
    expect(p?.drafts.map((d) => d.faithful)).toEqual([false, false, false]);
    expect(p?.departs).toBe("The passage has Maya smiling; the beat has her turned away.");

    // One that passes on its redraft streams with no chip.
    const fixed = scripted({ narrator: ["Maya smiles.", "Maya keeps her back to him."], check: [failed, { faithful: true }] });
    const again = new Narration({ model: fixed, sink: sinkLog().sink, throughOf: () => 0 }, input(new AbortController().signal));
    again.add({ beats: [beat("b1", { exposure: WHOLE })], mark: 0 });
    const passed = (await again.drain()).told[0];
    expect(passed).toMatchObject({ text: "Maya keeps her back to him.", faithful: true, redrafts: 1 });
    expect(passed?.departs).toBeUndefined();

    // A check that can't be read is asked once more, then the passage streams unchecked, with a chip.
    const unread = scripted({ narrator: ["Maya turns away."], check: ["not an object", "still not"] });
    const unchecked = new Narration({ model: unread, sink: sinkLog().sink, throughOf: () => 0 }, input(new AbortController().signal));
    unchecked.add({ beats: [beat("b1", { exposure: WHOLE })], mark: 0 });
    const u = (await unchecked.drain()).told[0];
    expect(u?.faithful).toBeNull();
    expect(u?.departs).toBe("This passage couldn't be checked against its beats.");
    expect(said(unread, "check").length).toBe(2);
  });

  test("a check cut off at its answer room is asked again with more room, never at the same limit (LIVE3 L3a-9)", async () => {
    const run = async (first: Partial<PortAnswer>): Promise<{ asked: (number | undefined)[]; faithful: boolean | null | undefined; log: { kind: string; text: string }[] }> => {
      const asked: (number | undefined)[] = [];
      const port = (async (role, _messages, opts) => {
        if (role !== "check") return { text: "Maya turns away." };
        asked.push(opts?.maxTokens);
        return asked.length === 1 ? { text: '{"faithful": tr', finish: "length", ...first } : { text: JSON.stringify({ faithful: true }), ...(opts?.maxTokens !== undefined ? { room: opts.maxTokens } : {}) };
      }) as ModelPort;
      const { sink, log } = sinkLog();
      const n = new Narration({ model: port, sink, throughOf: () => 0 }, input(new AbortController().signal));
      n.add({ beats: [beat("b1", { exposure: WHOLE })], mark: 0 });
      return { asked, faithful: (await n.drain()).told[0]?.faithful, log };
    };
    // Cut off at the role's own room (the Fast model's 8,192): asked again at twice it, and read.
    const cut = await run({ room: 8192 });
    expect(cut.asked).toEqual([undefined, 16384]);
    expect(cut.faithful).toBe(true);
    expect(cut.log.some((l) => l.text.includes("GM's check of passage 1 was cut off at its answer room of 8,192 tokens; asking again with room for 16,384."))).toBe(true);
    // Held to a limit the provider stated, there is no more room to give it: asked again as it was.
    expect((await run({ room: 4096, capped: { asked: 8192, limit: 4096 } })).asked).toEqual([undefined, undefined]);
  });

  test("the port says the room each answer was made at: the role's own, else what the stage asked (LIVE3 L3a-9)", async () => {
    const rooms: number[] = [];
    const host = {
      models: {
        quiet: async (req: { maxTokens: number }): Promise<QuietResult> => {
          rooms.push(req.maxTokens);
          return { content: "{}", finishReason: "length", tokens: 10, tokensIn: 6, tokensOut: 4, model: "deepseek-v4-flash" };
        },
      },
      log: () => undefined,
    };
    const port = depthPort(host as never, async () => defaultSettings(), "u1", { day: null });
    const own = await port("check", [{ role: "user", content: "hi" }]);
    expect(own.room).toBe(rooms[0]);
    expect((await port("check", [{ role: "user", content: "hi" }], { maxTokens: 20000 })).room).toBe(20000);
  });
});

describe("what the player asked this telling to change (§3.9)", () => {
  test("the narrator renders with it, and the GM's check is told the texture he asked for is allowed, never a fact the beats lack", async () => {
    const model = scripted({ narrator: ["Rain on the glass, slow and grey, as Maya turns away."], check: [{ faithful: true }] });
    const n = new Narration({ model, sink: sinkLog().sink, throughOf: () => 0 }, input(new AbortController().signal, { direction: "slower, and more rain" }));
    n.add({ beats: [beat("b1", { exposure: WHOLE })], mark: 0 });
    await n.drain();
    expect(said(model, "narrator")[0]).toContain("slower, and more rain");
    const check = said(model, "check")[0] ?? "";
    expect(check).toContain("slower, and more rain");
    expect(check).toContain("is allowed and is no departure from the beats");
    // Without one, the check reads the beats alone.
    const plain = scripted({ narrator: ["Maya turns away."], check: [{ faithful: true }] });
    const p = new Narration({ model: plain, sink: sinkLog().sink, throughOf: () => 0 }, input(new AbortController().signal));
    p.add({ beats: [beat("b1", { exposure: WHOLE })], mark: 0 });
    await p.drain();
    expect(said(plain, "check")[0]).not.toContain("What the player asked");
  });

  test("the GM's check reads the author's notebook excerpts the narrator was given, as tone that adds no facts (M23)", async () => {
    const model = scripted({ narrator: ["Maya turns away, the rain slow on the glass."], check: [{ faithful: true }] });
    const n = new Narration({ model, sink: sinkLog().sink, throughOf: () => 0 }, input(new AbortController().signal, { excerpts: ["Keep it rain-soaked and quiet: Maya is hiding the letter."] }));
    n.add({ beats: [beat("b1", { exposure: WHOLE })], mark: 0 });
    await n.drain();
    expect(said(model, "check")[0]).toContain("## From the author's notebook, for this scene (the narrator was asked to carry these; they add no facts)\nKeep it rain-soaked and quiet: Maya is hiding the letter.");
  });
});

describe("the narrator fails (§1.3, §1.4)", () => {
  const failing = (o: { stop?: AbortController } = {}) =>
    scripted({
      narrator: [
        "Maya looks up.",
        async () => {
          o.stop?.abort();
          throw new Error("the narrator's connection timed out");
        },
      ],
      check: [{ faithful: true }],
    });
  // Passage 1 streams, the narrator fails on passage 2, and the scene goes on: a moment of his own beat only (no passage to miss), then Jordan at the door.
  const b0 = beat("b0", { exposure: WHOLE });
  const b1 = beat("b1", { exposure: WHOLE, order: 1 });
  const b2 = beat("b2", { decided: "player", actors: ["you"], exposure: WHOLE, order: 2 });
  const b3 = beat("b3", { actors: ["jordan"], exposure: [{ who: "you", channel: "sight", reach: "partial", pov: blobHash("Someone at the door.") }], pov: "Someone at the door.", order: 3 });
  const scene = [b0, b1, b2, b3];
  const run = async (model: ScriptedPort, signal: AbortSignal) => {
    const { sink, log, content } = sinkLog();
    const n = new Narration({ model, sink, throughOf: (mark) => 10 + mark }, input(signal));
    scene.forEach((b, mark) => n.add({ beats: [b], mark }));
    return { out: await n.drain(), log, content: content() };
  };

  test("it renders nothing more, the moments stand as decided, the record names each one it didn't render, the reply's chip says so, and Re-narrate renders them all", async () => {
    const model = failing();
    const { out, log, content } = await run(model, new AbortController().signal);
    expect(content).toEqual(["Maya looks up."]);
    expect(out.failed).toBe("the narrator's connection timed out");
    expect(said(model, "narrator")).toHaveLength(2);
    expect(log.some((l) => l.kind === "progress" && l.text.includes("couldn't render passage 2") && l.text.includes("Re-narrate"))).toBe(true);
    expect(passagesIn(out.events).map((p) => p.moment)).toEqual([0]);
    expect(unrenderedIn(out.events)).toEqual([
      { moment: 1, beats: ["b1"], through: 11, why: "the narrator's connection timed out" },
      { moment: 3, beats: ["b3"], through: 13, why: "the narrator's connection timed out" },
    ]);

    // The reply's chip says so, with Re-narrate; a record cut before them (a Stop's, a failed stage's) keeps no beat of them, and no chip.
    const pre = scene.map((b) => beatEvent(b.beat));
    const chip = unfaithfulChip("m1", 0, [...pre, ...out.events]);
    expect([chip?.id, chip?.label, chip?.actions.map((a) => a.id)]).toEqual(["unfaithful:m1:0", "2 moments weren't rendered", ["renarrate"]]);
    expect(chip?.detail).toContain("(the narrator's connection timed out)");
    expect(unfaithfulChip("m1", 0, [pre[0] as LedgerEvent, ...out.events])).toBeNull();

    // Re-narrate renders every decided moment: the one that streamed and the two that didn't, with the source's cuts.
    const texts = new Map(scene.flatMap((b) => [[b.beat.what, b.what], [b.beat.surface, b.surface], ...(b.pov ? [[blobHash(b.pov), b.pov] as const] : [])] as [string, string][]));
    const { moments, throughOf } = await renarrateMoments({ pre, read: out.events }, "you", async (h) => texts.get(h) ?? null);
    expect(moments.map((m) => [m.mark, m.beats.map((b) => b.beat.id)])).toEqual([
      [0, ["b0"]],
      [1, ["b1"]],
      [3, ["b3"]],
    ]);
    expect(moments[2]?.beats[0]?.pov).toBe("Someone at the door.");
    expect([throughOf(0), throughOf(1), throughOf(3)]).toEqual([10, 11, 13]);
    const again = new Narration({ model: scripted({ narrator: ["Maya looks up.", "She nods.", "Someone fills the doorway."], check: [{ faithful: true }, { faithful: true }, { faithful: true }] }), sink: sinkLog().sink, throughOf }, input(new AbortController().signal, { asks: false }));
    for (const m of moments) again.add(m);
    const renarrated = await again.drain();
    expect(renarrated.told.map((p) => p.mark)).toEqual([0, 1, 3]);
    expect(unrenderedIn(renarrated.events)).toEqual([]);
    expect(unfaithfulChip("m1", 1, [...pre, ...renarrated.events])).toBeNull();
  });

  test("stopped once it failed, the record keeps nothing past the last streamed moment, so it names no unrendered one", async () => {
    const stop = new AbortController();
    const { out } = await run(failing({ stop }), stop.signal);
    expect([out.stopped, out.streamedThrough]).toEqual([true, 0]);
    expect(unrenderedIn(out.events)).toEqual([]);
  });

  test("a source rendered only in part before the record named its unrendered moments: Re-narrate renders the turn's beats after its last passage too, by their order in the scene", async () => {
    const pre = [beatEvent(b0.beat), beatEvent(b1.beat), beatEvent({ ...b3.beat, order: 1 }), beatEvent({ ...b2.beat, by: { draft: "d1" } })];
    const read = [passageEvent({ moment: 0, index: 0, beats: ["b0"], pov: "you", text: blobHash("p"), through: 1, drafts: [{ text: blobHash("p"), faithful: true }] })];
    const { moments, throughOf } = await renarrateMoments({ pre, read }, "you", async () => "");
    expect(moments.map((m) => [m.mark, m.beats.map((b) => b.beat.id)])).toEqual([
      [0, ["b0"]],
      [1, ["b1", "b3"]],
    ]);
    expect(throughOf(1)).toBe(3);
  });
});

describe("Stop (§3.10)", () => {
  test("Stop lands between beats: only the moments whose prose streamed stay, with the private beats decided before them", async () => {
    const stop = new AbortController();
    const model = scripted({
      narrator: [
        "Maya sets down a cup.",
        async () => {
          // The player stops while the third moment's passage renders.
          stop.abort();
          return "Jordan walks in.";
        },
      ],
      check: [{ faithful: true }],
    });
    const { sink, content } = sinkLog();
    const n = new Narration({ model, sink, throughOf: (mark) => mark }, input(stop.signal));
    // The scene's plan, bucketed by moment as the loop keeps it.
    const buckets: { mark: number; beats: string[] }[] = [];
    const decide = (m: Moment): void => {
      buckets.push({ mark: m.mark, beats: m.beats.map((b) => b.beat.id) });
      n.add(m);
    };
    decide({ beats: [beat("b1", { exposure: WHOLE })], mark: 0 });
    // A private act the player character can't perceive: decided, never rendered.
    decide({ beats: [beat("b2", { actors: ["jordan"], exposure: [{ who: "maya", channel: "sight", reach: "whole" }] })], mark: 1 });
    decide({ beats: [beat("b3", { actors: ["jordan"], exposure: WHOLE })], mark: 2 });
    decide({ beats: [beat("b4", { exposure: WHOLE })], mark: 3 });
    const out = await n.drain();
    expect(out.stopped).toBe(true);
    expect(content()).toEqual(["Maya sets down a cup."]);
    // The third moment's passage never streamed, and the fourth was never rendered.
    expect(said(model, "narrator").length).toBe(2);
    expect(out.streamedThrough).toBe(0);
    const through = out.streamedThrough ?? -1;
    expect(buckets.filter((b) => b.mark <= through).flatMap((b) => b.beats)).toEqual(["b1"]);
    expect(out.events.length).toBe(1);

    // A private moment decided before the last passage that streamed stays.
    const stop2 = new AbortController();
    const later = scripted({
      narrator: [
        "Maya sets down a cup.",
        "Jordan walks in.",
        async () => {
          stop2.abort();
          return "Maya waves.";
        },
      ],
      check: [{ faithful: true }, { faithful: true }],
    });
    const n2 = new Narration({ model: later, sink: sinkLog().sink, throughOf: (mark) => mark }, input(stop2.signal));
    n2.add({ beats: [beat("b1", { exposure: WHOLE })], mark: 0 });
    n2.add({ beats: [beat("b2", { actors: ["jordan"] })], mark: 1 });
    n2.add({ beats: [beat("b3", { actors: ["jordan"], exposure: WHOLE })], mark: 2 });
    n2.add({ beats: [beat("b4", { exposure: WHOLE })], mark: 3 });
    expect((await n2.drain()).streamedThrough).toBe(2);

    // A Stop before anything streamed keeps nothing.
    const early = new AbortController();
    early.abort();
    const n3 = new Narration({ model: scripted({ narrator: ["x"], check: [] }), sink: sinkLog().sink, throughOf: () => 0 }, input(early.signal));
    n3.add({ beats: [beat("b1", { exposure: WHOLE })], mark: 0 });
    const none = await n3.drain();
    expect([none.stopped, none.streamedThrough, none.events.length]).toEqual([true, null, 0]);
  });
});

describe("Re-narrate (P3)", () => {
  test("a Re-narrate renders its source's beats again exactly, regrouped as its prose grouped them, and decides nothing", async () => {
    // The source turn: the player character's staging, his own beat and Maya's answer (one moment), a
    // write decided with them, a private beat, then Jordan in the doorway; and the prose that rendered it.
    const texts = new Map<string, string>();
    const keep = (b: RenderBeat): Beat => {
      texts.set(b.beat.what, b.what);
      texts.set(b.beat.surface, b.surface);
      if (b.quotes && b.beat.quotes) texts.set(b.beat.quotes, b.quotes);
      const pov = b.beat.exposure.find((x) => x.who === "you")?.pov;
      if (b.pov && pov) texts.set(pov, b.pov);
      return b.beat;
    };
    const where = blobHash("by the counter");
    const doing = blobHash("waiting for coffee");
    texts.set(where, "by the counter");
    texts.set(doing, "waiting for coffee");
    const b0 = keep(beat("b0", { decided: "player", actors: ["you"], exposure: WHOLE, quotes: "Coffee, please." }));
    const b1 = keep(beat("b1", { exposure: WHOLE, quotes: "We're closed." }));
    const b2 = keep(beat("b2", { actors: ["jordan"] }));
    const povText = "a figure in the doorway";
    const b3 = keep(beat("b3", { actors: ["jordan"], exposure: [{ who: "you", channel: "sight", reach: "partial", pov: blobHash(povText) }], pov: povText }));
    const pre: LedgerEvent[] = [stagingEvent({ who: "you", where, doing }), beatEvent(b0), beatEvent(b1), { type: "engine.ws.write", data: { path: "minds/maya/now.md", hash: blobHash("tired") } }, beatEvent(b2), beatEvent(b3)];
    const passage = (moment: number, index: number, beats: string[], through: number): LedgerEvent => ({ type: STORY_PASSAGE, data: { moment, index, beats, pov: "you", text: blobHash(`passage ${index}`), through, drafts: [{ text: blobHash(`passage ${index}`), faithful: true }] } });
    const source = { pre, read: [passage(0, 0, ["b0", "b1"], 4), passage(2, 1, ["b3"], 6)] };
    const before = structuredClone(source);
    const blob = async (hash: string): Promise<string | null> => texts.get(hash) ?? null;

    const { moments, throughOf } = await renarrateMoments(source, "you", blob);
    expect(moments.map((m) => [m.mark, m.beats.map((b) => b.beat)])).toEqual([
      [0, [b0, b1]],
      [2, [b3]],
    ]);
    expect(moments[0]?.staging?.where).toBe("by the counter");
    expect(moments[1]?.beats[0]?.pov).toBe(povText);
    expect([throughOf(0), throughOf(2)]).toEqual([4, 6]);

    // Rendered afresh, asking no one: a narrator that asks anyway wrote no passage and goes back, and
    // each passage renders the same beats with the source's cuts.
    const model = scripted({ narrator: ["ASK: is it raining?", "Maya shakes her head. “We're closed.”", "Someone fills the doorway."], check: [{ faithful: true }, { faithful: true }] });
    const n = new Narration({ model, sink: sinkLog().sink, throughOf }, input(new AbortController().signal, { asks: false }));
    for (const m of moments) n.add(m);
    const out = await n.drain();
    const asked = said(model, "narrator");
    expect(asked[0]).not.toContain('starting "ASK: "');
    expect(asked.some((t) => t.includes("You asked the author"))).toBe(false);
    expect(out.told.map((p) => [p.mark, p.beats, p.redrafts])).toEqual([
      [0, ["b0", "b1"], 1],
      [2, ["b3"], 0],
    ]);
    expect(passagesIn(out.events).map((p) => p.through)).toEqual([4, 6]);
    expect(source).toEqual(before);

    // A Stop of the Re-narrate after its first passage cuts the copied plan there: the moment and the
    // write decided with it stay; the private beat and the rest go.
    const stop = new AbortController();
    const stopped = scripted({
      narrator: [
        "Maya shakes her head.",
        async () => {
          stop.abort();
          return "Someone fills the doorway.";
        },
      ],
      check: [{ faithful: true }],
    });
    const n2 = new Narration({ model: stopped, sink: sinkLog().sink, throughOf }, input(stop.signal, { asks: false }));
    for (const m of moments) n2.add(m);
    const cut = await n2.drain();
    expect(cut.streamedThrough).toBe(0);
    expect(source.pre.slice(0, throughOf(cut.streamedThrough ?? -1)).map((e) => ("data" in e ? beatOf(e.data)?.id : undefined) ?? e.type)).toEqual(["story.staging", "b0", "b1", "engine.ws.write"]);

    // A source with no prose groups its beats by their order in the scene.
    const loose = await renarrateMoments({ pre: [beatEvent({ ...b1, order: 1 }), beatEvent({ ...b3, order: 1 }), beatEvent({ ...b0, order: 2 })], read: [] }, "you", blob);
    expect(loose.moments.map((m) => m.beats.map((b) => b.beat.id))).toEqual([["b1", "b3"], ["b0"]]);
    expect(loose.throughOf(0)).toBe(2);
  });
});

describe("the narrator asks (§1.3)", () => {
  test("a detail canon lacks is decided by the author as a beat of that moment before the passage renders", async () => {
    const rain = beat("b9", { decided: "author", actors: [], exposure: [{ who: "you", channel: "hearing", reach: "whole" }] });
    const questions: string[][] = [];
    const model = scripted({ narrator: ["ASK: is it raining outside?", "Rain taps the glass as Maya turns."], check: [{ faithful: true }] });
    const ask = async (q: { questions: string[] }): Promise<RenderBeat[]> => {
      questions.push(q.questions);
      return [rain];
    };
    const n = new Narration({ model, sink: sinkLog().sink, throughOf: () => 2, ask }, input(new AbortController().signal));
    n.add({ beats: [beat("b1", { exposure: WHOLE })], mark: 0 });
    const out = await n.drain();
    expect(questions).toEqual([["is it raining outside?"]]);
    expect(said(model, "narrator")[1]).toContain("b9: what there was to sense");
    expect(out.told[0]?.beats).toEqual(["b1", "b9"]);
    expect(passagesIn(out.events)[0]?.asked?.[0]?.beats).toEqual(["b9"]);
  });
});

describe("story.passage", () => {
  test("story.unrendered is the rendering too: structural, never grouped, changing no state", () => {
    const def = reg.get(STORY_UNRENDERED);
    const data = { moments: [{ moment: 1, beats: ["b1"], through: 3 }], pov: "you", why: "the narrator's call failed" };
    const ctx = reg.context(world, structuredClone(state));
    expect(def?.validate({ type: STORY_UNRENDERED, data } as never, ctx)).toBeNull();
    expect(def?.validate({ type: STORY_UNRENDERED, data: { ...data, moments: [] } } as never, ctx)?.code).toBe("bad_story_event");
    expect(def?.validate({ type: STORY_UNRENDERED, data: { ...data, why: "" } } as never, ctx)?.code).toBe("bad_story_event");
    expect(def?.validate({ type: STORY_UNRENDERED, data, group: "g" } as never, ctx)?.code).toBe("story_grouped");
    expect(def?.neutral).toBe(true);
    expect(fold(reg, world, state, [{ type: STORY_UNRENDERED, data }])).toEqual(state);
  });

  test("it is the rendering: structural, never grouped, changing no state, its texts kept", () => {
    const def = reg.get(STORY_PASSAGE);
    const data = { moment: 0, index: 0, beats: ["b1"], pov: "you", text: blobHash("p"), drafts: [{ text: blobHash("p"), faithful: false, notes: blobHash("n") }], departs: "The passage has Maya smiling." };
    const ctx = reg.context(world, structuredClone(state));
    expect(def?.validate({ type: STORY_PASSAGE, data } as never, ctx)).toBeNull();
    expect(def?.validate({ type: STORY_PASSAGE, data: { ...data, drafts: [] } } as never, ctx)?.code).toBe("bad_story_event");
    expect(def?.validate({ type: STORY_PASSAGE, data, group: "g" } as never, ctx)?.code).toBe("story_grouped");
    expect(def?.neutral).toBe(true);
    expect(fold(reg, world, state, [{ type: STORY_PASSAGE, data }])).toEqual(state);
    expect(storyBlobs(STORY_PASSAGE, data).sort()).toEqual([blobHash("p"), blobHash("p"), blobHash("n")].sort());
  });

  test("every model call of a turn is reported once, with its connection, model, tokens and time", async () => {
    const calls: unknown[] = [];
    let t = 0;
    const port: ModelPort = async () => {
      t += 40;
      return { text: "ok", usage: { tokensIn: 10, tokensOut: 5 }, call: { connection: "conn-1", model: "deepseek-v4-flash" } };
    };
    const wrapped = reporting(port, { call: (c) => calls.push(c) }, () => t);
    await wrapped("check", [{ role: "user", content: "x" }]);
    expect(calls).toEqual([{ role: "check", connection: "conn-1", model: "deepseek-v4-flash", requestId: null, promptTokens: 10, completionTokens: 5, ms: 40 }]);
  });
});

describe("the turn inspector (§7)", () => {
  test("a reply's scene reads off its record: its beats in order with who decided and who perceived each, each passage with its checks, and its turn's model calls, each on its connection by name, the reply numbered as the chat numbers it", async () => {
    const failed = { faithful: false, problems: [{ words: "Maya smiles", beat: "b1", problem: "the beat has her turned away", change: "keep her back to him" }], departs: "The passage has Maya smiling; the beat has her turned away." };
    const model = scripted({ narrator: ["Maya smiles. “We're closed.”", "Maya keeps her back to him. “We're closed.”"], check: [failed, { faithful: true }] });
    const n = new Narration({ model, sink: sinkLog().sink, throughOf: () => 3 }, input(new AbortController().signal));
    const glimpse = blobHash("something white goes into a coat");
    const hello = beat("b1", { exposure: WHOLE, quotes: "We're closed." });
    const pocket = beat("b2", { actors: ["jordan"], exposure: [{ who: "maya", channel: "sight", reach: "partial", pov: glimpse, pending: true }] });
    n.add({ beats: [hello, pocket], mark: 0 });
    const out = await n.drain();
    const texts = new Map<string, string>(Object.entries(out.blobs));
    for (const b of [hello, pocket]) {
      texts.set(b.beat.what, b.what);
      texts.set(b.beat.surface, b.surface);
    }
    texts.set(blobHash("We're closed."), "We're closed.");
    texts.set(glimpse, "something white goes into a coat");
    const where = blobHash("by the counter");
    const doing = blobHash("waiting for coffee");
    texts.set(where, "by the counter");
    texts.set(doing, "waiting for coffee");
    // The reply's record: its plan holds the staging and the moment's beats, its read part the prose.
    const rec = { v: 1, defHash: "r", seq: 7, swipeHash: { hash: "h", len: 1 }, path: "p", seed: "s", pre: 3, events: [stagingEvent({ who: "you", where, doing }), beatEvent(hello.beat), beatEvent(pocket.beat), ...out.events], post: [], markersApplied: 0, status: "ok", undone: [], intents: {} } as unknown as Rec;
    const observed: ChainMessage[] = [
      { id: "m1", isUser: true, swipeId: 0, swipes: ["Coffee?"], ledger: null },
      { id: "m2", isUser: false, swipeId: 0, swipes: ["Maya keeps her back to him. “We're closed.”"], ledger: { v: 1, swipes: { "0": rec }, markers: [] } },
    ];
    const core = { chain: (o: ChainMessage[]) => o, journal: { tombstones: [] } } as unknown as LedgerCore;
    // One call on a connection the user has, by its id as the port reported it; one on a connection since deleted.
    const calls = [
      { role: "narrator", connection: "conn-1", model: "deepseek-v4-flash", requestId: null, ms: 4000 },
      { role: "check", connection: "conn-gone", model: "deepseek-v4-flash", requestId: null, ms: 900 },
    ];
    const rt: SceneViewRt = {
      ledger: {
        with: async (_chat, _user, op) => {
          await op(core, observed);
        },
      },
      blobs: { get: async (_user, hash) => texts.get(hash) ?? null },
      inspector: { load: async () => ({ userId: "u", records: [{ id: "g1", at: 0, activation: "confirmed", sections: [], budget: { sections: 0, used: 0 }, forced: [], provenance: { calls, turnMs: 9000, firstContentMs: 2000, reply: { messageId: "m2", swipeId: 0 } } }] }) },
      // The chat numbers its messages from 0 and never renumbers them: a message deleted before these left them #3 and #4.
      host: { chats: { messages: async () => [{ id: "m1", index: 3 }, { id: "m2", index: 4 }] }, connections: { list: async () => [{ id: "conn-1", name: "DeepSeek (scratch)" }] } },
    };
    const view = await sceneView(rt, { state, world }, "c", "u");
    // The reply as the chat shows it, its #4 (LIVE3 lane 1b: "Message 9" where the chat said #8).
    expect(view.reply).toMatchObject({ messageId: "m2", swipeId: 0, index: 4 });
    expect(view.replies.map((r) => r.index)).toEqual([4]);
    expect(view.pov).toEqual({ id: "you", name: "Alex Rivera" });
    expect(view.staging).toEqual([{ who: "you", name: "Alex Rivera", where: "by the counter", doing: "waiting for coffee" }]);
    expect(view.beats.map((b) => [b.id, b.decided, b.actors, b.quotes ?? null, b.passage])).toEqual([
      ["b1", "character", ["Maya Chen"], "We're closed.", 1],
      ["b2", "character", ["Jordan Price"], null, 1],
    ]);
    expect(view.beats[1]?.exposure).toEqual([{ who: "maya", name: "Maya Chen", channel: "sight", reach: "partial", pov: "something white goes into a coat", pending: true }]);
    expect(view.told).toHaveLength(1);
    expect(view.told[0]?.text).toBe("Maya keeps her back to him. “We're closed.”");
    expect(view.told[0]?.drafts.map((d) => [d.text, d.faithful])).toEqual([
      ["Maya smiles. “We're closed.”", false],
      ["Maya keeps her back to him. “We're closed.”", true],
    ]);
    expect(view.told[0]?.drafts[0]?.notes).toContain("keep her back to him");
    // Each call on its connection by name, as Settings shows it; one Lumiverse no longer has by its id (LIVE3 lane 1b: every call showed c7c0f78d-…).
    expect(view.provenance).toEqual({ calls: [{ ...calls[0], connection: "DeepSeek (scratch)" }, calls[1]], turnMs: 9000, firstContentMs: 2000 });
  });
});

describe("Re-narrate through the ledger (P3)", () => {
  test("a Re-narrate's record holds its source's beats exactly and prose of its own; a Re-run decides anew", async () => {
    // A model standing for a depth turn: its plan the scene's staging and beat (ids from the turn's
    // seed, as a scene's are from its token), its read part the passage the reply streamed.
    let plans = 0;
    const model: TurnModel = {
      plan: ({ state: s, seed }) => {
        plans++;
        const where = blobHash("by the counter");
        const said: Beat = { id: beatId(seed, "0"), at: s.clock, order: 0, place: "cafe", actors: ["maya"], act: "said", about: [], what: blobHash(`what ${seed}`), surface: blobHash(`surface ${seed}`), exposure: [{ who: "you", channel: "hearing", reach: "whole" }], by: { turn: seed, decided: "character" } };
        return [stagingEvent({ who: "you", where, doing: where }), beatEvent(said)];
      },
      read: ({ text }) => [passageEvent({ moment: 0, index: 0, beats: ["b0"], pov: "you", text: blobHash(text), drafts: [{ text: blobHash(text), faithful: true }] })],
    };
    const h = new Harness("fresh", { packs: [storyPack], model });
    const chat = await h.newChat();
    await h.send(chat, "I order a coffee.", "Maya turns away. “We're closed.”");
    const record = async (): Promise<Rec> => {
      const core = await h.core(chat);
      const head = (await h.chain(chat)).findLast((m) => !m.isUser);
      const rec = head ? activeRecord(head, core.journal.tombstones) : null;
      if (!rec) throw new Error("no record on the head");
      return rec;
    };
    const source = await record();
    const head = h.host.head(chat);
    if (!head) throw new Error("no head");

    h.renarrateNext = true;
    await h.host.finish(await h.host.start(chat, { type: "swipe", messageId: head.id }), "Maya keeps her back to you. “We're closed.”");
    const again = await record();
    expect(plans).toBe(1);
    expect(again.events.slice(0, again.pre)).toEqual(source.events.slice(0, source.pre));
    expect(passagesIn(again.events.slice(again.pre)).map((p) => p.text)).toEqual([blobHash("Maya keeps her back to you. “We're closed.”")]);
    expect(passagesIn(source.events.slice(source.pre)).map((p) => p.text)).toEqual([blobHash("Maya turns away. “We're closed.”")]);

    // A Re-run plays the scene again: new beats, decided anew.
    await h.host.finish(await h.host.start(chat, { type: "swipe", messageId: head.id }), "Maya shrugs.");
    const rerun = await record();
    expect(plans).toBe(2);
    expect(rerun.events.slice(0, rerun.pre).map((e) => ("data" in e ? beatOf(e.data)?.id : undefined)).filter(Boolean)).not.toEqual(source.events.slice(0, source.pre).map((e) => ("data" in e ? beatOf(e.data)?.id : undefined)).filter(Boolean));
  });
});
