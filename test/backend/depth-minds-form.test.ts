// Minds form in play (D-17; DEPTH-GAPS H3, M32): someone first met after opt-in, a new person, or anyone
// on a chat turned on without the bootstrap gets a mind at the first scene they join, its core from
// their card, else from what the world knows of them, and from then on plays as their own agent.

import { describe, expect, test } from "bun:test";
import type { HostCharacter } from "../../src/backend/host";
import type { ModelPort } from "../../src/backend/depth/port";
import type { DepthTurnInput, TurnSink } from "../../src/backend/depth/scene/contract";
import { scenePlugs } from "../../src/backend/depth/scene/plugs";
import { runDepthTurn } from "../../src/backend/depth/scene/turn";
import { defaultSettings } from "../../src/backend/settings-store";
import { mindedAt, mindMetaAt, mindWriteEvent } from "../../src/shared/character-engine";
import type { LedgerEvent } from "../../src/shared/ledger";
import { beatOf, STORY_BEAT, type Beat } from "../../src/shared/story";
import type { WorldDoc } from "../../src/shared/world";
import type { WorldState } from "../../src/engine/state";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { fold, startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const ROLE = "night manager of the café";
const DESCRIPTION = "Wiry, unhurried, never forgets a face.";

/** The café with Alex (the player character) and Jordan, whom the chat has never met: no mind, no bootstrap. */
function cafe(o: { lod1: boolean; fields?: boolean; card?: string }): WorldDoc {
  const world = modernUsWorld("w", "Riverton");
  for (const id of ["you", "jordan"]) {
    const e = world.entities[id];
    if (e) e.fields = { ...e.fields, place: "cafe" };
  }
  const jordan = world.entities.jordan;
  if (jordan) {
    jordan.agent = o.lod1;
    if (o.fields !== false) jordan.fields = { ...jordan.fields, role: ROLE, description: DESCRIPTION };
    if (o.card) jordan.characterId = o.card;
  }
  return world;
}

const GM = { beats: [{ kind: "act", act: "said", actors: ["you"], addressed: ["jordan"], about: ["jordan"], what: "Alex greets Jordan.", surface: "Alex says hello to Jordan.", words: "Evening.", quotes: "Evening." }], signals: [] };
const SETUP = {
  scene: { place: "cafe" },
  cast: [{ who: "jordan", effort: "agent", why: "He'll matter: he runs the place at night." }],
  staging: [
    { who: "you", where: "at the counter", doing: "waiting" },
    { who: "jordan", where: "behind the counter", doing: "counting the till", place: "cafe" },
  ],
  exposure: [{ beat: "p1", who: "jordan", channel: "hearing", reach: "whole" }],
  beats: [],
  next: ["jordan"],
  end: null,
  why: "Jordan answers as himself.",
};
const THOUGHT = "A stranger at closing time: be civil, keep it short.";
const PLAY = { do: "Jordan looks up from the till.", say: "Evening. Kitchen's closed, coffee isn't.", to: ["Alex Rivera"], take: "A new face.", now: "Closing up." };
const STEP = { exposure: [{ beat: "d1", who: "you", channel: "hearing", reach: "whole" }], staging: [], beats: [], next: [], end: "Jordan has answered: the player speaks next." };

function scripted(script: { gm: unknown[]; author: unknown[]; character: unknown[] }): ModelPort & { calls: { role: string; text: string }[] } {
  const calls: { role: string; text: string }[] = [];
  const queues: Record<string, unknown[]> = { gm: script.gm, author: script.author, character: script.character };
  const port = (async (role, messages) => {
    calls.push({ role, text: messages.map((m) => m.content).join("\n") });
    if (role === "pov") return { text: JSON.stringify({ povs: { you: "A voice at the counter.", jordan: "A voice at the counter." } }) };
    if (role === "check") return { text: JSON.stringify({ faithful: true }) };
    if (role === "narrator") return { text: "A passage." };
    return { text: JSON.stringify(queues[role]?.shift() ?? {}), ...(role === "character" ? { reasoning: THOUGHT } : {}) };
  }) as ModelPort & { calls: { role: string; text: string }[] };
  port.calls = calls;
  return port;
}

function sink(): { sink: TurnSink; lines: string[] } {
  const lines: string[] = [];
  return { sink: { progress: (t) => void lines.push(t), reasoning: (t) => void lines.push(t), content: () => {}, call: () => {} }, lines };
}

/** One turn on `state`; its texts go to `store`. */
async function turn(world: WorldDoc, state: WorldState, store: Map<string, string>, n: number, host?: DepthTurnInput["rt"]["host"]) {
  const model = scripted({ gm: [GM], author: [SETUP, STEP], character: [PLAY] });
  const log = sink();
  const input: DepthTurnInput = {
    chatId: "chat-1",
    userId: "u1",
    turn: `gen-${n}`,
    kind: "normal",
    at: { basis: { message: `m${n}`, swipe: "s0", parentPath: "p0" }, state, world, story: { beats: [], staging: [], replaced: [], duplicates: [] }, events: [] },
    plan: { events: [], elapsedMinutes: 0, resolutions: [], chips: [] },
    runSeed: "run-1",
    seed: `seed-${n}`,
    input: { messageId: `m${n}`, text: "Evening." },
    recent: "",
    settings: defaultSettings(),
    model,
    sink: log.sink,
    signal: new AbortController().signal,
    rt: { registry: reg, blobs: { get: async (_u, hash) => store.get(hash) ?? null }, ...(host ? { host } : {}) },
  };
  const result = await runDepthTurn(input, scenePlugs);
  for (const [hash, text] of Object.entries(result.blobs)) store.set(hash, text);
  return { result, model, lines: log.lines, after: fold(reg, world, state, result.pre) };
}

const cores = (pre: readonly LedgerEvent[]) => pre.flatMap((e) => [mindWriteEvent(e)].filter((w) => w !== null && w.path.endsWith("core.md")));
const beats = (pre: readonly LedgerEvent[]): Beat[] => pre.flatMap((e) => (e.type === STORY_BEAT && "data" in e ? [beatOf(e.data)].filter((b): b is Beat => b !== null) : []));
const setupText = (model: { calls: { role: string; text: string }[] }) => model.calls.find((c) => c.role === "author")?.text ?? "";

describe("minds form in play", () => {
  test("someone first met after opt-in, who lives a life of his own, gets a mind at the first scene he joins and plays as his own agent there and in the next scene", async () => {
    const world = cafe({ lod1: true });
    const store = new Map<string, string>();
    const start = startState(world, reg);
    expect(mindedAt(start)).toEqual([]);

    const first = await turn(world, start, store, 1);
    // His core formed before the author set the scene, from what the world knows of him, for the user's review; the author read him as having a mind.
    const [core] = cores(first.result.pre);
    expect(core).toMatchObject({ who: "jordan", mode: "seed", source: "world", review: true });
    expect(store.get(core?.hash ?? "")).toContain(DESCRIPTION);
    expect(setupText(first.model)).toContain("Jordan Price [jordan], has a mind");
    expect(first.lines.some((l) => l.includes("Jordan Price has a mind now"))).toBe(true);
    // His own agent played him, from that core.
    const play = first.model.calls.filter((c) => c.role === "character");
    expect(play).toHaveLength(1);
    expect(play[0]?.text).toContain(DESCRIPTION);
    expect(beats(first.result.pre).some((b) => "turn" in b.by && b.by.decided === "character" && b.actors.includes("jordan"))).toBe(true);
    expect(mindedAt(first.after)).toEqual(["jordan"]);
    // What his play wrote rides the turn's record with the play's reasoning, which Minds → Writes shows.
    const now = first.result.pre.map((e) => mindWriteEvent(e)).find((w) => w?.path.endsWith("now.md"));
    expect(store.get(now?.reasoning ?? "")).toBe(THOUGHT);

    // The next scene: the mind he has stands, and his own agent plays him again.
    const second = await turn(world, first.after, store, 2);
    expect(cores(second.result.pre)).toEqual([]);
    expect(setupText(second.model)).toContain("Jordan Price [jordan], has a mind");
    expect(second.model.calls.filter((c) => c.role === "character")).toHaveLength(1);
    expect(beats(second.result.pre).some((b) => "turn" in b.by && b.by.decided === "character" && b.actors.includes("jordan"))).toBe(true);
  });

  test("a new person the author casts as their own agent gets a mind then, from their card where the world links one", async () => {
    const card: HostCharacter = { id: "card-j", name: "Jordan Price", description: "{{char}} keeps the café's keys and its secrets.", personality: "", scenario: "", examples: "" } as HostCharacter;
    const host = { characters: { get: async (id: string) => (id === "card-j" ? card : null), ofChat: async () => null } };
    const world = cafe({ lod1: false, card: "card-j" });
    const store = new Map<string, string>();
    // Not a life of his own in the world, but a card: his mind forms at the scene's setup all the same.
    const { result, model } = await turn(world, startState(world, reg), store, 1, host);
    const [core] = cores(result.pre);
    expect(core).toMatchObject({ who: "jordan", source: "card" });
    expect(core?.review).toBeUndefined();
    expect(store.get(core?.hash ?? "")).toContain("Jordan Price keeps the café's keys and its secrets.");
    expect(model.calls.filter((c) => c.role === "character")).toHaveLength(1);
  });

  test("someone the world gives no life of their own forms a mind when the author casts them as their own agent; with nothing to form it from, the author plays them, said", async () => {
    const world = cafe({ lod1: false });
    const store = new Map<string, string>();
    const cast = await turn(world, startState(world, reg), store, 1);
    expect(setupText(cast.model)).toContain("Jordan Price [jordan], no mind yet");
    expect(cores(cast.result.pre)).toMatchObject([{ who: "jordan", source: "world" }]);
    expect(cast.model.calls.filter((c) => c.role === "character")).toHaveLength(1);
    expect(mindMetaAt(cast.after, "jordan")["core.md"]).toBeDefined();

    const bare = cafe({ lod1: false, fields: false });
    const none = await turn(bare, startState(bare, reg), new Map(), 1);
    expect(cores(none.result.pre)).toEqual([]);
    expect(none.model.calls.filter((c) => c.role === "character")).toHaveLength(0);
    expect(none.lines.some((l) => l.includes("Jordan Price has no card and nothing the world knows of them to form a mind from"))).toBe(true);
  });
});
