// The Outline's pointers at other sections (DESIGN §9.2, §9.5): the engine's beats send the
// narrator to a section ("Narrate the interval from the Montage"), and an outline step's beats may
// too. A section the turn didn't fill must not be pointed at, so what names one goes.

import type { SlotId } from "../shared/ids";
import { MINDS_SLOT } from "../shared/minds";
import type { SectionTemplate } from "../shared/world";
import { DEFAULT_SECTIONS } from "./book";

/**
 * The labels of the sections the narrator won't have this turn, as the Outline (ranked `rank`) is
 * written: one the world has none of (by its default label), one ranked before the Outline that
 * wasn't filled (`filled`), and Minds when none of its lines fit (`minds`). One ranked after the
 * Outline isn't decided yet and isn't counted. A world's own label for a default section counts
 * with the default's.
 */
export function missingSections(sections: readonly SectionTemplate[], rank: number, filled: ReadonlySet<SlotId>, minds: boolean): string[] {
  const out: string[] = [];
  const defaults = new Map<SlotId, SectionTemplate>(Object.values(DEFAULT_SECTIONS).map((s) => [s.id, s]));
  for (const d of defaults.values()) if (!sections.some((s) => s.id === d.id)) out.push(d.label);
  for (const s of sections) {
    if (!(s.id === MINDS_SLOT ? !minds : s.rank < rank && !filled.has(s.id))) continue;
    out.push(s.label);
    const d = defaults.get(s.id);
    if (d && d.label !== s.label) out.push(d.label);
  }
  return out;
}

/**
 * Whether text points at the section labelled `label`: its label as written after "the" ("the
 * Montage"; "the money" is no section), or with "section" after it in any case ("the Minds
 * section", "money section").
 */
function names(text: string, label: string): boolean {
  const l = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bthe ${l}\\b`).test(text) || new RegExp(`\\b${l} section\\b`, "i").test(text);
}

/**
 * Outline lines without what points at a section the narrator doesn't have this turn (`missing`,
 * by label): in a line that names one, each clause naming one (a sentence's parts between
 * semicolons) goes, and a sentence, or a line, left with none goes whole. So "Time passes. Narrate
 * the interval from the Montage; don't add events." without a Montage reads "Time passes. Don't add
 * events." A line naming none stays exactly as it is.
 */
export function withoutMissing(lines: readonly string[], missing: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!missing.some((label) => names(line, label))) {
      out.push(line);
      continue;
    }
    const sentences = line.trim().split(/(?<=[.!?])\s+(?=[A-Z"“'‘([])/u);
    const kept = sentences.flatMap((sentence) => {
      const clauses = sentence.split(/\s*;\s*/);
      const left = clauses.filter((c) => !missing.some((label) => names(c, label)));
      if (left.length === clauses.length) return [sentence];
      if (left.length === 0) return [];
      const joined = left.join("; ").replace(/[\s,;:]+$/, "");
      const ended = /[.!?]$/.test(joined) ? joined : `${joined}.`;
      return [ended.charAt(0).toUpperCase() + ended.slice(1)];
    });
    if (kept.length > 0) out.push(kept.join(" "));
  }
  return out;
}
