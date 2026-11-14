// The world state (plan §6.9): compiled by code at the start of each turn, from memory, in a few
// milliseconds. It is the tree opened at the horizon, in the sections of the world state's layout
// (`.prompts/world-state.md`, as the chat has it): the horizon in full, with each place's map; the
// chain above it; what is around it; the rest of the world in outline; what is due; open business
// on the horizon; what changed last turn, by lane; and what is unsettled. Every line renders a
// recorded value; nothing in it is inferred, and none of its words are code's: the layout words
// every line. A section the layout leaves out is not compiled, and moving one moves it.
//
// The horizon is never cut for length. Every other section shares a budget: each takes what it needs
// while that is no more than an even share of what is left, and one cut short ends with the layout's
// line counting what it left out. The outline takes the room the others leave: breadth first, a
// level's levels go in while they fit, and a level whose levels do not fit is given as its own line
// with its reflection and the query that opens it.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { trackOwner } from "../shared/world";
import { calendarOf, formatClock } from "../engine/calendar";
import { own } from "../engine/pack-kit";
import { clockRecorded } from "./blank";
import { standing } from "./facts";
import { eventOf, type FoldEnv } from "./fold";
import type { UserStore } from "./store";
import { LANES, STORE_OPS, StoreInputError, type ChangeRow, type Mark, type StoreState } from "./types";
import { factFields, markFields, type TreeView } from "./view";
import { readPart, wordLine, type Part, type ViewLine } from "./words";

/** Every fixed value of the world state, each a setting with this default (Appendix D.1). */
export const WORLD_STATE_DEFAULTS = Object.freeze({
  /** Tokens everything but the horizon shares. */
  budget: 4000,
  /** Characters counted as one token when the budget is measured. */
  charsPerToken: 4,
  /** Minutes of story time ahead that the due section lists. */
  dueAhead: 360,
});

export type WorldStateSettings = { -readonly [K in keyof typeof WORLD_STATE_DEFAULTS]: number };

/** The sections the layout may hold, by the name of the field that places each. */
export const WORLD_STATE_SECTIONS = ["horizon", "above", "around", "outline", "due", "open", "changed", "unsettled"] as const;
export type WorldStateSection = (typeof WORLD_STATE_SECTIONS)[number];

/** A place's map as text, from the grid lane (the engine tools' `MapView`): null for a place with no map. */
export interface MapText {
  text(input: { state: StoreState; env: FoldEnv; place: string }): string | null;
}

/** One thing a span of time brings due (the engine tools' `DueItem`). */
export interface DueEntry {
  /** When, in minutes since the world's epoch. */
  at: number;
  kind: string;
  /** Where, as a tree ref. */
  where?: string;
  /** Who or what it concerns, by entity id. */
  who?: string[];
  what: JsonValue;
}

/** What time brings due for a span and a part of the tree (the engine tools' `DueList`). */
export interface DueSource {
  due(state: StoreState, span: { from: number; to: number }, at: string | null): DueEntry[];
}

export interface WorldStateInput {
  chat: string;
  /** The turn starting: the world state is the state at its start. */
  turn: string;
  /** The world state's layout as the chat has it: the part's text, or the part as read. */
  layout: string | Part;
  /** Each place's map as text; absent, the horizon says by the layout's line that no map is to hand. */
  map?: MapText;
  /** What time brings due; absent, the due section says by the layout's line that it is not listed. */
  due?: DueSource;
  settings?: Partial<WorldStateSettings>;
}

export interface WorldStateBlock {
  /** The block, worded by the layout. */
  text: string;
  /** Each section the layout holds, as lines. */
  sections: Partial<Record<WorldStateSection, ViewLine[]>>;
  /** Tokens of everything but the horizon, as the budget counts them. */
  tokens: number;
}

const SOFT_PRECISION = new Set<string>(["approximate", "vague", "unknown"]);
const SOFT_STANDING = new Set<string>(["proposed", "assumed"]);

const isSoft = (m: Pick<Mark, "precision" | "standing" | "source">): boolean => (m.precision !== null && SOFT_PRECISION.has(m.precision)) || (m.standing !== null && SOFT_STANDING.has(m.standing)) || m.source === null;

/** A recorded value as one line of text. */
function said(v: JsonValue): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/**
 * The world state for a chat at the start of a turn: the block the turn lane gives the Author, and
 * each section as lines. Refuses a turn that is not the chat's.
 */
export function worldState(store: UserStore, input: WorldStateInput): WorldStateBlock {
  const turn = store.turn(input.turn);
  if (!turn || turn.chat !== input.chat) throw new StoreInputError(`no turn ${input.turn} in chat ${input.chat}`);
  const part = typeof input.layout === "string" ? readPart(input.layout, "world-state") : input.layout;
  const settings: WorldStateSettings = { ...WORLD_STATE_DEFAULTS, ...input.settings };
  const folded = store.stateAt(turn.id);
  const view = store.viewAt(turn.id);
  const state = view.state;
  const placed = new Set(part.body.fields);
  const want = (s: WorldStateSection): boolean => placed.has(s);

  // The horizon as the Author left it; an entry inside another is shown with it.
  const listed = [...new Set(view.horizon().flatMap((h) => (h.ref === null ? [] : [h.ref])))];
  const ancestors = (ref: string): string[] => {
    const out: string[] = [];
    for (let at = view.parentOf(ref); at !== null; at = view.parentOf(at)) out.push(at);
    return out;
  };
  const horizon = listed.filter((ref) => !ancestors(ref).some((a) => listed.includes(a)));
  const within = new Set<string>();
  const gather = (ref: string): void => {
    within.add(ref);
    for (const c of view.childrenOf(ref)) gather(c);
  };
  for (const ref of horizon) gather(ref);
  const scene = horizon[0] ?? null;
  const chain = scene === null ? [] : ancestors(scene);
  const scenePlace = scene === null ? null : [scene, ...chain].find((r) => r.startsWith("place:")) ?? null;
  const nameOf = (ref: string): string => view.nameOf(ref) ?? ref.replace(/^(place|entity):/, "");

  const sections: Partial<Record<WorldStateSection, ViewLine[]>> = {};
  if (want("horizon")) sections.horizon = horizon.flatMap((ref) => horizonLines(view, ref, input.map));
  if (want("above")) sections.above = chain.flatMap((ref) => view.level(ref, 0, "own") ?? []);
  if (want("around")) sections.around = around(view, scenePlace, new Set([...within, ...chain])).flatMap((ref) => view.level(ref, 0, "none") ?? []);
  if (want("due")) {
    const doc = view.world;
    const from = state.world.clock;
    // On a clock nobody set (the blank world's, until play sets it) a time is given only as how long from now.
    const dated = clockRecorded(state);
    sections.due = input.due
      ? input.due.due(state, { from, to: from + settings.dueAhead }, null).map((d): ViewLine => {
          const where = d.where === undefined ? null : view.resolve(d.where);
          const fields: JsonObject = { after: d.at - from, kind: d.kind, what: said(d.what) };
          if (dated) fields.when = formatClock(calendarOf(doc), d.at);
          if (where !== null) fields.where = nameOf(where);
          if (d.who !== undefined && d.who.length > 0) fields.who = d.who.map((id) => nameOf(`entity:${id}`)).join(", ");
          return { kind: "due", depth: 0, fields };
        })
      : [{ kind: "due_unlisted", depth: 0, fields: {} }];
  }
  if (want("open")) {
    sections.open = [];
    for (const [id, t] of Object.entries(view.world.tracks)) {
      const stage = state.world.tracks[id]?.stage ?? t.start;
      const at = own(t.stages, stage);
      const owner = trackOwner(t);
      if ((at?.next.length ?? 0) === 0 || owner === undefined || !within.has(`entity:${owner}`)) continue;
      sections.open.push({ kind: "quest", depth: 0, fields: { id, label: t.label, kind: t.kind, stage: at?.label ?? stage, owner: nameOf(`entity:${owner}`) } });
    }
  }
  const before = turn.parent === null ? null : store.turn(turn.parent);
  const lastRows = before === null ? [] : store.changes(before.id);
  if (want("changed")) sections.changed = changedLines(view, lastRows, nameOf);
  if (want("unsettled")) {
    const lines: ViewLine[] = [];
    for (const ref of [...within, ...chain]) {
      for (const f of standing(state, ref)) if (isSoft(f)) lines.push({ kind: "unsettled_fact", depth: 0, fields: { at: nameOf(ref), ...factFields(f) } });
      const marks = state.marks[ref];
      if (!marks) continue;
      const values = view.values(ref, false);
      for (const [name, mark] of Object.entries(marks)) {
        const value = values.find((v) => v.key === name);
        if (!value || !isSoft(mark)) continue;
        lines.push({ kind: "unsettled_value", depth: 0, fields: { at: nameOf(ref), key: name, ...(value.value !== null ? { value: value.value } : {}), ...markFields(mark) } });
      }
    }
    const n = before === null ? 0 : before.depth + 1;
    for (const r of lastRows) if (!r.applied || r.reports.length > 0) lines.push({ kind: "unsettled_report", depth: 0, fields: { op: r.op, turn: n, applied: r.applied, codes: r.reports.map((x) => x.code) } });
    // What stopped applying is told once, in the first briefing after: what the turn before started from, its own briefing told.
    const told = new Set(before === null ? [] : store.startOf(before.id).notApplied.map((x) => x.change));
    for (const x of folded.notApplied) {
      if (told.has(x.change)) continue;
      const t = store.turn(x.turn);
      lines.push({ kind: "unsettled_report", depth: 0, fields: { op: x.op, turn: t === null ? 0 : t.depth + 1, applied: false, codes: x.reports.map((r) => r.code) } });
    }
    sections.unsettled = lines;
  }

  // The budget, shared by every section but the horizon: the smallest needs are met first, each while
  // it is no more than an even share of what is left, so no section crowds out the rest; the outline,
  // which gives way level by level, takes the room that remains.
  const budget = settings.budget * settings.charsPerToken;
  const needs: [WorldStateSection, number][] = [];
  for (const s of WORLD_STATE_SECTIONS) {
    const lines = sections[s];
    if (s !== "horizon" && s !== "outline" && lines !== undefined) needs.push([s, lines.reduce((n, l) => n + costOf(part, l), 0)]);
  }
  let left = budget;
  let sharing = needs.length + (want("outline") ? 1 : 0);
  for (const [s, need] of needs.sort((a, b) => a[1] - b[1])) {
    const kept = fit(part, s, sections[s] ?? [], Math.min(need, Math.floor(left / sharing)));
    sections[s] = kept.lines;
    left -= kept.used;
    sharing--;
  }
  // The world's own line opens the outline unless the chain above shows it.
  if (want("outline")) sections.outline = outline(view, part, left, new Set(horizon), !(want("above") && chain.length > 0));
  const texts: Partial<Record<WorldStateSection, string>> = {};
  let used = 0;
  for (const s of WORLD_STATE_SECTIONS) {
    const lines = sections[s];
    if (lines === undefined) continue;
    texts[s] = lines
      .map((l) => wordLine(part, l))
      .filter((t): t is string => t !== null)
      .join("\n");
    if (s !== "horizon") used += (texts[s] ?? "").length;
  }
  const text = part.body.render(part.header, texts).trim();
  return { text, sections, tokens: Math.ceil(used / settings.charsPerToken) };
}

/** What a line takes of the budget: its words and the line break after them; nothing for a kind the layout does not word. */
function costOf(part: Part, line: ViewLine): number {
  const words = wordLine(part, line);
  return words === null ? 0 : words.length + 1;
}

/**
 * As many of a section's lines as fit in `room` characters, in order. When some do not, the layout's
 * `left_out` line, counting them, ends the section at the depth of the first one left out, with room
 * kept for it; when not even that fits, nothing of the section is shown.
 */
function fit(part: Part, section: WorldStateSection, lines: readonly ViewLine[], room: number): { lines: ViewLine[]; used: number } {
  const costs = lines.map((l) => costOf(part, l));
  let used = 0;
  let k = 0;
  while (k < lines.length && used + (costs[k] as number) <= room) used += costs[k++] as number;
  if (k === lines.length) return { lines: [...lines], used };
  for (; k >= 0; k--) {
    const n = lines.length - k;
    const note: ViewLine = { kind: "left_out", depth: (lines[k] as ViewLine).depth, fields: { n, one: n === 1, section, [section]: true } };
    const total = used + costOf(part, note);
    if (total <= room) return { lines: [...lines.slice(0, k), note], used: total };
    if (k > 0) used -= costs[k - 1] as number;
  }
  return { lines: [], used: 0 };
}

/** A horizon entry in full, with a place's map after its own values. */
function horizonLines(view: TreeView, ref: string, map: MapText | undefined): ViewLine[] {
  const lines = view.query(ref, "full")?.lines ?? [];
  if (!ref.startsWith("place:")) return lines;
  let mapLine: ViewLine | null;
  if (map === undefined) mapLine = { kind: "map_unavailable", depth: 1, fields: {} };
  else {
    const text = map.text({ state: view.state, env: view.env, place: ref.slice("place:".length) });
    mapLine = text === null ? null : { kind: "map", depth: 1, fields: { text } };
  }
  if (mapLine === null) return lines;
  const at = lines.findIndex((l, i) => i > 0 && l.kind.startsWith("level_"));
  return at < 0 ? [...lines, mapLine] : [...lines.slice(0, at), mapLine, ...lines.slice(at)];
}

/** Places next to the scene's place: those beside it in the same place, and those a route joins it to. */
function around(view: TreeView, scenePlace: string | null, shown: ReadonlySet<string>): string[] {
  if (scenePlace === null) return [];
  const id = scenePlace.slice("place:".length);
  const out: string[] = [];
  const add = (ref: string): void => {
    if (ref !== scenePlace && !shown.has(ref) && !out.includes(ref) && view.resolve(ref) === ref) out.push(ref);
  };
  const parent = view.parentOf(scenePlace);
  if (parent !== null) for (const c of view.childrenOf(parent)) if (c.startsWith("place:")) add(c);
  for (const r of Object.values(view.world.routes)) {
    if (r.from === id) add(`place:${r.to}`);
    else if (r.to === id) add(`place:${r.from}`);
  }
  return out;
}

/** What the turn before changed, a line for each lane: how many changes, which operations, what they touched, how many did not apply. */
function changedLines(view: TreeView, rows: readonly ChangeRow[], nameOf: (ref: string) => string): ViewLine[] {
  const out: ViewLine[] = [];
  for (const lane of LANES) {
    const mine = rows.filter((r) => r.lane === lane);
    if (mine.length === 0) continue;
    const touched: string[] = [];
    const touch = (ref: string | null): void => {
      if (ref === null || view.resolve(ref) !== ref) return;
      const name = nameOf(ref);
      if (!touched.includes(name)) touched.push(name);
    };
    for (const r of mine) {
      if (!r.applied) continue;
      const v = isRecord(r.value) ? r.value : {};
      const ev = eventOf(r.op, r.value);
      if (r.op === STORE_OPS.fact) touch(typeof v.about === "string" ? v.about : null);
      else if (r.op === STORE_OPS.note) touch(typeof v.at === "string" ? view.resolve(v.at) : null);
      else if (ev) for (const t of view.env.registry.get(ev.type)?.touches?.(ev) ?? []) touch(`entity:${t.entity}`);
    }
    const unapplied = mine.filter((r) => !r.applied).length;
    const fields: JsonObject = { lane, n: mine.length, one: mine.length === 1, ops: { list: [...new Set(mine.map((r) => r.op))] } };
    if (touched.length > 0) fields.touched = { names: touched };
    if (unapplied > 0) fields.unapplied = unapplied;
    out.push({ kind: "changed", depth: 0, fields });
  }
  return out;
}

/**
 * The rest of the world in outline, within `room` characters: a line for each level in the world,
 * then breadth first each level's levels while they fit. A level whose levels are not shown is marked
 * with the query that opens it, and the mark is counted as soon as its line is. A horizon entry, shown
 * in full, is not opened here. Where even a line for each level does not fit, the layout's line
 * counting what is left out ends the outline.
 */
function outline(view: TreeView, part: Part, room: number, horizon: ReadonlySet<string>, root: boolean): ViewLine[] {
  const lines = new Map<string, ViewLine>();
  const lineOf = (ref: string, depth: number): ViewLine => {
    let line = lines.get(ref);
    if (!line) {
      line = (view.level(ref, depth, "none") as ViewLine[])[0] as ViewLine;
      lines.set(ref, line);
    }
    return line;
  };
  const opensFrom = (ref: string): boolean => view.childrenOf(ref).length > 0 && !horizon.has(ref);
  const marked = (line: ViewLine): ViewLine => ({ ...line, fields: { ...line.fields, opens: true } });
  const cost = (line: ViewLine): number => costOf(part, line);
  /** What a level's line takes while its levels are not shown: with the query that opens it, where it has levels. */
  const closed = (ref: string, depth: number): number => cost(opensFrom(ref) ? marked(lineOf(ref, depth)) : lineOf(ref, depth));
  const shown = new Set<string>();
  const opened = new Set<string>();
  // The floor: a line for each level in the world, under the world's own line where no chain above
  // shows it.
  const first = view.childrenOf("world").map((ref) => ({ ref, depth: root ? 1 : 0 }));
  let used = 0;
  if (root) {
    shown.add("world");
    opened.add("world");
    used += cost(lineOf("world", 0));
  }
  for (const x of first) {
    shown.add(x.ref);
    used += closed(x.ref, x.depth);
  }
  let layer = first;
  while (layer.length > 0) {
    const next: { ref: string; depth: number }[] = [];
    for (const x of layer) {
      if (!opensFrom(x.ref)) continue;
      const kids = view.childrenOf(x.ref);
      const block = kids.reduce((sum, k) => sum + closed(k, x.depth + 1), 0);
      const freed = closed(x.ref, x.depth) - cost(lineOf(x.ref, x.depth));
      if (used - freed + block > room) continue;
      used += block - freed;
      opened.add(x.ref);
      for (const k of kids) {
        shown.add(k);
        next.push({ ref: k, depth: x.depth + 1 });
      }
    }
    layer = next;
  }
  const out: ViewLine[] = [];
  const walk = (ref: string): void => {
    if (!shown.has(ref)) return;
    const line = lines.get(ref) as ViewLine;
    out.push(opensFrom(ref) && !opened.has(ref) ? marked(line) : line);
    for (const k of view.childrenOf(ref)) walk(k);
  };
  for (const ref of root ? ["world"] : first.map((x) => x.ref)) walk(ref);
  return fit(part, "outline", out, room).lines;
}
