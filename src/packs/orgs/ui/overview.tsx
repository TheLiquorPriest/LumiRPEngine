// An organization's Overview (ORG-SPEC §4.4, §4.5): the headline (the one figure the home shows for
// it; for the party, who is here and who is away; for one you don't belong to, who runs it), its
// alerts under it, each with Open to the tab that deals with it (`feed.tsx`), the party's own part
// (its roster by tier, a hired hand's way out, its purse and the leader's controls, `party.tsx`), and
// your place here: your title and since when and who runs it ("Mechanic since 12 Jan 2026; Marcus
// Delgado runs it"), your position and whom it reports to, what you may do in words with what each
// rests on, and the delegations you hold until when; then Coming up (paydays, invoices due, dues and
// lease ends) and its History, the latest 5 lines with the rest under More.

import { useState } from "preact/hooks";
import { Button, List, ListRow, Row, Section } from "../../../frontend/components";
import type { SheetRoute } from "../../../frontend/app";
import type { OrgHistoryLineView, OrgPersonView, OrgView } from "../../../shared/org-view";
import { ALERTS_SECTION, COMING_SECTION } from "../../../shared/org-feed";
import type { WorldCurrency } from "../../../shared/world";
import { decodeAlerts, decodeComing } from "./decode";
import { ComingUp, OrgAlerts } from "./feed";
import { PartyOverview, type PartyAct } from "./party";
import { andList, basisWords, hereAway, limitWords, placeLine, powerFamilies, powersText } from "./words";

/** History lines the Overview shows before More. */
export const HISTORY_SHOWN = 5;

/** An organization's History (§4.4): its latest lines, newest first, each with when and who; the rest under More. */
export function OrgHistory(props: { lines: readonly OrgHistoryLineView[] }) {
  const [all, setAll] = useState(false);
  return <OrgHistoryList lines={props.lines} all={all} onMore={() => setAll(true)} />;
}

/** History's rows: the latest `HISTORY_SHOWN`, then More with how many more there are, which shows them all (`all`). */
export function OrgHistoryList(props: { lines: readonly OrgHistoryLineView[]; all: boolean; onMore(): void }) {
  const shown = props.all ? props.lines : props.lines.slice(0, HISTORY_SHOWN);
  return (
    <Section title="History" flush>
      <List>
        {shown.map((line, i) => (
          <ListRow key={i} title={line.text} subtitle={[line.at, line.by ? line.by.name : null].filter((part) => part !== null).join(" · ")} />
        ))}
      </List>
      {!props.all && props.lines.length > HISTORY_SHOWN ? (
        <Button variant="ghost" size="sm" block onClick={props.onMore}>
          More ({props.lines.length - HISTORY_SHOWN})
        </Button>
      ) : null}
    </Section>
  );
}

/** Someone on the page as a row: their title, Here or Away; it opens their person sheet, but for your own. */
export function PersonRow(props: { person: OrgPersonView; subtitle?: string; open(route: SheetRoute): void }) {
  const p = props.person;
  return (
    <ListRow
      id={p.id}
      icon="user"
      title={p.you ? `${p.name} (you)` : p.name}
      subtitle={props.subtitle}
      value={p.you ? undefined : p.here ? "Here" : "Away"}
      valueTone="muted"
      chevron={!p.you}
      onClick={p.you ? undefined : () => props.open({ kind: "person", id: p.id })}
    />
  );
}

/**
 * The Overview; `act` plays the party's own controls, which show only where the page can play them
 * (Play's sheet, not GM → Orgs); `tabs` are the page's, and `onTab` changes it, for an alert's Open.
 */
export function OrgOverview(props: { org: OrgView; figure: string | null; currency?: WorldCurrency | null; act?: PartyAct; tabs?: readonly { id: string; label: string }[]; onTab?(id: string): void; open(route: SheetRoute): void }) {
  const { org } = props;
  const { you } = org;
  const others = org.people.filter((p) => !p.you);
  const here = others.filter((p) => p.here).length;
  const place = placeLine(org);
  const headline = [org.type === "party" ? (hereAway(here, others.length - here) ?? "Just you") : null, props.figure, you.belongs ? null : place].filter((line) => line !== null);
  const families = powerFamilies(you.powers.map((p) => p.power));
  const alerts = decodeAlerts(org.sections[ALERTS_SECTION]);
  const coming = decodeComing(org.sections[COMING_SECTION]);
  return (
    <div class="lre-stack" data-lre-org-overview={org.id}>
      {headline.length > 0 ? (
        <Section>
          <div class="lre-stack" data-lre-org-headline>
            {headline.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        </Section>
      ) : null}
      {alerts.length > 0 ? <OrgAlerts alerts={alerts} tabs={props.tabs ?? []} {...(props.onTab ? { onTab: props.onTab } : {})} /> : null}
      {org.type === "party" ? <PartyOverview org={org} currency={props.currency ?? null} {...(props.act ? { act: props.act } : {})} open={props.open} /> : null}
      {you.belongs ? (
        <Section title="Your place here">
          <div class="lre-stack">
            {place !== null ? <span data-lre-org-place>{place}</span> : null}
            {you.position && you.position.title.toLowerCase() !== (you.title ?? "").toLowerCase() ? <Row k="Position" v={you.position.title} /> : null}
            {you.reportsTo.length > 0 ? <Row k="Reports to" v={andList(you.reportsTo.map((r) => r.name))} /> : null}
          </div>
        </Section>
      ) : null}
      {you.belongs ? (
        <Section title="What you may do" flush>
          <List>
            {families.length === 0 ? (
              <ListRow title="You hold none of its powers" />
            ) : (
              families.map((f) => <ListRow key={f.family} title={f.family} subtitle={f.words.length > 0 ? f.words.join(", ") : undefined} value={basisWords(org, you.powers.filter((p) => f.powers.includes(p.power)))} valueTone="muted" />)
            )}
          </List>
        </Section>
      ) : null}
      {you.delegations.length > 0 ? (
        <Section title="Delegations you hold" flush>
          <List>
            {you.delegations.map((d, i) => (
              <ListRow key={i} title={powersText(d.powers)} subtitle={[d.until ? `Until ${d.until}` : "Until it is revoked", d.by ? `from ${d.by.name}` : null, ...(d.limits ? limitWords(d.limits) : [])].filter((p) => p !== null).join(" · ")} />
            ))}
          </List>
        </Section>
      ) : null}
      {coming.length > 0 ? <ComingUp items={coming} /> : null}
      {org.history.length > 0 ? <OrgHistory lines={org.history} /> : null}
    </div>
  );
}
