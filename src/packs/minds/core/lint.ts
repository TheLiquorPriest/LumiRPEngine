// Lint for character minds (DESIGN §24.2): the world's `minds` config, read as the engine plays it
// (a value out of range or of the wrong kind falls back to its default, and lint says so), what each
// person holds from the start (§24.11), and the world's step templates for the minds purposes.

import { hasOwn, isRecord } from "../../../shared/json";
import type { LintIssue } from "../../../shared/protocol";
import type { FactRef } from "../../../shared/minds";
import { AUTHORED_FACT_KINDS, HOLDING_BELIEFS, isConfidence, isMindPurpose, MINDS_RANGES, parseFactId, WORLD_MINDS_KEYS, worldMindTemplate } from "../../../shared/minds";
import type { WorldDoc } from "../../../shared/world";
import type { LintRule } from "../../../engine/registry";
import type { Registry } from "../../../engine/registry-impl";
import { fieldDef, kindIs } from "../../../engine/scope";
import { selectorProblems } from "../../../engine/selector";

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
    err("minds", "The minds config is an object (secrecy, weights, thresholds, always, never, memory, holdings); the defaults play instead.");
    return out;
  }
  for (const key of Object.keys(raw)) if (!(WORLD_MINDS_KEYS as readonly string[]).includes(key)) warn(`minds.${key}`, `"${key}" isn't part of the minds config; nothing reads it.`);
  if (raw.secrecy !== undefined && raw.secrecy !== "full" && raw.secrecy !== "brief") err("minds.secrecy", 'Secrecy is "full" (the narrator gets each mind to depict) or "brief" (a leak-checked depiction only); "full", the default, plays instead.');
  const number = (path: string, v: unknown, [lo, hi]: readonly [number, number], whole: boolean): void => {
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi || (whole && !Number.isInteger(v))) err(path, `${whole ? "A whole number" : "A number"} from ${lo} to ${hi}; the default plays instead.`);
  };
  const weights = raw.weights;
  if (weights !== undefined && !isRecord(weights)) err("minds.weights", "The weights are an object of points by input; the defaults play instead.");
  if (isRecord(weights)) {
    for (const key of WEIGHT_KEYS) number(`minds.weights.${key}`, weights[key], MINDS_RANGES.weight, false);
    const band = weights.band;
    if (band !== undefined && !isRecord(band)) err("minds.weights.band", "The band weights are an object: principal, supporting and background.");
    if (isRecord(band)) for (const b of ["principal", "supporting", "background"]) number(`minds.weights.band.${b}`, band[b], MINDS_RANGES.weight, false);
    const roles = weights.roles;
    if (roles !== undefined && !isRecord(roles)) err("minds.weights.roles", "The role weights are an object of points by classification value.");
    if (isRecord(roles)) {
      for (const [value, points] of Object.entries(roles)) {
        number(`minds.weights.roles.${value}`, points, MINDS_RANGES.weight, false);
        const held = Object.values(world.classifications).some((facet) => isRecord(facet.values) && hasOwn(facet.values, value));
        if (!held) warn(`minds.weights.roles.${value}`, `No classification of this world has a value "${value}", so this weight never counts.`);
      }
    }
    for (const key of Object.keys(weights)) if (!(WEIGHT_KEYS as readonly string[]).includes(key) && key !== "band" && key !== "roles") warn(`minds.weights.${key}`, `"${key}" isn't a focus input; nothing reads it.`);
  }
  const thresholds = raw.thresholds;
  if (thresholds !== undefined && !isRecord(thresholds)) err("minds.thresholds", "The thresholds are an object: live, near and far.");
  if (isRecord(thresholds)) {
    for (const key of ["live", "near", "far"]) number(`minds.thresholds.${key}`, thresholds[key], MINDS_RANGES.threshold, false);
    const { live, near, far } = thresholds;
    if (typeof live === "number" && typeof near === "number" && live < near) warn("minds.thresholds.live", "Live is below Near: Live plays at Near's threshold.");
    if (typeof near === "number" && typeof far === "number" && near < far) warn("minds.thresholds.near", "Near is below Far: Near plays at Far's threshold.");
  }
  for (const key of ["always", "never"] as const) {
    const sel = raw[key];
    if (sel === undefined || sel === null) continue;
    if (!isRecord(sel)) {
      err(`minds.${key}`, `"${key}" is a selector or null.`);
      continue;
    }
    if (Object.keys(sel).length === 0) warn(`minds.${key}`, `An empty selector here pins no one; leave "${key}" out instead.`);
    if (registry) for (const problem of selectorProblems(registry, world, sel)) err(`minds.${key}`, `The "${key}" selector ${problem}.`);
  }
  const memory = raw.memory;
  if (memory !== undefined && !isRecord(memory)) err("minds.memory", "The memory defaults are an object; the built-in defaults play instead.");
  if (isRecord(memory)) {
    for (const [part, fields] of Object.entries(memory)) {
      const spec = hasOwn(MEMORY_PARTS, part) ? MEMORY_PARTS[part] : undefined;
      if (!spec) {
        warn(`minds.memory.${part}`, `"${part}" isn't a memory layer; nothing reads it.`);
        continue;
      }
      if (!isRecord(fields)) {
        err(`minds.memory.${part}`, `The ${part} settings are an object.`);
        continue;
      }
      for (const [key, v] of Object.entries(fields)) {
        const field = hasOwn(spec, key) ? spec[key] : undefined;
        if (!field) warn(`minds.memory.${part}.${key}`, `"${key}" isn't a ${part} setting; nothing reads it.`);
        else if (field === "bool") {
          if (typeof v !== "boolean") err(`minds.memory.${part}.${key}`, "On (true) or off (false); the default plays instead.");
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
    err("minds.holdings", "What people hold from the start is an object of facts by person; no one holds anything from the start instead.");
    return out;
  }
  const person = (id: string): boolean => {
    const e = hasOwn(world.entities, id) ? world.entities[id] : undefined;
    return e !== undefined && (registry === undefined || kindIs(registry, world, e.kind, "person"));
  };
  for (const [who, facts] of Object.entries(raw)) {
    const at = `minds.holdings.${who}`;
    if (!hasOwn(world.entities, who)) err(at, `The world has no one "${who}", so these holdings are never read.`);
    else if (!person(who)) err(at, `${world.entities[who]?.name ?? who} isn't a person, so these holdings are never read.`);
    if (!isRecord(facts)) {
      err(at, "Each person's holdings are an object of facts by id; they hold nothing from the start instead.");
      continue;
    }
    for (const [fact, v] of Object.entries(facts)) {
      const path = `${at}.${fact}`;
      const ref = parseFactId(fact);
      if (!ref || !AUTHORED_FACT_KINDS.includes(ref.kind)) {
        err(path, "A fact held from the start is lore:<entry>, track:<track>:<stage> or field:<entity>:<field>; this one is left out.");
        continue;
      }
      const missing = missingRef(world, registry, ref);
      if (missing) warn(path, `${missing} The holding seeds a fact nothing refers to.`);
      if (!isRecord(v)) {
        err(path, "A holding is an object (belief, confidence, keptFrom); this one is left out.");
        continue;
      }
      for (const key of Object.keys(v)) if (key !== "belief" && key !== "confidence" && key !== "keptFrom") warn(`${path}.${key}`, `"${key}" isn't part of a holding; nothing reads it.`);
      if (v.belief !== undefined && !(HOLDING_BELIEFS as readonly unknown[]).includes(v.belief)) err(`${path}.belief`, 'A belief is "true", "false" or "uncertain"; "true" plays instead.');
      if (v.confidence !== undefined && !isConfidence(v.confidence)) err(`${path}.confidence`, "A confidence is a number from 0 to 1; 1 plays instead.");
      const kept = v.keptFrom;
      if (kept === undefined || kept === "everyone") continue;
      if (!Array.isArray(kept) || !kept.every((id) => typeof id === "string")) {
        err(`${path}.keptFrom`, 'Whom it is kept from is "everyone" or a list of people; it is kept from no one instead.');
        continue;
      }
      for (const id of kept) {
        if (id === who) warn(`${path}.keptFrom`, "No one keeps a fact from themselves; that name is passed over.");
        else if (!person(id)) err(`${path}.keptFrom`, `"${id}" isn't a person in the world; that name is passed over.`);
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
    if (t.signals.length > 0) out.push({ severity: "info", path: `steps.${id}.signals`, code: "minds.step_signals", message: `Minds run on their own cadence (Settings → Minds), so a ${t.purpose} template's signals are ignored.` });
    const used = worldMindTemplate(world, t.purpose);
    if (t.template.trim() === "") out.push({ severity: "warning", path: `steps.${id}.template`, code: "minds.step_blank", message: `This ${t.purpose} template is blank, so it is skipped${used ? ` and "${used.id}" is used` : ""}.` });
    else if (used && used !== t) out.push({ severity: "warning", path: `steps.${id}`, code: "minds.step_duplicate", message: `The world has another ${t.purpose} template ("${used.id}"); only that one, the first by id with any text, is used.` });
  }
  return out;
}

export const MINDS_LINTS: readonly LintRule[] = [
  { code: "minds.config", check: (world, registry) => configIssues(world, registry) },
  { code: "minds.holdings", check: (world, registry) => (isRecord(world.minds) ? holdingIssues(world, world.minds.holdings, registry) : []) },
  { code: "minds.steps", check: (world) => stepIssues(world) },
];
