// What every page is given, whichever shell it runs in: the client, the spoiler gate, where the page
// stands (its route), time, and a way to go elsewhere. The web shell keeps the route in the page's
// address; the drawer keeps it in memory, since Lumiverse owns the address.

import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import type { Readable } from "../frontend/store";
import type { RpeClient } from "./client";
import type { Gate } from "./gate";
import type { Timers } from "./roads";

/** The web shell, served by RPE at `/ui/`, or the drawer in Lumiverse. */
export type Shell = "web" | "drawer";

/** Where a page stands. A chat's pages have no chat in the drawer while Lumiverse shows none. */
export type Route = { page: "chats" } | { page: "live" | "turns"; chat: string | null } | { page: "turn"; chat: string; turn: string };

export interface UiApp {
  readonly shell: Shell;
  readonly client: RpeClient;
  readonly gate: Gate;
  readonly route: Readable<Route>;
  readonly timers: Timers;
  go(route: Route): void;
}

export const AppContext = createContext<UiApp | null>(null);

export function useApp(): UiApp {
  const app = useContext(AppContext);
  if (app === null) throw new Error("RPE's pages render inside one of its shells.");
  return app;
}

/** The chat a route is about, if any. */
export function chatOf(route: Route): string | null {
  return route.page === "chats" ? null : route.chat;
}

/** Now, ticking each second while `ticking`, for the times of what still runs. */
export function useNow(ticking: boolean): number {
  const app = useApp();
  const [now, setNow] = useState(() => app.timers.now());
  useEffect(() => {
    setNow(app.timers.now());
    if (!ticking) return;
    let handle: unknown = null;
    const tick = (): void => {
      setNow(app.timers.now());
      handle = app.timers.setTimeout(tick, 1000);
    };
    handle = app.timers.setTimeout(tick, 1000);
    return () => app.timers.clearTimeout(handle);
  }, [ticking]);
  return now;
}
