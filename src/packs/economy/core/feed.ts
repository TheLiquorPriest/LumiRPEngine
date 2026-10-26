// The Property section (DESIGN §6.11, §27.9): real estate and who holds it. In the player scope,
// the properties the player character holds a role on and can see (his own, or a group's he
// belongs to), each with where it is (as he may see it), his role and share, and the other owners as
// he may know them. In `scene` scope, the properties of the people with him that they can see, as
// they know them; in `gm`, every other one too, a secret one included. Owners and shares are read
// through `engine/access`.

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

/** The roles that make a property the holder's own; the rest only keep it, benefit from it or use it. */
const OWNING: Record<OwnerRole, boolean> = { owner: true, joint: true, custodian: false, beneficiary: false, trustee: false, authorized_user: false };

export function propertyLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const pov = ctx.world.pov;
  if (ctx.levelOf(pov, "money") === 0) return [];
  const see = (who: EntityId, id: EntityId): boolean => canSeeEntity(ctx.registry, ctx.world, ctx.state, who, id);
  const name = (id: EntityId): string => own(ctx.state.entities, id)?.name ?? id;
  const where = (id: EntityId, viewer: EntityId | null): string => {
    const place = placeOfEntity(ctx.state, id);
    if (!place) return "";
    if (viewer !== null && !canSeePlace(ctx.registry, ctx.world, ctx.state, viewer, place)) return " somewhere";
    const at = own(ctx.world.places, place)?.name ?? place;
    // A building named for its place ("114 Harbor Street at 114 Harbor Street") says where it is already.
    return at === name(id) ? "" : ` at ${at}`;
  };
  /** A holder's role and share, as every property line names them. */
  const roleOf = (o: { role: OwnerRole; worth: number }): string => `${ROLE_LABEL[o.role]}${o.worth > 0 ? `, ${Math.round(o.worth)}%` : ""}`;
  const lines: FeedLine[] = [];
  const others: EntityId[] = [];
  for (const id of propertyIds(ctx.state)) {
    if (isGone(ctx.state, id)) continue;
    const access = accessOf(ctx.state, id);
    // One he holds a part in but can't see (a group's secret safehouse) is never a player line.
    if (!owns(ctx.state, pov, id) || !see(pov, id)) {
      others.push(id);
      continue;
    }
    // "Yours" only when he owns it outright or jointly; otherwise its holders first, each with their
    // role, then what he is to it (his own role, or the group he holds through). Holders as he may know them.
    const holder = (o: (typeof access.owners)[number]): string => `${see(pov, o.party) ? name(o.party) : "someone"} (${roleOf(o)})`;
    const direct = access.owners.find((o) => o.party === pov);
    const through = direct ? undefined : access.owners.find((o) => isMemberOf(ctx.state, pov, o.party));
    const rest = access.owners.filter((o) => o !== direct).map(holder);
    let stake: string;
    if (direct && OWNING[direct.role]) stake = `yours (${roleOf(direct)})${rest.length > 0 ? `, with ${rest.join(", ")}` : ""}`;
    else {
      const you = direct ? `you: ${ROLE_LABEL[direct.role]}` : through ? `you: through ${see(pov, through.party) ? name(through.party) : "someone"}` : null;
      stake = [rest.length > 0 ? `held by ${rest.join(", ")}` : null, you].filter((p) => p !== null).join("; ");
    }
    lines.push({ text: `${name(id)}${where(id, pov)}${stake !== "" ? `: ${stake}` : ""}.`, known: "pov" });
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
    // Scene facts are only what an owner with him can see by the visibility rules (never a secret
    // property), told as they may know it; the rest is the GM's, by real names.
    const knowers = owners.filter((o) => withHim(o.party) && see(o.party, id)).map((o) => o.party);
    const knower = knowers[0];
    if (knower !== undefined) {
      const text = `${name(id)}${where(id, knower)}: held by ${owners.map((o) => `${see(knower, o.party) || o.party === knower ? name(o.party) : "someone"} (${roleOf(o)})`).join(", ")}.`;
      lines.push({ text, known: "scene", who: knowers.map(name).join(", ") });
    } else if (scope === "gm") lines.push({ text: `${name(id)}${where(id, null)}: held by ${owners.map((o) => `${name(o.party)} (${roleOf(o)})`).join(", ")}.`, known: "gm" });
    else continue;
    told++;
  }
  return lines;
}
