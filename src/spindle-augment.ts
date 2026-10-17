// The one local augmentation of `lumiverse-spindle-types` 0.6.49 (DESIGN §3, §18.6).
// The host runtime differs from the published types in these places; code uses these types
// at the host boundary instead of the published ones. Type-only module: import it with
// `import type`.
//
// Host sources: frontend/src/lib/spindle/dom-decorator-service.ts:62-83,
// frontend/src/lib/spindle/frontend-context.ts:25-78, src/spindle/worker-runtime.ts:730.

import type { SpindleFloatWidgetHandle, SpindleFloatWidgetOptions, SpindleFrontendContext } from "lumiverse-spindle-types";

export interface DecoratorRenderContext {
  mount: string;
  scope: string;
  liveAnchorId: string;
  owner: string;
  generation: number;
  node: Element;
  root: HTMLElement;
}

/**
 * `ctx.ui.registerDomDecorator` options. Never set `instanceKey`: the host matches it against
 * the anchor's own instance key, so a decorator that sets it renders nowhere (DESIGN §18.7).
 */
export interface DomDecoratorOptions {
  mount: string;
  render?: (root: HTMLElement, ctx: DecoratorRenderContext) => void | (() => void);
  update?: (root: HTMLElement, ctx: DecoratorRenderContext) => void;
  priority?: number;
  kind?: "html" | "svg";
  html?: string;
  svg?: string;
}

export type GeometryHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface GeometryRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GeometryBounds {
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ResizeOptions {
  handles?: readonly GeometryHandle[];
  bounds?: GeometryBounds;
  aspectLock?: number;
  snap?: { edges?: boolean; threshold?: number };
  onChange?(rect: GeometryRect): void;
  onCommit?(rect: GeometryRect): void;
}

export interface HostGeometry {
  getUiScale(): number;
  toLayoutPx(renderedPx: number): number;
  layoutViewportSize(): { width: number; height: number };
  layoutElementRect(el: Element): GeometryRect;
  createResizeController(el: HTMLElement, opts: ResizeOptions): () => void;
}

export type FloatWidgetOptions = SpindleFloatWidgetOptions & {
  resizable?: boolean;
  bounds?: GeometryBounds;
  aspectLock?: boolean | number;
  persistGeometry?: string | false;
  mobileClamp?: boolean;
  onGeometryCommit?(rect: GeometryRect): void;
};

/** The host's `ctx.ui` as it exists at runtime. */
export type HostUi = Omit<SpindleFrontendContext["ui"], "createFloatWidget"> & {
  registerDomDecorator(options: DomDecoratorOptions): () => void;
  geometry: HostGeometry;
  createFloatWidget(options?: FloatWidgetOptions): SpindleFloatWidgetHandle;
};

/** `spindle.world_books.entries.setExtension` (permission `world_books`). */
export interface EntryExtensionApi {
  setExtension(entryId: string, namespace: string, value: unknown | null, userId?: string): Promise<void>;
}
