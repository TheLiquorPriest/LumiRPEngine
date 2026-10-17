// Performance gate with the real packs (DESIGN §18.5): fold at 1k and 5k turns with a level-4
// ledger, a rebased view over 1k later turns (cold), record size per preset, a coarsened timelapse
// record, interceptor apply, and chat-open payload growth. Ledgers come from the real ledger core
// driving the real simulation (planTurn/postTurn, every pack) on the Riverton test world; no model.
// Main-process assembly cost (extension on versus off) is `bun scripts/perf/assembly.ts` (real host).
// Usage: bun scripts/perf/performance.ts [fold|presets|timelapse|interceptor|payload|all]

import { writeFileSync } from "node:fs";
import { hashJson } from "../../src/shared/hash";
import type { DomainId, Level } from "../../src/shared/ids";
import { DOMAINS } from "../../src/shared/ids";
import type { JsonValue } from "../../src/shared/json";
import type { ChatRun, MessageLedger } from "../../src/shared/ledger";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import type { FrontendToBackend } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import { LedgerFold } from "../../src/engine/ledger/fold";
import { emptyJournal, LedgerCore, type LedgerEnv, type TurnModel } from "../../src/engine/ledger/journal";
import { createRegistry } from "../../src/engine/registry-impl";
import type { InterpretOutput } from "../../src/engine/steps";
import { planTurn, postTurn, timelapseIntent } from "../../src/engine/turn";
import { Dispatcher } from "../../src/backend/dispatch";
import { ChatSnapshots } from "../../src/backend/ledger-io";
import { JobRunner } from "../../src/backend/jobs";
import { REALISM_PRESETS } from "../../src/backend/settings-store";
import { Runtime } from "../../src/backend/runtime";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../../test/packs/riverton";
import { FakeHost } from "../../test/support/fake-host";

/** Where the JSON report is written (`LRE_EVIDENCE_DIR`); without it the report only goes to stdout. */
const EVIDENCE = process.env.LRE_EVIDENCE_DIR;
const which = process.argv[2] ?? "all";
const registry = createRegistry(ALL_PACKS);
const report: Record<string, JsonValue> = { at: new Date().toISOString(), packs: ALL_PACKS.map((p) => p.id) };

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const p95 = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] ?? 0;
};
const r1 = (x: number): number => Math.round(x * 10) / 10;

function withLevels(world: WorldDoc, preset: "story" | "grounded" | "simulation" | "level4"): WorldDoc {
  const w = structuredClone(world);
  if (preset === "level4") {
    const levels = Object.fromEntries(DOMAINS.map((d) => [d, 4])) as Record<DomainId, Level>;
    w.realism = { preset: "custom", levels, tierCaps: { principal: {}, supporting: {}, background: {} } };
  } else w.realism = { preset, ...structuredClone(REALISM_PRESETS[preset]) };
  return w;
}

/** Riverton with `extra` more LOD1 agents (copies of Maya), for a dense timelapse. */
function withAgents(world: WorldDoc, extra: number): WorldDoc {
  const w = structuredClone(world);
  const maya = w.entities.maya;
  if (!maya) throw new Error("no Maya in Riverton");
  for (let i = 0; i < extra; i++) w.entities[`agent_${i}`] = { ...structuredClone(maya), id: `agent_${i}`, name: `Agent ${i}` };
  return w;
}

const TEXTS = ["walk to the cafe", "order a coffee", "chat with Maya", "wait twenty minutes", "head to the garage", "go home", "look around", "check my phone"];

/** A chat of `turns` turns made by the real ledger core and simulation; every tenth turn is a two-hour timelapse. */
function buildChat(world: WorldDoc, turns: number, timelapseEvery = 10, timelapseMinutes = 120, overrides: Record<string, string> = {}) {
  const revision = hashJson(world);
  const run: ChatRun = { v: 1, worldId: world.id, revision, runSeed: "bench", startedAt: 0 };
  const elapsed = new Map<string, number>();
  let intent: InterpretOutput | null = null;
  const model: TurnModel = {
    plan: ({ state, ctx, seed, kind, userTexts }) => {
      const plan = planTurn({ registry, world: ctx.world, state, runSeed: run.runSeed, seed, kind, userTexts, intent });
      elapsed.set(seed, plan.elapsedMinutes);
      return plan.events;
    },
    read: ({ state, ctx, seed }) => postTurn({ registry, world: ctx.world, state, runSeed: run.runSeed, seed, appliedMinutes: elapsed.get(seed.replace(/:read$/, "")) ?? 0, extracted: [] }),
  };
  let seeds = 0;
  // The chat keeps its fold snapshots as the real ledger service does (cold folds start from them).
  const env: LedgerEnv = { types: registry, worlds: (r) => (r === revision ? world : undefined), run, model, startMarkers: () => [], newSeed: () => `seed-${++seeds}`, snapshots: new ChatSnapshots() };
  const core = new LedgerCore(emptyJournal("bench"), env, new LedgerFold(registry));
  const observed: ChainMessage[] = [{ id: "m0", isUser: false, swipeId: 0, swipes: ["Morning in Riverton."], ledger: null }];
  core.sync(observed);
  const t0 = performance.now();
  for (let t = 0; t < turns; t++) {
    const timelapse = timelapseEvery > 0 && t % timelapseEvery === timelapseEvery - 1;
    intent = timelapse ? timelapseIntent({ type: "duration", minutes: timelapseMinutes }, overrides) : null;
    observed.push({ id: `u${t}`, isUser: true, swipeId: 0, swipes: [timelapse ? "(Timelapse)" : (TEXTS[t % TEXTS.length] ?? "")], ledger: null });
    const reply = { id: `a${t}`, isUser: false, swipeId: 0, swipes: [""], ledger: null };
    observed.push(reply);
    core.sync(observed);
    const generationId = `g${t}`;
    core.started({ generationId, kind: "normal", targetMessageId: reply.id, targetSwipeId: 0 }, observed);
    core.plan(generationId, observed, false);
    reply.swipes[0] = `Turn ${t} narration.`;
    core.saved(generationId);
    core.ended({ generationId, messageId: reply.id, content: reply.swipes[0] }, observed);
  }
  return { core, env, observed, buildMs: performance.now() - t0 };
}

function coldFold(chat: ReturnType<typeof buildChat>, observed: ChainMessage[], snapshots = true): { ms: number; folds: Record<string, number> } {
  // A fresh fold (an empty cache, as after a restart), with the chat's stored snapshots or without.
  const env: LedgerEnv = snapshots ? chat.env : { ...chat.env, snapshots: undefined };
  const fresh = new LedgerCore(chat.core.journal, env, new LedgerFold(registry));
  const t = performance.now();
  const out = fresh.fold(observed);
  const ms = performance.now() - t;
  const folds: Record<string, number> = {};
  for (const m of out.messages) folds[m.fold] = (folds[m.fold] ?? 0) + 1;
  return { ms, folds };
}

function sizes(ledgers: MessageLedger[]): JsonValue {
  const bytes = ledgers.map((l) => JSON.stringify(l).length);
  return { records: bytes.length, meanBytes: Math.round(bytes.reduce((a, b) => a + b, 0) / Math.max(1, bytes.length)), p95Bytes: p95(bytes), maxBytes: Math.max(0, ...bytes) };
}

if (which === "fold" || which === "all") {
  const world = withLevels(modernUsWorld("w_bench", "Riverton L4"), "level4");
  const out: Record<string, JsonValue> = {};
  // `B9_TURNS=50,200` for a quick run; the gate is 1,000 and 5,000.
  for (const turns of (process.env.B9_TURNS ?? "1000,5000").split(",").map(Number)) {
    const chat = buildChat(world, turns);
    const cold: number[] = [];
    for (let i = 0; i < 5; i++) cold.push(coldFold(chat, chat.observed).ms);
    const full: number[] = [];
    for (let i = 0; i < 3; i++) full.push(coldFold(chat, chat.observed, false).ms);
    const warmCore = new LedgerCore(chat.core.journal, chat.env, new LedgerFold(registry));
    warmCore.fold(chat.observed);
    const warm: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      warmCore.fold(chat.observed);
      warm.push(performance.now() - t);
    }
    const ledgers = Object.values(chat.core.journal.messages).map((m) => m.ledger);
    const events = ledgers.reduce((a, l) => a + Object.values(l.swipes).reduce((b, r) => b + r.events.length + r.post.reduce((c, p) => c + p.events.length, 0), 0), 0);
    const entry: Record<string, JsonValue> = { buildMs: Math.round(chat.buildMs), events, eventsPerTurn: r1(events / turns), coldFoldMedianMs: r1(median(cold)), coldFoldMaxMs: r1(Math.max(...cold)), fullFoldMedianMs: r1(median(full)), warmFoldMedianMs: r1(median(warm)), journalBytes: JSON.stringify(chat.core.journal).length, snapshotBytes: JSON.stringify(chat.env.snapshots ?? null).length, records: sizes(ledgers) };
    if (turns === 5000 || turns === 1000) {
      // A rebased view: switch an earlier reply to a new swipe with 1,000 later turns after it.
      const view = chat.observed.map((m) => ({ ...m, swipes: [...m.swipes] }));
      const at = view.length - 2 * 1000 - 1;
      const target = view[at];
      if (target && !target.isUser) {
        target.swipes.push("An alternative reply.");
        target.swipeId = target.swipes.length - 1;
        const runs: { ms: number; folds: Record<string, number> }[] = [];
        for (let i = 0; i < 5; i++) runs.push(coldFold(chat, view));
        entry.rebasedView1k = { coldMedianMs: r1(median(runs.map((x) => x.ms))), coldMaxMs: r1(Math.max(...runs.map((x) => x.ms))), folds: runs[0]?.folds ?? {} };
      }
    }
    out[`turns${turns}`] = entry;
    console.error(`fold ${turns}: ${JSON.stringify(entry)}`);
  }
  report.fold = out;
}

if (which === "presets" || which === "all") {
  const out: Record<string, JsonValue> = {};
  for (const preset of ["story", "grounded", "simulation", "level4"] as const) {
    const chat = buildChat(withLevels(modernUsWorld("w_bench", `Riverton ${preset}`), preset), 300);
    out[preset] = sizes(Object.values(chat.core.journal.messages).map((m) => m.ledger));
    console.error(`preset ${preset}: ${JSON.stringify(out[preset])}`);
  }
  report.recordSizePerPreset = out;
}

if (which === "timelapse" || which === "all") {
  // 20 LOD1 agents plus the POV: the default 600 agent-day cap ends the segment near 28 days.
  const out: Record<string, JsonValue> = {};
  for (const preset of ["simulation", "level4"] as const) {
    const world = withAgents(withLevels(modernUsWorld("w_bench", "Riverton dense"), preset), 17);
    const t = performance.now();
    // Every interrupt at `note`, so the segment runs to the unit cap (the dense case DESIGN §18.5 means).
    const chat = buildChat(world, 1, 1, 30 * 24 * 60, Object.fromEntries(Object.keys(world.time.interrupts).map((k) => [k, "note"])));
    const ms = performance.now() - t;
    const ledger = chat.core.journal.messages.a0?.ledger;
    const rec = ledger?.swipes["0"];
    out[preset] = { agents: Object.values(world.entities).filter((e) => e.agent).length, planAndCommitMs: Math.round(ms), events: rec?.events.length ?? 0, recordBytes: ledger ? JSON.stringify(ledger).length : 0, under32KB: ledger ? JSON.stringify(ledger).length < 32 * 1024 : false };
    console.error(`timelapse ${preset}: ${JSON.stringify(out[preset])}`);
  }
  report.timelapse = out;
}

if (which === "interceptor" || which === "payload" || which === "all") {
  const host = new FakeHost();
  const world = withLevels(modernUsWorld("w_bench", "Riverton"), "simulation");
  const rt = new Runtime({ host, packs: ALL_PACKS, pipeline: { plan: planTurn, post: postTurn }, templates: { riverton: () => structuredClone(world) } });
  const dispatch = new Dispatcher(rt, new JobRunner(host, rt.worlds, rt.steps, rt.settings, rt.registry));
  rt.start();
  dispatch.start();
  host.idle = async () => {
    await rt.ledger.idle();
    await rt.push.settle();
  };
  let req = 0;
  const send = async (request: Record<string, unknown>): Promise<JsonValue> => {
    const reqId = `r${++req}`;
    const before = host.sent.length;
    await dispatch.handle({ lre: PROTOCOL_VERSION, reqId, ...request } as unknown as FrontendToBackend, host.userId);
    await host.settle();
    const reply = host.sent.slice(before).find((m) => m.type === "lre.result" && m.reqId === reqId);
    return reply && reply.type === "lre.result" ? (JSON.parse(JSON.stringify(reply.body)) as JsonValue) : null;
  };
  const created = await send({ type: "lre.world", op: "create", name: "Riverton", template: "riverton" });
  const worldId = created && typeof created === "object" && !Array.isArray(created) && created.world && typeof created.world === "object" && !Array.isArray(created.world) ? created.world.id : null;
  if (typeof worldId !== "string") throw new Error("no world");
  const chatId = host.createChat("Morning in Riverton.");
  await send({ type: "lre.world", op: "attach", worldId, chatId });
  const payload: Record<string, JsonValue> = {};
  const marks = new Set([0, 100, 500, 1000]);
  const interceptMs: Record<string, JsonValue> = {};
  for (let t = 0; t <= 1000; t++) {
    if (marks.has(t)) {
      payload[`turns${t}`] = JSON.stringify(await rt.view(chatId, host.userId)).length;
      const ids = host.chat(chatId).metadata.chat_world_book_ids;
      const entries = [];
      for (const bookId of Array.isArray(ids) ? ids : []) {
        if (typeof bookId !== "string") continue;
        for (const e of await host.books.entries(bookId, host.userId)) entries.push({ id: e.id, bookId, extensions: e.extensions });
      }
      const xs: number[] = [];
      for (let i = 0; i < 12; i++) {
        const t0 = performance.now();
        await rt.intercept({ chatId, userId: host.userId, entries });
        xs.push(performance.now() - t0);
      }
      interceptMs[`turns${t}`] = { medianMs: r1(median(xs.slice(2))), p95Ms: r1(p95(xs.slice(2))), entries: entries.length };
      console.error(`turn ${t}: payload ${String(payload[`turns${t}`])} B, intercept ${JSON.stringify(interceptMs[`turns${t}`])}`);
    }
    if (t === 1000) break;
    host.sendUser(chatId, TEXTS[t % TEXTS.length] ?? "look around");
    await host.settle();
    const g = await host.start(chatId, { type: "normal" });
    await host.finish(g, `Turn ${t} narration.`);
  }
  report.payloadBytes = payload;
  report.interceptor = interceptMs;
  report.errors = rt.ledger.errors.slice(0, 5);
}

console.log(JSON.stringify(report, null, 1));
if (EVIDENCE) {
  const file = `${EVIDENCE}/perf-${which}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.error(`evidence: ${file}`);
}
