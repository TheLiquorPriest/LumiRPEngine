// The gear pack's sections (DESIGN §6.11; ITEMS-SPEC §5.5): the Gear section, what the player
// character has on them, holds for others, has borrowed and has lent, and which of the things that
// go about with them aren't with them now; and in People, what the people with them visibly wear
// and carry, each thing with whose it is when it isn't theirs. Possession is never ownership: who
// has a thing comes from its holders and whose it is from the things model (`whoseOf`, a presumed
// owner told as a stated one), each in words the player character may know (`engine/thing-words`).
// `gearOf` sorts someone's things for these lines and Play → Me → Gear alike. Pure.

import type { EntityId } from "../../../shared/ids";
import type { FeedScope } from "../../../shared/world";
import type { GrantBasis } from "../../../shared/things";
import { gotOf, grantBasisOf, madeOf, SET_KINDS, setsOf, thingsConfigOf } from "../../../shared/things";
import { listWords } from "../../../shared/words";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { orgPower, orgTypeOf } from "../../../engine/org";
import { own } from "../../../engine/pack-kit";
import { together } from "../../../engine/presence";
import { readPass } from "../../../engine/read-pass";
import type { FeedLine, ReadContext } from "../../../engine/registry";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { thingIndex } from "../../../engine/thing-index";
import { contentsOf, holderOf, holdersOf, possessorOf, restOf, whoseOf } from "../../../engine/things";
import { sentence, thingName, thingText, whereWords, whoseWords } from "../../../engine/thing-words";
import { canSeeEntity } from "../../../engine/visibility";
import { carriedBy } from "./model";

/** What a holder wears or has equipped. */
export function wornBy(ctx: ReadContext, who: EntityId): EntityId[] {
  return Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => own(ctx.state.entities, id)?.relations.some((x) => (x.type === "worn_by" || x.type === "equipped") && x.to === who));
}

/** How a thing is on its wearer, where slots are tracked (Gear 3): worn, in a pocket (a pocket isn't something worn) or in hand. */
export type WornAs = "worn" | "pocket" | "hand";

/** How `id` is on `who` (`WornAs`), or null when they neither wear nor have it equipped. */
export function wornAs(ctx: ReadContext, id: EntityId, who: EntityId): WornAs | null {
  const r = own(ctx.state.entities, id)?.relations.find((x) => (x.type === "worn_by" || x.type === "equipped") && x.to === who);
  if (!r) return null;
  const slot = typeof r.fields?.slot === "string" ? r.fields.slot : "";
  return slot === "pocket" || slot === "pocket_or_bag" ? "pocket" : r.type === "equipped" || slot === "hand_held" ? "hand" : "worn";
}

/** How a thing on the player character is, in a Gear line's words. */
const WORN_WORDS: Readonly<Record<WornAs, string>> = { worn: "worn", pocket: "in your pocket", hand: "in your hand" };

/** The order things on someone are told in: what they wear, then their pockets, their hands, and after them the rest they carry. */
export const WORN_ORDER: readonly WornAs[] = ["worn", "pocket", "hand"];

/**
 * Whether a thing shows at Gear 1 (DESIGN §9.3 level contract): it is notable, as an authored one
 * marked so, or it has come into play: made in play (`made`), or had by someone through the story
 * (`got`: bought, found, handed over, taken). Everyday carry is neither until the story touches it.
 */
export function inPlay(ctx: ReadContext, id: EntityId): boolean {
  const f = own(ctx.state.entities, id)?.fields;
  return f !== undefined && (f.notable === true || gotOf(f.got) !== null || madeOf(f.made) !== null);
}

/** A use grant (`uses`) on a thing: whom it is to, what it rests on, and its end. */
export interface GrantOn {
  thing: EntityId;
  who: EntityId;
  basis: GrantBasis;
  until?: number;
  /** A loan whose end has passed. */
  overdue: boolean;
}

/** Every use grant, by the thing it is on, each list in grantee order (one read of every entity's relations). */
function grantsByThing(ctx: ReadContext): Map<EntityId, GrantOn[]> {
  const out = new Map<EntityId, GrantOn[]>();
  for (const who of Object.keys(ctx.state.entities).sort()) {
    for (const r of own(ctx.state.entities, who)?.relations ?? []) {
      if (r.type !== "uses" || !own(ctx.state.entities, r.to)) continue;
      const grant: GrantOn = { thing: r.to, who, basis: grantBasisOf(r.fields, r.until), ...(r.until !== undefined ? { until: r.until } : {}), overdue: r.until !== undefined && r.until <= ctx.state.clock };
      const list = out.get(r.to);
      if (list) list.push(grant);
      else out.set(r.to, [grant]);
    }
  }
  return out;
}

/** Whether a thing is `who`'s to have as their own: theirs, stated or presumed, or an organization's whose things they use as theirs (a household's, the party's, a company's they run). */
export function isOwn(ctx: ReadContext, who: EntityId, id: EntityId): boolean {
  const owners = whoseOf(ctx, id).owners;
  return owners.includes(who) || owners.some((o) => orgTypeOf(ctx, o) !== null && orgPower(ctx, who, o, "assets.use", id) !== null);
}

/** Someone's things as the Gear section and Play → Me → Gear sort them (ITEMS-SPEC §5.5, §10.3). */
export interface GearOf {
  /** Their own on them (`isOwn`), at any depth, in the order they carry them (`carriedBy`). */
  on: EntityId[];
  /** Someone else's on them that isn't on loan or assigned to them: held for its owner, or taken. */
  holding: EntityId[];
  /** On loan or assigned to them, on them or not. */
  borrowed: GrantOn[];
  /** Their own (stated) that someone else has by a grant: lent, assigned, or held for them. */
  lent: GrantOn[];
  /** Their own (stated) not on them and not lent out, lost ones too, in id order. */
  elsewhere: EntityId[];
}

/** `who`'s things, sorted (`GearOf`); never money records, and never a thing gone from the world. */
export function gearOf(ctx: ReadContext, who: EntityId): GearOf {
  const grants = grantsByThing(ctx);
  const listed = (id: EntityId): boolean => {
    const e = own(ctx.state.entities, id);
    return !!e && e.kind !== "account" && !isGone(ctx.state, id);
  };
  const out: GearOf = { on: [], holding: [], borrowed: [], lent: [], elsewhere: [] };
  for (const id of carriedBy(ctx.state, who)) {
    if (!listed(id)) continue;
    if (isOwn(ctx, who, id)) out.on.push(id);
    else if (!(grants.get(id) ?? []).some((g) => g.who === who && g.basis !== "hold")) out.holding.push(id);
  }
  for (const [thing, list] of [...grants].sort(([a], [b]) => a.localeCompare(b))) if (listed(thing)) out.borrowed.push(...list.filter((g) => g.who === who && g.basis !== "hold"));
  for (const id of thingIndex(ctx).owned.get(who) ?? []) {
    if (!listed(id) || holdersOf(ctx.state, id).includes(who)) continue;
    const others = (grants.get(id) ?? []).filter((g) => g.who !== who);
    if (others.length > 0) out.lent.push(...others);
    else out.elsewhere.push(id);
  }
  return out;
}

/** Whether a thing of `who`'s goes about with them: it rests on its owner, or on them (ITEMS-SPEC §4.3). */
export function restsOn(ctx: ReadContext, id: EntityId, who: EntityId): boolean {
  const rest = restOf(ctx, id).rest;
  return rest === "owner" || (rest !== null && "in" in rest && rest.in === who);
}

/**
 * The Gear section (DESIGN §6, §6.11; ITEMS-SPEC §5.5), in the player character's knowledge, a thing
 * a line with its details as they may see them (`thingText`):
 * - `On you`: their own things on them, from Gear 3 worn, in a pocket or in hand, else what each is in;
 * - `Holding for <owner>`: someone else's they hold, with the story's why (`Taken from`, one they took);
 * - `Borrowed from <owner>`: on loan or assigned to them, until when or overdue, and where it is when not on them;
 * - `Lent out` (`With <someone>` for one held for them): their own someone else has by a grant;
 * - `Not with you`: their own things that go about with them (`restsOn`) and aren't with them now,
 *   with where, as far as the world's Not with you lines allow (`notWithYou`);
 * - `Saved outfits`, `Saved loadouts`: their saved sets by name, from Gear 3 (DESIGN §28.16).
 * At Gear 1 only things in play (`inPlay`) are on you or not with you; what changed hands always
 * shows. In `gm` scope, something on them they don't know of (a thing planted on them) is added, marked.
 */
export function gearLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const pov = ctx.world.pov;
  const level = ctx.levelOf(pov, "gear");
  if (level === 0) return [];
  return readPass(() => {
    const see = (id: EntityId): boolean => canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id);
    const nameOf = (id: EntityId): string => own(ctx.state.entities, id)?.name ?? id;
    const shown = (id: EntityId): boolean => see(id) && (level >= 2 || inPlay(ctx, id));
    const cal = calendarOf(ctx.world);
    const gear = gearOf(ctx, pov);
    const as = (id: EntityId): WornAs | null => (level >= 3 ? wornAs(ctx, id, pov) : null);
    // How a thing is on the player character: worn, in a pocket or in hand, else what it is in when that is something other than them.
    const onYou = (id: EntityId): string[] => {
      const worn = as(id);
      if (worn) return [WORN_WORDS[worn]];
      const holder = holderOf(ctx.state, id);
      return holder !== null && holder !== pov && see(holder) ? [`in ${nameOf(holder)}`] : [];
    };
    const owners = (id: EntityId): string => {
      const seen = whoseOf(ctx, id).owners.filter(see).map(nameOf);
      return seen.length > 0 ? listWords(seen) : "someone";
    };
    const lines: FeedLine[] = [];
    const rank = (id: EntityId): number => {
      const worn = as(id);
      return worn === null ? WORN_ORDER.length : WORN_ORDER.indexOf(worn);
    };
    const on = gear.on.filter(shown).sort((a, b) => rank(a) - rank(b));
    for (const id of on) {
      // Theirs as one of an organization they belong to (the household's milk): told whose.
      const whose = whoseOf(ctx, id).owners.includes(pov) ? [] : [whoseWords(ctx, id)].filter((w): w is string => w !== null);
      lines.push({ text: sentence(`On you: ${thingText(ctx, id, [...onYou(id), ...whose])}`), known: "pov" });
    }
    for (const id of gear.holding.filter(see)) {
      const got = gotOf(own(ctx.state.entities, id)?.fields.got);
      const lead = got?.how === "took" ? `Taken from ${owners(id)}` : `Holding for ${owners(id)}`;
      lines.push({ text: sentence(`${lead}: ${thingText(ctx, id, [...onYou(id), ...(got?.why !== undefined ? [got.why] : [])])}`), known: "pov" });
    }
    for (const g of gear.borrowed.filter((x) => see(x.thing))) {
      const terms = g.basis === "assign" ? ["yours to use"] : g.overdue ? ["overdue: it should go back"] : g.until !== undefined ? [`until ${formatClock(cal, g.until)}`] : [];
      const where = holdersOf(ctx.state, g.thing).includes(pov) ? onYou(g.thing) : [whereWords(ctx, g.thing)].filter((w): w is string => w !== null);
      lines.push({ text: sentence(`Borrowed from ${owners(g.thing)}: ${thingText(ctx, g.thing, [...terms, ...where])}`), known: "pov" });
    }
    for (const g of gear.lent.filter((x) => see(x.thing))) {
      const to = see(g.who) ? nameOf(g.who) : "someone";
      const terms = g.basis === "hold" ? ["holding it for you"] : g.basis === "assign" ? [`for ${to} to use`] : g.overdue ? [`to ${to}`, "overdue: it should have come back by now"] : [`to ${to}${g.until !== undefined ? ` until ${formatClock(cal, g.until)}` : ""}`];
      lines.push({ text: sentence(`${g.basis === "hold" ? `With ${to}` : "Lent out"}: ${thingText(ctx, g.thing, terms)}`), known: "pov" });
    }
    const away = gear.elsewhere.filter((id) => shown(id) && restsOn(ctx, id, pov)).slice(0, thingsConfigOf(ctx.world).notWithYou);
    for (const id of away) {
      // On someone else by no grant of theirs (taken, found), it is somewhere they can't know.
      const where = possessorOf(ctx, id) === null ? whereWords(ctx, id) : null;
      lines.push({ text: sentence(`Not with you: ${thingText(ctx, id, [where ?? "you don't know where"])}`), known: "pov" });
    }
    // Their saved outfits and loadouts by name (Gear 3, DESIGN §28.16), so a change into one is told and read by it.
    const sets = level >= 3 ? Object.values(setsOf(own(ctx.state.entities, pov)?.fields)) : [];
    for (const kind of SET_KINDS) {
      const names = sets.filter((s) => s.kind === kind).map((s) => s.name).sort((a, b) => a.localeCompare(b));
      if (names.length > 0) lines.push({ text: `${kind === "outfit" ? "Saved outfits" : "Saved loadouts"}: ${listWords(names)}.`, known: "pov" });
    }
    if (scope === "gm") {
      const unknown = [...new Set([...carriedBy(ctx.state, pov), ...wornBy(ctx, pov)])].filter((id) => own(ctx.state.entities, id)?.kind !== "account" && !see(id));
      if (unknown.length > 0) lines.push({ text: `On you without your knowing: ${unknown.map((id) => thingName(ctx, id, level)).join(", ")}.`, known: "gm" });
    }
    return lines;
  });
}

/**
 * What each person with the POV that it can see visibly wears and carries (DESIGN §6.11): every
 * worn and equipped thing and everything they hold in hand, never what is in a bag or a pocket, each
 * with whose it is when it isn't their own ("carries Toolbox (yours)"; ITEMS-SPEC §5.5). Only what the
 * POV can see. In `scene` scope, a thing on them the POV can't see but they can (by the visibility
 * rules, so never a secret one), marked as theirs to know; in `gm`, any other thing on them too.
 */
export function presentGearLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const pov = ctx.world.pov;
  if (ctx.levelOf(pov, "gear") === 0) return [];
  return readPass(() => {
    const see = (who: EntityId, id: EntityId): boolean => canSeeEntity(ctx.registry, ctx.world, ctx.state, who, id);
    const here = placeOfEntity(ctx.state, pov);
    const lines: FeedLine[] = [];
    for (const who of Object.keys(ctx.state.entities).sort()) {
      const person = own(ctx.state.entities, who);
      if (!person || who === pov || !kindIs(ctx.registry, ctx.world, person.kind, "person") || isGone(ctx.state, who) || !see(pov, who) || !together(ctx.world, here, placeOfEntity(ctx.state, who))) continue;
      const level = Math.max(1, ctx.levelOf(who, "gear"));
      const worn = wornBy(ctx, who);
      const held = contentsOf(ctx.state, who).filter((id) => {
        const e = own(ctx.state.entities, id);
        return !!e && e.kind !== "account" && e.fields.slot !== "pocket" && !worn.includes(id);
      });
      const say = (ids: readonly EntityId[]): string =>
        ids
          .map((id) => {
            const whose = whoseOf(ctx, id).owners.includes(who) ? null : whoseWords(ctx, id);
            return thingName(ctx, id, level, whose !== null ? [whose] : []);
          })
          .join(", ");
      const wornSeen = worn.filter((id) => see(pov, id));
      const heldSeen = held.filter((id) => see(pov, id));
      const parts = [...(wornSeen.length > 0 ? [`wears ${say(wornSeen)}`] : []), ...(heldSeen.length > 0 ? [`carries ${say(heldSeen)}`] : [])];
      if (parts.length > 0) lines.push({ text: `${person.name} ${parts.join("; ")}.`, known: "pov" });
      if (scope === "player") continue;
      const hidden = [...worn, ...held].filter((id) => !see(pov, id));
      const theirs = hidden.filter((id) => see(who, id));
      const gms = hidden.filter((id) => !see(who, id));
      if (theirs.length > 0) lines.push({ text: `${person.name} has ${say(theirs)}.`, known: "scene", who: person.name });
      if (scope === "gm" && gms.length > 0) lines.push({ text: `${person.name} has ${say(gms)}.`, known: "gm" });
    }
    return lines;
  });
}
