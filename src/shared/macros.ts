// Host macro safety (DESIGN §6.3). The host's macro engine acts on more than
// braces:
//   - `{{…}}` macros, evaluated again on a later pass when a message still holds `{{`;
//   - its escape sentinels \x01 / \x02 (and \x00 placeholders), which `postprocess()` turns back
//     into braces at the end of every evaluate(), so a sentinel pair becomes a macro on the next pass;
//   - the `<user>`, `<char>` and `<bot>` shorthands, which put a value on the slow path.
// A dynamic value (state, names, model or extraction output, Import and Refine proposals) is
// neutralized before it reaches the host, and import review lists every hazard in authored text.

/** C0 control characters except tab, newline and carriage return, plus DEL (the host's sentinels among them). */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const SHORTHAND = /<(user|char|bot)>/gi;
const MACRO = /\{\{[\s\S]*?\}\}/g;

/**
 * A value that can never form a host macro in any number of passes: control characters are dropped,
 * braces become their fullwidth lookalikes, and `<user>`-style shorthands get fullwidth angle brackets.
 */
export function neutralizeMacros(text: string): string {
  return text.replace(CONTROL, "").replace(/\{/g, "｛").replace(/\}/g, "｝").replace(SHORTHAND, "＜$1＞");
}

/** Everything in authored text the host's macro engine would act on, in order of kind (import review, lint). */
export function macroHazards(text: string, allowed: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MACRO)) if (!allowed.includes(m[0])) out.push(m[0].slice(0, 80));
  for (const m of text.matchAll(CONTROL)) out.push(`control character U+${(m[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`);
  for (const m of text.matchAll(SHORTHAND)) out.push(m[0]);
  return out;
}
