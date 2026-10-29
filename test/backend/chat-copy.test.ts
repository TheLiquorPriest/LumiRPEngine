// A chat's messages on a long chat (DESIGN §9.6). The host reads a chat only whole, reasoning and
// all, so the engine reads it once, when it is first used, and keeps its copy current from the host's
// message events and its own writes: no turn, reply or helper call reads it again, and the copy holds
// what a fresh read would, however the host's events and answers interleave.

import { describe, expect, test } from "bun:test";
import type { HostPort } from "../../src/backend/host";
import { MessageCache } from "../../src/backend/message-cache";
import { FakeHost } from "../support/fake-host";
import { plainMinds, Rig } from "../support/rig";
import { POV } from "../support/test-pack";

/** Counts the reads of a whole chat from the host from now on; `real` reads the host's chat uncounted. */
function countReads(host: FakeHost): { count: () => number; real: HostPort["chats"]["messages"] } {
  let count = 0;
  const real = host.chats.messages;
  host.chats.messages = async (chatId, userId) => {
    count++;
    return real(chatId, userId);
  };
  return { count: () => count, real };
}

/**
 * The host's reads from now on are served when asked and answered when `answer` is called, as an
 * answer over the host's IPC lands after whatever events the host sent meanwhile.
 */
function slowReads(host: FakeHost): { count: () => number; answer: () => void; real: HostPort["chats"]["messages"] } {
  let count = 0;
  const real = host.chats.messages;
  const answered = Promise.withResolvers<void>();
  host.chats.messages = async (chatId, userId) => {
    count++;
    const served = await real(chatId, userId);
    await answered.promise;
    return served;
  };
  return { count: () => count, answer: () => answered.resolve(), real };
}

/** The host's metadata writes from now on wait until `take` is called before the host takes them. */
function slowWrites(host: FakeHost): { take: () => void } {
  const write = host.chats.writeMetadata;
  const taken = Promise.withResolvers<void>();
  host.chats.writeMetadata = async (...args) => {
    await taken.promise;
    await write(...args);
  };
  return { take: () => taken.resolve() };
}

async function playedChat(rig: Rig, turns: number): Promise<string> {
  const chatId = await rig.worldChat();
  for (let i = 0; i < turns; i++) await rig.turn(chatId, `I look around (${i}).`, `The square is quiet (${i}).`);
  return chatId;
}

/** A chat on a bare fake host, with the engine's copy over it: a greeting, the player's message and a reply. */
async function bareChat(): Promise<{ host: FakeHost; cache: MessageCache; chatId: string; user: string }> {
  const host = new FakeHost();
  const chatId = host.createChat("The square is quiet.");
  host.sendUser(chatId, "I look around.");
  host.append(host.chat(chatId), { id: "reply-1", isUser: false, name: "Narrator", swipes: ["A bell rings."], swipeId: 0, bag: {} });
  await host.settle();
  return { host, cache: new MessageCache(host), chatId, user: host.userId };
}

describe("a chat's messages", () => {
  test("are read from the host once while the chat is open, not per drawer request", async () => {
    const rig = new Rig();
    const chatId = await playedChat(rig, 2);
    rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "core.context", entity: null }));
    const reads = countReads(rig.host);
    rig.body(await rig.send({ type: "lre.hello", chatId, client: { version: "test" } }));
    rig.body(await rig.send({ type: "lre.gm", chatId }));
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: POV, field: "mood", value: "calm" }));
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: POV, field: "mood", value: "tense" }] }));
    expect(reads.count()).toBe(0);
    expect(await rig.moodOf(chatId)).toBe("tense");
  });

  test("no reply reads them again: a typed turn, a Send after a reply, a Regenerate, a swipe, a Continue, an Impersonate, a stop and a failed reply each leave the copy as the host reads the chat", async () => {
    const rig = new Rig();
    const chatId = await playedChat(rig, 2);
    rig.body(await rig.send({ type: "lre.hello", chatId, client: { version: "test" } }));
    const reads = countReads(rig.host);
    const user = rig.host.userId;
    const same = async (): Promise<void> => {
      await rig.host.settle();
      expect(await rig.rt.host.chats.messages(chatId, user)).toEqual(await reads.real(chatId, user));
    };
    const reply = async (type: "normal" | "regenerate" | "swipe" | "continue" | "impersonate", text: string, options: { createAtEnd?: boolean; rerender?: Record<string, string>; error?: string } = {}): Promise<void> => {
      const g = await rig.host.start(chatId, { type, ...(options.createAtEnd ? { createAtEnd: true } : {}) });
      expect(g.halted).toBeUndefined();
      await rig.host.finish(g, text, { ...(options.rerender ? { rerender: options.rerender } : {}), ...(options.error ? { error: options.error } : {}) });
      await same();
    };
    // A typed turn whose message the host re-renders before the reply ends (P4), then a Send after the reply.
    const said = rig.host.sendUser(chatId, "I wait for the bell.");
    await rig.host.settle();
    await reply("normal", "Time passes.", { rerender: { [said]: "I wait for the bell, rendered." } });
    await reply("normal", "More time passes.");
    await reply("regenerate", "Time passes slowly.");
    await reply("swipe", "Time crawls.");
    await reply("continue", "Then the bell rings.");
    await reply("impersonate", "I stretch.");
    // A new reply the host creates at its save, one stopped part way and one whose call failed.
    rig.host.sendUser(chatId, "I stand.");
    await rig.host.settle();
    await reply("normal", "You stand.", { createAtEnd: true });
    rig.host.sendUser(chatId, "I walk.");
    await rig.host.settle();
    const stopped = await rig.host.start(chatId, { type: "normal" });
    await rig.host.stop(stopped, "You walk a few");
    await same();
    rig.host.sendUser(chatId, "I run.");
    await rig.host.settle();
    await reply("normal", "", { error: "the provider failed" });
    expect(reads.count()).toBe(0);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a turn with the minds on reads none of them, whatever helper calls it makes", async () => {
    const rig = new Rig({ minds: true });
    rig.host.quietReply = plainMinds;
    const chatId = await playedChat(rig, 2);
    const reads = countReads(rig.host);
    const calls = rig.host.quietCalls.length;
    await rig.turn(chatId, "I wait.", "Time passes.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(calls);
    expect(reads.count()).toBe(0);
  });

  test("the copy follows the host's edits, swipes, deletions and new messages without reading again", async () => {
    const rig = new Rig();
    const chatId = await playedChat(rig, 3);
    rig.body(await rig.send({ type: "lre.hello", chatId, client: { version: "test" } }));
    const reads = countReads(rig.host);
    const same = async (): Promise<void> => {
      await rig.host.settle();
      expect(await rig.rt.host.chats.messages(chatId, rig.host.userId)).toEqual(await reads.real(chatId, rig.host.userId));
    };
    const replies = (await reads.real(chatId, rig.host.userId)).filter((m) => !m.isUser);
    const [first, head] = [replies.at(-3), replies.at(-1)];
    if (!first || !head) throw new Error("no replies");
    rig.host.editMessage(chatId, head.id, "The square is loud.");
    await same();
    rig.host.addSwipe(chatId, head.id, "A bell rings.");
    await same();
    rig.host.navigate(chatId, head.id, 0);
    await same();
    rig.host.putSwipe(chatId, head.id, 1, "Two bells ring.");
    await same();
    rig.host.deleteSwipe(chatId, head.id, 1);
    await same();
    rig.host.sendUser(chatId, "I listen.");
    await same();
    // The host never renumbers (`index_in_chat`, which the fake host keeps the same way), so the copy
    // takes a deletion in place too.
    rig.host.deleteMessage(chatId, first.id);
    await same();
    expect(reads.count()).toBe(0);
  });

  test("the memory budget lets go of the chats no one uses, each read once when opened again; one a page shows, one holding a turn and the latest read stay", async () => {
    const rig = new Rig();
    const left = await playedChat(rig, 1);
    const shown = await playedChat(rig, 1);
    const waiting = await playedChat(rig, 1);
    // The engine prepared a turn for this chat, whose reply no page has started yet: it holds that turn.
    rig.host.sendUser(waiting, "I wait.");
    await rig.host.settle();
    expect((await rig.host.begin(waiting, { type: "normal" })).halted).toBe("cancelled");
    expect(rig.rt.ledger.preparedOf(waiting)).not.toBeNull();
    rig.body(await rig.send({ type: "lre.hello", chatId: left, viewing: true }, FakeHost.PAGE));
    rig.body(await rig.send({ type: "lre.hello", chatId: shown, viewing: true }, FakeHost.PAGE));
    expect(rig.rt.trimIdle()).toEqual({ messages: 1, ledgers: 1, views: 1, bridges: 1 });
    const reads = countReads(rig.host);
    for (const chatId of [shown, waiting]) await rig.rt.host.chats.messages(chatId, rig.host.userId);
    expect(reads.count()).toBe(0);
    rig.body(await rig.send({ type: "lre.hello", chatId: left, viewing: true }, FakeHost.PAGE));
    expect(reads.count()).toBe(1);
    // What went is built again as it was: the chat plays on.
    await rig.turn(left, "I walk on.", "The road is long.");
    expect(reads.count()).toBe(1);
    expect(rig.rt.ledger.errors).toEqual([]);
    // The page shows that chat now: the one it left is no one's.
    expect(rig.rt.trimIdle()).toEqual({ messages: 1, ledgers: 1, views: 1, bridges: 1 });
    await rig.rt.host.chats.messages(left, rig.host.userId);
    expect(reads.count()).toBe(1);
  });

  test("with no page saying which chat it shows, the memory budget keeps the chat read last", async () => {
    const rig = new Rig();
    const earlier = await playedChat(rig, 1);
    const latest = await playedChat(rig, 1);
    expect(rig.rt.trimIdle()).toEqual({ messages: 1, ledgers: 1, views: 1, bridges: 1 });
    const reads = countReads(rig.host);
    await rig.rt.host.chats.messages(latest, rig.host.userId);
    expect(reads.count()).toBe(0);
    await rig.rt.host.chats.messages(earlier, rig.host.userId);
    expect(reads.count()).toBe(1);
  });
});

describe("the copy, as the host's events and answers interleave", () => {
  test("a read under way takes the changes made while it reads, and is kept", async () => {
    const { host, cache, chatId, user } = await bareChat();
    const reads = slowReads(host);
    const reading = cache.host.chats.messages(chatId, user);
    const asking = cache.host.chats.messages(chatId, user);
    const [greeting, said] = host.chat(chatId).messages;
    if (!greeting || !said) throw new Error("no messages");
    host.editMessage(chatId, greeting.id, "The square is loud.");
    host.addSwipe(chatId, "reply-1", "Two bells ring.");
    host.sendUser(chatId, "I listen.");
    host.deleteMessage(chatId, said.id);
    await host.settle();
    reads.answer();
    const now = await reads.real(chatId, user);
    expect(await reading).toEqual(now);
    expect(await asking).toEqual(now);
    expect(await cache.host.chats.messages(chatId, user)).toEqual(now);
    expect(reads.count()).toBe(1);
  });

  test("events the host sent before a read was answered, arriving after it, leave the copy as the host has it", async () => {
    const { host, cache, chatId, user } = await bareChat();
    const reads = countReads(host);
    host.editMessage(chatId, "reply-1", "A bell rings twice.");
    host.navigate(chatId, "reply-1", 0);
    host.sendUser(chatId, "I listen.");
    expect(await cache.host.chats.messages(chatId, user)).toEqual(await reads.real(chatId, user));
    await host.settle();
    expect(await cache.host.chats.messages(chatId, user)).toEqual(await reads.real(chatId, user));
    expect(reads.count()).toBe(1);
  });

  test("the engine's metadata write is in the copy once the host takes it, whatever events for the chat come before and after it", async () => {
    const { host, cache, chatId, user } = await bareChat();
    const reads = countReads(host);
    await cache.host.chats.messages(chatId, user);
    const [greeting, said] = host.chat(chatId).messages;
    if (!greeting || !said) throw new Error("no messages");
    const same = async (): Promise<void> => expect(await cache.host.chats.messages(chatId, user)).toEqual(await reads.real(chatId, user));
    // While the write waits, the host edits the message written and adds another: their events come first.
    const write = host.chats.writeMetadata;
    const slow = slowWrites(host);
    const writing = cache.host.chats.writeMetadata(chatId, greeting.id, { other: { note: 1 } }, user);
    host.editMessage(chatId, greeting.id, "The square is loud.");
    host.sendUser(chatId, "I listen.");
    await host.settle();
    slow.take();
    await writing;
    // The write's own event hasn't come yet.
    await same();
    await host.settle();
    await same();
    // Two writes in a row, the first one's event arriving while the second waits.
    host.chats.writeMetadata = write;
    await cache.host.chats.writeMetadata(chatId, greeting.id, { other: { note: 2 } }, user);
    const later = slowWrites(host);
    const second = cache.host.chats.writeMetadata(chatId, said.id, { other: { note: 3 } }, user);
    await host.settle();
    later.take();
    await second;
    await same();
    await host.settle();
    await same();
    expect(reads.count()).toBe(1);
  });

  test("each user reads a chat once, and the host's events reach every user's copy", async () => {
    const { host, cache, chatId } = await bareChat();
    const reads = countReads(host);
    const users = ["user-1", "user-2"];
    for (const user of users) await cache.host.chats.messages(chatId, user);
    expect(reads.count()).toBe(2);
    host.editMessage(chatId, "reply-1", "A bell rings twice.");
    host.sendUser(chatId, "I listen.");
    await host.settle();
    await cache.host.chats.writeMetadata(chatId, "reply-1", { other: { note: 1 } }, "user-1");
    for (const user of users) expect(await cache.host.chats.messages(chatId, user)).toEqual(await reads.real(chatId, user));
    expect(reads.count()).toBe(2);
  });

  test("a reply saved without its event: the copy, which doesn't hold it, is read again at the generation's end", async () => {
    const { host, cache, chatId, user } = await bareChat();
    const reads = countReads(host);
    await cache.host.chats.messages(chatId, user);
    host.sendUser(chatId, "I wait.");
    await host.settle();
    await host.finish(await host.begin(chatId, { type: "normal", createAtEnd: true }), "Time passes.");
    expect(await cache.host.chats.messages(chatId, user)).toEqual(await reads.real(chatId, user));
    expect(reads.count()).toBe(1);
    host.sendUser(chatId, "I wait more.");
    await host.settle();
    host.lost.add("MESSAGE_SENT");
    await host.finish(await host.begin(chatId, { type: "normal", createAtEnd: true }), "More time passes.");
    expect(await cache.host.chats.messages(chatId, user)).toEqual(await reads.real(chatId, user));
    expect(reads.count()).toBe(2);
  });

  test("an event for a message the copy doesn't hold drops it, and the next read is the host's", async () => {
    const { host, cache, chatId, user } = await bareChat();
    const reads = countReads(host);
    await cache.host.chats.messages(chatId, user);
    host.append(host.chat(chatId), { id: "unseen", isUser: false, name: "Narrator", swipes: ["Written while the engine was away."], swipeId: 0, bag: {} });
    host.editMessage(chatId, "unseen", "Edited since.");
    await host.settle();
    expect(await cache.host.chats.messages(chatId, user)).toEqual(await reads.real(chatId, user));
    expect(reads.count()).toBe(2);
  });

  test("a chat forgotten while it is read answers that read, and is read afresh after", async () => {
    const { host, cache, chatId, user } = await bareChat();
    const reads = slowReads(host);
    const reading = cache.host.chats.messages(chatId, user);
    cache.forget(chatId);
    reads.answer();
    expect(await reading).toEqual(await reads.real(chatId, user));
    await cache.host.chats.messages(chatId, user);
    expect(reads.count()).toBe(2);
  });

  test("a persona rename shows the new names after it, read once; a change of the chat's record alone reads nothing", async () => {
    const { host, cache, chatId, user } = await bareChat();
    const reads = countReads(host);
    await cache.host.chats.messages(chatId, user);
    host.chatChanged({ chat: { id: chatId, name: "Renamed chat" }, changedFields: ["name"] });
    await host.settle();
    await cache.host.chats.messages(chatId, user);
    expect(reads.count()).toBe(1);
    host.sendUser(chatId, "I listen.");
    await host.settle();
    host.reattribute(chatId, "Persona B");
    await host.settle();
    const after = await cache.host.chats.messages(chatId, user);
    expect(after.filter((m) => m.isUser).map((m) => m.name)).toEqual(["Persona B", "Persona B"]);
    expect(after).toEqual(await reads.real(chatId, user));
    await cache.host.chats.messages(chatId, user);
    expect(reads.count()).toBe(2);
  });
});
