// Frontend entry (ARCHITECTURE §2): wires the protocol client, the UI registry, the drawer tab,
// the HUD (the phone's status line above the message input, else the floating pill), message chips
// (DOM decorators), input-bar palette actions and the float overlays. It renders `StateView` only
// and sends protocol requests; it computes no world state.

import { render } from "preact";
import type { SpindleFloatWidgetHandle, SpindleFrontendContext } from "lumiverse-spindle-types";
import type { App, Draft, Toast, UiState } from "./app";
import { AppContext, initialUi, makeRequest, SHOW_IDS_KEY, switchChat } from "./app";
import { trackJobs } from "./build/jobs";
import { recheckDraft, trackDraft } from "./build/draft";
import { MessageChips, messageIdFromScope } from "./chips";
import { Toasts } from "./components";
import { Drawer } from "./drawer";
import { createHost } from "./host";
import { Hud, StatusLine } from "./hud";
import type { HudSize } from "./hud";
import { createOverlays } from "./overlays";
import { HudFloat } from "./hud-float";
import { hudCentreX, isMobile } from "./layout";
import type { OverlaySet } from "./overlays";
import { UI_PACKS } from "./packs";
import { ProtocolClient } from "./protocol-client";
import type { FrontendToBackend } from "../shared/protocol";
import { STATE_EVENT, STATE_REQUEST_EVENT, STUDIO_INBOUND, STUDIO_OFFER_EVENT } from "../shared/studio-bridge";
import type { StudioState } from "../shared/world";
import { CannotStopNotice, OPEN_DIAGNOSTICS_EVENT } from "./diagnostics";
import { ENGINE_VERSION, WORLD_FORMAT } from "../shared/world";
import { timeMarker } from "./requests";
import { createStore } from "./store";
import { CSS } from "./styles";
import { setCurrency } from "./format";
import { buildCatalog } from "./ui-registry";

const ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>`;

export function setup(ctx: SpindleFrontendContext): () => void {
  const cleanups: (() => void)[] = [];
  const host = createHost(ctx);
  cleanups.push(() => host.dispose());
  cleanups.push(ctx.dom.addStyle(CSS));

  const client = new ProtocolClient({ send: (payload: FrontendToBackend) => ctx.sendToBackend(payload), subscribe: (handler) => ctx.onBackendMessage(handler) });
  cleanups.push(() => client.dispose());
  cleanups.push(trackJobs(client));
  // Before any component's subscription, so amounts render in the new state's currency.
  cleanups.push(client.subscribe((state) => setCurrency(state.view?.currency ?? null)));
  // The studio seam (DESIGN §15): announce the engine on load, again whenever the pack set changes,
  // and again when a studio that loaded later asks.
  let announced: string | null = null;
  let packsInPlay: Record<string, number> = {};
  const announce = (packs: Record<string, number>, again = false) => {
    const key = JSON.stringify(packs);
    if (key === announced && !again) return;
    announced = key;
    packsInPlay = packs;
    const detail: StudioState = { engineVersion: ENGINE_VERSION, worldFormat: WORLD_FORMAT, packs, inbound: [...STUDIO_INBOUND] };
    window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail }));
  };
  announce({});
  cleanups.push(client.subscribe((state) => (state.view ? announce(state.view.packs) : undefined)));
  const announceAgain = () => announce(packsInPlay, true);
  window.addEventListener(STATE_REQUEST_EVENT, announceAgain);
  cleanups.push(() => window.removeEventListener(STATE_REQUEST_EVENT, announceAgain));

  // Show ids is a choice for this device: read once here, written back when it changes.
  let showIds = false;
  try {
    showIds = localStorage.getItem(SHOW_IDS_KEY) === "true";
  } catch {
    // Storage can be blocked (a private window, a sandboxed frame): ids stay hidden.
  }
  const ui = createStore<UiState>(initialUi(showIds));
  cleanups.push(
    ui.subscribe((state) => {
      if (state.showIds === showIds) return;
      showIds = state.showIds;
      try {
        localStorage.setItem(SHOW_IDS_KEY, String(showIds));
      } catch {
        // Where storage is blocked the choice holds for this session only.
      }
    }),
  );
  const toasts = createStore<Toast[]>([]);
  let toastId = 0;
  const toast = (text: string, tone: Toast["tone"] = "info") => {
    toastId += 1;
    const id = toastId;
    toasts.update((all) => [...all.slice(-2), { id, text, tone }]);
    setTimeout(() => toasts.update((all) => all.filter((entry) => entry.id !== id)), tone === "error" ? 6000 : 3500);
  };
  cleanups.push(client.onError((error) => toast(error.message, "error")));
  // The engine ran before a reply the guard stopped (DESIGN §5.1): the frontend open on that chat
  // starts it again with Lumiverse's own command; a new reply after a reply only Send can start.
  cleanups.push(
    client.onGenerate((push) => {
      if (host.activeChat() !== push.chatId) return;
      if (push.as === "send") {
        toast("The engine is ready: press Send for the reply.", "info");
        return;
      }
      const command = push.as === "continue" ? "Continue" : "Regenerate";
      void host.generate(push.as).then((started) => {
        if (!started) toast(`The engine is ready, but ${command} couldn't start here: use ${command} on the last message.`, "error");
      });
    }),
  );

  let overlays: OverlaySet | null = null;
  const app: App = {
    client,
    send: client.send,
    sync: { get: () => client.getState(), subscribe: (listener) => client.subscribe(listener) },
    catalog: buildCatalog(UI_PACKS),
    ui,
    toasts,
    host,
    drafts: createStore<Draft | null>(null),
    toast,
    request: makeRequest(client.send, toast),
    overlays: {
      openMap: () => overlays?.open("map") ?? Promise.resolve(),
      closeMap: () => overlays?.close("map"),
      openPalette: (tab) => overlays?.open("palette", tab) ?? Promise.resolve(),
      closePalette: () => overlays?.close("palette"),
      openWorld: () => overlays?.open("world") ?? Promise.resolve(),
      closeWorld: () => overlays?.close("world"),
    },
  };
  overlays = createOverlays(app, host);
  const set = overlays;
  cleanups.push(() => set.destroy());
  // A draft another window or an outside agent changes is reloaded in Build (DESIGN §23).
  cleanups.push(trackDraft(app));
  // A socket that dropped may have missed a push: Build reads its draft again once the page is back,
  // and the open chat resyncs, so a reply the engine prepared while it slept starts (DESIGN §5.1).
  const recheck = (): void => {
    void recheckDraft(app);
    client.resync();
  };
  const visible = (): void => {
    if (document.visibilityState === "visible") recheck();
  };
  window.addEventListener("online", recheck);
  document.addEventListener("visibilitychange", visible);
  cleanups.push(ctx.events.on("CONNECTED", recheck), () => window.removeEventListener("online", recheck), () => document.removeEventListener("visibilitychange", visible));

  // ------------------------------------------------------------ drawer tab
  const tab = host.ui.registerDrawerTab({
    id: "lumirpengine",
    title: "LumiRPEngine",
    shortName: "RPEngine",
    headerTitle: "LumiRPEngine",
    description: "World simulation: play, build and settings",
    keywords: ["world", "simulation", "roleplay", "map", "timelapse", "realism"],
    iconSvg: ICON,
  });
  render(
    <AppContext.Provider value={app}>
      <Drawer measure={(el) => host.ui.geometry.layoutElementRect(el)} />
      <Toasts surface="drawer" />
    </AppContext.Provider>,
    tab.root,
  );
  cleanups.push(() => {
    render(null, tab.root);
    tab.destroy();
  });
  // LumiRPEngine Studio has a world waiting (DESIGN §15): open Build's world list, where it's reviewed before anything installs.
  const reviewOffer = () => {
    ui.update((state) => ({ ...state, mode: "build", build: { view: "worlds" }, studioOffer: state.studioOffer + 1 }));
    tab.activate();
  };
  window.addEventListener(STUDIO_OFFER_EVENT, reviewOffer);
  cleanups.push(() => window.removeEventListener(STUDIO_OFFER_EVENT, reviewOffer));
  // The activity line's and the error banner's way to Diagnostics: the drawer at Settings → Diagnostics.
  const showDiagnostics = () => {
    ui.update((state) => ({ ...state, mode: "settings", settings: { page: "diagnostics" } }));
    tab.activate();
  };
  window.addEventListener(OPEN_DIAGNOSTICS_EVENT, showDiagnostics);
  cleanups.push(() => window.removeEventListener(OPEN_DIAGNOSTICS_EVENT, showDiagnostics));

  // ------------------------------------------------------------ HUD pill and status line
  // How many status lines are mounted above a message input. On a phone the status line does the
  // pill's job; a host without that mount keeps the pill.
  const statusLines = createStore(0);
  const hud = new HudFloat<SpindleFloatWidgetHandle>({
    viewport: () => host.viewport.get(),
    create(rect) {
      const widget = host.ui.createFloatWidget({ width: rect.width, height: rect.height, initialPosition: { x: rect.x, y: rect.y }, chromeless: true, tooltip: "World status", persistGeometry: rect.key });
      widget.root.style.width = "100%";
      widget.root.style.height = "100%";
      let size: HudSize = { width: 0, height: 0 };
      // Where the code last put the pill: while it is still there (the player hasn't moved it), it
      // stays centred as its content resizes it.
      let placed = { x: rect.x, y: rect.y };
      render(
        <AppContext.Provider value={app}>
          <div class="lre" style={{ width: "max-content", height: "100%" }}>
            <Hud
              resize={(next) => {
                if (next.width === size.width && next.height === size.height) return;
                size = next;
                widget.setSize(next.width, next.height);
                const at = widget.getPosition();
                if (at.x !== placed.x || at.y !== placed.y) return;
                placed = { x: hudCentreX(host.viewport.get(), next.width), y: placed.y };
                widget.moveTo(placed.x, placed.y);
              }}
            />
          </div>
        </AppContext.Provider>,
        widget.root,
      );
      return widget;
    },
    destroy(widget) {
      render(null, widget.root);
      widget.destroy();
    },
  });
  cleanups.push(() => hud.dispose());

  // ------------------------------------------------------------ input-bar palette
  const actions = host.ui.registerInputBarAction({ id: "lre-actions", label: "World actions…", enabled: false });
  const timelapse = host.ui.registerInputBarAction({ id: "lre-timelapse", label: "Timelapse…", enabled: false });
  const clock = host.ui.registerInputBarAction({ id: "lre-clock", label: "Pause clock", enabled: false });
  const mapAction = host.ui.registerInputBarAction({ id: "lre-map", label: "World map", enabled: false });
  cleanups.push(actions.onClick(() => void app.overlays.openPalette("actions")));
  cleanups.push(timelapse.onClick(() => void app.overlays.openPalette("timelapse")));
  cleanups.push(mapAction.onClick(() => void app.overlays.openMap()));
  cleanups.push(
    clock.onClick(() => {
      const view = client.getState().view;
      if (view?.hud) void app.request(timeMarker(view.chatId, "pause", { all: true }, !view.hud.clock.paused));
    }),
  );
  for (const handle of [actions, timelapse, clock, mapAction]) cleanups.push(() => handle.destroy());

  // Surfaces that follow the state: HUD visibility, input-bar actions.
  const follow = () => {
    const view = client.getState().view;
    const world = view !== null && view.status !== "not_world";
    if (world && view.hud && (!isMobile(host.viewport.get()) || statusLines.get() === 0)) hud.ensure().setVisible(true);
    else hud.get()?.setVisible(false);
    actions.setEnabled(world && view.palette !== null);
    timelapse.setEnabled(world && view.palette?.timelapse != null);
    clock.setEnabled(world && view.hud !== null);
    clock.setLabel(view?.hud?.clock.paused ? "Resume clock" : "Pause clock");
    mapAction.setEnabled(world && view.panels["space.map"] !== undefined);
  };
  cleanups.push(client.subscribe(follow));
  // Crossing the phone breakpoint moves the pill to that layout's saved geometry, and hands its job
  // to the status line or back.
  cleanups.push(
    host.viewport.subscribe(() => {
      hud.relayout();
      follow();
    }),
  );
  cleanups.push(
    host.ui.registerDomDecorator({
      mount: "chat_composer_above",
      render(root) {
        render(
          <AppContext.Provider value={app}>
            <div class="lre">
              <CannotStopNotice inChat />
              <StatusLine />
            </div>
          </AppContext.Provider>,
          root,
        );
        statusLines.update((count) => count + 1);
        return () => {
          render(null, root);
          statusLines.update((count) => count - 1);
        };
      },
    }),
  );
  // Subscribed after the decorator, so teardown stops following before the status lines unmount.
  cleanups.push(statusLines.subscribe(follow));
  follow();

  // ------------------------------------------------------------ chips and chat toasts
  cleanups.push(
    host.ui.registerDomDecorator({
      mount: "message_body_after",
      render(root, decorator) {
        const messageId = messageIdFromScope(decorator.scope);
        if (!messageId) return;
        render(
          <AppContext.Provider value={app}>
            <div class="lre">
              <MessageChips messageId={messageId} />
            </div>
          </AppContext.Provider>,
          root,
        );
        return () => render(null, root);
      },
      update(root, decorator) {
        const messageId = messageIdFromScope(decorator.scope);
        if (!messageId) return;
        render(
          <AppContext.Provider value={app}>
            <div class="lre">
              <MessageChips messageId={messageId} />
            </div>
          </AppContext.Provider>,
          root,
        );
      },
    }),
  );
  cleanups.push(
    host.ui.registerDomDecorator({
      mount: "chat_toolbar",
      render(root) {
        render(
          <AppContext.Provider value={app}>
            <Toasts surface="chat" />
          </AppContext.Provider>,
          root,
        );
        return () => render(null, root);
      },
    }),
  );

  // ------------------------------------------------------------ the active chat
  const openActive = (chatId: string | null) => switchChat(app, chatId);
  if (ctx.state) {
    // The active Loom preset is the one prompts assemble with, and only the frontend can read it (DESIGN §6.8).
    client.presetId = ctx.state.get<string | null>("loom.activePresetId") ?? null;
    cleanups.push(
      ctx.state.subscribe<string | null>("loom.activePresetId", (presetId) => {
        if ((presetId ?? null) === client.presetId) return;
        client.presetId = presetId ?? null;
        void app.request({ type: "lre.preset", op: "active", presetId: client.presetId });
      }),
    );
    cleanups.push(ctx.state.subscribe<{ chatId: string | null }>("chat.active", (value) => openActive(value.chatId)));
  } else {
    for (const event of ["CHAT_CHANGED", "CHAT_SWITCHED"]) cleanups.push(ctx.events.on(event, () => openActive(ctx.getActiveChat().chatId)));
  }
  openActive(ctx.getActiveChat().chatId);

  return () => {
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.warn("[LumiRPEngine] cleanup failed", error);
      }
    }
  };
}
