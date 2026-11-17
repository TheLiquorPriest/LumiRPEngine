// The kept App for the chat Lumiverse has open, which the surfaces over the chat share (plan §14,
// PlanChatUI-2): the HUD pill, the three sheets (the map, the actions palette, the World sheet), the
// input-bar actions, the status line above the composer and the toasts in the chat's toolbar all read one
// App made over the page's client: its state is RPE's state of the chat, kept live, its taps go to RPE's
// routes, and its overlays are the float widgets the shell opens one at a time. It is made when a surface
// first asks for it, kept while the chat stays open, and let go when the chat changes or the frame stops.
// The sheets are of the kept chunk (`../kept/chunk.ts`), which the shell loads when one is first opened: the
// pill, the lines and the markers need none of it.

import type { App, Overlays } from "../../frontend/app";
import type { OverlaySet } from "../../frontend/overlays";
import { keptApp } from "../kept/app";
import { createStore, type Store } from "../store";
import { errorWords } from "../words";
import type { FrameEnv } from "./surface";

export interface ChatPlay {
  chat: string;
  app: App;
  /** How many status lines are mounted above a composer: on a phone the status line does the pill's job. */
  statusLines: Store<number>;
  stop(): void;
}

const made = new WeakMap<FrameEnv, ChatPlay>();

/** The App for the open chat; null with none open. */
export function chatPlay(env: FrameEnv): ChatPlay | null {
  const chat = env.chat.get();
  if (chat === null) return null;
  const held = made.get(env);
  if (held?.chat === chat) return held;
  held?.stop();
  let sheets: OverlaySet | null = null;
  let loading: Promise<OverlaySet> | null = null;
  let stopped = false;
  /** The sheets, made from the kept chunk the first time one is asked for. */
  const load = (): Promise<OverlaySet> => {
    const pending =
      loading ??
      env.kept().then(
        (chunk) => {
          const set = chunk.createSheets(kept.app, env.host);
          if (stopped) set.destroy();
          else sheets = set;
          return set;
        },
        (error: unknown) => {
          loading = null;
          throw error;
        },
      );
    loading = pending;
    return pending;
  };
  const opened = async (open: (set: OverlaySet) => Promise<void>): Promise<void> => {
    try {
      await open(await load());
    } catch (error) {
      kept.app.toast(`RPE could not open this view: ${errorWords(error)}`, "error");
    }
  };
  const overlays: Overlays = {
    openMap: () => opened((set) => set.open("map")),
    closeMap: () => sheets?.close("map"),
    openPalette: (tab, edit) => opened((set) => set.open("palette", tab, edit)),
    closePalette: () => sheets?.close("palette"),
    openWorld: () => opened((set) => set.open("world")),
    closeWorld: () => sheets?.close("world"),
  };
  const kept = keptApp({ client: env.client, chat: createStore<string | null>(chat), mode: "play", host: env.host, timers: env.timers, settings: () => env.settings.values.get(), open: env.open, overlays });
  const play: ChatPlay = {
    chat,
    app: kept.app,
    statusLines: createStore(0),
    stop() {
      stopped = true;
      if (made.get(env) === play) made.delete(env);
      sheets?.destroy();
      kept.stop();
    },
  };
  made.set(env, play);
  return play;
}

/** Lets go of the open chat's App. */
export function releasePlay(env: FrameEnv): void {
  made.get(env)?.stop();
}
