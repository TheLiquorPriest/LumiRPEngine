// An edit's operations, as kept code reads them as data (DESIGN §7 GM edits, §12 ✎ fixes): moved
// unchanged out of the previous extension's protocol (PlanSwap-13), which takes them back from here
// until it goes.

import type { DomainId, EntityId, FieldId, KindId, PlaceId, RelationTypeId, SlotId, StageId, TierId, TrackId } from "./ids";
import type { JsonObject, JsonValue } from "./json";
import type { MindEditOp } from "./minds";
import type { OrgOp } from "./org-ops";
import type { RoutineEditOp } from "./routines";
import type { ItemOp, PlaceOp } from "./things";
import type { FacetId, FacetValueId, LifeStateId, SectionFeed } from "./world";

/**
 * One typed edit (DESIGN §7 GM edits, §12 ✎ fixes). Each is checked against what it touches (a
 * field's type, values and bounds; a relation type's kinds and fields; a tier, a track's stages)
 * and resolved through the core effects, so pack guards apply. A ✎ fix is one `set`; the GM editor
 * sends any of them in order, applied all or none as one `fix` entry.
 *  - `set`, `add`: an entity's field (an owner is `set owner`); `add` stops at the field's bounds.
 *  - `link` adds a relation or replaces its fields; `unlink` removes it.
 *  - `move` puts an entity at a place, out of any container; `put` puts it inside another entity
 *    (`in`), or with `into: null` takes it out to where its container is.
 *  - `adjust` moves money into (positive) or out of an account against `economy.external:correction`.
 *  - `stage` moves a track to a stage: on to one that follows, as its entry plays; back, only the stage.
 *  - `entity` sets an entity's tier, agent flag and per-domain level overrides (null follows the tier).
 *  - `classify` sets an entity's classes (facet → values, the world's facets and values only) and
 *    tags, both whole; the chat holds them from then on over the world's definition.
 *  - `spawn` adds an entity; `despawn` takes one out of the world (`gone`, its relations unlinked)
 *    and `restore` brings it back.
 *  - `mind_pin`, `mind_refresh`, `mind_memory`, `mind_intent`: a character's mind (DESIGN §24.9): pin
 *    their fidelity, ask for a fresh mind next turn, edit or delete a note, commitment or plan, and
 *    set what they mean to do now and how they go about it; `mind_knowledge`: one holding of a fact
 *    the chat knows (§24.11), anyone's, the player character's too, set whole or taken away (`MindEditOp`).
 *  - `routine_follow`, `routine_block`, `schedule_override`: a character's routine and schedules in
 *    this chat (DESIGN §8): how they follow it, one block of it, one of their schedules (`RoutineEditOp`).
 *  - `effect` runs a pack effect registered for GM edits (`EffectDef.gm`) with literal arguments:
 *    what no entity field holds, such as an asset's price.
 *  - `feed` sets a section's settings in this chat over the world's (DESIGN §6.11), whole; `to: null`
 *    returns it to the world's.
 *  - `item` is one change to a thing in the things model's vocabulary (`ItemOp`, ITEMS-SPEC §3.5):
 *    made, moved through the one location writer, handed over, owned, lent, kept at, labelled,
 *    merged or removed. `put`, `move`, `link in`, `unlink in` and `set place` on a thing are such a
 *    move too.
 *  - `place` is one change to a place made in play (`PlaceOp`), the space pack's.
 *  - `org` is one change to an organization (`OrgOp`, ORG-SPEC §7.2): founding one, its members,
 *    positions, titles, delegations, staff and pay, shares, entry, dues, the party's tiers, its
 *    structure and name; the orgs pack compiles it to the packs' effects, the GM's (no power asked),
 *    with its History line, in one unit.
 */
export type EditOp =
  | { op: "set"; entity: EntityId; field: FieldId; value: JsonValue }
  | { op: "add"; entity: EntityId; field: FieldId; delta: number }
  | { op: "link"; rel: RelationTypeId; from: EntityId; to: EntityId; fields?: JsonObject; until?: number }
  | { op: "unlink"; rel: RelationTypeId; from: EntityId; to: EntityId }
  | { op: "move"; entity: EntityId; to: PlaceId }
  | { op: "put"; entity: EntityId; into: EntityId | null }
  | { op: "adjust"; account: EntityId; cents: number }
  | { op: "stage"; track: TrackId; to: StageId }
  | { op: "entity"; entity: EntityId; tier?: TierId; agent?: boolean; levels?: Partial<Record<DomainId, number | null>> }
  | { op: "classify"; entity: EntityId; class: Record<FacetId, FacetValueId[]>; tags: string[] }
  /** A life state (DESIGN §8), and who is told it besides everyone with the entity; at least one of them. */
  | { op: "life"; entity: EntityId; to?: LifeStateId; tell?: EntityId[] }
  | { op: "spawn"; kind: KindId; name: string; id?: EntityId; tier?: TierId; place?: PlaceId; agent?: boolean }
  | { op: "despawn"; entity: EntityId }
  | { op: "restore"; entity: EntityId }
  | MindEditOp
  | RoutineEditOp
  | { op: "effect"; effect: string; args: JsonObject }
  | { op: "feed"; section: SlotId; to: SectionFeed | null }
  | { op: "item"; change: ItemOp }
  | { op: "place"; change: PlaceOp }
  | { op: "org"; change: OrgOp };
