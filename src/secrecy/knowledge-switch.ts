// What a chat's turn records of its knowledge switch (DESIGN §24.11), so a swipe or a branch judges a
// secret by what held there: read from the minds pack's slice of the chat's state.

import type { WorldState } from "../engine/state";
import { readSlice } from "../packs/minds/core/state";
import type { PackEvent } from "../shared/ledger";
import { knowledgeThreshold, knowledgeTracked, MINDS_EVENTS } from "../shared/minds";

/**
 * Whether the chat tracks knowledge, recorded when it changes (`minds.knowledge`, DESIGN §24.11):
 * only in a chat that holds some, so a chat that never tracked any folds as it did. Null when the
 * state already says so.
 */
export function knowledgeSwitch(state: Readonly<WorldState>, on: boolean, threshold: number): PackEvent | null {
  const slice = readSlice(state);
  if (slice.knowledge === undefined) return null;
  // The user's threshold, when it changed: the player screens read it from the chat's state, as they read everything.
  const sure = on && knowledgeThreshold(slice) !== threshold;
  return knowledgeTracked(slice) !== on || sure ? { type: MINDS_EVENTS.knowledge, data: { on, ...(sure ? { threshold } : {}) } } : null;
}
