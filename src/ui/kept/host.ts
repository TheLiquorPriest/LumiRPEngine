// What today's Build mode is given of the page it runs in (`HostBridge`, `frontend/app.ts`), in each
// shell. In Lumiverse's drawer it is Lumiverse's own context, made into the bridge as today
// (`frontend/host.ts`), as far as the light extension's permissions give it. In the web shell it is
// the page's own: a confirm, a download, the window's size, and the two controls Build mounts through
// the bridge (a switch and a select), drawn by the page itself. There, Lumiverse has no books and no
// connections to list, and no chat in which to regenerate or show a reply: each answers as the bridge
// says it does when the host has none.

import type { HostBridge } from "../../frontend/app";
import { createHost } from "../../frontend/host";
import type { Viewport } from "../../frontend/layout";
import { createStore } from "../../frontend/store";

/** Lumiverse's frontend context, as today's host bridge is made from it. */
export type LumiverseContext = Parameters<typeof createHost>[0];

/** The bridge, with what the Build page needs of the page besides. */
export interface KeptHost extends HostBridge {
  /** Puts a stylesheet in the page; the returned function takes it out. */
  addStyle(css: string): () => void;
  /** Stops following the page (its size, the drawer). */
  dispose(): void;
}

/** In Lumiverse's drawer: today's bridge over Lumiverse's own context, and its own way to add a stylesheet. */
export function lumiverseHost(ctx: LumiverseContext): KeptHost {
  return { ...createHost(ctx), addStyle: (css) => ctx.dom.addStyle(css) };
}

type Components = HostBridge["components"];

/** Where a control is mounted: the element itself, or the one a selector names. */
function slotOf(target: Element | string): HTMLElement {
  const slot = typeof target === "string" ? document.querySelector(target) : target;
  if (!(slot instanceof HTMLElement)) throw new Error(`No element to mount a control in: ${String(target)}`);
  return slot;
}

let mounted = 0;

/**
 * The controls Build mounts through the bridge (`HostSwitch`, `HostSelect` in `frontend/components.tsx`),
 * drawn as the page's own checkbox and select. The bridge's other controls (a slider, a model picker)
 * are mounted only by Settings, GM and Play, which this build does not keep.
 */
const PAGE_CONTROLS: Pick<Components, "mountSwitch" | "mountSelect"> = {
  mountSwitch(target, options = {}) {
    const element = slotOf(target);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "rpe-kept-switch";
    input.setAttribute("role", "switch");
    let held = options;
    const apply = (): void => {
      input.checked = held.checked === true;
      input.disabled = held.disabled === true;
      if (held.ariaLabel !== undefined) input.setAttribute("aria-label", held.ariaLabel);
    };
    const changed = (): void => held.onChange?.(input.checked);
    apply();
    input.addEventListener("change", changed);
    element.replaceChildren(input);
    mounted += 1;
    return {
      componentId: `rpe-kept-${mounted}`,
      element,
      update(patch) {
        held = { ...held, ...patch };
        apply();
      },
      destroy() {
        input.removeEventListener("change", changed);
        element.replaceChildren();
      },
      getValue: () => input.checked,
    };
  },
  mountSelect(target, options) {
    const element = slotOf(target);
    const select = document.createElement("select");
    select.className = "lre-input";
    let held = options;
    const apply = (): void => {
      // As Lumiverse's select: no value shows the placeholder, which cannot be picked again.
      const placeholder = held.placeholder === undefined ? [] : [Object.assign(document.createElement("option"), { value: "", disabled: true, textContent: held.placeholder })];
      const choices = (held.options ?? []).map((choice) => Object.assign(document.createElement("option"), { value: choice.value, disabled: choice.disabled === true, textContent: choice.label, title: choice.sublabel ?? "" }));
      select.replaceChildren(...placeholder, ...choices);
      select.value = held.value ?? "";
      select.disabled = held.disabled === true;
      if (held.ariaLabel !== undefined) select.setAttribute("aria-label", held.ariaLabel);
    };
    const changed = (): void => held.onChange?.(select.value);
    apply();
    select.addEventListener("change", changed);
    element.replaceChildren(select);
    mounted += 1;
    return {
      componentId: `rpe-kept-${mounted}`,
      element,
      update(patch) {
        held = { ...held, ...patch };
        apply();
      },
      destroy() {
        select.removeEventListener("change", changed);
        element.replaceChildren();
      },
      getValue: () => select.value,
      open: () => select.showPicker(),
      close: () => select.blur(),
    };
  },
};

function windowViewport(): Viewport {
  return { width: Math.round(window.innerWidth), height: Math.round(window.innerHeight), coarse: window.matchMedia?.("(pointer: coarse)").matches === true };
}

/** In the web shell: the page's own confirm, download, size and controls. The page is the surface Build is shown on, so it is always open. */
export function webHost(): KeptHost {
  const viewport = createStore<Viewport>(windowViewport());
  const resized = (): void => {
    const next = windowViewport();
    const now = viewport.get();
    if (next.width !== now.width || next.height !== now.height || next.coarse !== now.coarse) viewport.set(next);
  };
  window.addEventListener("resize", resized);
  return {
    viewport,
    drawer: createStore({ open: true }),
    // Build calls only the two controls drawn here (PAGE_CONTROLS says which, and why).
    components: PAGE_CONTROLS as Components,
    confirm: async (title, message) => window.confirm(`${title}\n\n${message}`),
    worldBooks: async () => [],
    connections: async () => [],
    download(fileName, text) {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const anchor = Object.assign(document.createElement("a"), { href: url, download: fileName });
      anchor.style.display = "none";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // As today's bridge: long enough for the browser to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    activeChat: () => null,
    generate: async () => false,
    revealMessage: () => false,
    addStyle(css) {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
      return () => style.remove();
    },
    dispose() {
      window.removeEventListener("resize", resized);
    },
  };
}
