// A small player for the starter worlds' walkthroughs: act, teleport, let time pass, read the story.

import { evalExpr, scopeEnv } from "../../../src/engine/scope";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { ALL_NOTE } from "../../../src/engine/simulate";
import { runTimelapse } from "../../../src/engine/time";
import { answerPuzzle, stepTracks } from "../../../src/engine/tracks";
import { Working } from "../../../src/engine/working";
import type { JsonObject } from "../../../src/shared/json";
import type { WorldDoc } from "../../../src/shared/world";
import { ALL_PACKS } from "../../../src/packs/index";
import { STARTER_WORLDS } from "../../../src/packs/starters/index";
import { startState } from "../support";

export const registry = createRegistry(ALL_PACKS);

export class Play {
  readonly w: Working;

  constructor(readonly starter: string, readonly world: WorldDoc = STARTER_WORLDS[starter]?.("w", starter) as WorldDoc) {
    this.w = new Working(registry, world, startState(world));
    materializeAll(registry, this.w, world.pov, "walk");
  }

  get state() {
    return this.w.state;
  }

  /** Moves an entity (the player, or a character who should be on the scene). */
  at(entity: string, place: string): void {
    const rejection = this.w.apply({ type: "set", entity, field: "place", value: place });
    if (rejection) throw new Error(`cannot move ${entity} to ${place}: ${rejection.reason}`);
  }

  set(entity: string, field: string, value: string | number | boolean): void {
    const rejection = this.w.apply({ type: "set", entity, field, value });
    if (rejection) throw new Error(`cannot set ${entity}.${field}: ${rejection.reason}`);
  }

  /** Runs an action as the player and lets the tracks react. */
  act(action: string, params: JsonObject = {}): Resolution {
    const resolution = resolveAction(registry, this.w, { action, params }, createRng(`walk:${action}`), { runSeed: "walk" });
    stepTracks(registry, this.w, "walk");
    return resolution;
  }

  answer(track: string, text: string) {
    return answerPuzzle(registry, this.w, track, text, "walk");
  }

  /** Lets the tracks react to a state change made outside an action (a teleport, a set). */
  settle(): void {
    stepTracks(registry, this.w, "walk");
  }

  /** Evaluates a formula against the live state. */
  eval(src: string): unknown {
    return evalExpr(src, scopeEnv({ reg: registry, ctx: this.w.ctx }));
  }

  /** Lets the clock run to an absolute minute (rules and schedules tick as they do in a timelapse). */
  lapseTo(clock: number): void {
    const out = runTimelapse(registry, this.w, { type: "duration", minutes: clock - this.w.state.clock }, { runSeed: "walk", overrides: ALL_NOTE });
    if ("code" in out) throw new Error(`timelapse refused: ${out.reason}`);
  }

  lapse(minutes: number): void {
    this.lapseTo(this.w.state.clock + minutes);
  }

  stage(track: string): string | undefined {
    return this.w.state.tracks[track]?.stage;
  }

  flag(name: string): unknown {
    return (this.w.state.packs.story as { flags?: Record<string, unknown> } | undefined)?.flags?.[name];
  }
}
