// Play → Scene: where the POV is, who is present, the scene type and the last turn's elapsed
// time, plus the quick actions. Opening someone's detail is a player-facing observation
// (`lre.view.open`), which may materialize it (DESIGN §9.2).

import type { EntityId } from "../../shared/ids";
import { useApp } from "../app";
import { Card, Empty, Row, useBusy } from "../components";
import { formatMinutes, humanize } from "../format";
import type { PanelProps } from "../registry";
import { cashText, clockText } from "../hud";

export function ScenePanel(props: PanelProps) {
  const app = useApp();
  const { state } = props;
  const [busy, run] = useBusy();
  const scene = state.scene;
  const hud = state.hud;
  const open = (entity: EntityId) =>
    run(async () => {
      const cast = app.catalog.panels.find((panel) => panel.id === "castlife.cast");
      const result = await app.request({ type: "lre.view.open", chatId: props.chatId, panel: cast ? cast.id : "core.scene", entity });
      if (result && cast) app.ui.update((ui) => ({ ...ui, playPanel: cast.id }));
      if (result?.pending) app.toast("Details appear when the reply finishes.", "info");
    });
  return (
    <div class="lre-stack" data-lre-panel="core.scene">
      <Card title="Now">
        {hud ? <Row k="Time" sub={hud.clock.dayPart} v={<span class="lre-num">{clockText(hud)}</span>} /> : null}
        <Row k="Place" v={hud?.place?.name ?? "—"} />
        {scene ? <Row k="Scene" v={humanize(scene.sceneType)} sub={scene.elapsed > 0 ? `Last turn took ${formatMinutes(scene.elapsed)}` : "No time passed last turn"} /> : null}
        {hud?.weather ? <Row k="Weather" v={hud.weather} /> : null}
        {hud?.cash ? <Row k="Cash" v={<span class="lre-num">{cashText(hud.cash)}</span>} /> : null}
      </Card>
      <Card title="Present" aside={scene ? <span class="lre-badge">{scene.present.length}</span> : null}>
        {!scene || scene.present.length === 0 ? (
          <Empty>Nobody else is here.</Empty>
        ) : (
          <div class="lre-list">
            {scene.present.map((person) => {
              const pending = state.pending.some((mark) => mark.entity === person.id);
              return (
                <button key={person.id} type="button" class="lre-item" disabled={busy} onClick={() => open(person.id)}>
                  <span class="grow">
                    <span class="title">{person.name}</span>
                    <span class="sub">{person.label}</span>
                  </span>
                  {person.life ? <span class="lre-badge neg">{person.life}</span> : null}
                  {pending ? (
                    <span class="lre-badge warn">pending</span>
                  ) : (
                    <span class="lre-dim" aria-hidden="true">
                      ›
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Card>
      <div class="lre-inline">
        <button type="button" class="lre-btn" onClick={() => void app.overlays.openPalette("actions")}>
          <span aria-hidden="true">⚡</span> Actions
        </button>
        {state.palette?.timelapse ? (
          <button type="button" class="lre-btn" onClick={() => void app.overlays.openPalette("timelapse")}>
            <span aria-hidden="true">⏩</span> Timelapse
          </button>
        ) : null}
        {state.panels["space.map"] !== undefined ? (
          <button type="button" class="lre-btn" onClick={() => void app.overlays.openMap()}>
            <span aria-hidden="true">🗺</span> Map
          </button>
        ) : null}
      </div>
    </div>
  );
}
