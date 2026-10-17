// Preview harness boot: a mock host plus a mock backend, then the real frontend `setup`.
// URL: ?scenario=play|paused|not_world|fresh&drawer=open|closed&theme=dark|light (default dark)&map=ring|manor|square

import { setup } from "../../src/frontend/setup";
import type { FrontendToBackend } from "../../src/shared/protocol";
import { STARTER_MAPS } from "./fixtures";
import { MockBackend } from "./mock-backend";
import { createMockHost } from "./mock-host";
import { DARK_THEME, LIGHT_THEME } from "./themes";

const params = new URLSearchParams(location.search);
const light = params.get("theme") === "light";
const root = document.documentElement;
for (const [name, value] of Object.entries(light ? LIGHT_THEME : DARK_THEME)) root.style.setProperty(name, value);
root.style.colorScheme = light ? "light" : "dark";
const scenarioParam = params.get("scenario");
const scenario = scenarioParam === "paused" || scenarioParam === "not_world" || scenarioParam === "fresh" ? scenarioParam : "play";
const host = createMockHost(params.get("drawer") !== "closed");
const starter = STARTER_MAPS[params.get("map") ?? ""];
const backend = new MockBackend((payload) => host.deliver(payload), { scenario, ...(starter ? { map: starter } : {}), closeDrawer: () => host.setDrawer(false) });
host.onSend = (payload) => backend.receive(payload as FrontendToBackend);
const teardown = setup(host.ctx);

declare global {
  interface Window {
    __lre: { backend: MockBackend; host: typeof host; teardown: () => void };
  }
}
window.__lre = { backend, host, teardown };
