// How exact, how sure and from where a recorded value is, in words (plan §6.6): one reading for every
// page that shows a value or a change (World, the Turn page's lanes, Story, Cast).

import type { FactPrecision, FactSource, FactStanding } from "../shared/api";

export const SOURCE_WORDS: Readonly<Record<FactSource, string>> = {
  prose: "from the prose",
  lore: "from the lore",
  author: "by the Author",
  gm: "by the GM",
  character: "by a character",
  player: "by you",
  import: "imported",
  default: "a default",
  invented: "invented",
};

export const PRECISIONS: readonly FactPrecision[] = ["exact", "approximate", "vague", "unknown"];
export const STANDINGS: readonly FactStanding[] = ["established", "proposed", "assumed"];

/** A value's marks as one line: its precision and standing where it has them, its source ("unsourced" where none was given). */
export function marksWords(mark: { precision: FactPrecision | null; standing: FactStanding | null; source: FactSource | null }): string {
  return [mark.precision, mark.standing, mark.source === null ? "unsourced" : SOURCE_WORDS[mark.source]].filter((w): w is string => w !== null).join(", ");
}

const WHO_WORDS: Readonly<Record<string, string>> = { gm: "the GM", author: "the Author", player: "you" };

/** Who made a change, with what standing and from where, as a sentence: "Made by the GM: established, from the prose." A maker, a standing or a source the page has no words for is said as it was recorded. */
export function madeWords(change: { by: string | null; standing: string | null; source: string | null }): string {
  const sources: Readonly<Record<string, string>> = SOURCE_WORDS;
  const who = change.by === null ? "No one is named as its maker" : `Made by ${Object.hasOwn(WHO_WORDS, change.by) ? WHO_WORDS[change.by] : change.by}`;
  const from = change.source === null ? "unsourced" : Object.hasOwn(sources, change.source) ? sources[change.source] : change.source;
  return `${who}: ${[change.standing, from].filter((w): w is string => w !== null).join(", ")}.`;
}
