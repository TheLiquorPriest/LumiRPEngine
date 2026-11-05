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
//   the pins budget of Settings → Agents → Main agent. A listed file may be a chat path or a global
//   one (`~/`). An agent's pinned files are the manifest's for it, then those pinned in GM →
//   Workspace: the main agent's in its turn task, a role's in its prompt after its instructions
//   (`roles/agent.ts`), each framed by its own page's texts (`PinsTexts`). A file past the budget
//   comes as its headings, which `workspace_read` reads whole. Neither a turn's transcript nor a
//   system file (`AGENTS.md`, `roles/<role>.md`, at either level) is ever one: a system file is
//   already in the agent's system prompt (`system-files.ts`).

import { hashJson } from "../../shared/hash";
import { isRecord, safeKey } from "../../shared/json";
import type { Marker } from "../../shared/ledger";
import type { EntityDef } from "../../shared/world";
import { own } from "../../engine/pack-kit";
import { isGone } from "../../engine/scope";
import type { EntityState, WorldState } from "../../engine/state";
import { migrate, planUpgrade, type MarkerEnv } from "../../engine/upgrade";
import { canSeeEntity } from "../../engine/visibility";
import { MAIN_TEXT } from "../../shared/main-agent-prompts";
import type { PromptTexts } from "../../shared/prompts";
import { isFilePath, isSystemPath, PINS_PATH } from "../../shared/stores";
import { nounFor } from "../../shared/words";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore } from "../../engine/ledger/journal";
import type { Registry } from "../../engine/registry-impl";
import { tokensOf } from "../book";
import { renderPrompt } from "../prompts";
import { journalNotes } from "../view";
import type { ToolReadView } from "./tools/read-view";

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
    const files = Array.isArray(entry.files) ? [...new Set(entry.files.filter(isFilePath))] : [];
    const tokens = "tokens" in entry && typeof entry.tokens === "number" && Number.isInteger(entry.tokens) && entry.tokens >= 0 ? entry.tokens : null;
    out[role] = { files, tokens };
  }
  return out;
}

/** A markdown heading line. */
const HEADING = /^#{1,6}\s/;

/**
 * `role`'s pinned files as its prompt brings them in, framed by `framing`: those Settings → Agents →
 * Context pins for it (`config`), then the manifest's for it, then, with `pinned`, the files pinned in
 * GM → Workspace; each whole while it fits the role's budget, else as its headings. Empty when it has
 * none. A path the chat has no file at is passed over. A turn's transcript (`transcripts/`) and a
 * system file are never one, even listed in the manifest.
 */
export async function pinnedFiles(view: ToolReadView, input: { role: string; tokens: number; pinned: boolean; texts: PromptTexts; framing: PinsTexts; config?: readonly string[] }): Promise<string> {
  const { texts, framing } = input;
  const files = (await view.workspace()).filter((f) => f.transcript !== true && !isSystemPath(f.path));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const stored = byPath.get(PINS_PATH);
  const manifest = pinsManifestOf(stored ? await view.blob(stored.hash) : null);
  const entry = own(manifest, input.role);
  const pinned = input.pinned ? files.filter((f) => f.pinned && f.path !== PINS_PATH).map((f) => f.path) : [];
  const paths = [...new Set([...(input.config ?? []), ...(entry?.files ?? []), ...pinned])];
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

/** An entity as an Upgrade changes it, to compare across one: as the state holds it, its classes and tags as read (its own, else its revision's). */
function upgradeShape(e: EntityState | undefined, def: EntityDef | undefined): unknown {
  return e ? { ...e, class: e.class ?? def?.class ?? {}, tags: e.tags ?? def?.tags ?? [] } : null;
}

/**
 * What the chat's Upgrades since the main agent's last turn brought in (DESIGN §4.3 `migrate`), one
 * line each: the entities its picks took, new, changed or removed, money first, each by its name as
 * the player character knows it (the rest counted), so a payment an author wrote into the world is
 * never taken for the story's or the engine's own doing. What one took is its plan applied as the
 * fold applies it, the parts its picks leave to their defaults included (`migrate`), from the chat
 * as it stood before the message it is on; one made on another branch took nothing.
 */
function upgradeLines(d: DigestInput, chain: readonly ChainMessage[]): string[] {
  const head = d.core.renderState(d.observed);
  if (!head) return [];
  const fold = d.core.fold(d.observed);
  const env: MarkerEnv = { worlds: (revision) => d.core.worldAt(revision), types: d.registry };
  const pov = head.world.pov;
  const out: string[] = [];
  chain.forEach((m, i) => {
    if (d.last !== null && i < d.last) return;
    const inert = new Set(fold.notes.flatMap((n) => (n.kind === "inert" && n.messageId === m.id && n.ref !== null && "marker" in n.ref ? [n.ref.marker] : [])));
    const migrates = (m.ledger?.markers ?? []).filter((mk): mk is Extract<Marker, { kind: "migrate" }> => mk.kind === "migrate" && !inert.has(mk.seq)).sort((a, b) => a.seq - b.seq);
    if (!migrates.some((mk) => mk.merge !== undefined && mk.start !== true)) return;
    // Each in turn, so a second Upgrade on the message brings in only what the first didn't.
    let before: Readonly<WorldState> = d.core.fold(d.observed.slice(0, i)).state;
    for (const mk of migrates) {
      const after = structuredClone(before) as WorldState;
      const plan = mk.merge !== undefined && mk.start !== true ? planUpgrade(before, env, mk.to) : null;
      migrate(after, mk, env);
      if (plan) {
        const rows: { money: boolean; text: string }[] = [];
        let unseen = 0;
        const was = env.worlds(before.revision);
        const now = env.worlds(after.revision);
        const knew = d.core.playedAt(before);
        for (const p of plan.entities) {
          const held = own(before.entities, p.id);
          const taken = own(after.entities, p.id);
          // One picked to stay out of the chat took nothing.
          if (!taken) continue;
          let how: "new" | "changed" | "removed" | null;
          if (!held) how = "new";
          else if (p.status === "removed") how = isGone(after, p.id) && !isGone(before, p.id) ? "removed" : null;
          else how = hashJson(upgradeShape(held, was ? own(was.entities, p.id) : undefined)) !== hashJson(upgradeShape(taken, now ? own(now.entities, p.id) : undefined)) ? "changed" : null;
          if (how === null) continue;
          // Someone taken out of the world is judged as the player character knew them before.
          const seen = how === "removed" ? knew !== undefined && canSeeEntity(d.registry, knew, before, pov, p.id) : canSeeEntity(d.registry, head.world, head.state, pov, p.id);
          if (!seen) {
            unseen++;
            continue;
          }
          const kind = d.registry.kinds.get(taken.kind) ?? own(head.world.kinds, taken.kind);
          rows.push({ money: kind?.pack === "economy", text: `${taken.name} (${(kind?.label ?? taken.kind).toLowerCase()}, ${how})` });
        }
        rows.sort((a, b) => Number(b.money) - Number(a.money));
        const parts = [...rows.map((r) => r.text), ...(unseen > 0 ? [`${unseen} ${nounFor(unseen, "change", "changes")} the player character doesn't know of`] : [])];
        if (parts.length > 0) out.push(renderPrompt(MAIN_TEXT.digestUpgrade, d.texts, { changed: parts.join("; ") }));
      }
      before = after;
    }
  });
  return out;
}

/**
 * The turn task's digest (see the header), framed: since the main agent's last turn, or, for a fresh
 * session, the chat so far. Empty for a fresh session in a chat with nothing in it yet. What the
 * player did out of play and what the GM applied since come apart from what landed of the turn
 * (DESIGN §11): the player's told arrangements, their bookkeeping not for the story, the GM's
 * changes, then each Upgrade of the world, money first.
 */
export function digestOf(d: DigestInput): string {
  const { texts } = d;
  const chain = d.core.chain(d.observed);
  const lines = new Map<string, string[]>();
  const apart: Record<"told" | "untold" | "gm", string[]> = { told: [], untold: [], gm: [] };
  const indexOf = new Map(chain.map((m, i) => [m.id, i]));
  // Only what changed since the main agent's last turn is told, so the notes start there.
  for (const note of journalNotes(d.core, d.observed, d.observed.length, d.registry, d.last ?? 0)) {
    if (note.kind === "fix" && note.source !== undefined) {
      if (d.last === null || (indexOf.get(note.messageId) ?? -1) >= d.last) apart[note.source].push(note.text);
      continue;
    }
    lines.set(note.messageId, [...(lines.get(note.messageId) ?? []), note.text]);
  }
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
  const heads = [
    ...(landed.length > 0 ? [renderPrompt(MAIN_TEXT.digestLanded, texts, { changed: landed.join(" · ") })] : []),
    ...(apart.told.length > 0 ? [renderPrompt(MAIN_TEXT.digestTold, texts, { changed: apart.told.join(" · ") })] : []),
    ...(apart.untold.length > 0 ? [renderPrompt(MAIN_TEXT.digestBookkeeping, texts, { changed: apart.untold.join(" · ") })] : []),
    ...(apart.gm.length > 0 ? [renderPrompt(MAIN_TEXT.digestGm, texts, { changed: apart.gm.join(" · ") })] : []),
    ...upgradeLines(d, chain),
  ];
  const framing = d.fresh ? MAIN_TEXT.digestFresh : MAIN_TEXT.digest;
  if (entries.length === 0 && heads.length === 0) return d.fresh ? "" : renderPrompt(MAIN_TEXT.digestNothing, texts, {});
  // The newest replies first, within the digest's tokens: the framing and a left-out count go first,
  // then what landed of the last turn and what came apart from it; a reply too long for all that is left is cut when none newer is in.
  let left = d.tokens - tokensOf(renderPrompt(framing, texts, { turns: "" })) - tokensOf(renderPrompt(MAIN_TEXT.digestLeftOut, texts, { count: String(entries.length), replies: nounFor(entries.length, "reply", "replies") }));
  const shownHeads: string[] = [];
  for (const head of heads) {
    if (tokensOf(head) > left) continue;
    shownHeads.push(head);
    left -= tokensOf(head);
  }
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
  return renderPrompt(framing, texts, { turns: [...(leftOut > 0 ? [renderPrompt(MAIN_TEXT.digestLeftOut, texts, { count: String(leftOut), replies: nounFor(leftOut, "reply", "replies") })] : []), ...shownHeads, ...kept].join("\n\n") });
}

/** Blank lines a missing part leaves, closed up. */
export function tidy(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** The turn task (`main.turn`): the player's message, the digest and the pinned files. */
export function turnTask(texts: PromptTexts, parts: { message: string; digest: string; pins: string }): string {
  return tidy(renderPrompt(MAIN_TEXT.turn, texts, parts));
}
