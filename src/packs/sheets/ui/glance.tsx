// Play → Now glance for the You panel (contract §4.4, §6.4): the POV's active conditions, on the
// glance card every pack shares.

import { Badge, ListRow } from "../../../frontend/components";
import { GlanceCard } from "../../../frontend/play/glance";
import type { PanelProps } from "../../../frontend/registry";
import { decodeYouView } from "./panel";

/** The POV's active conditions, when there are any. */
export function YouGlance(props: PanelProps) {
  const view = decodeYouView(props.view);
  if (!view || view.conditions.length === 0) return null;
  return (
    <GlanceCard title="You" panel="sheets.you">
      <ListRow
        icon="pulse"
        title="Conditions"
        badge={
          <span class="lre-me-badges">
            {view.conditions.map((c) => (
              <Badge key={c} tone="warn">
                {c}
              </Badge>
            ))}
          </span>
        }
      />
    </GlanceCard>
  );
}
