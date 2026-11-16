// The world state (plan §6.9): compiled by code at the start of each turn, from memory, in a few
// milliseconds. It is the tree opened at the horizon, in the sections of the world state's layout
// (`.prompts/world-state.md`, as the chat has it): the horizon in full, with each place's map; the
// chain above it; what is around it; the rest of the world in outline; what fell due in the time the
// turn before moved the clock past; what is due; open business on the horizon; what changed last
// turn, by lane; and what is unsettled. Every line renders a recorded value; nothing in it is
// inferred, and none of its words are code's: the layout words every line. A section the layout
// leaves out is not compiled, and moving one moves it.
//
// The horizon is never cut for length. Every other section shares a budget: each takes what it needs
// while that is no more than an even share of what is left, and one cut short ends with the layout's
// line counting what it left out. The outline takes the room the others leave: breadth first, a
// level's levels go in while they fit, and a level whose levels do not fit is given as its own line
// with its reflection and the query that opens it. A due list is made only as far as the whole budget
// could show it, and the rest of its span is counted, so a long span costs what a short one does.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { TidyFinding } from "../shared/thing-gm";
import { trackOwner } from "../shared/world";
import { calendarOf, formatClock } from "../engine/calendar";
import { own } from "../engine/pack-kit";
import { clockRecorded } from "./blank";
import { standing } from "./facts";
import { eventOf, type FoldEnv } from "./fold";
import type { UserStore } from "./store";
import { LANES, STORE_OPS, StoreInputError, type ChangeRow, type Mark, type StoreState, type UnsettledChange } from "./types";
import { factFields, markFields, type TreeView, type ViewReading } from "./view";
import { readPart, wordLine, type Part, type ViewLine } from "./words";

/** Every fixed value of the world state, each a setting with this default (Appendix D.1). */
export const WORLD_STATE_DEFAULTS = Object.freeze({
  /** Tokens everything but the horizon shares. */
  budget: 4000,
  /** Minutes of story time ahead that the due section lists. */
  dueAhead: 360,
});

export type WorldStateSettings = { -readonly [K in keyof typeof WORLD_STATE_DEFAULTS]: number };

/** The sections the layout may hold, by the name of the field that places each. */
export const WORLD_STATE_SECTIONS = ["horizon", "above", "around", "outline", "passed", "due", "open", "changed", "unsettled"] as const;
export type WorldStateSection = (typeof WORLD_STATE_SECTIONS)[number];

/**
 * A place's map as text, from the grid lane (the engine tools' `MapView`): null for a place with no map. `grid` names the grid it is
 * drawn on, `drawn` the drawn layer's version; `layer` asks for one layer (both, in the layout's order, when absent), `around` names
 * the tree refs the printed part of a big grid must hold.
 */
export interface MapText {
  text(input: { state: StoreState; env: FoldEnv; place: string; layer?: "drawn" | "moving"; around?: readonly string[] }): { grid: string; drawn: string; text: string } | null;
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

/** What a span brings due as far as it is listed: the soonest, in time order, and how many more fall in it (the engine tools' `DueListing`). */
export interface DueListing {
  items: DueEntry[];
  /** How many more fall in the span than are listed; null when more do, but counting them would take going through the span year by year. */
  more: number | null;
}

/** What time brings due for a span and a part of the tree, the soonest `most` of it (the engine tools' `DueList`). */
export interface DueSource {
  due(state: StoreState, span: { from: number; to: number }, at: string | null, most: number): DueListing;
}

export interface WorldStateInput {
  chat: string;
  /** The turn starting: the world state is the state at its start. */
  turn: string;
  /** The world state's layout as the chat has it: the part's text, or the part as read. */
  layout: string | Part;
  /** Each place's map as text; absent, no map is shown. */
  map?: MapText;
  /** What time brings due; absent, no due section is given. */
  due?: DueSource;
  /**
   * The holds that cannot be (R-173): what the chat's tidy-up finds at the turn's start with `things.tidy` on, less what it was told
   * to leave. Each is listed under "unsettled" with the fix the tidy would make; the store neither finds nor applies one.
   */
  holds?: readonly TidyFinding[];
  /** Characters counted as one token, the model layer's own ratio (RPH's `tokens.charsPerToken`): the budget is counted at it. */
  charsPerToken: number;
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

const isSoft = (m: Pick<Mark, "precision" | "standing" | "source"> & { unchecked?: true }): boolean =>
  (m.precision !== null && SOFT_PRECISION.has(m.precision)) || (m.standing !== null && SOFT_STANDING.has(m.standing)) || m.source === null || m.unchecked === true;

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

  // The horizon as the Author left it, in his order (plan §6.9): the scene, its first entry that names the world, in full, and every
  // other entry at the depth he set for it (full when he set none); an entry inside one shown in full is shown with it, and one that
  // names nothing in the world is shown as his own words, once. It is never cut for length.
  const entries = view.horizon();
  const depthOf = new Map<string, number | "full">();
  for (const h of entries) if (h.ref !== null && !depthOf.has(h.ref)) depthOf.set(h.ref, depthOf.size === 0 ? "full" : h.depth);
  const ancestors = (ref: string): string[] => {
    const out: string[] = [];
    for (let at = view.parentOf(ref); at !== null; at = view.parentOf(at)) out.push(at);
    return out;
  };
  const horizon = [...depthOf.keys()].filter((ref) => !ancestors(ref).some((a) => depthOf.get(a) === "full"));
  // What the horizon shows: each entry, and its levels down to its depth.
  const within = new Set<string>();
  const gather = (ref: string, depth: number | "full"): void => {
    within.add(ref);
    if (depth === "full" || depth > 0) for (const c of view.childrenOf(ref)) gather(c, depth === "full" ? depth : depth - 1);
  };
  for (const ref of horizon) gather(ref, depthOf.get(ref) ?? "full");
  // Every entry brings the chain above it up to the world, nearest first; a parent shared by several, or shown on the horizon, once (R-63).
  const chain: string[] = [];
  for (const ref of horizon) for (const a of ancestors(ref)) if (!within.has(a) && !chain.includes(a)) chain.push(a);
  const scene = horizon[0] ?? null;
  const scenePlace = scene === null ? null : [scene, ...ancestors(scene)].find((r) => r.startsWith("place:")) ?? null;
  const nameOf = (ref: string): string => view.nameOf(ref) ?? ref.replace(/^(place|entity):/, "");

  const sections: Partial<Record<WorldStateSection, ViewLine[]>> = {};
  // Each level's reflection says what falls due under it in the same span the due section lists, when the reading has a due source.
  const reading: ViewReading | undefined = input.due === undefined ? undefined : { due: input.due, ahead: settings.dueAhead };
  if (want("horizon")) {
    const left = new Set<string>(horizon);
    const said = new Set<string>();
    sections.horizon = entries.flatMap((h): ViewLine[] => {
      if (h.ref !== null) return left.delete(h.ref) ? horizonLines(view, h.ref, depthOf.get(h.ref) ?? "full", input.map, reading) : [];
      if (said.has(h.at)) return [];
      said.add(h.at);
      return [{ kind: "horizon_words", depth: 0, fields: { text: h.at } }];
    });
  }
  if (want("above")) sections.above = chain.flatMap((ref) => view.level(ref, 0, "own", reading) ?? []);
  if (want("around")) sections.around = around(view, scenePlace, new Set([...within, ...chain])).flatMap((ref) => view.level(ref, 0, "none", reading) ?? []);
  const before = turn.parent === null ? null : store.turn(turn.parent);
  const lastRows = before === null ? [] : store.changes(before.id);
  // How many more a section's span holds than its lines list (null: more, uncounted); its cut counts them with what it leaves out.
  const beyond: Partial<Record<WorldStateSection, number | null>> = {};
  const budget = settings.budget * input.charsPerToken;
  const now = state.world.clock;
  // On a clock nobody set (the blank world's, until play sets it) a time is given only as how long from now, or how long ago.
  const dated = clockRecorded(state);
  const dueLine = (kind: string, d: DueEntry, fields: JsonObject): ViewLine => {
    const where = d.where === undefined ? null : view.resolve(d.where);
    const out: JsonObject = { ...fields, kind: d.kind, what: said(d.what) };
    if (dated) out.when = formatClock(calendarOf(view.world), d.at);
    if (where !== null) out.where = nameOf(where);
    if (d.who !== undefined && d.who.length > 0) out.who = d.who.map((id) => nameOf(`entity:${id}`)).join(", ");
    return { kind, depth: 0, fields: out };
  };
  // Beside a move of the clock in the turn before: what fell due in the time it moved past, which nothing applied (plan §6.1, §6.4).
  if (want("passed") && input.due !== undefined && before !== null && lastRows.some((r) => r.applied && r.op === "clock")) {
    const since = store.startOf(before.id).state.world.clock;
    if (now > since) {
      const listed = dueShown(part, input.due, state, { from: since, to: now }, budget, (d) => dueLine("fell_due", d, { ago: now - d.at }));
      sections.passed = listed.lines;
      beyond.passed = listed.more;
    }
  }
  // Without a source of what falls due (a world state read where no clock runs) there is no section to give.
  if (want("due") && input.due !== undefined) {
    // Its span is the user's own `dueAhead`.
    const listed = dueShown(part, input.due, state, { from: now, to: now + settings.dueAhead }, budget, (d) => dueLine("due", d, { after: d.at - now }));
    sections.due = listed.lines;
    beyond.due = listed.more;
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
    // Every change of the turn before, and every change placed since (a job's, his own), that carries a report, did not apply, names
    // no source, or is an invention with no gap check or consent: wherever in the world it is.
    const listed = new Set<number>();
    for (const u of store.unsettledOf(input.chat, before?.id ?? null, turn.id)) {
      listed.add(u.change.id);
      lines.push(unsettledChange(u, before !== null && u.turn === before.id ? before.depth + 1 : null, nameOf, view));
    }
    // What stopped applying is told once, in the first briefing after, by its thing and its value: what the turn before started
    // from, its own briefing told.
    const told = new Set(before === null ? [] : store.startOf(before.id).notApplied.map((x) => x.change));
    for (const x of folded.notApplied) {
      if (told.has(x.change) || listed.has(x.change)) continue;
      const t = x.turn === "" ? null : store.turn(x.turn);
      lines.push({ kind: "unsettled_stopped", depth: 0, fields: { op: x.op, ...(t === null ? { between: true } : { turn: t.depth + 1 }), ...aboutField(x.about ?? [], nameOf, view), value: said(x.value ?? null), codes: x.reports.map((r) => r.code) } });
    }
    // The holds that cannot be, each once, with the fix the tidy would make as its operations.
    const holds = new Set<string>();
    for (const h of input.holds ?? []) {
      if (holds.has(h.key)) continue;
      holds.add(h.key);
      lines.push(holdLine(h, nameOf, view));
    }
    sections.unsettled = lines;
  }

  // The budget, shared by every section but the horizon: the smallest needs are met first, each while
  // it is no more than an even share of what is left, so no section crowds out the rest; the outline,
  // which gives way level by level, takes the room that remains.
  const needs: [WorldStateSection, number][] = [];
  for (const s of WORLD_STATE_SECTIONS) {
    const lines = sections[s];
    if (s !== "horizon" && s !== "outline" && lines !== undefined) needs.push([s, lines.reduce((n, l) => n + costOf(part, l), 0)]);
  }
  let left = budget;
  let sharing = needs.length + (want("outline") ? 1 : 0);
  for (const [s, need] of needs.sort((a, b) => a[1] - b[1])) {
    const kept = fit(part, s, sections[s] ?? [], Math.min(need, Math.floor(left / sharing)), beyond[s] ?? 0);
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
  return { text, sections, tokens: Math.ceil(used / input.charsPerToken) };
}

/** What a line takes of the budget: its words and the line break after them; nothing for a kind the layout does not word. */
function costOf(part: Part, line: ViewLine): number {
  const words = wordLine(part, line);
  return words === null ? 0 : words.length + 1;
}

/**
 * As many of a section's lines as fit in `room` characters, in order. When some do not, or its span
 * holds `beyond` more than its lines list, the layout's `left_out` line, counting them all, ends the
 * section at the depth of the first one left out, with room kept for it (`left_out_uncounted` when
 * how many the span holds was not counted); when not even that fits, the section is that line alone,
 * past its share: nothing is dropped for space without a word (B-3).
 */
function fit(part: Part, section: WorldStateSection, lines: readonly ViewLine[], room: number, beyond: number | null): { lines: ViewLine[]; used: number } {
  const costs = lines.map((l) => costOf(part, l));
  let used = 0;
  let k = 0;
  while (k < lines.length && used + (costs[k] as number) <= room) used += costs[k++] as number;
  if (k === lines.length && beyond === 0) return { lines: [...lines], used };
  const noteAt = (at: number): ViewLine => {
    const n = beyond === null ? null : lines.length - at + beyond;
    const depth = (lines[at] ?? lines[at - 1])?.depth ?? 0;
    return n === null ? { kind: "left_out_uncounted", depth, fields: { section, [section]: true } } : { kind: "left_out", depth, fields: { n, one: n === 1, section, [section]: true } };
  };
  for (; k >= 0; k--) {
    const total = used + costOf(part, noteAt(k));
    if (total <= room) return { lines: [...lines.slice(0, k), noteAt(k)], used: total };
    if (k > 0) used -= costs[k - 1] as number;
  }
  const alone = noteAt(0);
  return { lines: [alone], used: costOf(part, alone) };
}

/** The things a line is about, by name, as its `about` field; none for a line about nothing in the tree. */
function aboutField(about: readonly string[], nameOf: (ref: string) => string, view: TreeView): JsonObject {
  const names = [...new Set(about.flatMap((ref) => (view.resolve(ref) === null ? [] : [nameOf(view.resolve(ref) as string)])))];
  return names.length > 0 ? { about: { names } } : {};
}

/**
 * A change "unsettled" lists, as its line: its operation, its turn's number (`between` when placed between turns), its lane and
 * who made it, the things it is about and the value it carried, its reports (codes, and each report as a piece with its values),
 * whether it applied, and the marks that list it (no source; an invention with no gap check or consent).
 */
function unsettledChange(u: UnsettledChange, n: number | null, nameOf: (ref: string) => string, view: TreeView): ViewLine {
  const c = u.change;
  const fields: JsonObject = { op: c.op, lane: c.lane, ...(n === null ? { between: true } : { turn: n }), ...aboutField(u.about, nameOf, view), value: said(c.value), applied: c.applied && !u.why.includes("not_applied") };
  if (c.by !== null) fields.by = c.by;
  if (c.reports.length > 0) {
    fields.codes = c.reports.map((r) => r.code);
    fields.reports = { pieces: c.reports.map((r) => ({ kind: "unsettled_code", fields: { code: r.code, ...(r.values !== undefined && Object.keys(r.values).length > 0 ? { values: JSON.stringify(r.values) } : {}) } })) };
  }
  if (u.why.includes("unsourced")) fields.unsourced = true;
  if (u.why.includes("unchecked")) fields.unchecked = true;
  return { kind: "unsettled_change", depth: 0, fields };
}

/**
 * A hold that cannot be, as its line: its kind, the things it names, and the fix the tidy would make as that fix's operations, each
 * a piece the layout words by its own key (`fix_<what it does>`), its ids given as the names they have; never the finding's own
 * words (its text, a fix's label, an operation's `why`).
 */
function holdLine(h: TidyFinding, nameOf: (ref: string) => string, view: TreeView): ViewLine {
  const named = (v: JsonValue): JsonValue => {
    if (typeof v !== "string") return isRecord(v) || Array.isArray(v) ? JSON.stringify(v) : v;
    const ref = view.resolve(v);
    return ref === null ? v : nameOf(ref);
  };
  const fields: JsonObject = { kind: h.kind, things: { names: h.things.map((id) => named(id)) } };
  if (h.fix !== null) {
    fields.fix = {
      pieces: h.fix.ops.map((op) => {
        // A thing's operation says what it does (`do`); any other is its own operation.
        const body = (op.op === "item" ? op.change : op) as unknown as JsonObject;
        const what = String(op.op === "item" ? op.change.do : op.op);
        const rest = Object.entries(body).filter(([k]) => k !== "op" && k !== "do" && k !== "why");
        return { kind: `fix_${what}`, fields: Object.fromEntries(rest.map(([k, v]) => [k, named(v ?? null)])) };
      }),
    };
  }
  return { kind: "unsettled_hold", depth: 0, fields };
}

/**
 * What `span` brings due as the lines of a section, the soonest first: as many as all of `room` could show at each line's own
 * cost, and one more where the span holds more, with how many more it holds than those (null: more, not counted). The due list
 * is asked for in batches, each twice the last, so what a span costs is what the lines its budget can show cost, however long
 * the span. A layout that words none of the lines asked for shows none, and is asked for no more.
 */
function dueShown(part: Part, source: DueSource, state: StoreState, span: { from: number; to: number }, room: number, line: (d: DueEntry) => ViewLine): { lines: ViewLine[]; more: number | null } {
  for (let most = 1; ; most *= 2) {
    const listing = source.due(state, span, null, most);
    const lines = listing.items.map(line);
    let used = 0;
    let k = 0;
    for (; k < lines.length && used + costOf(part, lines[k] as ViewLine) <= room; k++) used += costOf(part, lines[k] as ViewLine);
    if (k < lines.length || used === 0 || listing.more === 0 || listing.items.length < most) return { lines, more: listing.more };
  }
}

/** A horizon entry at its depth; one shown in full that is a place, with its map after its own values. */
function horizonLines(view: TreeView, ref: string, depth: number | "full", map: MapText | undefined, reading: ViewReading | undefined): ViewLine[] {
  const lines = view.query(ref, depth, reading)?.lines ?? [];
  if (depth !== "full" || !ref.startsWith("place:")) return lines;
  const printed = map === undefined ? null : map.text({ state: view.state, env: view.env, place: ref.slice("place:".length) });
  const text = printed === null ? null : printed.text;
  const mapLine: ViewLine | null = text === null ? null : { kind: "map", depth: 1, fields: { text } };
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
  return fit(part, "outline", out, room, 0).lines;
}
