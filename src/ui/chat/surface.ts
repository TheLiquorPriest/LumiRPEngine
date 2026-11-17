// What a chat surface is (plan §4.3, §14): one placement of RPE in Lumiverse's own chat, by where it
// stands. The loader (`src/ext/loader.ts`) registers each through Lumiverse's frontend API as given,
// and takes it off when its key is gone; what each draws, it draws itself. The shapes here are the
// ones the loader takes, written without Spindle's types (the pages import none): a surface made
// here is one the loader can register as it is.

import type { LumiverseHost } from "../../frontend/host";
import type { KeptLoader } from "../kept/chunk-api";
import type { Route } from "../app";
import type { RpeClient } from "../client";
import type { Readable } from "../store";
import type { Timers } from "../roads";
import type { UiSettings } from "../ui-settings";

/** What the host tells a decorator's render about its anchor. */
export interface DecoratorContext {
  /** The mount literal the anchor is of, such as `chat_input_tools_right`. */
  mount: string;
  /** What the anchor is for: `chat:<chat>:input-tools-right`, `message:<message>:bubble:body-after`. */
  scope: string;
  liveAnchorId: string;
}

/** A DOM decorator on one of the host's anchors: drawn into the root the host gives, with what takes it down returned. */
export interface DecoratorOptions {
  mount: string;
  render?: (root: HTMLElement, ctx: DecoratorContext) => void | (() => void);
  update?: (root: HTMLElement, ctx: DecoratorContext) => void;
  priority?: number;
}

/** A float widget's handle: its root and what is done to it (the HUD, the sheets). */
export interface FloatHandle {
  root: HTMLElement;
  setSize(width: number, height: number): void;
  setVisible(visible: boolean): void;
  setFullscreen(fullscreen: boolean): void;
  destroy(): void;
}

export interface FloatOptions {
  width?: number;
  height?: number;
  initialPosition?: { x: number; y: number };
  snapToEdge?: boolean;
  tooltip?: string;
  chromeless?: boolean;
  resizable?: boolean;
  persistGeometry?: string | false;
  mobileClamp?: boolean;
}

/** An input-bar action (a button the host puts in the composer's action bar). */
export interface InputActionOptions {
  id: string;
  label: string;
  subtitle?: string;
  iconSvg?: string;
  enabled?: boolean;
}

export type ChatSurface =
  | { key: string; placement: "dom-decorator"; options: DecoratorOptions }
  | { key: string; placement: "float-widget"; options?: FloatOptions; render(handle: FloatHandle): void | (() => void) }
  | { key: string; placement: "input-bar-action"; options: InputActionOptions; onClick(): void };

/** The surfaces the frame holds now, and a word when they change. */
export interface SurfaceList {
  current(): readonly ChatSurface[];
  subscribe(listener: () => void): () => void;
}

/** What the frame gives each surface file: the page's client, the chat Lumiverse has open, and a way to show one of RPE's pages in the drawer. */
export interface FrameEnv {
  client: RpeClient;
  /** The chat Lumiverse has open, or null. */
  chat: Readable<string | null>;
  /** Shows a page of RPE in the drawer tab (whoever calls it opens the tab). */
  open(route: Route): void;
  settings: UiSettings;
  timers: Timers;
  /** The bridge to Lumiverse the chat's surfaces share (its float widgets, its size, its drawer), made once for the frame. */
  host: LumiverseHost;
  /** Loads the kept chunk when a surface first needs one of its views (the sheets); the shell's, which loads it once. */
  kept: KeptLoader;
}

/** One surface file of `surfaces/`: the placements it registers, for the chat open now (asked again each time the chat changes). */
export interface SurfaceDef {
  readonly id: string;
  surfaces(env: FrameEnv): readonly ChatSurface[];
}
