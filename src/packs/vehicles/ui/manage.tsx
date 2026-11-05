// The Garage's controls (DESIGN §9.3; item 6): each at once, off screen, as the player's ✎ fix with
// its Undo in the notice at the top. Where is it? parks it where the story left it; Home base… sets
// where it is kept; Owner & use… (the shared sheet) says whose it is, lends it and stops a grant;
// Drive… takes it somewhere, a story action. "+ Add a vehicle" makes one of a class where the player
// says, under the chat's claims policy: Make it real makes it at once, Ask first asks in the sheet,
// Hold me to the world offers no Add.

import type { ClaimsPolicy } from "../../../shared/claims";
import type { ChatId, EntityId, PlaceId } from "../../../shared/ids";
import type { ItemFix } from "../../../shared/things";
import { useApp } from "../../../frontend/app";
import { PlaceSheet } from "../../../frontend/character/place-picker";
import { travelRequest } from "../../../frontend/requests";
import { AddThingSheet, type AddDraft } from "../../../frontend/things/add-thing";
import { thingsFix, type AtOnce } from "../../../frontend/things/at-once";
import { OwnerUseSheet, type OwnerUseThing } from "../../../frontend/things/owner-sheet";
import { playWhere } from "../../../frontend/things/play-where";
import type { GarageVehicle, GarageView } from "../core/view";

/** Which of the Garage's sheets is open, and for which vehicle. */
export type GarageSheet = { kind: "where" | "home" | "owner" | "drive"; vehicle: EntityId } | { kind: "add" };

/** Parks a vehicle where the story left it. */
export function parkFix(vehicle: EntityId, place: PlaceId): ItemFix {
  return { do: "move", item: vehicle, to: { place } };
}

/** Sets where a vehicle is kept, or clears it. */
export function homeFix(vehicle: EntityId, place: PlaceId | null): ItemFix {
  return { do: "home", item: vehicle, home: place === null ? null : { place } };
}

/** A vehicle as the Owner & use sheet reads it. */
export function ownerThing(v: GarageVehicle): OwnerUseThing {
  return {
    id: v.id,
    name: v.name,
    owner: v.owner ?? "other",
    ...(v.ownerName !== undefined ? { ownerName: v.ownerName } : {}),
    use: v.access ? [{ label: v.access, who: ["You"] }] : [],
    grants: v.grants ?? [],
  };
}

/** What Add a vehicle is under the claims policy: made at once, asked about first, or not offered. */
export function addPolicyOf(claims: ClaimsPolicy | null): "real" | "ask" | "hidden" {
  return claims === null || claims.mode === "real" ? "real" : claims.mode === "ask" ? "ask" : "hidden";
}

/** The ✎ make a vehicle draft sends: its class with the make, model and year picked, where it stands. */
export function vehicleMake(draft: AddDraft): ItemFix | null {
  const pick = draft.what !== null && "vehicle" in draft.what ? draft.what.vehicle : null;
  if (!pick || draft.at.is !== "place") return null;
  return { do: "make", name: draft.name.trim(), class: pick.id, details: { make: pick.make, model: pick.model, year: pick.year }, at: { place: draft.at.id } };
}

/** The Garage's open sheet, if any; each sends through `atOnce` and closes. */
export function GarageSheets(props: { chatId: ChatId; view: GarageView; sheet: GarageSheet | null; claims: ClaimsPolicy | null; atOnce: AtOnce; onClose(): void }) {
  const app = useApp();
  const { view, sheet, atOnce } = props;
  const places = view.places ?? [];
  if (sheet === null) return null;
  if (sheet.kind === "add") {
    const policy = addPolicyOf(props.claims);
    const choices = playWhere({ pov: null, ceiling: null, places, here: view.here ?? null, holders: [], people: [] });
    const here = choices.find((c) => c.is === "place" && c.id === view.here) ?? null;
    return (
      <AddThingSheet
        title="Add a vehicle"
        subtitle="One you have: it is made at once, with Undo."
        types={null}
        classes={view.classes ?? []}
        choices={choices}
        start={{ kind: "vehicle", at: here }}
        kinds={["vehicle"]}
        busy={atOnce.busy}
        action="Add it"
        askFor={(draft) => (policy === "ask" ? `Add ${draft.name.trim()} to the world as yours?` : null)}
        onSubmit={(draft) => {
          const fix = vehicleMake(draft);
          if (fix) atOnce.send(thingsFix(props.chatId, [fix], `Added ${draft.name.trim()}`), `${draft.name.trim()} is yours, at ${draft.at.name}.`, props.onClose);
        }}
        onClose={props.onClose}
      />
    );
  }
  const v = view.vehicles.find((x) => x.id === sheet.vehicle);
  if (!v) return null;
  if (sheet.kind === "owner") return <OwnerUseSheet chatId={props.chatId} thing={ownerThing(v)} people={view.people ?? []} loans={view.loans ?? []} household={view.household ?? null} onClose={props.onClose} />;
  if (sheet.kind === "where") {
    return (
      <PlaceSheet
        places={places}
        value={v.placeId ?? null}
        title={`Where is ${v.name}?`}
        none="Where the story left it"
        onClose={props.onClose}
        onPick={(place) => {
          if (place) atOnce.send(thingsFix(props.chatId, [parkFix(v.id, place.id)], `Parked ${v.name}`), `${v.name} is at ${place.name}.`, props.onClose);
        }}
      />
    );
  }
  if (sheet.kind === "home") {
    return (
      <PlaceSheet
        places={places}
        value={v.homeId ?? null}
        title={`Where is ${v.name} kept?`}
        clearLabel="No home base"
        onClose={props.onClose}
        onPick={(place) => atOnce.send(thingsFix(props.chatId, [homeFix(v.id, place?.id ?? null)], `Home base of ${v.name}`), place ? `${v.name} is kept at ${place.name}.` : `${v.name} has no home base now.`, props.onClose)}
      />
    );
  }
  return (
    <PlaceSheet
      places={places.filter((p) => p.id !== v.placeId)}
      value={null}
      title={`Drive ${v.name} to…`}
      onClose={props.onClose}
      onPick={(place) => {
        if (!place) return;
        void app.request(travelRequest("drive", { vehicle: v.id, to: place.id }, props.chatId)).then(() => props.onClose());
      }}
    />
  );
}
