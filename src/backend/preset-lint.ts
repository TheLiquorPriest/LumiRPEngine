// The D32 preset lint (DESIGN §13): checks on the user's active prompt preset that make engine turns
// go wrong, read from a dry-run assembly of a world chat. A block that asks the narrator to end
// replies with JSON (a ledger block) puts JSON in every reply; a
// small max-tokens limit with a reasoning model can leave a reply empty (DESIGN §18.4: 3 of 34).

import type { DryRun } from "./host";

export interface PresetCaveat {
  /** `preset_lint_pending`: the dry run is still running; `preset_lint_failed`: it failed, so the preset's warnings aren't known. */
  code: "preset_json_ledger" | "preset_low_max_tokens" | "preset_lint_pending" | "preset_lint_failed";
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

/** The caveats for one dry run; `presetName` names the preset in the message when known. */
export function presetCaveats(run: Pick<DryRun, "blocks" | "maxTokens" | "model">, presetName: string | null): PresetCaveat[] {
  const preset = presetName ? `Your active preset “${presetName}”` : "Your active preset";
  const out: PresetCaveat[] = [];
  for (const b of jsonLedgerBlocks(run.blocks)) {
    out.push({ code: "preset_json_ledger", message: `${preset} has an enabled block “${b.name}” that asks the narrator for JSON; replies will carry it. Turn it off in the preset if you don't want it.` });
  }
  if (run.maxTokens !== null && run.maxTokens < MIN_REASONING_MAX_TOKENS && isReasoningModel(run.model)) {
    out.push({ code: "preset_low_max_tokens", message: `${preset} limits replies to ${run.maxTokens} tokens with a reasoning model (${run.model}); its reasoning can use them all and leave the reply empty. Raise max tokens to at least ${MIN_REASONING_MAX_TOKENS}.` });
  }
  return out;
}
