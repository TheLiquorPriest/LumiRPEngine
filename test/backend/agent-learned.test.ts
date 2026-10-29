// The agents' learned area (DESIGN §4.4): an index in the chat's metadata, beside its run and never in
// its ledger, so swipes never change it and a Lumiverse Branch keeps it as it stood when the branch
// was made, its files' bodies shared in the user's blob store. Every writer of LRE's key in a chat's
// metadata takes its turn in one queue, so two writes at once both stand.

import { describe, expect, test } from "bun:test";
import { BlobStore } from "../../src/backend/agents/blobs";
import { agentMetaOf, agentRefs, ChatAgentMeta, type LearnedFile } from "../../src/backend/chat-agent-meta";
import { chatKnowledgePrefsOf } from "../../src/backend/chat-knowledge-prefs";
import { isRecord } from "../../src/shared/json";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { blobHash } from "../../src/shared/stores";
import { Harness } from "../support/harness";
import { Rig } from "../support/rig";

/** A learned file of `hash`, read with everyone's knowledge, as the assistant writes one. */
const file = (hash: string): LearnedFile => ({ hash, readers: "everyone", role: "assistant" });

describe("the learned area", () => {
  test("a Branch keeps it as it stood at branch time, swipes never change it, and the chat's run stays beside it", async () => {
    const h = new Harness();
    const blobs = new BlobStore(h.host);
    const meta = new ChatAgentMeta(h.host);
    const user = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "look around");
    const run = structuredClone((await h.host.chats.chatMetadata(chat, user))[LEDGER_NAMESPACE]);
    const tea = await blobs.put(user, "Sam takes tea without sugar.", "learn");
    await meta.setLearned(chat, user, { "learned/people/sam.md": file(tea) });
    blobs.release(user, "learn");
    const own = (await h.host.chats.chatMetadata(chat, user))[LEDGER_NAMESPACE];
    expect(isRecord(own) && isRecord(run) ? { ...own, agents: undefined } : null).toEqual({ ...(isRecord(run) ? run : {}), agents: undefined });
    // A Re-run of the reply leaves it as it is.
    const head = h.host.head(chat);
    if (!head) throw new Error("no reply");
    await h.host.finish(await h.host.start(chat, { type: "swipe", messageId: head.id }), "Again.");
    expect((await meta.get(chat, user)).learned).toEqual({ "learned/people/sam.md": file(tea) });
    const branch = h.host.branch(chat, head.id);
    // What the parent learns after the branch is its own.
    const coffee = await blobs.put(user, "Sam switched to coffee.");
    await meta.setLearned(chat, user, { "learned/people/sam.md": file(coffee), "learned/places/pier.md": file(await blobs.put(user, "The pier opens at dawn.")) });
    expect(Object.keys((await meta.get(chat, user)).learned).sort()).toEqual(["learned/people/sam.md", "learned/places/pier.md"]);
    expect((await meta.get(branch, user)).learned).toEqual({ "learned/people/sam.md": file(tea) });
    expect(await blobs.get(user, tea)).toBe("Sam takes tea without sugar.");
    // The branch learns on its own, and its records still fold beside it.
    await meta.setLearned(branch, user, { "learned/people/sam.md": null });
    expect((await meta.get(branch, user)).learned).toEqual({});
    expect((await meta.get(chat, user)).learned["learned/people/sam.md"]?.hash).toBe(coffee);
    await h.service.open(branch, user);
    await h.host.settle();
    expect((await h.folds(branch)).reference.violations).toEqual([]);
  });

  test("an entry that doesn't read is left out, a path outside learned/, a bad hash or readers are refused, and a chat that plays no world has none", async () => {
    const h = new Harness();
    const meta = new ChatAgentMeta(h.host);
    const user = h.host.userId;
    const chat = await h.newChat();
    const hash = blobHash("kept");
    const kept = { hash, readers: "gm" };
    await h.host.chats.mergeChatMetadata(chat, { [LEDGER_NAMESPACE]: { ...((await h.host.chats.chatMetadata(chat, user))[LEDGER_NAMESPACE] as object), agents: { learned: { "learned/a.md": kept, "notes/b.md": kept, "learned/c.md": { hash: "not a hash", readers: "gm" }, "learned/d.md": { hash, readers: "nobody" }, "learned/e.md": hash } } } }, user);
    const read = agentMetaOf(await h.host.chats.chatMetadata(chat, user));
    expect(read.learned).toEqual({ "learned/a.md": { hash, readers: "gm" } });
    expect(agentRefs(await h.host.chats.chatMetadata(chat, user))).toEqual([hash]);
    await expect(meta.setLearned(chat, user, { "/learned": file(hash) })).rejects.toThrow();
    await expect(meta.setLearned(chat, user, { "notes/d.md": file(hash) })).rejects.toThrow();
    await expect(meta.setLearned(chat, user, { "learned/d.md": file("nope") })).rejects.toThrow();
    const plain = h.host.createChat("Hello.");
    await expect(meta.setLearned(plain, user, { "learned/a.md": file(hash) })).rejects.toThrow();
    expect((await meta.get(plain, user)).learned).toEqual({});
  });
});

describe("LRE's writes of a chat's metadata", () => {
  test("a narrator choice, an assistant save and a learned file written at once all stand, each host read and write yielding first", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const user = rig.host.userId;
    const message = blobHash("A message of the GM assistant's thread.");
    // Spindle's chat reads and writes are round trips: each yields before it answers, as the real host's do, so writes not in one queue interleave.
    const chats = rig.host.chats;
    const read = chats.chatMetadata.bind(chats);
    const write = chats.mergeChatMetadata.bind(chats);
    chats.chatMetadata = async (...args) => {
      await Promise.resolve();
      return read(...args);
    };
    chats.mergeChatMetadata = async (...args) => {
      await Promise.resolve();
      return write(...args);
    };
    await Promise.all([
      rig.rt.chatKnowledge.set(chatId, user, { narrator: { knowledge: "pov", secrets: "omit" } }),
      rig.rt.chatAgents.setAssistant(chatId, user, (now) => ({ messages: [...now.messages, message], proposals: now.proposals })),
      rig.rt.chatAgents.setLearned(chatId, user, { "learned/jordan.md": file(blobHash("Jordan Ellis asks before acting.")) }),
    ]);
    const meta = await read(chatId, user);
    expect(agentMetaOf(meta).assistant.messages).toEqual([message]);
    expect(Object.keys(agentMetaOf(meta).learned)).toEqual(["learned/jordan.md"]);
    expect(chatKnowledgePrefsOf(meta).narrator).toEqual({ knowledge: "pov", secrets: "omit" });
  });
});
