// The chat frame (plan §4.3, §14): what the extension shell hands the loader to register in
// Lumiverse's chat. It follows the chat Lumiverse has open, asks each surface file of `surfaces/` for the
// placements it wants for that chat, and gives the loader the list (`SurfaceList`), told again when
// the list changes: when the chat does, when the window crosses the phone's width, and when the open
// chat's state moves what a surface's placement says (an input-bar action's label or whether it is on).
// A surface file adds itself by being in the folder (`surfaces/list.ts` is written from it). The web
// shell has no chat to adorn and does not make one.

import { createStore } from "../store";
import { chatPlay, releasePlay } from "./chat-play";
import type { ChatSurface, FrameEnv, SurfaceList } from "./surface";
import { SURFACES } from "./surfaces/list";
import { releaseReplies } from "./replies";
import { releaseWindow } from "./window";
import { releaseWorking } from "./working";

export type { ChatSurface, DecoratorContext, FloatHandle, FrameEnv, SurfaceDef, SurfaceList } from "./surface";

export interface ChatFrame {
  surfaces: SurfaceList;
  /** Lets go of the chat and the list. */
  stop(): void;
}

/** The frame over `env`; `surfaces` is the files' list unless a test gives its own. */
export function chatFrame(env: FrameEnv, surfaces = SURFACES): ChatFrame {
  const listeners = new Set<() => void>();
  const ask = (): readonly ChatSurface[] => surfaces.flatMap((file) => file.surfaces(env));
  const held = createStore<readonly ChatSurface[]>([]);
  let keys = "";
  let watching: (() => void) | null = null;
  /** Asks the surface files again; the loader hears of it only when a placement came or went. */
  const relist = (): void => {
    const next = ask();
    const now = next.map((surface) => surface.key).join("\n");
    held.set(next);
    if (now === keys) return;
    keys = now;
    for (const listener of [...listeners]) listener();
  };
  /** The open chat's App moves what the placements say: its state, and how many status lines are drawn. */
  const watch = (): void => {
    watching?.();
    const play = chatPlay(env);
    watching = play === null ? null : (() => {
      const offs = [play.app.sync.subscribe(relist), play.statusLines.subscribe(relist)];
      return () => {
        for (const off of offs) off();
      };
    })();
  };
  const offs = [
    env.chat.subscribe(() => {
      watch();
      relist();
    }),
    env.host.viewport.subscribe(relist),
  ];
  watch();
  relist();
  return {
    surfaces: {
      current: () => held.get(),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    stop() {
      for (const off of offs) off();
      watching?.();
      listeners.clear();
      releasePlay(env);
      releaseWorking(env);
      releaseWindow(env);
      releaseReplies(env);
    },
  };
}
