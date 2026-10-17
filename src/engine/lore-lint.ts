// World lore lint (DESIGN §4.2): entry ids and links, and secrets: a secret entry needs a gate, and
// a helper that writes prose in its audience is flagged, since what that step writes can reach the
// narrator.

import { hasOwn } from "../shared/json";
import { LORE_AUDIENCE, PROSE_STEPS } from "../shared/lore";
import type { LintIssue } from "../shared/protocol";
import type { WorldDoc } from "../shared/world";

export function lintLore(world: WorldDoc): LintIssue[] {
  const issues: LintIssue[] = [];
  const push = (severity: LintIssue["severity"], path: string, code: string, message: string): void => {
    issues.push({ severity, path, code, message });
  };
  // A secret entry may hold a track's truth: only its audience reads it, until its gate holds. A
  // public entry is open to every helper, and to the narrator once lore is delivered, so it holds none.
  const truths: string[] = [];
  for (const t of Object.values(world.tracks)) for (const s of Object.values(t.stages)) if (s.truth && s.truth.trim().length >= 12) truths.push(s.truth.trim().toLowerCase());
  for (const [id, l] of Object.entries(world.lore)) {
    if (l.id !== id) push("error", `lore.${id}.id`, "id_mismatch", "the id must match its key");
    for (const link of l.links) if (!hasOwn(world.entities, link) && !hasOwn(world.places, link)) push("warning", `lore.${id}.links`, "missing_ref", `"${link}" is not an entity or place`);
    if (l.secret !== true) {
      if (truths.some((t) => l.content.toLowerCase().includes(t))) push("error", `lore.${id}.content`, "secret_truth", `"${l.title}" is public but carries a secret's truth; mark it secret, with a gate, so only the helpers you pick read it`);
      continue;
    }
    if (!l.gate || l.gate.trim() === "") push("error", `lore.${id}.gate`, "no_gate", `secret lore "${l.title}" needs a gate: it is revealed only once the gate holds`);
    const audience = Array.isArray(l.audience) ? l.audience : [];
    const unknown = audience.filter((s) => !LORE_AUDIENCE.includes(s));
    if (unknown.length > 0) push("warning", `lore.${id}.audience`, "unknown_step", `no helper is called ${unknown.map((s) => `"${String(s)}"`).join(", ")}`);
    const prose = audience.filter((s) => PROSE_STEPS.includes(s));
    if (prose.length > 0) push("warning", `lore.${id}.audience`, "prose_audience", `secret lore "${l.title}" can be read by ${prose.join(", ")}, and what those steps write can reach the narrator`);
  }
  return issues;
}
