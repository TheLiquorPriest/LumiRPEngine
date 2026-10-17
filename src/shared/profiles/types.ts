// What a ruleset profile is (DESIGN §11): a world fragment in the shapes the engine already reads.

import type { ActionId, CheckId, DomainId, FieldId, Level, ProgressionId, TableId } from "../ids";
import type { DataTable } from "../tables";
import type { ActionDef, AdjudicationDef, CheckDef, CombatDef, FieldDef, ProgressionDef, SheetLayoutDef } from "../world";

export type ProfileId = "modern" | "classic" | "fifth" | "custom";

export interface ProfileDef {
  id: ProfileId;
  label: string;
  /** One line on what it gives a world, for the picker. */
  summary: string;
  /** Fields for the kind of the world's people: the point of view's kind. */
  fields: Record<FieldId, FieldDef>;
  checks: Record<CheckId, CheckDef>;
  actions: Record<ActionId, ActionDef>;
  tables: Record<TableId, DataTable>;
  ruleset: {
    progression: Record<ProgressionId, ProgressionDef>;
    sheet: SheetLayoutDef;
    minLevels: Partial<Record<DomainId, Level>>;
    adjudication: AdjudicationDef;
    combat: CombatDef;
  };
}
