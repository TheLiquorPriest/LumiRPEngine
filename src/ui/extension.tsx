// The extension shell (plan §14): RPE's pages in Lumiverse's drawer. The light extension's loader
// (`src/ext/loader.ts`) registers the drawer tab and calls `mount` with the tab's root, Spindle's
// frontend context and its end of the pipe to RPE; `mount` puts the pages there and hands back what takes
// them away and `open`, which the chat's own surfaces call to show a page (the link under a reply opens
// that turn's page). The chat is the one Lumiverse has open, and the bar atop the drawer is the
// navigation: the pages used most, and More for the rest (frame.tsx), which stays in reach when the
// drawer scrolls. The page shown, with its own inner place, is kept in memory, so a tab switch returns
// to it; it is drawn, and reads what it shows, only once the drawer has first been seen, so a chat opened
// with the drawer shut reads nothing for it. The client reaches RPE directly when the page can, else
// through the extension (client.ts).

import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { scrollParent } from "../frontend/scroll";
import { createStore, type Readable, useSelect } from "./store";
import { AppContext, type Route, type UiApp, useApp } from "./app";
import { createClient, extensionConnector } from "./client";
import { chatFrame, type SurfaceList } from "./chat";
import { CHAT_FRAME_CSS } from "./chat/styles";
import type { KeptChunk } from "./kept/chunk-api";
import { importHostFile, once } from "./kept/host-file";
import { Frame, PagesBar, routeFor } from "./frame";
import { createGate } from "./gate";
import { type LumiverseContext, type LumiverseHost, lumiverseHost } from "../frontend/host";
import { browserDeps, type RelayChannel, type RoadDeps } from "./roads";
import { UI_CSS } from "./styles";
import { createUiSettings, siteStorage, UiSettingsContext } from "./ui-settings";

/** Spindle's frontend context, as far as the pages use it. */
export interface DrawerContext {
  getActiveChat(): { chatId: string | null };
  events: { on(event: string, handler: (payload: unknown) => void): () => void };
  /** Lumiverse's state selectors, where the host has them; older hosts send chat events instead. */
  state?: { subscribe<T>(selector: string, listener: (value: T) => void): () => void };
  dom: { addStyle(css: string): () => void };
}

/** What the loader hands the shell: the drawer tab's root, the frontend context (all of it, which the Build page's bridge is made from), and the page's end of the pipe. */
export interface ShellMount {
  root: HTMLElement;
  ctx: DrawerContext & LumiverseContext;
  road: RelayChannel;
}

/** What `mount` hands back: how to take the pages away, how to show a page (the drawer tab itself is opened by whoever calls), and the surfaces RPE draws in Lumiverse's chat, which the loader registers. */
export interface Mounted {
  unmount(): void;
  open(route: Route): void;
  surfaces: SurfaceList;
}

/** The page shown last, kept while the page lives: the drawer's memory of where it was, for a tab switch that mounts the shell again. */
let remembered: Route | null = null;

/**
 * Keeps the bar of pages at the top of the host's scrolling panel as the drawer scrolls. The panel
 * Lumiverse scrolls our content in has padding of its own, and a sticky top keeps clear of it, so the
 * bar sticks that far above the content (`--lre-stick-top`), measured against the panel as it is now.
 */
function stickToPanel(el: HTMLElement): () => void {
  let scroller: HTMLElement | null = null;
  const observer = new ResizeObserver(() => apply());
  const apply = (): void => {
    if (!scroller?.contains(el)) {
      if (scroller) observer.unobserve(scroller);
      scroller = scrollParent(el);
      if (scroller) observer.observe(scroller);
    }
    if (scroller) el.style.setProperty("--lre-stick-top", `${-(parseFloat(getComputedStyle(scroller).paddingTop) || 0)}px`);
  };
  apply();
  observer.observe(el);
  // The host slides the drawer in with a transform, which no ResizeObserver sees: measure again when it settles.
  document.addEventListener("transitionend", apply, true);
  return () => {
    observer.disconnect();
    document.removeEventListener("transitionend", apply, true);
  };
}

/** Whether `el` has been on screen yet: false until it first is (the drawer opened on RPE's tab), then true for good. */
function useSeen(el: { current: HTMLElement | null }): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const target = el.current;
    if (seen || target === null) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setSeen(true);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [seen]);
  return seen;
}

/** The drawer's bar of pages and the page they show, drawn once the drawer is first seen; an entry goes to the chat Lumiverse has open, whatever the page now shows. */
function DrawerShell(props: { active: Readable<string | null> }) {
  const app = useApp();
  const route = useSelect(app.route, (r) => r);
  const active = useSelect(props.active, (chat) => chat);
  const root = useRef<HTMLDivElement>(null);
  const seen = useSeen(root);
  useEffect(() => (root.current === null ? undefined : stickToPanel(root.current)), []);
  return (
    <div ref={root} class="lre rpe rpe-drawer">
      <div class="rpe-drawer-bar">
        <PagesBar place="drawer" current={route.page} disabled={() => false} go={(id) => app.go(routeFor(id, active))} />
      </div>
      {seen ? <Frame route={route} /> : null}
    </div>
  );
}

/** Puts RPE's pages in the drawer tab's root. */
export function mount(shell: ShellMount, deps: RoadDeps = browserDeps()): Mounted {
  const { root, ctx } = shell;
  const removeStyle = ctx.dom.addStyle(UI_CSS);
  const settings = createUiSettings(siteStorage(() => globalThis.localStorage));
  const client = createClient(extensionConnector(shell.road, deps, settings));
  const stopSettings = settings.follow(client);
  // At once, not when a page first asks: with no chat open no page asks, and the drawer should still say how RPE stands.
  client.connect();
  const gate = createGate();
  const active = createStore<string | null>(ctx.getActiveChat().chatId);
  // Where the drawer was, for the chat open now: a chat's own inner place (its turn, its folder) is of the chat it was in.
  const kept = remembered;
  const route = createStore<Route>(kept === null ? { page: "live", chat: active.get() } : kept.chat === undefined ? kept : { page: kept.page, chat: active.get() });
  const remember = route.subscribe((next) => {
    remembered = next;
  });
  // Another chat: the same page for it (its inner place gone: a turn of the other chat is not this one's), and the spoiler gate shut. A page about no chat stays.
  const place = (chat: string | null): void => {
    if (active.get() === chat) return;
    active.set(chat);
    gate.closeAll();
    const current = route.get();
    if (current.chat !== undefined) route.set({ page: current.page, chat });
  };
  const offs: (() => void)[] = [remember];
  if (ctx.state !== undefined) offs.push(ctx.state.subscribe<{ chatId?: string | null } | null>("chat.active", (value) => place(value?.chatId ?? null)));
  else for (const event of ["CHAT_CHANGED", "CHAT_SWITCHED"]) offs.push(ctx.events.on(event, () => place(ctx.getActiveChat().chatId)));
  const app: UiApp = {
    shell: "drawer",
    client,
    gate,
    route,
    timers: deps.timers,
    keptHost: () => lumiverseHost(ctx, { revokeMs: () => settings.values.get().downloadRevokeMs, closeDrawer: () => shell.road.closeDrawer() }),
    // The kept views are the extension's second file, which Lumiverse serves beside the first, fetched when one is first shown.
    kept: once(() => importHostFile(ctx, "frontend/widget", process.env.LRE_BUILD_ID ?? "dev") as Promise<KeptChunk>),
    go: (next) => route.set(next),
  };
  render(
    <UiSettingsContext.Provider value={settings}>
      <AppContext.Provider value={app}>
        <DrawerShell active={active} />
      </AppContext.Provider>
    </UiSettingsContext.Provider>,
    root,
  );
  // The chat's own surfaces, drawn in Lumiverse's chat (the web shell has no chat to adorn and makes none). They share one bridge to Lumiverse.
  const chatHost = app.keptHost() as LumiverseHost;
  const frame = chatFrame({ client, chat: active, open: app.go, settings, timers: deps.timers, host: chatHost, kept: app.kept });
  const removeChatStyle = ctx.dom.addStyle(CHAT_FRAME_CSS);
  return {
    unmount() {
      frame.stop();
      chatHost.dispose();
      removeChatStyle();
      render(null, root);
      for (const off of offs) off();
      stopSettings();
      client.close();
      removeStyle();
    },
    open: app.go,
    surfaces: frame.surfaces,
  };
}
