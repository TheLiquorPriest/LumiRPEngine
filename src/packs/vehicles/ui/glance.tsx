// The Garage's glance on Now: a vehicle low on fuel, kept past its use grant, or overdue for
// service or registration; at most three rows.

import { Badge, ListRow } from "../../../frontend/components";
import type { IconName } from "../../../frontend/icons";
import type { PanelProps } from "../../../frontend/registry";
import type { GarageView } from "../core/view";
import { GLANCE_ROWS, GlanceCard } from "../../../frontend/play/glance";
import { decodeGarageView, LOW_FUEL_PCT, vehicleIcon } from "./panel";

export interface GarageAlert {
  key: string;
  vehicle: string;
  icon: IconName;
  text: string;
  flag: "Low" | "Overdue";
}

/** What needs attention across the garage, vehicle by vehicle: low fuel, an overdue use grant, overdue service. */
export function garageAlerts(view: GarageView): GarageAlert[] {
  const out: GarageAlert[] = [];
  for (const v of view.vehicles) {
    const icon = vehicleIcon(v);
    if (v.fuelPct !== undefined && v.fuelPct < LOW_FUEL_PCT) out.push({ key: `${v.id}:fuel`, vehicle: v.name, icon, text: `Fuel ${Math.round(v.fuelPct)}%${v.rangeLabel ? ` · ${v.rangeLabel}` : ""}`, flag: "Low" });
    if (v.assignedTo?.overdue) out.push({ key: `${v.id}:grant`, vehicle: v.name, icon, text: `Loan to ${v.assignedTo.name}${v.assignedTo.until ? ` ended ${v.assignedTo.until}` : ""}`, flag: "Overdue" });
    for (const s of v.service ?? []) if (s.overdue) out.push({ key: `${v.id}:service:${s.label}`, vehicle: v.name, icon, text: `${s.label} · ${s.due}`, flag: "Overdue" });
  }
  return out;
}

export function GarageGlance(props: PanelProps) {
  const view = decodeGarageView(props.view);
  const alerts = view ? garageAlerts(view) : [];
  if (alerts.length === 0) return null;
  return (
    <GlanceCard title="Garage" panel="vehicles.garage">
      {alerts.slice(0, GLANCE_ROWS).map((alert) => (
        <ListRow key={alert.key} icon={alert.icon} title={alert.vehicle} subtitle={alert.text} badge={<Badge tone="warn">{alert.flag}</Badge>} />
      ))}
    </GlanceCard>
  );
}
