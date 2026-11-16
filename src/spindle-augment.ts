// The one local augmentation of `lumiverse-spindle-types` 0.6.80, the version Lumiverse pins (DESIGN §3, §18.6).
// The host runtime differs from the published types in these places; code uses these types
// at the host boundary instead of the published ones. Type-only module: import it with
// `import type`. What 0.6.80 types as the host runs it is not here.
//
// Host sources: frontend/src/lib/spindle/loader.ts (`FrontendExtensionUI`: `registerDomDecorator` under
// `ctx.ui`, returning its remover), dom-decorator-service.ts (`DecoratorOptions`), geometry-api.ts
// (`ctx.ui.geometry`, which 0.6.80 types with another shape), frontend-context.ts (`FrontendFloatWidgetOptions`);
// for the backend's `spindle`, src/services/regex-scripts.service.ts (validateInput, rowToRegexScript),
// src/services/world-books.service.ts (updateEntry, buildStoredEntryExtensions) and
// src/services/preset-operations.ts (`prompt_order` stored as given).

import type { PromptBlockSnapshotDTO, RegexScriptCreateDTO, RegexScriptDTO, RegexScriptListOptionsDTO, RegexTargetDTO, SpindleAPI, SpindleFloatWidgetHandle, SpindleFloatWidgetOptions, SpindleFrontendContext, UserPresetDTO, UserPresetUpdateDTO, WorldBookEntryDTO, WorldBookEntryUpdateDTO } from "lumiverse-spindle-types";

/** A regex script's `target` is a list on the host, so one script can bake a reply and render it; a single target reads as a list of one. */
export type RegexScriptInput = Omit<RegexScriptCreateDTO, "target"> & { target?: RegexTargetDTO[] };

export type RegexScriptRow = Omit<RegexScriptDTO, "target"> & { target: RegexTargetDTO | RegexTargetDTO[] };

/**
 * An entry update keeps the entry's outlet unless it names one: `outlet_name` beside the other fields
 * sets it, and null clears it (an `outlet_name` inside `extensions` counts only when an entry is created).
 */
export type WorldBookEntryWrite = WorldBookEntryUpdateDTO & { outlet_name?: string | null };

/** The backend's `spindle` global as the host runs it. */
export type HostSpindleAPI = Omit<SpindleAPI, "regex_scripts" | "world_books" | "presets"> & {
  regex_scripts: Omit<SpindleAPI["regex_scripts"], "list" | "create" | "update"> & {
    list(options?: RegexScriptListOptionsDTO): Promise<{ data: RegexScriptRow[]; total: number }>;
    create(input: RegexScriptInput, userId?: string): Promise<RegexScriptRow>;
    update(scriptId: string, input: RegexScriptInput, userId?: string): Promise<RegexScriptRow>;
  };
  world_books: Omit<SpindleAPI["world_books"], "entries"> & {
    entries: Omit<SpindleAPI["world_books"]["entries"], "update"> & {
      update(entryId: string, input: WorldBookEntryWrite, userId?: string): Promise<WorldBookEntryDTO>;
    };
  };
  presets: Omit<SpindleAPI["presets"], "update"> & {
    /** The host stores `prompt_order` as given (src/services/preset-operations.ts), so a stored block keeps its sealed fields. */
    update(presetId: string, input: Omit<UserPresetUpdateDTO, "prompt_order"> & { prompt_order?: PromptBlockSnapshotDTO[] }, userId?: string): Promise<UserPresetDTO>;
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

/** The host's `ctx.ui` as it exists at runtime: the host serves `geometry` on every context, in its own shape. */
export type HostUi = Omit<SpindleFrontendContext["ui"], "createFloatWidget" | "geometry"> & {
  registerDomDecorator(options: DomDecoratorOptions): () => void;
  geometry: HostGeometry;
  createFloatWidget(options?: FloatWidgetOptions): SpindleFloatWidgetHandle;
};
