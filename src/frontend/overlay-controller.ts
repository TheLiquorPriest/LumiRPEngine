// Opening a float overlay (map, palette sheet) on a narrow viewport (DESIGN §12): the host drawer
// stacks above float widgets even when they are fullscreen, so the drawer closes first; so it does at
// any width for an overlay asked for full screen, or one that lies where the drawer covers it. When it
// can't be closed on a narrow viewport, the overlay renders in the drawer instead (DESIGN §12
// fallback); on a wide one the drawer covers only its side of it, so the overlay shows as it is.

import type { Viewport } from "./layout";
import { isMobile, overlayPlan } from "./layout";

export interface FloatSurface {
  show(fullscreen: boolean): void;
  hide(): void;
  isVisible(): boolean;
}

export interface OverlayDeps {
  viewport(): Viewport;
  drawerOpen(): boolean;
  /** Asks the backend to close the drawer (`lre.ui close_drawer`); false when it could not. */
  closeDrawer(): Promise<boolean>;
  surface: FloatSurface;
  /** Renders the overlay inside the drawer instead. */
  inDrawer(): void;
  /** The overlay lies where the open drawer covers it at any width (the map, at the right edge). */
  covered?: boolean;
}

export type OverlayOutcome = "float" | "drawer";

export class OverlayController {
  constructor(private readonly deps: OverlayDeps) {}

  /** `full`: asked for full screen, at any width. */
  async open(full = false): Promise<OverlayOutcome> {
    const viewport = this.deps.viewport();
    const plan = overlayPlan(viewport, this.deps.drawerOpen(), { full, covered: this.deps.covered === true });
    if (plan.closeDrawer && !(await this.deps.closeDrawer()) && isMobile(viewport)) {
      this.deps.inDrawer();
      return "drawer";
    }
    this.deps.surface.show(plan.fullscreen);
    return "float";
  }

  close(): void {
    this.deps.surface.hide();
  }

  toggle(): Promise<OverlayOutcome | null> {
    if (!this.deps.surface.isVisible()) return this.open();
    this.close();
    return Promise.resolve(null);
  }
}
