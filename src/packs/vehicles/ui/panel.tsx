// Play → Garage (DESIGN §9.1 Vehicles): "runs fine" at level 1; fuel, location and owner from 2;
// odometer, use grants and home base from 3; maintenance and registration at 4. Overdue use
// grants and service are flagged.

import { isRecord } from "../../../shared/json";
import { Card, Empty, JsonView, Row } from "../../../frontend/components";
import { list, num, obj, optNum, optStr, str } from "../../../frontend/decode";
import type { PanelProps } from "../../../frontend/registry";
import type { GarageVehicle, GarageView } from "../core/view";

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

export function GaragePanel(props: PanelProps) {
  const view = decodeGarageView(props.view);
  if (props.view === null || props.view === undefined) return <Empty>No vehicles.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  if (view.vehicles.length === 0) return <Empty>No vehicles yet.</Empty>;
  return (
    <div class="lre-stack" data-lre-panel="vehicles.garage">
      {view.vehicles.map((v) => (
        <Card key={v.id} title={v.name} aside={<span class={v.status.toLowerCase().includes("fine") || v.status.toLowerCase() === "ok" ? "lre-badge pos" : "lre-badge warn"}>{v.status}</span>}>
          {v.kind ? <div class="lre-small lre-muted">{v.kind}</div> : null}
          {v.fuelPct !== undefined ? (
            <div class="lre-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div class="lre-spread">
                <span>Fuel</span>
                <span class="lre-num">
                  {Math.round(v.fuelPct)}%{v.rangeLabel ? ` · ${v.rangeLabel}` : ""}
                </span>
              </div>
              <div class={v.fuelPct < 15 ? "lre-bar low" : "lre-bar"}>
                <span style={{ width: `${Math.max(0, Math.min(100, v.fuelPct))}%` }} />
              </div>
            </div>
          ) : null}
          {v.place ? <Row k="Location" v={v.place} sub={v.home && v.home !== v.place ? `home: ${v.home}` : undefined} /> : null}
          {v.odometerLabel ? <Row k="Odometer" v={v.odometerLabel} /> : null}
          {v.condition !== undefined ? <Row k="Condition" v={`${Math.round(v.condition)}%`} /> : null}
          {v.assignedTo ? <Row k="Assigned to" v={v.assignedTo.name} sub={v.assignedTo.overdue ? `overdue since ${v.assignedTo.until ?? "—"}` : v.assignedTo.until ? `until ${v.assignedTo.until}` : undefined} tone={v.assignedTo.overdue ? "warn" : undefined} /> : null}
          {(v.service ?? []).map((s) => (
            <Row key={s.label} k={s.label} v={s.due} tone={s.overdue ? "warn" : undefined} sub={s.overdue ? "overdue" : undefined} />
          ))}
        </Card>
      ))}
    </div>
  );
}
