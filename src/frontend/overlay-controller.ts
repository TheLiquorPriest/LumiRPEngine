// Opening a float overlay (map, palette sheet) on a narrow viewport (DESIGN §12): the host drawer
// stacks above float widgets even when they are fullscreen, so the drawer closes first. When it
// can't be closed, the overlay renders in the drawer instead (DESIGN §12 fallback).

import type { Viewport } from "./layout";
import { overlayPlan } from "./layout";

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
}

export type OverlayOutcome = "float" | "drawer";

export class OverlayController {
  constructor(private readonly deps: OverlayDeps) {}

  async open(): Promise<OverlayOutcome> {
    const plan = overlayPlan(this.deps.viewport(), this.deps.drawerOpen());
    if (plan.closeDrawer && !(await this.deps.closeDrawer())) {
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
