// Gear & containers pack (DESIGN §9.3): own, hold, wear and store; equip slots; containers with
// volume and load limits; stacks; kits as template plus overrides; condition, wear, consumables;
// use grants (lending) with overdue semantics.
//
// Level contract (domain `gear`):
//   0  off: transfers are no-ops; nothing renders
//   1  notable items only render (transfers still apply: the data is uniform)
//   2  items, containers (volume/load limits), stacks; cash lives in a wallet
//   3  worn and equipped slots, kits, condition
//   4  wear per use, consumables
//
// Services: gear.transfer, gear.drop, gear.give, gear.spawn, gear.take_piece, gear.lend,
// gear.retrieve. Queries: has_item, gear.kit_status, gear.overdue.

import type { JsonObject, JsonValue } from "../../../shared/json";
import { hasOwn } from "../../../shared/json";
import type { EntityId, PlaceId } from "../../../shared/ids";
import { hashParts } from "../../../shared/hash";
import type { LedgerEvent } from "../../../shared/ledger";
import type { DataTable } from "../../../shared/tables";
import type { EntityDef, KindDef, WorldCurrency } from "../../../shared/world";
import { calendarOf, clockOfPhrase } from "../../../engine/calendar";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { bump, labelOf, numOf, optionalService, strOf, own, rowOf } from "../../../engine/pack-kit";
import type { PackDef, ReadContext, Rejection } from "../../../engine/registry";
import { fieldDef, kindIs, placeOfEntity } from "../../../engine/scope";
import { carriedBy, contentsOf, findPiece, fitProblem, grants, hasItem, holderOf, isInside, kitStatus, overdueFor, takenOf, weightOf, type Grant, type KitStatus } from "./model";
import { buildGearView } from "./view";
import containers from "./tables/modern-us/containers.json";
import items from "./tables/modern-us/items.json";
import kits from "./tables/modern-us/kits.json";
import slots from "./tables/modern-us/slots.json";

const TABLES: DataTable[] = [items, containers, kits, slots] as unknown as DataTable[];

/** A narrated quantity change's largest step when the item kind's `qty` field has no bound. */
const QTY_MAX_DELTA = 10;

export interface GearSpawn {
  name: string;
  owner: EntityId | null;
  /** Holder (`in`), or a place when none. */
  holder?: EntityId | null;
  place?: PlaceId | null;
  catalog?: string;
  category?: string;
  qty?: number;
  kind?: "item" | "container";
  /** Disambiguates spawns that share every other input. */
  salt?: string;
}

type Events = LedgerEvent[] | Rejection;

declare module "../../../engine/registry" {
  interface ServiceMap {
    "gear.transfer": (ctx: ReadContext, item: EntityId, to: EntityId) => LedgerEvent[] | Rejection;
    "gear.drop": (ctx: ReadContext, item: EntityId, place: PlaceId) => LedgerEvent[] | Rejection;
    "gear.give": (ctx: ReadContext, item: EntityId, from: EntityId, to: EntityId) => LedgerEvent[] | Rejection;
    "gear.spawn": (ctx: ReadContext, spec: GearSpawn) => LedgerEvent[] | Rejection;
    "gear.take_piece": (ctx: ReadContext, kit: EntityId, piece: string, to: EntityId) => LedgerEvent[] | Rejection;
    "gear.lend": (ctx: ReadContext, thing: EntityId, to: EntityId, until: number) => LedgerEvent[] | Rejection;
    "gear.retrieve": (ctx: ReadContext, thing: EntityId) => LedgerEvent[] | Rejection;
  }
  interface QueryMap {
    has_item: (ctx: ReadContext, holder: EntityId, what: string) => boolean;
    "gear.kit_status": (ctx: ReadContext, kit: EntityId) => KitStatus | null;
    "gear.overdue": (ctx: ReadContext, owner: EntityId) => Grant[];
  }
}

export const ITEM: KindDef = {
  id: "item",
  label: "Item",
  extends: "thing",
  pack: "gear",
  fields: {
    notable: { type: "bool", label: "Notable", domain: "gear", level: 1 },
    qty: { type: "number", label: "Quantity", default: 1, min: 0, domain: "gear", level: 2, bound: { mode: "confirm", maxDelta: 10 } },
    weight_g: { type: "number", label: "Weight (g)", min: 0, domain: "gear", level: 2 },
    volume_l: { type: "number", label: "Volume (l)", min: 0, domain: "gear", level: 2 },
    catalog: { type: "text", label: "Catalog item", table: "economy.catalog" },
    category: { type: "text", label: "Category" },
    slot: { type: "text", label: "Equip slot", domain: "gear", level: 3 },
    condition: { type: "number", label: "Condition", default: 100, min: 0, max: 100, domain: "gear", level: 3, bands: [{ label: "broken", max: 10 }, { label: "worn", min: 10, max: 50 }, { label: "good", min: 50, max: 90 }, { label: "like new", min: 90 }], bound: { mode: "auto", maxDelta: 25 } },
    consumable: { type: "bool", label: "Consumable", domain: "gear", level: 4 },
    uses: { type: "number", label: "Uses left", min: 0, domain: "gear", level: 4 },
    overdue: { type: "bool", label: "Overdue", locked: true },
    piece: { type: "text", label: "Kit piece", locked: true },
    from_kit: { type: "ref", label: "From kit", locked: true },
  },
};

export const CONTAINER: KindDef = {
  id: "container",
  label: "Container",
  extends: "item",
  pack: "gear",
  fields: {
    capacity_l: { type: "number", label: "Capacity (l)", min: 0, domain: "gear", level: 2 },
    max_load_kg: { type: "number", label: "Max load (kg)", min: 0, domain: "gear", level: 2 },
    stock: { type: "text", label: "Contents category (sampled when first opened)" },
  },
};

export const KIT: KindDef = {
  id: "kit",
  label: "Kit",
  extends: "container",
  pack: "gear",
  fields: {
    kit: { type: "text", label: "Kit template", domain: "gear", level: 3 },
    pieces: { type: "list", label: "Pieces", domain: "gear", level: 3 },
    piece_count: { type: "number", label: "Piece count", domain: "gear", level: 3 },
  },
};

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** Cash words a handed-over "item" may be, with the amount each names in major units (null: not said). */
const CASH_WORDS: Record<string, number | null> = { cash: null, money: null, buck: null, bucks: null, change: null, coin: null, coins: null, banknote: null, banknotes: null, twenties: null, fifties: null, fiver: 5, tenner: 10, twenty: 20, fifty: 50, hundred: 100 };

/**
 * Money handed over as a give's "item", when the whole item is money: an optional article, then an
 * amount with the world's currency symbol or code or a money word ("$20", "20 USD", "12d", "20
 * dollars") or a cash word ("cash", "some money", "a twenty", "twenty bucks"), then optionally
 * "bill", "note" or "in cash" ("a $20 bill", "20 dollars in cash"). A priced thing ("my $300
 * jacket", "a $20 gift card") is no money. Its amount as written in major units, or null when the
 * text doesn't say; null overall when it isn't money. Extraction turns such a give into a transfer;
 * the give channel refuses it as money.
 */
export function cashGift(text: string, currency: WorldCurrency): { amount: number | null } | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/(\d),(?=\d{3}\b)/g, "$1");
  if (t === "") return null;
  const quote = (s: string): string => s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const article = "(?:(?:some|the|a|an|my|his|her|their) )?";
  const tail = "(?: (?:bills?|notes?|in cash))?";
  const unit = "(?:dollars?|bucks?|euros?|pounds?)";
  const n = "(\\d+(?:\\.\\d+)?)";
  const symbol = quote(currency.symbol);
  const code = quote(currency.code);
  const amounts = [...(symbol !== "" ? [`${symbol} ?${n}`, `${n} ?${symbol}`] : []), ...(code !== "" ? [`${n} ?${code}`] : []), `${n}[ -]${unit}`];
  for (const form of amounts) {
    const said = new RegExp(`^${article}${form}${tail}$`).exec(t)?.[1];
    if (said !== undefined) return { amount: Number(said) };
  }
  const word = new RegExp(`^${article}([a-z]+)(?:[ -]${unit})?${tail}$`).exec(t)?.[1];
  return word !== undefined && hasOwn(CASH_WORDS, word) ? { amount: CASH_WORDS[word] ?? null } : null;
}

/** The gear level that governs a move: the new holder's if it is a person, else the thing's owner's, else the POV's. */
function gearLevel(ctx: ReadContext, thing: EntityId, to?: EntityId): number {
  const toEntity = to ? own(ctx.state.entities, to) : undefined;
  if (to && toEntity && kindIs(ctx.registry, ctx.world, toEntity.kind, "person")) return ctx.levelOf(to, "gear");
  const owner = own(ctx.state.entities, thing)?.fields.owner;
  return ctx.levelOf(typeof owner === "string" && own(ctx.state.entities, owner) ? owner : ctx.world.pov, "gear");
}

/** Events that detach a thing from its holder and wearer, and clear its own place. */
function detach(ctx: ReadContext, thing: EntityId): LedgerEvent[] {
  const e = own(ctx.state.entities, thing);
  const out: LedgerEvent[] = [];
  if (!e) return out;
  for (const r of e.relations) if (r.type === "in" || r.type === "worn_by" || r.type === "equipped") out.push({ type: "unlink", rel: r.type, from: thing, to: r.to });
  return out;
}

const transfer = (ctx: ReadContext, item: EntityId, to: EntityId): Events => {
  if (!own(ctx.state.entities, item)) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
  if (!own(ctx.state.entities, to)) return reject("missing_entity", `no holder ${labelOf(ctx, to)}`);
  const level = gearLevel(ctx, item, to);
  if (level === 0) return [];
  if (holderOf(ctx.state, item) === to) return [];
  if (item === to || isInside(ctx.state, to, item)) return reject("cycle", "can't put something inside itself");
  const target = own(ctx.state.entities, to);
  if (level >= 2 && target && !kindIs(ctx.registry, ctx.world, target.kind, "person")) {
    const problem = fitProblem(ctx.state, item, to);
    if (problem) return reject("no_room", `${labelOf(ctx, item)} ${problem}`);
  }
  const out = detach(ctx, item);
  if (typeof own(ctx.state.entities, item)?.fields.place === "string") out.push({ type: "set", entity: item, field: "place", value: null });
  out.push({ type: "link", rel: "in", from: item, to });
  return out;
};

const drop = (ctx: ReadContext, item: EntityId, place: PlaceId): Events => {
  if (!own(ctx.state.entities, item)) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
  if (!own(ctx.world.places, place)) return reject("missing_place", `no place ${labelOf(ctx, place)}`);
  if (gearLevel(ctx, item) === 0) return [];
  return [...detach(ctx, item), { type: "set", entity: item, field: "place", value: place }];
};

/**
 * A thing's loans end once it is back with its owner or has a new owner (a narrated "Danny hands
 * the flashlight back" must not leave it lent and overdue): every `uses` grant on it goes, and its
 * overdue flag clears.
 */
function endLoans(ctx: ReadContext, thing: EntityId): LedgerEvent[] {
  const out: LedgerEvent[] = grants(ctx.state)
    .filter((g) => g.thing === thing)
    .map((g) => ({ type: "unlink", rel: "uses", from: g.borrower, to: thing }));
  if (own(ctx.state.entities, thing)?.fields.overdue === true) out.push({ type: "set", entity: thing, field: "overdue", value: false });
  return out;
}

const give = (ctx: ReadContext, item: EntityId, from: EntityId, to: EntityId): Events => {
  const e = own(ctx.state.entities, item);
  if (!e) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
  if (e.kind === "account") return reject("is_money", "cash changes hands as a transfer");
  if (from !== to && !isInside(ctx.state, item, from) && e.fields.owner !== from) return reject("not_held", `${labelOf(ctx, from)} doesn't have ${e.name}`);
  const moved = transfer(ctx, item, to);
  if (!Array.isArray(moved)) return moved;
  const owner: LedgerEvent[] = e.fields.owner === from || e.fields.owner === undefined ? [{ type: "set", entity: item, field: "owner", value: to }] : [];
  const loansEnd = e.fields.owner === to || owner.length > 0;
  return [...moved, ...owner, ...(loansEnd ? endLoans(ctx, item) : [])];
};

/** A stable spawned-entity id from the spawn's inputs (services have no rng). */
function spawnId(ctx: ReadContext, spec: GearSpawn): string {
  return `item:${hashParts(spec.name, spec.owner ?? "", spec.holder ?? "", spec.catalog ?? "", ctx.state.clock, spec.salt ?? "", Object.keys(ctx.state.entities).length).slice(0, 12)}`;
}

const spawn = (ctx: ReadContext, spec: GearSpawn): Events => {
  const row = spec.catalog ? (rowOf(ctx, "gear.items", spec.catalog) ?? rowOf(ctx, "gear.containers", spec.catalog)) : undefined;
  const fields: JsonObject = {};
  if (spec.owner) fields.owner = spec.owner;
  if (spec.catalog) fields.catalog = spec.catalog;
  if (spec.category ?? row?.category) fields.category = spec.category ?? strOf(row?.category);
  if (spec.qty !== undefined && spec.qty !== 1) fields.qty = spec.qty;
  if (row) {
    if (typeof row.weight_g === "number") fields.weight_g = row.weight_g;
    if (typeof row.empty_weight_g === "number") fields.weight_g = row.empty_weight_g;
    if (typeof row.volume_l === "number") fields.volume_l = row.volume_l;
    if (typeof row.capacity_l === "number") fields.capacity_l = row.capacity_l;
    if (typeof row.max_load_kg === "number") fields.max_load_kg = row.max_load_kg;
    if (typeof row.equip_slot === "string" && row.equip_slot !== "none") fields.slot = row.equip_slot;
  }
  const id = spawnId(ctx, spec);
  const relations = spec.holder && own(ctx.state.entities, spec.holder) ? [{ type: "in", to: spec.holder }] : [];
  if (relations.length === 0 && spec.place) fields.place = spec.place;
  const kind = spec.kind ?? (row && typeof row.capacity_l === "number" ? "container" : "item");
  const entity: EntityDef = { id, kind, name: spec.name, tier: "background", fields, relations };
  return [{ type: "spawn", entity }];
};

const takePiece = (ctx: ReadContext, kit: EntityId, piece: string, to: EntityId): Events => {
  const k = own(ctx.state.entities, kit);
  if (!k) return reject("missing_entity", `no kit ${labelOf(ctx, kit)}`);
  const status = kitStatus(ctx, kit);
  const p = findPiece(ctx, kit, piece);
  if (!status || !p) return reject("no_piece", `${k.name} has no ${piece}`);
  // A piece that was taken before and put back is an override item already: just move it.
  const back = contentsOf(ctx.state, kit).find((id) => own(ctx.state.entities, id)?.fields.from_kit === kit && own(ctx.state.entities, id)?.fields.piece === p.name);
  if (back) return transfer(ctx, back, to);
  const present = status.pieces.find((x) => x.name === p.name)?.present ?? 0;
  if (present <= 0) return reject("no_piece", `no ${p.name} left in ${k.name}`);
  const taken = takenOf(ctx.state, kit);
  const spawned = spawn(ctx, { name: p.name, owner: typeof k.fields.owner === "string" ? k.fields.owner : null, holder: to, salt: `${kit}:${p.name}:${own(taken, p.name) ?? 0}` });
  if (!Array.isArray(spawned)) return spawned;
  const first = spawned[0];
  if (first?.type === "spawn") {
    first.entity.fields.piece = p.name;
    first.entity.fields.from_kit = kit;
    first.entity.fields.weight_g = p.weightG;
  }
  return [...spawned, { type: "set", entity: kit, field: "taken", value: { ...taken, [p.name]: (own(taken, p.name) ?? 0) + 1 } }];
};

const lend = (ctx: ReadContext, thing: EntityId, to: EntityId, until: number): Events => {
  const e = own(ctx.state.entities, thing);
  if (!e) return reject("missing_entity", `no ${labelOf(ctx, thing)}`);
  if (!own(ctx.state.entities, to)) return reject("missing_entity", `no ${labelOf(ctx, to)}`);
  if (!Number.isFinite(until) || until <= ctx.state.clock) return reject("bad_until", "a loan needs a future end");
  const out: LedgerEvent[] = [];
  // A vehicle (or anything with a place of its own) stays where it is; carried things change hands.
  if (typeof e.fields.place !== "string" || holderOf(ctx.state, thing)) {
    const moved = transfer(ctx, thing, to);
    if (!Array.isArray(moved)) return moved;
    out.push(...moved);
  }
  if (e.fields.overdue === true) out.push({ type: "set", entity: thing, field: "overdue", value: false });
  out.push({ type: "link", rel: "uses", from: to, to: thing, until: Math.round(until) });
  return out;
};

const retrieve = (ctx: ReadContext, thing: EntityId): Events => {
  const e = own(ctx.state.entities, thing);
  if (!e) return reject("missing_entity", `no ${labelOf(ctx, thing)}`);
  const out: LedgerEvent[] = [];
  for (const g of grants(ctx.state)) if (g.thing === thing) out.push({ type: "unlink", rel: "uses", from: g.borrower, to: thing });
  const owner = typeof e.fields.owner === "string" ? e.fields.owner : null;
  // Things with a home base (vehicles) go back there; carried things go back to their owner.
  if (typeof e.fields.home === "string" && own(ctx.world.places, e.fields.home)) out.push(...detach(ctx, thing), { type: "set", entity: thing, field: "place", value: e.fields.home });
  else if (owner && own(ctx.state.entities, owner)) {
    const moved = transfer(ctx, thing, owner);
    if (Array.isArray(moved)) out.push(...moved);
  }
  // Cleared whenever the thing was lent too: an expiry flagged in the same slot lands before this.
  if (e.fields.overdue === true || out.some((x) => x.type === "unlink")) out.push({ type: "set", entity: thing, field: "overdue", value: false });
  return out;
};

const wear = (ctx: ReadContext, item: EntityId, wearer: EntityId, slot?: string): Events => {
  const e = own(ctx.state.entities, item);
  if (!e) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
  if (ctx.levelOf(wearer, "gear") < 3) return reject("level", "slots are tracked from Gear level 3");
  const s = slot ?? strOf(e.fields.slot);
  if (!s || s === "none") return reject("no_slot", `${e.name} isn't worn`);
  const rel = s === "hand_held" ? "equipped" : "worn_by";
  const occupied = Object.keys(ctx.state.entities).find((id) => id !== item && own(ctx.state.entities, id)?.relations.some((r) => r.type === rel && r.to === wearer && r.fields?.slot === s));
  if (occupied && s !== "pocket" && s !== "pocket_or_bag") return reject("slot_taken", `${labelOf(ctx, occupied)} is already in the ${s.replace(/_/g, " ")} slot`);
  const out: LedgerEvent[] = [];
  if (holderOf(ctx.state, item) !== wearer) {
    const moved = transfer(ctx, item, wearer);
    if (!Array.isArray(moved)) return moved;
    out.push(...moved);
  }
  out.push({ type: "link", rel, from: item, to: wearer, fields: { slot: s } });
  return out;
};

export const gearPack: PackDef = {
  id: "gear",
  label: "Gear & containers",
  version: 1,
  domain: "gear",
  requires: ["space"],
  register(r) {
    for (const t of TABLES) r.table({ id: t.id, schema: t.schema, columns: t.columns, defaults: t });
    r.kind(ITEM);
    r.kind(CONTAINER);
    r.kind(KIT);
    r.relation({ id: "worn_by", label: "Worn by", from: "item", to: "*", cardinality: "many_one", symmetric: false, fields: { slot: { type: "text" } }, pack: "gear" });
    r.relation({ id: "equipped", label: "Equipped by", from: "item", to: "*", cardinality: "many_one", symmetric: false, fields: { slot: { type: "text" } }, pack: "gear" });
    r.relation({ id: "uses", label: "Uses (granted until)", from: "*", to: "*", cardinality: "many_many", symmetric: false, fields: {}, pack: "gear" });

    r.service("gear.transfer", transfer);
    r.service("gear.drop", drop);
    r.service("gear.give", give);
    r.service("gear.spawn", spawn);
    r.service("gear.take_piece", takePiece);
    r.service("gear.lend", lend);
    r.service("gear.retrieve", retrieve);
    r.query("has_item", hasItem);
    r.query("gear.kit_status", kitStatus);
    r.query("gear.overdue", (ctx, owner) => overdueFor(ctx.state, owner));

    r.formula("has_item", (ctx, holder, what) => hasItem(ctx, String(holder ?? ""), String(what ?? "")));
    r.formula("carries", (ctx, holder, item) => isInside(ctx.state, String(item ?? ""), String(holder ?? "")));
    r.formula("carried_kg", (ctx, holder) => carriedBy(ctx.state, String(holder ?? "")).filter((id) => holderOf(ctx.state, id) === holder).reduce((a, id) => a + weightOf(ctx.state, id), 0) / 1000);
    r.formula("kit_present", (ctx, kit) => kitStatus(ctx, String(kit ?? ""))?.present ?? 0);
    r.formula("kit_complete", (ctx, kit) => kitStatus(ctx, String(kit ?? ""))?.complete ?? false);
    r.formula("lent_out", (ctx, thing) => grants(ctx.state).some((g) => g.thing === thing));

    const wrap = (type: string, f: (args: Record<string, JsonValue>, ctx: ReadContext) => Events): void => r.effect({ type, resolve: (args, ctx) => f(args, ctx) });
    wrap("gear.transfer", (a, ctx) => {
      const item = strOf(a.item);
      const to = strOf(a.to);
      const moved = transfer(ctx, item, to);
      return Array.isArray(moved) && own(ctx.state.entities, item)?.fields.owner === to ? [...moved, ...endLoans(ctx, item)] : moved;
    });
    wrap("gear.drop", (a, ctx) => drop(ctx, strOf(a.item), strOf(a.place) || (placeOfEntity(ctx.state, strOf(a.item)) ?? "")));
    wrap("gear.give", (a, ctx) => give(ctx, strOf(a.item), strOf(a.from), strOf(a.to)));
    // An NPC hands over something the world hadn't tracked yet: it comes into being, held by the recipient.
    wrap("gear.receive", (a, ctx) => spawn(ctx, { name: strOf(a.name), owner: strOf(a.to), holder: strOf(a.to), salt: `give:${strOf(a.from)}:${ctx.state.clock}` }));
    wrap("gear.take_piece", (a, ctx) => takePiece(ctx, strOf(a.kit), strOf(a.piece), strOf(a.to)));
    // A loan's end: the time the player said (`said`: "7 tonight", "tomorrow", "for 3 hours"), else
    // `until` (a clock, from the days). A said time nothing in it reads as falls back to the days;
    // with no days either, there is no end and no loan.
    wrap("gear.lend", (a, ctx) => {
      const said = strOf(a.said);
      const at = said !== "" ? clockOfPhrase(calendarOf(ctx.world), ctx.state.clock, said) : null;
      const until = at ?? numOf(a.until, NaN);
      if (said !== "" && at === null && !(until > ctx.state.clock)) return reject("bad_until", `"${said}" names no time; say how many days or until when`);
      return lend(ctx, strOf(a.item), strOf(a.to), until);
    });
    wrap("gear.retrieve", (a, ctx) => retrieve(ctx, strOf(a.item)));
    wrap("gear.wear", (a, ctx) => wear(ctx, strOf(a.item), strOf(a.wearer), typeof a.slot === "string" ? a.slot : undefined));
    wrap("gear.remove", (a, ctx) => {
      const item = strOf(a.item);
      const e = own(ctx.state.entities, item);
      if (!e) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
      return e.relations.filter((x) => x.type === "worn_by" || x.type === "equipped").map((x) => ({ type: "unlink" as const, rel: x.type, from: item, to: x.to }));
    });
    r.effect({
      type: "gear.use",
      resolve(args, ctx) {
        const item = strOf(args.item);
        const user = strOf(args.user) || ctx.world.pov;
        const e = own(ctx.state.entities, item);
        if (!e) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
        const level = ctx.levelOf(user, "gear");
        const out: LedgerEvent[] = [];
        if (level >= 4) {
          if (e.fields.consumable === true || typeof e.fields.uses === "number") {
            const uses = numOf(e.fields.uses, 1);
            if (uses <= 0) return reject("used_up", `${e.name} is used up`);
            out.push(bump(ctx.state, item, "uses", -1, uses));
          }
          const wearBy = ctx.rng.int(0, 2);
          const condition = numOf(e.fields.condition, 100);
          if (wearBy > 0 && condition > 0) out.push(bump(ctx.state, item, "condition", -Math.min(wearBy, condition), condition));
        }
        return out;
      },
    });

    r.action({ id: "take", label: "Take", pack: "gear", params: { item: { type: "ref", ref: "item" } }, requires: ["place(item) == here", "not carries(self, item)"], outcomes: { default: [{ type: "gear.transfer", args: { item: "item", to: "self" } }] }, duration: "1", lexicon: ["take", "pick up", "grab"], observable: "picks something up" });
    // Losing something: it leaves its holder and the world (whereabouts unknown); cash inside goes with it.
    r.effect({
      type: "gear.lose",
      resolve(args, ctx) {
        const item = strOf(args.item);
        const e = own(ctx.state.entities, item);
        if (!e) return reject("missing_entity", `no ${labelOf(ctx, item)}`);
        if (e.fields.lost === true) return reject("already_lost", `${e.name} is already lost`);
        const out: LedgerEvent[] = [];
        const lose = optionalService(ctx, "economy.lose");
        if (lose) {
          const money = lose(ctx, item, strOf(args.thief) || undefined);
          if (!Array.isArray(money)) return money;
          out.push(...money);
        }
        for (const r of e.relations) if (r.type === "in" || r.type === "worn_by" || r.type === "equipped") out.push({ type: "unlink", rel: r.type, from: item, to: r.to });
        out.push({ type: "set", entity: item, field: "lost", value: true });
        if (typeof e.fields.place === "string") out.push({ type: "set", entity: item, field: "place", value: null });
        return out;
      },
    });
    r.action({ id: "lose", label: "Lose something", pack: "gear", params: { item: { type: "ref", ref: "item" } }, requires: ["item.owner == self or carries(self, item)", "item.lost != true"], outcomes: { default: [{ type: "gear.lose", args: { item: "item" } }] }, duration: "1", lexicon: ["lost my", "lose", "can't find my", "is gone", "is missing"], observable: "searches their pockets" });
    r.action({ id: "drop", label: "Drop", pack: "gear", params: { item: { type: "ref", ref: "item" } }, requires: ["carries(self, item)"], outcomes: { default: [{ type: "gear.drop", args: { item: "item", place: "=here" } }] }, duration: "1", lexicon: ["drop", "put down", "leave"], observable: "puts something down" });
    r.action({ id: "give", label: "Give", pack: "gear", params: { item: { type: "ref", ref: "item" }, to: { type: "ref", ref: "person" } }, requires: ["carries(self, item)", "at(to, here)"], outcomes: { default: [{ type: "gear.give", args: { item: "item", from: "self", to: "to" } }] }, duration: "1", lexicon: ["give", "hand", "pass"], observable: "hands something over" });
    // Days or a said end, at least one: interpret fills whichever the player said ("until 7 tonight");
    // the palette always sends days.
    r.action({ id: "lend", label: "Lend", pack: "gear", params: { item: { type: "ref", ref: "item" }, to: { type: "ref", ref: "person" }, days: { type: "number", optional: true }, until: { type: "text", optional: true, label: "Until (a time: 7 pm, tonight, tomorrow)" } }, requires: ["item.owner == self", "days > 0 or params.until != null", "at(to, here) or at(item, here)"], outcomes: { default: [{ type: "gear.lend", args: { item: "item", to: "to", until: "=days > 0 ? clock + days(days) : 0", said: "=params.until" } }] }, duration: "2", lexicon: ["lend", "loan", "let borrow"], observable: "lends something" });
    r.action({ id: "reclaim", label: "Take back", pack: "gear", params: { item: { type: "ref", ref: "item" } }, requires: ["item.owner == self", "lent_out(item)"], outcomes: { default: [{ type: "gear.retrieve", args: { item: "item" } }] }, duration: "5", lexicon: ["take back", "get back", "reclaim"], observable: "takes something back" });
    r.action({ id: "wear", label: "Wear or equip", pack: "gear", params: { item: { type: "ref", ref: "item" } }, requires: ["carries(self, item) or place(item) == here", "level.gear >= 3"], outcomes: { default: [{ type: "gear.wear", args: { item: "item", wearer: "self" } }] }, duration: "2", lexicon: ["wear", "put on", "equip"], observable: "puts something on" });
    r.action({ id: "remove", label: "Take off", pack: "gear", params: { item: { type: "ref", ref: "item" } }, requires: ["carries(self, item)"], outcomes: { default: [{ type: "gear.remove", args: { item: "item" } }] }, duration: "2", lexicon: ["take off", "remove", "unequip"], observable: "takes something off" });
    r.action({ id: "use", label: "Use", pack: "gear", params: { item: { type: "ref", ref: "item" } }, requires: ["carries(self, item)"], outcomes: { default: [{ type: "gear.use", args: { item: "item", user: "self" } }] }, duration: "5", lexicon: ["use", "apply"], observable: "uses something" });
    r.action({ id: "take_piece", label: "Take from a kit", pack: "gear", params: { kit: { type: "ref", ref: "kit" }, piece: { type: "text" } }, requires: ["place(kit) == here or carries(self, kit)", "level.gear >= 3"], outcomes: { default: [{ type: "gear.take_piece", args: { kit: "kit", piece: "=piece", to: "self" } }] }, duration: "1", lexicon: ["take the", "grab a", "get a"], observable: "takes a tool" });

    r.process({
      id: "gear.grants",
      domain: "gear",
      minLevel: 1,
      step(slot, ctx) {
        const out: LedgerEvent[] = [];
        for (const g of grants(ctx.state)) {
          const thing = own(ctx.state.entities, g.thing);
          if (!thing || g.until === null || g.until > slot.end || thing.fields.overdue === true) continue;
          out.push({ type: "set", entity: g.thing, field: "overdue", value: true });
          const borrower = own(ctx.state.entities, g.borrower)?.name ?? g.borrower;
          out.push({ type: ENGINE_EVENTS.signal, data: { class: "overdue", text: `${thing.name} is overdue from ${borrower}.`, ...(g.owner ? { entity: g.owner } : {}) } });
        }
        return out;
      },
    });

    r.materializer({
      domain: "gear",
      version: 1,
      materialize(entity, ctx, rng) {
        const e = own(ctx.state.entities, entity);
        if (!e || ctx.levelOf(entity, "gear") < 2) return [];
        const out: LedgerEvent[] = [];
        if (kindIs(ctx.registry, ctx.world, e.kind, "person")) {
          // Everyone carries a wallet at Gear 2+, so cash has a place to live.
          const hasWallet = carriedBy(ctx.state, entity).some((id) => own(ctx.state.entities, id)?.fields.catalog === "wallet" || /wallet|purse/i.test(own(ctx.state.entities, id)?.name ?? ""));
          if (!hasWallet) {
            const w = spawn(ctx, { name: "Wallet", owner: entity, holder: entity, catalog: "wallet", kind: "container", salt: "materialize" });
            if (Array.isArray(w)) out.push(...w);
          }
          return out;
        }
        const stock = e.fields.stock;
        if (typeof stock === "string" && e.fields.sampled !== true) {
          const rows = Object.entries(ctx.tables.get("gear.items")?.rows ?? {}).filter(([, row]) => row.category === stock).map(([id]) => id).sort();
          const n = rows.length === 0 ? 0 : rng.int(2, 4);
          for (let i = 0; i < n; i++) {
            const id = rng.pick(rows);
            const row = rowOf(ctx, "gear.items", id);
            const made = spawn(ctx, { name: strOf(row?.name, id), owner: typeof e.fields.owner === "string" ? e.fields.owner : null, holder: entity, catalog: id, salt: `stock:${i}` });
            if (Array.isArray(made)) out.push(...made);
          }
          out.push({ type: "set", entity, field: "sampled", value: true });
        }
        return out;
      },
    });

    r.renderer({
      slot: "gear",
      render(ctx) {
        const pov = ctx.world.pov;
        const level = ctx.levelOf(pov, "gear");
        if (level === 0) return [];
        const carried = carriedBy(ctx.state, pov).filter((id) => own(ctx.state.entities, id)?.kind !== "account");
        const shown = carried.filter((id) => level >= 2 || own(ctx.state.entities, id)?.fields.notable === true);
        const lines: string[] = [];
        const label = (id: EntityId): string => {
          const e = own(ctx.state.entities, id);
          if (!e) return id;
          const qty = numOf(e.fields.qty, 1);
          const kit = level >= 3 ? kitStatus(ctx, id) : null;
          return `${e.name}${qty > 1 ? ` ×${qty}` : ""}${kit ? ` (${kit.present}/${kit.total})` : ""}`;
        };
        if (shown.length > 0) lines.push(`Carrying: ${shown.slice(0, 12).map(label).join(", ")}.`);
        if (level >= 3) {
          const worn = Object.keys(ctx.state.entities).filter((id) => own(ctx.state.entities, id)?.relations.some((x) => (x.type === "worn_by" || x.type === "equipped") && x.to === pov));
          if (worn.length > 0) lines.push(`Wearing: ${worn.map(label).join(", ")}.`);
        }
        for (const g of grants(ctx.state)) {
          if (g.owner === pov) lines.push(`Lent: ${own(ctx.state.entities, g.thing)?.name ?? g.thing} to ${own(ctx.state.entities, g.borrower)?.name ?? g.borrower}${g.overdue ? " (overdue)" : ""}.`);
          else if (g.borrower === pov) lines.push(`Borrowed: ${own(ctx.state.entities, g.thing)?.name ?? g.thing}${g.overdue ? " (overdue — should go back)" : ""}.`);
        }
        return lines;
      },
    });

    r.view({ panel: "gear.gear", build: (ctx) => buildGearView(ctx) as unknown as JsonValue });

    r.proposal({
      type: "give",
      boundField: "ref",
      validate(p, ctx) {
        const item = strOf(p.item);
        const e = own(ctx.state.entities, item);
        if (!own(ctx.state.entities, strOf(p.to))) return reject("missing_entity", `no recipient ${labelOf(ctx, strOf(p.to))}`);
        if (!e) {
          // Money handed over is a transfer, never a new item called "$20" or "cash".
          if (cashGift(item, ctx.world.currency)) return reject("is_money", "a cash give is a transfer");
          // Only an NPC can hand over something untracked; the POV can't give what it doesn't have.
          const from = strOf(p.from);
          return item !== "" && from !== "" && from !== ctx.world.pov && own(ctx.state.entities, from) ? null : reject("missing_entity", `no item ${labelOf(ctx, item)}`);
        }
        if (e.kind === "account") return reject("is_money", "a cash give is a transfer");
        return null;
      },
      toEffects: (p, ctx) => (own(ctx.state.entities, strOf(p.item)) ? [{ type: "gear.give", args: { item: strOf(p.item), from: strOf(p.from), to: strOf(p.to) } }] : [{ type: "gear.receive", args: { name: strOf(p.item), from: strOf(p.from), to: strOf(p.to) } }]),
    });
    r.proposal({
      type: "quantity",
      boundField: "number",
      validate(p, ctx) {
        const item = strOf(p.item);
        const e = own(ctx.state.entities, item);
        if (!e || !kindIs(ctx.registry, ctx.world, e.kind, "item")) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
        const delta = p.delta;
        if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) return reject("bad_proposal", "quantity needs a whole, non-zero delta");
        const who = strOf(p.entity);
        if (who !== "" && who !== e.fields.owner && !isInside(ctx.state, item, who)) return reject("not_holder", `${labelOf(ctx, who)} doesn't have ${e.name}`);
        // Capped per field: the item kind's `qty` bound, else the default.
        const cap = Math.abs(fieldDef(ctx.registry, ctx.world, e.kind, "qty")?.bound?.maxDelta ?? QTY_MAX_DELTA);
        return Math.abs(delta) > cap ? reject("over_bound", `a reply can change a quantity by at most ${cap}`) : null;
      },
      toEffects: (p) => [{ type: "add", args: { entity: strOf(p.item), field: "qty", delta: numOf(p.delta) } }],
    });

    r.lint({
      code: "gear.kits",
      check(world) {
        const issues = [];
        const table = world.tables["gear.kits"];
        for (const e of Object.values(world.entities)) {
          if (typeof e.fields.kit === "string" && table && !own(table.rows, e.fields.kit)) issues.push({ severity: "error" as const, code: "gear.kits", message: `${e.name} names an unknown kit ${e.fields.kit}.`, path: `entities.${e.id}.fields.kit` });
        }
        return issues;
      },
    });
  },
};

export default gearPack;
