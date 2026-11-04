// Money → In & out (ORG-SPEC §5.1): what comes in and goes out, under Money's one filter bar (In or
// Out, whose money it is, one account's). A person's Income, each job with its next payday and what
// it last paid, opening the job (its pay, payslip, deductions, where the pay goes, Quit); their
// standing payments by status, with New; the invoices billed to them, each opening its Pay now where
// they may pay it; their share of their household's costs, which opens the household in Orgs; and
// the accounts autopay runs on, each opening its autopay. A household's own money lists who pays
// what of its shared costs, its shared accounts and the costs; a business's own lists its trade
// among its standing payments, and the invoices it issued and is billed. Direction shows only what
// comes in or goes out; Whose and Account pick among the standing payments.

import { formatMoney } from "../../../shared/world";
import type { HouseholdView } from "../../../shared/finance";
import { Badge, Button, Empty, List, ListRow, Section } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { autopayText } from "./accounts";
import { FlowListRow, playerFlowControls, StandingPayments } from "./flows";
import type { SectionProps, SegmentProps } from "./hub";
import { accountControls, flowKept, householdRows, inOutChoices, invoicesToPay, ownBusiness, possessive, sharedAccounts, standingPayments } from "./layout";
import { MoneyFilters } from "./lines";
import { actionPage, detailPage } from "./nav";
import { IssuedInvoices, jobTitle } from "./work";

/** Income: each of a person's jobs, opening its page; the GM adds one here. */
function Income(props: SectionProps) {
  const { view, controls, nav } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  // The GM's Add a job, wherever what it adds would show (`hubTabs`).
  const adds = controls.mode === "gm" && view.partyKind === "person" && view.overview !== null;
  if (view.jobs.length === 0 && !adds) return null;
  return (
    <div class="lre-stack" data-lre-money-income>
      {adds ? (
        <Button variant="primary" icon="plus" block onClick={() => nav.open(actionPage("jobs", "new"))}>
          Add a job
        </Button>
      ) : null}
      <Section title="Income" flush>
        {view.jobs.length === 0 ? (
          <Empty icon="briefcase">No jobs.</Empty>
        ) : (
          <List>
            {view.jobs.map((j) => (
              <ListRow
                key={j.id}
                icon="briefcase"
                title={`${jobTitle(j)} at ${j.employer}`}
                subtitle={j.nextPay ? `Next payday ${j.nextPay}` : undefined}
                id={j.id}
                value={j.lastPay ? `${fmt(j.lastPay.net)} net` : j.pay}
                valueTone={j.lastPay ? "pos" : undefined}
                badge={j.status === "active" ? undefined : <Badge>{humanize(j.status)}</Badge>}
                chevron
                onClick={() => nav.open(detailPage("job", j.id))}
              />
            ))}
          </List>
        )}
      </Section>
    </div>
  );
}

/** The invoices billed to the party, each opening its Pay now where the player may pay it now, else the invoice's flow. */
function InvoicesToPay(props: SectionProps) {
  const { view, controls, nav } = props;
  const bills = invoicesToPay(view);
  if (bills.length === 0) return null;
  return (
    <Section title="Invoices to pay" flush>
      <List>
        {bills.map((f) => (
          <FlowListRow key={f.id} flow={f} nav={nav} onOpen={controls.mode === "player" && playerFlowControls(view, f).includes("pay_now") ? () => nav.open(actionPage("flow", f.id, "pay_now")) : undefined} />
        ))}
      </List>
    </Section>
  );
}

/**
 * A household's own money: who pays what of its shared costs a month, its shared accounts (those
 * the reader holds by name, the household's own by name, the rest counted, or named for the GM),
 * and the shared costs, each opening its flow.
 */
function SharedCosts(props: SectionProps & { household: HouseholdView }) {
  const { view, controls, nav, reader, household: h } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const shared = sharedAccounts(reader?.view ?? view, h);
  const named = shared.others.flatMap((id) => {
    const name = view.accounts.find((a) => a.id === id)?.name ?? (controls.mode === "gm" ? (controls.gm.entities.find((e) => e.id === id)?.name ?? id) : null);
    return name === null ? [] : [name];
  });
  const unnamed = shared.others.length - named.length;
  return (
    <div class="lre-stack" data-lre-money-shared={h.id}>
      <Section title="Who pays what" flush>
        {h.members.length === 0 ? (
          <Empty icon="users">No one lives here.</Empty>
        ) : (
          <List>
            {householdRows(h).map((m) => (
              <ListRow key={m.key} title={m.name} subtitle={[m.role ? humanize(m.role) : null, m.cents !== null ? `${fmt(m.cents)} a month` : null].filter((s) => s !== null).join(" · ") || undefined} value={m.share > 0 ? `${Math.round(m.share * 10) / 10}%` : undefined} />
            ))}
          </List>
        )}
      </Section>
      {h.accounts.length > 0 ? (
        <Section flush>
          <List>
            <ListRow icon="bank" title="Shared accounts" value={[...shared.names, ...named, ...(unnamed > 0 ? [`${unnamed} the household holds`] : [])].join(", ")} />
          </List>
        </Section>
      ) : null}
      <Section title="Shared costs" flush>
        {h.flows.length === 0 ? (
          <Empty icon="refresh">No shared costs.</Empty>
        ) : (
          <List>
            {h.flows.map((f) => (
              <FlowListRow key={f.id} flow={f} nav={nav} />
            ))}
          </List>
        )}
      </Section>
    </div>
  );
}

/** A person's household: their share of its costs a month, opening the household in Orgs; the GM's entry for a person in none, where households run, opens GM → Orgs to add them to one. */
function Household(props: SectionProps) {
  const { view, controls, nav } = props;
  const h = view.household;
  if (h) {
    const part = h.monthly.parts.find((p) => p.id === view.party)?.cents ?? null;
    return (
      <Section title="Household" flush>
        <div data-lre-money-household={h.id}>
          <List>
            <ListRow icon="users" title={h.name} subtitle={controls.mode === "player" ? "Your share of the shared costs" : `${possessive(view.name, false)} share of the shared costs`} id={h.id} value={part !== null ? `${formatMoney(part, controls.currency)} a month` : undefined} chevron onClick={() => nav.elsewhere({ org: h.id })} />
          </List>
        </div>
      </Section>
    );
  }
  if (controls.mode !== "gm" || view.partyKind !== "person" || view.overview === null || !view.features.includes("households")) return null;
  return (
    <Section title="Household" flush>
      <List>
        <ListRow icon="users" title="Not in a household" subtitle="Add them to one in GM → Orgs" chevron onClick={() => nav.elsewhere({ org: null })} />
      </List>
    </Section>
  );
}

/** The party's own accounts that autopay runs on, set or off, each opening its autopay where it may be changed, else its account. */
function Autopay(props: SectionProps) {
  const { view, controls, nav } = props;
  const accounts = view.accounts.flatMap((a) => (a.autopay !== null ? [{ account: a, autopay: a.autopay }] : []));
  if (accounts.length === 0) return null;
  return (
    <Section title="Autopay" flush>
      <List>
        {accounts.map(({ account: a, autopay }) => {
          const sets = controls.mode === "gm" || (controls.mode === "player" && accountControls(view, a).includes("autopay"));
          return <ListRow key={a.id} icon="refresh" title={a.name} subtitle={autopayText(autopay, controls.currency)} id={a.id} chevron onClick={() => nav.open(sets ? actionPage("account", a.id, "autopay") : detailPage("account", a.id))} />;
        })}
      </List>
    </Section>
  );
}

/** In & out, as the party's kind has it: a household's shared costs, a person's income and household, a business's invoices, and everyone's standing payments, bills and autopay, as the filter bar picks them. */
export function InOutSegment(props: SegmentProps) {
  const { view, filter } = props;
  const own = ownBusiness(view);
  const household = view.household !== null && view.household.id === view.party ? view.household : null;
  const choices = inOutChoices(view);
  const shows = (direction: "in" | "out"): boolean => filter.direction === "" || filter.direction === direction;
  // What isn't a standing payment is the party's own, on its own accounts: it shows while Whose and Account pick nothing else.
  const unpicked = filter.account === "" && (filter.whose === "" || filter.whose === view.party);
  return (
    <>
      {view.flows.length > 0 ? (
        <Section flush>
          <MoneyFilters filter={filter} onFilter={props.onFilter} whose={choices.whose} accounts={choices.accounts} />
        </Section>
      ) : null}
      {household && unpicked && shows("out") ? <SharedCosts {...props} household={household} /> : null}
      {view.partyKind === "person" && unpicked && shows("in") ? <Income {...props} /> : null}
      <StandingPayments {...props} flows={standingPayments(view).filter((f) => flowKept(f, filter))} />
      {unpicked && shows("out") ? <InvoicesToPay {...props} /> : null}
      {own && unpicked && shows("in") ? <IssuedInvoices {...props} business={own} /> : null}
      {view.partyKind === "person" && unpicked && shows("out") ? <Household {...props} /> : null}
      {unpicked && shows("out") ? <Autopay {...props} /> : null}
    </>
  );
}
