// The main agent's session (DESIGN §4.4): each turn's segment, compaction summaries and archived
// spans are blobs a turn record names by hash, outside the path hash. The session resumes by walking
// the chat's active chain, so swipes and Branches follow it with no remapping, and nothing is written
// into a record once the next turn is planned.

import { describe, expect, test } from "bun:test";
import { BlobStore } from "../../src/backend/agents/blobs";
import { type SessionMessage, Sessions, sessionAt } from "../../src/backend/agents/sessions";
import { decodeLedger } from "../../src/backend/ledger-io";
import { hashJson } from "../../src/shared/hash";
import type { ChatId, MessageId } from "../../src/shared/ids";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import { Harness } from "../support/harness";

function stores(h: Harness): { blobs: BlobStore; sessions: Sessions } {
  const blobs = new BlobStore(h.host);
  return { blobs, sessions: new Sessions(blobs, h.service) };
}

const said = (text: string): SessionMessage => ({ role: "assistant", content: text });

/** The latest reply's turn closes: its segment, holding `text`, is written into its record. */
async function close(h: Harness, sessions: Sessions, chat: ChatId, text: string): Promise<{ messageId: MessageId; swipeId: number }> {
  const head = h.host.head(chat);
  if (!head) throw new Error("no reply");
  const at = { messageId: head.id, swipeId: head.swipeId };
  const holder = `close-${head.id}-${head.swipeId}`;
  const segment = await sessions.segment(h.host.userId, holder, [said(text)]);
  expect(await sessions.record(chat, h.host.userId, holder, at, { segment })).toBeNull();
  await h.host.settle();
  return at;
}

/** What the session reads at the end of the chat's active chain. */
async function resumed(h: Harness, sessions: Sessions, chat: ChatId): Promise<{ summary: string | null; messages: string[] }> {
  const core = await h.core(chat);
  const session = await sessions.resume(h.host.userId, await h.chain(chat), core.journal.tombstones);
  expect(session.missing).toEqual([]);
  return { summary: session.summary, messages: session.messages.map((m) => String(m.content)) };
}

/** The chain before a reply: what the turn that wrote it read its session from. */
async function before(h: Harness, chat: ChatId, messageId: MessageId): Promise<ChainMessage[]> {
  const chain = await h.chain(chat);
  return chain.slice(0, chain.findIndex((m) => m.id === messageId));
}

describe("the main session", () => {
  test("it resumes along the active chain: a swipe reads its own record's segment, and a Branch the parent's up to where it was made", async () => {
    const h = new Harness();
    const { sessions } = stores(h);
    const chat = await h.newChat();
    expect(await resumed(h, sessions, chat)).toEqual({ summary: null, messages: [] });
    await h.send(chat, "look around");
    const first = await close(h, sessions, chat, "one");
    await h.send(chat, "earn:5");
    const second = await close(h, sessions, chat, "two");
    expect((await resumed(h, sessions, chat)).messages).toEqual(["one", "two"]);
    // A Re-run of the second turn is a new swipe with a record of its own, which holds no segment until its close.
    await h.host.finish(await h.host.start(chat, { type: "swipe", messageId: second.messageId }), "Okay again.");
    expect((await resumed(h, sessions, chat)).messages).toEqual(["one"]);
    await close(h, sessions, chat, "two again");
    expect((await resumed(h, sessions, chat)).messages).toEqual(["one", "two again"]);
    // Back on the first swipe, its own segment is read again.
    h.host.navigate(chat, second.messageId, second.swipeId);
    await h.host.settle();
    expect((await resumed(h, sessions, chat)).messages).toEqual(["one", "two"]);
    // A Branch at the first reply resumes the session as it stood there.
    const branch = h.host.branch(chat, first.messageId);
    await h.service.open(branch, h.host.userId);
    await h.host.settle();
    expect((await resumed(h, sessions, branch)).messages).toEqual(["one"]);
  });

  test("a record carries its session outside the path hash: every path and the state fold as before", async () => {
    const h = new Harness();
    const { sessions } = stores(h);
    const chat = await h.newChat();
    await h.send(chat, "look around");
    await h.send(chat, "earn:5", "Payday. [found:5]");
    const plain = await h.folds(chat);
    await close(h, sessions, chat, "two");
    const carried = await h.folds(chat);
    expect(carried.optimized.messages).toEqual(plain.optimized.messages);
    expect(hashJson(carried.reference.state)).toBe(hashJson(plain.reference.state));
    expect(carried.reference.violations).toEqual([]);
    // It reaches the message's own metadata, so a Branch or a rebuilt journal reads it.
    const head = h.host.head(chat);
    expect(head ? decodeLedger(head.bag)?.swipes[String(head.swipeId)]?.session?.segment : undefined).toBe(sessionAt(await h.chain(chat), []).segments[0]);
  });

  test("nothing is written into a record once the next turn is under way, nor after it", async () => {
    const h = new Harness();
    const { blobs, sessions } = stores(h);
    const user = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "look around");
    const head = h.host.head(chat);
    if (!head) throw new Error("no reply");
    const segment = await sessions.segment(user, "late", [said("late")]);
    h.host.sendUser(chat, "earn:5");
    await h.host.settle();
    const next = await h.host.start(chat, { type: "normal" });
    expect(await h.service.recordSession(chat, user, head.id, head.swipeId, { segment })).not.toBeNull();
    await h.host.finish(next, "Okay.");
    expect(await sessions.record(chat, user, "late", { messageId: head.id, swipeId: head.swipeId }, { segment })).not.toBeNull();
    const earlier = (await h.chain(chat)).find((m) => m.id === head.id);
    expect(earlier?.ledger?.swipes[String(head.swipeId)]?.session).toBeUndefined();
    // A refused write lets its blobs go, for the sweep.
    expect(blobs.held(user).has(segment)).toBe(false);
    // The latest reply's record still takes one.
    const last = h.host.head(chat);
    if (!last) throw new Error("no reply");
    expect(await h.service.recordSession(chat, user, last.id, last.swipeId, { segment })).toBeNull();
  });

  test("a turn's close writes its segment from inside its own ledger operation", async () => {
    const h = new Harness();
    const { blobs, sessions } = stores(h);
    const user = h.host.userId;
    const hooks = h.service.hooks;
    if (!hooks) throw new Error("no hooks");
    const written: (string | null)[] = [];
    hooks.afterCommit = async (turn) => {
      const holder = `close-${turn.generationId}`;
      const segment = await sessions.segment(user, holder, [said(turn.content)]);
      written.push(sessions.recordIn(turn.core, turn.observed, user, holder, { messageId: turn.messageId, swipeId: turn.swipeId }, { segment }));
    };
    const chat = await h.newChat();
    await h.send(chat, "look around", "First reply.");
    await h.send(chat, "earn:5", "Second reply.");
    expect(written).toEqual([null, null]);
    expect((await resumed(h, sessions, chat)).messages).toEqual(["First reply.", "Second reply."]);
    expect(blobs.held(user).size).toBe(0);
  });

  test("a compaction summarizes on its turn's record and archives what it replaced; a later rollback brings it back, and no earlier record changes", async () => {
    const h = new Harness();
    const { sessions } = stores(h);
    const user = h.host.userId;
    const chat = await h.newChat();
    for (const [text, line] of [["look around", "one"], ["earn:5", "two"], ["earn:7", "three"]] as const) {
      await h.send(chat, text);
      await close(h, sessions, chat, line);
    }
    const tombstones = (await h.core(chat)).journal.tombstones;
    // The fourth turn compacts all but the last turn's segment before it adds its own.
    await h.send(chat, "look around");
    const fourth = h.host.head(chat);
    if (!fourth) throw new Error("no reply");
    const at4 = sessionAt(await before(h, chat, fourth.id), tombstones);
    expect(at4).toMatchObject({ base: null, archived: null });
    const compacted = await sessions.compact(user, "t4", at4, "Earlier, Sam looked around and was paid.", 1);
    const four = await sessions.segment(user, "t4", [said("four")]);
    expect(await sessions.record(chat, user, "t4", { messageId: fourth.id, swipeId: fourth.swipeId }, { segment: four, ...compacted })).toBeNull();
    await h.host.settle();
    expect(await resumed(h, sessions, chat)).toEqual({ summary: "Earlier, Sam looked around and was paid.", messages: ["three", "four"] });
    // The fifth turn rolls the compaction back: the archived span returns with what came after it.
    await h.send(chat, "look around");
    const fifth = h.host.head(chat);
    if (!fifth) throw new Error("no reply");
    const at5 = sessionAt(await before(h, chat, fifth.id), tombstones);
    expect(at5.archived).toBe(compacted.archived);
    const rolled = await sessions.rollback(user, "t5", at5, compacted.archived);
    if (!rolled) throw new Error("no archived span");
    const five = await sessions.segment(user, "t5", [said("five")]);
    expect(await sessions.record(chat, user, "t5", { messageId: fifth.id, swipeId: fifth.swipeId }, { segment: five, ...rolled })).toBeNull();
    await h.host.settle();
    expect(await resumed(h, sessions, chat)).toEqual({ summary: null, messages: ["one", "two", "three", "four", "five"] });
    // The fourth record still holds its compaction: a Branch made there reads the summary.
    const branch = h.host.branch(chat, fourth.id);
    await h.service.open(branch, user);
    await h.host.settle();
    expect(await resumed(h, sessions, branch)).toEqual({ summary: "Earlier, Sam looked around and was paid.", messages: ["three", "four"] });
  });

  test("a segment the store no longer has is named as missing, and the rest of the session still reads", async () => {
    const h = new Harness();
    const { blobs, sessions } = stores(h);
    const user = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "look around");
    await close(h, sessions, chat, "one");
    await h.send(chat, "earn:5");
    await close(h, sessions, chat, "two");
    const [lost] = sessionAt(await h.chain(chat), []).segments;
    if (!lost) throw new Error("no segment");
    await blobs.remove(user, lost);
    const session = await sessions.resume(user, await h.chain(chat), []);
    expect(session.missing).toEqual([lost]);
    expect(session.messages.map((m) => m.content)).toEqual(["two"]);
  });
});
