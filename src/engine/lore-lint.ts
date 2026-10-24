// World lore lint (DESIGN §4.2): entry ids and links; who may read an entry (a `known_by` entry
// needs links, since only knowing what it links lets a helper read it); secrets (a `secret` that
// isn't true or false, which reads as secret; a secret entry needs a gate, and a step whose output
// reaches the narrator or the player is flagged in its audience, since the lore search never gives
// it the secret; its holders are people in the world, and only a secret has any); the lookup
// table: entries it names that don't exist, blank or empty terms, terms not in the form lookups
// match, and terms that are an entry's alias but lead elsewhere; and the lore pinned to characters,
// places and steps (DESIGN §24.5, `LORE_PIN_LINTS`).

import { hasOwn, isRecord } from "../shared/json";
import { isLorePin, LORE_AUDIENCE, loreIsSecret, lorePinKey, loreSourceOf, loreTerm, PROSE_STEPS } from "../shared/lore";
import { STEP_OUTPUTS } from "../shared/steps";
import type { LintIssue } from "../shared/protocol";
import type { WorldDoc } from "../shared/world";
import { loreHeldBy } from "./lore";

export function lintLore(world: WorldDoc): LintIssue[] {
  const issues: LintIssue[] = [];
  const push = (severity: LintIssue["severity"], path: string, code: string, message: string): void => {
    issues.push({ severity, path, code, message });
  };
  // A secret entry may hold a track's truth: only its audience reads it, until its gate holds. A
  // public entry is open to every helper, and to the narrator once lore is delivered, so it holds none.
  const truths: string[] = [];
  for (const t of Object.values(world.tracks)) for (const s of Object.values(t.stages)) if (s.truth && s.truth.trim().length >= 12) truths.push(s.truth.trim().toLowerCase());
  for (const [id, l] of Object.entries(world.lore)) {
    if (l.id !== id) push("error", `lore.${id}.id`, "id_mismatch", "the id must match its key");
    for (const link of l.links) if (!hasOwn(world.entities, link) && !hasOwn(world.places, link)) push("warning", `lore.${id}.links`, "missing_ref", `"${link}" is not an entity or place`);
    const holders: unknown[] = Array.isArray(l.holders) ? l.holders : [];
    for (const holder of holders) if (typeof holder !== "string" || !hasOwn(world.entities, holder)) push("warning", `lore.${id}.holders`, "missing_ref", `"${String(holder)}" is not an entity: the secret is no one's`);
    const visibility: unknown = l.visibility;
    if (visibility !== undefined && visibility !== "public" && visibility !== "known_by") push("warning", `lore.${id}.visibility`, "unknown_visibility", `"${String(visibility)}" isn't a lore visibility: no helper reads the entry`);
    else if (visibility === "known_by" && !loreIsSecret(l) && l.links.length === 0) push("warning", `lore.${id}.visibility`, "no_links", `"${l.title}" is known by whoever knows what it links, and it links nothing: no helper reads it`);
    const secret: unknown = l.secret;
    if (secret !== undefined && typeof secret !== "boolean") push("warning", `lore.${id}.secret`, "secret_type", `"secret" is ${JSON.stringify(secret).slice(0, 40)}, not true or false: "${l.title}" reads as secret until it is one or the other`);
    if (!loreIsSecret(l)) {
      if (truths.some((t) => l.content.toLowerCase().includes(t))) push("error", `lore.${id}.content`, "secret_truth", `"${l.title}" is public but carries a secret's truth; mark it secret, with a gate, so only the helpers you pick read it`);
      if (holders.length > 0) push("warning", `lore.${id}.holders`, "holders_public", `"${l.title}" isn't secret, so it is nobody's own: every mind reads it`);
      continue;
    }
    if (!l.gate || l.gate.trim() === "") push("error", `lore.${id}.gate`, "no_gate", `secret lore "${l.title}" needs a gate: it is revealed only once the gate holds`);
    const audience = Array.isArray(l.audience) ? l.audience : [];
    const unknown = audience.filter((s) => !LORE_AUDIENCE.includes(s));
    if (unknown.length > 0) push("warning", `lore.${id}.audience`, "unknown_step", `no helper is called ${unknown.map((s) => `"${String(s)}"`).join(", ")}`);
    const prose = audience.filter((s) => PROSE_STEPS.includes(s));
    if (prose.length > 0) push("warning", `lore.${id}.audience`, "prose_audience", `secret lore "${l.title}" lists ${prose.join(", ")}, which never read a secret before its gate holds: what those steps write reaches the narrator or the player`);
  }
  // A world file's table may be malformed past the migration (a term's list that isn't one).
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const aliases = new Map<string, string[]>();
  for (const [id, l] of Object.entries(world.lore)) {
    for (const alias of Array.isArray(l.aliases) ? l.aliases : []) {
      const term = loreTerm(alias);
      if (term !== "") aliases.set(term, [...(aliases.get(term) ?? []), id]);
    }
  }
  for (const [term, raw] of Object.entries(world.loreIndex.terms)) {
    const path = `loreIndex.terms.${term}`;
    const entries = ids(raw);
    const matched = loreTerm(term);
    if (matched === "") push("warning", path, "empty_term", "a blank term matches nothing");
    else if (matched !== term) push("warning", path, "term_case", `lookups match this term as "${matched}"`);
    if (entries.length === 0) push("warning", path, "empty_term", `"${term}" leads to no entry`);
    for (const id of entries) if (!hasOwn(world.lore, id)) push("warning", path, "missing_ref", `"${id}" is not a lore entry`);
    const elsewhere = [...new Set(aliases.get(matched) ?? [])].filter((id) => !entries.includes(id));
    if (elsewhere.length > 0) push("warning", path, "alias_elsewhere", `"${term}" is an alias of ${elsewhere.map((id) => `"${world.lore[id]?.title ?? id}"`).join(", ")}, but the term doesn't lead there`);
  }
  for (const [id, topic] of Object.entries(world.loreIndex.topics)) {
    const path = `loreIndex.topics.${id}`;
    if (typeof topic.label !== "string" || topic.label.trim() === "") push("warning", path, "topic_label", "the topic needs a label");
    for (const entry of ids(topic.entries)) if (!hasOwn(world.lore, entry)) push("warning", path, "missing_ref", `"${entry}" is not a lore entry`);
  }
  issues.push(...lintLorePins(world));
  issues.push(...lintLoreBooks(world));
  return issues;
}

/**
 * The World Info books the world reads lore from live (DESIGN §4.2): a list of book ids, each once.
 * Whether a book still exists is the host's to say: a chat's turn logs a listed book that is gone,
 * and Build marks it.
 */
function lintLoreBooks(world: WorldDoc): LintIssue[] {
  const raw: unknown = world.loreBooks;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return [{ severity: "error", path: "loreBooks", code: "lore_books_shape", message: "Lore books are a list of World Info book ids; none are read." }];
  const issues: LintIssue[] = [];
  const seen = new Set<string>();
  raw.forEach((id: unknown, i) => {
    if (typeof id !== "string" || id.trim() === "") issues.push({ severity: "warning", path: `loreBooks.${i}`, code: "lore_books_shape", message: "Not a World Info book id: it is ignored." });
    else if (seen.has(id)) issues.push({ severity: "warning", path: `loreBooks.${i}`, code: "lore_books_duplicate", message: "This book is listed twice: it is read once." });
    else seen.add(id);
  });
  return issues;
}

/**
 * The lore pinned to characters, places and steps (DESIGN §24.5): each pin is `{lore}`,
 * `{book, entry}` or `{book}`, under a character, place or step the world has; a world entry it
 * names exists, isn't pinned twice to the same one, and is one their
 * mind may read: a secret pinned to someone it doesn't belong to never reaches them, and an
 * AI-written entry waiting for review reaches nobody. A book and its entries are read from the host
 * when they are used, so only their shape is checked here.
 */
function lintLorePins(world: WorldDoc): LintIssue[] {
  const raw: unknown = world.lorePins;
  if (raw === undefined) return [];
  const issues: LintIssue[] = [];
  const push = (severity: LintIssue["severity"], path: string, code: string, message: string): void => {
    issues.push({ severity, path, code, message });
  };
  if (!isRecord(raw)) return [{ severity: "error", path: "lorePins", code: "pin_shape", message: "Lore pins are an object of characters, places and steps; none are read." }];
  for (const key of Object.keys(raw)) if (key !== "characters" && key !== "places" && key !== "steps") push("warning", `lorePins.${key}`, "pin_shape", `"${key}" isn't part of the lore pins; nothing reads it.`);
  for (const part of ["characters", "places", "steps"] as const) {
    const targets: unknown = raw[part];
    if (targets === undefined) continue;
    if (!isRecord(targets)) {
      push("error", `lorePins.${part}`, "pin_shape", `The pins to ${part} are an object of lists by id; none are read.`);
      continue;
    }
    for (const [id, list] of Object.entries(targets)) {
      const path = `lorePins.${part}.${id}`;
      const name = part === "characters" ? (hasOwn(world.entities, id) ? world.entities[id]?.name : undefined) : part === "places" ? (hasOwn(world.places, id) ? world.places[id]?.name : undefined) : hasOwn(STEP_OUTPUTS, id) ? id : undefined;
      if (name === undefined) push("warning", path, "pin_target", part === "steps" ? `"${id}" is not a step, so no call reads what is pinned to it.` : `"${id}" is not ${part === "characters" ? "an entity" : "a place"} in the world, so no call reads what is pinned to it.`);
      if (!Array.isArray(list)) {
        push("error", path, "pin_shape", "The pins are a list; none are read.");
        continue;
      }
      const seen = new Set<string>();
      for (const [i, pin] of list.entries()) {
        if (!isLorePin(pin)) {
          push("error", path, "pin_shape", `Pin ${i + 1} is none of {"lore": id}, {"book": id, "entry": id} and {"book": id}, so it is ignored.`);
          continue;
        }
        const key = lorePinKey(pin);
        if (seen.has(key)) push("warning", path, "pin_duplicate", `${"lore" in pin ? `"${pin.lore}"` : "entry" in pin ? "A book entry" : "A book"} is pinned here twice; it is read once.`);
        seen.add(key);
        if (!("lore" in pin)) continue;
        const entry = hasOwn(world.lore, pin.lore) ? world.lore[pin.lore] : undefined;
        if (!entry) {
          push("warning", path, "pin_missing", `"${pin.lore}" is not a lore entry, so nothing is pinned.`);
          continue;
        }
        const source = loreSourceOf(entry.source);
        if (source.kind === "ai" && source.status === "pending") push("warning", path, "pin_pending", `"${entry.title}" was written by an indexing job and isn't reviewed yet; no call reads it until it is.`);
        if (part === "characters" && name !== undefined && loreIsSecret(entry) && !loreHeldBy(world, entry, id)) push("warning", path, "pin_unread", `"${entry.title}" is a secret that isn't ${name}'s own, so their mind never reads it; name them among its holders, or pin something else.`);
      }
    }
  }
  return issues;
}
