// Play: the running chat. Section tabs come from the UI registry (core panels always; a pack's
// panels when its view is in the state), with status banners for a paused chat and an in-flight
// turn. A chat that isn't a world chat offers to attach a world.

import { useEffect, useId, useState } from "preact/hooks";
import type { PanelId } from "../../shared/ids";
import type { WorldIndex } from "../../shared/world";
import type { StateView } from "../../shared/state-view";
import { useApp, useUi } from "../app";
import { KeepReportChip } from "../chips";
import { Card, Empty, JsonView, Tabs, tabPanel, useBusy } from "../components";
import type { PanelDef } from "../registry";
import { useSelect } from "../store";
import type { UiCatalog } from "../ui-registry";

/** Core panels always show; a pack's panel shows once its view model is in the state. */
export function visiblePanels(catalog: UiCatalog, view: StateView): PanelDef[] {
  return catalog.panels.filter((panel) => panel.id.startsWith("core.") || view.panels[panel.id] !== undefined);
}

export function Play() {
  const app = useApp();
  const sync = useSelect(app.sync, (state) => state);
  const selected = useUi((ui) => ui.playPanel);
  const mapInDrawer = useUi((ui) => ui.mapInDrawer);
  const view = sync.view;
  const panelId = useId();
  const panels = view && view.status !== "not_world" ? visiblePanels(app.catalog, view) : [];
  const current = (mapInDrawer && panels.some((p) => p.id === "space.map") ? "space.map" : selected && panels.some((p) => p.id === selected) ? selected : panels[0]?.id) ?? null;
  const chatId = view && view.status !== "not_world" ? view.chatId : null;
  // Showing a pack's panel is a player-facing observation of the POV (DESIGN §9.2): it may
  // materialize the POV's detail in that pack's domain. Until it lands (or while a reply holds the
  // write), the panel shows the representation, so nothing waits on the answer and a refusal says
  // nothing. Context sends its own on opening.
  useEffect(() => {
    if (chatId !== null && current !== null && !current.startsWith("core.")) void app.send({ type: "lre.view.open", chatId, panel: current, entity: null });
  }, [chatId, current]);
  if (sync.chatId === null) return <Empty>Open a chat to play.</Empty>;
  if (!view) return sync.status === "closed" ? <NotWorld chatId={sync.chatId} /> : <Empty>Connecting to the engine…</Empty>;
  if (view.status === "not_world") return <NotWorld chatId={view.chatId} />;
  const panel = panels.find((p) => p.id === current);
  const keep = view.chips.find((chip) => chip.kind === "keep_report");
  const select = (id: PanelId) => app.ui.update((ui) => ({ ...ui, playPanel: id, mapInDrawer: id === "space.map" ? ui.mapInDrawer : false }));
  return (
    <div class="lre-stack" data-lre-section="play">
      {view.status === "paused" ? (
        <div class="lre-banner warn" role="status">
          <strong>Paused</strong>
          <span>A user message was edited. Later turns don't change the world until you Keep or Discard.</span>
          {keep ? <KeepReportChip chip={keep} chatId={view.chatId} send={app.send} /> : null}
        </div>
      ) : null}
      {view.status === "in_flight" ? (
        <div class="lre-banner info" role="status">
          A turn is running. Changes you make now apply when it finishes.
        </div>
      ) : null}
      <Tabs<PanelId> label="Play sections" panelId={panelId} value={current} tabs={panels.map((p) => ({ id: p.id, label: p.label, dot: view.pending.some((mark) => mark.panel === p.id) }))} onChange={select} />
      {mapInDrawer && current === "space.map" ? (
        <div class="lre-spread lre-small lre-muted">
          <span>The map opened here because the drawer couldn't close.</span>
          <button type="button" class="lre-btn small" onClick={() => app.ui.update((ui) => ({ ...ui, mapInDrawer: false }))}>
            Done
          </button>
        </div>
      ) : null}
      {panel ? (
        <div {...tabPanel(panelId, current)} style={panel.id === "space.map" ? { height: "min(70vh, 560px)" } : undefined}>
          <panel.component chatId={view.chatId} view={view.panels[panel.id] ?? null} state={view} send={app.send} />
        </div>
      ) : (
        <Card>
          <JsonView value={view.panels} />
        </Card>
      )}
    </div>
  );
}

function NotWorld(props: { chatId: string }) {
  const app = useApp();
  const [worlds, setWorlds] = useState<WorldIndex[] | null>(null);
  const [busy, run] = useBusy();
  useEffect(() => {
    void app.request({ type: "lre.world", op: "list" }).then((result) => setWorlds(result?.worlds ?? []));
  }, []);
  return (
    <div class="lre-stack" data-lre-section="play-not-world">
      <Card title="Not a world chat">
        <p class="lre-muted" style={{ margin: "0 0 8px" }}>
          Attach a world to this chat to track time, places, money and everyone in it.
        </p>
        {worlds === null ? (
          <Empty>Loading worlds…</Empty>
        ) : worlds.length === 0 ? (
          <Empty>No worlds yet. Create one in Build.</Empty>
        ) : (
          <div class="lre-list">
            {worlds.map((world) => (
              <button
                key={world.id}
                type="button"
                class="lre-item"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const ok = await app.host.confirm("Attach world", `Attach “${world.name}” to this chat? The world starts at its current revision.`, "info", "Attach");
                    if (!ok) return;
                    const result = await app.request({ type: "lre.world", op: "attach", worldId: world.id, chatId: props.chatId });
                    if (result) void app.client.open(props.chatId);
                  })
                }
              >
                <span class="grow">
                  <span class="title">{world.name}</span>
                  <span class="sub">{world.revisions.length} revision{world.revisions.length === 1 ? "" : "s"}</span>
                </span>
                <span class="lre-dim">Attach</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" class="lre-btn block" style={{ marginTop: "8px" }} onClick={() => app.ui.update((ui) => ({ ...ui, section: "build", build: { view: "worlds" } }))}>
          Open Build
        </button>
      </Card>
    </div>
  );
}
