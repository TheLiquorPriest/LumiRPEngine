// The D32 preset lint (DESIGN §13): checks on the user's active prompt preset that make engine turns
// go wrong, read from a dry-run assembly of a world chat. A block that asks the narrator to end
// replies with JSON (a ledger block) puts JSON in every reply; a
// small max-tokens limit with a reasoning model can leave a reply empty (DESIGN §18.4: 3 of 34); a
// preset that places some of the world's section outlets but not all sends the rest in outside its
// blocks, where it doesn't mean them to be (DESIGN §6.8).

import type { DryRun } from "./host";

export interface PresetCaveat {
  /**
   * `preset_lint_pending`: the dry run is still running; `preset_lint_failed`: it failed, so the
   * preset's warnings aren't known; `host_cannot_stop`: this Lumiverse can't stop a generation for
   * the engine run (DESIGN §5.1); `step_connection_missing` and `step_model_missing`: an enabled
   * step (or the helper model) names a connection the user no longer has, or a model its connection
   * doesn't list, so its call would fail the turn (Caveats' pre-flight, DESIGN §5.3);
   * `step_model_unchecked`: a connection's models didn't come within the Preset check timeout;
   * `lore_book_unread` and `lore_books_unlisted`: a World Info book LRE never managed to read, or the
   * books not listed at all, so all of the user's World Info is off in world chats (DESIGN §6.1).
   */
  code: "preset_json_ledger" | "preset_low_max_tokens" | "preset_partial_outlets" | "preset_lint_pending" | "preset_lint_failed" | "host_cannot_stop" | "step_connection_missing" | "step_model_missing" | "step_model_unchecked" | "lore_book_unread" | "lore_books_unlisted";
  message: string;
}

/** Replies below this many tokens can be all reasoning and no text (DESIGN §18.4). */
export const MIN_REASONING_MAX_TOKENS = 1500;

/** A block asking each reply to carry JSON: "End every reply with the updated ledger as JSON", "<json>…", "```json". */
const JSON_ASK = /\b(reply|replies|response|responses|respond|answer|output|end|append|include|finish)\b[^.\n]{0,80}\bjson\b/gi;
const JSON_FENCE = /<json>|```json/i;
/** "Never output JSON", "don't end replies with JSON": the opposite ask. */
const NEGATED = /\b(no|not|never|don't|dont|do not|avoid|without)\b/i;

/**
 * Models that reason before they answer (their reasoning counts against max tokens). A name list,
 * so a new reasoning model reads as plain until it is added (only the max-tokens check uses it).
 */
const REASONING_MODEL = /deepseek-(v4|r1|reasoner)|\br1\b|reason|think|\bo[134](-|$)|gpt-5|qwq|gemini-(2\.5|3)|claude-(opus|sonnet)-4|grok-[34]/i;

export function isReasoningModel(model: string): boolean {
  return REASONING_MODEL.test(model);
}
export function jsonLedgerBlocks(blocks: DryRun["blocks"]): DryRun["blocks"] {
  return blocks.filter((b) => JSON_FENCE.test(b.content) || [...b.content.matchAll(JSON_ASK)].some((m) => !NEGATED.test(b.content.slice(Math.max(0, (m.index ?? 0) - 24), (m.index ?? 0) + m[0].length))));
}

/**
 * The caveats for one dry run; `presetName` names the preset in the message when known. `placing`:
 * the `lre_` outlets the preset's assembled blocks hold, and the world's sections by outlet with
 * their labels, when the chat is a world chat.
 */
export function presetCaveats(run: Pick<DryRun, "blocks" | "maxTokens" | "model">, presetName: string | null, placing: { outlets: ReadonlySet<string>; sections: readonly { outlet: string; label: string }[] } | null = null): PresetCaveat[] {
  const preset = presetName ? `Your active preset “${presetName}”` : "Your active preset";
  const out: PresetCaveat[] = [];
  for (const b of jsonLedgerBlocks(run.blocks)) {
    out.push({ code: "preset_json_ledger", message: `${preset} has an enabled block “${b.name}” that asks the narrator for JSON; replies will carry it. Turn it off in the preset if you don't want it.` });
  }
  if (run.maxTokens !== null && run.maxTokens < MIN_REASONING_MAX_TOKENS && isReasoningModel(run.model)) {
    out.push({ code: "preset_low_max_tokens", message: `${preset} limits replies to ${run.maxTokens} tokens with a reasoning model (${run.model}); its reasoning can use them all and leave the reply empty. Raise max tokens to at least ${MIN_REASONING_MAX_TOKENS}.` });
  }
  // Placing any section means the preset lays them out itself: one it leaves out goes in on its own, outside its blocks.
  const missing = placing ? placing.sections.filter((s) => !placing.outlets.has(s.outlet)) : [];
  if (placing && missing.length > 0 && missing.length < placing.sections.length) {
    out.push({ code: "preset_partial_outlets", message: `${preset} places some of the world's sections with {{outlet::lre_…}} but not ${missing.map((s) => `${s.label} ({{outlet::${s.outlet}}})`).join(", ")}; those go in outside its blocks. Add their outlets where the others are.` });
  }
  return out;
}
