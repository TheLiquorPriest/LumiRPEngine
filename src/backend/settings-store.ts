// D4 per-connection extraction learning's outcomes (DESIGN §11; AGENT-LOOP-PLAN §6): what the old
// runtime counts of a chip's outcome, the flip it makes and its undo. The settings store and the
// learning it reads moved to src/migrate/today/settings-store.ts (PlanSwap-5), where the migration
// reads today's settings.

import type { BoundMode } from "../shared/ids";
import { hasOwn, safeKey } from "../shared/json";
import type { ChangeType, ExtractionLearning, ExtractionTypeStats, UserSettings } from "../shared/settings";
import { EXTRACTION_LEARNING } from "../shared/settings";
import { effectiveMode, isAgentChangeType, statsFor } from "../migrate/today/settings-store";

/**
 * A flip D4 learning made, of the type it was counted for: a reply's type (`ExtractionType`) from the
 * extract step's chips, whose mode-change chip the chat shows; an agent's type under its role, which
 * no chip announces, since the chat is a player surface.
 */
export interface ModeChange<T extends ChangeType = ChangeType> {
  connectionId: string;
  type: T;
  from: BoundMode;
  to: BoundMode;
  /** The agent role whose learning flipped (AGENT-LOOP-PLAN §6); absent for the extract step's. */
  role?: string;
}

function emptyStats(): ExtractionTypeStats {
  return { accepted: 0, rejected: 0, recent: "" };
}

/**
 * Records one chip outcome and applies the D4 rules: promotion at `promoteAt` acceptance over at
 * least `minProposals` outcomes (read from the rolling window), demotion past `demoteUndoRate`.
 * A pinned type is counted but never flips. Returns the flip, if any, for the mode-change chip.
 * An agent's outcome counts under its `role` (AGENT-LOOP-PLAN §6); one with no role counts on the
 * connection only for an extraction type, so an agent type with no role records nothing. `undone`
 * takes back an outcome counted accepted (an agent's change applied, then undone): it counts as
 * rejected instead, so a proposal still counts once.
 */
export function recordOutcome<T extends ChangeType>(settings: UserSettings, learning: ExtractionLearning, connectionId: string, type: T, outcome: "accepted" | "rejected" | "undone", now: number, role?: string): ModeChange<T> | null {
  if (!safeKey(connectionId)) return null;
  let byType: Partial<Record<ChangeType, ExtractionTypeStats>>;
  if (role === undefined) {
    if (isAgentChangeType(type)) return null;
    const kept = hasOwn(learning.connections, connectionId) ? (learning.connections[connectionId] ?? {}) : {};
    learning.connections[connectionId] = kept;
    byType = kept;
  } else {
    if (!safeKey(role)) return null;
    const roles = learning.roles ?? {};
    learning.roles = roles;
    const byConnection = hasOwn(roles, role) ? (roles[role] ?? {}) : {};
    roles[role] = byConnection;
    byType = hasOwn(byConnection, connectionId) ? (byConnection[connectionId] ?? {}) : {};
    byConnection[connectionId] = byType;
  }
  const stats = statsFor(learning, connectionId, type, role) ?? emptyStats();
  byType[type] = stats;
  if (outcome === "undone" && stats.accepted > 0) {
    stats.accepted--;
    stats.rejected++;
    const at = stats.recent.lastIndexOf("a");
    stats.recent = at >= 0 ? `${stats.recent.slice(0, at)}r${stats.recent.slice(at + 1)}` : `${stats.recent}r`.slice(-EXTRACTION_LEARNING.window);
  } else {
    if (outcome === "accepted") stats.accepted++;
    else stats.rejected++;
    stats.recent = `${stats.recent}${outcome === "accepted" ? "a" : "r"}`.slice(-EXTRACTION_LEARNING.window);
  }
  if (settings.extraction[type]) return null;
  const total = stats.accepted + stats.rejected;
  if (stats.holdUntil !== undefined && total < stats.holdUntil) return null;
  const window = stats.recent.length;
  const accepted = [...stats.recent].filter((c) => c === "a").length;
  const current = effectiveMode(settings, learning, connectionId, type, role).mode;
  let to: BoundMode | null = null;
  if (current === "confirm" && total >= EXTRACTION_LEARNING.minProposals && window >= EXTRACTION_LEARNING.minProposals && accepted / window >= EXTRACTION_LEARNING.promoteAt) to = "auto";
  else if (current === "auto" && window >= EXTRACTION_LEARNING.minProposals && (window - accepted) / window > EXTRACTION_LEARNING.demoteUndoRate) to = "confirm";
  if (!to) return null;
  stats.learned = to;
  stats.changedAt = now;
  return { connectionId, type, from: current, to, ...(role !== undefined ? { role } : {}) };
}

/** Undo on a mode-change chip: back to the previous mode, held for another `minProposals` outcomes. */
export function undoModeChange(learning: ExtractionLearning, change: ModeChange): void {
  const stats = statsFor(learning, change.connectionId, change.type, change.role);
  if (!stats) return;
  stats.learned = change.from;
  stats.holdUntil = stats.accepted + stats.rejected + EXTRACTION_LEARNING.minProposals;
}
