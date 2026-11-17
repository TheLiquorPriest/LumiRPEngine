// How a change reads in a sentence (DESIGN §7, Player-facing wording): what a field is, as a
// sentence names it, a possessive, a list of words, and a section's settings in a chat. The engine's
// event lines, the packs' describers and the GM view's notices word changes with these, so a line
// says who, what the setting means and the value in words, never a form's label glued to a value.

/** Words joined as a list is read: "a", "a and b", "a, b and c". */
export function listWords(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

/** A noun in the number a count takes: `one` for 1, else `many` ("tool", "tools"). */
export function nounFor(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** A count with its noun in the number it takes: "1 tool", "3 tools", "0 tools". */
export function counted(n: number, one: string, many: string): string {
  return `${n} ${nounFor(n, one, many)}`;
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
