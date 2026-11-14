// The Play page (plan §14, "What happens to today's UI"): today's play panels, kept as they are and
// reading RPE. For one chat: today's HUD strip on top, then today's Play (`frontend/play/play.tsx`),
// which lays out every panel the chat's state holds as today's drawer did, each through its pack's
// own component: a bar of destinations, each destination's panels as tabs, Now as the hub. The state
// is RPE's (source.ts), the taps go to RPE's routes (transport.ts), and above the panels what the page
// says once (app.ts): RPE's own words for each tap it does not serve, an Undo's sentence, what an
// overlay's button does not open; and why the state could not be read, while it could not. A chat RPE
// plays with no world shows today's own picker of the worlds Build holds, whose Attach gives it one;
// the panels then show. Leaving the page takes all of it away.

import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { AppContext as TodayContext, useApp as useToday } from "../../../frontend/app";
import { Banner, Toasts } from "../../../frontend/components";
import { setCurrency } from "../../../frontend/format";
import { Hud } from "../../../frontend/hud";
import { Play } from "../../../frontend/play/play";
import { type Readable, useSelect } from "../../../frontend/store";
import { useApp } from "../../app";
import { Banner as PageBanner } from "../../atoms";
import type { RpeClient } from "../../client";
import type { Timers } from "../../roads";
import type { KeptHost } from "../host";
import { playApp } from "./app";
import { chatState } from "./source";
import { PLAY_CSS } from "./styles";
import { playTransport } from "./transport";

export interface PlayMount {
  client: Pick<RpeClient, "call" | "follow">;
  chat: string;
  host: KeptHost;
  timers: Timers;
  /** Shows the shell's Build page. */
  openBuild(): void;
}

/** The floating pill reports its size to the float widget it lives in; here the page lays the strip out, so the size goes nowhere. */
function laidOutByPage(): void {}

/** What the page shows of the chat: why its state could not be read, what the page says once, then the HUD strip (a world's) and Play. */
function PlayBody(props: { said: Readable<readonly string[]> }) {
  const sync = useSelect(useToday().sync, (state) => state);
  const said = useSelect(props.said, (all) => all);
  const { view, failed } = sync;
  return (
    <div class="rpe-play-body">
      {failed === null ? null : (
        <PageBanner tone="neg" icon="alert" title="The chat's state could not be read">
          <span>{failed}</span>
        </PageBanner>
      )}
      {said.length === 0 ? null : (
        <div class="lre-stack" data-rpe-said>
          {said.map((sentence) => (
            <Banner key={sentence} tone="info" icon="info">
              {sentence}
            </Banner>
          ))}
        </div>
      )}
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
  const state = chatState(mount.client, mount.chat);
  // Amounts read in the chat's world's currency: set before the panels render a state, as today's setup does.
  const offCurrency = state.subscribe((held) => setCurrency(held.view?.currency ?? null));
  const transport = playTransport(mount.client, mount.chat);
  const played = playApp({ transport, state, host: mount.host, timers: mount.timers, openBuild: mount.openBuild });
  render(
    <TodayContext.Provider value={played.app}>
      <PlayBody said={played.said} />
      <Toasts surface="drawer" />
    </TodayContext.Provider>,
    root,
  );
  return () => {
    render(null, root);
    played.stop();
    transport.close();
    offCurrency();
    state.stop();
    setCurrency(null);
    mount.host.dispose();
    removeStyle();
  };
}

/** The page of the navigation, for the chat the route names. */
export function PlayPage(props: { chat: string }) {
  const app = useApp();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const at = root.current;
    if (at === null) return undefined;
    return mountPlay(at, { client: app.client, chat: props.chat, host: app.keptHost(), timers: app.timers, openBuild: () => app.go({ page: "build" }) });
  }, [props.chat]);
  return <div ref={root} class="rpe-play" />;
}
