// What the extension answers by itself when RPE gives no answer in time (STANDALONE-PLAN §4.2, §9.6;
// READINGS N-2): today's fail-closed verdict, worked out from the candidate entries alone. It holds every
// marked passage, whole-entry secret, older build's secret and copy of a mark out. It needs no state, and
// the extension keeps none: what RPE said for an earlier generation is not remembered.

import type { WorldInfoCandidate, WorldInfoVerdict } from "../shared/host";
import { blind, usersOwn } from "../secrecy/blind";

/** The verdict with no answer from RPE: today's fail-closed one. */
export function failClosed(entries: readonly WorldInfoCandidate[]): Required<WorldInfoVerdict> {
  const verdict = blind(usersOwn(entries));
  return { disabled: [...verdict.disabled], enabled: [...verdict.enabled], mutated: [...(verdict.mutated ?? [])] };
}
