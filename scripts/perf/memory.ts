// How much memory RPE holds as chats are played, turn after turn (docs/troubleshooting.md). RPE's own application runs in this
// process on the turn bed of `test/turn/bed.ts`: the stand-in Lumiverse, a scratch data folder. Its agents run on RPH's own model
// layer, on a DeepSeek connection whose server is a stand-in in a process of its own (`--model wire`, the default): every call goes
// out over the network as a real one does, with the whole prompt in its body, and comes back as a stream of thinking, text and tool
// calls; or, with `--model scripted`, on the one scripted model the tests use, which no request leaves.
//
// Each of `--chats` chats plays `--turns` turns at once with the others, in one scene. Lumiverse's prompt for each holds about
// `--prompt` tokens (the preset's text and a full window of history), sent on every call; the Author makes `--calls` calls a turn
// (a look at the world, a delegate to the character, a note of `--note` characters written, then read again and looked at in turn,
// a job started every `--job-every` turns, then its reply), each with `--thinking` characters of thinking; `--call-ms` spreads
// each answer's stream over that long. After every `--every` turns, and once at rest before the first, it collects garbage and prints
// the resident size, the heap, what the heap's objects own outside it, what the allocator holds, the worker threads, and what RPE's
// parts say they keep; again `--rest` seconds after the last turn. At the turns `--at` names it writes the heap's objects by kind
// (and, with `--snapshots`, a heap snapshot Chrome's tools read) into `--out`. `--global` is added to the user's RPE-global.yml, to
// measure under other settings a turn reads. With `--built` it first bundles itself as the built application is bundled and runs the
// bundle, so RPE's code runs as it does on a server.
//
// What the bed and the stand-in record of each turn for tests is let go after each turn, so what grows is RPE's own; the stand-in
// Lumiverse's chats and database are in the same process and in the figures.
// Usage: bun scripts/perf/memory.ts [--built] [--model wire|scripted] [--turns 20] [--chats 2] [--every 1] [--calls 20]
//   [--prompt 250000] [--thinking 3000] [--note 40000] [--call-ms 0] [--job-every 5] [--rest 0] [--global yaml] [--at 1,5,10,20]
//   [--out folder] [--snapshots]

// A worker thread RPE starts runs the file it was started from: in the bundle, this one. It serves its tasks, as the app's entry does.
import "../../src/app/workers/pool";
import { parseArgs } from "node:util";
import type { JsonObject } from "rp-harness/contract";
import type { Answer } from "rp-harness/testing/rig";
import { heapStats, memoryUsage } from "bun:jsc";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TurnBed } from "../../test/turn/bed";

const { values: args } = parseArgs({
  options: {
    built: { type: "boolean", default: false },
    "serve-provider": { type: "boolean", default: false },
    model: { type: "string", default: "wire" },
    turns: { type: "string", default: "20" },
    chats: { type: "string", default: "2" },
    every: { type: "string", default: "1" },
    calls: { type: "string", default: "20" },
    prompt: { type: "string", default: "250000" },
    thinking: { type: "string", default: "3000" },
    note: { type: "string", default: "40000" },
    "call-ms": { type: "string", default: "0" },
    "job-every": { type: "string", default: "5" },
    at: { type: "string", default: "" },
    out: { type: "string", default: "" },
    snapshots: { type: "boolean", default: false },
    rest: { type: "string", default: "0" },
    global: { type: "string", default: "" },
  },
});

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

const CALLS = Math.max(4, Number(args.calls));
const JOB_EVERY = Number(args["job-every"]);
const THINKING = Number(args.thinking);
const NOTE = prose(7, Number(args.note));
const CALL_MS = Number(args["call-ms"]);
const REPLY_CHARS = 2_400;
const CHARACTER_NAME = "Wren Hale";
/** The model the stand-in provider answers as. */
const MODEL = "deepseek-v4-flash";

type Piece = { text: string } | { thinking: string } | { call: string; args: JsonObject };

/** What the Author does at each step of its turn, and what every other agent says: the same play for the scripted model and the stand-in provider. */
function play(state: { calls: number; authorTurns: number }, isAuthor: boolean, step: number): Piece[] {
  state.calls += 1;
  const thinking: Piece[] = THINKING > 0 ? [{ thinking: prose(state.calls * 7, THINKING) }] : [];
  if (!isAuthor) return [...thinking, { text: prose(state.calls, 600) }];
  if (step === 0) {
    state.authorTurns += 1;
    const job: Piece[] = JOB_EVERY > 0 && state.authorTurns % JOB_EVERY === 0 ? [{ call: "job_start", args: { agent: "historian", brief: `Tally the keeper's log, part ${state.authorTurns}.` } }] : [];
    return [...thinking, { text: `<intent>${prose(state.authorTurns, 300)}</intent>` }, { call: "world_query", args: { at: "world" } }, ...job];
  }
  if (step === 1) return [...thinking, { call: "delegate", args: { agent: "character", brief: `The player asks about the boat, turn ${state.authorTurns}.`, plays: CHARACTER_NAME } }];
  if (step === 2) return [...thinking, { call: "file_write", args: { path: "scratch/scene.md", op: "write", text: NOTE } }];
  if (step < CALLS - 1) return [...thinking, step % 2 === 0 ? { call: "world_query", args: { at: "world" } } : { call: "file_read", args: { path: "scratch/scene.md" } }];
  return [...thinking, { text: `<reply>${prose(state.calls, REPLY_CHARS)}</reply>` }];
}

/**
 * The stand-in DeepSeek: an OpenAI-compatible chat completions server that answers every call with the play's next answer, read from
 * the request (the Author holds `job_start`; its step is how many of its answers follow the last user message), as a stream of
 * thinking (`reasoning_content`), text and tool calls, then the usage. It runs in a process of its own, so its memory is not RPE's.
 */
function serveProvider(): void {
  const state = { calls: 0, authorTurns: 0 };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "GET") return Response.json({ object: "list", data: [{ id: MODEL, object: "model", owned_by: "stand-in" }] });
      if (!url.pathname.endsWith("/chat/completions")) return new Response("not here", { status: 404 });
      const text = await request.text();
      const body = JSON.parse(text) as { messages: { role: string }[]; tools?: { function: { name: string } }[] };
      const isAuthor = (body.tools ?? []).some((t) => t.function.name === "job_start");
      const lastUser = body.messages.findLastIndex((m) => m.role === "user");
      const step = body.messages.slice(lastUser + 1).filter((m) => m.role === "assistant").length;
      const pieces = play(state, isAuthor, step);
      const id = `chatcmpl-${state.calls}`;
      const chunk = (delta: Record<string, unknown>, finish: string | null = null): string => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: MODEL, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      const frames: string[] = [chunk({ role: "assistant", content: "" })];
      let calls = 0;
      let output = 0;
      for (const piece of pieces) {
        if ("thinking" in piece) for (let at = 0; at < piece.thinking.length; at += 400) frames.push(chunk({ reasoning_content: piece.thinking.slice(at, at + 400) }));
        else if ("text" in piece) for (let at = 0; at < piece.text.length; at += 200) frames.push(chunk({ content: piece.text.slice(at, at + 200) }));
        else frames.push(chunk({ tool_calls: [{ index: calls, id: `call_${state.calls}_${calls++}`, type: "function", function: { name: piece.call, arguments: JSON.stringify(piece.args) } }] }));
        output += Math.ceil(JSON.stringify(piece).length / 4);
      }
      const input = Math.ceil(text.length / 4);
      frames.push(chunk({}, calls > 0 ? "tool_calls" : "stop"));
      frames.push(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: MODEL, choices: [], usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output, prompt_cache_hit_tokens: Math.floor(input * 0.9), prompt_cache_miss_tokens: input - Math.floor(input * 0.9) } })}\n\n`, "data: [DONE]\n\n");
      const gap = CALL_MS / frames.length;
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const frame of frames) {
            if (gap > 0) await Bun.sleep(gap);
            controller.enqueue(encoder.encode(frame));
          }
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
  console.log(String(server.port));
}

/** Bundles this file as the built application is bundled (`scripts/build.ts`), and runs the bundle with the rest of the arguments. */
async function runBuilt(): Promise<number> {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), "rpe-memory-built-"));
  try {
    const built = await Bun.build({ entrypoints: [fileURLToPath(import.meta.url)], outdir: dir, naming: "memory.js", target: "bun", external: ["supports-color"], ignoreDCEAnnotations: true, throw: false });
    if (!built.success) throw new Error(`the bundle did not build:\n${built.logs.map(String).join("\n")}`);
    const rest = process.argv.slice(2).filter((a) => a !== "--built");
    // The bundle reads the shipped files where the source tree has them, as a built app reads those the build put beside it.
    const env = { ...process.env, RPE_GUIDANCE_DIR: join(root, "guidance/"), RPH_GUIDANCE_DIR: join(root, "node_modules/rp-harness/guidance/") };
    const child = Bun.spawn([process.execPath, join(dir, "memory.js"), ...rest], { cwd: root, env, stdout: "inherit", stderr: "inherit" });
    return await child.exited;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function measureRun(): Promise<void> {
  // Imported here, on the main thread alone: a worker thread runs this file too, and must hold the tasks' code and not the application, as the app's entry does.
  const { CHARACTER, CHAT, CONNECTION, openTurnBed, PRESET, USER } = await import("../../test/turn/bed");

  const TURNS = Number(args.turns);
  const CHATS = Number(args.chats);
  const EVERY = Number(args.every);
  const PROMPT_TOKENS = Number(args.prompt);
  const AT = new Set(args.at === "" ? [] : args.at.split(",").map(Number));
  if (AT.size > 0 && args.out === "") throw new Error("--at needs --out, the folder the counts are written to");
  if (args.out !== "") mkdirSync(args.out!, { recursive: true });
  const wire = args.model === "wire";
  // A turn waits on Lumiverse's requests over the network: give each wait of the bed a turn's length, not a test's.
  process.env.RPE_TEST_LIMIT_MS = "1800000";

  const HISTORY = 40;
  // The prompt: a full window of history, and the preset's own text making up the rest (a token is about four characters).
  const PRESET_CHARS = Math.max(4_000, PROMPT_TOKENS * 4 - HISTORY * REPLY_CHARS);
  const state = { calls: 0, authorTurns: 0 };
  let bed: TurnBed | null = null;

  // The scripted model's answer to every call, whichever agent asks; it keeps a copy of every request for tests, let go here.
  const route: Answer = (request) => {
    bed?.model.add(route);
    (bed?.model.requests as unknown[] | undefined)?.splice(0);
    const isAuthor = request.tools.some((t) => t.name === "job_start");
    const lastUser = request.messages.findLastIndex((m) => m.role === "user");
    const step = request.messages.slice(lastUser + 1).filter((m) => m.role === "assistant").length;
    const input = Math.ceil(JSON.stringify(request.messages).length / 4);
    return { pieces: play(state, isAuthor, step), usage: { input, output: 300 } };
  };

  const provider = wire ? Bun.spawn([process.execPath, fileURLToPath(import.meta.url), "--serve-provider", ...process.argv.slice(2).filter((a) => a !== "--built")], { stdout: "pipe", stderr: "inherit" }) : null;
  let providerUrl = "";
  if (provider !== null) {
    const reader = provider.stdout.getReader();
    const first = await reader.read();
    reader.releaseLock();
    providerUrl = `http://127.0.0.1:${new TextDecoder().decode(first.value).trim()}/v1`;
  }

  const MiB = 1024 * 1024;
  const mb = (n: number): string => (n / MiB).toFixed(1);
  const measure = (turn: number): void => {
    Bun.gc(true);
    const m = memoryUsage();
    const h = heapStats();
    const threads = bed === null ? 0 : bed.app.workers.running + bed.app.index.threads;
    console.log(`turn ${String(turn).padStart(4)}  rss ${mb(m.current)} MB (peak ${mb(m.peak)})  heap ${mb(h.heapSize)} MB of ${mb(h.heapCapacity)}  outside ${mb(h.extraMemorySize)}  allocator ${mb(m.currentCommit)}  threads ${threads}  objects ${h.objectCount}  calls ${wire ? "(provider's)" : state.calls}`);
    const kept = bed?.app.kept.read() ?? [];
    if (kept.length > 0) console.log(`           kept: ${kept.map((k) => `${k.name} ${k.count}${k.chars === null ? "" : ` (${k.chars} chars)`}`).join("; ")}`);
    if (!AT.has(turn)) return;
    const counts = Object.entries(h.objectTypeCounts).sort((a, b) => b[1] - a[1]);
    writeFileSync(join(args.out!, `counts-${turn}.json`), JSON.stringify(Object.fromEntries(counts), null, 1));
    if (args.snapshots) writeFileSync(join(args.out!, `heap-${turn}.heapsnapshot`), Bun.generateHeapSnapshot("v8"));
  };

  /** The warnings already printed: each is printed once. */
  const said = new Set<string>();
  /** Lets go of what the bed and the stand-in record of each turn for tests, which RPE never holds. */
  const forgetRecords = (b: TurnBed): void => {
    b.requests.splice(0);
    b.left.splice(0);
    for (const l of b.logged.filter((l) => (l.level === "error" || l.level === "warn") && !said.has(l.message))) {
      said.add(l.message);
      console.log(`  log ${l.level}: ${l.message} ${JSON.stringify(l.fields ?? {}).slice(0, 300)} (said once)`);
    }
    b.logged.splice(0);
    b.host.streams.clear();
    b.host.events.splice(0);
    b.host.stored.clear();
    b.server.requests.splice(0);
  };

  /** Waits until the generation's turn is settled, no run of its chat goes on and no job of the user runs. */
  const settled = async (b: TurnBed, chat: string, generation: string): Promise<void> => {
    const store = b.turns.store.user(USER);
    await b.until(`the turn of ${generation} to settle`, async () => {
      const run = b.turns.runs.byGeneration(USER, generation);
      const turn = run === null ? null : store.turn(run.turn);
      if (turn === null || turn.status === "open" || b.turns.runs.ofChat(USER, chat).length > 0) return false;
      return !(await b.turns.harness.jobs.list({ user: USER, chat })).jobs.some((j) => j.state === "running" || j.state === "queued");
    });
  };

  const history = (chat: number) => Array.from({ length: HISTORY }, (_, i) => ({ id: `m-${chat}-${i}`, role: (i % 2 === 0 ? "assistant" : "user") as "assistant" | "user", content: prose(chat * 1000 + i, i % 2 === 0 ? REPLY_CHARS : 400) }));

  const b = await openTurnBed({ answers: [route], contextWindow: 1_000_000, messages: history(0), global: args.global ?? "", models: wire ? "layer" : "scripted" });
  bed = b;
  try {
    if (wire) {
      const made = await b.page<{ id?: string; error?: string }>("POST", "/api/v1/connections", { connection: { name: "Stand-in DeepSeek", provider: "deepseek", auth: "key", baseUrl: providerUrl, model: MODEL }, key: "sk-stand-in-memory-key" });
      if (made.body.id === undefined) throw new Error(`the stand-in provider's connection was not made: ${made.body.error ?? made.status}`);
      await b.turns.harness.models.setDefault(USER, made.body.id);
    }
    const preset = b.host.presets.get(PRESET)!;
    preset.blocks[0]!.content = `You narrate a lighthouse on Gannet Rock, one scene at a time.\n\n${prose(1, PRESET_CHARS)}`;
    const chats = [CHAT, ...Array.from({ length: CHATS - 1 }, (_, i) => `chat-memory-${i + 1}`)];
    chats.slice(1).forEach((id, i) => b.host.addChat({ id, user: USER, name: `Lighthouse ${i + 2}`, character: CHARACTER, messages: history(i + 1) }));
    forgetRecords(b);
    console.log(`${wire ? "RPH's model layer on a stand-in DeepSeek" : "the scripted model"}: ${CHATS} chat(s), ${TURNS} turns each, about ${PROMPT_TOKENS} tokens a prompt, ${CALLS} Author calls a turn with ${THINKING} characters of thinking each, a note of ${NOTE.length} characters, a job every ${JOB_EVERY} turns`);
    measure(0);
    for (let turn = 1; turn <= TURNS; turn++) {
      const started = performance.now();
      await Promise.all(
        chats.map(async (chat) => {
          b.host.send(chat, `${prose(turn, 300)} What news of the boat?`);
          const out = await b.host.generate({ chat, connection: CONNECTION, preset: PRESET });
          if (out.error !== null || out.generationId === null) throw new Error(`turn ${turn} of ${chat} failed: ${out.error}`);
          await settled(b, chat, out.generationId);
          const run = b.turns.runs.byGeneration(USER, out.generationId);
          const row = run === null ? null : b.turns.store.user(USER).turn(run.turn);
          if (turn === 1 || turn % EVERY === 0) console.log(`  ${chat}: turn ${row?.status ?? "none"}, ${row?.tokensIn ?? 0} tokens in, ${row?.tokensOut ?? 0} out, reply of ${out.reply?.content.length ?? 0} characters`);
        }),
      );
      forgetRecords(b);
      if (turn % EVERY === 0 || AT.has(turn)) {
        console.log(`  turn ${turn} played in ${((performance.now() - started) / 1000).toFixed(1)} s`);
        measure(turn);
      }
    }
    if (Number(args.rest) > 0) {
      await Bun.sleep(Number(args.rest) * 1000);
      console.log(`${args.rest} s after the last turn:`);
      measure(TURNS);
    }
  } finally {
    await b.close();
    provider?.kill();
  }
}

if (Bun.isMainThread) {
  if (args["serve-provider"]) serveProvider();
  else if (args.built) process.exitCode = await runBuilt();
  else await measureRun();
}
