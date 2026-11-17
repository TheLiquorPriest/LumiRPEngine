// What the kept views (Build, Play, the chat's surfaces) are given of the page they run in
// (`HostBridge`, `frontend/app.ts`), in each shell. In Lumiverse's drawer it is Lumiverse's own
// context, made into the bridge as today (`frontend/host.ts`, `lumiverseHost`, which the extension
// shell's mount calls: no file here takes Spindle's types). In the web shell it is the page's own: a
// confirm, a download, the window's size, and the four controls the kept views mount through the
// bridge (a switch, a select, a slider and a model picker), drawn by the page itself. There, Lumiverse
// has no books and no connections to list, and no chat in which to regenerate or show a reply: each
// answers as the bridge says it does when the host has none.

import type { ControlTarget, HostBridge, HostControls, ModelPickerOptions, SelectOptions, SliderOptions, SwitchOptions } from "../../frontend/app";
import type { Viewport } from "../../frontend/layout";
import { createStore } from "../store";

/** The bridge, with what the kept views need of the page besides. */
export interface KeptHost extends HostBridge {
  /** Puts a stylesheet in the page; the returned function takes it out. */
  addStyle(css: string): () => void;
  /** Stops following the page (its size, the drawer). */
  dispose(): void;
}

/** What the web shell's bridge reads of the page's settings, at each use. */
export interface WebHostOptions {
  /** How long a download's link is kept before the browser lets it go (ms): `pages.downloadRevokeMs`. */
  revokeMs(): number;
  /** The connections RPE lists (`GET /api/v1/connections`), for the model picker's choice of one; none where the page lists none. */
  connections?(): Promise<{ id: string; name: string; model: string | null }[]>;
  /** His books as Build's pickers list them (`GET /api/v1/build/lore/books`); none where the page lists none. */
  worldBooks?(): Promise<{ id: string; name: string }[]>;
}

/** Where a control is mounted: the element itself, or the one a selector names. */
function slotOf(target: ControlTarget): HTMLElement {
  const slot = typeof target === "string" ? document.querySelector(target) : target;
  if (!(slot instanceof HTMLElement)) throw new Error(`No element to mount a control in: ${String(target)}`);
  return slot;
}

let mounted = 0;

/** A control's handle over the options it holds: `update` merges a patch and draws again, `destroy` empties its place. */
function handleOf<O>(element: HTMLElement, held: { value: O }, draw: () => void, stop: () => void) {
  mounted += 1;
  return {
    componentId: `rpe-kept-${mounted}`,
    element,
    update(patch: Partial<O>): void {
      held.value = { ...held.value, ...patch };
      draw();
    },
    destroy(): void {
      stop();
      element.replaceChildren();
    },
  };
}

/** The page's own controls: the four the kept views mount through the bridge (`HostSwitch`, `HostSelect`, `HostSlider`, `HostModelPicker` in `frontend/components.tsx`). */
export const PAGE_CONTROLS: HostControls = {
  mountSwitch(target, options = {}) {
    const element = slotOf(target);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "rpe-kept-switch";
    input.setAttribute("role", "switch");
    const held = { value: options as SwitchOptions };
    const draw = (): void => {
      input.checked = held.value.checked === true;
      input.disabled = held.value.disabled === true;
      if (held.value.ariaLabel !== undefined) input.setAttribute("aria-label", held.value.ariaLabel);
    };
    const changed = (): void => held.value.onChange?.(input.checked);
    draw();
    input.addEventListener("change", changed);
    element.replaceChildren(input);
    return { ...handleOf(element, held, draw, () => input.removeEventListener("change", changed)), getValue: () => input.checked };
  },
  mountSelect(target, options) {
    const element = slotOf(target);
    const select = document.createElement("select");
    select.className = "lre-input";
    const held = { value: options as SelectOptions };
    const draw = (): void => {
      // As Lumiverse's select: no value shows the placeholder, which cannot be picked again.
      const placeholder = held.value.placeholder === undefined ? [] : [Object.assign(document.createElement("option"), { value: "", disabled: true, textContent: held.value.placeholder })];
      const choices = (held.value.options ?? []).map((choice) => Object.assign(document.createElement("option"), { value: choice.value, disabled: choice.disabled === true, textContent: choice.label, title: choice.sublabel ?? "" }));
      select.replaceChildren(...placeholder, ...choices);
      select.value = held.value.value ?? "";
      select.disabled = held.value.disabled === true;
      if (held.value.ariaLabel !== undefined) select.setAttribute("aria-label", held.value.ariaLabel);
    };
    const changed = (): void => held.value.onChange?.(select.value);
    draw();
    select.addEventListener("change", changed);
    element.replaceChildren(select);
    return { ...handleOf(element, held, draw, () => select.removeEventListener("change", changed)), getValue: () => select.value };
  },
  mountRangeSlider(target, options) {
    const element = slotOf(target);
    const wrap = document.createElement("div");
    wrap.className = "rpe-kept-slider";
    const head = document.createElement("div");
    head.className = "rpe-kept-slider-head";
    const name = document.createElement("span");
    const shown = document.createElement("span");
    shown.className = "rpe-kept-slider-value";
    head.append(name, shown);
    const input = document.createElement("input");
    input.type = "range";
    input.className = "rpe-kept-slider-input";
    const hint = document.createElement("div");
    hint.className = "lre-muted";
    wrap.append(head, input, hint);
    const held = { value: options as SliderOptions };
    const words = (value: number): string => `${held.value.integer === true ? Math.round(value) : value}${held.value.format?.suffix ?? ""}`;
    const draw = (): void => {
      const o = held.value;
      input.min = String(o.min);
      input.max = String(o.max);
      input.step = String(o.step ?? 1);
      input.value = String(o.value ?? o.min);
      input.disabled = o.disabled === true;
      if (o.label !== undefined) input.setAttribute("aria-label", o.label);
      name.textContent = o.label ?? "";
      hint.textContent = o.hint ?? "";
      hint.hidden = o.hint === undefined;
      shown.textContent = words(Number(input.value));
    };
    // A gesture's live value shows beside the label and goes to `onDragValue`; its end commits.
    const moved = (): void => {
      shown.textContent = words(Number(input.value));
      held.value.onDragValue?.(Number(input.value));
    };
    const committed = (): void => {
      const value = Number(input.value);
      held.value = { ...held.value, value };
      held.value.onDragValue?.(null);
      held.value.onCommit?.(value);
    };
    draw();
    input.addEventListener("input", moved);
    input.addEventListener("change", committed);
    element.replaceChildren(wrap);
    return {
      ...handleOf(element, held, draw, () => {
        input.removeEventListener("input", moved);
        input.removeEventListener("change", committed);
      }),
      getValue: () => Number(input.value),
    };
  },
  mountModelCombobox(target, options) {
    const element = slotOf(target);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "lre-input";
    input.autocomplete = "off";
    input.spellcheck = false;
    const held = { value: options as ModelPickerOptions };
    const draw = (): void => {
      if (document.activeElement !== input) input.value = held.value.value ?? "";
    };
    const changed = (): void => held.value.onChange?.(input.value.trim());
    draw();
    input.addEventListener("change", changed);
    element.replaceChildren(input);
    return handleOf(element, held, draw, () => input.removeEventListener("change", changed));
  },
};

function windowViewport(): Viewport {
  return { width: Math.round(window.innerWidth), height: Math.round(window.innerHeight), coarse: window.matchMedia?.("(pointer: coarse)").matches === true };
}

/** In the web shell: the page's own confirm, download, size and controls. The page is the surface the kept views are shown on, so it is always open. */
export function webHost(options: WebHostOptions): KeptHost {
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
    components: PAGE_CONTROLS,
    confirm: async (title, message) => window.confirm(`${title}\n\n${message}`),
    worldBooks: options.worldBooks ?? (async () => []),
    connections: options.connections ?? (async () => []),
    download(fileName, text) {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const anchor = Object.assign(document.createElement("a"), { href: url, download: fileName });
      anchor.style.display = "none";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Long enough for the browser to start the download.
      setTimeout(() => URL.revokeObjectURL(url), options.revokeMs());
    },
    activeChat: () => null,
    generate: async () => false,
    closeDrawer: async () => false,
    revealMessage: async () => false,
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
