// What an Upgrade brings into a chat, entity by entity (DESIGN §4.3 `migrate`), as the world store
// works it out and the pages show it: moved unchanged out of the previous extension's protocol
// (PlanSwap-13), which takes it back from here until it goes.

import type { EntityId, FieldId, RelationTypeId, RevisionId } from "./ids";
import type { EntityUpgradePick, UpgradeAspect } from "./ledger";

/** Where an Upgrade pick is written (DESIGN §4.3 `migrate`): a whole entity, one of its parts, a field, or one relation by type and target. */
export type UpgradeTarget =
  | { entity: EntityId; part: "entity" | UpgradeAspect }
  | { entity: EntityId; part: "field"; field: FieldId }
  | { entity: EntityId; part: "relation"; rel: RelationTypeId; to: string };

/** One change an Upgrade can bring into the chat, with its default pick and why. */
export interface UpgradeChange {
  /** Unique within the preview. */
  id: string;
  label: string;
  /** The chat's value now and the revision's, in words. */
  from: string;
  to: string;
  /** Take or keep; for an entity gone from the revision, keep or remove. */
  options: EntityUpgradePick[];
  /** The default: take what play never touched, keep what it did. */
  pick: EntityUpgradePick;
  why: "changed in play" | "unchanged" | "new" | "removed";
  /** Where a pick is written: both sides of a symmetric or inverse pair, which change together. */
  targets: UpgradeTarget[];
  /** It names someone or somewhere the POV can't see: shown as "A hidden change" until the owner opens the spoiler gate. */
  secret?: true;
}

export interface UpgradeEntityRow {
  entity: EntityId;
  name: string;
  /** The kind's label. */
  kind: string;
  status: "new" | "removed" | "changed";
  changes: UpgradeChange[];
  /** Someone or something the POV can't see: the whole row waits behind the spoiler gate. */
  secret?: true;
}

/** What an Upgrade brings into the chat, entity by entity (DESIGN §4.3 `migrate`). */
export interface UpgradePreview {
  /** The revision the chat's definitions come from (its own, unless an earlier Upgrade left them behind) and the one it moves to. */
  from: RevisionId;
  to: RevisionId;
  entities: UpgradeEntityRow[];
  /** Tracks that go back to their start, in words; a track the POV can't see is `secret`. */
  tracks: { text: string; secret?: true }[];
}
