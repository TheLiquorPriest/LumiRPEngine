// The Garage panel's view model (`vehicles.garage`): every vehicle the POV may drive (the one reader,
// `vehiclesFor`), each with whose it is, what the POV's use rests on, its grants, class and cargo,
// and whether the POV may lend it; and what the Garage's controls pick from: the places the POV can
// see, where it stands, the people it may lend to, its household, a lend's ends and the classes a
// vehicle may be added as. Where one is, or its home base, reads "Somewhere" when the POV can't see
// the place, as on every player surface.

import type { PlaceRef } from "../../../shared/character";
import type { EntityId, PlaceId } from "../../../shared/ids";
import type { LoanChoice } from "../../../shared/thing-gm";
import { grantBasisOf, type GrantBasis } from "../../../shared/things";
import { vehicleClassChoices, vehicleSpecsOf, worldHasAir, type VehicleClassChoice, type VehicleSpec } from "../../../shared/vehicles";
import type { ReadContext } from "../../../engine/registry";
import { accessOf } from "../../../engine/access";
import { calendarOf, dateAt, formatClock } from "../../../engine/calendar";
import { knownPlaceRefs } from "../../../engine/character";
import { orgTypeOf } from "../../../engine/org";
import { numOf, strOf, own, rowOf } from "../../../engine/pack-kit";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { loanChoices } from "../../../engine/thing-gm";
import { canSeeEntity, canSeePlace, HIDDEN_PLACE_NAME } from "../../../engine/visibility";
import { useTier, vehiclesFor, type VehicleUse } from "./access";
import { rangeLeft, serviceInterval } from "./index";

/** Someone the Garage names: a person to lend to, a household. */
export interface GarageParty {
  id: EntityId;
  name: string;
}

/** A grant on a vehicle: who may use it, on what ground, until when. */
export interface GarageGrant {
  who: EntityId;
  name: string;
  basis: GrantBasis;
  until?: string;
  overdue?: true;
}

export interface GarageVehicle {
  id: EntityId;
  name: string;
  kind: string;
  status: string;
  place: string | null;
  /** Where it stands, by id, when the POV can see the place. */
  placeId?: PlaceId;
  fuelPct?: number;
  rangeLabel?: string;
  odometerLabel?: string;
  condition?: number;
  home?: string;
  /** Its home base, by id, when the POV can see the place. */
  homeId?: PlaceId;
  assignedTo?: { name: string; until?: string; overdue: boolean };
  service?: { label: string; due: string; overdue: boolean }[];
  /** Its class row and the table's name for it. */
  classId?: string;
  className?: string;
  /** Whose it is, as the Owner & use sheet reads it. */
  owner?: "self" | "household" | "nobody" | "other";
  ownerName?: string;
  /** What the POV's use of it rests on, in words ("Yours", "The Riveras's", "Lent to you until …"). */
  access?: string;
  /** Who else may use it, on what ground (grants in force). */
  grants?: GarageGrant[];
  /** What the POV can see in it, by name. */
  cargo?: string[];
  /** The POV owns it. */
  mine?: boolean;
  /** The POV may lend it out or let someone use it. */
  canLend?: boolean;
  /** Its free specs ("Engine": "5.0L V8"), when it has any. */
  specs?: VehicleSpec[];
}

export interface GarageView {
  level: number;
  vehicles: GarageVehicle[];
  /** Places the POV can see, with their paths: where a vehicle is, its home base, where to drive. */
  places?: PlaceRef[];
  /** Where the POV stands, when it can see the place. */
  here?: PlaceId;
  /** People the POV can see, to lend to. */
  people?: GarageParty[];
  household?: GarageParty | null;
  loans?: LoanChoice[];
  /** The classes a vehicle may be added as (aircraft only where the world flies). */
  classes?: VehicleClassChoice[];
}

/** At most this many people go to the lend picker. */
const PEOPLE_CAP = 200;

/** What the POV's use of a vehicle rests on, in words. */
function accessWords(ctx: ReadContext, u: VehicleUse, ownerName: string, household: boolean): string {
  const cal = calendarOf(ctx.world);
  switch (u.use.basis) {
    case "owner":
      return u.mine ? "Yours" : `${ownerName}'s`;
    case "grant":
      return u.use.grant === "hold" ? `Holding it for ${ownerName}` : u.use.until !== undefined ? `Lent to you until ${formatClock(cal, u.use.until)}` : "Assigned to you";
    case "staff":
      return `${ownerName}'s, yours to use at work`;
    case "permit":
      return `${ownerName}'s, yours to use`;
    default:
      return household ? "Your household's" : `${ownerName}'s`;
  }
}

export function buildGarageView(ctx: ReadContext): GarageView {
  const pov = ctx.world.pov;
  const level = ctx.levelOf(pov, "vehicles");
  const cal = calendarOf(ctx.world);
  const seesPlace = (p: PlaceId): boolean => canSeePlace(ctx.registry, ctx.world, ctx.state, pov, p);
  const seesEntity = (id: EntityId): boolean => canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id);
  const nameOf = (id: EntityId): string => (seesEntity(id) ? (own(ctx.state.entities, id)?.name ?? "someone") : "someone");
  const vehicles: GarageVehicle[] = [];
  for (const u of vehiclesFor(ctx, pov)) {
    const id = u.id;
    const e = own(ctx.state.entities, id);
    if (!e || (!u.mine && !seesEntity(id))) continue;
    const place = placeOfEntity(ctx.state, id);
    const cls = rowOf(ctx, "vehicles.classes", strOf(e.fields.class));
    const household = u.owner !== null && orgTypeOf(ctx, u.owner) === "household";
    const ownerName = u.owner !== null ? nameOf(u.owner) : "nobody";
    const v: GarageVehicle = {
      id,
      name: e.name,
      kind: strOf(cls?.domain, "road"),
      status: level <= 1 ? (e.fields.status === "broken" ? "broken" : "runs fine") : strOf(e.fields.status, "ok").replace(/_/g, " "),
      place: place ? (seesPlace(place) ? (own(ctx.world.places, place)?.name ?? place) : HIDDEN_PLACE_NAME) : null,
      ...(place && seesPlace(place) ? { placeId: place } : {}),
      ...(cls ? { classId: strOf(e.fields.class), className: strOf(cls.name, strOf(e.fields.class)) } : {}),
      owner: u.mine ? "self" : household ? "household" : u.owner === null ? "nobody" : "other",
      ...(u.mine || u.owner === null ? {} : { ownerName }),
      access: accessWords(ctx, u, ownerName, household),
      mine: u.mine,
      canLend: u.canLend,
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
      const home = e.fields.home;
      if (typeof home === "string") {
        v.home = seesPlace(home) ? (own(ctx.world.places, home)?.name ?? home) : HIDDEN_PLACE_NAME;
        if (seesPlace(home)) v.homeId = home;
      }
      if (u.use.basis === "grant") v.assignedTo = { name: own(ctx.state.entities, pov)?.name ?? pov, ...(u.use.until !== undefined ? { until: formatClock(cal, u.use.until) } : {}), overdue: u.use.until !== undefined && u.use.until <= ctx.state.clock };
    }
    // Who else may use it: shown to whoever may lend it, at the level grants are told.
    if (u.canLend && useTier({ basis: "grant" }) <= level) {
      v.grants = accessOf(ctx.state, id)
        .users.filter((g) => g.who !== pov && seesEntity(g.who))
        .map((g): GarageGrant => {
          const fields = own(ctx.state.entities, g.who)?.relations.find((r) => r.type === "uses" && r.to === id)?.fields;
          return { who: g.who, name: nameOf(g.who), basis: grantBasisOf(fields, g.until), ...(g.until !== undefined ? { until: formatClock(cal, g.until) } : {}), ...(g.until !== undefined && g.until <= ctx.state.clock ? { overdue: true as const } : {}) };
        });
    }
    const cargo = Object.keys(ctx.state.entities)
      .sort()
      .filter((x) => !isGone(ctx.state, x) && seesEntity(x) && own(ctx.state.entities, x)?.relations.some((r) => r.type === "in" && r.to === id))
      .map((x) => own(ctx.state.entities, x)?.name ?? x);
    if (cargo.length > 0) v.cargo = cargo;
    const specs = vehicleSpecsOf(e.fields.specs) ?? [];
    if (specs.length > 0) v.specs = specs;
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
  const here = placeOfEntity(ctx.state, pov);
  const people = Object.keys(ctx.state.entities)
    .filter((id) => id !== pov && !isGone(ctx.state, id) && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person") && seesEntity(id))
    .map((id) => ({ id, name: own(ctx.state.entities, id)?.name ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, PEOPLE_CAP);
  const homeOrg = (own(ctx.state.entities, pov)?.relations ?? []).find((r) => r.type === "member_of" && orgTypeOf(ctx, r.to) === "household" && !isGone(ctx.state, r.to))?.to;
  return {
    level,
    vehicles,
    places: knownPlaceRefs(ctx.world, seesPlace),
    ...(here && seesPlace(here) ? { here } : {}),
    people,
    household: homeOrg ? { id: homeOrg, name: own(ctx.state.entities, homeOrg)?.name ?? homeOrg } : null,
    loans: loanChoices(ctx),
    classes: vehicleClassChoices(ctx.tables.get("vehicles.classes"), { year: dateAt(cal, ctx.state.clock).year, air: worldHasAir(ctx.world) }),
  };
}
