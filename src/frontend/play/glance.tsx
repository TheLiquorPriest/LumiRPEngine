// Play → Now glances: every pack's glance is this titled list of at most
// three rows whose Open button shows the panel where the rows live, so the glances read alike.

import type { ComponentChildren } from "preact";
import type { PanelId } from "../../shared/ids";
import { showPanel, useApp } from "../app";
import { Button, List, Section } from "../components";

/** The most rows a glance shows. */
export const GLANCE_ROWS = 3;

export function GlanceCard(props: { title: string; panel: PanelId; children: ComponentChildren }) {
  const app = useApp();
  // Open names the panel it shows, which can differ from the glance's own title.
  const where = app.catalog.panels.find((panel) => panel.id === props.panel)?.label ?? props.title;
  return (
    <Section
      title={props.title}
      flush
      aside={
        <Button variant="ghost" size="sm" iconAfter="chevron-right" label={`Open ${where}`} onClick={() => app.ui.update((ui) => showPanel(ui, app.catalog, props.panel))}>
          Open
        </Button>
      }
    >
      <List>{props.children}</List>
    </Section>
  );
}
