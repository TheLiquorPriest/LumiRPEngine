// The door to Lumiverse's registration with the application (plan §4.1, §4.2): its area, whose lanes
// are filled by the areas that know the answers. The turn lane fills the tagged reply it plays, the
// changes it hears, the history window, the stretches a chat names, the messages Lumiverse's memory
// stands in for, and the model layer's pass; the lore fills the secrecy of its entries. A lane no area
// fills is what the door answers by itself, below, so the door mounts whatever areas are composed.
//
// The door's reads of Lumiverse are taken by the areas that need them (the turn lane's), from the
// handle this returns.

import type { DoorFills } from "../../app/hooks";
import type { SecrecyRules } from "./answer";
import { type AdapterDeps, type AdapterLanes, type LumiverseDoor, lumiverseDoor } from "./mount";
import { LUMIVERSE_SETTINGS } from "./settings";

// An area adds a lane by naming it here: the app's hooks carry no type of the door's.
declare module "../../app/hooks" {
  interface DoorFills extends Partial<AdapterLanes> {}
}

/** What the door answers for the secrecy of lore while no area fills the lane: it says so, and the extension's own fail-closed verdict keeps every marked secret out. */
export const UNFILLED_SECRECY: SecrecyRules = async () => {
  throw new Error("RPE works out no secrecy of its lore, so the extension keeps every marked secret out.");
};

const none = (lane: string): Error => new Error(`RPE has no area that fills the door's ${lane} lane.`);

/**
 * What the door answers while no area fills a lane: a reply to play and a pass to make are refused in words, and each of the
 * others reads as nothing there (no change heard, no cut, no hidden message read, no stretch named, no message summarised,
 * the default connection).
 */
const UNFILLED: AdapterLanes = {
  turns: {
    play: async () => {
      throw none("turns");
    },
  },
  changes: { changed: () => undefined, reopened: () => undefined },
  window: async () => null,
  // No state to answer from: the question's cut is not known, and RPE makes it on receipt.
  start: async () => {
    throw none("start");
  },
  secrecy: UNFILLED_SECRECY,
  hiddenReadable: async () => false,
  ranges: async () => ({}),
  summarized: async () => new Set(),
  models: {
    pass: async () => {
      throw none("models");
    },
  },
  passConnection: () => null,
  passWords: async (key) => key,
};

/** The door, its lanes read from the app's hooks each time one is used. Mounting it reads what the areas filled. */
export function doorArea(deps: AdapterDeps): LumiverseDoor {
  let filled: Readonly<DoorFills> = {};
  /** The lane as the areas filled it, or the door's own answer. */
  const lane = <K extends keyof AdapterLanes>(name: K): AdapterLanes[K] => (filled[name] as AdapterLanes[K] | undefined) ?? UNFILLED[name];
  const lanes: AdapterLanes = {
    turns: { play: (turn, out, signal) => lane("turns").play(turn, out, signal) },
    changes: { changed: (change) => lane("changes").changed(change), reopened: () => lane("changes").reopened() },
    window: (ask, signal) => lane("window")(ask, signal),
    start: (ask, signal) => lane("start")(ask, signal),
    secrecy: (ask, signal) => lane("secrecy")(ask, signal),
    hiddenReadable: (chat) => lane("hiddenReadable")(chat),
    ranges: (chat) => lane("ranges")(chat),
    summarized: (chat) => lane("summarized")(chat),
    models: { pass: (request, sink, signal) => lane("models").pass(request, sink, signal) },
    passConnection: () => lane("passConnection")(),
    passWords: (key, fields) => lane("passWords")(key, fields),
  };
  const door = lumiverseDoor(lanes, deps);
  return {
    ...door,
    area: {
      ...door.area,
      settings: LUMIVERSE_SETTINGS,
      mount: async (at) => {
        filled = at.hooks.door;
        await door.area.mount?.(at);
      },
    },
  };
}
