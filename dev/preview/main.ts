// Preview harness boot: a mock host plus a mock backend, then the real frontend `setup`.
// URL: ?scenario=play|paused|not_world&drawer=open|closed&theme=dark|light (default dark)&map=ring

import { setup } from "../../src/frontend/setup";
import type { FrontendToBackend } from "../../src/shared/protocol";
import { MockBackend } from "./mock-backend";
import { createMockHost } from "./mock-host";
import { DARK_THEME, LIGHT_THEME } from "./themes";

const params = new URLSearchParams(location.search);
const light = params.get("theme") === "light";
const root = document.documentElement;
for (const [name, value] of Object.entries(light ? LIGHT_THEME : DARK_THEME)) root.style.setProperty(name, value);
root.style.colorScheme = light ? "light" : "dark";
const scenarioParam = params.get("scenario");
const scenario = scenarioParam === "paused" || scenarioParam === "not_world" ? scenarioParam : "play";
const host = createMockHost(params.get("drawer") !== "closed");
const backend = new MockBackend((payload) => host.deliver(payload), { scenario, ...(params.get("map") === "ring" ? { map: "ring" as const } : {}), closeDrawer: () => host.setDrawer(false) });
host.onSend = (payload) => backend.receive(payload as FrontendToBackend);
const teardown = setup(host.ctx);

declare global {
  interface Window {
    __lre: { backend: MockBackend; host: typeof host; teardown: () => void };
  }
}
window.__lre = { backend, host, teardown };
