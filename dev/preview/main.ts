// Preview harness boot: a mock host plus a mock backend, then the real frontend `setup`.
// URL: ?scenario=play|paused|not_world|fresh|combat|sheet&drawer=open|closed&theme=dark|light (default dark)&map=ring|manor|square&heads=on|off (default off)
//   &activity=busy|failed: the engine mid-turn ("Asking 3 minds…"), or its last turn failed (Diagnostics has the records)
//   &draft=elsewhere[&draftDelay=<seconds>, default 10]: that long after Build first loads a draft, another window
//     renames the world and changes Rosie's mood (`lre.draft.changed`); a form holding edits over either shows
//     Build's "changed elsewhere" notice. `__lre.backend.changeDraftElsewhere()` changes it again at any time.
//   &studio=new|revision|moved|errors|none: what LumiRPEngine Studio has waiting. Any but `none` says an offer is
//     waiting once the preview boots, so Build's world list opens on its review. Without it, Import from
//     LumiRPEngine Studio finds nothing waiting.
//   &money=<party>: Play's money is that Port Alder party's and GM → Money everyone's there, as the engine keeps
//     them nine days into a chat (`marcus_delgado`: a business, a house and credit; `helen_kowalczyk`: a
//     household; `pov`: a job and investments).
//   ?pickers: the character pickers alone in the drawer (place, bed, a list of text) over a 320-place world,
//     in place of the app (dev/preview/pickers.tsx).

import { setup } from "../../src/frontend/setup";
import type { FrontendToBackend } from "../../src/shared/protocol";
import { STUDIO_OFFER_EVENT } from "../../src/shared/studio-bridge";
import type { StudioCase } from "./fixtures";
import { STARTER_MAPS } from "./fixtures";
import { MockBackend } from "./mock-backend";
import { createMockHost } from "./mock-host";
import { mountPickers } from "./pickers";
import { DARK_THEME, LIGHT_THEME } from "./themes";

const params = new URLSearchParams(location.search);
const light = params.get("theme") === "light";
const root = document.documentElement;
for (const [name, value] of Object.entries(light ? LIGHT_THEME : DARK_THEME)) root.style.setProperty(name, value);
root.style.colorScheme = light ? "light" : "dark";
const scenarioParam = params.get("scenario");
const scenario = scenarioParam === "paused" || scenarioParam === "not_world" || scenarioParam === "fresh" || scenarioParam === "combat" || scenarioParam === "sheet" ? scenarioParam : "play";
const studioParam = params.get("studio");
const studio: StudioCase = studioParam === "new" || studioParam === "revision" || studioParam === "moved" || studioParam === "errors" ? studioParam : "none";
const delay = Number(params.get("draftDelay") ?? "10");
const draftElsewhereMs = params.get("draft") === "elsewhere" ? (Number.isFinite(delay) && delay >= 0 ? delay : 10) * 1000 : undefined;
const host = createMockHost({ drawerOpen: params.get("drawer") !== "closed", heads: params.get("heads") === "on" });
const starter = STARTER_MAPS[params.get("map") ?? ""];
const money = params.get("money") ?? "";
const activityParam = params.get("activity");
const activity = activityParam === "busy" || activityParam === "failed" ? activityParam : undefined;
const backend = new MockBackend((payload) => host.deliver(payload), { scenario, studio, ...(starter ? { map: starter } : {}), ...(money ? { money } : {}), ...(draftElsewhereMs !== undefined ? { draftElsewhereMs } : {}), ...(activity ? { activity } : {}), closeDrawer: () => host.setDrawer(false) });
host.onSend = (payload) => backend.receive(payload as FrontendToBackend);
const teardown = params.has("pickers") ? mountPickers() : setup(host.ctx);
// As the Studio's frontend does when it has a world waiting (DESIGN §15).
if (studio !== "none") window.dispatchEvent(new CustomEvent(STUDIO_OFFER_EVENT, { detail: { offerId: `offer-${studio}` } }));

declare global {
  interface Window {
    __lre: { backend: MockBackend; host: typeof host; teardown: () => void };
  }
}
window.__lre = { backend, host, teardown };
