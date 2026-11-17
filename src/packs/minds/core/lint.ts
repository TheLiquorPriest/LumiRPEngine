// Lint for character minds (DESIGN §24.2): the world's `minds` config, read as the engine plays it
// (a value out of range or of the wrong kind falls back to its default, and lint says so), what each
// person holds from the start (§24.11), and the world's step templates for the minds purposes.

import { hasOwn, isRecord } from "../../../shared/json";
import type { LintIssue } from "../../../shared/lint";
import type { FactRef } from "../../../shared/minds";
import { AUTHORED_FACT_KINDS, HOLDING_BELIEFS, isConfidence, isMindPurpose, MINDS_RANGES, parseFactId, WORLD_MINDS_KEYS, worldMindTemplate } from "../../../shared/minds";
import type { WorldDoc } from "../../../shared/world";
import type { LintRule } from "../../../engine/registry";
import type { Registry } from "../../../engine/registry-impl";
import { fieldDef, kindIs } from "../../../engine/scope";
import { selectorProblems } from "../../../engine/selector";
import { say } from "../../../engine/lines";

const WEIGHT_KEYS = ["here", "nearby", "mentioned", "regard", "knows", "owner", "track", "rule", "pending", "recent"] as const;
/** Each memory setting: a number in its range (whole or not, and `"none"` allowed where it may have no limit), or a switch. */
const MEMORY_PARTS: Readonly<Record<string, Readonly<Record<string, { range: readonly [number, number]; whole: boolean; none?: true } | "bool">>>> = {
  witness: { show: { range: MINDS_RANGES.show, whole: true } },
  recall: { recent: { range: MINDS_RANGES.show, whole: true }, relevant: { range: MINDS_RANGES.show, whole: true }, tokens: { range: MINDS_RANGES.recallTokens, whole: true, none: true } },
  notes: { show: { range: MINDS_RANGES.show, whole: true }, keep: { range: MINDS_RANGES.keep, whole: true } },
  commitments: { show: { range: MINDS_RANGES.show, whole: true } },
  salience: { halfLifeDays: { range: MINDS_RANGES.halfLifeDays, whole: false }, floor: { range: MINDS_RANGES.floor, whole: false } },
  consolidate: { enabled: "bool", periodDays: { range: MINDS_RANGES.periodDays, whole: false } },
};

/** Problems with `world.minds`: each one says what the engine plays instead. */
function configIssues(world: WorldDoc, registry: Registry | undefined): LintIssue[] {
  const raw: unknown = world.minds;
  if (raw === undefined) return [];
  const out: LintIssue[] = [];
  const err = (path: string, message: string): void => void out.push({ severity: "error", path, code: "minds.config", message });
  const warn = (path: string, message: string): void => void out.push({ severity: "warning", path, code: "minds.config", message });
  if (!isRecord(raw)) {
    err("minds", say("lint_the_minds_config_is_an_object_secrecy"));
    return out;
  }
  for (const key of Object.keys(raw)) if (!(WORLD_MINDS_KEYS as readonly string[]).includes(key)) warn(`minds.${key}`, say("lint_key_isnt_part_of_the_minds_config", { key: key }));
  if (raw.secrecy !== undefined && raw.secrecy !== "full" && raw.secrecy !== "brief") err("minds.secrecy", say("lint_secrecy_is_full_the_narrator_gets_each"));
  const number = (path: string, v: unknown, [lo, hi]: readonly [number, number], whole: boolean): void => {
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi || (whole && !Number.isInteger(v))) err(path, say("lint_a_whole_numbera_number_from_lo_to", { lo: lo, hi: hi, if_whole: !!(whole) }));
  };
  const weights = raw.weights;
  if (weights !== undefined && !isRecord(weights)) err("minds.weights", say("lint_the_weights_are_an_object_of_points"));
  if (isRecord(weights)) {
    for (const key of WEIGHT_KEYS) number(`minds.weights.${key}`, weights[key], MINDS_RANGES.weight, false);
    const band = weights.band;
    if (band !== undefined && !isRecord(band)) err("minds.weights.band", say("lint_the_band_weights_are_an_object_principal"));
    if (isRecord(band)) for (const b of ["principal", "supporting", "background"]) number(`minds.weights.band.${b}`, band[b], MINDS_RANGES.weight, false);
    const roles = weights.roles;
    if (roles !== undefined && !isRecord(roles)) err("minds.weights.roles", say("lint_the_role_weights_are_an_object_of"));
    if (isRecord(roles)) {
      for (const [value, points] of Object.entries(roles)) {
        number(`minds.weights.roles.${value}`, points, MINDS_RANGES.weight, false);
        const held = Object.values(world.classifications).some((facet) => isRecord(facet.values) && hasOwn(facet.values, value));
        if (!held) warn(`minds.weights.roles.${value}`, say("lint_no_classification_of_this_world_has_a", { value: value }));
      }
    }
    for (const key of Object.keys(weights)) if (!(WEIGHT_KEYS as readonly string[]).includes(key) && key !== "band" && key !== "roles") warn(`minds.weights.${key}`, say("lint_key_isnt_a_focus_input_nothing_reads", { key: key }));
  }
  const thresholds = raw.thresholds;
  if (thresholds !== undefined && !isRecord(thresholds)) err("minds.thresholds", say("lint_the_thresholds_are_an_object_live_near"));
  if (isRecord(thresholds)) {
    for (const key of ["live", "near", "far"]) number(`minds.thresholds.${key}`, thresholds[key], MINDS_RANGES.threshold, false);
    const { live, near, far } = thresholds;
    if (typeof live === "number" && typeof near === "number" && live < near) warn("minds.thresholds.live", say("lint_live_is_below_near_live_plays_at"));
    if (typeof near === "number" && typeof far === "number" && near < far) warn("minds.thresholds.near", say("lint_near_is_below_far_near_plays_at"));
  }
  for (const key of ["always", "never"] as const) {
    const sel = raw[key];
    if (sel === undefined || sel === null) continue;
    if (!isRecord(sel)) {
      err(`minds.${key}`, say("lint_key_is_a_selector_or_null", { key: key }));
      continue;
    }
    if (Object.keys(sel).length === 0) warn(`minds.${key}`, say("lint_an_empty_selector_here_pins_no_one", { key: key }));
    if (registry) for (const problem of selectorProblems(registry, world, sel)) err(`minds.${key}`, say("lint_the_key_selector_problem", { key: key, problem: problem }));
  }
  const memory = raw.memory;
  if (memory !== undefined && !isRecord(memory)) err("minds.memory", say("lint_the_memory_defaults_are_an_object_the"));
  if (isRecord(memory)) {
    for (const [part, fields] of Object.entries(memory)) {
      const spec = hasOwn(MEMORY_PARTS, part) ? MEMORY_PARTS[part] : undefined;
      if (!spec) {
        warn(`minds.memory.${part}`, say("lint_part_isnt_a_memory_layer_nothing_reads", { part: part }));
        continue;
      }
      if (!isRecord(fields)) {
        err(`minds.memory.${part}`, say("lint_the_part_settings_are_an_object", { part: part }));
        continue;
      }
      for (const [key, v] of Object.entries(fields)) {
        const field = hasOwn(spec, key) ? spec[key] : undefined;
        if (!field) warn(`minds.memory.${part}.${key}`, say("lint_key_isnt_a_part_setting_nothing_reads", { key: key, part: part }));
        else if (field === "bool") {
          if (typeof v !== "boolean") err(`minds.memory.${part}.${key}`, say("lint_on_true_or_off_false_the_default"));
        } else if (!(field.none && v === "none")) number(`minds.memory.${part}.${key}`, v, field.range, field.whole);
      }
    }
  }
  return out;
}

/** What a fact id names in the world, in words for lint, or null when the world has it. */
function missingRef(world: WorldDoc, registry: Registry | undefined, ref: FactRef): string | null {
  if (ref.kind === "lore") return hasOwn(world.lore, ref.lore) ? null : `The world has no lore entry "${ref.lore}".`;
  if (ref.kind === "track") {
    const track = hasOwn(world.tracks, ref.track) ? world.tracks[ref.track] : undefined;
    if (!track) return `The world has no track "${ref.track}".`;
    return hasOwn(track.stages, ref.stage) ? null : `The track "${track.label}" has no stage "${ref.stage}".`;
  }
  if (ref.kind === "field") {
    const e = hasOwn(world.entities, ref.entity) ? world.entities[ref.entity] : undefined;
    if (!e) return `The world has no entity "${ref.entity}".`;
    const defined = hasOwn(e.fields, ref.field) || (registry !== undefined && fieldDef(registry, world, e.kind, ref.field) !== undefined);
    return defined ? null : `${e.name} has no field "${ref.field}".`;
  }
  return null;
}

/**
 * `world.minds.holdings`: each holder a person in the world, each fact a world fact an author can
 * give (lore, a track's stage, someone's field) that the world has, a belief and a confidence that
 * read, and those it is kept from people in the world. Each says what the engine reads instead.
 */
function holdingIssues(world: WorldDoc, raw: unknown, registry: Registry | undefined): LintIssue[] {
  if (raw === undefined) return [];
  const out: LintIssue[] = [];
  const err = (path: string, message: string): void => void out.push({ severity: "error", path, code: "minds.holdings", message });
  const warn = (path: string, message: string): void => void out.push({ severity: "warning", path, code: "minds.holdings", message });
  if (!isRecord(raw)) {
    err("minds.holdings", say("lint_what_people_hold_from_the_start_is"));
    return out;
  }
  const person = (id: string): boolean => {
    const e = hasOwn(world.entities, id) ? world.entities[id] : undefined;
    return e !== undefined && (registry === undefined || kindIs(registry, world, e.kind, "person"));
  };
  for (const [who, facts] of Object.entries(raw)) {
    const at = `minds.holdings.${who}`;
    if (!hasOwn(world.entities, who)) err(at, say("lint_the_world_has_no_one_who_so", { who: who }));
    else if (!person(who)) err(at, say("lint_who_isnt_a_person_so_these_holdings", { who: world.entities[who]?.name ?? who }));
    if (!isRecord(facts)) {
      err(at, say("lint_each_persons_holdings_are_an_object_of"));
      continue;
    }
    for (const [fact, v] of Object.entries(facts)) {
      const path = `${at}.${fact}`;
      const ref = parseFactId(fact);
      if (!ref || !AUTHORED_FACT_KINDS.includes(ref.kind)) {
        err(path, say("lint_a_fact_held_from_the_start_is"));
        continue;
      }
      const missing = missingRef(world, registry, ref);
      if (missing) warn(path, say("lint_missing_the_holding_seeds_a_fact_nothing", { missing: missing }));
      if (!isRecord(v)) {
        err(path, say("lint_a_holding_is_an_object_belief_confidence"));
        continue;
      }
      for (const key of Object.keys(v)) if (key !== "belief" && key !== "confidence" && key !== "keptFrom") warn(`${path}.${key}`, say("lint_key_isnt_part_of_a_holding_nothing", { key: key }));
      if (v.belief !== undefined && !(HOLDING_BELIEFS as readonly unknown[]).includes(v.belief)) err(`${path}.belief`, say("lint_a_belief_is_true_false_or_uncertain"));
      if (v.confidence !== undefined && !isConfidence(v.confidence)) err(`${path}.confidence`, say("lint_a_confidence_is_a_number_from_0"));
      const kept = v.keptFrom;
      if (kept === undefined || kept === "everyone") continue;
      if (!Array.isArray(kept) || !kept.every((id) => typeof id === "string")) {
        err(`${path}.keptFrom`, say("lint_whom_it_is_kept_from_is_everyone"));
        continue;
      }
      for (const id of kept) {
        if (id === who) warn(`${path}.keptFrom`, say("lint_no_one_keeps_a_fact_from_themselves"));
        else if (!person(id)) err(`${path}.keptFrom`, say("lint_id_isnt_a_person_in_the_world", { id: id }));
      }
    }
  }
  return out;
}

/** Step templates for the minds purposes: their signals never decide anything, and only the one `worldMindTemplate` picks per purpose is used. */
function stepIssues(world: WorldDoc): LintIssue[] {
  const out: LintIssue[] = [];
  for (const [id, t] of Object.entries(world.steps).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isMindPurpose(t.purpose)) continue;
    if (t.signals.length > 0) out.push({ severity: "info", path: `steps.${id}.signals`, code: "minds.step_signals", message: say("lint_minds_run_on_their_own_cadence_settings", { purpose: t.purpose }) });
    const used = worldMindTemplate(world, t.purpose);
    if (t.template.trim() === "") out.push({ severity: "warning", path: `steps.${id}.template`, code: "minds.step_blank", message: say("lint_this_purpose_template_is_blank_so_it", { purpose: t.purpose, id: used?.id, if_used: !!(used) }) });
    else if (used && used !== t) out.push({ severity: "warning", path: `steps.${id}`, code: "minds.step_duplicate", message: say("lint_the_world_has_another_purpose_template_id", { purpose: t.purpose, id: used.id }) });
  }
  return out;
}

export const MINDS_LINTS: readonly LintRule[] = [
  { code: "minds.config", check: (world, registry) => configIssues(world, registry) },
  { code: "minds.holdings", check: (world, registry) => (isRecord(world.minds) ? holdingIssues(world, world.minds.holdings, registry) : []) },
  { code: "minds.steps", check: (world) => stepIssues(world) },
];
