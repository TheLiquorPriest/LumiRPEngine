// Play → Me → Garage (DESIGN §9.1 Vehicles): "runs fine" at level 1; fuel, location and owner from
// 2; odometer, use grants and home base from 3; maintenance and registration at 4. Each vehicle is a
// card; overdue use grants and service are flagged.

import { isRecord } from "../../../shared/json";
import { Badge, Empty, JsonView, List, ListRow, Meter } from "../../../frontend/components";
import { list, num, obj, optNum, optStr, str } from "../../../frontend/decode";
import { Icon } from "../../../frontend/icons";
import type { IconName } from "../../../frontend/icons";
import type { PanelProps } from "../../../frontend/registry";
import type { GarageVehicle, GarageView } from "../core/view";

/** Below this much fuel a vehicle is flagged low, here and on Now. */
export const LOW_FUEL_PCT = 15;

export function decodeGarageView(value: unknown): GarageView | null {
  if (!isRecord(value) || !Array.isArray(value.vehicles)) return null;
  return {
    level: num(value.level, 1),
    vehicles: list(value.vehicles, (v) => {
      const assigned = obj(v.assignedTo);
      return typeof v.id === "string"
        ? {
            id: v.id,
            name: str(v.name, v.id),
            kind: str(v.kind),
            status: str(v.status, "runs fine"),
            place: optStr(v.place) ?? null,
            fuelPct: optNum(v.fuelPct),
            rangeLabel: optStr(v.rangeLabel),
            odometerLabel: optStr(v.odometerLabel),
            condition: optNum(v.condition),
            home: optStr(v.home),
            assignedTo: assigned ? { name: str(assigned.name), until: optStr(assigned.until), overdue: assigned.overdue === true } : undefined,
            service: list(v.service, (s) => ({ label: str(s.label), due: str(s.due), overdue: s.overdue === true })),
          }
        : null;
    }),
  };
}

/** A boat by its kind or domain ("Boat · outboard", "water"); everything else draws as a car. */
export function vehicleIcon(v: GarageVehicle): IconName {
  return /boat|water|sea|marine/i.test(v.kind) ? "boat" : "car";
}

function VehicleCard(props: { vehicle: GarageVehicle }) {
  const v = props.vehicle;
  // "runs fine" or "ok" reads as fine; any other status needs attention.
  const status = v.status.toLowerCase();
  const fine = status.includes("fine") || status === "ok";
  const fuel = v.fuelPct === undefined ? null : Math.max(0, Math.min(100, Math.round(v.fuelPct)));
  return (
    <section class="lre-me-vehicle" aria-label={v.name}>
      <div class="lre-me-vehicle-head">
        <span class="lre-me-vehicle-icon">
          <Icon name={vehicleIcon(v)} />
        </span>
        <div class="lre-me-vehicle-titles">
          <h3 class="lre-me-vehicle-name">{v.name}</h3>
          {v.kind ? <span class="lre-me-vehicle-kind">{v.kind}</span> : null}
        </div>
        <Badge tone={fine ? "pos" : "warn"}>
          <Icon name={fine ? "check" : "alert"} size={12} />
          {v.status}
        </Badge>
      </div>
      {fuel !== null || v.condition !== undefined ? (
        <div class="lre-me-vehicle-meters">
          {fuel !== null ? <Meter label={`Fuel ${fuel}%${v.rangeLabel ? ` · ${v.rangeLabel}` : ""}${fuel < LOW_FUEL_PCT ? " · low" : ""}`} value={fuel} max={100} tone={fuel < LOW_FUEL_PCT ? "neg" : "accent"} /> : null}
          {v.condition !== undefined ? <Meter label={`Condition ${Math.round(v.condition)}%`} value={Math.round(v.condition)} max={100} tone={v.condition <= 25 ? "neg" : "accent"} /> : null}
        </div>
      ) : null}
      <List>
        {v.place ? <ListRow icon="pin" title="Location" subtitle={v.home && v.home !== v.place ? `home: ${v.home}` : undefined} value={v.place} /> : null}
        {v.odometerLabel ? <ListRow icon="route" title={v.odometerLabel.endsWith(" h") ? "Engine hours" : "Odometer"} value={v.odometerLabel} /> : null}
        {v.assignedTo ? (
          <ListRow
            icon="key"
            title="Assigned to"
            subtitle={v.assignedTo.overdue ? `overdue since ${v.assignedTo.until ?? "—"}` : v.assignedTo.until ? `until ${v.assignedTo.until}` : undefined}
            value={v.assignedTo.name}
            badge={v.assignedTo.overdue ? <Badge tone="warn">Overdue</Badge> : undefined}
          />
        ) : null}
        {(v.service ?? []).map((s) => (
          <ListRow key={s.label} icon="wrench" title={s.label} value={s.due} valueTone={s.overdue ? "warn" : undefined} badge={s.overdue ? <Badge tone="warn">Overdue</Badge> : undefined} />
        ))}
      </List>
    </section>
  );
}

export function GaragePanel(props: PanelProps) {
  const view = decodeGarageView(props.view);
  if (props.view === null || props.view === undefined) return <Empty icon="car">No vehicles.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  if (view.vehicles.length === 0) return <Empty icon="car">No vehicles yet.</Empty>;
  return (
    <div class="lre-stack lre-me" data-lre-panel="vehicles.garage">
      {view.vehicles.map((v) => (
        <VehicleCard key={v.id} vehicle={v} />
      ))}
    </div>
  );
}
