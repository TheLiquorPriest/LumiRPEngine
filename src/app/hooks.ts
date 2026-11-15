// What an area adds to the hooks of the others (STANDALONE-PLAN §4.1): a view an agent is given by
// name, which the turn lane's `views` hook takes from every area, and the lanes of the door to
// Lumiverse, each of which is filled by the area that knows the answer. An area names what it adds in
// its own file (`fills` of its `Area`), so the composition names each area once and no later package
// edits it. The app gathers every area's here when it opens, and the area that owns a hook reads it
// from the app when it is asked.

import type { AgentRef, Scope } from "rp-harness/contract";
import type { Setting } from "./setting-list";

/** A view an agent is given by name, beyond the turn's own: its text; null for a name that is none of the area's own. */
export type ViewHook = (scope: Scope, agent: AgentRef, ref: string) => Promise<string | null>;

/**
 * The lanes of the door to Lumiverse that an area fills. The door's own file names each lane, by adding
 * its entry here (`src/adapter/lumiverse/area.ts`), so this file names none of the door's types; a lane
 * no area fills is what the door answers by itself. Only one area fills a lane.
 */
// biome-ignore lint/suspicious/noEmptyInterface: each lane is added by the door's file, which owns its types
export interface DoorFills {}

/** What one area adds to the hooks of the others. */
export interface Fills {
  /** A view given to an agent by name, which the turn lane's `views` hook asks of every area in turn. */
  readonly views?: ViewHook;
  /** The door's lanes this area fills. */
  readonly door?: DoorFills;
}

/** The hooks as the app holds them, gathered from every area's `fills`. */
export interface Hooks {
  /** Asks each area's view in the order of the areas; the first text is the answer, null where none of them has the name. */
  readonly views: ViewHook;
  /** The door's lanes, each as the one area that fills it gave it; a lane no area fills is absent. */
  readonly door: Readonly<DoorFills>;
}

/** What gathering reads of an area. */
interface Giving {
  readonly name: string;
  readonly fills?: Fills;
  readonly settings?: readonly Setting[];
}

/** Every area's fills as one set of hooks; a lane of the door that two areas fill is an error that names both. */
export function gatherHooks(areas: readonly Giving[]): Hooks {
  const views: ViewHook[] = [];
  const door: Record<string, unknown> = {};
  const filledBy = new Map<string, string>();
  for (const area of areas) {
    if (area.fills?.views !== undefined) views.push(area.fills.views);
    for (const [lane, fill] of Object.entries(area.fills?.door ?? {})) {
      if (fill === undefined) continue;
      const first = filledBy.get(lane);
      if (first !== undefined) throw new Error(`The door's ${lane} lane is filled by two areas, ${first} and ${area.name}: one area fills a lane.`);
      filledBy.set(lane, area.name);
      door[lane] = fill;
    }
  }
  return {
    views: async (scope, agent, ref) => {
      for (const view of views) {
        const text = await view(scope, agent, ref);
        if (text !== null) return text;
      }
      return null;
    },
    door: door as DoorFills,
  };
}

/** The registry: every area's settings, in the order of the areas; a key two areas list (RPH's among them, which one area lists) is an error that names both. */
export function gatherSettings(areas: readonly Giving[]): Setting[] {
  const out: Setting[] = [];
  const listedBy = new Map<string, string>();
  for (const area of areas) {
    for (const def of area.settings ?? []) {
      const first = listedBy.get(def.key);
      if (first !== undefined) throw new Error(`The setting ${def.key} is listed by two areas, ${first} and ${area.name}: one area lists a setting.`);
      listedBy.set(def.key, area.name);
      out.push(def);
    }
  }
  return out;
}
