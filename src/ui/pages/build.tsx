// Build (plan §14): today's Build mode, mounted by PlanChatUI's kept page (`src/ui/kept/page.tsx`) over
// the shell's client. This file only offers the page to both shells, with Build's inner place (`at`).

import { BuildPage } from "../kept/page";
import type { PageEntry } from "../page-entry";

export const entry: PageEntry = { id: "build", title: "Build", icon: "hammer", shells: ["web", "drawer"], needsChat: false, withChat: true, often: false, order: 80, render: (route) => <BuildPage chat={route.chat ?? null} at={route.at ?? []} /> };
