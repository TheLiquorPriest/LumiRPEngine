// Play (plan §14): today's play panels, mounted by PlanChatUI's kept page (`src/ui/kept/play/`) over the
// shell's client. This file only offers the page to both shells.

import { PlayPage } from "../kept/play/page";
import type { PageEntry } from "../page-entry";

export const entry: PageEntry = { id: "play", title: "Play", icon: "dice", shells: ["web", "drawer"], needsChat: true, often: true, order: 70, render: (route) => <PlayPage chat={route.chat} /> };
