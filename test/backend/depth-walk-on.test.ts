// No play reads an open draft past its story time (DEPTH-PLAN §4.6's invariant, §5.3; A3's test,
// §9.2): a depth turn whose scene reaches someone an open draft holds from before the scene's minute
// has the author settle it, drop it or re-date it past the scene before anyone plays, and the turn's
// record keeps what that came to before the scene, with what it cost as its own line (§4.6
// Walk-ons, §4.7). A settled draft's beats are lived by whoever they reached in their next play; a
// real-time line reaching what a draft holds (its character, the player character, his place) plays
// as a scene so the draft settles first; a draft held for later, or holding no one here, asks
// nothing; and an answer that can't be read twice fails the turn rather than playing around the draft.

import { describe, expect, test } from "bun:test";
import { seedCore } from "../../src/backend/character-agent";
import { reachOf } from "../../src/shared/character-engine";
import type { ModelPort } from "../../src/backend/depth/port";
import type { DepthTurnInput, TurnSink } from "../../src/backend/depth/scene/contract";
import { scenePlugs } from "../../src/backend/depth/scene/plugs";
import { runDepthTurn, type ScenePlugs } from "../../src/backend/depth/scene/turn";
import { defaultSettings } from "../../src/backend/settings-store";
import { AUTHOR_SPEND, authorData, type SpendData } from "../../src/shared/author";
import { AUTHOR_DROP, draftEvent, draftOf, dropOf, heldIn, STORY_DRAFT, STORY_SETTLE, type DraftData } from "../../src/shared/episodes";
import type { LedgerEvent } from "../../src/shared/ledger";
import { STORY_SCENE } from "../../src/shared/scene";
import { STORY_BEAT, beatOf, type Beat, type StoryRef } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import { talkEvent } from "../../src/shared/talk";
import type { LiveEvent } from "../../src/engine/ledger/story";
import { sliceOf } from "../../src/engine/pack-kit";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { fold, startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const world = modernUsWorld("w", "Riverton");
// Everyone at the café: Alex (the player character), Maya and Rosa (each with a mind), Jordan (none).
for (const id of ["you", "maya", "rosa", "jordan"]) {
  const e = world.entities[id];
  if (e) e.fields = { ...e.fields, place: "cafe" };
}
const store = new Map<string, string>();
const put = (text: string): string => {
  store.set(blobHash(text), text);
  return blobHash(text);
};
const cores = [seedCore({ who: "maya", at: 0, source: "card", text: "Maya Chen, the café's barista: quick, warm, keeps the regulars' orders in her head." }), seedCore({ who: "rosa", at: 0, source: "card", text: "Rosa Delgado, a mechanic who reads the paper here every morning." })];
for (const c of cores) for (const [hash, text] of Object.entries(c.blobs)) store.set(hash, text);
const state = fold(reg, world, startState(world, reg), cores.flatMap((c) => c.events as LedgerEvent[]));
const NOW = state.clock;

const LINE = "Morning, Maya. One coffee, please.";
const GM = { beats: [{ kind: "act", act: "said", actors: ["you"], addressed: ["maya"], about: ["maya"], what: "Alex orders a coffee from Maya.", surface: "Alex steps up to the counter and orders.", words: LINE, quotes: LINE }], signals: [] };
const SETUP = {
  scene: { place: "cafe" },
  cast: [{ who: "maya", effort: "agent", why: "She serves him, as herself." }],
  staging: [
    { who: "you", where: "at the counter", doing: "ordering" },
    { who: "maya", where: "behind the counter", doing: "wiping the steam wand", place: "cafe" },
  ],
  exposure: [{ beat: "p1", who: "maya", channel: "hearing", reach: "whole" }],
  beats: [],
  next: ["maya"],
  end: null,
};
const PLAY = { do: "Maya reaches for a cup.", say: "Coming right up, Alex.", to: ["Alex Rivera"], take: "My head's still in Lisbon.", now: "Distracted." };
const STEP = { exposure: [{ beat: "d1", who: "you", channel: "hearing", reach: "whole" }], next: [], end: "Maya has answered: the player speaks next." };

// Off screen, an hour before the scene: Maya's sister called to say she is moving to Lisbon. Not canon yet.
const CALL_SURFACE = "Maya's phone rings; she listens, then sits down hard on the stockroom crate.";
function callDraft(o: { id?: string; at?: number; who?: string; touch?: StoryRef } = {}): DraftData {
  const id = o.id ?? "d-call";
  const at = o.at ?? NOW - 60;
  const who = o.who ?? "maya";
  const beat: Beat = { id: `${id}-b1`, at, order: 0, place: "cafe", actors: [], act: "happened", about: [{ entity: who }], what: put("Maya's sister calls: she is moving to Lisbon for good."), surface: put(CALL_SURFACE), exposure: [{ who, channel: "hearing", reach: "whole" }], by: { draft: id } };
  return {
    id,
    episode: { id: `e-${id}`, span: [at, at + 20], places: [], people: [who], why: "Her sister's news changes what Maya wants.", parts: [{ subject: { who }, treatment: "written", rationale: "a phone call, a few lines" }] },
    at,
    inputs: {},
    beats: [beat],
    effects: [],
    touches: [{ ref: o.touch ?? { entity: who }, from: at }],
    summary: "Maya's sister calls to say she is moving to Lisbon.",
  };
}
const live = (event: LedgerEvent, layer: string): LiveEvent => ({ event, from: { layer, messageId: "m0" }, at: 0, index: 0 });

/** Every call answered by its role, each reporting its cost: the author's, the GM's and the character's from their scripts (a string is sent as it is: no JSON), every point of view asked for, every check faithful, the narrator's prose in turn. */
function scripted(script: { gm?: unknown[]; author?: unknown[]; character?: unknown[] }): ModelPort & { calls: { role: string; text: string }[] } {
  const calls: { role: string; text: string }[] = [];
  const queues: Record<string, unknown[]> = { gm: script.gm ?? [], author: script.author ?? [], character: script.character ?? [] };
  const usage = { tokensIn: 10, tokensOut: 2 };
  const port = (async (role, messages) => {
    calls.push({ role, text: messages.map((m) => m.content).join("\n") });
    if (role === "pov") return { text: JSON.stringify({ povs: { you: "A murmur at the counter.", maya: "A murmur.", rosa: "A murmur." } }), usage };
    if (role === "check") return { text: JSON.stringify({ faithful: true }), usage };
    if (role === "narrator") return { text: "A passage.", usage };
    const next = queues[role]?.shift() ?? {};
    return { text: typeof next === "string" ? next : JSON.stringify(next), usage };
  }) as ModelPort & { calls: { role: string; text: string }[] };
  port.calls = calls;
  return port;
}

function sinkLog(): { sink: TurnSink; lines: string[] } {
  const lines: string[] = [];
  return { sink: { progress: (t) => void lines.push(t), reasoning: (t) => void lines.push(t), content: () => {}, call: () => {} }, lines };
}

function turnInput(model: ModelPort, sink: TurnSink, events: LiveEvent[]): DepthTurnInput {
  return {
    chatId: "chat-1",
    userId: "u1",
    turn: "gen-1",
    kind: "normal",
    at: { basis: { message: "m1", swipe: "s0", parentPath: "p0" }, state, world, story: { beats: [], staging: [], replaced: [], duplicates: [] }, events },
    plan: { events: [], elapsedMinutes: 0, resolutions: [], chips: [] },
    runSeed: "run-1",
    seed: "seed-1",
    input: { messageId: "m1", text: LINE },
    recent: "",
    settings: defaultSettings(),
    model,
    sink,
    signal: new AbortController().signal,
    rt: { registry: reg, blobs: { get: async (_u, hash) => store.get(hash) ?? null } },
  };
}

const beatsIn = (events: readonly LedgerEvent[]): Beat[] => events.flatMap((e) => (e.type === STORY_BEAT && "data" in e ? [beatOf(e.data)].filter((b): b is Beat => b !== null) : []));
const spendsIn = (events: readonly LedgerEvent[]): SpendData[] => events.flatMap((e) => [authorData<SpendData>(e, AUTHOR_SPEND)].filter((d): d is SpendData => d !== null));
const typesIn = (events: readonly LedgerEvent[]): string[] => events.map((e) => e.type);

describe("no play reads an open draft past its story time", () => {
  test("the scene reaches someone an open draft holds: the author settles it before anyone plays, and she lives it in her play; the walk-on is its own line in the turn's spend", async () => {
    const model = scripted({ gm: [GM], author: [{ verdict: "settle", why: "Nothing seen since says otherwise." }, SETUP, STEP], character: [PLAY] });
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, [live(draftEvent(callDraft()), "l-call")]), scenePlugs);

    // The author read the draft first: before the GM read the turn and before anyone played.
    const roles = model.calls.map((c) => c.role);
    expect(roles[0]).toBe("author");
    expect(model.calls[0]?.text).toContain("What of this scene it holds");
    expect(model.calls[0]?.text).toContain("Maya Chen (id: maya)");
    expect(roles.indexOf("gm")).toBeGreaterThan(0);
    const play = roles.indexOf("character");
    expect(play).toBeGreaterThan(0);
    // The setup was told what became of it.
    expect(model.calls.find((c) => c.role === "author" && c.text.includes("Off screen, just now, before this scene"))?.text).toContain("Settled, canon now: Maya's sister calls");

    // In the record, before the scene: the settlement, its beat dated when it happened, and the record folds.
    const types = typesIn(result.pre);
    expect(types.indexOf(STORY_SETTLE)).toBeGreaterThan(-1);
    expect(types.indexOf(STORY_SETTLE)).toBeLessThan(types.indexOf(STORY_SCENE));
    expect(beatsIn(result.pre).filter((b) => "draft" in b.by).map((b) => [b.id, b.at])).toEqual([["d-call-b1", NOW - 60]]);
    expect(() => fold(reg, world, state, result.pre)).not.toThrow();
    // What reached Maya off screen reached her play, as what reached her since she last played.
    expect(model.calls[play]?.text).toContain(CALL_SURFACE);
    expect(result.after.beats).toContain("d-call-b1");

    // What it cost: the walk-on's own line (the author's one reading), then the scene's (every other call).
    const spends = spendsIn(result.pre);
    expect(spends.map((s) => [s.treatment, s.for])).toEqual([
      ["walk-on", "d-call"],
      ["scene", "gen-1"],
    ]);
    expect(spends[0]?.cost).toEqual({ calls: 1, tokensIn: 10, tokensOut: 2 });
    expect(spends[0]?.roles).toEqual({ author: { calls: 1, tokensIn: 10, tokensOut: 2 } });
    expect(spends[1]?.cost).toEqual({ calls: model.calls.length - 1, tokensIn: 10 * (model.calls.length - 1), tokensOut: 2 * (model.calls.length - 1) });
    expect(typesIn(result.pre).slice(-2)).toEqual([AUTHOR_SPEND, AUTHOR_SPEND]);
  });

  // An episode's beats carry their deeds (LIVE3 L3a-4), but a settlement that rewrote a beat's text
  // kept the draft's deed with it, which could tell an act the settled beat no longer holds.
  test("a settlement that rewrites a beat drops the draft's deed for it, so its actor lives the beat as settled; a beat kept as drafted keeps its deed", async () => {
    const answered: Beat = { id: "d-call-b1", at: NOW - 60, order: 0, place: "cafe", actors: ["maya"], act: "did", about: [{ entity: "maya" }], what: put("Maya answers her sister's call."), deed: put("Maya picks up her phone and listens to her sister."), surface: put(CALL_SURFACE), exposure: [{ who: "maya", channel: "hearing", reach: "whole" }], by: { draft: "d-call" } };
    const promised: Beat = { id: "d-call-b2", at: NOW - 55, order: 1, place: "cafe", actors: ["maya"], act: "said", about: [{ entity: "maya" }], what: put("Maya promises her sister she'll visit Lisbon in the spring."), deed: put("Maya tells her sister she'll fly out in the spring."), surface: put("Maya says she'll visit in the spring."), quotes: put("I'll come in the spring."), exposure: [{ who: "maya", channel: "hearing", reach: "whole" }], by: { draft: "d-call" } };
    const settle = { verdict: "settle", why: "Nothing seen since says otherwise.", beats: [{ ref: "d2", keep: true, what: "Maya tells her sister she'll visit someday.", surface: "Maya says she'll visit someday.", quotes: "Someday, I promise." }] };
    const model = scripted({ gm: [GM], author: [settle, SETUP, STEP], character: [PLAY] });
    const result = await runDepthTurn(turnInput(model, sinkLog().sink, [live(draftEvent({ ...callDraft(), beats: [answered, promised] }), "l-call")]), scenePlugs);
    const [kept, rewritten, ...more] = beatsIn(result.pre).filter((b) => "draft" in b.by);
    if (!kept || !rewritten) throw new Error("the settlement made no beats");
    expect(more).toEqual([]);
    expect([kept.id, kept.deed]).toEqual([answered.id, answered.deed]);
    expect(rewritten.id).not.toBe(promised.id);
    expect(result.blobs[rewritten.surface]).toBe("Maya says she'll visit someday.");
    expect(rewritten.deed).toBeUndefined();
    // She lives it from the inside, as the point-of-view render tells her own act (LIVE3 lane 1b), never as its surface.
    const reach = reachOf(rewritten, "maya");
    expect(reach).toMatchObject({ as: "inside" });
    expect(result.blobs[reach?.text ?? ""]).toBe("A murmur.");
  });

  test("dropped: the drop rides in the record before the scene, and no one lives the draft", async () => {
    const model = scripted({ gm: [GM], author: [{ verdict: "drop", why: "Maya has been behind the counter all morning: no call came." }, SETUP, STEP], character: [PLAY] });
    const result = await runDepthTurn(turnInput(model, sinkLog().sink, [live(draftEvent(callDraft()), "l-call")]), scenePlugs);
    const types = typesIn(result.pre);
    expect(types.includes(STORY_SETTLE)).toBe(false);
    const drop = result.pre.find((e) => e.type === AUTHOR_DROP);
    expect(drop && "data" in drop ? dropOf(drop.data) : null).toEqual({ draft: "d-call", why: "Maya has been behind the counter all morning: no call came." });
    expect(types.indexOf(AUTHOR_DROP)).toBeLessThan(types.indexOf(STORY_SCENE));
    expect(model.calls.find((c) => c.role === "character")?.text).not.toContain(CALL_SURFACE);
    expect(beatsIn(result.pre).some((b) => "draft" in b.by)).toBe(false);
  });

  test("re-dated past the scene: the draft is dropped and drafted again later, holding her from then, and the scene plays without it", async () => {
    const model = scripted({ gm: [GM], author: [{ verdict: "redate", why: "Her sister calls tonight instead.", redate: { in: 180 } }, SETUP, STEP], character: [PLAY] });
    const result = await runDepthTurn(turnInput(model, sinkLog().sink, [live(draftEvent(callDraft()), "l-call")]), scenePlugs);
    const drop = result.pre.find((e) => e.type === AUTHOR_DROP);
    expect(drop && "data" in drop ? dropOf(drop.data)?.why : "").toStartWith("Re-dated to ");
    const again = result.pre.find((e) => e.type === STORY_DRAFT);
    const later = again && "data" in again ? draftOf(again.data) : null;
    expect(later?.id).not.toBe("d-call");
    expect(later?.episode.span).toEqual([NOW + 180, NOW + 200]);
    expect(later?.beats.map((b) => [b.at, b.by])).toEqual([[NOW + 180, { draft: later?.id ?? "" }]]);
    expect(later?.touches).toEqual([{ ref: { entity: "maya" }, from: NOW + 180 }]);
    expect(model.calls.find((c) => c.role === "character")?.text).not.toContain(CALL_SURFACE);
    // Folded, the old one lets her go and the new one holds her for its own span.
    const out = fold(reg, world, state, [draftEvent(callDraft()), ...result.pre]);
    expect(heldIn(sliceOf(out, "story"), sliceOf(out, "author"), "maya", NOW - 50)).toBe(false);
    expect(heldIn(sliceOf(out, "story"), sliceOf(out, "author"), "maya", NOW + 190)).toBe(true);
  });

  test("a line of real-time dialogue whose character a draft holds plays as a scene, so the draft settles before she answers", async () => {
    const model = scripted({ gm: [GM], author: [{ verdict: "settle", why: "It stands." }, SETUP, STEP], character: [PLAY] });
    const plugs: ScenePlugs = {
      ...scenePlugs,
      realtimeTurn: async () => {
        throw new Error("a held character never answers a line in real time");
      },
    };
    const talk = live(talkEvent({ with: "maya", state: "on", by: "player" }), "l-talk");
    const log = sinkLog();
    const result = await runDepthTurn(turnInput(model, log.sink, [talk, live(draftEvent(callDraft()), "l-call")]), plugs);
    expect(typesIn(result.pre)).toContain(STORY_SETTLE);
    expect(model.calls.find((c) => c.role === "author" && c.text.includes("watch took his line"))?.text).toContain("it settles first");
    expect(model.calls.find((c) => c.role === "character")?.text).toContain(CALL_SURFACE);
  });

  test("a real-time line plays as a scene when a draft holds what it reaches besides the character: the player character, or his place; the setup is told what is held", async () => {
    for (const [touch, holds] of [
      [{ entity: "you" }, "Alex Rivera (id: you)"],
      [{ place: "cafe" }, "Daybreak Café (id: cafe)"],
    ] as const) {
      const model = scripted({ gm: [GM], author: [{ verdict: "settle", why: "It stands." }, SETUP, STEP], character: [PLAY] });
      let answered = false;
      const plugs: ScenePlugs = {
        ...scenePlugs,
        realtimeTurn: async () => {
          answered = true;
          throw new Error("a line whose reach a draft holds never goes to real time");
        },
      };
      const talk = live(talkEvent({ with: "maya", state: "on", by: "player" }), "l-talk");
      const result = await runDepthTurn(turnInput(model, sinkLog().sink, [talk, live(draftEvent(callDraft({ touch })), "l-call")]), plugs);
      expect(answered).toBe(false);
      expect(typesIn(result.pre)).toContain(STORY_SETTLE);
      expect(model.calls.find((c) => c.role === "author" && c.text.includes("watch took his line"))?.text).toContain(`holds ${holds} from before now: it settles first`);
    }
  });

  test("a draft holding her only from after the scene's minute, or holding someone not here, asks nothing", async () => {
    for (const d of [callDraft({ at: NOW + 600 }), callDraft({ who: "jordan_absent" })]) {
      const model = scripted({ gm: [GM], author: [SETUP, STEP], character: [PLAY] });
      const result = await runDepthTurn(turnInput(model, sinkLog().sink, [live(draftEvent(d), "l-call")]), scenePlugs);
      expect(model.calls.filter((c) => c.role === "author")).toHaveLength(2);
      expect(model.calls.some((c) => c.text.includes("What of this scene it holds"))).toBe(false);
      expect(typesIn(result.pre).some((t) => t === STORY_SETTLE || t === AUTHOR_DROP)).toBe(false);
      expect(spendsIn(result.pre).map((s) => s.treatment)).toEqual(["scene"]);
    }
  });

  test("a walk-on the author can't answer twice fails the turn: the scene never plays around the draft", async () => {
    const model = scripted({ gm: [GM], author: ["not an answer", "still not an answer", SETUP, STEP], character: [PLAY] });
    await expect(runDepthTurn(turnInput(model, sinkLog().sink, [live(draftEvent(callDraft()), "l-call")]), scenePlugs)).rejects.toThrow();
    expect(model.calls.some((c) => c.role === "character")).toBe(false);
  });
});
