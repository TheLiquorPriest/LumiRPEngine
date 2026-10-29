// The narrator's built-in sections (DESIGN §4.2, §6): their defaults, which of them a world gets,
// and the world's own wording of them (`WorldDoc.sectionTemplates`). Shared, so Build shows each
// built-in section's text as the engine delivers it.

import type { SlotId } from "./ids";
import { hasOwn, isRecord } from "./json";
import { KNOWLEDGE_SLOT, MINDS_SLOT } from "./minds";
import type { SectionTemplate, WorldDoc } from "./world";

/** Where a section's lines go in its template. */
export const LINES_MARKER = "{{lines}}";

/**
 * Sections a world gets when it defines none (DESIGN §4.2 slot list); lower rank is kept first. Each
 * opens with what it holds and how the narrator uses it: the lines are the specific record to write
 * from, used as given, so the narrator neither infers what they mean nor summarizes them. None of
 * them outranks the player or the story: the narrator rules give the order of authority first
 * (`narratorRules`).
 */
export const DEFAULT_SECTIONS: Record<SlotId, SectionTemplate> = {
  outcome: { id: "outcome", label: "Outcome", rank: 0, template: "What the player character's actions did this turn, in the order they played, as the engine settled them: the authoritative record of this turn's results. Each line names the action, then in brackets what it was about, then its result and how long it took, then what it changed, in plain sentences (\"you\" is the player character). Narrate each as having happened this turn, with the exact results, rolls, amounts and changes its line gives; never soften, round or swap them for vaguer ones.\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 0, direction: "from_end" } },
  montage: { id: "montage", label: "Montage", rank: 1, template: "What happened while time passed, in order, as the engine played it out: the authoritative record of the interval. Narrate the interval as a summary of these lines, in their order, keeping the specific people, places, amounts and changes each one names. A line that gives the player's own words for this time comes first: narrate what they say happens, and fit the other lines around it.\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 0, direction: "from_end" } },
  scene: { id: "scene", label: "Scene", rank: 2, template: "Where the player character is now, when, and what they can perceive there: the authoritative facts of the scene. Describe it from these specifics as given (the place by its name, the time, the weather, what is in view), never generic stand-ins, and keep to them whenever the prose touches the setting.\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 1, direction: "from_end" } },
  people: { id: "people", label: "People", rank: 3, template: "The people with the player character, as the player character knows them, and what each is doing: the authoritative record of who is here. Call them by these names, and keep each one's activity, state, clothes and what they carry as their line gives it; never fold them into a crowd or swap in generic details. Bring a person's specifics in whenever the prose turns to them.\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 1, direction: "from_end" } },
  money: { id: "money", label: "Money", rank: 4, template: "The player character's money as it stands now: the authoritative figures. Use these exact amounts whenever money comes up; never round them, estimate them or give another balance.\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 2, direction: "from_end" } },
  gear: { id: "gear", label: "Gear", rank: 5, template: "What the player character carries, wears and has to hand, as it stands now: the authoritative list, one specific item a line. Name each item as given, with its details and condition, whenever the prose touches it; never replace it with a generic stand-in (\"a bag\", \"some tools\").\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 2, direction: "from_end" } },
  vehicles: { id: "vehicles", label: "Vehicles", rank: 6, template: "The vehicles the player character may use, and others nearby, as they know them: where each is, whose it is, its fuel and its state. These lines are the authoritative record: call each vehicle by the name and details its line gives, keep its place, fuel and condition as stated, and bring them in whenever a vehicle comes up, never a generic \"the car\" where a line names one.\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 2, direction: "from_end" } },
  quest: { id: "quest", label: "Quest", rank: 7, template: "The player character's quests and goals, as far as they know them: the authoritative record of where each stands. Let the reply follow from these, keeping each one's names, objectives and stage as given; never reveal a step they haven't reached.\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 3, direction: "from_end" } },
  outline: { id: "outline", label: "Outline", rank: 8, template: "The turn as the engine planned it, beat by beat. Write the reply from these beats, in this order, covering each one and keeping the specific people, things, places and amounts it names; what a beat leaves open is yours to fill in.\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 0, direction: "from_end" } },
  stance: { id: "stance", label: "Stance", rank: 9, template: "These lines are the authoritative record of how the people here behave and what each is about: show each person as their line says, in what they do and say; never state what a cue only hints at.\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 1, direction: "from_end" } },
  // Character minds (DESIGN §24.3): on their own token budget, apart from the section budget.
  [MINDS_SLOT]: { id: MINDS_SLOT, label: "Minds", rank: 10, template: "Each mind below is scoped to what that character knows and is blind to everyone else's. Let each shape that character's own choices, words and manner this turn, as specifically as it says. Show it through what they do and say; never state a thought, a reason or an intent outright, and never let one character act on another's private mind.\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 1, direction: "from_end" } },
  // Where the POV is and what it owns (DESIGN §6.11): ranked after the other facts, so the first left out on a small budget.
  place: { id: "place", label: "Place", rank: 11, template: "The place the player character is in: what it is like, what is here, where it leads, and the lore about it. These lines are the authoritative inventory of the place: name each thing, room, way out and detail as given whenever the prose touches it, and never reduce them to a summary or a generic stand-in (\"some furniture\", \"various goods\").\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 2, direction: "from_end" } },
  property: { id: "property", label: "Property", rank: 12, template: "Property the player character has a part in: where it is, who holds it and in what role. It is theirs only where a line says \"yours\"; otherwise they only use, keep or benefit from it. These lines are the authoritative record: use each property's name, place and details as given whenever it comes up.\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 3, direction: "from_end" } },
  // Who knows what (DESIGN §24.11): each person here's own knowledge, a fact at a time, as the narrator's knowledge lets it see them.
  [KNOWLEDGE_SLOT]: { id: KNOWLEDGE_SLOT, label: "Who knows what", rank: 13, template: "Who knows what among the people here, a fact at a time, the player character (\"You\") first among those who hold it: the authoritative record of what each person holds and how they came by it. Each person acts and speaks only from what their own lines give them: never let anyone use, hint at or guess a fact their lines don't give them, nor know what a line says they don't. \"Suspects\" is a guess they aren't sure of; \"keeps it from\" is something they won't reveal to those named.\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 1, direction: "from_end" } },
};

/** The built-in sections a world has without listing them: all of them when it lists none, else the Minds and Who knows what sections unless it lists its own. */
export function builtInSectionsOf(world: Pick<WorldDoc, "sections">): SectionTemplate[] {
  const own = Object.keys(world.sections);
  if (own.length === 0) return Object.values(DEFAULT_SECTIONS);
  return [MINDS_SLOT, KNOWLEDGE_SLOT].flatMap((slot) => {
    const section = DEFAULT_SECTIONS[slot];
    return section && !own.includes(slot) ? [section] : [];
  });
}

/** Why a section's template can't be used as written, or null: it must hold `{{lines}}`, where its lines go. */
export function sectionTemplateProblem(text: string): string | null {
  return text.includes(LINES_MARKER) ? null : `it must hold ${LINES_MARKER}, where the section's lines go`;
}

/** Why a world's `sectionTemplates` can't be stored, or null: an object of built-in section ids, each a text holding `{{lines}}`. */
export function sectionTemplatesProblem(value: unknown): string | null {
  if (!isRecord(value)) return "sectionTemplates must be an object of section ids";
  for (const [id, text] of Object.entries(value)) {
    if (!hasOwn(DEFAULT_SECTIONS, id)) return `sectionTemplates.${id}: there is no built-in section "${id}"`;
    if (typeof text !== "string") return `sectionTemplates.${id} must be text`;
    const problem = sectionTemplateProblem(text);
    if (problem !== null) return `sectionTemplates.${id}: ${problem}`;
  }
  return null;
}

/** A world's `sectionTemplates` with only what differs from the built-in text: what Build stores. */
export function storedSectionTemplates(value: Readonly<Record<string, string>>): Record<SlotId, string> {
  return Object.fromEntries(Object.entries(value).filter(([id, text]) => hasOwn(DEFAULT_SECTIONS, id) && text !== DEFAULT_SECTIONS[id]?.template));
}
