// The GM view (DESIGN §7), built when it is asked for (`lre.gm`), never pushed with the player's
// state: the world as it stands on the head (an in-flight turn's plan included, as GM edits are
// checked against it), every ✎ fix and GM edit in force on the chat's path worded in full, and the
// held writes that didn't apply, with their reasons.

import type { GmView } from "../shared/state-view";
import { worldMindsOf, type MindsSettings } from "../shared/minds";
import { buildGmWorld } from "../engine/gm-view";
import { calendarOf, formatClock } from "../engine/calendar";
import type { ChainMessage } from "../engine/ledger/chain";
import type { LedgerCore } from "../engine/ledger/journal";
import { activeRecord } from "../engine/ledger/path";
import { authorLines } from "../engine/player-events";
import type { Registry } from "../engine/registry-impl";
import { appliedEvents } from "./view";

/** How many edits the GM view lists, newest first. */
const GM_EDITS = 40;

export function buildGmView(core: LedgerCore, observed: readonly ChainMessage[], registry: Registry, minds: MindsSettings): GmView | null {
  const render = core.renderState(observed);
  if (!render) return null;
  const fold = core.fold(observed);
  const edits: GmView["edits"] = [];
  core.chain(observed).forEach((m, i) => {
    const rec = m.isUser ? null : activeRecord(m, core.journal.tombstones);
    if (!rec) return;
    for (const fix of appliedEvents(rec, fold, i).fixes) edits.push({ messageId: m.id, seq: fix.seq, lines: authorLines(registry, render.world, render.state, fix.events, 12) });
  });
  return {
    ...buildGmWorld(registry, render.world, render.state),
    edits: edits.reverse().slice(0, GM_EDITS),
    refused: (core.journal.refused ?? []).map((r) => ({ id: r.write.id, reason: r.reason })),
    minds: { enabled: minds.enabled, secrecy: worldMindsOf(render.world).secrecy, now: render.state.clock, nowText: formatClock(calendarOf(render.world), render.state.clock), characters: [] },
  };
}
