// A long chat of the previous build, as large as a long-played one, and the first reading of it after RPE starts, measured. Everything
// is invented.
//
// `bundle <folder>` makes the chat as the previous build left it, in a folder `bigchat-load.ts` loads into a Lumiverse instance: a
// starter world padded to `--bytes` a revision, `--revisions` revisions of it; `--replies` replies (the greeting one of them), `--swipes`
// swipes on them in all; the last `--records` replies played by the previous build's own ledger core and simulation, the chat moved
// onto each revision in turn, and each record carrying what the previous build recorded on a played reply (its prompt trace, its
// harness turn's record and departures, the parts its final review saw) sized so that the records on the messages and the chat's
// journal come to `--ledger-bytes` in all. `make <root>` loads a bundle into the migration's fixture and runs `rpe migrate` from this
// checkout into `<root>/rpe-data`. `read <root>` starts `rpe serve` on that data folder, has `--pages` pages read the chat at once as a
// page does when it opens it, asks RPE's status every 50 ms meanwhile, and prints one line of JSON: the processor seconds and the peak
// memory of the server until every read was answered, the longest a status took, and each read's time. Run it twice for the start and a
// restart.
// Usage: bun scripts/perf/long-chat.ts bundle <folder> [--replies 576] [--swipes 916] [--records 181] [--revisions 155] [--bytes 1400000] [--ledger-bytes 26800000]
//        bun scripts/perf/long-chat.ts make <root> <bundle folder>
//        bun scripts/perf/long-chat.ts read <root> [--pages 3]

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ChatSnapshots, encodeLedger } from "../../src/migrate/today/ledger-io";
import { emptyJournal, LedgerCore, type LedgerEnv, type TurnModel } from "../../src/engine/ledger/journal";
import { LedgerFold } from "../../src/engine/ledger/fold";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import { resolveFix } from "../../src/engine/edits";
import { createRegistry } from "../../src/engine/registry-impl";
import { planTurn, postTurn } from "../../src/engine/turn";
import { installHistoryLines } from "../../src/iface/history-lines";
import { shippedTexts } from "../../src/iface/texts";
import { ALL_PACKS } from "../../src/packs/index";
import { STARTER_WORLDS } from "../../src/packs/starters";
import { hashJson } from "../../src/shared/hash";
import type { ChatRun, Rec } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import { commandSocketPath } from "../../src/app/data-folder";
import { buildFixture, STRAY, USER } from "../../test/migrate/fixture";
import { loadBundle } from "./bigchat-load";

const REPO = resolve(import.meta.dir, "../..");
const MAIN = join(REPO, "src/app/main.ts");
const CHAT_ID = "c-bigchat-0001";
const WORLD_ID = "w_b16c4a7000000001";
const CHARACTER_ID = "ch-bigchat-0001";

const [command, rootArg, bundleArg] = process.argv.slice(2);
const { values } = parseArgs({
  args: process.argv.slice(command === "make" ? 5 : 4),
  options: { replies: { type: "string" }, swipes: { type: "string" }, records: { type: "string" }, revisions: { type: "string" }, bytes: { type: "string" }, "ledger-bytes": { type: "string" }, pages: { type: "string" } },
});
const num = (v: string | undefined, d: number): number => (v === undefined ? d : Number(v));

/** Invented prose, the same for the same seed: words drawn from a small list, so it neither repeats nor packs away to nothing. */
function proseOf(seed: number): (chars: number) => string {
  const WORDS = "the harbour lantern rain market alley cafe barista phone bus stop morning evening laughs quietly window street corner bakery shutter ferry horn lake bells wind coat umbrella neighbour garage engine radio song tea kettle letter key door stairs light shadow cat dog bicycle bench park fountain pigeons clock tower train platform ticket wallet coins receipt promise memory stranger friend sister brother mother father work shift manager notes plan route map evening news weather cold warm quiet loud slow fast careful tired hopeful".split(" ");
  let s = seed >>> 0 || 1;
  const next = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  return (chars) => {
    let out = "";
    while (out.length < chars) {
      const n = 6 + Math.floor(next() * 12);
      const words: string[] = [];
      for (let i = 0; i < n; i++) words.push(WORDS[Math.floor(next() * WORDS.length)] ?? "the");
      const sentence = words.join(" ");
      out += `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. `;
    }
    return out.slice(0, chars);
  };
}

/** A starter world padded to about `bytes` of JSON: four fifths more people, the rest lore. */
function paddedWorld(bytes: number): WorldDoc {
  const doc = STARTER_WORLDS.modern_slice_of_life?.(WORLD_ID, "Long town");
  if (doc === undefined) throw new Error("no starter world modern_slice_of_life");
  const people = Object.values(doc.entities).filter((e) => e.kind === "person");
  const prose = proseOf(7);
  let i = 0;
  while (JSON.stringify(doc).length < bytes * 0.8 && people.length > 0) {
    const from = people[i % people.length];
    if (from === undefined) break;
    const id = `pad_person_${i}`;
    doc.entities[id] = { ...structuredClone(from), id, name: `${from.name} ${i}` };
    i++;
  }
  let k = 0;
  while (JSON.stringify(doc).length < bytes) {
    doc.lore[`pad-lore-${k}`] = { id: `pad-lore-${k}`, title: `Note ${k}`, content: prose(1200), keys: [], links: [] } as never;
    k++;
  }
  return doc;
}

/** What the previous build recorded on a played reply besides its turn, about `bytes` of it: its prompt trace, its harness turn's record, its departures, the parts its final review saw. */
function heavyParts(n: number, bytes: number): Partial<Rec> {
  const prose = proseOf(1000 + n);
  const steps = Array.from({ length: Math.max(1, Math.round((bytes * 0.35) / 1600)) }, (_, i) => ({ agent: ["scene", "cast", "narrator", "review"][i % 4] ?? "scene", tool: ["read", "note", "write", "check"][i % 4] ?? "read", said: prose(1500) }));
  return {
    diag: JSON.stringify({ v: 1, prompt: prose(Math.round(bytes * 0.5)) }),
    harness: { turns: [`hturn-${n}`], record: { v: 1, generationId: `hg-${n}`, kind: "reply", at: Date.UTC(2026, 9, 1) + n * 600_000, usage: { input: 41000 + n, output: 900 + n, cached: 30000 }, steps }, departures: [prose(300), prose(300)] },
    finalParts: { narrator: prose(Math.round(bytes * 0.07)), scene: prose(Math.round(bytes * 0.07)) },
  };
}

async function bundle(out: string): Promise<void> {
  await installHistoryLines(shippedTexts());
  const replies = num(values.replies, 576);
  const swipes = num(values.swipes, 916);
  const records = num(values.records, 181);
  const revisions = num(values.revisions, 155);
  const bytes = num(values.bytes, 1_400_000);
  const ledgerBytes = num(values["ledger-bytes"], 26_800_000);
  const registry = createRegistry(ALL_PACKS);

  // The world: the padded starter, then a revision for each edit.
  const base = paddedWorld(bytes);
  const docs = new Map<string, WorldDoc>();
  const edits: { revision: string; edit: Record<string, unknown> | null }[] = [];
  for (let r = 0; r < revisions; r++) {
    const edit = r === 0 ? null : { id: "pad-edit", title: "Edit", content: `Edit ${r} of the town's notes.`, keys: [], links: [] };
    const doc = edit === null ? base : ({ ...base, lore: { ...base.lore, "pad-edit": edit } } as WorldDoc);
    const revision = hashJson(doc);
    docs.set(revision, doc);
    edits.push({ revision, edit });
  }
  const revs = edits.map((e) => e.revision);
  const at = (n: number): number => Date.UTC(2026, 6, 1) + n * 120_000;

  // The chat: the replies before the engine played, then the ones it played, the chat moved onto each revision in turn.
  const run: ChatRun = { v: 1, worldId: WORLD_ID, revision: revs[0] as string, runSeed: "bigchat-seed", startedAt: at(2 * (replies - records)) };
  const elapsed = new Map<string, number>();
  const model: TurnModel = {
    plan: ({ state, ctx, seed, kind, userTexts }) => {
      const plan = planTurn({ registry, world: ctx.world, state, runSeed: run.runSeed, seed, kind, userTexts, intent: null });
      elapsed.set(seed, plan.elapsedMinutes);
      return plan.events;
    },
    read: ({ state, ctx, seed }) => postTurn({ registry, world: ctx.world, state, runSeed: run.runSeed, seed, appliedMinutes: elapsed.get(seed.replace(/:read$/, "")) ?? 0, extracted: [] }),
  };
  let seeds = 0;
  const env: LedgerEnv = { types: registry, worlds: (r) => docs.get(r), run, model, startMarkers: () => [], newSeed: () => `seed-${++seeds}`, resolveFix: (doc, state, entry) => resolveFix(registry, doc, state, entry, run.runSeed), snapshots: new ChatSnapshots() };
  const core = new LedgerCore(emptyJournal(CHAT_ID), env, new LedgerFold(registry));
  const TEXTS = ["I walk to the cafe and look for a seat by the window.", "I order a coffee and ask the barista about the ferry.", "I wait twenty minutes, watching the rain.", "I head to the garage to see whether the bike is fixed.", "I go home and call my sister.", "I look around the market for the stall with the old maps.", "I check my phone for the bus times.", "I knock on the neighbour's door."];
  const prose = proseOf(42);
  const observed: ChainMessage[] = [{ id: "big-m0", isUser: false, swipeId: 0, swipes: [prose(1800)], ledger: null }];
  const sent = new Map<string, number>([["big-m0", at(0)]]);
  core.sync(observed);
  const played = replies - records;
  const extra = Math.max(0, swipes - replies);
  const plays = replies - 1;
  let gen = 0;
  let moved = 0;
  let recorded = 0;
  const t0 = performance.now();
  for (let t = 1; t < replies; t++) {
    const user: ChainMessage = { id: `big-u${t}`, isUser: true, swipeId: 0, swipes: [TEXTS[t % TEXTS.length] ?? ""], ledger: null };
    const reply: ChainMessage = { id: `big-a${t}`, isUser: false, swipeId: 0, swipes: [], ledger: null };
    sent.set(user.id, at(2 * t - 1));
    sent.set(reply.id, at(2 * t));
    // Its swipes: the extra ones spread over the replies.
    const count = 1 + Math.floor((t * extra) / plays) - Math.floor(((t - 1) * extra) / plays);
    if (t < played) {
      reply.swipes = Array.from({ length: count }, () => prose(2400));
      reply.swipeId = count - 1;
      observed.push(user, reply);
      core.sync(observed);
      continue;
    }
    // A reply the previous build played: the chat moved onto the revision this point of it was on.
    const target = records <= 1 ? 0 : Math.floor((recorded * (revisions - 1)) / (records - 1));
    while (moved < Math.min(target, revisions - 1)) {
      moved++;
      core.write({ kind: "marker", id: `move-${moved}`, target: "head", body: { kind: "migrate", to: revs[moved] as string } }, observed);
    }
    reply.swipes = [""];
    observed.push(user, reply);
    core.sync(observed);
    const generationId = `g${++gen}`;
    core.started({ generationId, kind: "normal", targetMessageId: reply.id, targetSwipeId: 0 }, observed);
    core.plan(generationId, observed, false);
    reply.swipes[0] = prose(2400);
    core.saved(generationId);
    core.ended({ generationId, messageId: reply.id, content: reply.swipes[0] as string }, observed);
    recorded++;
    // Swipes made with the engine switched off, which hold no record: the played one stays shown.
    for (let s = 1; s < count; s++) reply.swipes.push(prose(2400));
    if (count > 1) core.sync(observed);
  }
  process.stderr.write(`played ${gen} replies of ${replies}, ${moved + 1} revisions, in ${Math.round(performance.now() - t0)} ms\n`);

  // What the previous build recorded on a played reply besides its turn, sized so that the messages' records and the journal (which holds each again) come to `ledgerBytes`.
  const ledgerOf = (m: ChainMessage) => core.journal.messages[m.id]?.ledger;
  const size = (): number => observed.reduce((n, m) => n + (ledgerOf(m) ? JSON.stringify(encodeLedger({}, ledgerOf(m) as never)).length : 0), 0) + JSON.stringify(core.journal).length;
  const bare = size();
  const each = Math.max(0, Math.round((ledgerBytes - bare) / (2 * Math.max(1, recorded))));
  let n = 0;
  for (const m of observed) {
    const ledger = ledgerOf(m);
    if (!ledger) continue;
    for (const rec of Object.values(ledger.swipes)) Object.assign(rec, heavyParts(n++, each));
  }
  const total = size();
  process.stderr.write(`records ${bare} bytes bare, ${each} bytes more on each of ${n}, ${total} bytes in all\n`);

  const name = "Long town narrator (invented)";
  const rows = observed.map((m, i) => {
    const ledger = ledgerOf(m);
    const when = Math.floor((sent.get(m.id) ?? at(i)) / 1000);
    return {
      id: m.id,
      index_in_chat: i,
      is_user: m.isUser ? 1 : 0,
      name: m.isUser ? "Player" : name,
      content: m.swipes[m.swipeId] ?? "",
      send_date: when,
      swipe_id: m.swipeId,
      swipes: JSON.stringify(m.swipes),
      swipe_dates: JSON.stringify(m.swipes.map((_, s) => when + s * 60)),
      extra: JSON.stringify(i === 0 ? { greeting: true, greeting_character_id: CHARACTER_ID, greeting_index: 0 } : ledger === undefined ? {} : { spindle_metadata: encodeLedger({}, ledger) }),
    };
  });
  const chat = {
    character: { id: CHARACTER_ID, name, first_mes: observed[0]?.swipes[0] ?? "" },
    chat: { id: CHAT_ID, name: "Long town (invented, long)", metadata: JSON.stringify({ activeGreetingIndex: 0, lumi_rp_engine: { ...run, prefs: { engine: "harness" } } }) },
    messages: rows,
    files: { [`runs/${CHAT_ID}/journal.json`]: JSON.stringify({ ...core.journal, run: { worldId: run.worldId, runSeed: run.runSeed } }) },
  };
  const world = {
    id: WORLD_ID,
    base,
    edits,
    index: { id: WORLD_ID, name: "Long town", head: revs.at(-1), revisions: revs },
    history: { v: 1, notes: revs.map((revision, r) => ({ revision, at: new Date(at(r * 3)).toISOString(), source: r === 0 ? "create" : "build" })) },
  };
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "chat.json.gz"), Bun.gzipSync(new TextEncoder().encode(JSON.stringify(chat))));
  await writeFile(join(out, "world.json.gz"), Bun.gzipSync(new TextEncoder().encode(JSON.stringify(world))));
  await writeFile(
    join(out, "about.json"),
    JSON.stringify({ chat: CHAT_ID, world: WORLD_ID, replies, swipes: observed.reduce((s, m) => s + (m.isUser ? 0 : m.swipes.length), 0), records: n, revisions, played: moved + 1, revisionBytes: JSON.stringify(base).length, ledgerBytes: total, perRecordExtra: each, messages: observed.length }, null, 2),
  );
}

async function make(root: string, bundleFolder: string): Promise<void> {
  const fixture = await buildFixture("operator");
  await rm(join(fixture.userFolder, STRAY));
  await loadBundle(bundleFolder, fixture.sources.lumiverse, USER);
  const data = join(root, "rpe-data");
  await mkdir(root, { recursive: true });
  const t0 = performance.now();
  const migrated = Bun.spawnSync([process.execPath, MAIN, "migrate", "--lumiverse", fixture.sources.lumiverse, "--user", USER, "--runtime-config", fixture.sources.runtime?.configDir ?? "", "--runtime-data", fixture.sources.runtime?.dataDir ?? "", "--data", data], {
    env: { ...process.env, ...fixture.named, HOME: join(root, "home") },
    stdout: "pipe",
    stderr: "pipe",
  });
  await writeFile(join(root, "migrate.txt"), `${migrated.stdout.toString()}${migrated.stderr.toString()}`);
  await writeFile(join(root, "long.json"), JSON.stringify({ fixture: fixture.root, lumiverse: fixture.sources.lumiverse, data, chat: CHAT_ID }));
  process.stderr.write(`migrate exited ${migrated.exitCode} in ${Math.round(performance.now() - t0)} ms; its words are in ${join(root, "migrate.txt")}\n`);
}

/** The server's processor seconds and resident memory now. */
function usageOf(pid: number): { cpu: number; rss: number } | null {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const cpu = (Number(fields[11]) + Number(fields[12])) / 100;
      const rss = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0) * 1024;
      return { cpu, rss };
    } catch {
      return null;
    }
  }
  const out = Bun.spawnSync(["ps", "-o", "rss=,cputime=", "-p", String(pid)]).stdout.toString().trim();
  if (out === "") return null;
  const [rss, time] = out.split(/\s+/);
  const cpu = (time ?? "0").split(":").map(Number).reduce((n, p) => n * 60 + p, 0);
  return { cpu, rss: Number(rss) * 1024 };
}

/** RPE started on the data folder `make` wrote, from this checkout, and the calls a page makes, on its command socket as the owner. */
async function startServer(root: string): Promise<{ call: (path: string) => Promise<{ ms: number; status: number; bytes: number; text: string }>; pid: number; logs: () => string; chat: string; startedMs: number; stop: () => Promise<string> }> {
  const facts = JSON.parse(readFileSync(join(root, "long.json"), "utf8")) as { data: string; lumiverse: string; chat: string };
  const port = 7990 + Math.floor(Math.random() * 500);
  const config = join(facts.data, "config.json");
  const was = existsSync(config) ? (JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>) : {};
  await writeFile(config, JSON.stringify({ ...was, port, lumiverse: { ...((was.lumiverse as object | undefined) ?? {}), url: null, user: USER, database: join(facts.lumiverse, "lumiverse.db") } }, null, 2));
  // TRIAL_BUN_FLAGS: flags for Bun itself, a profiler's (`--cpu-prof-md --cpu-prof-dir=…`).
  const flags = (process.env.TRIAL_BUN_FLAGS ?? "").split(" ").filter((f) => f !== "");
  const server = Bun.spawn([process.execPath, ...flags, MAIN, "serve", "--data", facts.data], { env: { ...process.env, HOME: join(root, "home") }, stdout: "pipe", stderr: "pipe" });
  const logs: string[] = [];
  void (async () => {
    for await (const chunk of server.stderr) logs.push(new TextDecoder().decode(chunk));
  })();
  const socket = commandSocketPath(facts.data);
  const call = async (path: string): Promise<{ ms: number; status: number; bytes: number; text: string }> => {
    const t = performance.now();
    const res = await fetch(`http://rpe.local${path}`, { unix: socket } as RequestInit);
    const text = await res.text();
    return { ms: Math.round(performance.now() - t), status: res.status, bytes: text.length, text };
  };
  const start = performance.now();
  for (;;) {
    if (existsSync(socket)) {
      try {
        if ((await call("/api/v1/status")).status === 200) break;
      } catch {
        // Not listening yet.
      }
    }
    if (performance.now() - start > 120_000) throw new Error(`RPE did not start: ${logs.join("")}`);
    await Bun.sleep(100);
  }
  return {
    call,
    pid: server.pid,
    logs: () => logs.join(""),
    chat: facts.chat,
    startedMs: Math.round(performance.now() - start),
    stop: async () => {
      server.kill("SIGTERM");
      await server.exited;
      await writeFile(join(root, `serve-${Date.now()}.log`), logs.join(""));
      return logs.join("");
    },
  };
}

/** What `work` cost the server: its time, the server's processor seconds, the longest a status call took meanwhile (how long the thread was held), its peak memory and its memory after. */
async function measured<T>(pid: number, call: (path: string) => Promise<{ ms: number }>, work: () => Promise<T>): Promise<{ ms: number; cpu: number | null; heldMs: number; peakMb: number; afterMb: number | null; result: T }> {
  const at0 = usageOf(pid);
  let peak = at0?.rss ?? 0;
  let stopped = false;
  const sampler = (async () => {
    while (!stopped) {
      const u = usageOf(pid);
      if (u !== null) peak = Math.max(peak, u.rss);
      await Bun.sleep(100);
    }
  })();
  let held = 0;
  const status = (async () => {
    while (!stopped) {
      held = Math.max(held, (await call("/api/v1/status")).ms);
      await Bun.sleep(50);
    }
  })();
  const t = performance.now();
  const result = await work();
  const ms = Math.round(performance.now() - t);
  const at1 = usageOf(pid);
  stopped = true;
  await Promise.all([sampler, status]);
  const mb = (n: number): number => Math.round(n / 1048576);
  return { ms, cpu: at0 && at1 ? Math.round((at1.cpu - at0.cpu) * 100) / 100 : null, heldMs: held, peakMb: mb(Math.max(peak, at1?.rss ?? 0)), afterMb: at1 ? mb(at1.rss) : null, result };
}

async function read(root: string): Promise<void> {
  const pages = num(values.pages, 3);
  const s = await startServer(root);
  const c = encodeURIComponent(s.chat);
  // What a page reads of a chat as it opens it: the newest turn, the list of turns, the world, the maps, the state, the story, the quests.
  const reads = [`/api/v1/chats/${c}/newest`, `/api/v1/chats/${c}/turns`, `/api/v1/chats/${c}/world`, `/api/v1/chats/${c}/maps`, `/api/v1/chats/${c}/state`, `/api/v1/chats/${c}/story`, `/api/v1/chats/${c}/quests`, `/api/v1/chats/${c}/carried`];
  const m = await measured(s.pid, s.call, () => Promise.all(Array.from({ length: pages }, () => Promise.all(reads.map((p) => s.call(p))))));
  await s.stop();
  const { result, ...cost } = m;
  console.log(JSON.stringify({ startedMs: s.startedMs, ...cost, reads: result[0]?.map((r, i) => ({ path: reads[i]?.replace(`/api/v1/chats/${c}`, ""), ms: r.ms, status: r.status, kb: Math.round(r.bytes / 1024) })) }));
}

/**
 * The trial, at a start and again after a restart: the start's pass over the chat (until the log says it is done, or 10 s with no pass
 * in the log), then what one page asks as it opens the chat (as a real tab does: the state twice, the newest turn, the jobs, the window,
 * the settings), the state alone warm and three times at once, and the line under every reply of the chat in one request. For each:
 * its time, the processor seconds, the longest a status call waited meanwhile (how long the thread was held), and peak memory.
 */
async function trial(root: string): Promise<void> {
  const round = async (label: string): Promise<void> => {
    const s = await startServer(root);
    const c = encodeURIComponent(s.chat);
    const say = (what: string, m: { ms: number; cpu: number | null; heldMs: number; peakMb: number; afterMb: number | null }, more: Record<string, unknown> = {}): void => {
      console.log(JSON.stringify({ round: label, what, ms: m.ms, cpu: m.cpu, heldMs: m.heldMs, peakMb: m.peakMb, afterMb: m.afterMb, ...more }));
    };
    console.log(JSON.stringify({ round: label, what: "listening", ms: s.startedMs }));
    const pass = await measured(s.pid, s.call, async () => {
      const began = performance.now();
      for (;;) {
        const log = s.logs();
        if (log.includes(`"chat":"${s.chat}"`) && /made ready|could not be made ready/.test(log)) return "done";
        if (!/makes ready|made ready/.test(log) && performance.now() - began > 10_000) return "none";
        await Bun.sleep(100);
      }
    });
    say("the start's pass", pass, { pass: pass.result });
    const newest = (JSON.parse((await s.call(`/api/v1/chats/${c}/turns?limit=1`)).text) as { turns: { id: string }[] }).turns[0]?.id ?? "";
    const page = [`/state`, `/state`, `/turns?limit=1`, `/turns?limit=1`, `/turns?limit=1`, `/turns?limit=1`, `/jobs`, `/jobs`, `/jobs`, `/window`, `/window`, `/turns/${newest}`, `/turns/${newest}`, `/turns/${newest}`].map((p) => `/api/v1/chats/${c}${p}`);
    const opened = await measured(s.pid, s.call, () => Promise.all([...page.map((p) => s.call(p)), s.call("/api/v1/settings"), s.call("/api/v1/status/extension"), s.call("/api/v1/status/extension"), s.call("/api/v1/status/extension")]));
    say("one page opens the chat", opened, { slowest: Math.max(...opened.result.map((r) => r.ms)), failed: opened.result.filter((r) => r.status >= 400).map((r) => r.status) });
    say("the state, warm", await measured(s.pid, s.call, () => s.call(`/api/v1/chats/${c}/state`)));
    say("the state, three at once", await measured(s.pid, s.call, () => Promise.all([1, 2, 3].map(() => s.call(`/api/v1/chats/${c}/state`)))));
    const ids = Array.from({ length: 576 }, (_, i) => (i === 0 ? "big-m0" : `big-a${i}`));
    const lines = await measured(s.pid, s.call, () => s.call(`/api/v1/chats/${c}/replies?ids=${ids.join(",")}`));
    say("every reply's line in one request", lines, { status: lines.result.status, answered: lines.result.status === 200 ? (JSON.parse(lines.result.text) as { replies: unknown[] }).replies.length : lines.result.text.slice(0, 200) });
    const said = await s.stop();
    for (const line of said.split("\n").filter((l) => /made ready|held the thread long|could not be made ready/.test(l))) console.log(`  log: ${line.slice(0, 300)}`);
  };
  await round("start");
  await round("restart");
}

if (rootArg === undefined) throw new Error("Usage: bun scripts/perf/long-chat.ts bundle|make|read|trial <folder>");
if (command === "bundle") await bundle(resolve(rootArg));
else if (command === "make" && bundleArg !== undefined) await make(resolve(rootArg), resolve(bundleArg));
else if (command === "read") await read(resolve(rootArg));
else if (command === "trial") await trial(resolve(rootArg));
else throw new Error(`No such command: ${command}`);
