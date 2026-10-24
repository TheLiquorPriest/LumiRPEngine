// Bulk changes to a list's selection (DESIGN §7, §4.1): what a multi-select's bar applies to everyone
// picked. In GM mode a change is the existing GM edit ops, one per entity, sent in chunks of
// `EDIT_OPS_MAX`: each chunk is one `lre.edit`, all or none, with its own Undo. In Build it is a JSON
// Patch on the draft, worked out from the draft as it stands, so it writes only what changes. Each
// op goes through the same checks a single edit or write does.

import type { DomainId, EntityId, Level, PlaceId, TierId } from "../shared/ids";
import { pointerOf } from "../shared/json-patch";
import { lorePinKey, lorePinsJson, lorePinsOf } from "../shared/lore";
import type { Fidelity, MindApproach } from "../shared/minds";
import { FIDELITIES, MIND_TEXT_CAPS } from "../shared/minds";
import type { EditOp, JsonPatchOp } from "../shared/protocol";
import { EDIT_OPS_MAX } from "../shared/protocol";
import type { RoutineRole } from "../shared/routines";
import type { LorePin, WorldDoc } from "../shared/world";

/** A group a list selects at once ("by level"): exactly these rows. */
export interface SelectGroup {
  id: string;
  label: string;
  ids: readonly string[];
}

/** The characters by fidelity, Live first (GM → World and Minds): each level's group, the empty ones left out. */
export function fidelityGroups(characters: readonly { entity: EntityId; fidelity: { level: Fidelity } }[], label: Record<Fidelity, string>): SelectGroup[] {
  return FIDELITIES.map((level) => ({ id: level, label: label[level], ids: characters.filter((c) => c.fidelity.level === level).map((c) => c.entity) })).filter((g) => g.ids.length > 0);
}

/** The world's entities by tier, in the tiers' order (Build → Entities): each tier's group, the empty ones left out. */
export function tierGroups(doc: Pick<WorldDoc, "tiers" | "entities">): SelectGroup[] {
  return Object.entries(doc.tiers)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([id, tier]) => ({ id, label: tier.label, ids: Object.values(doc.entities).filter((e) => e.tier === id).map((e) => e.id) }))
    .filter((g) => g.ids.length > 0);
}

/** Splits a batch into chunks of at most `size`, in order. */
export function chunks<T>(items: readonly T[], size = EDIT_OPS_MAX): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Sends a batch in chunks, in order, each through `send` (one `lre.edit`, or one draft write); stops
 * at the first one refused, so what applied is the chunks before it. Resolves how many applied.
 */
export async function sendInChunks<T>(items: readonly T[], send: (chunk: T[]) => Promise<boolean>): Promise<{ applied: number; of: number }> {
  const all = chunks(items);
  let applied = 0;
  for (const chunk of all) {
    if (!(await send(chunk))) break;
    applied++;
  }
  return { applied, of: all.length };
}

// ---------------------------------------------------------------- GM mode

/** A change the GM view applies to everyone selected, as the GM edit op that makes it for one. */
export type BulkChange =
  | { kind: "tier"; tier: TierId }
  /** A domain's level for them, or null to hand it back to their tier. */
  | { kind: "level"; domain: DomainId; level: Level | null }
  /** Their routine's role in this chat (`routine_follow`), or null for the world's. */
  | { kind: "role"; role: RoutineRole | null }
  /** Their fidelity pinned in this chat (`mind_pin`), or null to go by score. */
  | { kind: "pin"; level: Fidelity | null }
  /** What they mean to do now and how (`mind_intent`); blank text and no approach clear it. */
  | { kind: "intent"; text: string; approach: MindApproach | null }
  | { kind: "move"; to: PlaceId };

/** Whether a change is a character's (their mind or routine): it applies only to the characters among those selected. */
export function forCharacters(change: BulkChange): boolean {
  return change.kind === "role" || change.kind === "pin" || change.kind === "intent";
}

/** The ops that make a change for each entity, in order; null when the change can't be made (an intent over its cap). */
export function bulkOps(ids: readonly EntityId[], change: BulkChange): EditOp[] | null {
  switch (change.kind) {
    case "tier":
      return ids.map((entity) => ({ op: "entity", entity, tier: change.tier }));
    case "level":
      return ids.map((entity) => ({ op: "entity", entity, levels: { [change.domain]: change.level } }));
    case "role":
      return ids.map((entity) => ({ op: "routine_follow", entity, role: change.role }));
    case "pin":
      return ids.map((entity) => ({ op: "mind_pin", entity, level: change.level }));
    case "intent": {
      const text = change.text.trim().replace(/\s+/g, " ");
      if (text.length > MIND_TEXT_CAPS.gmIntent) return null;
      return ids.map((entity) => ({ op: "mind_intent", entity, text, approach: change.approach }));
    }
    case "move":
      return ids.map((entity) => ({ op: "move", entity, to: change.to }));
  }
}

// ---------------------------------------------------------------- Build

/** A change Build applies to everyone selected in the draft. */
export type DraftChange =
  | { kind: "tier"; tier: TierId }
  /** A domain's level override, or null to remove it (the tier decides). */
  | { kind: "level"; domain: DomainId; level: Level | null }
  /** A place's default scene type, or null to remove it. */
  | { kind: "sceneType"; sceneType: string | null }
  /** A lore pin added to each one's pinned lore (entities as characters, places as places). */
  | { kind: "pin"; pin: LorePin };

/**
 * The JSON Patch that makes a change for each selected item of the draft, only where it changes
 * something. A place a map draws keeps its scene type (the map is its source); pins go to the
 * `lorePins` part whole, in one op.
 */
export function draftPatch(doc: WorldDoc, collection: "entities" | "places", ids: readonly string[], change: DraftChange): JsonPatchOp[] {
  if (change.kind === "pin") {
    const pins = lorePinsOf(doc);
    const target = collection === "entities" ? "characters" : "places";
    const key = lorePinKey(change.pin);
    let added = false;
    const next = { ...pins[target] };
    for (const id of ids) {
      const list = next[id] ?? [];
      if (list.some((p) => lorePinKey(p) === key)) continue;
      next[id] = [...list, change.pin];
      added = true;
    }
    return added ? [{ op: "add", path: "/lorePins", value: lorePinsJson({ ...pins, [target]: next }) }] : [];
  }
  const ops: JsonPatchOp[] = [];
  for (const id of ids) {
    if (collection === "places") {
      const place = doc.places[id];
      if (!place || change.kind !== "sceneType" || place.map !== undefined || (place.sceneType ?? null) === change.sceneType) continue;
      const path = pointerOf(["places", id, "sceneType"]);
      ops.push(change.sceneType === null ? { op: "remove", path } : { op: "add", path, value: change.sceneType });
      continue;
    }
    const entity = doc.entities[id];
    if (!entity) continue;
    if (change.kind === "tier" && entity.tier !== change.tier) ops.push({ op: "add", path: pointerOf(["entities", id, "tier"]), value: change.tier });
    if (change.kind === "level" && (entity.levels?.[change.domain] ?? null) !== change.level) {
      const levels = { ...entity.levels };
      if (change.level === null) delete levels[change.domain];
      else levels[change.domain] = change.level;
      const path = pointerOf(["entities", id, "levels"]);
      ops.push(Object.keys(levels).length === 0 ? { op: "remove", path } : { op: "add", path, value: levels });
    }
  }
  return ops;
}
