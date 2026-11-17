// What the kept views are loaded as (plan §4.3, §14): Build, the Play view, the things browser and the chat's
// three sheets (the map, the actions palette, the World sheet) are one chunk of the UI that the page loads
// when one is first shown, so the light part that is there from the first visit (the loader, the shell,
// every page but these, and the chat's surfaces) carries none of the previous build's panels, packs or
// engine code. The chunk is `chunk.ts`; this file is what the light part may know of it, types only:
// nothing here pulls a module of the chunk into the light part's file.
//
// A view of the chunk is mounted by the chunk into a root the light part gives it, and the two parts
// pass each other plain objects (the client, the host, the timers, the App): the chunk has copies of the
// shared modules of its own (in the extension it is another file Lumiverse serves), so no component of
// one is drawn inside the tree of the other.

import type { App } from "../../frontend/app";
import type { LumiverseHost } from "../../frontend/host";
import type { OverlaySet } from "../../frontend/overlays";
import type { BuildMount } from "./build";
import type { PlayMount } from "./play/mount";
import type { ThingsMount } from "./things";

export interface KeptChunk {
  /** Today's Play for a chat in `root`; the returned function takes it away with all it started. */
  mountPlay(root: HTMLElement, mount: PlayMount): () => void;
  /** Today's Build mode in `root`. */
  mountBuild(root: HTMLElement, mount: BuildMount): () => void;
  /** The things browser of a chat in `root` (the World page's, behind its spoiler gate). */
  mountThings(root: HTMLElement, mount: ThingsMount): () => void;
  /** The chat's three sheets over the chat's App, opened one at a time as float widgets of `host`. */
  createSheets(app: App, host: LumiverseHost): OverlaySet;
}

/** Loads the chunk once and hands it to whoever asks: the shell's. A load that failed is tried again at the next ask. */
export type KeptLoader = () => Promise<KeptChunk>;
