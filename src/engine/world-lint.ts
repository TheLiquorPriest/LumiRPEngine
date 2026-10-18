// Structural world lint (DESIGN §13): references, field types, cycles, unreachable track stages,
// tiers, classifications and selectors, relation kinds, cardinality and one-sided kinship,
// overlapping schedules, expressions that don't parse, unbalanced authored postings, predicates
// frozen at the world's current realism, and the ruleset primitives' own lint (engine/ruleset-lint).
// Pure; the authoring lint runs it with the registry (pack kinds, fields and relation types).

import type { JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { LintIssue } from "../shared/protocol";
import { DOMAINS } from "../shared/ids";
import { isBand, tierOf } from "../shared/tiers";
import type { EffectSpec, FieldDef, WorldDoc } from "../shared/world";
import { MAX_SPAWN_CAP, objectiveWhen } from "../shared/world";
import { compile } from "./expr";
import { frozenPredicates } from "./realism";
import { rulesetFloor, type Registry } from "./registry-impl";
import { relationIssues } from "./relations";
import { effectLists, lintRuleset } from "./ruleset-lint";
import { scheduleOverlaps } from "./schedules";
import { kindDef, kindFields } from "./scope";
import { classOf, classProblems, selectorProblems } from "./selector";
import { own } from "./pack-kit";
import { knownBySelector } from "./visibility";

function typeProblem(f: FieldDef, v: JsonValue, world: WorldDoc): string | null {
  if (v === null) return null;
  switch (f.type) {
    case "number":
    case "money":
      if (typeof v !== "number" || !Number.isFinite(v)) return "is not a number";
      if (f.min !== undefined && v < f.min) return `is below ${f.min}`;
      if (f.max !== undefined && v > f.max) return `is above ${f.max}`;
      return f.type === "money" && !Number.isInteger(v) ? "is not whole minor units" : null;
    case "text":
      return typeof v === "string" ? null : "is not text";
    case "bool":
      return typeof v === "boolean" ? null : "is not true or false";
    case "enum":
      return typeof v === "string" && (f.values ?? []).includes(v) ? null : `is not one of ${(f.values ?? []).join(", ")}`;
    case "ref":
      return typeof v === "string" && (own(world.entities, v) || own(world.places, v)) ? null : "names nothing in the world";
    case "list":
      return Array.isArray(v) || isRecord(v) ? null : "is not a list";
    default:
      return null;
  }
}

export function lintStructure(world: WorldDoc, reg: Registry): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (path: string, code: string, message: string): void => void issues.push({ severity: "error", path, code, message });
  const warn = (path: string, code: string, message: string): void => void issues.push({ severity: "warning", path, code, message });
  const known = (id: string): boolean => !!own(world.entities, id) || !!own(world.places, id);

  // References and field types.
  for (const [id, e] of Object.entries(world.entities)) {
    const fields = kindFields(reg, world, e.kind);
    for (const [name, v] of Object.entries(e.fields)) {
      const f = own(fields, name);
      const problem = f ? typeProblem(f, v, world) : null;
      if (problem) (f?.type === "ref" ? err : warn)(`entities.${id}.fields.${name}`, f?.type === "ref" ? "refs" : "types", `${e.name}'s ${f?.label ?? name} ${problem}.`);
    }
    for (const r of e.relations) if (!known(r.to)) err(`entities.${id}.relations`, "refs", `${e.name}'s ${r.type} relation names "${r.to}", which isn't in the world.`);
  }
  for (const [id, s] of Object.entries(world.schedules)) {
    const owner = s.owner;
    if (isRecord(owner)) for (const problem of selectorProblems(reg, world, owner)) err(`schedules.${id}.owner`, "refs", `Schedule ${id}'s owner selector ${problem}.`);
    else if (typeof owner === "string" && owner !== "" && !own(world.entities, owner) && !kindDef(reg, world, owner)) err(`schedules.${id}.owner`, "refs", `Schedule ${id} belongs to "${owner}", which is neither an entity, a group nor a kind.`);
    if (s.target !== "place") continue;
    for (const slot of s.slots) {
      const values = [slot.value, ...(slot.weighted ?? []).map((w) => w.value)];
      for (const v of values) if (typeof v === "string" && !own(world.places, v)) err(`schedules.${id}.slots`, "refs", `Schedule ${id} sends its owner to "${v}", which isn't a place.`);
    }
  }
  issues.push(...scheduleOverlaps(reg, world));
  for (const [id, a] of Object.entries(world.actions)) {
    for (const [name, p] of Object.entries(a.params)) {
      if (p.table !== undefined) {
        const at = `actions.${id}.params.${name}.table`;
        if (p.type !== "text") warn(at, "types", `${a.label}'s ${p.label ?? name} isn't a text parameter, so it never names a row of ${p.table}.`);
        else if (!own(world.tables, p.table)) err(at, "refs", `${a.label}'s ${p.label ?? name} names rows of the data table "${p.table}", which this world doesn't have.`);
      }
      if (p.of === undefined) continue;
      if (p.type !== "ref") warn(`actions.${id}.params.${name}.of`, "selector", `${a.label}'s ${p.label ?? name} isn't a ref parameter, so its selector never applies.`);
      for (const problem of selectorProblems(reg, world, p.of)) err(`actions.${id}.params.${name}.of`, "refs", `${a.label}'s ${p.label ?? name} selector ${problem}.`);
    }
  }
  for (const [id, k] of Object.entries(world.kinds)) {
    if (k.extends && !own(world.kinds, k.extends) && !reg.kinds.has(k.extends)) err(`kinds.${id}.extends`, "refs", `Kind ${id} extends an unknown kind "${k.extends}".`);
  }

  // Classifications (DESIGN §4.1): each value's parent is a value of the same facet, with no cycle;
  // entities hold known values, at most one of a single-valued facet.
  for (const [id, f] of Object.entries(isRecord(world.classifications) ? world.classifications : {})) {
    if (f.id !== id) err(`classifications.${id}.id`, "id_mismatch", "the id must match its key");
    const values = isRecord(f.values) ? f.values : {};
    for (const [vid, v] of Object.entries(values)) {
      const path = `classifications.${id}.values.${vid}.parent`;
      if (v.parent === undefined) continue;
      if (!hasOwn(values, v.parent)) {
        err(path, "refs", `${f.label}: "${v.label}" nests under "${v.parent}", which isn't one of its values.`);
        continue;
      }
      let cur: string | undefined = v.parent;
      for (let guard = 0; cur !== undefined && guard < 64; guard++) {
        if (cur === vid) {
          err(path, "cycles", `${f.label}: "${v.label}" nests under itself.`);
          break;
        }
        cur = own(values, cur)?.parent;
      }
    }
  }
  for (const [id, e] of Object.entries(world.entities)) for (const p of classProblems(world, e.class, e.name)) err(`entities.${id}.class`, p.code, p.message);

  // Relation types and authored relations: kinds, cardinality, and kinship authored on one side.
  issues.push(...relationIssues(reg, world));

  // Cycles: kinds that extend themselves, things inside themselves.
  for (const id of Object.keys(world.kinds)) {
    let cur = own(world.kinds, id)?.extends;
    for (let guard = 0; cur && guard < 64; guard++) {
      if (cur === id) {
        err(`kinds.${id}.extends`, "cycles", `Kind ${id} extends itself.`);
        break;
      }
      cur = own(world.kinds, cur)?.extends ?? reg.kinds.get(cur)?.extends;
    }
  }
  for (const [id, e] of Object.entries(world.entities)) {
    let cur = e.relations.find((r) => r.type === "in")?.to;
    for (let guard = 0; cur && guard < 64; guard++) {
      if (cur === id) {
        err(`entities.${id}.relations`, "cycles", `${e.name} is inside itself.`);
        break;
      }
      cur = own(world.entities, cur)?.relations.find((r) => r.type === "in")?.to;
    }
  }

  // Tiers (DESIGN §9.1): each maps to a band, and everything that names one names a tier the world has.
  for (const [id, t] of Object.entries(isRecord(world.tiers) ? world.tiers : {})) {
    const def: unknown = t;
    if (!isRecord(def) || !isBand(def.band)) err(`tiers.${id}.band`, "tier_band", `Tier ${id} needs a band: principal (Leads), supporting or background.`);
    else if (typeof def.label !== "string" || def.label.trim() === "") warn(`tiers.${id}.label`, "tier_label", `Tier ${id} has no label, so players see its id.`);
  }
  for (const [id, e] of Object.entries(world.entities)) {
    if (!tierOf(world, e.tier)) err(`entities.${id}.tier`, "unknown_tier", `${e.name}'s tier "${e.tier}" isn't one of the world's tiers.`);
  }
  if (world.spawnTier !== undefined && !tierOf(world, world.spawnTier)) err("spawnTier", "unknown_tier", `New people would join tier "${world.spawnTier}", which isn't one of the world's tiers.`);
  const cap: unknown = world.spawnCap;
  if (cap !== undefined && !(typeof cap === "number" && Number.isInteger(cap) && cap >= 0 && cap <= MAX_SPAWN_CAP)) err("spawnCap", "spawn_cap", `The number of people replies may introduce must be a whole number from 0 to ${MAX_SPAWN_CAP}.`);
  for (const { path, effects } of effectLists(world)) {
    effects.forEach((spec, i) => {
      if (spec.type !== "spawn") return;
      const tier = spec.args.tier;
      if (typeof tier === "string" && !tierOf(world, tier)) warn(`${path}.${i}`, "unknown_tier", `A spawn in ${path} names tier "${tier}", which isn't one of the world's tiers; it gets the spawn tier instead.`);
      // A value given as a formula is checked when the spawn runs.
      const raw: JsonValue | undefined = spec.args.class;
      if (raw === undefined || (isRecord(raw) && Object.values(raw).some((v) => typeof v === "string" && v.startsWith("=")))) return;
      const classes = classOf(raw);
      const who = `A spawn in ${path}`;
      const problems = classes ? classProblems(world, classes, who) : [{ code: "unknown_facet", message: `${who} gives a class that isn't a facet → values map.` }];
      for (const p of problems) warn(`${path}.${i}`, p.code, `${p.message} The spawn is refused.`);
    });
  }

  // Tracks: owners, stage targets, unreachable stages, predicates that don't parse.
  for (const [id, t] of Object.entries(world.tracks)) {
    if (t.owner && !own(world.entities, t.owner)) err(`tracks.${id}.owner`, "refs", `Track ${id} belongs to an unknown "${t.owner}".`);
    if (!own(t.stages, t.start)) err(`tracks.${id}.start`, "refs", `Track ${id} starts at an unknown stage "${t.start}".`);
    const reached = new Set<string>();
    const queue = [t.start];
    while (queue.length > 0) {
      const sid = queue.shift() ?? "";
      if (reached.has(sid) || !own(t.stages, sid)) continue;
      reached.add(sid);
      const s = own(t.stages, sid);
      for (const n of s?.next ?? []) {
        if (!own(t.stages, n.to)) err(`tracks.${id}.stages.${sid}.next`, "refs", `Stage ${sid} of ${t.label} leads to an unknown stage "${n.to}".`);
        queue.push(n.to);
      }
      if (s?.fail) queue.push(s.fail.to);
    }
    for (const sid of Object.keys(t.stages)) if (!reached.has(sid)) warn(`tracks.${id}.stages.${sid}`, "unreachable_stage", `Stage "${own(t.stages, sid)?.label ?? sid}" of ${t.label} can't be reached from its start.`);
    for (const [sid, s] of Object.entries(t.stages)) {
      const exprs = [...s.next.map((n) => n.when), ...(s.fail ? [s.fail.when] : []), ...(s.gate ? [s.gate] : []), ...(s.objectives ?? []).map(objectiveWhen)];
      for (const x of exprs) {
        try {
          compile(x);
        } catch (e) {
          err(`tracks.${id}.stages.${sid}`, "types", `A condition in ${t.label} doesn't parse: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  // Visibility (DESIGN §7): a value every reader understands (`discoverable` is for places), and a
  // `knownBy` only beside `known_by` or `discoverable`, as a selector this engine reads. Anything
  // else fails closed: the thing stays hidden, the grant grants nobody.
  const subjects: { path: string; what: string; visibility: unknown; knownBy: unknown; place: boolean }[] = [
    ...Object.entries(world.entities).map(([id, e]) => ({ path: `entities.${id}`, what: e.name, visibility: e.visibility, knownBy: e.knownBy, place: false })),
    ...Object.entries(world.places).map(([id, p]) => ({ path: `places.${id}`, what: p.name, visibility: p.visibility, knownBy: p.knownBy, place: true })),
    ...Object.entries(world.tracks).map(([id, t]) => ({ path: `tracks.${id}`, what: t.label, visibility: t.visibility, knownBy: t.knownBy, place: false })),
    ...Object.entries(world.kinds).flatMap(([kid, k]) => Object.entries(k.fields).map(([fid, f]) => ({ path: `kinds.${kid}.fields.${fid}`, what: `${k.label}'s ${f.label ?? fid}`, visibility: f.visibility, knownBy: f.knownBy, place: false }))),
  ];
  for (const s of subjects) {
    const understood = s.visibility === undefined || s.visibility === "public" || s.visibility === "known_by" || s.visibility === "secret" || (s.place && s.visibility === "discoverable");
    if (!understood) err(`${s.path}.visibility`, "visibility", `${s.what} has visibility "${String(s.visibility)}", which isn't ${s.place ? "public, known_by, discoverable or secret" : "public, known_by or secret (discoverable is for places)"}; it stays hidden from the player.`);
    if (s.knownBy === undefined) continue;
    if (s.visibility !== "known_by" && !(s.place && s.visibility === "discoverable")) warn(`${s.path}.knownBy`, "visibility", `${s.what} has a Known by, which only counts with ${s.place ? "known_by or discoverable" : "known_by"} visibility.`);
    const selector = knownBySelector(s.knownBy);
    if (!selector) {
      err(`${s.path}.knownBy`, "visibility", `${s.what}'s Known by names no constraint, or one this engine doesn't read, so it grants nobody.`);
      continue;
    }
    for (const id of [...(selector.ids ?? []), ...(selector.memberOf ?? [])]) if (!own(world.entities, id)) err(`${s.path}.knownBy`, "refs", `${s.what}'s Known by names "${id}", which isn't in the world.`);
  }

  // Authored postings must balance.
  for (const { path, effects } of effectLists(world)) {
    effects.forEach((spec, i) => {
      if (spec.type !== "post" || !Array.isArray(spec.args.lines)) return;
      const amounts = spec.args.lines.map((l) => (isRecord(l) && typeof l.amount === "number" ? l.amount : null));
      if (amounts.some((a) => a === null)) return;
      const sum = amounts.reduce((a: number, b) => a + (b ?? 0), 0);
      if (sum !== 0) err(`${path}.${i}`, "unbalanced_posting", `A posting in ${path} doesn't balance (it sums to ${sum}).`);
    });
  }

  // Predicates on fields the world's current realism freezes (after a demotion, or authored above
  // it); a ruleset's floor raises the level they play at.
  for (const domain of DOMAINS) {
    const level = rulesetFloor(world, domain, world.realism.levels[domain]);
    for (const p of frozenPredicates(reg, world, domain, level)) {
      warn(`${p.where}s.${p.id}`, "frozen_predicate", `A condition of ${p.where} ${p.id} reads ${p.field}, which ${domain} level ${level} doesn't track, so it never changes.`);
    }
  }
  issues.push(...lintRuleset(world, reg));
  return issues;
}
