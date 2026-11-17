// The Build view (plan §14, "What happens to today's UI"): today's Build mode, the world builder, kept
// as it is and talking to RPE's typed routes. It mounts today's own root component (`frontend/build/build.tsx`)
// in the one App the kept views share (app.ts), over the page's client (client.ts), with today's stylesheets
// (styles.ts) and the bridge the shell gives (host.ts). The chat the App knows is the chat Lumiverse has open
// (the drawer) or the one the route names (the web shell), so Build can mark the world it plays and offer
// Attach. Leaving the page takes all of it away. This is the chunk's half (`chunk.ts`); the page that loads
// it, and Build's inner place as the route holds it, are `page.tsx` and `build-place.ts`.

import { render } from "preact";
import { AppContext as TodayContext, type BuildRoute } from "../../frontend/app";
import { Build } from "../../frontend/build/build";
import { trackDraft } from "../../frontend/build/draft";
import { IdsSurface, Toasts } from "../../frontend/components";
import type { RpeClient } from "../client";
import type { Timers } from "../roads";
import type { Store } from "../store";
import { keptApp, type ToastSettings } from "./app";
import { samePlace } from "./build-place";
import { CATALOG } from "./catalog";
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

/** Puts today's Build mode in `root`; the returned function takes it away with all it started. */
export function mountBuild(root: HTMLElement, mount: BuildMount): () => void {
  const removeStyle = mount.host.addStyle(KEPT_CSS);
  const kept = keptApp({ ...mount, mode: "build", catalog: CATALOG, draft: trackDraft });
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
