// Map label placement: where each place's name goes on the map canvas, so no two names, no name and
// a place's dot, and no name and the map's own controls overlap. Pure geometry on screen pixels.
//
// Each name goes on the side of its dot facing away from the middle of the map (a ring of places gets
// names around its rim), beside the dot when there's room, else a little further out with a thin
// leader line back to it, or on another side; a place at the left or right keeps its name on its
// own half. A name that doesn't fit whole goes on two lines, else is shortened with an ellipsis
// (the full name shows in the place's card on tap), and as a last resort is left off; its dot stays
// tappable. The order is fixed (the POV's place, the selected place, then places straight left,
// right, above or below the middle, then diagonal ones), so the same map always lays out the same way.

import type { Point } from "../../../frontend/map-math";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelItem {
  id: string;
  /** The dot's centre, in screen px. */
  x: number;
  y: number;
  /** The dot's radius, in px. */
  r: number;
  text: string;
}

export interface PlacedLabel {
  id: string;
  /** The text drawn, one entry per line: the full name, or one wrapped onto two lines, or a shortened one ending in "…". */
  lines: string[];
  full: string;
  box: Box;
  /** From the dot's edge to the label, when the label isn't beside its dot. */
  leader: { from: Point; to: Point } | null;
}

export interface LabelOptions {
  width: number;
  height: number;
  /** Text width in px at the label font. */
  measure(text: string): number;
  /** Screen areas labels must stay out of (the map's buttons and title bar). */
  avoid?: readonly Box[];
  /** Ids laid out first, in this order (the POV's place, the selected place). */
  first?: readonly string[];
}

export const LABEL_HEIGHT = 20;
/** Line height of a label's second line. */
export const LINE = 16;
/** Text inset inside a label box, each side. */
export const LABEL_PAD = 4;
/** Space kept between a label and anything else. */
const GAP = 3;
/** Space kept clear at the canvas edge. */
const EDGE = 4;
const STEP = 16;
/** Widths tried, in px of text, once the full name doesn't fit anywhere. */
const SHORTER = [120, 96, 76, 60, 44];
/** Shorter widths that still read as most of a name, preferred near the dot over the full name far off. */
const READABLE = [120, 96, 76];
const MIN_CHARS = 4;
/** The cost up to which a label is still "a little further out" from its dot. */
const FAR = 112;
/** Space a side place's label keeps from the middle of the map, so the two sides' labels never meet there. */
const HALF_GAP = 2;
/** How far along its side a label may slide from its dot, and in what steps. */
const SLIDE = 120;
const SLIDE_STEP = 12;
/** The farthest a label sits from its dot. */
const MAX_REACH = 240;
/** A spot's cost (px out, px along, side rank) up to which the full name is preferred to a shorter one. */
const NEAR = 64;

/** Clear space around the places when the map is fitted, so names have room around a ring. */
export function labelPadding(width: number, height: number): number {
  return Math.round(Math.max(56, Math.min(width, height) * 0.2));
}

/** The map's own controls, which labels avoid: the bars along the top (`top` px tall) and the zoom buttons. */
export function controlBoxes(width: number, height: number, top = 52): Box[] {
  return [
    { x: 0, y: 0, w: width, h: top },
    { x: width - 56, y: height - 150, w: 56, h: 150 },
  ];
}

function overlaps(a: Box, b: Box, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

function inside(b: Box, width: number, height: number): boolean {
  return b.x >= EDGE && b.y >= EDGE && b.x + b.w <= width - EDGE && b.y + b.h <= height - EDGE;
}

/** Whether segment p→q crosses box b (Liang–Barsky clipping). */
function segmentHits(p: Point, q: Point, b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const edges: [number, number][] = [
    [-dx, p.x - b.x],
    [dx, b.x + b.w - p.x],
    [-dy, p.y - b.y],
    [dy, b.y + b.h - p.y],
  ];
  for (const [d, n] of edges) {
    if (d === 0) {
      if (n < 0) return false;
      continue;
    }
    const t = n / d;
    if (d < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/** The longest prefix of `text` that, with "…", measures at most `max` px; null under four characters. */
export function shorten(text: string, max: number, measure: (s: string) => number): string | null {
  if (measure(text) <= max) return text;
  let lo = MIN_CHARS;
  let hi = text.length - 1;
  let best: string | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = `${text.slice(0, mid).trimEnd()}…`;
    if (measure(s) <= max) {
      best = s;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/** A name on two lines at most `max` px wide, split between words; the second line shortened if needed. */
export function wrapTwo(text: string, max: number, measure: (s: string) => number): [string, string] | null {
  const words = text.split(/\s+/).filter((w) => w !== "");
  if (words.length < 2) return null;
  let first = "";
  let i = 0;
  while (i < words.length - 1) {
    const next = first === "" ? (words[i] ?? "") : `${first} ${words[i] ?? ""}`;
    if (measure(next) > max) break;
    first = next;
    i++;
  }
  if (first === "") return null;
  const second = shorten(words.slice(i).join(" "), max, measure);
  return second ? [first, second] : null;
}

type Side = "right" | "left" | "above" | "below";

/** The point of box `b` nearest to `p`. */
function nearest(b: Box, p: Point): Point {
  return { x: Math.max(b.x, Math.min(p.x, b.x + b.w)), y: Math.max(b.y, Math.min(p.y, b.y + b.h)) };
}

/** The sides to try for a dot, outward first: its direction from the middle of the map decides. */
function sidesFor(dir: Point): Side[] {
  const horizontal: Side[] = dir.x >= 0 ? ["right", "left"] : ["left", "right"];
  const vertical: Side[] = dir.y < 0 ? ["above", "below"] : ["below", "above"];
  return Math.abs(dir.x) >= 0.45 ? [horizontal[0]!, vertical[0]!, vertical[1]!, horizontal[1]!] : [vertical[0]!, horizontal[0]!, horizontal[1]!, vertical[1]!];
}

/** A place for a label relative to its dot: a side, how far out, and how far along that side. */
interface Spot {
  side: Side;
  out: number;
  slide: number;
  cost: number;
}

/** Every spot within reach, cheapest first: outward sides, near the dot, little slide. */
function spotsFor(sides: readonly Side[], reach: number): Spot[] {
  const out: Spot[] = [];
  sides.forEach((side, rankOfSide) => {
    for (let d = 0; d <= reach; d += STEP) {
      for (let s = 0; s <= SLIDE; s += SLIDE_STEP) {
        for (const slide of s === 0 ? [0] : [s, -s]) out.push({ side, out: d, slide, cost: d + Math.abs(slide) + rankOfSide * 14 });
      }
    }
  });
  return out.sort((a, b) => a.cost - b.cost);
}

/** The box for a `w`×`h` label at `spot` around a dot of radius `r` at `p`. */
function spotBox(p: Point, r: number, spot: Spot, w: number, h: number): Box {
  const clear = r + GAP + 1 + spot.out;
  switch (spot.side) {
    case "right":
      return { x: p.x + clear, y: p.y - h / 2 + spot.slide, w, h };
    case "left":
      return { x: p.x - clear - w, y: p.y - h / 2 + spot.slide, w, h };
    case "above":
      return { x: p.x - w / 2 + spot.slide, y: p.y - clear - h, w, h };
    case "below":
      return { x: p.x - w / 2 + spot.slide, y: p.y + clear, w, h };
  }
}

/**
 * Lays out every place's name; see the file comment. Labels whose dot is off the canvas are left
 * out (the map can be panned to them).
 */
export function placeLabels(items: readonly LabelItem[], opts: LabelOptions): PlacedLabel[] {
  const { width, height, measure } = opts;
  const onCanvas = items.filter((i) => i.x >= 0 && i.y >= 0 && i.x <= width && i.y <= height);
  if (onCanvas.length === 0) return [];
  const centre = { x: onCanvas.reduce((a, i) => a + i.x, 0) / onCanvas.length, y: onCanvas.reduce((a, i) => a + i.y, 0) / onCanvas.length };
  const angle = (i: LabelItem): number => {
    // Clockwise from straight up, in [0, 2π).
    const a = Math.atan2(i.x - centre.x, centre.y - i.y);
    return a < 0 ? a + 2 * Math.PI : a;
  };
  const first = opts.first ?? [];
  const rank = (i: LabelItem): number => {
    const at = first.indexOf(i.id);
    return at < 0 ? first.length : at;
  };
  // Places straight left, right, above or below the middle have one good side, so they choose
  // first; diagonal ones, which can go either way, last; ties clockwise from the top.
  const straightness = (i: LabelItem): number => {
    const len = Math.hypot(i.x - centre.x, i.y - centre.y);
    return len < 1 ? 0 : Math.round(Math.abs(Math.abs(i.x - centre.x) / len - Math.SQRT1_2) * 10);
  };
  const order = [...onCanvas].sort((a, b) => rank(a) - rank(b) || straightness(b) - straightness(a) || angle(a) - angle(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const dots: { id: string; box: Box }[] = items.map((i) => ({ id: i.id, box: { x: i.x - i.r - 1, y: i.y - i.r - 1, w: 2 * i.r + 2, h: 2 * i.r + 2 } }));
  const avoid = opts.avoid ?? [];
  const placed: PlacedLabel[] = [];
  const reach = Math.min(MAX_REACH, Math.max(width, height) / 2);

  const free = (box: Box, id: string, leader: PlacedLabel["leader"]): boolean => {
    if (!inside(box, width, height)) return false;
    if (avoid.some((b) => overlaps(box, b))) return false;
    if (dots.some((d) => overlaps(box, d.box, GAP))) return false;
    if (placed.some((l) => overlaps(box, l.box, GAP) || (l.leader !== null && segmentHits(l.leader.from, l.leader.to, box)))) return false;
    if (leader) {
      if (placed.some((l) => segmentHits(leader.from, leader.to, l.box))) return false;
      if (dots.some((d) => d.id !== id && segmentHits(leader.from, leader.to, d.box))) return false;
    }
    return true;
  };

  for (const item of order) {
    const dx = item.x - centre.x;
    const dy = item.y - centre.y;
    const len = Math.hypot(dx, dy);
    const dir = len < 1 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
    const spots = spotsFor(sidesFor(dir), reach);
    // A place at a side keeps its label on its own half of the map, so no leader crosses the middle.
    const half = Math.abs(dir.x) >= 0.45 ? Math.sign(dir.x) : 0;
    const ownHalf = (box: Box): boolean => (half > 0 ? box.x >= centre.x + HALF_GAP : half < 0 ? box.x + box.w <= centre.x - HALF_GAP : true);
    const full = item.text;
    const fullWidth = measure(full);
    const one = (texts: readonly string[]): string[][] => texts.map((t) => [t]);
    const shortened = (maxima: readonly number[]): string[][] => {
      const out: string[][] = [];
      for (const max of maxima) {
        if (max >= fullWidth) continue;
        const s = shorten(full, max, measure);
        if (s && !out.some((o) => o[0] === s)) out.push([s]);
      }
      return out;
    };
    const wrapped = (maxima: readonly number[]): string[][] => {
      const out: string[][] = [];
      for (const max of maxima) {
        if (max >= fullWidth) continue;
        const w = wrapTwo(full, max, measure);
        if (w && !out.some((o) => o.join("\n") === w.join("\n"))) out.push(w);
      }
      return out;
    };
    // Prefer, in turn: the full name close by; the name on two lines close by; most of the name
    // close by; the full name a little further out; two lines, or a shorter name, a little further
    // out; and as a last resort anything, anywhere.
    const tiers: [string[][], number, boolean][] = [
      [one([full]), NEAR, true],
      [wrapped(READABLE), NEAR, true],
      [shortened(READABLE), NEAR, true],
      [one([full]), FAR, true],
      [[...wrapped(SHORTER), ...shortened(SHORTER)], FAR, true],
      [[[full], ...wrapped(SHORTER), ...shortened(SHORTER)], Infinity, false],
    ];
    let done: PlacedLabel | null = null;
    search: for (const [variants, limit, keepHalf] of tiers) {
      for (const lines of variants) {
        const w = Math.max(...lines.map((l) => measure(l))) + 2 * LABEL_PAD;
        const h = lines.length === 1 ? LABEL_HEIGHT : LABEL_HEIGHT + LINE * (lines.length - 1);
        for (const spot of spots) {
          if (spot.cost > limit) break;
          const box = spotBox(item, item.r, spot, w, h);
          if (keepHalf && !ownHalf(box)) continue;
          const to = nearest(box, item);
          const gap = Math.hypot(to.x - item.x, to.y - item.y);
          const leader = gap > item.r + GAP + 2 ? { from: { x: item.x + ((to.x - item.x) / gap) * item.r, y: item.y + ((to.y - item.y) / gap) * item.r }, to } : null;
          if (free(box, item.id, leader)) {
            done = { id: item.id, lines, full, box, leader };
            break search;
          }
        }
      }
    }
    if (done) placed.push(done);
  }
  return placed;
}

/** The label under a screen point, its tap area at least 40 px tall; the nearest wins. */
export function labelAt(labels: readonly PlacedLabel[], p: Point): PlacedLabel | null {
  let best: PlacedLabel | null = null;
  let bestDistance = Infinity;
  for (const l of labels) {
    const grow = Math.max(0, (40 - l.box.h) / 2);
    const area = { x: l.box.x - 4, y: l.box.y - grow, w: l.box.w + 8, h: l.box.h + 2 * grow };
    if (p.x < area.x || p.x > area.x + area.w || p.y < area.y || p.y > area.y + area.h) continue;
    const distance = Math.abs(p.y - (l.box.y + l.box.h / 2));
    if (distance < bestDistance) {
      best = l;
      bestDistance = distance;
    }
  }
  return best;
}
