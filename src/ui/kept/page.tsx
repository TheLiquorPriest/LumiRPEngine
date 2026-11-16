// The Build page (plan §14, "What happens to today's UI"): today's Build mode, the world builder, kept
// as it is and talking to RPE. It mounts today's own root component (`frontend/build/build.tsx`) in the
// one App the kept views share (app.ts), over the page's client to RPE's typed routes (client.ts), with
// today's stylesheets (styles.ts) and the bridge the shell gives (host.ts). The chat the App knows is
// the chat Lumiverse has open (the drawer) or the one the route names (the web shell), so Build can
// mark the world it plays and offer Attach. Leaving the page takes all of it away. Today's Build keeps
// its own place in its own pages, so the page's route is Build alone. Above whichever of Build's pages
// shows, RPE's own words for each request it does not serve yet that the page asked for, once.

import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { AppContext as TodayContext } from "../../frontend/app";
import { Build } from "../../frontend/build/build";
import { IdsSurface, Toasts } from "../../frontend/components";
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
}

/** Puts today's Build mode in `root`; the returned function takes it away with all it started. */
export function mountBuild(root: HTMLElement, mount: BuildMount): () => void {
  const removeStyle = mount.host.addStyle(KEPT_CSS);
  const kept = keptApp({ ...mount, mode: "build", oldRoad: "build" });
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
    render(null, root);
    kept.stop();
    mount.host.dispose();
    removeStyle();
  };
}

export function BuildPage(props: { chat?: string | null }) {
  const app = useApp();
  const settings = useUiSettings();
  const root = useRef<HTMLDivElement>(null);
  const [chat] = useState(() => createStore<string | null>(props.chat ?? null));
  // The chat changes under a page that stays: Build keeps its draft, and the App's view of the open chat follows.
  chat.set(props.chat ?? null);
  useEffect(() => {
    const at = root.current;
    if (at === null) return undefined;
    return mountBuild(at, { client: app.client, chat, host: app.keptHost(), timers: app.timers, settings: () => settings.values.get() });
  }, []);
  return <div ref={root} class="rpe-kept" />;
}
