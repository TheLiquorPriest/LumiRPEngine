// Float overlays: the fullscreen map and the palette bottom sheet, each a chromeless float widget
// (`ui_panels`), opened through the OverlayController so the drawer closes first on mobile.

import { render } from "preact";
import type { SpindleFloatWidgetHandle } from "lumiverse-spindle-types";
import type { App, PaletteTab } from "./app";
import { AppContext, useApp, useView } from "./app";
import { Empty, Toasts } from "./components";
import type { Host } from "./host";
import { mapFloatRect, sheetRect } from "./layout";
import type { FloatSurface } from "./overlay-controller";
import { OverlayController } from "./overlay-controller";
import { PaletteSheet } from "./palette";

function MapFrame(props: { fullscreen: boolean; onToggleFullscreen(): void; onClose(): void }) {
  const app = useApp();
  const view = useView();
  const panel = app.catalog.panels.find((p) => p.id === "space.map");
  return (
    <div
      class={props.fullscreen ? "lre lre-overlay-root lre-map full" : "lre lre-overlay-root lre-map"}
      data-lre-overlay="map"
      role="dialog"
      aria-label="World map"
      tabIndex={-1}
      style={{ position: "relative" }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onClose();
      }}
    >
      {view && panel ? <panel.component chatId={view.chatId} view={view.panels["space.map"] ?? null} state={view} send={app.send} /> : <Empty>No map for this chat.</Empty>}
      <div class="bar">
        <span class="title">
          <span aria-hidden="true">🗺</span> {view?.hud?.place?.name ?? "Map"}
        </span>
        <button type="button" class="lre-btn" aria-label={props.fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={props.onToggleFullscreen} data-lre-btn="fullscreen">
          <span aria-hidden="true">{props.fullscreen ? "⤡" : "⤢"}</span>
        </button>
        <button type="button" class="lre-btn" aria-label="Close map" onClick={props.onClose}>
          ✕
        </button>
      </div>
      <Toasts surface="map" />
    </div>
  );
}

/** A lazily created float widget rendering one Preact tree. */
class WidgetSurface implements FloatSurface {
  private widget: SpindleFloatWidgetHandle | null = null;

  constructor(
    private readonly create: () => SpindleFloatWidgetHandle,
    private readonly paint: (widget: SpindleFloatWidgetHandle, fullscreen: boolean) => void,
    private readonly onVisible: (visible: boolean) => void,
  ) {}

  show(fullscreen: boolean): void {
    if (!this.widget) {
      this.widget = this.create();
      this.widget.root.style.width = "100%";
      this.widget.root.style.height = "100%";
    }
    const widget = this.widget;
    widget.setVisible(true);
    if (typeof widget.setFullscreen === "function" && widget.isFullscreen() !== fullscreen) widget.setFullscreen(fullscreen);
    this.paint(widget, fullscreen);
    // Focus moves into the overlay so its Escape handler and tab order reach the player.
    widget.root.querySelector<HTMLElement>('[role="dialog"]')?.focus();
    this.onVisible(true);
  }

  hide(): void {
    if (!this.widget) return;
    if (typeof this.widget.setFullscreen === "function" && this.widget.isFullscreen()) this.widget.setFullscreen(false);
    this.widget.setVisible(false);
    this.onVisible(false);
  }

  isVisible(): boolean {
    return this.widget?.isVisible() ?? false;
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
  open(kind: "map" | "palette", tab?: PaletteTab): Promise<void>;
  close(kind: "map" | "palette"): void;
  destroy(): void;
}

export function createOverlays(app: App, host: Host): OverlaySet {
  let paletteTab: PaletteTab = "actions";
  const setOverlay = (kind: "map" | "palette", visible: boolean) =>
    app.ui.update((ui) => ({ ...ui, overlay: visible ? kind : ui.overlay === kind ? null : ui.overlay }));

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
      const rect = sheetRect(host.viewport.get(), 0.62);
      return host.ui.createFloatWidget({ width: rect.width, height: rect.height, initialPosition: { x: rect.x, y: rect.y }, chromeless: true, tooltip: "LumiRPEngine actions", mobileClamp: false });
    },
    (widget) => {
      const vp = host.viewport.get();
      const rect = sheetRect(vp, 0.62);
      widget.setSize(rect.width, rect.height);
      widget.moveTo(rect.x, rect.y);
      render(
        <AppContext.Provider value={app}>
          <div class="lre-overlay-root" data-lre-overlay="palette">
            <PaletteSheet key={`${paletteTab}:${Date.now()}`} tab={paletteTab} desk={rect.width < vp.width} onClose={() => paletteControl.close()} />
            <Toasts surface="palette" />
          </div>
        </AppContext.Provider>,
        widget.root,
      );
    },
    (visible) => setOverlay("palette", visible),
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
    inDrawer: () => app.ui.update((ui) => ({ ...ui, section: "play", playPanel: "space.map", mapInDrawer: true })),
  });
  const paletteControl = new OverlayController({
    viewport: () => host.viewport.get(),
    drawerOpen: () => host.drawer.get().open,
    closeDrawer,
    surface: { show: () => palette.show(false), hide: () => palette.hide(), isVisible: () => palette.isVisible() },
    inDrawer: () => app.toast("Close the drawer to use the action sheet.", "error"),
  });

  return {
    async open(kind, tab) {
      if (kind === "palette") {
        paletteTab = tab ?? "actions";
        map.hide();
        await paletteControl.open();
      } else {
        palette.hide();
        await mapControl.open();
      }
    },
    close(kind) {
      if (kind === "map") mapControl.close();
      else paletteControl.close();
    },
    destroy() {
      map.destroy();
      palette.destroy();
    },
  };
}
