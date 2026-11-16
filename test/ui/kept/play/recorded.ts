// Recorded answers of the routes the Play page calls, in the shapes they declare. The chat's state is
// made as RPE's state route makes it: a starter world's `StateView` from today's own pure builders
// (`buildView` over a ledger core of the world: every pack's panel through its own builder, and the
// HUD, scene, palette and controls), with no turn played yet. A later state is the same world an hour
// and a half on, as after a turn that passed the time; a chat with no world answers today's view of a
// chat that is not a world chat.

import { buildView, ViewMemo } from "../../../../src/backend/view";
import { notWorldView } from "../../../../src/play/state/not-world";
import { resolveFix } from "../../../../src/engine/edits";
import type { ChainMessage } from "../../../../src/engine/ledger/chain";
import { LedgerFold } from "../../../../src/engine/ledger/fold";
import { emptyJournal, LedgerCore } from "../../../../src/engine/ledger/journal";
import { createRegistry } from "../../../../src/engine/registry-impl";
import { ALL_PACKS } from "../../../../src/packs";
import { STARTER_WORLDS } from "../../../../src/packs/starters";
import { hashJson } from "../../../../src/shared/hash";
import type { ChatRun } from "../../../../src/shared/ledger";
import type { Level } from "../../../../src/shared/ids";
import { OFFSTAGE_DEFAULTS } from "../../../../src/shared/offstage";
import type { ErrorMessage, ResultMessage } from "../../../../src/shared/protocol";
import { NARRATOR_DEFAULTS } from "../../../../src/shared/narrator-view";
import type { StateView } from "../../../../src/shared/state-view";
import { testModel } from "../../../support/test-pack";

/** The invented chat the recorded answers are about, and one RPE has no world for. */
export const CHAT = "chat-fernwick";
export const NO_WORLD_CHAT = "chat-tea-room";

/** When the starter world's story begins, and the same day an hour and a half later. */
export const BEGINS = "0412-08-25T07:30";
export const LATER = "0412-08-25T09:00";

const registry = createRegistry(ALL_PACKS);

/**
 * The chat's state as RPE's route answers it before any turn (the greeting alone), for `chat` (the
 * invented one by default): its world at `at`; with its Gear level raised to `gear` where what the
 * player has on them is to be listed with its verbs (the starter tracks gear at level 1, which lists
 * nothing); and with the things `off` taken off, still on the player and worn no more, as the state is
 * once a tap took them off.
 */
export function recordedView(options: { chat?: string; at?: string; gear?: Level; off?: readonly string[] } = {}): StateView {
  const chat = options.chat ?? CHAT;
  const starter = STARTER_WORLDS.fantasy_town;
  if (starter === undefined) throw new Error("No starter world fantasy_town");
  const doc = starter("world-fernwick", "Fernwick");
  const levels = options.gear === undefined ? doc.realism.levels : { ...doc.realism.levels, gear: options.gear };
  const off = new Set(options.off ?? []);
  const entities = Object.fromEntries(Object.entries(doc.entities).map(([id, entity]) => [id, off.has(id) ? { ...entity, relations: entity.relations.filter((r) => r.type !== "worn_by") } : entity]));
  const world = { ...doc, entities, start: { ...doc.start, at: options.at ?? BEGINS }, realism: { ...doc.realism, levels } };
  const revision = hashJson(world);
  const run: ChatRun = { v: 1, worldId: world.id, revision, runSeed: "play-page", startedAt: 0 };
  const observed: ChainMessage[] = [{ id: "m0", isUser: false, swipeId: 0, swipes: ["The market bell rings over Fernwick."], ledger: null }];
  const core = new LedgerCore(emptyJournal(chat), { types: registry, worlds: (r) => (r === revision ? world : undefined), run, model: testModel, startMarkers: () => [], newSeed: () => "fresh", resolveFix: (d, state, entry) => resolveFix(registry, d, state, entry, run.runSeed) }, new LedgerFold(registry));
  const view = buildView({ chatId: chat, run, core, observed, registry, world: (r) => core.worldAt(r), stored: [], meter: null, knowledge: { chat: {}, tracking: false, narrator: NARRATOR_DEFAULTS }, offstage: OFFSTAGE_DEFAULTS, memo: new ViewMemo() });
  // As it comes over a road: plain JSON, nothing shared with the builder.
  return JSON.parse(JSON.stringify(view)) as StateView;
}

/** What the route answers for a chat RPE plays with no world: today's view of a chat that is not a world chat. */
export function recordedNoWorld(chat: string = NO_WORLD_CHAT): StateView {
  return JSON.parse(JSON.stringify(notWorldView(chat))) as StateView;
}

/** The actions route's answer to a managing tap that changed the state, with its Undo, as today's backend answers `lre.fix`. */
export function appliedFix(reqId: string, undo: string): ResultMessage {
  return { lre: 1, type: "lre.result", reqId, request: "lre.fix", body: { pending: false, undo } };
}

/** The undo route's answer once a change is taken back, as today's backend answers an Undo chip. */
export function undone(reqId: string): ResultMessage {
  return { lre: 1, type: "lre.result", reqId, request: "lre.chip", body: { applied: true, pending: false } };
}

/** RPE's answer to what it does not serve: today's `unavailable`, with one sentence of RPE's. */
export function refused(reqId: string, sentence: string): ErrorMessage {
  return { lre: 1, type: "lre.error", reqId, code: "unavailable", message: sentence };
}
