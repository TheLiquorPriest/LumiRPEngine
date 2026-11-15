// How a page declares itself (plan §14). A page is a file or folder under `src/ui/pages/` whose module
// exports `entry`; both shells' navigation and routing are made from the entries of every such module
// (`page-list.ts`, which `bun scripts/ui/pages.ts` writes from the folders and the build writes again),
// so a page added there is offered in the web bar, in the narrow bar's More and among the drawer's tabs
// with no edit to a shared file.

import type { ComponentChildren } from "preact";
import type { Route, Shell } from "./app";
import type { IconName } from "./icons";

interface PageFace {
  /** Its name in a route's `page` and in the web shell's address. */
  readonly id: string;
  readonly title: string;
  readonly icon: IconName;
  /** The shells that offer it. */
  readonly shells: readonly Shell[];
  /** It stays in a narrow bar (a phone's, the drawer's); the rest are behind its More. */
  readonly often: boolean;
  /** Its place in the bars, the lowest first. */
  readonly order: number;
}

/**
 * A page about one chat (`needsChat`), which the shells show an empty page for until a chat is open; or
 * one that is about no chat, which may still show the open chat's own level when there is one
 * (`withChat`: Files, Settings and Storage). A route to a page that needs a chat always names it.
 */
export type PageEntry =
  | (PageFace & { readonly needsChat: true; readonly withChat?: undefined; render(route: Route & { readonly chat: string }): ComponentChildren })
  | (PageFace & { readonly needsChat: false; readonly withChat?: true; render(route: Route): ComponentChildren });
