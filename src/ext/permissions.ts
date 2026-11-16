// What the light extension needs of Lumiverse's permissions (STANDALONE-PLAN §4.2, Permissions), and
// why, in the words its notice shows. `interceptor`, `generation` and `cors_proxy` need an admin's
// approval; `generation_parameters` and `ui_panels` are granted without one
// (`spindle/manager.service.ts:878-918`). A registration made while its permission is missing is
// dropped, not kept for later (`worker-host.ts:3143-3153`, `:4910-4919`, `:2894-2907`), so whatever a
// grant opens is registered again when it comes. These five are all the manifest asks for.

import type { MissingPermission } from "../adapter/lumiverse/pipe-wire";

export const NEEDS: readonly MissingPermission[] = [
  { permission: "interceptor", why: "to leave history beyond your window out of a reply's prompt, and to mark the replies RPE plays" },
  { permission: "generation_parameters", why: "to carry that mark to RPE with the reply's request; without it RPE's replies are stopped" },
  { permission: "generation", why: "to hear when a reply starts, and to keep lore secrets out of prompts" },
  { permission: "cors_proxy", why: "to reach RPE on this machine, for the questions before each reply and for pages that cannot reach RPE themselves" },
  { permission: "ui_panels", why: "to open RPE's heads-up display and its panels in your chat" },
];

/** What is not granted of what the extension needs, in the order of `NEEDS`. */
export function missing(granted: Iterable<string>): MissingPermission[] {
  const have = new Set(granted);
  return NEEDS.filter((n) => !have.has(n.permission));
}
