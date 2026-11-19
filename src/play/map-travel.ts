// The ways to go somewhere, as the map panel shows them when it is asked (DESIGN §12): read when the page opens its list of places (the
// quickest way's minutes to each place there is a way to) and when it opens a place's sheet (every way to that place: the walk and each
// vehicle's trip, with how its minutes break down, its fare, the action that takes it, and why it is greyed). They are no part of the
// chat's state view: with every vehicle's trip to every place the player knows, they were most of what a long-played chat's view weighed,
// and worked out on every ask.

import { route, shape } from "../app";
import { readPass } from "../engine/read-pass";
import { travelWays } from "../packs/space/core/view";
import type { QuickestWay } from "../shared/travel";
import type { Store } from "../store";
import { chatContext } from "./things";

const T = shape.text();

const travelPart = shape.object({ kind: shape.oneOf("fetch", "start", "drive", "park", "walk"), minutes: shape.number(), words: T });
const travelWay = shape.named(
  "TravelWay",
  "One way to a place: what it is called, how it goes (walk, road, offroad, water, air), its minutes and how a vehicle trip's minutes break down, its fare, the vehicle, the action and values that take it, and why it is greyed where it is.",
  shape.object({
    to: T,
    label: T,
    mode: shape.oneOf("walk", "road", "offroad", "water", "air"),
    minutes: shape.number(),
    parts: shape.optional(shape.list(travelPart), "How a vehicle trip's minutes break down, each part in words; left out for a walk."),
    cents: shape.optional(shape.number(), "Its fare, where it has one."),
    vehicle: shape.optional(T, "The vehicle, by name, for a trip in one."),
    action: T,
    params: shape.record(shape.json()),
    disabled: shape.optional(T, "Why it cannot be taken now; left out where it can."),
  }),
);

export function mapTravelRoutes(store: Store) {
  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/travel",
      access: "page",
      group: "state",
      does: "The quickest way's minutes to each place the player's character knows and can go to from where it is now, for the map's list of places.",
      reply: shape.object({ ways: shape.list(shape.object({ to: T, minutes: shape.number() })) }),
      handle: ({ user, params }) =>
        readPass(() => {
          const quickest = new Map<string, number>();
          for (const way of travelWays(chatContext(store, user, params.chat), null)) {
            if (way.disabled !== undefined) continue;
            quickest.set(way.to, Math.min(way.minutes, quickest.get(way.to) ?? Number.POSITIVE_INFINITY));
          }
          return { ways: [...quickest].map(([to, minutes]): QuickestWay => ({ to, minutes })) };
        }),
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/travel/:place",
      access: "page",
      group: "state",
      does: "Every way the player's character could go from where it is now to one place, for that place's sheet: the walk and each vehicle's trip, worked out for that place alone.",
      reply: shape.object({ options: shape.list(travelWay) }),
      handle: ({ user, params }) => readPass(() => ({ options: travelWays(chatContext(store, user, params.chat), params.place) })),
    }),
  ];
}
