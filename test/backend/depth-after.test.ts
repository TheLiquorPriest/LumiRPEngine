// Right after a depth reply (DEPTH-PLAN §2.4, §6.4), through the ledger: whoever played remembers
// the turn, the GM links the turn's beats and what they now believe to the truth (at the GM's answer
// room, grown with what it reads), the author's poll
// lands its log, its jobs and its open predictions' scores at the reply, the catch-ups it asked for
// run before the reflections, which run before its own reflection, and that reflection lands its
// notebook revision, drift checks and predictions; Settings → Depth → Notebook revisions bounds how
// often the author reflects.

import { describe, expect, test } from "bun:test";
import { tokensOf } from "../../src/backend/book";
import { headBasis } from "../../src/backend/character-engine";
import type { ModelPort } from "../../src/backend/depth/port";
import { afterDepthReply, BACKGROUND_OFF, cadenceHolds, type AfterRt } from "../../src/backend/depth/scene/after";
import { talkLeft, talkTap, TALK_CHOICES } from "../../src/backend/depth/scene/talk";
import { truthLinkRoom } from "../../src/backend/depth/truth-link";
import { defaultSettings } from "../../src/backend/settings-store";
import { depthRequest, type DepthHost } from "../../src/backend/depth-views";
import type { Runtime } from "../../src/backend/runtime";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import { AUTHOR_DRIFT, AUTHOR_POLL, AUTHOR_PREDICT, AUTHOR_SCORE, authorData, predictEvent, predictionId, type PollData } from "../../src/shared/author";
import { mindFileWrite, mindLivedEvent, mindPath, mindTakeEvent, TAKES_KEPT, takesOf } from "../../src/shared/character-engine";
import { depthModel, type DepthRole } from "../../src/shared/depth-settings";
import { sceneEvent } from "../../src/shared/scene";
import { beatEvent, type Beat } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import { talkEvent } from "../../src/shared/talk";
import { layerEntryId } from "../../src/engine/ledger/layer";
import { notebookFiles } from "../../src/engine/notebook";
import authorPack from "../../src/packs/author/core/index";
import { readKnowledge } from "../../src/packs/minds/core/state";
import storyPack from "../../src/packs/story/core/index";
import { Harness } from "../support/harness";
import { readyLoopback } from "../support/relay";
import { Rig } from "../support/rig";

const PIER = "Sam says the pier floods at eight.";
const PIER_WHAT = "Sam warns Dev that the pier floods at eight.";
const BOAT = "A boat comes in low across the bay.";
const TAKE = "Sam looked worried. I should close early.";
const MEMORY = "Sam warned me the pier floods at eight. That one will stay with me.";
const BELIEFS = "- The pier floods at eight. I'd swear to it.";
const SELF = "I listen to warnings now.";

function rtOf(h: Harness): AfterRt {
  const stored = new Map<string, string>([PIER, PIER_WHAT, BOAT, TAKE].map((t) => [blobHash(t), t]));
  const settings = defaultSettings();
  return {
    host: h.host,
    registry: h.registry,
    blobs: { get: async (_u, hash) => stored.get(hash) ?? null, put: async (_u, text) => (stored.set(blobHash(text), text), blobHash(text)) },
    settings: { get: async () => settings },
    ledger: h.service,
  };
}

/** Each role answers in turn from its own list, and every call's text and answer room are kept by role. */
function port(answers: Partial<Record<DepthRole, unknown[]>>): ModelPort & { sent: Partial<Record<DepthRole, string[]>>; rooms: Partial<Record<DepthRole, (number | undefined)[]>> } {
  const sent: Partial<Record<DepthRole, string[]>> = {};
  const rooms: Partial<Record<DepthRole, (number | undefined)[]>> = {};
  const fn = (async (role, messages, opts) => {
    (sent[role] ??= []).push(messages.map((m) => m.content).join("\n"));
    (rooms[role] ??= []).push(opts?.maxTokens);
    return { text: JSON.stringify(answers[role]?.shift() ?? {}), usage: { tokensIn: 1, tokensOut: 1 } };
  }) as ModelPort & { sent: Partial<Record<DepthRole, string[]>>; rooms: Partial<Record<DepthRole, (number | undefined)[]>> };
  fn.sent = sent;
  fn.rooms = rooms;
  return fn;
}

const beat = (id: string, at: number, what: string, surface: string, pending: boolean, scene?: string): Beat => ({
  id,
  at,
  order: at,
  ...(scene ? { scene } : {}),
  place: "home",
  actors: ["sam"],
  act: "said",
  about: [],
  what: blobHash(what),
  surface: blobHash(surface),
  exposure: [{ who: "dev", channel: "hearing", reach: "whole", ...(pending ? { pending: true as const } : {}) }],
  by: { turn: "t1", decided: "player" },
});

describe("right after a depth reply", () => {
  test("remember, truth-link, poll, its jobs in order, then the author's reflection, each landed at the reply", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    const greeting = await h.service.basisFor(chat, userId);
    if (!greeting) throw new Error("no greeting");
    // What happened before the turn: a prediction still open, and a boat Dev saw and hasn't lived yet.
    expect((await h.service.landLayer(chat, userId, { id: "before", basis: greeting, kind: "story.beat", events: [predictEvent({ id: "p-old", text: "Dev will close the cafe early.", about: ["dev"], from: "scene" }), beatEvent(beat("boat", 500, BOAT, BOAT, true))] })).status).toBe("landed");
    await h.send(chat, "The pier floods at eight, Dev.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    // The turn's scene as its record holds it: Dev played as his own agent, and the scene ended.
    const take = mindTakeEvent({ who: "dev", at: 600, lived: ["pier"], take: TAKE });
    const scene = sceneEvent({ scene: "s1", place: "home", at: 600, cast: [{ who: "dev", effort: "agent", why: "the warning is his" }], opens: true, ends: true });
    expect((await h.service.landLayer(chat, userId, { id: "turn", basis, kind: "story.beat", events: [scene, beatEvent(beat("pier", 600, PIER_WHAT, PIER, false, "s1")), mindLivedEvent({ who: "dev", beats: ["pier"], at: 600, mode: "play" }), take.event] })).status).toBe("landed");

    const model = port({
      character: [
        { memories: [{ lived: ["pier"], about: ["sam"], text: MEMORY }], beliefs: BELIEFS },
        { memories: [{ lived: ["boat"], about: [], text: "The boat came in low." }] },
        { self: SELF, on_my_mind: "The pier, at eight." },
      ],
      gm: [{ facts: [{ ref: "f1", claim: "The pier floods at eight.", matters: "Dev closes early because of it.", about: ["dev"] }], links: [{ who: "dev", fact: "f1", from: { mind: "minds/dev/beliefs.md" }, belief: "true", confidence: 0.9, words: "I'd swear to it", why: "Dev wrote it in his beliefs." }] }],
      author: [
        { catchup: [{ who: "dev", why: "the boat will matter tonight" }], reflect: [{ who: "dev", why: "a warning that changes his day" }], author: { depth: "scene", why: "the scene ended" }, scores: [{ prediction: "p-old", outcome: "hit", note: "He means to close early." }], considered: [{ what: "Sam's own plans tonight", raised: false, why: "nothing presses yet" }] },
        { files: [{ path: "notebook/arcs/dev.md", text: "Dev learns to trust Sam." }], drift: [{ who: "dev", drift: "some", note: "Warier than his arc." }], predictions: [{ text: "Dev closes the cafe at seven.", about: ["dev"] }] },
      ],
    });
    const out = await afterDepthReply(rt, chat, userId, basis, { scene: "s1", ended: true, remember: ["dev"], poll: true, beats: ["pier"], signals: ["(OOC) let it rain later"] }, { model });
    expect(out).toEqual({
      remembered: ["dev"],
      linked: true,
      jobs: [
        { kind: "catchup", who: "dev", why: "the boat will matter tonight" },
        { kind: "reflect", who: "dev", why: "a warning that changes his day" },
        { kind: "author.reflect", depth: "scene", why: "the scene ended" },
      ],
      caughtUp: ["dev"],
      reflected: ["dev"],
      authorReflected: "scene",
      failed: [],
      offscreen: null,
      put: [],
    });
    // The GM read the turn's beat whole and what Dev now believes; the poll read what he keeps, what waits for him, the open prediction and the player's signal.
    expect(model.sent.gm?.[0]).toContain(PIER_WHAT);
    expect(model.sent.gm?.[0]).toContain(BELIEFS);
    // What the poll's catch-up and reflection wrote is linked too, after them: the GM read what Dev believes then.
    expect(model.sent.gm).toHaveLength(2);
    expect(model.sent.gm?.[1]).toContain(BELIEFS);
    const poll = model.sent.author?.[0] ?? "";
    for (const part of [MEMORY, BOAT, "[p-old]", "(OOC) let it rain later", "The scene ended with this turn."]) expect(poll).toContain(part);
    // The author's own reflection came after Dev's: it read who he has become, and the player's signals for player.md.
    expect(model.sent.author?.[1]).toContain(SELF);
    expect(model.sent.author?.[1]).toContain("- (OOC) let it rain later");

    const head = await h.service.foldAtBasis(chat, userId, basis, [AUTHOR_POLL, AUTHOR_SCORE, AUTHOR_DRIFT, AUTHOR_PREDICT]);
    if (!head) throw new Error("no fold");
    const types = head.events.map((e) => e.event.type);
    expect(types.filter((t) => t === AUTHOR_POLL)).toHaveLength(1);
    expect(head.events.find((e) => e.event.type === AUTHOR_SCORE)?.event).toMatchObject({ data: { prediction: "p-old", outcome: "hit" } });
    expect(head.events.find((e) => e.event.type === AUTHOR_DRIFT)?.event).toMatchObject({ data: { who: "dev", drift: "some" } });
    expect(head.events.filter((e) => e.event.type === AUTHOR_PREDICT).map((e) => ("data" in e.event ? e.event.data.id : null))).toEqual(["p-old", predictionId(chat, basis.message, basis.swipe, "0")]);
    expect(notebookFiles(head.state).map((f) => f.path)).toEqual(["notebook/arcs/dev.md"]);
    expect(Object.values(readKnowledge(head.state).facts).map((f) => f.claim)).toEqual(["The pier floods at eight."]);

    // Everything landed at this reply: a swipe of it leaves none of it standing.
    await h.host.finish(await h.host.start(chat, { type: "swipe", messageId: basis.message }), "Okay, at eight.");
    const swiped = await h.service.readEvents(chat, userId, [AUTHOR_POLL, AUTHOR_SCORE]);
    expect(swiped).toEqual([]);
  });

  test("the poll keeps the story time it asks to be woken at, and a reply whose clock passed it wakes a poll a conversation put off", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "I'll wait for the tide.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    const model = port({ author: [{ wake: { minutes: 30, why: "the tide turns" } }, {}] });
    await afterDepthReply(rt, chat, userId, basis, { scene: null, ended: false, remember: [], poll: true, beats: [] }, { model });
    const first = await h.service.foldAtBasis(chat, userId, basis, [AUTHOR_POLL]);
    if (!first) throw new Error("no fold");
    const wake = first.events.flatMap((e) => authorData<PollData>(e.event, AUTHOR_POLL)?.wake ?? []).at(-1);
    expect(wake).toEqual({ at: first.state.clock + 30, why: "the tide turns" });
    // Before the clock reaches it, a put-off poll stays asleep.
    expect((await afterDepthReply(rt, chat, userId, basis, { scene: null, ended: false, remember: [], poll: false, beats: [] }, { model, occasion: "early" })).jobs).toBeNull();
    expect((await h.service.landLayer(chat, userId, { id: "tide", basis, kind: "clock", events: [{ type: "clock", minutes: 45, cause: "advance" }] })).status).toBe("landed");
    const out = await afterDepthReply(rt, chat, userId, basis, { scene: null, ended: false, remember: [], poll: false, beats: [] }, { model, occasion: "tide" });
    expect(out.jobs).toEqual([]);
    expect(model.sent.author?.[1]).toContain("when you asked to be woken (the tide turns)");
  });

  test("Settings → Depth → Notebook revisions bounds how often the author reflects", () => {
    expect(cadenceHolds("turns", "scene", false)).toBeNull();
    expect(cadenceHolds("scenes", "scene", false)).toContain("the scene goes on");
    expect(cadenceHolds("scenes", "chapter", true)).toBeNull();
    expect(cadenceHolds("chapters", "scene", true)).toContain("At a chapter's end");
    expect(cadenceHolds("chapters", "chapter", false)).toBeNull();
  });

  test("the GM's truth link asks at the GM's answer room (Settings → Depth), grown with what it reads, as the bootstrap's", async () => {
    /** One turn's beat truth-linked after the reply, the GM's row its own at `own` tokens of room: the room the GM was asked at, and what it read. */
    const linkAt = async (own: number): Promise<{ room: number | undefined; read: string }> => {
      const h = new Harness("fresh", { packs: [storyPack, authorPack] });
      const rt = rtOf(h);
      const settings = await rt.settings.get(h.host.userId);
      settings.depth.roles.gm = { uses: "own", own: { ...depthModel(settings.depth, "gm"), maxTokens: own } };
      const chat = await h.newChat();
      await h.send(chat, "The pier floods at eight, Dev.");
      const basis = await h.service.basisFor(chat, h.host.userId);
      if (!basis) throw new Error("no basis");
      expect((await h.service.landLayer(chat, h.host.userId, { id: "turn", basis, kind: "story.beat", events: [beatEvent(beat("pier", 600, PIER_WHAT, PIER, false))] })).status).toBe("landed");
      const model = port({ gm: [{ facts: [{ ref: "f1", claim: "The pier floods at eight.", matters: "Dev closes early because of it.", about: ["dev"] }], links: [] }] });
      const out = await afterDepthReply(rt, chat, h.host.userId, basis, { scene: null, ended: false, remember: [], poll: false, beats: ["pier"] }, { model });
      expect(out.failed).toEqual([]);
      expect(out.linked).toBe(true);
      expect(model.rooms.gm).toHaveLength(1);
      return { room: model.rooms.gm?.[0], read: model.sent.gm?.[0] ?? "" };
    };
    // A room more than four times the read: the GM's own.
    expect((await linkAt(20_000)).room).toBe(20_000);
    // A room less than four times the read grows to it.
    const small = await linkAt(256);
    expect(small.room).toBeGreaterThan(256);
    expect(small.room).toBeLessThanOrEqual(truthLinkRoom(256, tokensOf(small.read)));
  });

  test("a character remembers when its scene ends for it: not while its talk runs; when the player leaves, at once; and the GM links what it then believes", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "How have you been, Dev?", "Fine.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    // A line of real-time dialogue: Dev answered as his own agent, and the talk runs on.
    const take = mindTakeEvent({ who: "dev", at: 600, lived: ["pier"], take: TAKE });
    expect((await h.service.landLayer(chat, userId, { id: "line", basis, kind: "story.beat", events: [talkEvent({ with: "dev", state: "on", by: "author", scene: "s1" }), beatEvent(beat("pier", 600, PIER_WHAT, PIER, false, "s1")), mindLivedEvent({ who: "dev", beats: ["pier"], at: 600, mode: "play" }), take.event] })).status).toBe("landed");
    const links = { facts: [{ ref: "f1", claim: "The pier floods at eight.", matters: "Dev closes early because of it.", about: ["dev"] }], links: [{ who: "dev", fact: "f1", from: { mind: "minds/dev/beliefs.md" }, belief: "true", confidence: 0.9, words: "I'd swear to it", why: "Dev wrote it in his beliefs." }] };
    const model = port({ character: [{ memories: [{ lived: ["pier"], about: ["sam"], text: MEMORY }], beliefs: BELIEFS }], gm: [{}, links] });
    const during = await afterDepthReply(rt, chat, userId, basis, { scene: "s1", ended: false, remember: [], poll: false, beats: ["pier"] }, { model });
    expect([during.remembered, model.sent.character]).toEqual([[], undefined]);

    // The player leaves: the talk ends at the reply, and its end remembers it there, links what Dev believes now, and runs the poll the conversation deferred.
    const tap = await talkTap({ host: h.host, ledger: h.service }, chat, userId, `talk:${basis.message}:0`, TALK_CHOICES.leave);
    if (!("applied" in tap) || !tap.left) throw new Error(`no Leave: ${JSON.stringify(tap)}`);
    const left = await talkLeft(rt, chat, userId, tap.left, { model });
    expect([left.remembered, left.linked, left.failed, left.jobs]).toEqual([["dev"], true, [], []]);
    expect(model.sent.author?.length).toBe(1);
    expect(model.sent.gm?.[1]).toContain(BELIEFS);
    const after = await h.service.foldAtBasis(chat, userId, basis);
    expect(after ? takesOf(after.state, "dev") : null).toEqual([]);
    expect(Object.values(after ? readKnowledge(after.state).facts : {}).map((f) => f.claim)).toEqual(["The pier floods at eight."]);
  });

  test("whoever holds takes remembers, not only this turn's players (a talk the author ended at the setup); a talk still on keeps its partner's open until the takes reach the cap", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "How have you been, Dev?", "Fine.");
    const first = await h.service.basisFor(chat, userId);
    if (!first) throw new Error("no basis");
    expect((await h.service.landLayer(chat, userId, { id: "line", basis: first, kind: "story.beat", events: [talkEvent({ with: "dev", state: "on", by: "author", scene: "s1" }), beatEvent(beat("pier", 600, PIER_WHAT, PIER, false, "s1")), mindTakeEvent({ who: "dev", at: 600, lived: ["pier"], take: TAKE }).event] })).status).toBe("landed");
    // The next turn is a scene: its setup ends the talk, and Dev doesn't play in it.
    await h.send(chat, "Anyway, I should go.", "Dev waves.");
    const next = await h.service.basisFor(chat, userId);
    if (!next) throw new Error("no basis");
    expect((await h.service.landLayer(chat, userId, { id: "scene", basis: next, kind: "story.beat", events: [talkEvent({ with: "dev", state: "off", by: "author", scene: "s1" })] })).status).toBe("landed");
    const model = port({ character: [{ memories: [{ lived: ["pier"], about: ["sam"], text: MEMORY }] }] });
    expect((await afterDepthReply(rt, chat, userId, next, { scene: "s2", ended: false, remember: [], poll: false, beats: [] }, { model })).remembered).toEqual(["dev"]);

    // A talk still on: past the cap, its partner remembers what it holds and the talk goes on.
    const capped = await h.newChat();
    await h.send(capped, "Tell me everything, Dev.", "Where to start.");
    const at = await h.service.basisFor(capped, userId);
    if (!at) throw new Error("no basis");
    const takes = Array.from({ length: TAKES_KEPT }, (_, i) => mindTakeEvent({ who: "dev", at: 600 + i, lived: ["pier"], take: TAKE }).event);
    expect((await h.service.landLayer(capped, userId, { id: "talk", basis: at, kind: "story.beat", events: [talkEvent({ with: "dev", state: "on", by: "author", scene: "s1" }), beatEvent(beat("pier", 600, PIER_WHAT, PIER, false, "s1"))] })).status).toBe("landed");
    for (let i = 0; i < TAKES_KEPT; i += 100) expect((await h.service.landLayer(capped, userId, { id: `takes${i}`, basis: at, kind: "minds.v2.take", events: takes.slice(i, i + 100) })).status).toBe("landed");
    const long = port({ character: [{ memories: [{ lived: ["pier"], about: ["sam"], text: MEMORY }] }] });
    expect((await afterDepthReply(rt, capped, userId, at, { scene: "s1", ended: false, remember: [], poll: false, beats: [] }, { model: long })).remembered).toEqual(["dev"]);
  });

  test("with the background lanes off only remembering and the truth link run, said in one line; the next poll reads every beat since the last one that ran", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const settings = await rt.settings.get(userId);
    const chat = await h.newChat();
    await h.send(chat, "The pier floods at eight, Dev.");
    const first = await h.service.basisFor(chat, userId);
    if (!first) throw new Error("no basis");
    expect((await h.service.landLayer(chat, userId, { id: "turn1", basis: first, kind: "story.beat", events: [beatEvent(beat("pier", 600, PIER_WHAT, PIER, false))] })).status).toBe("landed");
    settings.depth.background.on = false;
    const off = port({});
    const held = await afterDepthReply(rt, chat, userId, first, { scene: null, ended: false, remember: [], poll: true, beats: ["pier"] }, { model: off });
    expect([held.put, held.jobs, off.sent.author, off.sent.gm?.length]).toEqual([[BACKGROUND_OFF], null, undefined, 1]);

    settings.depth.background.on = true;
    await h.send(chat, "Look, a boat.");
    const second = await h.service.basisFor(chat, userId);
    if (!second) throw new Error("no basis");
    expect((await h.service.landLayer(chat, userId, { id: "turn2", basis: second, kind: "story.beat", events: [beatEvent(beat("boat", 640, BOAT, BOAT, false))] })).status).toBe("landed");
    const on = port({ author: [{ considered: [] }] });
    await afterDepthReply(rt, chat, userId, second, { scene: null, ended: false, remember: [], poll: true, beats: ["boat"] }, { model: on });
    expect(on.sent.author?.[0]).toContain(PIER_WHAT);
    expect(on.sent.author?.[0]).toContain(BOAT);
  });

  test("GM → Minds' Reflect and Catch up are linked once what they wrote of the beliefs lands, as the poll's jobs are (conformance finding 6)", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "How have you been, Dev?", "Fine.");
    const links = { facts: [{ ref: "f1", claim: "The pier floods at eight.", matters: "Dev closes early because of it.", about: ["dev"] }], links: [{ who: "dev", fact: "f1", from: { mind: "minds/dev/beliefs.md" }, belief: "true", confidence: 0.9, words: "I'd swear to it", why: "Dev wrote it in his beliefs." }] };
    const asked: string[] = [];
    // Dev's reflection rewrites his beliefs; the GM, asked with them, links them.
    h.host.quietReply = (req) => {
      const text = req.messages.map((m) => m.content).join("\n");
      asked.push(text);
      return JSON.stringify(text.includes(BELIEFS) ? links : { beliefs: BELIEFS, self: SELF });
    };
    const reflect = { lre: PROTOCOL_VERSION, reqId: "r1", type: "lre.depth", op: "reflect", chatId: chat, who: "dev" } as const;
    expect(await depthRequest(rt as unknown as Runtime, {} as DepthHost, reflect, userId)).toEqual({});
    expect(asked.filter((t) => t.includes(BELIEFS))).toHaveLength(1);
    const basis = await h.service.basisFor(chat, userId);
    const at = basis ? await h.service.foldAtBasis(chat, userId, basis) : null;
    expect(Object.values(at ? readKnowledge(at.state).facts : {}).map((f) => f.claim)).toEqual(["The pier floods at eight."]);
    // A press that wrote no belief gives the GM nothing new: no link is asked.
    h.host.quietReply = (req) => (asked.push(req.messages.map((m) => m.content).join("\n")), JSON.stringify({ self: "I keep to myself." }));
    const before = asked.length;
    await depthRequest(rt as unknown as Runtime, {} as DepthHost, reflect, userId);
    expect(asked.length - before).toBe(1);
  });

  test("the poll is told what a correction put out of a mind, so it can ask for the reflection that rewrites it", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    const greeting = await h.service.basisFor(chat, userId);
    if (!greeting) throw new Error("no greeting");
    // Dev lived the warning and wrote his beliefs from it.
    const beliefs = mindFileWrite({ who: "dev", path: mindPath("dev", "beliefs"), at: 600, mode: "catch-up", lived: ["pier"], about: [] }, BELIEFS);
    await rt.blobs.put(userId, BELIEFS);
    // He holds 300 takes unremembered, near the count that calls his remembering.
    const takes = Array.from({ length: 300 }, (_, i) => mindTakeEvent({ who: "dev", at: 600, lived: ["pier"], take: `Take ${i}.` }).event);
    expect((await h.service.landLayer(chat, userId, { id: "lived", basis: greeting, kind: "story.beat", events: [beatEvent(beat("pier", 600, PIER_WHAT, PIER, false)), mindLivedEvent({ who: "dev", beats: ["pier"], at: 600, mode: "catch-up" }), ...beliefs.events, ...takes] })).status).toBe("landed");
    await h.send(chat, "No, Sam said nine.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    // An edit corrected the warning: its new beat stands in for the old one.
    expect((await h.service.landLayer(chat, userId, { id: "edit", basis, kind: "story.beat", events: [beatEvent({ ...beat("pier9", 600, "Sam warns Dev that the pier floods at nine.", "Sam says the pier floods at nine.", true), supersedes: ["pier"] })] })).status).toBe("landed");
    const model = port({ author: [{}] });
    await afterDepthReply(rt, chat, userId, basis, { scene: null, ended: false, remember: [], poll: true, beats: ["pier9"] }, { model });
    expect(model.sent.author?.[0]).toContain("out of mind since a correction struck what they were written from: beliefs.md (a reflection rewrites them)");
    // A mind near that count asks for a reflection: the poll hears it.
    expect(model.sent.author?.[0]).toContain("their working memory is nearly full (300 takes unremembered): they ask to reflect");
  });

  test("someone the story reached who has no mind yet is listed to the poll, which may catch them up (H3)", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "I shout down the well.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    // The shout reaches the rat from afar, who has no mind.
    const shout: Beat = { ...beat("shout", 600, PIER_WHAT, PIER, true), exposure: [{ who: "rat", channel: "hearing", reach: "partial", pending: true as const, pov: blobHash(PIER) }] };
    expect((await h.service.landLayer(chat, userId, { id: "turn", basis, kind: "story.beat", events: [beatEvent(shout)] })).status).toBe("landed");
    const model = port({ author: [{}] });
    await afterDepthReply(rt, chat, userId, basis, { scene: null, ended: false, remember: [], poll: true, beats: ["shout"] }, { model });
    expect(model.sent.author?.[0]).toContain("Rat [rat]: 1 point of view waiting (no mind yet: a catch-up forms one, from their card or what the world knows of them, then lives these)");
  });
});

describe("the clock the player moves on outside a turn", () => {
  test("on a chat on depth, wakes the author's poll at the chat's head, the fix its occasion, which counts the time it moved on once with how it passed; a clock set back or a chat off depth wakes none", async () => {
    const rig = new Rig({ shipped: true });
    await readyLoopback(rig);
    const asked: string[] = [];
    rig.host.quietReply = (req) => {
      const text = req.messages.map((m) => m.content).join("\n");
      asked.push(text);
      return text.includes("Your open predictions:") ? JSON.stringify({ considered: [{ what: "The afternoon off screen", raised: false, why: "nothing presses yet" }] }) : "{}";
    };
    const polls = (): string[] => asked.filter((t) => t.includes("Your open predictions:"));
    const time = async (chatId: string): Promise<string> => {
      const fix = (await rig.rt.view(chatId, rig.host.userId)).hud?.fixes.time;
      if (fix?.type !== "time" || typeof fix.value !== "string") throw new Error("no clock");
      return fix.value;
    };
    // A time of day, in minutes, and that time some hours on (the same day: these stay in the morning).
    const minutesOf = (stamp: string): number => {
      const [h = 0, m = 0] = (stamp.split(" ")[1] ?? "").split(":").map(Number);
      return h * 60 + m;
    };
    const hoursOn = (stamp: string, hours: number): string => {
      const at = minutesOf(stamp) + hours * 60;
      return `${stamp.split(" ")[0]} ${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
    };
    const polled = async (chatId: string): Promise<unknown[]> => (await rig.rt.ledger.readEvents(chatId, rig.host.userId, [AUTHOR_POLL])).map((e) => ({ from: e.from, through: authorData<PollData>(e.event, AUTHOR_POLL)?.through }));
    const seqOf = (fixed: Record<string, unknown>): string => (typeof fixed.undo === "string" ? (fixed.undo.split(":").at(-1) ?? "") : "");
    const worldChat = async (): Promise<string> => {
      const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
      rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
      const chatId = rig.host.createChat("Morning.");
      rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
      return chatId;
    };

    // Off depth: the clock moves on, and nothing asks the author anything.
    const off = await worldChat();
    await rig.turn(off, "I look around.", "The room is quiet.");
    rig.body(await rig.send({ type: "lre.fix", chatId: off, time: hoursOn(await time(off), 1) }));
    await rig.rt.depthSettled();
    expect(polls()).toEqual([]);

    const chatId = await worldChat();
    const start = await time(chatId);
    rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on: true }));
    await rig.turn(chatId, "I look around.", "The room is quiet.");
    const from = await time(chatId);
    const first = rig.body(await rig.send({ type: "lre.fix", chatId, time: hoursOn(from, 2) }));
    await rig.rt.depthSettled();
    expect(await time(chatId)).toBe(hoursOn(from, 2));
    // The poll runs once at the chat's head, its record named by the fix (`clock:<seq>`). No poll had looked yet: it reads all the time since the chat began, the two hours among it counted once, and how they passed.
    const basis = await headBasis(rig.rt, chatId, rig.host.userId);
    if (!basis) throw new Error("no head");
    const head = rig.host.head(chatId)?.id;
    expect(polls()).toHaveLength(1);
    expect(polls()[0]).toContain(`since you last looked, ${minutesOf(hoursOn(from, 2)) - minutesOf(start)} story minutes passed, by the player moved the clock on, from `);
    expect(await polled(chatId)).toEqual([{ from: { layer: layerEntryId(AUTHOR_POLL, chatId, basis.message, basis.swipe, `clock:${seqOf(first)}`), messageId: head }, through: basis.message }]);

    // Moved on again at the same message: the poll there already read through it, so this hour is what passed since.
    const second = rig.body(await rig.send({ type: "lre.fix", chatId, time: hoursOn(from, 3) }));
    await rig.rt.depthSettled();
    expect(polls()).toHaveLength(2);
    expect(polls()[1]).toContain("since you last looked, 60 story minutes passed, by the player moved the clock on, from ");
    expect((await polled(chatId))[1]).toEqual({ from: { layer: layerEntryId(AUTHOR_POLL, chatId, basis.message, basis.swipe, `clock:${seqOf(second)}`), messageId: head }, through: basis.message });

    // Set back, no time passed: no poll.
    rig.body(await rig.send({ type: "lre.fix", chatId, time: from }));
    await rig.rt.depthSettled();
    expect(polls()).toHaveLength(2);
  }, 30_000);
});
