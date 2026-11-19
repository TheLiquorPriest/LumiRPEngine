// What every page is given, whichever shell it runs in: the client, the spoiler gate, where the page
// stands (its route), time, and a way to go elsewhere. The web shell keeps the route in the page's
// address; the drawer keeps it in memory, since Lumiverse owns the address.

import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import { type Readable, useSelect } from "./store";
import type { RpeClient } from "./client";
import type { Gate } from "./gate";
import type { Overlays } from "../frontend/app";
import type { KeptChunk } from "./kept/chunk-api";
import type { KeptHost } from "./kept/host";
import type { Timers } from "./roads";
import { useUiSetting, useUiSettings } from "./ui-settings";

/** The web shell, served by RPE at `/ui/`, or the drawer in Lumiverse. */
export type Shell = "web" | "drawer";

/**
 * Where a page stands: the page by its id (`PageEntry.id`), the chat it is about, and its own inner
 * place, which is part of its address (a turn on the Turns page, a folder on Files): the names that
 * lead to it, in order. A page that needs a chat has one; one that can show a chat's own levels has the
 * chat the shell is on or null; the rest have none. A page with no inner place has an empty `at`.
 */
export interface Route {
  readonly page: string;
  readonly chat?: string | null;
  readonly at?: readonly string[];
}

export interface UiApp {
  readonly shell: Shell;
  readonly client: RpeClient;
  readonly gate: Gate;
  readonly route: Readable<Route>;
  readonly timers: Timers;
  /** What today's Build mode is given of the page it runs in, made fresh for each visit to Build (kept/host.ts): Lumiverse's own in the drawer, the page's own in the web shell. */
  keptHost(): KeptHost;
  /** Loads the kept views (Build, Play, the things browser, the chat's sheets) when one is first shown, and hands them over (kept/chunk-api.ts): the web shell splits them off its script, the drawer fetches the extension's second file. */
  kept(): Promise<KeptChunk>;
  /** The sheets (the map, the actions sheet, the World sheet) the chat's own surfaces open for `chat`, asked at each opening: in the drawer, the ones the composer's entries open, while `chat` is the one Lumiverse has open; null where the shell has none for it (the web shell has no chat to adorn), and a view opens its own. */
  chatSheets?(chat: string): Overlays | null;
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
  return route.chat ?? null;
}

/** Now, ticking at the page's tick (its setting) while `ticking`, for the times of what still runs. */
export function useNow(ticking: boolean): number {
  const app = useApp();
  const tickMs = useUiSetting("tickMs");
  const [now, setNow] = useState(() => app.timers.now());
  useEffect(() => {
    setNow(app.timers.now());
    if (!ticking) return;
    let handle: unknown = null;
    const tick = (): void => {
      setNow(app.timers.now());
      handle = app.timers.setTimeout(tick, tickMs);
    };
    handle = app.timers.setTimeout(tick, tickMs);
    return () => app.timers.clearTimeout(handle);
  }, [ticking, tickMs]);
  return now;
}

/** Lumiverse's address as RPE holds it, for the pages that link into Lumiverse (Build's books): in the web shell, where the page is outside Lumiverse; none in the drawer, where the page is inside it already. */
export function useLumiverseAddress(): string | null {
  const app = useApp();
  const address = useSelect(useUiSettings().lumiverse, (value) => value);
  return app.shell === "web" ? address : null;
}
