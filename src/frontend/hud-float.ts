// The HUD pill's float widget across layouts (DESIGN §12): phone and desktop each save the pill's
// geometry under their own key (`hudFloatRect`). The host restores saved geometry only when it
// creates a widget, so a viewport that crosses the phone breakpoint needs a new widget under the
// other layout's key; otherwise the pill keeps the old layout's position until a reload.

import type { Rect, Viewport } from "./layout";
import { hudFloatRect } from "./layout";

export interface HudFloatDeps<W> {
  viewport(): Viewport;
  /** Creates and renders the widget at `rect`, its geometry saved under `rect.key`. */
  create(rect: Rect & { key: string }): W;
  /** Unmounts and destroys a widget. */
  destroy(widget: W): void;
}

export class HudFloat<W> {
  private current: { widget: W; key: string } | null = null;

  constructor(private readonly deps: HudFloatDeps<W>) {}

  /** The widget, created for the current layout on first use. */
  ensure(): W {
    if (this.current) return this.current.widget;
    const rect = hudFloatRect(this.deps.viewport());
    this.current = { widget: this.deps.create(rect), key: rect.key };
    return this.current.widget;
  }

  /** The widget if it exists. */
  get(): W | null {
    return this.current?.widget ?? null;
  }

  /**
   * After a viewport change: destroys a widget made for the other layout and returns true, so the
   * caller creates it again (when it should show) at this layout's saved geometry.
   */
  relayout(): boolean {
    if (!this.current || hudFloatRect(this.deps.viewport()).key === this.current.key) return false;
    this.dispose();
    return true;
  }

  dispose(): void {
    if (!this.current) return;
    const { widget } = this.current;
    this.current = null;
    this.deps.destroy(widget);
  }
}
