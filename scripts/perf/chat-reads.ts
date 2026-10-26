// Chat reads on a long chat (DESIGN §9.6): how often the engine reads a whole chat from the host, and
// what its process's RSS and heap peak at, in a fake-host session over a synthetic chat as long as the
// longest played ones (870 messages) whose rows carry the host's reasoning as Lumiverse keeps it in
// each message's `extra` (`reasoning`, `reasoningBySwipe`, `reasoningCarrier`,
// `reasoningCarrierBySwipe`: about 185 KB a row on average, so a read moves about 175 MB).
//
// The engine runs in a child Bun process, as on the host (`--spindle-subprocess`), and reads the chat
// through the Spindle adapter (`createSpindleHost().chats.messages`, `decodeMessage`). This process
// plays the host's side of a read: it sends the rows' reasoning over Bun's IPC with the host's
// `advanced` serialization, so the child receives and deserializes what it does on the host; the rows'
// text and metadata are cloned in the child the same way. The chat is generated filler on a shipped
// starter world, its text plain ASCII (one byte a character in memory; text past Latin-1 takes two).
//
// Measured: whole-chat reads (the host's `getMessages`) per step: the chat's open (a page's hello and
// its inspector), each typed turn by phase (the player's message, pre, plan, the reply's generation,
// its read), each Send after a reply, and a move to another long chat and back; the child's RSS,
// sampled every 2 ms from a worker thread (the peak per step) and the OS high-water mark, and its JS
// heap; and what the memory budget let go, wired as the backend wires it (`watchMemory`). The fake
// host's own copy of the chats (their text, about 14 MB each) sits in the child too; the baseline
// includes it.
//
// Usage: bun scripts/perf/chat-reads.ts [--messages 870] [--reasoning-kb 185] [--turns 2] [--limit-mb 768]
// Writes its JSON report to stdout, and to `LRE_EVIDENCE_DIR` when set.

import { writeFileSync } from "node:fs";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { HostMessage } from "../../src/backend/host";
import { MEMORY_LIMIT_BYTES, watchMemory } from "../../src/backend/memory-budget";
import { createSpindleHost } from "../../src/backend/spindle-host";
import { FakeHost } from "../../test/support/fake-host";
import { plainMinds, Rig } from "../../test/support/rig";

const EVIDENCE = process.env.LRE_EVIDENCE_DIR;
const MB = 1024 * 1024;
const mb = (bytes: number): number => Math.round((bytes / MB) * 10) / 10;

function flag(name: string, fallback: number): number {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? Number(process.argv[at + 1]) : fallback;
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} takes a number`);
  return value;
}

const MESSAGES = flag("messages", 870);
const REASONING_KB = flag("reasoning-kb", 185);
const TURNS = flag("turns", 2);
const LIMIT_MB = flag("limit-mb", MEMORY_LIMIT_BYTES / MB);

/** Words for filler text: plain, and no one's world. */
const WORDS = "the a street morning light window coffee table door quiet slowly turns walks says looks small warm rain evening room chair book phone car road market bread river bridge train station paper letter garden wall stairs kitchen laughs nods waits listens smiles after before while under over near again still then and but with into from across softly bright cold old new long short".split(" ");

/** A seeded generator (mulberry32), so every run builds the same chat. */
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

function filler(rand: () => number, chars: number): string {
  const parts: string[] = [];
  let length = 0;
  while (length < chars) {
    const word = `${WORDS[Math.floor(rand() * WORDS.length)] ?? "the"}${rand() < 0.08 ? ". " : " "}`;
    parts.push(word);
    length += word.length;
  }
  return parts.join("").slice(0, chars);
}

/** Message sizes as the longest chats have them: a reply of about 12.5 KB, a player's message of 600 characters, every other reply a second swipe. */
const USER_CHARS = 600;
const REPLY_CHARS = 12_500;

/** The reasoning keys' shares of a row's reasoning, as Lumiverse's rows on such a chat split it. */
const SHARES = { reasoningCarrierBySwipe: 0.347, reasoningCarrier: 0.3, reasoningBySwipe: 0.209, reasoning: 0.144 };

interface RowAsk {
  assistant: boolean;
  swipes: number;
}

type ToChild = { t: "extras"; rid: number; extras: JsonObject[] };
type ToParent = { t: "extras"; rid: number; rows: RowAsk[] } | { t: "report"; report: JsonObject };

// ---------------------------------------------------------------- the host's side

async function hostSide(): Promise<void> {
  const master = filler(seeded(7), 1_500_000);
  let offset = 0;
  // Each string a different slice, so none is sent as another's repeat.
  const take = (chars: number): string => {
    const n = Math.max(1, Math.round(chars));
    offset = (offset + 997) % (master.length - n);
    return master.slice(offset, offset + n);
  };
  let report: JsonObject | null = null;
  const child = Bun.spawn({
    cmd: [process.execPath, import.meta.path, "--engine", ...process.argv.slice(2)],
    serialization: "advanced",
    stdout: "inherit",
    stderr: "inherit",
    ipc(message: ToParent, sub) {
      if (message.t === "report") {
        report = message.report;
        return;
      }
      // The reasoning of the chat's rows, about REASONING_KB a row on average, all of it on the replies.
      const replies = message.rows.filter((r) => r.assistant).length;
      const perReply = replies === 0 ? 0 : (REASONING_KB * 1024 * message.rows.length) / replies;
      const extras = message.rows.map((row, i): JsonObject => {
        if (!row.assistant) return { persona_id: "persona-1" };
        const n = Math.max(1, row.swipes);
        return {
          character_id: "character-1",
          reasoning: take(perReply * SHARES.reasoning),
          reasoningBySwipe: Array.from({ length: n }, () => take((perReply * SHARES.reasoningBySwipe) / n)),
          reasoningCarrier: { kind: "reasoning_content", text: take(perReply * SHARES.reasoningCarrier) },
          reasoningCarrierBySwipe: Array.from({ length: n }, () => ({ kind: "reasoning_content", text: take((perReply * SHARES.reasoningCarrierBySwipe) / n) })),
          usage: { prompt_tokens: 12_000 + i, completion_tokens: 900, total_tokens: 12_900 + i },
          tokenCount: 900,
        };
      });
      const reply: ToChild = { t: "extras", rid: message.rid, extras };
      sub.send(reply);
    },
  });
  const code = await child.exited;
  if (code !== 0 || report === null) throw new Error(`the engine's process failed (exit ${code})`);
  console.log(JSON.stringify(report, null, 1));
  if (EVIDENCE) {
    const file = `${EVIDENCE}/perf-chat-reads-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.error(`evidence: ${file}`);
  }
}

// ---------------------------------------------------------------- the engine's side

/** Samples the process's RSS every 2 ms on a worker thread, so a peak inside a synchronous stretch of the engine is seen. */
function rssSampler(): { stop: () => Promise<[number, number][]> } {
  const code = `const series = []; const timer = setInterval(() => series.push([performance.timeOrigin + performance.now(), process.memoryUsage.rss()]), 2);
self.onmessage = () => { clearInterval(timer); postMessage(series); };`;
  const worker = new Worker(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
  return {
    stop: () => {
      const { promise, resolve } = Promise.withResolvers<[number, number][]>();
      worker.onmessage = (event: MessageEvent<[number, number][]>) => {
        resolve(event.data);
        void worker.terminate();
      };
      worker.postMessage("stop");
      return promise;
    },
  };
}

async function engineSide(): Promise<void> {
  const sampler = rssSampler();
  const now = (): number => performance.timeOrigin + performance.now();
  const pending = new Map<number, (extras: JsonObject[]) => void>();
  let rids = 0;
  process.on("message", (message: ToChild) => {
    pending.get(message.rid)?.(message.extras);
    pending.delete(message.rid);
  });
  const ask = (rows: RowAsk[]): Promise<JsonObject[]> => {
    const rid = ++rids;
    const { promise, resolve } = Promise.withResolvers<JsonObject[]>();
    pending.set(rid, resolve);
    const message: ToParent = { t: "extras", rid, rows };
    process.send?.(message);
    return promise;
  };

  // Where the session is, for the counts: the step (open, turn1, send1, …) and the phase in it.
  let step = "setup";
  let phase = "-";
  const marks: { t: number; step: string; phase: string }[] = [];
  const enter = (s: string, p: string): void => {
    step = s;
    phase = p;
    marks.push({ t: now(), step, phase });
  };
  const reads = new Map<string, number>();
  const heapPeak = new Map<string, number>();
  const sampleHeap = (): void => {
    const m = process.memoryUsage();
    heapPeak.set(step, Math.max(heapPeak.get(step) ?? 0, m.heapUsed));
  };

  const host = new FakeHost();
  // The host's handler for `chat.getMessages`: the chat's rows, `spindle_metadata` as `metadata`, the rest of `extra` beside it.
  const getMessages = async (chatId: string): Promise<unknown[]> => {
    const messages = host.chat(chatId).messages;
    const light = messages.map((m) => ({ id: m.id, chat_id: chatId, index_in_chat: m.index, is_user: m.isUser, name: m.name, role: m.isUser ? "user" : "assistant", content: m.swipes[m.swipeId] ?? "", send_date: 0, metadata: Object.keys(m.bag).length > 0 ? m.bag : undefined, swipe_id: m.swipeId, swipes: m.swipes, swipe_dates: m.swipes.map(() => 0), parent_message_id: null, branch_id: null, created_at: 0 }));
    const extras = await ask(messages.map((m) => ({ assistant: !m.isUser, swipes: m.swipes.length })));
    sampleHeap();
    // As they arrive over IPC: objects and strings of their own.
    const rows = structuredClone(light).map((row, i) => ({ ...row, extra: extras[i] ?? {} }));
    sampleHeap();
    return rows;
  };
  Object.assign(globalThis, { spindle: { contracts: {}, host: { capabilities: {} }, chat: { getMessages } } });
  const adapter = createSpindleHost().chats.messages;

  // The phases, marked as the host's events arrive (registered before the engine's, so they run first).
  let started = 0;
  const track = (): void => {
    host.on("GENERATION_STARTED", () => {
      started++;
      // The first generation of a turn is the one the guard stops (pre); the second is the reply's.
      if (started > 1) enter(step, "generation");
    });
    host.on("GENERATION_ENDED", () => enter(step, "read"));
  };

  track();
  let rig = new Rig({ shipped: true, host, minds: true });
  host.quietReply = plainMinds;
  const worldId = await rig.newWorld("Synthetic town", "modern_slice_of_life");
  const rand = seeded(42);
  const longChat = (): string => {
    const id = host.createChat(filler(rand, REPLY_CHARS));
    const chat = host.chat(id);
    for (let i = 1; i < MESSAGES; i++) {
      const isUser = i % 2 === 1;
      const swipes = isUser ? [filler(rand, USER_CHARS)] : i % 4 === 0 ? [filler(rand, REPLY_CHARS), filler(rand, REPLY_CHARS)] : [filler(rand, REPLY_CHARS)];
      host.append(chat, { id: `${id}-filler-${i}`, isUser, name: isUser ? "User" : "Narrator", swipes, swipeId: swipes.length - 1, bag: {} });
    }
    return id;
  };
  // Two long chats, attached as long ago, on the fake host's own reads (no reasoning): nothing of it is in the measure.
  const chatId = longChat();
  const other = longChat();
  for (const id of [chatId, other]) rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId: id }));
  const chat = host.chat(chatId);
  const size = {
    messages: chat.messages.length,
    contentMB: mb(chat.messages.reduce((sum, m) => sum + (m.swipes[m.swipeId] ?? "").length, 0)),
    swipesMB: mb(chat.messages.reduce((sum, m) => sum + m.swipes.reduce((s, x) => s + x.length, 0), 0)),
    reasoningMBPerRead: mb(REASONING_KB * 1024 * chat.messages.length),
  };
  // A fresh engine over the same host, as after the extension starts: nothing of the chats kept, and
  // every read of a chat from here on goes through the Spindle adapter, reasoning and all.
  host.restart();
  track();
  rig = new Rig({ shipped: true, host, minds: true });
  host.chats.messages = async (id): Promise<HostMessage[]> => {
    const key = `${step}\u0000${phase}`;
    reads.set(key, (reads.get(key) ?? 0) + 1);
    const out = await adapter(id, host.userId);
    sampleHeap();
    return out;
  };
  // The memory budget, as the backend runs it.
  const trims: string[] = [];
  const probe = { rss: () => process.memoryUsage.rss(), collect: () => void setTimeout(() => Bun.gc(true), 0) };
  const budget = watchMemory(rig.rt, probe, (line) => trims.push(`${step}: ${line}`), LIMIT_MB * MB);
  // Settled: the garbage collected and the pages the allocator gives back given back (its scavenger returns what it will within about ten seconds).
  const settled = async (): Promise<{ rss: number; heap: number }> => {
    Bun.gc(true);
    await Bun.sleep(12_000);
    return { rss: process.memoryUsage.rss(), heap: process.memoryUsage().heapUsed };
  };
  const baseline = await settled();
  heapPeak.clear();
  enter("baseline", "-");

  const ends = new Map<string, { rss: number; heap: number }>();
  const done = (s: string): void => {
    ends.set(s, { rss: process.memoryUsage.rss(), heap: process.memoryUsage().heapUsed });
    sampleHeap();
  };
  // A page opens a chat: its hello, then its inspector.
  const open = async (s: string, id: string): Promise<void> => {
    enter(s, "hello");
    rig.body(await rig.send({ type: "lre.hello", chatId: id, viewing: true }, FakeHost.PAGE));
    enter(s, "inspector");
    rig.body(await rig.send({ type: "lre.view.open", chatId: id, panel: "core.context", entity: null }, FakeHost.PAGE));
    await host.settle();
    done(s);
  };
  await open("open", chatId);
  const quiet = new Map<string, number>();
  const play = async (s: string, typed: string | null, reply: string): Promise<void> => {
    const calls = host.quietCalls.length;
    started = 0;
    if (typed !== null) {
      enter(s, "send");
      host.sendUser(chatId, typed);
      await host.settle();
    }
    enter(s, "pre");
    const g = await host.start(chatId, { type: "normal" });
    if (g.halted || !host.isOpen(g)) throw new Error(`${s}: the reply didn't start (${g.halted ?? "closed"}): ${rig.rt.ledger.errors.slice(-1).join("") || "see the chat's diagnostics"}`);
    await host.finish(g, reply);
    await host.settle();
    done(s);
    quiet.set(s, host.quietCalls.length - calls);
  };
  // The plan phase's steps, as the engine run names them.
  const diag = rig.rt.diag;
  const stepOf = diag.step.bind(diag);
  diag.step = (at, p, name, fn, judge, purposes) => {
    if (p === "plan" || p === "prose" || p === "sections") enter(step, "plan");
    return stepOf(at, p, name, fn, judge, purposes);
  };
  for (let t = 1; t <= TURNS; t++) {
    await play(`turn${t}`, filler(rand, USER_CHARS), filler(rand, REPLY_CHARS));
    await play(`send${t}`, null, filler(rand, REPLY_CHARS));
  }
  // The player moves to another long chat, then back.
  await open("other", other);
  await open("back", chatId);
  enter("end", "-");
  budget.stop();
  const after = await settled();
  const series = await sampler.stop();
  const steps = ["open", ...Array.from({ length: TURNS }, (_, i) => [`turn${i + 1}`, `send${i + 1}`]).flat(), "other", "back"];
  const peakRss = (s: string): number => {
    const from = marks.find((m) => m.step === s)?.t ?? Infinity;
    const to = marks.find((m) => m.t > from && m.step !== s)?.t ?? Infinity;
    return series.filter(([t]) => t >= from && t <= to).reduce((top, [, rss]) => Math.max(top, rss), 0);
  };
  const readsOf = (s: string): JsonObject => {
    const out: JsonObject = {};
    let total = 0;
    for (const [key, n] of reads) {
      const [k, p] = key.split("\u0000");
      if (k !== s || p === undefined) continue;
      out[p] = n;
      total += n;
    }
    return { total, ...out };
  };
  const report: JsonObject = {
    at: new Date().toISOString(),
    bun: Bun.version,
    platform: `${process.platform} ${process.arch}`,
    chat: size,
    reads: Object.fromEntries(steps.map((s) => [s, readsOf(s)])),
    quietCalls: Object.fromEntries([...quiet].map(([s, n]) => [s, n])),
    budget: { limitMB: LIMIT_MB, trims },
    memory: {
      baseline: { rssMB: mb(baseline.rss), heapMB: mb(baseline.heap) },
      ...Object.fromEntries(
        steps.map((s): [string, JsonValue] => [s, { peakRssMB: mb(peakRss(s)), endRssMB: mb(ends.get(s)?.rss ?? 0), peakHeapMB: mb(heapPeak.get(s) ?? 0), endHeapMB: mb(ends.get(s)?.heap ?? 0) }]),
      ),
      sessionPeakRssMB: mb(series.filter(([t]) => t >= (marks.find((m) => m.step === "open")?.t ?? 0)).reduce((top, [, rss]) => Math.max(top, rss), 0)),
      processMaxRssMB: mb(process.resourceUsage().maxRSS * 1024),
      settled: { rssMB: mb(after.rss), heapMB: mb(after.heap) },
    },
    errors: rig.rt.ledger.errors.slice(0, 5),
  };
  process.send?.({ t: "report", report } satisfies ToParent);
  // Let the report go out before the process ends.
  await Bun.sleep(200);
  process.exit(0);
}

if (process.argv.includes("--engine")) await engineSide();
else await hostSide();
