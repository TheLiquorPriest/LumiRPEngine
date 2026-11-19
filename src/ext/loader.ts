// The light extension's frontend (STANDALONE-PLAN §4.3, "Frontend"): a loader that puts RPE's shared UI
// in Lumiverse's drawer and in his chat, and hands it what it needs, and nothing more. The UI's own `mount`
// (from `src/ui/`, the extension shell) gets the drawer tab's root, Spindle's frontend context, and the
// page's end of the pipe (`page.ts`) for when the browser cannot reach RPE directly; what it gives back may
// carry the chat surfaces it draws (the line and chips under a reply, the HUD and panels, the composer's
// controls, the markers), each a placement through Lumiverse's own frontend API, which the loader registers
// as given and takes off on cleanup. Lumiverse calls the module's `setup(ctx)` and the cleanup it returns.

import type { SpindleDockPanelHandle, SpindleDockPanelOptions, SpindleFloatWidgetHandle, SpindleFrontendContext, SpindleInputBarActionOptions, SpindleMessageWidgetOptions } from "lumiverse-spindle-types";
import type { DomDecoratorOptions, FloatWidgetOptions, HostUi } from "../spindle-augment";
import { pageRoad, type PageRoad } from "./page";

/**
 * One surface of RPE in Lumiverse's chat, by where it stands. `key` names it for as long as the shell holds it: the loader registers it when it first sees the key and takes it off when the key is
 * gone. What each draws, it draws itself: the loader makes the registration and hands over the element the host gives.
 */
export type ChatSurface =
  /** A DOM decorator on one of the host's anchors (the two markers, the line under a reply): `ctx.ui.registerDomDecorator`; its `render` and `update` are the options', given an element of its own in the host's root (`ownRoot`). */
  | { key: string; placement: "dom-decorator"; options: DomDecoratorOptions }
  /** A float widget (the HUD): `ctx.ui.createFloatWidget`, drawn into its root by `render`, which may return what takes the drawing down. Needs `ui_panels`. */
  | { key: string; placement: "float-widget"; options?: FloatWidgetOptions; render(handle: SpindleFloatWidgetHandle): void | (() => void) }
  /** A dock panel: `ctx.ui.requestDockPanel`, drawn into its root by `render`. Needs `ui_panels`. */
  | { key: string; placement: "dock-panel"; options: SpindleDockPanelOptions; render(handle: SpindleDockPanelHandle): void | (() => void) }
  /** An input-bar action (the composer's depth and swipe-mode controls): `ctx.ui.registerInputBarAction`, `onClick` called when it is pressed. */
  | { key: string; placement: "input-bar-action"; options: SpindleInputBarActionOptions; onClick(): void }
  /** A widget under one reply (`ctx.messages.renderWidget`): `handler` hears what the widget's frame posts. */
  | { key: string; placement: "message-widget"; options: SpindleMessageWidgetOptions; handler?: (payload: unknown) => void };

/** The surfaces the shell holds now, and a word when they change: one added later is registered with no change to the loader. */
export interface SurfaceList {
  current(): readonly ChatSurface[];
  subscribe(listener: () => void): () => void;
}

/** What the UI's extension shell is given to mount itself. */
export interface ShellMount {
  /** The drawer tab's root element: the UI renders into it. */
  root: HTMLElement;
  /** Spindle's frontend context. */
  ctx: SpindleFrontendContext;
  /** RPE through the extension: start-up facts, requests, live updates. */
  road: PageRoad;
}

/** What the mounted shell gives back: its cleanup, a way to show one of its pages in the drawer tab (whoever calls it opens the tab), and the chat surfaces it draws, where it draws any. */
export interface Mounted {
  unmount(): void;
  open(route: { page: string; chat?: string | null; at?: readonly string[] }): void;
  surfaces?: SurfaceList;
}

/** The UI's extension shell (`src/ui/`): mounts the pages. */
export type MountShell = (mount: ShellMount) => Mounted;

/** The drawer tab RPE's pages live in. */
export const TAB = { id: "rpe", title: "RPE", shortName: "RPE", description: "RPE: the live view, turns, world, cast, story and settings" };

/**
 * A decorator's own element in the root the host gives it: the host gives every decorator of the extension on one anchor the one root
 * (`dom-decorator-service.ts` `ensureRoot`, by owner, mount and scope), so each draws into a child of its own, by its key, and none
 * replaces what another drew there (the line under a reply, the window's marker and the working marker share a reply's anchor).
 */
function ownRoot(root: HTMLElement, key: string): HTMLElement {
  const held = root.querySelector(`:scope > [data-rpe-surface="${CSS.escape(key)}"]`);
  if (held instanceof HTMLElement) return held;
  const own = document.createElement("div");
  own.setAttribute("data-rpe-surface", key);
  own.style.display = "contents";
  root.appendChild(own);
  return own;
}

/** One surface registered through the host's frontend API; what takes it off. */
function register(ctx: SpindleFrontendContext, surface: ChatSurface): () => void {
  const ui = ctx.ui as unknown as HostUi;
  switch (surface.placement) {
    case "dom-decorator": {
      const { key } = surface;
      const { render, update } = surface.options;
      // Under `ctx.ui` and returning its remover: the host has no such member at the context's top level.
      return ui.registerDomDecorator({
        ...surface.options,
        ...(render === undefined
          ? {}
          : {
              render: (root, at) => {
                const own = ownRoot(root, key);
                const drawn = render(own, at);
                return () => {
                  if (typeof drawn === "function") drawn();
                  own.remove();
                };
              },
            }),
        ...(update === undefined ? {} : { update: (root, at) => update(ownRoot(root, key), at) }),
      });
    }
    case "float-widget": {
      const handle = ui.createFloatWidget(surface.options);
      const drawn = surface.render(handle);
      return () => {
        if (typeof drawn === "function") drawn();
        handle.destroy();
      };
    }
    case "dock-panel": {
      const handle = ui.requestDockPanel(surface.options);
      const drawn = surface.render(handle);
      return () => {
        if (typeof drawn === "function") drawn();
        handle.destroy();
      };
    }
    case "input-bar-action": {
      const handle = ui.registerInputBarAction(surface.options);
      const off = handle.onClick(surface.onClick);
      return () => {
        off();
        handle.destroy();
      };
    }
    case "message-widget":
      // `renderWidget` returns what takes the widget off.
      return ctx.messages.renderWidget(surface.options, surface.handler);
  }
}

/** Whether the host opens a placement only with `ui_panels` (`placement-helper.ts`, `createFloatWidgetHandle` and the dock's): a revoke takes it down host-side. */
const needsPanels = (placement: ChatSurface["placement"]): boolean => placement === "float-widget" || placement === "dock-panel";

/** Hears whether `ui_panels` is granted, each time the extension learns the grants (at the page's start and at every change). */
export type PanelsGrant = (listener: (granted: boolean) => void) => () => void;

/**
 * Keeps the shell's surfaces registered: each key seen is registered once and taken off when the key goes, and every one is taken off by the cleanup returned. A surface the host
 * refuses (its anchor gone) is left out and tried again at the next change of the list, so one refusal costs the others nothing. With `panels`, the HUD and panels follow
 * `ui_panels`: while it is not granted none is asked for; when it is revoked the host has taken them down and they are forgotten; when it is granted they are registered at once.
 */
export function keepSurfaces(ctx: SpindleFrontendContext, list: SurfaceList, panels?: PanelsGrant): () => void {
  const held = new Map<string, { placement: ChatSurface["placement"]; remove: () => void }>();
  let panelsGranted = true;
  const sync = (): void => {
    const now = list.current();
    const keys = new Set(now.map((s) => s.key));
    for (const [key, { placement, remove }] of held) {
      if (keys.has(key) && (panelsGranted || !needsPanels(placement))) continue;
      held.delete(key);
      remove();
    }
    for (const surface of now) {
      if (held.has(surface.key) || (!panelsGranted && needsPanels(surface.placement))) continue;
      try {
        held.set(surface.key, { placement: surface.placement, remove: register(ctx, surface) });
      } catch (error) {
        console.warn(`RPE could not put "${surface.key}" in the chat: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  const offs = [
    list.subscribe(sync),
    panels?.((granted) => {
      if (granted === panelsGranted) return;
      panelsGranted = granted;
      sync();
    }),
  ];
  sync();
  return () => {
    for (const off of offs) off?.();
    for (const { remove } of held.values()) remove();
    held.clear();
  };
}

/** The frontend's `setup`, for the shell given. */
export function loader(mount: MountShell): (ctx: SpindleFrontendContext) => () => void {
  return (ctx) => {
    const road = pageRoad(ctx);
    const tab = ctx.ui.registerDrawerTab(TAB);
    const mounted = mount({ root: tab.root, ctx, road });
    const panels: PanelsGrant = (listener) => road.onPermissions((missing) => listener(!missing.some((m) => m.permission === "ui_panels")));
    const surfaces = mounted.surfaces === undefined ? null : keepSurfaces(ctx, mounted.surfaces, panels);
    return () => {
      surfaces?.();
      mounted.unmount();
      road.stop();
      tab.destroy();
    };
  };
}
