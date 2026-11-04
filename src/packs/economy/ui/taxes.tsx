// An organization's Taxes tab in Orgs (ORG-SPEC §3.11, §4.4; `r.orgTab`, the economy's `taxes`
// section): how its income is taxed (a corporation pays its own, or its parent's consolidated return
// files it; a pass-through company's profit is taxed to the people at the top, each with their share,
// through any companies between, and an organization at the top pays none, an exempt one by its
// exemption; an exempt organization pays none at all), its exempt status and whether gifts to it are
// deductible, a corporation's consolidated return (the corporations it includes, their combined
// profit and the tax on it, with File one or Stop), a change of structure waiting for the next
// estimated-tax period, its unemployment taxes' rates and wage bases, what falls due next, and this
// year and last: sales tax collected, remitted and held, payroll withholding and its own share, FUTA
// and SUTA accrued and paid, income tax, property tax and the donations it received. A reader gives
// to an exempt organization from here (Donate), and elects or ends a return, each played as a turn.
// GM → Orgs draws the same, with the GM's own status and election as GM edits.

import { useState } from "preact/hooks";
import { FINANCE_ACTIONS, STRUCTURE_WORDS, type ConsolidationView, type ExemptView, type TaxesView, type TaxYearView, type UnemploymentView } from "../../../shared/finance";
import type { EntityId } from "../../../shared/ids";
import { parseMoneyInput } from "../../../shared/money";
import { DEFAULT_CURRENCY, formatMoney, type WorldCurrency } from "../../../shared/world";
import { Button, Empty, JsonView, List, ListRow, Row, Section } from "../../../frontend/components";
import type { GmSectionProps, OrgGmTabProps, OrgTabProps } from "../../../frontend/registry";
import { decodeTaxes } from "./decode";
import { AmountField, SelectField } from "./forms";
import type { PlayerControls } from "./hub";
import { Controls } from "./nav";
import { usePlayerControls } from "./panel";

/** What the reader does from the Taxes tab, each played as a turn: elect or end a consolidated return, and give to the organization (true once the turn took it). */
export interface TaxesActs {
  busy: boolean;
  consolidate(elect: boolean): void;
  donate(cents: number): Promise<boolean>;
}

/** The GM's own changes from GM → Orgs → Taxes, each a GM edit: the exempt status (null: none) and the consolidated-return election. */
export interface TaxesGm {
  busy: boolean;
  status(status: string | null): void;
  consolidate(elect: boolean): void;
}

/** A share in percent, to two places. */
function share(n: number): string {
  return `${Math.round(n * 100) / 100}%`;
}

/** A tax rate in percent, as the tables write it (0.6%, 5.4%, 2.7%): the Taxes tab's and Payroll's. */
export function rate(n: number): string {
  return `${Math.round(n * 1000) / 1000}%`;
}

/** A year's lines, each where it holds anything; the sales tax held only for this year. */
function yearRows(y: TaxYearView, held: number | null): { k: string; cents: number }[] {
  return [
    { k: "Sales tax collected", cents: y.salesCollected },
    { k: "Sales tax remitted", cents: y.salesRemitted },
    ...(held !== null ? [{ k: "Sales tax held, to remit", cents: held }] : []),
    { k: "Withheld from its staff's pay", cents: y.withheld },
    { k: "Its own share of payroll tax", cents: y.employerShare },
    { k: "Federal unemployment tax (FUTA)", cents: y.futa },
    { k: "FUTA paid", cents: y.futaPaid },
    { k: "State unemployment tax (SUTA)", cents: y.suta },
    { k: "SUTA paid", cents: y.sutaPaid },
    { k: "Income tax paid", cents: y.income },
    { k: "Property tax", cents: y.property },
    { k: "Donations received", cents: y.donations },
  ].filter((r) => r.cents !== 0);
}

/** Its unemployment taxes' rates (ORG-SPEC §3.11, Phase 5): FUTA's net rate, with the gross rate, the credit for state tax and any credit reduction; SUTA's rate; each on its wage base. */
function UnemploymentRows(props: { rates: UnemploymentView; exempt: ExemptView | null; currency: WorldCurrency }) {
  const { futa, suta } = props.rates;
  const spared = props.exempt ? `its exempt status as ${props.exempt.name} spares it` : "the world's tables set no rate";
  return (
    <div class="lre-stack" data-lre-taxes-unemployment>
      {futa ? (
        <Row
          k="Federal unemployment tax (FUTA)"
          v={rate(futa.pct)}
          sub={[futa.creditPct > 0 ? `${rate(futa.grossPct)} less a ${rate(futa.creditPct)} credit for its state tax` : `${rate(futa.grossPct)}, with no credit: it pays no state unemployment tax`, futa.reductionPct > 0 ? `its state's ${rate(futa.reductionPct)} credit reduction due with the annual return` : null, `on the first ${formatMoney(futa.base, props.currency)} of each worker's pay a year`].filter((x) => x !== null).join("; ")}
        />
      ) : (
        <Row k="Federal unemployment tax (FUTA)" v="None" sub={spared} />
      )}
      {suta ? <Row k="State unemployment tax (SUTA)" v={rate(suta.pct)} sub={`on the first ${formatMoney(suta.base, props.currency)} of each worker's pay a year`} /> : <Row k="State unemployment tax (SUTA)" v="None" sub={spared} />}
    </div>
  );
}

/** A consolidated return (ORG-SPEC §3.11, Phase 5): elected or open to elect, the corporations it includes (or would) with the group's share of their votes and worth, and once elected the group's profit this year and the tax on it, where values show; with File one or Stop for whoever may, and the GM's own. */
function ConsolidationPart(props: { consolidation: ConsolidationView; why: string | null; currency: WorldCurrency; acts?: TaxesActs; gm?: TaxesGm }) {
  const c = props.consolidation;
  const label = c.elected ? "Stop filing one" : "File a consolidated return";
  return (
    <Section title="Consolidated return" flush>
      <div class="lre-stack" data-lre-taxes-consolidated={c.elected ? "elected" : "open"}>
        <Row k={c.elected ? "It files one consolidated return" : "It may file one consolidated return"} sub={c.elected ? "one federal return with the corporations below: their profits and losses offset, and it pays the group's tax; each state taxes its own" : "with the corporations below, which its group holds enough of by votes and by worth; until it does, each pays its own"} />
        {c.profit !== null ? <Row k="The group's profit this year" v={formatMoney(c.profit, props.currency)} sub="losses offset" /> : null}
        {c.tax !== null ? <Row k="The group's tax so far" v={formatMoney(c.tax, props.currency)} /> : null}
      </div>
      {c.members.length === 0 ? (
        <Empty icon="briefcase">No corporation it holds enough of to include.</Empty>
      ) : (
        <List>
          {c.members.map((m) => (
            <ListRow key={m.name} icon="briefcase" title={m.name} subtitle={`${share(m.votes)} of its votes`} value={share(m.share)} />
          ))}
        </List>
      )}
      {props.acts || props.gm ? (
        <Controls name="consolidate">
          {props.acts ? (
            <Button icon="layers" disabled={props.why !== null || props.acts.busy} onClick={() => props.acts?.consolidate(!c.elected)}>
              {label}
            </Button>
          ) : null}
          {props.gm ? (
            <Button icon="layers" disabled={props.gm.busy} onClick={() => props.gm?.consolidate(!c.elected)}>
              {`GM: ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
            </Button>
          ) : null}
        </Controls>
      ) : null}
      {props.acts && props.why !== null ? <span class="lre-field-help">{props.why}</span> : null}
    </Section>
  );
}

/** Donate: an amount from the reader, as they pay, to an exempt organization; deductible as its status says. Once the gift is played, the amount clears. */
export function DonateForm(props: { exempt: ExemptView; currency: WorldCurrency; acts: TaxesActs }) {
  const [amount, setAmount] = useState("");
  const cents = parseMoneyInput(amount, props.currency);
  const ok = cents !== null && cents > 0 && !props.acts.busy;
  return (
    <div class="lre-stack" data-lre-taxes-donate>
      <AmountField
        label="Amount to donate"
        value={amount}
        currency={props.currency}
        onInput={setAmount}
        invalid={amount.trim() !== "" && (cents === null || cents <= 0)}
        help={props.exempt.deductible ? "Deductible: it comes off your taxable income, and what that saves you is refunded each 15 April." : `Not deductible: a gift to a ${props.exempt.name.toLowerCase()} comes off no one's income tax.`}
      />
      <Button variant="primary" icon="heart" disabled={!ok} onClick={() => (ok && cents !== null ? void props.acts.donate(cents).then((done) => done && setAmount("")) : undefined)}>
        {ok && cents !== null ? `Donate ${formatMoney(cents, props.currency)}` : "Donate"}
      </Button>
    </div>
  );
}

/** GM → Orgs: the organization's exempt status, one of the world's exempt table's or none, as a GM edit. Keyed by the status in force, so a change from elsewhere (an Undo) shows. */
export function GmStatus(props: { statuses: readonly { id: string; name: string; code: string }[]; current: string; gm: TaxesGm }) {
  const [status, setStatus] = useState(props.current);
  return (
    <div class="lre-stack" data-lre-gm-tax-status>
      <SelectField
        label="GM: tax-exempt status"
        value={status}
        empty="Not exempt"
        options={props.statuses.map((s) => ({ value: s.id, label: s.code !== "" ? `${s.name} (${s.code})` : s.name }))}
        onChange={setStatus}
        help={props.statuses.length === 0 ? "The world's tables hold no exempt statuses: take the Data update for Tax-exempt organizations." : "Exempt, it pays no income tax and passes none to its owners, and owes FUTA and SUTA as its status says."}
      />
      <Button variant="primary" disabled={props.gm.busy || status === props.current} onClick={() => props.gm.status(status === "" ? null : status)}>
        Set the status
      </Button>
    </div>
  );
}

/** An organization's Taxes, from its section; with `acts` (Play) the reader's controls, with `gm` (GM → Orgs) the GM's. */
export function OrgTaxes(props: { section: TaxesView; currency: WorldCurrency; acts?: TaxesActs; gm?: TaxesGm }) {
  const { section, currency, acts, gm } = props;
  const money = (cents: number): string => formatMoney(cents, currency);
  const exempt = section.exempt;
  return (
    <div class="lre-stack" data-lre-org-taxes>
      {exempt || (gm && section.statuses) ? (
        <Section title="Tax-exempt">
          {exempt ? (
            <div class="lre-stack" data-lre-taxes-exempt={exempt.status}>
              <Row k="Exempt as" v={exempt.name} sub={exempt.code !== "" ? `IRC ${exempt.code}: it pays no income tax` : "it pays no income tax"} />
              <Row k="Donations to it" v={exempt.deductible ? "Deductible" : "Not deductible"} sub={exempt.deductible ? "a person's gifts come off their income tax" : "no one deducts a gift to it"} />
              <Row k="Unemployment taxes it owes" v={exempt.futa && exempt.suta ? "FUTA and SUTA" : exempt.suta ? "SUTA only" : exempt.futa ? "FUTA only" : "Neither"} />
            </div>
          ) : (
            <span class="lre-field-help">Not exempt: it pays its taxes as any organization does.</span>
          )}
          {gm && section.statuses ? <GmStatus key={exempt?.status ?? ""} statuses={section.statuses} current={exempt?.status ?? ""} gm={gm} /> : null}
        </Section>
      ) : null}
      {exempt && acts ? (
        <Section title="Donate">
          <DonateForm exempt={exempt} currency={currency} acts={acts} />
        </Section>
      ) : null}
      {section.income !== null ? (
        <Section title="Income tax">
          <div class="lre-stack" data-lre-taxes-income={section.income}>
            {section.income === "exempt" ? (
              <Row k="Exempt from income tax" sub="by its status: it pays none on its profit, and none passes to its owners" />
            ) : section.income === "corporate" ? (
              section.filedBy !== null ? (
                <Row k="Filed on a consolidated return" v={section.filedBy} sub="its parent's return pays the group's federal tax and its state tax: it pays none of its own while included" />
              ) : (
                <Row k="It pays corporate income tax" v={section.incomeSoFar !== null ? money(section.incomeSoFar) : undefined} sub="on this year's profit so far, and what its pass-through companies pass up to it" />
              )
            ) : (
              <Row k="Taxed to its owners" sub="its profit is their income, through any companies between, in their estimated tax" />
            )}
            {section.pending ? <span data-lre-taxes-pending>{`Taxed as ${STRUCTURE_WORDS[section.pending.structure] ?? section.pending.structure} from ${section.pending.from}.`}</span> : null}
          </div>
          {section.taxedTo.length > 0 || section.untaxed.length > 0 || section.exemptHolders.length > 0 ? (
            <List>
              {section.taxedTo.map((t) => (
                <ListRow key={`to:${t.name}`} icon="user" title={t.name} subtitle="pays tax on its share" value={share(t.share)} />
              ))}
              {section.untaxed.map((t) => (
                <ListRow key={`no:${t.name}`} icon="briefcase" title={t.name} subtitle="no one pays tax on this share" value={share(t.share)} valueTone="warn" />
              ))}
              {section.exemptHolders.map((t) => (
                <ListRow key={`ex:${t.name}`} icon="shield" title={t.name} subtitle="exempt: its exemption keeps this share untaxed" value={share(t.share)} />
              ))}
            </List>
          ) : null}
        </Section>
      ) : null}
      {section.consolidation ? <ConsolidationPart consolidation={section.consolidation} why={section.acts?.consolidate ?? null} currency={currency} {...(acts && section.acts ? { acts } : {})} {...(gm ? { gm } : {})} /> : null}
      {section.unemployment ? (
        <Section title="Unemployment taxes">
          <UnemploymentRows rates={section.unemployment} exempt={exempt} currency={currency} />
        </Section>
      ) : null}
      <Section title="Due next" flush>
        {section.due.length === 0 ? (
          <Empty icon="receipt">Nothing falls due.</Empty>
        ) : (
          <List>
            {section.due.map((d) => (
              <ListRow key={`${d.label}:${d.at}`} icon="receipt" title={d.label} subtitle={d.at} value={d.cents !== null ? money(d.cents) : undefined} />
            ))}
          </List>
        )}
      </Section>
      {section.years.map((y, i) => {
        const rows = yearRows(y, i === 0 ? section.salesHeld : null);
        return (
          <Section key={y.year} title={i === 0 ? `This year, ${y.year}` : `Last year, ${y.year}`}>
            {rows.length === 0 ? (
              <span class="lre-field-help">Nothing yet.</span>
            ) : (
              <div class="lre-stack" data-lre-taxes-year={y.year}>
                {rows.map((r) => (
                  <Row key={r.k} k={r.k} v={money(r.cents)} />
                ))}
              </div>
            )}
          </Section>
        );
      })}
    </div>
  );
}

/** The reader's Taxes controls on an organization, each sent as its in-world action, played as a turn: `tax_consolidate` and `donate`. */
export function taxesActs(org: EntityId, controls: Pick<PlayerControls, "busy" | "act">): TaxesActs {
  return {
    busy: controls.busy,
    consolidate: (elect) => void controls.act({ action: FINANCE_ACTIONS.consolidate, params: { org, elect: elect ? "yes" : "no" } }),
    donate: (cents) => controls.act({ action: FINANCE_ACTIONS.donate, params: { to: org, amount: cents } }),
  };
}

/** The GM's Taxes controls on an organization, each one GM edit of an org op: `tax_status` and `consolidate`. */
export function taxesGm(org: EntityId, gm: Pick<GmSectionProps, "busy" | "edit">): TaxesGm {
  return {
    busy: gm.busy,
    status: (status) => void gm.edit([{ op: "org", change: { do: "tax_status", org, status } }]),
    consolidate: (elect) => void gm.edit([{ op: "org", change: { do: "consolidate", org, elect } }]),
  };
}

/** Taxes in Play: the reader's controls (Donate, the consolidated-return election) each their in-world action. */
export function OrgTaxesTab(props: OrgTabProps) {
  const controls = usePlayerControls(props.chatId, props.state);
  const section = decodeTaxes(props.section);
  if (!section) return <JsonView value={props.section} />;
  return <OrgTaxes section={section} currency={props.state.currency ?? DEFAULT_CURRENCY} acts={taxesActs(props.org.id, controls)} />;
}

/** Taxes in GM → Orgs: as Play draws it, with the GM's own exempt status and consolidated-return election, each a GM edit. */
export function GmOrgTaxesTab(props: OrgGmTabProps) {
  const section = decodeTaxes(props.section);
  if (!section) return <JsonView value={props.section} />;
  return <OrgTaxes section={section} currency={props.gm.currency} gm={taxesGm(props.org.id, props.gm)} />;
}
