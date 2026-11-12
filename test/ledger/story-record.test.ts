// The story record's part of a reply's record (`Rec.story`, DEPTH2-PLAN §4) on the fake host: it is
// outside every hash, so writing it moves no path and no state; it follows a swipe and a branch as the
// record does; a reply that holds no record is given a bare one to hold it (`LedgerCore.recordStory`);
// a draft goes stale when the point of the chat it was written against leaves the path; and the
// story's prepared start keeps its record on the chat's first reply, where a new telling of the
// newest reply leaves it.

import { describe, expect, test } from "bun:test";
import { decodeLedger } from "../../src/backend/ledger-io";
import { chatStoryPort, type StoryRuntime } from "../../src/backend/story/record";
import { hashJson } from "../../src/shared/hash";
import type { ChatId } from "../../src/shared/ids";
import { isRecord } from "../../src/shared/json";
import { type Beat, type ChatRun, type Draft, LEDGER_NAMESPACE, type RecStory } from "../../src/shared/ledger";
import { type DraftDue, draftsDue } from "../../src/engine/story/drafts";
import { recStoryOf } from "../../src/engine/story/record";
import { Harness } from "../support/harness";

const beat = (id: string, what: string): Beat => ({ id, turn: "turn-1", at: 600, where: null, by: "world", kind: "happen", what, surface: what, exposure: [{ who: "player", reach: "whole" }], decidedBy: { agent: "author" } });

/** What the story record reaches of the backend, on the test harness: its ledger and host, and the chat's run as its metadata holds it. */
function storyRuntime(h: Harness): StoryRuntime {
  return {
    ledger: h.service,
    host: h.host,
    async runOf(chatId: ChatId): Promise<ChatRun | null> {
      const raw = (await h.host.chats.chatMetadata(chatId, h.host.userId))[LEDGER_NAMESPACE];
      // The harness wrote it as a ChatRun (`Harness.newChat`); the story record only asks whether the chat plays a world.
      return isRecord(raw) ? (raw as unknown as ChatRun) : null;
    },
  };
}

async function storyOf(h: Harness, chatId: ChatId): Promise<{ beats: string[]; drafts: DraftDue[] }> {
  const read = await chatStoryPort(storyRuntime(h), { chatId, userId: h.host.userId, turn: "test", on: "last" }).read();
  if (!read) throw new Error(`${chatId} plays no world`);
  return { beats: read.path.beats.map((b) => b.beat.id), drafts: draftsDue(read.path, 0, read.onPath) };
}

async function write(h: Harness, chatId: ChatId, messageId: string, story: RecStory): Promise<string | null> {
  const refused = await h.service.recordStory(chatId, h.host.userId, () => ({ messageId, swipeId: 0, story }));
  await h.host.settle();
  return refused;
}

function replies(h: Harness, chatId: ChatId): string[] {
  return h.host.chat(chatId).messages.filter((m) => !m.isUser).map((m) => m.id);
}

describe("the story record's part of a record", () => {
  test("it moves no path and no state, a reply with no record takes a bare one, and it follows a swipe and a branch as the record does", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "look around", "The street is quiet.");
    await h.send(chat, "earn:5", "Payday.");
    const [greeting = "", , head = ""] = replies(h, chat);
    const before = await h.folds(chat);
    expect((await h.chain(chat)).find((m) => m.id === greeting)?.ledger?.swipes["0"]).toBeUndefined();
    expect(await write(h, chat, greeting, { beats: [beat("b-greeting", "The day starts.")] })).toBeNull();
    expect(await write(h, chat, head, { beats: [beat("b-head", "Sam is paid.")], cast: [{ entity: "player", standing: "principal", digestedTo: "b-greeting" }] })).toBeNull();
    const after = await h.folds(chat);
    expect(hashJson(after.optimized.state)).toBe(hashJson(before.optimized.state));
    expect(after.optimized.messages).toEqual(before.optimized.messages);
    expect(hashJson(after.reference.state)).toBe(hashJson(before.reference.state));
    expect(after.reference.violations).toEqual([]);
    expect(h.service.errors).toEqual([]);
    // The greeting's bare record holds the part and nothing else; the head's is in its message's metadata.
    const bare = (await h.chain(chat)).find((m) => m.id === greeting)?.ledger?.swipes["0"];
    expect({ path: bare?.path, events: bare?.events.length, beats: recStoryOf(bare).beats.map((b) => b.id) }).toEqual({ path: "", events: 0, beats: ["b-greeting"] });
    const stored = decodeLedger(h.host.chat(chat).messages.find((m) => m.id === head)?.bag ?? {})?.swipes["0"];
    expect(recStoryOf(stored).cast).toEqual([{ entity: "player", standing: "principal", digestedTo: "b-greeting" }]);
    expect((await storyOf(h, chat)).beats).toEqual(["b-greeting", "b-head"]);
    // A new telling of the reply holds a record of its own, with no story: going back to the first brings it back.
    const g = await h.host.start(chat, { type: "swipe", messageId: head });
    await h.host.finish(g, "Payday, once more.");
    expect((await storyOf(h, chat)).beats).toEqual(["b-greeting"]);
    h.host.navigate(chat, head, 0);
    await h.host.settle();
    expect((await storyOf(h, chat)).beats).toEqual(["b-greeting", "b-head"]);
    // A branch copies the records, the story with them.
    const copy = h.host.branch(chat, head);
    await h.service.open(copy, h.host.userId);
    expect((await storyOf(h, copy)).beats).toEqual(["b-greeting", "b-head"]);
  });

  test("a draft goes stale when the point of the chat it was written against leaves the path, and a branch's copy of it is still on its path", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "look around", "The street is quiet.");
    await h.send(chat, "earn:5", "Payday.");
    const [, first = "", head = ""] = replies(h, chat);
    const seq = (await h.chain(chat)).find((m) => m.id === first)?.ledger?.swipes["0"]?.seq;
    const draft: Draft = { id: "d-heist", what: "The guild robs the docks.", tier: 3, who: ["player"], when: 10_000, basis: { messageId: first, swipeId: 0, ...(seq !== undefined ? { seq } : {}) }, state: "open" };
    expect(await write(h, chat, head, { drafts: [draft] })).toBeNull();
    expect((await storyOf(h, chat)).drafts).toEqual([]);
    const copy = h.host.branch(chat, head);
    await h.service.open(copy, h.host.userId);
    expect((await storyOf(h, copy)).drafts).toEqual([]);
    h.host.deleteMessage(chat, first);
    await h.host.settle();
    expect((await storyOf(h, chat)).drafts.map((d) => ({ id: d.draft.id, basisGone: d.basisGone, due: d.due }))).toEqual([{ id: "d-heist", basisGone: true, due: false }]);
  });

  test("the prepared start's record is kept on the chat's first reply, so a new telling of the newest reply keeps it; any other job of the player's writes on the newest", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "look around", "The street is quiet.");
    await h.send(chat, "earn:5", "Payday.");
    const [greeting = "", , head = ""] = replies(h, chat);
    const at = { chatId: chat, userId: h.host.userId };
    const past: RecStory = { beats: [beat("b-past", "Sam moved to the city.")], cast: [{ entity: "player", standing: "principal", digestedTo: "b-past" }] };
    expect(await chatStoryPort(storyRuntime(h), { ...at, turn: "job-prepare", on: "first" }).write(past)).toEqual({ kept: true });
    expect(await chatStoryPort(storyRuntime(h), { ...at, turn: "job-other", on: "last" }).write({ beats: [beat("b-other", "Sam counts the pay.")] })).toEqual({ kept: true });
    await h.host.settle();
    expect(recStoryOf((await h.chain(chat)).find((m) => m.id === greeting)?.ledger?.swipes["0"]).beats.map((b) => b.id)).toEqual(["b-past"]);
    expect((await storyOf(h, chat)).beats).toEqual(["b-past", "b-other"]);
    // A new telling of the newest reply takes the other job's beat away with the old telling; the prepared start's past and casting stay on the path.
    const g = await h.host.start(chat, { type: "swipe", messageId: head });
    await h.host.finish(g, "Payday, once more.");
    expect((await storyOf(h, chat)).beats).toEqual(["b-past"]);
    const read = await chatStoryPort(storyRuntime(h), { ...at, turn: "read", on: "first" }).read();
    expect(read?.path.cast).toEqual([{ entity: "player", standing: "principal", digestedTo: "b-past" }]);
  });
});
