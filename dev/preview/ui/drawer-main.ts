// The new pages' extension shell in the preview: today's fake Lumiverse page (index.html, mock-host.ts)
// with the light extension's real loader (`src/ext/loader.ts`) mounting the shell (`src/ui/extension.tsx`)
// in its drawer, and the extension's backend stood in for by `pipe.ts`, against the stand-in RPE.
// URL: /ui-drawer?road=relay|direct (default relay: the page cannot reach RPE itself and goes through the
//   extension) &missing (the extension says it lacks two permissions) &theme=dark|light &drawer=open|closed

import { loader } from "../../../src/ext/loader";
import { mount } from "../../../src/ui/extension";
import { createMockHost } from "../mock-host";
import { DARK_THEME, LIGHT_THEME } from "../themes";
import { previewPipe } from "./pipe";

const params = new URLSearchParams(location.search);
const light = params.get("theme") === "light";
for (const [name, value] of Object.entries(light ? LIGHT_THEME : DARK_THEME)) document.documentElement.style.setProperty(name, value);
document.documentElement.style.colorScheme = light ? "light" : "dark";

const host = createMockHost({ drawerOpen: params.get("drawer") !== "closed", heads: false });
const missing = params.has("missing")
  ? [
      { permission: "interceptor", why: "to tag each reply RPE plays with its chat and its turn" },
      { permission: "cors_proxy", why: "to reach RPE, and to carry this page's requests when it cannot reach RPE itself" },
    ]
  : [];
const pipe = previewPipe((payload) => host.deliver(payload), { road: params.get("road") === "direct" ? "direct" : "relay", missing, flushMs: 250 });
host.onSend = (payload) => pipe.receive(payload);
const teardown = loader(mount)(host.ctx);

declare global {
  interface Window {
    __rpeDrawer: { host: typeof host; teardown: () => void };
  }
}
window.__rpeDrawer = { host, teardown };
