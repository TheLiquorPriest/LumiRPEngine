// One depth turn end to end on the real stages (DEPTH-PLAN §1.3, §2.3, §3.10, §9.2 A2), every model
// call answered from a script: the GM writes the player's beats, the author sets the scene with an
// effort per character, a character plays as its own agent, the author's step writes who perceived
// each beat and ends the turn, and each moment streams as it is decided. A Stop keeps only the
// moments whose prose streamed; a Re-narrate renders the same beats again and decides nothing.
// The turn's commit records the scene's pre and its prose, never a read of the reply, whether
// the reply ended or was stopped.

import { describe, expect, test } from "bun:test";
import { seedCore } from "../../src/backend/character-agent";
import { MINDS_V2_KEY, reachOf } from "../../src/shared/character-engine";
import type { ArchiveSource } from "../../src/backend/depth/archive-tools";
import type { CeilingBind, TurnBudget } from "../../src/backend/depth/budget";
import type { ModelPort } from "../../src/backend/depth/port";
import { namesOf } from "../../src/backend/depth/scene/author";
import type { DepthTurnInput, TurnSink } from "../../src/backend/depth/scene/contract";
import { renarrateMoments } from "../../src/backend/depth/scene/narration";
import { scenePlugs } from "../../src/backend/depth/scene/plugs";
import { runDepthTurn } from "../../src/backend/depth/scene/turn";
import { attemptSeed } from "../../src/backend/depth/scene/resolve";
import { resolveOn } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { defaultSettings } from "../../src/backend/settings-store";
import type { LedgerEvent, Rec } from "../../src/shared/ledger";
import { OFFSCREEN_TEXT } from "../../src/shared/offscreen-prompts";
import { PROMPTS } from "../../src/shared/prompts";
import { SCENE_TEXT } from "../../src/shared/scene-prompts";
import { AUTHOR_SPEND, authorData, type SpendData } from "../../src/shared/author";
import { passageEvent, passagesIn, unreachedChip } from "../../src/shared/passage";
import { sceneEvent, sceneOf, STORY_SCENE } from "../../src/shared/scene";
import { beatEvent, beatId, beatOf, STORY_BEAT, STORY_STAGING, type Beat } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import { STORY_TALK, talkOf } from "../../src/shared/talk";
import { placeOfEntity } from "../../src/engine/scope";
import { own } from "../../src/engine/pack-kit";
import type { TurnModel } from "../../src/engine/ledger/journal";
import { activeRecord } from "../../src/engine/ledger/path";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import storyPack from "../../src/packs/story/core/index";
import { modernUsWorld } from "../packs/riverton";
import { fold, startState } from "../packs/support";
import { Harness } from "../support/harness";
import { POV } from "../support/test-pack";

const reg = createRegistry(ALL_PACKS);
const world = modernUsWorld("w", "Riverton");
// Everyone at the café: Alex (the player character), Maya and Rosa (each with a mind), Jordan (none).
for (const id of ["you", "maya", "rosa", "jordan"]) {
  const e = world.entities[id];
  if (e) e.fields = { ...e.fields, place: "cafe" };
}
const store = new Map<string, string>();
const cores = [seedCore({ who: "maya", at: 0, source: "card", text: "Maya Chen, the café's barista: quick, warm, keeps the regulars' orders in her head." }), seedCore({ who: "rosa", at: 0, source: "card", text: "Rosa Delgado, a mechanic who reads the paper here every morning." })];
for (const c of cores) for (const [hash, text] of Object.entries(c.blobs)) store.set(hash, text);
const state = fold(reg, world, startState(world, reg), cores.flatMap((c) => c.events as LedgerEvent[]));

const LINE = "Morning, Maya. One coffee, please. (OOC: keep it slow)";
const ORDER_WHAT = "Alex orders a coffee from Maya.";
const ORDER_SURFACE = "Alex steps up to the counter and orders.";
const NOTE: LedgerEvent = { type: "engine.note", data: { text: "The engine run's own event." } };

const GM = { beats: [{ kind: "act", act: "said", actors: ["you"], addressed: ["maya"], about: ["maya"], what: ORDER_WHAT, surface: ORDER_SURFACE, words: "Morning, Maya. One coffee, please.", quotes: "Morning, Maya. One coffee, please." }], signals: ["(OOC: keep it slow)"] };
const SETUP = {
  scene: { place: "cafe" },
  cast: [
    { who: "maya", effort: "agent", why: "She serves him, as herself." },
    { who: "rosa", effort: "author", why: "A regular at the window." },
    { who: "jordan", effort: "world", why: "Passing through for a coffee to go." },
  ],
  staging: [
    { who: "you", where: "at the counter", doing: "ordering" },
    { who: "maya", where: "behind the counter", doing: "wiping the steam wand", place: "cafe" },
    { who: "rosa", where: "at the window table", doing: "reading the paper", occluded: "the espresso machine hides the counter from her", place: "cafe" },
  ],
  exposure: [
    { beat: "p1", who: "maya", channel: "hearing", reach: "whole" },
    { beat: "p1", who: "rosa", channel: "hearing", reach: "partial" },
  ],
  beats: [{ what: "The espresso machine hisses as it heats.", surface: "The espresso machine hisses.", exposure: [{ who: "you", channel: "hearing", reach: "whole" }, { who: "maya", channel: "hearing", reach: "whole" }] }],
  next: ["maya"],
  end: null,
  reasoning: "He orders; Maya answers as herself.",
};
const PLAY = { do: "Maya reaches for a cup.", say: "Coming right up, Alex.", to: ["Alex Rivera"], take: "He looks like he slept badly.", now: "Busy with the morning rush." };
const STEP = {
  exposure: [
    { beat: "d1", who: "you", channel: "hearing", reach: "whole" },
    { beat: "d1", who: "rosa", channel: "sight", reach: "partial" },
  ],
  staging: [{ who: "maya", where: "at the espresso machine", doing: "pulling a shot", place: "cafe" }],
  beats: [
    { actors: ["rosa"], act: "did", what: "Rosa turns a page, listening.", surface: "Rosa turns a page.", exposure: [{ who: "you", channel: "sight", reach: "whole" }] },
  ],
  next: ["jordan"],
  end: "Maya has answered: the player speaks next.",
};

type Narrated = string | (() => Promise<string>);

/** Every call answered by its role: the GM, the author and the character from their scripts, every point of view asked for, every check faithful, the narrator's prose in turn. */
function scripted(script: { gm?: unknown[]; author?: unknown[]; character?: unknown[]; narrator?: Narrated[] }): ModelPort & { calls: { role: string; text: string }[] } {
  const calls: { role: string; text: string }[] = [];
  const queues: Record<string, unknown[]> = { gm: script.gm ?? [], author: script.author ?? [], character: script.character ?? [] };
  const port = (async (role, messages, opts) => {
    calls.push({ role, text: messages.map((m) => m.content).join("\n") });
    if (opts?.signal?.aborted) throw new Error("aborted");
    if (role === "pov") return { text: JSON.stringify({ povs: Object.fromEntries(["you", "maya", "rosa", "jordan"].map((who) => [who, `Only part of it reaches ${who}: voices at the counter.`])) }) };
    if (role === "check") return { text: JSON.stringify({ faithful: true }) };
    if (role === "narrator") {
      const next = script.narrator?.shift() ?? "A passage.";
      return { text: typeof next === "string" ? next : await next() };
    }
    return { text: JSON.stringify(queues[role]?.shift() ?? {}) };
  }) as ModelPort & { calls: { role: string; text: string }[] };
  port.calls = calls;
  return port;
}

function sinkLog(): { sink: TurnSink; lines: string[]; content: string[] } {
  const lines: string[] = [];
  const content: string[] = [];
  return { sink: { progress: (t) => void lines.push(t), reasoning: (t) => void lines.push(t), content: (t) => void content.push(t), call: () => {} }, lines, content };
}

function turnInput(model: ModelPort, sink: TurnSink, signal: AbortSignal, o: Partial<DepthTurnInput> = {}): DepthTurnInput {
  return {
    chatId: "chat-1",
    userId: "u1",
    turn: "gen-1",
    kind: "normal",
    at: { basis: { message: "m1", swipe: "s0", parentPath: "p0" }, state, world, story: { beats: [], staging: [], replaced: [], duplicates: [] }, events: [] },
    plan: { events: [NOTE], elapsedMinutes: 0, resolutions: [], chips: [] },
    runSeed: "run-1",
    seed: "seed-1",
    input: { messageId: "m1", text: LINE },
    recent: "",
    settings: defaultSettings(),
    model,
    sink,
    signal,
    rt: { registry: reg, blobs: { get: async (_u, hash) => store.get(hash) ?? null } },
    ...o,
  };
}

const beatsIn = (events: readonly LedgerEvent[]): Beat[] => events.flatMap((e) => (e.type === STORY_BEAT && "data" in e ? [beatOf(e.data)].filter((b): b is Beat => b !== null) : []));
const by = (b: Beat): string => ("turn" in b.by ? b.by.decided : "?");

/** The scene played whole, its prose streamed: the source a Re-narrate renders again. */
async function played(narrator: Narrated[] = ["The espresso machine hisses behind the counter.", "Maya reaches for a cup. “Coming right up, Alex.”"], signal = new AbortController().signal) {
  const model = scripted({ gm: [GM], author: [SETUP, STEP], character: [PLAY], narrator });
  const log = sinkLog();
  const result = await runDepthTurn(turnInput(model, log.sink, signal), scenePlugs);
  for (const [hash, text] of Object.entries(result.blobs)) store.set(hash, text);
  return { result, model, ...log };
}

describe("a depth turn, beat by beat", () => {
  test("the GM writes the player's beats, the author sets the scene and steps between beats, a character plays as its own agent, and each moment streams as it is decided", async () => {
    const { result, model, lines, content } = await played();
    expect(result.stopped).toBe(false);
    // Each role was asked as often as the scene needed it.
    const roles = model.calls.map((c) => c.role);
    expect(["gm", "author", "character", "narrator", "check"].map((r) => roles.filter((x) => x === r).length)).toEqual([1, 2, 1, 2, 2]);

    // The record's pre: the engine run's events first, then the scene's, moment by moment; it folds as decided.
    expect(result.pre[0]).toEqual(NOTE);
    expect(() => fold(reg, world, state, result.pre)).not.toThrow();
    const scene = result.pre.find((e) => e.type === STORY_SCENE);
    expect(scene && "data" in scene ? sceneOf(scene.data) : null).toMatchObject({ place: "cafe", opens: true, cast: [{ who: "maya", effort: "agent" }, { who: "rosa", effort: "author" }, { who: "jordan", effort: "world" }] });
    const beats = beatsIn(result.pre);
    expect(beats.map((b) => [by(b), b.actors])).toEqual([
      ["player", ["you"]],
      ["author", []],
      ["character", ["maya"]],
      ["author", ["rosa"]],
    ]);
    const [order, , answer, page] = beats as [Beat, Beat, Beat, Beat];
    // Who perceived each: the actor their own act, told from the inside by the render where the beat holds no deed (the player character's aside: his acts are the player's); a reach to a minded character the author plays waits for its catch-up, with its point of view.
    expect(order.exposure.find((x) => x.who === "you")).toEqual({ who: "you", channel: "sight", reach: "whole" });
    // Heard alone, whole, the order reaches Maya as what could be heard of it, never what there was to see (LIVE3c L3c-4).
    expect(order.exposure.find((x) => x.who === "maya")).toEqual({ who: "maya", channel: "hearing", reach: "whole", pov: blobHash("Only part of it reaches maya: voices at the counter.") });
    expect(order.exposure.find((x) => x.who === "rosa")).toMatchObject({ reach: "partial", pending: true, pov: expect.any(String) });
    expect(answer.exposure.find((x) => x.who === "maya")).toEqual({ who: "maya", channel: "sight", reach: "whole", pov: expect.any(String) });
    expect(answer.exposure.find((x) => x.who === "rosa")).toMatchObject({ reach: "partial", pending: true });
    expect(store.get(answer.quotes ?? "")).toBe("Coming right up, Alex.");
    expect(page.exposure.find((x) => x.who === "rosa")).toMatchObject({ reach: "whole", pending: true });
    // The point-of-view render read what there was to sense, never what happened.
    const povs = model.calls.filter((c) => c.role === "pov");
    expect(povs.length).toBeGreaterThan(0);
    expect(povs.some((c) => c.text.includes(ORDER_SURFACE))).toBe(true);
    for (const c of povs) expect(c.text).not.toContain(ORDER_WHAT);
    // A play reads none of the author's staging: what Maya perceives of the others is what the beats brought her (finding 10).
    const plays = model.calls.filter((c) => c.role === "character");
    expect(plays).toHaveLength(1);
    for (const s of ["Who is here", "at the window table", "reading the paper", "ordering"]) expect(plays[0]?.text).not.toContain(s);
    // Who the author named next but doesn't play as their own agent was refused, and said (an act written for one who does is the answer's to redo: below).
    expect(lines.some((l) => l.includes("doesn't play as their own agent this scene"))).toBe(true);

    // One passage per moment, streamed in order; the read part holds them.
    expect(content).toEqual(["The espresso machine hisses behind the counter.", "\n\nMaya reaches for a cup. “Coming right up, Alex.”"]);
    expect(passagesIn(result.read).map((p) => [p.moment, p.beats.length])).toEqual([
      [0, 2],
      [1, 2],
    ]);
    // What runs after the reply: Maya remembers the scene she played; the poll reads the beats and the player's signals.
    expect(result.after).toEqual({ scene: sceneOf(scene && "data" in scene ? scene.data : null)?.scene ?? "", ended: false, remember: ["maya"], poll: true, beats: beats.map((b) => b.id), signals: ["(OOC: keep it slow)"] });
  });

  test("staging is what anyone there could see, never a motive or an act done unseen: the setup and each step are told so, as an episode's are, since points of view are written from it", () => {
    const text = (id: string): string => PROMPTS.find((d) => d.id === id)?.text ?? "";
    for (const id of [SCENE_TEXT.setup, SCENE_TEXT.step, OFFSCREEN_TEXT.episode, OFFSCREEN_TEXT.episodeStep]) expect({ id, onlooker: text(id).includes("what anyone there could see them doing, and what occupies their eyes and hands: never a motive, a thought or anything done unseen") }).toEqual({ id, onlooker: true });
    expect(text(SCENE_TEXT.setup)).toContain("Stage it: everyone present, where they are and what they are doing, as anyone there could see it");
  });

  test("Stop: the moments whose prose streamed stay, and nothing decided after them", async () => {
    const stop = new AbortController();
    const { result, content } = await played(
      [
        "The espresso machine hisses behind the counter.",
        async () => {
          // The player stops while the second moment's passage renders.
          stop.abort();
          return "Maya reaches for a cup.";
        },
      ],
      stop.signal,
    );
    expect(result.stopped).toBe(true);
    expect(content).toEqual(["The espresso machine hisses behind the counter."]);
    // Moment 0 is kept whole (the engine run's events, the scene, its staging, his order and the machine); Maya's answer and her mind's record of it go.
    expect(result.pre[0]).toEqual(NOTE);
    expect(beatsIn(result.pre).map(by)).toEqual(["player", "author"]);
    expect(result.pre.some((e) => e.type.startsWith("minds."))).toBe(false);
    expect(passagesIn(result.read)).toHaveLength(1);
    expect(result.after.remember).toEqual([]);
    expect(() => fold(reg, world, state, result.pre)).not.toThrow();
  });

  test("Re-narrate renders the same beats again and decides nothing; stopped, it keeps its source's plan through the passage that streamed", async () => {
    const { result: source } = await played();
    const again = scripted({ narrator: ["Steam rises from the machine.", "Maya pulls down a cup. “Coming right up, Alex.”"] });
    const log = sinkLog();
    const re = await runDepthTurn(turnInput(again, log.sink, new AbortController().signal, { kind: "renarrate", source: { pre: source.pre, read: source.read } }), scenePlugs);
    expect([...new Set(again.calls.map((c) => c.role))].sort()).toEqual(["check", "narrator"]);
    // The same plan, then what rendering it again cost: the source's own spend rides with the beats it copies.
    expect(re.pre.slice(0, source.pre.length)).toEqual(source.pre);
    expect(re.pre.slice(source.pre.length).map((e) => e.type)).toEqual([AUTHOR_SPEND]);
    expect(log.content).toEqual(["Steam rises from the machine.", "\n\nMaya pulls down a cup. “Coming right up, Alex.”"]);
    expect(passagesIn(re.read).map((p) => p.beats)).toEqual(passagesIn(source.read).map((p) => p.beats));
    expect(re.after.signals).toEqual(["a Re-narrate"]);

    const stop = new AbortController();
    const cut = await runDepthTurn(
      turnInput(
        scripted({
          narrator: [
            "Steam rises from the machine.",
            async () => {
              stop.abort();
              return "Maya pulls down a cup.";
            },
          ],
        }),
        sinkLog().sink,
        stop.signal,
        { kind: "renarrate", source: { pre: source.pre, read: source.read } },
      ),
      scenePlugs,
    );
    expect(cut.stopped).toBe(true);
    expect(beatsIn(cut.pre).map((b) => b.id)).toEqual(beatsIn(source.pre).slice(0, 2).map((b) => b.id));
    const plan = cut.pre.filter((e) => e.type !== AUTHOR_SPEND);
    expect(plan).toEqual(source.pre.slice(0, plan.length));
    expect(cut.pre.at(-1)?.type).toBe(AUTHOR_SPEND);
  });

  test("the author's setup reads the archive, and the excerpts it quotes reach the narrator's part exactly as written", async () => {
    // The chat's archive before this turn: one earlier reply, where Maya made a promise.
    const EARLIER = "Maya laughs. “Your mug stays behind the counter, Alex, chipped or not. Always.” She sets it on the shelf.";
    const PROMISE = "“Your mug stays behind the counter, Alex, chipped or not. Always.”";
    const from = EARLIER.indexOf(PROMISE);
    const searched: unknown[] = [];
    const archive: ArchiveSource = {
      search: async (q) => {
        searched.push(q);
        return { hits: [{ messageId: "m0", index: 0, isUser: false, swipeId: 0, swipe: "r0", storyTime: null, places: ["cafe"], people: ["maya"], beats: [], score: 2, snippet: EARLIER, span: [0, EARLIER.length] }], total: 1 };
      },
      quote: async (r) => {
        if (r.messageId !== "m0") return null;
        const [start, end] = r.span ?? [0, EARLIER.length];
        return { messageId: "m0", index: 0, isUser: false, swipeId: 0, swipe: "r0", storyTime: null, span: [start, end], text: EARLIER.slice(start, end), truncated: false };
      },
    };
    const reads = { archive: [{ tool: "archive_search", text: "mug" }] };
    const setup = { ...SETUP, quotes: [{ message: "[m0]", from, to: from + PROMISE.length, why: "her promise about his mug" }, { message: "m9", why: "a message after this turn" }] };
    const model = scripted({ gm: [GM], author: [reads, setup, STEP], character: [PLAY] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal, { archive }), scenePlugs);
    expect(result.stopped).toBe(false);

    // The setup was told of the archive's tools, read it, and answered with what it found in front of it.
    const authors = model.calls.filter((c) => c.role === "author");
    expect(authors).toHaveLength(3);
    expect(authors[0]?.text).toContain("archive_search");
    expect(searched).toEqual([{ text: "mug", offset: 0 }]);
    expect(authors[1]?.text).toContain("What the archive gave");
    expect(authors[1]?.text).toContain(EARLIER);
    expect(log.lines.some((l) => l.startsWith("The author reads the archive: archive_search"))).toBe(true);

    // Every narrator call holds the passage exactly as written; a quote of a message not before this turn is refused, and said.
    const narrated = model.calls.filter((c) => c.role === "narrator");
    expect(narrated.length).toBeGreaterThan(0);
    for (const c of narrated) {
      expect(c.text).toContain(`From message 1, for her promise about his mug:\n${PROMISE}`);
      expect(c.text).not.toContain("She sets it on the shelf.");
    }
    expect(log.lines.some((l) => l.includes("a quote named m9, which isn't a message of this chat's story before this turn"))).toBe(true);
  });

  test("without the archive, the setup asks once and a quote it names is refused", async () => {
    const model = scripted({ gm: [GM], author: [{ ...SETUP, quotes: [{ message: "m0" }] }, STEP], character: [PLAY] });
    const log = sinkLog();
    await runDepthTurn(turnInput(model, log.sink, new AbortController().signal), scenePlugs);
    expect(model.calls.filter((c) => c.role === "author")).toHaveLength(2);
    expect(model.calls.find((c) => c.role === "author")?.text).toContain("The chat's archive can't be read this turn");
    expect(model.calls.filter((c) => c.role === "narrator").some((c) => c.text.includes("Words from earlier in the story"))).toBe(false);
    expect(log.lines.some((l) => l.includes("the archive can't be read this turn"))).toBe(true);
  });

  test("the author naming the player character by an id spelled from his name (alex_rivera, as the live trial's author wrote jordan_ellis for [pov]) still stages him and has the scene reach him", async () => {
    const spelled = {
      ...SETUP,
      staging: SETUP.staging.map((s) => (s.who === "you" ? { ...s, who: "alex_rivera" } : s)),
      beats: [{ ...SETUP.beats[0], exposure: [{ who: "Alex-Rivera", channel: "hearing", reach: "whole" }, { who: "maya", channel: "hearing", reach: "whole" }] }],
    };
    const model = scripted({ gm: [GM], author: [spelled, { ...STEP, exposure: [{ beat: "d1", who: "alex_rivera", channel: "hearing", reach: "whole" }] }], character: [PLAY] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal), scenePlugs);
    expect(log.lines.some((l) => l.includes("doesn't have"))).toBe(false);
    const [, hiss, answer] = beatsIn(result.pre) as [Beat, Beat, Beat];
    // Heard alone, each reaches him as what could be heard of it, his own point of view (LIVE3c L3c-4).
    const heard = { who: "you", channel: "hearing", reach: "whole", pov: blobHash("Only part of it reaches you: voices at the counter.") } as const;
    expect(hiss.exposure.find((x) => x.who === "you")).toEqual(heard);
    expect(answer.exposure.find((x) => x.who === "you")).toEqual(heard);
    expect(log.content.length).toBeGreaterThan(0);
    // The lookup reads a name spelled as an id, case and `_`/`-` aside, for places too; an id stays first, and a name no one has stays unread.
    const names = namesOf(world, state);
    expect([names.person("alex_rivera"), names.person("[maya_chen]"), names.person("you"), names.place("daybreak_café"), names.person("alex_rivers")]).toEqual(["you", "maya", "you", "cafe", null]);
  });

  test("what the player's act attempts the GM names, and the rules resolve in the scene (the engine run before it read none of his words): the engine's own check from the turn's seed with his act, its changes in the record, the outcome right after his act", async () => {
    // The café with a wall to climb (d20 + skill against 12), and Alex's skill.
    const climbing = structuredClone(world);
    climbing.checks.climb = { id: "climb", dice: "d20", modifier: "self.skill", dc: "12" };
    climbing.actions.climb = { id: "climb", label: "Climb the wall", params: {}, requires: [], check: "climb", outcomes: { success: [{ type: "set", args: { entity: "self", field: "activity", value: "up" } }], failure: [{ type: "add", args: { entity: "self", field: "stress", delta: 5 } }] }, duration: "5" };
    const you = climbing.entities.you;
    if (you) you.fields = { ...you.fields, skill: 2 };
    const words = "I grab the drainpipe and climb up to the café's roof.";
    const act = { beats: [{ kind: "act", act: "did", actors: ["you"], about: [], what: "Alex climbs the drainpipe toward the roof.", surface: "Alex grabs the drainpipe and starts up the wall.", words: "grab the drainpipe and climb up to the café's roof", attempt: "climb the wall to the roof" }], signals: [] };
    const read = { actions: [{ action: "climb", params: {}, words: "climb up to the café's roof" }], judgement: null, none: null };
    const told = { what: "Alex's climb, as the check fell.", surface: "Alex hauls himself up the drainpipe.", about: ["you"] };
    // He perceives how his own climb went, as Maya does: something beyond his own beats reaches him, so the turn ends where the author ends it (LIVE3c L3c-5).
    const setup = { scene: { place: "cafe" }, cast: [], staging: [], exposure: [{ beat: "p2", who: "you", channel: "sight", reach: "whole" }, { beat: "p2", who: "maya", channel: "sight", reach: "whole" }], beats: [], next: [], end: "He climbs: the player speaks next." };
    const model = scripted({ gm: [act, read, told], author: [setup] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal, { at: { basis: { message: "m1", swipe: "s0", parentPath: "p0" }, state, world: climbing, story: { beats: [], staging: [], replaced: [], duplicates: [] }, events: [] }, input: { messageId: "m1", text: words } }), scenePlugs);

    expect(model.calls.map((c) => c.role).filter((r) => r === "gm" || r === "author")).toEqual(["gm", "gm", "gm", "author"]);
    // The GM read his act against what the rules let him do, with that act's own words.
    const asked = model.calls[1]?.text ?? "";
    expect(asked).toContain("climb: Climb the wall");
    expect(asked).toContain("The player's own words for this act: grab the drainpipe and climb up to the café's roof");
    // The engine rolled it from the turn's seed with his act, and its change is in the record.
    const direct = resolveOn(reg, climbing, state, { action: "climb", actor: "you" }, createRng(attemptSeed("seed-1", "p1")), { runSeed: "run-1" });
    const after = fold(reg, climbing, state, result.pre);
    expect([after.entities.you?.fields.activity, after.entities.you?.fields.stress]).toEqual([direct.state.entities.you?.fields.activity, direct.state.entities.you?.fields.stress]);
    // The setup read it among what the rules resolved, and exposed the outcome beat right after his act.
    expect(model.calls.find((c) => c.role === "author")?.text).toContain(`What the rules resolved:\n- Alex Rivera: climb${direct.resolution.outcome ? `, ${direct.resolution.outcome}` : ""}`);
    const beats = beatsIn(result.pre);
    expect(beats.map((b) => [by(b), b.actors])).toEqual([
      ["player", ["you"]],
      ["gm", []],
    ]);
    expect(result.blobs[beats[1]?.what ?? ""]).toBe(told.what);
    expect(beats[1]?.exposure.find((x) => x.who === "maya")).toMatchObject({ who: "maya", channel: "sight", reach: "whole" });
  });

  // LIVE3 L3a-5: the GM read "take the stairs after Danny" (down: Danny had gone down from 2B) as a
  // climb up, with a fitness check costing 5 minutes: it never saw the scene, and it read what his
  // act attempts from his whole message. And the depth release's late correctness review, finding 1:
  // an act of his whose words the GM tidied was dropped whole, so it never happened in canon.
  test("the GM reads his turn against the scene that is playing and what an act attempts from that act's own words: an action whose words aren't his for the act is dropped, and an act whose words his message doesn't hold plays with nothing it attempts read, each said", async () => {
    const climbing = structuredClone(world);
    climbing.checks.climb = { id: "climb", dice: "d20", modifier: "self.skill", dc: "12" };
    climbing.actions.climb = { id: "climb", label: "Climb the stairs", params: {}, requires: [], check: "climb", outcomes: { success: [{ type: "set", args: { entity: "self", field: "activity", value: "up" } }], failure: [{ type: "add", args: { entity: "self", field: "stress", delta: 5 } }] }, duration: "5" };
    const put = (text: string): string => (store.set(blobHash(text), text), blobHash(text));
    const from = { layer: "l-scene", messageId: "m0" };
    const down: Beat = { id: "b-down", at: state.clock, order: 0, scene: "s1", place: "cafe", actors: ["maya"], act: "did", about: [], what: put("Maya heads down the back stairs to the cellar."), surface: put("Maya goes down the back stairs."), exposure: [{ who: "you", channel: "sight", reach: "whole" }], by: { turn: "t0", decided: "author" } };
    const at = {
      basis: { message: "m1", swipe: "s0", parentPath: "p0" },
      state,
      world: climbing,
      story: { beats: [{ beat: down, from, index: 1 }], staging: [{ staging: { who: "maya", scene: "s1", where: put("on the back stairs, below Alex"), doing: put("going down to the cellar") }, from, index: 0 }], replaced: [], duplicates: [] },
      events: [{ event: sceneEvent({ scene: "s1", place: "cafe", at: state.clock, cast: [{ who: "maya", effort: "author", why: "She fetches the milk." }], opens: true }), from, at: 0, index: 0 }],
    };
    const text = "I take the stairs after Maya. “Need a hand?” grabbin teh crate she left on teh landing";
    const crate = { kind: "act", act: "did", actors: ["you"], about: ["maya"], what: "Alex picks up the crate Maya left on the landing.", surface: "Alex lifts a crate off the landing.", words: "grabbing the crate she left on the landing", attempt: "take the crate" };
    const gm = {
      beats: [{ kind: "act", act: "did", actors: ["you"], about: ["maya"], what: "Alex follows Maya down the back stairs.", surface: "Alex starts down the back stairs after Maya.", words: "take the stairs after Maya", attempt: "catch up with Maya on the stairs" }, crate],
      signals: [],
    };
    const read = { actions: [{ action: "climb", params: {}, words: "climb up the stairs" }], judgement: null, none: null };
    const setup = { scene: { place: "cafe" }, cast: [], staging: [], exposure: [], beats: [], next: [], end: "He follows her down: the player speaks next." };
    const model = scripted({ gm: [gm, read], author: [setup] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal, { at, input: { messageId: "m1", text } }), scenePlugs);
    const [reading, resolving, ...more] = model.calls.filter((c) => c.role === "gm");
    // The GM's reading of his turn had the scene so far and where everyone in it is.
    expect(reading?.text).toContain("Maya heads down the back stairs to the cellar.");
    expect(reading?.text).toContain("Where everyone in it is:\n- Maya Chen (id: maya): on the back stairs, below Alex; going down to the cellar");
    // Its reading of what his act attempts had the scene so far and that act's own words, never the rest of his message.
    expect(resolving?.text).toContain("Maya heads down the back stairs to the cellar.");
    expect(resolving?.text).toContain("The player's own words for this act: take the stairs after Maya");
    expect(resolving?.text).not.toContain("Need a hand?");
    // The climb up was dropped, said, and nothing rolled or was told of it.
    expect(log.lines).toContain("The GM's reading of what you attempt dropped climb: “climb up the stairs” isn't in your words.");
    expect(fold(reg, climbing, state, result.pre).entities.you?.fields.activity).toBe(state.entities.you?.fields.activity);
    // The crate, his own act in his own spelling, plays all the same: the setup reads it and it is in canon. What it attempts, read from words his message doesn't hold, isn't resolved, said.
    expect(log.lines).toContain(`The GM's reading of your turn: “${crate.surface}” stands, but not what it attempts (“${crate.attempt}”): “${crate.words}” isn't in your message.`);
    expect(more).toEqual([]);
    expect(model.calls.find((c) => c.role === "author")?.text).toContain(crate.what);
    expect(beatsIn(result.pre).map((b) => [by(b), b.actors, result.blobs[b.surface]])).toEqual([
      ["player", ["you"], "Alex starts down the back stairs after Maya."],
      ["player", ["you"], crate.surface],
    ]);
  });

  test("the steps a turn takes are Settings → Depth → Steps per turn: past them the player answers, said", async () => {
    const settings = defaultSettings();
    settings.depth.steps = 1;
    const again = { exposure: [{ beat: "d1", who: "you", channel: "hearing", reach: "whole" }], staging: [], beats: [], next: ["maya"], end: null };
    const model = scripted({ gm: [GM], author: [SETUP, again, again], character: [PLAY, PLAY] });
    const log = sinkLog();
    await runDepthTurn(turnInput(model, log.sink, new AbortController().signal, { settings }), scenePlugs);
    expect(model.calls.filter((c) => c.role === "character")).toHaveLength(1);
    const authors = model.calls.filter((c) => c.role === "author");
    expect(authors).toHaveLength(2);
    expect(authors[1]?.text).toContain("This is your last step before this turn ends whatever happens");
    expect(log.lines).toContain("The turn reached its bound of 1 step between beats (Settings → Depth → Steps per turn): the player answers here, and the scene goes on next turn.");
  });

  test("the player's signals beyond his words (what he asked of a swipe, his swipes around it) reach the setup and the poll beside how the turn came and his out-of-character lines", async () => {
    const asked = "he asked of the swipe he left: slower, and more of Maya";
    const model = scripted({ gm: [GM], author: [SETUP, STEP], character: [PLAY] });
    const result = await runDepthTurn(turnInput(model, sinkLog().sink, new AbortController().signal, { kind: "swipe", signals: [asked] }), scenePlugs);
    expect(model.calls.find((c) => c.role === "author")?.text).toContain(`His signals beyond the story (out-of-character lines and the like):\n- a swipe\n- ${asked}\n- (OOC: keep it slow)`);
    expect(result.after.signals).toEqual(["a swipe", asked, "(OOC: keep it slow)"]);
    const source = await played();
    const re = await runDepthTurn(turnInput(scripted({}), sinkLog().sink, new AbortController().signal, { kind: "renarrate", signals: [asked], source: { pre: source.result.pre, read: source.result.read } }), scenePlugs);
    expect(re.after.signals).toEqual(["a Re-narrate", asked]);
  });

  test("what the player asked a swipe to change reaches the narrator and its check, on a Re-run as on a Re-narrate", async () => {
    const direction = "Slower: let the café noise breathe.";
    const rerun = scripted({ gm: [GM], author: [SETUP, STEP], character: [PLAY] });
    await runDepthTurn(turnInput(rerun, sinkLog().sink, new AbortController().signal, { kind: "swipe", direction }), scenePlugs);
    const source = await played();
    const again = scripted({});
    await runDepthTurn(turnInput(again, sinkLog().sink, new AbortController().signal, { kind: "renarrate", direction, source: { pre: source.result.pre, read: source.result.read } }), scenePlugs);
    for (const model of [rerun, again]) {
      const told = model.calls.filter((c) => c.role === "narrator" || c.role === "check");
      expect(told.map((c) => c.role)).toEqual(["narrator", "check", "narrator", "check"]);
      for (const c of told) expect(c.text).toContain(direction);
    }
  });

  test("an empty Send (no new message: the story goes on from the last reply) plays the scene from there: the GM reads no words of his, the setup is told he sent none, and the first passage opens the reply", async () => {
    const model = scripted({ author: [{ ...SETUP, exposure: [] }, STEP], character: [PLAY] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal, { input: null, plan: null }), scenePlugs);
    expect(model.calls.filter((c) => c.role === "gm")).toEqual([]);
    expect(model.calls.find((c) => c.role === "author")?.text).toContain("The player sent no new message: he asks the story to go on from here.");
    expect(beatsIn(result.pre).map(by)).not.toContain("player");
    expect(log.content[0]?.startsWith("\n")).toBe(false);
    expect(log.content.length).toBeGreaterThan(0);
  });
});

/** Today's ceiling, spent. */
const SPENT_DAY: CeilingBind = { which: "day", limit: 50_000, spent: 50_000, words: "today's depth work has spent 50K tokens, at its ceiling of 50K (Settings → Depth → Budget → Per day)" };

/** A budget whose day ceiling binds once `bound()` says so, with 40K left before then. */
function budgetOf(bound: () => boolean): TurnBudget {
  return { binds: () => (bound() ? SPENT_DAY : null), left: () => ({ turn: null, day: bound() ? 0 : 40_000 }) };
}

/** Maya's acts as the author plays them once the budget slid her to it: her answer, then the coffee set down, where the turn ends. */
const SLID_STEPS = [
  { exposure: [], staging: [], beats: [{ by: "maya", actors: ["maya"], act: "said", what: "Maya tells Alex his coffee is coming.", surface: "Maya reaches for a cup.", quotes: "Coming right up.", exposure: [{ who: "you", channel: "hearing", reach: "whole" }] }], next: ["maya"], end: null },
  { exposure: [], staging: [], beats: [{ by: "maya", actors: ["maya"], act: "did", what: "Maya sets the coffee down in front of Alex.", surface: "Maya sets a coffee on the counter.", exposure: [{ who: "you", channel: "sight", reach: "whole" }] }], next: [], end: "The coffee is served: the player answers." },
];

const sceneSpend = (pre: readonly LedgerEvent[]): SpendData | undefined => pre.flatMap((e) => authorData<SpendData>(e, AUTHOR_SPEND) ?? []).find((s) => s.treatment === "scene");
const scenesIn = (pre: readonly LedgerEvent[]) => pre.flatMap((e) => (e.type === STORY_SCENE && "data" in e ? [sceneOf(e.data)].filter((s) => s !== null) : []));

describe("a depth turn under a ceiling that binds (§6.5)", () => {
  test("bound from the start: the setup reads it, whoever it still cast as their own agent the author plays, and its steps play them as far as it judges; the scene never ends at moment 0", async () => {
    const model = scripted({ gm: [GM], author: [SETUP, ...SLID_STEPS], character: [PLAY] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal, { budget: budgetOf(() => true) }), scenePlugs);
    expect(result.stopped).toBe(false);
    // No one played as their own agent: Maya was the author's, in both of its steps.
    expect(model.calls.some((c) => c.role === "character")).toBe(false);
    const authors = model.calls.filter((c) => c.role === "author");
    expect(authors).toHaveLength(3);
    expect(authors[0]?.text).toContain(`The budget binds: ${SPENT_DAY.words}.`);
    expect(authors[1]?.text).toContain("Due to act now, whom you play: Maya Chen [maya].");
    expect(authors[1]?.text).toContain("The budget slid Maya Chen [maya] to you this turn");
    expect(authors[2]?.text).toContain("Maya tells Alex his coffee is coming.");
    const hers = beatsIn(result.pre).filter((b) => b.actors.includes("maya"));
    expect(hers.map((b) => [by(b), result.blobs[b.what]])).toEqual([
      ["author", "Maya tells Alex his coffee is coming."],
      ["author", "Maya sets the coffee down in front of Alex."],
    ]);
    // The cast has her as the author's, with why; the scene's spend keeps the line; the thinking block says it.
    expect(scenesIn(result.pre).map((s) => s.cast.find((c) => c.who === "maya"))).toEqual([{ who: "maya", effort: "author", why: "She serves him, as herself. The budget slid them to the author: today's ceiling binds." }]);
    expect(sceneSpend(result.pre)?.put).toEqual([`Maya Chen played by the author rather than their own agents: ${SPENT_DAY.words}`]);
    expect(log.lines.some((l) => l.includes(`The budget: ${SPENT_DAY.words}, so the author plays Maya Chen from here rather than their own agents`))).toBe(true);
    expect(log.lines.some((l) => l.includes("The turn ends: The coffee is served"))).toBe(true);
    // Three moments rendered: the opening, then each of the author's steps.
    expect(passagesIn(result.read).map((p) => p.moment)).toEqual([0, 1, 2]);
    expect(() => fold(reg, world, state, result.pre)).not.toThrow();
  });

  test("bound mid-scene: whoever still plays as their own agent slides to the author from that moment, recorded in the scene's cast, and the author's next step plays them", async () => {
    const answered = { exposure: [{ beat: "d1", who: "you", channel: "hearing", reach: "whole" }], staging: [], beats: [], next: ["maya"], end: null };
    const model = scripted({ gm: [GM], author: [SETUP, answered, SLID_STEPS[1]], character: [PLAY, PLAY] });
    // The ceiling binds once the author has set the scene and taken one step.
    const budget = budgetOf(() => model.calls.filter((c) => c.role === "author").length >= 2);
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal, { budget }), scenePlugs);
    expect(model.calls.filter((c) => c.role === "character")).toHaveLength(1);
    const authors = model.calls.filter((c) => c.role === "author");
    expect(authors).toHaveLength(3);
    expect(authors[1]?.text).toContain("The budget: today's depth work has about 40K tokens left under its ceiling (Per day).");
    expect(authors[2]?.text).toContain("Due to act now, whom you play: Maya Chen [maya].");
    expect(authors[2]?.text).toContain(`The budget binds: ${SPENT_DAY.words}.`);
    // Her first act her own agent's, her next the author's; the scene's cast changes at that moment.
    expect(beatsIn(result.pre).filter((b) => b.actors.includes("maya")).map(by)).toEqual(["character", "author"]);
    expect(scenesIn(result.pre).map((s) => s.cast.find((c) => c.who === "maya")?.effort)).toEqual(["agent", "author"]);
    expect(sceneSpend(result.pre)?.put).toEqual([`Maya Chen played by the author rather than their own agents: ${SPENT_DAY.words}`]);
    // She played once as herself: she remembers the scene after the reply.
    expect(result.after.remember).toEqual(["maya"]);
    expect(passagesIn(result.read).map((p) => p.moment)).toEqual([0, 1, 2]);
    expect(() => fold(reg, world, state, result.pre)).not.toThrow();
  });
});

describe("a depth turn's commit", () => {
  test("its record holds the scene's pre and prose, never the engine plan alone or a read of the reply, whether the reply ended or was stopped", async () => {
    const READ = "A read of the reply, which a depth turn never makes.";
    const model: TurnModel = { plan: () => [NOTE], read: () => [{ type: "engine.note", data: { text: READ } }] };
    const h = new Harness("fresh", { packs: [storyPack], model });
    const hooks = h.service.hooks;
    if (!hooks) throw new Error("no hooks");
    // The runtime's commit of a depth turn: the scene becomes the turn's plan, its prose the read part.
    hooks.beforeCommit = async (input) => {
      if (input.scene) input.core.scene(input.generationId, input.scene.pre, input.scene.read, input.observed);
    };
    const chat = await h.newChat();
    const sceneFor = (turn: string) => {
      const said: Beat = { id: beatId(turn, "0"), at: 0, order: 0, place: "home", actors: ["dev"], act: "said", about: [], what: blobHash(`what ${turn}`), surface: blobHash(`surface ${turn}`), exposure: [{ who: POV, channel: "hearing", reach: "whole" }], by: { turn, decided: "character" } };
      const passage = passageEvent({ moment: 0, index: 0, beats: [said.id], pov: POV, text: blobHash(`passage ${turn}`), drafts: [{ text: blobHash(`passage ${turn}`), faithful: true }] });
      return { pre: [NOTE, beatEvent(said)], read: [passage], blobs: {} };
    };
    const head = async (): Promise<Rec> => {
      const core = await h.core(chat);
      const reply = (await h.chain(chat)).findLast((m) => !m.isUser);
      const rec = reply ? activeRecord(reply, core.journal.tombstones) : null;
      if (!rec) throw new Error("no record on the head");
      return rec;
    };

    h.host.sendUser(chat, "Morning, Dev.");
    await h.host.settle();
    const ended = await h.host.start(chat, { type: "normal" });
    const first = sceneFor(ended.id);
    h.service.sceneCommit(ended.id, first);
    await h.host.finish(ended, "Dev nods.");
    const rec = await head();
    expect([rec.status, rec.events.slice(0, rec.pre), rec.events.slice(rec.pre)]).toEqual(["ok", first.pre, first.read]);

    // Stopped after its passage streamed: the same, and the reply's text is never read.
    h.host.sendUser(chat, "Busy day?");
    await h.host.settle();
    const stopped = await h.host.start(chat, { type: "normal" });
    const second = sceneFor(stopped.id);
    h.service.sceneCommit(stopped.id, second);
    await h.host.stop(stopped, "Dev shrugs.");
    const cut = await head();
    expect([cut.events.slice(0, cut.pre), cut.events.slice(cut.pre)]).toEqual([second.pre, second.read]);
    const { reference, optimized } = await h.folds(chat);
    expect([reference.violations, optimized.violations]).toEqual([[], []]);
  });
});

describe("a depth turn whose stage fails mid-scene (conformance finding 3)", () => {
  test("keeps the beats whose prose streamed, as a Stop does, and says why; a stage that fails before any passage streamed fails the turn", async () => {
    const base = scripted({ gm: [GM], author: [SETUP], character: [PLAY], narrator: ["The espresso machine hisses behind the counter."] });
    let authored = 0;
    // The author's step after Maya plays fails (a provider error), once the opening moment's passage is on its way.
    const model = (async (role, messages, opts) => {
      if (role === "author" && ++authored === 2) throw new Error("the provider answered 429");
      return base(role, messages, opts);
    }) as ModelPort;
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal), scenePlugs);
    expect(result.error).toBe("the provider answered 429");
    expect(result.stopped).toBe(false);
    expect(log.content).toEqual(["The espresso machine hisses behind the counter."]);
    expect(passagesIn(result.read).map((p) => p.moment)).toEqual([0]);
    // The opening moment's beats are canon; Maya's play, decided after it and never rendered, isn't.
    expect(beatsIn(result.pre).map(by)).toEqual(["player", "author"]);
    expect(log.lines.some((l) => l.includes("a stage failed: the provider answered 429"))).toBe(true);
    expect(result.after.beats).toEqual(beatsIn(result.pre).map((b) => b.id));

    // Before any passage streamed, the failure is the turn's: nothing of it is kept.
    const early = (async (role, messages, opts) => {
      if (role === "author") throw new Error("the provider is down");
      return base(role, messages, opts);
    }) as ModelPort;
    await expect(runDepthTurn(turnInput(early, sinkLog().sink, new AbortController().signal), scenePlugs)).rejects.toThrow("the provider is down");
  });
});

describe("an answer of the author's that can't all be kept (LIVE3 lane 1)", () => {
  // The live case (L3a-3): the setup cast Danny as his own agent, then wrote his answer as its own beat and a walk with
  // the player character among its actors, set no one next and ended the turn: both beats were refused, the author never
  // heard why, and Danny never spoke. Here Maya is the one playing as her own agent.
  const answer = { ref: "b1", by: "maya", actors: ["maya"], act: "said", what: "Maya tells Alex his coffee is on the house.", surface: "Maya says the coffee is on the house.", quotes: "On the house, Alex." };
  const walk = { ref: "b2", actors: ["maya", "you"], act: "did", what: "Maya and Alex walk to the window table.", surface: "Maya and Alex walk over to the window table." };
  const ended = "Maya has answered, and made her offer: the player speaks next.";
  const answered = { exposure: [{ beat: "d1", who: "you", channel: "hearing", reach: "whole" }], staging: [], beats: [], next: [], end: "Maya has answered: the player speaks next." };

  test("a setup's beat for someone playing as their own agent, or for the player character, is refused alone and said back; the author sets the scene again, and whoever it still writes an act for plays as their own agent rather than the turn ending", async () => {
    const first = { ...SETUP, beats: [answer, walk, ...SETUP.beats], next: [], end: ended };
    const again = { ...SETUP, beats: [answer, ...SETUP.beats], next: [], end: ended };
    const model = scripted({ gm: [GM], author: [first, again, answered], character: [PLAY] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal), scenePlugs);
    const authors = model.calls.filter((c) => c.role === "author");
    expect(authors).toHaveLength(3);
    // Told what couldn't be kept and why, in the same conversation: the setup again.
    const told = authors[1]?.text ?? "";
    expect(told).toContain(JSON.stringify(first));
    expect(told).toContain("beat b1: Maya Chen [maya] decides their own acts (playing as their own agent); the beat wasn't kept");
    expect(told).toContain(`beat b2: Alex Rivera [you], Maya Chen [maya] decide their own acts (the player character is the player's, and the other plays as their own agent); the beat wasn't kept; where the others only spoke to him or acted on him, name Alex Rivera [you] in its "addressed" and its exposure, never its actors`);
    expect(log.lines.some((l) => l.startsWith("The author's setup couldn't all be kept") && l.includes("beat b2"))).toBe(true);
    // Its answer again still wrote Maya's: refused alone, the rest of it kept, and her own agent plays in its place.
    expect(model.calls.filter((c) => c.role === "character")).toHaveLength(1);
    const beats = beatsIn(result.pre);
    expect(beats.map((b) => [by(b), b.actors])).toEqual([
      ["player", ["you"]],
      ["author", []],
      ["character", ["maya"]],
    ]);
    expect(beats.some((b) => [answer.what, walk.what].includes(result.blobs[b.what] ?? ""))).toBe(false);
    expect(log.lines).toContain("The author's setup: Maya Chen [maya] plays as their own agent: their own agent acts now in place of the act written for them, and the turn goes on to it rather than ending");
    // The author's step hears what its last answer couldn't keep, and ends the turn once Maya has played.
    expect(authors[2]?.text).toContain("What your last answer couldn't keep:\n- beat b1: Maya Chen [maya] decides their own acts");
    expect(log.lines.some((l) => l.includes("The turn ends: Maya has answered"))).toBe(true);
    expect(result.after.remember).toEqual(["maya"]);
  });

  test("told why, the setup names her next instead: her own agent plays, and nothing is said of it after", async () => {
    const first = { ...SETUP, beats: [answer, ...SETUP.beats], next: [], end: ended };
    const fixed = { ...SETUP, next: ["maya"], end: null };
    const model = scripted({ gm: [GM], author: [first, fixed, answered], character: [PLAY] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal), scenePlugs);
    expect(model.calls.filter((c) => c.role === "author")).toHaveLength(3);
    expect(model.calls.filter((c) => c.role === "character")).toHaveLength(1);
    expect(beatsIn(result.pre).map(by)).toEqual(["player", "author", "character"]);
    expect(log.lines.some((l) => l.includes("plays as their own agent: their own agent acts now"))).toBe(false);
    expect(model.calls.filter((c) => c.role === "author")[2]?.text).not.toContain("What your last answer couldn't keep");
  });

  test("a step's beat for someone playing as their own agent is said back, and the step taken again", async () => {
    const step = { ...answered, beats: [{ ref: "s1", actors: ["maya"], act: "did", what: "Maya slides the cup across.", surface: "Maya slides a cup across the counter." }], end: null, next: [] };
    const model = scripted({ gm: [GM], author: [SETUP, step, answered], character: [PLAY] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal), scenePlugs);
    const authors = model.calls.filter((c) => c.role === "author");
    expect(authors).toHaveLength(3);
    expect(authors[2]?.text).toContain("beat s1: Maya Chen [maya] decides their own acts (playing as their own agent); the beat wasn't kept");
    expect(log.lines.some((l) => l.startsWith("The author's step couldn't all be kept"))).toBe(true);
    // Taken again, the step ends the turn: the cup's beat was never kept.
    expect(beatsIn(result.pre).some((b) => result.blobs[b.what] === "Maya slides the cup across.")).toBe(false);
    expect(log.lines.some((l) => l.includes("The turn ends: Maya has answered"))).toBe(true);
  });

  test("the player character listed among a beat's actors and named in its addressed leaves its actors: the beat is kept, he perceives it, and the author's next step hears why; a beat he alone acts in is refused (LIVE3 lane 1b)", async () => {
    // The live case: the setup wrote Marcus's answer and Danny's line with Jordan, the one they answered, among their
    // actors; both were refused, and Marcus's answer was lost. Here Rosa, whom the author plays, speaks to Alex.
    const greeting = { ref: "w1", by: "rosa", actors: ["rosa", "you"], addressed: ["you"], act: "said", what: "Rosa tells Alex the coffee here is the best in town.", surface: "Rosa looks up from her paper and says the coffee here is the best in town.", quotes: "Best coffee in town, this." };
    const sits = { ref: "w2", actors: ["you"], act: "did", what: "Alex sits down at the window table.", surface: "Alex sits down by the window." };
    const model = scripted({ gm: [GM], author: [{ ...SETUP, beats: [greeting, sits, ...SETUP.beats] }, { ...SETUP, beats: [greeting, ...SETUP.beats] }, answered], character: [PLAY] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal), scenePlugs);
    const authors = model.calls.filter((c) => c.role === "author");
    expect(authors).toHaveLength(3);
    // The author's texts say being addressed is not acting.
    expect(authors[0]?.text).toContain("Being addressed is not acting: when someone speaks to him or does something to him, the act is theirs, and he goes in its exposure");
    // Only the beat he alone acts in was refused and said back.
    expect(authors[1]?.text).toContain("beat w2: Alex Rivera [you] decides their own acts (the player character is the player's); the beat wasn't kept");
    expect(authors[1]?.text).not.toContain("beat w1: Alex Rivera [you] decides");
    expect(beatsIn(result.pre).some((b) => result.blobs[b.what] === sits.what)).toBe(false);
    // Rosa's line is kept as her act, Alex the one she addressed, perceiving it whole as he would have as one of its actors.
    const kept = beatsIn(result.pre).find((b) => result.blobs[b.what] === greeting.what);
    expect(kept?.actors).toEqual(["rosa"]);
    expect(kept?.addressed).toEqual(["you"]);
    expect(kept?.exposure.find((x) => x.who === "you")).toMatchObject({ channel: "sight", reach: "whole" });
    // Said in the thinking block, and the author's next step hears it.
    const note = "beat w1: Alex Rivera [you] isn't one of its actors: being addressed is not acting, and his acts are the player's. It was kept as the act of Rosa Delgado [rosa], with him as the one addressed; put him in a beat's exposure, never its actors";
    expect(log.lines).toContain(`The author's setup: ${note}`);
    expect(authors[2]?.text).toContain(`What your last answer couldn't keep:\n- ${note}`);
  });

  test("the player character listed beside others among a beat's actors, where the answer doesn't name him addressed, acts in it: the joint act is refused and said back, and the scene set again, never kept as the others' (the final correctness review, finding 4)", async () => {
    // "Rosa and Alex lift the crate" was kept as Rosa's act with Alex addressed: canon held an act of his that the player never wrote.
    const lift = { ref: "w1", by: "rosa", actors: ["rosa", "you"], act: "did", what: "Rosa and Alex lift the crate onto the counter.", deed: "Rosa takes one end of the crate and Alex the other, and they heave it onto the counter.", surface: "Rosa and Alex heave a crate up onto the counter." };
    const model = scripted({ gm: [GM], author: [{ ...SETUP, beats: [lift, ...SETUP.beats] }, SETUP, answered], character: [PLAY] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal), scenePlugs);
    const authors = model.calls.filter((c) => c.role === "author");
    expect(authors).toHaveLength(3);
    // Refused as an act of his, with how to write him as the one addressed; the setup is asked again in the same conversation.
    const refusal = `beat w1: Alex Rivera [you] decides their own acts (the player character is the player's); the beat wasn't kept; where the others only spoke to him or acted on him, name Alex Rivera [you] in its "addressed" and its exposure, never its actors`;
    expect(authors[1]?.text).toContain(JSON.stringify(lift));
    expect(authors[1]?.text).toContain(refusal);
    expect(authors[1]?.text).toContain("Alex Rivera [you] is the player's: never write an act of his");
    expect(log.lines).toContain(`The author's setup couldn't all be kept: ${refusal}. Told why, it set the scene again.`);
    // Nothing of it is canon, as Rosa's act or as his.
    expect(beatsIn(result.pre).some((b) => result.blobs[b.what] === lift.what)).toBe(false);
    expect(beatsIn(result.pre).filter((b) => by(b) === "author" && b.actors.length > 0)).toEqual([]);
  });

  test("the setup reads the world's places by id; a place it names that the world doesn't have is said back and the scene set again, never dropped silently (L3a-8)", async () => {
    // The live case: the setup named its place `the_shop`, meaning Alder Automotive, having been told only where Jordan was.
    const opening = { ...SETUP, next: [], end: "He has ordered: the player speaks next." };
    const model = scripted({ gm: [GM], author: [{ ...opening, scene: { place: "the_office" } }, { ...opening, scene: { place: "office" } }] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal), scenePlugs);
    const authors = model.calls.filter((c) => c.role === "author");
    expect(authors).toHaveLength(2);
    expect(authors[0]?.text).toContain("The world's places, each by its id (a scene plays at one of them):\n- Daybreak Café [cafe], in Riverton");
    expect(authors[0]?.text).toContain("- Brightline office [office], in Riverton");
    expect(authors[1]?.text).toContain(`the scene's place "the_office" isn't one of the world's places`);
    expect(authors[1]?.text).toContain("Name the scene's place by the id of one of the world's places, as listed.");
    expect(log.lines.some((l) => l.startsWith(`The author's setup couldn't all be kept: the scene's place "the_office"`))).toBe(true);
    expect(scenesIn(result.pre).map((s) => s.place)).toEqual(["office"]);

    // Named wrongly again, the scene plays where he is, and the thinking block says so.
    const still = scripted({ gm: [GM], author: [{ ...opening, scene: { place: "the_office" } }, { ...opening, scene: { place: "the_office" } }] });
    const again = sinkLog();
    const kept = await runDepthTurn(turnInput(still, again.sink, new AbortController().signal), scenePlugs);
    expect(scenesIn(kept.pre).map((s) => s.place)).toEqual(["cafe"]);
    expect(again.lines).toContain(`The author's setup: the scene's place "the_office" isn't one of the world's places, so it plays where Alex Rivera [you] is, at Daybreak Café [cafe]`);
  });

  test("live author and GM beats carry their deed: each actor lives its own act as they did it, never as a surface written from where the player character stood (L3a-4)", async () => {
    // The live case: Helen's own act (setting her door chain) reached her as its surface, "a small metallic scrape and click,
    // two floors down", heard from Jordan's landing. Here Rosa, whom the author plays, leaves a tip at the window table.
    const tip = { ref: "w1", by: "rosa", actors: ["rosa"], act: "did", what: "Rosa leaves a tip for Maya and goes back to her paper.", deed: "Rosa tucks a dollar under her saucer and picks her paper back up.", surface: "By the window, a coin clinks on a saucer and a newspaper rustles.", exposure: [{ who: "you", channel: "hearing", reach: "partial" }] };
    const rain = { ref: "w2", act: "happened", what: "It starts to rain.", deed: "Someone runs for cover.", surface: "Rain patters on the café's front window.", exposure: [{ who: "you", channel: "hearing", reach: "whole" }] };
    const page = { ref: "w3", by: "rosa", actors: ["rosa"], act: "did", what: "Rosa turns a page.", surface: "A page turns by the window." };
    const order = { ...GM.beats[0], deed: "Alex steps up to the counter and asks Maya for a coffee." };
    const opening = { ...SETUP, beats: [...SETUP.beats, tip, rain, page], next: [], end: "He has ordered: the player speaks next." };
    const model = scripted({ gm: [{ ...GM, beats: [order] }], author: [opening] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal), scenePlugs);
    // Both the author's and the GM's texts ask each beat for its deed.
    expect(model.calls.find((c) => c.role === "author")?.text).toContain('"deed": what its actors did and said, plainly, as they did it, never as anyone saw or heard it');
    expect(model.calls.find((c) => c.role === "gm")?.text).toContain('"deed": what he did and said, plainly, as he did it');
    const beats = beatsIn(result.pre);
    const [ordered, , tipped, rained, turned] = beats as [Beat, Beat, Beat, Beat, Beat];
    // His own act carries its deed, as the GM wrote it.
    expect(result.blobs[ordered.deed ?? ""]).toBe(order.deed);
    // Rosa lives her own act as she did it, whole, however far the rest of it reached anyone: no point of view asked of her.
    expect(result.blobs[tipped.deed ?? ""]).toBe(tip.deed);
    expect(reachOf(tipped, "rosa")).toMatchObject({ as: "deed", whole: true, text: tipped.deed });
    expect(tipped.exposure.find((x) => x.who === "rosa")?.pov).toBeUndefined();
    // A deed for a beat no one acts in isn't kept, and said.
    expect(rained.deed).toBeUndefined();
    expect(log.lines).toContain("The author's setup: beat w2: no one acts in it, so its deed wasn't kept");
    // A beat with actors and no deed (LIVE3 lane 1b: live author beats often have none): the render tells each actor its own act from the inside, as the one doing it, never as its surface.
    expect(turned.deed).toBeUndefined();
    const own = reachOf(turned, "rosa");
    expect(own).toMatchObject({ as: "inside", whole: true });
    expect(result.blobs[own?.text ?? ""]).toBe("Only part of it reaches rosa: voices at the counter.");
    expect(model.calls.some((c) => c.role === "pov" && c.text.includes(page.surface) && c.text.includes("### rosa: by sight; whole; their own act"))).toBe(true);
  });
});

/** The moves a turn's record holds, each as [who, where to]. */
const moves = (pre: readonly LedgerEvent[]) => pre.flatMap((e) => (e.type === "set" && e.field === "place" ? [[e.entity, e.value]] : []));

describe("where a scene plays moves the people in it (LIVE3 lane 1b, L3b-1)", () => {
  // The live case: turns 1–3 played at Alder Automotive, the setup's place, while the state kept Jordan, Marcus and Danny at
  // 114 Harbor Street, so the top bar and Play → Here put them there, and the next turn's reading had Jordan leave "the door
  // of the house". Here the setup plays the scene at the office, where Alex went by his own act and no rule moved him.
  const opening = { ...SETUP, scene: { place: "office" }, staging: SETUP.staging.map((s) => ({ ...s, place: "office" })), next: [], end: "He has ordered: the player speaks next." };

  test("the setup's place moves the player character and everyone it stages there, with the scene, as the author's decision; whoever it doesn't stage stays", async () => {
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(scripted({ gm: [GM], author: [opening] }), log.sink, new AbortController().signal), scenePlugs);
    expect(moves(result.pre)).toEqual([
      ["you", "office"],
      ["maya", "office"],
      ["rosa", "office"],
    ]);
    // In moment 0, after the scene that plays there and before its staging and beats.
    const first = result.pre.findIndex((e) => e.type === "set" && e.field === "place");
    expect(first).toBeGreaterThan(result.pre.findIndex((e) => e.type === STORY_SCENE));
    expect(first).toBeLessThan(result.pre.findIndex((e) => e.type === STORY_STAGING));
    expect(first).toBeLessThan(result.pre.findIndex((e) => e.type === STORY_BEAT));
    // The state agrees with the scene: they are all at the office, and Jordan, whom it didn't stage, is still at the café.
    const after = fold(reg, world, state, result.pre);
    expect(["you", "maya", "rosa", "jordan"].map((id) => placeOfEntity(after, id))).toEqual(["office", "office", "office", "cafe"]);
    expect(log.lines).toContain("Where the scene plays moves the people in it: Alex Rivera, Maya Chen and Rosa Delgado are at Brightline office now.");
    // The scene's beats play there.
    expect(new Set(beatsIn(result.pre).map((b) => b.place))).toEqual(new Set(["office"]));

    // A scene where everyone already is moves no one.
    const stayed = await runDepthTurn(turnInput(scripted({ gm: [GM], author: [{ ...opening, scene: { place: "cafe" }, staging: SETUP.staging.map((s) => ({ ...s, place: "cafe" })) }] }), sinkLog().sink, new AbortController().signal), scenePlugs);
    expect(moves(stayed.pre)).toEqual([]);
  });

  test("someone a step stages arriving is moved where the scene plays, in that step's moment", async () => {
    // Jordan is at the office; the author's step has him walk into the café.
    const away = fold(reg, world, state, [{ type: "set", entity: "jordan", field: "place", value: "office" }]);
    const setup = { ...SETUP, cast: SETUP.cast.filter((c) => c.who !== "jordan"), next: ["maya"], end: null };
    const arrives = { exposure: [{ beat: "d1", who: "you", channel: "hearing", reach: "whole" }], staging: [{ who: "jordan", where: "in the doorway", doing: "shaking the rain off his coat", place: "cafe" }], beats: [{ act: "happened", what: "Jordan Price comes in from the rain.", surface: "The door opens on the rain and a man comes in.", exposure: [{ who: "you", channel: "sight", reach: "whole" }] }], next: [], end: "Someone has come in: the player answers." };
    const log = sinkLog();
    const input = turnInput(scripted({ gm: [GM], author: [setup, arrives], character: [PLAY] }), log.sink, new AbortController().signal);
    const result = await runDepthTurn({ ...input, at: { ...input.at, state: away } }, scenePlugs);
    expect(moves(result.pre)).toEqual([["jordan", "cafe"]]);
    expect(placeOfEntity(fold(reg, world, away, result.pre), "jordan")).toBe("cafe");
    // After the moment the setup opened with: the step's.
    expect(result.pre.findIndex((e) => e.type === "set" && e.field === "place")).toBeGreaterThan(result.pre.findIndex((e) => e.type === STORY_BEAT && "data" in e && beatOf(e.data)?.actors.includes("maya") === true));
    expect(log.lines).toContain("Where the scene plays moves the people in it: Jordan Price is at Daybreak Café now.");
  });
});

describe("the author's staging says where each person is, and only that moves them (LIVE3c, L3c-2)", () => {
  // The live case: Jordan rang the shop from Shoreline Fuel; the setup played the scene on the forecourt and staged Marcus and
  // Danny at the shop's end of the line, and the scene moved them both to Shoreline Fuel. Here Alex rings Jordan at the office.
  const away = fold(reg, world, state, [{ type: "set", entity: "jordan", field: "place", value: "office" }]);
  const atCafe = SETUP.staging.map((s) => ({ ...s, place: "cafe" }));
  const line = { who: "jordan", where: "at his desk, the phone to his ear", doing: "talking into the phone" };
  const call = (jordan: Record<string, unknown>, o: Record<string, unknown> = {}) => ({ ...SETUP, staging: [...atCafe, { ...line, ...jordan }], next: [], end: "He is on the phone: the player speaks next.", ...o });
  async function staged(author: unknown[], at = away) {
    const log = sinkLog();
    const model = scripted({ gm: [GM], author, character: [PLAY] });
    const input = turnInput(model, log.sink, new AbortController().signal);
    const result = await runDepthTurn({ ...input, at: { ...input.at, state: at } }, scenePlugs);
    return { result, log, model, after: fold(reg, world, at, result.pre) };
  }

  test("a phone call keeps the far party where they are: reached remotely, or placed where the world has them, they aren't moved to the scene", async () => {
    for (const jordan of [{ remote: true }, { place: "office" }, { remote: true, place: "cafe" }]) {
      const { result, after } = await staged([call(jordan)]);
      expect(moves(result.pre)).toEqual([]);
      expect(placeOfEntity(after, "jordan")).toBe("office");
      // Everyone at the café still is, the scene with them.
      expect(["you", "maya", "rosa"].map((id) => placeOfEntity(after, id))).toEqual(["cafe", "cafe", "cafe"]);
    }
    // The setup's text asks where each person is, and the author's next step reads it as it staged them.
    const { model } = await staged([call({ remote: true }, { next: ["maya"], end: null }), { ...STEP, next: [] }]);
    const authors = model.calls.filter((c) => c.role === "author");
    expect(authors[0]?.text).toContain("are written from it), Alex Rivera among them, and the id of the world's place each is at: whoever the world has elsewhere is moved to the place you give them. Give everyone you stage a place, or \"remote\": no place is guessed for anyone given neither, but Alex Rivera, whom the scene plays from: given no place, he is at the scene's place. Someone the scene reaches only from afar (the far end of a phone call, a radio, a screen) is \"remote\", never at the scene's place: they stay where they are.");
    expect(authors[0]?.text).toContain('"place": the id of the world\'s place where they are, as listed: the scene\'s own place for everyone there in person, "remote": true instead, with no place, for someone elsewhere whom the scene reaches only from afar (the far end of a phone call, a radio, a screen)');
    expect(authors[1]?.text).toContain("- Jordan Price [jordan]: at his desk, the phone to his ear; talking into the phone (remote: reached from afar)");
    expect(authors[1]?.text).toContain("- Maya Chen [maya]: behind the counter; wiping the steam wand (at [cafe])");
  });

  test("someone placed elsewhere is moved there only when the world has them somewhere else; one at a place the world lacks moves no one, and one given no place is said back and asked for once more (the final correctness review, finding 1)", async () => {
    // The world has Jordan at the café; the author places him at the office, where he is now.
    const sent = await staged([call({ place: "office" })], state);
    expect(moves(sent.result.pre)).toEqual([["jordan", "office"]]);
    expect(placeOfEntity(sent.after, "jordan")).toBe("office");
    expect(sent.log.lines).toContain("Where the author stages them moves them: Jordan Price is at Brightline office now.");

    // Staged with neither a place nor "remote" (a Prompts override written before either was asked), he is said back and
    // the scene set again, never dropped in silence: placed this time, he is moved.
    const unplaced = 'the staging gave Jordan Price [jordan] neither the place they are at nor "remote", so they stay where they were: no place is guessed';
    const fixed = await staged([call({}), call({ place: "cafe" })]);
    const asked = fixed.model.calls.filter((c) => c.role === "author");
    expect(asked).toHaveLength(2);
    expect(asked[1]?.text).toContain(`Not all of your answer could be kept:\n- ${unplaced}`);
    expect(asked[1]?.text).toContain('Give each person you stage "place": the id of the world\'s place where they are, as listed (the scene\'s own place for everyone there in person), or "remote": true');
    expect(fixed.log.lines).toContain(`The author's setup couldn't all be kept: ${unplaced}. Told why, it set the scene again.`);
    expect(moves(fixed.result.pre)).toEqual([["jordan", "cafe"]]);
    // Given none again, he stays where the world has him, said: no place is guessed. The player character given none is at the scene's place, never asked for.
    const bare = await staged([call({}), call({})]);
    expect(bare.model.calls.filter((c) => c.role === "author")).toHaveLength(2);
    expect(moves(bare.result.pre)).toEqual([]);
    expect(placeOfEntity(bare.after, "jordan")).toBe("office");
    expect(bare.log.lines).toContain(`The author's setup: ${unplaced}`);
    expect(bare.log.lines.some((l) => l.includes("the staging gave Alex Rivera [you]"))).toBe(false);
    // A step's staging is read the same way: asked again, the step places him where he arrives.
    const setup = { ...SETUP, cast: SETUP.cast.filter((c) => c.who !== "jordan"), next: ["maya"], end: null };
    const arrives = (jordan: Record<string, unknown>) => ({ exposure: [{ beat: "d1", who: "you", channel: "hearing", reach: "whole" }], staging: [{ who: "jordan", where: "in the doorway", doing: "shaking the rain off his coat", ...jordan }], beats: [], next: [], end: "Someone has come in: the player answers." });
    const stepped = await staged([setup, arrives({}), arrives({ place: "cafe" })]);
    const steps = stepped.model.calls.filter((c) => c.role === "author");
    expect(steps).toHaveLength(3);
    expect(steps[2]?.text).toContain(`Not all of your answer could be kept:\n- ${unplaced}`);
    expect(stepped.log.lines).toContain(`The author's step couldn't all be kept: ${unplaced}. Told why, it took the step again.`);
    expect(moves(stepped.result.pre)).toEqual([["jordan", "cafe"]]);

    const lacks = await staged([call({ place: "the moon" })]);
    expect(moves(lacks.result.pre)).toEqual([]);
    expect(placeOfEntity(lacks.after, "jordan")).toBe("office");
    expect(lacks.log.lines).toContain('The author\'s setup: the staging placed Jordan Price [jordan] at "the moon", which isn\'t one of the world\'s places, so they stay where they were');
  });

  test("the player character given no place is at the scene's place, which plays from where he is, staged without one or not at all; remote, he stays where he is", async () => {
    // The world has Alex at the café; the setup plays the scene at the office, placing Maya and Rosa there.
    const office = (you: Record<string, unknown> | null) => ({ ...SETUP, scene: { place: "office" }, staging: SETUP.staging.flatMap((s) => (s.who !== "you" ? [{ ...s, place: "office" }] : you === null ? [] : [{ ...s, ...you }])), next: [], end: "He has ordered: the player speaks next." });
    for (const you of [{}, null]) {
      const { result, after, log } = await staged([office(you)], state);
      expect(moves(result.pre)).toEqual([
        ["you", "office"],
        ["maya", "office"],
        ["rosa", "office"],
      ]);
      expect(placeOfEntity(after, "you")).toBe("office");
      expect(log.lines).toContain("Where the scene plays moves the people in it: Alex Rivera, Maya Chen and Rosa Delgado are at Brightline office now.");
    }
    const far = await staged([office({ remote: true })], state);
    expect(moves(far.result.pre)).toEqual([
      ["maya", "office"],
      ["rosa", "office"],
    ]);
    expect(placeOfEntity(far.after, "you")).toBe("cafe");
  });
});

describe("a perceiver who only hears never lives what there was to see (LIVE3c, L3c-4)", () => {
  // The live case: Marcus answered Jordan down the phone from the shop, and the reply showed his hand on the truck, since a
  // whole reach by hearing was rendered from the beat's surface, and the GM's check asked for it. Here Jordan answers Alex.
  test("a phone answer: the player hears the words, never the hand on the truck; the narrator and the check read it as heard alone, and words alone need no point of view", async () => {
    const heard = (b: Record<string, unknown>) => ({ actors: ["jordan"], act: "said", exposure: [{ who: "you", channel: "hearing", reach: "whole" }], ...b });
    const answer = heard({ what: "Jordan answers the phone.", surface: "Jordan, one hand on the truck's fender, says into the phone: “Ring Ray now.”", quotes: "Ring Ray now." });
    const more = heard({ what: "Jordan adds a word.", surface: "Two bottles.", quotes: "Two bottles." });
    const staging = [...SETUP.staging.map((s) => ({ ...s, place: "cafe" })), { who: "jordan", where: "at the shop, the phone at his shoulder", doing: "working on a truck", remote: true }];
    const model = scripted({ gm: [GM], author: [{ ...SETUP, staging, beats: [answer, more], next: [], end: "He is on the phone: the player speaks next." }] });
    const result = await runDepthTurn(turnInput(model, sinkLog().sink, new AbortController().signal), scenePlugs);
    const [, said, words] = beatsIn(result.pre) as [Beat, Beat, Beat];
    // He hears the answer alone: his own point of view of it, the words and what could be heard; its words alone need none.
    expect(said.exposure.find((x) => x.who === "you")).toEqual({ who: "you", channel: "hearing", reach: "whole", pov: blobHash("Only part of it reaches you: voices at the counter.") });
    expect(words.exposure.find((x) => x.who === "you")).toEqual({ who: "you", channel: "hearing", reach: "whole" });
    expect(reachOf(said, "you")).toMatchObject({ text: blobHash("Only part of it reaches you: voices at the counter."), quotes: said.quotes });
    expect(reachOf(words, "you")).toMatchObject({ text: words.quotes, quotes: words.quotes });
    // The narrator reads his point of view and the exact words, never the hand; the check is told he only heard it.
    const narrator = model.calls.find((c) => c.role === "narrator")?.text ?? "";
    expect(narrator).toContain("It reached Alex Rivera by hearing alone: only what could be heard of it, nothing of what there was to see. What reached them:\nOnly part of it reaches you: voices at the counter.\nExact words: “Ring Ray now.”");
    expect(narrator).not.toContain("truck's fender");
    const check = model.calls.find((c) => c.role === "check")?.text ?? "";
    expect(check).toContain("It reached Alex Rivera by hearing alone: the passage may show only what could be heard of it, never what there was to see. What reached them: Only part of it reaches you: voices at the counter.");
    // Re-narrated, the same: his point of view, read back for a reach he only heard.
    const again = await renarrateMoments({ pre: result.pre, read: result.read }, "you", async (hash) => store.get(hash) ?? null);
    expect(again.moments[0]?.beats.find((b) => b.beat.id === said.id)?.pov).toBe("Only part of it reaches you: voices at the counter.");
  });
});

describe("real time needs the character playing as their own agent (LIVE3 lane 1b, L3b-3)", () => {
  // The live case: turns 1 and 3 asked for real time with Marcus while casting him as the author's own to play, and got none;
  // the refusal was said only to the player, after the setup. Here the setup asks for it with Rosa, whom it plays itself.
  const asks = { ...SETUP, realtime: { with: "rosa", why: "He'll want a word with her about the car." }, next: [], end: "He has ordered: the player speaks next." };
  const refusal = 'real-time dialogue with Rosa Delgado [rosa] needs them playing as their own agent ("effort": "agent"), and you cast them as yours to play; it wasn\'t entered';
  const talks = (pre: readonly LedgerEvent[]) => pre.flatMap((e) => (e.type === STORY_TALK && "data" in e ? [talkOf(e.data)].filter((t) => t !== null) : []));

  test("the setup's text says so; asked with someone it plays itself, the refusal is said back and the scene set again, and cast as her own agent she talks in real time, answering his line before the turn ends (LIVE3c L3c-5)", async () => {
    const recast = { ...asks, cast: SETUP.cast.map((c) => (c.who === "rosa" ? { ...c, effort: "agent" } : c)) };
    const rosa = { do: "Rosa folds her paper.", say: "Morning, Alex. The car's ready at four.", to: ["Alex Rivera"], take: "He looks tired.", now: "Glad of the company." };
    const answered = { exposure: [{ beat: "d1", who: "you", channel: "sight", reach: "whole" }], staging: [], beats: [], next: [], end: "Rosa has answered: the player speaks next." };
    const log = sinkLog();
    const model = scripted({ gm: [GM], author: [asks, recast, answered], character: [rosa] });
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal), scenePlugs);
    const authors = model.calls.filter((c) => c.role === "author");
    expect(authors).toHaveLength(3);
    expect(authors[0]?.text).toContain('Real time needs them playing as their own agent: cast them "agent" for it. With someone you play yourself or handle as part of the world, it isn\'t entered.');
    expect(authors[0]?.text).toContain('"realtime": {"with": the id of someone you cast as "agent"');
    // The author is told, in the same conversation, and what to do instead.
    expect(authors[1]?.text).toContain(`- ${refusal}`);
    expect(authors[1]?.text).toContain('Real-time dialogue is with someone playing as their own agent: to enter it, cast them "agent" and name them in "realtime"');
    expect(log.lines.some((l) => l.startsWith(`The author's setup couldn't all be kept: ${refusal}`))).toBe(true);
    expect(talks(result.pre).map((t) => [t.with, t.state])).toEqual([["rosa", "on"]]);
    // The setup ended the turn at once; real time entered there starts with her own answer, so her own agent plays first, and the author's step hears why.
    const started = "real-time dialogue with Rosa Delgado starts with their own answer: their own agent plays now, and the turn goes on to them rather than ending";
    expect(log.lines).toContain(`The author's setup: ${started}.`);
    expect(model.calls.filter((c) => c.role === "character")).toHaveLength(1);
    expect(beatsIn(result.pre).filter((b) => by(b) === "character").map((b) => b.actors)).toEqual([["rosa"]]);
    expect(authors[2]?.text).toContain(`What your last answer couldn't keep:\n- ${started}`);
  });

  test("cast as its own again, real time isn't entered, said, and the author's next step hears it", async () => {
    const still = { ...asks, next: ["maya"], end: null };
    const answered = { exposure: [{ beat: "d1", who: "you", channel: "hearing", reach: "whole" }], staging: [], beats: [], next: [], end: "Maya has answered: the player speaks next." };
    const log = sinkLog();
    const model = scripted({ gm: [GM], author: [still, still, answered], character: [PLAY] });
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal), scenePlugs);
    expect(talks(result.pre)).toEqual([]);
    expect(log.lines).toContain(`The author's setup: ${refusal}`);
    expect(model.calls.filter((c) => c.role === "author")[2]?.text).toContain(`What your last answer couldn't keep:\n- ${refusal}`);
  });

  test("one the budget slid to the author isn't talked with in real time either, and the author's next step hears why", async () => {
    const model = scripted({ gm: [GM], author: [{ ...SETUP, realtime: { with: "maya", why: "A word with her." } }, ...SLID_STEPS] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, new AbortController().signal, { budget: budgetOf(() => true) }), scenePlugs);
    const slid = "real-time dialogue with Maya Chen needs them playing as their own agent, and the budget slid them to the author; it wasn't entered";
    expect(talks(result.pre)).toEqual([]);
    expect(log.lines).toContain(`The author's setup: ${slid}`);
    expect(model.calls.filter((c) => c.role === "author")[1]?.text).toContain(`What your last answer couldn't keep:\n- ${slid}`);
  });
});

describe("no depth turn ends with nothing reaching the player character (LIVE3c, L3c-5)", () => {
  // The live case (turn 6): after Play as → Marcus, the setup cast Danny as his own agent, entered real time with him and
  // ended the turn at once, before he acted; its one beat of its own reached Danny alone, so the narrator had nothing and
  // the reply came back empty. Here the player plays Rosa after the switch, and Maya is the one she asks.
  const minds = state.packs.minds as Record<string, unknown>;
  const switched = { ...state, packs: { ...state.packs, minds: { ...minds, [MINDS_V2_KEY]: { ...(minds[MINDS_V2_KEY] as Record<string, unknown>), pov: "rosa" } } } };
  const line = `I fold the paper and lean on the counter. "Is the lemon cake fresh, Maya?"`;
  const asked = { beats: [{ kind: "act", act: "said", actors: ["rosa"], addressed: ["maya"], about: ["maya"], what: "Rosa asks Maya whether the lemon cake is fresh.", surface: "Rosa leans on the counter and asks about the cake.", words: "Is the lemon cake fresh, Maya?", quotes: "Is the lemon cake fresh, Maya?" }], signals: [] };
  const staging = [
    { who: "rosa", where: "leaning on the counter", doing: "waiting on an answer, the paper folded under her hand", place: "cafe" },
    { who: "maya", where: "behind the counter", doing: "wiping the steam wand", place: "cafe" },
    { who: "you", where: "at the window table", doing: "reading", place: "cafe" },
  ];
  // Its one beat of its own reaches Maya alone, and it ends the turn with Maya to answer.
  const machine = { what: "The espresso machine ticks as it cools.", surface: "The machine ticks.", exposure: [{ who: "maya", channel: "hearing", reach: "whole" }] };
  const setup = { scene: { place: "cafe" }, cast: [{ who: "maya", effort: "agent", why: "She answers as herself." }, { who: "you", effort: "world", why: "A regular at the window." }], staging, exposure: [], beats: [machine], next: [], end: "Rosa waits on her question; Maya answers now, and then it comes back to Rosa." };
  const input = (model: ModelPort, sink: TurnSink) => turnInput(model, sink, new AbortController().signal, { at: { basis: { message: "m1", swipe: "s0", parentPath: "p0" }, state: switched, world, story: { beats: [], staging: [], replaced: [], duplicates: [] }, events: [] }, input: { messageId: "m1", text: line } });
  const name = (id: string) => own(switched.entities, id)?.name ?? id;

  test("turn 6: after the switch, real time entered at the setup that ended the turn at once still has the partner's own agent answer her line, and the reply tells it", async () => {
    // The first setup wrote Maya's answer for her (refused), and its second ended the turn at once, as live.
    const wrote = { ...setup, realtime: { with: "maya", why: "A word over the counter." }, beats: [{ actors: ["maya"], act: "said", what: "Maya says it's fresh.", surface: "Maya nods at the cake stand.", quotes: "Baked at six.", exposure: [{ who: "rosa", channel: "hearing", reach: "whole" }] }] };
    const again = { ...setup, realtime: { with: "maya", why: "A word over the counter." } };
    const maya = { do: "Maya taps the glass over the cake stand.", say: "Baked at six, Rosa. Still warm.", to: ["Rosa Delgado"], take: "Rosa's in early.", now: "Easy morning." };
    const answered = { exposure: [{ beat: "d1", who: "rosa", channel: "sight", reach: "whole" }], staging: [], beats: [], next: [], end: "Maya has answered: the player speaks next." };
    const log = sinkLog();
    const model = scripted({ gm: [asked], author: [wrote, again, answered], character: [maya], narrator: ["Maya taps the glass. “Baked at six, Rosa. Still warm.”"] });
    const result = await runDepthTurn(input(model, log.sink), scenePlugs);
    // The partner answered her line, as her own agent, and it reached the player character: the reply is non-empty and tells it.
    expect(model.calls.filter((c) => c.role === "character")).toHaveLength(1);
    const answer = beatsIn(result.pre).find((b) => by(b) === "character");
    expect(answer?.actors).toEqual(["maya"]);
    expect(answer?.exposure.find((x) => x.who === "rosa")).toMatchObject({ channel: "sight", reach: "whole" });
    expect(log.content.join("")).toBe("Maya taps the glass. “Baked at six, Rosa. Still warm.”");
    expect(passagesIn(result.read).map((p) => [p.pov, p.quiet === true])).toEqual([["rosa", false]]);
    expect(log.lines).toContain("The author's setup: real-time dialogue with Maya Chen starts with their own answer: their own agent plays now, and the turn goes on to them rather than ending.");
    // The setup's exposure and everything it reads is the switched character's (`povOf`), never the world's own pov.
    const authors = model.calls.filter((c) => c.role === "author");
    expect(authors[0]?.text).toContain("- Rosa Delgado [rosa] (the player character)");
    expect(authors[0]?.text).not.toContain("Alex Rivera [you] (the player character)");
    const mine = beatsIn(result.pre).find((b) => by(b) === "player");
    expect([mine?.actors, mine?.exposure.find((x) => x.who === "rosa")?.reach]).toEqual([["rosa"], "whole"]);
  });

  test("a turn the author would end with nothing beyond her own beats reaching her: it is told exactly that and takes one more step, once, whose beat reaches her", async () => {
    const played = { ...setup, cast: [{ who: "maya", effort: "author", why: "Yours to play this morning." }] };
    const more = { exposure: [], staging: [], beats: [{ actors: ["maya"], act: "said", what: "Maya says the cake is fresh.", surface: "Maya nods at the cake stand.", quotes: "Fresh this morning.", exposure: [{ who: "rosa", channel: "hearing", reach: "whole" }] }], next: [], end: "Maya has answered: the player speaks next." };
    const log = sinkLog();
    const model = scripted({ gm: [asked], author: [played, more], narrator: ["Maya nods at the cake stand. “Fresh this morning.”"] });
    const result = await runDepthTurn(input(model, log.sink), scenePlugs);
    const authors = model.calls.filter((c) => c.role === "author");
    expect(authors).toHaveLength(2);
    expect(authors[1]?.text).toContain("Nothing this turn has reached Rosa Delgado [rosa] beyond the player's own beats: no beat anyone else decided reached him, so the reply would have nothing to tell him.");
    expect(authors[1]?.text).toContain("This is your last step before this turn ends whatever happens");
    expect(log.lines).toContain("Nothing this turn has reached Rosa Delgado beyond the player's own beats: the author takes one more step for what reaches them.");
    expect(log.content.join("")).toBe("Maya nods at the cake stand. “Fresh this morning.”");
    expect(passagesIn(result.read).map((p) => p.quiet === true)).toEqual([false]);
    expect(unreachedChip("m2", 0, result.read, name)).toBeNull();
  });

  test("one that still has nothing for her: the reply is a short, honest passage of where she is and what she's doing, never empty, with a chip saying nothing reached her", async () => {
    const played = { ...setup, cast: [{ who: "maya", effort: "author", why: "Yours to play this morning." }] };
    const nothing = { exposure: [], staging: [], beats: [], next: [], end: "Rosa waits on her answer." };
    const log = sinkLog();
    const model = scripted({ gm: [asked], author: [played, nothing], narrator: ["Rosa keeps her elbows on the counter, the paper folded under her hand."] });
    const result = await runDepthTurn(input(model, log.sink), scenePlugs);
    // One more step, once: no third.
    expect(model.calls.filter((c) => c.role === "author")).toHaveLength(2);
    const narrated = model.calls.filter((c) => c.role === "narrator");
    expect(narrated).toHaveLength(1);
    expect(narrated[0]?.text).toContain("Nothing of this turn reached Rosa Delgado beyond what the player wrote for them");
    expect(narrated[0]?.text).toContain("leaning on the counter; waiting on an answer, the paper folded under her hand");
    // The check read it against every beat of the turn: the one that reached Maya alone it was told not to show.
    const checked = model.calls.find((c) => c.role === "check")?.text ?? "";
    expect(checked).toContain("It didn't reach Rosa Delgado: the passage must not show it.");
    expect(log.content).toEqual(["Rosa keeps her elbows on the counter, the paper folded under her hand."]);
    const [quiet] = passagesIn(result.read);
    expect([quiet?.quiet, quiet?.pov, quiet?.beats]).toEqual([true, "rosa", beatsIn(result.pre).map((b) => b.id)]);
    expect(unreachedChip("m2", 0, result.read, name)).toMatchObject({ kind: "degraded", label: "Nothing reached Rosa Delgado", actions: [] });
    expect(result.stopped).toBe(false);
    expect(result.failed).toBeUndefined();
  });

  test("an author step unreadable twice is the model's failure, never the story's: no quiet passage and no chip saying nothing reached her, the reply empty for Retry (the last review, C-1)", async () => {
    const played = { ...setup, cast: [{ who: "maya", effort: "author", why: "Yours to play this morning." }] };
    const log = sinkLog();
    const model = scripted({ gm: [asked], author: [played, "x", "x"], narrator: ["Rosa keeps her elbows on the counter, the paper folded under her hand."] });
    const result = await runDepthTurn(input(model, log.sink), scenePlugs);
    expect(model.calls.filter((c) => c.role === "author")).toHaveLength(3);
    expect(log.lines).toContain("The author's step still couldn't be read: the turn ends here, and the player answers.");
    expect(model.calls.filter((c) => c.role === "narrator")).toHaveLength(0);
    expect(log.content).toEqual([]);
    expect(passagesIn(result.read)).toEqual([]);
    expect(unreachedChip("m2", 0, result.read, name)).toBeNull();
  });
});

describe("the setup is given everyone the scene may reach by their id, the player character always (LIVE3d, L3d-5)", () => {
  // The live case: after Play as → Marcus, he rang Jordan, the world's own player character, at Shoreline Fuel. The setup was
  // given ids only for those at the shop, and Jordan, with no mind, only by name, so it staged and wrote nothing of him: "without
  // a usable id I do not stage or write him". Here the player plays Rosa after the switch, and rings Alex, the world's own, at the office.
  const minds = state.packs.minds as Record<string, unknown>;
  const switched = { ...state, packs: { ...state.packs, minds: { ...minds, [MINDS_V2_KEY]: { ...(minds[MINDS_V2_KEY] as Record<string, unknown>), pov: "rosa" } } } };
  const apart = fold(reg, world, switched, [
    { type: "set", entity: "you", field: "place", value: "office" },
    { type: "set", entity: "maya", field: "place", value: "maya_flat" },
  ]);
  const line = `I ring Alex from the café's phone. "Bring the invoices when you come."`;
  const rings = { beats: [{ kind: "act", act: "said", actors: ["rosa"], addressed: ["you"], about: ["you"], what: "Rosa rings Alex at the office and asks him to bring the invoices.", surface: "Rosa holds the café's phone to her ear.", words: "Bring the invoices when you come.", quotes: "Bring the invoices when you come." }], signals: [] };
  const answers = { actors: ["you"], act: "said", what: "Alex says he'll bring them.", surface: "Alex's voice on the line.", quotes: "On my way with them.", exposure: [{ who: "rosa", channel: "hearing", reach: "whole" }] };
  const setup = {
    scene: { place: "cafe" },
    cast: [{ who: "you", effort: "author", why: "On the line from the office." }],
    staging: [
      { who: "rosa", where: "by the café's phone", doing: "holding the receiver", place: "cafe" },
      { who: "you", where: "at his desk, the phone to his ear", doing: "listening", remote: true },
    ],
    exposure: [{ beat: "p1", who: "you", channel: "hearing", reach: "whole" }],
    beats: [answers],
    next: [],
    end: "He has answered: the player speaks next.",
  };

  test("after a switch, the far party of a call, the world's own player character with no mind, is listed by his id, the player character marked, and the setup stages him remote", async () => {
    const model = scripted({ gm: [rings], author: [setup] });
    const input = turnInput(model, sinkLog().sink, new AbortController().signal, { at: { basis: { message: "m1", swipe: "s0", parentPath: "p0" }, state: apart, world, story: { beats: [], staging: [], replaced: [], duplicates: [] }, events: [] }, input: { messageId: "m1", text: line } });
    const result = await runDepthTurn(input, scenePlugs);
    const asked = model.calls.find((c) => c.role === "author")?.text ?? "";
    expect(asked).toContain("The people the scene may reach, each by their id:\n- Rosa Delgado [rosa] (the player character), at Daybreak Café");
    expect(asked).toContain("With him:\n- Jordan Price [jordan], no mind yet");
    // The one his act names first, then the rest: Maya has a mind, though no one named her.
    expect(asked).toContain("Elsewhere, whom the scene reaches only from afar (the far end of a phone call, a radio, a screen) unless it brings them there:\n- Alex Rivera [you], no mind yet, at Brightline office\n- Maya Chen [maya], has a mind, at Maya's flat");
    expect(asked).not.toContain("Alex Rivera [you] (the player character)");
    // Staged remote, he answers down the line where he is, and it reaches her.
    const after = fold(reg, world, apart, result.pre);
    expect(placeOfEntity(after, "you")).toBe("office");
    expect(placeOfEntity(after, "rosa")).toBe("cafe");
    const answer = beatsIn(result.pre).find((b) => b.actors.includes("you"));
    expect(answer?.exposure.find((x) => x.who === "rosa")).toMatchObject({ channel: "hearing", reach: "whole" });
  });
});

describe("after a switch, the time a scene runs keeps everyone in it with the player character (LIVE3d, L3d-4)", () => {
  // The live case: after Play as → Marcus, a turn at Alder Automotive ran the clock 8:24 → 8:31 while Jordan, the world's own
  // player character, was at Shoreline Fuel. The GM edit's hold on Danny ended at 8:25, and his day took him home to 114 Harbor
  // Street mid-scene, with no move listed: the scene's time read the world's own player character as the one a scene holds
  // people with. Here the player plays Rosa at the café, Alex is at home, and the scene runs past 8:00, when Jordan's schedule
  // has him at the office.
  const minds = state.packs.minds as Record<string, unknown>;
  const switched = { ...state, packs: { ...state.packs, minds: { ...minds, [MINDS_V2_KEY]: { ...(minds[MINDS_V2_KEY] as Record<string, unknown>), pov: "rosa" } } } };
  const home = fold(reg, world, switched, [{ type: "set", entity: "you", field: "place", value: "apartment" }]);
  const line = `I lean across to Jordan. "How are the fleet's brakes holding up?"`;
  const asks = { beats: [{ kind: "act", act: "said", actors: ["rosa"], addressed: ["jordan"], about: ["jordan"], what: "Rosa asks Jordan how the fleet's brakes are holding up.", surface: "Rosa leans across the table to Jordan.", words: "How are the fleet's brakes holding up?", quotes: "How are the fleet's brakes holding up?" }], signals: [] };
  const talks = { actors: ["jordan"], act: "said", what: "Jordan talks her through the fleet's brake jobs at length.", surface: "Jordan talks, counting jobs off on his fingers.", quotes: "Pads on six of them, rotors on two.", after: 45, exposure: [{ who: "rosa", channel: "hearing", reach: "whole" }] };
  const setup = {
    scene: { place: "cafe" },
    cast: [{ who: "jordan", effort: "author", why: "He talks shop with her." }],
    staging: [
      { who: "rosa", where: "at the window table", doing: "leaning across to Jordan", place: "cafe" },
      { who: "jordan", where: "across the table from her", doing: "turning his cup", place: "cafe" },
    ],
    exposure: [{ beat: "p1", who: "jordan", channel: "hearing", reach: "whole" }],
    beats: [talks],
    next: [],
    end: "He has answered: the player speaks next.",
  };

  test("the scene runs past the hour Jordan's schedule has him at the office: in the scene with her, he stays, and the turn moves no one", async () => {
    const model = scripted({ gm: [asks], author: [setup] });
    const input = turnInput(model, sinkLog().sink, new AbortController().signal, { at: { basis: { message: "m1", swipe: "s0", parentPath: "p0" }, state: home, world, story: { beats: [], staging: [], replaced: [], duplicates: [] }, events: [] }, input: { messageId: "m1", text: line } });
    const result = await runDepthTurn(input, scenePlugs);
    const after = fold(reg, world, home, result.pre);
    expect(after.clock).toBe(home.clock + 45);
    expect(["rosa", "jordan"].map((id) => placeOfEntity(after, id))).toEqual(["cafe", "cafe"]);
    expect(moves(result.pre).filter(([who]) => who === "rosa" || who === "jordan")).toEqual([]);
  });
});
