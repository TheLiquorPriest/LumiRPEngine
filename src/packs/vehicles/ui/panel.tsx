// Play → Me → Garage (DESIGN §9.1 Vehicles): "runs fine" at level 1; fuel, location and owner from
// 2; odometer, use grants and home base from 3; maintenance and registration at 4. Each vehicle the
// player may drive is a card: whose it is and what their use rests on, its class, cargo and grants,
// and its controls (Where is it?, Home base…, Owner & use…, Drive…), each at once with Undo. "+ Add a
// vehicle" follows the chat's claims policy. Overdue use grants and service are flagged.

import { useState } from "preact/hooks";
import { isRecord } from "../../../shared/json";
import type { PlaceRef } from "../../../shared/character";
import { GRANT_BASES } from "../../../shared/things";
import { VEHICLE_DOMAINS } from "../../../shared/vehicles";
import { Badge, Button, Empty, JsonView, List, ListRow, Meter } from "../../../frontend/components";
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

function VehicleCard(props: { vehicle: GarageVehicle; onSheet?(kind: "where" | "home" | "owner" | "drive"): void }) {
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

export function GaragePanel(props: PanelProps) {
  const view = decodeGarageView(props.view);
  const atOnce = useAtOnce(props.chatId);
  const [sheet, setSheet] = useState<GarageSheet | null>(null);
  if (props.view === null || props.view === undefined) return <Empty icon="car">No vehicles.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  const claims = props.state.controls?.realism.claims ?? null;
  const canAdd = addPolicyOf(claims) !== "hidden" && (view.classes ?? []).length > 0;
  return (
    <div class="lre-stack lre-me" data-lre-panel="vehicles.garage">
      <AtOnceNotice done={atOnce.done} busy={atOnce.busy} onUndo={atOnce.undo} onDismiss={atOnce.dismiss} />
      {view.vehicles.length === 0 ? <Empty icon="car">No vehicles yet.</Empty> : null}
      {view.vehicles.map((v) => (
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
