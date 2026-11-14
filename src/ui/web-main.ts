// The web shell's entry, loaded by `index.html`: RPE served this page, so RPE is at the page's own origin.

import { siteStorage, startWeb } from "./web";

const root = document.getElementById("rpe");
if (root !== null) startWeb(root, { base: location.origin, storage: siteStorage(() => window.localStorage) });
