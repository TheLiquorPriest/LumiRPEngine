// What each part of a chat's state view costs, worked out in this process from a copy of RPE's database, opened read-only: the head's
// state, the quests' trails, each panel's builder, the HUD, the scene, the palette, the controls, the reply clocks, the chips and the
// state at the head's start, each timed on its own; the whole view twice more, the first as the first ask after a start makes it, with
// nothing held; each panel read apart (an organization's page, who may use a thing) item by item, as its sheet reads one; and what the
// pages read of the turns apart from the view, each read twice: the Journal's notes as the Journal reads them when it opens, and the
// lines under the newest 20 replies. Prints one line of JSON per part, slowest first: milliseconds of the first ask (cold) and of the
// second (warm), and the size of what it made.
// With `--keep`, the copy is written to: what the notes' and the lines' reads work out is stored with their turns' nodes, as RPE stores
// it, and timed as a row of its own; run it again on the same copy and those reads are a fresh process's over the rows a run before
// stored (the restart he feels), their rows named so. Without it nothing is written, but a copy made before the store kept such rows
// has their table made on it, as RPE's start makes it.
// Usage: bun scripts/perf/state-parts.ts <copy of rpe.db> <chat id> [build id the server folds under] [--keep]

import { Database } from "bun:sqlite";
import { playedWorld } from "../../src/engine/places-in-play";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { placeOfEntity } from "../../src/engine/scope";
import { historyTexts, installHistoryLines } from "../../src/iface/history-lines";
import { shippedTexts } from "../../src/iface/texts";
import { ALL_PACKS } from "../../src/packs/index";
import { journalNotes } from "../../src/play/journal";
import { chipsOf, replyClocks } from "../../src/play/panel-reads";
import { TAP_DEFAULTS } from "../../src/play/settings";
import { controls } from "../../src/play/state/controls";
import { hud } from "../../src/play/state/hud";
import { palette } from "../../src/play/state/palette";
import { scene } from "../../src/play/state/scene";
import { chatView, chatViewItem, headTurn } from "../../src/play/view";
import { questSliceOf, questViews } from "../../src/quests/record";
import { trailsOf } from "../../src/quests/trail";
import { MAP_DEFAULTS } from "../../src/shared/map-config";
import type { JsonValue } from "../../src/shared/json";
import { openStore, STORE_MIGRATIONS, storedWorlds } from "../../src/store";
import { storeTurnReads, type TurnReadKind, type TurnReadMade } from "../../src/store/turn-reads";
import type { Turns } from "../../src/turn/lane";
import { TurnMarks } from "../../src/turn/marks";
import { replyLines } from "../../src/turn/replies";
import { Runs } from "../../src/turn/runs";
import { STORE_AREAS } from "../../src/turn/store-areas";

const args = process.argv.slice(2);
const keeping = args.includes("--keep");
const [file, chat, build] = args.filter((a) => a !== "--keep");
if (file === undefined || chat === undefined) {
  console.error("Usage: bun scripts/perf/state-parts.ts <copy of rpe.db> <chat id> [build id the server folds under] [--keep]");
  process.exit(2);
}
await installHistoryLines(shippedTexts());
const tableless = new Database(file, { readonly: true });
const hasRows = tableless.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'turn_read'").get() !== null;
tableless.close();
const db = new Database(file, { readonly: !keeping && hasRows });
// The store's table of reads kept by node, from its own migration, on a copy made before it.
const kept = STORE_MIGRATIONS.find((m) => m.version === 17);
if (!hasRows && kept !== undefined && "sql" in kept) db.run(kept.sql);
const registry = createRegistry(ALL_PACKS);
const store = openStore({ db, registry, worlds: storedWorlds(db), areas: STORE_AREAS, ...(build === undefined ? {} : { fingerprint: build }), log: () => undefined, handlerFailed: () => undefined });
const user = (db.query("SELECT user FROM chat WHERE id = ?").get(chat) as { user: string } | null)?.user;
if (user === undefined) throw new Error(`no chat ${chat} in ${file}`);
const s = store.user(user);
const texts = await historyTexts(shippedTexts());

const times = new Map<string, { cold: number; warm: number | null; kb: number }>();
const timed = <T>(name: string, work: () => T): T => {
  const began = performance.now();
  const out = work();
  const ms = Math.round(performance.now() - began);
  const was = times.get(name);
  let kb = 0;
  try {
    kb = Math.round((JSON.stringify(out ?? null)?.length ?? 0) / 1024);
  } catch {
    kb = -1;
  }
  times.set(name, was === undefined ? { cold: ms, warm: null, kb } : { ...was, warm: ms });
  return out;
};
const timedAsync = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
  const began = performance.now();
  const out = await work();
  const ms = Math.round(performance.now() - began);
  const was = times.get(name);
  times.set(name, was === undefined ? { cold: ms, warm: null, kb: Math.round(JSON.stringify(out ?? null).length / 1024) } : { ...was, warm: ms });
  return out;
};
/** `work` timed under `name` (`timedAsync`), and under `<name>: longest hold of the thread` the longest RPE's thread was held in one piece while it ran (a timer's longest wait between its ticks). */
const timedHeld = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
  let last = performance.now();
  let longest = 0;
  const tick = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 1);
  try {
    return await timedAsync(name, work);
  } finally {
    clearInterval(tick);
    longest = Math.max(longest, performance.now() - last);
    const row = `${name}: longest hold of the thread`;
    const was = times.get(row);
    times.set(row, was === undefined ? { cold: Math.round(longest), warm: null, kb: 0 } : { ...was, warm: Math.round(longest) });
  }
};

for (let ask = 0; ask < 2; ask++) {
  const folded = timed("head state", () => s.headState(chat));
  const state = folded.state.world;
  const doc = store.env.worlds(state.revision);
  if (doc === undefined) throw new Error(`the revision ${state.revision} is not kept`);
  const world = playedWorld(doc, state);
  const at = headTurn(s, chat);
  timed("state at the head turn's start", () => (at === null ? null : s.startOf(at).state.world.clock));
  timed("chips", () => chipsOf(db, s, user, chat));
  readPass(() => {
    const ctx = registry.context(world, state);
    const panels: Record<string, JsonValue> = {};
    // A panel read apart is no part of the view: its items are timed below, as Orgs reads them.
    for (const view of registry.views.filter((v) => v.apart !== true)) {
      try {
        panels[view.panel] = timed(`panel ${view.panel}`, () => view.build(ctx, { mapDisplay: null, mapConfig: MAP_DEFAULTS }));
      } catch (error) {
        panels[view.panel] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    timed("quest trails", () => trailsOf(s, store.env, chat, null, world.tracks, state.tracks));
    timed("quest views", () => questViews(world.tracks, questSliceOf(folded.state)));
    const shown = timed("scene", () => scene(world, state, 0, registry));
    timed("hud", () => hud(world, state, panels, ctx));
    timed("reply clocks", () => replyClocks(s, chat, world, placeOfEntity(state, world.pov), TAP_DEFAULTS.clocksMost));
    timed("controls", () => controls(world, state, shown.sceneType, registry, { chat: {}, tracking: TAP_DEFAULTS.choices.tracking, narrator: TAP_DEFAULTS.choices.narrator }, TAP_DEFAULTS.tell));
    timed("palette", () => palette(world, state, registry));
  });
}
// The whole view as the state route makes it, the Journal's notes no part of it: a first ask as the first after a start makes it, with
// no state held (what the parts above held let go of), then a second, which finds its built parts kept while the state stands.
const knowledge = { chat: {}, tracking: TAP_DEFAULTS.choices.tracking, narrator: TAP_DEFAULTS.choices.narrator };
store.dropCaches();
for (let ask = 0; ask < 2; ask++) {
  await timedHeld("the whole state view, the first ask with nothing held", () =>
    chatView({ store, user, chat, turn: null, turning: false, offstage: TAP_DEFAULTS.tell, map: MAP_DEFAULTS, knowledge, chips: chipsOf(db, s, user, chat), meter: null, pending: [], clocksMost: TAP_DEFAULTS.clocksMost, staged: null, notCarried: [] }),
  );
}
// Each panel read apart as its sheet reads an item when it opens, after the view of the same state (`chatViewItem`): an organization's
// page (`orgs.org`), who may use a thing (`gear.use`). Every item's first read (all of them, and the slowest alone, each one piece on
// the thread), then a second read of the slowest, which the view's key keeps.
const at = { store, user, chat, turn: null, offstage: TAP_DEFAULTS.tell, map: MAP_DEFAULTS, knowledge };
const head = s.headState(chat).state.world;
const headDoc = store.env.worlds(head.revision);
for (const def of registry.views) {
  const items = def.apart === true ? def.items : undefined;
  if (items === undefined || headDoc === undefined) continue;
  const ids = readPass(() => items.ids(registry.context(playedWorld(headDoc, head), head)));
  let slowest = { id: "", ms: -1, kb: 0 };
  let all = { ms: 0, kb: 0 };
  for (const id of ids) {
    const began = performance.now();
    const item = chatViewItem(at, def.panel, id);
    const ms = performance.now() - began;
    const kb = JSON.stringify(item).length / 1024;
    all = { ms: all.ms + ms, kb: all.kb + kb };
    if (ms > slowest.ms) slowest = { id, ms, kb };
  }
  if (slowest.id === "") continue;
  const began = performance.now();
  chatViewItem(at, def.panel, slowest.id);
  times.set(`${def.panel} read apart: one item, the slowest of ${ids.length}`, { cold: Math.round(slowest.ms), warm: Math.round(performance.now() - began), kb: Math.round(slowest.kb) });
  times.set(`${def.panel} read apart: every item, one read each (${ids.length})`, { cold: Math.round(all.ms), warm: null, kb: Math.round(all.kb) });
}
// What the pages read of the turns apart from the view, each twice: the Journal's notes as the Journal reads them when it opens after
// the view (`GET …/state/journal`), and the lines under the newest 20 replies (`GET …/replies`). A first read takes each turn's from its
// node's row, else works it out from the turn's state (the oldest's fold runs on this thread, where the server gives it a worker); the
// second finds them in memory. With `--keep` what they worked out is stored after them, as RPE's write queue stores it.
const over = db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM turn_read WHERE user = ?").get(user)?.n ? ", over the rows a run before stored" : "";
const made: [TurnReadKind, ReadonlyMap<string, TurnReadMade>][] = [];
const keep = keeping ? (_: unknown, __: string, kind: TurnReadKind, rows: ReadonlyMap<string, TurnReadMade>): void => void (rows.size > 0 && made.push([kind, rows])) : undefined;
for (let ask = 0; ask < 2; ask++) await timedHeld(`the Journal's notes read apart (100 turns)${over}`, () => journalNotes(store, user, chat, TAP_DEFAULTS.journalMost, { texts, code: (c) => c, key: "probe" }, keep));
const writes = { run: async <T>(write: (on: Database) => T): Promise<T> => write(db) };
const turns = { store, marks: new TurnMarks(db, writes as never), runs: new Runs(db, writes) } as unknown as Pick<Turns, "store" | "marks" | "runs">;
const newest = s
  .path(chat)
  .filter((e) => !e.user && e.turn !== null)
  .slice(-20)
  .map((e) => e.message);
for (let ask = 0; ask < 2; ask++) await timedHeld(`the newest 20 replies' lines read apart${over}`, () => replyLines(turns, user, chat, newest, undefined, { texts, key: "probe" }, keep));
if (made.length > 0) timed("storing what the notes' and the lines' reads worked out", () => db.transaction(() => made.forEach(([kind, rows]) => storeTurnReads(store, user, kind, rows)))());
const rows = [...times].map(([part, t]) => ({ part, ...t })).sort((a, b) => (b.warm ?? b.cold) - (a.warm ?? a.cold));
for (const row of rows) console.log(JSON.stringify(row));
console.log(JSON.stringify({ total: { cold: rows.reduce((n, r) => n + r.cold, 0), warm: rows.reduce((n, r) => n + (r.warm ?? 0), 0) }, tracks: Object.keys(store.env.worlds(s.headState(chat).state.world.revision)?.tracks ?? {}).length }));
