// The Property section (DESIGN §6.11, §27.9): real estate and who holds it. In the player scope,
// the properties the player character holds a role on (his own, or a group's he belongs to), each
// with where it is (as he may see it), his role and share, and the other owners as he may know
// them. In `scene` scope, the properties of the people with him, as theirs to know; in `gm`, every
// other property too. Owners and shares are read through `engine/access`.

import type { OwnerRole } from "../../../shared/finance";
import type { EntityId } from "../../../shared/ids";
import type { FeedScope } from "../../../shared/world";
import { accessOf, owns } from "../../../engine/access";
import { own } from "../../../engine/pack-kit";
import { together } from "../../../engine/presence";
import type { FeedLine, ReadContext } from "../../../engine/registry";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { isMemberOf } from "../../../engine/selector";
import { canSeeEntity, canSeePlace } from "../../../engine/visibility";
import { propertyIds } from "./property";

/** At most this many properties beyond the player character's are told. */
const OTHERS_CAP = 10;

/** A holder's role as a property line says it. */
const ROLE_LABEL: Record<OwnerRole, string> = { owner: "owner", joint: "joint owner", custodian: "custodian", beneficiary: "beneficiary", trustee: "trustee", authorized_user: "authorized user" };

export function propertyLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const pov = ctx.world.pov;
  if (ctx.levelOf(pov, "money") === 0) return [];
  const see = (who: EntityId, id: EntityId): boolean => canSeeEntity(ctx.registry, ctx.world, ctx.state, who, id);
  const name = (id: EntityId): string => own(ctx.state.entities, id)?.name ?? id;
  const where = (id: EntityId, viewer: EntityId | null): string => {
    const place = placeOfEntity(ctx.state, id);
    if (!place) return "";
    return viewer === null || canSeePlace(ctx.registry, ctx.world, ctx.state, viewer, place) ? ` at ${own(ctx.world.places, place)?.name ?? place}` : " somewhere";
  };
  const lines: FeedLine[] = [];
  const others: EntityId[] = [];
  for (const id of propertyIds(ctx.state)) {
    if (isGone(ctx.state, id)) continue;
    const access = accessOf(ctx.state, id);
    if (!owns(ctx.state, pov, id)) {
      others.push(id);
      continue;
    }
    // His own stake, or the group's he holds through; the rest of the owners as he may know them.
    const mine = access.owners.find((o) => o.party === pov) ?? access.owners.find((o) => isMemberOf(ctx.state, pov, o.party));
    const stake = mine ? `${mine.party === pov ? "yours" : `${see(pov, mine.party) ? name(mine.party) : "someone"}'s`} (${ROLE_LABEL[mine.role]}${mine.worth > 0 && mine.worth < 100 ? `, ${Math.round(mine.worth)}%` : ""})` : "yours";
    const co = access.owners.filter((o) => o !== mine).map((o) => `${see(pov, o.party) ? name(o.party) : "someone"}${o.worth > 0 ? ` ${Math.round(o.worth)}%` : ""}`);
    lines.push({ text: `${name(id)}${where(id, pov)}: ${stake}${co.length > 0 ? `, with ${co.join(", ")}` : ""}.`, known: "pov" });
  }
  if (scope === "player") return lines;
  const here = placeOfEntity(ctx.state, pov);
  const withHim = (who: EntityId): boolean => {
    const e = own(ctx.state.entities, who);
    return !!e && kindIs(ctx.registry, ctx.world, e.kind, "person") && see(pov, who) && together(ctx.world, here, placeOfEntity(ctx.state, who));
  };
  let told = 0;
  for (const id of others) {
    if (told >= OTHERS_CAP) break;
    const owners = accessOf(ctx.state, id).owners;
    if (owners.length === 0) continue;
    const text = `${name(id)}${where(id, null)}: ${owners.map((o) => `${name(o.party)}'s${o.worth > 0 && o.worth < 100 ? ` (${Math.round(o.worth)}%)` : ""}`).join(", ")}.`;
    const knowers = owners.filter((o) => withHim(o.party)).map((o) => name(o.party));
    if (knowers.length > 0) lines.push({ text, known: "scene", who: knowers.join(", ") });
    else if (scope === "gm") lines.push({ text, known: "gm" });
    else continue;
    told++;
  }
  return lines;
}
