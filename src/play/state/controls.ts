// The controls the player sets: the chat's realism, adjudication, inferred checks, sections' feed,
// time, knowledge, things and cash. Pure, over a world and its state.

import { policyOf } from "../../engine/adjudication";
import { chatFeed, sourceOf, worldFeed } from "../../engine/feed";
import { inferredOf, worldSkills } from "../../engine/inferred";
import { claimsOf, presetOf } from "../../engine/realism";
import { levelFloors, type Registry } from "../../engine/registry-impl";
import type { WorldState } from "../../engine/state";
import { clockPaused } from "../../engine/time";
import { chatCashRule, toggles } from "../../packs/economy/core/pay";
import { FEATURE_DEFS } from "../../shared/finance";
import type { OffstageSettings } from "../../shared/offstage";
import { builtInSectionsOf } from "../../shared/sections";
import { type NarratorView, narratorViewOf } from "../../shared/settings";
import type { ControlsView } from "../../shared/state-view";
import { thingsConfigOf } from "../../shared/things";
import { bandTiers } from "../../shared/tiers";
import type { SectionTemplate, WorldDoc } from "../../shared/world";

/** The chat's own knowledge choices beside the user's: knowledge tracking and the narrator's knowledge (what `ControlsView.knowledge` and `.things` show). */
export interface ControlsKnowledge {
  chat: { knowledge?: boolean; narrator?: NarratorView; tidy?: boolean };
  tracking: boolean;
  narrator: NarratorView;
}

/** A world's sections in rank order: its own, then the built-in ones it has without listing them. The controls read a section's id, label and feed, never its wording. */
function sectionsOf(world: WorldDoc): SectionTemplate[] {
  return [...Object.values(world.sections), ...builtInSectionsOf(world)].sort((a, b) => a.rank - b.rank);
}

export function controls(world: WorldDoc, state: WorldState, sceneType: string, registry: Registry, knowledge: ControlsKnowledge, offstage: OffstageSettings): ControlsView {
  return {
    // The chat's own preset: a new chat may start from the user's settings, and This chat changes it.
    realism: { preset: presetOf(state.realism), levels: { ...state.realism.levels }, tierCaps: structuredClone(state.realism.tierCaps), bandTiers: bandTiers(world), floors: levelFloors(world), claims: claimsOf(world, state) },
    adjudication: policyOf(world, state),
    inferred: inferredOf(world, state),
    skills: worldSkills(registry, world, state),
    sections: sectionsOf(world).map((s) => ({ id: s.id, label: s.label, world: worldFeed(s), chat: chatFeed(state)[s.id] ?? null })),
    // One row per source, as `include` names them; a source with no words of its own reads as its name.
    sources: [...new Map(registry.renderers.map((r) => [sourceOf(r), { id: sourceOf(r), slot: r.slot, label: r.label ?? sourceOf(r).replace(/_/g, " ") }])).values()],
    time: {
      sceneType,
      sceneTicks: { ...state.time.sceneTicks },
      scale: state.time.scale,
      paused: clockPaused(world, state),
      interrupts: { ...state.time.interrupts },
      speedThrough: structuredClone(state.time.speedThrough),
      montage: state.time.montage,
      unitCap: { ...state.time.unitCap },
    },
    knowledge: {
      tracking: { chat: knowledge.chat.knowledge ?? null, user: knowledge.tracking },
      narrator: { chat: knowledge.chat.narrator ?? null, world: narratorViewOf(world.narrator), user: knowledge.narrator },
    },
    things: { tidy: { chat: knowledge.chat.tidy ?? null, world: thingsConfigOf(world).tidy.auto } },
    cash: cashControls(registry, world, state),
    offstage,
  };
}

/** Where cash needs a machine (GM → This chat → Money): the chat's own rule beside the world's switch, at the player character's Money level; null where money is off. */
function cashControls(registry: Registry, world: WorldDoc, state: WorldState): ControlsView["cash"] {
  const level = registry.context(world, state).levelOf(world.pov, "money");
  if (!(level > 0)) return null;
  const set = toggles(world).atm;
  return { chat: chatCashRule(state), world: typeof set === "boolean" ? set : null, level, usual: FEATURE_DEFS.atm.on };
}
