// The author's interviews from its poll (§4.4, Interview): a question the poll asks runs as a job
// after the reflections, its answer kept as a probe by the author, and read by the next poll. A
// character's own ask to reflect reaches the poll. The catch-up's files cite the beats each draws
// on. The author's drift checks read in the Notebook view.

import { describe, expect, test } from "bun:test";
import { catchUp } from "../../src/backend/character-agent";
import { notebookView } from "../../src/backend/depth/notebook";
import type { ModelPort } from "../../src/backend/depth/port";
import { afterDepthReply, type AfterRt } from "../../src/backend/depth/scene/after";
import { linkTruths } from "../../src/backend/depth/truth-link";
import { defaultSettings } from "../../src/backend/settings-store";
import { MIND_WRITE, mindAskEvent, mindFileWrite, mindPath, mindLivedEvent, mindTakeEvent, mindWriteEvent, probesOf } from "../../src/shared/character-engine";
import type { DepthRole } from "../../src/shared/depth-settings";
import { sceneEvent } from "../../src/shared/scene";
import { beatEvent, type Beat } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import authorPack from "../../src/packs/author/core/index";
import storyPack from "../../src/packs/story/core/index";
import { Harness } from "../support/harness";

const PIER = "Sam says the pier floods at eight.";
const TAKE = "Sam looked worried. I should close early.";
const QUESTION = "What will you do when the water comes?";
const ANSWER = "Close the cafe early and carry the chairs upstairs.";
const ASK = "I keep lying to Sam and I don't know who that makes me.";

function rtOf(h: Harness): AfterRt {
  const stored = new Map<string, string>([PIER, TAKE].map((t) => [blobHash(t), t]));
  const settings = defaultSettings();
  return {
    host: h.host,
    registry: h.registry,
    blobs: { get: async (_u, hash) => stored.get(hash) ?? null, put: async (_u, text) => (stored.set(blobHash(text), text), blobHash(text)) },
    settings: { get: async () => settings },
    ledger: h.service,
  };
}

/** Each role answers in turn from its own list; every call's text is kept by role. */
function port(answers: Partial<Record<DepthRole, unknown[]>>): ModelPort & { sent: Partial<Record<DepthRole, string[]>> } {
  const sent: Partial<Record<DepthRole, string[]>> = {};
  const fn = (async (role, messages) => {
    (sent[role] ??= []).push(messages.map((m) => m.content).join("\n"));
    return { text: JSON.stringify(answers[role]?.shift() ?? {}), usage: { tokensIn: 1, tokensOut: 1 } };
  }) as ModelPort & { sent: Partial<Record<DepthRole, string[]>> };
  fn.sent = sent;
  return fn;
}

const beat = (id: string, at: number): Beat => ({
  id,
  at,
  order: at,
  scene: "s1",
  place: "home",
  actors: ["sam"],
  act: "said",
  about: [],
  what: blobHash(PIER),
  surface: blobHash(PIER),
  exposure: [{ who: "dev", channel: "hearing", reach: "whole" }],
  by: { turn: "t1", decided: "player" },
});

describe("the author interviews from its poll", () => {
  test("its question runs as a job, kept as the author's probe, and its answer is read by the next poll", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "The pier floods at eight, Dev.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    const take = mindTakeEvent({ who: "dev", at: 600, lived: ["pier"], take: TAKE });
    const scene = sceneEvent({ scene: "s1", place: "home", at: 600, cast: [{ who: "dev", effort: "agent", why: "the warning is his" }], opens: true });
    // Dev's own ask to take stock rides his play.
    expect((await h.service.landLayer(chat, userId, { id: "turn", basis, kind: "story.beat", events: [scene, beatEvent(beat("pier", 600)), mindLivedEvent({ who: "dev", beats: ["pier"], at: 600, mode: "play" }), take.event, mindAskEvent({ who: "dev", at: 600, why: ASK })] })).status).toBe("landed");

    const model = port({
      character: [{ memories: [{ lived: ["pier"], about: ["sam"], text: "Sam warned me about the pier." }] }, { answer: ANSWER }],
      author: [{ interview: [{ who: "dev", question: QUESTION, why: "his plans for the flood" }, { who: "sam", question: "And you?", why: "the player's own" }] }],
    });
    const out = await afterDepthReply(rt, chat, userId, basis, { scene: "s1", ended: false, remember: ["dev"], poll: true, beats: ["pier"] }, { model });
    expect(out.failed).toEqual([]);
    expect(out.jobs).toEqual([{ kind: "interview", who: "dev", question: QUESTION, why: "his plans for the flood" }]);
    // The poll heard Dev ask to reflect, in his words.
    expect(model.sent.author?.[0]).toContain(`they ask to reflect, in their words: ${ASK}`);
    // The interview read his mind and asked the question; its answer is the author's probe.
    expect(model.sent.character?.[1]).toContain(QUESTION);
    const head = await h.service.foldAtBasis(chat, userId, basis);
    if (!head) throw new Error("no fold");
    expect(probesOf(head.state, "dev").map((p) => [p.by, p.neutral])).toEqual([["author", false]]);

    // The next poll reads what Dev answered, once.
    await h.send(chat, "Then let's carry the chairs, Dev.");
    const next = await h.service.basisFor(chat, userId);
    if (!next) throw new Error("no basis");
    const again = port({ author: [{}, {}] });
    await afterDepthReply(rt, chat, userId, next, { scene: "s1", ended: false, remember: [], poll: true, beats: [] }, { model: again });
    const poll = again.sent.author?.[0] ?? "";
    expect(poll).toContain(QUESTION);
    expect(poll).toContain(ANSWER);
  });
});

describe("a catch-up's files cite the beats each draws on", () => {
  test("beliefs, a person and now cite what the answer says; a file it names none for cites the whole batch; a cite outside the batch is dropped", async () => {
    const model: ModelPort = async () => ({
      text: JSON.stringify({
        beliefs: "- The pier floods at eight.",
        people: { "Maya Chen": "She skims the till." },
        now: "Uneasy.",
        on_my_mind: "The pier.",
        cites: { beliefs: ["b1", "b-elsewhere"], "Maya Chen": ["b2"], now: ["b2"] },
      }),
    });
    const out = await catchUp(model, {
      who: "dev",
      name: "Dev",
      at: 620,
      mind: {},
      known: { maya: "Maya Chen" },
      lived: [
        { beat: "b1", at: 600, whole: true, text: "Sam says the pier floods at eight." },
        { beat: "b2", at: 610, whole: true, text: "Maya slips two twenties from the till." },
      ],
    });
    const cited = Object.fromEntries(
      out.events.flatMap((e) => {
        const w = e.type === MIND_WRITE ? mindWriteEvent(e) : null;
        return w ? [[w.path.replace("minds/dev/", ""), w.lived]] : [];
      }),
    );
    expect(cited["beliefs.md"]).toEqual(["b1"]);
    expect(cited["people/maya.md"]).toEqual(["b2"]);
    expect(cited["now.md"]).toEqual(["b2"]);
    expect(cited["on-my-mind.md"]).toEqual(["b1", "b2"]);
  });
});

describe("the author's drift checks in the Notebook view", () => {
  test("each check reads with whose arc, how far and its note, newest first", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "The pier floods at eight, Dev.");
    const basis = await h.service.basisFor(chat, userId);
    if (!basis) throw new Error("no basis");
    const scene = sceneEvent({ scene: "s1", place: "home", at: 600, cast: [{ who: "dev", effort: "agent", why: "the warning is his" }], opens: true, ends: true });
    expect((await h.service.landLayer(chat, userId, { id: "turn", basis, kind: "story.beat", events: [scene, beatEvent(beat("pier", 600))] })).status).toBe("landed");
    const model = port({
      author: [{ author: { depth: "scene", why: "the scene ended" } }, { files: [{ path: "notebook/arcs/dev.md", text: "Dev learns to trust Sam." }], drift: [{ who: "dev", drift: "strong", note: "He trusts no one now." }] }],
    });
    await afterDepthReply(rt, chat, userId, basis, { scene: "s1", ended: true, remember: [], poll: true, beats: ["pier"] }, { model });
    const view = await notebookView({ host: h.host, blobs: rt.blobs, ledger: h.service }, chat, userId);
    expect(view.drift).toEqual([{ at: expect.stringContaining("after message"), who: expect.any(String), drift: "strong", note: "He trusts no one now." }]);
  });
});

describe("the GM interviews from its truth link", () => {
  test("its question is asked of the mind, kept as the GM's probe, and its next link reads the answer", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    const greeting = await h.service.basisFor(chat, userId);
    if (!greeting) throw new Error("no greeting");
    const beliefs = mindFileWrite({ who: "dev", path: mindPath("dev", "beliefs"), at: 600, mode: "catch-up", lived: [], about: [] }, "- The pier floods at eight, I think.");
    for (const text of Object.values(beliefs.blobs)) await rt.blobs.put(userId, text);
    expect((await h.service.landLayer(chat, userId, { id: "mind", basis: greeting, kind: "minds.v2.write", events: beliefs.events })).status).toBe("landed");
    const model = port({ gm: [{ facts: [], links: [], interview: [{ who: "dev", question: "How sure are you of eight?" }, { who: "nobody", question: "Hm?" }] }, {}], character: [{ answer: "Sure as the tide." }] });
    const first = await linkTruths(rt, chat, userId, greeting, { who: ["dev"], beats: [], key: ["one"], model });
    expect(first.refused.some((r) => r.includes("an interview of no one"))).toBe(true);
    expect(model.sent.character?.[0]).toContain("How sure are you of eight?");
    const head = await h.service.foldAtBasis(chat, userId, greeting);
    if (!head) throw new Error("no fold");
    expect(probesOf(head.state, "dev").map((p) => [p.by, p.neutral])).toEqual([["gm", false]]);
    await linkTruths(rt, chat, userId, greeting, { who: ["dev"], beats: [], key: ["two"], model });
    expect(model.sent.gm?.[1]).toContain("What the characters you interviewed answered");
    expect(model.sent.gm?.[1]).toContain("Sure as the tide.");
  });
});
