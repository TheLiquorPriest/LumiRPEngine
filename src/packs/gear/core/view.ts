// The Gear panel's view model (`gear.gear`, Play → Me → Gear; ITEMS-SPEC §10.3): what the POV has on
// it (worn, in its pockets and hands, in its bags), what it holds for others, its own things
// elsewhere with where each is, what it has lent out and what it has borrowed, as item trees sorted
// by `gearOf`. Each item says whose it is, why the POV has it, where it is kept and where it is now,
// as the POV may know them. Gear 1 shows only things in play on it and elsewhere (`inPlay`); what
// changed hands always shows. Kits and slots from Gear 3.

import type { EntityId } from "../../../shared/ids";
import { gotOf, type GotHow } from "../../../shared/things";
import type { ReadContext } from "../../../engine/registry";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { numOf, strOf, own } from "../../../engine/pack-kit";
import { readPass } from "../../../engine/read-pass";
import { canSeeEntity, canSeePlace } from "../../../engine/visibility";
import { contentsOf, holderOf, holdersOf, restOf, whoseOf } from "../../../engine/things";
import { whereWords, whoseWords } from "../../../engine/thing-words";
import { gearOf, inPlay, wornAs, type GrantOn, type WornAs } from "./feed";
import { kitStatus, loadOf } from "./model";

export interface GearItem {
  id: EntityId;
  name: string;
  qty?: number;
  condition?: number;
  slot?: string;
  /** How it is on you, where slots are tracked (Gear 3): worn, in a pocket, in hand. */
  as?: WornAs;
  load?: { used: number; capacity: number; unit: "l" };
  kit?: { complete: boolean; present: number; total: number; missing: string[] };
  /** Whose it is, as you may know it ("yours", "Danny Okafor's", "nobody's"). */
  whose?: string;
  /** Why you have it: how it came to you and from whom, with the story's why. */
  why?: string;
  /** Where it is kept when nobody is using it: its `home`, else where it rests by default. */
  kept?: string;
  /** Where it is now, for a thing not on you, or what it is in when that isn't you. */
  where?: string;
  /** Yours, with someone else by a grant: whom, until when, overdue, or held for you (`hold`). */
  lent?: { to: string; until?: string; overdue: boolean; hold?: true };
  /** Someone else's, on loan to you, or assigned to you to use (`assigned`). */
  borrowed?: { from: string; until?: string; overdue: boolean; assigned?: true };
  children?: GearItem[];
}

export interface GearView {
  level: number;
  /** Yours on you: worn, in your pockets and hands, in your bags. */
  on: GearItem[];
  /** Someone else's you hold for them, or took. */
  holding: GearItem[];
  /** Yours elsewhere, each with where it is. */
  elsewhere: GearItem[];
  /** Yours that someone else has by a grant. */
  lent: GearItem[];
  /** On loan or assigned to you. */
  borrowed: GearItem[];
}

/** How a thing came to its possessor (`got.how`), said to the player character as the one who has it; `from` names whom it came from. */
const GOT_WORDS: Readonly<Record<GotHow, (from: string | null) => string>> = {
  bought: (from) => (from ? `You bought it from ${from}` : "You bought it"),
  given: (from) => (from ? `${from} gave it to you` : "It was given to you"),
  holding: (from) => (from ? `${from} handed it to you to hold` : "It was handed to you to hold"),
  loan: (from) => (from ? `${from} lent it to you` : "It was lent to you"),
  found: () => "You found it",
  took: (from) => (from ? `You took it from ${from}` : "You took it"),
  fetched: () => "You went and got it",
  put_away: () => "It was put away with you",
  made: () => "It came to you in the story",
};

/** The first letter up, as a row's value starts. */
const upper = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export function buildGearView(ctx: ReadContext): GearView {
  const pov = ctx.world.pov;
  const level = ctx.levelOf(pov, "gear");
  return readPass(() => {
    const cal = calendarOf(ctx.world);
    const see = (id: EntityId): boolean => canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id);
    const nameOf = (id: EntityId): string => own(ctx.state.entities, id)?.name ?? id;
    const listed = (id: EntityId): boolean => own(ctx.state.entities, id)?.kind !== "account" && see(id);
    const shown = (id: EntityId): boolean => listed(id) && (level >= 2 || inPlay(ctx, id));
    const gear = gearOf(ctx, pov);
    const onYou = (id: EntityId): boolean => holdersOf(ctx.state, id).includes(pov);
    const whose = (id: EntityId): string | undefined => whoseWords(ctx, id) ?? (whoseOf(ctx, id).owners.length === 0 ? "nobody's" : undefined);
    // Why the POV has it, from what the story recorded when it came to them.
    const why = (id: EntityId): string | undefined => {
      const got = gotOf(own(ctx.state.entities, id)?.fields.got);
      if (!got || !onYou(id)) return undefined;
      const said = GOT_WORDS[got.how](got.from !== undefined && got.from !== pov && see(got.from) ? nameOf(got.from) : null);
      return got.why !== undefined ? `${said}: ${got.why}` : said;
    };
    // Where it is kept: on its owner (you, when it is yours), in a holder or at a place, as the POV may know them.
    const kept = (id: EntityId): string | undefined => {
      const rest = restOf(ctx, id).rest;
      if (rest === null) return undefined;
      if (rest === "owner") {
        const owner = whoseOf(ctx, id).owners[0];
        return owner === undefined ? undefined : owner === pov ? "On you" : see(owner) ? `On ${nameOf(owner)}` : undefined;
      }
      if ("in" in rest) return rest.in === pov ? "On you" : see(rest.in) ? `In ${nameOf(rest.in)}` : undefined;
      return canSeePlace(ctx.registry, ctx.world, ctx.state, pov, rest.place) ? (own(ctx.world.places, rest.place)?.name ?? rest.place) : undefined;
    };
    const item = (id: EntityId, depth: number, keep: (id: EntityId) => boolean): GearItem => {
      const e = own(ctx.state.entities, id);
      const out: GearItem = { id, name: e?.name ?? id };
      if (!e) return out;
      const qty = numOf(e.fields.qty, 1);
      if (level >= 2 && qty !== 1) out.qty = qty;
      if (level >= 3 && typeof e.fields.condition === "number") out.condition = e.fields.condition;
      // Only what is on the POV shows a slot of theirs: a thing lent or kept elsewhere isn't on them.
      if (level >= 3 && strOf(e.fields.slot) && onYou(id)) out.slot = strOf(e.fields.slot).replace(/_/g, " ");
      const as = level >= 3 ? wornAs(ctx, id, pov) : null;
      if (as) out.as = as;
      if (level >= 2 && typeof e.fields.capacity_l === "number") {
        const load = loadOf(ctx.state, id);
        out.load = { used: Math.round(load.usedL * 100) / 100, capacity: load.capacityL ?? 0, unit: "l" };
      }
      const kit = level >= 3 ? kitStatus(ctx, id) : null;
      if (kit) out.kit = { complete: kit.complete, present: kit.present, total: kit.total, missing: kit.missing };
      const owner = whose(id);
      if (owner !== undefined) out.whose = owner;
      const reason = why(id);
      if (reason !== undefined) out.why = reason;
      const rest = kept(id);
      if (rest !== undefined) out.kept = rest;
      const kids = depth < 8 ? contentsOf(ctx.state, id).filter(keep) : [];
      if (kids.length > 0) out.children = kids.map((kid) => item(kid, depth + 1, keep));
      return out;
    };
    // What a thing is in when that is something other than the POV (a held thing in your bag).
    const inside = (id: EntityId): string | undefined => {
      const holder = holderOf(ctx.state, id);
      return holder !== null && holder !== pov && see(holder) ? `In ${nameOf(holder)}` : undefined;
    };
    const away = (id: EntityId): string => upper(whereWords(ctx, id) ?? "somewhere you don't know");
    const until = (g: GrantOn): { until?: string } => (g.until !== undefined ? { until: formatClock(cal, g.until) } : {});
    const firstOf = (grants: readonly GrantOn[]): GrantOn[] => grants.filter((g, i) => grants.findIndex((x) => x.thing === g.thing) === i);
    // Things nested inside another of the same list list under it, not again at the top.
    const roots = (ids: readonly EntityId[]): EntityId[] => ids.filter((id) => !ids.includes(holderOf(ctx.state, id) ?? ""));
    // On you is your own things only: someone else's in your bag is in Holding for others or Borrowed, with what it is in.
    const yoursShown = (id: EntityId): boolean => gear.on.includes(id) && shown(id);
    return {
      level,
      on: contentsOf(ctx.state, pov)
        .filter(yoursShown)
        .map((id) => item(id, 0, yoursShown)),
      holding: roots(gear.holding.filter(listed)).map((id) => {
        const out = item(id, 0, listed);
        const where = inside(id);
        return where !== undefined ? { ...out, where } : out;
      }),
      elsewhere: roots(gear.elsewhere.filter(shown)).map((id) => ({ ...item(id, 0, shown), where: away(id) })),
      lent: firstOf(gear.lent.filter((g) => listed(g.thing))).map((g) => ({ ...item(g.thing, 0, listed), lent: { to: see(g.who) ? nameOf(g.who) : "someone", ...until(g), overdue: g.overdue, ...(g.basis === "hold" ? { hold: true as const } : {}) }, where: away(g.thing) })),
      borrowed: firstOf(gear.borrowed.filter((g) => listed(g.thing))).map((g) => {
        const from = whoseOf(ctx, g.thing).owners.find(see);
        const out: GearItem = { ...item(g.thing, 0, listed), borrowed: { from: from !== undefined ? nameOf(from) : "someone", ...until(g), overdue: g.overdue, ...(g.basis === "assign" ? { assigned: true as const } : {}) } };
        const where = onYou(g.thing) ? inside(g.thing) : away(g.thing);
        return where !== undefined ? { ...out, where } : out;
      }),
    };
  });
}
