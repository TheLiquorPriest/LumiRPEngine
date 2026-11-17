// The Play page (plan §14, "What happens to today's UI"): today's play panels, kept as they are and
// reading RPE. For one chat: today's HUD strip on top, then today's Play (`frontend/play/play.tsx`),
// which lays out every panel the chat's state holds as today's drawer did, each through its pack's
// own component: a bar of destinations, each destination's panels as tabs, Now as the hub. The App is
// the one the kept views share (`../app.ts`): the state is RPE's (`../chat-state.ts`), the taps go to
// RPE's routes (`../client.ts`), and above the panels what the page says once: RPE's own words for each
// request it does not serve yet, an Undo's sentence, what an overlay's button does not open; and why
// the state could not be read, while it could not. A chat RPE plays with no world shows today's own
// picker of the worlds Build holds, whose Attach gives it one; the panels then show. Leaving the page
// takes all of it away.

import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { AppContext as TodayContext, useApp as useToday } from "../../../frontend/app";
import { Toasts } from "../../../frontend/components";
import { setCurrency } from "../../../frontend/format";
import { Hud } from "../../../frontend/hud";
import { Play } from "../../../frontend/play/play";
import { createStore, type Readable, useSelect } from "../../store";
import { useApp } from "../../app";
import { Banner as PageBanner } from "../../atoms";
import type { RpeClient } from "../../client";
import type { Timers } from "../../roads";
import { useUiSettings } from "../../ui-settings";
import { keptApp, type ToastSettings } from "../app";
import type { KeptHost } from "../host";
import { Said } from "../said";
import { PLAY_CSS } from "./styles";
// GM mode's things browser sets itself in World's slot when its module loads: the pages that show Play are the ones that load it.
import "../things";

export interface PlayMount {
  client: Pick<RpeClient, "call" | "follow">;
  chat: string;
  host: KeptHost;
  timers: Timers;
  settings(): ToastSettings;
  /** Shows the shell's Build page. */
  openBuild(): void;
  /** Shows one of RPE's pages (the Live page, a turn's page). */
  open(route: { page: string; chat?: string | null; at?: readonly string[] }): void;
}

/** The floating pill reports its size to the float widget it lives in; here the page lays the strip out, so the size goes nowhere. */
function laidOutByPage(): void {}

/** What the page shows of the chat: why its state could not be read, what the page says once, then the HUD strip (a world's) and Play. */
function PlayBody(props: { said: Readable<readonly string[]> }) {
  const sync = useSelect(useToday().sync, (state) => state);
  const { view, failed } = sync;
  return (
    <div class="rpe-play-body">
      {failed === null ? null : (
        <PageBanner tone="neg" icon="alert" title="The chat's state could not be read">
          <span>{failed}</span>
        </PageBanner>
      )}
      <Said said={props.said} />
      {view === null ? (
        failed === null ? (
          <p class="lre-muted rpe-line">Reading the chat's state…</p>
        ) : null
      ) : (
        <>
          {view.status === "not_world" ? null : (
            <div class="rpe-play-hud">
              <Hud resize={laidOutByPage} />
            </div>
          )}
          <Play />
        </>
      )}
    </div>
  );
}

/** Puts today's Play for `mount.chat` in `root`; the returned function takes it away with all it started. */
export function mountPlay(root: HTMLElement, mount: PlayMount): () => void {
  const removeStyle = mount.host.addStyle(PLAY_CSS);
  const kept = keptApp({ ...mount, chat: createStore<string | null>(mount.chat), mode: "play" });
  // Amounts read in the chat's world's currency: set before the panels render a state, as today's setup does.
  const offCurrency = kept.app.sync.subscribe((held) => setCurrency(held.view?.currency ?? null));
  render(
    <TodayContext.Provider value={kept.app}>
      <PlayBody said={kept.said} />
      <Toasts surface="drawer" />
    </TodayContext.Provider>,
    root,
  );
  return () => {
    render(null, root);
    kept.stop();
    offCurrency();
    setCurrency(null);
    mount.host.dispose();
    removeStyle();
  };
}

/** The page of the navigation, for the chat the route names. */
export function PlayPage(props: { chat: string }) {
  const app = useApp();
  const settings = useUiSettings();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const at = root.current;
    if (at === null) return undefined;
    // Build opens on the chat the page is for, so it marks the world this chat plays and offers Attach to it.
    return mountPlay(at, { client: app.client, chat: props.chat, host: app.keptHost(), timers: app.timers, settings: () => settings.values.get(), openBuild: () => app.go({ page: "build", chat: props.chat }), open: app.go });
  }, [props.chat]);
  return <div ref={root} class="rpe-play" />;
}
