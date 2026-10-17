// Preview fixture (`?scenario=sheet`): Play → You with the Modern profile's sheet, built by the
// real engine from the preview world with the profile applied (every conflict taken) and a few
// numbers of the player's own: a mechanic part-way to level 3, a little hurt, an Action Point spent.

import type { JsonValue } from "../../src/shared/json";
import { hashJson } from "../../src/shared/hash";
import { applyProfile, planProfile, PROFILES, type ProfileChoice } from "../../src/shared/profiles/index";
import { createRegistry } from "../../src/engine/registry-impl";
import { initialState } from "../../src/engine/world-state";
import { ALL_PACKS } from "../../src/packs/index";
import { buildSheetView } from "../../src/packs/sheets/core/index";
import { worldFixture } from "./fixtures";

export function modernSheetFixture(): JsonValue {
  const reg = createRegistry(ALL_PACKS);
  const packKinds = Object.fromEntries(reg.kinds);
  const base = worldFixture();
  const take: Record<string, ProfileChoice> = {};
  for (const item of planProfile(base, PROFILES.modern, packKinds).items) if (item.status === "conflict") take[item.path] = "profile";
  const world = applyProfile(base, PROFILES.modern, packKinds, take);
  const pov = world.entities[world.pov];
  if (pov) Object.assign(pov.fields, { str: 12, dex: 15, con: 13, int: 14, wis: 10, cha: 11, xp: 2400, level: 2, hp: 11, action_points: 4, repair: 5, drive: 4, computers: 2, notice: 3, investigate: 2, reputation: 1 });
  // The sheet view is plain JSON; the cast only restates it as JSON.
  return buildSheetView(reg.context(world, initialState(world, hashJson(world), reg))) as unknown as JsonValue;
}
