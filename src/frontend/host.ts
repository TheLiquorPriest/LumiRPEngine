// The host capabilities the UI uses, over `SpindleFrontendContext` with the runtime `ctx.ui`
// shape from `spindle-augment` (DESIGN §18.6). Optional host APIs are feature-detected.

import { isRecord } from "../shared/json";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { HostUi } from "../spindle-augment";
import type { DrawerState, HostBridge } from "./app";
import type { Viewport } from "./layout";
import { createStore } from "./store";

export interface Host extends HostBridge {
  ui: HostUi;
  dispose(): void;
}

function readViewport(ui: HostUi): Viewport {
  const size = ui.geometry ? ui.geometry.layoutViewportSize() : { width: window.innerWidth, height: window.innerHeight };
  return { width: Math.round(size.width), height: Math.round(size.height), coarse: window.matchMedia?.("(pointer: coarse)").matches === true };
}

export function createHost(ctx: SpindleFrontendContext): Host {
  const ui = ctx.ui as unknown as HostUi;
  const viewport = createStore<Viewport>(readViewport(ui));
  const drawer = createStore<DrawerState>({ open: ui.events.getDrawerState().open });
  const syncViewport = () => {
    const next = readViewport(ui);
    const current = viewport.get();
    if (next.width !== current.width || next.height !== current.height || next.coarse !== current.coarse) viewport.set(next);
  };
  window.addEventListener("resize", syncViewport);
  const coarse = window.matchMedia?.("(pointer: coarse)");
  coarse?.addEventListener("change", syncViewport);
  const offDrawer = ui.events.onDrawerChange((state) => {
    if (state.open !== drawer.get().open) drawer.set({ open: state.open });
  });
  return {
    ui,
    viewport,
    drawer,
    components: ctx.components,
    async confirm(title, message, variant, confirmLabel) {
      const result = await ui.showConfirm({ title, message, variant, confirmLabel });
      return result.confirmed;
    },
    async worldBooks() {
      if (!ctx.worldBooks) return [];
      // The typed shape is `{data, total}`; the running host returns a bare array. Accept both.
      const result: unknown = await ctx.worldBooks.list({ limit: 500 });
      const books: unknown[] = Array.isArray(result) ? result : isRecord(result) && Array.isArray(result.data) ? result.data : [];
      return books.flatMap((book) => (isRecord(book) && typeof book.id === "string" ? [{ id: book.id, name: typeof book.name === "string" ? book.name : book.id }] : []));
    },
    async connections() {
      if (!ctx.connections) return [];
      const profiles = await ctx.connections.list();
      return profiles.map((profile) => ({ id: profile.id, name: profile.name, model: profile.model || null }));
    },
    download(fileName, text) {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    activeChat: () => ctx.getActiveChat().chatId,
    async generate(as) {
      const surfaces = ctx.host.surfaces;
      if (!surfaces) return false;
      try {
        await surfaces.invoke({ kind: "command", id: as === "continue" ? "action-continue" : "action-regenerate" });
        return true;
      } catch (error) {
        console.warn(`[LumiRPEngine] ${as} failed`, error);
        return false;
      }
    },
    revealMessage(messageId) {
      const element = ctx.dom.findMessageElement(messageId);
      if (!element) return false;
      // Nothing moves under reduced motion: the jump is instant there.
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
      element.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
      return true;
    },
    dispose() {
      window.removeEventListener("resize", syncViewport);
      coarse?.removeEventListener("change", syncViewport);
      offDrawer();
    },
  };
}
