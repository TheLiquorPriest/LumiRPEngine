// One tree, at any zoom (plan §6.4): the engine's own data read as one nested tree. The world holds
// its places, places hold places, and every entity sits where today's engine already says it is:
// inside what holds it (`in`), else at its place, else, for a group, inside the group it belongs
// to, under "groups"; anything else is "elsewhere". Nothing here is inferred.
//
// Each level shows its values with where they come from: its own; for a place, those the places
// above it set and it does not (inherited, "from <place>"), except the fields that only describe a
// level; and those a game system keeps its own way (time, weather, coin, entry), named by the
// system, so what the tree shows is what the sums use. Each level carries a reflection of what is
// beneath it, made from recorded values whenever the state is read: how many people, things and
// places, who of note, what is open, the last turn that changed something there, and an agent's
// own line.
//
// A query is a point and a depth, and returns indented text of the same shape at every level.

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { tierBand, tierLabel } from "../shared/tiers";
import { formatMoney, trackOwner, type WorldDoc } from "../shared/world";
import { calendarOf, formatClock, placeOffset, placeZone } from "../engine/calendar";
import { setEntryOf } from "../engine/org";
import { optionalQuery, own } from "../engine/pack-kit";
import { readPass } from "../engine/read-pass";
import type { ReadContext } from "../engine/registry";
import type { EntityState } from "../engine/state";
import { isGone, kindDef, kindIs, placeOfEntity } from "../engine/scope";
import type { FoldEnv } from "./fold";
import type { StoreState, Touched } from "./types";

export interface ViewOptions {
  /** Fields that describe a level itself and never pass down to what is inside it. */
  ownOnly: readonly string[];
  /** How many names of note a reflection gives. */
  notable: number;
}

type NodeKind = "world" | "place" | "entity" | "groups" | "elsewhere";
type Category = "person" | "group" | "thing" | "record";

interface Node {
  ref: string;
  id: string;
  kind: NodeKind;
  name: string;
  what: string;
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

/** One value line: its key, its value as text, and where it comes from (absent: its own). */
export interface ValueLine {
  key: string;
  value: string;
  from?: string;
}

/** A level of the tree as data: what a query shows of it. */
export interface NodeView {
  ref: string;
  name: string;
  what: string;
  reflection: string;
  values: ValueLine[];
  children: string[];
  parent: string | null;
}

const ORDER: Record<NodeKind, number> = { world: 0, place: 1, entity: 2, groups: 3, elsewhere: 4 };
const CATEGORY_ORDER: Record<Category, number> = { person: 0, group: 1, thing: 2, record: 3 };

/** A JSON value as one line of text. */
function show(v: JsonValue | undefined): string {
  if (v === undefined || v === null) return "none";
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) return v.map((x) => show(x)).join(", ");
  return JSON.stringify(v);
}

export class TreeView {
  private readonly nodes = new Map<string, Node>();
  private readonly doc: WorldDoc;
  /** Agents' own lines by the level each names now. */
  private readonly notes = new Map<string, string>();
  private readonly ctx: ReadContext;

  constructor(
    private readonly env: FoldEnv,
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

  private build(): void {
    const doc = this.doc;
    const entities = this.state.world.entities;
    this.add({ ref: "world", id: "world", kind: "world", name: doc.name, what: "world", parent: null, category: null, gone: false });
    for (const [id, p] of Object.entries(doc.places)) {
      const parent = p.parent !== undefined && own(doc.places, p.parent) ? `place:${p.parent}` : "world";
      this.add({ ref: `place:${id}`, id, kind: "place", name: p.name, what: "place", parent, category: null, gone: false });
    }
    let groups = false;
    let elsewhere = false;
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
        groups ||= within === undefined;
      } else {
        parent = "elsewhere";
        elsewhere = true;
      }
      const label = kindDef(this.env.registry, doc, e.kind)?.label ?? e.kind;
      this.add({ ref: `entity:${id}`, id, kind: "entity", name: e.name, what: label, parent, category, gone: isGone(this.state.world, id) });
    }
    if (groups) this.add({ ref: "groups", id: "groups", kind: "groups", name: "Groups", what: "groups", parent: "world", category: null, gone: false });
    if (elsewhere) this.add({ ref: "elsewhere", id: "elsewhere", kind: "elsewhere", name: "Elsewhere", what: "not in any place", parent: "world", category: null, gone: false });
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
        if (!this.nodes.has("elsewhere")) this.add({ ref: "elsewhere", id: "elsewhere", kind: "elsewhere", name: "Elsewhere", what: "not in any place", parent: "world", category: null, gone: false });
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
    return cat !== 0 ? cat : x.name.localeCompare(y.name) || x.id.localeCompare(y.id);
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
          if (rank >= 0) names.push({ rank, name: node.name });
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

  private reflection(node: Node): string {
    const parts: string[] = [];
    const count = (n: number, one: string, many: string): void => {
      if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
    };
    if (node.people > 0) parts.push(`${node.people} ${node.people === 1 ? "person" : "people"}${node.notable.length > 0 ? ` (${node.notable.map((x) => x.name).join(", ")})` : ""}`);
    count(node.things, "thing", "things");
    count(node.places, "place", "places");
    count(node.groups, "group", "groups");
    count(node.records, "record", "records");
    const head = parts.join(", ");
    const tail: string[] = [];
    if (node.open > 0) tail.push(`${node.open} open`);
    if (node.changed) tail.push(`changed turn ${node.changed.n}`);
    const note = this.notes.get(node.ref);
    if (note !== undefined) tail.push(`note: ${note}`);
    return [head, ...tail].filter((s) => s !== "").join("; ");
  }

  private header(node: Node): string {
    const marks: string[] = [];
    if (node.kind === "entity") {
      const e = this.state.world.entities[node.id] as EntityState;
      const holder = node.parent?.startsWith("entity:") ? node.parent.slice("entity:".length) : null;
      if (holder !== null && e.relations.some((r) => r.type === "worn_by" && r.to === holder)) marks.push("worn");
      if (holder !== null && e.relations.some((r) => r.type === "equipped" && r.to === holder)) marks.push("equipped");
      if (node.gone) marks.push("gone");
    }
    const reflection = this.reflection(node);
    return `${node.name} [${node.id}] (${[node.what, ...marks].join(", ")})${reflection === "" ? "" : ` — ${reflection}`}`;
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

  /** What the game systems keep their own way, for a place: its local time, weather and entry. */
  private placeSystems(id: string, root: boolean): ValueLine[] {
    const out: ValueLine[] = [];
    const clock = this.state.world.clock;
    if (root) out.push({ key: "time", value: formatClock(calendarOf(this.doc), clock, placeOffset(this.doc, clock, id)), from: "calendar" });
    const sky = optionalQuery(this.ctx, "weather.sky")?.(this.ctx, id) ?? null;
    if (sky !== null) out.push({ key: "weather", value: sky, from: "weather" });
    const entry = setEntryOf(this.ctx, id);
    if (entry) out.push({ key: "entry", value: entry.entry, from: entry.at === id ? "orgs" : `orgs, from ${own(this.doc.places, entry.at)?.name ?? entry.at}` });
    return out;
  }

  /** A level's values: system values first, then its own, then (at the query's own point) what it inherits. */
  values(ref: string, root = true): ValueLine[] {
    const node = this.nodes.get(ref);
    if (!node) return [];
    return readPass(() => this.valuesOf(node, root));
  }

  private valuesOf(node: Node, root: boolean): ValueLine[] {
    const doc = this.doc;
    const lines: ValueLine[] = [];
    let ownFields: Record<string, JsonValue> = {};
    let above: string | null = null;
    if (node.kind === "world") {
      lines.push({ key: "time", value: formatClock(calendarOf(doc), this.state.world.clock), from: "calendar" });
      lines.push({ key: "time zone", value: doc.calendar.timeZone });
      lines.push({ key: "currency", value: `${doc.currency.code} (${doc.currency.symbol})` });
      return lines;
    }
    if (node.kind === "place") {
      const p = own(doc.places, node.id);
      lines.push(...this.placeSystems(node.id, root));
      ownFields = p?.fields ?? {};
      if (p?.timeZone) lines.push({ key: "time zone", value: p.timeZone });
      else if (root) {
        const zone = placeZone(doc, node.id);
        const setter = this.placeChain(node.id).find((x) => own(doc.places, x.id)?.timeZone === zone);
        lines.push({ key: "time zone", value: zone, from: setter ? `from ${setter.name}` : "from the world" });
      }
      above = p?.parent ?? null;
    } else if (node.kind === "entity") {
      const e = this.state.world.entities[node.id] as EntityState;
      lines.push({ key: "tier", value: tierLabel(doc, e.tier) });
      if (e.life !== undefined) lines.push({ key: "life", value: e.life });
      if (node.category === "person" || node.category === "group") {
        const cash = optionalQuery(this.ctx, "economy.carried_cash")?.(this.ctx, node.id) ?? null;
        if (cash !== null) lines.push({ key: "coin", value: formatMoney(cash, doc.currency), from: "economy" });
      }
      const posted = this.state.world.accounts[node.id];
      if (posted !== undefined) lines.push({ key: "posted", value: formatMoney(posted, doc.currency), from: "economy" });
      ownFields = e.fields;
      const rels = new Map<string, string[]>();
      for (const r of e.relations) {
        const target = this.state.world.entities[r.to]?.name ?? own(doc.places, r.to)?.name ?? r.to;
        const role = isRecord(r.fields) && typeof r.fields.role === "string" ? ` (${r.fields.role})` : "";
        rels.set(r.type, [...(rels.get(r.type) ?? []), `${target}${role}`]);
      }
      for (const [type, targets] of rels) lines.push({ key: type, value: targets.join(", ") });
      if (node.category === "group") {
        const members = Object.entries(this.state.world.entities)
          .filter(([, m]) => m.relations.some((r) => r.type === "member_of" && r.to === node.id))
          .map(([, m]) => m.name)
          .sort();
        if (members.length > 0) lines.push({ key: "members", value: members.join(", ") });
      }
    }
    const taken = new Set(lines.map((l) => l.key));
    for (const [key, v] of Object.entries(ownFields)) if (!taken.has(key)) lines.push({ key, value: show(v) });
    // At the query's own point, a place shows what the places above it set and it does not: the
    // nearest one's, named. People and things are shown where they are, not given their place's values.
    if (!root || node.kind !== "place") return lines;
    const kept = new Set([...taken, ...Object.keys(ownFields), ...this.options.ownOnly]);
    for (const p of this.placeChain(above)) {
      for (const [key, v] of Object.entries(p.fields)) {
        if (kept.has(key)) continue;
        kept.add(key);
        lines.push({ key, value: show(v), from: `from ${p.name}` });
      }
    }
    return lines;
  }

  /** A level as data, or null when nothing in the tree is called `at`. */
  node(at: string): NodeView | null {
    const ref = this.resolve(at);
    const node = ref === null ? undefined : this.nodes.get(ref);
    if (!node) return null;
    return { ref: node.ref, name: node.name, what: node.what, reflection: this.reflection(node), values: this.values(node.ref), children: [...node.children], parent: node.parent };
  }

  /**
   * The tree at `at`, to `depth` levels below it (`full`: all of them), as indented text: the level
   * itself with its values, each level above the depth with its values and its levels, and each
   * level at the depth as one line.
   */
  query(at: string, depth: number | "full"): string {
    const ref = this.resolve(at);
    if (ref === null) return this.notFound(at);
    const max = depth === "full" ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(depth));
    const lines: string[] = [];
    readPass(() => {
      const walk = (r: string, level: number): void => {
        const node = this.nodes.get(r) as Node;
        const pad = "  ".repeat(level);
        lines.push(`${pad}${this.header(node)}`);
        if (level > 0 && level >= max) return;
        for (const v of this.valuesOf(node, level === 0)) lines.push(`${pad}  · ${v.key}: ${v.value}${v.from === undefined ? "" : ` (${v.from})`}`);
        if (level >= max) return;
        for (const c of node.children) walk(c, level + 1);
      };
      walk(ref, 0);
    });
    return lines.join("\n");
  }

  private notFound(at: string): string {
    const said = at.toLowerCase();
    const near = [...this.nodes.values()]
      .filter((n) => n.id.toLowerCase().includes(said) || n.name.toLowerCase().includes(said))
      .slice(0, 5)
      .map((n) => `${n.name} [${n.id}]`);
    return `Nothing in the tree is called ${at}.${near.length > 0 ? ` Near: ${near.join(", ")}.` : ""}`;
  }

  /** The horizon as the Author left it, each entry with the level it names now (null: none). */
  horizon(): { at: string; ref: string | null; name: string | null }[] {
    return this.state.horizon.map((at) => {
      const ref = this.resolve(at);
      return { at, ref, name: ref === null ? null : (this.nodes.get(ref)?.name ?? null) };
    });
  }
}
