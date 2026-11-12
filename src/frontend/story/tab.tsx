// The Harness tab's pages (DEPTH2-PLAN §1): the story's own beside LumiAH's. A bottom bar goes from
// Agents (LumiAH's pages, the agents at work, where the tab opens) to the story's Cast, Record and
// Notebook, and back. LumiAH's pages come in as `children`, since only `harness/` may draw them.
// Hook-free: the Harness tab hands in where it is (`ui.harness`) and the way to move.

import type { ComponentChildren } from "preact";
import type { HarnessPage, HarnessRoute } from "../app";
import { BottomNav } from "../components";
import type { IconName } from "../icons";
import { CastPage } from "./cast";
import type { StoryFiles } from "./files";
import { NotebookPage } from "./notebook";
import { RecordPage } from "./record";

/** The bar's pages, in order. */
export const HARNESS_TABS: readonly { id: HarnessPage; label: string; icon: IconName }[] = [
  { id: "agents", label: "Agents", icon: "sparkle" },
  { id: "cast", label: "Cast", icon: "users" },
  { id: "record", label: "Record", icon: "scroll" },
  { id: "notebook", label: "Notebook", icon: "book" },
];

export function StoryFrame(props: { route: HarnessRoute; chatId: string; files: StoryFiles; go(route: HarnessRoute): void; children: ComponentChildren }) {
  const { route, chatId } = props;
  return (
    <div class="lre-story-frame" data-lre-harness-page={route.page}>
      <div class="lre-story-body">
        {route.page === "agents" ? props.children : route.page === "cast" ? <CastPage key={chatId} chatId={chatId} files={props.files} {...(route.entity !== undefined ? { open: route.entity } : {})} /> : route.page === "record" ? <RecordPage key={chatId} chatId={chatId} {...(route.at !== undefined ? { at: route.at } : {})} go={props.go} /> : <NotebookPage key={chatId} chatId={chatId} files={props.files} />}
      </div>
      <BottomNav label="Harness pages" items={HARNESS_TABS} value={route.page} onChange={(page) => props.go({ page })} />
    </div>
  );
}
