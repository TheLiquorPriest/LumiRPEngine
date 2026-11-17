// The Build page (plan §14, "What happens to today's UI"): today's Build mode, the world builder, kept
// as it is and talking to RPE's typed routes. It mounts today's own root component (`frontend/build/build.tsx`)
// in the one App the kept views share (app.ts), over the page's client (client.ts), with today's stylesheets
// (styles.ts) and the bridge the shell gives (host.ts). The chat the App knows is the chat Lumiverse has open
// (the drawer) or the one the route names (the web shell), so Build can mark the world it plays and offer
// Attach. Build's inner place (the worlds, a world, a collection, a list, an item, a part, Problems, a job,
// Secrecy) is the route's own (`at`): the web shell keeps it in the address and the drawer in memory, so a
// reload or Back returns to it. Leaving the page takes all of it away.

import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { AppContext as TodayContext, type BuildRoute } from "../../frontend/app";
import { Build } from "../../frontend/build/build";
import { IdsSurface, Toasts } from "../../frontend/components";
import type { JobKind } from "../../shared/jobs";
import type { WorldCollection, WorldPart } from "../../shared/world";
import { useApp } from "../app";
import type { RpeClient } from "../client";
import type { Timers } from "../roads";
import { createStore, type Store } from "../store";
import { useUiSettings } from "../ui-settings";
import { keptApp, type ToastSettings } from "./app";
import type { KeptHost } from "./host";
import { Said } from "./said";
import { KEPT_CSS } from "./styles";

export interface BuildMount {
  client: Pick<RpeClient, "call" | "follow">;
  /** The chat Lumiverse has open, or the one the route names; the page sets it as it changes. */
  chat: Store<string | null>;
  host: KeptHost;
  timers: Timers;
  settings(): ToastSettings;
  /** Shows one of RPE's pages (the Live page, a turn's page). */
  open(route: { page: string; chat?: string | null; at?: readonly string[] }): void;
  /** Build's inner place, as the route holds it: set by the page when the route moves, and by Build when he moves inside it. */
  place?: Store<BuildRoute>;
}

/** Build's inner place as the route's names (`at`). */
export function atOf(place: BuildRoute): string[] {
  switch (place.view) {
    case "worlds":
      return [];
    case "world":
      return [place.worldId];
    case "collection":
      return [place.worldId, "collection", place.collection];
    case "entities":
      return [place.worldId, "entities", place.group];
    case "item":
      return [place.worldId, "item", place.collection, place.id ?? "", ...(place.at === undefined ? [] : [place.at])];
    case "part":
      return [place.worldId, "part", place.part];
    case "check":
      return [place.worldId, "check"];
    case "job":
      return [place.worldId, "job", place.kind];
    case "secrecy":
      return [place.worldId, "secrecy"];
  }
}

/** The inner place the route's names lead to; names that lead nowhere Build knows are the list of worlds. */
export function placeOf(at: readonly string[] | undefined): BuildRoute {
  const [worldId, view, name, id, inner] = at ?? [];
  if (worldId === undefined || worldId === "") return { view: "worlds" };
  if (view === undefined) return { view: "world", worldId };
  if (view === "check" || view === "secrecy") return { view, worldId };
  if (name === undefined || name === "") return { view: "world", worldId };
  if (view === "collection") return { view, worldId, collection: name as WorldCollection };
  if (view === "entities") return { view, worldId, group: name as Extract<BuildRoute, { view: "entities" }>["group"] };
  if (view === "item") return { view, worldId, collection: name as WorldCollection, id: id === undefined || id === "" ? null : id, ...(inner === undefined ? {} : { at: inner }) };
  if (view === "part") return { view, worldId, part: name as WorldPart };
  if (view === "job") return { view, worldId, kind: name as JobKind };
  return { view: "world", worldId };
}

function samePlace(a: BuildRoute, b: BuildRoute): boolean {
  return JSON.stringify(atOf(a)) === JSON.stringify(atOf(b));
}

/** Puts today's Build mode in `root`; the returned function takes it away with all it started. */
export function mountBuild(root: HTMLElement, mount: BuildMount): () => void {
  const removeStyle = mount.host.addStyle(KEPT_CSS);
  const kept = keptApp({ ...mount, mode: "build" });
  const stops: (() => void)[] = [];
  const place = mount.place;
  if (place !== undefined) {
    // The route's place opens Build there; a move either way is told to the other.
    kept.app.ui.update((ui) => ({ ...ui, build: place.get() }));
    stops.push(place.subscribe((next) => (samePlace(next, kept.app.ui.get().build) ? undefined : kept.app.ui.update((ui) => ({ ...ui, build: next })))));
    stops.push(kept.app.ui.subscribe((ui) => (samePlace(ui.build, place.get()) ? undefined : place.set(ui.build))));
  }
  // Ids show here under Show ids, as in today's Build; a form sheet, while open, is all the body shows (`lre-mode-body`, FORMS_CSS).
  render(
    <TodayContext.Provider value={kept.app}>
      <div class="rpe-kept-body lre-mode-body">
        <Said said={kept.said} />
        <IdsSurface.Provider value={true}>
          <Build />
        </IdsSurface.Provider>
      </div>
      <Toasts surface="drawer" />
    </TodayContext.Provider>,
    root,
  );
  return () => {
    for (const stop of stops) stop();
    render(null, root);
    kept.stop();
    mount.host.dispose();
    removeStyle();
  };
}

export function BuildPage(props: { chat?: string | null; at?: readonly string[] }) {
  const app = useApp();
  const settings = useUiSettings();
  const root = useRef<HTMLDivElement>(null);
  const [chat] = useState(() => createStore<string | null>(props.chat ?? null));
  const [place] = useState(() => createStore<BuildRoute>(placeOf(props.at)));
  // The chat changes under a page that stays: Build keeps its draft, and the App's view of the open chat follows.
  chat.set(props.chat ?? null);
  // A route that moved (Back, a link, a reload) moves Build; Build's own move goes into the route.
  const routed = placeOf(props.at);
  if (!samePlace(routed, place.get())) place.set(routed);
  useEffect(() => place.subscribe((next) => app.go({ page: "build", chat: props.chat ?? null, at: atOf(next) })), [props.chat]);
  useEffect(() => {
    const at = root.current;
    if (at === null) return undefined;
    return mountBuild(at, { client: app.client, chat, host: app.keptHost(), timers: app.timers, settings: () => settings.values.get(), open: app.go, place });
  }, []);
  return <div ref={root} class="rpe-kept" />;
}
