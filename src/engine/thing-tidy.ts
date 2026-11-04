// Tidy up (ITEMS-SPEC §7.5, GM → Things): a deterministic audit of a chat's things, read from its
// head and the events on its path (`PathEvent`), each finding said in a sentence with the one GM edit
// that fixes it (item ops, so it lands through the one location writer, one edit with its own Undo)
// and, where no one answer fits, the fixes to choose from. It looks for:
//   1. a thing too big to carry on a person, or a vehicle on one: put at the buyer's home when it was
//      bought (its `got`, or a purchase it was made with, as older builds put every purchase on the
//      payer), else where the person is;
//   2. a thing both lying at a place and in a holder: kept at the place, where play reads it, or in
//      the holder;
//   3. a thing worn by someone but lying elsewhere: taken off them;
//   4. an owner a reply's read set on a handover from the owner who had it (a `set owner` grouped
//      with the `link in` to the new owner, as older builds read every give), still standing: its
//      owner's again, held by the one who has it;
//   5. a likely duplicate: two things of one head noun and one type with an owner in common or at
//      one place, one of them made in play; or one made beside a hidden thing it may be
//      (`maybe_same_as`): merged, keeping the world's own or the older;
//   6. a thing made in play whose size nothing gives: a size to pick;
//   7. a Gear or Place line the head turn's final review dropped or rewrote in the narrator's prompt
//      (`Rec.finalEdits`), which says the state may be wrong: the things it names, to look at.
// Secrecy is marks: a finding about a hidden or secret thing says so. Every turn tidies the first
// and third kinds' findings (`tidyTurn`), each its own unit with Undo, as play can't have them. Pure.

import { ownersIn } from "../shared/finance";
import type { FinalEdit } from "../shared/final-review";
import { hashParts } from "../shared/hash";
import type { EntityId, PlaceId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { LedgerEvent, Rec } from "../shared/ledger";
import type { EditOp } from "../shared/protocol";
import type { TidyFinding, TidyFix, TidyKind, TidyRun } from "../shared/thing-gm";
import { TIDY_KINDS } from "../shared/thing-gm";
import type { Spot } from "../shared/things";
import { gotOf, isSize, SIZE_LABELS, SIZES, sizeRank, thingsConfigOf } from "../shared/things";
import { possessive } from "../shared/words";
import { own } from "./pack-kit";
import { readPass } from "./read-pass";
import type { ReadContext } from "./registry";
import { isGone, kindIs, placeOfEntity } from "./scope";
import { flatPath, type PathEvent } from "./thing-gm";
import { thingIndex } from "./thing-index";
import { thingVisibility } from "./thing-view";
import { holderOf, holdersOf, holdsOf, possessorOf, sizeOf } from "./things";
import { applyItemOp } from "./thing-ops";
import type { Working } from "./working";

/** A head noun shared by more things than this is too common to pair them by (every "key" of a large world). */
const PAIR_LIMIT = 64;

/** How far up a chain of holders the scan follows. */
const DEPTH = 32;

/** A handover a reply's read made an owner change of: the thing, the owner who had it, and the one it went to. */
interface Handover {
  thing: EntityId;
  from: EntityId;
  to: EntityId;
}

/** What the path says that the head doesn't: who bought what, the read's handovers that changed an owner, and the order things were made in. */
interface PathFacts {
  bought: Map<EntityId, EntityId>;
  handovers: Map<EntityId, Handover>;
  order: Map<EntityId, number>;
}

/**
 * Reads the path's events in order, one change (a unit's `group`, else the unit) at a time, keeping
 * each thing's owner and holder as they stood before it: a purchase made with a thing marks its
 * payer the buyer, and in a reply's read an owner set to the one it was handed to, from an owner who
 * had it, is a handover's; any later change of that owner retires it.
 */
function readPath(ctx: ReadContext, path: readonly PathEvent[]): PathFacts {
  const bought = new Map<EntityId, EntityId>();
  const handovers = new Map<EntityId, Handover>();
  const order = new Map<EntityId, number>();
  const owner = new Map<EntityId, string | null>();
  const holder = new Map<EntityId, string | null>();
  const kinds = new Map<EntityId, string>();
  const ownerOf = (id: EntityId): string | null => {
    if (owner.has(id)) return owner.get(id) ?? null;
    const authored = own(ctx.world.entities, id)?.fields.owner;
    return typeof authored === "string" ? authored : null;
  };
  const holderAt = (id: EntityId): string | null => (holder.has(id) ? (holder.get(id) ?? null) : (own(ctx.world.entities, id)?.relations.find((r) => r.type === "in")?.to ?? null));
  const person = (id: EntityId): boolean => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? kinds.get(id) ?? "", "person");
  const possessorAt = (id: EntityId): string | null => {
    const seen = new Set<string>([id]);
    for (let at = holderAt(id); at !== null && !seen.has(at) && seen.size < DEPTH; at = holderAt(at)) {
      if (person(at)) return at;
      seen.add(at);
    }
    return null;
  };
  // One change at a time: consecutive events of a unit that share a group (or have none).
  const changes: { origin: PathEvent["origin"]; events: LedgerEvent[] }[] = [];
  let last = "";
  for (const p of flatPath(path)) {
    const key = `${p.unit}\u0000${p.event.group ?? ""}`;
    const current = changes.at(-1);
    if (current && key === last) current.events.push(p.event);
    else changes.push({ origin: p.origin, events: [p.event] });
    last = key;
  }
  for (const change of changes) {
    const purchase = change.events.find((e): e is Extract<LedgerEvent, { data: unknown }> => e.type === "economy.txn" && "data" in e && isRecord(e.data) && e.data.kind === "purchase");
    const found = new Map<EntityId, Handover>();
    for (const e of change.events) {
      if (e.type === "spawn") {
        order.set(e.entity.id, order.size);
        kinds.set(e.entity.id, e.entity.kind);
        const payer = purchase?.data.payer;
        const spawnedOwner = e.entity.fields.owner;
        if (purchase) bought.set(e.entity.id, typeof payer === "string" ? payer : typeof spawnedOwner === "string" ? spawnedOwner : ctx.world.pov);
      }
      if (change.origin !== "story" || e.type !== "set" || e.field !== "owner" || typeof e.value !== "string") continue;
      const to = e.value;
      const from = ownerOf(e.entity);
      if (!change.events.some((x) => x.type === "link" && x.rel === "in" && x.from === e.entity && x.to === to)) continue;
      if (from !== null && from !== to && person(from) && possessorAt(e.entity) === from) found.set(e.entity, { thing: e.entity, from, to });
    }
    for (const e of change.events) {
      if (e.type === "set" && (e.field === "owner" || e.field === "owners")) {
        if (!found.has(e.entity)) handovers.delete(e.entity);
        owner.set(e.entity, e.field === "owner" && typeof e.value === "string" ? e.value : null);
      } else if (e.type === "link" && e.rel === "in") holder.set(e.from, e.to);
      else if (e.type === "unlink" && e.rel === "in" && holderAt(e.from) === e.to) holder.set(e.from, null);
      else if (e.type === "spawn") {
        owner.set(e.entity.id, typeof e.entity.fields.owner === "string" ? e.entity.fields.owner : null);
        holder.set(e.entity.id, e.entity.relations.find((r) => r.type === "in")?.to ?? null);
      }
    }
    for (const [thing, h] of found) handovers.set(thing, h);
  }
  return { bought, handovers, order };
}

const move = (item: EntityId, to: Spot, why: string): EditOp => ({ op: "item", change: { do: "move", item, to, why } });

/** The prompt parts whose lines a final review's drop finding reads: the Gear and Place sections. */
const STATE_PARTS: Readonly<Record<string, string>> = { gear: "Gear", place: "Place" };

/** What a Tidy up read weighs beyond the head: the head turn's final review edits (the seventh kind), and, for a turn's tidy, only some kinds and things. */
export interface TidyOptions {
  finalEdits?: readonly FinalEdit[];
  kinds?: readonly TidyKind[];
  things?: ReadonlySet<EntityId>;
}

/** Whom a thing is worn by while it isn't on them (Tidy up's third kind), or null. */
function wornElsewhere(ctx: ReadContext, id: EntityId): EntityId | null {
  const worn = own(ctx.state.entities, id)?.relations.find((r) => r.type === "worn_by" || r.type === "equipped");
  return worn && !holdersOf(ctx.state, id).includes(worn.to) ? worn.to : null;
}

/**
 * Every finding on a chat's things (see the module's head), its kinds in `TIDY_KINDS` order, each
 * kind's by its sentence; `opts.kinds` and `opts.things` read only those.
 */
export function tidyFindings(ctx: ReadContext, path: readonly PathEvent[], opts: TidyOptions = {}): TidyFinding[] {
  return readPass(() => {
    const facts = readPath(ctx, path);
    const name = (id: string): string => own(ctx.state.entities, id)?.name ?? own(ctx.world.places, id)?.name ?? id;
    const isPerson = (id: string): boolean => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person");
    const made = (id: EntityId): boolean => !own(ctx.world.entities, id);
    const secret = (id: EntityId): boolean => {
      const v = thingVisibility(ctx, id);
      return v === "discoverable" || v === "secret" || v === "known_by";
    };
    const out: TidyFinding[] = [];
    const add = (kind: TidyKind, things: EntityId[], text: string, fix: TidyFix | null, choices: TidyFix[] = []): void => {
      out.push({ key: `${kind}:${things.join("+")}`, kind, things, text, fix, choices, secret: things.some(secret) });
    };
    const ceiling = thingsConfigOf(ctx.world).sizes.ceiling;
    const wanted = (kind: TidyKind): boolean => opts.kinds === undefined || opts.kinds.includes(kind);
    const things = thingIndex(ctx).things.filter((id) => !isGone(ctx.state, id));
    for (const id of opts.things ? things.filter((t) => opts.things?.has(t)) : things) {
      const e = own(ctx.state.entities, id);
      if (!e) continue;
      const holder = holderOf(ctx.state, id);
      const lying = typeof e.fields.place === "string" && e.fields.place !== "" ? e.fields.place : null;
      const size = sizeOf(ctx, id).size;
      const big = size === "vehicle" ? size : isSize(size) && sizeRank(size) > sizeRank(ceiling) ? size : null;
      // 1. Too big to carry, on a person.
      if (wanted("too_big") && holder !== null && lying === null && big !== null && isPerson(holder)) {
        const got = gotOf(e.fields.got);
        const buyer = facts.bought.get(id) ?? (got?.how === "bought" ? (ownersIn(e.fields)[0]?.party ?? holder) : undefined);
        const home = buyer !== undefined ? own(ctx.state.entities, buyer)?.fields.home : undefined;
        const homePlace = typeof home === "string" && own(ctx.world.places, home) ? home : null;
        const to: PlaceId | null = homePlace ?? placeOfEntity(ctx.state, holder);
        const why = big === "vehicle" ? "a vehicle goes only on another vehicle" : `too big to carry (${SIZE_LABELS[big]}; a person carries up to ${SIZE_LABELS[ceiling]})`;
        const where = to === null ? "" : homePlace !== null && buyer !== undefined ? ` It was bought: put it at ${name(to)}, where ${name(buyer)} lives?` : ` Put it at ${name(to)}, where ${name(holder)} is?`;
        add("too_big", [id], `${e.name} is on ${name(holder)}: ${why}.${where}`, to === null ? null : { label: `Put it at ${name(to)}`, ops: [move(id, { place: to }, homePlace !== null ? "Too big to carry: delivered to the buyer's home" : "Too big to carry: set down where they are")], done: `${e.name} is at ${name(to)} now.` });
      }
      // 2. Lying at a place and in a holder (on a person) at once.
      if (wanted("two_places") && holder !== null && lying !== null) {
        const held = `${isPerson(holder) ? "on" : "in"} ${name(holder)}`;
        const keepIn: TidyFix[] = holdsOf(ctx, holder) !== null ? [{ label: `Keep it ${held}`, ops: [move(id, { in: holder }, "One place at a time")], done: `${e.name} is ${held} now.` }] : [];
        add("two_places", [id], `${e.name} lies at ${name(lying)} and is ${held} at once; play reads it at ${name(lying)}.`, own(ctx.world.places, lying) ? { label: `Keep it at ${name(lying)}`, ops: [move(id, { place: lying }, "One place at a time")], done: `${e.name} lies at ${name(lying)} now, in nothing.` } : null, keepIn);
      }
      // 3. Worn by someone, lying elsewhere.
      const wearer = wanted("worn_elsewhere") ? wornElsewhere(ctx, id) : null;
      if (wearer !== null) {
        const at = lying !== null ? `lies at ${name(lying)}` : holder !== null ? `is ${isPerson(holder) ? "on" : "in"} ${name(holder)}` : "is nowhere";
        add("worn_elsewhere", [id], `${e.name} ${at}, yet ${name(wearer)} still wears it.`, { label: `Take it off ${name(wearer)}`, ops: [{ op: "item", change: { do: "wear", item: id, who: wearer, off: true } }], done: `${name(wearer)} doesn't wear ${e.name} now.` });
      }
      // 6. Made in play, its size nothing gives.
      if (wanted("size_unknown") && made(id) && size === "unknown") {
        add(
          "size_unknown",
          [id],
          `${e.name} was made in play, and nothing gives its size (its type, volume or category), so play treats it as portable. What size is it?`,
          null,
          SIZES.map((s) => ({ label: SIZE_LABELS[s], ops: [{ op: "item", change: { do: "label", item: id, size: s } }], done: `${e.name} is ${SIZE_LABELS[s]} now.` })),
        );
      }
    }
    // 4. An owner a handover set in a reply's read, still standing.
    for (const h of wanted("handover_owner") ? facts.handovers.values() : []) {
      const e = own(ctx.state.entities, h.thing);
      const owners = e ? ownersIn(e.fields).map((o) => o.party) : [];
      if (!e || isGone(ctx.state, h.thing) || !own(ctx.state.entities, h.from) || isGone(ctx.state, h.from) || owners.length !== 1 || owners[0] !== h.to || Array.isArray(e.fields.owners)) continue;
      const held = possessorOf(ctx, h.thing) === h.to;
      const ops: EditOp[] = [{ op: "item", change: { do: "own", item: h.thing, owner: h.from, why: "A handover keeps the owner" } }, ...(held ? [{ op: "item", change: { do: "grant", item: h.thing, who: h.to, basis: "hold", by: h.from } } satisfies EditOp] : [])];
      add("handover_owner", [h.thing], `${e.name} became ${possessive(name(h.to))} when ${name(h.from)} handed it over in a reply. A handover keeps the owner unless the story says it was a gift, a sale or a trade.`, { label: `Make it ${possessive(name(h.from))} again`, ops, done: held ? `${e.name} is ${possessive(name(h.from))} again, held by ${name(h.to)}.` : `${e.name} is ${possessive(name(h.from))} again.` });
    }
    // 5. Likely duplicates.
    const index = thingIndex(ctx);
    const heads = new Map<string, EntityId[]>();
    if (wanted("duplicate")) for (const id of things) for (const head of new Set(index.names.get(id)?.find((n) => n.by === "name")?.heads ?? [])) heads.set(head, [...(heads.get(head) ?? []), id]);
    const typeOf = (id: EntityId): string | null => {
      const catalog = own(ctx.state.entities, id)?.fields.catalog;
      return typeof catalog === "string" && catalog !== "" ? catalog : null;
    };
    const pairs = new Map<string, { a: EntityId; b: EntityId; why: string }>();
    for (const ids of heads.values()) {
      if (ids.length < 2 || ids.length > PAIR_LIMIT) continue;
      for (const [i, a] of ids.entries()) {
        for (const b of ids.slice(i + 1)) {
          if ((!made(a) && !made(b)) || typeOf(a) !== typeOf(b) || holdersOf(ctx.state, a).includes(b) || holdersOf(ctx.state, b).includes(a)) continue;
          const ownersB = new Set(ownersIn(own(ctx.state.entities, b)?.fields ?? {}).map((o) => o.party));
          const shared = ownersIn(own(ctx.state.entities, a)?.fields ?? {}).find((o) => ownersB.has(o.party))?.party;
          const at = placeOfEntity(ctx.state, a);
          const why = shared !== undefined ? `both ${possessive(name(shared))}` : at !== null && at === placeOfEntity(ctx.state, b) ? `both at ${name(at)}` : null;
          if (why !== null) pairs.set([a, b].sort().join("+"), { a, b, why });
        }
      }
    }
    for (const id of wanted("duplicate") ? things : []) {
      const same = own(ctx.state.entities, id)?.fields.maybe_same_as;
      // One holding the other is no duplicate, as for the name pairs: merging them would put a thing inside itself.
      if (typeof same === "string" && same !== id && own(ctx.state.entities, same) && !isGone(ctx.state, same) && !holdersOf(ctx.state, id).includes(same) && !holdersOf(ctx.state, same).includes(id)) pairs.set([id, same].sort().join("+"), { a: same, b: id, why: "made beside a hidden one it may be" });
    }
    const at = (id: EntityId): string => {
      const who = possessorOf(ctx, id);
      const place = placeOfEntity(ctx.state, id);
      return who !== null ? `on ${name(who)}` : place !== null ? `at ${name(place)}` : "nowhere";
    };
    for (const { a, b, why } of pairs.values()) {
      // The one made in play goes; of two, the later made.
      const drop = made(a) && made(b) ? ((facts.order.get(a) ?? -1) > (facts.order.get(b) ?? -1) ? a : b) : made(a) ? a : b;
      const keep = drop === a ? b : a;
      add("duplicate", [keep, drop].sort(), `${name(keep)} (${at(keep)}) and ${name(drop)} (${at(drop)}, made in play) may be the same thing: ${why}.`, { label: `Merge into ${name(keep)}`, ops: [{ op: "item", change: { do: "merge", keep, drop } }], done: `${name(drop)} is merged into ${name(keep)}.` });
    }
    // 7. A Gear or Place line the head turn's final review took out of the narrator's prompt, or rewrote.
    for (const edit of wanted("final_dropped") ? (opts.finalEdits ?? []) : []) {
      const part = STATE_PARTS[edit.part];
      if (edit.op === "append" || part === undefined) continue;
      const said = edit.line.toLowerCase();
      const named = things.filter((id) => {
        const n = own(ctx.state.entities, id)?.name.toLowerCase() ?? "";
        return n.length >= 3 && said.includes(n);
      });
      const how = edit.op === "drop" ? "took this line out of" : `rewrote this line in`;
      const then = edit.op === "replace" ? ` as "${edit.text}"` : "";
      out.push({ key: `final_dropped:${edit.part}:${hashParts("lre.tidy.final", edit.line).slice(0, 12)}`, kind: "final_dropped", things: named.slice(0, 8), text: `The last turn's final review ${how} the narrator's ${part} section${then}: "${edit.line}". A line it can't use often means the things are wrong: look at what it names.`, fix: null, choices: [], secret: named.some(secret) });
    }
    return out.sort((x, y) => TIDY_KINDS.indexOf(x.kind) - TIDY_KINDS.indexOf(y.kind) || x.text.localeCompare(y.text) || x.key.localeCompare(y.key));
  });
}

/** A Tidy up run: the findings not left, at most `limit` of them, with how many there are and how many were left, and the left ones, at most `limit` too. */
export function tidyRun(all: readonly TidyFinding[], left: ReadonlySet<string>, limit: number): TidyRun {
  const standing = all.filter((f) => !left.has(f.key));
  const out = all.filter((f) => left.has(f.key));
  return { findings: standing.slice(0, limit), total: standing.length, left: out.length, limit, leftOut: out.slice(0, limit) };
}

/**
 * The group of the Things tidied fix's units (ITEMS-SPEC §9): a turn's tidy writes each finding it
 * puts right as its own unit, `gear.tidied:<the finding's key>`; the one-time fix of an earlier
 * build wrote `gear.tidied` alone.
 */
export const TIDIED_GROUP = "gear.tidied";

/** Whether an event's group is a Things tidied unit's (`TIDIED_GROUP`, alone or with its finding's key). */
export function isTidiedGroup(group: string | undefined): boolean {
  return group !== undefined && (group === TIDIED_GROUP || group.startsWith(`${TIDIED_GROUP}:`));
}

/**
 * The things whose tidy the player undid (ITEMS-SPEC §9), each with whom it was taken off or out
 * of, from the chain's records oldest first: a later tidy of it that stands forgets the Undo.
 */
export function tidyUndone(records: readonly Pick<Rec, "events" | "undone">[]): Map<EntityId, EntityId> {
  const out = new Map<EntityId, EntityId>();
  for (const rec of records) {
    const undone = new Set(rec.undone.flatMap((r) => (r.in === "events" ? [r.index] : [])));
    rec.events.forEach((e, i) => {
      if (!isTidiedGroup(e.group) || e.type !== "unlink" || (e.rel !== "in" && e.rel !== "worn_by" && e.rel !== "equipped")) return;
      if (undone.has(i)) out.set(e.from, e.to);
      else out.delete(e.from);
    });
  }
  return out;
}

/** What a turn's tidy reads beyond the head (`tidyTurn`). */
export interface TidyTurnInput {
  /** The events on the chain's path, read only when the scan finds something to put right. */
  path: () => readonly PathEvent[];
  /** The findings left as they are in this chat (Leave it), by key. */
  left: ReadonlySet<string>;
  /** The chain's turn records, oldest first, for the player's Undo of an earlier tidy. */
  records: readonly Pick<Rec, "events" | "undone">[];
}

/**
 * Every turn's tidy of impossible holds (ITEMS-SPEC §9), before the turn reads: a thing too big to
 * carry on a person put at the buyer's home when it was bought, else where the person is; a thing
 * worn by someone but lying elsewhere taken off them. A cheap scan of the head finds them, and only
 * then is the path read. Each is put right as its own unit (`gear.tidied:<key>`), a confirmed
 * change, so a Built-in thing moves too; one left as it is (Leave it), or whose tidy the player
 * undid while it stays on that person, stays as it is. Its events; none when nothing needs it.
 */
export function tidyTurn(w: Working, input: TidyTurnInput): LedgerEvent[] {
  const ctx = w.ctx;
  const hits = readPass(() => {
    const ceiling = sizeRank(thingsConfigOf(ctx.world).sizes.ceiling);
    const out: { key: string; thing: EntityId; on: EntityId }[] = [];
    for (const id of thingIndex(ctx).things) {
      if (isGone(ctx.state, id)) continue;
      const holder = holderOf(ctx.state, id);
      const lying = own(ctx.state.entities, id)?.fields.place;
      if (holder !== null && (typeof lying !== "string" || lying === "") && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, holder)?.kind ?? "", "person")) {
        const size = sizeOf(ctx, id).size;
        if (size === "vehicle" || (isSize(size) && sizeRank(size) > ceiling)) out.push({ key: `too_big:${id}`, thing: id, on: holder });
      }
      const wearer = wornElsewhere(ctx, id);
      if (wearer !== null) out.push({ key: `worn_elsewhere:${id}`, thing: id, on: wearer });
    }
    return out;
  });
  if (hits.length === 0) return [];
  const undone = tidyUndone(input.records);
  const due = hits.filter((h) => !input.left.has(h.key) && undone.get(h.thing) !== h.on);
  if (due.length === 0) return [];
  const keys = new Set(due.map((h) => h.key));
  const from = w.events.length;
  for (const finding of tidyFindings(ctx, input.path(), { kinds: ["too_big", "worn_elsewhere"], things: new Set(due.map((h) => h.thing)) })) {
    if (!keys.has(finding.key)) continue;
    const start = w.events.length;
    for (const op of finding.fix?.ops ?? []) {
      if (op.op !== "item" || op.change.do === "remove") continue;
      const mark = w.mark();
      if ("code" in applyItemOp(w, op.change, { by: "engine", confirmed: true, gm: true, salt: `tidied:${finding.key}`, viewer: w.world.pov })) w.restore(mark);
    }
    for (let i = start; i < w.events.length; i++) {
      const e = w.events[i];
      if (e) w.events[i] = { ...e, group: `${TIDIED_GROUP}:${finding.key}` };
    }
  }
  return w.events.slice(from);
}
