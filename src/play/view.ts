// The panels of a chat (plan §14, "What happens to today's UI": today's play panels kept, re-pointed to
// RPE): today's `StateView`, built from RPE's store at the chat's head or at one of its turns. Every
// pack's panel comes from the pack's own builder, and the HUD, the scene, the palette and the controls
// from today's pure builders, as today's backend builds them (`backend/view.ts`, `buildView`). What
// only today's ledger held (the Journal, the Keep report, writes held back for a turn, chips, each
// reply's clock) has no source in RPE's store, and is present and empty. Which of today's engines
// plays the chat is left out: none of them does, RPE does, and today's pages draw the parts of
// today's harness (its prepared turns, its connections) for a chat that names it, which RPE does not
// serve. A chat RPE plays on no world is answered as today answers a chat that is not a world's.

import { controls, hud, notWorldView, palette, scene } from "../backend/view";
import { playedWorld } from "../engine/places-in-play";
import { readPass } from "../engine/read-pass";
import { definitionsLag } from "../engine/upgrade";
import type { PackId, PanelId } from "../shared/ids";
import type { JsonValue } from "../shared/json";
import { KNOWLEDGE_DEFAULTS } from "../shared/minds";
import { OFFSTAGE_DEFAULTS } from "../shared/offstage";
import { NARRATOR_DEFAULTS } from "../shared/settings";
import type { StateView } from "../shared/state-view";
import type { Store, UserStore } from "../store";

/**
 * The knowledge choices the controls show. RPE keeps none of today's (a chat's own, Settings → Minds →
 * Knowledge, Settings → Narrator): the chat follows everything, and the user's are today's defaults.
 */
const KNOWLEDGE = { chat: {}, tracking: KNOWLEDGE_DEFAULTS.enabled, narrator: NARRATOR_DEFAULTS };

export interface ChatViewInput {
  store: Store;
  user: string;
  chat: string;
  /** A turn of the chat to read the state at; null for the chat's head. */
  turn: string | null;
  /** Whether a turn of the chat runs now. */
  turning: boolean;
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
  const state = (input.turn === null ? s.headState(chat) : s.stateAt(input.turn)).state.world;
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
    // No map display is kept for a chat in RPE: the map panel follows the world's.
    const prefs = { mapDisplay: null };
    for (const view of registry.views) {
      try {
        panels[view.panel] = view.build(ctx, prefs);
      } catch (error) {
        panels[view.panel] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
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
      chips: [],
      replyClocks: {},
      journal: [],
      keepReport: [],
      pending: [],
      panels,
      palette: palette(world, state, registry),
      controls: controls(world, state, shown.sceneType, registry, KNOWLEDGE, OFFSTAGE_DEFAULTS),
      meter: null,
      packs,
      currency: world.currency,
    };
  });
}
