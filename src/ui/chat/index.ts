// The chat frame (plan §4.3, §14): what the extension shell hands the loader to register in
// Lumiverse's chat. It follows the chat Lumiverse has open, asks each surface file of `surfaces/` for the
// placements it wants for that chat, and gives the loader the list (`SurfaceList`), told again when the
// chat changes. A surface file adds itself by being in the folder (`surfaces/list.ts` is written from it).
// The web shell has no chat to adorn and does not make one.

import { createStore } from "../store";
import type { ChatSurface, FrameEnv, SurfaceList } from "./surface";
import { SURFACES } from "./surfaces/list";

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
  const held = createStore<readonly ChatSurface[]>(ask());
  const off = env.chat.subscribe(() => {
    held.set(ask());
    for (const listener of [...listeners]) listener();
  });
  return {
    surfaces: {
      current: () => held.get(),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    stop() {
      off();
      listeners.clear();
    },
  };
}
