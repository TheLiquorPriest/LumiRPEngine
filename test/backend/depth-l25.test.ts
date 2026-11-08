// Prompt gaps of a depth turn (DEPTH-GAPS L-25; S27, C12-15, L38-40): the point-of-view render with
// a mind and a take seeded reads neither, nor the author's notebook; the notebook excerpts the
// author's setup picks reach the narrator's part, and only the narrator's; a Re-narrate of a reply
// written before depth is told from the short context, never the history before its window; the
// palette's Regenerate redoes a depth reply as the swipe setting says. Every model call is a script's.

import { describe, expect, test } from "bun:test";
import { seedCore } from "../../src/backend/character-agent";
import type { ModelPort } from "../../src/backend/depth/port";
import type { DepthTurnInput, TurnSink } from "../../src/backend/depth/scene/contract";
import { scenePlugs } from "../../src/backend/depth/scene/plugs";
import { runDepthTurn } from "../../src/backend/depth/scene/turn";
import { toChain } from "../../src/backend/ledger-io";
import { defaultSettings } from "../../src/backend/settings-store";
import { LreError } from "../../src/cli/connection";
import type { CallFields, CallRequestType, RelayLink } from "../../src/cli/loopback-relay";
import { RELAY_DEFAULTS, Relay } from "../../src/cli/loopback-relay";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { mindFileWrite, mindPath, mindTakeEvent } from "../../src/shared/character-engine";
import { isRecord } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { LoopbackResultBodies } from "../../src/shared/loopback";
import { LOOPBACK_MODEL } from "../../src/shared/loopback";
import { beatOf, STORY_BEAT } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import { coreStream } from "../cli/core-staging/llm/openai-stream";
import type { Generation } from "../support/fake-host";
import { modernUsWorld } from "../packs/riverton";
import { fold, startState } from "../packs/support";
import { Rig } from "../support/rig";

// ------------------------------------------------------------------ one turn on the real stages

const reg = createRegistry(ALL_PACKS);
const world = modernUsWorld("w", "Riverton");
for (const id of ["you", "maya", "rosa", "jordan"]) {
  const e = world.entities[id];
  if (e) e.fields = { ...e.fields, place: "cafe" };
}

/** What a point-of-view render must never be given: a mind's own files, its take of the scene, and the author's notebook. */
const SECRET = {
  mayaMind: "MAYA-BELIEF: Alex owes the café forty dollars.",
  mayaTake: "MAYA-TAKE: he is here to apologise, I can tell.",
  rosaTake: "ROSA-TAKE: the barista is hiding something.",
  notebook: "NOTEBOOK-ARC: Maya will forgive the debt by the end.",
};
const store = new Map<string, string>(Object.values(SECRET).map((t) => [blobHash(t), t]));
const cores = [seedCore({ who: "maya", at: 0, source: "card", text: "Maya Chen, the café's barista." }), seedCore({ who: "rosa", at: 0, source: "card", text: "Rosa Delgado, a mechanic." })];
for (const c of cores) for (const [hash, text] of Object.entries(c.blobs)) store.set(hash, text);
const state = fold(reg, world, startState(world, reg), [
  ...cores.flatMap((c) => c.events as LedgerEvent[]),
  ...(mindFileWrite({ who: "maya", path: mindPath("maya", "beliefs"), at: 0, mode: "reflect", lived: [], about: [] }, SECRET.mayaMind).events as LedgerEvent[]),
  mindTakeEvent({ who: "maya", at: 0, lived: [], take: SECRET.mayaTake }).event as LedgerEvent,
  mindTakeEvent({ who: "rosa", at: 0, lived: [], take: SECRET.rosaTake }).event as LedgerEvent,
  { type: "engine.ws.write", data: { path: "notebook/arcs/maya.md", hash: blobHash(SECRET.notebook) } },
]);

const ORDER_WHAT = "Alex orders a coffee from Maya.";
const ORDER_SURFACE = "Alex steps up to the counter and orders.";
const GM = { beats: [{ kind: "act", act: "said", actors: ["you"], addressed: ["maya"], about: ["maya"], what: ORDER_WHAT, surface: ORDER_SURFACE, words: "One coffee, please.", quotes: "One coffee, please." }], signals: [] };
const EXCERPT = "Keep it rain-soaked and slow: Maya hasn't mentioned the debt yet.";
const SETUP = {
  scene: { place: "cafe" },
  cast: [
    { who: "maya", effort: "agent", why: "She serves him, as herself." },
    { who: "rosa", effort: "author", why: "A regular at the window." },
  ],
  staging: [
    { who: "you", where: "at the counter", doing: "ordering" },
    { who: "maya", where: "behind the counter", doing: "wiping the steam wand", place: "cafe" },
    { who: "rosa", where: "at the window table", doing: "reading the paper", place: "cafe" },
  ],
  exposure: [
    { beat: "p1", who: "maya", channel: "hearing", reach: "whole" },
    { beat: "p1", who: "rosa", channel: "hearing", reach: "partial" },
  ],
  beats: [],
  excerpts: [EXCERPT],
  next: ["maya"],
  end: null,
  reasoning: "He orders; Maya answers.",
};
const PLAY = { do: "Maya reaches for a cup.", say: "Coming right up.", to: ["Alex Rivera"], take: "He looks tired.", now: "Busy." };
const STEP = { exposure: [{ beat: "d1", who: "you", channel: "hearing", reach: "whole" }, { beat: "d1", who: "rosa", channel: "sight", reach: "partial" }], staging: [], beats: [], next: [], end: "Maya has answered: the player speaks next." };

function scripted(script: { gm: unknown[]; author: unknown[]; character: unknown[] }): ModelPort & { calls: { role: string; text: string }[] } {
  const calls: { role: string; text: string }[] = [];
  const queues: Record<string, unknown[]> = { gm: script.gm, author: script.author, character: script.character };
  const port = (async (role, messages) => {
    calls.push({ role, text: messages.map((m) => m.content).join("\n") });
    if (role === "pov") return { text: JSON.stringify({ povs: Object.fromEntries(["you", "maya", "rosa", "jordan"].map((who) => [who, `Only part of it reaches ${who}: voices at the counter.`])) }) };
    if (role === "check") return { text: JSON.stringify({ faithful: true }) };
    if (role === "narrator") return { text: "A passage." };
    return { text: JSON.stringify(queues[role]?.shift() ?? {}) };
  }) as ModelPort & { calls: { role: string; text: string }[] };
  port.calls = calls;
  return port;
}

const sink: TurnSink = { progress: () => {}, reasoning: () => {}, content: () => {}, call: () => {} };

async function playedTurn() {
  const model = scripted({ gm: [GM], author: [SETUP, STEP], character: [PLAY] });
  const input: DepthTurnInput = {
    chatId: "chat-1",
    userId: "u1",
    turn: "gen-1",
    kind: "normal",
    at: { basis: { message: "m1", swipe: "s0", parentPath: "p0" }, state, world, story: { beats: [], staging: [], replaced: [], duplicates: [] }, events: [] },
    plan: { events: [], elapsedMinutes: 0, resolutions: [], chips: [] },
    runSeed: "run-1",
    seed: "seed-1",
    input: { messageId: "m1", text: "One coffee, please." },
    recent: "",
    settings: defaultSettings(),
    model,
    sink,
    signal: new AbortController().signal,
    rt: { registry: reg, blobs: { get: async (_u, hash) => store.get(hash) ?? null } },
  };
  const result = await runDepthTurn(input, scenePlugs);
  return { result, calls: model.calls };
}

describe("a depth turn's prompts (L-25)", () => {
  test("S27: the point-of-view render, with a mind and a take seeded, reads what there was to sense and none of a mind, a take or the notebook", async () => {
    const { result, calls } = await playedTurn();
    expect(result.stopped).toBe(false);
    // The seeds are live: Maya's play is given her own mind and her take of the scene.
    const play = calls.find((c) => c.role === "character")?.text ?? "";
    expect(play).toContain(SECRET.mayaMind);
    const povs = calls.filter((c) => c.role === "pov");
    expect(povs.length).toBeGreaterThan(0);
    expect(povs.some((c) => c.text.includes(ORDER_SURFACE))).toBe(true);
    for (const c of povs) for (const s of [ORDER_WHAT, ...Object.values(SECRET)]) expect({ leaked: s, in: c.text.includes(s) }).toEqual({ leaked: s, in: false });
  });

  test("C12-15: the notebook excerpts the setup picks reach the narrator's part, and the GM's check of it, never a play or a point of view", async () => {
    const { calls } = await playedTurn();
    const narrator = calls.filter((c) => c.role === "narrator");
    expect(narrator.length).toBeGreaterThan(0);
    for (const c of narrator) expect(c.text).toContain(`## From the author's notebook, for this scene\n${EXCERPT}`);
    const checks = calls.filter((c) => c.role === "check");
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) expect(c.text).toContain(EXCERPT);
    for (const c of calls.filter((x) => x.role === "character" || x.role === "pov")) expect(c.text).not.toContain(EXCERPT);
    // The notebook itself stays the author's: only the excerpt it chose is the narrator's.
    for (const c of narrator) expect(c.text).not.toContain(SECRET.notebook);
  });
});

// ------------------------------------------------------------------ through the loopback

const SESSION = "c25c".repeat(8);
const PORT = 7891;
const PASSAGE = "A bell rings over the door as you come in.";
const RETOLD = "The old reply, told again from the window.";

class BackendLink implements RelayLink {
  up = true;
  out = null;
  refused: string | null = null;
  secret = "";

  constructor(private readonly rig: Rig) {}

  async request<T extends CallRequestType>(type: T, fields: CallFields<T>): Promise<LoopbackResultBodies[T]> {
    return (await this.send(type, fields as unknown as Record<string, unknown>)) as LoopbackResultBodies[T];
  }

  async send(type: string, fields: Record<string, unknown>): Promise<unknown> {
    const reply = await this.rig.send({ type, secret: this.secret, ...fields }, SESSION);
    if (reply.type === "lre.error") throw new LreError(reply.code, reply.message, []);
    if (reply.type !== "lre.result") throw new Error(`no result to ${type}`);
    return reply.body;
  }
}

function answer(text: string): string {
  if (text.includes("What the player wrote, verbatim:")) return JSON.stringify({ beats: [{ kind: "act", act: "said", what: "He walks into the shop and says hello.", surface: "He walks in and says hello.", words: /What the player wrote, verbatim:\n(.*)/.exec(text)?.[1] ?? "", quotes: "Hello?" }], signals: [] });
  if (text.includes("His beats, as the GM wrote them:")) {
    const pov = /\[([^\]]+)\] \(the player character\)/.exec(text)?.[1] ?? "";
    return JSON.stringify({ scene: {}, cast: [], staging: [], exposure: [], beats: [{ what: "The bell over the door rings as he comes in.", surface: "A bell rings over the door.", exposure: [{ who: pov, channel: "hearing", reach: "whole" }] }], next: [], end: "He has come in: the player speaks next." });
  }
  if (text.includes("## The beats of its moment")) return JSON.stringify({ faithful: true });
  if (text.includes("## This moment")) return PASSAGE;
  // A narrator's call that tells no moment: today's narrator, from the preset's prompt.
  if (text.startsWith("You are the narrator of this story.")) return RETOLD;
  return "{}";
}

/** A world chat on the loopback, its relay up, with `history` already in it, on depth unless `depth` is false: every quiet call's text in `asked`. */
async function loopbackDepth(rig: Rig, asked: string[], history: readonly string[] = [], depth = true) {
  const host = rig.host;
  host.connectionProfiles.push({ id: "conn-loop", name: "Loopback", models: [LOOPBACK_MODEL], provider: "custom", url: `http://127.0.0.1:${PORT}/v1` });
  host.contextConnectionId = "conn-loop";
  host.quietReply = (req) => {
    const text = req.messages.map((m) => m.content).join("\n");
    asked.push(text);
    return answer(text);
  };
  const link = new BackendLink(rig);
  const registered = await link.send("lre.loopback.register", { name: "sam", mode: "user", build: "dev", host: "box", listen: "127.0.0.1", port: PORT });
  if (!isRecord(registered) || typeof registered.secret !== "string") throw new Error("the relay wasn't registered");
  link.secret = registered.secret;
  const page = rig.body(await rig.send({ type: "lre.loopback.page", op: "mint" })).page;
  if (!isRecord(page) || typeof page.minted !== "string") throw new Error("no loopback key was minted");
  const key = page.minted;
  const report = { name: "sam", build: "dev", runtime: { bun: "/usr/bin/bun", script: "/srv/lre/lumirpengine.js", unit: null }, host: "box", listen: "127.0.0.1", port: PORT, scheduler: "excluded", session: { valid: true, expiresAt: null, checkedAt: null }, calls: 0 };
  await link.send("lre.loopback.hello", { api: 1, report, open: [] });
  const relay = new Relay(link, { ...RELAY_DEFAULTS, listen: "127.0.0.1", port: PORT, mode: "user" }, { now: Date.now, id: () => crypto.randomUUID().replaceAll("-", ""), log: () => undefined, fingerprint: async () => "fp" });
  const send = host.frontend.send;
  host.frontend.send = (message, userId, session) => {
    send(message, userId, session);
    if (message.type === "lre.loopback.chunk" && session === SESSION) queueMicrotask(() => relay.chunk(message));
  };
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = host.createChat("Morning.");
  history.forEach((text, i) => host.append(host.chat(chatId), { id: `old${i}`, isUser: i % 2 === 0, name: i % 2 === 0 ? "User" : "Narrator", swipes: [text], swipeId: 0, bag: {} }));
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  if (depth) rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on: true }));
  return { relay, key, chatId };
}

async function relayed(at: { relay: Relay; key: string }, g: Generation) {
  const res = await at.relay.fetch(new Request(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${at.key}`, host: `127.0.0.1:${PORT}`, "content-type": "application/json" }, body: JSON.stringify({ model: LOOPBACK_MODEL, stream: true, messages: g.prompt ?? [], lre_turn: g.parameters?.lre_turn }) }));
  let content = "";
  let reasoning = "";
  for await (const c of coreStream(res)) {
    content += c.token;
    reasoning += c.reasoning ?? "";
  }
  return { g, content, reasoning };
}

// Each test boots a whole Rig and plays its turns through the relay: on a loaded machine that runs past bun's 5s default.
const LOOPBACK_MS = 60_000;

describe("a chat on depth through the loopback (L-25)", () => {
  test("a Re-narrate of a reply written before depth is told from the short context: the recent window, never the history before it, and no scene", async () => {
    const rig = new Rig({ shipped: true });
    const host = rig.host;
    const asked: string[] = [];
    const earlier = Array.from({ length: 6 }, (_, i) => `Earlier line ${i + 1}: the rain keeps on.`);
    const at = await loopbackDepth(rig, asked, earlier, false);
    // A reply before the chat went on depth: today's narrator writes it, and its record holds no beat.
    host.sendUser(at.chatId, "I ask about the rain.");
    await host.settle();
    const classic = await relayed(at, await host.begin(at.chatId, { type: "normal" }));
    expect(classic.content).toBe(RETOLD);
    await host.finish(classic.g, classic.content);
    const reply = host.head(at.chatId);
    if (!reply || reply.isUser) throw new Error("no reply");
    rig.body(await rig.send({ type: "lre.bootstrap", chatId: at.chatId, op: "opt", on: true }));
    expect((await rig.rt.settings.get(host.userId)).swipeDefault).toBe("renarrate");

    const before = host.quietCalls.length;
    const out = await relayed(at, await host.begin(at.chatId, { type: "swipe", messageId: reply.id }));
    expect(out.reasoning).toContain("The narrator reads your preset as it is and the chat's last 4 messages");
    expect(out.reasoning).toContain("The 4 earlier messages stay out of its prompt.");
    expect(out.reasoning).toContain("No scene plays this reply (it re-tells a reply written before the chat went on depth)");
    expect(out.content).toBe(RETOLD);
    const calls = host.quietCalls.slice(before).map((r) => r.messages.map((m) => m.content).join("\n"));
    // No scene plays: no GM reading, no setup, no moment's part.
    expect(calls.some((t) => t.includes("His beats, as the GM wrote them:") || t.includes("What the player wrote, verbatim:") || t.includes("## This moment"))).toBe(false);
    const narrator = calls.at(-1) ?? "";
    // The window (4 messages by default): the player's message and the three before it, never the history before them.
    expect(narrator).toContain("I ask about the rain.");
    for (const l of earlier.slice(3)) expect(narrator).toContain(l);
    for (const l of earlier.slice(0, 3)) expect(narrator).not.toContain(l);
    expect(narrator).not.toContain("Morning.");
  }, LOOPBACK_MS);

  test("a turn made while the chat is paused is told from the short context: the recent window, never the history before it, and no scene", async () => {
    const rig = new Rig({ shipped: true });
    const host = rig.host;
    const asked: string[] = [];
    const earlier = Array.from({ length: 6 }, (_, i) => `Earlier line ${i + 1}: the rain keeps on.`);
    const at = await loopbackDepth(rig, asked, earlier, false);
    // A reply before the chat went on depth: its record holds no beat, so an edit of the message it answered pauses the chat.
    host.sendUser(at.chatId, "I ask about the rain.");
    await host.settle();
    const classic = await relayed(at, await host.begin(at.chatId, { type: "normal" }));
    await host.finish(classic.g, classic.content);
    rig.body(await rig.send({ type: "lre.bootstrap", chatId: at.chatId, op: "opt", on: true }));
    const asking = host.chat(at.chatId).messages.findLast((m) => m.isUser);
    if (!asking) throw new Error("no player message");
    host.editMessage(at.chatId, asking.id, "I ask whether the rain will stop.");
    await host.settle();
    expect((await rig.rt.ledger.core(at.chatId, host.userId))?.journal.pauses.length).toBe(1);

    host.sendUser(at.chatId, "I wait by the window.");
    await host.settle();
    const before = host.quietCalls.length;
    const out = await relayed(at, await host.begin(at.chatId, { type: "normal" }));
    expect(out.reasoning).toContain("No scene plays this reply (the turn was made while the chat was paused)");
    expect(out.reasoning).toContain("The narrator reads your preset as it is and the chat's last 4 messages");
    expect(out.content).toBe(RETOLD);
    const calls = host.quietCalls.slice(before).map((r) => r.messages.map((m) => m.content).join("\n"));
    expect(calls.some((t) => t.includes("His beats, as the GM wrote them:") || t.includes("What the player wrote, verbatim:") || t.includes("## This moment"))).toBe(false);
    const narrator = calls.at(-1) ?? "";
    // The window: his new message and the three before it (the edited one as he left it), never the history before them.
    for (const l of ["I wait by the window.", RETOLD, "I ask whether the rain will stop.", earlier[5] ?? ""]) expect(narrator).toContain(l);
    for (const l of earlier.slice(0, 5)) expect(narrator).not.toContain(l);
    expect(narrator).not.toContain("Morning.");
  }, LOOPBACK_MS);

  test("the palette's Regenerate of a depth reply: under Re-narrate the same beats told afresh, no scene played; under Re-run the scene plays again, told it came as a Regenerate", async () => {
    const rig = new Rig({ shipped: true });
    const host = rig.host;
    const asked: string[] = [];
    const at = await loopbackDepth(rig, asked);
    const setups = () => asked.filter((t) => t.includes("His beats, as the GM wrote them:"));
    const beatsOf = async (swipe: string) => {
      const rec = (await rig.rt.ledger.core(at.chatId, host.userId))?.chain(toChain(await host.chats.messages(at.chatId, host.userId))).at(-1)?.ledger?.swipes[swipe];
      return (rec?.events.slice(0, rec.pre) ?? []).flatMap((e) => (e.type === STORY_BEAT && "data" in e ? [beatOf(e.data)?.id] : []));
    };
    host.sendUser(at.chatId, "I walk into the shop. Hello?");
    await host.settle();
    const first = await relayed(at, await host.begin(at.chatId, { type: "normal" }));
    await host.finish(first.g, first.content);
    const told = await beatsOf("0");
    expect(told.length).toBeGreaterThan(0);
    expect(setups()).toHaveLength(1);
    const reply = host.head(at.chatId);
    if (!reply) throw new Error("no reply");

    // The shipped swipe setting: Re-narrate.
    const again = await relayed(at, await host.begin(at.chatId, { type: "regenerate", messageId: reply.id }));
    expect(again.reasoning).toContain("Re-narrating, as your swipe setting says");
    expect(again.content).toBe(PASSAGE);
    expect(setups()).toHaveLength(1);
    await host.finish(again.g, again.content);
    expect(await beatsOf("1")).toEqual(told);

    rig.body(await rig.send({ type: "lre.settings.set", patch: { swipeDefault: "rerun" } }));
    const rerun = await relayed(at, await host.begin(at.chatId, { type: "regenerate", messageId: reply.id }));
    expect(rerun.reasoning).toContain("Re-running, as your swipe setting says");
    expect(rerun.content).toBe(PASSAGE);
    expect(setups()).toHaveLength(2);
    expect(setups()[1]).toContain("a Regenerate");
    await host.finish(rerun.g, rerun.content);
    const replayed = await beatsOf("2");
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed).not.toEqual(told);
  }, LOOPBACK_MS);
});
