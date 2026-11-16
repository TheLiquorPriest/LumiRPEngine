// One tree, at any zoom (plan §6.4): the engine's own data read as one nested tree. The world holds
// its places, places hold places, and every entity sits where today's engine already says it is:
// inside what holds it (`in`), else at its place, else, for a group, inside the group it belongs
// to, under the groups; anything else is elsewhere. Nothing here is inferred.
//
// Each level shows its values with where they come from: its own; for a place, those the places
// above it set and it does not; for a member of a group, those its groups set and it does not, the
// nearest group first (a level's own value always wins), except the fields that only describe a
// level; and those a game system keeps its own way (time, weather, coin, entry), named by the
// system, so what the tree shows is what the sums use. Beside each value stand the facts recorded
// on that level with the same key (plan §6.6): neither overwrites the other, and each says how
// exact it is and the turn it is from. Each level carries a reflection of what is beneath it, made
// from recorded values whenever the state is read: how many people, things and places, who of
// note, what is open, the last turn that changed something there, and an agent's own line.
//
// A query is a point and a depth. It returns data: lines, each with its kind and its values, the
// same shape at every level. No word here reaches an agent: `renderView` words a view with a part.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { tierBand, tierLabel } from "../shared/tiers";
import { formatMoney, trackOwner, type WorldDoc } from "../shared/world";
import { calendarOf, formatClock, placeOffset, placeZone } from "../engine/calendar";
import { setEntryOf } from "../engine/org";
import { optionalQuery, own } from "../engine/pack-kit";
import { readPass } from "../engine/read-pass";
import type { ReadContext } from "../engine/registry";
import type { EntityState } from "../engine/state";
import { isGone, kindDef, kindIs, WALK_SETTINGS, walkCuts } from "../engine/scope";
import { isOpened } from "../packs/economy/core/journal";
import { openerOf } from "../packs/economy/core/model";
import { cashAccount } from "../packs/economy/core/pay";
import { BLANK_REVISION, clockRecorded } from "./blank";
import { standing } from "./facts";
import type { FoldEnv } from "./fold";
import type { Fact, Mark, StoreState, Touched } from "./types";
import type { View, ViewLine } from "./words";

export interface ViewOptions {
  /** Fields that describe a level itself and never pass down to what is inside it. */
  ownOnly: readonly string[];
  /** How many names of note a reflection gives. */
  notable: number;
}

/** What a level of the tree is: the world, a place, an entity, or one of the two levels the tree adds (the groups, and what is elsewhere). */
export type NodeKind = "world" | "place" | "entity" | "groups" | "elsewhere";
type Category = "person" | "group" | "thing" | "record";

interface Node {
  ref: string;
  id: string;
  kind: NodeKind;
  /** Its name in the data; null for the two levels the tree adds. */
  name: string | null;
  /** An entity's kind, by its label in the world. */
  what: string | null;
  parent: string | null;
  children: string[];
  category: Category | null;
  gone: boolean;
  /** What is beneath it. */
  people: number;
  things: number;
  places: number;
  groups: number;
  records: number;
  /** Names of note beneath it, best first, at most `notable`. */
  notable: { rank: number; name: string }[];
  open: number;
  changed: Touched | null;
}

/** Where a value comes from when it is not the level's own setting. */
export type From = {
  /** The game system that keeps it its own way: `calendar`, `weather`, `orgs`, `economy`. */
  system?: string;
  /** The level above that sets it (a place, a group, the world). */
  ref?: string;
  name?: string;
};

/**
 * One value of a level: its key (the data's own, or a code the part words: `time`, `time_zone`,
 * `currency`, `tier`, `life`, `coin`, `posted`, `members`, `weather`, `entry`), its value as text
 * (null: none), where it comes from (absent: its own), and the change that last wrote it, where one
 * did.
 */
export type ValueLine = {
  key: string;
  value: string | null;
  from?: From;
  mark?: Mark;
};

/** What is beneath a level (§6.4), as data. */
export type Reflection = {
  people: number;
  things: number;
  places: number;
  groups: number;
  records: number;
  /** Names of note, best first. */
  notable: string[];
  /** Tracks still in progress there. */
  open: number;
  /** The number of the last turn that changed something there. */
  changed: number | null;
  /** An agent's own line on the level. */
  note: string | null;
};

/** A level of the tree as data: what a query shows of it. */
export interface NodeView {
  ref: string;
  kind: NodeKind;
  /** Its name in the data; null for the groups and for what is elsewhere. */
  name: string | null;
  /** An entity's kind, by its label; null for any other level. */
  what: string | null;
  reflection: Reflection;
  values: ValueLine[];
  /** The facts standing on it. */
  facts: Fact[];
  children: string[];
  parent: string | null;
}

/** Which values a level's lines carry: none, its own (with what systems keep), or all (with what it inherits). */
export type ValuesShown = "none" | "own" | "all";

const ORDER: Record<NodeKind, number> = { world: 0, place: 1, entity: 2, groups: 3, elsewhere: 4 };
const CATEGORY_ORDER: Record<Category, number> = { person: 0, group: 1, thing: 2, record: 3 };

/** A JSON value as one line of text; null when there is none. */
function show(v: JsonValue | undefined): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) return v.map((x) => show(x) ?? "").join(", ");
  return JSON.stringify(v);
}

/** A reflection as the pieces a level's line carries: one per part there is something in, each worded by the part's `reflection_<name>` line. */
function reflectionPieces(r: Reflection): JsonObject[] {
  const pieces: JsonObject[] = [];
  const count = (name: string, n: number, extra: JsonObject = {}): void => {
    if (n > 0) pieces.push({ kind: `reflection_${name}`, fields: { n, one: n === 1, ...extra } });
  };
  count("people", r.people, r.notable.length > 0 ? { notable: { names: r.notable } } : {});
  count("things", r.things);
  count("places", r.places);
  count("groups", r.groups);
  count("records", r.records);
  count("open", r.open);
  if (r.changed !== null) pieces.push({ kind: "reflection_changed", fields: { turn: r.changed } });
  if (r.note !== null) pieces.push({ kind: "reflection_note", fields: { text: r.note } });
  return pieces;
}

/** A mark's fields on a line: the turn's number and, where recorded, how exact, how sure and from where. */
export function markFields(mark: Mark | undefined): JsonObject {
  if (!mark) return {};
  const out: JsonObject = { turn: mark.n };
  if (mark.precision !== null) out.precision = mark.precision;
  if (mark.standing !== null) out.standing = mark.standing;
  if (mark.source !== null) out.source = mark.source;
  else out.unsourced = true;
  return out;
}

/** A fact as a line's fields. */
export function factFields(f: Fact): JsonObject {
  const out: JsonObject = { id: f.id, key: f.key, value: f.value, turn: f.n };
  if (f.precision !== null) out.precision = f.precision;
  if (f.standing !== null) out.standing = f.standing;
  if (f.source !== null) out.source = f.source;
  else out.unsourced = true;
  if (f.by !== null) out.by = f.by;
  return out;
}

/** A value as a line's fields; `facts` is how many facts with its key stand beside it. */
function valueFields(v: ValueLine, facts: number): JsonObject {
  const out: JsonObject = { key: v.key, ...markFields(v.mark) };
  if (v.value !== null) out.value = v.value;
  if (v.from?.system !== undefined) out.system = v.from.system;
  if (v.from?.ref !== undefined) out.from = { ref: v.from.ref, name: v.from.name ?? null, ...(v.from.ref === "world" ? { world: true } : {}) };
  if (facts > 0) out.facts = facts;
  return out;
}

export class TreeView {
  private readonly nodes = new Map<string, Node>();
  private readonly doc: WorldDoc;
  /** Agents' own lines by the level each names now. */
  private readonly notes = new Map<string, string>();
  private readonly ctx: ReadContext;

  constructor(
    readonly env: FoldEnv,
    readonly state: StoreState,
    private readonly options: ViewOptions,
  ) {
    const doc = env.worlds(state.world.revision);
    if (!doc) throw new Error(`the world revision ${state.world.revision} is not available`);
    this.ctx = env.registry.context(doc, state.world);
    // The world as this chat plays it: its own places and those play made or changed.
    this.doc = this.ctx.world;
    readPass(() => this.build());
  }

  /** The world as the chat plays it. */
  get world(): WorldDoc {
    return this.doc;
  }

  private add(node: Omit<Node, "children" | "people" | "things" | "places" | "groups" | "records" | "notable" | "open" | "changed">): void {
    this.nodes.set(node.ref, { ...node, children: [], people: 0, things: 0, places: 0, groups: 0, records: 0, notable: [], open: 0, changed: null });
  }

  private categoryOf(e: EntityState): Category {
    const reg = this.env.registry;
    if (kindIs(reg, this.doc, e.kind, "person")) return "person";
    if (kindIs(reg, this.doc, e.kind, "group")) return "group";
    if (kindIs(reg, this.doc, e.kind, "item")) return "thing";
    return "record";
  }

  private addGroups(): void {
    if (!this.nodes.has("groups")) this.add({ ref: "groups", id: "groups", kind: "groups", name: null, what: null, parent: "world", category: null, gone: false });
  }

  private addElsewhere(): void {
    if (!this.nodes.has("elsewhere")) this.add({ ref: "elsewhere", id: "elsewhere", kind: "elsewhere", name: null, what: null, parent: "world", category: null, gone: false });
  }

  private build(): void {
    const doc = this.doc;
    const entities = this.state.world.entities;
    // A world with no name (the blank one) has none to show: the part says what it is.
    this.add({ ref: "world", id: "world", kind: "world", name: doc.name === "" ? null : doc.name, what: null, parent: null, category: null, gone: false });
    for (const [id, p] of Object.entries(doc.places)) {
      const parent = p.parent !== undefined && own(doc.places, p.parent) ? `place:${p.parent}` : "world";
      this.add({ ref: `place:${id}`, id, kind: "place", name: p.name, what: null, parent, category: null, gone: false });
    }
    for (const id of Object.keys(entities).sort()) {
      const e = entities[id] as EntityState;
      const category = this.categoryOf(e);
      const holder = e.relations.find((r) => r.type === "in")?.to;
      const place = typeof e.fields.place === "string" ? e.fields.place : "";
      let parent: string;
      if (holder !== undefined && own(entities, holder)) parent = `entity:${holder}`;
      else if (place !== "" && own(doc.places, place)) parent = `place:${place}`;
      else if (category === "group") {
        const within = e.relations.find((r) => r.type === "member_of" && own(entities, r.to) && this.categoryOf(entities[r.to] as EntityState) === "group")?.to;
        parent = within !== undefined ? `entity:${within}` : "groups";
        if (within === undefined) this.addGroups();
      } else {
        parent = "elsewhere";
        this.addElsewhere();
      }
      const label = kindDef(this.env.registry, doc, e.kind)?.label ?? e.kind;
      this.add({ ref: `entity:${id}`, id, kind: "entity", name: e.name, what: label, parent, category, gone: isGone(this.state.world, id) });
    }
    this.breakLoops();
    for (const node of this.nodes.values()) if (node.parent !== null) this.nodes.get(node.parent)?.children.push(node.ref);
    for (const node of this.nodes.values()) node.children.sort((a, b) => this.compare(a, b));
    this.aggregate();
    for (const [at, note] of Object.entries(this.state.notes)) {
      const ref = this.resolve(at);
      if (ref !== null) this.notes.set(ref, note.text);
    }
  }

  /**
   * Every level must reach the world. Where a chain of parents loops (an `in` or `member_of` cycle in
   * the data), the last level walked before the loop closes is put elsewhere, and the walk is tried again.
   */
  private breakLoops(): void {
    const reaches = new Set<string>(["world"]);
    for (const start of [...this.nodes.values()]) {
      for (;;) {
        const seen: Node[] = [];
        let at: Node | undefined = start;
        while (at && !reaches.has(at.ref) && !seen.includes(at)) {
          seen.push(at);
          at = at.parent === null ? undefined : this.nodes.get(at.parent);
        }
        if (at && reaches.has(at.ref)) {
          for (const n of seen) reaches.add(n.ref);
          break;
        }
        this.addElsewhere();
        const last = seen.at(-1);
        if (!last) break;
        last.parent = "elsewhere";
      }
    }
  }

  private compare(a: string, b: string): number {
    const x = this.nodes.get(a) as Node;
    const y = this.nodes.get(b) as Node;
    const kind = ORDER[x.kind] - ORDER[y.kind];
    if (kind !== 0) return kind;
    const cat = (x.category ? CATEGORY_ORDER[x.category] : 0) - (y.category ? CATEGORY_ORDER[y.category] : 0);
    return cat !== 0 ? cat : (x.name ?? "").localeCompare(y.name ?? "") || x.id.localeCompare(y.id);
  }

  /** Counts, names of note, what is open and the last change, summed up the tree from the leaves. */
  private aggregate(): void {
    const opens = new Map<string, number>();
    for (const [id, t] of Object.entries(this.doc.tracks)) {
      const stage = this.state.world.tracks[id]?.stage ?? t.start;
      if ((own(t.stages, stage)?.next.length ?? 0) === 0) continue;
      const owner = trackOwner(t);
      const ref = owner !== undefined && this.nodes.has(`entity:${owner}`) ? `entity:${owner}` : "world";
      opens.set(ref, (opens.get(ref) ?? 0) + 1);
    }
    const order: Node[] = [];
    const stack: Node[] = [this.nodes.get("world") as Node];
    while (stack.length > 0) {
      const node = stack.pop() as Node;
      order.push(node);
      for (const c of node.children) stack.push(this.nodes.get(c) as Node);
    }
    for (const node of order.reverse()) {
      node.open += opens.get(node.ref) ?? 0;
      const own = this.state.touched[node.ref];
      if (own && (!node.changed || own.n > node.changed.n)) node.changed = own;
      const parent = node.parent === null ? undefined : this.nodes.get(node.parent);
      if (!parent) continue;
      parent.people += node.people;
      parent.things += node.things;
      parent.places += node.places;
      parent.groups += node.groups;
      parent.records += node.records;
      parent.open += node.open;
      if (node.changed && (!parent.changed || node.changed.n > parent.changed.n)) parent.changed = node.changed;
      let names = [...parent.notable, ...node.notable];
      if (!node.gone) {
        if (node.kind === "place") parent.places++;
        else if (node.category === "person") {
          parent.people++;
          const e = this.state.world.entities[node.id] as EntityState;
          const band = tierBand(this.doc, e.tier);
          const rank = band === "principal" ? 0 : band === "supporting" ? 1 : e.agent ? 2 : -1;
          if (rank >= 0) names.push({ rank, name: node.name ?? node.id });
        } else if (node.category === "group") parent.groups++;
        else if (node.category === "thing") parent.things++;
        else if (node.category === "record") parent.records++;
      }
      names = names.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
      parent.notable = names.slice(0, this.options.notable);
    }
  }

  /** The tree ref `at` names: `world`, `groups`, `elsewhere`, `place:<id>`, `entity:<id>`, or a bare id (a place before an entity). */
  resolve(at: string): string | null {
    if (this.nodes.has(at)) return at;
    if (this.nodes.has(`place:${at}`)) return `place:${at}`;
    if (this.nodes.has(`entity:${at}`)) return `entity:${at}`;
    return null;
  }

  /** The level a level sits in: null for the world, and for nothing called `ref`. */
  parentOf(ref: string): string | null {
    return this.nodes.get(ref)?.parent ?? null;
  }

  /** The levels in a level, in the tree's order. */
  childrenOf(ref: string): readonly string[] {
    return this.nodes.get(ref)?.children ?? [];
  }

  /** A level's name in the data: null for the two levels the tree adds, a world with no name, and nothing called `ref`. */
  nameOf(ref: string): string | null {
    return this.nodes.get(ref)?.name ?? null;
  }

  private reflectionOf(node: Node): Reflection {
    return {
      people: node.people,
      things: node.things,
      places: node.places,
      groups: node.groups,
      records: node.records,
      notable: node.notable.map((x) => x.name),
      open: node.open,
      changed: node.changed?.n ?? null,
      note: this.notes.get(node.ref) ?? null,
    };
  }

  /** A level's own line as data: what it is, its marks, and its reflection. */
  private levelLine(node: Node, depth: number): ViewLine {
    const fields: JsonObject = { ref: node.ref, id: node.id };
    if (node.name !== null) fields.name = node.name;
    if (node.what !== null) fields.what = node.what;
    if (node.kind === "entity") {
      const e = this.state.world.entities[node.id] as EntityState;
      const holder = node.parent?.startsWith("entity:") ? node.parent.slice("entity:".length) : null;
      if (holder !== null && e.relations.some((r) => r.type === "worn_by" && r.to === holder)) fields.worn = true;
      if (holder !== null && e.relations.some((r) => r.type === "equipped" && r.to === holder)) fields.equipped = true;
      if (node.gone) fields.gone = true;
    }
    const pieces = reflectionPieces(this.reflectionOf(node));
    if (pieces.length > 0) fields.reflection = { pieces };
    return { kind: `level_${node.kind}`, depth, fields };
  }

  /** A place's own fields and those of the places above it, nearest first. */
  private placeChain(place: string | null): { id: string; name: string; fields: Record<string, JsonValue> }[] {
    const out: { id: string; name: string; fields: Record<string, JsonValue> }[] = [];
    for (let id = place ?? undefined, guard = 0; id !== undefined && guard < 64; guard++) {
      const p = own(this.doc.places, id);
      if (!p || out.some((x) => x.id === id)) break;
      out.push({ id, name: p.name, fields: p.fields });
      id = p.parent;
    }
    return out;
  }

  /** The groups an entity belongs to, nearest first: its own, in the order it records them, then theirs. */
  private groupChain(id: string): { id: string; name: string; fields: Record<string, JsonValue> }[] {
    const entities = this.state.world.entities;
    const out: { id: string; name: string; fields: Record<string, JsonValue> }[] = [];
    const queue = [id];
    const seen = new Set<string>([id]);
    while (queue.length > 0) {
      const at = own(entities, queue.shift() as string);
      for (const r of at?.relations ?? []) {
        if (r.type !== "member_of" || seen.has(r.to)) continue;
        const g = own(entities, r.to);
        if (!g || this.categoryOf(g) !== "group") continue;
        seen.add(r.to);
        out.push({ id: r.to, name: g.name, fields: g.fields });
        queue.push(r.to);
      }
    }
    return out;
  }

  /** What the game systems keep their own way, for a place: its local time (at the query's own point, where the clock is a recorded value), weather and entry. */
  private placeSystems(id: string, root: boolean): ValueLine[] {
    const out: ValueLine[] = [];
    const clock = this.state.world.clock;
    if (root && clockRecorded(this.state)) out.push({ key: "time", value: formatClock(calendarOf(this.doc), clock, placeOffset(this.doc, clock, id)), from: { system: "calendar" }, ...this.timeMark() });
    const sky = optionalQuery(this.ctx, "weather.sky")?.(this.ctx, id) ?? null;
    if (sky !== null) out.push({ key: "weather", value: sky, from: { system: "weather" } });
    const entry = setEntryOf(this.ctx, id);
    if (entry) out.push({ key: "entry", value: entry.entry, from: entry.at === id ? { system: "orgs" } : { system: "orgs", ref: `place:${entry.at}`, name: own(this.doc.places, entry.at)?.name ?? entry.at } });
    return out;
  }

  /** The change that last set the clock, for a time line; none before one did. */
  private timeMark(): { mark?: Mark } {
    const mark = this.state.marks.world?.time;
    return mark ? { mark } : {};
  }

  /**
   * What last moved a person's coin: the economy reads it from the cash account they carry, its
   * balance once the account is open (until then its opening amount, the world's own value, which no
   * change wrote), so it is that account's posting mark, with the least exact precision of any posting.
   */
  private coinMark(who: string): { mark?: Mark } {
    const account = cashAccount(this.ctx, who);
    if (account === null || !isOpened(this.state.world, account, openerOf(this.state.world, account))) return {};
    const mark = this.state.marks[`entity:${account}`]?.posted;
    return mark ? { mark } : {};
  }

  /** A level's values: system values first, then its own, then (with `inherited`) what it takes from the levels above it. */
  values(ref: string, root = true): ValueLine[] {
    const node = this.nodes.get(ref);
    if (!node) return [];
    return readPass(() => this.valuesOf(node, root));
  }

  private valuesOf(node: Node, inherited: boolean): ValueLine[] {
    const doc = this.doc;
    const lines: ValueLine[] = [];
    let ownFields: Record<string, JsonValue> = {};
    if (node.kind === "world") {
      // The blank world's calendar and currency are the authoring template's, which nobody set: its
      // time shows once play sets the clock, its time zone and currency once a world is attached.
      if (clockRecorded(this.state)) lines.push({ key: "time", value: formatClock(calendarOf(doc), this.state.world.clock), from: { system: "calendar" }, ...this.timeMark() });
      if (this.state.world.revision !== BLANK_REVISION) {
        lines.push({ key: "time_zone", value: doc.calendar.timeZone });
        lines.push({ key: "currency", value: `${doc.currency.code} (${doc.currency.symbol})` });
      }
      return lines;
    }
    const marks = this.state.marks[node.ref] ?? {};
    let above: { id: string; name: string; fields: Record<string, JsonValue> }[] = [];
    let aboveRef = (id: string): string => `place:${id}`;
    if (node.kind === "place") {
      const p = own(doc.places, node.id);
      lines.push(...this.placeSystems(node.id, inherited));
      ownFields = p?.fields ?? {};
      if (p?.timeZone) lines.push({ key: "time_zone", value: p.timeZone });
      else if (inherited) {
        const zone = placeZone(doc, node.id);
        const setter = this.placeChain(node.id).find((x) => own(doc.places, x.id)?.timeZone === zone);
        if (setter) lines.push({ key: "time_zone", value: zone, from: { ref: `place:${setter.id}`, name: setter.name } });
        else if (this.state.world.revision !== BLANK_REVISION) lines.push({ key: "time_zone", value: zone, from: { ref: "world", name: doc.name } });
      }
      if (inherited) above = this.placeChain(p?.parent ?? null);
    } else if (node.kind === "entity") {
      const e = this.state.world.entities[node.id] as EntityState;
      lines.push({ key: "tier", value: tierLabel(doc, e.tier), ...(marks.tier ? { mark: marks.tier } : {}) });
      if (e.life !== undefined) lines.push({ key: "life", value: e.life, ...(marks.life ? { mark: marks.life } : {}) });
      if (node.category === "person" || node.category === "group") {
        const cash = optionalQuery(this.ctx, "economy.carried_cash")?.(this.ctx, node.id) ?? null;
        if (cash !== null) lines.push({ key: "coin", value: formatMoney(cash, doc.currency), from: { system: "economy" }, ...this.coinMark(node.id) });
      }
      const posted = this.state.world.accounts[node.id];
      if (posted !== undefined) lines.push({ key: "posted", value: formatMoney(posted, doc.currency), from: { system: "economy" }, ...(marks.posted ? { mark: marks.posted } : {}) });
      ownFields = e.fields;
      const rels = new Map<string, string[]>();
      for (const r of e.relations) {
        const target = this.state.world.entities[r.to]?.name ?? own(doc.places, r.to)?.name ?? r.to;
        const role = isRecord(r.fields) && typeof r.fields.role === "string" ? ` (${r.fields.role})` : "";
        rels.set(r.type, [...(rels.get(r.type) ?? []), `${target}${role}`]);
      }
      for (const [type, targets] of rels) lines.push({ key: type, value: targets.join(", "), ...(marks[type] ? { mark: marks[type] } : {}) });
      if (node.category === "group") {
        const members = Object.entries(this.state.world.entities)
          .filter(([, m]) => m.relations.some((r) => r.type === "member_of" && r.to === node.id))
          .map(([, m]) => m.name)
          .sort();
        if (members.length > 0) lines.push({ key: "members", value: members.join(", ") });
      }
      if (inherited) {
        above = this.groupChain(node.id);
        aboveRef = (id) => `entity:${id}`;
      }
    }
    const taken = new Set(lines.map((l) => l.key));
    for (const [key, v] of Object.entries(ownFields)) if (!taken.has(key)) lines.push({ key, value: show(v), ...(marks[key] ? { mark: marks[key] } : {}) });
    // What the levels above set and this one does not: for a place, the places above it; for a
    // member, its groups. The nearest one's, named. Shown at the query's own point only.
    const kept = new Set([...taken, ...Object.keys(ownFields), ...this.options.ownOnly]);
    for (const p of above) {
      for (const [key, v] of Object.entries(p.fields)) {
        if (kept.has(key)) continue;
        kept.add(key);
        lines.push({ key, value: show(v), from: { ref: aboveRef(p.id), name: p.name } });
      }
    }
    return lines;
  }

  /** A level's lines: its own line and, as asked, its values with the facts standing beside them, one level further in. */
  private levelLines(node: Node, depth: number, shown: ValuesShown): ViewLine[] {
    const out: ViewLine[] = [this.levelLine(node, depth)];
    if (shown === "none") return out;
    const facts = standing(this.state, node.ref);
    const placed = new Set<string>();
    for (const v of this.valuesOf(node, shown === "all")) {
      const beside = facts.filter((f) => f.key === v.key);
      out.push({ kind: "value", depth: depth + 1, fields: valueFields(v, beside.length) });
      for (const f of beside) {
        placed.add(f.id);
        out.push({ kind: "fact", depth: depth + 1, fields: factFields(f) });
      }
    }
    for (const f of facts) if (!placed.has(f.id)) out.push({ kind: "fact", depth: depth + 1, fields: factFields(f) });
    return out;
  }

  /** A level as data, or null when nothing in the tree is called `at`. */
  node(at: string): NodeView | null {
    const ref = this.resolve(at);
    const node = ref === null ? undefined : this.nodes.get(ref);
    if (!node) return null;
    return {
      ref: node.ref,
      kind: node.kind,
      name: node.name,
      what: node.what,
      reflection: this.reflectionOf(node),
      values: this.values(node.ref),
      facts: standing(this.state, node.ref),
      children: [...node.children],
      parent: node.parent,
    };
  }

  /**
   * One level's lines at `depth` in: its own line and, as asked, its values with its facts. For a
   * view put together level by level (the world state). Null when nothing is called `at`.
   */
  level(at: string, depth: number, shown: ValuesShown): ViewLine[] | null {
    const ref = this.resolve(at);
    const node = ref === null ? undefined : this.nodes.get(ref);
    if (!node) return null;
    return readPass(() => this.levelLines(node, depth, shown));
  }

  /**
   * The tree at `at`, to `depth` levels below it (`full`: all of them): the level itself with its
   * values (and what it inherits), each level above the depth with its values and its levels, and
   * each level at the depth as its own line. Null when nothing in the tree is called `at`. An engine
   * walk cut short by its setting in this state or its world adds a line saying where it stopped.
   */
  query(at: string, depth: number | "full"): View | null {
    const ref = this.resolve(at);
    if (ref === null) return null;
    const max = depth === "full" ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(depth));
    const lines: ViewLine[] = [];
    readPass(() => {
      const walk = (r: string, level: number): void => {
        const node = this.nodes.get(r) as Node;
        const atCut = level > 0 && level >= max;
        lines.push(...this.levelLines(node, level, atCut ? "none" : level === 0 ? "all" : "own"));
        if (level >= max) return;
        for (const c of node.children) walk(c, level + 1);
      };
      walk(ref, 0);
    });
    for (const cut of walkCuts(this.state.world, this.doc)) lines.push({ kind: "walk_stopped", depth: 0, fields: { walk: cut.walk, setting: WALK_SETTINGS[cut.walk], from: cut.from, at: cut.at, limit: cut.limit } });
    return { lines };
  }

  /** The horizon as the Author left it, each entry with the level it names now (null: none). */
  horizon(): { at: string; ref: string | null; name: string | null }[] {
    return this.state.horizon.map((at) => {
      const ref = this.resolve(at);
      return { at, ref, name: ref === null ? null : (this.nodes.get(ref)?.name ?? null) };
    });
  }
}
