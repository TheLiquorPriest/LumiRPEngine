// Build's map editor (DESIGN §13): a map (`lre-map-v1`) drawn and edited by touch,
// with its JSON one tab away. Every edit goes through that JSON, so the two never disagree: a
// visual edit writes the map's JSON (laid out by `formatMap`), and typed JSON redraws the map. A
// grid map is painted cell by cell with its legend's brushes (rooms, doors, walls, terrain, zones,
// things), flood-filled, and its places dragged to their cells; a node map's places are dragged
// into position and joined by dragging from one to another. Rooms, legend entries, places and
// links open as sheets. Every problem the schema and the map lint find is marked where it is on
// the canvas and on the preview, listed, and opens what it's about; the JSON tab marks each on its
// line. Insert template starts a small grid map or node map.

import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import type { Cell } from "../../../shared/grid";
import { nearestMiddle } from "../../../shared/grid";
import type { TravelMode } from "../../../shared/ids";
import type { JsonValue } from "../../../shared/json";
import { hasOwn, isRecord } from "../../../shared/json";
import { DEFAULT_LEGEND, formatMap, mapProblems, mapTemplate, nameOfId, readMap, VOID_TERRAIN } from "../../../shared/maps";
import { pathText, type JsonPath } from "../../../shared/schema-check";
import type { MapDoc, WorldDoc } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { deleteItem, go, ItemHeader, newItemName, type MenuItem } from "../../../frontend/build/chrome";
import { CheckField, Chip, FormGroup, FormSheet, Issues, ItemRow, RefPicker, type RefOption } from "../../../frontend/build/form-kit";
import { useHeld } from "../../../frontend/build/held";
import { deriveId, newItem } from "../../../frontend/build/schema";
import { Badge, Banner, Button, Disclosure, Empty, Field, IconButton, IdText, NumberStepper, SaveBar, Seg, Tabs, tabPanel, useBusy, useShowIds } from "../../../frontend/components";
import { Icon } from "../../../frontend/icons";
import { lineAt, parseJsonText } from "../../../frontend/json-text";
import { hitTest, TAP_SLOP, toScreen, toWorld, type Point, type Transform } from "../../../frontend/map-math";
import type { EditorProps } from "../../../frontend/registry";
import type { LintIssue } from "../../../shared/protocol";
import type { MapScopeView } from "../core/map-scope";
import type { CanvasPalette } from "./canvas-theme";
import { cellAt, cellView, crossCell, EditCanvas, gridLines, gridUnit, strokeCells, Swatch, usePalette, ZOOM_STRIP, type CanvasTool } from "./editors";
import { LABEL_PAD, LINE, placeLabels, type Box, type PlacedLabel } from "./labels";
import { areaFill, FRAME_UNITS, terrainFill, type Paint } from "./map-draw";
import { MapPreview, previewMarks, previewScope, type PreviewMark } from "./map-preview";

/** The code area's line height in px (the gutter and the text share it). */
const LINE_PX = 18;

export interface MapTextProblem {
  line: number;
  severity: "error" | "warning";
  message: string;
  /** Where in the map, as a JSON path; empty for text that isn't JSON yet. */
  path: JsonPath;
}

export interface CheckedMapText {
  /** The text as JSON, or null while it isn't JSON. */
  value: JsonValue | null;
  /** Every problem, by line. */
  problems: MapTextProblem[];
  /** The map's scope as Play would draw it, once the map reads as lre-map-v1. */
  scope: MapScopeView | null;
}

/** A map's text checked as the editor shows it: JSON first, then the schema and the map lint against the draft, each problem on its line. */
export function checkMapText(text: string, key: string, world: WorldDoc): CheckedMapText {
  const parsed = parseJsonText(text);
  if (!parsed.ok) return { value: null, problems: [{ line: parsed.line, severity: "error", message: `Not JSON yet (column ${parsed.column}): ${parsed.message}.`, path: [] }], scope: null };
  // Lint reads every map through the schema check, so the candidate goes in as it is.
  const doc: WorldDoc = { ...world, maps: { ...world.maps, [key]: parsed.value as unknown as MapDoc } };
  const problems = (mapProblems(doc).get(key) ?? [])
    .map((p) => ({ line: lineAt(parsed.lines, p.path), severity: p.severity, message: `${p.path.length > 0 ? `${pathText(p.path)}: ` : ""}${p.message}`, path: p.path }))
    .sort((a, b) => a.line - b.line);
  const { map } = readMap(parsed.value);
  return { value: parsed.value, problems, scope: map ? previewScope(world, key, map) : null };
}

// ---------------------------------------------------------------- the map as the editor reads it

/** A map's JSON while it is edited: any JSON object, so keys and entries the editor doesn't know stay as they are. */
export type MapValue = Record<string, unknown>;

export interface MapPlaceEntry {
  /** Its position in `places`. */
  index: number;
  id: string;
  /** Its own name, or its id in words. */
  name: string;
  at: Cell | null;
  opens: string | null;
}

export interface MapLinkEntry {
  index: number;
  from: string;
  to: string;
  minutes: number;
  mode: TravelMode;
  both: boolean;
}

/** What a map draws, read leniently: entries of the wrong shape are left out here (lint names them) and keep their place in the JSON. */
export interface MapModel {
  kind: "grid" | "node" | "empty";
  layout: string[];
  /** The layout's size on a grid map; the frame positions sit in on a node map. */
  width: number;
  height: number;
  legend: Record<string, unknown>;
  places: MapPlaceEntry[];
  links: MapLinkEntry[];
}

const MODES: readonly TravelMode[] = ["walk", "road", "offroad", "water"];

function pairOf(value: unknown): Cell | null {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number" ? { x: value[0], y: value[1] } : null;
}

/** A map's model, or why the editor can't draw it (its JSON then needs fixing first). */
export function readModel(value: MapValue): MapModel | string {
  const { layout, legend, places, links } = value;
  if (layout !== undefined && !(Array.isArray(layout) && layout.every((row) => typeof row === "string"))) return "The layout isn't a list of rows of text.";
  if (legend !== undefined && !isRecord(legend)) return "The legend isn't an object.";
  if (places !== undefined && !Array.isArray(places)) return "The places aren't a list.";
  if (links !== undefined && !Array.isArray(links)) return "The links aren't a list.";
  const rows = Array.isArray(layout) ? layout.filter((row): row is string => typeof row === "string") : [];
  const placeList: MapPlaceEntry[] = [];
  (Array.isArray(places) ? places : []).forEach((p, index) => {
    if (!isRecord(p) || typeof p.id !== "string") return;
    placeList.push({ index, id: p.id, name: typeof p.name === "string" && p.name ? p.name : nameOfId(p.id), at: pairOf(p.at), opens: typeof p.opens === "string" ? p.opens : null });
  });
  const linkList: MapLinkEntry[] = [];
  (Array.isArray(links) ? links : []).forEach((l, index) => {
    if (!isRecord(l) || typeof l.from !== "string" || typeof l.to !== "string") return;
    const mode = MODES.find((m) => m === l.mode) ?? "walk";
    linkList.push({ index, from: l.from, to: l.to, minutes: typeof l.minutes === "number" ? l.minutes : 0, mode, both: l.bidirectional !== false });
  });
  const kind = Array.isArray(layout) ? "grid" : placeList.length > 0 || linkList.length > 0 || value.size !== undefined ? "node" : "empty";
  if (kind === "grid") {
    const { width, height } = layoutSize(rows);
    return { kind, layout: rows, width, height, legend: isRecord(legend) ? legend : {}, places: placeList, links: linkList };
  }
  // A node map's frame: its size, else enough for every position (as Play reads it), at least 100 square.
  const size = pairOf(value.size);
  const xs = placeList.map((p) => p.at?.x ?? 0);
  const ys = placeList.map((p) => p.at?.y ?? 0);
  const frame = size && size.x > 0 && size.y > 0 ? size : { x: Math.max(100, ...xs), y: Math.max(100, ...ys) };
  return { kind, layout: [], width: frame.x, height: frame.y, legend: isRecord(legend) ? legend : {}, places: placeList, links: linkList };
}

/** A layout's size: the widest row (in characters, code points) by the row count. */
export function layoutSize(layout: readonly string[]): { width: number; height: number } {
  return { width: Math.max(0, ...layout.map((row) => [...row].length)), height: layout.length };
}

/** What one layout character stands for. */
export type CellMeaning =
  | { kind: "wall" }
  | { kind: "floor" }
  | { kind: "door" }
  | { kind: "nothing" }
  | { kind: "terrain"; terrain: string; blocked: boolean }
  | { kind: "place"; place: string }
  | { kind: "roomDoor"; place: string }
  | { kind: "zone"; zone: string }
  | { kind: "item"; item: string; place: string | null }
  | { kind: "unknown" };

/** A character's meaning: the map's legend, else the default one (# wall, . floor, + door, a space nothing). */
export function cellMeaning(legend: Readonly<Record<string, unknown>>, ch: string): CellMeaning {
  const cell = hasOwn(legend, ch) ? legend[ch] : hasOwn(DEFAULT_LEGEND, ch) ? DEFAULT_LEGEND[ch] : undefined;
  if (cell === "wall" || cell === "floor" || cell === "door") return { kind: cell };
  if (!isRecord(cell)) return { kind: "unknown" };
  if (typeof cell.terrain === "string") return cell.terrain === VOID_TERRAIN && cell.blocked === true ? { kind: "nothing" } : { kind: "terrain", terrain: cell.terrain, blocked: cell.blocked === true };
  if (cell.door === true && typeof cell.place === "string") return { kind: "roomDoor", place: cell.place };
  if (typeof cell.place === "string" && cell.item === undefined) return { kind: "place", place: cell.place };
  if (typeof cell.zone === "string") return { kind: "zone", zone: cell.zone };
  if (typeof cell.item === "string") return { kind: "item", item: cell.item, place: typeof cell.place === "string" ? cell.place : null };
  return { kind: "unknown" };
}

/** The layout with `cells` set to `ch`. A row shorter than a cell is padded with spaces first: nothing, as the engine reads a short row. */
export function paintLayout(layout: readonly string[], cells: readonly Cell[], ch: string): string[] {
  const rows = layout.map((row) => [...row]);
  for (const { x, y } of cells) {
    const row = rows[y];
    if (!row || x < 0) continue;
    while (row.length < x) row.push(" ");
    row[x] = ch;
  }
  return rows.map((row) => row.join(""));
}

/** The cells a fill from `start` reaches: the same character, side by side (a short row's missing cells read as a space). */
export function fillCells(layout: readonly string[], start: Cell): Cell[] {
  const rows = layout.map((row) => [...row]);
  const { width, height } = layoutSize(layout);
  const at = (c: Cell) => rows[c.y]?.[c.x] ?? " ";
  if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height) return [];
  const ch = at(start);
  const seen = new Set<number>([start.y * width + start.x]);
  const out: Cell[] = [];
  const queue: Cell[] = [start];
  for (let next = queue.shift(); next; next = queue.shift()) {
    out.push(next);
    for (const n of [{ x: next.x + 1, y: next.y }, { x: next.x - 1, y: next.y }, { x: next.x, y: next.y + 1 }, { x: next.x, y: next.y - 1 }]) {
      const index = n.y * width + n.x;
      if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height || seen.has(index) || at(n) !== ch) continue;
      seen.add(index);
      queue.push(n);
    }
  }
  return out;
}

/** The layout cut or padded to `width` × `height`, new cells `fill`; every row comes out `width` long. */
export function resizeLayout(layout: readonly string[], width: number, height: number, fill: string): string[] {
  return Array.from({ length: height }, (_, y) => {
    const row = [...(layout[y] ?? "")].slice(0, width);
    while (row.length < width) row.push(fill);
    return row.join("");
  });
}

const SPARE_CHARS = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789*=~^%&@$!?:;<>/|"];

/** A layout character for a new legend entry: one of the name's letters if free, else any free one; null when none is left. */
export function freeChar(legend: Readonly<Record<string, unknown>>, layout: readonly string[], name: string): string | null {
  const used = new Set([...Object.keys(legend), ...Object.keys(DEFAULT_LEGEND), ...layout.flatMap((row) => [...row])]);
  const letters = [...name.toLowerCase()].filter((ch) => /[a-z0-9]/.test(ch));
  return [...letters, ...letters.map((ch) => ch.toUpperCase()), ...SPARE_CHARS].find((ch) => !used.has(ch)) ?? null;
}

/** How many cells of the layout use `ch`. */
export function charCount(layout: readonly string[], ch: string): number {
  return layout.reduce((n, row) => n + [...row].filter((c) => c === ch).length, 0);
}

/** A record with `patch` applied; an undefined value takes its key out. */
function patched(record: Record<string, unknown>, patch: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record };
  for (const [key, v] of Object.entries(patch)) {
    if (v === undefined) delete out[key];
    else out[key] = v;
  }
  return out;
}

function listOf(value: MapValue, key: "places" | "links"): unknown[] {
  const list = value[key];
  return Array.isArray(list) ? list : [];
}

/** The map with a new layout; a `size` the map gives follows it, so the two never disagree. */
export function withLayout(value: MapValue, layout: readonly string[]): MapValue {
  const { width, height } = layoutSize(layout);
  return patched(value, { layout: [...layout], size: value.size !== undefined ? [width, height] : undefined });
}

/** The map with the place at `index` patched. */
export function patchPlace(value: MapValue, index: number, patch: Readonly<Record<string, unknown>>): MapValue {
  return { ...value, places: listOf(value, "places").map((p, i) => (i === index && isRecord(p) ? patched(p, patch) : p)) };
}

/** The map with the link at `index` patched. */
export function patchLink(value: MapValue, index: number, patch: Readonly<Record<string, unknown>>): MapValue {
  return { ...value, links: listOf(value, "links").map((l, i) => (i === index && isRecord(l) ? patched(l, patch) : l)) };
}

/** A place's id changed everywhere the map names it: the place, the legend's rooms and things, and the links. */
export function renamePlace(value: MapValue, from: string, to: string): MapValue {
  const swap = (id: unknown) => (id === from ? to : id);
  const legend = isRecord(value.legend) ? Object.fromEntries(Object.entries(value.legend).map(([ch, cell]) => [ch, isRecord(cell) && cell.place === from ? { ...cell, place: to } : cell])) : undefined;
  return patched(value, {
    places: value.places === undefined ? undefined : listOf(value, "places").map((p) => (isRecord(p) && p.id === from ? { ...p, id: to } : p)),
    links: value.links === undefined ? undefined : listOf(value, "links").map((l) => (isRecord(l) ? { ...l, from: swap(l.from), to: swap(l.to) } : l)),
    legend,
  });
}

/**
 * A place taken off the map with what names it: its room's legend entries go and their cells
 * become floor, a thing laid in its room lies in the room around it instead, and its links go.
 */
export function removePlace(value: MapValue, id: string): MapValue {
  const legend = isRecord(value.legend) ? value.legend : {};
  const rooms = Object.entries(legend).filter(([, cell]) => isRecord(cell) && cell.place === id && cell.item === undefined).map(([ch]) => ch);
  const nextLegend: Record<string, unknown> = {};
  for (const [ch, cell] of Object.entries(legend)) {
    if (rooms.includes(ch)) continue;
    nextLegend[ch] = isRecord(cell) && cell.item !== undefined && cell.place === id ? patched(cell, { place: undefined }) : cell;
  }
  const layout = Array.isArray(value.layout) ? value.layout.map((row) => (typeof row === "string" ? [...row].map((ch) => (rooms.includes(ch) ? "." : ch)).join("") : row)) : undefined;
  return patched(value, {
    places: listOf(value, "places").filter((p) => !(isRecord(p) && p.id === id)),
    links: value.links === undefined ? undefined : listOf(value, "links").filter((l) => !(isRecord(l) && (l.from === id || l.to === id))),
    legend: value.legend === undefined ? undefined : nextLegend,
    layout,
  });
}

/** The map with legend entry `ch` set (or taken out when `cell` is undefined, its cells painted `fill`). */
export function setLegend(value: MapValue, ch: string, cell: unknown, fill = "."): MapValue {
  const legend = patched(isRecord(value.legend) ? value.legend : {}, { [ch]: cell });
  const layout = cell === undefined && Array.isArray(value.layout) ? value.layout.map((row) => (typeof row === "string" ? [...row].map((c) => (c === ch ? fill : c)).join("") : row)) : value.layout;
  return patched(value, { legend, layout });
}

/** A legend entry moved to another character, with every cell painted with it. */
export function moveLegendChar(value: MapValue, from: string, to: string): MapValue {
  const legend: Record<string, unknown> = {};
  for (const [ch, cell] of Object.entries(isRecord(value.legend) ? value.legend : {})) legend[ch === from ? to : ch] = cell;
  const layout = Array.isArray(value.layout) ? value.layout.map((row) => (typeof row === "string" ? [...row].map((c) => (c === from ? to : c)).join("") : row)) : value.layout;
  return patched(value, { legend, layout });
}

/** Where each place sits on a grid map: its `at` when it's on the layout, else the middle of its room; null when neither. */
export function gridPlaceCells(model: MapModel, areas: ReadonlyMap<string, readonly number[]>): Map<string, Cell | null> {
  const out = new Map<string, Cell | null>();
  for (const p of model.places) {
    const at = p.at && p.at.x < model.width && p.at.y < model.height ? p.at : null;
    out.set(p.id, at ?? nearestMiddle(areas.get(p.id) ?? [], model.width));
  }
  return out;
}

/** Where each place sits on a node map's frame: its `at`, else on a ring around the middle (as Play lays out an unplaced place). */
export function nodePositions(model: MapModel): Map<string, Point> {
  const out = new Map<string, Point>();
  const loose = model.places.filter((p) => !p.at);
  const r = Math.min(model.width, model.height) * 0.38;
  for (const p of model.places) {
    if (p.at) out.set(p.id, { x: p.at.x, y: p.at.y });
    else {
      const i = loose.indexOf(p);
      const angle = (i / Math.max(1, loose.length)) * Math.PI * 2 - Math.PI / 2;
      out.set(p.id, { x: model.width / 2 + Math.cos(angle) * r, y: model.height / 2 + Math.sin(angle) * r });
    }
  }
  return out;
}

/** A frame position for a point in drawing units: whole numbers, kept inside the frame. */
export function framePosition(world: Point, unit: number, frame: { width: number; height: number }): Cell {
  return { x: Math.min(frame.width, Math.max(0, Math.round(world.x / unit))), y: Math.min(frame.height, Math.max(0, Math.round(world.y / unit))) };
}

/** The distance from `p` to the segment a–b, in the same units. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const s = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + s * dx), p.y - (a.y + s * dy));
}

// ---------------------------------------------------------------- drawing

/** What the layout holds: each character's meaning, each room's cells, and each character's cell count. */
interface LayoutFacts {
  meaning: Map<string, CellMeaning>;
  areas: Map<string, number[]>;
  counts: Map<string, number>;
}

function layoutFacts(model: MapModel): LayoutFacts {
  const meaning = new Map<string, CellMeaning>();
  const areas = new Map<string, number[]>();
  const counts = new Map<string, number>();
  model.layout.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
      let m = meaning.get(ch);
      if (!m) {
        m = cellMeaning(model.legend, ch);
        meaning.set(ch, m);
      }
      // A door on a room's edge is part of the room's area, as the engine compiles it.
      if (m.kind === "place" || m.kind === "roomDoor") areas.set(m.place, [...(areas.get(m.place) ?? []), y * model.width + x]);
    });
  });
  return { meaning, areas, counts };
}

/** The fill a cell of this meaning is painted with, as Play's map paints it; null for nothing. */
function meaningFill(m: CellMeaning, palette: CanvasPalette): Paint | null {
  switch (m.kind) {
    case "nothing":
      return null;
    case "wall":
      return terrainFill("wall", palette);
    case "door":
    case "roomDoor":
      return terrainFill("door", palette);
    case "terrain":
      return terrainFill(m.terrain, palette);
    default:
      return terrainFill("floor", palette);
  }
}

/** The tint a room gets: its place's turn among the map's places in id order, as Play orders a scope's places. */
function roomTint(id: string, ids: readonly string[], palette: CanvasPalette): Paint {
  return areaFill(Math.max(0, ids.indexOf(id)), palette);
}

function drawMarks(g: CanvasRenderingContext2D, marks: readonly PreviewMark[], palette: CanvasPalette, cellTo: (cell: number) => Point | null, size: number, placeAt: (id: string) => Point | null): void {
  for (const mark of marks) {
    g.strokeStyle = mark.severity === "error" ? (palette.series[3] ?? palette.ink) : (palette.series[2] ?? palette.ink);
    g.setLineDash(mark.severity === "error" ? [] : [5, 4]);
    g.lineWidth = 2;
    for (const cell of mark.cells ?? []) {
      const p = cellTo(cell);
      if (p) g.strokeRect(p.x + 1, p.y + 1, Math.max(2, size - 2), Math.max(2, size - 2));
    }
    const place = mark.place ? placeAt(mark.place) : null;
    if (place) {
      g.lineWidth = 3;
      g.beginPath();
      g.arc(place.x, place.y, 17, 0, Math.PI * 2);
      g.stroke();
    }
    const a = mark.link ? placeAt(mark.link[0]) : null;
    const b = mark.link ? placeAt(mark.link[1]) : null;
    if (a && b) {
      g.lineWidth = 5;
      g.globalAlpha = 0.7;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.globalAlpha = 1;
    }
  }
  g.setLineDash([]);
}

/** Places' dots and names (laid out as Play lays them, clear of the zoom buttons); `selected` gets a ring. */
function drawPlaces(g: CanvasRenderingContext2D, places: readonly { id: string; name: string; at: Point }[], selected: string | null, width: number, height: number, palette: CanvasPalette): PlacedLabel[] {
  for (const p of places) {
    const isSelected = p.id === selected;
    g.fillStyle = palette.ink;
    g.strokeStyle = palette.bg;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(p.at.x, p.at.y, isSelected ? 9 : 7, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (isSelected) {
      g.strokeStyle = palette.item;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(p.at.x, p.at.y, 15, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.font = `13px ${palette.font}`;
  const avoid: Box[] = [{ x: width - 144, y: height - ZOOM_STRIP, w: 144, h: ZOOM_STRIP }];
  const labels = placeLabels(
    places.map((p) => ({ id: p.id, x: p.at.x, y: p.at.y, r: p.id === selected ? 16 : 8, text: p.name })),
    { width, height, measure: (s) => g.measureText(s).width, avoid, first: selected ? [selected] : [] },
  );
  g.globalAlpha = 0.5;
  g.strokeStyle = palette.ink;
  g.lineWidth = 1;
  g.beginPath();
  for (const label of labels) {
    if (!label.leader) continue;
    g.moveTo(label.leader.from.x, label.leader.from.y);
    g.lineTo(label.leader.to.x, label.leader.to.y);
  }
  g.stroke();
  for (const label of labels) {
    const { x, y, w, h } = label.box;
    // A name sits on a cut-out of the drawing, so the surface shows behind it in either theme.
    g.globalAlpha = 0.9;
    g.globalCompositeOperation = "destination-out";
    g.fillRect(x, y, w, h);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.strokeStyle = palette.line;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.fillStyle = palette.ink;
    label.lines.forEach((line, i) => g.fillText(line, x + LABEL_PAD, y + 15 + i * LINE));
  }
  return labels;
}

function drawGridMap(g: CanvasRenderingContext2D, model: MapModel, facts: LayoutFacts, view: Transform, width: number, height: number, palette: CanvasPalette, overlay: { marks: readonly PreviewMark[]; selected: string | null }): void {
  const unit = gridUnit(model);
  const t = cellView(view, unit);
  const size = Math.ceil(t.k);
  const ids = model.places.map((p) => p.id).sort();
  const zones = [...new Set([...facts.meaning.values()].flatMap((m) => (m.kind === "zone" ? [m.zone] : [])))].sort();
  const neg = palette.series[3] ?? palette.ink;
  model.layout.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const p = toScreen(t, { x, y });
      if (p.x > width || p.y > height || p.x + t.k < 0 || p.y + t.k < 0) return;
      const m = facts.meaning.get(ch) ?? { kind: "unknown" };
      const fill = meaningFill(m, palette);
      if (fill) {
        g.globalAlpha = fill.alpha;
        g.fillStyle = fill.color;
        g.fillRect(p.x, p.y, size, size);
      }
      if (m.kind === "place") {
        const tint = roomTint(m.place, ids, palette);
        g.globalAlpha = tint.alpha;
        g.fillStyle = tint.color;
        g.fillRect(p.x, p.y, size, size);
      }
      g.globalAlpha = 1;
      if (m.kind === "zone") {
        // Hatched, so a zone never reads as a room by its colour alone.
        g.strokeStyle = palette.series[(zones.indexOf(m.zone) + 3) % palette.series.length] ?? palette.muted;
        g.globalAlpha = 0.55;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(p.x, p.y + t.k * 0.5);
        g.lineTo(p.x + t.k * 0.5, p.y);
        g.moveTo(p.x, p.y + t.k);
        g.lineTo(p.x + t.k, p.y);
        g.moveTo(p.x + t.k * 0.5, p.y + t.k);
        g.lineTo(p.x + t.k, p.y + t.k * 0.5);
        g.stroke();
        g.globalAlpha = 1;
      }
      if ((m.kind === "terrain" && m.blocked) || m.kind === "unknown") crossCell(g, p, t.k, m.kind === "unknown" ? neg : palette.muted);
      if (m.kind === "item") {
        const c = { x: p.x + t.k / 2, y: p.y + t.k / 2 };
        const r = Math.max(4, t.k * 0.24);
        g.fillStyle = palette.item;
        g.strokeStyle = palette.bg;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(c.x, c.y - r);
        g.lineTo(c.x + r, c.y);
        g.lineTo(c.x, c.y + r);
        g.lineTo(c.x - r, c.y);
        g.closePath();
        g.fill();
        g.stroke();
      }
    });
  });
  gridLines(g, t, model.width, model.height, palette);
  const cells = gridPlaceCells(model, facts.areas);
  const placed = model.places.flatMap((p) => {
    const cell = cells.get(p.id);
    return cell ? [{ id: p.id, name: p.name, at: toScreen(t, { x: cell.x + 0.5, y: cell.y + 0.5 }) }] : [];
  });
  drawMarks(g, overlay.marks, palette, (cell) => toScreen(t, { x: cell % model.width, y: Math.floor(cell / model.width) }), t.k, (id) => placed.find((p) => p.id === id)?.at ?? null);
  drawPlaces(g, placed, overlay.selected, width, height, palette);
}

const LINK_DASH: Record<TravelMode, number[]> = { road: [], walk: [6, 6], offroad: [10, 4, 2, 4], water: [2, 5] };

function drawNodeMap(g: CanvasRenderingContext2D, model: MapModel, view: Transform, width: number, height: number, palette: CanvasPalette, overlay: { marks: readonly PreviewMark[]; selected: Selection | null; band: { from: string; to: Point } | null }): void {
  const unit = FRAME_UNITS / Math.max(1, model.width, model.height);
  const positions = nodePositions(model);
  const screen = (p: Point) => toScreen(view, { x: p.x * unit, y: p.y * unit });
  // The frame, with a line every 10 units once they're far enough apart to help.
  const a = screen({ x: 0, y: 0 });
  const b = screen({ x: model.width, y: model.height });
  const step = 10 * unit * view.k;
  if (step >= 14) {
    g.strokeStyle = palette.line;
    g.globalAlpha = 0.45;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= model.width; x += 10) {
      const s = screen({ x, y: 0 });
      g.moveTo(Math.round(s.x) + 0.5, a.y);
      g.lineTo(Math.round(s.x) + 0.5, b.y);
    }
    for (let y = 0; y <= model.height; y += 10) {
      const s = screen({ x: 0, y });
      g.moveTo(a.x, Math.round(s.y) + 0.5);
      g.lineTo(b.x, Math.round(s.y) + 0.5);
    }
    g.stroke();
    g.globalAlpha = 1;
  }
  g.strokeStyle = palette.line;
  g.lineWidth = 1.5;
  g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  const at = (id: string) => {
    const p = positions.get(id);
    return p ? screen(p) : null;
  };
  // Roads solid, footpaths dashed, off-road dash-dot, water dotted: the pattern says the way, not only its colour.
  g.font = `11px ${palette.font}`;
  for (const link of model.links) {
    const pa = at(link.from);
    const pb = at(link.to);
    if (!pa || !pb) continue;
    const isSelected = overlay.selected?.kind === "link" && overlay.selected.index === link.index;
    g.strokeStyle = isSelected ? palette.item : link.mode === "water" ? (palette.series[1] ?? palette.pov) : palette.ink;
    g.globalAlpha = isSelected ? 1 : 0.55;
    g.lineWidth = isSelected ? 4 : link.mode === "road" ? 3 : 2;
    g.setLineDash(LINK_DASH[link.mode]);
    g.beginPath();
    g.moveTo(pa.x, pa.y);
    g.lineTo(pb.x, pb.y);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) > 90) {
      const text = `${link.minutes} min`;
      const w = g.measureText(text).width + 8;
      const mx = (pa.x + pb.x) / 2;
      const my = (pa.y + pb.y) / 2;
      g.globalCompositeOperation = "destination-out";
      g.globalAlpha = 0.85;
      g.fillRect(mx - w / 2, my - 8, w, 16);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.fillStyle = palette.muted;
      g.fillText(text, mx - w / 2 + 4, my + 4);
    }
  }
  if (overlay.band) {
    const from = at(overlay.band.from);
    if (from) {
      g.strokeStyle = palette.pov;
      g.lineWidth = 2;
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(from.x, from.y);
      g.lineTo(overlay.band.to.x, overlay.band.to.y);
      g.stroke();
      g.setLineDash([]);
    }
  }
  drawMarks(g, overlay.marks, palette, () => null, 0, at);
  const placed = model.places.flatMap((p) => {
    const s = at(p.id);
    return s ? [{ id: p.id, name: p.name, at: s }] : [];
  });
  drawPlaces(g, placed, overlay.selected?.kind === "place" ? overlay.selected.id : null, width, height, palette);
}

// ---------------------------------------------------------------- the editor

type Tab = "draw" | "places" | "preview" | "json";
type GridTool = "paint" | "fill" | "move";
type NodeTool = "move" | "link" | "add";
type Selection = { kind: "place"; id: string } | { kind: "link"; index: number };
type Sheet = { kind: "place"; id: string } | { kind: "newPlace"; room: boolean; at: Cell | null } | { kind: "legend"; ch: string } | { kind: "newLegend" } | { kind: "link"; index: number } | { kind: "newLink" } | { kind: "settings" };

const GRID_TOOLS = [
  { value: "paint", label: "Paint" },
  { value: "fill", label: "Fill" },
  { value: "move", label: "Move" },
] as const satisfies readonly { value: GridTool; label: string }[];

const NODE_TOOLS = [
  { value: "move", label: "Move" },
  { value: "link", label: "Link" },
  { value: "add", label: "Add" },
] as const satisfies readonly { value: NodeTool; label: string }[];

const HINTS: Record<GridTool | NodeTool, string> = {
  paint: "Drag to paint with the brush. Two fingers pan and zoom.",
  fill: "Tap a cell to fill the area around it with the brush.",
  move: "Drag a place to move it; tap one to select it. Drag elsewhere to pan.",
  link: "Drag from one place to another to join them with a way.",
  add: "Tap the map where the new place goes.",
};

const MODE_LABEL: Record<TravelMode, string> = { walk: "Walk", road: "Road", offroad: "Off-road", water: "Water" };

const MEANINGS = [
  { value: "wall", label: "Wall" },
  { value: "floor", label: "Floor" },
  { value: "door", label: "Door" },
  { value: "roomDoor", label: "Room door" },
  { value: "terrain", label: "Terrain" },
  { value: "place", label: "Room" },
  { value: "zone", label: "Zone" },
  { value: "item", label: "Thing" },
] as const;
type MeaningKind = (typeof MEANINGS)[number]["value"];

/** A meaning in words, for a brush or a legend row. */
function meaningText(m: CellMeaning, placeName: (id: string) => string, entityName: (id: string) => string): string {
  switch (m.kind) {
    case "wall":
      return "Wall";
    case "floor":
      return "Floor";
    case "door":
      return "Door";
    case "roomDoor":
      return `Door of ${placeName(m.place)}`;
    case "nothing":
      return "Nothing";
    case "terrain":
      return m.blocked ? `${m.terrain} (blocked)` : m.terrain;
    case "place":
      return placeName(m.place);
    case "zone":
      return `Zone ${m.zone}`;
    case "item":
      return entityName(m.item);
    case "unknown":
      return "Not in the legend";
  }
}

/** A legend value for a meaning, from the form's fields. */
function legendValue(kind: MeaningKind, form: { terrain: string; blocked: boolean; place: string; zone: string; item: string; itemPlace: string }): unknown {
  switch (kind) {
    case "wall":
    case "floor":
    case "door":
      return kind;
    case "roomDoor":
      return { door: true, place: form.place };
    case "terrain":
      return form.blocked ? { terrain: form.terrain, blocked: true } : { terrain: form.terrain };
    case "place":
      return { place: form.place };
    case "zone":
      return { zone: form.zone };
    case "item":
      return form.itemPlace ? { item: form.item, place: form.itemPlace } : { item: form.item };
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function MapEditor(props: EditorProps) {
  const app = useApp();
  const showIds = useShowIds();
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : (props.id ?? "");
  const stored = hasOwn(props.world.maps, id) ? props.world.maps[id] : undefined;
  const initial = useMemo(() => formatMap(stored ?? newItem("maps", id, props.world, newItemName(props.world.id, "maps", id))), [JSON.stringify(stored), id]);
  const [text, setText] = useState(initial);
  const [busy, run] = useBusy();
  const [tab, setTab] = useState<Tab>("draw");
  const [gridTool, setGridTool] = useState<GridTool>("paint");
  const [nodeTool, setNodeTool] = useState<NodeTool>("move");
  const [brush, setBrush] = useState("#");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [band, setBand] = useState<{ from: string; to: Point } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const palette = usePalette(root);
  const panelId = useId();
  useHeld(text, setText, initial, `${props.world.id}/maps/${props.id ?? ""}`, initial);
  const checked = useMemo(() => checkMapText(text, id, props.world), [text, id, props.world]);
  // The value the next edit starts from: edits within one gesture build on each other before a render.
  const live = useRef<JsonValue | null>(null);
  live.current = checked.value;
  const value = isRecord(checked.value) ? checked.value : null;
  const model = useMemo(() => (value ? readModel(value) : null), [value]);
  const facts = useMemo(() => (model && typeof model !== "string" && model.kind === "grid" ? layoutFacts(model) : null), [model]);
  const marks = useMemo(() => previewMarks(checked.value, checked.problems), [checked]);
  const stroke = useRef<{ last: Cell; moved: boolean; start: Point; place: string | null } | null>(null);

  const marksByLine = new Map<number, "error" | "warning">();
  for (const p of checked.problems) if (marksByLine.get(p.line) !== "error") marksByLine.set(p.line, p.severity);
  const errors = checked.problems.filter((p) => p.severity === "error").length;
  const warnings = checked.problems.length - errors;
  const changed = text !== initial;
  const placeName = (pid: string) => (model && typeof model !== "string" ? model.places.find((p) => p.id === pid)?.name : undefined) ?? props.world.places[pid]?.name ?? pid;
  const entityName = (eid: string) => props.world.entities[eid]?.name ?? eid;

  /** Applies a visual edit: the map's JSON is rewritten, laid out as Tidy lays it out. */
  const apply = (edit: (map: MapValue) => MapValue) => {
    const current = live.current;
    if (!isRecord(current)) return;
    const next = edit(current);
    live.current = next as JsonValue;
    setText(formatMap(next));
  };
  /** Keeps the text before an edit, for Undo. */
  const record = () => setHistory((h) => [...h.slice(-49), text]);
  const edit = (change: (map: MapValue) => MapValue) => {
    record();
    apply(change);
  };
  const undo = () => {
    const last = history.at(-1);
    if (last === undefined) return;
    setHistory(history.slice(0, -1));
    setText(last);
  };

  const jump = (line: number) => {
    const el = area.current;
    if (!el) return;
    const rows = text.split("\n");
    const start = rows.slice(0, line - 1).reduce((at, row) => at + row.length + 1, 0);
    el.focus();
    el.setSelectionRange(start, start + (rows[line - 1]?.length ?? 0));
    el.scrollTop = Math.max(0, (line - 3) * LINE_PX);
    if (gutter.current) gutter.current.scrollTop = el.scrollTop;
  };
  // A jump asked for from another tab waits for the JSON tab to show.
  const [pendingLine, setPendingLine] = useState<number | null>(null);
  useEffect(() => {
    if (tab !== "json" || pendingLine === null) return;
    jump(pendingLine);
    setPendingLine(null);
  }, [tab, pendingLine]);

  const insert = (kind: "grid" | "node") =>
    run(async () => {
      const current = checked.value;
      const scope = isRecord(current) && typeof current.scope === "string" && current.scope !== "" ? current.scope : props.world.start.place;
      const drawn = isRecord(current) && (Array.isArray(current.layout) || Array.isArray(current.links) || (Array.isArray(current.places) && current.places.length > 0));
      if (drawn && !(await app.host.confirm("Insert template", "Replace this map with the template? Revert brings back the saved map.", "info", "Replace"))) return;
      record();
      setSelected(null);
      setBrush("#");
      setText(formatMap({ ...mapTemplate(kind, id, scope), ...(isRecord(current) && typeof current.title === "string" ? { title: current.title } : {}) }));
    });
  const save = () =>
    run(async () => {
      if (!isRecord(checked.value)) return;
      const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "maps", id, value: checked.value });
      if (message.type === "lre.result" && isNew) go(app, { view: "item", worldId: props.world.id, collection: "maps", id });
    });
  const remove = () =>
    run(async () => {
      await deleteItem(app, props.send, { worldId: props.world.id, collection: "maps", id, message: `Delete the map “${id}”? The places, grid and routes it draws go with it.` });
    });

  /** Opens what a problem is about: its place, link or legend entry, else its line in the JSON. */
  const openProblem = (p: MapTextProblem) => {
    const [head, at] = p.path;
    const m = model && typeof model !== "string" ? model : null;
    if (tab !== "json" && m && head === "places" && typeof at === "number") {
      const place = m.places.find((entry) => entry.index === at);
      if (place) return setSheet({ kind: "place", id: place.id });
    }
    if (tab !== "json" && m && head === "links" && typeof at === "number" && m.links.some((l) => l.index === at)) return setSheet({ kind: "link", index: at });
    if (tab !== "json" && m && head === "legend" && typeof at === "string" && hasOwn(m.legend, at)) return setSheet({ kind: "legend", ch: at });
    if (tab !== "json" && m && head === "layout") return setTab("draw");
    setTab("json");
    setPendingLine(p.line);
  };

  const title = value && typeof value.title === "string" && value.title ? value.title : nameOfId(id);
  const m = model && typeof model !== "string" ? model : null;
  const scopeName = value && typeof value.scope === "string" ? (props.world.places[value.scope]?.name ?? value.scope) : null;
  const subtitle = m ? `${m.kind === "grid" ? `Grid map · ${m.width} × ${m.height}` : m.kind === "node" ? `Node map · ${m.places.length} place${m.places.length === 1 ? "" : "s"}` : "Empty map"}${scopeName ? ` · inside ${scopeName}` : ""}` : "Map";
  const menu: MenuItem[] = [
    { label: "Start from a grid template", icon: "grid", disabled: busy, onSelect: () => insert("grid") },
    { label: "Start from a node template", icon: "branch", disabled: busy, onSelect: () => insert("node") },
  ];
  const issuesAt = (prefix: JsonPath): LintIssue[] =>
    checked.problems.filter((p) => prefix.every((part, i) => p.path[i] === part)).map((p) => ({ severity: p.severity, path: pathText(p.path), code: "map", message: p.message }));

  return (
    <div ref={root} class="lre-build-page" data-lre-editor="maps">
      <ItemHeader title={title} id={id} subtitle={subtitle} onDelete={isNew ? undefined : remove} busy={busy} menu={menu} />
      <Tabs<Tab>
        label="Map editor"
        panelId={panelId}
        value={tab}
        tabs={[
          { id: "draw", label: "Draw" },
          { id: "places", label: m?.kind === "grid" ? "Rooms" : "Places" },
          { id: "preview", label: "Preview" },
          { id: "json", label: "JSON" },
        ]}
        onChange={setTab}
      />
      <Problems problems={checked.problems} errors={errors} warnings={warnings} json={tab === "json"} onOpen={openProblem} />
      <div {...(tab === "draw" ? tabPanel(panelId, "draw") : {})} hidden={tab !== "draw"} class="lre-stack">
        {checked.value === null ? (
          <Banner tone="warn" title="The JSON has an error" actions={<Button size="sm" onClick={() => openProblem(checked.problems[0] ?? { line: 1, severity: "error", message: "", path: [] })}>Show it</Button>}>
            Fix it in the JSON tab to draw the map again.
          </Banner>
        ) : typeof model === "string" || !m ? (
          <Banner tone="warn" title="The map can't be drawn" actions={<Button size="sm" onClick={() => setTab("json")}>Open the JSON</Button>}>
            {typeof model === "string" ? model : "The map isn't a JSON object."}
          </Banner>
        ) : m.kind === "empty" ? (
          <Empty icon="map" title="What kind of map?" action={<span class="lre-inline"><Button icon="grid" onClick={() => insert("grid")}>Grid map</Button><Button icon="branch" onClick={() => insert("node")}>Node map</Button></span>}>
            A grid map draws rooms cell by cell (a house, a ship). A node map joins places by ways (a town, a valley). Each starts from a small example you can change.
          </Empty>
        ) : m.kind === "grid" && facts ? (
          <GridDraw
            model={m}
            facts={facts}
            palette={palette}
            tool={gridTool}
            onTool={setGridTool}
            brush={brush}
            onBrush={setBrush}
            selected={selected?.kind === "place" ? selected.id : null}
            marks={marks}
            canUndo={history.length > 0}
            onUndo={undo}
            placeName={placeName}
            entityName={entityName}
            showIds={showIds}
            canvasTool={gridCanvasTool(m, facts)}
            onAddBrush={() => setSheet({ kind: "newLegend" })}
            onAddRoom={() => setSheet({ kind: "newPlace", room: true, at: null })}
            onEditBrush={(ch) => setSheet({ kind: "legend", ch })}
            onOpenPlace={(pid) => setSheet({ kind: "place", id: pid })}
            onDeselect={() => setSelected(null)}
          />
        ) : (
          <NodeDraw
            model={m}
            tool={nodeTool}
            onTool={setNodeTool}
            selected={selected}
            band={band}
            marks={marks}
            canUndo={history.length > 0}
            onUndo={undo}
            placeName={placeName}
            canvasTool={nodeCanvasTool(m)}
            onOpen={(s) => setSheet(s.kind === "place" ? { kind: "place", id: s.id } : { kind: "link", index: s.index })}
            onDeselect={() => setSelected(null)}
          />
        )}
      </div>
      {tab === "places" ? (
        <div {...tabPanel(panelId, "places")} class="lre-stack">
          {m ? (
            <PlacesPanel model={m} facts={facts} palette={palette} placeName={placeName} entityName={entityName} issuesAt={issuesAt} onSheet={setSheet} />
          ) : (
            <Banner tone="warn" title="The map can't be read">
              Fix its JSON first.
            </Banner>
          )}
          <FormGroup title="Map" aside={<Button size="sm" icon="edit" onClick={() => setSheet({ kind: "settings" })}>Edit</Button>}>
            <span class="lre-small lre-muted">
              {title} · inside {scopeName ?? "no place"}
              {m?.kind === "grid" ? ` · ${m.width} × ${m.height} cells${value && typeof value.cellMeters === "number" ? `, ${value.cellMeters} m each` : ""}` : m?.kind === "node" ? ` · frame ${m.width} × ${m.height}` : ""}
            </span>
          </FormGroup>
        </div>
      ) : null}
      {tab === "preview" ? (
        <div {...tabPanel(panelId, "preview")} class="lre-stack">
          <span class="lre-small lre-muted">The map as Play draws it, every place shown, with its problems marked.</span>
          {checked.scope ? <MapPreview scope={checked.scope} height={360} marks={marks} /> : <Empty icon="map">The preview shows once the map reads as lre-map-v1.</Empty>}
        </div>
      ) : null}
      {tab === "json" ? (
        <div {...tabPanel(panelId, "json")} class="lre-stack">
          <span class="lre-small lre-muted">The map as lre-map-v1 JSON: a grid map's layout rows and legend, or a node map's places and links. The places it lists are made inside its scope, and the map owns them.</span>
          <div class="lre-inline">
            <Button size="sm" icon="grid" disabled={busy} onClick={() => insert("grid")}>
              Grid template
            </Button>
            <Button size="sm" icon="branch" disabled={busy} onClick={() => insert("node")}>
              Node template
            </Button>
            <Button size="sm" variant="ghost" disabled={checked.value === null} onClick={() => setText(formatMap(checked.value))}>
              Tidy
            </Button>
          </div>
          <div class="lre-ve-code">
            <pre class="gutter" ref={gutter} aria-hidden="true">
              {text.split("\n").map((_, i) => (
                <span key={i} class={marksByLine.get(i + 1)}>
                  {i + 1}
                </span>
              ))}
            </pre>
            <textarea
              ref={area}
              class="text"
              wrap="off"
              spellcheck={false}
              aria-label="The map as lre-map-v1 JSON"
              aria-invalid={errors > 0}
              value={text}
              onInput={(event) => setText(event.currentTarget.value)}
              onScroll={(event) => {
                if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
              }}
            />
          </div>
        </div>
      ) : null}
      {sheet && value && m ? <MapSheet sheet={sheet} world={props.world} mapId={id} value={value} model={m} facts={facts} palette={palette} issuesAt={issuesAt} placeName={placeName} entityName={entityName} edit={edit} onSheet={setSheet} onClose={() => setSheet(null)} onPaint={(ch) => {
        setBrush(ch);
        setGridTool("paint");
        setTab("draw");
        setSheet(null);
      }} onSelect={setSelected} /> : null}
      <SaveBar>
        <Button variant="primary" disabled={busy || checked.value === null || (!changed && !isNew)} onClick={save}>
          {isNew ? "Create map" : "Save to draft"}
        </Button>
        <Button variant="ghost" disabled={busy || !changed} onClick={() => setText(initial)}>
          Revert
        </Button>
      </SaveBar>
    </div>
  );

  /** One finger on a grid map: paint a stroke, fill an area, or drag a place to its cell. */
  function gridCanvasTool(model: MapModel, facts: LayoutFacts): CanvasTool {
    const unit = gridUnit(model);
    const cellUnder = (p: Point, t: Transform): Cell | null => {
      const index = cellAt(cellView(t, unit), model, p);
      return index === null ? null : { x: index % model.width, y: Math.floor(index / model.width) };
    };
    const placeUnder = (p: Point, t: Transform): string | null => {
      const cells = gridPlaceCells(model, facts.areas);
      const dots = model.places.flatMap((place) => {
        const c = cells.get(place.id);
        return c ? [{ id: place.id, x: (c.x + 0.5) * unit, y: (c.y + 0.5) * unit }] : [];
      });
      return hitTest(t, dots, p, 22)?.id ?? null;
    };
    const roomAt = (cell: Cell): string | null => {
      const ch = [...(model.layout[cell.y] ?? "")][cell.x] ?? " ";
      const meaning = facts.meaning.get(ch);
      return meaning?.kind === "place" || meaning?.kind === "roomDoor" ? meaning.place : null;
    };
    if (gridTool === "paint") {
      return {
        press: (p, t) => {
          const cell = cellUnder(p, t);
          if (!cell) return false;
          record();
          stroke.current = { last: cell, moved: false, start: p, place: null };
          apply((map) => withLayout(map, paintLayout(model.layout, [cell], brush)));
          return true;
        },
        move: (p, t) => {
          const s = stroke.current;
          const cell = cellUnder(p, t);
          if (!s || !cell || (cell.x === s.last.x && cell.y === s.last.y)) return;
          const cells = strokeCells(s.last, cell).slice(1);
          apply((map) => withLayout(map, paintLayout(Array.isArray(map.layout) ? map.layout.filter((row): row is string => typeof row === "string") : [], cells, brush)));
          s.last = cell;
        },
        release: () => {
          stroke.current = null;
        },
      };
    }
    if (gridTool === "fill") {
      return {
        tap: (p, t) => {
          const cell = cellUnder(p, t);
          if (!cell) return;
          const cells = fillCells(model.layout, cell);
          if (cells.length === 0 || ([...(model.layout[cell.y] ?? "")][cell.x] ?? " ") === brush) return;
          edit((map) => withLayout(map, paintLayout(model.layout, cells, brush)));
        },
      };
    }
    return {
      press: (p, t) => {
        const place = placeUnder(p, t);
        const cell = cellUnder(p, t);
        if (!place || !cell) return false;
        stroke.current = { last: cell, moved: false, start: p, place };
        setSelected({ kind: "place", id: place });
        return true;
      },
      move: (p, t) => {
        const s = stroke.current;
        const cell = cellUnder(p, t);
        if (!s?.place || !cell || (cell.x === s.last.x && cell.y === s.last.y)) return;
        const entry = model.places.find((e) => e.id === s.place);
        if (!entry) return;
        if (!s.moved) record();
        s.moved = true;
        s.last = cell;
        apply((map) => patchPlace(map, entry.index, { at: [cell.x, cell.y] }));
      },
      release: () => {
        stroke.current = null;
      },
      tap: (p, t) => {
        const cell = cellUnder(p, t);
        const room = cell ? roomAt(cell) : null;
        setSelected(room ? { kind: "place", id: room } : null);
      },
    };
  }

  /** One finger on a node map: drag a place, drag a way from one place to another, or tap where a new place goes. */
  function nodeCanvasTool(model: MapModel): CanvasTool {
    const unit = FRAME_UNITS / Math.max(1, model.width, model.height);
    const positions = nodePositions(model);
    const dots = model.places.flatMap((p) => {
      const at = positions.get(p.id);
      return at ? [{ id: p.id, x: at.x * unit, y: at.y * unit }] : [];
    });
    const placeUnder = (p: Point, t: Transform) => hitTest(t, dots, p, 24)?.id ?? null;
    const linkUnder = (p: Point, t: Transform): number | null => {
      let best: number | null = null;
      let distance = 14;
      for (const link of model.links) {
        const a = positions.get(link.from);
        const b = positions.get(link.to);
        if (!a || !b) continue;
        const d = segmentDistance(p, toScreen(t, { x: a.x * unit, y: a.y * unit }), toScreen(t, { x: b.x * unit, y: b.y * unit }));
        if (d <= distance) {
          best = link.index;
          distance = d;
        }
      }
      return best;
    };
    const tapSelect = (p: Point, t: Transform) => {
      const place = placeUnder(p, t);
      const link = place ? null : linkUnder(p, t);
      setSelected(place ? { kind: "place", id: place } : link !== null ? { kind: "link", index: link } : null);
    };
    if (nodeTool === "add") {
      return {
        tap: (p, t) => {
          if (placeUnder(p, t)) return tapSelect(p, t);
          setSheet({ kind: "newPlace", room: false, at: framePosition(toWorld(t, p), unit, model) });
        },
      };
    }
    if (nodeTool === "link") {
      return {
        press: (p, t) => {
          const from = placeUnder(p, t);
          if (!from) return false;
          setBand({ from, to: p });
          return true;
        },
        move: (p) => setBand((b) => (b ? { ...b, to: p } : b)),
        release: (p, t) => {
          const from = band?.from ?? null;
          setBand(null);
          const to = placeUnder(p, t);
          if (!from || !to || to === from) return;
          const index = Array.isArray(live.current) || !isRecord(live.current) ? 0 : listOf(live.current, "links").length;
          edit((map) => ({ ...map, links: [...listOf(map, "links"), { from, to, minutes: 5 }] }));
          setSelected({ kind: "link", index });
        },
        tap: tapSelect,
      };
    }
    return {
      press: (p, t) => {
        const place = placeUnder(p, t);
        if (!place) return false;
        stroke.current = { last: { x: 0, y: 0 }, moved: false, start: p, place };
        return true;
      },
      move: (p, t) => {
        const s = stroke.current;
        if (!s?.place) return;
        if (!s.moved && Math.hypot(p.x - s.start.x, p.y - s.start.y) <= TAP_SLOP) return;
        const entry = model.places.find((e) => e.id === s.place);
        if (!entry) return;
        const at = framePosition(toWorld(t, p), unit, model);
        if (s.moved && at.x === s.last.x && at.y === s.last.y) return;
        if (!s.moved) record();
        s.moved = true;
        s.last = at;
        setSelected({ kind: "place", id: entry.id });
        apply((map) => patchPlace(map, entry.index, { at: [at.x, at.y] }));
      },
      release: (p, t) => {
        const s = stroke.current;
        stroke.current = null;
        if (s && !s.moved) tapSelect(p, t);
      },
      tap: tapSelect,
    };
  }
}

/** The problems, collapsed under a count; each opens what it's about (in the JSON tab, its line). */
function Problems(props: { problems: readonly MapTextProblem[]; errors: number; warnings: number; json: boolean; onOpen(p: MapTextProblem): void }) {
  if (props.problems.length === 0) {
    return (
      <div class="lre-ve-valid lre-small lre-pos" aria-live="polite" data-lre-map-problems={0}>
        <Icon name="check" size={16} /> A valid lre-map-v1 map.
      </div>
    );
  }
  const summary = [props.errors > 0 ? `${props.errors} error${props.errors === 1 ? "" : "s"}` : "", props.warnings > 0 ? `${props.warnings} warning${props.warnings === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  return (
    <div aria-live="polite" data-lre-map-problems={props.problems.length}>
      <Disclosure
        summary={
          <span class={props.errors > 0 ? "lre-ve-problems-sum lre-neg" : "lre-ve-problems-sum lre-warn"}>
            <Icon name="alert" size={16} /> {summary}
          </span>
        }
      >
        <div class="lre-ve-problems">
          {props.problems.map((p, i) => (
            <button key={`${p.line}:${i}`} type="button" class="lre-ve-problem" onClick={() => props.onOpen(p)}>
              <Badge tone={p.severity === "error" ? "neg" : "warn"}>{props.json ? `Line ${p.line}` : p.severity === "error" ? "Error" : "Warning"}</Badge>
              <span class="grow">{p.message}</span>
              <Icon name="chevron-right" size={16} />
            </button>
          ))}
        </div>
      </Disclosure>
    </div>
  );
}

function GridDraw(props: {
  model: MapModel;
  facts: LayoutFacts;
  palette: CanvasPalette | null;
  tool: GridTool;
  onTool(tool: GridTool): void;
  brush: string;
  onBrush(ch: string): void;
  selected: string | null;
  marks: readonly PreviewMark[];
  canUndo: boolean;
  onUndo(): void;
  placeName(id: string): string;
  entityName(id: string): string;
  showIds: boolean;
  canvasTool: CanvasTool;
  onAddBrush(): void;
  onAddRoom(): void;
  onEditBrush(ch: string): void;
  onOpenPlace(id: string): void;
  onDeselect(): void;
}) {
  const { model, facts, palette } = props;
  const unit = gridUnit(model);
  // The default characters first (as the legend makes them mean), then the legend's own.
  const brushes = [...new Set([...Object.keys(DEFAULT_LEGEND), ...Object.keys(model.legend)])];
  const meaningOf = (ch: string) => facts.meaning.get(ch) ?? cellMeaning(model.legend, ch);
  const swatch = (ch: string): Paint | null => {
    if (!palette) return null;
    const m = meaningOf(ch);
    return m.kind === "place" ? roomTint(m.place, model.places.map((p) => p.id).sort(), palette) : meaningFill(m, palette);
  };
  const selectedPlace = props.selected ? model.places.find((p) => p.id === props.selected) : undefined;
  return (
    <>
      <div class="lre-ve-toolbar">
        <Seg<GridTool> label="Tool" value={props.tool} options={GRID_TOOLS} onChange={props.onTool} />
        <IconButton icon="undo" label="Undo" disabled={!props.canUndo} onClick={props.onUndo} />
      </div>
      {props.tool !== "move" ? (
        <div class="lre-stack" data-lre-brushes>
          <div class="lre-form-chips lre-ve-brushes" role="group" aria-label="Brush">
            {brushes.map((ch) => (
              <Chip key={ch} pressed={ch === props.brush} onToggle={() => props.onBrush(ch)}>
                <span class="lre-ve-brush">
                  <Swatch fill={swatch(ch)} />
                  {meaningText(meaningOf(ch), props.placeName, props.entityName)}
                  {props.showIds ? <code class="lre-id">{ch === " " ? "space" : ch}</code> : null}
                </span>
              </Chip>
            ))}
          </div>
          <div class="lre-inline">
            <Button size="sm" icon="plus" onClick={props.onAddRoom}>
              Room
            </Button>
            <Button size="sm" icon="plus" onClick={props.onAddBrush}>
              Brush
            </Button>
            {hasOwn(model.legend, props.brush) ? (
              <Button size="sm" variant="ghost" icon="edit" onClick={() => props.onEditBrush(props.brush)}>
                Edit brush
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <EditCanvas
        label={`Grid map, ${model.width} by ${model.height} cells`}
        bounds={{ minX: 0, minY: 0, maxX: model.width * unit, maxY: model.height * unit }}
        fitKey={`grid:${model.width}x${model.height}`}
        height={360}
        tool={props.canvasTool}
        draw={(g, t, width, height, p) => drawGridMap(g, model, facts, t, width, height, p, { marks: props.marks, selected: props.selected })}
      />
      <span class="lre-small lre-muted">{HINTS[props.tool]}</span>
      {selectedPlace ? (
        <div class="lre-ve-dock" data-lre-selected={selectedPlace.id}>
          <span class="grow">
            <strong>{selectedPlace.name}</strong>
            <span class="lre-small lre-muted"> {selectedPlace.at ? `at ${selectedPlace.at.x}, ${selectedPlace.at.y}` : facts.areas.has(selectedPlace.id) ? `${facts.areas.get(selectedPlace.id)?.length ?? 0} cells` : "not drawn yet"}</span>
          </span>
          <Button size="sm" icon="edit" onClick={() => props.onOpenPlace(selectedPlace.id)}>
            Edit
          </Button>
          <IconButton icon="close" label="Clear the selection" onClick={props.onDeselect} />
        </div>
      ) : null}
    </>
  );
}

function NodeDraw(props: {
  model: MapModel;
  tool: NodeTool;
  onTool(tool: NodeTool): void;
  selected: Selection | null;
  band: { from: string; to: Point } | null;
  marks: readonly PreviewMark[];
  canUndo: boolean;
  onUndo(): void;
  placeName(id: string): string;
  canvasTool: CanvasTool;
  onOpen(selection: Selection): void;
  onDeselect(): void;
}) {
  const { model } = props;
  const unit = FRAME_UNITS / Math.max(1, model.width, model.height);
  const selectedPlace = props.selected?.kind === "place" ? model.places.find((p) => props.selected?.kind === "place" && p.id === props.selected.id) : undefined;
  const selectedLink = props.selected?.kind === "link" ? model.links.find((l) => props.selected?.kind === "link" && l.index === props.selected.index) : undefined;
  return (
    <>
      <div class="lre-ve-toolbar">
        <Seg<NodeTool> label="Tool" value={props.tool} options={NODE_TOOLS} onChange={props.onTool} />
        <IconButton icon="undo" label="Undo" disabled={!props.canUndo} onClick={props.onUndo} />
      </div>
      <EditCanvas
        label={`Node map with ${model.places.length} places`}
        bounds={{ minX: 0, minY: 0, maxX: model.width * unit, maxY: model.height * unit }}
        fitKey={`node:${model.width}x${model.height}`}
        height={360}
        tool={props.canvasTool}
        draw={(g, t, width, height, p) => drawNodeMap(g, model, t, width, height, p, { marks: props.marks, selected: props.selected, band: props.band })}
      />
      <span class="lre-small lre-muted">{HINTS[props.tool]}</span>
      {selectedPlace ? (
        <div class="lre-ve-dock" data-lre-selected={selectedPlace.id}>
          <span class="grow">
            <strong>{selectedPlace.name}</strong>
            <span class="lre-small lre-muted"> {selectedPlace.at ? `at ${selectedPlace.at.x}, ${selectedPlace.at.y}` : "not placed yet"}</span>
          </span>
          <Button size="sm" icon="edit" onClick={() => props.onOpen({ kind: "place", id: selectedPlace.id })}>
            Edit
          </Button>
          <IconButton icon="close" label="Clear the selection" onClick={props.onDeselect} />
        </div>
      ) : selectedLink ? (
        <div class="lre-ve-dock" data-lre-selected={`link:${selectedLink.index}`}>
          <span class="grow">
            <strong>
              {props.placeName(selectedLink.from)} {selectedLink.both ? "↔" : "→"} {props.placeName(selectedLink.to)}
            </strong>
            <span class="lre-small lre-muted">
              {" "}
              {selectedLink.minutes} min · {MODE_LABEL[selectedLink.mode]}
            </span>
          </span>
          <Button size="sm" icon="edit" onClick={() => props.onOpen({ kind: "link", index: selectedLink.index })}>
            Edit
          </Button>
          <IconButton icon="close" label="Clear the selection" onClick={props.onDeselect} />
        </div>
      ) : null}
    </>
  );
}

function PlacesPanel(props: { model: MapModel; facts: LayoutFacts | null; palette: CanvasPalette | null; placeName(id: string): string; entityName(id: string): string; issuesAt(prefix: JsonPath): LintIssue[]; onSheet(sheet: Sheet): void }) {
  const { model, facts } = props;
  const count = (n: number) => (n > 0 ? <Badge tone="warn">{n}</Badge> : undefined);
  return (
    <>
      <FormGroup title={model.kind === "grid" ? "Rooms and places" : "Places"} aside={<Button size="sm" icon="plus" onClick={() => props.onSheet({ kind: "newPlace", room: model.kind === "grid", at: null })}>{model.kind === "grid" ? "Room" : "Place"}</Button>}>
        {model.places.length === 0 ? (
          <span class="lre-small lre-muted">No places yet.</span>
        ) : (
          <div class="lre-form-items">
            {model.places.map((p) => {
              const cells = facts?.areas.get(p.id)?.length ?? 0;
              const where = model.kind === "grid" ? [cells > 0 ? `Room · ${cells} cell${cells === 1 ? "" : "s"}` : "No room drawn", p.at ? `at ${p.at.x}, ${p.at.y}` : ""] : [p.at ? `At ${p.at.x}, ${p.at.y}` : "Not placed: on a ring"];
              return <ItemRow key={`${p.index}:${p.id}`} title={p.name} subtitle={[...where, p.opens ? "has its own map" : ""].filter(Boolean).join(" · ")} badge={count(props.issuesAt(["places", p.index]).length)} openLabel={`Edit ${p.name}`} onOpen={() => props.onSheet({ kind: "place", id: p.id })} />;
            })}
          </div>
        )}
      </FormGroup>
      {model.kind === "grid" ? (
        <FormGroup title="Legend" aside={<Button size="sm" icon="plus" onClick={() => props.onSheet({ kind: "newLegend" })}>Add</Button>}>
          <span class="lre-small lre-muted">What each brush paints. Wall, floor, door and nothing need no entry.</span>
          {Object.keys(model.legend).length === 0 ? null : (
            <div class="lre-form-items">
              {Object.keys(model.legend).map((ch) => {
                const m = cellMeaning(model.legend, ch);
                const cells = facts?.counts.get(ch) ?? 0;
                return (
                  <ItemRow
                    key={ch}
                    title={
                      <span class="lre-ve-brush">
                        <Swatch fill={props.palette ? (m.kind === "place" ? roomTint(m.place, model.places.map((p) => p.id).sort(), props.palette) : meaningFill(m, props.palette)) : null} />
                        {meaningText(m, props.placeName, props.entityName)}
                      </span>
                    }
                    subtitle={
                      <>
                        {MEANINGS.find((x) => x.value === m.kind)?.label ?? "Unknown"} · {cells} cell{cells === 1 ? "" : "s"} <IdText id={ch === " " ? "space" : ch} />
                      </>
                    }
                    badge={count(props.issuesAt(["legend", ch]).length)}
                    openLabel={`Edit the legend entry ${meaningText(m, props.placeName, props.entityName)}`}
                    onOpen={() => props.onSheet({ kind: "legend", ch })}
                  />
                );
              })}
            </div>
          )}
        </FormGroup>
      ) : (
        <FormGroup title="Ways" aside={<Button size="sm" icon="plus" disabled={model.places.length < 1} onClick={() => props.onSheet({ kind: "newLink" })}>Way</Button>}>
          <span class="lre-small lre-muted">Link every place on the map or none: with links, travel between them follows only the links.</span>
          {model.links.length === 0 ? null : (
            <div class="lre-form-items">
              {model.links.map((l) => (
                <ItemRow key={l.index} title={`${props.placeName(l.from)} ${l.both ? "↔" : "→"} ${props.placeName(l.to)}`} subtitle={`${l.minutes} min · ${MODE_LABEL[l.mode]}`} badge={count(props.issuesAt(["links", l.index]).length)} openLabel={`Edit the way from ${props.placeName(l.from)} to ${props.placeName(l.to)}`} onOpen={() => props.onSheet({ kind: "link", index: l.index })} />
              ))}
            </div>
          )}
        </FormGroup>
      )}
    </>
  );
}

/** The sheet open over the map editor: a place, a new place or room, a legend entry, a way, or the map's own settings. */
function MapSheet(props: {
  sheet: Sheet;
  world: WorldDoc;
  mapId: string;
  value: MapValue;
  model: MapModel;
  facts: LayoutFacts | null;
  palette: CanvasPalette | null;
  issuesAt(prefix: JsonPath): LintIssue[];
  placeName(id: string): string;
  entityName(id: string): string;
  edit(change: (map: MapValue) => MapValue): void;
  onSheet(sheet: Sheet | null): void;
  onClose(): void;
  onPaint(ch: string): void;
  onSelect(selection: Selection | null): void;
}) {
  const { sheet, model, world } = props;
  const app = useApp();
  const mapPlaces: RefOption[] = model.places.map((p) => ({ value: p.id, label: p.name }));
  const worldPlaces: RefOption[] = Object.values(world.places)
    .filter((p) => p.map !== props.mapId && !model.places.some((own) => own.id === p.id))
    .map((p) => ({ value: p.id, label: p.name, sublabel: "outside this map" }));
  const taken = new Set([...Object.keys(world.places), ...model.places.map((p) => p.id)]);
  if (sheet.kind === "settings") return <SettingsSheet {...props} />;
  if (sheet.kind === "newPlace") return <NewPlaceSheet room={sheet.room} at={sheet.at} model={model} taken={taken} edit={props.edit} onClose={props.onClose} onCreated={(pid, ch) => {
    props.onSelect({ kind: "place", id: pid });
    if (ch) props.onPaint(ch);
    else props.onClose();
  }} />;
  if (sheet.kind === "place") {
    const place = model.places.find((p) => p.id === sheet.id);
    if (!place) return <FormSheet title="Place" backLabel="Map" onClose={props.onClose}><Empty>This place isn't on the map any more.</Empty></FormSheet>;
    return <PlaceSheet place={place} model={model} facts={props.facts} world={world} mapId={props.mapId} taken={taken} issues={props.issuesAt(["places", place.index])} edit={props.edit} onClose={props.onClose} onPaint={props.onPaint} onRenamed={(to) => props.onSheet({ kind: "place", id: to })} onRemoved={() => {
      props.onSelect(null);
      props.onClose();
    }} confirm={(title, message) => app.host.confirm(title, message, "danger", "Remove")} />;
  }
  if (sheet.kind === "legend" || sheet.kind === "newLegend") {
    return <LegendSheet ch={sheet.kind === "legend" ? sheet.ch : null} model={model} facts={props.facts} world={world} mapPlaces={mapPlaces} issues={sheet.kind === "legend" ? props.issuesAt(["legend", sheet.ch]) : []} edit={props.edit} onClose={props.onClose} onPaint={props.onPaint} confirm={(title, message) => app.host.confirm(title, message, "danger", "Remove")} />;
  }
  const link = sheet.kind === "link" ? model.links.find((l) => l.index === sheet.index) : undefined;
  if (sheet.kind === "link" && !link) return <FormSheet title="Way" backLabel="Map" onClose={props.onClose}><Empty>This way isn't on the map any more.</Empty></FormSheet>;
  return <LinkSheet link={link ?? null} options={[...mapPlaces, ...worldPlaces]} placeName={props.placeName} issues={link ? props.issuesAt(["links", link.index]) : []} edit={props.edit} onClose={props.onClose} onCreated={(index) => props.onSelect({ kind: "link", index })} />;
}

function SettingsSheet(props: { world: WorldDoc; mapId: string; value: MapValue; model: MapModel; issuesAt(prefix: JsonPath): LintIssue[]; edit(change: (map: MapValue) => MapValue): void; onClose(): void }) {
  const { value, model } = props;
  const scopes: RefOption[] = Object.values(props.world.places)
    .filter((p) => p.map !== props.mapId)
    .map((p) => ({ value: p.id, label: p.name, ...(p.parent ? { sublabel: `in ${props.world.places[p.parent]?.name ?? p.parent}` } : {}) }));
  const size = pairOf(value.size);
  return (
    <FormSheet title="Map settings" backLabel="Map" onClose={props.onClose}>
      <Field label="Title" help="Shown with the map; leave it empty to go by its id.">
        <input class="lre-input" value={typeof value.title === "string" ? value.title : ""} onChange={(event) => props.edit((map) => patched(map, { title: event.currentTarget.value.trim() || undefined }))} />
      </Field>
      <RefPicker label="Draws the inside of" value={typeof value.scope === "string" ? value.scope : ""} options={scopes} onChange={(scope) => props.edit((map) => ({ ...map, scope }))} />
      <Issues issues={props.issuesAt(["scope"])} />
      {model.kind === "grid" ? (
        <>
          <NumberStepper label="Width (cells)" value={model.width} min={1} max={64} integer onChange={(width) => props.edit((map) => withLayout(map, resizeLayout(model.layout, width, model.height, " ")))} />
          <NumberStepper label="Height (rows)" value={model.height} min={1} max={64} integer onChange={(height) => props.edit((map) => withLayout(map, resizeLayout(model.layout, model.width, height, " ")))} />
          <span class="lre-small lre-muted">New cells hold nothing until you paint them; cells cut off go.</span>
          <Field label="Cell size (metres)" help="80 when left empty; 1 or 2 suits a room. Walking times on the map use it.">
            <input class="lre-input" inputMode="decimal" value={typeof value.cellMeters === "number" ? String(value.cellMeters) : ""} onChange={(event) => {
              const n = Number(event.currentTarget.value);
              props.edit((map) => patched(map, { cellMeters: event.currentTarget.value.trim() && Number.isFinite(n) && n > 0 ? n : undefined }));
            }} />
          </Field>
          <Issues issues={[...props.issuesAt(["size"]), ...props.issuesAt(["cellMeters"])]} />
        </>
      ) : (
        <>
          <CheckField label="A fixed frame" help="Positions sit in a frame of this size; without one, the frame grows to fit them." checked={size !== null} onChange={(on) => props.edit((map) => patched(map, { size: on ? [model.width, model.height] : undefined }))} />
          {size ? (
            <>
              <NumberStepper label="Frame width" value={size.x} min={1} max={10000} integer onChange={(w) => props.edit((map) => ({ ...map, size: [w, size.y] }))} />
              <NumberStepper label="Frame height" value={size.y} min={1} max={10000} integer onChange={(h) => props.edit((map) => ({ ...map, size: [size.x, h] }))} />
            </>
          ) : null}
          <Issues issues={props.issuesAt(["size"])} />
        </>
      )}
    </FormSheet>
  );
}

function NewPlaceSheet(props: { room: boolean; at: Cell | null; model: MapModel; taken: ReadonlySet<string>; edit(change: (map: MapValue) => MapValue): void; onClose(): void; onCreated(id: string, ch: string | null): void }) {
  const [name, setName] = useState("");
  const pid = deriveId(name || "place", props.taken);
  const ch = props.room ? freeChar(props.model.legend, props.model.layout, name) : null;
  const noun = props.room ? "room" : "place";
  return (
    <FormSheet title={props.room ? "New room" : "New place"} backLabel="Map" onClose={props.onClose}>
      <form
        class="lre-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || (props.room && !ch)) return;
          props.edit((map) => {
            const place: Record<string, unknown> = { id: pid, name: name.trim(), ...(props.at ? { at: [props.at.x, props.at.y] } : {}) };
            const added = { ...map, places: [...listOf(map, "places"), place] };
            return ch ? setLegend(added, ch, { place: pid }) : added;
          });
          props.onCreated(pid, ch);
        }}
      >
        <Field label="Name" help={props.room ? "Then paint its area with its brush; doors (+) join it to the rooms around it." : props.at ? `It goes at ${props.at.x}, ${props.at.y}; drag it to move it.` : "It goes on a ring until you drag it into place."}>
          <input class="lre-input" value={name} placeholder={props.room ? "Kitchen" : "Market square"} onInput={(event) => setName(event.currentTarget.value)} />
        </Field>
        <IdText id={pid} />
        {props.room && !ch ? <Issues issues={[{ severity: "error", path: "legend", code: "map", message: "Every layout character is taken; free one in the legend first." }]} /> : null}
        <div class="lre-inline">
          <Button type="submit" variant="primary" icon="plus" disabled={!name.trim() || (props.room && !ch)}>
            Add the {noun}
          </Button>
        </div>
      </form>
    </FormSheet>
  );
}

function PlaceSheet(props: { place: MapPlaceEntry; model: MapModel; facts: LayoutFacts | null; world: WorldDoc; mapId: string; taken: ReadonlySet<string>; issues: LintIssue[]; edit(change: (map: MapValue) => MapValue): void; onClose(): void; onPaint(ch: string): void; onRenamed(id: string): void; onRemoved(): void; confirm(title: string, message: string): Promise<boolean> }) {
  const { place, model } = props;
  const [idText, setIdText] = useState(place.id);
  useEffect(() => setIdText(place.id), [place.id]);
  const grid = model.kind === "grid";
  const roomChars = Object.keys(model.legend).filter((ch) => {
    const m = cellMeaning(model.legend, ch);
    return m.kind === "place" && m.place === place.id;
  });
  const cells = props.facts?.areas.get(place.id)?.length ?? 0;
  const maps: RefOption[] = Object.entries(props.world.maps)
    .filter(([key]) => key !== props.mapId)
    .map(([key, map]) => ({ value: key, label: map.title ?? nameOfId(key), sublabel: map.scope === place.id ? "draws this place" : `draws ${props.world.places[map.scope]?.name ?? map.scope}` }));
  const idProblem = idText === place.id ? null : !ID_PATTERN.test(idText) ? "Letters, digits, _ and -, starting with a letter or digit." : props.taken.has(idText) ? "Another place has this id." : null;
  const setAt = (at: Cell | null) => props.edit((map) => patchPlace(map, place.index, { at: at ? [at.x, at.y] : undefined }));
  return (
    <FormSheet title={place.name} subtitle={grid ? (cells > 0 ? `Room · ${cells} cells` : "Place") : "Place"} backLabel="Map" onClose={props.onClose}>
      <Issues issues={props.issues} />
      <Field label="Name" help="Leave it empty to go by its id in words.">
        <input class="lre-input" value={place.name === nameOfId(place.id) ? "" : place.name} placeholder={nameOfId(place.id)} onChange={(event) => props.edit((map) => patchPlace(map, place.index, { name: event.currentTarget.value.trim() || undefined }))} />
      </Field>
      <FormGroup title={grid ? "Its cell" : "Position"} aside={place.at ? <Button size="sm" variant="ghost" onClick={() => setAt(null)}>Clear</Button> : <Button size="sm" onClick={() => setAt(grid ? { x: 0, y: 0 } : { x: Math.round(model.width / 2), y: Math.round(model.height / 2) })}>Set</Button>}>
        {place.at ? (
          <>
            <NumberStepper label="Across (x)" value={place.at.x} min={0} max={grid ? model.width - 1 : 10000} integer onChange={(x) => setAt({ x, y: place.at?.y ?? 0 })} />
            <NumberStepper label="Down (y)" value={place.at.y} min={0} max={grid ? model.height - 1 : 10000} integer onChange={(y) => setAt({ x: place.at?.x ?? 0, y })} />
          </>
        ) : (
          <span class="lre-small lre-muted">{grid ? "In the middle of its room. Drag its dot on the map, or set a cell here." : "On a ring with the other unplaced places. Drag it on the map, or set a position here."}</span>
        )}
      </FormGroup>
      {grid ? (
        <FormGroup title="Its room">
          {roomChars.length > 0 ? (
            <>
              <span class="lre-small lre-muted">{cells > 0 ? `${cells} cell${cells === 1 ? "" : "s"} painted.` : "Nothing painted yet."}</span>
              <div class="lre-inline">
                {roomChars.map((ch) => (
                  <Button key={ch} size="sm" icon="edit" onClick={() => props.onPaint(ch)}>
                    Paint its room{roomChars.length > 1 ? ` (${ch})` : ""}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <>
              <span class="lre-small lre-muted">No brush paints its room: it stands at its cell only.</span>
              <div class="lre-inline">
                <Button
                  size="sm"
                  icon="plus"
                  disabled={freeChar(model.legend, model.layout, place.name) === null}
                  onClick={() => {
                    const ch = freeChar(model.legend, model.layout, place.name);
                    if (!ch) return;
                    props.edit((map) => setLegend(map, ch, { place: place.id }));
                    props.onPaint(ch);
                  }}
                >
                  Give it a room
                </Button>
              </div>
            </>
          )}
        </FormGroup>
      ) : null}
      <RefPicker label="Its inside is drawn by" value={place.opens ?? ""} options={maps} none="No map of its own" onChange={(opens) => props.edit((map) => patchPlace(map, place.index, { opens: opens || undefined }))} />
      <Disclosure summary="Advanced">
        <Field label="Id" help="Rules, actions and other maps name the place by it. Changing it changes it everywhere this map names it." error={idProblem}>
          <input
            class={idProblem ? "lre-input invalid" : "lre-input"}
            value={idText}
            onInput={(event) => setIdText(event.currentTarget.value.trim())}
            onChange={() => {
              if (idText === place.id || idProblem) return;
              props.edit((map) => renamePlace(map, place.id, idText));
              props.onRenamed(idText);
            }}
          />
        </Field>
      </Disclosure>
      <div class="lre-inline">
        <Button
          variant="danger"
          icon="trash"
          onClick={async () => {
            const parts = [grid && roomChars.length > 0 ? "its room's cells become floor" : "", model.links.some((l) => l.from === place.id || l.to === place.id) ? "its ways go" : ""].filter(Boolean);
            if (!(await props.confirm("Remove place", `Remove ${place.name} from the map${parts.length > 0 ? `? ${parts.join(", and ")}.` : "?"}`))) return;
            props.edit((map) => removePlace(map, place.id));
            props.onRemoved();
          }}
        >
          Remove {grid ? "room" : "place"}
        </Button>
      </div>
    </FormSheet>
  );
}

function LegendSheet(props: { ch: string | null; model: MapModel; facts: LayoutFacts | null; world: WorldDoc; mapPlaces: RefOption[]; issues: LintIssue[]; edit(change: (map: MapValue) => MapValue): void; onClose(): void; onPaint(ch: string): void; confirm(title: string, message: string): Promise<boolean> }) {
  const { model } = props;
  const current = props.ch !== null ? cellMeaning(model.legend, props.ch) : null;
  const [kind, setKind] = useState<MeaningKind>(current && current.kind !== "nothing" && current.kind !== "unknown" ? current.kind : "terrain");
  const [form, setForm] = useState({
    terrain: current?.kind === "terrain" ? current.terrain : "grass",
    blocked: current?.kind === "terrain" ? current.blocked : false,
    place: current?.kind === "place" || current?.kind === "roomDoor" ? current.place : (props.mapPlaces[0]?.value ?? ""),
    zone: current?.kind === "zone" ? current.zone : "",
    item: current?.kind === "item" ? current.item : "",
    itemPlace: current?.kind === "item" ? (current.place ?? "") : "",
  });
  const [chText, setChText] = useState(props.ch ?? freeChar(model.legend, model.layout, kind === "place" || kind === "roomDoor" ? form.place : kind === "zone" ? form.zone : kind === "item" ? form.item : form.terrain) ?? "");
  const cells = props.ch !== null ? (props.facts?.counts.get(props.ch) ?? 0) : 0;
  const chars = [...chText];
  const chProblem = chars.length !== 1 ? "One character." : chText !== props.ch && hasOwn(model.legend, chText) ? "The legend has this character already." : null;
  const ready = kind === "terrain" ? form.terrain.trim() !== "" : kind === "place" || kind === "roomDoor" ? form.place !== "" : kind === "zone" ? ID_PATTERN.test(form.zone) : kind === "item" ? form.item !== "" : true;
  const things: RefOption[] = Object.values(props.world.entities).map((e) => ({ value: e.id, label: e.name, sublabel: e.kind }));
  const commit = () => {
    if (!ready || chProblem) return;
    const cell = legendValue(kind, { ...form, terrain: form.terrain.trim() });
    props.edit((map) => {
      const moved = props.ch !== null && props.ch !== chText ? moveLegendChar(map, props.ch, chText) : map;
      return setLegend(moved, chText, cell);
    });
  };
  const update = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  return (
    <FormSheet title={props.ch === null ? "New brush" : "Brush"} subtitle={props.ch === null ? "A legend entry: what a layout character paints" : `${cells} cell${cells === 1 ? "" : "s"} painted with it`} backLabel="Map" onClose={props.onClose}>
      <Issues issues={props.issues} />
      <Field label="It paints">
        <Seg<MeaningKind> label="It paints" value={kind} options={MEANINGS} onChange={setKind} />
      </Field>
      {kind === "terrain" ? (
        <>
          <Field label="Terrain" help="Its name decides its colour and walking cost: grass, road, water, sand, mud, forest, rock…">
            <input class="lre-input" value={form.terrain} onInput={(event) => update({ terrain: event.currentTarget.value })} />
          </Field>
          <CheckField label="Can't be crossed" checked={form.blocked} onChange={(blocked) => update({ blocked })} />
        </>
      ) : null}
      {kind === "place" ? <RefPicker label="The room of" value={form.place} options={props.mapPlaces} onChange={(place) => update({ place })} /> : null}
      {kind === "roomDoor" ? <RefPicker label="A door of" value={form.place} options={props.mapPlaces} onChange={(place) => update({ place })} /> : null}
      {kind === "zone" ? (
        <Field label="Zone id" help="Rules can fire when someone steps into it." error={form.zone && !ID_PATTERN.test(form.zone) ? "Letters, digits, _ and -, starting with a letter or digit." : null}>
          <input class="lre-input" value={form.zone} onInput={(event) => update({ zone: event.currentTarget.value.trim() })} />
        </Field>
      ) : null}
      {kind === "item" ? (
        <>
          <RefPicker label="The thing lying here" value={form.item} options={things} onChange={(item) => update({ item })} />
          <RefPicker label="On the floor of" value={form.itemPlace} options={props.mapPlaces} none="The room around it" onChange={(itemPlace) => update({ itemPlace })} />
        </>
      ) : null}
      <Disclosure summary="Advanced" defaultOpen={chProblem !== null}>
        <Field label="Layout character" help="The character the map's layout uses for it." error={chProblem}>
          <input class={chProblem ? "lre-input invalid lre-ve-char" : "lre-input lre-ve-char"} value={chText} maxLength={2} onInput={(event) => setChText(event.currentTarget.value)} />
        </Field>
      </Disclosure>
      <div class="lre-inline">
        <Button
          variant="primary"
          icon="check"
          disabled={!ready || chProblem !== null}
          onClick={() => {
            commit();
            props.onPaint(chText);
          }}
        >
          {props.ch === null ? "Add and paint" : "Save and paint"}
        </Button>
        <Button
          disabled={!ready || chProblem !== null}
          onClick={() => {
            commit();
            props.onClose();
          }}
        >
          {props.ch === null ? "Add" : "Save"}
        </Button>
        {props.ch !== null ? (
          <Button
            variant="danger"
            icon="trash"
            onClick={async () => {
              const ch = props.ch;
              if (ch === null) return;
              if (cells > 0 && !(await props.confirm("Remove brush", `${cells} cell${cells === 1 ? " uses" : "s use"} it; they become floor.`))) return;
              props.edit((map) => setLegend(map, ch, undefined));
              props.onClose();
            }}
          >
            Remove
          </Button>
        ) : null}
      </div>
    </FormSheet>
  );
}

function LinkSheet(props: { link: MapLinkEntry | null; options: RefOption[]; placeName(id: string): string; issues: LintIssue[]; edit(change: (map: MapValue) => MapValue): void; onClose(): void; onCreated(index: number): void }) {
  const link = props.link;
  const [draft, setDraft] = useState({ from: props.options[0]?.value ?? "", to: props.options[1]?.value ?? "", minutes: 5 });
  if (!link) {
    return (
      <FormSheet title="New way" backLabel="Map" onClose={props.onClose}>
        <RefPicker label="From" value={draft.from} options={props.options} onChange={(from) => setDraft({ ...draft, from })} />
        <RefPicker label="To" value={draft.to} options={props.options} onChange={(to) => setDraft({ ...draft, to })} />
        <NumberStepper label="Minutes" value={draft.minutes} min={1} max={100000} onChange={(minutes) => setDraft({ ...draft, minutes })} />
        <div class="lre-inline">
          <Button
            variant="primary"
            icon="plus"
            disabled={!draft.from || !draft.to || draft.from === draft.to}
            onClick={() => {
              let index = 0;
              props.edit((map) => {
                const links = listOf(map, "links");
                index = links.length;
                return { ...map, links: [...links, { from: draft.from, to: draft.to, minutes: draft.minutes }] };
              });
              props.onCreated(index);
              props.onClose();
            }}
          >
            Add the way
          </Button>
        </div>
      </FormSheet>
    );
  }
  const set = (patch: Record<string, unknown>) => props.edit((map) => patchLink(map, link.index, patch));
  return (
    <FormSheet title={`${props.placeName(link.from)} ${link.both ? "↔" : "→"} ${props.placeName(link.to)}`} subtitle="A way between two places" backLabel="Map" onClose={props.onClose}>
      <Issues issues={props.issues} />
      <RefPicker label="From" value={link.from} options={props.options} onChange={(from) => set({ from })} />
      <RefPicker label="To" value={link.to} options={props.options} onChange={(to) => set({ to })} />
      <NumberStepper label="Minutes" value={link.minutes} min={1} max={100000} onChange={(minutes) => set({ minutes })} />
      <Field label="By">
        <Seg<TravelMode> label="By" value={link.mode} options={MODES.map((mode) => ({ value: mode, label: MODE_LABEL[mode] }))} onChange={(mode) => set({ mode: mode === "walk" ? undefined : mode })} />
      </Field>
      <CheckField label="Both ways" help="Off: only from the first place to the second." checked={link.both} onChange={(both) => set({ bidirectional: both ? undefined : false })} />
      <div class="lre-inline">
        <Button
          variant="danger"
          icon="trash"
          onClick={() => {
            props.edit((map) => ({ ...map, links: listOf(map, "links").filter((_, i) => i !== link.index) }));
            props.onClose();
          }}
        >
          Remove the way
        </Button>
      </div>
    </FormSheet>
  );
}
