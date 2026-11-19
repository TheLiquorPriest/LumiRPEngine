// What each part of a chat's state view costs, worked out in this process from a copy of RPE's database, opened read-only: the head's
// state, the Journal's notes, the quests' trails, each panel's builder, the HUD, the scene, the palette, the controls, the reply clocks,
// the chips and the state at the head's start, each timed on its own, the whole view twice more, and the organizations' pages as Orgs
// reads them apart. Prints one line of JSON per part,
// slowest first: milliseconds of the first ask (cold) and of the second (warm), and the size of what it made. Nothing is written.
// Usage: bun scripts/perf/state-parts.ts <copy of rpe.db> <chat id> [build id the server folds under]

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
import { ORGS_ORG_PANEL, ORGS_SUMMARY_PANEL } from "../../src/shared/org-view";
import type { StateView } from "../../src/shared/state-view";
import { openStore, storedWorlds } from "../../src/store";
import { STORE_AREAS } from "../../src/turn/store-areas";

const [file, chat, build] = process.argv.slice(2);
if (file === undefined || chat === undefined) {
  console.error("Usage: bun scripts/perf/state-parts.ts <copy of rpe.db> <chat id> [build id the server folds under]");
  process.exit(2);
}
await installHistoryLines(shippedTexts());
const db = new Database(file, { readonly: true });
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

for (let ask = 0; ask < 2; ask++) {
  const folded = timed("head state", () => s.headState(chat));
  const state = folded.state.world;
  const doc = store.env.worlds(state.revision);
  if (doc === undefined) throw new Error(`the revision ${state.revision} is not kept`);
  const world = playedWorld(doc, state);
  const at = headTurn(s, chat);
  timed("state at the head turn's start", () => (at === null ? null : s.startOf(at).state.world.clock));
  await timedAsync("journal notes (100 turns)", () => journalNotes(store, user, chat, TAP_DEFAULTS.journalMost, { texts, code: (c) => c, key: "probe" }));
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
// The whole view as the state route makes it (its built parts kept while the state stands): a first ask of this state, then a second,
// with the longest RPE's thread was held in one piece while it was made (a timer's longest wait between its ticks).
const knowledge = { chat: {}, tracking: TAP_DEFAULTS.choices.tracking, narrator: TAP_DEFAULTS.choices.narrator };
let view: StateView | null = null;
for (let ask = 0; ask < 2; ask++) {
  const journal = await journalNotes(store, user, chat, TAP_DEFAULTS.journalMost, { texts, code: (c) => c, key: "probe" });
  let last = performance.now();
  let longest = 0;
  const tick = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 1);
  view = await timedAsync("the whole state view", () =>
    chatView({ store, user, chat, turn: null, turning: false, offstage: TAP_DEFAULTS.tell, map: MAP_DEFAULTS, knowledge, journal, chips: chipsOf(db, s, user, chat), meter: null, pending: [], clocksMost: TAP_DEFAULTS.clocksMost, staged: null, notCarried: [] }),
  );
  clearInterval(tick);
  longest = Math.max(longest, performance.now() - last);
  timed("the whole state view: longest hold of the thread", () => null);
  const row = times.get("the whole state view: longest hold of the thread");
  if (row !== undefined) times.set("the whole state view: longest hold of the thread", ask === 0 ? { ...row, cold: Math.round(longest) } : { ...row, warm: Math.round(longest) });
}
// An organization's page as Orgs reads it when it opens, after the view of the same state (`chatViewItem`): every page's first read
// (all of them, and the slowest alone, each one piece on the thread), then a second read of the slowest, which the view's key keeps.
const pages = Object.keys((view?.panels[ORGS_SUMMARY_PANEL] ?? {}) as object);
const at = { store, user, chat, turn: null, offstage: TAP_DEFAULTS.tell, map: MAP_DEFAULTS, knowledge };
let slowest = { id: "", ms: -1, kb: 0 };
let all = { ms: 0, kb: 0 };
for (const id of pages) {
  const began = performance.now();
  const page = chatViewItem(at, ORGS_ORG_PANEL, id);
  const ms = performance.now() - began;
  const kb = JSON.stringify(page).length / 1024;
  all = { ms: all.ms + ms, kb: all.kb + kb };
  if (ms > slowest.ms) slowest = { id, ms, kb };
}
if (slowest.id !== "") {
  const began = performance.now();
  chatViewItem(at, ORGS_ORG_PANEL, slowest.id);
  times.set(`one organization's page, the slowest of ${pages.length}`, { cold: Math.round(slowest.ms), warm: Math.round(performance.now() - began), kb: Math.round(slowest.kb) });
  times.set(`every organization's page, one read each (${pages.length})`, { cold: Math.round(all.ms), warm: null, kb: Math.round(all.kb) });
}
const rows = [...times].map(([part, t]) => ({ part, ...t })).sort((a, b) => (b.warm ?? b.cold) - (a.warm ?? a.cold));
for (const row of rows) console.log(JSON.stringify(row));
console.log(JSON.stringify({ total: { cold: rows.reduce((n, r) => n + r.cold, 0), warm: rows.reduce((n, r) => n + (r.warm ?? 0), 0) }, tracks: Object.keys(store.env.worlds(s.headState(chat).state.world.revision)?.tracks ?? {}).length }));
