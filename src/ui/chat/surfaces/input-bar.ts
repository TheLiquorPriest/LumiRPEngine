// The input-bar actions (plan §14, PlanChatUI-2 item 3): World actions…, Timelapse…, Pause clock or
// Resume clock (the label follows the clock) and World map, each in the composer's action bar while the
// open chat plays a world, enabled by today's rules (a palette; a timelapse tab; a HUD; a map panel).
// The host takes an action's label and state when it is registered, so each is registered under a key
// that says them, and the frame asks again whenever the state moves.

import { timeMarker } from "../../../frontend/requests";
import { chatPlay } from "../chat-play";
import type { ChatSurface, SurfaceDef } from "../surface";

export const surface: SurfaceDef = {
  id: "input-bar",
  surfaces(env) {
    const play = chatPlay(env);
    if (play === null) return [];
    const { app } = play;
    const view = app.sync.get().view;
    const world = view !== null && view.status !== "not_world";
    const paused = view?.hud?.clock.paused === true;
    const at = (id: string, label: string, enabled: boolean, onClick: () => void): ChatSurface => ({ key: `input:${play.chat}:${id}:${label}:${enabled}`, placement: "input-bar-action", options: { id: `lre-${id}`, label, enabled }, onClick });
    return [
      at("actions", "World actions…", world && view.palette !== null, () => void app.overlays.openPalette("actions")),
      at("timelapse", "Timelapse…", world && view.palette?.timelapse != null, () => void app.overlays.openPalette("timelapse")),
      at("clock", paused ? "Resume clock" : "Pause clock", world && view.hud !== null, () => {
        const now = app.sync.get().view;
        if (now?.hud) void app.request(timeMarker(now.chatId, "pause", { all: true }, !now.hud.clock.paused));
      }),
      at("map", "World map", world && view.panels["space.map"] !== undefined, () => void app.overlays.openMap()),
    ];
  },
};
