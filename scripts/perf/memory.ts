// How much memory RPE holds as chats are played, turn after turn (docs/troubleshooting.md). RPE's own application runs in
// this process on the turn bed of `test/turn/bed.ts`: the stand-in Lumiverse, a scratch data folder, every agent on one
// scripted model. Each of `--chats` chats plays `--turns` turns at once with the others; each turn's prompt holds about
// `--prompt` tokens (the preset's text and a full window of history), and the Author makes `--calls` calls in it: a look
// at the world, a delegate to the character, a note written and read again, a job started every `--job-every` turns, then
// its reply. After every `--every` turns, and once at rest before the first, it collects garbage and prints the resident
// size and the heap, and again `--rest` seconds after the last turn; at the turns `--at` names it writes the heap's objects
// by kind (and, with `--snapshots`, a heap snapshot Chrome's tools read) into `--out`. `--global` is added to the user's
// RPE-global.yml, to measure under other settings. What the bed and the stand-in record of each turn for tests is let go
// after each turn, so what grows is RPE's own; the stand-in Lumiverse's chats and database are in the same process and in
// the figures. Run from source, each worker thread RPE starts holds about 20 MB; run from the built file, more (the whole
// file is read on each thread): add the difference for each thread a server runs.
// Usage: bun scripts/perf/memory.ts [--turns 100] [--chats 1] [--every 10] [--calls 6] [--prompt 50000] [--job-every 5] [--rest 0] [--global yaml] [--at 10,100] [--out folder] [--snapshots]

import { heapStats, memoryUsage } from "bun:jsc";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Answer, RecordedRequest, Reply } from "rp-harness/testing/rig";
import type { ChatMessage } from "../../test/standin/lumiverse";
import { CHARACTER, CHAT, CONNECTION, openTurnBed, PRESET, type TurnBed, USER } from "../../test/turn/bed";

const { values: args } = parseArgs({
  options: {
    turns: { type: "string", default: "100" },
    chats: { type: "string", default: "1" },
    every: { type: "string", default: "10" },
    calls: { type: "string", default: "6" },
    prompt: { type: "string", default: "50000" },
    "job-every": { type: "string", default: "5" },
    at: { type: "string", default: "" },
    out: { type: "string", default: "" },
    snapshots: { type: "boolean", default: false },
    rest: { type: "string", default: "0" },
    global: { type: "string", default: "" },
  },
});
const TURNS = Number(args.turns);
const CHATS = Number(args.chats);
const EVERY = Number(args.every);
const CALLS = Math.max(4, Number(args.calls));
const PROMPT_TOKENS = Number(args.prompt);
const JOB_EVERY = Number(args["job-every"]);
const AT = new Set(args.at === "" ? [] : args.at.split(",").map(Number));
if (AT.size > 0 && args.out === "") throw new Error("--at needs --out, the folder the counts are written to");
if (args.out !== "") mkdirSync(args.out, { recursive: true });

// A turn waits on Lumiverse's requests over the network: give each wait of the bed a turn's length, not a test's.
process.env.RPE_TEST_LIMIT_MS = "600000";

/** Prose of about `chars` characters, different for each seed, as a story's text is. */
function prose(seed: number, chars: number): string {
  const words = ["the", "lamp", "turns", "above", "sea", "storm", "keeper", "Wren", "rope", "boat", "salt", "glass", "stairs", "brass", "oil", "night", "wind", "rock", "bell", "log", "harbour", "fog", "light", "tide", "gull", "door", "cold", "slow", "quiet", "loud"];
  let x = (seed * 2654435761) >>> 0;
  const out: string[] = [];
  let length = 0;
  while (length < chars) {
    x = (x * 1103515245 + 12345) >>> 0;
    const word = words[x % words.length]!;
    out.push(word);
    length += word.length + 1;
    if (x % 11 === 0) out.push(".");
  }
  return out.join(" ");
}

const REPLY_CHARS = 2_400;
const HISTORY = 40;
// The prompt: a full window of history, and the preset's own text making up the rest (a token is about four characters).
const PRESET_CHARS = Math.max(4_000, PROMPT_TOKENS * 4 - HISTORY * REPLY_CHARS);

let calls = 0;
let authorTurns = 0;
const note = prose(7, 1_200);

/** Every call's answer, whichever agent asks: the Author (it holds `job_start`) works through its turn; any other agent answers in prose. */
const route: Answer = (request: RecordedRequest): Reply => {
  calls += 1;
  bed?.model.add(route);
  // The scripted model keeps a copy of every request for tests: let it go.
  (bed?.model.requests as RecordedRequest[] | undefined)?.splice(0);
  const input = Math.ceil(JSON.stringify(request.messages).length / 4);
  if (!request.tools.some((t) => t.name === "job_start")) return { pieces: [{ text: prose(calls, 600) }], usage: { input, output: 150 } };
  const lastUser = request.messages.findLastIndex((m) => m.role === "user");
  const step = request.messages.slice(lastUser + 1).filter((m) => m.role === "assistant").length;
  if (step === 0) {
    authorTurns += 1;
    const job = JOB_EVERY > 0 && authorTurns % JOB_EVERY === 0 ? [{ call: "job_start", args: { agent: "historian", brief: `Tally the keeper's log, part ${authorTurns}.` } }] : [];
    return { pieces: [{ text: `<intent>${prose(authorTurns, 300)}</intent>` }, { call: "world_query", args: { at: "world" } }, ...job], usage: { input, output: 200 } };
  }
  if (step === 1) return { pieces: [{ call: "delegate", args: { agent: "character", brief: `The player asks about the boat, turn ${authorTurns}.`, plays: CHARACTER.name } }], usage: { input, output: 60 } };
  if (step === 2) return { pieces: [{ call: "file_write", args: { path: "scratch/scene.md", op: "write", text: note } }], usage: { input, output: 300 } };
  if (step < CALLS - 1) return { pieces: [step % 2 === 0 ? { call: "world_query", args: { at: "world" } } : { call: "file_read", args: { path: "scratch/scene.md" } }], usage: { input, output: 30 } };
  return { pieces: [{ text: `<reply>${prose(calls, REPLY_CHARS)}</reply>` }], usage: { input, output: REPLY_CHARS / 4 } };
};

let bed: TurnBed | null = null;
const MiB = 1024 * 1024;
const mb = (n: number): string => (n / MiB).toFixed(1);

function measure(turn: number): void {
  Bun.gc(true);
  const m = memoryUsage();
  const h = heapStats();
  // The resident size now and at its highest, and what the allocator outside the heap holds from the system: what a freed object leaves held shows there, not in the heap.
  console.log(`turn ${String(turn).padStart(4)}  rss ${mb(m.current)} MB (peak ${mb(m.peak)} MB)  heap ${mb(h.heapSize)} MB of ${mb(h.heapCapacity)} MB  extra ${mb(h.extraMemorySize)} MB  allocator ${mb(m.currentCommit)} MB  objects ${h.objectCount}  calls ${calls}`);
  if (!AT.has(turn)) return;
  const counts = Object.entries(h.objectTypeCounts).sort((a, b) => b[1] - a[1]);
  writeFileSync(join(args.out!, `counts-${turn}.json`), JSON.stringify(Object.fromEntries(counts), null, 1));
  if (args.snapshots) writeFileSync(join(args.out!, `heap-${turn}.heapsnapshot`), Bun.generateHeapSnapshot("v8"));
}

/** Lets go of what the bed and the stand-in record of each turn for tests, which RPE never holds. */
function forgetRecords(b: TurnBed): void {
  b.requests.splice(0);
  b.left.splice(0);
  const errors = b.logged.filter((l) => l.level === "error" || l.level === "warn");
  for (const l of errors) console.log(`  log ${l.level}: ${l.message}`);
  b.logged.splice(0);
  b.host.streams.clear();
  b.host.events.splice(0);
  b.host.stored.clear();
  b.server.requests.splice(0);
}

/** Waits until the generation's turn is settled, no run of its chat goes on and no job of the user runs. */
async function settled(b: TurnBed, chat: string, generation: string): Promise<void> {
  const store = b.turns.store.user(USER);
  await b.until(`the turn of ${generation} to settle`, async () => {
    const run = b.turns.runs.byGeneration(USER, generation);
    const turn = run === null ? null : store.turn(run.turn);
    if (turn === null || turn.status === "open" || b.turns.runs.ofChat(USER, chat).length > 0) return false;
    return !(await b.turns.harness.jobs.list({ user: USER, chat })).jobs.some((j) => j.state === "running" || j.state === "queued");
  });
}

const history = (chat: number): ChatMessage[] =>
  Array.from({ length: HISTORY }, (_, i) => ({ id: `m-${chat}-${i}`, role: i % 2 === 0 ? "assistant" : "user", content: prose(chat * 1000 + i, i % 2 === 0 ? REPLY_CHARS : 400) }));

const b = await openTurnBed({ answers: [route], contextWindow: 1_000_000, messages: history(0), global: args.global ?? "" });
bed = b;
try {
  const preset = b.host.presets.get(PRESET)!;
  preset.blocks[0]!.content = `You narrate a lighthouse on Gannet Rock, one scene at a time.\n\n${prose(1, PRESET_CHARS)}`;
  const chats = [CHAT, ...Array.from({ length: CHATS - 1 }, (_, i) => `chat-memory-${i + 1}`)];
  chats.slice(1).forEach((id, i) => b.host.addChat({ id, user: USER, name: `Lighthouse ${i + 2}`, character: CHARACTER, messages: history(i + 1) }));
  forgetRecords(b);
  console.log(`${CHATS} chat(s), ${TURNS} turns each, about ${PROMPT_TOKENS} tokens a prompt, ${CALLS} Author calls a turn, a job every ${JOB_EVERY} turns`);
  measure(0);
  for (let turn = 1; turn <= TURNS; turn++) {
    await Promise.all(
      chats.map(async (chat) => {
        b.host.send(chat, `${prose(turn, 300)} What news of the boat?`);
        const out = await b.host.generate({ chat, connection: CONNECTION, preset: PRESET });
        if (out.error !== null || out.generationId === null) throw new Error(`turn ${turn} of ${chat} failed: ${out.error}`);
        await settled(b, chat, out.generationId);
      }),
    );
    forgetRecords(b);
    if (turn % EVERY === 0 || AT.has(turn)) measure(turn);
  }
  if (Number(args.rest) > 0) {
    await Bun.sleep(Number(args.rest) * 1000);
    console.log(`${args.rest} s after the last turn:`);
    measure(TURNS);
  }
} finally {
  await b.close();
}
