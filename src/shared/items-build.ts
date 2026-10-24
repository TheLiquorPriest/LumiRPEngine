// Build's helpers for authoring things (DESIGN §13): what lies in a container, on someone or at a
// place; the "Reveal this item" scaffold that hides a thing until it is searched for (§7
// discoverable things); and the item checks a quest's objectives test (`carries`, `has_item`, `at`).

import type { JsonObject, JsonValue } from "./json";
import { hasOwn, isRecord } from "./json";
import type { KindDef, WorldDoc } from "./world";

/** One thing in a container, on someone or lying at a place, as Build's Contents lists it. */
export interface ContentsRow {
  id: string;
  name: string;
  /** `discoverable`: hidden until the player character searches where it lies or opens what holds it. */
  hidden: boolean;
}

/** Whether `kind` is a thing (an item, or a kind that extends one), by the world's kinds and the packs'. */
export function isItemKind(kinds: Readonly<Record<string, KindDef>>, kind: string): boolean {
  let cur: string | undefined = kind;
  for (let guard = 0; cur && guard < 32; guard++) {
    if (cur === "item") return true;
    cur = hasOwn(kinds, cur) ? kinds[cur]?.extends : undefined;
  }
  return false;
}

/**
 * What the world document puts in `id` (an entity's `in` relations to it), or, for a place, what
 * lies loose there (its `place` with no holder), by name. Only the document's own: what play adds
 * (bought, found, sampled stock) isn't the author's.
 */
export function authoredContents(world: Pick<WorldDoc, "entities">, id: string, of: "entities" | "places"): ContentsRow[] {
  return Object.values(world.entities)
    .filter((e) => (of === "entities" ? e.relations.some((r) => r.type === "in" && r.to === id) : e.fields.place === id && !e.relations.some((r) => r.type === "in")))
    .map((e) => ({ id: e.id, name: e.name, hidden: e.visibility === "discoverable" }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * "Reveal this item": the thing, made `discoverable`, so it stays hidden until the player character
 * searches where it lies, or opens the container it is in, with the built-in Search. It must lie
 * somewhere first (a place, or in a container or on someone): a thing nowhere can never be found.
 * Its Known by stays, granting it as for a `known_by` thing. A secret thing is made discoverable too:
 * that is what the author asked for.
 */
export function revealScaffold(entity: JsonObject): { entity: JsonObject } | { problem: string } {
  const fields = isRecord(entity.fields) ? entity.fields : {};
  const placed = typeof fields.place === "string" && fields.place !== "";
  const held = Array.isArray(entity.relations) && entity.relations.some((r: JsonValue) => isRecord(r) && r.type === "in" && typeof r.to === "string" && r.to !== "");
  if (!placed && !held) return { problem: "Put it somewhere first: a place, or in a container or on someone." };
  return { entity: { ...entity, visibility: "discoverable" } };
}

/** The item checks an objective can make: the player character has it with them, has one like it, or it lies at a place. */
export type ItemCheck = "carries" | "has_item" | "at";

/** A thing or place an item check names: its id for the condition, its name for the label. */
export interface Named {
  id: string;
  name: string;
}

/**
 * An objective testing a thing (DESIGN §10): a label the player reads in their quests, `label` or a
 * plain one from the check ("Have the spare relay with you"), and its condition, `carries(pov, 'id')`,
 * `has_item(pov, 'id')` or `at('id', 'place')`. Ids go in as quoted literals, which the quest-id lint checks.
 */
export function itemObjective(check: ItemCheck, item: Named, place: Named | null = null, label = ""): { label: string; when: string } {
  // World ids are plain keys (no quotes or backslashes), so a literal holds them as they are.
  const quote = (s: string): string => `'${s}'`;
  const when = check === "at" ? `at(${quote(item.id)}, ${quote(place?.id ?? "")})` : `${check}(pov, ${quote(item.id)})`;
  return { label: label.trim() !== "" ? label.trim() : itemObjectiveLabel(check, item, place), when };
}

/** The plain label an item check reads as when the author gives none. */
export function itemObjectiveLabel(check: ItemCheck, item: Named, place: Named | null = null): string {
  // "Spare relay" reads as "the spare relay"; a name that starts with a proper noun ("Rosie's keys") keeps its capital.
  const thing = /^[A-Z][a-z]/.test(item.name) && !/^[A-Z][a-z]*'/.test(item.name) ? item.name.charAt(0).toLowerCase() + item.name.slice(1) : item.name;
  if (check === "carries") return `Have the ${thing} with you`;
  if (check === "has_item") return `Have a ${thing}`;
  return `Get the ${thing} to ${place?.name ?? "the place"}`;
}
