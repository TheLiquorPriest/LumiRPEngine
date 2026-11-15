// The stand-in Lumiverse's page: one browser tab of a signed-in user, with one extension's frontend
// loaded in it as Lumiverse's loader loads one. Modelled on Lumiverse's source (staging at a70f4ed2;
// paths are its `frontend/src/`, or its `src/` where a path begins so), with the file and line beside
// each part.
//
// The page is a document of its own (the tests' small DOM, `test/ui/kept/dom.ts`): the drawer and its
// tabs, the open chat with the hosts Lumiverse's message components render for each message, the float
// widgets and dock panels, and the stylesheets the extension added. Its socket is the one
// `LumiverseServer.page()` keeps for it, so what the frontend sends its backend, and hears back, goes
// through the stand-in's receive queue like any page's. Its reads carry the session it signed in with.
//
// A test loads a frontend module (`load`), does what the user does (opens a chat or a drawer tab, drags
// a float widget, presses a composer action, lets a widget's script post), and reads back what the
// module put on the page. The module's `ctx` is Lumiverse's for these members:
// - `setup(ctx)` run once the extension's grants are read, its cleanup at unload in Lumiverse's order,
//   `ready` and `deferReady`, and what the backend says before the frontend is ready held for it
//   (`lib/spindle/loader.ts:960-971`, `:1181-1184`, `:1480-1498`, `:2405-2451`, `:2525-2569`, `:440-578`;
//   `lib/spindle/frontend-extension-cleanup.ts:18-128`);
// - `frontendSessionId`, `sendToBackend` and `onBackendMessage`, over the page's socket (`loader.ts:2059-2075`);
// - `ui.registerDrawerTab`, needing no permission (`loader.ts:1552-1555`; `lib/spindle/placement-helper.ts:409-508`);
// - `messages.renderWidget`, `removeWidget` and the message ids (`loader.ts:2096-2138`;
//   `lib/spindle/message-widgets.tsx`; `lib/spindle/sandbox-frame.ts:108-195`);
// - `ui.registerDomDecorator`, on the hosts the page's messages carry (`loader.ts:1350-1395`, `:1628-1635`;
//   `lib/spindle/dom-decorator-service.ts:347-836`);
// - `dom`, without `createSandboxFrame` (`lib/spindle/dom-helper.ts:37-281`);
// - `ui.createFloatWidget` and `ui.requestDockPanel`, refused without `ui_panels` (`loader.ts:657-662`,
//   `:1576-1583`; `lib/spindle/frontend-authority-map.ts:237-238`; `placement-helper.ts:259-382`, `:944-1344`);
// - `ui.registerInputBarAction`, needing no permission (`loader.ts:1605-1608`; `placement-helper.ts:1414-1504`),
//   pressed as the composer's menu presses it (`components/chat/InputBarExtensionActions.tsx:20-37`);
// - `getActiveChat`, `state.get` and `state.subscribe` for `chat.active` and `chat.messageCount`
//   (`loader.ts:2051-2058`; `lib/spindle/state-selectors.ts:171-188`, `:378-427`), `onTeardown`
//   (`loader.ts:1189-1206`) and `manifest`.
// No other member of Lumiverse's context is on the page: a module that calls one fails as it would on a
// host without it.
//
// Its own, because it cannot copy them: markup is kept as given, where Lumiverse sanitizes it (DOMPurify,
// `dom-helper.ts:65-79`; `sanitizeRichHtml`, `dom-decorator-service.ts:297-345`); a widget's frame holds
// the widget's html and runs no script, and what its script would post is played by `widgetSays`
// (`sandbox-frame.ts:28-106`); work Lumiverse puts off to the next animation frame runs a moment later on
// the test's clock, or at once by `frame()` (`dom-decorator-service.ts:626-649`, `:841-844`); selectors
// are read as the tests' DOM reads them; the UI scale is 1; the extension's grants are read from it as
// installed, where Lumiverse's page asks `GET /api/v1/spindle/:id/permissions` (`loader.ts:1977-1983`;
// `src/routes/spindle.routes.ts:451-460`), which the stand-in's server does not serve; and the page shows
// the chat as it was when the test last opened or refreshed it, since the page's socket brings it nothing
// but its extension's messages, where Lumiverse's page follows the socket's events.

import type {
  SpindleDockPanelHandle,
  SpindleDockPanelOptions,
  SpindleDrawerTabHandle,
  SpindleDrawerTabOptions,
  SpindleFloatWidgetHandle,
  SpindleFloatWidgetOptions,
  SpindleFrontendContext,
  SpindleInputBarActionHandle,
  SpindleInputBarActionOptions,
  SpindleMessageWidgetOptions,
} from "lumiverse-spindle-types";
import type { PageChannel } from "../../src/ext/page";
import { PageWindow, type PageDocument, type PageElement } from "../ui/kept/dom";
import type { LumiverseServer } from "./http";
import type { ServerSocket } from "./sockets";

/** `MAX_PENDING_STARTUP_ITEMS` (`loader.ts:440`): what waits for a frontend not ready yet; past it the oldest go. */
const STARTUP_ITEMS_MAX = 100;
/** `FRONTEND_READY_TIMEOUT_MS` (`loader.ts:441`): a frontend that put its readiness off is made ready after this long. */
const READY_TIMEOUT_MS = 10_000;
/** A widget's frame keeps between these heights unless it names its own (`message-widgets.tsx:127-128`; `sandbox-frame.ts:116-118`). */
const WIDGET_MIN_HEIGHT = 40;
const WIDGET_MAX_HEIGHT = 4000;
/** A float widget's size when it names none, and its gap from the viewport's corner (`placement-helper.ts:962-968`). */
const FLOAT_SIZE = 48;
const FLOAT_MARGIN = 16;
/** A dock panel's least and greatest size when it names none (`placement-helper.ts:1205-1206`). */
const DOCK_MIN = 200;
const DOCK_MAX = 600;
/** The viewport when the window gives no size (`placement-helper.ts:259-267`). */
const VIEWPORT_FALLBACK = { width: 1440, height: 900 };
/** `PERSISTENT_GEOMETRY_KEY_PATTERN` (`store/slices/spindle-placement.ts:233`). */
const GEOMETRY_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** `EXTENSION_IDENTIFIER_PATTERN` (`lib/spindle/extension-root-stamp.ts:11`). */
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
/** A frontend session id: 16 random bytes in hex (`lib/frontend-session.ts:1-4`; `src/spindle/frontend-session.ts:1-5`). */
const SESSION = /^[0-9a-f]{32}$/;
/** What only the host writes on an extension's roots (`extension-root-stamp.ts:43-48`). */
const ROOT_ATTRIBUTES: Record<string, true> = { "data-spindle-ext": true, "data-spindle-extension-root": true, "data-spindle-extension-id": true, "data-spindle-ext-id": true };
/** What `ctx.dom.createElement` refuses (`dom-helper.ts:26`, `:168-170`). */
const FORBIDDEN_TAGS: Record<string, true> = { iframe: true, frame: true, object: true, embed: true };
/** `PLACEMENT_DESTROYED_ERROR` (`placement-helper.ts:127`). */
const PLACEMENT_DESTROYED = "PLACEMENT_DESTROYED: Placement handle has been destroyed";
/** `assertFrontendActive`'s refusal (`loader.ts:654`). */
const INACTIVE = "SPINDLE_FRONTEND_INACTIVE: extension frontend generation is no longer active";

/** A frontend module as Lumiverse imports one: its `setup`, and a `teardown` it may export besides (`loader.ts:259-266`, `:2372`). */
export interface FrontendModule {
  setup?(ctx: SpindleFrontendContext): unknown;
  teardown?(): void | Promise<void>;
}

/** The installed extension whose frontend the page loads: Lumiverse's id for it, and what it is granted. */
export interface PageExtension {
  id: string;
  permissions: { getGranted(): Promise<readonly string[]> };
}

/** The extension's manifest, as Lumiverse hands it to the frontend (`loader.ts:2192`). */
export interface PageManifest {
  identifier: string;
  name: string;
  [field: string]: unknown;
}

export interface PageOptions {
  server: LumiverseServer;
  /** The user's account: the page signs in with it, as the browser did, and its reads carry that session. */
  signIn: { username: string; password: string };
  extension: PageExtension;
  manifest: PageManifest;
  /** Its frontend session; made as Lumiverse makes one when not given. */
  session?: string;
  /** Its window; a test that draws into the page with the browser's globals set gives that page's window. */
  window?: PageWindow;
}

export interface GeometryRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GeometryBounds {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

/** `ctx.ui.createFloatWidget`'s options as Lumiverse takes them (`lib/spindle/frontend-context.ts:60-68`). */
export type FloatWidgetOptions = SpindleFloatWidgetOptions & {
  resizable?: boolean;
  bounds?: GeometryBounds;
  aspectLock?: boolean | number;
  persistGeometry?: string | false;
  mobileClamp?: boolean;
  onGeometryCommit?(rect: GeometryRect): void;
};

/** `ctx.ui.requestDockPanel`'s options as Lumiverse takes them (`frontend-context.ts:70-80`). */
export type DockPanelOptions = SpindleDockPanelOptions & {
  persistGeometry?: string | false;
  respectRequestedEdge?: boolean;
  showCollapsedTitle?: boolean;
  onGeometryCommit?(rect: GeometryRect): void;
};

/** What a decorator's `render` and `update` are given (`dom-decorator-service.ts:62-70`). */
export interface DecoratorRenderContext {
  mount: string;
  scope: string;
  liveAnchorId: string;
  owner: string;
  generation: number;
  node: Element;
  root: HTMLElement;
}

/** `ctx.ui.registerDomDecorator`'s options: Lumiverse's own, under `ui`, where the published types put the member elsewhere (`dom-decorator-service.ts:72-83`; `loader.ts:337`). */
export interface DecoratorOptions {
  mount: string;
  render?: (root: HTMLElement, ctx: DecoratorRenderContext) => void | (() => void);
  update?: (root: HTMLElement, ctx: DecoratorRenderContext) => void;
  priority?: number;
  instanceKey?: string;
  kind?: "html" | "svg" | "badge" | "button" | "context-action";
  html?: string;
  svg?: string;
}

/** The members of Lumiverse's frontend context the page offers, each as Lumiverse shapes it. */
export interface PageContext {
  readonly frontendSessionId: string;
  readonly manifest: PageManifest;
  sendToBackend(payload: unknown): void;
  onBackendMessage(handler: (payload: unknown) => void): () => void;
  ready(): void;
  deferReady(): void;
  onTeardown(handler: () => void): () => void;
  getActiveChat(): { chatId: string | null; characterId: string | null };
  state: {
    get<T = unknown>(id: string): T;
    subscribe<T = unknown>(id: string, handler: (value: T) => void): () => void;
  };
  ui: {
    registerDrawerTab(options: SpindleDrawerTabOptions): SpindleDrawerTabHandle;
    registerDomDecorator(options: DecoratorOptions): () => void;
    createFloatWidget(options?: FloatWidgetOptions): SpindleFloatWidgetHandle;
    requestDockPanel(options: DockPanelOptions): SpindleDockPanelHandle;
    registerInputBarAction(options: SpindleInputBarActionOptions): SpindleInputBarActionHandle;
  };
  messages: {
    renderWidget(options: SpindleMessageWidgetOptions, handler?: (payload: unknown) => void): () => void;
    removeWidget(messageId: string, widgetId: string): void;
    getLatestMessageId(): string | null;
    getMessageIdAtIndex(index: number): string | null;
    listMessageIds(): string[];
  };
  dom: {
    inject(target: string | Element, html: string, position?: InsertPosition): Element;
    uninject(element: Element): void;
    addStyle(css: string, options?: { scope?: "global" | "root" }): () => void;
    createElement(tag: string, attrs?: Record<string, string>): HTMLElement;
    query(selector: string): Element | null;
    queryAll(selector: string): Element[];
    getMessageId(target: Element): string | null;
    findMessageElement(messageId: string): Element | null;
    listMessageElements(): { messageId: string; element: Element }[];
    cleanup(): void;
  };
}

/** A tab in the drawer, as Lumiverse's store holds it (`placement-helper.ts:450-469`). */
export interface DrawerTab {
  tabId: string;
  contributionId: string;
  title: string;
  shortName?: string;
  description?: string;
  keywords?: string[];
  headerTitle?: string;
  iconUrl?: string;
  iconSvg?: string;
  badge: string | null;
  root: PageElement;
}

/** A float widget, as Lumiverse's store holds it (`placement-helper.ts:1059-1081`). */
export interface FloatWidget extends GeometryRect {
  widgetId: string;
  root: PageElement;
  visible: boolean;
  fullscreen: boolean;
  resizable: boolean;
  snapToEdge: boolean;
  mobileClamp: boolean;
  tooltip?: string;
  chromeless?: boolean;
}

/** A dock panel, as Lumiverse's store holds it (`placement-helper.ts:1266-1283`). */
export interface DockPanel {
  panelId: string;
  root: PageElement;
  edge: string;
  title: string;
  size: number;
  minSize: number;
  maxSize: number;
  resizable: boolean;
  collapsed: boolean;
  chromeless: boolean;
  centerContent: boolean;
  iconUrl?: string;
}

/** An action in the composer's menu of extension actions (`placement-helper.ts:1451-1472`; `InputBarExtensionActions.tsx:24-29`). */
export interface InputBarAction {
  actionId: string;
  contributionId: string;
  extensionName: string;
  label: string;
  subtitle?: string;
  iconSvg?: string;
  iconUrl?: string;
}

/** A widget as it stands under a message: its html, the heights its frame keeps between, and the frame. */
export interface Widget {
  widgetId: string;
  html: string;
  minHeight: number;
  maxHeight: number;
  frame: PageElement;
}

interface Placement {
  generation: number;
  dispose(): void;
}

interface DrawerTabRecord extends DrawerTab {
  activated: Set<() => void>;
}

interface FloatWidgetRecord extends FloatWidget {
  preFullscreen?: GeometryRect;
  dragEnd: Set<(pos: { x: number; y: number }) => void>;
  commit(rect: GeometryRect): GeometryRect;
}

interface InputBarActionRecord extends InputBarAction {
  enabled: boolean;
  clicks: Set<() => void>;
}

interface WidgetRecord extends SpindleMessageWidgetOptions {
  onMessage?: (payload: unknown) => void;
}

interface ShownWidget {
  host: PageElement;
  frame: PageElement | null;
  record: WidgetRecord | null;
}

interface ChatMessage {
  id: string;
  content: string;
}

interface OpenChat {
  id: string;
  characterId: string | null;
  avatarId: string | null;
  messages: ChatMessage[];
}

interface Bubble {
  element: PageElement;
  content: PageElement;
  text: PageElement;
}

/** One load of the extension's frontend: Lumiverse's `LoadedExtension` and what its context closes over (`loader.ts:272-295`). */
interface Loaded {
  generation: number;
  ctx: PageContext;
  granted: readonly string[];
  /** `frontendLifecycleActive` (`loader.ts:645`). */
  active: boolean;
  ready: boolean;
  holdReady: boolean;
  setupComplete: boolean;
  readyTimer: unknown;
  teardown: (() => void) | undefined;
  teardownClaimed: boolean;
  staleTeardowns: Set<() => void>;
  backendHandlers: Set<(payload: unknown) => void>;
  /** `eventUnsubs` (`loader.ts:681-693`). */
  subscriptions: (() => void)[];
  /** `registeredDecoratorAnchors` and `mountSyncActive` (`loader.ts:1350-1351`). */
  anchors: Set<PageElement>;
  mountSync: boolean;
  channels: Map<string, { listeners: Set<(value: unknown) => void>; last: unknown }>;
  stateDisposed: boolean;
  /** What `ctx.dom` made and keeps for its cleanup (`dom-helper.ts:45-48`). */
  made: Set<PageElement>;
  styles: Set<() => void>;
  cleaned: boolean;
}

const words = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const finiteOr = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const positive = (value: unknown, fallback = 0): number => Math.max(0, finiteOr(value, fallback));

interface Resolved {
  region: GeometryRect;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

/** `resolveGeometryBounds` (`placement-helper.ts:319-342`). */
function resolveBounds(region: GeometryRect, bounds?: GeometryBounds): Resolved {
  const minWidth = Math.max(1, finiteOr(bounds?.minWidth, 1));
  const minHeight = Math.max(1, finiteOr(bounds?.minHeight, 1));
  const maxWidth = Math.min(region.width, Math.max(minWidth, finiteOr(bounds?.maxWidth, region.width)));
  const maxHeight = Math.min(region.height, Math.max(minHeight, finiteOr(bounds?.maxHeight, region.height)));
  return { region, minWidth: Math.min(minWidth, maxWidth), minHeight: Math.min(minHeight, maxHeight), maxWidth, maxHeight };
}

/** `normalizeAspectLock` (`placement-helper.ts:305-308`). */
function normalizeAspectLock(value: boolean | number | undefined): boolean | number | undefined {
  if (value === true || value === false) return value;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** `clampGeometryRect` with `clampLayoutRect` (`placement-helper.ts:344-382`; `lib/spindle/zoom-layer-geometry.ts:99-114`). */
function clampRect(rect: GeometryRect, resolved: Resolved, aspectLock?: boolean | number): GeometryRect {
  let width = Math.min(Math.max(finiteOr(rect.width, resolved.minWidth), resolved.minWidth), resolved.maxWidth);
  let height = Math.min(Math.max(finiteOr(rect.height, resolved.minHeight), resolved.minHeight), resolved.maxHeight);
  const ratio = typeof aspectLock === "number" ? aspectLock : aspectLock === true && height > 0 && Number.isFinite(width / height) ? width / height : undefined;
  if (ratio !== undefined) {
    width = Math.min(width, resolved.maxHeight * ratio);
    height = width / ratio;
    if (height < resolved.minHeight) {
      height = resolved.minHeight;
      width = height * ratio;
    }
    if (width > resolved.maxWidth) {
      width = resolved.maxWidth;
      height = width / ratio;
    }
    if (height > resolved.maxHeight) {
      height = resolved.maxHeight;
      width = height * ratio;
    }
    width = Math.min(Math.max(width, resolved.minWidth), resolved.maxWidth);
    height = Math.min(Math.max(height, resolved.minHeight), resolved.maxHeight);
  }
  const region = { x: finiteOr(resolved.region.x, 0), y: finiteOr(resolved.region.y, 0), width: positive(resolved.region.width), height: positive(resolved.region.height) };
  const minWidth = positive(resolved.minWidth);
  const minHeight = positive(resolved.minHeight);
  const w = Math.min(Math.max(positive(width), minWidth), Math.max(minWidth, region.width));
  const h = Math.min(Math.max(positive(height), minHeight), Math.max(minHeight, region.height));
  const x = finiteOr(rect.x, resolved.region.x);
  const y = finiteOr(rect.y, resolved.region.y);
  return {
    x: Math.min(Math.max(x, region.x), region.x + Math.max(0, region.width - w)),
    y: Math.min(Math.max(y, region.y), region.y + Math.max(0, region.height - h)),
    width: w,
    height: h,
  };
}

/** `clampDockSize` (`placement-helper.ts:402-405`). */
const clampDockSize = (value: unknown, min: number, max: number): number => Math.max(min, Math.min(Math.round(finiteOr(value, min)), max));

/** A widget frame's least and greatest height (`message-widgets.tsx:127-128`; `sandbox-frame.ts:116-118`, `:297-300`). */
function widgetHeights(record: WidgetRecord): { minHeight: number; maxHeight: number } {
  const clamp = (value: number, min: number, max: number): number => (Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : min);
  const minHeight = clamp(record.minHeight ?? WIDGET_MIN_HEIGHT, 1, WIDGET_MAX_HEIGHT);
  return { minHeight, maxHeight: clamp(record.maxHeight ?? WIDGET_MAX_HEIGHT, minHeight, WIDGET_MAX_HEIGHT) };
}

/** Where a decorator renders: a host of the page, as the loader registers each for the extension's load (`dom-decorator-service.ts:43-51`). */
interface Anchor {
  id: string;
  mount: string;
  scope: string;
  generation: number;
  node: PageElement;
}

interface DecoratorRecord {
  id: string;
  options: DecoratorOptions;
  generation: number;
  disposed: boolean;
}

interface DecoratorRoot {
  root: PageElement;
  generation: number;
  injected: Map<string, PageElement>;
  disposers: Map<string, () => void>;
}

interface DecoratorHost {
  readonly owner: string;
  mount(work: () => void): void;
  teardown(work: () => void): void;
  element(tag: string): PageElement;
  stamp(element: PageElement, attribute: string): void;
}

/** Lumiverse's DOM decorator service for the page's one extension (`dom-decorator-service.ts:347-836`). */
class Decorators {
  private readonly anchors = new Map<string, Anchor>();
  private readonly anchorIds = new Map<PageElement, string>();
  private readonly records = new Map<string, DecoratorRecord>();
  private readonly roots = new Map<string, DecoratorRoot>();
  private nextAnchor = 1;
  private nextDecorator = 1;

  constructor(private readonly host: DecoratorHost) {}

  /** `registerAnchor` (`:364-407`). */
  registerAnchor(mount: string, scope: string, generation: number, node: PageElement): void {
    const trimmed = scope.trim();
    const existingId = this.anchorIds.get(node);
    const existing = existingId === undefined ? undefined : this.anchors.get(existingId);
    if (existing !== undefined) {
      if (existing.mount === mount && existing.scope === trimmed && existing.generation === generation) {
        this.host.mount(() => this.mountAnchor(existing));
        return;
      }
      this.unregisterAnchor(existing.id);
    }
    const anchor: Anchor = { id: `live-anchor:${this.nextAnchor++}`, mount, scope: trimmed, generation, node };
    this.anchors.set(anchor.id, anchor);
    this.anchorIds.set(node, anchor.id);
    this.host.mount(() => this.mountAnchor(anchor));
  }

  /** `unregisterAnchor` (`:409-431`): its root goes at the next frame. */
  unregisterAnchor(nodeOrId: PageElement | string): void {
    const id = typeof nodeOrId === "string" ? nodeOrId : this.anchorIds.get(nodeOrId);
    const anchor = id === undefined ? undefined : this.anchors.get(id);
    if (anchor === undefined) return;
    this.anchors.delete(anchor.id);
    this.anchorIds.delete(anchor.node);
    this.host.teardown(() => this.teardownRoot(anchor.id));
  }

  /** `registerDecorator` (`:433-467`): one decorator per mount and instance key; registering again replaces its options. */
  register(options: DecoratorOptions, generation: number): () => void {
    if (!options.mount) throw new Error("SPINDLE_DECORATOR_MOUNT_REQUIRED");
    for (const existing of this.records.values()) {
      if (existing.disposed || existing.generation !== generation || existing.options.mount !== options.mount || existing.options.instanceKey !== options.instanceKey) continue;
      existing.options = options;
      this.host.mount(() => this.replay(options.mount, generation));
      return () => this.dispose(existing.id);
    }
    const record: DecoratorRecord = { id: `decorator:${this.nextDecorator++}:${generation}:${options.mount}:${options.instanceKey ?? ""}`, options, generation, disposed: false };
    this.records.set(record.id, record);
    this.host.mount(() => this.replay(options.mount, generation));
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.dispose(record.id);
    };
  }

  /** `unloadGeneration` (`:514-526`). */
  unload(generation: number): void {
    for (const anchor of [...this.anchors.values()]) if (anchor.generation === generation) this.unregisterAnchor(anchor.id);
    for (const record of [...this.records.values()]) if (record.generation === generation) this.dispose(record.id);
  }

  /** `hasDecorator`'s and `applyDecorators`'s match: an instance key matches only an anchor with that key, and the loader's anchors carry none (`:651-661`, `:707-716`). */
  private matching(anchor: Anchor): DecoratorRecord[] {
    return [...this.records.values()]
      .filter((d) => !d.disposed && d.generation === anchor.generation && d.options.mount === anchor.mount && d.options.instanceKey === undefined)
      .sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0));
  }

  /** `mountAnchor` and `ensureRoot` (`:663-705`). */
  private mountAnchor(anchor: Anchor): void {
    if (!this.anchors.has(anchor.id)) return;
    const matching = this.matching(anchor);
    if (matching.length === 0) return;
    let root = this.roots.get(anchor.id);
    if (root === undefined) {
      const element = this.host.element("div");
      this.host.stamp(element, "data-spindle-extension-root");
      element.setAttribute("data-spindle-mount-literal", anchor.mount);
      element.setAttribute("data-spindle-scope", anchor.scope);
      root = { root: element, generation: anchor.generation, injected: new Map(), disposers: new Map() };
      this.roots.set(anchor.id, root);
    }
    if (root.root.parentElement !== anchor.node) anchor.node.appendChild(root.root);
    for (const decorator of matching) this.apply(anchor, root, decorator);
  }

  /** `applyDecorator` and `writeInjected` (`:723-765`); `wrapKind` (`:312-333`). */
  private apply(anchor: Anchor, root: DecoratorRoot, decorator: DecoratorRecord): void {
    const element = root.root as unknown as HTMLElement;
    const ctx: DecoratorRenderContext = { mount: anchor.mount, scope: anchor.scope, liveAnchorId: anchor.id, owner: this.host.owner, generation: anchor.generation, node: anchor.node as unknown as Element, root: element };
    if (root.disposers.has(decorator.id) || root.injected.has(decorator.id)) {
      decorator.options.update?.(element, ctx);
      return;
    }
    const { kind, html, svg } = decorator.options;
    if (html || svg || kind) {
      const button = kind === "button" || kind === "context-action";
      const slot = this.host.element(kind === "badge" ? "span" : button ? "button" : "div");
      if (button) slot.setAttribute("type", "button");
      slot.setAttribute("data-spindle-decorator-kind", kind ?? "html");
      slot.setAttribute("data-spindle-injected", decorator.id);
      // Kept as given: Lumiverse sanitizes it and strips the host's ownership attributes (`:335-345`).
      const markup = html ?? svg ?? "";
      if (markup === "") slot.replaceChildren();
      else slot.innerHTML = markup;
      root.root.appendChild(slot);
      root.injected.set(decorator.id, slot);
    }
    const disposer = decorator.options.render?.(element, ctx);
    if (typeof disposer === "function") root.disposers.set(decorator.id, disposer);
  }

  /** `replayMatching` (`:767-773`). */
  private replay(mount: string, generation: number): void {
    for (const anchor of this.anchors.values()) if (anchor.mount === mount && anchor.generation === generation) this.mountAnchor(anchor);
  }

  /** `disposeDecorator` (`:775-800`): what it rendered goes at the next frame; the roots stay. */
  private dispose(id: string): void {
    const decorator = this.records.get(id);
    if (decorator === undefined || decorator.disposed) return;
    decorator.disposed = true;
    this.records.delete(id);
    this.host.teardown(() => {
      for (const root of this.roots.values()) {
        if (root.generation !== decorator.generation) continue;
        const disposer = root.disposers.get(id);
        if (disposer !== undefined) {
          try {
            disposer();
          } catch {
            // `:790`: a disposer's fault does not stop the others.
          }
          root.disposers.delete(id);
        }
        root.injected.get(id)?.remove();
        root.injected.delete(id);
      }
    });
  }

  /** `teardownRoot` (`:802-823`). */
  private teardownRoot(anchorId: string): void {
    const root = this.roots.get(anchorId);
    if (root === undefined) return;
    for (const disposer of root.disposers.values()) {
      try {
        disposer();
      } catch {
        // `:806`.
      }
    }
    root.disposers.clear();
    for (const slot of root.injected.values()) slot.remove();
    root.injected.clear();
    for (const attribute of Object.keys(ROOT_ATTRIBUTES)) root.root.removeAttribute(attribute);
    root.root.replaceChildren();
    root.root.remove();
    this.roots.delete(anchorId);
  }
}

/** A frontend session id as Lumiverse's page makes one (`lib/frontend-session.ts:1-4`). */
function newSession(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("");
}

/** The avatar `chat.active` names: the speaker's in a group chat, else the chat's own (`store/slices/chat.ts:179-189`). */
function avatarOf(metadata: unknown, characterId: string | null): string | null {
  const meta = typeof metadata === "object" && metadata !== null ? (metadata as Record<string, unknown>) : {};
  const groupAvatars = meta.group_active_avatar_ids;
  const groupAvatar = meta.group === true && characterId !== null && typeof groupAvatars === "object" && groupAvatars !== null ? (groupAvatars as Record<string, unknown>)[characterId] : undefined;
  if (typeof groupAvatar === "string") return groupAvatar;
  if (meta.group === true) return null;
  return typeof meta.active_avatar_id === "string" ? meta.active_avatar_id : null;
}

/** Signs in as the user, as the browser did before the page opened, and opens the page with its frontend session. */
export async function openPage(options: PageOptions): Promise<StandInPage> {
  const { server } = options;
  const session = options.session ?? newSession();
  if (!SESSION.test(session)) throw new Error(`a frontend session is 32 hex digits (lib/frontend-session.ts:1-4), not "${session}"`);
  const res = await server.fetch(`${server.base}/api/auth/sign-in/username`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(options.signIn) });
  const body = (await res.json()) as { token?: unknown; user?: { id?: unknown } } | null;
  if (res.status !== 200 || typeof body?.token !== "string" || typeof body.user?.id !== "string") throw new Error(`the page could not sign in as ${options.signIn.username}: ${res.status}`);
  return new StandInPage(options, session, body.user.id, body.token);
}

export class StandInPage {
  readonly window: PageWindow;
  readonly document: PageDocument;
  readonly session: string;
  /** The signed-in user whose page it is. */
  readonly user: string;
  readonly socket: ServerSocket;
  /** What Lumiverse writes to the browser's console about the extension: its warnings, and the errors it catches. */
  readonly logs: string[] = [];

  private readonly server: LumiverseServer;
  private readonly extension: PageExtension;
  private readonly manifest: PageManifest;
  private readonly token: string;
  private readonly channel: PageChannel;
  private readonly closeSocket: () => void;
  private readonly drawer: PageElement;
  private readonly chatView: PageElement;
  private readonly floatLayer: PageElement;
  private readonly dockLayer: PageElement;
  private readonly decorators: Decorators;

  private loaded: Loaded | null = null;
  /** `loadGeneration` and `bootstrappingGenerations` (`loader.ts:434-435`). */
  private generation = 0;
  private bootstrapping: number | null = null;
  /** `pendingStartupItems` (`loader.ts:438`). */
  private queued: { generation: number; payload: unknown }[] = [];
  private readonly placements = new Set<Placement>();
  /** `placementCounter` (`placement-helper.ts:67-70`). */
  private placementCounter = 0;
  private readonly tabs = new Map<string, DrawerTabRecord>();
  private drawerTab: string | null = null;
  private readonly floats = new Map<string, FloatWidgetRecord>();
  private readonly docks = new Map<string, DockPanel & { visibility: Set<(visible: boolean) => void> }>();
  private readonly actions = new Map<string, InputBarActionRecord>();
  /** `persistedPlacementGeometry`, for this page's life. */
  private readonly persisted = new Map<string, GeometryRect>();
  /** `widgetsByMessage` (`message-widgets.tsx:22`). */
  private readonly widgetsByMessage = new Map<string, WidgetRecord[]>();
  private readonly shown = new Map<string, Map<string, ShownWidget>>();
  private chat: OpenChat | null = null;
  private renderedChat: string | null = null;
  private chatHosts: { before: PageElement; empty: PageElement; after: PageElement } | null = null;
  private readonly bubbles = new Map<string, Bubble>();
  private readonly decoratorWork = { teardowns: [] as (() => void)[], mounts: [] as (() => void)[] };
  private widgetsDue = false;
  private frameTimer: unknown = null;
  private sandboxTokens = 0;
  private injections = 0;
  private closed = false;

  constructor(options: PageOptions, session: string, user: string, token: string) {
    this.server = options.server;
    this.extension = options.extension;
    this.manifest = options.manifest;
    this.session = session;
    this.user = user;
    this.token = token;
    this.window = options.window ?? new PageWindow();
    this.document = this.window.document;
    const element = (marker: string): PageElement => {
      const el = this.document.createElement("div");
      // The stand-in's own markers: Lumiverse's drawer, chat and placement layers carry its style classes.
      el.setAttribute(marker, "");
      this.document.body.appendChild(el);
      return el;
    };
    this.drawer = element("data-standin-drawer");
    this.chatView = element("data-standin-chat");
    this.floatLayer = element("data-standin-float-widgets");
    this.dockLayer = element("data-standin-dock-panels");
    this.decorators = new Decorators({
      owner: options.extension.id,
      mount: (work) => this.queueDecoratorWork("mounts", work),
      teardown: (work) => this.queueDecoratorWork("teardowns", work),
      element: (tag) => this.document.createElement(tag),
      stamp: (el, attribute) => this.stamp(el, attribute),
    });
    const page = this.server.page(user, session, options.extension.id);
    this.channel = page.channel;
    this.socket = page.socket;
    this.closeSocket = page.close;
    // `SPINDLE_FRONTEND_MSG` from the page's socket, to the extension's frontend (`ws/useWebSocket.ts:1791-1793`).
    this.channel.onBackendMessage((payload) => this.routeBackend(payload));
  }

  private get clock(): LumiverseServer["clock"] {
    return this.server.clock;
  }

  private get identifier(): string {
    return this.manifest.identifier;
  }

  // ---------------------------------------------------------------- loading

  /** Lumiverse loads the extension's frontend, as a forced load does: one already loaded is unloaded first (`loader.ts:621-671`, `:905-2462`). */
  async load(module: FrontendModule): Promise<void> {
    if (this.closed) throw new Error("the page is closed");
    if (this.loaded !== null) this.unload();
    const generation = ++this.generation;
    this.bootstrapping = generation;
    const granted = [...(await this.extension.permissions.getGranted())];
    if (this.generation !== generation || this.closed) return;
    if (typeof module.setup !== "function") {
      this.logs.push(`[Spindle:${this.identifier}] Frontend module missing setup()`);
      this.discardQueued(generation);
      this.bootstrapping = null;
      return;
    }
    const loaded: Loaded = {
      generation,
      ctx: undefined as unknown as PageContext,
      granted,
      active: true,
      ready: false,
      holdReady: false,
      setupComplete: false,
      readyTimer: null,
      teardown: module.teardown === undefined ? undefined : () => void module.teardown?.(),
      teardownClaimed: false,
      staleTeardowns: new Set(),
      backendHandlers: new Set(),
      subscriptions: [],
      anchors: new Set(),
      mountSync: true,
      channels: new Map(),
      stateDisposed: false,
      made: new Set(),
      styles: new Set(),
      cleaned: false,
    };
    loaded.ctx = this.context(loaded);
    this.loaded = loaded;
    this.syncAnchors();
    let result: unknown;
    try {
      result = module.setup(loaded.ctx as unknown as SpindleFrontendContext);
    } catch (error) {
      // `finalizeFrontendLoadFailure` (`frontend-extension-cleanup.ts:60-74`), then the load's own catch (`loader.ts:2411-2414`, `:2452-2461`).
      this.cleanup(loaded, false);
      this.logs.push(`[Spindle] Failed to load frontend for ${this.identifier}: ${words(error)}`);
      return;
    }
    this.observeSetup(result, loaded);
    loaded.setupComplete = true;
    if (typeof result === "function") loaded.teardown = result as () => void;
    if (!loaded.ready) {
      if (loaded.holdReady) this.armReady(loaded);
      else this.markReady(loaded);
    }
  }

  /** Lumiverse unloads the extension's frontend: disabled, updated or removed (`loader.ts:2525-2554`). */
  unload(): void {
    this.generation += 1;
    this.bootstrapping = null;
    this.queued = [];
    const loaded = this.loaded;
    if (loaded !== null) this.cleanup(loaded, true);
  }

  /** The tab closes: its socket goes, and nothing of the frontend runs again, as nothing runs in a closed tab. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.frameTimer !== null) this.clock.clearTimeout(this.frameTimer);
    this.frameTimer = null;
    if (this.loaded !== null && this.loaded.readyTimer !== null) this.clock.clearTimeout(this.loaded.readyTimer);
    this.closeSocket();
  }

  /** `observeFrontendSetupTeardown` (`frontend-extension-cleanup.ts:76-128`): a setup that answers later gives its cleanup then, or is unloaded for its fault. */
  private observeSetup(result: unknown, loaded: Loaded): void {
    if (typeof result !== "object" || result === null || typeof (result as PromiseLike<unknown>).then !== "function") return;
    void Promise.resolve(result)
      .then((resolved) => {
        if (typeof resolved !== "function") return;
        const teardown = resolved as () => void;
        if (this.isCurrent(loaded) && !loaded.teardownClaimed) {
          loaded.teardown = teardown;
          return;
        }
        if ((loaded.teardownClaimed && loaded.teardown === teardown) || loaded.staleTeardowns.has(teardown)) return;
        loaded.staleTeardowns.add(teardown);
        try {
          teardown();
        } catch (error) {
          this.logs.push(`[Spindle] Stale async setup teardown error for ${this.identifier}: ${words(error)}`);
        }
      })
      .catch((error: unknown) => {
        if (!this.isCurrent(loaded)) return;
        this.logs.push(`[Spindle] Async setup error for ${this.identifier}: ${words(error)}`);
        this.unload();
      });
  }

  private isCurrent(loaded: Loaded): boolean {
    return !this.closed && this.loaded === loaded && this.generation === loaded.generation;
  }

  private assertActive(loaded: Loaded): void {
    if (!loaded.active || !this.isCurrent(loaded)) throw new Error(INACTIVE);
  }

  /** `createFrontendExtensionCleanup` with the loader's steps, in its order (`frontend-extension-cleanup.ts:18-53`; `loader.ts:2211-2361`). */
  private cleanup(loaded: Loaded, reportTeardownError: boolean): void {
    if (loaded.cleaned) return;
    loaded.cleaned = true;
    loaded.active = false;
    for (const placement of [...this.placements]) {
      if (placement.generation !== loaded.generation) continue;
      try {
        placement.dispose();
      } catch {
        // `:33-37`.
      }
    }
    if (!loaded.teardownClaimed) {
      loaded.teardownClaimed = true;
      try {
        loaded.teardown?.();
      } catch (error) {
        if (reportTeardownError) this.logs.push(`[Spindle] Teardown error for ${this.identifier}: ${words(error)}`);
      }
    }
    while (loaded.subscriptions.length > 0) {
      for (const off of loaded.subscriptions.splice(0)) {
        try {
          off();
        } catch {
          // `loader.ts:2272-2274`.
        }
      }
    }
    try {
      loaded.ctx.dom.cleanup();
    } catch {
      // `loader.ts:2281-2283`.
    }
    // The mount sync stops and the decorators go at once (`loader.ts:677-680`, `:1397-1417`).
    loaded.mountSync = false;
    this.decorators.unload(loaded.generation);
    this.flushDecorators();
    loaded.anchors.clear();
    this.discardQueued(loaded.generation);
    if (this.bootstrapping === loaded.generation) this.bootstrapping = null;
    if (loaded.readyTimer !== null) this.clock.clearTimeout(loaded.readyTimer);
    loaded.readyTimer = null;
    loaded.backendHandlers.clear();
    // `removeMessageWidgetsByExtension` (`message-widgets.tsx:75-85`): the frames go when the messages draw again.
    if (this.widgetsByMessage.size > 0) {
      this.widgetsByMessage.clear();
      this.widgetsChanged();
    }
    if (this.loaded === loaded) this.loaded = null;
  }

  // ---------------------------------------------------------------- the backend's messages

  /** `routeBackendMessage` (`loader.ts:2556-2569`). */
  private routeBackend(payload: unknown): void {
    const loaded = this.loaded;
    if (loaded === null || !this.isCurrent(loaded) || !loaded.ready) {
      this.queue(payload);
      return;
    }
    this.deliver(loaded, payload);
  }

  /** `queueStartupItem` and `currentStartupGeneration` (`loader.ts:491-524`): kept only for a load under way. */
  private queue(payload: unknown): void {
    const loaded = this.loaded;
    const generation = loaded !== null && !loaded.ready && this.isCurrent(loaded) ? loaded.generation : this.bootstrapping !== null && this.bootstrapping === this.generation ? this.bootstrapping : null;
    if (generation === null) return;
    this.queued.push({ generation, payload });
    if (this.queued.length > STARTUP_ITEMS_MAX) this.queued.splice(0, this.queued.length - STARTUP_ITEMS_MAX);
  }

  private discardQueued(generation: number): void {
    this.queued = this.queued.filter((item) => item.generation !== generation);
  }

  /** `deliverBackendMessage` (`loader.ts:453-474`): one handler's fault does not stop the rest. */
  private deliver(loaded: Loaded, payload: unknown): void {
    if (!this.isCurrent(loaded)) return;
    for (const handler of [...loaded.backendHandlers]) {
      try {
        handler(payload);
      } catch (error) {
        this.logs.push(`[Spindle] Backend message handler error for ${this.identifier}: ${words(error)}`);
      }
    }
  }

  /** `markExtensionReady` with `flushPendingStartupItems` (`loader.ts:545-578`). */
  private markReady(loaded: Loaded): void {
    if (loaded.ready || !this.isCurrent(loaded)) return;
    loaded.ready = true;
    if (this.bootstrapping === loaded.generation) this.bootstrapping = null;
    if (loaded.readyTimer !== null) this.clock.clearTimeout(loaded.readyTimer);
    loaded.readyTimer = null;
    const items = this.queued;
    this.queued = [];
    for (const item of items) if (item.generation === loaded.generation) this.deliver(loaded, item.payload);
  }

  /** `armReadyTimeout` (`loader.ts:534-543`), on the test's clock. */
  private armReady(loaded: Loaded): void {
    if (loaded.readyTimer !== null || loaded.ready || !this.isCurrent(loaded)) return;
    loaded.readyTimer = this.clock.setTimeout(() => {
      loaded.readyTimer = null;
      if (!this.isCurrent(loaded) || loaded.ready) return;
      this.logs.push(`[Spindle] Frontend ready() timeout for ${this.identifier}; auto-releasing queued startup events`);
      this.markReady(loaded);
    }, READY_TIMEOUT_MS);
  }

  // ---------------------------------------------------------------- the context

  private context(loaded: Loaded): PageContext {
    const active = (): void => this.assertActive(loaded);
    // `assertLegacyPermission` (`loader.ts:657-662`) with the member's permission (`frontend-authority-map.ts:237-238`).
    const needs = (permission: string, member: string): void => {
      active();
      if (permission.split("|").some((candidate) => loaded.granted.includes(candidate))) return;
      throw new Error(`PERMISSION_DENIED:${permission} — ${member} requires the ${permission} permission`);
    };
    const onTeardown = (handler: () => void): (() => void) => {
      active();
      let live = true;
      const tracked = (): void => {
        if (!live) return;
        live = false;
        const at = loaded.subscriptions.indexOf(tracked);
        if (at !== -1) loaded.subscriptions.splice(at, 1);
        handler();
      };
      loaded.subscriptions.push(tracked);
      return () => {
        if (!live) return;
        live = false;
        const at = loaded.subscriptions.indexOf(tracked);
        if (at !== -1) loaded.subscriptions.splice(at, 1);
      };
    };
    // The selector registry is disposed at teardown (`state-selectors.ts:420-427`).
    loaded.subscriptions.push(() => {
      loaded.stateDisposed = true;
      loaded.channels.clear();
    });
    const usableState = (): void => {
      if (loaded.stateDisposed) throw new Error("SPINDLE_FRONTEND_INACTIVE: state selector registry is disposed");
      active();
    };
    const track = (unsubscribe: () => void): (() => void) => {
      let live = true;
      const tracked = (): void => {
        if (!live) return;
        live = false;
        const at = loaded.subscriptions.indexOf(tracked);
        if (at !== -1) loaded.subscriptions.splice(at, 1);
        unsubscribe();
      };
      loaded.subscriptions.push(tracked);
      return tracked;
    };
    const messageIds = (): string[] => (this.chat?.messages ?? []).map((m) => m.id);

    return {
      frontendSessionId: this.session,
      manifest: this.manifest,
      sendToBackend: (payload) => {
        active();
        this.channel.sendToBackend(payload);
      },
      onBackendMessage: (handler) => {
        active();
        loaded.backendHandlers.add(handler);
        return () => {
          loaded.backendHandlers.delete(handler);
        };
      },
      ready: () => {
        active();
        this.markReady(loaded);
      },
      deferReady: () => {
        active();
        if (loaded.ready) {
          this.logs.push(`[Spindle:${this.identifier}] deferReady() called after frontend was already ready`);
          return;
        }
        if (loaded.setupComplete) {
          this.logs.push(`[Spindle:${this.identifier}] deferReady() must be called before setup() returns`);
          return;
        }
        if (!loaded.holdReady) {
          loaded.holdReady = true;
          this.armReady(loaded);
        }
      },
      onTeardown,
      getActiveChat: () => {
        active();
        return { chatId: this.chat?.id ?? null, characterId: this.chat?.characterId ?? null };
      },
      state: {
        get: <T>(id: string): T => {
          usableState();
          return structuredClone(this.selector(id)()) as T;
        },
        subscribe: <T>(id: string, handler: (value: T) => void): (() => void) => {
          usableState();
          const read = this.selector(id);
          let channel = loaded.channels.get(id);
          if (channel === undefined) {
            channel = { listeners: new Set(), last: read() };
            loaded.channels.set(id, channel);
          }
          const listener = handler as (value: unknown) => void;
          channel.listeners.add(listener);
          let live = true;
          return () => {
            if (!live) return;
            live = false;
            channel.listeners.delete(listener);
            if (channel.listeners.size === 0) loaded.channels.delete(id);
          };
        },
      },
      ui: {
        registerDrawerTab: (options) => {
          active();
          return this.drawerTabHandle(loaded, options);
        },
        registerDomDecorator: (options) => {
          active();
          return track(this.decorators.register(options, loaded.generation));
        },
        createFloatWidget: (options) => {
          needs("ui_panels", "ctx.ui.createFloatWidget");
          return this.floatWidgetHandle(loaded, options ?? {}, active);
        },
        requestDockPanel: (options) => {
          needs("ui_panels", "ctx.ui.requestDockPanel");
          return this.dockPanelHandle(loaded, options);
        },
        registerInputBarAction: (options) => {
          active();
          return this.inputBarActionHandle(loaded, options);
        },
      },
      messages: {
        renderWidget: (options, handler) => {
          active();
          return this.upsertWidget(options, handler);
        },
        removeWidget: (messageId, widgetId) => {
          active();
          this.removeWidget(messageId, widgetId);
        },
        getLatestMessageId: () => {
          active();
          const ids = messageIds();
          return ids.length > 0 ? (ids[ids.length - 1] ?? null) : null;
        },
        getMessageIdAtIndex: (index) => {
          active();
          const ids = messageIds();
          const at = index < 0 ? ids.length + index : index;
          return at < 0 || at >= ids.length ? null : (ids[at] ?? null);
        },
        listMessageIds: () => {
          active();
          return messageIds();
        },
      },
      dom: this.domHelper(loaded, active),
    };
  }

  /** The state selectors the page models (`state-selectors.ts:171-188`). */
  private selector(id: string): () => unknown {
    if (id === "chat.active") return () => ({ chatId: this.chat?.id ?? null, characterId: this.chat?.characterId ?? null, avatarImageId: this.chat?.avatarId ?? null });
    if (id === "chat.messageCount") return () => this.chat?.messages.length ?? 0;
    throw new Error(`the stand-in page does not model the state selector "${id}"`);
  }

  /** Each subscribed selector whose value changed tells its listeners, each a copy (`state-selectors.ts:335-349`). */
  private publishState(): void {
    const loaded = this.loaded;
    if (loaded === null || !this.isCurrent(loaded)) return;
    for (const [id, channel] of loaded.channels) {
      const next = this.selector(id)();
      if (JSON.stringify(next) === JSON.stringify(channel.last)) continue;
      channel.last = next;
      for (const listener of [...channel.listeners]) {
        try {
          listener(structuredClone(next));
        } catch {
          // `:346`: a listener's fault stays the extension's.
        }
      }
    }
  }

  /** `stampExtensionRoot` (`extension-root-stamp.ts:33-41`), with the identity the load registers. */
  private stamp(element: PageElement, attribute: string): void {
    element.setAttribute(attribute, this.extension.id);
    element.setAttribute("data-spindle-ext-id", this.identifier);
  }

  /** `nextId` (`placement-helper.ts:68-70`). */
  private nextId(kind: string): string {
    return `spindle:${this.extension.id}:${kind}:${++this.placementCounter}`;
  }

  /** `trackPlacementDisposer` (`placement-helper.ts:147-180`): disposed once, and by the unload with the rest of its load. */
  private track(loaded: Loaded, dispose: () => void): () => void {
    let live = true;
    let disposing = false;
    const placement: Placement = { generation: loaded.generation, dispose: () => tracked() };
    const tracked = (): void => {
      if (!live || disposing) return;
      disposing = true;
      try {
        dispose();
        live = false;
        this.placements.delete(placement);
      } finally {
        disposing = false;
      }
    };
    this.placements.add(placement);
    return tracked;
  }

  /** `placementGeometryKey` (`store/slices/spindle-placement.ts:239-251`). */
  private geometryKey(kind: string, key: string | false | undefined): string | undefined {
    if (key === undefined || key === false) return undefined;
    if (!GEOMETRY_KEY.test(key)) throw new Error("INVALID_GEOMETRY_KEY: persistGeometry must be a nonempty 128-character placement key segment");
    return `${kind}:${key}`;
  }

  /** The layout viewport at a UI scale of 1 (`placement-helper.ts:259-267`). */
  private viewport(): GeometryRect {
    const { innerWidth, innerHeight } = this.window;
    return { x: 0, y: 0, width: innerWidth > 0 ? innerWidth : VIEWPORT_FALLBACK.width, height: innerHeight > 0 ? innerHeight : VIEWPORT_FALLBACK.height };
  }

  // ---------------------------------------------------------------- the drawer

  /** `createDrawerTabHandle` (`placement-helper.ts:409-508`). */
  private drawerTabHandle(loaded: Loaded, options: SpindleDrawerTabOptions): SpindleDrawerTabHandle {
    const tabId = this.nextId(`tab:${options.id}`);
    const root = this.document.createElement("div");
    this.stamp(root, "data-spindle-extension-root");
    root.setAttribute("data-spindle-drawer-tab", tabId);
    let destroyed = false;
    const record: DrawerTabRecord = {
      tabId,
      contributionId: options.id,
      title: options.title,
      ...(options.shortName !== undefined ? { shortName: options.shortName } : {}),
      ...(options.description !== undefined ? { description: options.description } : {}),
      ...(options.keywords !== undefined ? { keywords: options.keywords } : {}),
      ...(options.headerTitle !== undefined ? { headerTitle: options.headerTitle } : {}),
      ...(options.iconUrl !== undefined ? { iconUrl: options.iconUrl } : {}),
      ...(options.iconSvg !== undefined ? { iconSvg: options.iconSvg } : {}),
      badge: null,
      root,
      activated: new Set(),
    };
    const dispose = this.track(loaded, () => {
      destroyed = true;
      root.remove();
      this.tabs.delete(tabId);
      record.activated.clear();
    });
    this.tabs.set(tabId, record);
    this.drawer.appendChild(root);
    const usable = (): void => {
      if (destroyed) throw new Error(PLACEMENT_DESTROYED);
    };
    return {
      root: root as unknown as HTMLElement,
      tabId,
      setTitle: (title) => {
        usable();
        record.title = title;
      },
      setShortName: (shortName) => {
        usable();
        record.shortName = shortName;
      },
      setBadge: (text) => {
        usable();
        record.badge = text;
      },
      activate: () => {
        usable();
        this.showTab(tabId);
      },
      destroy: dispose,
      onActivate: (handler) => {
        usable();
        record.activated.add(handler);
        return () => {
          record.activated.delete(handler);
        };
      },
    };
  }

  /** The drawer opens on a tab: its handlers hear it when the drawer's tab becomes this one (`placement-helper.ts:423-429`, `:495-500`). */
  private showTab(tabId: string): void {
    const before = this.drawerTab;
    this.drawerTab = tabId;
    if (before === tabId) return;
    for (const handler of [...(this.tabs.get(tabId)?.activated ?? [])]) {
      try {
        handler();
      } catch {
        // `:427`.
      }
    }
  }

  // ---------------------------------------------------------------- float widgets and dock panels

  /** `createFloatWidgetHandle` (`placement-helper.ts:944-1181`). */
  private floatWidgetHandle(loaded: Loaded, options: FloatWidgetOptions, active: () => void): SpindleFloatWidgetHandle {
    const touchMode = (mode: unknown): void => {
      if (mode !== "guarded" && mode !== "native") throw new Error("SPINDLE_TOUCH_SCROLL_MODE_INVALID: Expected guarded or native");
    };
    touchMode(options.touchScrollMode ?? "guarded");
    const widgetId = this.nextId("float");
    const key = this.geometryKey("float", options.persistGeometry);
    const root = this.document.createElement("div");
    this.stamp(root, "data-spindle-extension-root");
    const lock = normalizeAspectLock(options.aspectLock);
    const bounds = (): Resolved => resolveBounds(this.viewport(), options.bounds);
    const width = Math.max(1, finiteOr(options.width, FLOAT_SIZE));
    const height = Math.max(1, finiteOr(options.height, FLOAT_SIZE));
    const view = this.viewport();
    const fallback = clampRect({ x: finiteOr(options.initialPosition?.x, view.width - width - FLOAT_MARGIN), y: finiteOr(options.initialPosition?.y, view.height - height - FLOAT_MARGIN), width, height }, bounds(), lock);
    const kept = key === undefined ? undefined : this.persisted.get(key);
    const initial = kept === undefined ? fallback : clampRect(kept, bounds(), lock);
    let destroyed = false;
    const update = (rect: GeometryRect): GeometryRect => {
      const next = clampRect(rect, bounds(), lock);
      Object.assign(record, next);
      return next;
    };
    const commit = (rect: GeometryRect): GeometryRect => {
      const next = update(rect);
      if (key !== undefined) this.persisted.set(key, next);
      try {
        options.onGeometryCommit?.(next);
      } catch {
        // `:988`: the extension's callback does not break the placement.
      }
      return next;
    };
    const record: FloatWidgetRecord = {
      widgetId,
      root,
      ...initial,
      visible: true,
      fullscreen: options.fullscreen ?? false,
      resizable: options.resizable !== false,
      snapToEdge: options.snapToEdge ?? true,
      mobileClamp: options.mobileClamp !== false,
      ...(options.tooltip !== undefined ? { tooltip: options.tooltip } : {}),
      ...(options.chromeless !== undefined ? { chromeless: options.chromeless } : {}),
      dragEnd: new Set(),
      commit,
    };
    const dispose = this.track(loaded, () => {
      destroyed = true;
      root.remove();
      this.floats.delete(widgetId);
      record.dragEnd.clear();
    });
    this.floats.set(widgetId, record);
    this.floatLayer.appendChild(root);
    const usable = (): void => {
      if (destroyed) throw new Error(PLACEMENT_DESTROYED);
    };
    const rect = (): GeometryRect => ({ x: record.x, y: record.y, width: record.width, height: record.height });
    return {
      root: root as unknown as HTMLElement,
      widgetId,
      setTouchScrollMode: (mode) => {
        active();
        usable();
        touchMode(mode);
      },
      moveTo: (x, y) => {
        usable();
        commit({ ...rect(), x, y });
      },
      getPosition: () => {
        usable();
        return { x: record.x, y: record.y };
      },
      setSize: (w, h) => {
        usable();
        if (record.fullscreen || !Number.isFinite(w) || !Number.isFinite(h)) return;
        const ratio = lock === true ? record.width / Math.max(1, record.height) : lock;
        commit({ x: record.x, y: record.y, width: Math.round(w), height: ratio ? Math.round(w / ratio) : Math.round(h) });
      },
      setVisible: (visible) => {
        usable();
        record.visible = visible;
      },
      isVisible: () => {
        usable();
        return record.visible;
      },
      setFullscreen: (fullscreen) => {
        usable();
        if (fullscreen) {
          const before = rect();
          update(this.viewport());
          record.fullscreen = true;
          record.preFullscreen = before;
          return;
        }
        commit(record.preFullscreen ?? rect());
        record.fullscreen = false;
        delete record.preFullscreen;
      },
      isFullscreen: () => {
        usable();
        return record.fullscreen;
      },
      destroy: dispose,
      onDragEnd: (handler) => {
        usable();
        record.dragEnd.add(handler);
        return () => {
          record.dragEnd.delete(handler);
        };
      },
    };
  }

  /** `createDockPanelHandle` (`placement-helper.ts:1191-1344`). */
  private dockPanelHandle(loaded: Loaded, options: DockPanelOptions): SpindleDockPanelHandle {
    const panelId = this.nextId(`dock:${options.edge}`);
    const key = this.geometryKey("dock", options.persistGeometry);
    const root = this.document.createElement("div");
    this.stamp(root, "data-spindle-extension-root");
    let minSize = Math.max(1, finiteOr(options.minSize, DOCK_MIN));
    let maxSize = Math.max(minSize, finiteOr(options.maxSize, DOCK_MAX));
    const kept = key === undefined ? undefined : this.persisted.get(key);
    const restored = kept === undefined ? undefined : clampRect(kept, resolveBounds(this.viewport(), { minWidth: minSize, minHeight: minSize, maxWidth: maxSize, maxHeight: maxSize }));
    let destroyed = false;
    const record: DockPanel & { visibility: Set<(visible: boolean) => void> } = {
      panelId,
      root,
      edge: options.edge,
      title: options.title,
      size: clampDockSize(restored?.width ?? finiteOr(options.size, minSize), minSize, maxSize),
      minSize,
      maxSize,
      resizable: options.resizable ?? true,
      collapsed: options.startCollapsed ?? false,
      chromeless: options.chromeless === true,
      centerContent: options.centerContent === true,
      ...(options.iconUrl !== undefined ? { iconUrl: options.iconUrl } : {}),
      visibility: new Set(),
    };
    const persist = (): void => {
      const rect = { x: 0, y: 0, width: record.size, height: record.size };
      if (key !== undefined) this.persisted.set(key, rect);
      try {
        options.onGeometryCommit?.(rect);
      } catch {
        // `:1227`.
      }
    };
    const boundsChanged = (): void => {
      const next = clampDockSize(record.size, minSize, maxSize);
      const changed = next !== record.size;
      Object.assign(record, { size: next, minSize, maxSize });
      if (changed) persist();
    };
    const dispose = this.track(loaded, () => {
      destroyed = true;
      root.remove();
      this.docks.delete(panelId);
      record.visibility.clear();
    });
    this.docks.set(panelId, record);
    this.dockLayer.appendChild(root);
    const usable = (): void => {
      if (destroyed) throw new Error(PLACEMENT_DESTROYED);
    };
    const visible = (shown: boolean): void => {
      record.collapsed = !shown;
      for (const handler of [...record.visibility]) {
        try {
          handler(shown);
        } catch {
          // `:1301`.
        }
      }
    };
    return {
      root: root as unknown as HTMLElement,
      panelId,
      collapse: () => {
        usable();
        visible(false);
      },
      expand: () => {
        usable();
        visible(true);
      },
      isCollapsed: () => {
        usable();
        return record.collapsed;
      },
      setTitle: (title) => {
        usable();
        record.title = title;
      },
      setSize: (size) => {
        usable();
        if (!Number.isFinite(size)) return;
        record.size = clampDockSize(size, minSize, maxSize);
        persist();
      },
      setMinSize: (size) => {
        usable();
        if (!Number.isFinite(size)) return;
        minSize = Math.max(1, Math.round(size));
        maxSize = Math.max(minSize, maxSize);
        boundsChanged();
      },
      setMaxSize: (size) => {
        usable();
        if (!Number.isFinite(size)) return;
        maxSize = Math.max(minSize, Math.round(size));
        boundsChanged();
      },
      destroy: dispose,
      onVisibilityChange: (handler) => {
        usable();
        record.visibility.add(handler);
        return () => {
          record.visibility.delete(handler);
        };
      },
    };
  }

  // ---------------------------------------------------------------- the composer's actions

  /** `createInputBarActionHandle` (`placement-helper.ts:1414-1504`). */
  private inputBarActionHandle(loaded: Loaded, options: SpindleInputBarActionOptions): SpindleInputBarActionHandle {
    const actionId = this.nextId(`action:${options.id}`);
    let destroyed = false;
    const record: InputBarActionRecord = {
      actionId,
      contributionId: options.id,
      extensionName: this.manifest.name,
      label: options.label,
      ...(options.subtitle !== undefined ? { subtitle: options.subtitle } : {}),
      ...(options.iconSvg !== undefined ? { iconSvg: options.iconSvg } : {}),
      ...(options.iconUrl !== undefined ? { iconUrl: options.iconUrl } : {}),
      enabled: options.enabled !== false,
      clicks: new Set(),
    };
    const dispose = this.track(loaded, () => {
      destroyed = true;
      this.actions.delete(actionId);
      record.clicks.clear();
    });
    this.actions.set(actionId, record);
    const usable = (): void => {
      if (destroyed) throw new Error(PLACEMENT_DESTROYED);
    };
    return {
      actionId,
      setLabel: (label) => {
        usable();
        record.label = label;
      },
      setSubtitle: (subtitle) => {
        usable();
        if (subtitle === undefined) delete record.subtitle;
        else record.subtitle = subtitle;
      },
      setEnabled: (enabled) => {
        usable();
        record.enabled = enabled;
      },
      onClick: (handler) => {
        usable();
        record.clicks.add(handler);
        return () => {
          record.clicks.delete(handler);
        };
      },
      destroy: dispose,
    };
  }

  // ---------------------------------------------------------------- widgets under messages

  /** `upsertMessageWidget` (`message-widgets.tsx:36-63`). */
  private upsertWidget(options: SpindleMessageWidgetOptions, onMessage?: (payload: unknown) => void): () => void {
    const list = this.widgetsByMessage.get(options.messageId) ?? [];
    const record: WidgetRecord = { ...options, ...(onMessage !== undefined ? { onMessage } : {}) };
    const at = list.findIndex((w) => w.widgetId === options.widgetId);
    if (at === -1) list.push(record);
    else list[at] = record;
    this.widgetsByMessage.set(options.messageId, list);
    this.widgetsChanged();
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      const current = this.widgetsByMessage.get(record.messageId);
      const index = current?.indexOf(record) ?? -1;
      if (current === undefined || index === -1) return;
      current.splice(index, 1);
      if (current.length === 0) this.widgetsByMessage.delete(record.messageId);
      this.widgetsChanged();
    };
  }

  /** `removeMessageWidget` (`message-widgets.tsx:65-73`). */
  private removeWidget(messageId: string, widgetId: string): void {
    const list = this.widgetsByMessage.get(messageId);
    if (list === undefined) return;
    const next = list.filter((w) => w.widgetId !== widgetId);
    if (next.length === list.length) return;
    if (next.length === 0) this.widgetsByMessage.delete(messageId);
    else this.widgetsByMessage.set(messageId, next);
    this.widgetsChanged();
  }

  /** The messages draw their widgets again, a moment later (`message-widgets.tsx:87-170`). */
  private widgetsChanged(): void {
    this.widgetsDue = true;
    this.schedule();
  }

  /** Each message shown gets a host per widget, after its text, holding a sandboxed frame made again whenever the widget is rendered again (`message-widgets.tsx:87-164`; `sandbox-frame.ts:108-195`). */
  private drawWidgets(): void {
    for (const messageId of [...this.shown.keys()]) if (!this.bubbles.has(messageId)) this.shown.delete(messageId);
    for (const [messageId, bubble] of this.bubbles) {
      const wanted = this.widgetsByMessage.get(messageId) ?? [];
      const shown = this.shown.get(messageId) ?? new Map<string, ShownWidget>();
      for (const [widgetId, widget] of shown) {
        if (wanted.some((w) => w.widgetId === widgetId)) continue;
        widget.host.remove();
        shown.delete(widgetId);
      }
      for (const record of wanted) {
        let widget = shown.get(record.widgetId);
        if (widget === undefined) {
          const host = this.document.createElement("div");
          host.setAttribute("data-spindle-message-widget-host", record.widgetId);
          widget = { host, frame: null, record: null };
          shown.set(record.widgetId, widget);
        }
        if (widget.record !== record) {
          widget.frame = this.widgetFrame(record);
          widget.host.replaceChildren(widget.frame);
          widget.record = record;
        }
        bubble.content.appendChild(widget.host);
      }
      if (shown.size > 0) this.shown.set(messageId, shown);
      else this.shown.delete(messageId);
    }
  }

  /** The widget's sandboxed frame (`sandbox-frame.ts:115-136`; `message-widgets.tsx:124-132`); its document is the widget's html as given. */
  private widgetFrame(record: WidgetRecord): PageElement {
    const { minHeight } = widgetHeights(record);
    const frame = this.document.createElement("iframe");
    this.stamp(frame, "data-spindle-ext");
    frame.setAttribute("data-spindle-sandbox-frame", `sandbox-${++this.sandboxTokens}`);
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("srcdoc", record.html);
    frame.setAttribute("data-spindle-message-widget", record.widgetId);
    frame.setAttribute("data-spindle-extension-id", this.extension.id);
    frame.style.height = `${minHeight}px`;
    return frame;
  }

  // ---------------------------------------------------------------- ctx.dom

  /** `createDOMHelper` (`dom-helper.ts:37-281`). */
  private domHelper(loaded: Loaded, active: () => void): PageContext["dom"] {
    const extension = this.extension.id;
    const release = (element: PageElement): void => {
      loaded.made.delete(element);
      element.remove();
    };
    return {
      inject: (target, html, position) => {
        active();
        const el = typeof target === "string" ? this.document.querySelector(target) : (target as unknown as PageElement);
        if (el === null) throw new Error(`Target not found: ${String(target)}`);
        const wrapper = this.document.createElement("div");
        this.stamp(wrapper, "data-spindle-ext");
        wrapper.setAttribute("data-spindle-inj-id", `inj-${++this.injections}`);
        // Kept as given: Lumiverse sanitizes it (`:65-79`).
        wrapper.innerHTML = html;
        const parent = el.parentNode;
        switch (position ?? "beforeend") {
          case "beforebegin":
            if (parent !== null) parent.insertBefore(wrapper, el);
            break;
          case "afterbegin":
            el.insertBefore(wrapper, el.firstChild);
            break;
          case "afterend":
            if (parent !== null) parent.insertBefore(wrapper, el.nextSibling);
            break;
          default:
            el.appendChild(wrapper);
        }
        loaded.made.add(wrapper);
        return wrapper as unknown as Element;
      },
      uninject: (element) => release(element as unknown as PageElement),
      addStyle: (css, options) => {
        active();
        const style = this.document.createElement("style");
        this.stamp(style, "data-spindle-ext");
        // A root-scoped sheet needs an identifier fit for a selector; the stand-in keeps its text as given where Lumiverse rewrites it under the extension's scope (`:143-151`, `:292-314`).
        if (options?.scope === "root" && !IDENTIFIER.test(this.identifier)) throw new Error("SCOPE_IDENTIFIER_INVALID");
        style.textContent = css;
        this.document.head.appendChild(style);
        const remove = (): void => {
          style.remove();
          loaded.styles.delete(remove);
        };
        loaded.styles.add(remove);
        return remove;
      },
      createElement: (tag, attrs) => {
        active();
        if (Object.hasOwn(FORBIDDEN_TAGS, tag.toLowerCase())) throw new Error(`Forbidden element tag: ${tag}. Use ctx.dom.createSandboxFrame() for isolated scriptable widgets.`);
        const el = this.document.createElement(tag);
        this.stamp(el, "data-spindle-ext");
        for (const [name, value] of Object.entries(attrs ?? {})) if (!Object.hasOwn(ROOT_ATTRIBUTES, name.toLowerCase())) el.setAttribute(name, value);
        loaded.made.add(el);
        return el as unknown as HTMLElement;
      },
      query: (selector) => this.document.querySelector(`[data-spindle-ext="${extension}"] ${selector}`) as unknown as Element | null,
      queryAll: (selector) => this.document.querySelectorAll(`[data-spindle-ext="${extension}"] ${selector}`) as unknown as Element[],
      getMessageId: (target) => (target as unknown as PageElement).closest?.("[data-message-id]")?.getAttribute("data-message-id") ?? null,
      findMessageElement: (messageId) => (messageId ? (this.document.querySelector(`[data-message-id="${messageId}"]`) as unknown as Element | null) : null),
      listMessageElements: () => this.document.querySelectorAll("[data-message-id]").flatMap((el) => {
        const messageId = el.getAttribute("data-message-id");
        return messageId ? [{ messageId, element: el as unknown as Element }] : [];
      }),
      cleanup: () => {
        for (const el of [...loaded.made]) release(el);
        for (const remove of [...loaded.styles]) remove();
      },
    };
  }

  // ---------------------------------------------------------------- decorators' anchors and the frame

  /** `attachMountRoots` (`loader.ts:1352-1384`): every host of the page is an anchor for the extension's load; a host gone takes its anchor with it. */
  private syncAnchors(): void {
    const loaded = this.loaded;
    if (loaded === null || !loaded.mountSync) return;
    for (const node of [...loaded.anchors]) {
      if (node.isConnected) continue;
      this.decorators.unregisterAnchor(node);
      loaded.anchors.delete(node);
    }
    for (const host of this.document.querySelectorAll("[data-spindle-mount][data-spindle-scope]")) {
      const mount = host.getAttribute("data-spindle-mount");
      const scope = host.getAttribute("data-spindle-scope");
      if (!mount || !scope?.trim()) continue;
      this.decorators.registerAnchor(mount, scope, loaded.generation, host);
      loaded.anchors.add(host);
    }
  }

  private queueDecoratorWork(kind: "mounts" | "teardowns", work: () => void): void {
    this.decoratorWork[kind].push(work);
    this.schedule();
  }

  /** The next animation frame, or a timer where there is none (`dom-decorator-service.ts:636-649`, `:841-844`): here, the test's clock. */
  private schedule(): void {
    if (this.frameTimer !== null || this.closed) return;
    this.frameTimer = this.clock.setTimeout(() => {
      this.frameTimer = null;
      this.flushFrame();
    }, 0);
  }

  private flushDecorators(): void {
    const teardowns = this.decoratorWork.teardowns.splice(0);
    const mounts = this.decoratorWork.mounts.splice(0);
    for (const work of teardowns) work();
    for (const work of mounts) work();
  }

  private flushFrame(): void {
    this.flushDecorators();
    if (this.widgetsDue) {
      this.widgetsDue = false;
      this.drawWidgets();
    }
  }

  // ---------------------------------------------------------------- what the user does

  /** The work waiting for the next frame runs now, as `flushDomDecoratorWork` runs it (`dom-decorator-service.ts:889-891`). */
  frame(): void {
    if (this.frameTimer !== null) this.clock.clearTimeout(this.frameTimer);
    this.frameTimer = null;
    this.flushFrame();
  }

  /** The user opens a chat: the page reads it and its messages from Lumiverse's routes, shows each message with its hosts, and the active chat is this one. */
  async openChat(chatId: string): Promise<void> {
    const chat = (await this.read(`/api/v1/chats/${encodeURIComponent(chatId)}`)) as Record<string, unknown>;
    const characterId = typeof chat.character_id === "string" ? chat.character_id : null;
    this.chat = { id: chatId, characterId, avatarId: avatarOf(chat.metadata, characterId), messages: await this.readMessages(chatId) };
    this.drawChat();
    this.publishState();
  }

  /** The open chat read again, as it stands now. */
  async refreshChat(): Promise<void> {
    if (this.chat === null) throw new Error("no chat is open on the page");
    await this.openChat(this.chat.id);
  }

  /** The user leaves the chat: no chat is active. */
  closeChat(): void {
    this.chat = null;
    this.drawChat();
    this.publishState();
  }

  /** The user opens a tab of the drawer. */
  openTab(tabId: string): void {
    if (!this.tabs.has(tabId)) throw new Error(`no drawer tab ${tabId} is on the page`);
    this.showTab(tabId);
  }

  /** The user drags a float widget to a place: it lands there, kept inside the viewport, and its handlers hear where (`placement-helper.ts:1021-1036`). */
  dragFloatWidget(widgetId: string, x: number, y: number): void {
    const record = this.floats.get(widgetId);
    if (record === undefined) throw new Error(`no float widget ${widgetId} is on the page`);
    const rect = record.commit({ x, y, width: record.width, height: record.height });
    for (const handler of [...record.dragEnd]) {
      try {
        handler({ x: rect.x, y: rect.y });
      } catch {
        // `:1033`.
      }
    }
  }

  /** The user presses the composer's action that says `label`: each of its handlers is called with nothing (`InputBarExtensionActions.tsx:31-37`). */
  pressInputBarAction(label: string): void {
    const found = [...this.actions.values()].filter((a) => a.enabled && a.label === label);
    const [action] = found;
    if (found.length !== 1 || action === undefined) throw new Error(`${found.length} actions in the composer's menu say "${label}"`);
    for (const handler of [...action.clicks]) {
      try {
        handler();
      } catch {
        // `:34`.
      }
    }
  }

  /** A widget's script posts to the extension: its handler hears a copy (`sandbox-frame.ts:28-106`). */
  widgetSays(messageId: string, widgetId: string, payload: unknown): void {
    const record = this.shown.get(messageId)?.get(widgetId)?.record;
    if (record === undefined || record === null) throw new Error(`no widget ${widgetId} stands under message ${messageId}`);
    try {
      record.onMessage?.(structuredClone(payload));
    } catch (error) {
      this.logs.push(`[Spindle] Sandbox frame message handler failed: ${words(error)}`);
    }
  }

  // ---------------------------------------------------------------- what a test reads

  /** The drawer's tabs, in the order registered. */
  drawerTabs(): DrawerTab[] {
    return [...this.tabs.values()].map(({ activated: _activated, ...tab }) => ({ ...tab }));
  }

  /** The tab the drawer is on. */
  get openTabId(): string | null {
    return this.drawerTab;
  }

  floatWidgets(): FloatWidget[] {
    return [...this.floats.values()].map(({ dragEnd: _dragEnd, commit: _commit, preFullscreen: _pre, ...widget }) => ({ ...widget }));
  }

  dockPanels(): DockPanel[] {
    return [...this.docks.values()].map(({ visibility: _visibility, ...panel }) => ({ ...panel }));
  }

  /** The composer's menu of extension actions: the enabled ones, in the order registered (`InputBarExtensionActions.tsx:20-29`). */
  inputBarActions(): InputBarAction[] {
    return [...this.actions.values()].filter((a) => a.enabled).map(({ clicks: _clicks, enabled: _enabled, ...action }) => ({ ...action }));
  }

  /** A message's bubble, while the open chat shows it. */
  message(messageId: string): PageElement | null {
    return this.bubbles.get(messageId)?.element ?? null;
  }

  /** The widgets standing under a message now, in their order. */
  widgets(messageId: string): Widget[] {
    return [...(this.shown.get(messageId)?.values() ?? [])].flatMap(({ record, frame }) => (record === null || frame === null ? [] : [{ widgetId: record.widgetId, html: record.html, ...widgetHeights(record), frame }]));
  }

  // ---------------------------------------------------------------- the chat on the page

  private async read(path: string): Promise<unknown> {
    const res = await this.server.fetch(`${this.server.base}${path}`, { method: "GET", headers: { authorization: `Bearer ${this.token}` } });
    const body = (await res.json()) as unknown;
    if (res.status !== 200) throw new Error(`GET ${path} answered ${res.status}: ${JSON.stringify(body)}`);
    return body;
  }

  /** Every page of the chat's messages, oldest first, as Lumiverse serves them (`src/routes/chats.routes.ts:792-821`). */
  private async readMessages(chatId: string): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];
    for (let offset = 0; ; ) {
      const page = (await this.read(`/api/v1/chats/${encodeURIComponent(chatId)}/messages?limit=1000&offset=${offset}`)) as { data: Record<string, unknown>[]; total: number };
      for (const row of page.data) messages.push({ id: String(row.id), content: typeof row.content === "string" ? row.content : "" });
      offset += page.data.length;
      if (page.data.length === 0 || offset >= page.total) return messages;
    }
  }

  /**
   * The chat as Lumiverse's message list draws it (`components/chat/MessageList.tsx:1929-1999`): its hosts
   * before and after the messages, its empty state when there are none, and each message's bubble with the
   * hosts its component renders (`components/chat/BubbleMessageDefault.tsx:397`, `:464`, `:485`, `:533`,
   * `:553`, `:558`; `components/chat/BubbleActions.tsx:125`) and its widgets after its text
   * (`components/chat/MessageContent.tsx:2525`). A message drawn before keeps its bubble, as a keyed row does.
   */
  private drawChat(): void {
    const chat = this.chat;
    if (chat === null || this.renderedChat !== chat.id) {
      this.bubbles.clear();
      this.chatHosts = null;
      this.renderedChat = null;
      this.chatView.replaceChildren();
    }
    if (chat !== null) {
      const host = (mount: string, scope: string): PageElement => {
        const el = this.document.createElement("span");
        el.setAttribute("data-spindle-mount", mount);
        el.setAttribute("data-spindle-scope", scope);
        return el;
      };
      this.renderedChat = chat.id;
      this.chatHosts ??= { before: host("chat_stream_before", `chat:${chat.id}:stream-before`), empty: host("chat_empty_state", `chat:${chat.id}:empty`), after: host("chat_stream_after", `chat:${chat.id}:stream-after`) };
      const ids = new Set(chat.messages.map((m) => m.id));
      for (const id of [...this.bubbles.keys()]) if (!ids.has(id)) this.bubbles.delete(id);
      const rows = chat.messages.map((m) => {
        let bubble = this.bubbles.get(m.id);
        if (bubble === undefined) {
          bubble = this.bubble(m.id, host);
          this.bubbles.set(m.id, bubble);
        }
        bubble.text.textContent = m.content;
        return bubble.element;
      });
      const { before, empty, after } = this.chatHosts;
      this.chatView.replaceChildren(before, ...(rows.length === 0 ? [empty] : rows), after);
    }
    this.syncAnchors();
    this.widgetsChanged();
  }

  private bubble(id: string, host: (mount: string, scope: string) => PageElement): Bubble {
    const element = this.document.createElement("div");
    element.setAttribute("data-message-id", id);
    const content = this.document.createElement("div");
    const text = this.document.createElement("div");
    content.append(host("message_body_before", `message:${id}:bubble:body-before`), text);
    element.append(
      host("message_header", `message:${id}:bubble:header`),
      content,
      host("message_body_after", `message:${id}:bubble:body-after`),
      host("message_swipe_indicators", `message:${id}:bubble:swipe-indicators`),
      host("message_footer", `message:${id}:bubble:footer`),
      host("message_actions", `message:${id}:actions`),
    );
    return { element, content, text };
  }
}
