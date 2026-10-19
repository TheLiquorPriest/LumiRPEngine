// Gear's glance on Now: things the POV lent that are overdue back, each opening its item sheet.
// Nothing else in the Gear view needs attention turn to turn, so the glance is usually absent.

import { pushSheet, useApp } from "../../../frontend/app";
import { Badge, ListRow } from "../../../frontend/components";
import type { PanelProps } from "../../../frontend/registry";
import type { GearItem, GearView } from "../core/view";
import { GLANCE_ROWS, GlanceCard } from "../../../frontend/play/glance";
import { decodeGearView, lentText, SECTIONS } from "./panel";

/** Every item lent out and overdue, each once (an owned thing can also show where it is). */
export function overdueLoans(view: GearView): GearItem[] {
  const seen = new Map<string, GearItem>();
  const walk = (items: readonly GearItem[]) => {
    for (const item of items) {
      if (item.lent?.overdue && !seen.has(item.id)) seen.set(item.id, item);
      walk(item.children ?? []);
    }
  };
  for (const section of SECTIONS) walk(view[section]);
  return [...seen.values()];
}

export function GearGlance(props: PanelProps) {
  const app = useApp();
  const view = decodeGearView(props.view);
  const overdue = view ? overdueLoans(view) : [];
  if (overdue.length === 0) return null;
  return (
    <GlanceCard title="Gear" panel="gear.gear">
      {overdue.slice(0, GLANCE_ROWS).map((item) => (
        <ListRow key={item.id} icon="user-plus" title={item.name} subtitle={item.lent ? lentText(item.lent) : undefined} badge={<Badge tone="warn">Overdue</Badge>} chevron onClick={() => app.ui.update((ui) => pushSheet(ui, { kind: "item", id: item.id }))} />
      ))}
    </GlanceCard>
  );
}
