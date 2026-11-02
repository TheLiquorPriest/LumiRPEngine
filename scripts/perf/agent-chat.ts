// A long agents chat (DESIGN §4.4-§4.6, §9.6): what GM → Workspace, GM → Assistant and the state view
// cost on a chat played by the main agent for as long as the longest played ones, and what the
// backend holds for it. The chat and its scripted models are `test/support/agent-chat.ts`'s, which
// the perf regression test plays too (`test/backend/agent-chat-perf.test.ts`).
//
// The dataset is built once and stored; each measurement runs in its own process from it, as after a
// restart, the backend talking to the fake host through a port that copies whatever crosses it and,
// with --latency-ms, waits that long on each chat and storage call, as a round trip to the host does.
// It times, cold and then warm (the median of --repeats), the state view and the GM's reads of the
// chat (`lre.workspace list`, `lre.workspace session`, `lre.assistant get`), and again after one more
// turn; then the heap the backend retains over a baseline with no chat open, taken apart piece by
// piece, each part's figure what it alone held, given the parts before it.
//
// Usage: bun scripts/perf/agent-chat.ts [all|build|measure] [--turns 160] [--rebuild] [--latency-ms 2] [--repeats 3] [--exists-first] [--json]
// `--exists-first` reads storage as an earlier build did (whether a file is there, then the read).
// The dataset is kept in $LRE_PERF_CACHE (default /tmp/lre-perf); `LRE_EVIDENCE_DIR` also gets the report.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sessionAt } from "../../src/backend/agents/sessions";
import { toChain } from "../../src/backend/ledger-io";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import { isRecord, type JsonObject } from "../../src/shared/json";
import { PROTOCOL_VERSION, type FrontendToBackend } from "../../src/shared/protocol";
import { AGENT_CHAT_PAGE as PAGE, agentChat, playTurn, replyText, scripted, userText } from "../../test/support/agent-chat";
import { FakeHost } from "../../test/support/fake-host";
import { Rig } from "../../test/support/rig";
import { calm, dumpHost, empty, field, heap, type HostDump, ipcPort, mb, quiet, restoreHost } from "./fixture";

function flag(name: string, fallback: number): number {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? Number(process.argv[at + 1]) : fallback;
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} takes a number`);
  return value;
}

const CACHE = process.env.LRE_PERF_CACHE ?? "/tmp/lre-perf";
const TURNS = flag("turns", 160);
const LATENCY_MS = flag("latency-ms", 2);
const REPEATS = Math.max(1, flag("repeats", 3));
const READ_MODE = process.argv.includes("--exists-first") ? "exists-first" : "read-first";
const DATASET = join(CACHE, `agent-chat-v1-${TURNS}.json`);
const EVIDENCE = process.env.LRE_EVIDENCE_DIR;

// ---------------------------------------------------------------- the dataset

interface Dataset {
  v: 1;
  chatId: string;
  turns: number;
  host: HostDump;
}

/** What the chat holds, counted from its storage: the session's segments at its head, the transcripts, the blobs and their bytes. */
async function sizes(host: FakeHost, chatId: string): Promise<JsonObject> {
  const chain = toChain(await host.chats.messages(chatId, host.userId));
  const journalText = host.files.get(`${host.userId}/runs/${chatId}/journal.json`) ?? "{}";
  const journal = JSON.parse(journalText) as { messages?: Record<string, { ledger: ChainMessage["ledger"] }> };
  const overlaid = chain.map((m) => ({ ...m, ledger: journal.messages?.[m.id]?.ledger ?? m.ledger }));
  const refs = sessionAt(overlaid, []);
  const transcripts = overlaid.filter((m) => !m.isUser && isRecord(m.ledger?.swipes[String(m.swipeId)]?.session) && typeof m.ledger?.swipes[String(m.swipeId)]?.session?.transcript === "string").length;
  let blobs = 0;
  let bytes = 0;
  for (const [path, text] of host.files) {
    if (!path.includes("/agents/blobs/")) continue;
    blobs++;
    bytes += text.length;
  }
  return { messages: chain.length, segments: refs.segments.length, compacted: refs.base !== null, transcripts, blobs, blobMB: mb(bytes), journalKB: Math.round(journalText.length / 1000) };
}

async function build(): Promise<void> {
  let turn = 0;
  const host = new FakeHost();
  // Through a port that copies what crosses it, so what the backend keeps after the session is its own.
  const rig = new Rig({ shipped: true, minds: true, host, port: (h) => ipcPort(h) });
  host.quietReply = scripted(() => turn);
  const chatId = await agentChat(rig);
  const t0 = performance.now();
  for (; turn < TURNS; turn++) {
    await playTurn(rig, chatId, turn);
    if (rig.rt.ledger.errors.length > 0) throw new Error(`turn ${turn}: ${rig.rt.ledger.errors.join("; ")}`);
    quiet(host);
    if (turn % 20 === 19) console.error(`built ${turn + 1}/${TURNS} turns in ${Math.round((performance.now() - t0) / 1000)} s, heap ${mb(heap())} MB`);
  }
  await calm(rig);
  const data: Dataset = { v: 1, chatId, turns: TURNS, host: dumpHost(host) };
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(DATASET, JSON.stringify(data));
  console.error(`dataset: ${JSON.stringify(await sizes(host, chatId))}, written to ${DATASET} in ${Math.round((performance.now() - t0) / 1000)} s`);
  // What the backend kept over the whole session that played the chat, in one process.
  console.error(`after the session: ${JSON.stringify({ fold: foldStats(rig), parts: teardown(rig, chatId) })}`);
  process.exit(0);
}

// ---------------------------------------------------------------- measuring

const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const round = (ms: number): number => Math.round(ms * 10) / 10;

/** The round trips to the host the measured backend made, counted by its port, in all and by call. */
const TRIPS: { n: number; by: Record<string, number> } = { n: 0, by: {} };

/** The GM's reads of the chat, by the label Diagnostics gives them. */
const READS: readonly { what: string; request: JsonObject }[] = [
  { what: "lre.workspace list", request: { type: "lre.workspace", op: "list" } },
  { what: "lre.workspace session", request: { type: "lre.workspace", op: "session" } },
  { what: "lre.assistant get", request: { type: "lre.assistant", op: "get" } },
];

interface Timing {
  ms: number;
  trips: number;
  by: Record<string, number>;
}

/** Times `fn`, with the round trips it made, in all and by call. */
async function measured<T>(fn: () => Promise<T>): Promise<Timing & { value: T }> {
  const trips = TRIPS.n;
  const by = { ...TRIPS.by };
  const t0 = performance.now();
  const value = await fn();
  const ms = performance.now() - t0;
  return { value, ms, trips: TRIPS.n - trips, by: Object.fromEntries(Object.entries(TRIPS.by).flatMap(([k, v]) => (v !== (by[k] ?? 0) ? [[k, v - (by[k] ?? 0)]] : []))) };
}

/** One request, timed as the dispatcher times it (from its arrival to its answer), with the round trips it made and its answer's size. */
async function timed(rig: Rig, chatId: string, request: JsonObject): Promise<Timing & { kb: number }> {
  const reqId = `m${Math.random().toString(36).slice(2)}`;
  const before = rig.host.sent.length;
  const t = await measured(() => rig.dispatch.handle({ lre: PROTOCOL_VERSION, reqId, chatId, ...request } as unknown as FrontendToBackend, rig.host.userId, PAGE));
  const reply = rig.host.sent.slice(before).find((m) => (m.type === "lre.result" || m.type === "lre.error") && m.reqId === reqId);
  if (reply?.type !== "lre.result") throw new Error(`${JSON.stringify(request)}: ${JSON.stringify(reply)}`);
  return { ms: t.ms, trips: t.trips, by: t.by, kb: Math.round(JSON.stringify(reply.body).length / 1000) };
}

/** The state view as the push builds it, timed. */
function viewTimed(rig: Rig, chatId: string): Promise<Timing> {
  return measured(() => rig.rt.view(chatId, rig.host.userId));
}

/** A read once cold, then `REPEATS` times warm, back to back: the cold time and round trips (by call), and the warm median's. */
async function coldWarm(once: () => Promise<Timing & { kb?: number }>): Promise<JsonObject> {
  const cold = await once();
  const warm: Timing[] = [];
  for (let i = 0; i < REPEATS; i++) warm.push(await once());
  return { coldMs: round(cold.ms), coldTrips: cold.trips, coldBy: cold.by, warmMs: round(median(warm.map((w) => w.ms))), warmTrips: median(warm.map((w) => w.trips)), ...(cold.kb !== undefined ? { kb: cold.kb } : {}) };
}

/** Every read, as GM → Workspace's tabs and the state push ask for them. */
async function reads(rig: Rig, chatId: string): Promise<JsonObject> {
  const out: JsonObject = { "state view": await coldWarm(() => viewTimed(rig, chatId)) };
  for (const { what, request } of READS) out[what] = await coldWarm(() => timed(rig, chatId, request));
  return out;
}

/** What the users' folds keep: steps (and those holding a state), step keys and re-convergence hashes. */
function foldStats(rig: Rig): JsonObject {
  let steps = 0;
  let states = 0;
  let keys = 0;
  let settled = 0;
  for (const fold of field<Map<string, { cache: Map<string, { state: unknown }>; stepKeys: Map<string, string>; settled: Map<string, string> }>>(rig.rt, "folds").values()) {
    steps += fold.cache.size;
    states += [...fold.cache.values()].filter((s) => s.state !== null).length;
    keys += fold.stepKeys.size;
    settled += fold.settled.size;
  }
  return { steps, states, keys, settled };
}

/** What each part of the backend alone held, taken apart in order, collecting after each. */
function teardown(rig: Rig, chatId: string): { part: string; mb: number }[] {
  const rt = rig.rt;
  const ledger = field<object>(rt, "ledger");
  const parts: [string, () => void][] = [
    ["message copy", () => field<(id: string) => void>(ledger, "forgetMessages")(chatId)],
    ["agent runs kept (orchestrator)", () => empty(rt.orchestrator, "runs")],
    ["live feeds", () => empty(rt.live, "feeds")],
    ["agent runs waiting at a gate", () => empty(rt.orchestrator, "waiting")],
    ["main session read (Sessions)", () => empty(rt.sessions, "read")],
    ["GM assistant threads", () => empty(rig.dispatch.assistant, "threads")],
    ["diagnostics", () => empty(rt.diag, "chats", "turns", "activities")],
    ["fold cache", () => {
      for (const fold of field<Map<string, { trim(): number }>>(rt, "folds").values()) fold.trim();
    }],
    ["ledger cores and journals", () => empty(ledger, "chats", "gates", "started", "opening", "pages", "answered")],
    ["pushed views", () => empty(field<object>(rt, "push"), "channels")],
    ["world revisions", () => (empty(rt, "pins"), empty(rt.worlds, "revisions", "alive"))],
    ["turn bridges", () => empty(rt, "bridges")],
    ["minds kept", () => (empty(rt, "answeredMinds", "keptMinds", "mindTraces"), empty(field<object>(rig.dispatch, "minds"), "runs"))],
    ["inspector", () => empty(rt.inspector, "logs")],
  ];
  const out: { part: string; mb: number }[] = [];
  let at = heap();
  for (const [part, clear] of parts) {
    clear();
    const now = heap();
    out.push({ part, mb: mb(at - now) });
    at = now;
  }
  return out;
}

async function measure(): Promise<JsonObject> {
  const data = JSON.parse(readFileSync(DATASET, "utf8")) as Dataset;
  let turn = data.turns;
  const host = restoreHost(data.host);
  host.quietReply = scripted(() => turn);
  const rig = new Rig({ shipped: true, minds: true, host, port: (h) => ipcPort(h, { latencyMs: LATENCY_MS, trips: TRIPS, reads: READ_MODE }) });
  await calm(rig);
  const { chatId } = data;
  const base = heap();
  const rss0 = process.memoryUsage().rss;
  const helloAt = await measured(async () => rig.body(await rig.send({ type: "lre.hello", chatId }, PAGE)));
  const hello = { ms: round(helloAt.ms), trips: helloAt.trips, by: helloAt.by };
  await calm(rig);
  const opened = await reads(rig, chatId);
  // One more turn, its views timed as the push built them, then the reads again.
  const pushed: Omit<Timing, "by">[] = [];
  const view = rig.rt.view.bind(rig.rt);
  rig.rt.view = async (id, userId) => {
    const t = await measured(() => view(id, userId));
    pushed.push({ ms: round(t.ms), trips: t.trips });
    return t.value;
  };
  const turnAt = await measured(async () => {
    await rig.turn(chatId, userText(turn), replyText(turn, 0));
    await calm(rig);
  });
  turn++;
  const turnDone = { ms: round(turnAt.ms), trips: turnAt.trips, by: turnAt.by, views: pushed };
  rig.rt.view = view;
  const afterTurn = await reads(rig, chatId);
  const total = heap() - base;
  const report: JsonObject = {
    at: new Date().toISOString(),
    latencyMs: LATENCY_MS,
    reads: READ_MODE,
    chat: await sizes(host, chatId),
    hello,
    opened,
    turn: turnDone,
    afterTurn,
    retainedMB: mb(total),
    rssGrowthMB: mb(process.memoryUsage().rss - rss0),
  };
  report.parts = teardown(rig, chatId);
  return report;
}

const mode = process.argv[2] ?? "all";
if (mode === "build") await build();
else if (mode === "measure") {
  console.log(JSON.stringify(await measure()));
  process.exit(0);
} else if (mode === "all") {
  if (process.argv.includes("--rebuild") || !existsSync(DATASET)) {
    const made = Bun.spawnSync([process.execPath, import.meta.path, "build", ...process.argv.slice(3)], { stdout: "inherit", stderr: "inherit" });
    if (made.exitCode !== 0) throw new Error("the dataset build failed");
  }
  const run = Bun.spawnSync([process.execPath, import.meta.path, "measure", ...process.argv.slice(3)], { stdout: "pipe", stderr: "inherit" });
  if (run.exitCode !== 0) throw new Error("the measurement failed");
  const report = JSON.parse(run.stdout.toString().trim().split("\n").at(-1) ?? "{}") as JsonObject;
  console.log(JSON.stringify(report, null, process.argv.includes("--json") ? undefined : 1));
  if (EVIDENCE) writeFileSync(join(EVIDENCE, "agent-chat.json"), JSON.stringify(report, null, 1));
  process.exit(0);
} else throw new Error(`unknown mode ${mode}`);
