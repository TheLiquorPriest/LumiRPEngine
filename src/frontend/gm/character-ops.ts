// The GM character sheet's choices as the edits they send (the Character model, DESIGN §7): which
// page a GM entity opens, and one `lre.edit` op for each control. Pure, so tests read them.

import type { CharacterBed, CharacterRelation, PlaceRef } from "../../shared/character";
import type { EditOp } from "../../shared/protocol";
import { PARTY_RELATION } from "../../shared/party";
import type { RoutineRole } from "../../shared/routines";
import type { GmEntity, GmRelation, GmView } from "../../shared/state-view";
import { bedValue } from "../character/bed-picker";
import { partyOf } from "../requests";

/** A person opens their character sheet; anything else, the entity sheet. */
export function gmPageFor(entity: Pick<GmEntity, "person">): "character" | "entity" {
  return entity.person ? "character" : "entity";
}

/** "Move them…": a move through the one move path to the place picked; none when they're already there. */
export function moveOp(entity: Pick<GmEntity, "id" | "place">, place: PlaceRef | null): EditOp | null {
  return place && place.id !== entity.place ? { op: "move", entity: entity.id, to: place.id } : null;
}

/** Home: their `home` set to the place picked, or cleared. */
export function homeOp(entity: Pick<GmEntity, "id">, place: PlaceRef | null): EditOp {
  return { op: "set", entity: entity.id, field: "home", value: place?.id ?? null };
}

/** Sleeps: their `bed` set to the place or thing picked, or cleared to sleep at home. */
export function bedOp(entity: Pick<GmEntity, "id">, bed: CharacterBed): EditOp {
  return { op: "set", entity: entity.id, field: "bed", value: bedValue(bed) };
}

/** "Travels with <player character>" switched on or off: the party link or unlink, or none when it's already so. */
export function partySwitchOp(entity: GmEntity, gm: Pick<GmView, "entities">, on: boolean): EditOp | null {
  const party = partyOf(entity, gm);
  return party && party.travels !== on ? party.op : null;
}

/**
 * How what their routine has now stands against what they're doing (DESIGN §6.6), so the sheet can
 * say why the two differ: `off` and `context` (informative) never move them; an enforced routine
 * yields to a story hold (`held`), and may simply not have them there (`elsewhere`); else `living`.
 * A place inside the block's (the counter in the diner) counts as there.
 */
export type RoutineStanding = "off" | "context" | "held" | "elsewhere" | "living";

export function routineStanding(role: RoutineRole, held: boolean, blockPlace: string | null, place: string | null, places: readonly Pick<PlaceRef, "id" | "parent">[]): RoutineStanding {
  if (role === "off") return "off";
  if (role === "informative") return "context";
  if (held) return "held";
  if (blockPlace === null) return "living";
  const parent = new Map(places.map((p) => [p.id, p.parent]));
  const seen = new Set<string>();
  for (let at = place; at !== null && !seen.has(at); at = parent.get(at) ?? null) {
    if (at === blockPlace) return "living";
    seen.add(at);
  }
  return "elsewhere";
}

/** Relations a character's sheet shows elsewhere: what holds them (Inside) and the party (its switch). */
const SHOWN_ON_SHEET: Record<string, true> = { in: true, [PARTY_RELATION]: true };

/**
 * The Relations list's rows. With the character model's words (a character's sheet), each says what
 * it holds as the world words it ("warm", "Role: Owner"), in the model's order, and the relations the
 * sheet shows elsewhere are left out; the numbers wait on the edit form. A relation the words don't
 * cover still gets its row after them, so the GM can always see and remove it. Otherwise (an
 * entity's page) each lists its declared fields by label, and a regard's value now; a field the
 * relation type doesn't declare is bookkeeping, never shown.
 */
export function relationRows(entity: Pick<GmEntity, "relations">, gm: Pick<GmView, "relationTypes">, words?: readonly CharacterRelation[]): { relation: GmRelation; detail: string | undefined }[] {
  const detailOf = (relation: GmRelation): string | undefined => {
    const defs = gm.relationTypes.find((t) => t.id === relation.type)?.fields ?? [];
    const parts = Object.entries(relation.fields ?? {}).flatMap(([id, v]) => {
      const def = defs.find((d) => d.id === id);
      return def ? [`${def.label} ${typeof v === "string" ? v : JSON.stringify(v)}`] : [];
    });
    if (relation.value !== undefined) parts.push(`now ${relation.value}`);
    return parts.length > 0 ? parts.join(" · ") : undefined;
  };
  if (!words) return entity.relations.map((relation) => ({ relation, detail: detailOf(relation) }));
  const worded = words.flatMap((w) => {
    const relation = entity.relations.find((r) => r.type === w.type && r.to === w.to.id);
    return relation ? [{ relation, detail: w.words !== "" ? w.words : undefined }] : [];
  });
  const rest = entity.relations.filter((r) => !SHOWN_ON_SHEET[r.type] && !worded.some((w) => w.relation === r)).map((relation) => ({ relation, detail: detailOf(relation) }));
  return [...worded, ...rest];
}
