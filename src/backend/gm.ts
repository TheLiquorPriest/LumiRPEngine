// The GM view (DESIGN §7), built when it is asked for (`lre.gm`), never pushed with the player's
// state: the world as it stands on the head (an in-flight turn's plan included, as GM edits are
// checked against it), every ✎ fix and GM edit in force on the chat's path worded in full, and the
// held writes that didn't apply, with their reasons.

import type { GmView } from "../shared/state-view";
import { effectiveMemory, type MindsSettings } from "../shared/minds";
import { buildGmWorld } from "../engine/gm-view";
import { buildMindsGm } from "../packs/minds/core/gm";
import type { ChainMessage } from "../engine/ledger/chain";
import type { LedgerCore } from "../engine/ledger/journal";
import { activeRecord } from "../engine/ledger/path";
import { authorLines } from "../engine/player-events";
import { readPass } from "../engine/read-pass";
import type { Registry } from "../engine/registry-impl";
import { appliedEvents, clockFixLine } from "./view";

/** How many edits the GM view lists, newest first. */
const GM_EDITS = 40;

export function buildGmView(core: LedgerCore, observed: readonly ChainMessage[], registry: Registry, minds: MindsSettings): GmView | null {
  const render = core.renderState(observed);
  if (!render) return null;
  const fold = core.fold(observed);
  const chain = core.chain(observed);
  // Everything else only reads the folded states, many times over: one read pass (DESIGN §9.6).
  return readPass(() => {
    const edits: GmView["edits"] = [];
    chain.forEach((m, i) => {
      const rec = m.isUser ? null : activeRecord(m, core.journal.tombstones);
      if (!rec) return;
      // A fix of the time leads with how it moved the clock, which no event line words.
      for (const fix of appliedEvents(rec, fold, i).fixes) {
        const clock = clockFixLine(fix.events);
        edits.push({ messageId: m.id, seq: fix.seq, lines: [...(clock ? [clock] : []), ...authorLines(registry, render.world, render.state, fix.events, 12)], ...(fix.by ? { by: fix.by.label } : {}) });
      }
    });
    return {
      ...buildGmWorld(registry, render.world, render.state),
      edits: edits.reverse().slice(0, GM_EDITS),
      refused: (core.journal.refused ?? []).map((r) => ({ id: r.write.id, reason: r.reason })),
      // Fidelity reads the chat's latest message and reply, as the next turn's would.
      minds: buildMindsGm(registry.context(render.world, render.state), latestTexts(observed), minds.enabled, effectiveMemory(render.world, minds)),
    };
  });
}

/** The latest user message and the reply before it, as a turn's fidelity reads them; a GM's minds run picks Live and Near by them too. */
export function latestTexts(observed: readonly ChainMessage[]): { user: string; reply: string } {
  const text = (m: ChainMessage | undefined): string => (m ? (m.swipes[m.swipeId] ?? "") : "");
  const lastUser = observed.findLastIndex((m) => m.isUser);
  return { user: text(observed[lastUser]), reply: text(observed.slice(0, lastUser < 0 ? observed.length : lastUser).findLast((m) => !m.isUser)) };
}
