// The Play view (plan §14, "What happens to today's UI"): today's play panels, kept as they are and
// reading RPE. For one chat: today's HUD strip on top, then today's Play (`frontend/play/play.tsx`),
// which lays out every panel the chat's state holds as today's drawer did, each through its pack's
// own component: a bar of destinations, each destination's panels as tabs, Now as the hub. The App is
// the one the kept views share (`../app.ts`): the state is RPE's (`../chat-state.ts`), the taps go to
// RPE's routes (`../client.ts`), and above the panels what the page says once: RPE's own words for each
// request it does not serve yet, and an Undo's sentence; and why the state could not be read, while it
// could not. Act, Timelapse, the HUD's Map and Actions and the map's Full screen open the chat's sheets
// (the actions sheet, the map, the World sheet): the ones its composer's entries open, where the shell
// has them for the chat (the drawer, for the chat Lumiverse has open), else the page's own over its
// view. A chat RPE plays with no world shows today's own picker of the worlds Build holds, whose Attach
// gives it one; the panels then show. Leaving the page takes all of it away. This is the chunk's half
// (`../chunk.ts`); the page that loads it is `page.tsx`.

import { render } from "preact";
import { AppContext as TodayContext, type Overlays, useApp as useToday } from "../../../frontend/app";
import { Banner, Toasts } from "../../../frontend/components";
import { setCurrency } from "../../../frontend/format";
import { Hud } from "../../../frontend/hud";
import { createOverlays, type OverlaySet } from "../../../frontend/overlays";
import { Play } from "../../../frontend/play/play";
import { createStore, type Readable, useSelect } from "../../store";
import type { RpeClient } from "../../client";
import type { Timers } from "../../roads";
import { keptApp, type ToastSettings } from "../app";
import { CATALOG } from "../catalog";
import type { KeptHost } from "../host";
import { Said } from "../said";
import { PLAY_CSS } from "./styles";

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
  /** The chat's own sheets where the shell has them for this chat, asked at each opening (the drawer's, while the chat is the one Lumiverse has open); null, or left out, where it has none, and the page opens its own. */
  sheets?(): Overlays | null;
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
        <Banner tone="neg" icon="alert" title="The chat's state could not be read">
          <span>{failed}</span>
        </Banner>
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
  // The page's own sheets, over its view: made when one is first opened where the shell has none for the chat.
  let own: OverlaySet | null = null;
  const made = (): OverlaySet => (own ??= createOverlays(kept.app, mount.host));
  const ownSheets: Overlays = {
    openMap: () => made().open("map"),
    closeMap: () => own?.close("map"),
    openPalette: (tab, edit) => made().open("palette", tab, edit),
    closePalette: () => own?.close("palette"),
    openWorld: () => made().open("world"),
    closeWorld: () => own?.close("world"),
  };
  // The shell is asked at each opening, so a chat that becomes the one Lumiverse has open while the page shows opens its composer's sheets from then on.
  const sheets = (): Overlays => mount.sheets?.() ?? ownSheets;
  const overlays: Overlays = {
    openMap: () => sheets().openMap(),
    closeMap: () => sheets().closeMap(),
    openPalette: (tab, edit) => sheets().openPalette(tab, edit),
    closePalette: () => sheets().closePalette(),
    openWorld: () => sheets().openWorld(),
    closeWorld: () => sheets().closeWorld(),
  };
  const kept = keptApp({ ...mount, chat: createStore<string | null>(mount.chat), mode: "play", catalog: CATALOG, overlays });
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
    own?.destroy();
    kept.stop();
    offCurrency();
    setCurrency(null);
    mount.host.dispose();
    removeStyle();
  };
}
