// The blob sweep (DESIGN §4.4): what nothing references any more is removed once its retention has
// passed, counted from the first sweep that found it so, and never while a turn runs. Every swipe's
// record in every chat, every chat's layer (its held drafts too), every learned index, the user's global
// workspace, Diagnostics' kept texts and the work in flight keep what they name, so a Branch still
// resolves after its parent is pruned.

import { describe, expect, test } from "bun:test";
import { BLOBS_DIR, BlobStore } from "../../src/backend/agents/blobs";
import { Sessions, sessionAt } from "../../src/backend/agents/sessions";
import { Sweep, SWEEP_PATH } from "../../src/backend/agents/sweep";
import { ChatAgentMeta } from "../../src/backend/chat-agent-meta";
import { Diagnostics } from "../../src/backend/diagnostics";
import { GLOBAL_INDEX_PATH, GlobalWorkspace } from "../../src/backend/global-workspace";
import { decodeLedger } from "../../src/backend/ledger-io";
import type { DiagAgentCall } from "../../src/shared/diagnostics";
import type { ChatId, MessageId, UserId } from "../../src/shared/ids";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { DAY_MS, HOUR_MS, RETENTION_DEFAULTS, type RetentionSettings } from "../../src/shared/stores";
import { workspaceOf, wsWrite } from "../../src/engine/workspace";
import { layerDir } from "../../src/backend/layer-store";
import storyPack from "../../src/packs/story/core/index";
import type { LayerDraft } from "../../src/shared/layer";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { JsonObject } from "../../src/shared/json";
import { beatEvent, beatId, type Beat } from "../../src/shared/story";
import { MIND_TAKE } from "../../src/shared/character-engine";
import { STORY_DRAFT } from "../../src/shared/episodes";
import { POV } from "../support/test-pack";
import type { Generation } from "../support/fake-host";
import { Harness } from "../support/harness";

const DAY0 = Date.UTC(2026, 9, 1);

const CALL: Omit<DiagAgentCall, "text"> = { role: "gm", connection: "active", model: "fake", usage: null, ms: 5, outcome: "ok" };

/** A world chat's ledger, the agent stores over its host, and the sweep, on a clock the test moves. */
class Stores {
  readonly h: Harness;
  readonly user: UserId;
  readonly blobs: BlobStore;
  readonly sessions: Sessions;
  readonly meta: ChatAgentMeta;
  /** The user's global workspace; a test may swap in a fresh one, which reads its index from storage again. */
  global: GlobalWorkspace;
  now = DAY0;
  readonly diag: Diagnostics;
  /** Done once while the next sweep reads what references what: a put, or a turn starting. */
  during: (() => Promise<unknown>) | null = null;
  readonly retention: RetentionSettings;
  readonly sweep: Sweep;

  constructor(retention: Partial<RetentionSettings> = {}, h = new Harness()) {
    this.h = h;
    this.user = h.host.userId;
    this.blobs = new BlobStore(h.host);
    this.sessions = new Sessions(this.blobs, h.service);
    this.meta = new ChatAgentMeta(h.host);
    this.global = new GlobalWorkspace(h.host);
    this.diag = new Diagnostics(h.host, { blobs: this.blobs, now: () => this.now });
    this.retention = { ...RETENTION_DEFAULTS, ...retention };
    this.sweep = new Sweep({
      host: this.h.host,
      messages: (chatId, userId) => this.h.host.chats.messages(chatId, userId),
      blobs: this.blobs,
      retention: async () => ({ ...this.retention }),
      turning: (userId) => this.h.service.turning(userId),
      journals: (userId) => this.h.service.journals(userId),
      transcripts: async (chatId, userId) => {
        const work = this.during;
        this.during = null;
        await work?.();
        return this.diag.transcripts(chatId, userId);
      },
      global: (userId) => this.global.refs(userId),
      now: () => this.now,
    });
  }

  /** The clock, `days` after the start. */
  at(days: number): void {
    this.now = DAY0 + days * DAY_MS;
  }
}

/** The latest reply's turn closes: its segment, holding `text`, is written into its record. */
async function close(t: Stores, chat: ChatId, text: string): Promise<{ messageId: MessageId; swipeId: number; segment: string }> {
  const head = t.h.host.head(chat);
  if (!head) throw new Error("no reply");
  const at = { messageId: head.id, swipeId: head.swipeId };
  const holder = `close-${head.id}-${head.swipeId}`;
  const segment = await t.sessions.segment(t.user, holder, [{ role: "assistant", content: text }]);
  expect(await t.sessions.record(chat, t.user, holder, at, { segment })).toBeNull();
  await t.h.host.settle();
  return { ...at, segment };
}

/** The latest reply's turn closes with a transcript, `text`, written at `at` (none: a record kept before its time was noted); its hash. */
async function transcribed(t: Stores, chat: ChatId, text: string, at?: number): Promise<string> {
  const head = t.h.host.head(chat);
  if (!head) throw new Error("no reply");
  const holder = `transcript-${head.id}-${head.swipeId}`;
  const transcript = await t.blobs.put(t.user, text, holder);
  expect(await t.sessions.record(chat, t.user, holder, { messageId: head.id, swipeId: head.swipeId }, { transcript, transcriptChars: text.length, ...(at !== undefined ? { transcriptAt: at } : {}) })).toBeNull();
  await t.h.host.settle();
  return transcript;
}

/** The GM writes a workspace file: a `fix` entry on the head, as GM → Workspace writes land. */
async function gmFile(t: Stores, chat: ChatId, path: string, text: string): Promise<string> {
  const holder = `gm-${path}`;
  const hash = await t.blobs.put(t.user, text, holder);
  const written = await t.h.write(chat, { kind: "post", id: holder, target: "head", entry: { kind: "fix", gm: true, events: [wsWrite(path, hash)] } });
  t.blobs.release(t.user, holder);
  expect(written.applied).toBe(true);
  return hash;
}

async function learn(t: Stores, chat: ChatId, path: string, text: string): Promise<void> {
  const hash = await t.blobs.put(t.user, text, "learn");
  await t.meta.setLearned(chat, t.user, { [path]: { hash, role: "assistant" } });
  t.blobs.release(t.user, "learn");
}

/** Everything the chat's agents read back: its session, its workspace's files, its learned files and its agent calls' texts. */
async function resolved(t: Stores, chat: ChatId): Promise<{ session: string[]; missing: string[]; files: Record<string, string | null>; learned: Record<string, string | null>; calls: (string | null)[] }> {
  const core = await t.h.core(chat);
  const session = await t.sessions.resume(t.user, await t.h.chain(chat), core.journal.tombstones);
  const files: Record<string, string | null> = {};
  for (const [path, hash] of Object.entries(workspaceOf((await t.h.folds(chat)).optimized.state))) files[path] = await t.blobs.get(t.user, hash);
  const learned: Record<string, string | null> = {};
  for (const [path, file] of Object.entries((await t.meta.get(chat, t.user)).learned)) learned[path] = await t.blobs.get(t.user, file.hash);
  const calls = await Promise.all((await t.diag.transcripts(chat, t.user)).map((hash) => t.blobs.get(t.user, hash)));
  return { session: session.messages.map((m) => String(m.content)), missing: session.missing, files, learned, calls };
}

describe("the blob sweep", () => {
  test("a Branch still resolves after its parent is pruned; what only the pruned part named goes once its retention has passed, never at the first sweep to find it", async () => {
    const t = new Stores();
    const chat = await t.h.newChat();
    await t.h.send(chat, "look around");
    const first = await close(t, chat, "one");
    await gmFile(t, chat, "notes/sam.md", "Sam keeps the harbour ledger.");
    await learn(t, chat, "learned/people/sam.md", "Sam takes tea without sugar.");
    await t.h.send(chat, "earn:5");
    await close(t, chat, "two");
    await gmFile(t, chat, "notes/pier.md", "The pier opens at dawn.");
    // A Branch at the first reply, with an agent call of its own whose text Diagnostics keeps.
    const branch = t.h.host.branch(chat, first.messageId);
    await t.h.service.open(branch, t.user);
    await t.h.host.settle();
    await t.diag.agentCall({ chatId: branch, userId: t.user, turn: null }, null, CALL, "Asked where Sam keeps the ledger; answered: at the harbour.");
    const branched = await resolved(t, branch);
    expect(branched).toEqual({ session: ["one"], missing: [], files: { "notes/sam.md": "Sam keeps the harbour ledger." }, learned: { "learned/people/sam.md": "Sam takes tea without sugar." }, calls: ["Asked where Sam keeps the ledger; answered: at the harbour."] });
    // The parent is pruned: its second turn goes, with its segment and the file written on it.
    const messages = t.h.host.chat(chat).messages;
    for (const m of messages.slice(messages.findIndex((x) => x.id === first.messageId) + 1)) t.h.host.deleteMessage(chat, m.id);
    await t.h.host.settle();
    const pruned = await resolved(t, chat);
    expect(pruned).toEqual({ session: ["one"], missing: [], files: { "notes/sam.md": "Sam keeps the harbour ledger." }, learned: { "learned/people/sam.md": "Sam takes tea without sugar." }, calls: [] });

    // The first sweep, long after the prune, only finds them; they go a retention later.
    t.at(20);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 6, referenced: 4, found: 2, removed: 0 });
    t.at(26);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, found: 0, removed: 0 });
    t.at(27);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 6, referenced: 4, removed: 2 });
    expect(await t.blobs.list(t.user)).toHaveLength(4);
    expect(await resolved(t, branch)).toEqual(branched);
    expect(await resolved(t, chat)).toEqual(pruned);
    // What is still referenced stays, sweep after sweep.
    t.at(28);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 4, referenced: 4, found: 0, removed: 0 });
    await t.diag.settle();
  });

  test("a chat whose metadata no longer shows it as LRE's still has its records read: what they name stays", async () => {
    const t = new Stores();
    const chat = await t.h.newChat();
    await t.h.send(chat, "look around");
    await close(t, chat, "one");
    const ledger = await gmFile(t, chat, "notes/sam.md", "Sam keeps the harbour ledger.");
    await t.h.host.settle();
    // Another writer's merge dropped LRE's key: the chat list no longer shows it as an engine chat.
    delete t.h.host.chat(chat).metadata[LEDGER_NAMESPACE];
    for (const days of [0, 8, 30]) {
      t.at(days);
      expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, found: 0, removed: 0 });
    }
    expect(await t.blobs.get(t.user, ledger)).toBe("Sam keeps the harbour ledger.");
    await t.diag.settle();
  });

  test("a compaction's summary and archived span keep the segments they read once the messages that wrote them are deleted", async () => {
    const t = new Stores();
    const chat = await t.h.newChat();
    for (const [text, line] of [["look around", "one"], ["earn:5", "two"], ["earn:7", "three"]] as const) {
      await t.h.send(chat, text);
      await close(t, chat, line);
    }
    // The fourth turn compacts all but the last segment before it adds its own.
    await t.h.send(chat, "look around");
    const fourth = t.h.host.head(chat);
    if (!fourth) throw new Error("no reply");
    const chain = await t.h.chain(chat);
    const compacted = await t.sessions.compact(t.user, "t4", sessionAt(chain.slice(0, chain.findIndex((m) => m.id === fourth.id)), []), "Earlier, Sam looked around and was paid twice.", 1);
    const four = await t.sessions.segment(t.user, "t4", [{ role: "assistant", content: "four" }]);
    expect(await t.sessions.record(chat, t.user, "t4", { messageId: fourth.id, swipeId: fourth.swipeId }, { segment: four, ...compacted })).toBeNull();
    await t.h.host.settle();
    // The three turns before it are deleted: only the summary and the span name their segments now.
    for (const m of t.h.host.chat(chat).messages.slice(1, -2)) t.h.host.deleteMessage(chat, m.id);
    await t.h.host.settle();
    for (const days of [0, 8, 30]) {
      t.at(days);
      expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 6, referenced: 6, found: 0, removed: 0 });
    }
    const { tombstones } = (await t.h.core(chat)).journal;
    const session = await t.sessions.resume(t.user, await t.h.chain(chat), tombstones);
    expect({ summary: session.summary, messages: session.messages.map((m) => m.content), missing: session.missing }).toEqual({ summary: "Earlier, Sam looked around and was paid twice.", messages: ["three", "four"], missing: [] });
    // A rollback still finds the archived span whole.
    const at = sessionAt(await t.h.chain(chat), tombstones);
    const rolled = await t.sessions.rollback(t.user, "t5", at, compacted.archived);
    if (!rolled) throw new Error("no archived span");
    const back = await t.sessions.load(t.user, { base: rolled.summary, segments: [], archived: rolled.archived });
    expect({ messages: back.messages.map((m) => m.content), missing: back.missing }).toEqual({ messages: ["one", "two", "three", "four"], missing: [] });
    t.blobs.release(t.user, "t5");
  });

  test("what work in flight holds and what is put while a sweep looks are kept, a put restarts a blob's clock, and no sweep runs during a turn", async () => {
    const t = new Stores();
    const chat = await t.h.newChat();
    await t.h.send(chat, "look around");
    await close(t, chat, "one");
    const draft = await t.blobs.put(t.user, "A draft the turn hasn't recorded yet.");
    const again = await t.blobs.put(t.user, "Notes put again while a sweep looks.");
    const twice = await t.blobs.put(t.user, "A note written twice.");
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 4, referenced: 1, found: 3, removed: 0 });
    // Put again on day 6: its clock starts over.
    t.at(6);
    await t.blobs.put(t.user, "A note written twice.");
    // Day 8: a turn's work holds the draft, and the notes are put again while the sweep looks.
    t.at(8);
    t.blobs.hold(t.user, "turn-2", draft);
    t.during = () => t.blobs.put(t.user, "Notes put again while a sweep looks.");
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 4, referenced: 3, found: 1, removed: 0 });
    t.blobs.release(t.user, "turn-2");
    // Each of their clocks started again: the note's on day 8, the draft's and the notes' on day 9.
    t.at(9);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, referenced: 1, found: 2, removed: 0 });
    t.at(15);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, removed: 1 });
    expect(await t.blobs.get(t.user, twice)).toBeNull();
    t.at(16);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, removed: 2 });
    expect([await t.blobs.get(t.user, draft), await t.blobs.get(t.user, again)]).toEqual([null, null]);

    const junk = await t.blobs.put(t.user, "Nothing names this.");
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, found: 1 });
    // Day 30: a turn starts while the sweep looks, so it removes nothing.
    t.at(30);
    t.h.host.sendUser(chat, "earn:5");
    await t.h.host.settle();
    const started: { turn?: Generation } = {};
    t.during = async () => {
      started.turn = await t.h.host.start(chat, { type: "normal" });
    };
    const stopped = await t.sweep.run(t.user);
    expect(stopped).toMatchObject({ ran: true, removed: 0 });
    expect(stopped.ran ? stopped.stopped : undefined).toBeDefined();
    // While it runs, a sweep is refused and a nudge does nothing.
    expect(t.h.service.turning(t.user)).toBe(true);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: false });
    t.at(40);
    t.sweep.nudge(t.user);
    await t.sweep.settle();
    expect(await t.blobs.get(t.user, junk)).toBe("Nothing names this.");
    if (!started.turn) throw new Error("no turn");
    await t.h.host.finish(started.turn, "Okay.");
    expect(t.h.service.turning(t.user)).toBe(false);
    t.sweep.nudge(t.user);
    await t.sweep.settle();
    expect(await t.blobs.get(t.user, junk)).toBeNull();
  });

  test("while what a chat references can't be read, a sweep removes nothing", async () => {
    const t = new Stores();
    const chat = await t.h.newChat();
    await t.h.send(chat, "look around");
    const { segment } = await close(t, chat, "one");
    const other = await t.h.newChat("Evening, Sam.");
    await t.h.send(other, "look around");
    await close(t, other, "elsewhere");
    const junk = [await t.blobs.put(t.user, "Nothing names this."), await t.blobs.put(t.user, "Nor this.")];
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, found: 2, removed: 0 });
    // The other chat's reply loses a chunk of its engine data to a write the engine hasn't heard of.
    const reply = t.h.host.head(other);
    if (!reply) throw new Error("no reply");
    const bag = structuredClone(reply.bag);
    reply.bag = { ...bag, [LEDGER_NAMESPACE]: { v: 1, chunks: 2, hash: "0".repeat(32) }, [`${LEDGER_NAMESPACE}:0`]: '{"v":1,' };
    t.at(8);
    const damaged = await t.sweep.run(t.user);
    expect(damaged).toMatchObject({ ran: true, removed: 0 });
    expect(damaged.ran ? damaged.stopped : undefined).toBeDefined();
    // Then the host can't give the chat's messages at all.
    reply.bag = bag;
    const messages = t.h.host.chats.messages;
    t.h.host.chats.messages = async (chatId, userId) => {
      if (chatId === other) throw new Error("the host is busy");
      return messages(chatId, userId);
    };
    t.at(9);
    const unread = await t.sweep.run(t.user);
    expect(unread).toMatchObject({ ran: true, removed: 0 });
    expect(unread.ran ? unread.stopped : undefined).toBeDefined();
    expect(await Promise.all(junk.map((hash) => t.blobs.get(t.user, hash)))).toEqual(["Nothing names this.", "Nor this."]);
    // Once it reads again, what the earlier sweep found goes.
    t.h.host.chats.messages = messages;
    t.at(10);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, removed: 2 });
    expect(await Promise.all(junk.map((hash) => t.blobs.get(t.user, hash)))).toEqual([null, null]);
    expect(await t.blobs.get(t.user, segment)).not.toBeNull();
  });

  test("the global workspace keeps its files' bodies while its index names them, in no chat at all; one taken out goes a retention later, and while the index can't be read nothing goes", async () => {
    const t = new Stores();
    const chat = await t.h.newChat();
    await t.h.send(chat, "look around");
    await close(t, chat, "one");
    const style = await t.blobs.put(t.user, "Keep replies short.", "global");
    const agents = await t.blobs.put(t.user, "Every agent: name a place the first time it matters.", "global");
    await t.global.set(t.user, { "~/notes/style.md": { hash: style, role: "gm" }, "~/AGENTS.md": { hash: agents, pinned: true, role: "main" } });
    t.blobs.release(t.user, "global");
    // No chat's record or metadata names them: the index alone keeps them, sweep after sweep.
    for (const days of [0, 8, 30]) {
      t.at(days);
      expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 3, referenced: 3, found: 0, removed: 0 });
    }
    // The index is the user's, in their storage: a fresh store reads it back whole.
    expect(t.h.host.files.has(`${t.user}/${GLOBAL_INDEX_PATH}`)).toBe(true);
    expect(await new GlobalWorkspace(t.h.host).get(t.user)).toEqual({ "~/AGENTS.md": { hash: agents, pinned: true, role: "main" }, "~/notes/style.md": { hash: style, role: "gm" } });
    // Taken out of the index, its body is found unreferenced, and goes only a retention later.
    await t.global.set(t.user, { "~/notes/style.md": null });
    t.at(31);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, referenced: 2, found: 1, removed: 0 });
    // Meanwhile the index can't be read: what is still referenced isn't known, so nothing goes.
    const read = t.h.host.storage.read;
    t.h.host.storage.read = async (path, userId) => {
      if (path === GLOBAL_INDEX_PATH) throw new Error("the host is busy");
      return read(path, userId);
    };
    t.global = new GlobalWorkspace(t.h.host);
    t.at(38);
    const unread = await t.sweep.run(t.user);
    expect(unread).toMatchObject({ ran: true, removed: 0 });
    expect(unread.ran ? unread.stopped : undefined).toContain("the global workspace");
    expect(await t.blobs.get(t.user, style)).toBe("Keep replies short.");
    // Read again, the file taken out goes; the one still named stays.
    t.h.host.storage.read = read;
    t.at(39);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, referenced: 2, removed: 1 });
    expect([await t.blobs.get(t.user, style), await t.blobs.get(t.user, agents)]).toEqual([null, "Every agent: name a place the first time it matters."]);
  });

  test("a record only a closed chat's journal still holds keeps what it names, and the chat writes it back when it opens", async () => {
    const t = new Stores();
    const chat = await t.h.newChat();
    await t.h.send(chat, "look around");
    const { messageId, swipeId, segment } = await close(t, chat, "one");
    // The idle chat is let go, then its reply's engine data is lost to a write the engine never hears of.
    expect(t.h.service.trim(() => false)).toContain(chat);
    const reply = t.h.host.message(chat, messageId);
    const { [LEDGER_NAMESPACE]: _lost, ...rest } = reply.bag;
    reply.bag = rest;
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 1, referenced: 1, found: 0 });
    t.at(8);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, referenced: 1, removed: 0 });
    await t.h.service.open(chat, t.user);
    await t.h.host.settle();
    expect(decodeLedger(t.h.host.message(chat, messageId).bag)?.swipes[String(swipeId)]?.session?.segment).toBe(segment);
    expect((await resolved(t, chat)).session).toEqual(["one"]);
  });

  test("a nudge sweeps once when one is due, never while sweeps are off, and writes nothing for a user who stored no blob", async () => {
    const t = new Stores({ sweepHours: "none" });
    let blobLists = 0;
    const list = t.h.host.storage.list;
    t.h.host.storage.list = async (prefix, userId) => {
      if (prefix === BLOBS_DIR) blobLists++;
      return list(prefix, userId);
    };
    let chatLists = 0;
    const chats = t.h.host.chats.list;
    t.h.host.chats.list = async (userId) => {
      chatLists++;
      return chats(userId);
    };
    const chat = await t.h.newChat();
    await t.h.send(chat, "look around");
    const files = [...t.h.host.files.keys()].sort();
    // No blob stored: a due nudge looks once, writes nothing, and knows when it looked.
    t.retention.sweepHours = 24;
    t.sweep.nudge(t.user);
    await t.sweep.settle();
    t.sweep.nudge(t.user);
    await t.sweep.settle();
    expect(blobLists).toBe(1);
    t.now += 24 * HOUR_MS;
    t.sweep.nudge(t.user);
    await t.sweep.settle();
    expect(blobLists).toBe(2);
    expect([...t.h.host.files.keys()].sort()).toEqual(files);
    expect(chatLists).toBe(0);

    // Sweeps off: no nudge sweeps, however long it has been.
    t.retention.sweepHours = "none";
    const junk = await t.blobs.put(t.user, "Nothing names this.");
    for (const days of [1, 30, 365]) {
      t.at(days);
      t.sweep.nudge(t.user);
      await t.sweep.settle();
    }
    expect(chatLists).toBe(0);
    expect(t.h.host.files.has(`${t.user}/${SWEEP_PATH}`)).toBe(false);
    // Back on: a due nudge sweeps once, however often it is nudged.
    t.retention.sweepHours = 24;
    t.sweep.nudge(t.user);
    t.sweep.nudge(t.user);
    await t.sweep.settle();
    t.sweep.nudge(t.user);
    await t.sweep.settle();
    expect(chatLists).toBe(1);
    expect(t.h.host.files.has(`${t.user}/${SWEEP_PATH}`)).toBe(true);
    // A day on it is due again: the blob it found unreferenced a day ago stays, until its retention has passed.
    t.at(366);
    t.sweep.nudge(t.user);
    await t.sweep.settle();
    expect(chatLists).toBe(2);
    expect(await t.blobs.get(t.user, junk)).toBe("Nothing names this.");
    t.at(372);
    t.sweep.nudge(t.user);
    await t.sweep.settle();
    expect(chatLists).toBe(3);
    expect(await t.blobs.get(t.user, junk)).toBeNull();
  });

  test("a turn's transcript past a chat's latest turns (Settings → Agents → Retention) is no longer referenced and goes a retention later; each chat counts its own, so a Branch keeps the one its chain ends on", async () => {
    const t = new Stores({ unreferencedDays: 0 });
    const chat = await t.h.newChat();
    const transcripts: string[] = [];
    for (const [i, text] of ["look around", "earn:5", "earn:7"].entries()) {
      await t.h.send(chat, text);
      transcripts.push(await transcribed(t, chat, `Everything turn ${i + 1}'s agents did.`, DAY0 + i * DAY_MS));
    }
    const [first, second, third] = transcripts;
    // A Branch ends on the second turn's reply.
    const replies = t.h.host.chat(chat).messages.filter((m) => !m.isUser);
    const branch = t.h.host.branch(chat, replies[2]?.id ?? "");
    await t.h.service.open(branch, t.user);
    await t.h.host.settle();
    // Every turn keeps its transcript by default, however many and however old.
    t.at(400);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 3, referenced: 3, found: 0 });
    // One turn a chat: the parent keeps its third, the Branch its second; the first goes.
    t.retention.turnTranscripts = 1;
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 3, referenced: 2, found: 1, removed: 0 });
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 3, referenced: 2, removed: 1 });
    expect(await t.blobs.get(t.user, first ?? "")).toBeNull();
    expect(await t.blobs.get(t.user, second ?? "")).toBe("Everything turn 2's agents did.");
    expect(await t.blobs.get(t.user, third ?? "")).toBe("Everything turn 3's agents did.");
    // A record only the chat's journal holds counts the same: the chat let go, its replies' engine data lost to another writer.
    expect(t.h.service.trim(() => false)).toContain(chat);
    for (const m of t.h.host.chat(chat).messages) {
      const { [LEDGER_NAMESPACE]: _lost, ...rest } = m.bag;
      m.bag = rest;
    }
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 2, referenced: 2, found: 0, removed: 0 });
    await t.diag.settle();
  });

  test("a turn's transcript written longer ago than its age (Settings → Agents → Retention) goes a retention later; one whose record never noted when it was written stays", async () => {
    const t = new Stores({ unreferencedDays: 0, turnTranscriptDays: 2 });
    const chat = await t.h.newChat();
    await t.h.send(chat, "look around");
    const undated = await transcribed(t, chat, "An earlier build's transcript.");
    await t.h.send(chat, "earn:5");
    const old = await transcribed(t, chat, "A transcript four days old.", DAY0);
    await t.h.send(chat, "earn:7");
    const recent = await transcribed(t, chat, "A transcript a day old.", DAY0 + 3 * DAY_MS);
    t.at(4);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 3, referenced: 2, found: 1 });
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 3, referenced: 2, removed: 1 });
    expect([await t.blobs.get(t.user, undated), await t.blobs.get(t.user, old), await t.blobs.get(t.user, recent)]).toEqual(["An earlier build's transcript.", null, "A transcript a day old."]);
    // Exactly its age is still within it.
    t.at(5);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 2, referenced: 2, found: 0 });
    await t.diag.settle();
  });

  test("a layer's entries and held drafts keep the blobs their beats, mind takes and reasoning name; a branch's own copy keeps them once its parent is gone, and once no layer names them they go a retention later", async () => {
    const t = new Stores({}, new Harness("fresh", { packs: [storyPack] }));
    const chat = await t.h.newChat();
    await t.h.send(chat, "look around");
    const head = t.h.host.head(chat);
    if (!head) throw new Error("no reply");
    const basis = await t.h.service.basisFor(chat, t.user, head.id);
    if (!basis) throw new Error("no basis");
    const put = (text: string): Promise<string> => t.blobs.put(t.user, text);
    const beat = async (seed: string): Promise<Beat> => ({ id: beatId(seed), at: 0, order: 0, place: "home", actors: [POV], act: "said", about: [], what: await put(`What ${seed} was.`), surface: await put(`How ${seed} looked.`), exposure: [{ who: POV, channel: "hearing", reach: "whole" }], by: { turn: seed, decided: "player" } });
    const rosa: LedgerEvent = { type: "spawn", entity: { id: "rosa", kind: "person", name: "Rosa Vance", tier: "background", fields: {}, relations: [] } };
    const take = async (b: Beat, text: string): Promise<LedgerEvent> => ({ type: MIND_TAKE, data: { who: "rosa", at: 0, lived: [b.id], take: await put(text) } });
    // Landed: a beat, a newcomer's take on it, and the author's reasoning.
    const landedBeat = await beat("landed");
    const landed = await t.h.service.landLayer(chat, t.user, { id: "e-landed", basis, kind: "story.beat", events: [beatEvent(landedBeat), rosa, await take(landedBeat, "Rosa thinks Sam is hiding something.")], reasoning: await put("Whether Rosa would notice.") });
    expect(landed.status).toBe("landed");
    await t.h.host.settle();
    // Held, as the store keeps a draft while a turn is in flight: a draft's own beats and the changes it would make.
    const heldBeat = await beat("held");
    const effects = [await take(heldBeat, "Rosa means to ask the harbourmaster.")];
    const draft: LayerDraft = { id: "d-held", basis, kind: STORY_DRAFT, events: [{ type: STORY_DRAFT, data: { beats: [heldBeat], effects } as unknown as JsonObject }], reasoning: await put("What the episode would do off screen.") };
    await t.h.host.storage.write(`${layerDir(chat)}/held.json`, JSON.stringify([{ draft, waitFor: ["g-in-flight"] }]), t.user);
    const junk = await put("Nothing names this.");
    // A branch at the reply copies what its parent landed into its own layer; held drafts stay the parent's.
    const branch = t.h.host.branch(chat, head.id);
    await t.h.host.chats.mergeChatMetadata(branch, { branched_from: chat, branch_at_message: head.id }, t.user);
    await t.h.service.open(branch, t.user);
    await t.h.host.settle();
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 9, referenced: 8, found: 1, removed: 0 });
    t.at(7);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 9, referenced: 8, removed: 1 });
    expect(await t.blobs.get(t.user, junk)).toBeNull();
    // The parent goes, with its layer: the held draft's blobs are found unreferenced; the branch's copy keeps the landed entry's.
    t.h.host.deleteChat(chat);
    await t.h.host.settle();
    t.at(8);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 8, referenced: 4, found: 4, removed: 0 });
    t.at(15);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 8, referenced: 4, removed: 4 });
    expect(await Promise.all([landedBeat.what, landedBeat.surface].map((hash) => t.blobs.get(t.user, hash)))).toEqual(["What landed was.", "How landed looked."]);
    expect(await Promise.all([heldBeat.what, heldBeat.surface].map((hash) => t.blobs.get(t.user, hash)))).toEqual([null, null]);
    // Then the branch goes too, and nothing names what its layer held.
    t.h.host.deleteChat(branch);
    await t.h.host.settle();
    t.at(16);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 4, referenced: 0, found: 4, removed: 0 });
    t.at(23);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored: 4, referenced: 0, removed: 4 });
  });

  test("a blob a single layer entry alone names (a beat, a mind write, a notebook revision, a held draft) survives the sweep; one nothing names goes after unreferencedDays", async () => {
    const t = new Stores({}, new Harness("fresh", { packs: [storyPack] }));
    const chat = await t.h.newChat();
    await t.h.send(chat, "look around");
    const head = t.h.host.head(chat);
    if (!head) throw new Error("no reply");
    const basis = await t.h.service.basisFor(chat, t.user, head.id);
    if (!basis) throw new Error("no basis");
    const before = (await t.sweep.run(t.user)) as { stored: number };
    const put = (text: string): Promise<string> => t.blobs.put(t.user, text);
    const surface = await put("A shared surface.");
    const beat = async (seed: string): Promise<Beat> => ({ id: beatId(seed), at: 0, order: 0, place: "home", actors: [POV], act: "said", about: [], what: await put(`Only the ${seed} beat names this.`), surface, exposure: [{ who: POV, channel: "hearing", reach: "whole" }], by: { turn: seed, decided: "player" } });
    const land = async (id: string, kind: string, events: LedgerEvent[]): Promise<void> => {
      expect((await t.h.service.landLayer(chat, t.user, { id, basis, kind, events })).status).toBe("landed");
      await t.h.host.settle();
    };
    const landedBeat = await beat("landed");
    await land("e-beat", "story.beat", [beatEvent(landedBeat)]);
    const rosa: LedgerEvent = { type: "spawn", entity: { id: "rosa", kind: "person", name: "Rosa Vance", tier: "background", fields: {}, relations: [] } };
    const mind = await put("Only a mind write names this.");
    await land("e-mind", "story.beat", [rosa, { type: MIND_TAKE, data: { who: "rosa", at: 0, lived: [landedBeat.id], take: mind } }]);
    const page = await put("Only a notebook revision names this.");
    await land("e-notebook", "story.beat", [wsWrite("notebook/arcs/rosa.md", page)]);
    const heldBeat = await beat("held");
    const draft: LayerDraft = { id: "d-held", basis, kind: STORY_DRAFT, events: [{ type: STORY_DRAFT, data: { beats: [heldBeat], effects: [] } as unknown as JsonObject }] };
    await t.h.host.storage.write(`${layerDir(chat)}/held.json`, JSON.stringify([{ draft, waitFor: ["g-in-flight"] }]), t.user);
    const junk = await put("Nothing names this.");
    const kept = [landedBeat.what, surface, mind, page, heldBeat.what];
    const stored = (before.stored ?? 0) + kept.length + 1;
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored, referenced: stored - 1, found: 1, removed: 0 });
    t.at(t.retention.unreferencedDays);
    expect(await t.sweep.run(t.user)).toMatchObject({ ran: true, stored, referenced: stored - 1, removed: 1 });
    expect(await t.blobs.get(t.user, junk)).toBeNull();
    expect(await Promise.all(kept.map((hash) => t.blobs.get(t.user, hash)))).toEqual(["Only the landed beat names this.", "A shared surface.", "Only a mind write names this.", "Only a notebook revision names this.", "Only the held beat names this."]);
  });
});
