// One tree, at any zoom (plan §6.4): the engine's own data read as one nested tree. The world holds
// its places, places hold places, and every entity sits where today's engine already says it is:
// inside what holds it (`in`), else at its place, else, for a group, inside the group it belongs
// to, under the groups; anything else is elsewhere. Nothing here is inferred.
//
// Each level shows its values with where they come from: its own; then what the levels above it set
// and it does not, the nearest first: for a member of a group, its groups; for a person or a thing,
// what holds it and the places above it; for a place, the places above it; and last the world's own
// values (a level's own value always wins), except the fields that only describe a level; and those
// a game system keeps its own way (time, weather, coin, entry, currency, prices), named by the
// system, so what the tree shows is what the sums use. Beside each value stand the facts recorded
// on that level with the same key (plan §6.6): neither overwrites the other, and each says how
// exact it is and the turn it is from. Each level carries a reflection of what is beneath it, made
// from recorded values whenever the state is read: how many people, things and places, who of
// note, what is open, what falls due there in the time ahead (when the reading passes what time
// brings due), the last turn that changed something there, and an agent's own line.
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
import { clockPaused } from "../engine/time";
import { isGone, kindDef, kindIs, WALK_SETTINGS, walkCuts } from "../engine/scope";
import { isOpened } from "../packs/economy/core/journal";
import { openerOf } from "../packs/economy/core/model";
import { cashAccount } from "../packs/economy/core/pay";
import { regionOf } from "../packs/weather/core/index";
import { madePlacesOf } from "../engine/places-in-play";
import { chatDraftOf } from "../engine/world-draft";
import { whereOf } from "../packs/space/core/grid-play";
import { BLANK_REVISION, clockRecorded } from "./blank";
import { settled, standing } from "./facts";
import type { FoldEnv } from "./fold";
import type { Fact, Mark, StoreState, Touched } from "./types";
import type { View, ViewLine } from "./words";
import type { DueSource } from "./world-state";

/** What a reading of the tree passes in beyond the state: what time brings due, and how far ahead a reflection counts it. */
export interface ViewReading {
  due: DueSource;
  /** Minutes of story time ahead (`worldState.dueAhead`). */
  ahead: number;
}

export interface ViewOptions {
  /** Fields that describe a level itself and never pass down to what is inside it. */
  ownOnly: readonly string[];
  /** How many names of note a reflection gives. */
  notable: number;
  /** How many places up the tree a place's values are inherited from (`store.placeDepth`). */
  placeDepth: number;
}

/** What a level of the tree is: the world, a place, an entity, or one of the two levels the tree adds (the groups, and what is elsewhere). */
export type NodeKind = "world" | "place" | "entity" | "groups" | "elsewhere";
type Category = "person" | "group" | "thing" | "record";

/** A level whose values another takes: its tree ref, its name, and what it sets. */
type Above = { ref: string; name: string; fields: Record<string, JsonValue> };

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
  /** A time while the clock is paused for the scene. */
  paused?: true;
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
  /**
   * What falls due beneath it in the time ahead: how many (null: more than one, uncounted), and the soonest, with the minutes until
   * it. Null when nothing does, or the reading passed no due source.
   */
  due: { n: number | null; after: number; kind: string } | null;
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
  if (r.due !== null) pieces.push({ kind: "reflection_due", fields: { ...(r.due.n !== null ? { n: r.due.n, one: r.due.n === 1 } : { more: true }), after: r.due.after, kind: r.due.kind } });
  if (r.changed !== null) pieces.push({ kind: "reflection_changed", fields: { turn: r.changed } });
  if (r.note !== null) pieces.push({ kind: "reflection_note", fields: { text: r.note } });
  return pieces;
}

/**
 * Where the Author's horizon is kept (plan §6.4, B-5): the story area's record beside the scene, rewound with the story, set whole by
 * its `horizon` operation and given by its `horizon` read. The store names the area and imports nothing of it.
 */
export const HORIZON = { area: "story", read: "horizon", op: "story.horizon" } as const;

/** The story area's read of its threads still open (`[{ id, who, place, fields }]`; PlanStory). */
const THREADS_READ = "threads";

/** The quest area and its read of the quests the story opened in play that are not closed (`[{ id, at }]`, `at` the tree refs each names). */
const QUESTS_OPEN = { area: "quest", read: "open" } as const;

/** An entry of the horizon: a tree ref or the Author's own words, and how deep the world state shows it (`full` when he set none). */
export interface HorizonEntry {
  at: string;
  depth: number | "full";
}

/** The Author's horizon in `state`, in his order, as the story area's read gives it; none where the store opened without that area. */
export function horizonOf(env: Pick<FoldEnv, "areas">, state: StoreState): HorizonEntry[] {
  const area = env.areas?.get(HORIZON.area);
  const read = area?.reads && Object.hasOwn(area.reads, HORIZON.read) ? area.reads[HORIZON.read] : undefined;
  const list = read?.(state.areas?.[HORIZON.area] ?? area?.initial?.() ?? {}, {});
  return (Array.isArray(list) ? list : []).flatMap((e) => (isRecord(e) && typeof e.at === "string" ? [{ at: e.at, depth: typeof e.depth === "number" ? e.depth : "full" }] : []));
}

/** A mark's fields on a line: the turn's number and, where recorded, how exact, how sure and from where, and an unchecked invention. */
export function markFields(mark: Mark | undefined): JsonObject {
  if (!mark) return {};
  const out: JsonObject = { turn: mark.n };
  if (mark.precision !== null) out.precision = mark.precision;
  if (mark.standing !== null) out.standing = mark.standing;
  if (mark.source !== null) out.source = mark.source;
  else out.unsourced = true;
  if (mark.unchecked === true) out.unchecked = true;
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
  if (f.part !== undefined) out.part = f.part;
  if (f.beat !== undefined) out.beat = f.beat;
  return out;
}

/** A value as a line's fields; `facts` is how many facts with its key stand beside it. */
function valueFields(v: ValueLine, facts: number): JsonObject {
  const out: JsonObject = { key: v.key, ...markFields(v.mark) };
  if (v.value !== null) out.value = v.value;
  if (v.from?.system !== undefined) out.system = v.from.system;
  if (v.from?.ref !== undefined) out.from = { ref: v.from.ref, name: v.from.name ?? null, ...(v.from.ref === "world" ? { world: true } : {}) };
  if (facts > 0) out.facts = facts;
  if (v.paused) out.paused = true;
  return out;
}

export class TreeView {
  private readonly nodes = new Map<string, Node>();
  private readonly doc: WorldDoc;
  /** Agents' own lines by the level each names now. */
  private readonly notes = new Map<string, string>();
  private readonly ctx: ReadContext;
  /** While a query runs: each place whose chain up stopped at `store.placeDepth`, and the place it stopped at. */
  private stopsSeen: Map<string, { place: string; at: string }> | null = null;
  /** While a reading that passed one runs: what time brings due, for the reflections. */
  private reading: ViewReading | null = null;
  /** The story's open threads with the levels each names, read once (`threads`). */
  private openThreads: { id: string; refs: string[]; fields: JsonObject }[] | null = null;
  /** Each query with no reading, answered once (`query`). */
  private readonly asked = new Map<string, ViewLine[]>();
  /** Whether a chain of holders looped and a level was put elsewhere to break it: a tree made from this one is built afresh. */
  private loopsBroken = false;

  /**
   * `prev`, a tree over a state this one was folded from, lets the tree be made from it where the world's places are the same (`update`):
   * kept current as changes land, rather than built afresh over each state.
   */
  constructor(
    readonly env: FoldEnv,
    readonly state: StoreState,
    private readonly options: ViewOptions,
    prev?: TreeView,
  ) {
    const doc = env.worlds(state.world.revision);
    if (!doc) throw new Error(`the world revision ${state.world.revision} is not available`);
    this.ctx = env.registry.context(doc, state.world);
    const was = prev?.state.world;
    const same = was !== undefined && was.revision === state.world.revision && madePlacesOf(was) === madePlacesOf(state.world) && chatDraftOf(was) === chatDraftOf(state.world);
    // The world as this chat plays it: its own places and those play made or changed (`prev`'s, where those are the same).
    this.doc = same && prev !== undefined ? prev.doc : this.ctx.world;
    readPass(() => {
      if (same && prev !== undefined && this.update(prev)) this.readNotes();
      else {
        this.nodes.clear();
        this.build();
      }
    });
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
      const parent = this.entityParent(e, category);
      if (parent === "groups") this.addGroups();
      if (parent === "elsewhere") this.addElsewhere();
      this.add({ ref: `entity:${id}`, id, kind: "entity", name: e.name, what: this.labelOf(e), parent, category, gone: isGone(this.state.world, id) });
    }
    this.breakLoops();
    for (const node of this.nodes.values()) if (node.parent !== null) this.nodes.get(node.parent)?.children.push(node.ref);
    for (const node of this.nodes.values()) node.children.sort((a, b) => this.compare(a, b));
    this.aggregate();
    this.readNotes();
  }

  /** Agents' own lines, each at the level it names now. */
  private readNotes(): void {
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
        this.loopsBroken = true;
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

  /**
   * The story's threads still open (its `threads` read), each with the levels it names found in the tree: its people, by id or by
   * name, and its place; none found, it is the whole world's.
   */
  threads(): { id: string; refs: string[]; fields: JsonObject }[] {
    if (this.openThreads !== null) return this.openThreads;
    const area = this.env.areas?.get(HORIZON.area);
    const read = area?.reads && Object.hasOwn(area.reads, THREADS_READ) ? area.reads[THREADS_READ] : undefined;
    const list = read?.(this.state.areas?.[HORIZON.area] ?? area?.initial?.() ?? {}, {});
    const byName = new Map<string, string>();
    for (const node of this.nodes.values()) if (node.name !== null && !byName.has(node.name.toLowerCase())) byName.set(node.name.toLowerCase(), node.ref);
    this.openThreads = (Array.isArray(list) ? list : []).flatMap((t) => {
      if (!isRecord(t) || typeof t.id !== "string") return [];
      const named = [...(Array.isArray(t.who) ? t.who : []), t.place].filter((w): w is string => typeof w === "string" && w.trim() !== "");
      const refs = [...new Set(named.flatMap((w) => this.resolve(w) ?? byName.get(w.trim().toLowerCase()) ?? []))];
      return [{ id: t.id, refs, fields: isRecord(t.fields) ? t.fields : {} }];
    });
    return this.openThreads;
  }

  /** The quests the story opened in play, not closed, each with the tree refs it names (none: the whole world's); the quest area's `open` read. */
  private questsOpen(): { id: string; at: string[] }[] {
    const area = this.env.areas?.get(QUESTS_OPEN.area);
    const read = area?.reads && Object.hasOwn(area.reads, QUESTS_OPEN.read) ? area.reads[QUESTS_OPEN.read] : undefined;
    const list = read?.(this.state.areas?.[QUESTS_OPEN.area] ?? area?.initial?.() ?? {}, {});
    return (Array.isArray(list) ? list : []).flatMap((q) => {
      if (!isRecord(q) || typeof q.id !== "string" || !Array.isArray(q.at)) return [];
      return [{ id: q.id, at: q.at.filter((r): r is string => typeof r === "string") }];
    });
  }

  /** Where a thing sits in the tree: in or on what holds it, else at its place, else (a group) in the group it belongs to, else elsewhere. */
  private entityParent(e: EntityState, category: Category): string {
    const entities = this.state.world.entities;
    const holder = e.relations.find((r) => r.type === "in" || r.type === "on")?.to;
    const place = typeof e.fields.place === "string" ? e.fields.place : "";
    if (holder !== undefined && own(entities, holder)) return `entity:${holder}`;
    if (place !== "" && own(this.doc.places, place)) return `place:${place}`;
    if (category !== "group") return "elsewhere";
    const within = e.relations.find((r) => r.type === "member_of" && own(entities, r.to) && this.categoryOf(entities[r.to] as EntityState) === "group")?.to;
    return within !== undefined ? `entity:${within}` : "groups";
  }

  private labelOf(e: EntityState): string {
    return kindDef(this.env.registry, this.doc, e.kind)?.label ?? e.kind;
  }

  /**
   * What is open under each level (plan §6.4): each quest in progress, at its owner, and each open thread, at what it names; the whole
   * world's where it names nothing in the tree. Each counts once at every level above what it names.
   */
  private opensOf(): Map<string, number> {
    const opens = new Map<string, number>();
    const count = (refs: readonly string[]): void => {
      const under = new Set<string>();
      for (const ref of refs.length > 0 ? refs : ["world"]) for (let at: string | null = ref; at !== null && !under.has(at); at = this.nodes.get(at)?.parent ?? null) under.add(at);
      for (const ref of under) opens.set(ref, (opens.get(ref) ?? 0) + 1);
    };
    for (const [id, t] of Object.entries(this.doc.tracks)) {
      const stage = this.state.world.tracks[id]?.stage ?? t.start;
      if ((own(t.stages, stage)?.next.length ?? 0) === 0) continue;
      const owner = trackOwner(t);
      count(owner !== undefined && this.nodes.has(`entity:${owner}`) ? [`entity:${owner}`] : []);
    }
    for (const t of this.threads()) count(t.refs);
    for (const q of this.questsOpen()) count(q.at.filter((ref) => this.nodes.has(ref)));
    return opens;
  }

  /** A level's counts, names of note and last change, from its children's (each summed already) and its own last change. */
  private sumUp(node: Node): void {
    node.people = node.things = node.places = node.groups = node.records = 0;
    let changed: Touched | null = null;
    const names: { rank: number; name: string }[] = [];
    for (const c of node.children) {
      const child = this.nodes.get(c) as Node;
      node.people += child.people;
      node.things += child.things;
      node.places += child.places;
      node.groups += child.groups;
      node.records += child.records;
      if (child.changed && (!changed || child.changed.n > changed.n)) changed = child.changed;
      names.push(...child.notable);
      if (child.gone) continue;
      if (child.kind === "place") node.places++;
      else if (child.category === "person") {
        node.people++;
        const e = this.state.world.entities[child.id] as EntityState;
        const band = tierBand(this.doc, e.tier);
        const rank = band === "principal" ? 0 : band === "supporting" ? 1 : e.agent ? 2 : -1;
        if (rank >= 0) names.push({ rank, name: child.name ?? child.id });
      } else if (child.category === "group") node.groups++;
      else if (child.category === "thing") node.things++;
      else if (child.category === "record") node.records++;
    }
    const own = this.state.touched[node.ref];
    node.changed = own && (!changed || own.n > changed.n) ? own : changed;
    node.notable = names.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).slice(0, this.options.notable);
  }

  /** Counts, names of note, what is open and the last change, summed up the tree from the leaves. */
  private aggregate(): void {
    const order: Node[] = [];
    const stack: Node[] = [this.nodes.get("world") as Node];
    while (stack.length > 0) {
      const node = stack.pop() as Node;
      order.push(node);
      for (const c of node.children) stack.push(this.nodes.get(c) as Node);
    }
    for (const node of order.reverse()) this.sumUp(node);
    const opens = this.opensOf();
    for (const node of order) node.open = opens.get(node.ref) ?? 0;
  }

  /**
   * The tree over this state made from `prev`'s, the tree over a state this one was folded from (PlanStore-S2 item 5): the levels
   * nothing changed are `prev`'s own; each thing that changed is placed again, and every level above where it was and where it is, or
   * whose own last change moved, is summed again. False, with nothing kept, where a thing's presence, kind or being gone changed, a
   * level the tree adds emptied, or a chain of holders loops: the tree is built afresh, as it gives the same.
   */
  private update(prev: TreeView): boolean {
    const before = prev.state.world.entities;
    const now = this.state.world.entities;
    const ids = Object.keys(now);
    if (prev.loopsBroken || ids.length !== Object.keys(before).length) return false;
    for (const [ref, node] of prev.nodes) this.nodes.set(ref, node);
    // A level is `prev`'s until this tree writes it: copied then, once.
    const mine = new Set<string>();
    const take = (ref: string): Node => {
      const node = this.nodes.get(ref) as Node;
      if (mine.has(ref)) return node;
      const copy = { ...node, children: [...node.children] };
      this.nodes.set(ref, copy);
      mine.add(ref);
      return copy;
    };
    const dirty = new Set<string>();
    const sorted = new Set<string>();
    for (const id of ids) {
      const e = now[id] as EntityState;
      if (e === before[id]) continue;
      const ref = `entity:${id}`;
      const was = prev.nodes.get(ref);
      const category = this.categoryOf(e);
      if (was === undefined || was.category !== category || was.gone !== isGone(this.state.world, id)) return false;
      const parent = this.entityParent(e, category);
      if (!this.nodes.has(parent)) return false;
      const node = take(ref);
      if (node.parent !== parent) {
        const from = take(node.parent as string);
        from.children = from.children.filter((c) => c !== ref);
        if (from.children.length === 0 && (from.kind === "groups" || from.kind === "elsewhere")) return false;
        dirty.add(from.ref);
        take(parent).children.push(ref);
        sorted.add(parent);
        node.parent = parent;
      } else if (node.name !== e.name) sorted.add(parent);
      node.name = e.name;
      node.what = this.labelOf(e);
      dirty.add(ref);
    }
    for (const ref of sorted) take(ref).children.sort((a, b) => this.compare(a, b));
    for (const key of new Set([...Object.keys(this.state.touched), ...Object.keys(prev.state.touched)])) if (this.state.touched[key] !== prev.state.touched[key] && this.nodes.has(key)) dirty.add(key);
    // Every dirty level and those above it, deepest first; a chain that does not reach the world loops.
    const depth = new Map<string, number>();
    const depthOf = (ref: string): number => {
      const chain: string[] = [];
      let at: string | null = ref;
      while (at !== null && !depth.has(at)) {
        if (chain.includes(at)) return -1;
        chain.push(at);
        at = this.nodes.get(at)?.parent ?? null;
      }
      let d = at === null ? -1 : (depth.get(at) as number);
      for (const r of chain.reverse()) depth.set(r, ++d);
      return depth.get(ref) as number;
    };
    for (const ref of dirty) if (depthOf(ref) < 0) return false;
    const up = new Set<string>();
    for (const ref of dirty) for (let at: string | null = ref; at !== null && !up.has(at); at = this.nodes.get(at)?.parent ?? null) up.add(at);
    for (const ref of [...up].sort((a, b) => (depth.get(b) ?? 0) - (depth.get(a) ?? 0))) this.sumUp(take(ref));
    const opens = this.opensOf();
    for (const [ref, node] of this.nodes) if (node.open !== (opens.get(ref) ?? 0)) take(ref).open = opens.get(ref) ?? 0;
    return true;
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

  /** Whether `ref` is an entity of a person's kind (a group's, a thing's or a record's is not). */
  isPerson(ref: string): boolean {
    return this.nodes.get(ref)?.category === "person";
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
      due: this.dueUnder(node.ref),
      changed: node.changed?.n ?? null,
      note: this.notes.get(node.ref) ?? null,
    };
  }

  /** What falls due under a level in the reading's time ahead: how many and the soonest; null without a due source, or with none due. */
  private dueUnder(ref: string): Reflection["due"] {
    if (this.reading === null) return null;
    const now = this.state.world.clock;
    const listing = this.reading.due.due(this.state, { from: now, to: now + this.reading.ahead }, ref, 1);
    const soonest = listing.items[0];
    if (soonest === undefined) return null;
    return { n: listing.more === null ? null : listing.items.length + listing.more, after: soonest.at - now, kind: soonest.kind };
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
      if (holder !== null && e.relations.some((r) => r.type === "on" && r.to === holder)) fields.on = true;
      if (node.gone) fields.gone = true;
    }
    const pieces = reflectionPieces(this.reflectionOf(node));
    if (pieces.length > 0) fields.reflection = { pieces };
    return { kind: `level_${node.kind}`, depth, fields };
  }

  /** A place's own fields and those of the places above it, nearest first. */
  private placeChain(place: string | null): { id: string; name: string; fields: Record<string, JsonValue> }[] {
    const out: { id: string; name: string; fields: Record<string, JsonValue> }[] = [];
    for (let id = place ?? undefined, depth = 0; id !== undefined; depth++) {
      const p = own(this.doc.places, id);
      if (!p || out.some((x) => x.id === id)) break;
      // As many places up as `store.placeDepth` says; a query that met the end says where the chain above stopped.
      if (depth >= this.options.placeDepth) {
        if (place !== null) this.stopsSeen?.set(place, { place, at: id });
        break;
      }
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

  /**
   * What the game systems keep their own way, for a place: its local time (at the query's own point, where the clock is a recorded
   * value) named by the place whose time zone gives it, and paused for the scene where it is; weather named by the place or region
   * whose weather it is; entry; and at the query's own point the prices the economy quotes there, each the number its sums use.
   */
  private placeSystems(id: string, root: boolean): ValueLine[] {
    const out: ValueLine[] = [];
    const clock = this.state.world.clock;
    const chain = this.placeChain(id);
    if (root && clockRecorded(this.state)) {
      const zone = placeZone(this.doc, id);
      const setter = chain.find((x) => own(this.doc.places, x.id)?.timeZone === zone);
      const level = setter ? { ref: `place:${setter.id}`, name: setter.name } : { ref: "world", name: this.doc.name };
      out.push({ key: "time", value: formatClock(calendarOf(this.doc), clock, placeOffset(this.doc, clock, id)), from: { system: "calendar", ...level }, ...(clockPaused(this.doc, this.state.world) ? { paused: true as const } : {}), ...this.timeMark() });
    }
    const sky = optionalQuery(this.ctx, "weather.sky")?.(this.ctx, id) ?? null;
    if (sky !== null) {
      const placed = chain.find((x) => typeof x.fields.weather === "string" && x.fields.weather !== "");
      const region = placed === undefined ? regionOf(this.ctx, id) : null;
      const level = placed !== undefined ? { ref: `place:${placed.id}`, name: placed.name } : region !== null ? { ref: `entity:${region}`, name: own(this.state.world.entities, region)?.name ?? region } : {};
      out.push({ key: "weather", value: sky, from: { system: "weather", ...level } });
    }
    const entry = setEntryOf(this.ctx, id);
    if (entry) out.push({ key: "entry", value: entry.entry, from: entry.at === id ? { system: "orgs" } : { system: "orgs", ref: `place:${entry.at}`, name: own(this.doc.places, entry.at)?.name ?? entry.at } });
    const offers = root ? (optionalQuery(this.ctx, "economy.offers_at")?.(this.ctx, id) ?? []) : [];
    if (offers.length > 0) out.push({ key: "prices", value: offers.map((o) => `${o.name} ${formatMoney(o.cents, this.doc.currency)}`).join(", "), from: { system: "economy" } });
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
        lines.push({ key: "currency", value: this.worldCurrency() });
      }
      // The world's own values (`store.value`), each with the change that set it.
      const marks = this.state.marks.world ?? {};
      const taken = new Set(lines.map((l) => l.key));
      for (const [key, v] of Object.entries(this.state.values ?? {})) if (!taken.has(key)) lines.push({ key, value: show(v), ...(marks[key] ? { mark: marks[key] } : {}) });
      return lines;
    }
    const marks = this.state.marks[node.ref] ?? {};
    let above: Above[] = [];
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
      if (inherited) above = this.aboveOf(node);
    } else if (node.kind === "entity") {
      const e = this.state.world.entities[node.id] as EntityState;
      lines.push({ key: "tier", value: tierLabel(doc, e.tier), ...(marks.tier ? { mark: marks.tier } : {}) });
      if (e.life !== undefined) lines.push({ key: "life", value: e.life, ...(marks.life ? { mark: marks.life } : {}) });
      // Where play said it is within its place besides its square, which the place's map shows: a named zone, words, or both.
      const where = whereOf(this.state.world, node.id);
      if (where?.zone !== undefined) lines.push({ key: "zone", value: where.zone, from: { system: "space" } });
      if (where?.words !== undefined) lines.push({ key: "position", value: where.words, from: { system: "space" } });
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
      if (inherited) above = this.aboveOf(node);
    }
    const taken = new Set(lines.map((l) => l.key));
    for (const [key, v] of Object.entries(ownFields)) if (!taken.has(key)) lines.push({ key, value: show(v), ...(marks[key] ? { mark: marks[key] } : {}) });
    // What the levels above set and this one does not, the nearest one's, named. Shown at the query's own point only.
    const kept = new Set([...taken, ...Object.keys(ownFields), ...this.options.ownOnly]);
    for (const p of above) {
      for (const [key, v] of Object.entries(p.fields)) {
        if (kept.has(key)) continue;
        kept.add(key);
        lines.push({ key, value: show(v), from: { ref: p.ref, name: p.name } });
      }
    }
    // The currency every place and person counts in, where none above sets its own: the economy's, the world's.
    const counts = node.kind === "place" || node.category === "person";
    if (inherited && counts && !kept.has("currency") && this.state.world.revision !== BLANK_REVISION) lines.push({ key: "currency", value: this.worldCurrency(), from: { system: "economy", ref: "world", name: doc.name } });
    return lines;
  }

  /** The world's currency as a value: its code and symbol. */
  private worldCurrency(): string {
    return `${this.doc.currency.code} (${this.doc.currency.symbol})`;
  }

  /**
   * The levels whose values a level takes, nearest first: for a member of a group, its groups; then, for a person or a thing, what
   * holds it, up to the place it is in, and the places above; for a place, the places above it; last the world's own values.
   */
  private aboveOf(node: Node): Above[] {
    const out: Above[] = [];
    const places = (id: string | null): Above[] => this.placeChain(id).map((p) => ({ ref: `place:${p.id}`, name: p.name, fields: p.fields }));
    if (node.kind === "place") out.push(...places(own(this.doc.places, node.id)?.parent ?? null));
    else if (node.kind === "entity") {
      out.push(...this.groupChain(node.id).map((g) => ({ ref: `entity:${g.id}`, name: g.name, fields: g.fields })));
      const seen = new Set<string>([node.ref]);
      let at = node.parent === null ? undefined : this.nodes.get(node.parent);
      for (; at?.kind === "entity" && !seen.has(at.ref); at = at.parent === null ? undefined : this.nodes.get(at.parent)) {
        seen.add(at.ref);
        // A person's own fields describe the person: what a person carries takes nothing from them, only from what holds them.
        if (at.category !== "person" && !out.some((x) => x.ref === at?.ref)) out.push({ ref: at.ref, name: at.name ?? at.id, fields: (this.state.world.entities[at.id] as EntityState).fields });
      }
      if (at?.kind === "place") out.push(...places(at.id));
    }
    out.push({ ref: "world", name: this.doc.name, fields: this.state.values ?? {} });
    return out;
  }

  /**
   * A level's lines: its own line and, as asked, its values with the facts standing beside them, one level further in. A fact a later
   * exact record of the value beside it settles (the coin's posting among them) stands no more (R-62).
   */
  private levelLines(node: Node, depth: number, shown: ValuesShown): ViewLine[] {
    const out: ViewLine[] = [this.levelLine(node, depth)];
    if (shown === "none") return out;
    const facts = standing(this.state, node.ref);
    const placed = new Set<string>();
    for (const v of this.valuesOf(node, shown === "all")) {
      const beside = facts.filter((f) => f.key === v.key);
      for (const f of beside) placed.add(f.id);
      const standingBeside = beside.filter((f) => !settled(f, v.mark));
      out.push({ kind: "value", depth: depth + 1, fields: valueFields(v, standingBeside.length) });
      for (const f of standingBeside) out.push({ kind: "fact", depth: depth + 1, fields: factFields(f) });
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
   * view put together level by level (the world state). Null when nothing is called `at`. With a
   * reading, its reflection says what falls due under it.
   */
  level(at: string, depth: number, shown: ValuesShown, reading?: ViewReading): ViewLine[] | null {
    const ref = this.resolve(at);
    const node = ref === null ? undefined : this.nodes.get(ref);
    if (!node) return null;
    return this.withReading(reading, () => readPass(() => this.levelLines(node, depth, shown)));
  }

  /** Runs `read` with the reading's due source (none: no reflection says anything of due). */
  private withReading<T>(reading: ViewReading | undefined, read: () => T): T {
    this.reading = reading ?? null;
    try {
      return read();
    } finally {
      this.reading = null;
    }
  }

  /**
   * The tree at `at`, to `depth` levels below it (`full`: all of them): the level itself with its
   * values (and what it inherits), each level above the depth with its values and its levels, and
   * each level at the depth as its own line. The groups level is a heading: the groups in it stand
   * at its own depth, so the world at depth 1 has a line for each region and each group. Null when
   * nothing in the tree is called `at`. An engine walk cut short by its setting in this state or its
   * world adds a line saying where it stopped. With a reading, each reflection says what falls due
   * under its level in the time ahead. A query with no reading is answered once per tree, and again from memory.
   */
  query(at: string, depth: number | "full", reading?: ViewReading): View | null {
    const ref = this.resolve(at);
    if (ref === null) return null;
    const max = depth === "full" ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(depth));
    const key = reading === undefined ? `${ref}\n${max}` : null;
    const asked = key === null ? undefined : this.asked.get(key);
    if (asked !== undefined) return { lines: [...asked] };
    const lines: ViewLine[] = [];
    this.stopsSeen = new Map();
    this.withReading(reading, () =>
      readPass(() => {
        // `indent` is how far in a line stands; `level` how many levels down the query has gone, which the groups heading does not add to.
        const walk = (r: string, indent: number, level: number): void => {
          const node = this.nodes.get(r) as Node;
          const heading = node.kind === "groups" && level > 0;
          const atCut = level > 0 && level >= max && !heading;
          lines.push(...this.levelLines(node, indent, atCut ? "none" : level === 0 ? "all" : heading ? "none" : "own"));
          if (level >= max && !heading) return;
          for (const c of node.children) walk(c, indent + 1, heading ? level : level + 1);
        };
        walk(ref, 0, 0);
      }),
    );
    const stops = this.stopsSeen;
    this.stopsSeen = null;
    for (const s of stops.values()) lines.push({ kind: "place_chain_stopped", depth: 0, fields: { place: s.place, at: s.at, limit: this.options.placeDepth, setting: "store.placeDepth" } });
    for (const cut of walkCuts(this.state.world, this.doc)) lines.push({ kind: "walk_stopped", depth: 0, fields: { walk: cut.walk, setting: WALK_SETTINGS[cut.walk], from: cut.from, at: cut.at, limit: cut.limit } });
    if (key !== null) this.asked.set(key, lines);
    return { lines: [...lines] };
  }

  /** The horizon as the Author left it (`horizonOf`), each entry with the level it names now (null: none) and the depth it is shown at. */
  horizon(): { at: string; ref: string | null; name: string | null; depth: number | "full" }[] {
    return horizonOf(this.env, this.state).map(({ at, depth }) => {
      const ref = this.resolve(at);
      return { at, ref, name: ref === null ? null : (this.nodes.get(ref)?.name ?? null), depth };
    });
  }
}
