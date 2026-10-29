// How a change reads in a sentence (DESIGN §7, Player-facing wording): what a field is, as a
// sentence names it, a possessive, a list of words, and a section's settings in a chat. The engine's
// event lines, the packs' describers and the GM view's notices word changes with these, so a line
// says who, what the setting means and the value in words, never a form's label glued to a value.

import type { FeedScope, SectionFeed } from "./world";

/** Words joined as a list is read: "a", "a and b", "a, b and c". */
export function listWords(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

/** "Danny Okafor's"; the POV as a line names it, "You" or "you", reads "Your" or "your". */
export function possessive(name: string): string {
  return name === "You" ? "Your" : name === "you" ? "your" : `${name}'s`;
}

/** Units a field's label may give in brackets ("Weight (g)"): said after its number instead. */
const LABEL_UNITS: Readonly<Record<string, true>> = { g: true, kg: true, l: true, mi: true, km: true, h: true, min: true, days: true, months: true, years: true };

/**
 * What a field is, as a sentence names it: its label without the form's bracketed hint ("Bed (a
 * place or an item)" is a bed, "Birthday (MM-DD or YYYY-MM-DD)" a birthday), in lower case unless it
 * starts with an acronym (APR, HP); a unit in brackets ("Weight (g)") or a trailing % ("Fuel %") is
 * the `unit` its numbers take.
 */
export function fieldNoun(label: string | undefined, field: string): { noun: string; unit: string } {
  const plain = field.replace(/_/g, " ");
  const text = (label ?? plain).trim();
  const bracket = /^(.*?)\s*\(([^()]*)\)$/.exec(text);
  const base = (bracket?.[1] ?? text).trim() || plain;
  const percent = base.endsWith(" %");
  const noun = percent ? base.slice(0, -2) : base;
  const unit = percent ? "%" : bracket && LABEL_UNITS[bracket[2] ?? ""] ? ` ${bracket[2] ?? ""}` : "";
  return { noun: /^[A-Z]{2}/.test(noun) ? noun : noun.charAt(0).toLowerCase() + noun.slice(1), unit };
}

/** What a section tells the narrator, by whose knowledge it reads. */
const SCOPE_TELLS: Record<FeedScope, string> = {
  player: "tells what your character knows",
  scene: "also tells what the people with your character know",
  gm: "tells everything, with what your character doesn't know marked",
};

/**
 * A section's settings in a chat as one sentence (`lre.edit` `feed`, DESIGN §6.11): out of the
 * prompt, back to the world's, or what this chat sets for it (whose knowledge it tells, its caps,
 * the sources picked), the notice the save leaves and the GM's Edits log alike. A section that sets
 * no scope follows the narrator's knowledge (`sectionScope`).
 */
export function feedSentence(label: string, to: SectionFeed | null): string {
  if (to === null) return `The ${label} section follows the world's settings again in this chat`;
  if (to.enabled === false) return `The ${label} section is left out of the prompt in this chat`;
  const caps = [to.maxLines !== undefined ? `${to.maxLines} ${to.maxLines === 1 ? "line" : "lines"}` : null, to.maxTokens !== undefined ? `${to.maxTokens} tokens` : null].filter((c) => c !== null);
  const parts = [
    to.scope ? SCOPE_TELLS[to.scope] : "follows the narrator's knowledge",
    caps.length > 0 ? `cut to at most ${listWords(caps)}` : "with no cap",
    to.include ? `from ${to.include.length === 1 ? "the 1 source" : `the ${to.include.length} sources`} picked for it` : null,
  ].filter((p) => p !== null);
  return `In this chat, the ${label} section ${parts.join(", ")}`;
}
