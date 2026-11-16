// Everyone and everything on a grid, drawn where the view puts them (plan §8.2; PlanChatUI-4 item 1): each
// piece on its square with its footprint, marked by kind; a thing lying on another shown small on the
// holder's square; each door as it stands (open, closed or locked); the squares the player's character
// does not see now under a shade. The grid's own ground is `map-draw.ts`'s; this is what stands on it.

import type { Point, Transform } from "../../../frontend/map-math";
import { toScreen } from "../../../frontend/map-math";
import type { MapDoorView, MapGridView, MapPieceView } from "../core/map-scope";
import type { CanvasPalette } from "./canvas-theme";

/** Kinds that stand on their own feet are drawn round; the rest fill their footprint. */
const BEING = /person|people|npc|character|creature|animal|monster|beast/i;

/** Whether a kind of thing is someone who stands and walks (a person, a creature), and has a person's sheet. */
export function isBeing(kind: string): boolean {
  return BEING.test(kind);
}

/** How much of its square a thing lying on another takes: a badge in the square's corner. */
const BADGE = 0.4;

/** A piece's state when it is not alive is drawn dim. */
const DIM = 0.45;

/** The series colour a kind is drawn in: one kind is one colour on every map. */
export function kindColor(kind: string, palette: Pick<CanvasPalette, "series" | "item">): string {
  let hash = 0;
  for (const ch of kind) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return palette.series[hash % Math.max(1, palette.series.length)] ?? palette.item;
}

/** The squares a piece covers, from its top left. */
export function footprintOf(piece: Pick<MapPieceView, "x" | "y" | "size">): { x: number; y: number; w: number; h: number } {
  return { x: piece.x, y: piece.y, w: piece.size?.[0] ?? 1, h: piece.size?.[1] ?? 1 };
}

/** Where a piece is on the screen: its footprint, or the badge a thing lying on another is. */
function boxOf(piece: MapPieceView, unit: number, t: Transform): { x: number; y: number; w: number; h: number } {
  const f = footprintOf(piece);
  const size = unit * t.k;
  const at = toScreen(t, { x: f.x * unit, y: f.y * unit });
  if (piece.on === undefined) return { x: at.x, y: at.y, w: f.w * size, h: f.h * size };
  const s = size * BADGE;
  return { x: at.x + size - s, y: at.y + size - s, w: s, h: s };
}

/** The piece under a screen point: the topmost that covers it (a thing lying on another is above its holder). */
export function pieceAt(grid: Pick<MapGridView, "pieces">, unit: number, t: Transform, p: Point): MapPieceView | null {
  const pieces = grid.pieces ?? [];
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const piece = pieces[i];
    if (piece === undefined) continue;
    const b = boxOf(piece, unit, t);
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return piece;
  }
  return null;
}

/** The pieces covering a square (its footprint, not the badge a thing lying on another is): who and what is there. */
export function piecesAt(grid: Pick<MapGridView, "pieces">, cell: { x: number; y: number }): MapPieceView[] {
  return (grid.pieces ?? []).filter((piece) => {
    const f = footprintOf(piece);
    return cell.x >= f.x && cell.x < f.x + f.w && cell.y >= f.y && cell.y < f.y + f.h;
  });
}

function shade(g: CanvasRenderingContext2D, indexes: readonly number[], width: number, unit: number, t: Transform, palette: CanvasPalette): void {
  const size = unit * t.k;
  const span = Math.ceil(size);
  g.globalAlpha = 0.5;
  g.fillStyle = palette.fog;
  for (const index of indexes) {
    const p = toScreen(t, { x: (index % width) * unit, y: Math.floor(index / width) * unit });
    g.fillRect(p.x, p.y, span, span);
  }
  g.globalAlpha = 1;
}

function paintDoor(g: CanvasRenderingContext2D, door: MapDoorView, unit: number, t: Transform, palette: CanvasPalette): void {
  const size = unit * t.k;
  const p = toScreen(t, { x: door.x * unit, y: door.y * unit });
  const inset = Math.max(1, size * 0.22);
  const w = Math.max(2, size - inset * 2);
  g.lineWidth = 2;
  g.strokeStyle = palette.ink;
  if (door.state === "open") {
    g.setLineDash([3, 3]);
    g.strokeRect(p.x + inset, p.y + inset, w, w);
    g.setLineDash([]);
    return;
  }
  g.globalAlpha = 0.85;
  g.fillStyle = palette.series[2] ?? palette.item;
  g.fillRect(p.x + inset, p.y + inset, w, w);
  g.globalAlpha = 1;
  g.strokeRect(p.x + inset, p.y + inset, w, w);
  if (door.state === "locked") {
    g.fillStyle = palette.ink;
    g.beginPath();
    g.arc(p.x + size / 2, p.y + size / 2, Math.max(2, size * 0.1), 0, Math.PI * 2);
    g.fill();
  }
}

function paintPiece(g: CanvasRenderingContext2D, piece: MapPieceView, unit: number, t: Transform, palette: CanvasPalette, picked: boolean): void {
  const b = boxOf(piece, unit, t);
  const size = unit * t.k;
  const lying = piece.on !== undefined;
  g.globalAlpha = piece.state === undefined ? 0.9 : DIM;
  g.fillStyle = kindColor(piece.kind, palette);
  g.strokeStyle = picked ? palette.item : palette.ink;
  // A footprint that blocks the way is outlined heavier than one that does not.
  g.lineWidth = picked ? 3 : piece.blocks?.way === true ? 2.5 : 1.5;
  g.beginPath();
  if (!lying && isBeing(piece.kind) && b.w === size && b.h === size) g.arc(b.x + b.w / 2, b.y + b.h / 2, Math.max(3, size * 0.36), 0, Math.PI * 2);
  else g.rect(b.x + 1, b.y + 1, Math.max(2, b.w - 2), Math.max(2, b.h - 2));
  g.fill();
  g.stroke();
  g.globalAlpha = 1;
  // What it is, at a size a letter reads at.
  if (!lying && size >= 14 && piece.name.length > 0) {
    g.font = `${Math.round(Math.max(9, size * 0.42))}px ${palette.font}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = palette.ink;
    g.fillText(piece.name.charAt(0).toUpperCase(), b.x + b.w / 2, b.y + b.h / 2);
    g.textAlign = "start";
    g.textBaseline = "alphabetic";
  }
}

/** What stands on a grid, drawn over its ground: the squares not seen shaded, each door, each piece (those lying on another last). */
export function paintScene(g: CanvasRenderingContext2D, grid: MapGridView, unit: number, t: Transform, palette: CanvasPalette, picked: string | null): void {
  if (grid.dark !== undefined) shade(g, grid.dark, grid.width, unit, t, palette);
  for (const door of grid.doors ?? []) paintDoor(g, door, unit, t, palette);
  const pieces = grid.pieces ?? [];
  for (const piece of pieces) if (piece.on === undefined) paintPiece(g, piece, unit, t, palette, piece.id === picked);
  for (const piece of pieces) if (piece.on !== undefined) paintPiece(g, piece, unit, t, palette, piece.id === picked);
}
