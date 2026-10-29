// The main agent's turn task (INC2-SPEC C14; AGENT-LOOP-PLAN §4, §7.1): the turn-task template
// with the player's message, a digest of what changed since the main agent's last turn, and its
// pinned files. Every text is the Main agent page's.
//
// - **The digest** is the chat as the player saw it, from its Journal (`journalNotes`): what landed
//   of the main agent's last turn once its reply was read, then each reply since, with the player's
//   message before it and what changed. With no turn of its own on the chain (a chat that played
//   classic, or a fixed pipeline, until now), it is the chat so far, framed as a fresh session. The
//   newest replies come first within Settings → Agents → Main agent's digest tokens; the rest are
//   counted as left out.
// - **The pins manifest** is a workspace file (`.pins.json`) listing files per role: `main` for the
//   main agent, a role's id for a role, each with its files in order and its budget in tokens, else
//   the pins budget of Settings → Agents → Main agent. An agent's pinned files are the manifest's for
//   it, then those pinned in GM → Workspace: the main agent's in its turn task, a role's in its
//   prompt after its instructions (`roles/agent.ts`), each framed by its own page's texts
//   (`PinsTexts`). A file past the budget comes as its headings, which `workspace_read` reads whole.
//   Files are read with the agent's knowledge, as its workspace tools read them.

import { isRecord, safeKey } from "../../shared/json";
import { own } from "../../engine/pack-kit";
import { MAIN_TEXT } from "../../shared/main-agent-prompts";
import type { PromptTexts } from "../../shared/prompts";
import { isWorkspacePath } from "../../shared/stores";
import { nounFor } from "../../shared/words";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore } from "../../engine/ledger/journal";
import type { Registry } from "../../engine/registry-impl";
import { tokensOf } from "../book";
import { renderPrompt } from "../prompts";
import { journalNotes } from "../view";
import type { ToolReadView } from "./tools/read-view";

/** The pins manifest's path in the chat's workspace (a stored name, §16.7). */
export const PINS_PATH = ".pins.json";

/** The manifest's key for the main agent's own pins; a role's are under its id. */
export const MAIN_PINS = "main";

/** A role's entry in the pins manifest: its files in order, and its budget in tokens (null: the pins budget). */
export interface PinsEntry {
  files: string[];
  tokens: number | null;
}

/** The texts an agent's pinned files are framed by, by id: the whole, one file whole, one past the budget, and its headings when it has none. */
export interface PinsTexts {
  pins: string;
  file: string;
  headings: string;
  none: string;
}

/** The main agent's, from its page. */
export const MAIN_PINS_TEXTS: PinsTexts = { pins: MAIN_TEXT.pins, file: MAIN_TEXT.pinsFile, headings: MAIN_TEXT.pinsHeadings, none: MAIN_TEXT.none };

/**
 * The pins manifest as stored: by role, `{files: [paths], tokens?}`, or just the list of paths. An
 * entry or a path that doesn't read is left out, and a manifest that isn't JSON is none.
 */
export function pinsManifestOf(text: string | null): Record<string, PinsEntry> {
  if (text === null) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isRecord(raw)) return {};
  const out: Record<string, PinsEntry> = {};
  for (const [role, value] of Object.entries(raw)) {
    const entry = Array.isArray(value) ? { files: value } : isRecord(value) ? value : null;
    if (!entry || !safeKey(role)) continue;
    const files = Array.isArray(entry.files) ? [...new Set(entry.files.filter(isWorkspacePath))] : [];
    const tokens = "tokens" in entry && typeof entry.tokens === "number" && Number.isInteger(entry.tokens) && entry.tokens >= 0 ? entry.tokens : null;
    out[role] = { files, tokens };
  }
  return out;
}

/** A markdown heading line. */
const HEADING = /^#{1,6}\s/;

/**
 * `role`'s pinned files as its prompt brings them in, read with the view's knowledge and framed by
 * `framing`: the manifest's for it, then, with `pinned`, the files pinned in GM → Workspace; each
 * whole while it fits the role's budget, else as its headings. Empty when it has none.
 */
export async function pinnedFiles(view: ToolReadView, input: { role: string; tokens: number; pinned: boolean; texts: PromptTexts; framing: PinsTexts }): Promise<string> {
  const { texts, framing } = input;
  const files = await view.workspace();
  const byPath = new Map(files.map((f) => [f.path, f]));
  const stored = byPath.get(PINS_PATH);
  const manifest = pinsManifestOf(stored ? await view.blob(stored.hash) : null);
  const entry = own(manifest, input.role);
  const pinned = input.pinned ? files.filter((f) => f.pinned && f.path !== PINS_PATH).map((f) => f.path) : [];
  const paths = [...new Set([...(entry?.files ?? []), ...pinned])];
  const budget = entry?.tokens ?? input.tokens;
  let left = budget;
  const parts: string[] = [];
  for (const path of paths) {
    const file = byPath.get(path);
    const text = file ? await view.blob(file.hash) : null;
    if (text === null) continue;
    const whole = renderPrompt(framing.file, texts, { path, text });
    if (tokensOf(whole) <= left) {
      parts.push(whole);
      left -= tokensOf(whole);
      continue;
    }
    const headings = text.split("\n").filter((line) => HEADING.test(line)).join("\n");
    const shown = renderPrompt(framing.headings, texts, { path, headings: headings === "" ? renderPrompt(framing.none, texts, {}) : headings });
    parts.push(shown);
    left = Math.max(0, left - tokensOf(shown));
  }
  return parts.length === 0 ? "" : renderPrompt(framing.pins, texts, { tokens: String(budget), unit: nounFor(budget, "token", "tokens"), files: parts.join("\n\n") });
}

/** `text` cut at the end to `tokens` at most, the cut marked; the whole when it fits. */
function cutTo(text: string, tokens: number): string {
  if (tokensOf(text) <= tokens) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (tokensOf(`${text.slice(0, mid)}…`) <= tokens) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

/** What a digest is made from: the chain before the turn, and where the main agent's last turn is on it. */
export interface DigestInput {
  core: LedgerCore;
  /** The chain before the turn (up to its target), as the host has it. */
  observed: readonly ChainMessage[];
  registry: Registry;
  /** The index in `observed` of the main agent's last turn's reply; null when it has none there. */
  last: number | null;
  /** No session of its own yet: the digest is the chat so far. */
  fresh: boolean;
  tokens: number;
  texts: PromptTexts;
}

/**
 * The turn task's digest (see the header), framed: since the main agent's last turn, or, for a fresh
 * session, the chat so far. Empty for a fresh session in a chat with nothing in it yet.
 */
export function digestOf(d: DigestInput): string {
  const { texts } = d;
  const chain = d.core.chain(d.observed);
  const lines = new Map<string, string[]>();
  for (const note of journalNotes(d.core, d.observed, d.observed.length, d.registry)) lines.set(note.messageId, [...(lines.get(note.messageId) ?? []), note.text]);
  const none = renderPrompt(MAIN_TEXT.none, texts, {});
  const entries: string[] = [];
  let replies = 0;
  chain.forEach((m, i) => {
    if (m.isUser) return;
    replies++;
    if (d.last !== null && i <= d.last) return;
    const before = chain[i - 1];
    const said = before?.isUser ? (before.swipes[before.swipeId] ?? "").trim() : "";
    entries.push(renderPrompt(MAIN_TEXT.digestEntry, texts, { n: String(replies), said: said || none, changed: (lines.get(m.id) ?? []).join(" · ") || none, reply: (m.swipes[m.swipeId] ?? "").trim() || none }));
  });
  const last = d.last === null ? undefined : chain[d.last];
  const landed = last ? (lines.get(last.id) ?? []) : [];
  const head = landed.length > 0 ? renderPrompt(MAIN_TEXT.digestLanded, texts, { changed: landed.join(" · ") }) : null;
  const framing = d.fresh ? MAIN_TEXT.digestFresh : MAIN_TEXT.digest;
  if (entries.length === 0 && head === null) return d.fresh ? "" : renderPrompt(MAIN_TEXT.digestNothing, texts, {});
  // The newest replies first, within the digest's tokens: the framing and a left-out count go first,
  // then what landed of the last turn; a reply too long for all that is left is cut when none newer is in.
  let left = d.tokens - tokensOf(renderPrompt(framing, texts, { turns: "" })) - tokensOf(renderPrompt(MAIN_TEXT.digestLeftOut, texts, { count: String(entries.length), replies: nounFor(entries.length, "reply", "replies") }));
  const shownHead = head !== null && tokensOf(head) <= left ? head : null;
  if (shownHead) left -= tokensOf(shownHead);
  const kept: string[] = [];
  let next = entries.length - 1;
  while (next >= 0) {
    const entry = entries[next] ?? "";
    if (tokensOf(entry) <= left) {
      kept.unshift(entry);
      left -= tokensOf(entry);
      next--;
      continue;
    }
    if (kept.length === 0 && left > 0) {
      kept.unshift(cutTo(entry, left));
      next--;
    }
    break;
  }
  const leftOut = next + 1;
  return renderPrompt(framing, texts, { turns: [...(leftOut > 0 ? [renderPrompt(MAIN_TEXT.digestLeftOut, texts, { count: String(leftOut), replies: nounFor(leftOut, "reply", "replies") })] : []), ...(shownHead ? [shownHead] : []), ...kept].join("\n\n") });
}

/** Blank lines a missing part leaves, closed up. */
export function tidy(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** The turn task (`main.turn`): the player's message, the digest and the pinned files. */
export function turnTask(texts: PromptTexts, parts: { message: string; digest: string; pins: string }): string {
  return tidy(renderPrompt(MAIN_TEXT.turn, texts, parts));
}
