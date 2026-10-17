// World Info control (DESIGN §6.1–6.4): candidates, pre-rank and hit set; selection (engine-only, or
// `select` with a per-candidate cache); the lore budget with pins first and one entry per group;
// and the vote. Pure apart from the decision callback, so tests drive it directly.

import { hashJson, hashParts } from "../shared/hash";
import { isRecord } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import type { ContextGeneration } from "../shared/state-view";
import { sampleNoul } from "../engine/decide";
import { createRng } from "../engine/rng";
import { tokensOf } from "./book";
import type { InterceptorEntry } from "./host";

export type CandidateStatus = ContextGeneration["candidates"][number]["status"];

export interface Candidate {
  entry: InterceptorEntry;
  /** Stored `constant:true, disabled:false` user entries (DESIGN §6.1 pins). */
  pinned: boolean;
  /** An engine-book world lore entry (stored disabled; only these may receive `enabled`). */
  engine: boolean;
  score: number;
  /** World lore priority (pre-rank tie-break, higher first). */
  priority: number;
  /** In the hit set: a keyword or back-link hit. */
  hit: boolean;
  tokens: number;
}

export interface CandidateInput {
  entries: readonly InterceptorEntry[];
  engineBookId: string | null;
  /** Engine-book slot entries (handled as slots, never as lore). */
  slotIds: ReadonlySet<string>;
  passThroughBooks: ReadonlySet<string>;
  suppressed: (entry: InterceptorEntry) => boolean;
  /** Scene entity and place ids, for back-links. */
  sceneIds: ReadonlySet<string>;
  /** Recent messages, newest first. */
  recent: readonly string[];
  /** Whether a secret lore entry's gate holds now (DESIGN §4.2: secret lore is gated). */
  revealed: (gate: string) => boolean;
  /** Whether an entity id names something the POV knows (DESIGN §6.1: facts the POV doesn't know are removed). */
  knows?: (id: string) => boolean;
}

export interface Candidates {
  candidates: Candidate[];
  suppressed: string[];
  passThrough: InterceptorEntry[];
  /** User entries past the pre-rank cap: never selected, so the vote disables them. */
  overflow: string[];
}

/** The pre-rank cap (DESIGN §6.1). */
export const CANDIDATE_CAP = 64;

/** The engine's extension data on a book entry (world lore carries keys, links, group, priority, gate). */
function ext(entry: InterceptorEntry): Record<string, unknown> {
  const ns = entry.extensions[LEDGER_NAMESPACE];
  return isRecord(ns) ? ns : {};
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

export function gatherCandidates(input: CandidateInput): Candidates {
  const suppressed: string[] = [];
  const passThrough: InterceptorEntry[] = [];
  const out: Candidate[] = [];
  const recent = input.recent.map((m) => m.toLowerCase());
  for (const raw of input.entries) {
    const engine = raw.bookId === input.engineBookId;
    if (engine && input.slotIds.has(raw.id)) continue;
    if (!engine && input.passThroughBooks.has(raw.bookId)) {
      passThrough.push(raw);
      continue;
    }
    if (!engine && input.suppressed(raw)) {
      suppressed.push(raw.id);
      continue;
    }
    const ns = ext(raw);
    // Disabled user entries never come back; secret world lore waits for its gate.
    if (!engine && raw.disabled) continue;
    if (engine && ns.secret === true && !(typeof ns.gate === "string" && input.revealed(ns.gate))) continue;
    // World lore has no host keys (it never activates natively): its keys and group live in the extension.
    const entry: InterceptorEntry = engine ? { ...raw, keys: strings(ns.keys), group: typeof ns.group === "string" ? ns.group : raw.group } : raw;
    let score = 0;
    let hit = false;
    let keyHit = false;
    for (const id of strings(ns.links)) {
      if (input.sceneIds.has(id)) {
        score += 3;
        hit = true;
      }
    }
    for (const key of entry.keys) {
      const k = key.trim().toLowerCase();
      if (k.length < 2) continue;
      const at = recent.findIndex((m) => m.includes(k));
      if (at < 0) continue;
      hit = true;
      keyHit = true;
      score += 2 + (at < 2 ? 1 : 0);
    }
    // World lore about people the POV doesn't know yet waits until the conversation names it.
    const links = strings(ns.links);
    if (engine && input.knows && !keyHit && links.length > 0 && links.every((id) => !input.knows?.(id))) continue;
    const priority = typeof ns.priority === "number" ? ns.priority : 0;
    out.push({ entry, pinned: !engine && entry.constant && !entry.disabled, engine, score, priority, hit, tokens: tokensOf(entry.content) });
  }
  out.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.score - a.score || b.priority - a.priority || a.entry.id.localeCompare(b.entry.id));
  const kept = Math.max(CANDIDATE_CAP, out.filter((c) => c.pinned).length);
  return { candidates: out.slice(0, kept), suppressed, passThrough, overflow: out.slice(kept).filter((c) => !c.engine).map((c) => c.entry.id) };
}

export interface SelectionInput {
  candidates: readonly Candidate[];
  loreBudget: number;
  mode: "engine" | "standard" | "full";
  /** Asks the model which candidates matter; probabilities by candidate id, or null on failure (engine-only fallback). */
  decide: ((asks: readonly Candidate[]) => Promise<Map<string, number> | null>) | null;
  /** The per-candidate decision cache (Standard), keyed by `cacheKey`. */
  cache: Map<string, boolean>;
  cacheKey: (c: Candidate) => string;
  seed: string;
}

export interface Selection {
  selected: Candidate[];
  status: Map<string, { status: CandidateStatus; reason: string }>;
  used: number;
  pinsOverBudget: boolean;
  viaModel: boolean;
}

export async function selectLore(input: SelectionInput): Promise<Selection> {
  const status = new Map<string, { status: CandidateStatus; reason: string }>();
  const wanted = new Map<string, boolean>();
  let viaModel = false;
  const nonPins = input.candidates.filter((c) => !c.pinned);
  if (input.mode !== "engine" && input.decide) {
    const asks = nonPins.filter((c) => (input.mode === "full" || c.hit) && (input.mode === "full" || !input.cache.has(input.cacheKey(c))));
    for (const c of nonPins) if (input.mode === "standard" && input.cache.has(input.cacheKey(c))) wanted.set(c.entry.id, input.cache.get(input.cacheKey(c)) === true);
    const answers = asks.length > 0 ? await input.decide(asks) : new Map<string, number>();
    if (answers) {
      viaModel = true;
      for (const c of asks) {
        const p = answers.get(c.entry.id);
        if (p === undefined) continue;
        const yes = sampleNoul(Math.min(1, Math.max(0, p)), createRng(hashParts("lre.select", input.seed, c.entry.id)));
        wanted.set(c.entry.id, yes);
        // Fallback results are never cached; model answers are (Standard only).
        if (input.mode === "standard") input.cache.set(input.cacheKey(c), yes);
      }
    }
  }
  // Engine-only (and anything the model didn't answer): the hit set, by score.
  for (const c of nonPins) if (!wanted.has(c.entry.id)) wanted.set(c.entry.id, c.hit);

  const selected: Candidate[] = [];
  const groups = new Map<string, Candidate>();
  let used = 0;
  const pins = input.candidates.filter((c) => c.pinned);
  // Pins first; two pins in one group: the override wins, else the weight, else the turn seed.
  for (const c of pins) {
    const g = c.entry.group;
    const rival = g ? groups.get(g) : undefined;
    if (g && rival) {
      const keepRival = rival.entry.groupOverride !== c.entry.groupOverride ? rival.entry.groupOverride : rival.entry.groupWeight !== c.entry.groupWeight ? rival.entry.groupWeight > c.entry.groupWeight : createRng(hashParts("lre.group", input.seed, g)).next() < 0.5;
      const loser = keepRival ? c : rival;
      status.set(loser.entry.id, { status: "dropped", reason: "group" });
      if (!keepRival) {
        selected.splice(selected.indexOf(rival), 1, c);
        used += c.tokens - rival.tokens;
        groups.set(g, c);
        status.set(c.entry.id, { status: "pinned", reason: "constant" });
      }
      continue;
    }
    selected.push(c);
    used += c.tokens;
    if (g) groups.set(g, c);
    status.set(c.entry.id, { status: "pinned", reason: "constant" });
  }
  const pinsOverBudget = used > input.loreBudget;
  for (const c of nonPins) {
    if (!wanted.get(c.entry.id)) {
      status.set(c.entry.id, { status: "dropped", reason: c.hit ? (viaModel ? "not selected" : "low rank") : "no hit" });
      continue;
    }
    if (pinsOverBudget) {
      status.set(c.entry.id, { status: "dropped", reason: "pins fill the lore budget" });
      continue;
    }
    const g = c.entry.group;
    if (g && groups.has(g)) {
      status.set(c.entry.id, { status: "dropped", reason: "group" });
      continue;
    }
    if (used + c.tokens > input.loreBudget) {
      status.set(c.entry.id, { status: "dropped", reason: "lore budget" });
      continue;
    }
    selected.push(c);
    used += c.tokens;
    if (g) groups.set(g, c);
    status.set(c.entry.id, { status: "included", reason: viaModel ? "selected" : "rank" });
  }
  return { selected, status, used, pinsOverBudget, viaModel };
}

/** The per-candidate cache key (DESIGN §6.2): content hash, relevance key, hit-set membership, step config. */
export function cacheKeyOf(c: Candidate, relevance: string, stepConfig: string): string {
  return hashJson([hashParts("lre.content", c.entry.content), relevance, c.hit, stepConfig]);
}
