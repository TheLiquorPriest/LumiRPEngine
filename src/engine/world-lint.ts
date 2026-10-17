// Structural world lint (DESIGN §13): references, field types, cycles, unreachable track stages,
// expressions that don't parse, unbalanced authored postings and predicates frozen at the world's
// current realism. Pure; the authoring lint runs it with the registry (pack kinds and fields).

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { LintIssue } from "../shared/protocol";
import { DOMAINS } from "../shared/ids";
import type { EffectSpec, FieldDef, WorldDoc } from "../shared/world";
import { objectiveWhen } from "../shared/world";
import { compile } from "./expr";
import { frozenPredicates } from "./realism";
import type { Registry } from "./registry-impl";
import { kindFields } from "./scope";
import { own } from "./pack-kit";

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

/** Every authored effect list in the world, with its path. */
function effectLists(world: WorldDoc): { path: string; effects: EffectSpec[] }[] {
  const out: { path: string; effects: EffectSpec[] }[] = [];
  for (const [id, a] of Object.entries(world.actions)) for (const [o, list] of Object.entries(a.outcomes)) out.push({ path: `actions.${id}.outcomes.${o}`, effects: list });
  for (const [id, r] of Object.entries(world.rules)) out.push({ path: `rules.${id}.do`, effects: r.do });
  for (const [id, t] of Object.entries(world.tracks)) {
    for (const [sid, s] of Object.entries(t.stages)) {
      if (s.effects) out.push({ path: `tracks.${id}.stages.${sid}.effects`, effects: s.effects });
      if (s.rewards) out.push({ path: `tracks.${id}.stages.${sid}.rewards`, effects: s.rewards });
    }
  }
  return out;
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
    if (s.owner && !own(world.entities, s.owner) && !own(world.kinds, s.owner) && !reg.kinds.has(s.owner)) err(`schedules.${id}.owner`, "refs", `Schedule ${id} belongs to "${s.owner}", which is neither a person nor a kind.`);
    if (s.target !== "place") continue;
    for (const slot of s.slots) {
      const values = [slot.value, ...(slot.weighted ?? []).map((w) => w.value)];
      for (const v of values) if (typeof v === "string" && !own(world.places, v)) err(`schedules.${id}.slots`, "refs", `Schedule ${id} sends its owner to "${v}", which isn't a place.`);
    }
  }
  for (const [id, k] of Object.entries(world.kinds)) {
    if (k.extends && !own(world.kinds, k.extends) && !reg.kinds.has(k.extends)) err(`kinds.${id}.extends`, "refs", `Kind ${id} extends an unknown kind "${k.extends}".`);
  }

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

  // Predicates on fields the world's current realism freezes (after a demotion, or authored above it).
  for (const domain of DOMAINS) {
    for (const p of frozenPredicates(reg, world, domain, world.realism.levels[domain])) {
      warn(`${p.where}s.${p.id}`, "frozen_predicate", `A condition of ${p.where} ${p.id} reads ${p.field}, which ${domain} level ${world.realism.levels[domain]} doesn't track, so it never changes.`);
    }
  }
  return issues;
}
