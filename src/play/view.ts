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
import { readPass } from "../engine/read-pass";
import { definitionsLag } from "../engine/upgrade";
import type { PackId, PanelId } from "../shared/ids";
import type { JsonValue } from "../shared/json";
import type { MapConfig } from "../shared/map-config";
import type { JournalNote } from "../shared/ledger";
import type { OffstageSettings } from "../shared/offstage";
import type { CallMeterView, Chip, PendingMark, StagedPress, StateView } from "../shared/state-view";
import type { RequestRecord } from "../turn/requests";
import type { Store, UserStore } from "../store";
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

export function chatView(input: ChatViewInput): StateView {
  const { store, chat } = input;
  const s = store.user(input.user);
  const row = s.chat(chat);
  if (row === null || row.world === null) return notWorldView(chat);
  const folded = input.turn === null ? s.headState(chat) : s.stateAt(input.turn);
  const state = folded.state.world;
  const doc = store.env.worlds(state.revision) ?? (row.revision === null ? undefined : store.env.worlds(row.revision));
  if (doc === undefined) return notWorldView(chat);
  // The world as the state plays it (ITEMS-SPEC §6.2): with the places play made.
  const world = playedWorld(doc, state);
  const registry = store.env.registry;
  // The scene's elapsed time is what the turn shown moved the clock by.
  const at = input.turn ?? headTurn(s, chat);
  const elapsed = at === null ? 0 : state.clock - s.startOf(at).state.world.clock;
  // Everything here only reads the state, many times over: one read pass (DESIGN §9.6).
  return readPass((): StateView => {
    const ctx = registry.context(world, state);
    const panels: Record<PanelId, JsonValue> = {};
    // The map's display is the chat's own `map.display`, in the map settings the grids are drawn at.
    const prefs = { mapDisplay: null, mapConfig: input.map };
    for (const view of registry.views) {
      try {
        panels[view.panel] = view.build(ctx, prefs);
      } catch (error) {
        panels[view.panel] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    // The quest log lists, under each world quest it holds, the stages that quest was moved past: the pages' own reading of them (`withTrails`).
    const log = panels["story.quests"];
    if (log !== undefined) panels["story.quests"] = withPast(log, withTrails(questViews(world.tracks, questSliceOf(folded.state)), world.tracks, trailsOf(s, store.env, chat, input.turn, world.tracks, state.tracks)));
    const shown = scene(world, state, elapsed, registry);
    const packs: Record<PackId, number> = {};
    for (const pack of registry.packs) packs[pack.id] = pack.version;
    const lag = definitionsLag(state);
    return {
      v: 1,
      chatId: chat,
      worldId: row.world,
      revision: state.revision,
      ...(lag !== null ? { definitionsFrom: lag } : {}),
      status: input.turning ? "in_flight" : "idle",
      hud: hud(world, state, panels, ctx),
      scene: shown,
      chips: input.chips,
      replyClocks: replyClocks(s, chat, world, state, input.clocksMost),
      journal: input.journal,
      keepReport: [],
      pending: input.pending,
      staged: input.staged,
      notCarried: input.notCarried,
      panels,
      palette: palette(world, state, registry),
      controls: controls(world, state, shown.sceneType, registry, input.knowledge, input.offstage),
      meter: input.meter,
      packs,
      currency: world.currency,
    };
  });
}
