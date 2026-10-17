// The Garage panel's view model (`vehicles.garage`): the POV's vehicles and the ones it uses.

import type { EntityId } from "../../../shared/ids";
import type { ReadContext } from "../../../engine/registry";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { numOf, strOf, own, rowOf } from "../../../engine/pack-kit";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { rangeLeft, serviceInterval } from "./index";

export interface GarageVehicle {
  id: EntityId;
  name: string;
  kind: string;
  status: string;
  place: string | null;
  fuelPct?: number;
  rangeLabel?: string;
  odometerLabel?: string;
  condition?: number;
  home?: string;
  assignedTo?: { name: string; until?: string; overdue: boolean };
  service?: { label: string; due: string; overdue: boolean }[];
}

export interface GarageView {
  level: number;
  vehicles: GarageVehicle[];
}

export function buildGarageView(ctx: ReadContext): GarageView {
  const pov = ctx.world.pov;
  const level = ctx.levelOf(pov, "vehicles");
  const cal = calendarOf(ctx.world);
  const vehicles: GarageVehicle[] = [];
  for (const id of Object.keys(ctx.state.entities).sort()) {
    const e = own(ctx.state.entities, id);
    if (!e || !kindIs(ctx.registry, ctx.world, e.kind, "vehicle") || isGone(ctx.state, id)) continue;
    const grant = Object.keys(ctx.state.entities)
      .sort()
      .map((b) => ({ b, r: own(ctx.state.entities, b)?.relations.find((x) => x.type === "uses" && x.to === id) }))
      .find((x) => x.r);
    if (e.fields.owner !== pov && grant?.b !== pov) continue;
    const place = placeOfEntity(ctx.state, id);
    const cls = rowOf(ctx, "vehicles.classes", strOf(e.fields.class));
    const v: GarageVehicle = {
      id,
      name: e.name,
      kind: strOf(cls?.domain, "road"),
      status: level <= 1 ? (e.fields.status === "broken" ? "broken" : "runs fine") : strOf(e.fields.status, "ok").replace(/_/g, " "),
      place: place ? (own(ctx.world.places, place)?.name ?? place) : null,
    };
    if (level >= 2) {
      v.fuelPct = Math.round(numOf(e.fields.fuel_pct, 100));
      const range = rangeLeft(ctx, id);
      if (range) v.rangeLabel = `~${Math.round(range.value)} ${range.unit}`;
    }
    if (level >= 3) {
      if (typeof e.fields.odometer_mi === "number") v.odometerLabel = `${Math.round(e.fields.odometer_mi).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} mi`;
      else if (typeof e.fields.engine_hours === "number") v.odometerLabel = `${Math.round(e.fields.engine_hours)} h`;
      if (typeof e.fields.condition === "number") v.condition = e.fields.condition;
      if (typeof e.fields.home === "string") v.home = own(ctx.world.places, e.fields.home)?.name ?? e.fields.home;
      if (grant?.r) {
        const until = grant.r.until;
        v.assignedTo = { name: own(ctx.state.entities, grant.b)?.name ?? grant.b, ...(until !== undefined ? { until: formatClock(cal, until) } : {}), overdue: until !== undefined && until <= ctx.state.clock };
      }
    }
    if (level >= 4) {
      const interval = serviceInterval(ctx, id);
      if (interval !== null) {
        const used = typeof e.fields.odometer_mi === "number" ? e.fields.odometer_mi : numOf(e.fields.engine_hours);
        const due = numOf(e.fields.last_service) + interval;
        const unit = typeof e.fields.odometer_mi === "number" ? "mi" : "h";
        v.service = [{ label: "Service", due: `${Math.round(due)} ${unit}`, overdue: used > due }];
      }
    }
    vehicles.push(v);
  }
  return { level, vehicles };
}
