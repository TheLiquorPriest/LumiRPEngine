// The panels of a chat (plan §14, "What happens to today's UI": today's play panels kept, re-pointed to
// RPE): today's `StateView`, built from RPE's store at the chat's head or at one of its turns. Every
// pack's panel comes from the pack's own builder, and the HUD, the scene, the palette and the controls
// from today's pure builders, which live in `state/` as today's backend built them (`buildView`). The
// Journal's notes are read from the chat's turns (`journal.ts`); the chips under the replies, the HUD's
// meter and the pending marks from RPE's own records (`panel-reads.ts`), each newest reply's clock from
// its turn's story time; the controls' knowledge choices from the chat's settings; and what waits for his
// next message from a panel (`staged`) from the request the turn lane holds for it, in the words the next
// briefing gives the Author. The Keep report only
// today's ledger held, and is present and empty. Which of today's engines plays the chat is left out:
// none of them does, RPE does. A chat RPE plays on no world is answered as today answers a chat that is
// not a world's.

import { playedWorld } from "../engine/places-in-play";
import { passInStretches, readPass, type PassInStretches } from "../engine/read-pass";
import { placeOfEntity } from "../engine/scope";
import type { ReadContext } from "../engine/registry";
import type { WorldState } from "../engine/state";
import { definitionsLag } from "../engine/upgrade";
import type { PackId, PanelId } from "../shared/ids";
import type { JsonValue } from "../shared/json";
import type { MapConfig } from "../shared/map-config";
import type { WorldDoc } from "../shared/world";
import type { JournalNote } from "../shared/ledger";
import { linesGiven } from "../shared/lines";
import type { OffstageSettings } from "../shared/offstage";
import type { CallMeterView, Chip, PendingMark, StagedPress, StateView } from "../shared/state-view";
import type { RequestRecord } from "../turn/requests";
import { inStretches, type Folded, type Store, type UserStore } from "../store";
import { questSliceOf, questViews } from "../quests/record";
import { trailsOf, withPast, withTrails } from "../quests/trail";
import { replyClocks } from "./panel-reads";
import { type ControlsKnowledge, controls } from "./state/controls";
import { hud } from "./state/hud";
import { notWorldView } from "./state/not-world";
import { palette } from "./state/palette";
import { scene } from "./state/scene";

export interface ChatViewInput {
  store: Store;
  user: string;
  chat: string;
  /** A turn of the chat to read the state at; null for the chat's head. */
  turn: string | null;
  /** Whether a turn of the chat runs now. */
  turning: boolean;
  /** The chat's out-of-play settings (`taps.tell.*`), which preset the controls' Tell switch. */
  offstage: OffstageSettings;
  /** The chat's map settings (`map:` in its config), for the scale and time step a grid is drawn with. */
  map: MapConfig;
  /** The chat's own knowledge choices and tidy-up switch beside his own (`controls.knowledge`, `controls.things`). */
  knowledge: ControlsKnowledge;
  /** The Journal's notes of the chat's newest turns (`journal.ts`). */
  journal: JournalNote[];
  /** The decisions and records under the chat's replies (`panel-reads.ts`). */
  chips: Chip[];
  /** The HUD's meter; null before any turn spent anything. */
  meter: CallMeterView | null;
  /** His changes made while a turn runs, until it ends. */
  pending: PendingMark[];
  /** The newest replies whose clock the view carries. */
  clocksMost: number;
  /** What waits for his next message from a panel: the request the turn lane holds (`requests.ts`); null for none, and at a turn of the past. */
  staged: StagedPress | null;
  /** The presses a turn of the chat's path was told and did not carry out (`Requests.notCarried`); none at a turn of the past. */
  notCarried: StagedPress[];
}

/** A press as its view shows it: what was pressed, then on what, as the next briefing gives the Author each (`notices.md`, `panel_request`). */
export function pressedLine(asked: { what: string; on: string | null }): string {
  return asked.on === null ? asked.what : `${asked.what}, on ${asked.on}`;
}

/** A panel's press, as the state view shows it, played now as his message or not; null for a request that is no panel's. */
export function pressOf(r: RequestRecord): StagedPress | null {
  if (r.kind !== "panel" || !("what" in r.asked)) return null;
  const { action, values, from, what, on } = r.asked;
  return { request: r.id, action, values, from, what, on, label: pressedLine(r.asked) };
}

/** A panel's request that waits, as the state view shows it; null for one that is no panel's, or was played now as his message. */
export function stagedOf(r: RequestRecord): StagedPress | null {
  return r.played ? null : pressOf(r);
}

/** The turn at the head of a chat's path; null before its first. */
export function headTurn(s: UserStore, chat: string): string | null {
  const row = s.chat(chat);
  if (row === null || row.head === null) return null;
  return s.path(chat).findLast((e) => e.node === row.head)?.turn ?? null;
}

/**
 * What a state view builds from the state it shows and the settings that shape it, never from the ask, with what the rest of the view
 * reads of that state (the world as it plays it, its revision, how far its definitions lag, where his character is): kept (`built`).
 */
interface Built extends ViewParts {
  world: WorldDoc;
  revision: string;
  lag: ReturnType<typeof definitionsLag>;
  place: string | null;
  /**
   * The read pass the parts were built in, which an item read apart of the same state reads in (`chatViewItem`), so what the parts
   * worked out (a company's valuation, the money's flows) it finds and works out nothing again: kept under the very state and world
   * objects they were read from, so a state the store folds again is read afresh.
   */
  pass: PassInStretches;
}

interface ViewParts {
  panels: Record<PanelId, JsonValue>;
  hud: StateView["hud"];
  scene: StateView["scene"];
  palette: StateView["palette"];
  controls: StateView["controls"];
}

/**
 * The latest states' built parts, by the store's key for the state (`stateKey`, another once anything its fold reads changes) and what
 * else shaped them: the chat's head node (the path its quests' trails were read along), the chat's world revision, the giving of the
 * application's lines the panels word with (`linesGiven`) and the chat's settings the parts read. Kept by key, never by the state object,
 * so the store letting the state go (to fold the states of other replies) loses nothing; a second page, a second tab and every `state`
 * event after the first read them, and build nothing. Read them, never change them. The newest asked are kept, `VIEWS_KEPT` of them.
 */
const built = new Map<string, Built>();
const VIEWS_KEPT = 4;

/**
 * What a state view builds from a state, as one read pass run in stretches that let RPE's thread go between them (DESIGN §9.6: one
 * pass, so what one panel reads the others find): a panel a stretch, and a panel of many pages alike (`PanelViewDef.items`) a page at a
 * time; then the quests' trails, the scene, the HUD (which reads the panels), the palette and the controls.
 */
async function buildParts(input: ChatViewInput, s: UserStore, folded: Folded, world: WorldDoc, state: WorldState, elapsed: number): Promise<ViewParts & { pass: PassInStretches }> {
  const registry = input.store.env.registry;
  const pass = passInStretches();
  const ctx: ReadContext = registry.context(world, state);
  const panels: Record<PanelId, JsonValue> = {};
  // The map's display is the chat's own `map.display`, in the map settings the grids are drawn at.
  const prefs = { mapDisplay: null, mapConfig: input.map };
  const failed = (error: unknown): JsonValue => ({ error: error instanceof Error ? error.message : String(error) });
  const steps: (() => void)[] = [];
  for (const view of registry.views) {
    // A panel read an item at a time when a page opens one is no part of the view (`chatViewItem`).
    if (view.apart === true) continue;
    const items = view.items;
    if (items === undefined) {
      steps.push(() => {
        try {
          panels[view.panel] = view.build(ctx, prefs);
        } catch (error) {
          panels[view.panel] = failed(error);
        }
      });
      continue;
    }
    // A page a step, into one record in the order of its ids; one that fails fails the panel, as its whole build would have.
    const record: Record<string, JsonValue> = {};
    let broken = false;
    const page = (id: string) => (): void => {
      if (broken) return;
      try {
        const built = items.build(ctx, prefs, id);
        if (built !== null) record[id] = built;
      } catch (error) {
        broken = true;
        panels[view.panel] = failed(error);
      }
    };
    const pages = (): void => {
      let ids: readonly string[];
      try {
        ids = items.ids(ctx);
      } catch (error) {
        panels[view.panel] = failed(error);
        return;
      }
      panels[view.panel] = record;
      // The pages go right after this step, before the steps of the panels after this one.
      steps.splice(steps.indexOf(pages) + 1, 0, ...ids.map(page));
    };
    steps.push(pages);
  }
  let shown: StateView["scene"] | null = null;
  const parts: Partial<ViewParts> = {};
  steps.push(() => {
    // The quest log lists, under each world quest it holds, the stages that quest was moved past: the pages' own reading of them (`withTrails`).
    const log = panels["story.quests"];
    if (log !== undefined) panels["story.quests"] = withPast(log, withTrails(questViews(world.tracks, questSliceOf(folded.state)), world.tracks, trailsOf(s, input.store.env, input.chat, input.turn, world.tracks, state.tracks)));
  });
  steps.push(() => {
    shown = scene(world, state, elapsed, registry);
    parts.hud = hud(world, state, panels, ctx);
  });
  steps.push(() => {
    parts.palette = palette(world, state, registry);
  });
  steps.push(() => {
    parts.controls = controls(world, state, shown?.sceneType ?? "", registry, input.knowledge, input.offstage);
  });
  // Each step is taken when it is reached, so the pages a panel's first step adds run in their place.
  await inStretches(steps, (step) => step(), (stretch) => pass.run(stretch));
  if (shown === null || parts.hud === undefined || parts.palette === undefined || parts.controls === undefined) throw new Error("the state view's parts were not all built");
  return { panels, scene: shown, hud: parts.hud, palette: parts.palette, controls: parts.controls, pass };
}

export async function chatView(input: ChatViewInput): Promise<StateView> {
  const { store, chat } = input;
  const s = store.user(input.user);
  const row = s.chat(chat);
  if (row === null || row.world === null) return notWorldView(chat);
  const registry = store.env.registry;
  // The panels word some lines with the application's lines in force (`say`): they shape the view as the state does.
  const lines = linesGiven();
  const key = viewKey(s, row, lines, input);
  let kept = built.get(key);
  if (kept !== undefined) {
    // The newest asked last: the first is the one let go.
    built.delete(key);
    built.set(key, kept);
  } else {
    const folded = input.turn === null ? s.headState(chat) : s.stateAt(input.turn);
    const state = folded.state.world;
    const doc = store.env.worlds(state.revision) ?? (row.revision === null ? undefined : store.env.worlds(row.revision));
    if (doc === undefined) return notWorldView(chat);
    // The world as the state plays it (ITEMS-SPEC §6.2): with the places play made.
    const world = playedWorld(doc, state);
    // The scene's elapsed time is what the turn shown moved the clock by.
    const at = input.turn ?? headTurn(s, chat);
    const elapsed = at === null ? 0 : state.clock - s.startOf(at).state.world.clock;
    kept = { ...(await buildParts(input, s, folded, world, state, elapsed)), world, revision: state.revision, lag: definitionsLag(state), place: placeOfEntity(state, world.pov) };
    // A view whose stretches the lines were given again between is answered once and not kept: some of it may be worded with the old ones.
    if (linesGiven() === lines) {
      built.set(key, kept);
      for (const old of built.keys()) {
        if (built.size <= VIEWS_KEPT) break;
        built.delete(old);
      }
    }
  }
  const packs: Record<PackId, number> = {};
  for (const pack of registry.packs) packs[pack.id] = pack.version;
  return {
    v: 1,
    chatId: chat,
    worldId: row.world,
    revision: kept.revision,
    ...(kept.lag !== null ? { definitionsFrom: kept.lag } : {}),
    status: input.turning ? "in_flight" : "idle",
    hud: kept.hud,
    scene: kept.scene,
    chips: input.chips,
    replyClocks: replyClocks(s, chat, kept.world, kept.place, input.clocksMost),
    journal: input.journal,
    keepReport: [],
    pending: input.pending,
    staged: input.staged,
    notCarried: input.notCarried,
    panels: kept.panels,
    palette: kept.palette,
    controls: kept.controls,
    meter: input.meter,
    packs,
    currency: kept.world.currency,
  };
}

/** What shapes a view's parts beside the state they show: an item read apart (`chatViewItem`) is kept under the key its view is. */
export type ViewKeyInput = Pick<ChatViewInput, "store" | "user" | "chat" | "turn" | "map" | "knowledge" | "offstage">;

/** The key a view's parts are kept under (`built`): the store's key for the state, and what else shaped them. */
function viewKey(s: UserStore, row: { head: string | null; revision: string | null }, lines: number, input: ViewKeyInput): string {
  return JSON.stringify([s.stateKey(input.chat, input.turn), row.head, row.revision, lines, input.map, input.knowledge, input.offstage]);
}

/**
 * The items of the panels no view carries, read one at a time as pages open them (`chatViewItem`), by the key the view of the same
 * state is kept under, then by panel and item: the newest asked keys, `VIEWS_KEPT` of them, as the views are kept.
 */
const itemsKept = new Map<string, Map<string, JsonValue | null>>();

/**
 * One item of a panel the state view does not carry (`PanelViewDef.apart`: an organization's page), as a page reads it when it opens it:
 * built from the state the chat's view at the same key is built from, in that view's read pass where it is kept (so what the view's
 * parts worked out is not worked out again), else in a pass of its own, and kept under that key, so a second open builds nothing and a
 * change to the state builds it again. Null where the panel has no such item, or the chat plays no world.
 */
export function chatViewItem(input: ViewKeyInput, panel: PanelId, id: string): JsonValue | null {
  const { store, chat } = input;
  const s = store.user(input.user);
  const row = s.chat(chat);
  const items = store.env.registry.views.find((v) => v.panel === panel && v.apart === true)?.items;
  if (row === null || row.world === null || items === undefined) return null;
  const lines = linesGiven();
  const key = viewKey(s, row, lines, input);
  const at = `${panel}\n${id}`;
  const kept = itemsKept.get(key);
  if (kept !== undefined) {
    itemsKept.delete(key);
    itemsKept.set(key, kept);
    if (kept.has(at)) return kept.get(at) ?? null;
  }
  const state = (input.turn === null ? s.headState(chat) : s.stateAt(input.turn)).state.world;
  const view = built.get(key);
  let world = view?.world;
  if (world === undefined) {
    const doc = store.env.worlds(state.revision) ?? (row.revision === null ? undefined : store.env.worlds(row.revision));
    if (doc === undefined) return null;
    world = playedWorld(doc, state);
  }
  const ctx = store.env.registry.context(world, state);
  const read = (): JsonValue | null => items.build(ctx, { mapDisplay: null, mapConfig: input.map }, id);
  const item = view === undefined ? readPass(read) : view.pass.run(read);
  // An item worded with lines given again while it was built is answered once and not kept, as a view is.
  if (linesGiven() === lines) {
    const into = kept ?? new Map<string, JsonValue | null>();
    into.set(at, item);
    itemsKept.set(key, into);
    for (const old of itemsKept.keys()) {
      if (itemsKept.size <= VIEWS_KEPT) break;
      itemsKept.delete(old);
    }
  }
  return item;
}
