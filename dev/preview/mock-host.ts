// A mock Lumiverse frontend host for the preview harness: drawer tab (full-width with the host tab
// row and a "title ✕" header on phones, as the real host draws it), float widgets (stacked under the
// drawer on mobile, as DESIGN §12 describes), optional chat heads, DOM decorators over static chat and
// message anchors, input-bar actions, simple stand-ins for the host components, and the messaging bridge.

import type { SpindleFrontendContext, SpindleModelComboboxOptions, SpindleNumberStepperOptions, SpindleRangeSliderOptions, SpindleSelectOptions, SpindleSwitchOptions } from "lumiverse-spindle-types";
import type { DecoratorRenderContext, DomDecoratorOptions, FloatWidgetOptions } from "../../src/spindle-augment";

type Listener<T> = (value: T) => void;

export interface MockHost {
  ctx: SpindleFrontendContext;
  deliver(payload: unknown): void;
  onSend: (payload: unknown) => void;
  setDrawer(open: boolean): void;
  drawerOpen(): boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function handle<O>(element: HTMLElement, getValue: () => unknown, update: (patch: Partial<O>) => void) {
  return { componentId: `mock-${Math.random().toString(36).slice(2)}`, element, update, getValue, destroy: () => element.replaceChildren(), focus: () => {}, blur: () => {}, open: () => {}, close: () => {} };
}

/** Host actions the harness invoked through `ctx.host.surfaces` (Retry → regenerate). */
export const hostActions: string[] = [];

export interface MockHostOptions {
  drawerOpen: boolean;
  /** Draw three host chat heads (`data-head-idx`) at the right edge, above the drawer. */
  heads: boolean;
}

export function createMockHost(options: MockHostOptions): MockHost {
  const backendListeners = new Set<Listener<unknown>>();
  const drawerListeners = new Set<Listener<{ open: boolean; tabId: string | null }>>();
  let drawerOpen = options.drawerOpen;
  const drawer = document.getElementById("drawer") as HTMLElement;
  const drawerPanel = document.getElementById("drawer-panel") as HTMLElement;
  const drawerTitle = document.getElementById("drawer-title-text") as HTMLElement;
  const floats = document.getElementById("floats") as HTMLElement;
  const extras = document.getElementById("extras") as HTMLElement;
  if (options.heads) {
    const heads = document.getElementById("chatheads") as HTMLElement;
    for (let idx = 0; idx < 3; idx++) heads.appendChild(el("div", { "data-head-idx": String(idx), role: "button", "aria-label": `Chat head ${idx + 1}` }));
  }
  const applyDrawer = () => {
    drawer.dataset.open = String(drawerOpen);
    document.body.dataset.drawer = drawerOpen ? "open" : "closed";
    for (const listener of drawerListeners) listener({ open: drawerOpen, tabId: drawerOpen ? "lumirpengine" : null });
  };
  applyDrawer();
  (document.getElementById("drawer-toggle") as HTMLElement).addEventListener("click", () => {
    drawerOpen = !drawerOpen;
    applyDrawer();
  });
  const closeDrawer = () => {
    drawerOpen = false;
    applyDrawer();
  };
  (document.getElementById("drawer-backdrop") as HTMLElement).addEventListener("click", closeDrawer);
  (document.getElementById("drawer-close") as HTMLElement).addEventListener("click", closeDrawer);

  // The host's Extras popover; the mock lists two host items and closes on a pick or an outside click.
  const extrasToggle = document.getElementById("extras-toggle") as HTMLElement;
  const extrasPopover = document.getElementById("extras-popover") as HTMLElement;
  const setExtras = (open: boolean) => {
    extrasPopover.hidden = !open;
    extrasToggle.setAttribute("aria-expanded", String(open));
  };
  extrasToggle.addEventListener("click", () => setExtras(extrasToggle.getAttribute("aria-expanded") !== "true"));
  extrasPopover.addEventListener("click", () => setExtras(false));
  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && !extrasPopover.contains(event.target) && !extrasToggle.contains(event.target)) setExtras(false);
  });

  const host: MockHost = {
    onSend: () => {},
    deliver(payload) {
      for (const listener of backendListeners) listener(structuredClone(payload));
    },
    setDrawer(open) {
      drawerOpen = open;
      applyDrawer();
    },
    drawerOpen: () => drawerOpen,
    ctx: null as unknown as SpindleFrontendContext,
  };

  const ui = {
    events: {
      getDrawerState: () => ({ open: drawerOpen, tabId: drawerOpen ? "lumirpengine" : null }),
      onDrawerChange(listener: Listener<{ open: boolean; tabId: string | null }>) {
        drawerListeners.add(listener);
        return () => drawerListeners.delete(listener);
      },
      getKeyboardState: () => ({ visible: false, insetBottom: 0, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }),
      onKeyboardChange: () => () => {},
    },
    geometry: {
      getUiScale: () => 1,
      toLayoutPx: (px: number) => px,
      layoutViewportSize: () => ({ width: window.innerWidth, height: window.innerHeight }),
      layoutElementRect: (node: Element) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      },
      createResizeController: () => () => {},
    },
    registerDrawerTab(options: { id: string; title: string }) {
      const root = el("div", { "data-tab": options.id });
      drawerTitle.textContent = options.title;
      drawerPanel.appendChild(root);
      return { root, tabId: options.id, setTitle: () => {}, setShortName: () => {}, setBadge: () => {}, activate: () => host.setDrawer(true), destroy: () => root.remove(), onActivate: () => () => {} };
    },
    createFloatWidget(options: FloatWidgetOptions = {}) {
      const root = el("div", { class: "float", "data-tooltip": options.tooltip ?? "" });
      let visible = true;
      let fullscreen = false;
      const pos = { x: options.initialPosition?.x ?? 16, y: options.initialPosition?.y ?? 16 };
      const size = { width: options.width ?? 200, height: options.height ?? 200 };
      // Like the host, a widget with `persistGeometry` reopens at its saved geometry (first open saves it).
      const saveKey = typeof options.persistGeometry === "string" ? `lre-preview-geometry:${options.persistGeometry}` : null;
      const saved: unknown = saveKey ? JSON.parse(localStorage.getItem(saveKey) ?? "null") : null;
      if (saved && typeof saved === "object" && "width" in saved && "height" in saved && "x" in saved && "y" in saved && [saved.width, saved.height, saved.x, saved.y].every((n) => typeof n === "number")) {
        Object.assign(size, { width: saved.width, height: saved.height });
        Object.assign(pos, { x: saved.x, y: saved.y });
      } else if (saveKey) localStorage.setItem(saveKey, JSON.stringify({ ...pos, ...size }));
      const paint = () => {
        root.style.display = visible ? "block" : "none";
        root.classList.toggle("full", fullscreen);
        if (!fullscreen) Object.assign(root.style, { left: `${pos.x}px`, top: `${pos.y}px`, width: `${size.width}px`, height: `${size.height}px` });
        else Object.assign(root.style, { left: "0", top: "0", width: "100vw", height: "100vh" });
      };
      paint();
      floats.appendChild(root);
      // Like the host, the widget's root goes into the page only after the frame its widget mounts in,
      // so whatever renders into it first runs its effects while it is still detached.
      const inner = el("div");
      requestAnimationFrame(() => requestAnimationFrame(() => root.appendChild(inner)));
      return {
        root: inner,
        widgetId: `w-${Math.random().toString(36).slice(2)}`,
        moveTo(x: number, y: number) {
          pos.x = x;
          pos.y = y;
          paint();
        },
        getPosition: () => ({ ...pos }),
        setSize(width: number, height: number) {
          size.width = width;
          size.height = height;
          paint();
        },
        setVisible(next: boolean) {
          visible = next;
          paint();
        },
        isVisible: () => visible,
        setFullscreen(next: boolean) {
          fullscreen = next;
          paint();
        },
        isFullscreen: () => fullscreen,
        setTouchScrollMode: () => {},
        destroy: () => root.remove(),
        onDragEnd: () => () => {},
      };
    },
    registerDomDecorator(options: DomDecoratorOptions) {
      const cleanups: (() => void)[] = [];
      for (const anchor of document.querySelectorAll<HTMLElement>(`[data-spindle-mount="${options.mount}"]`)) {
        const root = el("div", { "data-decorator": options.mount });
        anchor.appendChild(root);
        const context: DecoratorRenderContext = { mount: options.mount, scope: anchor.dataset.spindleScope ?? "", liveAnchorId: anchor.id || "a", owner: "lumi_rp_engine", generation: 1, node: anchor, root };
        const cleanup = options.render?.(root, context);
        cleanups.push(() => {
          if (typeof cleanup === "function") cleanup();
          root.remove();
        });
      }
      return () => cleanups.forEach((cleanup) => cleanup());
    },
    registerInputBarAction(options: { id: string; label: string; enabled?: boolean }) {
      const button = el("button", { type: "button", "data-action": options.id }, options.label);
      button.style.display = options.enabled === false ? "none" : "";
      extras.appendChild(button);
      const handlers = new Set<() => void>();
      button.addEventListener("click", () => handlers.forEach((h) => h()));
      return {
        actionId: options.id,
        setLabel: (label: string) => {
          button.textContent = label;
        },
        setEnabled: (enabled: boolean) => {
          button.style.display = enabled ? "" : "none";
        },
        onClick(handler: () => void) {
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
        destroy: () => button.remove(),
      };
    },
    // The browser's own confirm, so a question the extension asks shows and can be answered here.
    showConfirm: async (options: { title: string; message: string }) => ({ confirmed: window.confirm(`${options.title}\n\n${options.message}`) }),
  };

  const components = {
    mountRangeSlider(target: HTMLElement, options: SpindleRangeSliderOptions) {
      const wrap = el("div", { class: "mock-slider" });
      const header = el("div", { class: "mock-slider-head" });
      const input = el("input", { type: "range", min: String(options.min), max: String(options.max), step: String(options.step ?? 1) });
      input.value = String(options.value ?? options.min);
      const head = () => {
        if (options.label) header.textContent = `${options.label} — ${input.value}${options.format?.suffix ?? ""}`;
      };
      head();
      input.addEventListener("input", () => {
        head();
        options.onDragValue?.(Number(input.value));
      });
      input.addEventListener("change", () => options.onCommit?.(Number(input.value)));
      if (options.label) wrap.appendChild(header);
      wrap.appendChild(input);
      target.replaceChildren(wrap);
      return handle<SpindleRangeSliderOptions>(target, () => Number(input.value), (patch) => {
        // Like the host, an update changes only what it names.
        if (typeof patch.value === "number") input.value = String(patch.value);
        if ("disabled" in patch) input.disabled = patch.disabled === true;
        head();
      });
    },
    mountSwitch(target: HTMLElement, options: SpindleSwitchOptions = {}) {
      const input = el("input", { type: "checkbox", class: "mock-switch" });
      input.checked = options.checked === true;
      input.addEventListener("change", () => options.onChange?.(input.checked));
      target.replaceChildren(input);
      return handle<SpindleSwitchOptions>(target, () => input.checked, (patch) => {
        if (typeof patch.checked === "boolean") input.checked = patch.checked;
      });
    },
    mountNumberStepper(target: HTMLElement, options: SpindleNumberStepperOptions = {}) {
      const wrap = el("div", { class: "mock-stepper" });
      const minus = el("button", { type: "button" }, "−");
      const input = el("input", { inputmode: "decimal" });
      const plus = el("button", { type: "button" }, "+");
      const step = options.step ?? 1;
      input.value = options.value === null || options.value === undefined ? "" : String(options.value);
      const commit = (value: number) => {
        input.value = String(value);
        options.onChange?.(value);
      };
      minus.addEventListener("click", () => commit(Number(input.value || 0) - step));
      plus.addEventListener("click", () => commit(Number(input.value || 0) + step));
      input.addEventListener("change", () => commit(Number(input.value)));
      wrap.append(minus, input, plus);
      target.replaceChildren(wrap);
      return handle<SpindleNumberStepperOptions>(target, () => Number(input.value), (patch) => {
        if (typeof patch.value === "number") input.value = String(patch.value);
      });
    },
    mountSelect(target: HTMLElement, options: SpindleSelectOptions) {
      const select = el("select", { class: "mock-select" });
      let placeholder = options.placeholder;
      // As the host's select: an empty value shows the placeholder, which can't be picked again.
      const fill = (opts: SpindleSelectOptions["options"]) =>
        select.replaceChildren(...(placeholder ? [el("option", { value: "", disabled: "" }, placeholder)] : []), ...(opts ?? []).map((o) => el("option", { value: o.value }, o.label)));
      fill(options.options);
      select.value = options.value ?? "";
      select.addEventListener("change", () => options.onChange?.(select.value));
      target.replaceChildren(select);
      let current = options.options;
      return handle<SpindleSelectOptions>(target, () => select.value, (patch) => {
        const value = select.value;
        if (patch.placeholder !== undefined) placeholder = patch.placeholder;
        if (patch.options) current = patch.options;
        if (patch.options || patch.placeholder !== undefined) {
          fill(current);
          select.value = value;
        }
        if (typeof patch.value === "string") select.value = patch.value;
      });
    },
    mountModelCombobox(target: HTMLElement, options: SpindleModelComboboxOptions) {
      const input = el("input", { class: "mock-select", list: "mock-models" });
      input.value = options.value ?? "";
      const list = el("datalist", { id: "mock-models" });
      for (const model of ["deepseek-v4-flash", "deepseek-v4-pro"]) list.appendChild(el("option", { value: model }));
      input.addEventListener("change", () => options.onChange?.(input.value));
      target.replaceChildren(input, list);
      return handle<SpindleModelComboboxOptions>(target, () => input.value, () => {});
    },
  };

  const activeListeners = new Set<Listener<{ chatId: string | null }>>();
  host.ctx = {
    ui,
    components,
    dom: {
      addStyle(css: string) {
        const style = el("style", {}, css);
        document.head.appendChild(style);
        return () => style.remove();
      },
      findMessageElement: (messageId: string) => document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`),
    },
    events: { on: () => () => {}, emit: () => {} },
    host: {
      surfaces: {
        invoke: async (ref: { kind: string; id: string }) => {
          hostActions.push(`${ref.kind}:${ref.id}`);
        },
      },
    },
    state: {
      get: () => ({ chatId: "chat-1" }),
      subscribe(_selector: string, listener: Listener<{ chatId: string | null }>) {
        activeListeners.add(listener);
        return () => activeListeners.delete(listener);
      },
    },
    getActiveChat: () => ({ chatId: "chat-1", characterId: "maple" }),
    sendToBackend: (payload: unknown) => host.onSend(structuredClone(payload)),
    onBackendMessage(listener: Listener<unknown>) {
      backendListeners.add(listener);
      return () => backendListeners.delete(listener);
    },
    worldBooks: {
      list: async () => ({
        data: [
          { id: "book-engine", name: "Maple Falls (engine)" },
          { id: "book-sam", name: "Sam's backstory" },
          { id: "book-town", name: "Town lore" },
        ],
        total: 3,
      }),
    },
    connections: {
      list: async () => [
        { id: "conn-ds", name: "Deepseek", model: "deepseek-v4-flash" },
        { id: "conn-ds-pro", name: "Deepseek Pro", model: "deepseek-v4-pro" },
      ],
    },
  } as unknown as SpindleFrontendContext;
  return host;
}
