// GM → Orgs (ORG-SPEC §6.1, the orgs pack's `orgs.gm`): every organization's page as the GM sees it,
// every member named (`buildOrgView` with no reader), the party first, then each organization in id
// order; and, for Who may…, every person holding a power in it, each power with the chain of bases it
// rests on in words: an owner's role, a position and how it is held, a delegation and its granter's
// own basis, a member's default, or control: their own basis where they hold it, then each hold it
// flows down through. Pure; read on request with the rest of the GM view.

import { ownersIn, ROLE_RIGHTS, type OwnerRole } from "../../../shared/finance";
import type { EntityId } from "../../../shared/ids";
import { ORG_POWERS, POWER_WORDS, type OrgGrant, type OrgPower, type OrgType } from "../../../shared/org";
import type { OrgGmView, OrgMayPowerView } from "../../../shared/org-view";
import { controlPathOf, defaultPowers, delegationsOf, heldPositions, holdersOf, HOW_WORDS, orgPower, orgTypeOf, type OrgHold } from "../../../engine/org";
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

/** How one hold passes a power down, in a chain's words. */
function holdWords(ctx: ReadContext, hold: OrgHold): string {
  const holder = nameOf(ctx, hold.holder);
  const org = nameOf(ctx, hold.org);
  const pct = (n: number): string => `${Math.round(n * 100) / 100}%`;
  if (hold.how === "position") return `${holder} holds ${hold.position?.title ?? "a position"} at ${org}: its powers pass down`;
  if (hold.how === "delegate") return `${holder} acts for ${org} by delegation: its powers pass down`;
  if (!hold.controlled) return `${holder} holds ${pct(hold.share ?? 0)} of ${org}: seeing its money passes down`;
  return `${holder} controls ${org} (${hold.votes !== undefined ? `${pct(hold.votes)} of its votes` : ROLE_WORDS[hold.role ?? "owner"]}): its powers pass down`;
}

/** The steps of one grant: what `who` is there, and why that gives the power; a delegation then names its granter's own steps; control, the basis at the top and each hold on the way down. */
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
    case "control": {
      const path = controlPathOf(ctx, who, org, power);
      if (!path || depth >= CHAIN_DEPTH) return [`${name} holds it through ${grant.id === undefined ? "another organization" : nameOf(ctx, grant.id)}`];
      return [...chainOf(ctx, path.top, who, power, path.root, depth + 1), ...path.steps.map((s) => holdWords(ctx, s))];
    }
  }
}

/** Every organization in the GM view, with Who may…'s answers; with `only`, those it names, in the view's order, each built alone (an id naming no organization is left out). */
export function buildOrgsGm(ctx: ReadContext, only?: readonly string[]): OrgGmView[] {
  const people = Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => !isGone(ctx.state, id) && kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "person"));
  const party = partyIdOf(ctx);
  const wanted = only ? new Set(only) : null;
  const ids = [
    ...(party.exists ? [] : [party.id]),
    ...(wanted ? [...wanted].filter((id) => own(ctx.state.entities, id)).sort() : Object.keys(ctx.state.entities).sort()).filter((id) => orgTypeOf(ctx, id) !== null && !isGone(ctx.state, id)),
  ].filter((id) => !wanted || wanted.has(id));
  return ids.flatMap((id) => {
    const page = buildOrgView(ctx, id, null);
    if (!page) return [];
    // Only someone with a basis here can hold a power here: one of its rows (a member, through a
    // member group, staff, the party's roster), an owner, or a delegate; or, where an organization
    // holds it, anyone through that one (§29.3 Control). Everyone else holds none.
    const based = new Set([...rowsAt(ctx, id).map((r) => r.who), ...ownersIn(own(ctx.state.entities, id)?.fields ?? {}).map((o) => o.party), ...delegationsOf(ctx, id).map((d) => d.who)]);
    const held = orgTypeOf(ctx, id) !== null && holdersOf(ctx, id).length > 0;
    const may = people.flatMap((who) => {
      if (!held && !based.has(who)) return [];
      const powers: OrgMayPowerView[] = powersAt(ctx, id, who).map(({ power, grant }) => ({ power, basis: grant.basis, chain: chainOf(ctx, id, who, power, grant, 0) }));
      return powers.length > 0 ? [{ who: { id: who, name: nameOf(ctx, who) }, powers }] : [];
    });
    return [{ page, may }];
  });
}
