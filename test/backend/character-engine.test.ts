// The Character Engine through the ledger (DEPTH-PLAN §4.4, §4.9): a catch-up's mind writes land as
// a basis-anchored layer entry, fold in every fold, and survive a swipe of a later reply; an entry
// anchored at the swiped reply goes inert and comes back with it; what a character recalls is only
// what it lived; and a chat switched to another player character (D-10) before Play as was turned
// off hands the old one his agent back. What the player does while a reply is written anchors at the
// last message kept, before that reply, and lands as the reply is kept; a switch of player character
// there lands only where the reply still folds with it.

import { describe, expect, test } from "bun:test";
import { catchUpNow, headBasis, interviewMind, mindEdit, mindView, mindsView, type EngineRt } from "../../src/backend/character-engine";
import type { ModelPort } from "../../src/backend/depth/port";
import { defaultSettings } from "../../src/backend/settings-store";
import { MIND_INTERVIEW, MIND_POV, MIND_WRITE, exposedBeats, livedCorpus, mindFileWrite, mindFilesAt, mindMetaAt, mindPath, mindPovEvent, mindTakeEvent, mindV2At, povOf, recallSearch } from "../../src/shared/character-engine";
import type { ChatId, EntityId, UserId } from "../../src/shared/ids";
import { beatEvent, type Beat } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import storyPack from "../../src/packs/story/core/index";
import type { TurnModel } from "../../src/engine/ledger/journal";
import { Harness } from "../support/harness";

const POV_DOOR = "Through the door, two voices, too muffled to make out.";
const TEXT = {
  pier: "Sam says the pier floods at eight.",
  pierWhat: "Sam warns Dev that the pier floods at eight.",
  pierWords: "\"It floods at eight.\"",
  door: "Raised voices behind the kitchen door.",
  doorWhat: "Mira tells the cook to burn the letter.",
  doorWords: "\"Burn it before he reads it.\"",
  letter: "Mira slips a letter into her coat.",
  letterWhat: "Mira hides the letter from Dev.",
  boat: "A boat noses into the harbour.",
  boatWhat: "Dale brings his boat in early.",
};

function beat(id: string, at: number, surface: string, what: string, exposure: Beat["exposure"], quotes?: string): Beat {
  return { id, at, order: 1, place: "home", actors: [], act: "did", about: [], what: blobHash(what), surface: blobHash(surface), ...(quotes ? { quotes: blobHash(quotes) } : {}), exposure, by: { entry: "test" } };
}

/** A switch of player character as Play as landed it before it was turned off (D-10): `minds.v2.pov` at the head; one made while a reply is written waits for it. */
async function switchTo(rt: EngineRt, chat: ChatId, userId: UserId, who: EntityId): Promise<void> {
  const basis = await headBasis(rt, chat, userId);
  if (!basis) throw new Error("no basis");
  await rt.ledger.landLayer(chat, userId, { id: `pov:${who}:${basis.message}:${basis.swipe}`, basis, kind: MIND_POV, events: [mindPovEvent(who)], by: { role: "user" } });
}

/** A runtime over the harness: its ledger, a blob store in memory, the shipped settings. */
function rtOf(h: Harness): EngineRt & { stored: Map<string, string> } {
  const stored = new Map<string, string>(Object.values(TEXT).concat(POV_DOOR).map((t) => [blobHash(t), t]));
  return {
    stored,
    host: h.host,
    registry: h.registry,
    blobs: {
      get: async (_u, hash) => stored.get(hash) ?? null,
      put: async (_u, text) => {
        stored.set(blobHash(text), text);
        return blobHash(text);
      },
    },
    settings: { get: async () => defaultSettings() },
    ledger: h.service,
  };
}

/** A port answering each call with the next answer, keeping what it was sent. */
function port(...answers: unknown[]): ModelPort & { sent: string[] } {
  const sent: string[] = [];
  const fn = (async (_role, messages) => {
    sent.push(messages.map((m) => m.content).join("\n"));
    return { text: JSON.stringify(answers.shift() ?? {}), usage: { tokensIn: 1, tokensOut: 1 } };
  }) as ModelPort & { sent: string[] };
  fn.sent = sent;
  return fn;
}

/** Dev's mind files at the head, after checking every fold agrees on them. */
async function devMind(h: Harness, chat: ChatId, who: EntityId = "dev"): Promise<Record<string, string>> {
  const { reference, optimized, cold } = await h.folds(chat);
  expect(mindFilesAt(reference.state, who)).toEqual(mindFilesAt(optimized.state, who));
  expect(mindFilesAt(cold.state, who)).toEqual(mindFilesAt(optimized.state, who));
  expect(reference.violations).toEqual([]);
  return mindFilesAt(optimized.state, who);
}

describe("the Character Engine through the ledger", () => {
  test("a catch-up's writes land at their basis, fold everywhere and survive a swipe of a later reply; recall holds only what was lived", async () => {
    const h = new Harness("fresh", { packs: [storyPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "hello");
    const first = h.host.head(chat);
    if (!first) throw new Error("no reply");
    const b1 = await h.service.basisFor(chat, userId, first.id);
    if (!b1) throw new Error("no basis");
    // The bootstrap's beats, anchored at the first reply: Dev heard the pier whole, the door in part; the letter reached only Sam.
    const beats = [
      beat("pier", 600, TEXT.pier, TEXT.pierWhat, [{ who: "dev", channel: "hearing", reach: "whole" }], TEXT.pierWords),
      beat("door", 610, TEXT.door, TEXT.doorWhat, [{ who: "dev", channel: "hearing", reach: "partial", pov: blobHash(POV_DOOR) }], TEXT.doorWords),
      beat("letter", 615, TEXT.letter, TEXT.letterWhat, [{ who: "sam", channel: "sight", reach: "whole" }]),
    ];
    expect((await h.service.landLayer(chat, userId, { id: "beats", basis: b1, kind: "story.beat", events: beats.map(beatEvent) })).status).toBe("landed");

    const model = port({ memories: [{ lived: ["pier", "letter"], about: ["sam"], text: "Sam warned me about the pier. Eight o'clock." }], beliefs: "- The pier floods at eight. I'd swear to it." });
    const caught = await catchUpNow(rt, chat, userId, "dev", { model, basis: b1 });
    expect(caught.lived).toBe(2);
    // The agent was given what reached it only: the pier whole with its words, the door as its own point of view.
    const sent = model.sent.join("\n");
    expect(sent).toContain(TEXT.pier);
    expect(sent).toContain(TEXT.pierWords);
    expect(sent).toContain(POV_DOOR);
    for (const never of [TEXT.pierWhat, TEXT.door, TEXT.doorWhat, TEXT.doorWords, TEXT.letter, TEXT.letterWhat]) expect(sent).not.toContain(never);

    await h.send(chat, "again");
    const head = h.host.head(chat);
    const b2 = await h.service.basisFor(chat, userId);
    if (!head || !b2) throw new Error("no head");
    const now = mindFileWrite({ who: "dev", path: mindPath("dev", "now"), at: 700, mode: "catch-up", lived: [], about: [] }, "Watching the door.");
    expect((await h.service.landLayer(chat, userId, { id: "now", basis: b2, kind: MIND_WRITE, events: now.events })).status).toBe("landed");
    expect(Object.keys(await devMind(h, chat)).sort()).toEqual(["beliefs.md", "memories/000000600-1.md", "now.md"]);

    // A swipe of the later reply: what was anchored at the first stays; the head's own write goes inert.
    await h.host.finish(await h.host.start(chat, { type: "swipe", messageId: head.id }), "Okay, again.");
    expect(Object.keys(await devMind(h, chat)).sort()).toEqual(["beliefs.md", "memories/000000600-1.md"]);
    h.host.navigate(chat, head.id, 0);
    await h.host.settle();
    expect(Object.keys(await devMind(h, chat)).sort()).toEqual(["beliefs.md", "memories/000000600-1.md", "now.md"]);

    // Landing the same job again lands nothing twice.
    const again = await catchUpNow(rt, chat, userId, "dev", { model: port(), basis: b1 });
    expect(again.lived).toBe(0);

    const at = await h.service.foldAtBasis(chat, userId, b2);
    if (!at) throw new Error("off chain");
    // The memory cites only the beats Dev lived.
    expect(mindMetaAt(at.state, "dev")["memories/000000600-1.md"]?.lived).toEqual(["pier"]);
    const { beats: live } = exposedBeats(at.story);
    const corpus = livedCorpus({ who: "dev", mind: mindV2At(at.state, "dev"), beats: live, texts: Object.fromEntries(rt.stored) });
    for (const cue of ["the letter in her coat", "burn it before he reads it", "who hid the letter from Dev?"]) {
      for (const hit of recallSearch(corpus, cue)) for (const never of ["letter", "Burn it", "burn the letter"]) expect(hit.doc.text).not.toContain(never);
    }
    expect(recallSearch(corpus, "when does the pier flood?").map((hit) => hit.doc.id)).toContain("beat:pier");

    // The views read it whole: nothing hidden.
    const list = await mindsView(rt, chat, userId);
    expect(list.pov?.id).toBe("sam");
    expect(list.characters.find((c) => c.id === "dev")?.pending).toBe(0);
    const view = await mindView(rt, chat, userId, "dev");
    expect(view.files.map((f) => f.path)).toEqual(["now.md", "beliefs.md", "memories/000000600-1.md"]);
    expect(view.writes[0]?.path).toBe("now.md");
    expect(view.povs.map((p) => [p.beat.id, p.reach, p.pending])).toEqual([
      ["door", "part", false],
      ["pier", "whole", false],
    ]);
  });

  test("a catch-up redone after a swipe of the reply it landed at lands afresh there, and what it lived counts only as it lands", async () => {
    const h = new Harness("fresh", { packs: [storyPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "hello");
    const first = h.host.head(chat);
    const b1 = first ? await h.service.basisFor(chat, userId, first.id) : null;
    if (!b1) throw new Error("no basis");
    const beats = [
      beat("pier", 600, TEXT.pier, TEXT.pierWhat, [{ who: "dev", channel: "hearing", reach: "whole" }], TEXT.pierWords),
      beat("door", 610, TEXT.door, TEXT.doorWhat, [{ who: "dev", channel: "hearing", reach: "partial", pov: blobHash(POV_DOOR) }], TEXT.doorWords),
    ];
    expect((await h.service.landLayer(chat, userId, { id: "beats", basis: b1, kind: "story.beat", events: beats.map(beatEvent) })).status).toBe("landed");
    await h.send(chat, "again");
    const head = h.host.head(chat);
    if (!head) throw new Error("no head");
    const answer = () => port({ memories: [{ lived: ["pier"], about: ["sam"], text: "Sam warned me about the pier. Eight o'clock." }] });
    // Caught up at the head reply: Dev lives both beats there.
    const caught = await catchUpNow(rt, chat, userId, "dev", { model: answer() });
    expect(caught.lived).toBe(2);
    expect(Object.keys(await devMind(h, chat))).toEqual(["memories/000000600-1.md"]);

    // The head reply is swiped: what Dev lived there went with it, so both beats wait again, and the
    // same batch caught up again lands afresh on the new swipe rather than meeting the old one's entry.
    await h.host.finish(await h.host.start(chat, { type: "swipe", messageId: head.id }), "Okay, again.");
    expect(await devMind(h, chat)).toEqual({});
    const again = await catchUpNow(rt, chat, userId, "dev", { model: answer() });
    expect(again.entries.map((e) => e.status === "landed" && e.existing === true)).toEqual([false]);
    expect(again.lived).toBe(2);
    expect(Object.keys(await devMind(h, chat))).toEqual(["memories/000000600-1.md"]);
    // Each swipe keeps its own: back on the first, the first catch-up folds there.
    h.host.navigate(chat, head.id, 0);
    await h.host.settle();
    expect(Object.keys(await devMind(h, chat))).toEqual(["memories/000000600-1.md"]);
    const swipes = (await h.service.layerSummaries(chat, userId)).filter((s) => s.kind === MIND_WRITE).map((s) => `${s.basis.message} ${s.basis.swipe}`);
    expect(swipes.length).toBe(2);
    expect(new Set(swipes).size).toBe(2);

    // One made while a reply is written is held for it: it lived nothing yet, and lands once the reply is kept.
    const b2 = await h.service.basisFor(chat, userId, head.id);
    if (!b2) throw new Error("no basis");
    expect((await h.service.landLayer(chat, userId, { id: "boat", basis: b2, kind: "story.beat", events: [beatEvent(beat("boat", 620, TEXT.boat, TEXT.boatWhat, [{ who: "dev", channel: "sight", reach: "whole" }]))] })).status).toBe("landed");
    h.host.sendUser(chat, "And the boat?");
    await h.host.settle();
    const g = await h.host.start(chat, { type: "normal" });
    const held = await catchUpNow(rt, chat, userId, "dev", { basis: b2, model: port({ memories: [{ lived: ["boat"], text: "Dale's boat came in early." }] }) });
    expect(held.entries.map((e) => e.status)).toEqual(["held"]);
    expect(held.lived).toBe(0);
    await h.host.finish(g, "The boat docks.");
    await h.host.settle();
    expect(Object.keys(await devMind(h, chat)).sort()).toEqual(["memories/000000600-1.md", "memories/000000620-1.md"]);
  });

  test("a chat switched to another player character (D-10): the new one has no agent, the old one catches up on what reached him", async () => {
    const h = new Harness("fresh", { packs: [storyPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "hello");
    const b1 = await h.service.basisFor(chat, userId);
    if (!b1) throw new Error("no basis");
    await h.service.landLayer(chat, userId, { id: "beats", basis: b1, kind: "story.beat", events: [beatEvent(beat("letter", 615, TEXT.letter, TEXT.letterWhat, [{ who: "sam", channel: "sight", reach: "whole" }]))] });
    await expect(catchUpNow(rt, chat, userId, "sam", { model: port() })).rejects.toThrow("player character");

    await switchTo(rt, chat, userId, "dev");
    const head = await h.service.basisFor(chat, userId);
    const at = head ? await h.service.foldAtBasis(chat, userId, head) : null;
    expect(at ? povOf(at.world, at.state) : null).toBe("dev");
    await expect(interviewMind(rt, chat, userId, "dev", "How are you?", false, port({ answer: "Fine." }))).rejects.toThrow("player character");

    const caught = await catchUpNow(rt, chat, userId, "sam", { model: port({ memories: [{ lived: ["letter"], text: "I saw Mira hide a letter." }] }) });
    expect(caught.lived).toBe(1);
    expect(Object.keys(await devMind(h, chat, "sam"))).toEqual(["memories/000000615-1.md"]);
    const probe = await interviewMind(rt, chat, userId, "sam", "What did you see?", false, port({ answer: "A letter. Mira's.", self: "I notice things." }));
    expect(probe).toEqual({ answer: "A letter. Mira's.", folded: false });
    expect(Object.keys(await devMind(h, chat, "sam"))).toEqual(["memories/000000615-1.md"]);
  });
});

describe("what the player does while a reply is written", () => {
  test("anchors at the last message kept, before the reply, and lands as the reply is kept", async () => {
    const h = new Harness("fresh", { packs: [storyPack] });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "hello");
    const first = h.host.head(chat);
    const b1 = first ? await h.service.basisFor(chat, userId, first.id) : null;
    if (!b1) throw new Error("no basis");
    expect((await h.service.landLayer(chat, userId, { id: "beats", basis: b1, kind: "story.beat", events: [beatEvent(beat("pier", 600, TEXT.pier, TEXT.pierWhat, [{ who: "dev", channel: "hearing", reach: "whole" }], TEXT.pierWords))] })).status).toBe("landed");

    const said = h.host.sendUser(chat, "Watch the door, Dev.");
    await h.host.settle();
    const g = await h.host.start(chat, { type: "normal" });
    // The player's own edit, Catch up now and an interview, while the reply is written: each waits for it.
    expect(await mindEdit(rt, chat, userId, "dev", "beliefs.md", "- Someone is listening at the door.")).toEqual({ undo: null, pending: true });
    const caught = await catchUpNow(rt, chat, userId, "dev", { model: port({ memories: [{ lived: ["pier"], about: ["sam"], text: "Sam warned me about the pier." }] }) });
    expect(caught.entries.map((e) => e.status)).toEqual(["held"]);
    expect(caught.lived).toBe(0);
    expect(await interviewMind(rt, chat, userId, "dev", "What do you see?", false, port({ answer: "The door, and whoever is behind it." }))).toEqual({ answer: "The door, and whoever is behind it.", folded: false });
    await h.host.finish(g, "Dev nods at the door.");
    await h.host.settle();

    // Each landed with the reply, at the player's message before it.
    expect(Object.keys(await devMind(h, chat)).sort()).toEqual(["beliefs.md", "memories/000000600-1.md"]);
    expect((await h.service.layerSummaries(chat, userId)).filter((s) => s.kind === MIND_WRITE || s.kind === MIND_INTERVIEW).map((s) => [s.kind, s.basis.message])).toEqual([
      [MIND_WRITE, said],
      [MIND_WRITE, said],
      [MIND_INTERVIEW, said],
    ]);
    expect(h.host.toasts).toEqual([]);
  });

  test("a switch of player character lands before the reply only where the reply still folds with it: one that would unmake his play in it is refused, and the player told", async () => {
    // A turn whose player addresses Dev plays Dev's agent: his take of the moment rides in its record.
    const model: TurnModel = {
      plan: ({ state, userTexts }) => (userTexts.at(-1)?.startsWith("Dev") ? [mindTakeEvent({ who: "dev", at: state.clock, lived: [], take: "He keeps his eyes on the door." }).event] : []),
      read: () => [],
    };
    const h = new Harness("fresh", { packs: [storyPack], model });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "hello");
    const povNow = async (): Promise<EntityId | null> => {
      const b = await h.service.basisFor(chat, userId);
      const at = b ? await h.service.foldAtBasis(chat, userId, b) : null;
      return at ? povOf(at.world, at.state) : null;
    };
    const during = async (text: string, act: () => Promise<void>): Promise<void> => {
      h.host.sendUser(chat, text);
      await h.host.settle();
      const g = await h.host.start(chat, { type: "normal" });
      await act();
      await h.host.finish(g, "The door stays shut.");
      await h.host.settle();
    };

    // Dev plays in the reply being written: switching to him before it would unmake his play there,
    // so the switch is refused as the reply is kept, and the player reads why.
    await during("Dev, the door.", () => switchTo(rt, chat, userId, "dev"));
    expect(await povNow()).toBe("sam");
    expect(await devMind(h, chat)).toEqual({});
    expect((await h.service.layerSummaries(chat, userId)).map((s) => s.kind)).toEqual([]);
    expect(h.host.toasts).toEqual([{ message: expect.stringMatching(/^Your change made while the reply was written wasn't kept: a later turn no longer folds with it \(.*player character has no agent/), userId }]);

    // A reply he plays no part in: the switch made while it is written lands with it.
    await during("Quiet morning.", () => switchTo(rt, chat, userId, "dev"));
    expect(await povNow()).toBe("dev");
    expect(await devMind(h, chat)).toEqual({});
    expect(h.host.toasts).toHaveLength(1);
  });
});
