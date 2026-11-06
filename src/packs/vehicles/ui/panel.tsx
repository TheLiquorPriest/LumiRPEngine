// Play → Me → Garage (DESIGN §9.1 Vehicles): "runs fine" at level 1; fuel, location and owner from
// 2; odometer, use grants and home base from 3; maintenance and registration at 4. Each vehicle the
// player may drive is a card: whose it is and what their use rests on, its class, cargo, specs and
// grants, and its controls (Where is it?, Home base…, Owner & use…, Specs…, Drive…), each at once
// with Undo. Above the cards, with two or more, Sort (name, type, location) and filter chips by type
// (its class, else its domain) and by location. "+ Add a vehicle" follows the chat's claims policy.
// Overdue use grants and service are flagged.

import { useState } from "preact/hooks";
import { isRecord } from "../../../shared/json";
import type { PlaceRef } from "../../../shared/character";
import { GRANT_BASES } from "../../../shared/things";
import { shortClassName, specWords, VEHICLE_DOMAIN_LABEL, VEHICLE_DOMAINS, vehicleSpecsOf } from "../../../shared/vehicles";
import { Badge, Button, Empty, JsonView, List, ListRow, Meter, Seg, type SegOption } from "../../../frontend/components";
import { list, num, obj, oneOf, optNum, optStr, str, strings } from "../../../frontend/decode";
import { Icon } from "../../../frontend/icons";
import type { IconName } from "../../../frontend/icons";
import type { PanelProps } from "../../../frontend/registry";
import { AtOnceNotice, useAtOnce } from "../../../frontend/things/at-once";
import type { GarageVehicle, GarageView } from "../core/view";
import { addPolicyOf, GarageSheets, type GarageSheet } from "./manage";

/** Below this much fuel a vehicle is flagged low, here and on Now. */
export const LOW_FUEL_PCT = 15;

const OWNERS = ["self", "household", "nobody", "other"] as const;

function decodePlaceRef(p: Record<string, unknown>): PlaceRef | null {
  return typeof p.id === "string" ? { id: p.id, name: str(p.name, p.id), path: strings(p.path), parent: optStr(p.parent) ?? null, visibility: (typeof p.visibility === "string" ? p.visibility : "public") as PlaceRef["visibility"] } : null;
}

export function decodeGarageView(value: unknown): GarageView | null {
  if (!isRecord(value) || !Array.isArray(value.vehicles)) return null;
  const household = obj(value.household);
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
            placeId: optStr(v.placeId),
            fuelPct: optNum(v.fuelPct),
            rangeLabel: optStr(v.rangeLabel),
            odometerLabel: optStr(v.odometerLabel),
            condition: optNum(v.condition),
            home: optStr(v.home),
            homeId: optStr(v.homeId),
            assignedTo: assigned ? { name: str(assigned.name), until: optStr(assigned.until), overdue: assigned.overdue === true } : undefined,
            service: list(v.service, (s) => ({ label: str(s.label), due: str(s.due), overdue: s.overdue === true })),
            classId: optStr(v.classId),
            className: optStr(v.className),
            owner: oneOf(v.owner, OWNERS, "other"),
            ownerName: optStr(v.ownerName),
            access: optStr(v.access),
            grants: list(v.grants, (g) => (typeof g.who === "string" ? { who: g.who, name: str(g.name, g.who), basis: oneOf(g.basis, GRANT_BASES, "assign"), ...(typeof g.until === "string" ? { until: g.until } : {}), ...(g.overdue === true ? { overdue: true as const } : {}) } : null)),
            cargo: strings(v.cargo),
            mine: v.mine === true,
            canLend: v.canLend === true,
            specs: vehicleSpecsOf(v.specs) ?? [],
          }
        : null;
    }),
    places: list(value.places, decodePlaceRef),
    here: optStr(value.here),
    people: list(value.people, (p) => (typeof p.id === "string" ? { id: p.id, name: str(p.name, p.id) } : null)),
    household: household && typeof household.id === "string" ? { id: household.id, name: str(household.name, household.id) } : null,
    loans: list(value.loans, (l) => (typeof l.until === "number" ? { label: str(l.label), until: l.until } : null)),
    classes: list(value.classes, (c) => (typeof c.id === "string" ? { id: c.id, name: str(c.name, c.id), domain: oneOf(c.domain, VEHICLE_DOMAINS, "road"), make: optStr(c.make), model: optStr(c.model), year: optNum(c.year), priceCents: optNum(c.priceCents) } : null)),
  };
}

/** A vehicle by its domain: a boat on the water, a plane in the air; everything else draws as a car. */
export function vehicleIcon(v: GarageVehicle): IconName {
  return /air/i.test(v.kind) ? "plane" : /boat|water|sea|marine/i.test(v.kind) ? "boat" : "car";
}

export function VehicleCard(props: { vehicle: GarageVehicle; onSheet?(kind: "where" | "home" | "owner" | "specs" | "drive"): void }) {
  const v = props.vehicle;
  // "runs fine" or "ok" reads as fine; any other status needs attention.
  const status = v.status.toLowerCase();
  const fine = status.includes("fine") || status === "ok";
  const fuel = v.fuelPct === undefined ? null : Math.max(0, Math.min(100, Math.round(v.fuelPct)));
  const open = props.onSheet;
  return (
    <section class="lre-me-vehicle" aria-label={v.name} data-lre-vehicle={v.id}>
      <div class="lre-me-vehicle-head">
        <span class="lre-me-vehicle-icon">
          <Icon name={vehicleIcon(v)} />
        </span>
        <div class="lre-me-vehicle-titles">
          <h3 class="lre-me-vehicle-name">{v.name}</h3>
          {v.className ? <span class="lre-me-vehicle-kind">{v.className}</span> : v.kind ? <span class="lre-me-vehicle-kind">{v.kind}</span> : null}
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
        {v.access ? <ListRow icon="key" title="Whose" value={v.access} /> : null}
        {v.place ? <ListRow icon="pin" title="Location" subtitle={v.home && v.home !== v.place ? `home: ${v.home}` : undefined} value={v.place} /> : null}
        {v.odometerLabel ? <ListRow icon="route" title={v.odometerLabel.endsWith(" h") ? "Engine hours" : "Odometer"} value={v.odometerLabel} /> : null}
        {v.cargo && v.cargo.length > 0 ? <ListRow icon="box" title="Cargo" subtitle={v.cargo.join(", ")} /> : null}
        {v.specs && v.specs.length > 0 ? <ListRow icon="list" title="Specs" subtitle={v.specs.map(specWords).join(" · ")} /> : null}
        {v.assignedTo ? (
          <ListRow
            icon="key"
            title="Assigned to"
            subtitle={v.assignedTo.overdue ? `overdue since ${v.assignedTo.until ?? "—"}` : v.assignedTo.until ? `until ${v.assignedTo.until}` : undefined}
            value={v.assignedTo.name}
            badge={v.assignedTo.overdue ? <Badge tone="warn">Overdue</Badge> : undefined}
          />
        ) : null}
        {(v.grants ?? []).map((g) => (
          <ListRow key={g.who} icon="users" title={g.name} subtitle={g.until ? `until ${g.until}` : g.basis === "hold" ? "holding it for you" : "may use it"} badge={g.overdue ? <Badge tone="warn">Overdue</Badge> : undefined} />
        ))}
        {(v.service ?? []).map((s) => (
          <ListRow key={s.label} icon="wrench" title={s.label} value={s.due} valueTone={s.overdue ? "warn" : undefined} badge={s.overdue ? <Badge tone="warn">Overdue</Badge> : undefined} />
        ))}
      </List>
      {open ? (
        <div class="lre-row-actions" data-lre-vehicle-controls={v.id}>
          <Button size="sm" variant="secondary" icon="pin" onClick={() => open("where")}>
            Where is it?
          </Button>
          {v.mine || v.canLend ? (
            <Button size="sm" variant="secondary" icon="home" onClick={() => open("home")}>
              Home base…
            </Button>
          ) : null}
          {v.mine || v.canLend ? (
            <Button size="sm" variant="secondary" icon="users" onClick={() => open("owner")}>
              {(v.grants ?? []).length > 0 ? "Lend… / Stop" : "Owner & use…"}
            </Button>
          ) : null}
          {v.mine ? (
            <Button size="sm" variant="secondary" icon="edit" onClick={() => open("specs")}>
              Specs…
            </Button>
          ) : null}
          {status !== "broken" ? (
            <Button size="sm" variant="secondary" icon={vehicleIcon(v)} onClick={() => open("drive")}>
              Drive…
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** How the Garage orders its cards. */
export type GarageSort = "name" | "type" | "location";

const SORTS: readonly SegOption<GarageSort>[] = [
  { value: "name", label: "Name" },
  { value: "type", label: "Type" },
  { value: "location", label: "Location" },
];

/** A vehicle's type, as Sort and the type chips read it: its class's short name, else its domain. */
export function garageType(v: GarageVehicle): string {
  if (v.className) return shortClassName(v.className);
  const domain = VEHICLE_DOMAINS.find((d) => d === v.kind);
  return domain ? VEHICLE_DOMAIN_LABEL[domain] : v.kind || "Vehicle";
}

/** Where a vehicle is, as Sort and the location chips read it. */
export function garageLocation(v: GarageVehicle): string {
  return v.place ?? "Unknown";
}

/** The cards the Garage shows: of the picked type and location (null: any), in the picked order, then by name. */
export function garageShown(vehicles: readonly GarageVehicle[], pick: GaragePick): GarageVehicle[] {
  const key = (v: GarageVehicle): string => (pick.sort === "type" ? garageType(v) : pick.sort === "location" ? garageLocation(v) : "");
  return vehicles
    .filter((v) => (pick.type === null || garageType(v) === pick.type) && (pick.place === null || garageLocation(v) === pick.place))
    .sort((a, b) => key(a).localeCompare(key(b)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** What Sort and the chips have picked: an order, and a type and a location (null: any). */
export interface GaragePick {
  sort: GarageSort;
  type: string | null;
  place: string | null;
}

/** The types and locations the chips offer, and the pick as it holds: one no vehicle has any more (one moved, one sold) shows them all. */
export function garageFilters(vehicles: readonly GarageVehicle[], pick: GaragePick): { types: string[]; places: string[]; pick: GaragePick } {
  const types = [...new Set(vehicles.map(garageType))].sort((a, b) => a.localeCompare(b));
  const places = [...new Set(vehicles.map(garageLocation))].sort((a, b) => a.localeCompare(b));
  return { types, places, pick: { sort: pick.sort, type: pick.type !== null && types.includes(pick.type) ? pick.type : null, place: pick.place !== null && places.includes(pick.place) ? pick.place : null } };
}

/** One row of filter chips, "All" first; none when every vehicle shares one value. Hook-free. */
export function GarageChips(props: { filter: "type" | "place"; label: string; values: readonly string[]; value: string | null; onPick(value: string | null): void }) {
  if (props.values.length < 2) return null;
  return (
    <div class="lre-bel-chips" role="group" aria-label={props.label} data-lre-garage-filter={props.filter}>
      {[null, ...props.values].map((value) => (
        <button key={value ?? ""} type="button" class="lre-bel-chip" aria-pressed={props.value === value} data-lre-garage-chip={value ?? ""} onClick={() => props.onPick(value)}>
          {value ?? "All"}
        </button>
      ))}
    </div>
  );
}

/** Sort and the filter chips, over two or more vehicles. Hook-free. */
export function GarageControls(props: { vehicles: readonly GarageVehicle[]; pick: GaragePick; onPick(next: GaragePick): void }) {
  if (props.vehicles.length < 2) return null;
  const { types, places, pick } = garageFilters(props.vehicles, props.pick);
  return (
    <div class="lre-stack" data-lre-garage-controls="">
      <Seg<GarageSort> label="Sort by" value={pick.sort} options={SORTS} onChange={(sort) => props.onPick({ ...pick, sort })} />
      <GarageChips filter="type" label="Type" values={types} value={pick.type} onPick={(type) => props.onPick({ ...pick, type })} />
      <GarageChips filter="place" label="Location" values={places} value={pick.place} onPick={(place) => props.onPick({ ...pick, place })} />
    </div>
  );
}

export function GaragePanel(props: PanelProps) {
  const view = decodeGarageView(props.view);
  const atOnce = useAtOnce(props.chatId);
  const [sheet, setSheet] = useState<GarageSheet | null>(null);
  const [pick, setPick] = useState<GaragePick>({ sort: "name", type: null, place: null });
  if (props.view === null || props.view === undefined) return <Empty icon="car">No vehicles.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  const claims = props.state.controls?.realism.claims ?? null;
  const canAdd = addPolicyOf(claims) !== "hidden" && (view.classes ?? []).length > 0;
  const shown = garageShown(view.vehicles, garageFilters(view.vehicles, pick).pick);
  return (
    <div class="lre-stack lre-me" data-lre-panel="vehicles.garage">
      <AtOnceNotice done={atOnce.done} busy={atOnce.busy} onUndo={atOnce.undo} onDismiss={atOnce.dismiss} />
      {view.vehicles.length === 0 ? <Empty icon="car">No vehicles yet.</Empty> : null}
      <GarageControls vehicles={view.vehicles} pick={pick} onPick={setPick} />
      {shown.map((v) => (
        <VehicleCard key={v.id} vehicle={v} onSheet={(kind) => setSheet({ kind, vehicle: v.id })} />
      ))}
      {canAdd ? (
        <Button variant="secondary" icon="plus" block onClick={() => setSheet({ kind: "add" })}>
          Add a vehicle
        </Button>
      ) : null}
      <GarageSheets chatId={props.chatId} view={view} sheet={sheet} claims={claims} atOnce={atOnce} onClose={() => setSheet(null)} />
    </div>
  );
}
