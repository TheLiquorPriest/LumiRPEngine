// The extension shell (plan §14): RPE's pages in Lumiverse's drawer. The light extension's loader
// (`src/ext/loader.ts`) registers the drawer tab and calls `mount` with the tab's root, Spindle's
// frontend context and its end of the pipe to RPE; `mount` puts the pages there and returns what takes
// them away. The chat is the one Lumiverse has open, and the drawer's own tabs are the navigation. The
// client reaches RPE directly when the page can, else through the extension (client.ts).

import { render } from "preact";
import { createStore, useSelect } from "../frontend/store";
import { AppContext, chatOf, type Route, type UiApp, useApp } from "./app";
import { createClient, extensionConnector } from "./client";
import { NAV, navOf, Notices, PageFor, routeFor } from "./frame";
import { createGate } from "./gate";
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

/** What the loader hands the shell: the drawer tab's root, the frontend context, and the page's end of the pipe. */
export interface ShellMount {
  root: HTMLElement;
  ctx: DrawerContext;
  road: RelayChannel;
}

function DrawerShell() {
  const app = useApp();
  const route = useSelect(app.route, (r) => r);
  const current = navOf(route);
  return (
    <div class="lre rpe rpe-drawer">
      <div class="rpe-drawer-bar">
        <div class="lre-tabs" role="tablist" aria-label="RPE's pages">
          {NAV.filter((item) => item.shells.includes("drawer")).map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={item.id === current ? "true" : "false"} onClick={() => app.go(routeFor(item.id, chatOf(route)))}>
              {item.title}
            </button>
          ))}
        </div>
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
  const route = createStore<Route>({ page: "live", chat: ctx.getActiveChat().chatId });
  // Another chat: the same page for it (a turn's page becomes its list), and the spoiler gate shut.
  const place = (chat: string | null): void => {
    const current = route.get();
    if (chatOf(current) === chat) return;
    gate.closeAll();
    route.set({ page: current.page === "live" ? "live" : "turns", chat });
  };
  const offs: (() => void)[] = [];
  if (ctx.state !== undefined) offs.push(ctx.state.subscribe<{ chatId?: string | null } | null>("chat.active", (value) => place(value?.chatId ?? null)));
  else for (const event of ["CHAT_CHANGED", "CHAT_SWITCHED"]) offs.push(ctx.events.on(event, () => place(ctx.getActiveChat().chatId)));
  const app: UiApp = { shell: "drawer", client, gate, route, timers: deps.timers, go: (next) => route.set(next) };
  render(
    <AppContext.Provider value={app}>
      <DrawerShell />
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
