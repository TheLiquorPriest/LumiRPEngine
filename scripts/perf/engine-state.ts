// What the backend keeps in memory per open chat, apart from its copy of the chat's messages
// (ARCHITECTURE §4 Memory), on a large world and a long chat: a world of about 800 entities and 650
// lore entries (`large-world.ts`, a third of its lore read live from a World Info book), and an
// 870-message chat whose records come from playing its turns through the fake host with scripted
// model answers (minds on), a swipe every twelfth turn, and two branches of it. Nothing in it comes
// from any player's data.
//
// Three scenarios, each in its own process from the same stored dataset, as after a restart: the
// chat opened; the chat opened and 10 more turns played; the chat and both branches opened. The
// backend talks to the fake host through a port that copies whatever crosses it, as Spindle's IPC
// does, so nothing it keeps is shared with the host's own records. Each scenario reports the heap
// the backend retains over a baseline with no chat open (after a full collection), then takes the
// backend apart piece by piece, collecting after each: each part's figure is what it alone held,
// given the parts before it. A heap snapshot names the largest objects that no Map entry holds.
//
// Usage: bun scripts/perf/engine-state.ts [all|build|open|turns|chats] [--rebuild] [--json]
// The dataset (~40 MB of JSON) is kept in $LRE_PERF_CACHE (default /tmp/lre-perf) and rebuilt with
// --rebuild (about 10 minutes); `LRE_EVIDENCE_DIR` also gets the report.

import { heapStats } from "bun:jsc";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostPort, QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { lastLoreIndex } from "../../src/backend/lore-secrets";
import { LedgerFold } from "../../src/engine/ledger/fold";
import { contentId } from "../../src/engine/ledger/path";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import { FakeHost, type FakeChat } from "../../test/support/fake-host";
import { Rig } from "../../test/support/rig";
import { HeapGraph } from "./heap-retainers";
import { bookLore, largeWorld } from "./large-world";

const CACHE = process.env.LRE_PERF_CACHE ?? "/tmp/lre-perf";
/** Turns played into the chat: with its greeting, 871 messages (`LRE_PERF_TURNS` for a quick run). */
const TURNS = Number(process.env.LRE_PERF_TURNS ?? 435);
const DATASET = join(CACHE, `engine-state-v1-${TURNS}.json`);
const EVIDENCE = process.env.LRE_EVIDENCE_DIR;
/** Turns played into the open chat in the `turns` scenario (`LRE_PERF_MORE_TURNS` for a longer session). */
const MORE_TURNS = Number(process.env.LRE_PERF_MORE_TURNS ?? 10);
const PAGE = "desk";

const MIND = /You are the private mind of (.+?) in the roleplay world/;
const MEMORY = /You keep the memory of (.+?) in the roleplay world/;
const INTERPRET = "You map a player's typed input";
const EXTRACT = "propose concrete state changes";
const WORDS = ["harbor", "ledger", "window", "lantern", "bench", "market", "ferry", "garden", "workshop", "kettle", "bridge", "orchard", "counter", "parcel", "radio", "awning", "porch", "tide"];
const VERBS = ["check", "carry", "sort", "mend", "watch", "open", "close", "count"];
const PLACES = ["bluebird_coffee", "alder_automotive", "gen_place_3", "alder_market", "gen_place_10", "harbor_street_114", "gen_place_21", "lakefront_park"];

const word = (t: number): string => WORDS[t % WORDS.length] as string;
const mb = (bytes: number): number => Math.round(bytes / 1e5) / 10;

/** What the player types on turn `t`. */
function userText(t: number): string {
  return `I ${VERBS[t % VERBS.length]} the ${word(t)} near the ${word(t + 5)}, then look around (turn ${t}).`;
}

/** The narrator's reply to turn `t` (its swipe `swipe`): 4 to 8 kB of neutral prose. */
function replyText(t: number, swipe: number): string {
  const sentences: string[] = [];
  const n = 50 + ((t * 7 + swipe * 13) % 50);
  for (let i = 0; i < n; i++) sentences.push(`The ${word(t + i)} by the ${word(t + i * 3)} ${i % 2 === 0 ? "catches the light" : "creaks in the wind"} as the ${word(t + i * 5)} settles.`);
  return `Turn ${t}, take ${swipe}. ${sentences.join(" ")}`;
}

/** The helper's answers: minds, their memories, interpret and extract, by the turn being played. */
function scripted(turn: () => number): (req: QuietRequest) => string {
  return (req) => {
    const system = req.messages[0]?.content ?? "";
    const t = turn();
    const mind = MIND.exec(system)?.[1];
    if (mind) return JSON.stringify({ monologue: `${mind} turns over the ${word(t)} from turn ${t}.`, depiction: `${mind} glances at the ${word(t + 1)}`, intent: "Keep at the day's work.", reactions: [], plans: [], mood: "calm" });
    const remembers = MEMORY.exec(system)?.[1];
    if (remembers) {
      return JSON.stringify({
        notes: [{ text: `${remembers} noticed the ${word(t)} on turn ${t}.`, salience: 3 }],
        commitments: t % 9 === 0 ? [{ kind: "plan", with: [], text: `see to the ${word(t + 2)}` }] : [],
        resolved: [],
        plans: [],
        told: [],
        ...(t % 25 === 0 ? { summary: `${remembers} keeps busy around the ${word(t + 3)}.` } : {}),
      });
    }
    if (system.includes(INTERPRET)) {
      const k = t % 6;
      if (k === 0 || k === 3) return JSON.stringify({ action: "go", params: { to: PLACES[t % PLACES.length] }, confidence: 0.9 });
      if (k === 1) return JSON.stringify({ action: "chat_with", params: { target: "danny_okafor" }, confidence: 0.9 });
      if (k === 4) return JSON.stringify({ action: "timelapse", params: { span: "twenty minutes later" }, confidence: 0.9 });
      return JSON.stringify({ action: null, params: {}, confidence: 0.9, reason: "no action" });
    }
    if (system.includes(EXTRACT)) {
      const proposals: JsonObject[] = [];
      if (t % 3 === 0) proposals.push({ type: "time_advance", minutes: 10 });
      if (t % 5 === 0) proposals.push({ type: "purchase", payer: "pov", item: `a ${word(t)} snack`, category: "food", price: 4.5, method: "debit card" });
      return JSON.stringify({ proposals });
    }
    return "{}";
  };
}

/**
 * The host as the extension's subprocess sees it: every value that crosses the port is a copy, as
 * over Spindle's IPC, and nothing on either side holds the other's objects strongly. The backend's
 * handlers are held on its side and reached from the host through weak references, and the port
 * reaches the host weakly too, so a heap snapshot's dominators split the two.
 */
function ipcPort(host: FakeHost): HostPort {
  const far = new WeakRef(host);
  const near = (): FakeHost => {
    const h = far.deref();
    if (!h) throw new Error("the host is gone");
    return h;
  };
  const own = new Set<unknown>();
  const copy = (v: unknown): unknown => {
    if (typeof v === "string") return JSON.parse(JSON.stringify(v)) as string;
    if (v === null || typeof v !== "object" || v instanceof AbortSignal) return v;
    if (Object.values(v).some((x) => typeof x === "function")) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "function" ? x : copy(x)]));
    return structuredClone(v);
  };
  const settled = (v: unknown): unknown => (v instanceof Promise ? v.then(copy) : copy(v));
  // What the backend hands the host: data copied; a function kept here and called through a weak reference.
  const out = (v: unknown): unknown => {
    if (typeof v !== "function") return copy(v);
    own.add(v);
    const ref = new WeakRef(v as (...args: unknown[]) => unknown);
    return (...args: unknown[]) => settled(ref.deref()?.(...args.map(copy)));
  };
  const call =
    (target: () => Record<string, unknown>, name: string) =>
    (...args: unknown[]): unknown => {
      const t = target();
      return settled((t[name] as (...a: unknown[]) => unknown).apply(t, args.map(out)));
    };
  const namespace = (key: string): Record<string, unknown> => {
    const of = (): Record<string, unknown> => (near() as unknown as Record<string, Record<string, unknown>>)[key] as Record<string, unknown>;
    return Object.fromEntries(Object.keys(of()).map((name) => [name, call(of, name)]));
  };
  const self = (): Record<string, unknown> => near() as unknown as Record<string, unknown>;
  const port = {
    chats: namespace("chats"),
    storage: namespace("storage"),
    extensionStorage: namespace("extensionStorage"),
    models: namespace("models"),
    tokens: namespace("tokens"),
    frontend: namespace("frontend"),
    books: namespace("books"),
    presets: namespace("presets"),
    connections: namespace("connections"),
    mcp: namespace("mcp"),
    regex: namespace("regex"),
    processes: namespace("processes"),
    on: call(self, "on"),
    registerContextHandler: call(self, "registerContextHandler"),
    registerWorldInfoInterceptor: call(self, "registerWorldInfoInterceptor"),
    toast: call(self, "toast"),
    dryRun: call(self, "dryRun"),
    log: call(self, "log"),
    get capabilities() {
      return copy(near().capabilities);
    },
  };
  return port as unknown as HostPort;
}

// ---------------------------------------------------------------- the dataset

interface Dataset {
  v: 1;
  chats: string[];
  host: {
    nextId: number;
    bookChanges: number;
    chats: FakeChat[];
    files: [string, string][];
    extensionFiles: [string, string][];
    books: [string, { name: string; character?: boolean; added?: number; updated: number; entries: [string, JsonObject][] }][];
    regex: [string, JsonObject][];
    globalBooks: string[];
  };
  world: { entities: number; places: number; lore: number; bytes: number };
}

/** The fake host's private counters, which a stored dataset carries. */
interface HostCounters {
  nextId: number;
  bookChanges: number;
}

/** Drops what the fake host records for tests (every message sent, call made, line logged): host-side, and not the backend's. */
function quiet(host: FakeHost): void {
  for (const list of [host.sent, host.sentTo, host.quietCalls, host.quietStopped, host.logs, host.tokenCalls, host.placed, host.fills, host.restarts, host.toasts, host.spawned, host.decideCalls, host.mcpReads]) list.length = 0;
  host.userLogs.clear();
  host.logTurns.clear();
  host.processMail.clear();
  host.assembled = [];
}

async function build(): Promise<void> {
  let turn = 0;
  const host = new FakeHost();
  host.quietReply = scripted(() => turn);
  // The player's World Info book that a third of the world's lore was imported from.
  const lore = bookLore();
  const bookId = host.userBook("Harbor notes");
  const entryIds: string[] = [];
  for (const e of lore) entryIds.push(await host.books.createEntry(bookId, { comment: e.title, content: e.content, keys: e.keys, disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {} }, host.userId));
  const rig = new Rig({ shipped: true, minds: true, host, templates: { large: (id, name) => largeWorld(id, name, { bookId, entryIds }) } });
  const worldId = await rig.newWorld("Harbor", "large");
  const chatId = host.createChat("Morning on the harbor.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.hello", chatId }, PAGE));
  const t0 = performance.now();
  for (; turn < TURNS; turn++) {
    await rig.turn(chatId, userText(turn), replyText(turn, 0));
    if (turn % 12 === 11) {
      const g = await host.start(chatId, { type: "swipe" });
      await host.finish(g, replyText(turn, 1));
    }
    quiet(host);
    if (turn % 25 === 24) console.error(`built ${turn + 1}/${TURNS} turns in ${Math.round((performance.now() - t0) / 1000)} s`);
  }
  // Two branches of the whole chat, each opened once, so each has its own journal and snapshots.
  const branches = [host.importCopy(chatId), host.importCopy(chatId)];
  for (const id of branches) rig.body(await rig.send({ type: "lre.hello", chatId: id }, PAGE));
  rig.body(await rig.send({ type: "lre.hello", chatId }, PAGE));
  await host.settle();
  const world = largeWorld("w", "w", { bookId, entryIds });
  const counters = host as unknown as HostCounters;
  const data: Dataset = {
    v: 1,
    chats: [chatId, ...branches],
    host: {
      nextId: counters.nextId,
      bookChanges: counters.bookChanges,
      chats: [...host.chatsById.values()],
      files: [...host.files],
      extensionFiles: [...host.extensionFiles],
      books: [...host.bookStore].map(([id, b]) => [id, { ...b, entries: [...b.entries].map(([k, e]): [string, JsonObject] => [k, e as unknown as JsonObject]) }]),
      regex: [...host.regexScripts].map(([k, s]): [string, JsonObject] => [k, s as unknown as JsonObject]),
      globalBooks: [...host.globalBooks],
    },
    world: { entities: Object.keys(world.entities).length, places: Object.keys(world.places).length, lore: Object.keys(world.lore).length, bytes: JSON.stringify(world).length },
  };
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(DATASET, JSON.stringify(data));
  console.error(`dataset: ${host.chat(chatId).messages.length} messages, written to ${DATASET} in ${Math.round((performance.now() - t0) / 1000)} s`);
  process.exit(0);
}

function restore(data: Dataset): FakeHost {
  const host = new FakeHost();
  const counters = host as unknown as HostCounters;
  counters.nextId = data.host.nextId;
  counters.bookChanges = data.host.bookChanges;
  for (const c of data.host.chats) host.chatsById.set(c.id, c);
  for (const [k, v] of data.host.files) host.files.set(k, v);
  for (const [k, v] of data.host.extensionFiles) host.extensionFiles.set(k, v);
  for (const [id, b] of data.host.books) host.bookStore.set(id, { ...b, entries: new Map(b.entries.map(([k, e]) => [k, e as never])) });
  for (const [k, s] of data.host.regex) host.regexScripts.set(k, s as never);
  host.globalBooks = [...data.host.globalBooks];
  return host;
}

// ---------------------------------------------------------------- measuring

/** The heap after a full collection, in bytes. */
function heap(): number {
  Bun.gc(true);
  Bun.gc(true);
  return heapStats().heapSize;
}

/** Waits until nothing the backend started is still running or scheduled. */
async function calm(rig: Rig): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await rig.host.settle();
    await Bun.sleep(30);
  }
  quiet(rig.host);
}

type Clear = Map<unknown, unknown> | Set<unknown> | unknown[];

/** Empties each named field of `owner` (a Map, Set or array); a field missing is an error, so a renamed one never measures as nothing. */
function empty(owner: unknown, ...fields: string[]): void {
  for (const f of fields) {
    const v = (owner as Record<string, Clear | undefined>)[f];
    if (v instanceof Map || v instanceof Set) v.clear();
    else if (Array.isArray(v)) v.length = 0;
    else throw new Error(`no field ${f} to empty`);
  }
}

/** A private field, read as `T`; missing is an error. */
function field<T>(owner: unknown, name: string): T {
  const v = (owner as Record<string, unknown>)[name];
  if (v === undefined) throw new Error(`no field ${name}`);
  return v as T;
}

interface Slot {
  snapshots: { map: Map<string, unknown> };
  written: string | null;
  core: { journal: JsonValue };
}

interface FoldInsides {
  cache: Map<string, { state: unknown }>;
  settled: Map<string, string>;
  kept: { checkpoint: Map<string, true>; tail: Map<string, true> };
  digests: Record<string, Map<string, string>>;
}

/** Counts that explain the figures: what each cache holds. */
function counts(rig: Rig, chats: readonly string[]): JsonObject {
  const ledger = field<object>(rig.rt, "ledger");
  const fold = field<FoldInsides>(ledger, "folder");
  const slots = field<Map<string, Slot>>(ledger, "chats");
  const push = field<Map<string, { last: JsonValue | null }>>(field<object>(rig.rt, "push"), "channels");
  return {
    foldSteps: fold.cache.size,
    foldStates: [...fold.cache.values()].filter((s) => s.state !== null).length,
    foldKept: { checkpoints: fold.kept.checkpoint.size, tails: fold.kept.tail.size },
    foldDigests: Object.fromEntries(Object.entries(fold.digests).map(([k, m]) => [k, m.size])),
    foldSettled: fold.settled.size,
    slots: slots.size,
    perChat: Object.fromEntries(
      chats.flatMap((id) => {
        const s = slots.get(id);
        return s ? [[id, { snapshots: s.snapshots.map.size, journalKB: Math.round((s.written?.length ?? 0) / 1000), viewKB: Math.round(JSON.stringify(push.get(`${rig.host.userId}\u0000${id}`)?.last ?? null).length / 1000) }]] : [];
      }),
    ),
    views: push.size,
    revisions: rig.rt.worlds.loaded(),
  };
}

/** One world state's heap size and JSON length, folded at the open chat's head. */
async function stateSize(rig: Rig, chatId: string): Promise<JsonObject> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) return {};
  const state = core.fold(toChain(await rig.rt.host.chats.messages(chatId, rig.host.userId))).state;
  const before = heap();
  const copies = [structuredClone(state), structuredClone(state), structuredClone(state), structuredClone(state)];
  const after = heap();
  return { heapMB: mb((after - before) / copies.length), jsonKB: Math.round(JSON.stringify(state).length / 1000) };
}

/**
 * Takes the backend apart in order, collecting after each part: what each part alone held. The
 * message copy goes first, so the parts after it measure without it.
 */
function teardown(rig: Rig, chats: readonly string[]): { part: string; mb: number }[] {
  const rt = rig.rt;
  const ledger = field<object>(rt, "ledger");
  const fold = field<FoldInsides>(ledger, "folder");
  const slots = field<Map<string, Slot>>(ledger, "chats");
  const parts: [string, () => void][] = [
    ["message copy", () => chats.forEach((id) => field<(id: string) => void>(ledger, "forgetMessages")(id))],
    ["fold cache: state copies", () => fold.cache.forEach((s) => (s.state = null))],
    ["fold cache: steps", () => (empty(fold, "cache"), empty(fold.kept, "checkpoint", "tail"))],
    ["fold cache: digests", () => (Object.values(fold.digests).forEach((m) => m.clear()), fold.settled.clear())],
    ["fold snapshots", () => slots.forEach((s) => s.snapshots.map.clear())],
    ["journal text kept", () => slots.forEach((s) => (s.written = null))],
    ["ledger cores and journals", () => empty(ledger, "chats", "gates", "started", "opening", "pages", "answered")],
    ["pushed views", () => empty(field<object>(rt, "push"), "channels")],
    ["world revisions", () => (empty(rt, "pins"), empty(rt.worlds, "revisions", "alive"))],
    ["turn bridges", () => empty(rt, "bridges")],
    ["lore read live", () => empty(rt, "liveLores")],
    ["lore index", () => empty(lastLoreIndex(rt.host, rig.host.userId), "books", "worlds", "unread", "notes")],
    ["minds kept", () => (empty(rt, "answeredMinds", "keptMinds", "mindTraces"), empty(field<object>(rig.dispatch, "minds"), "runs"))],
    ["inspector", () => empty(rt.inspector, "logs")],
    ["diagnostics", () => empty(rt.diag, "chats", "turns", "activities")],
    ["call meter", () => (empty(rt.meter, "users", "log"))],
    ["chat stores (chips, notes, prefs, staged)", () => (empty(rt.chips, "chips", "lapsed"), empty(rt.planNotes, "notes"), empty(rt.outcomeNotes, "notes"), empty(rt.chatPrefs, "prefs"), empty(rt.staged, "staged"), empty(rt, "runs"))],
    ...["prePhase", "preBudgets", "loreTraces", "runLines", "tokenCounts", "presetWarnings", "caveatRuns", "carriedEntries", "lastPlace"].map((name): [string, () => void] => [`turn state: ${name}`, () => empty(rt, name)]),
    // The module's cache of message texts' ids: as many new tiny texts as it keeps push every message text out.
    ["content ids (path.ts)", () => Array.from({ length: 4096 }, (_, i) => contentId(`${i}`))],
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

/** The largest objects a heap snapshot attributes under the backend (what no Map entry holds), as paths from the runtime. */
function snapshotRetainers(): { runtimeMB: number; top: { path: string; className: string; mb: number }[] } {
  const graph = new HeapGraph(Bun.generateHeapSnapshot());
  const [rt] = graph.ofClass("Runtime");
  if (rt === undefined) return { runtimeMB: 0, top: [] };
  return { runtimeMB: mb(graph.retained[rt] as number), top: graph.tree(rt, 1e6, 4).map((r) => ({ path: r.path, className: r.className, mb: mb(r.bytes) })) };
}

type Scenario = "open" | "turns" | "chats";

async function scenario(name: Scenario): Promise<JsonObject> {
  const data = JSON.parse(readFileSync(DATASET, "utf8")) as Dataset;
  let turn = TURNS;
  const host = restore(data);
  host.quietReply = scripted(() => turn);
  const rig = new Rig({ shipped: true, minds: true, host, port: ipcPort });
  await calm(rig);
  const [chatId, ...branches] = data.chats as [string, ...string[]];
  const base = heap();
  const rss0 = process.memoryUsage().rss;
  // The fold's work, counted: the folds asked for and the steps folded, so a cache that keeps less
  // shows what it costs in work.
  const work = { folds: 0, steps: 0 };
  const proto = LedgerFold.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const [method, counter] of [["fold", "folds"], ["step", "steps"]] as const) {
    const original = proto[method] as (...args: unknown[]) => unknown;
    proto[method] = function (this: unknown, ...args: unknown[]) {
      work[counter]++;
      return original.apply(this, args);
    };
  }
  const opened = name === "chats" ? data.chats : [chatId];
  const t0 = performance.now();
  for (const id of opened) rig.body(await rig.send({ type: "lre.hello", chatId: id }, PAGE));
  await calm(rig);
  const openMs = Math.round(performance.now() - t0);
  const openWork = { ...work };
  const turnMs: number[] = [];
  if (name === "turns") {
    for (let i = 0; i < MORE_TURNS; i++, turn++) {
      const t = performance.now();
      await rig.turn(chatId, userText(turn), replyText(turn, 0));
      turnMs.push(Math.round(performance.now() - t));
      quiet(host);
    }
    await calm(rig);
  }
  const total = heap() - base;
  const report: JsonObject = {
    scenario: name,
    messages: host.chat(chatId).messages.length,
    chatsOpen: opened.length,
    baselineMB: mb(base),
    retainedMB: mb(total),
    rssGrowthMB: mb(process.memoryUsage().rss - rss0),
    openMs,
    openWork,
    ...(name === "turns" ? { turnMs, turnWork: { folds: work.folds - openWork.folds, steps: work.steps - openWork.steps } } : {}),
    counts: counts(rig, opened),
    worldState: await stateSize(rig, chatId),
  };
  if (process.argv.includes("--snapshot")) {
    // A snapshot's root reaches what globals hold, not what a running function's frame does.
    (globalThis as Record<string, unknown>).measured = rig;
    report.snapshot = snapshotRetainers();
  }
  report.parts = teardown(rig, [...opened, ...branches.filter((b) => !opened.includes(b))]);
  const parts = report.parts as { part: string; mb: number }[];
  report.unattributedMB = Math.round((mb(total) - parts.reduce((a, p) => a + p.mb, 0)) * 10) / 10;
  return report;
}

const mode = process.argv[2] ?? "all";
const json = process.argv.includes("--json");
if (mode === "build") await build();
else if (mode === "open" || mode === "turns" || mode === "chats") {
  const report = await scenario(mode);
  console.log(JSON.stringify(report));
  process.exit(0);
} else if (mode === "all") {
  if (process.argv.includes("--rebuild") || !existsSync(DATASET)) {
    const made = Bun.spawnSync([process.execPath, import.meta.path, "build"], { stdout: "inherit", stderr: "inherit" });
    if (made.exitCode !== 0) throw new Error("the dataset build failed");
  }
  const data = JSON.parse(readFileSync(DATASET, "utf8")) as Dataset;
  const reports: JsonObject[] = [];
  for (const s of ["open", "turns", "chats"] as const) {
    const run = Bun.spawnSync([process.execPath, import.meta.path, s, ...process.argv.filter((a) => a === "--snapshot")], { stdout: "pipe", stderr: "inherit" });
    if (run.exitCode !== 0) throw new Error(`scenario ${s} failed`);
    reports.push(JSON.parse(run.stdout.toString().trim().split("\n").at(-1) ?? "{}") as JsonObject);
  }
  const out = { at: new Date().toISOString(), world: data.world, scenarios: reports };
  if (json) console.log(JSON.stringify(out, null, 1));
  else {
    console.log(`world: ${data.world.entities} entities, ${data.world.places} places, ${data.world.lore} lore entries, ${mb(data.world.bytes)} MB of JSON`);
    for (const r of reports) {
      console.log(`\n${String(r.scenario)}: ${String(r.chatsOpen)} chat(s) of ${String(r.messages)} messages, retained ${String(r.retainedMB)} MB over a ${String(r.baselineMB)} MB baseline (RSS +${String(r.rssGrowthMB)} MB, open ${String(r.openMs)} ms)`);
      for (const p of r.parts as { part: string; mb: number }[]) if (p.mb >= 0.1) console.log(`  ${p.part.padEnd(44)} ${p.mb.toFixed(1).padStart(7)} MB`);
      console.log(`  ${"(not taken apart)".padEnd(44)} ${String(r.unattributedMB).padStart(7)} MB`);
      console.log(`  fold work: open ${JSON.stringify(r.openWork)}${r.turnWork ? `, ${MORE_TURNS} turns ${JSON.stringify(r.turnWork)} in ${JSON.stringify(r.turnMs)} ms` : ""}`);
      console.log(`  counts: ${JSON.stringify(r.counts)}`);
      console.log(`  one world state: ${JSON.stringify(r.worldState)}`);
      if (r.snapshot) console.log(`  heap snapshot, under the runtime outside Map entries: ${JSON.stringify(r.snapshot)}`);
    }
  }
  if (EVIDENCE) writeFileSync(join(EVIDENCE, "engine-state.json"), JSON.stringify(out, null, 1));
  process.exit(0);
} else throw new Error(`unknown mode ${mode}`);
