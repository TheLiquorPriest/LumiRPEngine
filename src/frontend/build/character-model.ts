// Build's Character page, as plain data (DESIGN §13 characters): who gets the page instead of the
// generic editor, the draft patch of what an edit changed, and how a character's relations group.

import { pointerOf } from "../../shared/json-patch";
import type { JsonObject, JsonValue } from "../../shared/json";
import { hasOwn, isRecord } from "../../shared/json";
import type { JsonPatchOp } from "../../shared/protocol";
import type { WorldDoc } from "../../shared/world";
import { kindIs } from "./selector-editor";

/** Whether an entity being edited is a character: its kind is a person (the world's kinds and the packs'). */
export function isCharacter(doc: WorldDoc, value: JsonValue | undefined): boolean {
  return isRecord(value) && typeof value.kind === "string" && kindIs(doc, value.kind, "person");
}

/** Whether Build opens an item on the Character page: a person in the draft's entities. A new one (`new:` id) is made in the generic editor first. */
export function opensCharacterPage(doc: WorldDoc, collection: string, id: string | null): boolean {
  if (collection !== "entities" || id === null || id.startsWith("new:")) return false;
  const e = hasOwn(doc.entities, id) ? doc.entities[id] : undefined;
  return e !== undefined && kindIs(doc, e.kind, "person");
}

/**
 * A draft patch (RFC 6902) of only what an edit changed on entity `id`: its top-level keys, and its
 * fields one by one, so a change made elsewhere to anything else stands. Nothing changed, none.
 */
export function entityPatch(id: string, before: JsonObject, after: JsonObject): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [];
  const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) && (a === undefined) === (b === undefined);
  const diff = (base: string[], was: JsonObject, now: JsonObject): void => {
    for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
      const a = was[key];
      const b = now[key];
      if (same(a, b)) continue;
      const path = pointerOf([...base, key]);
      if (b === undefined) ops.push({ op: "remove", path });
      else if (a === undefined) ops.push({ op: "add", path, value: b });
      else ops.push({ op: "replace", path, value: b });
    }
  };
  const { fields: wasFields, ...was } = before;
  const { fields: nowFields, ...now } = after;
  diff(["entities", id], was, now);
  // Fields field by field: the page edits a few of many.
  if (isRecord(wasFields) && isRecord(nowFields)) diff(["entities", id, "fields"], wasFields, nowFields);
  else if (!same(wasFields, nowFields)) ops.push(nowFields === undefined ? { op: "remove", path: pointerOf(["entities", id, "fields"]) } : { op: wasFields === undefined ? "add" : "replace", path: pointerOf(["entities", id, "fields"]), value: nowFields });
  return ops;
}

/** How the People section groups a character's relations; any type not listed is Other. */
export type RelationGroup = "family" | "feelings" | "groups" | "other";

export const RELATION_GROUP: Readonly<Record<string, RelationGroup>> = {
  parent_of: "family",
  child_of: "family",
  sibling_of: "family",
  spouse_of: "family",
  partner_of: "family",
  kin_of: "family",
  regard: "feelings",
  drawn_to: "feelings",
  knows: "feelings",
  hostile: "feelings",
  member_of: "groups",
};

export const GROUP_LABEL: Readonly<Record<RelationGroup, string>> = { family: "Family", feelings: "Feelings", groups: "Groups", other: "Other" };

/**
 * Relations the People section shows, by group, each with its index in the entity's own list (what
 * an edit changes): never `in` (Where the story starts them shows what holds them) or what the
 * gear pack writes for a thing (worn, equipped, lent).
 */
export function relationGroups(relations: readonly JsonValue[]): Record<RelationGroup, { index: number; type: string; to: string }[]> {
  const out: Record<RelationGroup, { index: number; type: string; to: string }[]> = { family: [], feelings: [], groups: [], other: [] };
  relations.forEach((r, index) => {
    if (!isRecord(r) || typeof r.type !== "string" || typeof r.to !== "string" || HIDDEN_RELATIONS[r.type] === true) return;
    out[RELATION_GROUP[r.type] ?? "other"].push({ index, type: r.type, to: r.to });
  });
  return out;
}

/** Relations shown elsewhere on the page, or that a person never holds by authoring. */
const HIDDEN_RELATIONS: Readonly<Record<string, true>> = { in: true, worn_by: true, equipped: true, uses: true };
