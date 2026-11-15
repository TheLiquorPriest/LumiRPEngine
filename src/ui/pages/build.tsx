// Build (plan §14): today's Build mode, mounted by PlanChatUI's kept page (`src/ui/kept/page.tsx`) over
// the shell's client. This file only offers the page to both shells.

import { BuildPage } from "../kept/page";
import type { PageEntry } from "../page-entry";

export const entry: PageEntry = { id: "build", title: "Build", icon: "hammer", shells: ["web", "drawer"], needsChat: false, often: false, order: 80, render: () => <BuildPage /> };
