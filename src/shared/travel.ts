// Travel plans and vehicle trips (DESIGN §9.1, §12) as the Space pack's queries answer them: shared,
// since the Vehicles pack reads them through `space.route` and `space.vehicle_trips` and a pack's
// core never imports another's.

import type { PlaceId, TravelMode } from "./ids";
import type { JsonObject } from "./json";

export interface TravelLeg {
  from: PlaceId;
  to: PlaceId;
  minutes: number;
  distanceKm: number;
  terrain: string | null;
}

export interface TravelPlan {
  mode: TravelMode;
  legs: TravelLeg[];
  minutes: number;
  distanceKm: number;
}

/**
 * A vehicle trip: the walk to where the vehicle is parked, getting it going, the drive, parking it,
 * and the walk from where it's left. Each part is whole minutes, and `minutes` is their sum.
 */
export interface VehicleTrip {
  /** The walk from the driver to the vehicle; none when it's where they are. */
  fetch: TravelPlan | null;
  startMinutes: number;
  /** Over every mode the vehicle goes by; `mode` is the one most of its minutes take. */
  drive: TravelPlan;
  /** Where the vehicle is left: the destination, else the place the walk from it is shortest. */
  park: PlaceId;
  parkMinutes: number;
  /** The walk from where it's left; none when that's the destination. */
  walk: TravelPlan | null;
  minutes: number;
}

/** What a vehicle trip is planned from. */
export interface VehicleTripAsk {
  /** Where the driver is. */
  from: PlaceId;
  /** Where the vehicle is. */
  at: PlaceId;
  modes: readonly TravelMode[];
  /** km/h for this vehicle's class, when the world sets one; else each mode's own. */
  speed?: number;
  /** Where it may be left short of the destination: the driver must know the place. */
  canPark(place: PlaceId): boolean;
}

/** One part of a vehicle trip's time, as its Getting there row tells it: its minutes, then its words ("to reach it at home", "driving", "on foot from Harbor Street"). */
export interface TravelPart {
  kind: "fetch" | "start" | "drive" | "park" | "walk";
  minutes: number;
  words: string;
}

/**
 * A way to a place as the map's place sheet lists it (DESIGN §12): the walk, or a vehicle's trip with how its minutes break down
 * (`parts`, none for a walk) and its fare; the action and values that take it; and why it is greyed, where it is.
 */
export interface TravelWay {
  to: PlaceId;
  label: string;
  mode: TravelMode;
  minutes: number;
  parts?: TravelPart[];
  cents?: number;
  vehicle?: string;
  action: string;
  params: JsonObject;
  disabled?: string;
}

/** The quickest way to a place there is one to, as the map's list of places shows it: its minutes. */
export interface QuickestWay {
  to: PlaceId;
  minutes: number;
}
