// Written by `bun scripts/ui/pages.ts` from the pages under `src/ui/pages/`, and again by the build: never by hand.
// Every page of the shells, in the order their bars offer them.

import type { PageEntry } from "./page-entry";
import { entry as buildPage } from "./pages/build";
import { entry as castPage } from "./pages/cast";
import { entry as chatsPage } from "./pages/chats";
import { entry as connectionsPage } from "./pages/connections";
import { entry as filesPage } from "./pages/files";
import { entry as livePage } from "./pages/live";
import { entry as lorePage } from "./pages/lore";
import { entry as migrationPage } from "./pages/migration";
import { entry as playPage } from "./pages/play";
import { entry as promptPage } from "./pages/prompt";
import { entry as runtimePage } from "./pages/runtime";
import { entry as settingsPage } from "./pages/settings";
import { entry as storagePage } from "./pages/storage";
import { entry as storyPage } from "./pages/story";
import { entry as turnsPage } from "./pages/turns";
import { entry as worldPage } from "./pages/world";

export const PAGES: readonly PageEntry[] = [buildPage, castPage, chatsPage, connectionsPage, filesPage, livePage, lorePage, migrationPage, playPage, promptPage, runtimePage, settingsPage, storagePage, storyPage, turnsPage, worldPage].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
