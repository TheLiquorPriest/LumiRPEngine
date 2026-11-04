// GM → Orgs (ORG-SPEC §6.1, the orgs pack's `orgs.gm`): every organization's page as the GM sees it,
// every member named (`buildOrgView` with no reader), the party first, then each organization in id
// order; and, for Who may…, every person holding a power in it, each power with the chain of bases it
// rests on in words: an owner's role, a position and how it is held, a delegation and its granter's
// own basis, a member's default. Pure; read on request with the rest of the GM view.

import { ownersIn, ROLE_RIGHTS, type OwnerRole } from "../../../shared/finance";
import type { EntityId } from "../../../shared/ids";
import { ORG_POWERS, POWER_WORDS, type OrgGrant, type OrgPower, type OrgType } from "../../../shared/org";
import type { OrgGmView, OrgMayPowerView } from "../../../shared/org-view";
import { defaultPowers, heldPositions, HOW_WORDS, orgPower, orgTypeOf } from "../../../engine/org";
import { own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import { buildOrgView, partyIdOf, powersAt, rowsAt } from "./view";

/** An owner's role as a chain's step names it. */
const ROLE_WORDS: Readonly<Record<OwnerRole, string>> = { owner: "an owner", joint: "a joint owner", custodian: "its custodian", beneficiary: "a beneficiary", trustee: "a trustee", authorized_user: "an authorized user" };

/** What a type calls its members in a default's step. */
const TYPE_WORDS: Readonly<Record<OrgType, string>> = { household: "A household's", group: "A group's", company: "A company's", trust: "A trust's", party: "The party's" };

/** How far a chain follows delegations back to a granter who holds the power some other way. */
const CHAIN_DEPTH = 8;

function nameOf(ctx: ReadContext, id: EntityId): string {
  return own(ctx.state.entities, id)?.name ?? id;
}

/** The power `who` holds in `org` by a grant, or null; the party before it has an entity reads its roster. */
function grantOf(ctx: ReadContext, org: EntityId, who: EntityId, power: OrgPower): OrgGrant | null {
  return orgTypeOf(ctx, org) === null ? (powersAt(ctx, org, who).find((p) => p.power === power)?.grant ?? null) : orgPower(ctx, who, org, power);
}

/** The steps of one grant: what `who` is there, and why that gives the power; a delegation then names its granter's own steps. */
function chainOf(ctx: ReadContext, org: EntityId, who: EntityId, power: OrgPower, grant: OrgGrant, depth: number): string[] {
  const name = nameOf(ctx, who);
  const orgName = own(ctx.state.entities, org)?.name ?? "the party";
  switch (grant.basis) {
    case "owner": {
      const roles = ownersIn(own(ctx.state.entities, org)?.fields ?? {}).filter((o) => o.party === who);
      const managing = roles.find((o) => ROLE_RIGHTS[o.role].manage);
      const role = managing ?? roles[0];
      return [`${name} is ${role ? ROLE_WORDS[role.role] : "an owner"} of ${orgName}`, managing ? "An owner who manages it holds every power" : "Every owner may see its money"];
    }
    case "position": {
      // The party before it has an entity: its leader holds the Leader position its page implies.
      if (orgTypeOf(ctx, org) === null) return [`${name} leads the party`, "The party's leader holds every power"];
      const held = heldPositions(ctx, who, org).find((h) => h.position.id === grant.id);
      const title = held?.position.title ?? (grant.id === undefined ? "a position" : grant.id);
      const how = held?.row.how === "staff" ? " by their job" : "";
      const powers = held?.position.powers ?? [];
      const gives = ORG_POWERS.every((p) => powers.includes(p)) ? `${title} holds every power` : powers.includes(power) ? `${title} may ${POWER_WORDS[power]}` : `${title} gives a power that lets it ${POWER_WORDS[power]}`;
      return [`${name} holds ${title} at ${orgName}${how}`, gives];
    }
    case "delegate": {
      const by = grant.id;
      const head = `${name} acts for ${orgName}${by === undefined ? "" : `, delegated by ${nameOf(ctx, by)}`}`;
      if (by === undefined || depth >= CHAIN_DEPTH) return [head];
      const theirs = grantOf(ctx, org, by, power);
      if (!theirs) return [head, `${nameOf(ctx, by)} no longer holds it`];
      // A granter whose own grant is a delegation back to someone already named stops there.
      if (theirs.basis === "delegate" && theirs.id === who) return [head];
      return [head, ...chainOf(ctx, org, by, power, theirs, depth + 1)];
    }
    case "member": {
      const type = orgTypeOf(ctx, org) ?? "party";
      const row = rowsAt(ctx, org).find((r) => r.who === who && defaultPowers(type, r.how).includes(power));
      const how = row ? HOW_WORDS[row.how].toLowerCase() : "member";
      const via = row?.via === undefined ? "" : ` through ${nameOf(ctx, row.via)}`;
      return [`${name} is ${how === "member" ? "a member" : how} of ${orgName}${via}`, `${TYPE_WORDS[type]} ${how === "member" ? "members" : `${how} tier`} may ${POWER_WORDS[power]} by default`];
    }
  }
}

/** Every organization in the GM view, with Who may…'s answers. */
export function buildOrgsGm(ctx: ReadContext): OrgGmView[] {
  const people = Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => !isGone(ctx.state, id) && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person"));
  const party = partyIdOf(ctx);
  const ids = [
    ...(party.exists ? [] : [party.id]),
    ...Object.keys(ctx.state.entities)
      .sort()
      .filter((id) => orgTypeOf(ctx, id) !== null && !isGone(ctx.state, id)),
  ];
  return ids.flatMap((id) => {
    const page = buildOrgView(ctx, id, null);
    if (!page) return [];
    const may = people.flatMap((who) => {
      const powers: OrgMayPowerView[] = powersAt(ctx, id, who).map(({ power, grant }) => ({ power, basis: grant.basis, chain: chainOf(ctx, id, who, power, grant, 0) }));
      return powers.length > 0 ? [{ who: { id: who, name: nameOf(ctx, who) }, powers }] : [];
    });
    return [{ page, may }];
  });
}
