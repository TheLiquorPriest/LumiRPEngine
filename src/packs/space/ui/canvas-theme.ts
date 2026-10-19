// The canvas palette (contract §5.1): map and grid drawings take their colours from the
// `--lre-canvas-*` and `--lre-series-*` tokens at draw time, so a canvas follows the host theme in
// light and dark like the rest of the UI, and redraws when the host switches theme (the host sets
// its variables, and its theme class, on <html>).

import { useEffect, useState } from "preact/hooks";

export interface CanvasPalette {
  /** The drawing's ground, over the element's own (opaque) background. */
  bg: string;
  /** Names, dots, walls: the strongest marks. */
  ink: string;
  muted: string;
  /** Grid lines and frames. */
  line: string;
  /** The POV: its dot and its place's ring. */
  pov: string;
  /** What the POV hasn't seen. */
  fog: string;
  /** Things lying in cells, and the selection. */
  item: string;
  /** The categorical fills `--lre-series-1` to `-6`, for areas and kinds. */
  series: readonly string[];
  /** The UI's font family, for names drawn on the canvas. */
  font: string;
}

const TOKENS = { bg: "--lre-canvas-bg", ink: "--lre-canvas-ink", muted: "--lre-canvas-muted", line: "--lre-canvas-line", pov: "--lre-canvas-pov", fog: "--lre-canvas-fog", item: "--lre-canvas-item" } as const;
const SERIES = [1, 2, 3, 4, 5, 6].map((n) => `--lre-series-${n}`);

let scratch: CanvasRenderingContext2D | null | undefined;

/** Whether a 2D context takes `value` as a colour: an unparsable one leaves the previous colour in place. */
function accepts(g: CanvasRenderingContext2D, value: string): boolean {
  if (value === "") return false;
  g.fillStyle = "#000";
  g.fillStyle = value;
  const a = g.fillStyle;
  g.fillStyle = "#fff";
  g.fillStyle = value;
  return a === g.fillStyle;
}

/** `color(srgb r g b / a)`, the form computed colour-mixes take, as `rgba()`, which every canvas reads. */
function srgbToRgba(value: string): string | null {
  const m = /^color\(srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)(?:\s*\/\s*([\d.e+-]+%?))?\s*\)$/i.exec(value.trim());
  if (!m) return null;
  const channel = (s: string | undefined): number => Math.round(Math.min(1, Math.max(0, Number(s))) * 255);
  const alphaText = m[4] ?? "1";
  const alpha = alphaText.endsWith("%") ? Number(alphaText.slice(0, -1)) / 100 : Number(alphaText);
  return `rgba(${channel(m[1])}, ${channel(m[2])}, ${channel(m[3])}, ${Number.isFinite(alpha) ? alpha : 1})`;
}

/**
 * A token's value in a form the canvas draws with: as the token computes when the canvas reads it
 * (custom properties compute with their `var()`s substituted); else as an element's computed
 * colour, which resolves `color-mix()` for a canvas that doesn't; else `fallback`.
 */
function usable(value: string, fallback: string): string {
  if (scratch === undefined) scratch = document.createElement("canvas").getContext("2d");
  const g = scratch;
  if (!g) return value || fallback;
  if (accepts(g, value)) return value;
  if (value !== "") {
    const probe = document.createElement("span");
    probe.style.color = value;
    if (probe.style.color !== "") {
      probe.hidden = true;
      document.body.appendChild(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      if (accepts(g, computed)) return computed;
      const rgba = srgbToRgba(computed);
      if (rgba && accepts(g, rgba)) return rgba;
    }
  }
  return fallback;
}

let version = 0;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

// One palette per element per theme, while the theme is watched: drawing runs on every pan frame,
// the tokens change only with the theme.
const cache = new WeakMap<Element, { version: number; palette: CanvasPalette }>();

/** The canvas palette as the tokens compute at `el` (a canvas inside a `.lre` root). */
export function canvasPalette(el: Element): CanvasPalette {
  const hit = observer ? cache.get(el) : undefined;
  if (hit && hit.version === version) return hit.palette;
  const style = getComputedStyle(el);
  const read = (name: string, fallback: string): string => usable(style.getPropertyValue(name).trim(), fallback);
  // With no tokens at all (outside a `.lre` root) marks fall back to the element's text colour.
  const palette: CanvasPalette = {
    bg: read(TOKENS.bg, "transparent"),
    ink: read(TOKENS.ink, "currentcolor"),
    muted: read(TOKENS.muted, "currentcolor"),
    line: read(TOKENS.line, "currentcolor"),
    pov: read(TOKENS.pov, "currentcolor"),
    fog: read(TOKENS.fog, "transparent"),
    item: read(TOKENS.item, "currentcolor"),
    series: SERIES.map((name) => read(name, "currentcolor")),
    font: style.fontFamily || "system-ui, sans-serif",
  };
  cache.set(el, { version, palette });
  return palette;
}

/** Calls `onChange` whenever the host's theme may have changed (`style` or `class` on <html>); returns the unsubscribe. */
export function watchTheme(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!observer && typeof MutationObserver !== "undefined") {
    // The theme may have changed while nothing watched: palettes read before then are stale.
    version += 1;
    observer = new MutationObserver(() => {
      version += 1;
      for (const listener of [...listeners]) listener();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

/** A number that changes with the host theme: put it in a drawing effect's dependencies to redraw. */
export function useThemeVersion(): number {
  const [seen, setSeen] = useState(version);
  useEffect(() => watchTheme(() => setSeen(version)), []);
  return seen;
}
