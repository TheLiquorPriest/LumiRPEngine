// A long chat read by the prepared start: 1,200 messages, about 8 MB of text, made up here. Each tool
// is called as a job's run calls it (`prepareEnv` builds the same: the engine's own host, the reader
// outside a turn, the story record on the chat's first reply read through the run's kept read); the
// page is asked as the page asks. Every ask for the whole chat through the engine's host is counted,
// and charged 2 seconds, as a read of a chat this long costs where the engine keeps no copy of it.

import { describe, expect, test } from "bun:test";
import type { ToolEnv } from "../../src/backend/agents/tools/registry";
import { chatRead } from "../../src/backend/chat-read";
import type { HarnessCore } from "../../src/backend/harness/extension";
import type { HostPort } from "../../src/backend/host";
import { preparePage } from "../../src/backend/story/prepare";
import { chatStoryPort } from "../../src/backend/story/record";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { PREPARE_STORY } from "../../src/shared/harness-texts-prepare";
import type { JsonObject } from "../../src/shared/json";
import type { Rig } from "../support/rig";
import { mount, playOn } from "./harness-driver";
import { call, castChat, castEnv, castTurn, memoryFiles } from "./harness-cast-kit";

const MESSAGES = 1200;
/** What a read of the whole chat is charged, in milliseconds. */
const WHOLE_MS = 2000;

/** A seeded generator (mulberry32), so every run makes the same chat. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = "the a street morning light window coffee table door quiet slowly turns walks says looks small warm rain evening room chair book phone road market bread river bridge train station paper letter garden wall stairs kitchen laughs nods waits listens smiles after before while under over near again still then and but with into from across softly bright cold old new long short".split(" ");

function filler(rand: () => number, chars: number): string {
  const parts: string[] = [];
  let length = 0;
  while (length < chars) {
    const word = `${WORDS[Math.floor(rand() * WORDS.length)] ?? "the"}${rand() < 0.01 ? ".\n" : rand() < 0.08 ? ". " : " "}`;
    parts.push(word);
    length += word.length;
  }
  return parts.join("").slice(0, chars);
}

interface Long {
  rig: Rig;
  chatId: string;
  env: ToolEnv;
  /** The asks for the whole chat through the engine's host so far. */
  reads: { n: number };
}

/** A cast chat grown to 1,200 messages, opened by a backend that has just started, with the author's env in a preparation the player started and the page's harness in place; `chatMs`: how long the user keeps a chat read for its agents. */
async function longChat(chatMs?: number): Promise<Long> {
  const made = await castChat();
  const chat = made.rig.host.chat(made.chatId);
  const rand = seeded(7);
  for (let i = 1; i < MESSAGES; i++) made.rig.host.append(chat, { id: `old-${i}`, isUser: i % 2 === 1, name: i % 2 === 1 ? "User" : "Narrator", swipes: [filler(rand, i % 2 === 1 ? 600 : 13_000)], swipeId: 0, bag: {} });
  const rig = made.rig.restart();
  const userId = rig.host.userId;
  if (chatMs !== undefined) rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { kept: { chatMs } } } }));
  const settings = await rig.rt.settings.get(userId);
  const prepared = { ...settings, story: { ...settings.story, prepare: { ...settings.story.prepare, askAboveTokens: 100_000_000 } } };
  const files = memoryFiles();
  // The story as the author understands it, which a plan on a chat with a history is written from.
  await files.write(PREPARE_STORY, "Mara keeps the boarding house.", null);
  const kept = async () => (await chatRead(rig.rt.host, { chatId: made.chatId, userId }, settings.agents.kept.chatMs)).messages;
  const story = chatStoryPort(rig.rt, { chatId: made.chatId, userId, turn: "job-1", on: "first", messages: kept });
  const turn = await castTurn(rig, made.chatId, { main: false, settings: prepared, story, host: rig.rt.host, job: { id: "job-1", byUser: true } });
  const env: ToolEnv = { ...castEnv(rig, made.chatId, turn, HARNESS_AGENT.author), files };
  mount(rig);
  await playOn(rig, made.chatId, "harness");
  const core: HarnessCore = { ask: async () => ({ jobs: [] }), stop: () => undefined, spent: () => null };
  rig.rt.harness.core = core;
  rig.rt.harness.files = () => files;
  const reads = { n: 0 };
  const engine: HostPort["chats"] = rig.rt.host.chats;
  const through = engine.messages;
  engine.messages = async (chatId, user) => {
    reads.n++;
    return through(chatId, user);
  };
  return { rig, chatId: made.chatId, env, reads };
}

/** What a call asked of the whole chat, and its answer. */
async function counted(long: Long, run: () => Promise<string>): Promise<{ reads: number; ms: number; text: string }> {
  const before = long.reads.n;
  const t0 = performance.now();
  const text = await run();
  const reads = long.reads.n - before;
  return { reads, ms: reads * WHOLE_MS + Math.round(performance.now() - t0), text };
}

const tool = (env: ToolEnv, name: string, args: JsonObject = {}) => async (): Promise<string> => {
  const out = await call(env, name, args);
  if (out.error) throw new Error(`${name}: ${out.text}`);
  return out.text;
};

const page = (long: Long) => async (): Promise<string> => JSON.stringify(await preparePage(long.rig.rt, { chatId: long.chatId, userId: long.rig.host.userId }, { op: "get" }));

/** The survey and the plan of one stretch, #1 to #40, and that stretch opened: where each test of reading starts. */
async function planned(long: Long): Promise<void> {
  const { env } = long;
  for (const part of ["summaries", "lore"]) await tool(env, "prepare_survey", { part })();
  await tool(env, "prepare_plan", { about: "Mara keeps the boarding house.", principals: [{ who: "Mara", why: "The story is hers." }], stretches: [{ from: 1, to: 40, why: "Where it starts.", who: ["Mara"] }], depth: "all", depthWhy: "The story is short enough to relive whole." })();
  await tool(env, "prepare_relive", { stretch: "s1" })();
}

describe("a long chat read by the prepared start", () => {
  test("each tool reads the chat once: a second call reads none of it, prepare_status none at all, and the page none once the file exists", async () => {
    const long = await longChat();
    const { env } = long;
    const table: string[] = [];
    const note = async (label: string, run: () => Promise<string>): Promise<number> => {
      const m = await counted(long, run);
      table.push(`${label}: ${m.reads} whole-chat reads, ${m.ms} ms`);
      return m.reads;
    };
    expect(await note("page, no file yet", page(long))).toBe(1);
    expect(await note("prepare_survey", tool(env, "prepare_survey"))).toBe(0);
    expect(await note("prepare_survey chat", tool(env, "prepare_survey", { part: "chat" }))).toBe(0);
    for (const part of ["summaries", "lore"]) expect(await note(`prepare_survey ${part}`, tool(env, "prepare_survey", { part }))).toBe(0);
    expect(await note("prepare_plan", tool(env, "prepare_plan", { about: "Mara keeps the boarding house.", principals: [{ who: "Mara", why: "The story is hers." }], stretches: [{ from: 1, to: 40, why: "Where it starts.", who: ["Mara"] }], depth: "all", depthWhy: "The story is short enough to relive whole." }))).toBe(0);
    expect(await note("prepare_relive (opens a stretch)", tool(env, "prepare_relive", { stretch: "s1" }))).toBe(0);
    expect(await note("prepare_status", tool(env, "prepare_status"))).toBe(0);
    for (const n of [1, 2, 3]) expect(await note(`stretch_read ${n}`, tool(env, "stretch_read", { stretch: "s1", from: 1 + (n - 1) * 3 }))).toBe(0);
    for (const n of [1, 2, 3, 4, 5]) expect(await note(`page ${n}`, page(long))).toBe(0);
    // A change ends the kept read: prepare_status still reads nothing, and the page with its file nothing either.
    long.rig.host.editMessage(long.chatId, "old-5", "Mara counts the rent money twice.");
    expect(await note("prepare_status after an edit", tool(env, "prepare_status"))).toBe(0);
    expect(await note("page after an edit", page(long))).toBe(0);
    console.log(table.join("\n"));
  }, 60_000);

  test("a message added, edited, deleted or swiped between two calls is read again, and the next call sees it", async () => {
    const long = await longChat();
    const { rig, chatId, env } = long;
    await planned(long);
    const read = (from: number) => tool(env, "stretch_read", { stretch: "s1", from });
    const changes: [string, () => void, () => Promise<string>, string, boolean][] = [
      ["edited", () => rig.host.editMessage(chatId, "old-3", "Joss writes the ferry times on the wall."), read(3), "ferry times", true],
      ["swiped", () => rig.host.addSwipe(chatId, "old-4", "The harbour bell rings twice."), read(4), "harbour bell", true],
      ["added", () => void rig.host.sendUser(chatId, "I ask Mara about the lighthouse song."), tool(env, "prepare_survey", { part: "chat" }), `"messages":${MESSAGES + 1}`, true],
      ["deleted", () => rig.host.deleteMessage(chatId, "old-1199"), tool(env, "prepare_survey", { part: "chat" }), `"messages":${MESSAGES}`, true],
    ];
    for (const [what, change, next, text, seen] of changes) {
      await counted(long, next);
      change();
      // The host tells of the change as Lumiverse does: by its event, once delivered.
      await rig.host.settle();
      const m = await counted(long, next);
      expect({ what, readAgain: m.reads > 0, seen: m.text.includes(text) }).toEqual({ what, readAgain: true, seen });
      expect({ what, then: (await counted(long, next)).reads }).toEqual({ what, then: 0 });
    }
  }, 60_000);

  test("with keeping off, every call reads the chat again", async () => {
    const long = await longChat(0);
    for (const n of [1, 2, 3]) expect({ n, reads: (await counted(long, tool(long.env, "prepare_survey", { part: "chat" }))).reads > 0 }).toEqual({ n, reads: true });
  }, 60_000);
});
