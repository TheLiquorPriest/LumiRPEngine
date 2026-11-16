// The owner's tools on a chat's grid (plan §8.2; PlanChatUI-4 items 4 and 5): squares changed one at a time, a
// rectangle or a line with a symbol of the map's legend, and a grid laid for a place that has none. Each is
// his own change on the chat's line, told to the Author, with an Undo; the change belongs to the chat until
// he keeps it in the world.

import { useState } from "preact/hooks";
import type { Cell } from "../../../shared/grid";
import type { MapStroke } from "../../../frontend/app";
import { Button, Field, IconButton, NumberStepper, Seg } from "../../../frontend/components";

export type MapTool = "square" | "rect" | "line";

const TOOLS = [
  { value: "square", label: "Square", title: "Change one square" },
  { value: "rect", label: "Rectangle", title: "Change a rectangle: tap two corners" },
  { value: "line", label: "Line", title: "Change a line of squares: tap its two ends" },
] as const satisfies readonly { value: MapTool; label: string; title: string }[];

/** One symbol of the map's legend, with what it stands for in words. */
export interface LegendSymbol {
  symbol: string;
  words: string;
}

/** What a legend entry stands for, as a person reads it. */
export function legendWords(def: unknown): string {
  if (typeof def === "string") return def;
  if (typeof def !== "object" || def === null) return "";
  const entry = def as Record<string, unknown>;
  if (entry.door === true) return "door";
  if (typeof entry.terrain === "string") return entry.terrain;
  if (typeof entry.place === "string") return `place ${entry.place}`;
  if (typeof entry.zone === "string") return `zone ${entry.zone}`;
  if (typeof entry.item === "string") return `item ${entry.item}`;
  return "";
}

export function legendOf(legend: Readonly<Record<string, unknown>>): LegendSymbol[] {
  return Object.entries(legend)
    .map(([symbol, def]) => ({ symbol, words: legendWords(def) }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** A square as the routes count them: from 1 at the top left. */
const counted = (cell: Cell): number[] => [cell.x + 1, cell.y + 1];

/**
 * What a tap on a square does with the tool in hand: a stroke ready to send, or the first corner or end kept
 * until the second is tapped.
 */
export function tapped(tool: MapTool, symbol: string, anchor: Cell | null, cell: Cell): { stroke: MapStroke | null; anchor: Cell | null } {
  if (tool === "square") return { stroke: { symbol, squares: [counted(cell)] }, anchor: null };
  if (anchor === null) return { stroke: null, anchor: cell };
  return { stroke: tool === "rect" ? { symbol, rect: [counted(anchor), counted(cell)] } : { symbol, line: [counted(anchor), counted(cell)] }, anchor: null };
}

export interface MapToolsProps {
  tool: MapTool;
  symbol: string | null;
  symbols: readonly LegendSymbol[];
  /** The first corner or end of a rectangle or line, tapped and waiting for its other. */
  anchor: Cell | null;
  busy: boolean;
  /** The last change made here, to take back. */
  undo: { words: string } | null;
  onTool(tool: MapTool): void;
  onSymbol(symbol: string): void;
  onUndo(): void;
  onClose(): void;
}

/** The Undo of the last change made on the grid, with what it was. */
export function UndoBar(props: { undo: { words: string } | null; busy: boolean; onUndo(): void }) {
  if (props.undo === null) return null;
  return (
    <div class="lre-row" data-lre-map-undo>
      <span class="k">{props.undo.words}</span>
      <Button size="sm" icon="undo" disabled={props.busy} onClick={props.onUndo}>
        Undo
      </Button>
    </div>
  );
}

/** The tools' bar: which way to change squares, and what to change them to. */
export function MapTools(props: MapToolsProps) {
  const waiting = props.anchor !== null;
  return (
    <div class="lre-world-dock lre-map-tools" role="group" aria-label="Change squares" data-lre-map-tools>
      <div class="lre-world-dock-head">
        <strong>Change squares</strong>
        <IconButton icon="close" label="Stop changing squares" onClick={props.onClose} />
      </div>
      <Seg<MapTool> label="Change" value={props.tool} options={TOOLS} disabled={props.busy} onChange={props.onTool} />
      <div class="lre-map-symbols" role="radiogroup" aria-label="Change squares to">
        {props.symbols.map((s) => (
          <button key={s.symbol} type="button" role="radio" aria-checked={props.symbol === s.symbol} class={props.symbol === s.symbol ? "lre-btn primary small" : "lre-btn small"} title={s.words} disabled={props.busy} onClick={() => props.onSymbol(s.symbol)}>
            <span class="lre-map-symbol">{s.symbol}</span> {s.words}
          </button>
        ))}
      </div>
      <span class="lre-muted" data-lre-map-tool-hint>
        {props.symbol === null ? "Pick what to change squares to." : waiting ? "Tap the other end." : props.tool === "square" ? "Tap a square." : "Tap the first end."}
      </span>
      <UndoBar undo={props.undo} busy={props.busy} onUndo={props.onUndo} />
    </div>
  );
}

export interface LayGridProps {
  place: string;
  name: string;
  busy: boolean;
  onLay(laying: { width: number; height: number; feet: number }): void;
}

/** A place that draws no grid: its size in squares and how wide a square is, to lay one the chat plays on. */
export function LayGrid(props: LayGridProps) {
  const [width, setWidth] = useState(8);
  const [height, setHeight] = useState(8);
  const [feet, setFeet] = useState(5);
  return (
    <div class="lre-world-dock lre-map-lay" role="group" aria-label={`Lay a grid for ${props.name}`} data-lre-map-lay={props.place}>
      <div class="lre-world-dock-head">
        <strong>{props.name} has no grid</strong>
      </div>
      <Field label="Lay one for the chat" help="The chat plays on it from now on; it stays the chat's until you keep it in the world.">
        <NumberStepper label="Squares across" value={width} min={1} integer disabled={props.busy} onChange={setWidth} />
        <NumberStepper label="Squares down" value={height} min={1} integer disabled={props.busy} onChange={setHeight} />
        <NumberStepper label="Feet to a square" value={feet} min={1} integer disabled={props.busy} onChange={setFeet} />
      </Field>
      <Button variant="primary" busy={props.busy} onClick={() => props.onLay({ width, height, feet })}>
        Lay the grid
      </Button>
    </div>
  );
}
