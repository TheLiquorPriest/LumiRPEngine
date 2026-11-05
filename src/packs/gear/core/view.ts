// The Gear panel's view model (`gear.gear`, Play → Me → Belongings; ITEMS-SPEC §10.3): what the POV
// has on it (worn, in its pockets and hands, in its bags), what it holds for others, its own things
// elsewhere with where each is, what it has lent out and what it has borrowed, as item trees sorted
// by `gearOf`. Each item says whose it is, why the POV has it, where it is kept and where it is now,
// and, for its own things, who may use it and whom it has let use it, as the POV may know them. Gear
// 1 shows only things in play on it and elsewhere (`inPlay`); what changed hands always shows. Kits
// and slots from Gear 3. Belongings' groups, derived and never stored: the outfit (worn, by slot),
// what is carried and not worn, the wardrobe (their clothing at home, by what keeps it), everything
// of theirs stored at home (by what holds it), the things where they are (furnishings, what lies
// loose, what is in holders they may use), their saved outfits and loadouts (DESIGN §28.16), the
// people here and how many vehicles they may use (the Garage lists those, never these lists); below
// Gear 3 everything on them is carried.

import type { EntityId, PlaceId } from "../../../shared/ids";
import type { LoanChoice } from "../../../shared/thing-gm";
import type { AccessChip } from "../../../shared/thing-view";
import { gotOf, grantBasisOf, thingsConfigOf, type GotHow, type GrantBasis, type SetKind, type Size, type SizeClass } from "../../../shared/things";
import type { ReadContext } from "../../../engine/registry";
import { accessFor } from "../../../engine/access";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { numOf, optionalQuery, strOf, own } from "../../../engine/pack-kit";
import { together } from "../../../engine/presence";
import { readPass } from "../../../engine/read-pass";
import { isGone, kindIs, placeOfEntity, placeWithin } from "../../../engine/scope";
import { loanChoices } from "../../../engine/thing-gm";
import { thingIndex, typeRowOf } from "../../../engine/thing-index";
import { useChips } from "../../../engine/thing-view";
import { canSeeEntity, canSeePlace } from "../../../engine/visibility";
import { contentsOf, holderOf, holdersOf, holdsOf, householdOf, keptCategoryOf, mayFixThing, possessorOf, restOf, sizeOf, slotOf, whoseOf } from "../../../engine/things";
import { whereWords, whoseWords } from "../../../engine/thing-words";
import { gearOf, inPlay, wornAs, type GrantOn, type WornAs } from "./feed";
import { kitStatus, loadOf } from "./model";
import { gearSets } from "./sets";

export interface GearItem {
  id: EntityId;
  name: string;
  qty?: number;
  condition?: number;
  slot?: string;
  /** How it is on you, where slots are tracked (Gear 3): worn, in a pocket, in hand. */
  as?: WornAs;
  /** Its size (ITEMS-SPEC §4.1), when anything gives it. */
  size?: SizeClass;
  /** The largest size it takes, for what holds things: somewhere to Put it in. */
  holds?: Size;
  /** It is worn in a slot, where slots are tracked (Gear 3). */
  wearable?: true;
  /** Yours to move or change: yours (or your household's), or nobody's here at a place you own or live in (`mayFixThing`). */
  mine?: true;
  /** Its stated owner (the first, for a thing with several); null when none is stated. */
  ownerId?: EntityId | null;
  /** Its category: its own, else its type row's (clothing, weapon, armor, ammo…). */
  category?: string;
  /** On a thing that is yours: who may use it beyond a grant, ground by ground, among the people you know. */
  use?: AccessChip[];
  /** On a thing that is yours: whom you (or anyone) let use it, each you know, with when it ends. */
  grants?: GearGrant[];
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

/** A holder Belongings names: its id and name. */
export interface GearHolder {
  id: EntityId;
  name: string;
}

/** A use grant on a thing of yours: whom it lets use it, on what basis, until when, and whether it is overdue. */
export interface GearGrant {
  who: EntityId;
  name: string;
  basis: GrantBasis;
  until?: string;
  overdue?: true;
}

/** Your things stored at home in one holder (a wardrobe, a box, a gun safe), or lying loose at a place there (`holder` null), and the name of where it is. */
export interface GearStore {
  holder: GearHolder | null;
  where: string;
  items: GearItem[];
}

/** One piece of a saved set as Belongings shows it: the thing, its name, the slot it goes in when that isn't its own, and whether it is out of reach now. */
export interface GearSetPiece {
  item: EntityId;
  name: string;
  slot?: string;
  missing?: true;
}

/** A saved outfit or loadout (DESIGN §28.16); `on` when every piece of it to hand is worn now, in its slot. */
export interface GearSet {
  id: string;
  name: string;
  kind: SetKind;
  pieces: GearSetPiece[];
  on?: true;
}

/** The player character's clothing at home kept in one holder (a wardrobe, a dresser), or lying loose there (`holder` null), and the name of where it is. */
export interface WardrobeGroup {
  holder: GearHolder | null;
  where: string;
  items: GearItem[];
}

/** The things where the player character is: the furnishings (Furniture or larger), what lies loose, and what is in each holder here they may use. */
export interface GearHere {
  place: string;
  room: GearItem[];
  lying: GearItem[];
  inside: { holder: GearHolder; items: GearItem[] }[];
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
  /** What you wear or have in hand, by slot (Gear 3), with what is in it; empty below Gear 3. */
  outfit: GearItem[];
  /** What is on you and not worn, with what is in it; below Gear 3, everything on you. */
  carried: GearItem[];
  /** Your clothing at home, by what keeps it (Gear 3); empty below Gear 3. */
  wardrobe: WardrobeGroup[];
  /** The things where you are; null when you are nowhere. */
  here: GearHere | null;
  /** Everything of yours (or your household's, or nobody's) at home that nobody has, by what holds it, loose last; empty with no home. */
  stored: GearStore[];
  /** Your saved outfits and loadouts (Gear 3); empty below it. */
  sets: GearSet[];
  /** The people here you can see. */
  people: GearHolder[];
  /** How many vehicles you may use (the Garage lists them; these lists never do). */
  vehicles: number;
  /** The ends a loan or a grant of use offers: a day, three days, a week from now. */
  loans: LoanChoice[];
  /** Your household, for "the household's"; null for none. */
  household: GearHolder | null;
  /** Your home, the place; null for none. */
  home: GearHolder | null;
  /** The largest thing a person carries (the world's person ceiling). */
  ceiling: Size;
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
    // Vehicles are the Garage's, and so are the parts built into them (a truck's bed, its glovebox): no
    // list here holds one. What is kept in such a part is listed as any other thing, with where it is.
    const listed = (id: EntityId): boolean => {
      const e = own(ctx.state.entities, id);
      if (e === undefined || e.kind === "account" || kindIs(ctx.registry, ctx.world, e.kind, "vehicle")) return false;
      const holder = holderOf(ctx.state, id);
      const inVehicle = holder !== null && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, holder)?.kind ?? "", "vehicle");
      return !(inVehicle && sizeOf(ctx, id).size === "part") && see(id);
    };
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
    // The use grants on each thing (a `uses` to it), read once: who, with the link.
    const granted = new Map<EntityId, { who: EntityId; basis: GrantBasis; until: number | undefined }[]>();
    for (const who of Object.keys(ctx.state.entities).sort()) {
      for (const r of own(ctx.state.entities, who)?.relations ?? []) {
        if (r.type !== "uses") continue;
        granted.set(r.to, [...(granted.get(r.to) ?? []), { who, basis: grantBasisOf(r.fields, r.until), until: r.until }]);
      }
    }
    const known = (who: EntityId): boolean => who === pov || see(who);
    const household = householdOf(ctx, pov);
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
      const size = sizeOf(ctx, id).size;
      if (size !== "unknown") out.size = size;
      const holds = holdsOf(ctx, id);
      if (holds !== null) out.holds = holds;
      if (level >= 3 && slotOf(ctx, e.fields) !== null) out.wearable = true;
      if (mayFixThing(ctx, pov, id)) {
        out.mine = true;
        // Who may use it and whom it is lent to, as Owner & use shows them: only the people the POV knows.
        if (level >= 2) out.use = useChips(ctx, id, known);
        const grants = (granted.get(id) ?? []).filter((g) => known(g.who));
        if (grants.length > 0) out.grants = grants.map((g) => ({ who: g.who, name: nameOf(g.who), basis: g.basis, ...(g.until !== undefined ? { until: formatClock(cal, g.until) } : {}), ...(g.until !== undefined && g.until <= ctx.state.clock ? { overdue: true as const } : {}) }));
      }
      const stated = whoseOf(ctx, id);
      const ownerId = stated.presumed === undefined ? stated.owners[0] : undefined;
      if (ownerId === undefined) out.ownerId = null;
      else if (known(ownerId) || ownerId === household) out.ownerId = ownerId;
      const category = typeof e.fields.category === "string" && e.fields.category !== "" ? e.fields.category : typeRowOf(ctx, e.fields)?.row.category;
      if (typeof category === "string" && category !== "") out.category = category;
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
    // Manage's groups. The outfit: what you wear or hold in hand, by the slots' order (what is in a pocket is carried); carried is the rest on you.
    const slots = Object.keys(ctx.tables.get("gear.slots")?.rows ?? {});
    const wornSlot = (id: EntityId): string | null => {
      const r = own(ctx.state.entities, id)?.relations.find((x) => (x.type === "worn_by" || x.type === "equipped") && x.to === pov);
      const slot = !r ? null : typeof r.fields?.slot === "string" && r.fields.slot !== "" ? r.fields.slot : (slotOf(ctx, own(ctx.state.entities, id)?.fields ?? {}) ?? "worn");
      return slot === "pocket" || slot === "pocket_or_bag" ? null : slot;
    };
    const mine = contentsOf(ctx.state, pov).filter(shown);
    const slotRank = (slot: string): number => (slots.includes(slot) ? slots.indexOf(slot) : slots.length);
    const outfit = (level < 3 ? [] : mine)
      .flatMap((id) => {
        const slot = wornSlot(id);
        return slot !== null ? [{ id, slot }] : [];
      })
      .sort((a, b) => slotRank(a.slot) - slotRank(b.slot) || a.id.localeCompare(b.id));
    const outfitIds = new Set(outfit.map((o) => o.id));
    const home = own(ctx.state.entities, pov)?.fields.home;
    const homePlace = typeof home === "string" && own(ctx.world.places, home) ? home : null;
    const atHome = (place: PlaceId | null): boolean => place !== null && homePlace !== null && placeWithin(ctx.world, place, homePlace) && together(ctx.world, place, homePlace);
    const placeName = (place: PlaceId): string => own(ctx.world.places, place)?.name ?? place;
    // The wardrobe: your clothing at home that nobody has, by what holds it, loose last.
    const wardrobe: WardrobeGroup[] = [];
    if (level >= 3 && homePlace !== null) {
      const groups = new Map<string, WardrobeGroup>();
      for (const id of thingIndex(ctx).things) {
        const e = own(ctx.state.entities, id);
        if (!e || isGone(ctx.state, id) || !listed(id) || possessorOf(ctx, id) !== null || keptCategoryOf(ctx, e.fields) !== "clothing" || !whoseOf(ctx, id).owners.includes(pov)) continue;
        const at = placeOfEntity(ctx.state, id);
        if (!atHome(at) || at === null) continue;
        const holder = holderOf(ctx.state, id);
        const by = holder !== null && see(holder) ? holder : null;
        const key = by ?? `place:${at}`;
        const group = groups.get(key) ?? { holder: by !== null ? { id: by, name: nameOf(by) } : null, where: placeName(placeOfEntity(ctx.state, by ?? id) ?? at), items: [] };
        group.items.push(item(id, 0, listed));
        groups.set(key, group);
      }
      wardrobe.push(...[...groups.values()].sort((a, b) => Number(a.holder === null) - Number(b.holder === null) || (a.holder?.name ?? a.where).localeCompare(b.holder?.name ?? b.where)));
    }
    // Home storage: everything of yours (or your household's, or nobody's) at home that nobody has, by
    // the holder lying there that keeps it (a wardrobe, a box, a gun safe), with what is inside each,
    // loose last; the furnishings themselves are the room's, not storage.
    const stored: GearStore[] = [];
    if (homePlace !== null) {
      const ours = (id: EntityId): boolean => listed(id) && !isGone(ctx.state, id) && possessorOf(ctx, id) === null && mayFixThing(ctx, pov, id);
      const portable = (id: EntityId): boolean => {
        const size = sizeOf(ctx, id).size;
        return size !== "furniture" && size !== "builtin" && size !== "part" && size !== "vehicle";
      };
      const loose: GearStore[] = [];
      for (const [at, ids] of [...thingIndex(ctx).loose].sort(([a], [b]) => a.localeCompare(b))) {
        if (!atHome(at) || !canSeePlace(ctx.registry, ctx.world, ctx.state, pov, at)) continue;
        const lying: EntityId[] = [];
        for (const id of ids) {
          if (!listed(id) || isGone(ctx.state, id)) continue;
          const inner = holdsOf(ctx, id) !== null ? contentsOf(ctx.state, id).filter(ours) : [];
          if (inner.length > 0) stored.push({ holder: { id, name: nameOf(id) }, where: placeName(at), items: inner.map((kid) => item(kid, 0, listed)) });
          else if (ours(id) && portable(id)) lying.push(id);
        }
        if (lying.length > 0) loose.push({ holder: null, where: placeName(at), items: lying.map((id) => item(id, 0, listed)) });
      }
      stored.sort((a, b) => (a.holder?.name ?? "").localeCompare(b.holder?.name ?? "") || a.where.localeCompare(b.where));
      stored.push(...loose);
    }
    // Where you are: what lies here, the furnishings apart, and what is in what holds things here that you may use.
    const herePlace = placeOfEntity(ctx.state, pov);
    let here: GearHere | null = null;
    if (herePlace !== null && canSeePlace(ctx.registry, ctx.world, ctx.state, pov, herePlace)) {
      const loose = (thingIndex(ctx).loose.get(herePlace) ?? []).filter((id) => listed(id) && !isGone(ctx.state, id));
      const big = (id: EntityId): boolean => {
        const size = sizeOf(ctx, id).size;
        return size === "furniture" || size === "builtin" || size === "part" || size === "vehicle";
      };
      const inside = loose.filter((id) => holdsOf(ctx, id) !== null && accessFor(ctx, pov, id).use !== null).flatMap((id) => {
        const items = contentsOf(ctx.state, id).filter(listed).map((kid) => item(kid, 0, listed));
        return items.length > 0 ? [{ holder: { id, name: nameOf(id) }, items }] : [];
      });
      here = { place: placeName(herePlace), room: loose.filter(big).map((id) => item(id, 0, listed)), lying: loose.filter((id) => !big(id)).map((id) => item(id, 0, listed)), inside };
    }
    // What the POV has nothing else to read for: the people here, and the Garage's count.
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
      outfit: outfit.map(({ id, slot }) => ({ ...item(id, 0, shown), slot: slot.replace(/_/g, " ") })),
      carried: mine.filter((id) => !outfitIds.has(id)).map((id) => item(id, 0, shown)),
      wardrobe,
      here,
      stored,
      sets: level >= 3 ? gearSets(ctx, pov) : [],
      people:
        herePlace === null
          ? []
          : Object.keys(ctx.state.entities)
              .filter((id) => id !== pov && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person") && !isGone(ctx.state, id) && placeOfEntity(ctx.state, id) === herePlace && see(id))
              .map((id) => ({ id, name: nameOf(id) }))
              .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      vehicles: optionalQuery(ctx, "vehicles.for")?.(ctx, pov).filter(see).length ?? 0,
      loans: loanChoices(ctx),
      household: household !== null ? { id: household, name: nameOf(household) } : null,
      home: homePlace !== null ? { id: homePlace, name: placeName(homePlace) } : null,
      ceiling: thingsConfigOf(ctx.world).sizes.ceiling,
    };
  });
}
