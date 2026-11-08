// Drafts and settlements per chat and path (DEPTH-PLAN §4.6, §4.9; A3's test, §9.2): a draft is a
// candidate where its basis is on the chain; a settlement makes its beats canon at the draft's own
// minute and its world changes now, and folds where its basis does, so a swipe, a Regenerate or a
// delete of the reply it read reopens the draft and a switch back settles it again; a chain settles a
// draft once and never one it dropped; a settlement lands only while the beats it read from its story
// time on still stand, and anything decided at its basis lands only where every later turn still
// folds as made with it (A1a's warning); an edit, an undo and a Keep move it as they move any entry;
// a branch reads its parent's drafts, and settling or dropping one in either never reaches the other.
// Both folds agree throughout, cold folds included.

import { describe, expect, test } from "bun:test";
import { hashJson, hashParts } from "../../src/shared/hash";
import type { ChatId, MessageId } from "../../src/shared/ids";
import type { Basis, LayerDraft } from "../../src/shared/layer";
import type { LedgerEvent } from "../../src/shared/ledger";
import { beatEvent, beatId, type Beat } from "../../src/shared/story";
import { draftEvent, dropEvent, pinsOf, settleEvent, STORY_DRAFT, STORY_SETTLE, AUTHOR_DROP, type DraftData } from "../../src/shared/episodes";
import type { TurnModel } from "../../src/engine/ledger/journal";
import type { FoldOutput } from "../../src/engine/ledger/chain";
import { objOf, sliceOf } from "../../src/engine/pack-kit";
import storyPack from "../../src/packs/story/core/index";
import authorPack from "../../src/packs/author/core/index";
import { DRAFT_TYPES, draftsOn, type DraftState } from "../../src/backend/depth/offscreen/drafts";
import { Harness } from "../support/harness";
import { POV } from "../support/test-pack";

const blob = (s: string): string => hashParts("test.blob", s);

function beat(id: string, at: number, extra: Partial<Beat> = {}): Beat {
  return { id, at, order: 0, place: "home", actors: [POV], act: "said", about: [], what: blob(`what ${id}`), surface: blob(`surface ${id}`), exposure: [{ who: POV, channel: "hearing", reach: "whole" }], by: { turn: id, decided: "player" }, ...extra };
}

/** Each turn decides one beat, named by its seed; a player who says "settle <draft>" has the turn settle it in the foreground, as a turn that can't proceed without it does. */
const model: TurnModel = {
  plan: ({ seed, state, userTexts }) => {
    const out: LedgerEvent[] = [beatEvent(beat(beatId(seed), state.clock))];
    const asked = /^settle (\S+)$/.exec(userTexts.at(-1) ?? "");
    if (asked?.[1]) out.push(settleEvent({ draft: asked[1], at: state.clock, pins: { digest: "in-turn", count: 0 }, why: "the scene needed it", beats: [] }));
    return out;
  },
  read: () => [],
};

/** A draft: Dale sells the boat at `at`, off screen; it would set a flag of its own. */
function boatDraft(id: string, at: number): DraftData {
  return {
    id,
    episode: { id: `e-${id}`, span: [at, at + 60], places: ["home"], people: ["dale"], why: "Dale needs the money before the bank calls.", parts: [{ subject: { event: "the boat's sale" }, treatment: "written", rationale: "routine business, nothing at stake on screen" }] },
    at,
    inputs: {},
    beats: [beat(`${id}-sale`, at, { actors: ["dale"], act: "did", exposure: [], by: { draft: id } })],
    effects: [{ type: "story.flag", data: { name: `sold-${id}`, value: true } }],
    touches: [{ ref: { thing: "boat" }, from: at }],
    summary: "Dale sells his boat to a buyer from the marina.",
  };
}

function draftEntry(d: DraftData, basis: Basis): LayerDraft {
  return { id: `draft-${d.id}`, basis, kind: STORY_DRAFT, events: [draftEvent(d)] };
}

async function setup(): Promise<{ h: Harness; chat: ChatId; ids: MessageId[] }> {
  const h = new Harness("fresh", { packs: [storyPack, authorPack], model });
  const chat = await h.newChat();
  await h.send(chat, "Hello.", "First reply.");
  await h.send(chat, "Again.", "Second reply.");
  return { h, chat, ids: (await h.chain(chat)).map((m) => m.id) };
}

async function basisOf(h: Harness, chat: ChatId, messageId: MessageId): Promise<Basis> {
  const b = await h.service.basisFor(chat, h.host.userId, messageId);
  if (!b) throw new Error(`no basis for ${messageId}`);
  return b;
}

async function head(h: Harness, chat: ChatId): Promise<Basis> {
  const b = await h.service.basisFor(chat, h.host.userId);
  if (!b) throw new Error("no head");
  return b;
}

async function land(h: Harness, chat: ChatId, d: LayerDraft) {
  const out = await h.service.landLayer(chat, h.host.userId, d);
  await h.host.settle();
  return out;
}

/** A settlement as the settle job makes one: read at `basis`, its pins the live beats from the draft's minute on through it, the draft's beats and changes beside it. */
async function settlement(h: Harness, chat: ChatId, d: DraftData, basis: Basis, id = `settle-${d.id}-${basis.message}-${basis.swipe}`): Promise<LayerDraft> {
  const at = await h.service.foldAtBasis(chat, h.host.userId, basis);
  if (!at) throw new Error("the basis left the chain");
  const pins = pinsOf(at.story, d.at);
  return { id, basis, kind: STORY_SETTLE, events: [settleEvent({ draft: d.id, at: d.at, pins, why: "Nothing seen since says otherwise.", beats: d.beats.map((b) => b.id) }), ...d.beats.map((b) => beatEvent(b)), ...d.effects] };
}

function drop(d: DraftData, basis: Basis, id = `drop-${d.id}-${basis.message}-${basis.swipe}`): LayerDraft {
  return { id, basis, kind: AUTHOR_DROP, events: [dropEvent({ draft: d.id, why: "The player saw the boat at the marina since." })] };
}

/** Both folds (warm and cold) agree, with no violation and no ledger error. */
async function agree(h: Harness, chat: ChatId): Promise<FoldOutput> {
  const { reference, optimized, cold } = await h.folds(chat);
  expect(hashJson(optimized.state)).toBe(hashJson(reference.state));
  expect(hashJson(cold.state)).toBe(hashJson(reference.state));
  expect(optimized.messages).toEqual(reference.messages);
  expect(optimized.layerDrops).toEqual(reference.layerDrops);
  expect(reference.violations).toEqual([]);
  expect(optimized.violations).toEqual([]);
  expect(h.service.errors).toEqual([]);
  return reference;
}

/** Each live draft's state on the chat's chain, the world flags its settlements set, and the draft beats read as canon; the fold's own marks agree with the walk. */
async function onChain(h: Harness, chat: ChatId): Promise<{ states: Record<string, DraftState>; flags: string[]; beats: string[] }> {
  const out = await agree(h, chat);
  const drafts = draftsOn(await h.service.readEvents(chat, h.host.userId, DRAFT_TYPES));
  const states = Object.fromEntries(drafts.map((d) => [d.draft.id, d.state]));
  const settledMarks = Object.keys(objOf(sliceOf(out.state, "story").settled)).sort();
  const droppedMarks = Object.keys(objOf(sliceOf(out.state, "author").dropped)).sort();
  expect(settledMarks).toEqual(drafts.filter((d) => d.state === "settled").map((d) => d.draft.id).sort());
  expect(droppedMarks).toEqual(drafts.filter((d) => d.state === "dropped").map((d) => d.draft.id).sort());
  const story = await h.service.readStory(chat, h.host.userId);
  return {
    states,
    flags: Object.keys(objOf(sliceOf(out.state, "story").flags)).sort(),
    beats: story.beats.filter((b) => "draft" in b.beat.by).map((b) => b.beat.id),
  };
}

async function swipe(h: Harness, chat: ChatId, reply: string, type: "swipe" | "regenerate" = "swipe"): Promise<void> {
  const g = await h.host.start(chat, { type });
  await h.host.finish(g, reply);
  await h.host.settle();
}

describe("drafts and settlements per chat and path", () => {
  test("a settlement makes the draft's beats canon at its own minute and its changes now; a swipe or Regenerate of the reply it read reopens the draft, a switch back settles it again", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const at1 = await basisOf(h, chat, a1);
    const t1 = (await h.service.foldAtBasis(chat, h.host.userId, at1))?.state.clock ?? 0;
    const d = boatDraft("d-boat", t1);
    expect((await land(h, chat, draftEntry(d, at1))).status).toBe("landed");
    // A draft is no canon: its beats aren't read and its changes aren't made.
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "open" }, flags: [], beats: [] });

    const at2 = await basisOf(h, chat, a2);
    expect((await land(h, chat, await settlement(h, chat, d, at2))).status).toBe("landed");
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "settled" }, flags: ["sold-d-boat"], beats: ["d-boat-sale"] });
    // Backdated: the settled beat reads at the draft's minute, though it landed after the second reply.
    const story = await h.service.readStory(chat, h.host.userId);
    expect(story.beats.find((b) => b.beat.id === "d-boat-sale")?.beat.at).toBe(t1);
    expect(story.beats.find((b) => b.beat.id === "d-boat-sale")?.from).toEqual({ layer: `settle-d-boat-${a2}-${at2.swipe}`, messageId: a2 });

    await swipe(h, chat, "Second reply, again.");
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "open" }, flags: [], beats: [] });
    h.host.navigate(chat, a2, 0);
    await h.host.settle();
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "settled" }, flags: ["sold-d-boat"], beats: ["d-boat-sale"] });

    await swipe(h, chat, "Second reply, regenerated.", "regenerate");
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "open" }, flags: [], beats: [] });
    // The draft, anchored at the first reply, is still a candidate here, and settles again at this head.
    expect((await land(h, chat, await settlement(h, chat, d, await head(h, chat)))).status).toBe("landed");
    expect((await onChain(h, chat)).states).toEqual({ "d-boat": "settled" });
  });

  test("a chain settles a draft once and never one it dropped; each path keeps its own verdict", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const d = boatDraft("d-boat", 0);
    await land(h, chat, draftEntry(d, await basisOf(h, chat, a1)));
    const at2 = await basisOf(h, chat, a2);
    expect((await land(h, chat, await settlement(h, chat, d, at2))).status).toBe("landed");
    // Landing the same settlement again changes nothing; a second one is refused, as is a drop.
    expect(await land(h, chat, await settlement(h, chat, d, at2))).toMatchObject({ status: "landed", existing: true });
    expect(await land(h, chat, await settlement(h, chat, d, at2, "settle-twice"))).toMatchObject({ status: "refused", reason: expect.stringContaining("already settled here") });
    expect(await land(h, chat, drop(d, at2))).toMatchObject({ status: "refused", reason: expect.stringContaining("settled here") });

    // On another swipe of the reply the author drops it instead, and a settlement there is refused.
    await swipe(h, chat, "Second reply, again.");
    const other = await head(h, chat);
    expect((await land(h, chat, drop(d, other))).status).toBe("landed");
    expect(await land(h, chat, await settlement(h, chat, d, other, "settle-dropped"))).toMatchObject({ status: "refused", reason: expect.stringContaining("dropped this draft here") });
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "dropped" }, flags: [], beats: [] });
    h.host.navigate(chat, a2, 0);
    await h.host.settle();
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "settled" }, flags: ["sold-d-boat"], beats: ["d-boat-sale"] });
  });

  test("a settlement lands only while the beats it read from its story time on still stand: not before a later turn, not held across a turn's generation, not after an undo of what it read", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const at1 = await basisOf(h, chat, a1);
    const d = boatDraft("d-boat", 0);
    await land(h, chat, draftEntry(d, at1));
    // Read through the first reply only: the second reply's beat is a pin it never read.
    expect(await land(h, chat, await settlement(h, chat, d, at1))).toMatchObject({ status: "refused", reason: expect.stringContaining("moved on past what it read") });

    // Read at the head, but a turn runs before it lands: held, then refused when the window closes.
    const read = await settlement(h, chat, d, await basisOf(h, chat, a2));
    h.host.sendUser(chat, "Onward.");
    await h.host.settle();
    const g = await h.host.start(chat, { type: "normal" });
    expect((await h.service.landLayer(chat, h.host.userId, read)).status).toBe("held");
    await h.host.finish(g, "Third reply.");
    await h.host.settle();
    expect((await h.service.layerSummaries(chat, h.host.userId)).map((s) => s.id)).toEqual(["draft-d-boat"]);
    expect((await onChain(h, chat)).states).toEqual({ "d-boat": "open" });

    // Read at the head, then the GM undoes that reply's beat before it lands: what it read changed.
    const a3 = (await h.chain(chat)).at(-1)?.id ?? "";
    const before = await settlement(h, chat, d, await head(h, chat));
    const swipeId = h.host.message(chat, a3).swipeId;
    expect((await h.write(chat, { kind: "undo", id: "u-beat", messageId: a3, swipeId, refs: [{ in: "events", index: 0 }] })).applied).toBe(true);
    expect(await land(h, chat, before)).toMatchObject({ status: "refused", reason: expect.stringContaining("changed since") });
    // Read again, it lands; the undone beat is no pin of it.
    const again = await settlement(h, chat, d, await head(h, chat), "settle-after-undo");
    expect((await land(h, chat, again)).status).toBe("landed");
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "settled" }, flags: ["sold-d-boat"], beats: ["d-boat-sale"] });
  });

  test("what is decided at its basis lands only where every later turn still folds as made with it: a drop before a turn that settled the draft is refused", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack], model });
    const chat = await h.newChat();
    await h.send(chat, "Hello.", "First reply.");
    const a1 = (await h.chain(chat)).at(-1)?.id ?? "";
    const d = boatDraft("d-boat", 0);
    const other = boatDraft("d-truck", 0);
    await land(h, chat, draftEntry(d, await basisOf(h, chat, a1)));
    await land(h, chat, draftEntry(other, await basisOf(h, chat, a1)));
    // The next turn can't proceed without the boat's draft, and settles it in its own record.
    await h.send(chat, "settle d-boat", "The marina, the next morning.");
    expect((await onChain(h, chat)).states).toEqual({ "d-boat": "settled", "d-truck": "open" });
    // Decided at the first reply, a drop of it would break that turn: refused. One of the other draft lands.
    expect(await land(h, chat, drop(d, await basisOf(h, chat, a1)))).toMatchObject({ status: "refused", reason: expect.stringContaining("a later turn no longer folds with it") });
    expect((await land(h, chat, drop(other, await basisOf(h, chat, a1)))).status).toBe("landed");
    expect((await onChain(h, chat)).states).toEqual({ "d-boat": "settled", "d-truck": "dropped" });
  });

  test("a refused trial leaves no fold behind under its id: an entry that reuses the id is judged on its own, and the folds agree", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack], model });
    const chat = await h.newChat();
    await h.send(chat, "Hello.", "First reply.");
    const a1 = (await h.chain(chat)).at(-1)?.id ?? "";
    const d = boatDraft("d-boat", 0);
    const other = boatDraft("d-truck", 0);
    await land(h, chat, draftEntry(d, await basisOf(h, chat, a1)));
    await land(h, chat, draftEntry(other, await basisOf(h, chat, a1)));
    await h.send(chat, "settle d-boat", "The marina, the next morning.");
    // One id whatever the drop drops, as a job's id names its kind, subject and basis and never its content.
    const id = "drop-at-the-first-reply";
    expect(await land(h, chat, drop(d, await basisOf(h, chat, a1), id))).toMatchObject({ status: "refused", reason: expect.stringContaining("a later turn no longer folds with it") });
    expect((await land(h, chat, drop(other, await basisOf(h, chat, a1), id))).status).toBe("landed");
    expect((await onChain(h, chat)).states).toEqual({ "d-boat": "settled", "d-truck": "dropped" });
  });

  test("delete then send: a settlement anchored at the deleted reply goes inert, and the draft settles again at the new head", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const d = boatDraft("d-boat", 0);
    await land(h, chat, draftEntry(d, await basisOf(h, chat, a1)));
    await land(h, chat, await settlement(h, chat, d, await basisOf(h, chat, a2)));
    h.host.deleteMessage(chat, a2);
    await h.host.settle();
    await h.send(chat, "Once more.", "Third reply.");
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "open" }, flags: [], beats: [] });
    expect((await land(h, chat, await settlement(h, chat, d, await head(h, chat)))).status).toBe("landed");
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "settled" }, flags: ["sold-d-boat"], beats: ["d-boat-sale"] });
  });

  test("an edit: the settled reply's own edit keeps its settlement; an earlier message's edit pauses landing until Keep, after which the settlement folds on as a rebased view", async () => {
    const { h, chat, ids } = await setup();
    const [, u1, a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const d = boatDraft("d-boat", 0);
    const other = boatDraft("d-truck", 0);
    await land(h, chat, draftEntry(d, await basisOf(h, chat, a1)));
    await land(h, chat, draftEntry(other, await basisOf(h, chat, a2)));
    await land(h, chat, await settlement(h, chat, d, await basisOf(h, chat, a2)));
    h.host.editMessage(chat, a2, "Second reply, as the player put it.");
    await h.host.settle();
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "settled", "d-truck": "open" }, flags: ["sold-d-boat"], beats: ["d-boat-sale"] });

    const at2 = await basisOf(h, chat, a2);
    h.host.editMessage(chat, u1, "Hello there.");
    await h.host.settle();
    expect((await h.core(chat)).journal.pauses.map((p) => p.messageId)).toEqual([u1]);
    expect(await land(h, chat, drop(other, at2))).toMatchObject({ status: "refused", reason: expect.stringContaining("paused") });
    expect((await h.write(chat, { kind: "keep", id: "k1", messageId: u1, parentPath: "", convert: [] })).applied).toBe(true);
    const out = await agree(h, chat);
    expect(out.messages.filter((m) => m.fold === "view").length).toBeGreaterThan(0);
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "settled", "d-truck": "open" }, flags: ["sold-d-boat"], beats: ["d-boat-sale"] });
    expect((await land(h, chat, await settlement(h, chat, other, await head(h, chat)))).status).toBe("landed");
    expect((await onChain(h, chat)).states).toEqual({ "d-boat": "settled", "d-truck": "settled" });
  });

  test("a branch reads its parent's drafts; settling or dropping one in either never reaches the other, across a restart", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const d = boatDraft("d-boat", 0);
    const other = boatDraft("d-truck", 0);
    await land(h, chat, draftEntry(d, await basisOf(h, chat, a1)));
    await land(h, chat, draftEntry(other, await basisOf(h, chat, a1)));
    const branch = h.host.branch(chat, a2);
    await h.host.chats.mergeChatMetadata(branch, { branched_from: chat, branch_at_message: a2 }, h.host.userId);
    await h.service.open(branch, h.host.userId);
    expect((await onChain(h, branch)).states).toEqual({ "d-boat": "open", "d-truck": "open" });

    // The branch settles the boat and drops the truck; the parent does the opposite.
    expect((await land(h, branch, await settlement(h, branch, d, await head(h, branch)))).status).toBe("landed");
    expect((await land(h, branch, drop(other, await head(h, branch)))).status).toBe("landed");
    expect((await land(h, chat, drop(d, await head(h, chat)))).status).toBe("landed");
    expect((await land(h, chat, await settlement(h, chat, other, await head(h, chat)))).status).toBe("landed");
    expect(await onChain(h, branch)).toEqual({ states: { "d-boat": "settled", "d-truck": "dropped" }, flags: ["sold-d-boat"], beats: ["d-boat-sale"] });
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "dropped", "d-truck": "settled" }, flags: ["sold-d-truck"], beats: ["d-truck-sale"] });

    await h.restart();
    expect(await onChain(h, branch)).toEqual({ states: { "d-boat": "settled", "d-truck": "dropped" }, flags: ["sold-d-boat"], beats: ["d-boat-sale"] });
    expect(await onChain(h, chat)).toEqual({ states: { "d-boat": "dropped", "d-truck": "settled" }, flags: ["sold-d-truck"], beats: ["d-truck-sale"] });
  });
});
