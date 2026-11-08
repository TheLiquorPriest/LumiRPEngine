// GM → Depth (DEPTH-PLAN §7): the depth views a chat's GM pages hold beside Minds, as tabs that fit
// a 390 px drawer (the strip scrolls sideways): the author's Notebook, the Drafts of what happens off
// screen, the Treatments each piece of work got and what it cost, the turn inspector's scene view
// (Turn), the Archive of the chat's own prose, and the Bootstrap. Every one is the player's to read
// (§1.4, D-9). A link from This chat → Depth opens the Bootstrap tab through GM mode's focus
// (`gmOpen(ui, DEPTH_SECTION, "bootstrap")`), and a Settled off screen chip's Read opens its draft in
// the Drafts tab (`draftFocus`).

import { useId, useState } from "preact/hooks";
import { Tabs, tabPanel } from "../components";
import { useGmFocus } from "../gm/ui";
import type { GmSectionProps } from "../registry";
import { ArchiveView } from "./archive";
import { BootstrapPanel } from "./bootstrap";
import { DraftsView } from "./drafts";
import { NotebookView } from "./notebook";
import { TreatmentsView } from "./treatments";
import { TurnView } from "./turn";

export const DEPTH_TABS = ["notebook", "drafts", "treatments", "turn", "archive", "bootstrap"] as const;
export type DepthTab = (typeof DEPTH_TABS)[number];

const DEPTH_TAB_LABEL: Readonly<Record<DepthTab, string>> = { notebook: "Notebook", drafts: "Drafts", treatments: "Treatments", turn: "Turn", archive: "Archive", bootstrap: "Bootstrap" };

const DRAFT_FOCUS = "drafts:";

/** The GM focus that opens a draft in GM → Depth → Drafts (`gmOpen(ui, DEPTH_SECTION, draftFocus(id))`). */
export function draftFocus(draft: string): string {
  return `${DRAFT_FOCUS}${draft}`;
}

export function DepthSection(props: GmSectionProps) {
  const [tab, setTab] = useState<DepthTab>("notebook");
  // The draft a link asked to open, a fresh object each ask, so asking again for one closed since opens it again.
  const [opening, setOpening] = useState<{ draft: string } | null>(null);
  const panelId = useId();
  // This chat → Depth's Open the bootstrap; a Settled off screen chip's Read.
  useGmFocus((to) => {
    if (to.startsWith(DRAFT_FOCUS)) {
      setTab("drafts");
      setOpening({ draft: to.slice(DRAFT_FOCUS.length) });
    } else if ((DEPTH_TABS as readonly string[]).includes(to)) setTab(to as DepthTab);
  });
  return (
    <div class="lre-stack lre-depth" data-lre-depth-section={tab}>
      <Tabs<DepthTab>
        label="Depth"
        panelId={panelId}
        value={tab}
        tabs={DEPTH_TABS.map((id) => ({ id, label: DEPTH_TAB_LABEL[id] }))}
        onChange={(to) => {
          setOpening(null);
          setTab(to);
        }}
      />
      <div {...tabPanel(panelId, tab)} class="lre-stack">
        {tab === "notebook" ? <NotebookView section={props} /> : tab === "drafts" ? <DraftsView section={props} opening={opening} /> : tab === "treatments" ? <TreatmentsView section={props} /> : tab === "turn" ? <TurnView section={props} /> : tab === "archive" ? <ArchiveView section={props} /> : <BootstrapPanel section={props} />}
      </div>
    </div>
  );
}
