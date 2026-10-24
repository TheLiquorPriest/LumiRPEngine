// What GM mode's forms share once the truth is shown: the loaded GM view, the world's currency and
// one way to send an edit (one `lre.edit`: checked against what it touches, all or none, one fix
// with its own Undo chip), after which the GM view says what it did, with that Undo. Names stand in
// for ids everywhere; the ids show only with Show ids.

import type { EditOp } from "../../shared/protocol";
import type { GmEntity, GmView } from "../../shared/state-view";
import type { WorldCurrency } from "../../shared/world";

export interface Editor {
  gm: GmView;
  currency: WorldCurrency;
  busy: boolean;
  /**
   * Sends the operations as one edit and reloads the GM view; resolves whether it applied. Once it
   * has, the GM view says what it did, with its Undo: `done`, else the edit's own lines.
   */
  edit(ops: EditOp[], done?: string): Promise<boolean>;
}

/** The GM view's own editor, which World's bulk change sends through as well. */
export interface BulkEditor extends Editor {
  /**
   * Sends a batch as edits of at most `EDIT_OPS_MAX` operations, in order, stopping at the first one
   * refused; then the GM view says what applied, `done` with how many operations did, with one Undo
   * for all of it.
   */
  editAll(ops: readonly EditOp[], done: (count: number) => string): Promise<{ applied: number; of: number }>;
}

type Edit = GmView["edits"][number];

/** What the GM view says after an edit: what it did, and the chips that undo it, newest first. */
export interface EditNotice {
  text: string;
  undo: string[];
}

/** The edits a reload brought that weren't there before (by message and sequence): what an edit just made. */
export function newEdits(before: readonly Edit[], after: readonly Edit[]): Edit[] {
  const seen = new Set(before.map((e) => `${e.messageId}\u0000${e.seq}`));
  return after.filter((e) => !seen.has(`${e.messageId}\u0000${e.seq}`));
}

/** The notice for the edits just made: `done`, else their own lines; Undo takes back every one of them. */
export function editNotice(made: readonly Edit[], done?: string): EditNotice {
  return { text: done ?? (made.flatMap((e) => e.lines).join(" · ") || "Saved"), undo: made.flatMap((e) => (e.undo === null ? [] : [e.undo])) };
}

/** Whether a notice's Undo still reaches all it made: every chip is still an edit's on the latest reply. */
export function noticeStands(notice: EditNotice, gm: Pick<GmView, "edits">): boolean {
  return notice.undo.every((chip) => gm.edits.some((e) => e.undo === chip));
}

/** An entity's or place's name, the id when neither has one, "—" for none. */
export function nameOf(gm: Pick<GmView, "entities" | "places">, id: string | null): string {
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

/**
 * The things the player said they had, made real for their actions (DESIGN §9.4 player claims), that
 * are still in the world, by name, each with who holds it or where it lies: the list a GM finds them
 * in to remove them. A removed one, or a consumable used up, has left the list.
 */
export function claimedThings(gm: Pick<GmView, "entities" | "places">): { entity: GmEntity; where: string }[] {
  return gm.entities
    .filter((e) => e.claimed && !e.gone)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entity) => ({ entity, where: entity.holder !== null ? `held by ${nameOf(gm, entity.holder)}` : entity.place !== null ? `at ${nameOf(gm, entity.place)}` : "nowhere" }));
}
