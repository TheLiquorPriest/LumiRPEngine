// The HUD over the chat (plan §14, PlanChatUI-2 items 1 and 4): today's pill in a float widget while the
// open chat plays a world, sized by its content and placed where Lumiverse keeps it, and on a phone the
// status line above the composer doing the pill's job (the pill hides where a status line is mounted).
// Phone and desktop each save the pill's place under their own key, so crossing the phone's width makes
// a new widget under the other layout's key (the surface's key says which).

import { render } from "preact";
import { AppContext } from "../../../frontend/app";
import { Hud, type HudSize, StatusLine } from "../../../frontend/hud";
import { hudCentreX, hudFloatRect, isMobile } from "../../../frontend/layout";
import { chatPlay } from "../chat-play";
import type { FloatHandle, FrameEnv, SurfaceDef } from "../surface";

/** Whether the pill shows: the chat plays a world, the state has its values, and a phone's status line does not already say them. */
function pillShown(env: FrameEnv): boolean {
  const play = chatPlay(env);
  const view = play?.app.sync.get().view ?? null;
  const world = view !== null && view.status !== "not_world" && view.hud !== null;
  return world && (!isMobile(env.host.viewport.get()) || (play?.statusLines.get() ?? 0) === 0);
}

function drawPill(env: FrameEnv, handle: FloatHandle): () => void {
  const play = chatPlay(env);
  if (play === null) return () => undefined;
  handle.root.style.width = "100%";
  handle.root.style.height = "100%";
  let size: HudSize = { width: 0, height: 0 };
  const rect = hudFloatRect(env.host.viewport.get());
  // Where the code last put the pill: while it is still there (the player has not moved it), it stays centred as its content resizes it.
  let placed = { x: rect.x, y: rect.y };
  const widget = handle as FloatHandle & { getPosition?(): { x: number; y: number }; moveTo?(x: number, y: number): void };
  render(
    <AppContext.Provider value={play.app}>
      <div class="lre" style={{ width: "max-content", height: "100%" }}>
        <Hud
          resize={(next) => {
            if (next.width === size.width && next.height === size.height) return;
            size = next;
            handle.setSize(next.width, next.height);
            const at = widget.getPosition?.();
            if (at === undefined || at.x !== placed.x || at.y !== placed.y) return;
            placed = { x: hudCentreX(env.host.viewport.get(), next.width), y: placed.y };
            widget.moveTo?.(placed.x, placed.y);
          }}
        />
      </div>
    </AppContext.Provider>,
    handle.root,
  );
  const follow = (): void => handle.setVisible(pillShown(env));
  const offs = [play.app.sync.subscribe(follow), play.statusLines.subscribe(follow), env.host.viewport.subscribe(follow)];
  follow();
  return () => {
    for (const off of offs) off();
    render(null, handle.root);
  };
}

export const surface: SurfaceDef = {
  id: "hud",
  surfaces(env) {
    const play = chatPlay(env);
    if (play === null) return [];
    const rect = hudFloatRect(env.host.viewport.get());
    return [
      {
        key: `hud:${play.chat}:${rect.key}`,
        placement: "float-widget",
        options: { width: rect.width, height: rect.height, initialPosition: { x: rect.x, y: rect.y }, chromeless: true, tooltip: "World status", persistGeometry: rect.key },
        render: (handle) => drawPill(env, handle),
      },
      {
        key: `status-line:${play.chat}`,
        placement: "dom-decorator",
        options: {
          mount: "chat_composer_above",
          render(root) {
            render(
              <AppContext.Provider value={play.app}>
                <div class="lre">
                  <StatusLine />
                </div>
              </AppContext.Provider>,
              root,
            );
            play.statusLines.update((count) => count + 1);
            return () => {
              render(null, root);
              play.statusLines.update((count) => count - 1);
            };
          },
        },
      },
    ];
  },
};
