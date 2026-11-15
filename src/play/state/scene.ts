// The scene the player reads: who is present, the type in force, how long the last turn took. Its
// builders are pure, over a world, its state and the registry; the HUD takes the scene types the POV
// may know of from here too.

import { canSeeEntity, canSeePlace, povPlace } from "../../engine/visibility";
import { povLife } from "../../engine/life";
import type { Registry } from "../../engine/registry-impl";
import { isGone, kindIs, placeOfEntity } from "../../engine/scope";
import type { WorldState } from "../../engine/state";
import { DEFAULT_SCENE_TYPE, ENGINE_SCENE_TYPES, sceneType } from "../../engine/time";
import type { SceneView } from "../../shared/state-view";
import type { WorldDoc } from "../../shared/world";

/**
 * The scene types the POV may know of (DESIGN §7): the engine's own and those of the places the POV
 * can see. A world's tick says nothing of who may know a type, so one only a hidden place has, or
 * only an action sets, is never named, whatever tick the world gives it.
 */
export function knownSceneTypes(registry: Registry, world: WorldDoc, state: Readonly<WorldState>): Set<string> {
  return new Set([...ENGINE_SCENE_TYPES, ...Object.values(world.places).flatMap((p) => (p.sceneType && canSeePlace(registry, world, state, world.pov, p.id) ? [p.sceneType] : []))]);
}

export function scene(world: WorldDoc, state: WorldState, headElapsed: number, registry: Registry): SceneView {
  const placeId = placeOfEntity(state, world.pov);
  const present: SceneView["present"] = [];
  for (const [id, e] of Object.entries(state.entities)) {
    if (id === world.pov || placeOfEntity(state, id) !== placeId || placeId === null || isGone(state, id)) continue;
    // Authored kinds extend `person` (the starters' `character`). Someone the POV can't see (secret,
    // or `known_by` and not known) isn't listed, even standing right there. A body stays listed where
    // it lies, with its life state as the POV knows it.
    if (!kindIs(registry, world, e.kind, "person") || !canSeeEntity(registry, world, state, world.pov, id)) continue;
    const life = povLife(world, state, id);
    present.push({ id, name: e.name, label: world.kinds[e.kind]?.label ?? e.kind, ...(life ? { life: life.label } : {}) });
  }
  // The scene in force as the player reads it: a type the POV may not know of (one only a hidden
  // place has or only an action sets, whether the POV stands in that place or is pinned to it)
  // reads as the engine's default scene. Display only: the clock still paces by the type in force.
  const type = sceneType(world, state);
  return { placeId: povPlace(registry, world, state)?.id ?? null, sceneType: knownSceneTypes(registry, world, state).has(type) ? type : DEFAULT_SCENE_TYPE, present, elapsed: headElapsed };
}
