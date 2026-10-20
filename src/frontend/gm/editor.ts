// What GM mode's forms share once the truth is shown: the loaded GM view, the world's currency and
// one way to send an edit (one `lre.edit`: checked against what it touches, all or none, one fix
// with its own Undo chip). Names stand in for ids everywhere; the ids show only with Show ids.

import type { EditOp } from "../../shared/protocol";
import type { GmEntity, GmView } from "../../shared/state-view";
import type { WorldCurrency } from "../../shared/world";

export interface Editor {
  gm: GmView;
  currency: WorldCurrency;
  busy: boolean;
  /** Sends the operations as one edit and reloads the GM view; resolves whether it applied. */
  edit(ops: EditOp[]): Promise<boolean>;
}

/** An entity's or place's name, the id when neither has one, "—" for none. */
export function nameOf(gm: GmView, id: string | null): string {
  if (id === null) return "—";
  return gm.entities.find((e) => e.id === id)?.name ?? gm.places.find((p) => p.id === id)?.name ?? id;
}

/**
 * The entities a search and a kind filter keep: a name (or, for those who know them, an id)
 * containing the query, of the kind when one is chosen; present ones first, then by name.
 */
export function findEntities(entities: readonly GmEntity[], query: string, kind: string): GmEntity[] {
  const q = query.trim().toLowerCase();
  return entities.filter((e) => (kind === "" || e.kind === kind) && (q === "" || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))).sort((a, b) => Number(a.gone) - Number(b.gone) || a.name.localeCompare(b.name));
}
