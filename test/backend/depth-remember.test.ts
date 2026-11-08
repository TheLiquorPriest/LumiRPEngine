// Remembering right after the reply (DEPTH-PLAN §2.4, §4.4 Remember) through the ledger: each
// character who played writes what it keeps of the scene as one entry at the reply's basis, from the
// scene as it lived it and its own takes; the remember takes up its working memory, the plans it
// writes with a time reach the planner, a second run lands nothing, a scene kept open isn't
// remembered, and a swipe of a later reply leaves it standing.

import { describe, expect, test } from "bun:test";
import type { EngineRt } from "../../src/backend/character-engine";
import type { ModelPort } from "../../src/backend/depth/port";
import { rememberAfterReply } from "../../src/backend/depth/scene/remember";
import { defaultSettings } from "../../src/backend/settings-store";
import { mindFilesAt, mindLivedEvent, mindTakeEvent, takesOf } from "../../src/shared/character-engine";
import type { ChatId } from "../../src/shared/ids";
import { beatEvent, type Beat } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import storyPack from "../../src/packs/story/core/index";
import { readCharacter } from "../../src/packs/minds/core/state";
import { Harness } from "../support/harness";

const PIER = "Sam says the pier floods at eight.";
const PIER_WHAT = "Sam warns Dev that the pier floods at eight.";
const TAKE = "Sam looked worried. I should close early.";

function rtOf(h: Harness): EngineRt {
  const stored = new Map<string, string>([PIER, PIER_WHAT, TAKE].map((t) => [blobHash(t), t]));
  return {
    host: h.host,
    registry: h.registry,
    blobs: { get: async (_u, hash) => stored.get(hash) ?? null, put: async (_u, text) => (stored.set(blobHash(text), text), blobHash(text)) },
    settings: { get: async () => defaultSettings() },
    ledger: h.service,
  };
}

function port(...answers: unknown[]): ModelPort & { sent: string[] } {
  const sent: string[] = [];
  const fn = (async (_role, messages) => {
    sent.push(messages.map((m) => m.content).join("\n"));
    return { text: JSON.stringify(answers.shift() ?? {}), usage: { tokensIn: 1, tokensOut: 1 } };
  }) as ModelPort & { sent: string[] };
  fn.sent = sent;
  return fn;
}

async function devAt(h: Harness, chat: ChatId) {
  const basis = await h.service.basisFor(chat, h.host.userId);
  const at = basis ? await h.service.foldAtBasis(chat, h.host.userId, basis) : null;
  if (!at) throw new Error("no fold");
  return at.state;
}

describe("remembering right after the reply", () => {
  test("each character who played remembers the scene once, at the reply, and its takes leave its working memory", async () => {
    const h = new Harness("fresh", { packs: [storyPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "The pier floods at eight, Dev.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    // What the turn's record holds of the scene, as a turn would leave it: the beat, and Dev's play of it.
    const pier: Beat = { id: "pier", at: 600, order: 1, place: "home", actors: ["sam"], act: "said", about: [], what: blobHash(PIER_WHAT), surface: blobHash(PIER), exposure: [{ who: "dev", channel: "hearing", reach: "whole" }], by: { turn: "t1", decided: "player" } };
    const take = mindTakeEvent({ who: "dev", at: 600, lived: ["pier"], take: TAKE });
    expect((await h.service.landLayer(chat, userId, { id: "scene", basis, kind: "story.beat", events: [beatEvent(pier), mindLivedEvent({ who: "dev", beats: ["pier"], at: 600, mode: "play" }), take.event] })).status).toBe("landed");
    expect(takesOf(await devAt(h, chat), "dev")).toHaveLength(1);

    // A scene kept open (a live talk) isn't remembered.
    expect(await rememberAfterReply(rt, chat, userId, { basis, open: ["dev"], model: port() })).toEqual({ remembered: [], entries: [], failed: [] });

    const model = port({
      memories: [{ lived: ["pier"], about: ["sam"], text: "Sam warned me about the pier. I'll close early." }],
      plans: "- Close the cafe at seven.",
      planned: [{ what: "close the cafe early", kind: "work", when: "2026-10-16 19:00", until: "2026-10-16 19:30" }],
    });
    const done = await rememberAfterReply(rt, chat, userId, { basis, model });
    expect(done.remembered).toEqual(["dev"]);
    expect(done.failed).toEqual([]);
    // It lived the scene as it reached it, with its own take; never the beat's truth.
    expect(model.sent[0]).toContain(PIER);
    expect(model.sent[0]).toContain(TAKE);
    expect(model.sent[0]).not.toContain(PIER_WHAT);
    const state = await devAt(h, chat);
    expect(takesOf(state, "dev")).toEqual([]);
    expect(Object.keys(mindFilesAt(state, "dev")).sort()).toEqual(["memories/000000600-1.md", "plans.md"]);
    // Its plan with a time is the planner's to lay.
    expect(readCharacter(state, "dev").plans.map((p) => [p.what, p.kind, p.source])).toEqual([["close the cafe early", "work", "agent"]]);

    // Once remembered, there is nothing left to remember: a second run lands nothing.
    expect((await rememberAfterReply(rt, chat, userId, { basis, model: port() })).remembered).toEqual([]);
    expect((await rememberAfterReply(rt, chat, userId, { basis, who: ["dev"], model: port() })).entries).toEqual([]);

    // A later reply swiped leaves what was remembered at this one standing.
    await h.send(chat, "See you at eight.");
    const head = h.host.head(chat);
    if (!head) throw new Error("no head");
    await h.host.finish(await h.host.start(chat, { type: "swipe", messageId: head.id }), "Okay, at eight.");
    expect(Object.keys(mindFilesAt(await devAt(h, chat), "dev")).sort()).toEqual(["memories/000000600-1.md", "plans.md"]);
    // The player character has no agent to remember for: named, he is passed over.
    expect(await rememberAfterReply(rt, chat, userId, { who: ["sam"], model: port() })).toEqual({ remembered: [], entries: [], failed: [] });
  });
});
