// What today's settings store reads of Settings → Agents → Prompts (DESIGN §6.12): the user's own
// texts, stored by id in `settings.json`'s `prompts.texts`. Today's code, carried for the migration
// (PlanSwap-15 items 3 and 4; READINGS R-85) with no text of the old engines in it: where today's
// reader holds a stored text against the registry's text of its id, this holds it against that
// text's row of the table of shipped texts (shipped-texts.ts), the SHA-256 of its wording and the
// placeholders it requires, which is all today's reader asks of the text.
//
// Today's reader keeps a stored text unless its id has no text, it is not a string, it is the
// shipped text word for word, or it cannot be sent. `sortPromptTexts` sorts every stored text by the
// same tests and hands each on: his edit, or set apart (today's build would not send it, or no build
// had its id), or the shipped text. A text today's reader let vanish is handed on with its reason.
// None of it comes into force in RPE; the carry attaches each as a file, off.

import { createHash } from "node:crypto";
import { isRecord } from "../../shared/json";
import type { SecretMarkWording } from "../../shared/secret-marks";
import { SHIPPED_TEXTS, type ShippedText } from "./shipped-texts";

/**
 * The registry id of each part of a secret's mark (`SecretMarkWording`), the Secret marks group: the
 * wording a turn's sections, its narrator rules and the World Info entries in its prompt mark a
 * secret in, and the narrator rules' sentence on a mark (`rule`).
 */
export const MARK_TEXT_IDS = { known: "narrator.mark.known", kept: "narrator.mark.kept", both: "narrator.mark.both", everyone: "narrator.mark.everyone", rule: "narrator.secret_marks" } as const satisfies Record<keyof SecretMarkWording, string>;

/** Settings → Agents → Prompts (DESIGN §6.12). */
export interface PromptSettings {
  /** The user's own texts by id: only those that differ from the shipped text. */
  texts: Record<string, string>;
  /** The longest text of the user's own, in characters. */
  maxChars: number;
}

/** No texts of the user's own yet; a text of their own may run as long as a step's own prompt does (20,000 characters). */
export const PROMPT_SETTINGS_DEFAULTS: Readonly<PromptSettings> = Object.freeze({ texts: {}, maxChars: 20_000 });

/** What a Re-narrate is sent (Settings → Swipes): the texts its turn was made with, or the user's current ones. */
export type SwipeTexts = "turn" | "current";
export const SWIPE_TEXTS: readonly SwipeTexts[] = ["turn", "current"];

const BY_ID: ReadonlyMap<string, ShippedText> = new Map(SHIPPED_TEXTS.map((row) => [row.id, row]));

/** The SHA-256 of a text's exact wording, as the table holds it. */
export function textFingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The shipped text's row of an id; undefined where no build had a text of it. */
export function shippedText(id: string): ShippedText | undefined {
  return BY_ID.get(id);
}

/** The placeholder token for a name. */
function placeholder(name: string): string {
  return `{{${name}}}`;
}

/** The placeholders `text` lacks that its text requires: without one it can't be used, so it is never sent. */
function missingPlaceholders(row: ShippedText, text: string): string[] {
  return row.required.filter((name) => !text.includes(placeholder(name)));
}

/** Whether `text` can be sent as the text of `row`: it keeps every placeholder its text requires, and isn't blank where the text can't be. */
function sendable(row: ShippedText, text: string): boolean {
  return missingPlaceholders(row, text).length === 0 && !(row.nonEmpty && text.trim() === "");
}

/** Why a stored text was set apart: today's build would not send it (a placeholder it requires is missing, or it is blank where it may not be), or no build had a text of its id. */
export type SetApartReason = "missing_placeholder" | "blank" | "unknown_id";

/** One stored text: its id, its wording and the SHA-256 of it, by which each stored text is found again in exactly one end of the sort. */
export interface SortedText {
  id: string;
  text: string;
  sha256: string;
}

/** A stored text today's reader let vanish, with its reason (and, for a missing placeholder, which). */
export interface SetApartText extends SortedText {
  reason: SetApartReason;
  /** The placeholders its text requires that it lacks, by name. */
  missing: string[];
}

/** Every text stored in `prompts.texts`, each in exactly one end. */
export interface PromptTextSort {
  /** His edits: a text that is not the shipped one and that today's build would send. Today's reader keeps these. */
  edits: SortedText[];
  /** Today's build would not send them, or no build had their ids; today's reader let them vanish. */
  setApart: SetApartText[];
  /** The shipped text word for word: not his edit. */
  shipped: SortedText[];
  /** Ids whose stored value is not a string, so no text; today's reader drops them. */
  notText: string[];
}

/** Sorts what `prompts.texts` stores, as it is in the file (after an older file's mark wording is moved into it). */
export function sortPromptTexts(stored: unknown): PromptTextSort {
  const sort: PromptTextSort = { edits: [], setApart: [], shipped: [], notText: [] };
  if (!isRecord(stored)) return sort;
  for (const [id, text] of Object.entries(stored)) {
    if (typeof text !== "string") {
      sort.notText.push(id);
      continue;
    }
    const sha256 = textFingerprint(text);
    const row = shippedText(id);
    if (!row) sort.setApart.push({ id, text, sha256, reason: "unknown_id", missing: [] });
    else if (sha256 === row.sha256) sort.shipped.push({ id, text, sha256 });
    else if (sendable(row, text)) sort.edits.push({ id, text, sha256 });
    else sort.setApart.push({ id, text, sha256, reason: row.nonEmpty && text.trim() === "" ? "blank" : "missing_placeholder", missing: missingPlaceholders(row, text) });
  }
  return sort;
}

/**
 * `UserSettings.prompts` as stored, checked: a text of a known id kept as written, except one that is
 * the shipped text word for word (not the user's own) or can't be sent. Length isn't checked here, so
 * lowering the limit never cuts a text already saved; a write past it is refused (`promptsWritten`).
 */
export function promptSettingsOf(raw: unknown, base: Readonly<PromptSettings> = PROMPT_SETTINGS_DEFAULTS): PromptSettings {
  const v = isRecord(raw) ? raw : {};
  const maxChars = typeof v.maxChars === "number" && Number.isInteger(v.maxChars) && v.maxChars >= 1 ? v.maxChars : base.maxChars;
  if (!isRecord(v.texts)) return { texts: { ...base.texts }, maxChars };
  const texts: Record<string, string> = {};
  for (const edit of sortPromptTexts(v.texts).edits) texts[edit.id] = edit.text;
  return { texts, maxChars };
}

/** Anything in double braces: a placeholder when it is exactly `{{name}}` of one the text has, else an unknown one, which Settings flags and never saves. */
const PROMPT_BRACES = /\{\{[\s\S]*?\}\}/g;

/**
 * Whether `text` can be saved as the text of `row` (DESIGN §6.12): it holds no placeholder the text
 * doesn't have (today's step templates send one as nothing, so it is flagged rather than lost
 * silently), keeps each it requires, isn't blank where the text can't be, and runs to `maxChars`
 * characters at most.
 */
function savable(row: ShippedText, text: string, maxChars: number): boolean {
  const known = new Set(row.vars.map(placeholder));
  for (const m of text.matchAll(PROMPT_BRACES)) if (!known.has(m[0])) return false;
  return sendable(row, text) && text.length <= maxChars;
}

/**
 * The prompt settings a write leaves (DESIGN §6.12): each text it changed that can't be saved as
 * written (an unknown placeholder, or past the limit in force after the write) stays as it was, so a
 * page or a tool that skipped the checks can't store one.
 */
export function promptsWritten(before: Readonly<PromptSettings>, after: Readonly<PromptSettings>): PromptSettings {
  const texts: Record<string, string> = { ...after.texts };
  for (const [id, now] of Object.entries(after.texts)) {
    const was: string | undefined = before.texts[id];
    const row = shippedText(id);
    if (now === was || !row || savable(row, now, after.maxChars)) continue;
    if (was === undefined) delete texts[id];
    else texts[id] = was;
  }
  return { texts, maxChars: after.maxChars };
}
