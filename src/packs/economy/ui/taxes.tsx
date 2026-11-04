// An organization's Taxes tab in Orgs (ORG-SPEC §3.11, §4.4; `r.orgTab`, the economy's `taxes`
// section): how its income is taxed (a corporation pays its own; a pass-through company's profit is
// taxed to the people at the top, each with their share, through any companies between, and an
// organization at the top pays none), a change of structure waiting for the next estimated-tax
// period, what falls due next, and this year and last: sales tax collected, remitted and held,
// payroll withholding and its own share, income tax and property tax. GM → Orgs draws the same.

import { STRUCTURE_WORDS, type TaxesView, type TaxYearView } from "../../../shared/finance";
import { DEFAULT_CURRENCY, formatMoney, type WorldCurrency } from "../../../shared/world";
import { Empty, JsonView, List, ListRow, Row, Section } from "../../../frontend/components";
import type { OrgGmTabProps, OrgTabProps } from "../../../frontend/registry";
import { decodeTaxes } from "./decode";

/** A year's lines, each where it holds anything; the sales tax held only for this year. */
function yearRows(y: TaxYearView, held: number | null): { k: string; cents: number }[] {
  return [
    { k: "Sales tax collected", cents: y.salesCollected },
    { k: "Sales tax remitted", cents: y.salesRemitted },
    ...(held !== null ? [{ k: "Sales tax held, to remit", cents: held }] : []),
    { k: "Withheld from its staff's pay", cents: y.withheld },
    { k: "Its own share of payroll tax", cents: y.employerShare },
    { k: "Income tax paid", cents: y.income },
    { k: "Property tax", cents: y.property },
  ].filter((r) => r.cents !== 0);
}

/** An organization's Taxes, from its section. */
export function OrgTaxes(props: { section: TaxesView; currency: WorldCurrency }) {
  const { section, currency } = props;
  const money = (cents: number): string => formatMoney(cents, currency);
  return (
    <div class="lre-stack" data-lre-org-taxes>
      {section.income !== null ? (
        <Section title="Income tax">
          <div class="lre-stack" data-lre-taxes-income={section.income}>
            {section.income === "corporate" ? (
              <Row k="It pays corporate income tax" v={section.incomeSoFar !== null ? money(section.incomeSoFar) : undefined} sub="on this year's profit so far, and what its pass-through companies pass up to it" />
            ) : (
              <Row k="Taxed to its owners" sub="its profit is their income, through any companies between, in their estimated tax" />
            )}
            {section.pending ? <span data-lre-taxes-pending>{`Taxed as ${STRUCTURE_WORDS[section.pending.structure] ?? section.pending.structure} from ${section.pending.from}.`}</span> : null}
          </div>
          {section.taxedTo.length > 0 || section.untaxed.length > 0 ? (
            <List>
              {section.taxedTo.map((t) => (
                <ListRow key={`to:${t.name}`} icon="user" title={t.name} subtitle="pays tax on its share" value={`${Math.round(t.share * 100) / 100}%`} />
              ))}
              {section.untaxed.map((t) => (
                <ListRow key={`no:${t.name}`} icon="briefcase" title={t.name} subtitle="no one pays tax on this share" value={`${Math.round(t.share * 100) / 100}%`} valueTone="warn" />
              ))}
            </List>
          ) : null}
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

export function OrgTaxesTab(props: OrgTabProps) {
  const section = decodeTaxes(props.section);
  if (!section) return <JsonView value={props.section} />;
  return <OrgTaxes section={section} currency={props.state.currency ?? DEFAULT_CURRENCY} />;
}

export function GmOrgTaxesTab(props: OrgGmTabProps) {
  const section = decodeTaxes(props.section);
  if (!section) return <JsonView value={props.section} />;
  return <OrgTaxes section={section} currency={props.gm.currency} />;
}
