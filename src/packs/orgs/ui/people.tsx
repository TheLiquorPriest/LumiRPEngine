// An organization's People (ORG-SPEC §4.4): at the top, by power, Hire someone (`staff.hire`),
// Admit a member (`members.admit`; on a trust, Add an officer or director) and a trust's Pay out
// (`money.payout`); each position with its seats filled of total and whom it reports to, its holders
// under it (the Chart tab draws them as a tree); then staff without a position, members without one
// (Board and officers on a company or a trust, the party's by tier) and the owners with their share,
// which link to a company's Ownership; and how many in it the reader doesn't know. A row is a name
// (an organization seated or belonging here by its type's icon), a title and here or away, and
// opens the member sheet (`org_edit`), with what the reader may do there; in GM → Orgs, the GM's.

import type { SheetRoute } from "../../../frontend/app";
import { Button, Empty, List, ListRow, Section } from "../../../frontend/components";
import type { OrgPersonView, OrgView } from "../../../shared/org-view";
import { isPartyTier, PARTY_TIERS } from "../../../shared/party";
import { admitLabel } from "./chart-model";
import { orgEditRoute, peopleControls } from "./edit";
import { count, seatWords, TIER_HEADINGS, TYPE_ICON } from "./words";

/** Someone on the page as a row: their title (or what `subtitle` says), Here or Away (or `value`); it opens their member sheet. */
function memberRow(org: OrgView, p: OrgPersonView, subtitle: string | undefined, value: string | undefined, open: (route: SheetRoute) => void) {
  return <ListRow key={p.id} id={p.id} icon={p.org !== null ? TYPE_ICON[p.org] : "user"} title={p.you ? `${p.name} (you)` : p.name} subtitle={subtitle} value={value ?? (p.you || p.org !== null ? undefined : p.here ? "Here" : "Away")} valueTone="muted" chevron onClick={() => open(orgEditRoute(org.id, "member", p.id))} />;
}

/** `ownership` switches the page to its Ownership tab, when it has one. */
export function OrgPeople(props: { org: OrgView; ownership: (() => void) | null; open(route: SheetRoute): void }) {
  const { org } = props;
  const byId = new Map(org.people.map((p) => [p.id, p]));
  const placed = new Set(org.positions.flatMap((p) => p.holders));
  const unplaced = org.people.filter((p) => !placed.has(p.id));
  const can = peopleControls(org);
  const rows = (people: readonly OrgPersonView[]) => people.map((p) => memberRow(org, p, [p.title, p.via ? `through ${p.via.name}` : null].filter((part) => part).join(" · ") || undefined, undefined, props.open));
  const group = (key: string, title: string, people: readonly OrgPersonView[]) =>
    people.length === 0 ? null : (
      <div key={key} data-lre-org-people={key}>
        <Section title={title} flush>
          <List>{rows(people)}</List>
        </Section>
      </div>
    );
  const owners = org.people.filter((p) => p.hows.includes("owner"));
  const hidden = org.hidden.count;
  const actions =
    can.hire || can.admit || can.payout ? (
      <div class="lre-stack" data-lre-org-people-actions>
        {can.hire ? (
          <Button variant="primary" icon="user-plus" block onClick={() => props.open(orgEditRoute(org.id, "hire"))}>
            Hire someone
          </Button>
        ) : null}
        {can.admit ? (
          <Button icon="user-plus" block onClick={() => props.open(orgEditRoute(org.id, "admit"))}>
            {admitLabel(org)}
          </Button>
        ) : null}
        {can.payout ? (
          <Button icon="coins" block onClick={() => props.open(orgEditRoute(org.id, "payout"))}>
            Pay out to its beneficiaries
          </Button>
        ) : null}
      </div>
    ) : null;
  if (org.people.length === 0 && hidden === 0) {
    return (
      <div class="lre-stack" data-lre-org-people-tab={org.id}>
        {actions}
        <Empty icon="users">No one belongs to it that you know of.</Empty>
      </div>
    );
  }
  return (
    <div class="lre-stack" data-lre-org-people-tab={org.id}>
      {actions}
      {org.positions.map((position) => {
        const holders = position.holders.flatMap((id) => byId.get(id) ?? []);
        return (
          <div key={position.id} data-lre-org-position={position.id}>
            <Section title={position.title} aside={[seatWords(position), position.reportsTo ? `reports to ${position.reportsTo.title}` : null].filter((part) => part !== null).join(" · ")} flush>
              <List>
                {rows(holders)}
                {position.hidden > 0 ? <ListRow title={`And ${count(position.hidden, "other", "others")} you don't know`} /> : null}
                {holders.length === 0 && position.hidden === 0 ? <ListRow title="Vacant" /> : null}
              </List>
            </Section>
          </div>
        );
      })}
      {group(
        "staff",
        "Staff",
        unplaced.filter((p) => p.hows.includes("staff")),
      )}
      {org.type === "party"
        ? PARTY_TIERS.map((tier) =>
            group(
              tier,
              TIER_HEADINGS[tier],
              unplaced.filter((p) => p.hows.includes(tier)),
            ),
          )
        : group(
            "members",
            org.type === "company" || org.type === "trust" ? "Board and officers" : "Members",
            unplaced.filter((p) => p.hows.some((h) => h === "member" || h === "leader" || isPartyTier(h))),
          )}
      {owners.length > 0 ? (
        <div data-lre-org-people="owners">
          <Section
            title={org.type === "trust" ? "Trustees and beneficiaries" : "Owners"}
            aside={
              props.ownership ? (
                <Button variant="ghost" size="sm" iconAfter="chevron-right" onClick={props.ownership}>
                  Ownership
                </Button>
              ) : undefined
            }
            flush
          >
            <List>{owners.map((p) => memberRow(org, p, p.title, p.share !== null ? `${Number(p.share.toFixed(2))}%` : undefined, props.open))}</List>
          </Section>
        </div>
      ) : null}
      {hidden > 0 ? <span class="lre-small lre-muted">{`${count(hidden, "person", "people")} you don't know ${hidden === 1 ? "belongs" : "belong"} to it.`}</span> : null}
    </div>
  );
}
