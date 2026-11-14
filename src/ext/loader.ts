// The light extension's frontend (STANDALONE-PLAN §4.3, "Frontend"): a loader that puts RPE's shared UI
// in Lumiverse's drawer and hands it what it needs, and nothing more. The UI's own `mount` (from
// `src/ui/`, the extension shell) gets the drawer tab's root, Spindle's frontend context (for chat
// adornments; this build registers none), and the page's end of the pipe (`page.ts`) for when the
// browser cannot reach RPE directly. Lumiverse calls the module's `setup(ctx)` and the cleanup it returns.

import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { pageRoad, type PageRoad } from "./page";

/** What the UI's extension shell is given to mount itself. */
export interface ShellMount {
  /** The drawer tab's root element: the UI renders into it. */
  root: HTMLElement;
  /** Spindle's frontend context, for chat adornments; this build registers none. */
  ctx: SpindleFrontendContext;
  /** RPE through the extension: start-up facts, requests, live updates. */
  road: PageRoad;
}

/** The UI's extension shell (`src/ui/`): mounts the pages, returns its cleanup. */
export type MountShell = (mount: ShellMount) => () => void;

/** The drawer tab RPE's pages live in. */
export const TAB = { id: "rpe", title: "RPE", shortName: "RPE", description: "RPE: the live view, turns, world, cast, story and settings" };

/** The frontend's `setup`, for the shell given. */
export function loader(mount: MountShell): (ctx: SpindleFrontendContext) => () => void {
  return (ctx) => {
    const road = pageRoad(ctx);
    const tab = ctx.ui.registerDrawerTab(TAB);
    const unmount = mount({ root: tab.root, ctx, road });
    return () => {
      unmount();
      road.stop();
      tab.destroy();
    };
  };
}
