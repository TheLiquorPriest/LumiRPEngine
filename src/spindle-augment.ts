// The one local augmentation of `lumiverse-spindle-types` 0.6.49 (DESIGN §3, §18.6).
// The host runtime differs from the published types in these places; code uses these types
// at the host boundary instead of the published ones. Type-only module: import it with
// `import type`.
//
// Host sources: frontend/src/lib/spindle/dom-decorator-service.ts:62-83,
// frontend/src/lib/spindle/frontend-context.ts:25-78; for the backend's `spindle`,
// src/services/regex-scripts.service.ts (validateInput, rowToRegexScript).

import type { RegexScriptCreateDTO, RegexScriptDTO, RegexScriptListOptionsDTO, RegexTargetDTO, SpindleAPI, SpindleFloatWidgetHandle, SpindleFloatWidgetOptions, SpindleFrontendContext } from "lumiverse-spindle-types";

/** A regex script's `target` is a list on the host, so one script can bake a reply and render it; a single target reads as a list of one. */
export type RegexScriptInput = Omit<RegexScriptCreateDTO, "target"> & { target?: RegexTargetDTO[] };

export type RegexScriptRow = Omit<RegexScriptDTO, "target"> & { target: RegexTargetDTO | RegexTargetDTO[] };

/** The backend's `spindle` global as the host runs it. */
export type HostSpindleAPI = Omit<SpindleAPI, "regex_scripts"> & {
  regex_scripts: Omit<SpindleAPI["regex_scripts"], "list" | "create" | "update"> & {
    list(options?: RegexScriptListOptionsDTO): Promise<{ data: RegexScriptRow[]; total: number }>;
    create(input: RegexScriptInput, userId?: string): Promise<RegexScriptRow>;
    update(scriptId: string, input: RegexScriptInput, userId?: string): Promise<RegexScriptRow>;
  };
};

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
