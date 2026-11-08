// The basis-anchored layer and the narrative record (DEPTH-PLAN §4.2, §4.9; A1's tests, §9.2): an
// entry folds wherever its basis message shows the swipe it was made from, right after that
// message's record, and moves no path; a swipe of the latest reply leaves inert only what was made
// from it; a result held across a swipe's generation never lands on the sibling; delete then send;
// a branch inherits what its parent landed by the time it was made, holds it in its own layer under
// its copies' ids and keeps it once its parent is gone, and landing in either never reaches the other; a
// landing is idempotent by id across a restart; beats live with their turn (a Re-run replaces them, a
// Re-narrate keeps them) and amendments supersede them where they fold. Both folds agree throughout,
// cold (snapshot-started) folds included.

import { describe, expect, setSystemTime, test } from "bun:test";
import { hashJson, hashParts } from "../../src/shared/hash";
import type { ChatId, MessageId } from "../../src/shared/ids";
import type { Basis, LayerDraft, LayerEntry } from "../../src/shared/layer";
import { LEDGER_NAMESPACE, type LedgerEvent } from "../../src/shared/ledger";
import { beatEvent, beatId, strikeEvent, type Beat } from "../../src/shared/story";
import type { TurnModel } from "../../src/engine/ledger/journal";
import type { FoldOutput } from "../../src/engine/ledger/chain";
import { workspaceOf, WS_WRITE, wsDelete, wsWrite } from "../../src/engine/workspace";
import { contentId } from "../../src/engine/ledger/path";
import storyPack from "../../src/packs/story/core/index";
import { Harness } from "../support/harness";
import { POV } from "../support/test-pack";
import { ArchiveIndex } from "../../src/backend/archive-index";
import { layerDir } from "../../src/backend/layer-store";
import { carryOf } from "../../src/backend/layer-carry";
import { randomBytes } from "node:crypto";

const blob = (s: string): string => hashParts("test.blob", s);

function beat(id: string, at: number, extra: Partial<Beat> = {}): Beat {
  return { id, at, order: 0, place: "home", actors: [POV], act: "said", about: [], what: blob(`what ${id}`), surface: blob(`surface ${id}`), exposure: [{ who: POV, channel: "hearing", reach: "whole" }], by: { turn: id, decided: "player" }, ...extra };
}

/** Each turn decides one beat, named by its seed: a Re-run draws a new seed, a Re-narrate copies the turn's events. */
const beatModel: TurnModel = {
  plan: ({ seed, state }) => [beatEvent(beat(beatId(seed), state.clock))],
  read: () => [],
};

function draft(id: string, basis: Basis, events: LedgerEvent[], extra: Partial<LayerDraft> = {}): LayerDraft {
  return { id, basis, kind: events[0]?.type ?? "test", events, ...extra };
}

const note = (name: string): LedgerEvent => wsWrite(`notebook/${name}.md`, blob(name));
/** A newcomer brought into the world, as the bootstrap's spawn brings one in; and a write that needs her there. */
const rosa = (name = "Rosa Vance"): LedgerEvent => ({ type: "spawn", entity: { id: "rosa", kind: "person", name, tier: "background", fields: {}, relations: [] } });
const wary = (who: string): LedgerEvent => ({ type: "set", entity: who, field: "mood", value: "wary" });

async function setup(): Promise<{ h: Harness; chat: ChatId; ids: MessageId[] }> {
  const h = new Harness("fresh", { packs: [storyPack], model: beatModel });
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

/** A branch of `chat` at `at` as core makes one, its metadata naming where it came from; LumiRPEngine hasn't opened it yet. */
async function branchAt(h: Harness, chat: ChatId, at: MessageId): Promise<ChatId> {
  const branch = h.host.branch(chat, at);
  await h.host.chats.mergeChatMetadata(branch, { branched_from: chat, branch_at_message: at }, h.host.userId);
  return branch;
}

async function land(h: Harness, chat: ChatId, d: LayerDraft) {
  const out = await h.service.landLayer(chat, h.host.userId, d);
  await h.host.settle();
  return out;
}

/** The workspace's notebook files as the chat folds them now, checked against both folds (warm and cold). */
async function files(h: Harness, chat: ChatId): Promise<string[]> {
  const out = await agree(h, chat);
  return Object.keys(workspaceOf(out.state))
    .filter((p) => p.startsWith("notebook/"))
    .map((p) => p.slice("notebook/".length, -".md".length))
    .sort();
}

async function agree(h: Harness, chat: ChatId): Promise<FoldOutput> {
  const { reference, optimized, cold } = await h.folds(chat);
  expect(hashJson(optimized.state)).toBe(hashJson(reference.state));
  expect(hashJson(cold.state)).toBe(hashJson(reference.state));
  expect(optimized.messages).toEqual(reference.messages);
  expect(optimized.layerDrops).toEqual(reference.layerDrops);
  expect(cold.layerDrops).toEqual(reference.layerDrops);
  expect(reference.violations).toEqual([]);
  expect(optimized.violations).toEqual([]);
  expect(h.service.errors).toEqual([]);
  return reference;
}

async function swipe(h: Harness, chat: ChatId, reply: string): Promise<void> {
  const g = await h.host.start(chat, { type: "swipe" });
  await h.host.finish(g, reply);
  await h.host.settle();
}

async function beatsOn(h: Harness, chat: ChatId, messageId: MessageId): Promise<string[]> {
  const story = await h.service.readStory(chat, h.host.userId);
  return story.beats.filter((b) => b.from.messageId === messageId).map((b) => b.beat.id);
}

describe("the basis-anchored layer", () => {
  test("a swipe of the latest reply leaves inert only what was made from it, and a switch back brings it back", async () => {
    const { h, chat, ids } = await setup();
    const [m0, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const paths = (await h.folds(chat)).reference.messages.map((m) => m.path);
    const at0 = await basisOf(h, chat, m0);
    const at1 = await basisOf(h, chat, a1);
    const at2 = await basisOf(h, chat, a2);
    // A reply with a turn record is keyed by its record; the greeting, by its text.
    expect(at2.swipe).toMatch(/^r\d+$/);
    expect(at0.swipe).toMatch(/^c[0-9a-f]{32}$/);
    expect((await land(h, chat, draft("e0", at0, [beatEvent(beat("b-history", 0, { by: { bootstrap: { message: m0, swipe: at0.swipe } } }))]))).status).toBe("landed");
    expect((await land(h, chat, draft("e1", at1, [note("a")]))).status).toBe("landed");
    expect((await land(h, chat, draft("e2", at2, [note("b")]))).status).toBe("landed");
    expect(await files(h, chat)).toEqual(["a", "b"]);
    // Landing moved no path.
    expect((await h.folds(chat)).reference.messages.map((m) => m.path)).toEqual(paths);
    // An entry of beats alone changes no state, so the world-state folds leave it out; the narrative record reads it.
    expect((await h.folds(chat)).reference.messages.map((m) => m.layer ?? [])).toEqual([[], [], ["e1"], [], ["e2"]]);
    const before = await beatsOn(h, chat, a2);

    await swipe(h, chat, "Second reply, again.");
    expect(await files(h, chat)).toEqual(["a"]);
    const story = await h.service.readStory(chat, h.host.userId);
    expect(story.beats.some((b) => b.beat.id === "b-history")).toBe(true);
    const after = await beatsOn(h, chat, a2);
    expect(after).toHaveLength(1);
    expect(after).not.toEqual(before);

    h.host.navigate(chat, a2, 0);
    await h.host.settle();
    expect(await files(h, chat)).toEqual(["a", "b"]);
    expect(await beatsOn(h, chat, a2)).toEqual(before);
  });

  test("a result held across a swipe's generation never lands on the sibling; one anchored earlier lands when the window closes", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const at1 = await basisOf(h, chat, a1);
    const at2 = await basisOf(h, chat, a2);
    const g = await h.host.start(chat, { type: "swipe" });
    const sibling = await h.service.landLayer(chat, h.host.userId, draft("held-on-a2", at2, [note("sibling")]));
    const earlier = await h.service.landLayer(chat, h.host.userId, draft("held-on-a1", at1, [note("earlier")]));
    expect(sibling.status).toBe("held");
    expect(earlier.status).toBe("held");
    await h.host.finish(g, "Second reply, swiped.");
    await h.host.settle();
    const landed = (await h.service.layerSummaries(chat, h.host.userId)).map((s) => s.id);
    expect(landed).toEqual(["held-on-a1"]);
    expect(await files(h, chat)).toEqual(["earlier"]);
    h.host.navigate(chat, a2, 0);
    await h.host.settle();
    expect(await files(h, chat)).toEqual(["earlier"]);
  });

  test("a held result refused as its windows close is told to the player when it was his or its message still stands; work its message's swipe took away goes unsaid", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const at1 = await basisOf(h, chat, a1);
    const at2 = await basisOf(h, chat, a2);
    const g = await h.host.start(chat, { type: "swipe" });
    // Held through the swipe's generation, each refused as it closes: work made from the swiped reply, the player's own change made from it, and work made earlier that doesn't fit there.
    for (const d of [draft("work-on-a2", at2, [note("work")]), draft("mine-on-a2", at2, [note("mine")], { by: { role: "player" } }), draft("misfit-on-a1", at1, [wsDelete("notebook/none.md")], { by: { role: "author" } })]) {
      expect((await h.service.landLayer(chat, h.host.userId, d)).status).toBe("held");
    }
    await h.host.finish(g, "Second reply, swiped.");
    await h.host.settle();
    expect(await h.service.layerSummaries(chat, h.host.userId)).toEqual([]);
    expect(h.host.toasts).toEqual([
      { message: "Your change made while the reply was written wasn't kept: the message it was made from shows another swipe now", userId: h.host.userId },
      { message: expect.stringMatching(/^Work made while the reply was written wasn't kept: event 0 /), userId: h.host.userId },
    ]);
  });

  test("landing refuses a basis off the chain, and an event that doesn't fit the fold there", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const at2 = await basisOf(h, chat, a2);
    await swipe(h, chat, "Second reply, again.");
    const off = await land(h, chat, draft("off", at2, [note("x")]));
    expect(off.status).toBe("refused");
    const at1 = await basisOf(h, chat, a1);
    const misfit = await land(h, chat, draft("misfit", at1, [wsDelete("notebook/none.md")]));
    expect(misfit.status).toBe("refused");
    expect(await h.service.layerSummaries(chat, h.host.userId)).toEqual([]);
  });

  test("delete then send: what was anchored at the deleted reply goes inert, what was anchored before it stays", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    await land(h, chat, draft("e1", await basisOf(h, chat, a1), [note("a")]));
    await land(h, chat, draft("e2", await basisOf(h, chat, a2), [note("b")]));
    h.host.deleteMessage(chat, a2);
    await h.host.settle();
    await h.send(chat, "Once more.", "Third reply.");
    expect(await files(h, chat)).toEqual(["a"]);
    const head = (await h.chain(chat)).at(-1)?.id ?? "";
    expect((await land(h, chat, draft("e3", await basisOf(h, chat, head), [note("c")]))).status).toBe("landed");
    expect(await files(h, chat)).toEqual(["a", "c"]);
  });

  test("an entry under a changed prefix folds as a rebased view: what no longer fits drops, never a violation", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    await land(h, chat, draft("e1", await basisOf(h, chat, a1), [note("a")]));
    await land(h, chat, draft("e2", await basisOf(h, chat, a2), [wsDelete("notebook/a.md"), note("kept")]));
    expect(await files(h, chat)).toEqual(["kept"]);
    h.host.deleteMessage(chat, a1);
    await h.host.settle();
    expect(await files(h, chat)).toEqual(["kept"]);
    const out = await agree(h, chat);
    expect(out.layerDrops.map((d) => [d.entry, d.index])).toEqual([["e2", 0]]);
  });

  test("an entry's supersedes stops the entries it names wherever it folds", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    await land(h, chat, draft("first", await basisOf(h, chat, a1), [note("first")]));
    await land(h, chat, draft("redo", await basisOf(h, chat, a2), [note("redo")], { supersedes: ["first"] }));
    expect(await files(h, chat)).toEqual(["redo"]);
    await swipe(h, chat, "Second reply, again.");
    expect(await files(h, chat)).toEqual(["first"]);
  });

  test("an entry is checked with what it supersedes already gone: a redo brings in again whom the entry it replaces brought in", async () => {
    const { h, chat, ids } = await setup();
    const at1 = await basisOf(h, chat, ids[2] as MessageId);
    expect((await land(h, chat, draft("spawn", at1, [rosa()]))).status).toBe("landed");
    // Checked where the first spawn still folded, the redo's own would have met her there already.
    expect((await land(h, chat, draft("respawn", at1, [rosa("Rosa Vance, the harbourmaster")], { supersedes: ["spawn"] }))).status).toBe("landed");
    expect((await agree(h, chat)).state.entities.rosa?.name).toBe("Rosa Vance, the harbourmaster");
  });

  test("an entry that supersedes others lands only where every turn and entry from the first of them on still folds without them, its own basis wherever it is", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, u2, a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const at1 = await basisOf(h, chat, a1);
    const at2 = await basisOf(h, chat, a2);
    await land(h, chat, draft("spawn", at1, [rosa()]));
    expect((await land(h, chat, draft("wary", await basisOf(h, chat, u2), [wary("rosa")]))).status).toBe("landed");
    // A redo at the first reply that no longer brings her in: the entry after it stood on her.
    expect(await land(h, chat, draft("redo", at1, [note("redo")], { supersedes: ["spawn"] }))).toMatchObject({ status: "refused", reason: expect.stringContaining("no longer folds with it") });
    // So does one at the chain's last message, after both: what it takes away is behind it.
    expect(await land(h, chat, draft("redo-at-head", at2, [note("redo")], { supersedes: ["spawn"] }))).toMatchObject({ status: "refused", reason: expect.stringContaining("no longer folds with it") });
    // One that brings her in again lands, and the folds agree.
    expect((await land(h, chat, draft("redo-with-her", at1, [rosa(), note("redo")], { supersedes: ["spawn"] }))).status).toBe("landed");
    expect(await files(h, chat)).toEqual(["redo"]);
    expect((await h.service.layerSummaries(chat, h.host.userId)).map((s) => s.id)).toEqual(["spawn", "wary", "redo-with-her"]);
  });

  test("a branch folds what was landed before it was made; landing in either never reaches the other", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    await land(h, chat, draft("e1", await basisOf(h, chat, a1), [note("a")]));
    await land(h, chat, draft("e2", await basisOf(h, chat, a2), [note("b")]));
    const branch = h.host.branch(chat, a2);
    // As core writes them on a branch.
    await h.host.chats.mergeChatMetadata(branch, { branched_from: chat, branch_at_message: a2 }, h.host.userId);
    await h.service.open(branch, h.host.userId);
    expect(await files(h, branch)).toEqual(["a", "b"]);
    await land(h, chat, draft("parent-only", await basisOf(h, chat, a2), [note("c")]));
    const copy = (await h.chain(branch)).at(-1)?.id ?? "";
    expect(copy).not.toBe(a2);
    expect((await land(h, branch, draft("branch-only", await basisOf(h, branch, copy), [note("d")]))).status).toBe("landed");
    expect(await files(h, chat)).toEqual(["a", "b", "c"]);
    expect(await files(h, branch)).toEqual(["a", "b", "d"]);
    // The branch holds its inheritance after a restart.
    await h.restart();
    expect(await files(h, branch)).toEqual(["a", "b", "d"]);
    expect(await files(h, chat)).toEqual(["a", "b", "c"]);
  });

  test("a chat carries its layer in its own metadata, so an imported copy folds what it landed under its copies of the messages; a layer too large to carry is marked so", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    await land(h, chat, draft("e1", await basisOf(h, chat, a1), [note("a")]));
    await land(h, chat, draft("e2", await basisOf(h, chat, a2), [note("b")]));
    // Carried once a turn, when something landed since: the next turn's end writes it.
    expect(h.host.chat(chat).metadata.lre_layer).toBeUndefined();
    await h.send(chat, "On.", "Third reply.");
    const copy = h.host.importCopy(chat);
    await h.service.open(copy, h.host.userId);
    await h.host.settle();
    expect(await files(h, copy)).toEqual(["a", "b"]);
    await h.restart();
    expect(await files(h, copy)).toEqual(["a", "b"]);
    // Past the cap, nothing is carried: the copy starts without it, and the chat keeps the export warning.
    const big = Array.from({ length: 40 }, (_, i): LayerEntry => ({ id: `big${i}`, chat, basis: { message: a1, swipe: "c0", parentPath: "" }, kind: "test", events: [], reasoning: randomBytes(48_000).toString("base64"), landed: { seq: i, at: new Date(0).toISOString() } }));
    expect("over" in carryOf(chat, "run", big, [])).toBe(true);
  });

  test("a branch holds what it inherited in its own layer: it keeps it once its parent chat is gone, across a restart", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    await land(h, chat, draft("e1", await basisOf(h, chat, a1), [note("a")]));
    await land(h, chat, draft("e2", await basisOf(h, chat, a2), [note("b")]));
    const branch = await branchAt(h, chat, a2);
    await h.service.open(branch, h.host.userId);
    expect(await files(h, branch)).toEqual(["a", "b"]);
    // Its own files hold them, renamed for it, so the blob sweep keeps what they name.
    const stored = JSON.parse((await h.host.storage.read(`${layerDir(branch)}/seg-0.json`, h.host.userId)) ?? "[]") as { id: string; basis: Basis }[];
    expect(stored.map((e) => e.id)).toEqual(["e1", "e2"]);
    const copies = h.host.chat(branch).messages.map((m) => m.id);
    expect(stored.map((e) => e.basis.message)).toEqual([copies[2], copies[4]]);
    h.host.deleteChat(chat);
    await h.host.settle();
    // The deleted chat's run goes with it: its layer, journal and every other file under its run directory.
    expect([...h.host.files.keys()].filter((k) => k.includes(`runs/${chat}/`))).toEqual([]);
    await h.restart();
    expect(await files(h, branch)).toEqual(["a", "b"]);
    expect((await h.service.layerSummaries(branch, h.host.userId, { inherited: true })).map((s) => s.id)).toEqual(["e1", "e2"]);
    expect(await h.service.layerSummaries(branch, h.host.userId)).toEqual([]);
  });

  test("a branch takes what its parent landed by the time it was made, never what the parent landed before it was first opened", async () => {
    const t0 = Date.now();
    setSystemTime(new Date(t0));
    try {
      const { h, chat, ids } = await setup();
      const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
      await land(h, chat, draft("before", await basisOf(h, chat, a1), [note("before")]));
      setSystemTime(new Date(t0 + 5_000));
      const branch = await branchAt(h, chat, a2);
      // The parent's after-reply work lands after the branch was made, before LumiRPEngine first opens it.
      setSystemTime(new Date(t0 + 10_000));
      await land(h, chat, draft("late", await basisOf(h, chat, a2), [note("late")]));
      await h.service.open(branch, h.host.userId);
      expect(await files(h, branch)).toEqual(["before"]);
      expect(await files(h, chat)).toEqual(["before", "late"]);
    } finally {
      setSystemTime();
    }
  });

  test("a branch takes each entry onto the copy of its own message by the identity the copy shows, never by its place: a message deleted, or inserted before the branch point (the host numbers every later one up), in the parent or the branch since, shifts nothing", async () => {
    for (const change of ["the parent deletes one", "the parent inserts one", "the branch inserts one"] as const) {
      const { h, chat, ids } = await setup();
      const [, u1, a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
      await land(h, chat, draft("e1", await basisOf(h, chat, a1), [note("a")]));
      await land(h, chat, draft("e2", await basisOf(h, chat, a2), [note("b")]));
      const branch = await branchAt(h, chat, a2);
      const copies = h.host.chat(branch).messages.map((m) => m.id);
      // Before LumiRPEngine first opens the branch, a message before the branch point goes, or one comes in.
      if (change === "the parent deletes one") h.host.deleteMessage(chat, u1);
      else if (change === "the parent inserts one") h.host.insertBefore(chat, u1, { isUser: false, text: "The cafe opens." });
      else h.host.insertBefore(branch, copies[1] as MessageId, { isUser: false, text: "The cafe opens." });
      await h.host.settle();
      await h.service.open(branch, h.host.userId);
      expect({ change, files: await files(h, branch) }).toEqual({ change, files: ["a", "b"] });
      const stored = JSON.parse((await h.host.storage.read(`${layerDir(branch)}/seg-0.json`, h.host.userId)) ?? "[]") as { id: string; basis: Basis }[];
      expect({ change, on: stored.map((e) => e.basis.message) }).toEqual({ change, on: [copies[2], copies[4]] });
    }
  });

  test("a branch an earlier build opened keeps the terms it stored, and holds what they take in its own layer from its next open", async () => {
    const t0 = Date.now();
    setSystemTime(new Date(t0));
    try {
      const { h, chat, ids } = await setup();
      const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
      await land(h, chat, draft("e1", await basisOf(h, chat, a1), [note("a")]));
      setSystemTime(new Date(t0 + 5_000));
      const branch = await branchAt(h, chat, a2);
      setSystemTime(new Date(t0 + 10_000));
      await land(h, chat, draft("e2", await basisOf(h, chat, a2), [note("b")]));
      // The earlier build fixed its terms when it first opened the branch, after e2, and read them live at every open.
      const copies = h.host.chat(branch).messages.map((m) => m.id);
      const messages = Object.fromEntries(ids.map((id, i) => [id, copies[i]]));
      await h.host.storage.write(`${layerDir(branch)}/meta.json`, JSON.stringify({ v: 1, seq: 0, segments: 0, inherit: { from: chat, seq: 2, before: new Date(t0 + 15_000).toISOString(), messages } }), h.host.userId);
      setSystemTime(new Date(t0 + 20_000));
      await land(h, chat, draft("e3", await basisOf(h, chat, a2), [note("c")]));
      await h.service.open(branch, h.host.userId);
      expect(await files(h, branch)).toEqual(["a", "b"]);
      h.host.deleteChat(chat);
      await h.restart();
      expect(await files(h, branch)).toEqual(["a", "b"]);
    } finally {
      setSystemTime();
    }
  });

  test("an edit of an old player message keeps what was made from it as it was: its identity holds, as a reply's does, across a restart and in a branch", async () => {
    const h = new Harness("fresh", { packs: [storyPack], model: beatModel });
    // A chat's history, never played: the bootstrap distils beats from the player's own messages too.
    const chat = h.host.createChat("Morning, Sam.");
    h.host.append(h.host.chat(chat), { id: "h1", isUser: true, name: "User", swipes: ["Helo, Dev."], swipeId: 0, bag: {} });
    h.host.append(h.host.chat(chat), { id: "h2", isUser: false, name: "Narrator", swipes: ["Dev waves back."], swipeId: 0, bag: {} });
    await h.host.chats.mergeChatMetadata(chat, { [LEDGER_NAMESPACE]: { v: 1, worldId: "world-test", revision: h.revision, runSeed: `run-${chat}`, startedAt: 0 } }, h.host.userId);
    await h.service.open(chat, h.host.userId);
    const at = await basisOf(h, chat, "h1");
    expect((await land(h, chat, draft("beats-h1", at, [beatEvent(beat("b-h1", 0, { by: { bootstrap: { message: "h1", swipe: at.swipe } } }))]))).status).toBe("landed");
    expect((await land(h, chat, draft("note-h1", at, [note("h1")]))).status).toBe("landed");
    // A typo fix, with no turn after it to pause; the edit goes to the hooks as the player's, for the author's directive.
    const told: { messageId: string; isUser: boolean; text: string }[] = [];
    if (h.service.hooks) h.service.hooks.assistantEdited = (e) => void told.push({ messageId: e.messageId, isUser: e.isUser, text: e.text });
    h.host.editMessage(chat, "h1", "Hello, Dev.");
    await h.host.settle();
    expect(told).toEqual([{ messageId: "h1", isUser: true, text: "Hello, Dev." }]);
    expect((await h.core(chat)).journal.pauses).toEqual([]);
    expect((await basisOf(h, chat, "h1")).swipe).toBe(at.swipe);
    expect(await beatsOn(h, chat, "h1")).toEqual(["b-h1"]);
    expect(await files(h, chat)).toEqual(["h1"]);
    await h.restart();
    expect(await beatsOn(h, chat, "h1")).toEqual(["b-h1"]);
    // A branch made since inherits them: its copy of the message keeps the identity too.
    const branch = await branchAt(h, chat, "h2");
    await h.service.open(branch, h.host.userId);
    expect(await files(h, branch)).toEqual(["h1"]);
    // Edited back as it was, it still shows that identity.
    h.host.editMessage(chat, "h1", "Helo, Dev.");
    await h.host.settle();
    expect((await basisOf(h, chat, "h1")).swipe).toBe(at.swipe);
    expect(await files(h, chat)).toEqual(["h1"]);
  });

  test("an edit of a player message nothing was made from gives it no record: its identity is its text, as before", async () => {
    const { h, chat, ids } = await setup();
    const u2 = ids[3] as MessageId;
    const told: string[] = [];
    if (h.service.hooks) h.service.hooks.assistantEdited = (e) => void told.push(e.messageId);
    h.host.editMessage(chat, u2, "Again, please.");
    await h.host.settle();
    expect(told).toEqual([]);
    expect((await h.chain(chat))[3]?.ledger).toBeNull();
    expect((await basisOf(h, chat, u2)).swipe).toBe(`c${contentId("Again, please.").hash}`);
  });

  test("a landing is idempotent by id, across a restart (a job rerun after a crash never lands twice)", async () => {
    const { h, chat, ids } = await setup();
    const d = draft("job-1", await basisOf(h, chat, ids[2] as MessageId), [note("once")]);
    expect((await land(h, chat, d)).status).toBe("landed");
    expect(await land(h, chat, d)).toMatchObject({ status: "landed", existing: true });
    const many = await h.service.landLayers(chat, h.host.userId, [d, draft("job-2", d.basis, [note("twice")])]);
    expect(many.map((r) => r.status)).toEqual(["landed", "landed"]);
    await h.restart();
    expect(await land(h, chat, d)).toMatchObject({ status: "landed", existing: true });
    expect((await h.service.layerSummaries(chat, h.host.userId)).map((s) => s.id)).toEqual(["job-1", "job-2"]);
    expect(await files(h, chat)).toEqual(["once", "twice"]);
  });
});

describe("the narrative record", () => {
  test("a beat lives with its turn: a Re-run replaces the turn's beats, a Re-narrate keeps them", async () => {
    const { h, chat, ids } = await setup();
    const a2 = ids[4] as MessageId;
    const original = await beatsOn(h, chat, a2);
    expect(original).toHaveLength(1);
    h.renarrateNext = true;
    await swipe(h, chat, "Second reply, told again.");
    expect(await beatsOn(h, chat, a2)).toEqual(original);
    await swipe(h, chat, "Second reply, played again.");
    const rerun = await beatsOn(h, chat, a2);
    expect(rerun).toHaveLength(1);
    expect(rerun).not.toEqual(original);
    await agree(h, chat);
  });

  test("an amendment supersedes a beat and a strike takes one out, only where they fold", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const [first] = await beatsOn(h, chat, a1);
    const [second] = await beatsOn(h, chat, a2);
    if (!first || !second) throw new Error("no beats");
    const amend = beatEvent(beat("b-amended", 0, { supersedes: [first], by: { entry: "spot-check" } }));
    expect((await land(h, chat, draft("amend", await basisOf(h, chat, a2), [amend, strikeEvent({ beats: [second] })]))).status).toBe("landed");
    const story = await h.service.readStory(chat, h.host.userId);
    expect(story.beats.map((b) => b.beat.id)).toEqual(["b-amended"]);
    expect(story.replaced.map((r) => r.id).sort()).toEqual([first, second].sort());
    await swipe(h, chat, "Second reply, again.");
    const after = await h.service.readStory(chat, h.host.userId);
    expect(after.beats.map((b) => b.beat.id)).toContain(first);
    expect(after.beats.some((b) => b.beat.id === "b-amended")).toBe(false);
  });

  test("a malformed or grouped story event never validates", async () => {
    const { h, chat, ids } = await setup();
    const at = await basisOf(h, chat, ids[2] as MessageId);
    const grouped: LedgerEvent = { ...beatEvent(beat("b-grouped", 0)), group: "g" };
    expect((await land(h, chat, draft("grouped", at, [grouped]))).status).toBe("refused");
    const bad: LedgerEvent = { type: "story.beat", data: { id: "b-bad" } };
    expect((await land(h, chat, draft("bad", at, [bad]))).status).toBe("refused");
  });
});

describe("the raw archive index", () => {
  test("searches the chat's prose on the active chain, filters by the beats citing it, and quotes it exactly", async () => {
    const h = new Harness("fresh", { packs: [storyPack], model: beatModel });
    const chat = await h.newChat();
    await h.send(chat, "Where is the boat?", "The boat is moored at the marina, its hull freshly painted.");
    await h.send(chat, "And Dale?", "Dale sold his truck on Tuesday and took the bus home.");
    const ids = (await h.chain(chat)).map((m) => m.id);
    const a2 = ids[4] as MessageId;
    // A beat citing the second reply, with Dale on it.
    await land(h, chat, draft("cite", await basisOf(h, chat, a2), [beatEvent(beat("b-dale", 0, { actors: ["dale"], place: "bus_stop" }))]));
    const archive = new ArchiveIndex(h.service);
    const boats = await archive.search(chat, h.host.userId, { text: "boats marina" });
    expect(boats.hits[0]?.messageId).toBe(ids[2]);
    expect(boats.hits[0]?.snippet).toContain("marina");
    const dale = await archive.search(chat, h.host.userId, { who: "dale" });
    expect(dale.hits.map((x) => x.messageId)).toEqual([a2]);
    // The turn's own beat cites it too.
    expect(dale.hits[0]?.places).toEqual(["home", "bus_stop"]);
    expect((await archive.search(chat, h.host.userId, { text: "truck", upTo: ids[2] })).total).toBe(0);
    const quote = await archive.quote(chat, h.host.userId, { messageId: a2, span: [0, 4] });
    expect(quote?.text).toBe("Dale");
    // A swipe replaces what the index reads of the reply.
    await swipe(h, chat, "Dale kept his truck after all.");
    expect((await archive.search(chat, h.host.userId, { text: "bus" })).total).toBe(0);
    expect((await archive.search(chat, h.host.userId, { text: "kept truck" })).hits[0]?.messageId).toBe(a2);
  });
});

describe("the other routes", () => {
  test("Regenerate leaves inert only what was made from the reply it replaces", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    await land(h, chat, draft("e1", await basisOf(h, chat, a1), [note("a")]));
    await land(h, chat, draft("e2", await basisOf(h, chat, a2), [note("b")]));
    const g = await h.host.start(chat, { type: "regenerate" });
    await h.host.finish(g, "Second reply, regenerated.");
    await h.host.settle();
    expect(await files(h, chat)).toEqual(["a"]);
  });

  test("an undone beat stops being read, and the folds agree", async () => {
    const { h, chat, ids } = await setup();
    const a2 = ids[4] as MessageId;
    const [only] = await beatsOn(h, chat, a2);
    const swipeId = h.host.message(chat, a2).swipeId;
    expect((await h.write(chat, { kind: "undo", id: "u-beat", messageId: a2, swipeId, refs: [{ in: "events", index: 0 }] })).applied).toBe(true);
    expect(only).toBeDefined();
    expect(await beatsOn(h, chat, a2)).toEqual([]);
    await agree(h, chat);
  });
});

describe("reads at a basis", () => {
  test("a basis read takes the live events a reader asks for, through its basis only, in the same walk as the beats", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    await land(h, chat, draft("e1", await basisOf(h, chat, a1), [note("a")]));
    await land(h, chat, draft("e2", await basisOf(h, chat, a2), [note("b")]));
    const layered = (read: { events: { from: object }[] } | null): (string | null)[] => (read?.events ?? []).map((e) => ("layer" in e.from && typeof e.from.layer === "string" ? e.from.layer : null));
    const at1 = await h.service.foldAtBasis(chat, h.host.userId, await basisOf(h, chat, a1), [WS_WRITE]);
    expect(layered(at1)).toEqual(["e1"]);
    expect(at1?.story.beats).toHaveLength(1);
    expect(layered(await h.service.foldAtBasis(chat, h.host.userId, await basisOf(h, chat, a2), [WS_WRITE]))).toEqual(["e1", "e2"]);
    expect((await h.service.foldAtBasis(chat, h.host.userId, await basisOf(h, chat, a2)))?.events).toEqual([]);
    expect(layered({ events: await h.service.readEvents(chat, h.host.userId, [WS_WRITE], a1) })).toEqual(["e1"]);
  });
});
