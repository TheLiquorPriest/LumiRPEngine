// Float overlays (contract §4.8): the map, the palette and the World sheet, each a chromeless float
// widget (`ui_panels`) opened through the OverlayController, so the drawer closes first on mobile.
// One shows at a time. On a phone a bottom sheet spans the width less what the host's chat heads
// cover of it, followed while it shows. Closing an overlay hands focus back to what opened it.

import { render } from "preact";
import type { SpindleFloatWidgetHandle } from "lumiverse-spindle-types";
import type { App, PaletteTab, UiState } from "./app";
import { AppContext, playAt, useApp, useView } from "./app";
import { watchChatHeads } from "./chat-heads";
import { Empty, IconButton, Toasts } from "./components";
import type { Host } from "./host";
import { WorldSheet } from "./hud";
import { Icon } from "./icons";
import type { Rect } from "./layout";
import { isMobile, mapFloatRect, sheetRect } from "./layout";
import type { FloatSurface } from "./overlay-controller";
import { OverlayController } from "./overlay-controller";
import { PaletteSheet } from "./palette";

export type OverlayKind = NonNullable<UiState["overlay"]>;

/** The palette's share of the viewport's height. */
const PALETTE_HEIGHT = 0.62;

function MapFrame(props: { fullscreen: boolean; onToggleFullscreen(): void; onClose(): void }) {
  const app = useApp();
  const view = useView();
  const panel = app.catalog.panels.find((p) => p.id === "space.map");
  return (
    <div
      class={props.fullscreen ? "lre lre-overlay-root lre-chat-mapframe full" : "lre lre-overlay-root lre-chat-mapframe"}
      data-lre-overlay="map"
      role="dialog"
      aria-label="World map"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onClose();
      }}
    >
      {view && panel ? (
        <panel.component chatId={view.chatId} view={view.panels["space.map"] ?? null} state={view} send={app.send} />
      ) : (
        <Empty icon="map" title="No map">
          This chat has no map.
        </Empty>
      )}
      <div class="lre-chat-mapbar">
        <span class="lre-chat-mapbar-title">
          <Icon name="map" size={16} />
          <span>{view?.hud?.place?.name ?? "Map"}</span>
        </span>
        <IconButton icon={props.fullscreen ? "shrink" : "expand"} label={props.fullscreen ? "Exit fullscreen" : "Fullscreen"} variant="secondary" onClick={props.onToggleFullscreen} />
        <IconButton icon="close" label="Close map" variant="secondary" onClick={props.onClose} />
      </div>
      <Toasts surface="map" />
    </div>
  );
}

/** A lazily created float widget rendering one Preact tree. */
class WidgetSurface implements FloatSurface {
  private widget: SpindleFloatWidgetHandle | null = null;
  /** What had focus when the overlay opened; closing it hands focus back (contract §5.7). */
  private opener: HTMLElement | null = null;

  constructor(
    private readonly create: () => SpindleFloatWidgetHandle,
    private readonly paint: (widget: SpindleFloatWidgetHandle, fullscreen: boolean) => void,
    private readonly onVisible: (visible: boolean) => void,
    /** Sizes and moves a sheet's widget for the viewport and the chat heads as they are now. */
    private readonly place: ((widget: SpindleFloatWidgetHandle) => void) | null = null,
  ) {}

  show(fullscreen: boolean): void {
    if (!this.widget) {
      this.widget = this.create();
      this.widget.root.style.width = "100%";
      this.widget.root.style.height = "100%";
    }
    const widget = this.widget;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && !widget.root.contains(focused)) this.opener = focused;
    widget.setVisible(true);
    if (typeof widget.setFullscreen === "function" && widget.isFullscreen() !== fullscreen) widget.setFullscreen(fullscreen);
    this.place?.(widget);
    this.paint(widget, fullscreen);
    // Focus moves into the overlay so its Escape handler and tab order reach the player.
    widget.root.querySelector<HTMLElement>('[role="dialog"]')?.focus();
    this.onVisible(true);
  }

  hide(): void {
    if (!this.widget) return;
    const focused = document.activeElement;
    // Hiding drops focus held inside the overlay; it goes back to the opener when that is still on the page.
    const inside = focused instanceof Node && this.widget.root.contains(focused);
    if (typeof this.widget.setFullscreen === "function" && this.widget.isFullscreen()) this.widget.setFullscreen(false);
    this.widget.setVisible(false);
    this.onVisible(false);
    if (inside && this.opener?.isConnected) this.opener.focus();
    this.opener = null;
  }

  isVisible(): boolean {
    return this.widget?.isVisible() ?? false;
  }

  /** Re-places a showing sheet: the chat heads moved, or its content changed height. */
  relayout(): void {
    if (this.widget && this.widget.isVisible()) this.place?.(this.widget);
  }

  toggleFullscreen(): void {
    const widget = this.widget;
    if (!widget || typeof widget.setFullscreen !== "function") return;
    const next = !widget.isFullscreen();
    widget.setFullscreen(next);
    this.paint(widget, next);
  }

  destroy(): void {
    if (!this.widget) return;
    render(null, this.widget.root);
    this.widget.destroy();
    this.widget = null;
  }
}

export interface OverlaySet {
  open(kind: OverlayKind, tab?: PaletteTab): Promise<void>;
  close(kind: OverlayKind): void;
  destroy(): void;
}

export function createOverlays(app: App, host: Host): OverlaySet {
  let paletteTab: PaletteTab = "actions";
  /** The World sheet's height as its content last measured it; a first guess until then. */
  let worldHeight = 0;
  const setOverlay = (kind: OverlayKind, visible: boolean) => app.ui.update((ui) => ({ ...ui, overlay: visible ? kind : ui.overlay === kind ? null : ui.overlay }));

  // The chat heads are watched only while a sheet shows on a phone: elsewhere they change nothing.
  let heads: { get(): Rect[]; stop(): void } | null = null;
  const sheetHeads = (): Rect[] => {
    if (!isMobile(host.viewport.get())) return [];
    if (!heads) {
      // In the host's layout pixels, as the viewport is read; the rendered rect where the host has no geometry API.
      const geometry = host.ui.geometry;
      const watch = watchChatHeads(geometry ? (el) => geometry.layoutElementRect(el) : undefined);
      const off = watch.subscribe(() => {
        palette.relayout();
        world.relayout();
      });
      heads = {
        get: watch.get,
        stop() {
          off();
          watch.dispose();
        },
      };
    }
    return heads.get();
  };
  const sheetShown = (kind: OverlayKind, visible: boolean) => {
    setOverlay(kind, visible);
    if (visible || palette.isVisible() || world.isVisible()) return;
    heads?.stop();
    heads = null;
  };
  const placeSheet = (widget: SpindleFloatWidgetHandle, height: number) => {
    const rect = sheetRect(host.viewport.get(), height, sheetHeads());
    widget.setSize(rect.width, rect.height);
    widget.moveTo(rect.x, rect.y);
  };

  const map: WidgetSurface = new WidgetSurface(
    () => {
      const rect = mapFloatRect(host.viewport.get());
      return host.ui.createFloatWidget({ width: rect.width, height: rect.height, initialPosition: { x: rect.x, y: rect.y }, chromeless: true, tooltip: "LumiRPEngine map", resizable: true, persistGeometry: rect.key, bounds: { minWidth: 280, minHeight: 240 } });
    },
    (widget, fullscreen) =>
      render(
        <AppContext.Provider value={app}>
          <MapFrame fullscreen={fullscreen} onToggleFullscreen={() => map.toggleFullscreen()} onClose={() => mapControl.close()} />
        </AppContext.Provider>,
        widget.root,
      ),
    (visible) => setOverlay("map", visible),
  );

  const palette: WidgetSurface = new WidgetSurface(
    () => {
      const vp = host.viewport.get();
      const rect = sheetRect(vp, vp.height * PALETTE_HEIGHT);
      return host.ui.createFloatWidget({ width: rect.width, height: rect.height, initialPosition: { x: rect.x, y: rect.y }, chromeless: true, tooltip: "LumiRPEngine actions", mobileClamp: false });
    },
    (widget) =>
      render(
        <AppContext.Provider value={app}>
          <div class="lre lre-overlay-root" data-lre-overlay="palette">
            <PaletteSheet key={`${paletteTab}:${Date.now()}`} tab={paletteTab} desk={!isMobile(host.viewport.get())} onClose={() => paletteControl.close()} />
            <Toasts surface="palette" />
          </div>
        </AppContext.Provider>,
        widget.root,
      ),
    (visible) => sheetShown("palette", visible),
    (widget) => placeSheet(widget, host.viewport.get().height * PALETTE_HEIGHT),
  );

  const world: WidgetSurface = new WidgetSurface(
    () => {
      const vp = host.viewport.get();
      const rect = sheetRect(vp, vp.height / 2);
      return host.ui.createFloatWidget({ width: rect.width, height: rect.height, initialPosition: { x: rect.x, y: rect.y }, chromeless: true, tooltip: "LumiRPEngine world", mobileClamp: false });
    },
    (widget) =>
      render(
        <AppContext.Provider value={app}>
          <div class="lre lre-overlay-root" data-lre-overlay="world">
            <WorldSheet
              key={Date.now()}
              desk={!isMobile(host.viewport.get())}
              onClose={() => worldControl.close()}
              onHeight={(height) => {
                if (height === worldHeight) return;
                worldHeight = height;
                world.relayout();
              }}
            />
            <Toasts surface="world" />
          </div>
        </AppContext.Provider>,
        widget.root,
      ),
    (visible) => sheetShown("world", visible),
    (widget) => placeSheet(widget, worldHeight > 0 ? worldHeight : host.viewport.get().height / 2),
  );

  const closeDrawer = async (): Promise<boolean> => {
    const message = await app.send({ type: "lre.ui", op: "close_drawer" });
    return message.type === "lre.result";
  };
  const mapControl = new OverlayController({
    viewport: () => host.viewport.get(),
    drawerOpen: () => host.drawer.get().open,
    closeDrawer,
    surface: map,
    inDrawer: () => app.ui.update((ui) => playAt(ui, "places", "space.map")),
  });
  const paletteControl = new OverlayController({
    viewport: () => host.viewport.get(),
    drawerOpen: () => host.drawer.get().open,
    closeDrawer,
    surface: { show: () => palette.show(false), hide: () => palette.hide(), isVisible: () => palette.isVisible() },
    inDrawer: () => app.toast("Close the drawer to use the action sheet.", "error"),
  });
  const worldControl = new OverlayController({
    viewport: () => host.viewport.get(),
    drawerOpen: () => host.drawer.get().open,
    closeDrawer,
    surface: { show: () => world.show(false), hide: () => world.hide(), isVisible: () => world.isVisible() },
    // Play → Now shows the same details, with the same fixes, where the drawer can't close.
    inDrawer: () => app.ui.update((ui) => playAt(ui, "now")),
  });
  const surfaces: Record<OverlayKind, WidgetSurface> = { map, palette, world };
  const controls: Record<OverlayKind, OverlayController> = { map: mapControl, palette: paletteControl, world: worldControl };

  return {
    async open(kind, tab) {
      for (const other of ["map", "palette", "world"] as const) if (other !== kind) surfaces[other].hide();
      if (kind === "palette") paletteTab = tab ?? "actions";
      await controls[kind].open();
    },
    close(kind) {
      controls[kind].close();
    },
    destroy() {
      map.destroy();
      palette.destroy();
      world.destroy();
      heads?.stop();
      heads = null;
    },
  };
}
