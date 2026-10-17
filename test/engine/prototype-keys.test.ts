// An id from an event, effect, proposal or param never resolves through
// `Object.prototype`. `__proto__`, `constructor` and `toString` name nothing in a world, so every
// lookup by such an id is a miss: effects, events, actions, params, proposals and pack validators
// reject it as unknown instead of reading a built-in.
import { describe, expect, test } from "bun:test";
import { applyEffects } from "../../src/engine/effects";
import { createRegistry } from "../../src/engine/registry-impl";
import { paramCandidates, resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { EffectSpec } from "../../src/shared/world";
import { ALL_PACKS } from "../../src/packs/index";
import { DEFAULT_DIFFICULTY, difficultyOf } from "../../src/packs/sheets/core/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const KEYS = ["__proto__", "constructor", "toString"] as const;

function setup(): Working {
  const world = modernUsWorld("proto", "Riverton");
  return new Working(reg, world, startState(world));
}

/** The first rejection code of an effect list, or "ok". */
function effectCode(w: Working, effect: EffectSpec): string {
  const out = applyEffects(reg, w, [effect], { bindings: { self: w.world.pov }, rng: createRng(JSON.stringify(effect)) });
  return out.rejected[0]?.rejection.code ?? "ok";
}

function eventCode(w: Working, event: LedgerEvent): string {
  return w.apply(event)?.code ?? "ok";
}

describe("prototype keys name nothing", () => {
  for (const key of KEYS) {
    test(`${key}: core effects reject it as an entity or a place`, () => {
      const w = setup();
      const before = JSON.stringify(w.state);
      expect(effectCode(w, { type: "set", args: { entity: key, field: "mood", value: "calm" } })).toBe("missing_entity");
      expect(effectCode(w, { type: "add", args: { entity: key, field: "cash", delta: 1 } })).toBe("missing_entity");
      expect(effectCode(w, { type: "move", args: { entity: key, to: Object.keys(w.world.places)[0] ?? "" } })).toBe("missing_entity");
      expect(effectCode(w, { type: "move", args: { entity: w.world.pov, to: key } })).toBe("missing_place");
      expect(JSON.stringify(w.state)).toBe(before);
    });

    test(`${key}: actions and params reject it`, () => {
      const w = setup();
      expect(resolveAction(reg, w, { action: key }, createRng("a")).failed?.code).toBe("unknown_action");
      expect(resolveAction(reg, w, { action: "go", params: { to: key } }, createRng("b")).failed?.code).toBe("bad_param");
      const go = reg.actions.get("go");
      expect(go).toBeDefined();
      if (go) expect(paramCandidates(reg, w.world, w.state, go, key)).toEqual([]);
    });

    test(`${key}: pack events and validators reject it`, () => {
      const w = setup();
      expect(eventCode(w, { type: "engine.attempt", data: { track: key } })).toBe("missing_track");
      expect(eventCode(w, { type: "space.route", data: { route: key, open: true } })).toBe("bad_route");
      expect(eventCode(w, { type: "castlife.need", data: { entity: w.world.pov, need: key, delta: 5 } })).toBe("bad_event");
      expect(eventCode(w, { type: "castlife.need", data: { entity: key, need: "hunger", delta: 5 } })).toBe("bad_event");
      expect(effectCode(w, { type: "story.answer", args: { track: key, answer: "anything" } })).toBe("not_a_puzzle");
      expect(difficultyOf(key)).toBe(DEFAULT_DIFFICULTY);
    });

    test(`${key}: the location proposal rejects it as a place or an entity`, () => {
      const w = setup();
      const location = reg.proposals.get("location");
      expect(location).toBeDefined();
      if (!location) return;
      expect(location.validate({ place: key }, w.ctx)?.code).toBe("missing_place");
      expect(location.validate({ entity: key, place: Object.keys(w.world.places)[0] ?? "" }, w.ctx)?.code).toBe("missing_entity");
    });
  }
});
