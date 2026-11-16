// Where the kept things browser (the chat's own UI, `src/ui/chat/`) mounts on the World page: behind the
// spoiler gate, below the tree. The chat's UI sets its component here once, when it mounts; the page draws
// it when one is set and the gate is open, and draws nothing in its place when none is.

import type { ComponentType } from "preact";

export type ThingsBrowser = ComponentType<{ chat: string }>;

let held: ThingsBrowser | null = null;

/** Sets the browser the World page mounts, or lets it go (null). */
export function setThingsBrowser(browser: ThingsBrowser | null): void {
  held = browser;
}

/** The browser set, if any. */
export function thingsBrowser(): ThingsBrowser | null {
  return held;
}
