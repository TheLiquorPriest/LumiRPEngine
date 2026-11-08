// A character at play (DEPTH-PLAN §4.4 Play, §9.2 A2): a play's context, and a catch-up's, its
// recall's answers included, holds nothing beyond the character's own mind and the points of view it
// received: no beat's truth, no surface or words that reached it only in part, no beat that never
// reached it, no other mind or take, and not the author's notebook. Its take is kept as its working
// memory of the scene; what reached it and its own act are lived.

import { describe, expect, test } from "bun:test";
import { catchUp, seedCore } from "../../src/backend/character-agent";
import { livedPovs, mindInput } from "../../src/backend/character-engine";
import type { ModelPort, PortMessage } from "../../src/backend/depth/port";
import { actBeatTexts, play, sceneRecall, sceneSoFar, type SceneRead } from "../../src/backend/depth/scene/play";
import { defaultSettings } from "../../src/backend/settings-store";
import { MIND_TAKE, exposedBeats, mindFileWrite, mindFilesAt, mindLivedEvent, mindPath, mindTakeEvent, mindV2At, pendingFor, personPath, takesOf } from "../../src/shared/character-engine";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { Beat, PlacedBeat, StoryRead } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import { validateEvent } from "../../src/engine/events";
import mindsPack from "../../src/packs/minds/core/index";
import { baseWorld, fold, POV, registryOf, startState } from "../packs/support";

const world = baseWorld({
  entities: {
    ...baseWorld().entities,
    mira: { id: "mira", kind: "person", name: "Mira", tier: "principal", fields: { place: "cafe", home: "cafe" }, relations: [] },
  },
});
const reg = registryOf([mindsPack]);
const userId = "u1";

/** What Dev may be given: his own mind, and what reached him as it reached him. */
const OWN = {
  core: "DEV-CORE: keeps the cafe and trusts no one quickly.",
  self: "DEV-SELF: I want this place to outlast me.",
  mind: "DEV-ONMYMIND: the pier floods at eight.",
  now: "DEV-NOW: wiping the counter.",
  beliefs: "- DEV-BELIEF: Sam can be trusted. A hunch.",
  plans: "DEV-PLANS: close early tonight.",
  sam: "DEV-PEOPLE-SAM: listens more than they talk.",
  take: "DEV-TAKE: Sam looked worried when they said it.",
  pier: "PIER-SURFACE: Sam says the pier floods at eight.",
  pierWords: "PIER-WORDS: It floods at eight.",
  act: "DEVACT-SURFACE: Dev nods and sets the cup down.",
  doorPov: "DOOR-POV: through the door, voices, too muffled to make out.",
  bell: "BELL-SURFACE: the bell over the door rings twice.",
};
/** What Dev must never be given. */
const NEVER = {
  pierWhat: "PIER-TRUTH: Sam warns Dev about the flood.",
  actWhat: "DEVACT-TRUTH: Dev agrees to keep quiet.",
  door: "DOOR-SURFACE: Mira tells the cook to burn the letter.",
  doorWords: "DOOR-WORDS: Burn it before he reads it.",
  doorWhat: "DOOR-TRUTH: Mira orders the letter burned.",
  letter: "LETTER-SURFACE: Mira slips a letter into her coat.",
  letterWhat: "LETTER-TRUTH: Mira steals the letter.",
  bellWhat: "BELL-TRUTH: Mira's accomplice arrives.",
  miraMind: "MIRA-MIND: I took the letter and no one saw.",
  miraTake: "MIRA-TAKE: Dev suspects nothing.",
  arc: "ARC-NOTEBOOK: Dev will turn on Sam by the end.",
};
const texts = new Map<string, string>([...Object.values(OWN), ...Object.values(NEVER)].map((t) => [blobHash(t), t]));
const blobs = { get: async (_u: string, hash: string) => texts.get(hash) ?? null };

function beat(id: string, at: number, surface: string, what: string, exposure: Beat["exposure"], quotes?: string, actors: string[] = []): Beat {
  return { id, at, order: 1, place: "cafe", actors, act: "did", about: [], what: blobHash(what), surface: blobHash(surface), ...(quotes ? { quotes: blobHash(quotes) } : {}), exposure, by: { turn: "t1", decided: "character" } };
}

// The chain: the pier reached Dev whole; his own act; the door only in part (his own point of view); the letter only Mira.
const chain: Beat[] = [
  beat("pier", 600, OWN.pier, NEVER.pierWhat, [{ who: "dev", channel: "hearing", reach: "whole" }, { who: POV, channel: "hearing", reach: "whole" }], OWN.pierWords, [POV]),
  beat("devAct", 601, OWN.act, NEVER.actWhat, [{ who: "dev", channel: "sight", reach: "whole" }, { who: POV, channel: "sight", reach: "whole" }], undefined, ["dev"]),
  beat("door", 610, NEVER.door, NEVER.doorWhat, [{ who: "dev", channel: "hearing", reach: "partial", pov: blobHash(OWN.doorPov) }], NEVER.doorWords, ["mira"]),
  beat("letter", 615, NEVER.letter, NEVER.letterWhat, [{ who: "mira", channel: "sight", reach: "whole" }], undefined, ["mira"]),
];
// The scene's own beat, decided this turn and not on the chain yet.
const bell = beat("bell", 620, OWN.bell, NEVER.bellWhat, [{ who: "dev", channel: "hearing", reach: "whole" }]);
const story: StoryRead = { beats: chain.map((b, index): PlacedBeat => ({ beat: b, from: { layer: "e1", messageId: "m1" }, index })), staging: [], replaced: [], duplicates: [] };

const write = (who: string, path: string, text: string, mode: "catch-up" | "reflect" = "catch-up"): LedgerEvent[] => mindFileWrite({ who, path, at: 590, mode, lived: [], about: [] }, text).events as LedgerEvent[];

/** Dev's mind and his earlier play this scene, Mira's mind and take, and the author's notebook, all in one state. */
const state = fold(reg, world, startState(world, reg), [
  ...(seedCore({ who: "dev", at: 0, source: "card", text: OWN.core }).events as LedgerEvent[]),
  ...write("dev", mindPath("dev", "self"), OWN.self, "reflect"),
  ...write("dev", mindPath("dev", "mind"), OWN.mind),
  ...write("dev", mindPath("dev", "now"), OWN.now),
  ...write("dev", mindPath("dev", "beliefs"), OWN.beliefs),
  ...write("dev", mindPath("dev", "plans"), OWN.plans),
  ...write("dev", personPath("dev", POV), OWN.sam),
  mindLivedEvent({ who: "dev", beats: ["pier", "devAct"], at: 601, mode: "play" }) as LedgerEvent,
  mindTakeEvent({ who: "dev", at: 601, lived: ["pier"], beat: "devAct", take: OWN.take }).event as LedgerEvent,
  ...write("mira", mindPath("mira", "beliefs"), NEVER.miraMind),
  mindLivedEvent({ who: "mira", beats: ["letter"], at: 615, mode: "play" }) as LedgerEvent,
  mindTakeEvent({ who: "mira", at: 615, lived: ["letter"], take: NEVER.miraTake }).event as LedgerEvent,
  { type: "engine.ws.write", data: { path: "notebook/arcs/dev.md", hash: blobHash(NEVER.arc) } },
]);
const read: SceneRead = { world, state, story, beats: [bell] };

/** A port answering each call with the next answer, keeping every message it was sent. */
function port(...answers: unknown[]): ModelPort & { sent: { role: string; messages: PortMessage[] }[] } {
  const sent: { role: string; messages: PortMessage[] }[] = [];
  const fn = (async (role, messages) => {
    sent.push({ role, messages: messages.map((m) => ({ ...m })) });
    return { text: JSON.stringify(answers.shift() ?? {}), usage: { tokensIn: 1, tokensOut: 1 } };
  }) as ModelPort & { sent: typeof sent };
  fn.sent = sent;
  return fn;
}

const everything = (p: { sent: { messages: PortMessage[] }[] }): string => p.sent.flatMap((s) => s.messages.map((m) => m.content)).join("\n");

describe("a character at play", () => {
  test("its context, its recall's answers included, holds only its own mind and what reached it as it reached it", async () => {
    const { scene, reached } = await sceneSoFar(blobs, userId, read, "dev");
    // The scene as it lived it: the pier, then its own play; what reached it since: the door as its own point of view, the bell whole.
    expect(scene).toEqual([{ reached: expect.objectContaining({ beat: "pier", whole: true, text: OWN.pier, quotes: OWN.pierWords }) }, { played: { beat: "devAct", did: OWN.act, take: OWN.take } }]);
    expect(reached.map((p) => [p.beat, p.whole, p.text, p.quotes])).toEqual([
      ["door", false, OWN.doorPov, undefined],
      ["bell", true, OWN.bell, undefined],
    ]);

    const recall = sceneRecall(blobs, userId, read, "dev");
    const model = port(
      { recall: "what did Sam say about the pier?" },
      { do: "Dev glances toward the kitchen door.", say: "“We close early tonight.”", to: ["Sam"], take: "DEV-NEWTAKE: something is wrong back there.", now: "DEV-NEWNOW: uneasy, watching the door." },
    );
    const input = { ...(await mindInput({ registry: reg, blobs }, userId, { state, world, story }, "dev", defaultSettings())), beat: "devAct2", scene, reached, recall };
    const out = await play(model, input);
    expect(model.sent.map((s) => s.role)).toEqual(["character", "character"]);
    const sent = everything(model);
    for (const own of Object.values(OWN)) expect(sent).toContain(own);
    for (const [key, never] of Object.entries(NEVER)) expect({ key, leaked: sent.includes(never) }).toEqual({ key, leaked: false });
    // The recall answered from its own corpus: its second call carries what came back.
    expect(model.sent[1]?.messages.at(-1)?.content).toContain(OWN.pier);

    // The tool's answers themselves: nothing but its own mind and what it lived, whatever the cue.
    for (const cue of ["burn the letter", "who took the letter from the coat?", "Mira's accomplice at the door", "what does the author mean for Dev?", "what did Mira write in her beliefs?"]) {
      for (const hit of await recall(cue)) for (const never of Object.values(NEVER)) expect(hit.doc.text).not.toContain(never);
    }

    // What it does and says is its beat's; its take stays its own.
    expect(out.act).toEqual({ act: "said", surface: "Dev glances toward the kitchen door. Dev says, “We close early tonight.”", quotes: "We close early tonight.", addressed: [POV] });
    expect(actBeatTexts(out.act!, "Dev")).toEqual({ what: out.act!.surface, surface: out.act!.surface, quotes: "We close early tonight." });
    expect(out.recalls).toEqual([{ cue: "what did Sam say about the pier?", hits: expect.any(Number) }]);
    expect(out.recalls[0]!.hits).toBeGreaterThan(0);
    expect(out.take).toBe("DEV-NEWTAKE: something is wrong back there.");

    // Its events fold: what reached it and its own act are lived, its take joins its working memory, its now is rewritten.
    const after = fold(reg, world, state, out.events as LedgerEvent[]);
    expect(Object.keys(mindV2At(after, "dev").lived).sort()).toEqual(["bell", "devAct", "devAct2", "door", "pier"]);
    expect(takesOf(after, "dev").map((t) => [t.beat, t.lived, texts.get(t.hash) ?? out.blobs[t.hash]])).toEqual([
      ["devAct", ["pier"], OWN.take],
      ["devAct2", ["door", "bell"], "DEV-NEWTAKE: something is wrong back there."],
    ]);
    expect(out.blobs[mindFilesAt(after, "dev")["now.md"] ?? ""]).toBe("DEV-NEWNOW: uneasy, watching the door.");
    const all = [...exposedBeats(story).beats, bell];
    expect(pendingFor(all, mindV2At(after, "dev"), "dev")).toEqual([]);
    // Mira's working memory is hers alone, and untouched.
    expect(takesOf(after, "mira").map((t) => texts.get(t.hash))).toEqual([NEVER.miraTake]);
    // The player character has no agent: a take for him is refused (D-10).
    const take = mindTakeEvent({ who: POV, at: 620, lived: [], take: "Sam's own agent?" }).event as LedgerEvent;
    expect(take.type).toBe(MIND_TAKE);
    expect(validateEvent(reg, take, reg.context(world, state))?.code).toBe("player_character");
  });

  test("a catch-up's context holds only its own mind and the points of view it received", async () => {
    const pending = pendingFor([...exposedBeats(story).beats, bell], mindV2At(state, "dev"), "dev");
    const lived = await livedPovs(blobs, userId, world, pending, "dev");
    const model = port({ memories: [{ lived: ["door"], text: "Voices behind the door. I couldn't make them out." }], now: "Listening." });
    await catchUp(model, { ...(await mindInput({ registry: reg, blobs }, userId, { state, world, story }, "dev", defaultSettings())), lived });
    const sent = everything(model);
    for (const own of [OWN.core, OWN.self, OWN.mind, OWN.beliefs, OWN.doorPov, OWN.bell]) expect(sent).toContain(own);
    for (const [key, never] of Object.entries(NEVER)) expect({ key, leaked: sent.includes(never) }).toEqual({ key, leaked: false });
  });

  test("an answer that isn't one JSON object keeps nothing; a play with nothing to sense lets the moment pass", async () => {
    const input = { ...(await mindInput({ registry: reg, blobs }, userId, { state, world, story }, "dev", defaultSettings())), beat: "devAct3", scene: [], reached: [] };
    const broken: ModelPort = async () => ({ text: "I'd rather not say." });
    await expect(play(broken, input)).rejects.toThrow("character");
    const quiet = await play(port({ do: null, say: null, take: "Nothing to do but wait." }), input);
    expect(quiet.act).toBeNull();
    const after = fold(reg, world, state, quiet.events as LedgerEvent[]);
    // No act: its take is kept, with no beat of its own, and nothing new is lived.
    expect(takesOf(after, "dev").at(-1)).toMatchObject({ lived: [] });
    expect(takesOf(after, "dev").at(-1)?.beat).toBeUndefined();
    expect(Object.keys(mindV2At(after, "dev").lived).sort()).toEqual(["devAct", "pier"]);
  });
});
