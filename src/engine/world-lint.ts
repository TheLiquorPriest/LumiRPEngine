// Structural world lint (DESIGN §13): references, field types, cycles, unreachable track stages,
// tiers, classifications and selectors, relation kinds, cardinality and one-sided kinship,
// overlapping schedules, expressions that don't parse, unbalanced authored postings, predicates
// frozen at the world's current realism, player claims (its default policy and the params a claim
// may fill), the narrator's knowledge default, and the ruleset primitives' own lint (engine/ruleset-lint).
// Pure; the authoring lint runs it with the registry (pack kinds, fields and relation types).

import { CLAIM_MODE_LABEL, CLAIM_MODES, readClaims } from "../shared/claims";
import type { JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { LintIssue } from "../shared/lint";
import { narratorViewOf } from "../shared/narrator-view";
import { DOMAINS } from "../shared/ids";
import { isBand, tierOf } from "../shared/tiers";
import type { EffectSpec, FieldDef, KindDef, WorldDoc } from "../shared/world";
import { ALIVE, BUILTIN_LIFE_STATES, GM_OWNER, isLifeState, MAX_PLACE_CAP, MAX_SPAWN_CAP, objectiveWhen } from "../shared/world";
import { callsIn, compile } from "./expr";
import { frozenPredicates } from "./realism";
import { rulesetFloor, type Registry } from "./registry-impl";
import { relationIssues } from "./relations";
import { effectLists, lintRuleset } from "./ruleset-lint";
import { scheduleOverlaps } from "./schedules";
import { kindDef, kindFields, kindParent } from "./scope";
import { classOf, classProblems, selectorProblems } from "./selector";
import { own } from "./pack-kit";
import { knownBySelector } from "./visibility";
import { say } from "./lines";

/** What each literal argument of a track condition's lookups must name: `carries(holder, item)`, `at(entity, place)`, `knows(who, entity or place)`. */
const TRACK_REF_ARGS: Readonly<Record<string, readonly ("entity" | "place" | "either")[]>> = {
  carries: ["entity", "entity"],
  at: ["entity", "place"],
  knows: ["entity", "either"],
};

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

/**
 * A kind's fields as the world's own kinds give them: at each step its own definition, else the
 * pack's, up the Extends each names. What only a pack kind under a world kind of the same id brings
 * (DESIGN §4.1: that kind's fields, and the parent it keeps) is left out.
 */
function ownFields(reg: Registry, world: WorldDoc, kind: string): Record<string, FieldDef> {
  const chain: KindDef[] = [];
  for (let def = kindDef(reg, world, kind), guard = 0; def && guard < 32; def = def.extends ? kindDef(reg, world, def.extends) : undefined, guard++) chain.unshift(def);
  const out: Record<string, FieldDef> = {};
  for (const def of chain) Object.assign(out, def.fields);
  return out;
}

/** The first world kind up `kind`'s chain that lies over a pack kind of the same id, with that pack kind. */
function overlayOf(reg: Registry, world: WorldDoc, kind: string): { mine: KindDef; pack: KindDef } | null {
  for (let id: string | undefined = kind, guard = 0; id && guard < 32; id = kindParent(reg, world, id), guard++) {
    const mine = own(world.kinds, id);
    const pack = reg.kinds.get(id);
    if (mine && pack) return { mine, pack };
  }
  return null;
}

export function lintStructure(world: WorldDoc, reg: Registry): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (path: string, code: string, message: string): void => void issues.push({ severity: "error", path, code, message });
  const warn = (path: string, code: string, message: string): void => void issues.push({ severity: "warning", path, code, message });
  const known = (id: string): boolean => !!own(world.entities, id) || !!own(world.places, id);

  // References and field types, as the kind's fields type them. How firmly follows the world's own
  // kinds (`ownFields`): a value only a pack kind under a world kind of the same id types (DESIGN
  // §4.1) was the world's own words before that kind lay over the pack's, so a reference of it that
  // names nothing is told, and never refuses a commit or an import.
  const typed = new Map<string, { fields: Record<string, FieldDef>; mine: Record<string, FieldDef>; overlay: { mine: KindDef; pack: KindDef } | null }>();
  for (const [id, e] of Object.entries(world.entities)) {
    let kind = typed.get(e.kind);
    if (!kind) typed.set(e.kind, (kind = { fields: kindFields(reg, world, e.kind), mine: ownFields(reg, world, e.kind), overlay: overlayOf(reg, world, e.kind) }));
    for (const [name, v] of Object.entries(e.fields)) {
      const f = own(kind.fields, name);
      const problem = f ? typeProblem(f, v, world) : null;
      if (!f || problem === null) continue;
      const at = `entities.${id}.fields.${name}`;
      const mine = own(kind.mine, name);
      const mineProblem = mine === f ? problem : mine ? typeProblem(mine, v, world) : null;
      if (mine && mineProblem !== null) {
        (mine.type === "ref" ? err : warn)(at, mine.type === "ref" ? "refs" : "types", `${e.name}'s ${mine.label ?? name} ${mineProblem}.`);
        continue;
      }
      const label = f.label ?? name;
      const o = kind.overlay;
      const from = o ? `Your ${o.mine.label} kind doesn't define ${label}: it has it from the packs' ${o.pack.label}, which it lies over, so the value is read as theirs.` : `None of your kinds defines ${label}: it is a pack's field, read as theirs.`;
      warn(at, f.type === "ref" ? "refs" : "types", say("lint_name_s_label_problem_from_name_something", { name: e.name, label: label, problem: problem, from: from, mine: o ? o.mine.label : undefined, if_ref: f.type === "ref", if_o: !!(o) }));
    }
    for (const r of e.relations) if (!known(r.to)) err(`entities.${id}.relations`, "refs", say("lint_name_s_type_relation_names_r_which", { name: e.name, type: r.type, r: r.to }));
  }
  for (const [id, s] of Object.entries(world.schedules)) {
    const owner = s.owner;
    if (isRecord(owner)) for (const problem of selectorProblems(reg, world, owner)) err(`schedules.${id}.owner`, "refs", say("lint_schedule_id_s_owner_selector_problem", { id: id, problem: problem }));
    else if (typeof owner === "string" && owner !== "" && !own(world.entities, owner) && !kindDef(reg, world, owner)) err(`schedules.${id}.owner`, "refs", say("lint_schedule_id_belongs_to_owner_which_is", { id: id, owner: owner }));
    if (s.target !== "place") continue;
    for (const slot of s.slots) {
      const values = [slot.value, ...(slot.weighted ?? []).map((w) => w.value)];
      for (const v of values) if (typeof v === "string" && !own(world.places, v)) err(`schedules.${id}.slots`, "refs", say("lint_schedule_id_sends_its_owner_to_v", { id: id, v: v }));
    }
  }
  issues.push(...scheduleOverlaps(reg, world));
  for (const [id, a] of Object.entries(world.actions)) {
    for (const [name, p] of Object.entries(a.params)) {
      if (p.table !== undefined) {
        const at = `actions.${id}.params.${name}.table`;
        if (p.type !== "text") warn(at, "types", say("lint_label_s_name_isnt_a_text_parameter", { label: a.label, name: p.label ?? name, table: p.table }));
        else if (!own(world.tables, p.table)) err(at, "refs", say("lint_label_s_name_names_rows_of_the", { label: a.label, name: p.label ?? name, table: p.table }));
      }
      if (p.claim !== undefined) {
        // A place the engine doesn't read leaves the param one no claim ever fills (DESIGN §9.4).
        const place: unknown = p.claim;
        const at = `actions.${id}.params.${name}.claim`;
        if (place !== "held" && place !== "here") err(at, "claims", say("lint_label_s_name_says_a_claimed_thing", { label: a.label, name: p.label ?? name, place: String(place) }));
        else if (p.type !== "ref") warn(at, "claims", say("lint_label_s_name_isnt_a_ref_parameter", { label: a.label, name: p.label ?? name }));
      }
      // An outside account stands in for whom a ref param pays when it names nothing that fits (DESIGN §9.4 typed money); any other param never pays it.
      if (p.outside !== undefined && p.type !== "ref") warn(`actions.${id}.params.${name}.outside`, "outside", say("lint_label_s_name_isnt_a_ref_parameter_2", { label: a.label, name: p.label ?? name, outside: p.outside }));
      if (p.of === undefined) continue;
      if (p.type !== "ref") warn(`actions.${id}.params.${name}.of`, "selector", say("lint_label_s_name_isnt_a_ref_parameter_3", { label: a.label, name: p.label ?? name }));
      for (const problem of selectorProblems(reg, world, p.of)) err(`actions.${id}.params.${name}.of`, "refs", say("lint_label_s_name_selector_problem", { label: a.label, name: p.label ?? name, problem: problem }));
    }
  }
  for (const [id, k] of Object.entries(world.kinds)) {
    if (k.extends && !own(world.kinds, k.extends) && !reg.kinds.has(k.extends)) err(`kinds.${id}.extends`, "refs", say("lint_kind_id_extends_an_unknown_kind_extends", { id: id, extends: k.extends }));
    // A world kind with a pack kind's id lies over it (DESIGN §4.1), keeping the pack's fields and
    // parent. Only an Extends of its own that isn't the pack's cuts the pack's chain, losing what the
    // pack's parents give and the new chain doesn't; a kind that keeps the pack's parent loses only
    // what a kind above it cuts, and that kind is told.
    const pack = reg.kinds.get(id);
    if (!pack || k.extends === undefined || k.extends === pack.extends) continue;
    const packFields = new Map<string, FieldDef>();
    for (let cur: KindDef | undefined = pack, guard = 0; cur && guard < 32; cur = cur.extends ? reg.kinds.get(cur.extends) : undefined, guard++) {
      for (const [field, def] of Object.entries(cur.fields)) if (!packFields.has(field)) packFields.set(field, def);
    }
    const kept = kindFields(reg, world, id);
    const lost = [...packFields].filter(([field]) => !hasOwn(kept, field)).map(([field, def]) => def.label ?? field);
    if (lost.length > 0) warn(`kinds.${id}`, "kind_shadow", say("lint_kind_label_id_lies_over_the_pack", { label: k.label, id: id, pack: pack.pack, pack2: pack.label, extends: k.extends, extends2: pack.extends, lostCount: lost.length, lost: lost.slice(0, 6).join(", "), lost2: lost.length > 6 ? ", …" : "", if_extends: !!(pack.extends) }));
  }

  // Classifications (DESIGN §4.1): each value's parent is a value of the same facet, with no cycle;
  // entities hold known values, at most one of a single-valued facet.
  for (const [id, f] of Object.entries(isRecord(world.classifications) ? world.classifications : {})) {
    if (f.id !== id) err(`classifications.${id}.id`, "id_mismatch", say("lint_the_id_must_match_its_key"));
    const values = isRecord(f.values) ? f.values : {};
    for (const [vid, v] of Object.entries(values)) {
      const path = `classifications.${id}.values.${vid}.parent`;
      if (v.parent === undefined) continue;
      if (!hasOwn(values, v.parent)) {
        err(path, "refs", say("lint_f_label_nests_under_parent_which_isnt", { f: f.label, label: v.label, parent: v.parent }));
        continue;
      }
      let cur: string | undefined = v.parent;
      for (let guard = 0; cur !== undefined && guard < 64; guard++) {
        if (cur === vid) {
          err(path, "cycles", say("lint_f_label_nests_under_itself", { f: f.label, label: v.label }));
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
        err(`kinds.${id}.extends`, "cycles", say("lint_kind_id_extends_itself", { id: id }));
        break;
      }
      cur = own(world.kinds, cur)?.extends ?? reg.kinds.get(cur)?.extends;
    }
  }
  for (const [id, e] of Object.entries(world.entities)) {
    let cur = e.relations.find((r) => r.type === "in")?.to;
    for (let guard = 0; cur && guard < 64; guard++) {
      if (cur === id) {
        err(`entities.${id}.relations`, "cycles", say("lint_name_is_inside_itself", { name: e.name }));
        break;
      }
      cur = own(world.entities, cur)?.relations.find((r) => r.type === "in")?.to;
    }
  }

  // Tiers (DESIGN §9.1): each maps to a band, and everything that names one names a tier the world has.
  for (const [id, t] of Object.entries(isRecord(world.tiers) ? world.tiers : {})) {
    const def: unknown = t;
    if (!isRecord(def) || !isBand(def.band)) err(`tiers.${id}.band`, "tier_band", say("lint_tier_id_needs_a_band_principal_leads", { id: id }));
    else if (typeof def.label !== "string" || def.label.trim() === "") warn(`tiers.${id}.label`, "tier_label", say("lint_tier_id_has_no_label_so_players", { id: id }));
  }
  for (const [id, e] of Object.entries(world.entities)) {
    if (!tierOf(world, e.tier)) err(`entities.${id}.tier`, "unknown_tier", say("lint_name_s_tier_tier_isnt_one_of", { name: e.name, tier: e.tier }));
  }
  if (world.spawnTier !== undefined && !tierOf(world, world.spawnTier)) err("spawnTier", "unknown_tier", say("lint_new_people_would_join_tier_spawntier_which", { spawnTier: world.spawnTier }));
  const cap: unknown = world.spawnCap;
  if (cap !== undefined && !(typeof cap === "number" && Number.isInteger(cap) && cap >= 0 && cap <= MAX_SPAWN_CAP)) err("spawnCap", "spawn_cap", say("lint_the_number_of_people_replies_may_introduce", { mAX_SPAWN_CAP: MAX_SPAWN_CAP }));
  // Places made in play (ITEMS-SPEC §6.2, §11): per chat and per reply.
  for (const [key, what] of [["placeCap", "a chat"], ["placesPerTurn", "one reply"]] as const) {
    const v: unknown = world[key];
    if (v !== undefined && !(typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_PLACE_CAP)) err(key, "place_cap", say("lint_the_number_of_places_what_may_make", { what: what, mAX_PLACE_CAP: MAX_PLACE_CAP }));
  }
  // The narrator's knowledge in the world's chats (DESIGN §6.11): a whole view, or none at all.
  const narrator: unknown = world.narrator;
  if (narrator !== undefined && narratorViewOf(narrator) === null) err("narrator", "narrator", say("lint_the_narrators_knowledge_needs_both_parts_knowledge"));
  if (isRecord(narrator)) for (const key of Object.keys(narrator)) if (key !== "knowledge" && key !== "secrets") warn(`narrator.${key}`, "narrator_key", say("lint_the_narrators_knowledge_has_no_part_key", { key: key }));
  for (const { path, effects } of effectLists(world)) {
    effects.forEach((spec, i) => {
      if (spec.type !== "spawn") return;
      const tier = spec.args.tier;
      if (typeof tier === "string" && !tierOf(world, tier)) warn(`${path}.${i}`, "unknown_tier", say("lint_a_spawn_in_path_names_tier_tier", { path: path, tier: tier }));
      // A value given as a formula is checked when the spawn runs.
      const raw: JsonValue | undefined = spec.args.class;
      if (raw === undefined || (isRecord(raw) && Object.values(raw).some((v) => typeof v === "string" && v.startsWith("=")))) return;
      const classes = classOf(raw);
      const who = `A spawn in ${path}`;
      const problems = classes ? classProblems(world, classes, who) : [{ code: "unknown_facet", message: `${who} gives a class that isn't a facet → values map.` }];
      for (const p of problems) warn(`${path}.${i}`, p.code, say("lint_message_the_spawn_is_refused", { message: p.message }));
    });
  }

  // Life states (DESIGN §8): the world's own beside the built-ins, and each one an entity, the combat
  // rules or a `life` effect names.
  for (const [id, def] of Object.entries(isRecord(world.lifeStates) ? world.lifeStates : {})) {
    const raw: unknown = def;
    if (hasOwn(BUILTIN_LIFE_STATES, id)) err(`lifeStates.${id}`, "life_builtin", say("lint_id_is_a_built_in_life_state", { id: id }));
    else if (!isRecord(raw) || typeof raw.label !== "string" || raw.label.trim() === "") warn(`lifeStates.${id}.label`, "life_label", say("lint_life_state_id_has_no_label_so", { id: id }));
    else if (typeof raw.reads !== "string" || raw.reads.trim() === "") warn(`lifeStates.${id}.reads`, "life_reads", say("lint_life_state_id_doesnt_say_how_the", { id: id, raw: raw.label.toLowerCase() }));
  }
  for (const [id, e] of Object.entries(world.entities)) {
    if (e.life !== undefined && !isLifeState(world, e.life)) err(`entities.${id}.life`, "unknown_life", say("lint_name_starts_in_life_state_life_which", { name: e.name, life: e.life }));
    for (const knower of e.lifeKnownBy ?? []) if (!own(world.entities, knower)) err(`entities.${id}.lifeKnownBy`, "refs", say("lint_name_s_starting_life_state_is_known", { name: e.name, knower: knower }));
    if ((e.lifeKnownBy ?? []).length > 0 && (e.life ?? ALIVE) === ALIVE) warn(`entities.${id}.lifeKnownBy`, "life_known_by", say("lint_name_starts_alive_so_who_knows_how", { name: e.name }));
  }
  const downLife: unknown = world.ruleset?.combat?.down?.life;
  if (downLife !== undefined && (typeof downLife !== "string" || !isLifeState(world, downLife))) err("ruleset.combat.down.life", "unknown_life", say("lint_combats_down_rule_names_life_state_downlife", { downLife: String(downLife) }));
  for (const { path, effects } of effectLists(world)) {
    effects.forEach((spec, i) => {
      const to = spec.args.to;
      // A state given as a formula is checked when the effect runs.
      if (spec.type === "life" && typeof to === "string" && !to.startsWith("=") && !isLifeState(world, to)) warn(`${path}.${i}`, "unknown_life", say("lint_a_life_change_in_path_names_life", { path: path, to: to }));
    });
  }

  // Tracks: owners, stage targets, unreachable stages, predicates that don't parse.
  for (const [id, t] of Object.entries(world.tracks)) {
    if (t.owner && t.owner !== GM_OWNER && !own(world.entities, t.owner)) err(`tracks.${id}.owner`, "refs", say("lint_track_id_belongs_to_an_unknown_owner", { id: id, owner: t.owner }));
    if (!own(t.stages, t.start)) err(`tracks.${id}.start`, "refs", say("lint_track_id_starts_at_an_unknown_stage", { id: id, start: t.start }));
    const reached = new Set<string>();
    const queue = [t.start];
    while (queue.length > 0) {
      const sid = queue.shift() ?? "";
      if (reached.has(sid) || !own(t.stages, sid)) continue;
      reached.add(sid);
      const s = own(t.stages, sid);
      for (const n of s?.next ?? []) {
        if (!own(t.stages, n.to)) err(`tracks.${id}.stages.${sid}.next`, "refs", say("lint_stage_sid_of_t_leads_to_an", { sid: sid, t: t.label, n: n.to }));
        queue.push(n.to);
      }
      if (s?.fail) queue.push(s.fail.to);
    }
    for (const sid of Object.keys(t.stages)) if (!reached.has(sid)) warn(`tracks.${id}.stages.${sid}`, "unreachable_stage", say("lint_stage_sid_of_t_cant_be_reached", { sid: own(t.stages, sid)?.label ?? sid, t: t.label }));
    for (const [sid, s] of Object.entries(t.stages)) {
      const exprs = [...s.next.map((n) => n.when), ...(s.fail ? [s.fail.when] : []), ...(s.gate ? [s.gate] : []), ...(s.objectives ?? []).map(objectiveWhen)];
      for (const x of exprs) {
        try {
          compile(x);
        } catch (e) {
          err(`tracks.${id}.stages.${sid}`, "types", say("lint_a_condition_in_t_doesnt_parse_message", { t: t.label, message: e instanceof Error ? e.message : String(e) }));
          continue;
        }
        // A typo'd id in a condition never holds, so the stage silently never advances.
        for (const c of callsIn(x)) {
          const sorts = own(TRACK_REF_ARGS, c.name);
          if (!sorts) continue;
          c.args.forEach((v, i) => {
            const sort = sorts[i];
            if (typeof v !== "string" || !sort) return;
            const found = (sort !== "place" && own(world.entities, v) !== undefined) || (sort !== "entity" && own(world.places, v) !== undefined);
            if (!found) warn(`tracks.${id}.stages.${sid}`, "unknown_condition_ref", say("lint_a_condition_in_t_names_v_in", { t: t.label, v: v, name: c.name, if_place: sort === "place", if_entity: sort === "entity" }));
          });
        }
      }
    }
  }

  // Visibility (DESIGN §7): a value every reader understands (`discoverable` is for places), and a
  // `knownBy` only beside `known_by` or `discoverable`, as a selector this engine reads. Anything
  // else fails closed: the thing stays hidden, the grant grants nobody.
  // `findable`: `discoverable` is for places and entities (found once visited, or searched for), never tracks or fields.
  const subjects: { path: string; what: string; visibility: unknown; knownBy: unknown; findable: boolean }[] = [
    ...Object.entries(world.entities).map(([id, e]) => ({ path: `entities.${id}`, what: e.name, visibility: e.visibility, knownBy: e.knownBy, findable: true })),
    ...Object.entries(world.places).map(([id, p]) => ({ path: `places.${id}`, what: p.name, visibility: p.visibility, knownBy: p.knownBy, findable: true })),
    ...Object.entries(world.tracks).map(([id, t]) => ({ path: `tracks.${id}`, what: t.label, visibility: t.visibility, knownBy: t.knownBy, findable: false })),
    ...Object.entries(world.kinds).flatMap(([kid, k]) => Object.entries(k.fields).map(([fid, f]) => ({ path: `kinds.${kid}.fields.${fid}`, what: `${k.label}'s ${f.label ?? fid}`, visibility: f.visibility, knownBy: f.knownBy, findable: false }))),
  ];
  for (const s of subjects) {
    const understood = s.visibility === undefined || s.visibility === "public" || s.visibility === "known_by" || s.visibility === "secret" || (s.findable && s.visibility === "discoverable");
    if (!understood) err(`${s.path}.visibility`, "visibility", say("lint_what_has_visibility_visibility_which_isnt_public", { what: s.what, visibility: String(s.visibility), if_findable: !!(s.findable) }));
    if (s.knownBy === undefined) continue;
    if (s.visibility !== "known_by" && !(s.findable && s.visibility === "discoverable")) warn(`${s.path}.knownBy`, "visibility", say("lint_what_has_a_known_by_which_only", { what: s.what, if_findable: !!(s.findable) }));
    const selector = knownBySelector(s.knownBy);
    if (!selector) {
      err(`${s.path}.knownBy`, "visibility", say("lint_what_s_known_by_names_no_constraint", { what: s.what }));
      continue;
    }
    for (const id of [...(selector.ids ?? []), ...(selector.memberOf ?? [])]) if (!own(world.entities, id)) err(`${s.path}.knownBy`, "refs", say("lint_what_s_known_by_names_id_which", { what: s.what, id: id }));
  }

  // Authored postings must balance.
  for (const { path, effects } of effectLists(world)) {
    effects.forEach((spec, i) => {
      if (spec.type !== "post" || !Array.isArray(spec.args.lines)) return;
      const amounts = spec.args.lines.map((l) => (isRecord(l) && typeof l.amount === "number" ? l.amount : null));
      if (amounts.some((a) => a === null)) return;
      const sum = amounts.reduce((a: number, b) => a + (b ?? 0), 0);
      if (sum !== 0) err(`${path}.${i}`, "unbalanced_posting", say("lint_a_posting_in_path_doesnt_balance_it", { path: path, sum: sum }));
    });
  }

  // Predicates on fields the world's current realism freezes (after a demotion, or authored above
  // it); a ruleset's floor raises the level they play at.
  for (const domain of DOMAINS) {
    const level = rulesetFloor(world, domain, world.realism.levels[domain]);
    for (const p of frozenPredicates(reg, world, domain, level)) {
      warn(`${p.where}s.${p.id}`, "frozen_predicate", say("lint_a_condition_of_where_id_reads_field", { where: p.where, id: p.id, field: p.field, domain: domain, level: level }));
    }
  }

  // The world's player-claims default (DESIGN §9.4): one the engine can't read is no default, and
  // new chats quietly take the player's own setting instead.
  const claims: unknown = world.realism.claims;
  if (claims !== undefined && !readClaims(claims)) {
    const modes = CLAIM_MODES.map((m) => `${CLAIM_MODE_LABEL[m]} ("${m}")`);
    err("realism.claims", "claims", say("lint_player_claims_should_be_modes_or_modes2", { modes: modes.slice(0, -1).join(", "), modes2: modes.at(-1) ?? "" }));
  } else if (isRecord(claims) && claims.capped !== undefined && typeof claims.capped !== "boolean") {
    warn("realism.claims.capped", "claims", say("lint_player_claims_cap_should_be_true_or"));
  }
  issues.push(...lintRuleset(world, reg));
  return issues;
}
