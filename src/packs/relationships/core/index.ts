// Relationships pack (DESIGN §9.3): per-pair multi-axis regard, appraisal rules,
// bands that feed the planner and the narrator's voice, history and group regard; groups
// (factions, families, households, companies) with membership; and kinship.
//
// Representation (uniform at every level): a directed `regard` relation from A to B whose fields
// hold one value per axis (world config `axes`, default warmth / trust / respect, −100…100), `t`
// (when it last changed) and `history` (the latest changes). Regard is an accumulator: the
// `relationships.regard` event carries deltas.
//
// Groups are entities of kind `group` or a kind extending it; `member_of` (with the member's role,
// rank and since) joins one, and groups may be members of larger groups. Kinship is `parent_of` /
// `child_of` (each other's inverse) and the symmetric `sibling_of`, `spouse_of` and `partner_of`:
// the engine keeps both sides (`engine/relations.ts`).
//
// Level contract (domain `relationships`, read at the regarding party):
//   0  off: appraisals are no-ops
//   1  one band per pair (axes move together: an appraisal's mean delta)
//   2  one number per pair (the axes' mean)
//   3  multiple axes plus appraisal rules
//   4  history, group regard

import { listOf, say } from "../../../shared/lines";
import type { JsonObject } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import type { BandDef, KindDef, RelationTypeDef } from "../../../shared/world";
import { numOf, objOf, strOf, own } from "../../../engine/pack-kit";
import type { EventTypeDef, PackDef, ReadContext, Rejection } from "../../../engine/registry";
import { bandOf } from "../../../engine/scope";
import { GROUP_KIND, linkRows, MEMBER_OF, membersOf } from "../../../engine/selector";
import type { WorldState } from "../../../engine/state";
import { CONVERSATION, STATED_MINUTES } from "../../../shared/needs";
import { possessive } from "../../../shared/words";

export interface Axis {
  id: string;
  label: string;
  min: number;
  max: number;
}

export const DEFAULT_AXES: readonly Axis[] = [
  { id: "warmth", label: "Warmth", min: -100, max: 100 },
  { id: "trust", label: "Trust", min: -100, max: 100 },
  { id: "respect", label: "Respect", min: -100, max: 100 },
];

export const DEFAULT_BANDS: readonly BandDef[] = [
  { label: "hostile", max: -60 },
  { label: "cold", min: -60, max: -20 },
  { label: "neutral", min: -20, max: 20 },
  { label: "warm", min: 20, max: 60 },
  { label: "devoted", min: 60 },
];

/** Built-in appraisals: axis deltas per kind of event; worlds add or override them in `config.appraisals`. */
export const APPRAISALS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  greeting: { warmth: 1 },
  conversation: { warmth: 2, trust: 1 },
  encounter: { warmth: 1 },
  gift: { warmth: 8, trust: 3 },
  help: { warmth: 5, trust: 5, respect: 3 },
  praise: { warmth: 3, respect: 5 },
  promise_kept: { trust: 8, respect: 2 },
  promise_broken: { trust: -12, respect: -4 },
  insult: { warmth: -10, respect: -5 },
  argument: { warmth: -6, trust: -2 },
  betrayal: { warmth: -10, trust: -25, respect: -5 },
  threat: { warmth: -8, trust: -10, fear: 10 },
};

const HISTORY = 8;
/** A chat's time: the stated length, else a quarter of an hour. */
const CHAT_FOR = "minutes > 0 ? minutes : 15";

export type AppraiseService = (ctx: ReadContext, from: EntityId, to: EntityId, appraisal: string | Record<string, number>, why?: string, mutual?: boolean) => LedgerEvent[];

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** Regard change from an appraisal, at the regarding party's level (no-op at 0). */
    "relationship.appraise": AppraiseService;
  }
  interface QueryMap {
    /** Current regard as last recorded: one axis, or the axes' mean. */
    regard: (ctx: ReadContext, from: EntityId, to: EntityId, axis?: string) => number;
    regard_band: (ctx: ReadContext, from: EntityId, to: EntityId) => string;
    /** A group's regard toward someone (any group, factions included): its own regard relation, else its members' mean. */
    "relationships.faction_regard": (ctx: ReadContext, group: EntityId, to: EntityId) => number;
    /** Regard for panels at the regarding party's level: one band (1), one value (2), each axis (3+). */
    "relationships.view": (ctx: ReadContext, from: EntityId, to: EntityId) => { axis: string; band: string; value?: number }[];
    /** Regard in the world's band words alone, for the narrator's Stance (`regardWords`); null without regard. */
    "relationships.words": (ctx: ReadContext, from: EntityId, to: EntityId) => string | null;
    /** The voice line for someone in the POV's scene, as the narrator's People section tells it (`voiceLine`); null without regard. */
    "relationships.voice": (ctx: ReadContext, who: EntityId) => string | null;
    /** What a world's half-life halves of regard within a span, as a read: it changes nothing. A world with no half-life has none. */
    "relationships.fading": (ctx: ReadContext, span: { from: number; to: number }) => Fading[];
  }
}

function config(ctx: Pick<ReadContext, "world">): JsonObject {
  return ctx.world.packs.relationships?.config ?? {};
}

export function axesOf(ctx: Pick<ReadContext, "world">): Axis[] {
  const raw = config(ctx).axes;
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_AXES];
  return raw.map((a) => objOf(a)).filter((a) => typeof a.id === "string").map((a) => ({ id: strOf(a.id), label: strOf(a.label, strOf(a.id)), min: numOf(a.min, -100), max: numOf(a.max, 100) }));
}

export function bandsOf(ctx: Pick<ReadContext, "world">): BandDef[] {
  const raw = config(ctx).bands;
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_BANDS];
  return raw.map((b) => objOf(b)).map((b) => ({ label: strOf(b.label), ...(typeof b.min === "number" ? { min: b.min } : {}), ...(typeof b.max === "number" ? { max: b.max } : {}) }));
}

/** The half-life, in minutes, a world's relationships config gives its regard (`halfLifeDays`), or null where it sets none: code holds none of its own. */
function halfLife(ctx: Pick<ReadContext, "world">): number | null {
  const days = config(ctx).halfLifeDays;
  return typeof days === "number" && Number.isFinite(days) && days > 0 ? Math.max(1, days * 1440) : null;
}

function relationOf(state: Readonly<WorldState>, from: EntityId, to: EntityId): JsonObject | null {
  const r = own(state.entities, from)?.relations.find((x) => x.type === "regard" && x.to === to);
  return r ? (r.fields ?? {}) : null;
}

/** Every axis's value from A toward B as it was last recorded: nothing fades by itself as time passes. */
export function regardAxes(ctx: ReadContext, from: EntityId, to: EntityId): Record<string, number> {
  const f = relationOf(ctx.state, from, to) ?? {};
  const out: Record<string, number> = {};
  for (const a of axesOf(ctx)) out[a.id] = Math.round(numOf(f[a.id]) * 10) / 10;
  return out;
}

export function regardValue(ctx: ReadContext, from: EntityId, to: EntityId, axis?: string): number {
  const axes = regardAxes(ctx, from, to);
  if (axis) return own(axes, axis) ?? 0;
  const values = Object.values(axes);
  return values.length === 0 ? 0 : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export function regardBand(ctx: ReadContext, from: EntityId, to: EntityId): string {
  return bandOf(bandsOf(ctx), regardValue(ctx, from, to))?.label ?? "neutral";
}

function deltasFor(ctx: ReadContext, appraisal: string | Record<string, number>): Record<string, number> {
  if (typeof appraisal !== "string") return appraisal;
  const custom = objOf(own(objOf(config(ctx).appraisals), appraisal));
  if (Object.keys(custom).length > 0) return Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, numOf(v)]));
  return { ...(own(APPRAISALS, appraisal) ?? {}) };
}

const appraise: AppraiseService = (ctx, from, to, appraisal, why, mutual) => appraiseWith(ctx, from, to, appraisal, why, mutual, false);

/**
 * A regard change as an event. As given (`given`), it is recorded at any realism level and between someone and themself, on the axes
 * it names and never spread as a mean over every axis, and it is kept past an axis's range; the event carries the mark, so a record
 * made without it folds as it always did, spread and clamped.
 */
function appraiseWith(ctx: ReadContext, from: EntityId, to: EntityId, appraisal: string | Record<string, number>, why: string | undefined, mutual: boolean | undefined, given: boolean): LedgerEvent[] {
  if (!own(ctx.state.entities, from) || !own(ctx.state.entities, to) || (from === to && !given)) return [];
  const level = ctx.levelOf(from, "relationships");
  if (level === 0 && !given) return [];
  const axes = axesOf(ctx).map((a) => a.id);
  const raw = deltasFor(ctx, appraisal);
  const known = Object.entries(raw).filter(([k, v]) => axes.includes(k) && v !== 0);
  if (known.length === 0) return [];
  let deltas: JsonObject;
  if (level >= 3 || given) deltas = Object.fromEntries(known);
  else {
    // Below level 3 the pair has one value: every axis moves by the appraisal's mean.
    const mean = Math.round((known.reduce((a, [, v]) => a + v, 0) / axes.length) * 10) / 10;
    deltas = Object.fromEntries(axes.map((a) => [a, mean]));
  }
  // Each change also carries its result, the pair's anchor `{axis values, t}`: a record keeps only the last anchor per NPC↔NPC pair (period close).
  const npc = from !== ctx.world.pov && to !== ctx.world.pov;
  const anchor = anchorAfter(ctx, from, to, deltas, ctx.state.clock, given);
  const back = mutual ? anchorAfter(ctx, to, from, deltas, ctx.state.clock, given) : null;
  const sameBack = back !== null && JSON.stringify(back) === JSON.stringify(anchor);
  return [{ type: "relationships.regard", data: { from, to, deltas, why: why ?? (typeof appraisal === "string" ? appraisal : "change"), ...(mutual ? { mutual: true } : {}), ...(npc ? { npc: true } : {}), ...(given ? { asGiven: true } : {}), anchor, ...(back && !sameBack ? { back } : {}) } }];
}

/** A pair's axis values and `t` after `deltas` at `at`: what is recorded, plus the deltas, each kept inside its axis unless the change is as given. */
function anchorAfter(ctx: ReadContext, from: EntityId, to: EntityId, deltas: JsonObject, at: number, given: boolean): JsonObject {
  const current = regardAxes(ctx, from, to);
  const out: JsonObject = {};
  for (const a of axesOf(ctx)) {
    const value = Math.round(((current[a.id] ?? 0) + numOf(deltas[a.id])) * 10) / 10;
    out[a.id] = given ? value : Math.max(a.min, Math.min(a.max, value));
  }
  out.t = at;
  return out;
}

/** Writes A's regard toward B: the anchor's values and `t`, plus a history entry for regard involving the POV. */
function writeRegard(state: WorldState, from: EntityId, to: EntityId, anchor: JsonObject, entry: JsonObject | null): void {
  const entity = own(state.entities, from);
  if (!entity) return;
  const prev = relationOf(state, from, to) ?? {};
  const fields: JsonObject = { ...prev, ...anchor };
  if (entry) fields.history = [...(Array.isArray(prev.history) ? prev.history.slice(-(HISTORY - 1)) : []), entry];
  entity.relations = entity.relations.filter((r) => !(r.type === "regard" && r.to === to));
  entity.relations.push({ type: "regard", to, fields });
}

const regardEvent: EventTypeDef<PackEvent> = {
  type: "relationships.regard",
  validate: (e, ctx) => {
    const from = strOf(e.data.from);
    const to = strOf(e.data.to);
    if (!own(ctx.state.entities, from) || !own(ctx.state.entities, to)) return { code: "missing_entity", reason: say("why_regard_needs_two_entities") };
    const numbers = [...Object.values(objOf(e.data.deltas)), ...Object.values(objOf(e.data.anchor))];
    if (e.data.deltas === undefined && e.data.anchor === undefined) return { code: "bad_delta", reason: say("why_regard_needs_deltas_or_an_anchor") };
    return numbers.every((v) => typeof v === "number" && Number.isFinite(v)) ? null : { code: "bad_delta", reason: say("why_regard_values_must_be_numbers") };
  },
  // What was kept as the story gave it and lies past its axis's range: kept all the same, and said.
  advise: (e, ctx) => {
    if (e.data.asGiven !== true || e.data.deltas === undefined) return null;
    const from = strOf(e.data.from);
    const to = strOf(e.data.to);
    const after = anchorAfter(ctx, from, to, objOf(e.data.deltas), ctx.state.clock, true);
    const past = axesOf(ctx).find((a) => numOf(after[a.id]) < a.min || numOf(after[a.id]) > a.max);
    return past ? { code: "off_the_scale", values: { who: own(ctx.state.entities, from)?.name ?? from, toward: own(ctx.state.entities, to)?.name ?? to, axis: past.label, value: numOf(after[past.id]), least: past.min, most: past.max } } : null;
  },
  apply: (e, state, ctx) => {
    const from = strOf(e.data.from);
    const to = strOf(e.data.to);
    const mutual = e.data.mutual === true;
    if (e.data.deltas !== undefined) {
      // A change: applied to the pair as it is now (rebases like any accumulator, L21).
      const rctx: ReadContext = { ...ctx, state };
      const deltas = objOf(e.data.deltas);
      const entry = e.data.npc === true ? null : { at: state.clock, why: strOf(e.data.why), deltas };
      const fwd = anchorAfter(rctx, from, to, deltas, state.clock, e.data.asGiven === true);
      const rev = mutual ? anchorAfter(rctx, to, from, deltas, state.clock, e.data.asGiven === true) : null;
      writeRegard(state, from, to, fwd, entry);
      if (rev) writeRegard(state, to, from, rev, entry);
      return;
    }
    // A period-close anchor from a coarsened record.
    const anchor = objOf(e.data.anchor);
    writeRegard(state, from, to, anchor, null);
    if (mutual) writeRegard(state, to, from, e.data.back === undefined ? anchor : objOf(e.data.back), null);
  },
  touches: (e) => {
    const from = strOf(e.data.from);
    const to = strOf(e.data.to);
    return e.data.mutual === true ? [{ entity: from, rel: "regard", to }, { entity: to, rel: "regard", to: from }] : [{ entity: from, rel: "regard", to }];
  },
  // NPC↔NPC regard in a record: the last anchor per pair stands for the period.
  coarsen: {
    key: (e) => (e.data.npc === true ? (e.data.mutual === true ? `m:${[strOf(e.data.from), strOf(e.data.to)].sort().join("|")}` : `d:${strOf(e.data.from)}>${strOf(e.data.to)}`) : null),
    merge: (_a, b) => ({ ...b, data: { from: b.data.from ?? null, to: b.data.to ?? null, ...(b.data.mutual === true ? { mutual: true } : {}), npc: true, anchor: b.data.anchor ?? {}, ...(b.data.back !== undefined ? { back: b.data.back } : {}) } }),
  },
  describe: (e, ctx) => {
    const pov = ctx.world.pov;
    const name = (id: string, subject: boolean): string => (id === pov ? (subject ? "You" : "you") : (own(ctx.state.entities, id)?.name ?? id));
    const from = name(strOf(e.data.from), true);
    const to = name(strOf(e.data.to), false);
    // One axis: "Danny Okafor's trust toward you rose by 8"; several: "Maya Chen's regard for Jordan Price
    // changed: warmth rose by 5 and trust fell by 2".
    const parts = Object.entries(objOf(e.data.deltas))
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] !== 0)
      .map(([axis, d]) => ({ axis: (axesOf(ctx).find((a) => a.id === axis)?.label ?? axis.replace(/_/g, " ")).toLowerCase(), moved: say(d > 0 ? "regard_rose" : "regard_fell", { by: Math.round(Math.abs(d) * 10) / 10 }) }));
    const [only] = parts;
    if (parts.length === 1 && only) return say("regard_axis", { whose: possessive(from), axis: only.axis, to, moved: only.moved });
    return parts.length > 0 ? say("regard_changed", { whose: possessive(from), to, parts: listOf(parts.map((p) => `${p.axis} ${p.moved}`)) }) : say("regard_settles", { whose: possessive(from), to });
  },
};

/** The pack's own groups (the base `group` kind is the space pack's). `faction` keeps its id, so worlds written before groups keep working. */
export const GROUP_KINDS: readonly KindDef[] = [
  { id: "faction", label: "Faction", extends: GROUP_KIND, pack: "relationships", fields: {} },
  { id: "family", label: "Family", extends: GROUP_KIND, pack: "relationships", fields: {} },
  { id: "household", label: "Household", extends: GROUP_KIND, pack: "relationships", fields: {} },
  { id: "company", label: "Company", extends: GROUP_KIND, pack: "relationships", fields: {} },
];

/** Kinship between people: an inverse pair and three symmetric bonds, all many-to-many. */
export const KINSHIP: readonly RelationTypeDef[] = [
  { id: "parent_of", label: "Parent of", from: "person", to: "person", cardinality: "many_many", symmetric: false, inverse: "child_of", fields: {}, pack: "relationships" },
  { id: "child_of", label: "Child of", from: "person", to: "person", cardinality: "many_many", symmetric: false, inverse: "parent_of", fields: {}, pack: "relationships" },
  { id: "sibling_of", label: "Sibling of", from: "person", to: "person", cardinality: "many_many", symmetric: true, fields: {}, pack: "relationships" },
  { id: "spouse_of", label: "Spouse of", from: "person", to: "person", cardinality: "many_many", symmetric: true, fields: { since: { type: "date", label: "Since" } }, pack: "relationships" },
  { id: "partner_of", label: "Partner of", from: "person", to: "person", cardinality: "many_many", symmetric: true, fields: { since: { type: "date", label: "Since" } }, pack: "relationships" },
];

/**
 * Group regard (level 4 in spirit; read at any level): the group's own regard relation toward `to`
 * when it has one, else the mean of its members' regard, every member that isn't a group itself,
 * directly or through member groups. The `faction_regard` formula and query read it for any group.
 */
function groupRegard(ctx: ReadContext, group: EntityId, to: EntityId): number {
  if (relationOf(ctx.state, group, to)) return regardValue(ctx, group, to);
  const members = membersOf(ctx.registry, ctx.world, ctx.state, group);
  if (members.length === 0) return 0;
  return Math.round((members.reduce((a, m) => a + regardValue(ctx, m, to), 0) / members.length) * 10) / 10;
}

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/**
 * The voice line for one person in the POV's scene: how they feel toward the POV in the world's band
 * words, never numbers the narrator can't read (`regardWords`: from level 3, each axis apart from the band).
 */
export function voiceLine(ctx: ReadContext, who: EntityId): string | null {
  const words = regardWords(ctx, who, ctx.world.pov);
  if (words === null) return null;
  return say("feed_who_is_words_toward_you", { who: own(ctx.state.entities, who)?.name ?? who, words: words });
}

/**
 * A's regard toward B in the world's band words, never numbers (the Stance section, DESIGN §6.6):
 * the overall band and, from level 3, each axis whose band differs from it ("warm (trust: cold)"),
 * so axes that agree cost nothing. Null at level 0 or without a regard relation.
 */
export function regardWords(ctx: ReadContext, from: EntityId, to: EntityId): string | null {
  const level = ctx.levelOf(from, "relationships");
  if (level === 0 || !relationOf(ctx.state, from, to)) return null;
  const band = regardBand(ctx, from, to);
  if (level <= 2) return band;
  const axes = regardAxes(ctx, from, to);
  const bands = bandsOf(ctx);
  const apart = axesOf(ctx).flatMap((a) => {
    const word = bandOf(bands, axes[a.id] ?? 0)?.label ?? "neutral";
    return word === band ? [] : [`${a.label.toLowerCase()}: ${word}`];
  });
  return apart.length > 0 ? `${band} (${apart.join(", ")})` : band;
}

export const relationshipsPack: PackDef = {
  id: "relationships",
  label: "Relationships",
  version: 1,
  domain: "relationships",
  requires: ["space"],
  register(r) {
    for (const kind of GROUP_KINDS) r.kind(kind);
    r.relation({ id: "regard", label: "Regard", from: "*", to: "*", cardinality: "many_many", symmetric: false, fields: Object.fromEntries(DEFAULT_AXES.map((a) => [a.id, { type: "number", min: a.min, max: a.max, domain: "relationships", level: 1 }])), pack: "relationships" });
    // `role` is the member's own title (ORG-SPEC §3.3); `position` one its group defines.
    r.relation({ id: MEMBER_OF, label: "Member of", from: "*", to: GROUP_KIND, cardinality: "many_many", symmetric: false, fields: { role: { type: "text", label: "Title" }, position: { type: "text", label: "Position" }, rank: { type: "number", label: "Rank" }, since: { type: "date", label: "Since" } }, pack: "relationships" });
    // Every group's members by `member_of`, nested through member groups (ORG-SPEC §3.2).
    r.membership(GROUP_KIND, linkRows);
    r.relation({ id: "knows", label: "Knows", from: "*", to: "*", cardinality: "many_many", symmetric: false, fields: {}, pack: "relationships" });
    for (const kin of KINSHIP) r.relation(kin);
    r.event(regardEvent);
    r.service("relationship.appraise", appraise);
    r.query("regard", regardValue);
    r.query("regard_band", regardBand);
    r.query("relationships.faction_regard", groupRegard);
    r.query("relationships.view", regardView);
    r.query("relationships.words", regardWords);
    // People tells each person's regard after their own line, once it has named the POV first: Cast life reads it there.
    r.query("relationships.voice", voiceLine);
    r.query("relationships.fading", fadingIn);
    r.formula("regard", (ctx, from, to, axis) => regardValue(ctx, String(from ?? ""), String(to ?? ""), typeof axis === "string" && axis !== "" ? axis : undefined));
    r.formula("regard_band", (ctx, from, to) => regardBand(ctx, String(from ?? ""), String(to ?? "")));
    // Group regard, under the name worlds already use.
    r.formula("faction_regard", (ctx, group, to) => groupRegard(ctx, String(group ?? ""), String(to ?? "")));

    r.effect({ type: "relationships.appraise", args: ["from", "to", "appraisal", "why?", "mutual?"], resolve: (a, ctx) => [...appraise(ctx, strOf(a.from), strOf(a.to), typeof a.appraisal === "string" ? a.appraisal : (objOf(a.appraisal) as Record<string, number>), strOf(a.why) || undefined), ...(a.mutual === true ? appraise(ctx, strOf(a.to), strOf(a.from), typeof a.appraisal === "string" ? a.appraisal : (objOf(a.appraisal) as Record<string, number>), strOf(a.why) || undefined) : [])] });
    r.effect({
      type: "relationships.adjust",
      args: ["from", "to", "delta", "axis?", "why?", "asGiven?"],
      resolve(a, ctx) {
        const from = strOf(a.from);
        const to = strOf(a.to);
        if (!own(ctx.state.entities, from) || !own(ctx.state.entities, to)) return reject("missing_entity", say("why_regard_needs_two_entities"));
        const delta = numOf(a.delta);
        const axis = strOf(a.axis);
        // As given: the change is kept on the axis named (else every axis by it), whatever the level, between anyone and themself, never spread and never clamped; past the range it is advised.
        const given = a.asGiven === true;
        if (given && axis !== "" && !axesOf(ctx).some((x) => x.id === axis)) return { ...reject("bad_axis", say("why_no_regard_axis_axis", { axis: axis })), said: axis, choices: axesOf(ctx).map((x) => x.id) };
        return appraiseWith(ctx, from, to, axis ? { [axis]: delta } : Object.fromEntries(axesOf(ctx).map((x) => [x.id, delta])), strOf(a.why, "change"), undefined, given);
      },
    });

    // A stated length ("talk for two hours", `minutes`) is the chat's time, a quarter of an hour without
    // one, and the speaker's activity for that span. Relationships needs nothing more: Cast life,
    // when a world has it, meets the speaker's social need from the conversation's regard as the chat ends.
    r.action({ id: "chat_with", pack: "relationships", params: { target: { type: "ref", ref: "person" }, minutes: STATED_MINUTES }, requires: ["at(target, here)"], outcomes: { default: [{ type: "relationships.appraise", args: { from: "target", to: "self", appraisal: CONVERSATION, mutual: true } }] }, duration: CHAT_FOR, activity: { type: "chat", until: `clock + (${CHAT_FOR})` }, lexicon: ["chat with", "talk to", "catch up with"], observable: "chats" });
    r.action({ id: "give_gift", pack: "relationships", params: { target: { type: "ref", ref: "person" } }, requires: ["at(target, here)"], outcomes: { default: [{ type: "relationships.appraise", args: { from: "target", to: "self", appraisal: "gift" } }] }, duration: "5", lexicon: ["give a gift", "surprise"], observable: "gives a gift" });

    r.proposal({
      type: "regard",
      boundField: "number",
      validate(p, ctx) {
        if (!own(ctx.state.entities, strOf(p.from)) || !own(ctx.state.entities, strOf(p.to))) return reject("missing_entity", say("why_regard_needs_two_known_people"));
        if (typeof p.delta !== "number" || p.delta === 0) return reject("bad_delta", say("why_regard_needs_a_non_zero_delta"));
        if (typeof p.axis === "string" && !axesOf(ctx).some((a) => a.id === p.axis)) return reject("bad_axis", say("why_no_regard_axis_axis", { axis: p.axis }));
        return null;
      },
      // As far as the story says; each axis stays inside its range (`appraise`).
      toEffects: (p) => [{ type: "relationships.adjust", args: { from: strOf(p.from), to: strOf(p.to), ...(typeof p.axis === "string" ? { axis: p.axis } : {}), delta: numOf(p.delta), why: strOf(p.why, "narrated") } }],
    });

    r.lint({
      code: "relationships.axes",
      check(world) {
        const axes = axesOf({ world }).map((a) => a.id);
        const issues = [];
        for (const e of Object.values(world.entities)) {
          for (const rel of e.relations) {
            if (rel.type !== "regard") continue;
            for (const k of Object.keys(rel.fields ?? {})) if (k !== "t" && k !== "history" && !axes.includes(k)) issues.push({ severity: "warning" as const, code: "relationships.axes", message: say("lint_name_s_regard_toward_rel_names_an", { name: e.name, rel: rel.to, k: k }), path: `entities.${e.id}.relations` });
          }
        }
        return issues;
      },
    });
  },
};

export default relationshipsPack;

/** Regard as JSON for panels (castlife.cast). */
export function regardView(ctx: ReadContext, from: EntityId, to: EntityId): { axis: string; band: string; value?: number }[] {
  const level = ctx.levelOf(from, "relationships");
  if (level === 0 || !relationOf(ctx.state, from, to)) return [];
  const band = regardBand(ctx, from, to);
  if (level === 1) return [{ axis: "overall", band }];
  if (level === 2) return [{ axis: "overall", band, value: regardValue(ctx, from, to) }];
  const axes = regardAxes(ctx, from, to);
  const bands = bandsOf(ctx);
  return axesOf(ctx).map((a) => ({ axis: a.label, band: bandOf(bands, axes[a.id] ?? 0)?.label ?? "neutral", value: axes[a.id] ?? 0 }));
}

/** One half-life of a pair's regard that ends within a span: the value last recorded, when it was, the moment the half-life ends and the value that is then half as many times over. */
export interface Fading {
  from: EntityId;
  to: EntityId;
  axis: string;
  value: number;
  since: number;
  at: number;
  halved: number;
}

/**
 * The fading a world's half-life (`halfLifeDays` in its relationships config) brings, as a read: each pair and axis whose regard that
 * half-life halves within the span (after `span.from`, up to `span.to`), with the moment each whole half-life since it was recorded ends.
 * It changes nothing: what the fading does is for an agent to decide. A world that sets no half-life has none.
 */
export function fadingIn(ctx: ReadContext, span: { from: number; to: number }): Fading[] {
  const life = halfLife(ctx);
  if (life === null) return [];
  const out: Fading[] = [];
  for (const [from, e] of Object.entries(ctx.state.entities)) {
    for (const r of e.relations) {
      if (r.type !== "regard") continue;
      const f = r.fields ?? {};
      const since = numOf(f.t, ctx.state.clock);
      for (const a of axesOf(ctx)) {
        const value = numOf(f[a.id]);
        if (value === 0) continue;
        for (let n = Math.max(1, Math.ceil((span.from - since) / life)); since + n * life <= span.to; n++) {
          const at = since + n * life;
          if (at > span.from) out.push({ from, to: r.to, axis: a.id, value, since, at, halved: Math.round(value * Math.pow(0.5, n) * 10) / 10 });
        }
      }
    }
  }
  return out.sort((x, y) => x.at - y.at || x.from.localeCompare(y.from) || x.to.localeCompare(y.to) || x.axis.localeCompare(y.axis));
}
