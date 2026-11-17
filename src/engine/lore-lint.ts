// World lore lint (DESIGN §4.2): entry ids and links; who may read an entry (a `known_by` entry
// needs links, since only knowing what it links lets a helper read it); secrets (a `secret` that
// isn't true or false, which reads as secret; a secret entry needs a gate, and a step whose output
// reaches the narrator or the player is flagged in its audience, since the lore search never gives
// it the secret; its holders are people in the world, and only a secret has any); a secret mark in
// an entry's text naming no one, or more than one person (`markNameIssues`); the lookup table:
// entries it names that don't exist, blank or empty terms, terms not in the form lookups match, and
// terms that are an entry's alias but lead elsewhere; and the lore pinned to characters, places and
// steps (DESIGN §24.5, `LORE_PIN_LINTS`).

import { hasOwn, isRecord } from "../shared/json";
import { isLorePin, LORE_AUDIENCE, loreIsSecret, lorePinKey, loreSourceOf, loreTerm, PROSE_STEPS } from "../shared/lore";
import { STEP_OUTPUTS } from "../shared/steps";
import type { LintIssue } from "../shared/lint";
import { markNameIssues, parseSecretMarks } from "../shared/secret-marks";
import type { WorldDoc } from "../shared/world";
import { loreHeldBy } from "./lore";
import { say } from "./lines";

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
    if (l.id !== id) push("error", `lore.${id}.id`, "id_mismatch", say("lint_the_id_must_match_its_key"));
    for (const link of l.links) if (!hasOwn(world.entities, link) && !hasOwn(world.places, link)) push("warning", `lore.${id}.links`, "missing_ref", say("lint_link_is_not_an_entity_or_place", { link: link }));
    const holders: unknown[] = Array.isArray(l.holders) ? l.holders : [];
    for (const holder of holders) if (typeof holder !== "string" || !hasOwn(world.entities, holder)) push("warning", `lore.${id}.holders`, "missing_ref", say("lint_holder_is_not_an_entity_the_secret", { holder: String(holder) }));
    if (typeof l.content === "string") for (const mark of parseSecretMarks(l.content)) issues.push(...markNameIssues(world, null, mark, `lore.${id}.content`));
    const visibility: unknown = l.visibility;
    if (visibility !== undefined && visibility !== "public" && visibility !== "known_by") push("warning", `lore.${id}.visibility`, "unknown_visibility", say("lint_visibility_isnt_a_lore_visibility_no_helper", { visibility: String(visibility) }));
    else if (visibility === "known_by" && !loreIsSecret(l) && l.links.length === 0) push("warning", `lore.${id}.visibility`, "no_links", say("lint_title_is_known_by_whoever_knows_what", { title: l.title }));
    const secret: unknown = l.secret;
    if (secret !== undefined && typeof secret !== "boolean") push("warning", `lore.${id}.secret`, "secret_type", say("lint_secret_is_secret_not_true_or_false", { secret: JSON.stringify(secret).slice(0, 40), title: l.title }));
    if (!loreIsSecret(l)) {
      if (truths.some((t) => l.content.toLowerCase().includes(t))) push("error", `lore.${id}.content`, "secret_truth", say("lint_title_is_public_but_carries_a_secrets", { title: l.title }));
      if (holders.length > 0) push("warning", `lore.${id}.holders`, "holders_public", say("lint_title_isnt_secret_so_it_is_nobodys", { title: l.title }));
      continue;
    }
    if (!l.gate || l.gate.trim() === "") push("error", `lore.${id}.gate`, "no_gate", say("lint_secret_lore_title_needs_a_gate_it", { title: l.title }));
    const audience = Array.isArray(l.audience) ? l.audience : [];
    const unknown = audience.filter((s) => !LORE_AUDIENCE.includes(s));
    if (unknown.length > 0) push("warning", `lore.${id}.audience`, "unknown_step", say("lint_no_helper_is_called_names", { names: unknown.map((s) => `"${String(s)}"`).join(", ") }));
    const prose = audience.filter((s) => PROSE_STEPS.includes(s));
    if (prose.length > 0) push("warning", `lore.${id}.audience`, "prose_audience", say("lint_secret_lore_title_lists_prose_which_never", { title: l.title, prose: prose.join(", ") }));
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
    if (matched === "") push("warning", path, "empty_term", say("lint_a_blank_term_matches_nothing"));
    else if (matched !== term) push("warning", path, "term_case", say("lint_lookups_match_this_term_as_matched", { matched: matched }));
    if (entries.length === 0) push("warning", path, "empty_term", say("lint_term_leads_to_no_entry", { term: term }));
    for (const id of entries) if (!hasOwn(world.lore, id)) push("warning", path, "missing_ref", say("lint_id_is_not_a_lore_entry", { id: id }));
    const elsewhere = [...new Set(aliases.get(matched) ?? [])].filter((id) => !entries.includes(id));
    if (elsewhere.length > 0) push("warning", path, "alias_elsewhere", say("lint_term_is_an_alias_of_others_but_the", { term, others: elsewhere.map((id) => `"${world.lore[id]?.title ?? id}"`).join(", ") }));
  }
  for (const [id, topic] of Object.entries(world.loreIndex.topics)) {
    const path = `loreIndex.topics.${id}`;
    if (typeof topic.label !== "string" || topic.label.trim() === "") push("warning", path, "topic_label", say("lint_the_topic_needs_a_label"));
    for (const entry of ids(topic.entries)) if (!hasOwn(world.lore, entry)) push("warning", path, "missing_ref", say("lint_id_is_not_a_lore_entry", { id: entry }));
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
  if (!Array.isArray(raw)) return [{ severity: "error", path: "loreBooks", code: "lore_books_shape", message: say("lint_lore_books_are_a_list_of_world") }];
  const issues: LintIssue[] = [];
  const seen = new Set<string>();
  raw.forEach((id: unknown, i) => {
    if (typeof id !== "string" || id.trim() === "") issues.push({ severity: "warning", path: `loreBooks.${i}`, code: "lore_books_shape", message: say("lint_not_a_world_info_book_id_it") });
    else if (seen.has(id)) issues.push({ severity: "warning", path: `loreBooks.${i}`, code: "lore_books_duplicate", message: say("lint_this_book_is_listed_twice_it_is") });
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
  if (!isRecord(raw)) return [{ severity: "error", path: "lorePins", code: "pin_shape", message: say("lint_lore_pins_are_an_object_of_characters") }];
  for (const key of Object.keys(raw)) if (key !== "characters" && key !== "places" && key !== "steps") push("warning", `lorePins.${key}`, "pin_shape", say("lint_key_isnt_part_of_the_lore_pins", { key: key }));
  for (const part of ["characters", "places", "steps"] as const) {
    const targets: unknown = raw[part];
    if (targets === undefined) continue;
    if (!isRecord(targets)) {
      push("error", `lorePins.${part}`, "pin_shape", say("lint_the_pins_to_part_are_an_object", { part: part }));
      continue;
    }
    for (const [id, list] of Object.entries(targets)) {
      const path = `lorePins.${part}.${id}`;
      const name = part === "characters" ? (hasOwn(world.entities, id) ? world.entities[id]?.name : undefined) : part === "places" ? (hasOwn(world.places, id) ? world.places[id]?.name : undefined) : hasOwn(STEP_OUTPUTS, id) ? id : undefined;
      if (name === undefined) push("warning", path, "pin_target", part === "steps" ? say("lint_id_is_not_a_step_so_no", { id: id }) : say("lint_id_is_not_an_entitya_place_in", { id: id, if_characters: part === "characters" }));
      if (!Array.isArray(list)) {
        push("error", path, "pin_shape", say("lint_the_pins_are_a_list_none_are"));
        continue;
      }
      const seen = new Set<string>();
      for (const [i, pin] of list.entries()) {
        if (!isLorePin(pin)) {
          push("error", path, "pin_shape", say("lint_pin_i_is_none_of_lore_id", { i: i + 1 }));
          continue;
        }
        const key = lorePinKey(pin);
        if (seen.has(key)) push("warning", path, "pin_duplicate", say("lint_lore_a_book_entrya_book_is_pinned", { lore: "lore" in pin ? pin.lore : undefined, if_lore: !!("lore" in pin), if_entry: !!("entry" in pin) }));
        seen.add(key);
        if (!("lore" in pin)) continue;
        const entry = hasOwn(world.lore, pin.lore) ? world.lore[pin.lore] : undefined;
        if (!entry) {
          push("warning", path, "pin_missing", say("lint_lore_is_not_a_lore_entry_so", { lore: pin.lore }));
          continue;
        }
        const source = loreSourceOf(entry.source);
        if (source.kind === "ai" && source.status === "pending") push("warning", path, "pin_pending", say("lint_title_was_written_by_an_indexing_job", { title: entry.title }));
        if (part === "characters" && name !== undefined && loreIsSecret(entry) && !loreHeldBy(world, entry, id)) push("warning", path, "pin_unread", say("lint_title_is_a_secret_that_isnt_name", { title: entry.title, name: name }));
      }
    }
  }
  return issues;
}
