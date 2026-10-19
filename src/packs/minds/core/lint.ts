// Lint for character minds (DESIGN §24.2): the world's `minds` config, read as the engine plays it
// (a value out of range or of the wrong kind falls back to its default, and lint says so), and the
// world's step templates for the minds purposes.

import { hasOwn, isRecord } from "../../../shared/json";
import type { LintIssue } from "../../../shared/protocol";
import { isMindPurpose, MINDS_RANGES, WORLD_MINDS_KEYS } from "../../../shared/minds";
import type { WorldDoc } from "../../../shared/world";
import type { LintRule } from "../../../engine/registry";
import type { Registry } from "../../../engine/registry-impl";
import { selectorProblems } from "../../../engine/selector";

const WEIGHT_KEYS = ["here", "nearby", "mentioned", "regard", "knows", "owner", "track", "rule", "pending", "recent"] as const;
const MEMORY_PARTS: Readonly<Record<string, Readonly<Record<string, { range: readonly [number, number]; whole: boolean } | "bool">>>> = {
  witness: { show: { range: MINDS_RANGES.show, whole: true } },
  recall: { recent: { range: MINDS_RANGES.show, whole: true }, relevant: { range: MINDS_RANGES.show, whole: true }, tokens: { range: MINDS_RANGES.recallTokens, whole: true } },
  notes: { show: { range: MINDS_RANGES.show, whole: true }, keep: { range: MINDS_RANGES.keep, whole: true } },
  commitments: { show: { range: MINDS_RANGES.show, whole: true } },
  salience: { halfLifeDays: { range: MINDS_RANGES.halfLifeDays, whole: false }, floor: { range: MINDS_RANGES.floor, whole: false } },
  consolidate: { enabled: "bool" },
};

/** Problems with `world.minds`: each one says what the engine plays instead. */
function configIssues(world: WorldDoc, registry: Registry | undefined): LintIssue[] {
  const raw: unknown = world.minds;
  if (raw === undefined) return [];
  const out: LintIssue[] = [];
  const err = (path: string, message: string): void => void out.push({ severity: "error", path, code: "minds.config", message });
  const warn = (path: string, message: string): void => void out.push({ severity: "warning", path, code: "minds.config", message });
  if (!isRecord(raw)) {
    err("minds", "The minds config is an object (secrecy, weights, thresholds, always, never, memory); the defaults play instead.");
    return out;
  }
  for (const key of Object.keys(raw)) if (!(WORLD_MINDS_KEYS as readonly string[]).includes(key)) warn(`minds.${key}`, `"${key}" isn't part of the minds config; nothing reads it.`);
  if (raw.secrecy !== undefined && raw.secrecy !== "full" && raw.secrecy !== "brief") err("minds.secrecy", 'Secrecy is "full" (the narrator gets each mind to depict) or "brief" (a leak-checked depiction only); "brief" plays instead.');
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
        } else number(`minds.memory.${part}.${key}`, v, field.range, field.whole);
      }
    }
  }
  return out;
}

/** Step templates for the minds purposes: their signals never decide anything, and only the first per purpose is used. */
function stepIssues(world: WorldDoc): LintIssue[] {
  const out: LintIssue[] = [];
  const first = new Map<string, string>();
  for (const id of Object.keys(world.steps).sort()) {
    const t = world.steps[id];
    if (!t || !isMindPurpose(t.purpose)) continue;
    if (t.signals.length > 0) out.push({ severity: "info", path: `steps.${id}.signals`, code: "minds.step_signals", message: `Minds run on their own cadence (Settings → Minds), so a ${t.purpose} template's signals are ignored.` });
    const earlier = first.get(t.purpose);
    if (earlier !== undefined) out.push({ severity: "warning", path: `steps.${id}`, code: "minds.step_duplicate", message: `The world has another ${t.purpose} template ("${earlier}"); only that one, the first by id, is used.` });
    else first.set(t.purpose, id);
  }
  return out;
}

export const MINDS_LINTS: readonly LintRule[] = [
  { code: "minds.config", check: (world, registry) => configIssues(world, registry) },
  { code: "minds.steps", check: (world) => stepIssues(world) },
];
