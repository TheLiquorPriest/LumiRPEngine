// The turn probe itself (`turn-parts.ts` is its entry, which a worker thread runs too and serves its tasks from): a turn's parts, timed
// one at a time on copies of a user's RPE data, with the longest each held RPE's thread in one piece: the reads a turn's intake makes
// until the model's first call (where the probe stops it), the turn's commit from invented changes, the reads a page makes after it,
// and the same after a swipe of that turn and after an Undo. RPE's own composition is opened over the copies, with Lumiverse's database
// read where it lies, read-only, by the door's own reader. It has no network: every road out (an HTTP call, a web socket, a model) is a
// part that throws by name, and the run stops there, saying which. It writes only to the copies and to the folder the copy of the
// database is in. Nothing of his text is printed: one line of JSON a part (its name, ms, kb, the longest hold), a total, what it could
// not make, and an error by its kind and the part it stopped (with `RPE_PROBE_DEBUG` set, an error's stack goes to standard error too,
// for a trial on invented data).
//
// The copy of the database's folder is RPE's data folder for the run: it takes a first config.json there (no secrets.json is read or
// made), and a backup of the database there if this build migrates it. The build id names the snapshots the folds use: the id of the
// build that made them (his server's) folds from them; another folds from the chat's start, as an update does.

import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import type { TaggedTurn } from "../../src/adapter/lumiverse/provider";
import type { ReplyStream } from "../../src/adapter/lumiverse/stream";
import { textHash } from "../../src/adapter/lumiverse/wire";
import { dataPaths, openApp, readQuery } from "../../src/app";
import { compose } from "../../src/app/compose";
import { configOf } from "../../src/app/config";
import { loadGuidance } from "../../src/app/guidance";
import { CAST_VIEWS, castPresentViews, castViews, type CastViewName, MemorySearch } from "../../src/cast";
import { charactersOf } from "../../src/cast/record";
import { ROW_PARTS } from "../../src/cast/fold";
import { historyTexts, mapView, mapWording } from "../../src/iface";
import { placeLinesAt } from "../../src/places";
import { tidyHolds } from "../../src/play/path-events";
import { journalNotes } from "../../src/play/journal";
import { playAnswers } from "../../src/play/service";
import { hashParts } from "../../src/shared/hash";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import { trailsOf } from "../../src/quests/trail";
import { own } from "../../src/engine/pack-kit";
import { type ChangeInput, timeDue, WORLD_STATE_SECTIONS, worldState, worldStateFolds } from "../../src/store";
import { storyBrief } from "../../src/story";
import { RPE_GUIDANCE } from "../../src/tree";
import { maskWorldInfoScanExclusions, SCAN_SETTING, scannedSteps, scanSettingsOf } from "../../src/turn/scan";
import { turnSettings } from "../../src/turn/settings";
import { stageAt, stageCues } from "../../src/turn/stage";
import { guidanceTexts } from "../../src/turn/texts";
import { castLayouts, NO_SESSION, ON_STAGE_VIEWS, PARTS, tokenCount } from "../../src/turn/turns";

const [rpeDb, filesDir, indexFile, lumiverseDb, chat, build] = process.argv.slice(2);
if (rpeDb === undefined || filesDir === undefined || indexFile === undefined || lumiverseDb === undefined || chat === undefined || build === undefined) {
  console.log(JSON.stringify({ stopped: "arguments", wants: "<copy of rpe.db> <copy of files/> <copy of the index file> <Lumiverse's database> <chat id> <build id>" }));
  process.exit(2);
}

// ---------------------------------------------------------------- no network

/** A road out the probe refused, by what asked; the run stops at the first. */
const refused: string[] = [];
class NoNetwork extends Error {
  constructor(readonly what: string) {
    super(`the probe has no network: ${what}`);
    this.name = "NoNetwork";
  }
}
const refuse =
  (what: string) =>
  (..._: unknown[]): never => {
    refused.push(what);
    throw new NoNetwork(what);
  };
// Every fetch and web socket of this process, whoever makes one: RPE's and RPH's code reach out by nothing else but a server
// (`Bun.serve`), which only `App.start` makes, and the probe never starts one. Bun's own properties cannot be replaced.
globalThis.fetch = Object.assign(refuse("an HTTP call (fetch)"), { preconnect: refuse("an HTTP call (preconnect)") }) as unknown as typeof fetch;
(globalThis as { WebSocket: unknown }).WebSocket = class {
  constructor() {
    refuse("a web socket")();
  }
};

/** One line of output. */
const say = (line: Record<string, JsonValue>): void => console.log(JSON.stringify(line));

/** An error as the output tells it: its kind alone, never its words. */
const kindOf = (error: unknown): string => (error instanceof NoNetwork ? "NoNetwork" : error instanceof Error ? error.name || "Error" : typeof error);

/** Stops the run where a road out was asked for, naming it and the part it stopped. */
function stopIfRefused(part: string): void {
  if (refused.length === 0) return;
  say({ stopped: "network", by: refused[0] ?? "", part });
  process.exit(3);
}

// ---------------------------------------------------------------- the thread's holds

// A timer that ticks every millisecond: a wait between its ticks longer than that is RPE's thread held in one piece.
const gaps: { from: number; to: number }[] = [];
let lastTick = performance.now();
const ticker = setInterval(() => {
  const now = performance.now();
  if (now - lastTick > 2) gaps.push({ from: lastTick, to: now });
  lastTick = now;
}, 1);
/** The longest the thread was held in one piece between `from` and `to` (performance time). */
const heldBetween = (from: number, to: number): number => Math.round(Math.max(0, ...gaps.map((g) => Math.min(g.to, to) - Math.max(g.from, from))));
/** The machine clock's time as performance time. */
const offset = Date.now() - performance.now();

const rows: { part: string; ms: number; kb: number; held: number }[] = [];
const notMade: string[] = [
  "the lore's projection book, refreshed after a run (it writes to Lumiverse)",
  "the reply's tie by Lumiverse's end of the generation (the turn is tied by the store's own call, to an invented message)",
  "the server's own steps before a route (a route is called by its handler)",
  "the swipe's and the Undo's intake (each is made by the store's own calls)",
];

async function timed<T>(part: string, work: () => T | Promise<T>, size: (out: T) => number = () => 0): Promise<T | undefined> {
  const from = performance.now();
  let out: T | undefined;
  try {
    out = await work();
  } catch (error) {
    stopIfRefused(part);
    say({ part, error: kindOf(error) });
    if (process.env.RPE_PROBE_DEBUG !== undefined) console.error(error instanceof Error ? error.stack : String(error));
    return undefined;
  }
  const to = performance.now();
  // The tick that ends a hold comes after the work: let it come.
  await Bun.sleep(5);
  stopIfRefused(part);
  let kb = 0;
  try {
    kb = out === undefined ? 0 : Math.round(size(out) / 1024);
  } catch {
    kb = -1;
  }
  const row = { part, ms: Math.round(to - from), kb, held: heldBetween(from, to) };
  rows.push(row);
  say(row);
  return out;
}

// ---------------------------------------------------------------- RPE over the copies

const found = (() => {
  const db = new Database(rpeDb, { readonly: true });
  try {
    return db.query<{ user: string }, [string]>("SELECT user FROM chat WHERE id = ?").get(chat)?.user ?? null;
  } finally {
    db.close();
  }
})();
if (found === null) {
  say({ stopped: "the copy of the database holds no such chat" });
  process.exit(2);
}
const owner: string = found;
const root = dirname(resolve(rpeDb));
const fromFiles = dataPaths(dirname(resolve(filesDir)));
if (fromFiles.files !== resolve(filesDir)) {
  say({ stopped: "the copy of the files folder is not named files" });
  process.exit(2);
}
const paths = { ...dataPaths(root), database: resolve(rpeDb), index: resolve(indexFile), files: fromFiles.files, globalConfig: fromFiles.globalConfig, shippedConfig: fromFiles.shippedConfig };
// Config.json's values the composition needs, invented: Lumiverse at an address nothing answers at (every call to it is refused before it
// leaves), his user (the chat's, read from the copy), and Lumiverse's database where it lies, which the door's reader opens read-only.
const config = configOf({ v: 1, port: 0, lumiverse: { url: "http://lumiverse.probe.invalid", user: owner, database: resolve(lumiverseDb) } }, {}, "the probe's config");
const logged = { debug: 0, info: 0, warn: 0, error: 0 };
// What RPE logs is counted by level and never printed; a trial on invented data (`RPE_PROBE_DEBUG`) has each line's words on standard error.
const debug = process.env.RPE_PROBE_DEBUG !== undefined;
const logLine = (level: keyof typeof logged) => (message: string, fields?: Record<string, JsonValue>) => {
  logged[level]++;
  if (debug) console.error(`${level} ${message}${fields === undefined ? "" : ` ${JSON.stringify(fields)}`}`);
};
const log = { debug: logLine("debug"), info: logLine("info"), warn: logLine("warn"), error: logLine("error") };
const composition = compose({
  fetch: refuse("an HTTP call to Lumiverse"),
  open: refuse("a socket to Lumiverse"),
  // The model layer: no agent is given a model. The intake stops before the first call (below); reaching one stops the run.
  harness: { models: { agentModel: refuse("a model") } },
});
const app = await timed("RPE opened over the copies", () => openApp({ paths, config, version: build, areas: composition.areas, ui: null, log }));
if (app === undefined) process.exit(1);
const mounted = composition.turns();
if (mounted === null) {
  say({ stopped: "the turn lane did not mount" });
  process.exit(1);
}
const turns = mounted;
const s = turns.store.user(owner);
const scope = { user: owner, chat, session: NO_SESSION };
const settings = await turnSettings(turns.files, scope, turns.env.log);
const table = app.routes.fix();
/** A route of RPE's, called by its handler as the server calls it for his page. */
async function route(path: string, params: Record<string, string>, query: Record<string, string> = {}): Promise<unknown> {
  const placed = table.get(path)?.get("GET");
  if (placed === undefined || "raw" in placed.route) throw new Error(`no route GET ${path}`);
  const read = readQuery(placed.route.query ?? {}, new URLSearchParams(Object.entries(query)), path);
  if (!read.ok) throw new Error(`the probe's query for ${path} does not read`);
  const handle = placed.route.handle as (call: unknown) => Promise<unknown>;
  return await handle({ params, query: read.value, body: undefined, user: owner, auth: { user: owner, access: placed.route.access, listener: "tcp", credential: null }, signal: new AbortController().signal });
}
const size = (out: unknown): number => JSON.stringify(out ?? null).length;

// The words the Journal's notes are worked out in, as the state route works them out (`PlayService.stateView`).
const texts = await historyTexts(guidanceTexts(turns.files, scope, turns.env.log));
const keys = (await playAnswers(RPE_GUIDANCE)).keys;
const words = { texts, code: (code: string) => own(keys, code) ?? code, key: hashParts("journal-words", JSON.stringify(texts), JSON.stringify(keys)) };

await timed("before the turn: the head's state", () => s.headState(chat));

// ---------------------------------------------------------------- what a briefing is built from, each on its own

// Read as the newest turn's own briefing read them, at its start, before the turn the probe plays: each cold, as the intake's
// briefing finds them for its turn (that step's row below is all of them together, and the rest of the briefing).
const newestTurn = s.path(chat).findLast((e) => e.turn !== null && !e.user)?.turn ?? null;
if (newestTurn === null) notMade.push("the briefing's parts (the chat has no turn yet)");
else {
  const point = { user: owner, chat, session: NO_SESSION, turn: newestTurn };
  const guidance = loadGuidance(turns.files, point);
  const statePart = await guidance.part(PARTS.worldState);
  const layout = statePart === undefined ? null : await turns.files.read(point, statePart.source.path);
  const maps = mapView(await mapWording(guidanceTexts(turns.files, point, turns.env.log)), settings.map);
  if (layout?.status === "read") {
    const text = layout.text;
    const inputAt = (turn: string, layoutText: string) => ({ chat, turn, layout: layoutText, map: maps, drawnGiven: {}, placeLines: placeLinesAt(s, turns.store.env, chat, turn, settings.places, settings.map), holds: tidyHolds(turns.store, owner, turn, settings.taps.tidy), due: timeDue(turns.store), settings: settings.worldState, charsPerToken: settings.charsPerToken });
    // The states it reads, folded first as the briefing folds them (a long fold on a worker thread), then the world state over them.
    await timed("a briefing's world state's states, folded as the briefing folds them", () => turns.store.afar(() => worldStateFolds(s, newestTurn)));
    await timed("a briefing's world state", () => worldState(s, inputAt(newestTurn, text)), (o) => o.text.length);
    // Its parts, read at the start of the turn before the newest (another state, as cold): the tree over the state, then each section of
    // the layout alone (the layout's own lines, a body of that section only), each on the tree the ones before it read.
    const earlier = s.turn(newestTurn)?.parent ?? null;
    const closing = text.startsWith("---\n") ? text.indexOf("\n---", 4) : -1;
    if (earlier !== null && s.turn(earlier)?.chat === chat && closing >= 0) {
      const head = text.slice(0, text.indexOf("\n", closing + 1) + 1);
      await timed("a world state's states, folded as the briefing folds them (the turn before)", () => turns.store.afar(() => worldStateFolds(s, earlier)));
      await timed("a world state's tree over the state (the turn before)", () => s.viewAt(earlier));
      await timed("a world state's holds that cannot be (the turn before)", () => tidyHolds(turns.store, owner, earlier, settings.taps.tidy), size);
      await timed("a world state's place lines, made (the turn before)", () => placeLinesAt(s, turns.store.env, chat, earlier, settings.places, settings.map));
      for (const section of WORLD_STATE_SECTIONS) await timed(`a world state's section ${section} alone (the turn before)`, () => worldState(s, inputAt(earlier, `${head}{{${section}}}\n`)), (o) => o.text.length);
      await timed("a world state whole, after its sections (the turn before)", () => worldState(s, inputAt(earlier, text)), (o) => o.text.length);
    } else notMade.push("a world state's parts (no turn before the newest, or a layout with no header)");
  } else notMade.push("a briefing's world state (its layout part is not in force for the chat)");
  const said = (await guidance.part(PARTS.briefing))?.header[ON_STAGE_VIEWS];
  const named = Array.isArray(said) ? said.flatMap((n) => (typeof n === "string" && n.trim() !== "" ? [n.trim()] : [])) : [];
  const stage = stageAt(turns.store, owner, chat, newestTurn);
  const search = new MemorySearch(app.index);
  const tokens = tokenCount(settings.charsPerToken);
  if (stage !== null && stage.who.length > 0) {
    const present = stage.who;
    const cues = stageCues(stage);
    if (named.length > 0) {
      await timed("a briefing's views of those on stage", async () => castPresentViews(named, { store: turns.store, user: owner, chat, turn: newestTurn, present, sources: turns.sources, search, layouts: await castLayouts(guidance, named), tokens, settings: settings.cast, cues }), size);
    } else notMade.push("a briefing's views of those on stage (the briefing names none)");
    // The turn's folder's cast views: every view of each character on stage, as the lane writes them alongside the first model call.
    const all = Object.keys(CAST_VIEWS) as CastViewName[];
    await timed(
      "the cast's folder: every view of each on stage",
      async () => {
        const layouts = await castLayouts(guidance, all);
        const out = [];
        for (const character of new Set(present)) out.push(await castViews(all, { store: turns.store, user: owner, chat, turn: newestTurn, character, present, sources: turns.sources, search, layouts, tokens, settings: settings.cast, cues }));
        return out;
      },
      size,
    );
  } else notMade.push("the cast's views (nobody is on stage at the newest turn)");
  const reads = composition.door.lumiverse()?.reads;
  if (reads !== undefined) {
    await timed(
      "a briefing's lore map: the chat's scan and the lore's catalogue",
      async () => {
        const scan = scanSettingsOf((await reads.setting(SCAN_SETTING))?.value);
        const steps = (await reads.path(chat)) ?? [];
        const scanned = scannedSteps(steps, new Set(), scan.depth);
        const first = scanned[0] === undefined ? -1 : steps.indexOf(scanned[0]);
        const ids = new Set(scanned.map((m) => m.id));
        const messages = first < 0 ? [] : (await reads.messages(chat, { from: first, to: steps.length })).filter((m) => ids.has(m.id)).map((m) => maskWorldInfoScanExclusions(m.text));
        return await turns.loreIndex.loreMap({ user: owner, chat, turn: newestTurn, messages, matching: scan.matching });
      },
      size,
    );
  }
  const briefPart = await guidance.part(PARTS.storyBrief);
  if (briefPart?.format === "template") await timed("a briefing's story brief", () => storyBrief({ store: turns.store, user: owner, chat, turn: newestTurn, ...(stage !== null ? { stage: stage.who } : {}), layout: briefPart }), (o) => o.text.length);
  await timed("the window, as the next briefing works it out", () => turns.lane.windowOf(owner, chat), size);
}
notMade.push("the lore's search and the session files (an agent's run reads and writes them, after the model's first call)");

// What a page reads before the turn, so that what is read after it is what a turn changes.
const newestReplies = (): string[] =>
  s
    .path(chat)
    .filter((e) => !e.user && e.turn !== null)
    .slice(-20)
    .map((e) => e.message);
await timed("before the turn: the Journal's notes", () => journalNotes(turns.store, owner, chat, settings.taps.journalMost, words), size);
await timed("before the turn: /state", () => route("/api/v1/chats/:chat/state", { chat }), size);
await timed("before the turn: the reply lines of the newest 20 replies", () => route("/api/v1/chats/:chat/replies", { chat }, { ids: newestReplies().join(",") }), size);

// ---------------------------------------------------------------- the intake, to the model's first call

const generation = `probe-${crypto.randomUUID()}`;
const reply = `probe-reply-${crypto.randomUUID()}`;
const INVENTED = "An invented message, the probe's.";
const tagged: TaggedTurn = {
  tag: { v: 1, user: owner, chat, generation, kind: "new", target: { message: reply, swipe: 0 }, speaker: { id: null, name: null }, connection: "probe", preset: null, persona: null, cut: { answered: false }, secrecy: { by: "rpe" }, question: null, messages: [] },
  prompt: [{ role: "user", content: INVENTED }],
  layout: { messages: [], complete: true, blocks: [], blocksFrom: null, preset: null },
  cut: { keep: null, byExtension: null, byRpe: 0, joining: { post: "none", collapse: false, from: "settings" }, told: true, clipped: null, notices: [], secrecy: { by: "rpe" }, question: null, trimmed: null, lore: null },
  model: null,
  lore: [],
  parameters: {},
};
const out: ReplyStream = { reasoning: () => undefined, content: () => undefined, progress: () => undefined, toolCalls: () => undefined, finish: () => undefined, error: () => undefined };
// The intake ends where the harness is asked to answer: the model's first call comes after. The probe stops the turn there.
let reached: number | null = null;
class ProbeStop extends Error {
  constructor() {
    super("the probe stops the turn before its model's first call");
    this.name = "ProbeStop";
  }
}
turns.harness.answer = async () => {
  reached = performance.now();
  throw new ProbeStop();
};
const began = performance.now();
await timed("the intake, to the model's first call", async () => {
  try {
    await turns.lane.play(tagged, out, new AbortController().signal);
  } catch (error) {
    if (reached === null) throw error;
  }
  if (reached === null) throw new Error("the intake ended before the model's first call");
});
// Each step of the intake as the lane timed it (`RunRecord.intake`), with the longest hold inside it.
const run = app.db.query<{ turn: string; intake: string | null }, [string, string]>("SELECT turn, intake FROM turn_run WHERE user = ? AND generation = ?").get(owner, generation);
for (const step of JSON.parse(run?.intake ?? "[]") as { step: string; from: number; to: number }[]) {
  const from = step.from - offset;
  const to = step.to - offset;
  const row = { part: `intake: ${step.step}`, ms: Math.round(step.to - step.from), kb: 0, held: heldBetween(from, to) };
  rows.push(row);
  say(row);
}
if (reached !== null) {
  const row = { part: "intake: the briefing kept, to the model's first call", ms: Math.round(reached - began - rows.filter((r) => r.part.startsWith("intake: ")).reduce((n, r) => n + r.ms, 0)), kb: 0, held: 0 };
  say(row);
}
// An intake that stopped before it kept a run (its row says how) leaves the turn to the store's own call: the rest is measured as after one.
if (run === null) notMade.push("the intake's steps (it stopped before it kept its run: its row names the error's kind)");
await turns.lane.settled();

// ---------------------------------------------------------------- the commit, of invented changes of the kinds his turns hold most

const head = s.headState(chat).state.world;
const pov = turns.store.env.worlds(head.revision)?.pov ?? null;
const someone = Object.keys(head.entities).find((id) => id !== pov && head.entities[id]?.kind === "person") ?? Object.keys(head.entities)[0] ?? "";
const character = charactersOf(app.db, owner, [chat])[0]?.id ?? "probe-character";
const invented = (n: number): ChangeInput[] => [
  { lane: "engine", op: "clock", value: { type: "clock", minutes: 7, cause: "tick" }, by: "gm", source: "gm" },
  { lane: "engine", op: "set", value: { type: "set", entity: someone, field: "probe_mark", value: n }, by: "gm", source: "gm" },
  { lane: "engine", op: "minds.mind", value: { type: "minds.mind", data: { entity: someone, at: head.clock, place: null, level: "live", moment: "turn", reason: "live", monologue: "An invented thought.", depiction: "An invented look.", intent: "An invented aim.", reactions: [], plans: [], mood: null, interrupt: null, withheld: false } } as unknown as JsonObject, by: "gm", source: "gm" },
  { lane: "story", op: "story.write", value: { part: "thread", item: `probe-thread-${n}`, value: { text: `An invented thread, the probe's ${n}.`, hot: true } }, by: "author" },
  { lane: "story", op: "cast.write", value: { character, part: ROW_PARTS[2], item: `probe-item-${n}`, value: { text: "An invented note, the probe's." } }, by: "author" },
];
let turn = run?.turn ?? "";
if (s.turn(turn)?.status !== "open") turn = (await app.writes.run(() => s.beginTurn({ chat, kind: "normal" }), "the probe's turn")).id;
await timed("the commit: the turn's changes recorded", () => app.writes.run(() => s.addChanges(turn, invented(1)), "the probe's changes"));
await timed("the commit: the turn tied to its reply", () => app.writes.run(() => s.tieTurn(turn, { message: reply, hash: textHash("An invented reply, the probe's."), date: Date.now() }), "the probe's tie"));

// ---------------------------------------------------------------- what a page reads after it

async function afterReads(after: string): Promise<void> {
  // The chat's own reading of its head alone (`headState`: the head turn's state with his changes that stand after it), as the first
  // read after a write folds it: the rows after it find it held.
  await timed(`${after}: the head's reading, alone`, () => s.headState(chat));
  // The quests' trails alone, as the view reads them at the head: one walk of the path, asking what stands placed before each turn
  // where his own change or an ended job's is anywhere (`valueHistories`).
  await timed(
    `${after}: the quests' trails, alone`,
    () => {
      const { world } = s.headState(chat).state;
      return trailsOf(s, turns.store.env, chat, null, turns.store.env.worlds(world.revision)?.tracks ?? {}, world.tracks);
    },
    size,
  );
  // The Journal's notes, as the first state asked works them out; the state asked after them finds them kept.
  await timed(`${after}: the Journal's notes`, () => journalNotes(turns.store, owner, chat, settings.taps.journalMost, words), size);
  await timed(`${after}: /state, the first ask (its notes worked out the row before)`, () => route("/api/v1/chats/:chat/state", { chat }), size);
  await timed(`${after}: the reply lines of the newest 20 replies`, () => route("/api/v1/chats/:chat/replies", { chat }, { ids: newestReplies().join(",") }), size);
  await timed(`${after}: the head's state`, () => s.headState(chat));
  await timed(`${after}: /state, a second ask`, () => route("/api/v1/chats/:chat/state", { chat }), size);
}
await afterReads("after the turn");

// A swipe of that turn: another attempt at its reply, begun, recorded and tied as the lane does.
const swipe = await timed("a swipe: begun", () => app.writes.run(() => s.beginTurn({ chat, kind: "swipe", target: reply }), "the probe's swipe"));
if (swipe !== undefined) {
  await timed("a swipe: its changes recorded", () => app.writes.run(() => s.addChanges(swipe.id, invented(2)), "the probe's swipe's changes"));
  await timed("a swipe: tied to its reply", () => app.writes.run(() => s.tieTurn(swipe.id, { message: reply, hash: textHash("Another invented reply, the probe's."), date: Date.now() }), "the probe's swipe's tie"));
  await afterReads("after a swipe");
  // A job of the swipe's turn, with one invented change, ended as a job ends when it settles: what it changed takes effect at once.
  await timed("a job of the swipe: its change recorded", () => app.writes.run(() => s.addChanges(swipe.id, invented(3).slice(1, 2).map((c) => ({ ...c, job: "probe-job" }))), "the probe's job's change"));
  await timed("a job of the swipe: ended", () => app.writes.run(() => s.endJob("probe-job"), "the probe's job's end"));
  await afterReads("after a job's end");
}

// An edit of his own (invented, as the page writes one), then its Undo, with the same reads after each.
const edit = await timed("an edit of his own", () => app.writes.run(() => s.addOwnerChanges(chat, [{ lane: "engine", op: "set", value: { type: "set", entity: someone, field: "probe_mark", value: 99 }, by: "player", source: "player" }]), "the probe's edit"));
if (edit !== undefined) {
  await afterReads("after an edit of his own");
  const undone = edit.changes[0]?.id;
  if (undone !== undefined) {
    await timed("an Undo of his edit", () => app.writes.run(() => s.undo(undone), "the probe's undo"));
    await afterReads("after an Undo of his edit");
  }
}

clearInterval(ticker);
// The intake's steps are parts of the intake, counted in its own row once.
const counted = rows.filter((r) => !r.part.startsWith("intake: "));
say({ total: { ms: counted.reduce((n, r) => n + r.ms, 0), held: Math.max(0, ...rows.map((r) => r.held)) }, logged });
say({ "not made": notMade });
await app.close();
process.exit(0);
