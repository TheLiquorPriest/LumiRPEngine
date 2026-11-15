// The extension shell (plan §14): RPE's pages in Lumiverse's drawer. The light extension's loader
// (`src/ext/loader.ts`) registers the drawer tab and calls `mount` with the tab's root, Spindle's
// frontend context and its end of the pipe to RPE; `mount` puts the pages there and returns what takes
// them away. The chat is the one Lumiverse has open, and the bar atop the drawer is the navigation: the
// pages used most, and More for the rest (frame.tsx). The client reaches RPE directly when the page can,
// else through the extension (client.ts).

import { render } from "preact";
import { createStore, type Readable, useSelect } from "./store";
import { AppContext, type Route, type UiApp, useApp } from "./app";
import { createClient, extensionConnector } from "./client";
import { navOf, Notices, PageFor, PagesBar, routeFor } from "./frame";
import { createGate } from "./gate";
import { type LumiverseContext, lumiverseHost } from "./kept/host";
import { browserDeps, type RelayChannel, type RoadDeps } from "./roads";
import { UI_CSS } from "./styles";

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

/** The drawer's bar of pages and the page they show; an entry goes to the chat Lumiverse has open, whatever the page now shows. */
function DrawerShell(props: { active: Readable<string | null> }) {
  const app = useApp();
  const route = useSelect(app.route, (r) => r);
  const active = useSelect(props.active, (chat) => chat);
  return (
    <div class="lre rpe rpe-drawer">
      <div class="rpe-drawer-bar">
        <PagesBar place="drawer" current={navOf(route)} disabled={() => false} go={(id) => app.go(routeFor(id, active))} />
      </div>
      <Notices />
      <PageFor route={route} />
    </div>
  );
}

/** Puts RPE's pages in the drawer tab's root; the returned function takes them away and stops the client. */
export function mount(shell: ShellMount, deps: RoadDeps = browserDeps()): () => void {
  const { root, ctx } = shell;
  const removeStyle = ctx.dom.addStyle(UI_CSS);
  const client = createClient(extensionConnector(shell.road, deps));
  // At once, not when a page first asks: with no chat open no page asks, and the drawer should still say how RPE stands.
  client.connect();
  const gate = createGate();
  const active = createStore<string | null>(ctx.getActiveChat().chatId);
  const route = createStore<Route>({ page: "live", chat: active.get() });
  // Another chat: the same page for it (a turn's page becomes its list), and the spoiler gate shut. A page about no chat stays.
  const place = (chat: string | null): void => {
    if (active.get() === chat) return;
    active.set(chat);
    gate.closeAll();
    const current = route.get();
    if (current.page === "turn") route.set({ page: "turns", chat });
    else if ("chat" in current) route.set({ page: current.page, chat });
  };
  const offs: (() => void)[] = [];
  if (ctx.state !== undefined) offs.push(ctx.state.subscribe<{ chatId?: string | null } | null>("chat.active", (value) => place(value?.chatId ?? null)));
  else for (const event of ["CHAT_CHANGED", "CHAT_SWITCHED"]) offs.push(ctx.events.on(event, () => place(ctx.getActiveChat().chatId)));
  const app: UiApp = { shell: "drawer", client, gate, route, timers: deps.timers, keptHost: () => lumiverseHost(ctx), go: (next) => route.set(next) };
  render(
    <AppContext.Provider value={app}>
      <DrawerShell active={active} />
    </AppContext.Provider>,
    root,
  );
  return () => {
    render(null, root);
    for (const off of offs) off();
    client.close();
    removeStyle();
  };
}
