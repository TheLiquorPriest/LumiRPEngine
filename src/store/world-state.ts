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
import { DOMAINS } from "../shared/ids";
import { trackOwner } from "../shared/world";
import { calendarOf, formatClock, placeOffset, placeZone } from "../engine/calendar";
import { own } from "../engine/pack-kit";
import { presetOf } from "../engine/realism";
import { clockPaused } from "../engine/time";
import { clockRecorded } from "./blank";
import { standing } from "./facts";
import { aboutOf, type FoldEnv } from "./fold";
import type { UserStore } from "./store";
import { LANES, StoreInputError, type ChangeRow, type Mark, type StoreState, type UnsettledChange } from "./types";
import { factFields, HORIZON, markFields, type TreeView, type ViewReading } from "./view";
import { readPart, wordLine, type Part, type ViewLine } from "./words";

/** The story area's read of the scene the chat is in (`{ scene, place, who }`, null when none is open; PlanStory-5). */
const SCENE_READ = "scene";

/** The nearest place at or above `ref` in the tree; none where no place holds it. */
function placeAbove(view: TreeView, ref: string | null): string | null {
  for (let at = ref; at !== null; at = view.parentOf(at)) if (at.startsWith("place:")) return at;
  return null;
}

/** The levels above `ref` in the tree, nearest first, up to the world. */
function ancestorsOf(view: TreeView, ref: string): string[] {
  const out: string[] = [];
  for (let at = view.parentOf(ref); at !== null; at = view.parentOf(at)) out.push(at);
  return out;
}

/** The place the open scene's record names (the story's `scene` read), found in the tree, on any state the store gives; none when no scene is open or its place is not found. */
export function openScenePlaceOf(view: TreeView): string | null {
  const area = view.env.areas?.get(HORIZON.area);
  const read = area?.reads && Object.hasOwn(area.reads, SCENE_READ) ? area.reads[SCENE_READ] : undefined;
  const scene = read?.(view.state.areas?.[HORIZON.area] ?? area?.initial?.() ?? {}, {});
  return placeAbove(view, isRecord(scene) && typeof scene.place === "string" ? view.resolve(scene.place) : null);
}

/** The nearest place that holds his character (the world's point of view), on any state the store gives; none when no place does. */
export function ownerPlaceOf(view: TreeView): string | null {
  return placeAbove(view, view.resolve(`entity:${view.world.pov}`));
}

/** The scene's place (plan §6.9): the open scene's, else the place holding the first horizon entry that names the world, else where his character stands. */
export function scenePlaceOf(view: TreeView): string | null {
  return openScenePlaceOf(view) ?? placeAbove(view, view.horizon().find((h) => h.ref !== null)?.ref ?? null) ?? ownerPlaceOf(view);
}

/** The time at a place: its date and time where the clock is a recorded value (null: nobody set it), the level whose time zone gives it, and whether the clock is paused for the scene. */
export interface TimeAt {
  clock: number;
  time: string | null;
  from: { ref: string; name: string } | null;
  paused: boolean;
}

/** The time at `place` (the scene's place when none is given), on any state the store gives (`TimeAt`). */
export function timeOf(view: TreeView, place: string | null = scenePlaceOf(view)): TimeAt {
  const doc = view.world;
  const clock = view.state.world.clock;
  const id = place !== null && place.startsWith("place:") ? place.slice("place:".length) : null;
  const time = clockRecorded(view.state) ? formatClock(calendarOf(doc), clock, placeOffset(doc, clock, id)) : null;
  const zone = placeZone(doc, id);
  let from: TimeAt["from"] = null;
  for (let at = place; at !== null && from === null; at = view.parentOf(at)) if (at.startsWith("place:") && own(doc.places, at.slice("place:".length))?.timeZone === zone) from = { ref: at, name: view.nameOf(at) ?? at };
  return { clock, time, from: from ?? (time === null ? null : { ref: "world", name: doc.name }), paused: clockPaused(doc, view.state.world) };
}

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
  /** Each place's map as text; absent, no map is shown and no line says so. */
  map?: MapText;
  /** The drawn layer's version of each grid given already this session, by grid: such a grid is printed with its moving layer only. */
  drawnGiven?: Readonly<Record<string, string>>;
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
  /** The drawn layer's version of each grid this block printed it for, by grid: the session keeps them and gives them back as `drawnGiven`. */
  drawnShown: Record<string, string>;
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

  // The horizon (plan §6.9): first the scene's place (`scenePlaceOf`), in full, whatever the horizon names; then the Author's entries in
  // his order, each at the depth he set for it (full when he set none); then his character, in full, where neither shows him. An entry
  // inside one shown in full is shown with it, and one that names nothing in the world is shown as his own words, once. It is never cut.
  const entries = view.horizon();
  const scenePlace = scenePlaceOf(view);
  const pov = view.resolve(`entity:${view.world.pov}`);
  const depthOf = new Map<string, number | "full">();
  if (scenePlace !== null) depthOf.set(scenePlace, "full");
  for (const h of entries) if (h.ref !== null && !depthOf.has(h.ref)) depthOf.set(h.ref, h.depth);
  if (pov !== null && !depthOf.has(pov)) depthOf.set(pov, "full");
  const horizon = [...depthOf.keys()].filter((ref) => !ancestorsOf(view, ref).some((a) => depthOf.get(a) === "full"));
  // What the horizon shows: each entry, and its levels down to its depth.
  const within = new Set<string>();
  const gather = (ref: string, depth: number | "full"): void => {
    within.add(ref);
    if (depth === "full" || depth > 0) for (const c of view.childrenOf(ref)) gather(c, depth === "full" ? depth : depth - 1);
  };
  for (const ref of horizon) gather(ref, depthOf.get(ref) ?? "full");
  // Every entry brings the chain above it up to the world, nearest first; a parent shared by several, or shown on the horizon, once (R-63).
  const chain: string[] = [];
  for (const ref of horizon) for (const a of ancestorsOf(view, ref)) if (!within.has(a) && !chain.includes(a)) chain.push(a);
  const nameOf = (ref: string): string => view.nameOf(ref) ?? ref.replace(/^(place|entity):/, "");

  const sections: Partial<Record<WorldStateSection, ViewLine[]>> = {};
  const drawnShown: Record<string, string> = {};
  // Each level's reflection says what falls due under it in the same span the due section lists, when the reading has a due source.
  const reading: ViewReading | undefined = input.due === undefined ? undefined : { due: input.due, ahead: settings.dueAhead };
  if (want("horizon")) {
    const left = new Set<string>(horizon);
    const maps: Maps = { port: input.map, given: input.drawnGiven ?? {}, shown: drawnShown, grids: new Set(), around: horizon };
    const show = (ref: string): ViewLine[] => (left.delete(ref) ? horizonLines(view, ref, depthOf.get(ref) ?? "full", maps, reading) : []);
    const said = new Set<string>();
    sections.horizon = [
      ...(scenePlace === null ? [] : show(scenePlace)),
      ...entries.flatMap((h): ViewLine[] => {
        if (h.ref !== null) return show(h.ref);
        if (said.has(h.at)) return [];
        said.add(h.at);
        return [{ kind: "horizon_words", depth: 0, fields: { text: h.at } }];
      }),
      ...(pov === null ? [] : show(pov)),
    ];
  }
  if (want("above")) sections.above = chain.flatMap((ref) => view.level(ref, 0, "own", reading) ?? []);
  const budget = settings.budget * input.charsPerToken;
  // The places beside the scene's place: around it, and the due list's middle list.
  const beside = around(view, scenePlace, new Set([...within, ...chain]));
  if (want("around")) sections.around = [...beside.flatMap((ref) => view.level(ref, 0, "none", reading) ?? []), ...onTheWay(view, scenePlace === null ? [] : [scenePlace, ...beside], input.due, settings.dueAhead, budget, nameOf)];
  const before = turn.parent === null ? null : store.turn(turn.parent);
  const lastRows = before === null ? [] : store.changes(before.id);
  // How many more a section's span holds than its lines list (null: more, uncounted); its cut counts them with what it leaves out.
  const beyond: Partial<Record<WorldStateSection, number | null>> = {};
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
  // What is due in the time ahead (plan §6.9), in three lists, each with its own share of the section's room, so what falls due
  // elsewhere never pushes the scene's own out: in the scene (its place and what is in it), around it (the places beside it), and
  // beyond. An item is listed with its place; one that names none, where the people it concerns stand (as the due source lists a
  // part of the tree); one that names neither, beyond, once. Its span is the user's own `dueAhead`.
  const dueLists: DueList[] = [];
  if (want("due") && input.due !== undefined) {
    const source = input.due;
    const span = { from: now, to: now + settings.dueAhead };
    const line = (d: DueEntry): ViewLine => dueLine("due", d, { after: d.at - now });
    const seen = new Set<string>();
    const keyOf = (d: DueEntry): string => JSON.stringify([d.at, d.kind, d.where ?? null, d.who ?? [], d.what]);
    const listOf = (head: string, ats: readonly (string | null)[]): void => {
      const list: DueList = { lines: [], more: 0 };
      for (const at of ats) {
        const shown = dueShown(part, source, state, span, Math.floor(budget / 3), line, at, (d) => seen.has(keyOf(d)));
        for (const d of shown.items) seen.add(keyOf(d));
        list.lines.push(...shown.lines);
        list.more = list.more === null || shown.more === null ? null : list.more + shown.more;
      }
      if (list.lines.length > 0) dueLists.push({ lines: [{ kind: head, depth: 0, fields: {} }, ...list.lines], more: list.more });
    };
    if (scenePlace !== null) listOf("due_scene", [scenePlace]);
    if (beside.length > 0) listOf("due_around", beside);
    listOf("due_beyond", [null]);
    sections.due = dueLists.flatMap((l) => l.lines);
  }
  if (want("open")) {
    sections.open = [];
    for (const [id, t] of Object.entries(view.world.tracks)) {
      const stage = state.world.tracks[id]?.stage ?? t.start;
      const at = own(t.stages, stage);
      const owner = trackOwner(t);
      if ((at?.next.length ?? 0) === 0 || owner === undefined || !within.has(`entity:${owner}`)) continue;
      sections.open.push({ kind: "quest", depth: 0, fields: { id, label: t.label, kind: t.kind, stage: at?.label ?? stage, owner: nameOf(`entity:${owner}`), ...markFields(state.marks[`track:${id}`]?.stage) } });
    }
  }
  // What changed since the turn before began: its own changes (a job's written on it count where they take effect) and what is
  // placed before this turn (a job's that took effect, his own).
  if (want("changed")) sections.changed = changedLines(view, [...lastRows.filter((c) => c.job === null).map((change) => ({ change, applied: change.applied })), ...store.changesBefore(turn.id)], nameOf);
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
    const room = Math.min(need, Math.floor(left / sharing));
    const kept = s === "due" && dueLists.length > 0 ? fitLists(part, dueLists, room) : fit(part, s, sections[s] ?? [], room, beyond[s] ?? 0);
    sections[s] = kept.lines;
    left -= kept.used;
    sharing--;
  }
  // The world's realism opens the outline, then the world's own line unless the chain above shows it.
  if (want("outline")) {
    const realism = realismLine(state);
    sections.outline = [realism, ...outline(view, part, left - costOf(part, realism), new Set(horizon), !(want("above") && chain.length > 0))];
  }
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
  return { text, sections, tokens: Math.ceil(used / input.charsPerToken), drawnShown };
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
 * What `span` brings due under `at` (null: the whole world) as the lines of a section, the soonest first, less what `skip` says is
 * listed already: as many as all of `room` could show at each line's own cost, and one more where the span holds more, with how many
 * more it holds than those (null: more, not counted). The due list is asked for in batches, each twice the last, so what a span costs
 * is what the lines its budget can show cost, however long the span. A layout that words none of the lines asked for shows none, and
 * is asked for no more.
 */
function dueShown(part: Part, source: DueSource, state: StoreState, span: { from: number; to: number }, room: number, line: (d: DueEntry) => ViewLine, at: string | null = null, skip: (d: DueEntry) => boolean = () => false): { lines: ViewLine[]; items: DueEntry[]; more: number | null } {
  for (let most = 1; ; most *= 2) {
    const listing = source.due(state, span, at, most);
    const items = listing.items.filter((d) => !skip(d));
    const lines = items.map(line);
    let used = 0;
    let k = 0;
    for (; k < lines.length && used + costOf(part, lines[k] as ViewLine) <= room; k++) used += costOf(part, lines[k] as ViewLine);
    if (k < lines.length || used === 0 || listing.more === 0 || listing.items.length < most) return { lines, items, more: listing.more };
  }
}

/** One of the due section's lists: its heading line and items, and how many more its span holds than it lists (null: more, uncounted). */
interface DueList {
  lines: ViewLine[];
  more: number | null;
}

/** The due section's lists within `room`: the smallest needs met first, each while no more than an even share of what is left, so no list crowds out another; in their own order. */
function fitLists(part: Part, lists: readonly DueList[], room: number): { lines: ViewLine[]; used: number } {
  const kept = new Map<DueList, ViewLine[]>();
  let left = room;
  const needOf = (l: DueList): number => l.lines.reduce((n, x) => n + costOf(part, x), 0);
  [...lists]
    .sort((a, b) => needOf(a) - needOf(b))
    .forEach((l, i, all) => {
      const got = fit(part, "due", l.lines, Math.min(needOf(l), Math.floor(left / (all.length - i))), l.more);
      kept.set(l, got.lines);
      left -= got.used;
    });
  return { lines: lists.flatMap((l) => kept.get(l) ?? []), used: room - left };
}

/** The world's realism (R-76) as the chat has it: its preset and each domain's level; each domain is shown as closely as its level says. */
function realismLine(state: StoreState): ViewLine {
  const realism = state.world.realism;
  return { kind: "realism", depth: 0, fields: { preset: presetOf(realism), ...Object.fromEntries(DOMAINS.map((d) => [d, realism.levels[d] ?? null])) } };
}

/** The maps a world state prints through the map port (Maps-4): each grid once, its drawn layer only where the session was not given that version. */
interface Maps {
  port: MapText | undefined;
  given: Readonly<Record<string, string>>;
  shown: Record<string, string>;
  /** The grids printed already in this block. */
  grids: Set<string>;
  /** The horizon's entries, which the printed part of a big grid must hold. */
  around: readonly string[];
}

/** A place's map line: its moving layer, with its drawn layer where the session was not given that version; none for a place with no map, or on a grid printed already. */
function mapLine(view: TreeView, place: string, maps: Maps): ViewLine | null {
  if (maps.port === undefined) return null;
  const input = { state: view.state, env: view.env, place: place.slice("place:".length), around: maps.around };
  const moving = maps.port.text({ ...input, layer: "moving" });
  if (moving === null || maps.grids.has(moving.grid)) return null;
  maps.grids.add(moving.grid);
  if (maps.given[moving.grid] === moving.drawn) return { kind: "map", depth: 1, fields: { text: moving.text } };
  const both = maps.port.text(input) ?? moving;
  maps.shown[both.grid] = both.drawn;
  return { kind: "map", depth: 1, fields: { text: both.text } };
}

/** A horizon entry at its depth; one shown in full that is a place, with its map after its own values. */
function horizonLines(view: TreeView, ref: string, depth: number | "full", maps: Maps, reading: ViewReading | undefined): ViewLine[] {
  const lines = view.query(ref, depth, reading)?.lines ?? [];
  if (depth !== "full" || !ref.startsWith("place:")) return lines;
  const map = mapLine(view, ref, maps);
  if (map === null) return lines;
  const at = lines.findIndex((l, i) => i > 0 && l.kind.startsWith("level_"));
  return at < 0 ? [...lines, map] : [...lines.slice(0, at), map, ...lines.slice(at)];
}

/**
 * Who is on the way to the scene's place or a place beside it (plan §6.9): each one an arrival the due list gives there in the time
 * ahead brings (a schedule's move there among them), and each person whose recorded trip ends there and has not brought them yet; a
 * line each, by who, where to and how long from now, none for someone there already. The due list is asked for no more than `room`
 * lines could ever hold.
 */
function onTheWay(view: TreeView, places: readonly string[], due: DueSource | undefined, ahead: number, room: number, nameOf: (ref: string) => string): ViewLine[] {
  const now = view.state.world.clock;
  const out: ViewLine[] = [];
  const seen = new Set<string>();
  const add = (who: string, to: string, at: number | null): void => {
    const key = `${who}\u0000${to}`;
    if (seen.has(key) || ancestorsOf(view, `entity:${who}`).includes(to)) return;
    seen.add(key);
    out.push({ kind: "on_the_way", depth: 0, fields: { who: nameOf(`entity:${who}`), to: nameOf(to), ...(at !== null && at > now ? { after: at - now } : {}) } });
  };
  for (const to of places) {
    const listed = due?.due(view.state, { from: now, to: now + ahead }, to, Math.max(1, room)).items ?? [];
    for (const d of listed) if ((d.kind === "arrival" || d.kind === "place") && (d.where === undefined || view.resolve(d.where) === to)) for (const who of d.who ?? []) add(who, to, d.at);
  }
  for (const [id, e] of Object.entries(view.state.world.entities)) {
    const trips = e.fields.trips;
    if (!Array.isArray(trips)) continue;
    for (const t of trips) {
      if (!isRecord(t) || typeof t.place !== "string" || (typeof t.until === "number" && t.until <= now) || (typeof t.from === "number" && t.from > now + ahead)) continue;
      const to = view.resolve(`place:${t.place}`);
      if (to !== null && places.includes(to)) add(id, to, typeof t.from === "number" ? t.from : null);
    }
  }
  return out;
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

/**
 * What changed since the turn before began, a line for each lane (plan §6.9): how many changes, which operations, what they touched,
 * who made them, how many did not apply; his own edits told apart as his, a line for each lane they reach; a lane with nothing, a
 * line that says so.
 */
function changedLines(view: TreeView, rows: readonly { change: ChangeRow; applied: boolean }[], nameOf: (ref: string) => string): ViewLine[] {
  const out: ViewLine[] = [];
  const lineOf = (kind: string, lane: string, mine: readonly { change: ChangeRow; applied: boolean }[]): ViewLine => {
    const touched: string[] = [];
    for (const r of mine) {
      if (!r.applied) continue;
      for (const at of aboutOf(view.env, r.change.op, r.change.value)) {
        const ref = view.resolve(at);
        if (ref !== null && !touched.includes(nameOf(ref))) touched.push(nameOf(ref));
      }
    }
    const by = [...new Set(mine.flatMap((r) => (r.change.by === null ? [] : [r.change.by])))];
    const unapplied = mine.filter((r) => !r.applied).length;
    const fields: JsonObject = { lane, n: mine.length, one: mine.length === 1, ops: { list: [...new Set(mine.map((r) => r.change.op))] } };
    if (touched.length > 0) fields.touched = { names: touched };
    if (by.length > 0) fields.by = { names: by };
    if (unapplied > 0) fields.unapplied = unapplied;
    return { kind, depth: 0, fields };
  };
  // His own edit: a change of his chat made by no job.
  const his = (c: ChangeRow): boolean => c.chat !== null && c.job === null;
  for (const lane of LANES) {
    const theirs = rows.filter((r) => r.change.lane === lane && !his(r.change));
    const mine = rows.filter((r) => r.change.lane === lane && his(r.change));
    if (theirs.length > 0) out.push(lineOf("changed", lane, theirs));
    if (mine.length > 0) out.push(lineOf("changed_his", lane, mine));
    if (theirs.length === 0 && mine.length === 0) out.push({ kind: "changed_none", depth: 0, fields: { lane } });
  }
  return out;
}

/**
 * The rest of the world in outline, within `room` characters: a line for each level in the world, and for each level of the groups
 * heading, so every region and every group has one; then breadth first each level's levels while they fit. A level whose levels are
 * not shown is marked with the query that opens it, and the mark is counted as soon as its line is. A horizon entry, shown in full,
 * is not opened here. Where even the floor does not fit, the layout's line counting what is left out ends the outline.
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
  // A heading (the groups level) is no layer of its own: its levels are on the floor too.
  let layer = first.flatMap((x) => {
    if (view.node(x.ref)?.kind !== "groups" || !opensFrom(x.ref)) return [x];
    const kids = view.childrenOf(x.ref).map((ref) => ({ ref, depth: x.depth + 1 }));
    used += kids.reduce((n, k) => n + closed(k.ref, k.depth), 0) - (closed(x.ref, x.depth) - cost(lineOf(x.ref, x.depth)));
    opened.add(x.ref);
    for (const k of kids) shown.add(k.ref);
    return kids;
  });
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
