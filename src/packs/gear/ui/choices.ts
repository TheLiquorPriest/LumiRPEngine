// Where the player may put their things, from the Gear view and the HUD (Belongings' Move to…, Put
// in…, Empty into… and Add's Where): the holders they carry or wear, the ones here they own or may
// use, and the ones at home, each nested in what holds it with how full it is; the places the place
// ✎ offers; the player character and the people here (`frontend/things/play-where.ts` builds the
// choices). Pure.

import type { EntityId, PlaceId } from "../../../shared/ids";
import type { StateView } from "../../../shared/state-view";
import type { WhereChoice } from "../../../shared/thing-view";
import type { MoveAt } from "../../../frontend/things/move-sheet";
import { fullWhy, playWhere, type PlayHolder } from "../../../frontend/things/play-where";
import type { GearItem, GearView } from "../core/view";

/** Belongings' choices of where: the choices, where the player character is and lives, and the holders by id (for how full each is). */
export interface PlayChoices {
  choices: WhereChoice[];
  at: MoveAt;
  holders: ReadonlyMap<string, PlayHolder>;
  /** Why a holder can't take more (it is full), or null. */
  blocked(choice: WhereChoice): string | null;
}

/** The player character, as the place ✎ names them; null when the HUD has no place ✎ (nowhere, or Space off). */
export function povOf(state: StateView): EntityId | null {
  return state.hud?.fixes.place?.entity ?? null;
}

/** The holders among some things and in them, `top` holding the first level: those of the player's own that take things, each once. */
function holdersIn(items: readonly GearItem[], top: { in: EntityId | null; place: PlaceId | null }, keep: (item: GearItem) => boolean, out: Map<string, PlayHolder>): void {
  for (const item of items) {
    if (item.holds !== undefined && keep(item) && !out.has(item.id)) out.set(item.id, { id: item.id, name: item.name, holds: item.holds, ...(item.load ? { load: { used: item.load.used, capacity: item.load.capacity } } : {}), in: top.in, place: top.place });
    holdersIn(item.children ?? [], { in: item.id, place: null }, keep, out);
  }
}

/**
 * The holders the player may put things in: what they wear or carry that holds things (in them,
 * nested), the ones here of theirs or that they may use (lying where they stand), and the ones at
 * home, under the holder that keeps them, at the home place (or the room of it the Gear view names).
 */
export function gearHolders(view: GearView, state: StateView): PlayHolder[] {
  const pov = povOf(state);
  const here = state.hud?.place?.id ?? null;
  const places = state.hud?.fixes.place?.places ?? [];
  const out = new Map<string, PlayHolder>();
  const mine = (item: GearItem): boolean => item.mine === true;
  holdersIn(view.outfit, { in: pov, place: null }, mine, out);
  holdersIn(view.carried, { in: pov, place: null }, mine, out);
  if (view.here) {
    const usable = new Set(view.here.inside.map((h) => h.holder.id));
    holdersIn([...view.here.room, ...view.here.lying], { in: null, place: here }, (item) => item.mine === true || usable.has(item.id), out);
  }
  const home = view.home?.id ?? null;
  for (const store of view.stored) {
    // The room of the home the store names, else the home itself.
    const room = places.find((p) => p.name === store.where && (p.id === home || p.path.includes(view.home?.name ?? "")))?.id ?? home;
    if (store.holder && !out.has(store.holder.id)) out.set(store.holder.id, { id: store.holder.id, name: store.holder.name, holds: null, in: null, place: room });
    holdersIn(store.items, store.holder ? { in: store.holder.id, place: null } : { in: null, place: room }, mine, out);
  }
  return [...out.values()];
}

/** Belongings' choices of where, from the Gear view and the HUD. */
export function playChoices(view: GearView, state: StateView): PlayChoices {
  const pov = povOf(state);
  const holders = gearHolders(view, state);
  const byId = new Map(holders.map((h) => [h.id, h]));
  const here = state.hud?.place?.id ?? null;
  const choices = playWhere({ pov: pov !== null ? { id: pov, name: "You" } : null, ceiling: view.ceiling, places: state.hud?.fixes.place?.places ?? [], here, holders, people: view.people });
  return { choices, at: { pov, here, home: view.home?.id ?? null }, holders: byId, blocked: (choice) => (choice.is === "thing" ? fullWhy(byId.get(choice.id)) : null) };
}
