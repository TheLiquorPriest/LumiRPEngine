// Money → Credit and Household (DESIGN §25): the credit score with its band (its history, its
// parts, and the report on its own page in the full books) and the credit an application can ask
// for, each offer opening its Apply page; a household's members, shares, shared accounts and
// shared costs, each cost opening its flow's page. The player applies for credit (an in-world
// action) and handles the shared flows they may; the GM adds and takes out household members, and
// puts a person who has none in a household.

import { useState } from "preact/hooks";
import { SCORE_MAX, SCORE_MIN, type FinanceView } from "../../../shared/finance";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Badge, Button, Empty, List, ListRow, Meter, Section } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { FlowListRow } from "./flows";
import { ActionPage, AmountPage, ChoiceField, SelectField } from "./forms";
import type { SectionProps } from "./hub";
import { creditBlocks, gmParties, householdRows, possessive, sharedAccounts } from "./layout";
import { actionPage, Controls, Hero, MoneyPage, Note, type HubPage, type HubPages } from "./nav";
import { applyCreditAction } from "./requests";

type Offer = NonNullable<FinanceView["credit"]>["offers"][number];

/** The credit report: a page of the Credit section, not a thing of the world, so opening it observes nothing. */
const REPORT: HubPage = { type: "section", path: ["credit", "report"] };

/** A 0–1 score part as a percentage. */
function pct(part: number): string {
  return `${Math.round(part * 100)}%`;
}

/** An offer as a row: the credit, its kind, its rate and its most; `onOpen` opens its Apply page. */
function OfferRow(props: { offer: Offer; currency: WorldCurrency; onOpen?(): void }) {
  const o = props.offer;
  return <ListRow title={o.label} subtitle={[humanize(o.class), o.aprPct !== null ? `${o.aprPct}% APR` : null, o.limit !== null ? `up to ${formatMoney(o.limit, props.currency)}` : null].filter((s) => s !== null).join(" · ")} chevron={props.onOpen !== undefined} onClick={props.onOpen} />;
}

// ---------------------------------------------------------------- credit

function CreditSection(props: SectionProps) {
  const { view, controls, nav } = props;
  const c = view.credit;
  if (!c) {
    return (
      <MoneyPage nav={nav} name="credit" title="Credit">
        <Empty icon="pulse">No credit report.</Empty>
      </MoneyPage>
    );
  }
  const blocks = creditBlocks(view);
  const sub = [c.band, c.tier ? `${humanize(c.tier)} rates` : null].filter((s) => s !== null).join(" · ");
  return (
    <MoneyPage nav={nav} name="credit" title="Credit">
      <Hero label="Credit score" value={c.score !== null ? String(c.score) : "No score yet"} sub={sub === "" ? undefined : sub} badges={c.asOf ? <Badge>{`as of ${c.asOf}`}</Badge> : undefined}>
        {c.score !== null ? <Meter label={`On a scale of ${SCORE_MIN} to ${SCORE_MAX}`} value={c.score} min={SCORE_MIN} max={SCORE_MAX} /> : null}
      </Hero>
      {blocks.history > 0 && c.history.length > 0 ? (
        <Section title="History" flush>
          <List>
            {c.history.slice(-blocks.history).map((h) => (
              <ListRow key={h.at} title={h.at} value={String(h.score)} />
            ))}
          </List>
        </Section>
      ) : null}
      {blocks.factors && c.factors ? (
        <Section title="What makes it" flush>
          <List>
            <ListRow title="Paying on time" value={pct(c.factors.payment)} />
            <ListRow title="Credit used" subtitle={`${c.utilisationPct}% of limits`} value={pct(c.factors.utilisation)} />
            <ListRow title="Age of accounts" subtitle={`${c.ageMonths} months on average`} value={pct(c.factors.age)} />
            <ListRow title="Mix of credit" value={pct(c.factors.mix)} />
            <ListRow title="New credit" value={pct(c.factors.recent)} />
          </List>
        </Section>
      ) : null}
      {blocks.report ? (
        <Section flush>
          <List>
            <ListRow icon="scroll" title="Report" subtitle={`${c.onTimePct}% on time · ${c.accounts.length} ${c.accounts.length === 1 ? "account" : "accounts"}`} badge={c.marks.length > 0 ? <Badge tone="neg">{`${c.marks.length} ${c.marks.length === 1 ? "mark" : "marks"}`}</Badge> : undefined} chevron onClick={() => nav.open(REPORT)} />
          </List>
        </Section>
      ) : null}
      {c.offers.length > 0 ? (
        <Section title={controls.mode === "player" ? "Credit you could apply for" : "Credit they could apply for"} flush>
          <List>
            {c.offers.map((o) => (
              <OfferRow key={o.product} offer={o} currency={controls.currency} onOpen={controls.mode === "player" ? () => nav.open(actionPage("credit", "apply", o.product)) : undefined} />
            ))}
          </List>
        </Section>
      ) : null}
    </MoneyPage>
  );
}

/** The credit report, in the full books: on-time share, each account with its use and late payments, the inquiries and the marks. */
function ReportPage(props: SectionProps) {
  const { view, controls, nav } = props;
  const c = view.credit;
  if (!c || !creditBlocks(view).report) return null;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  return (
    <MoneyPage nav={nav} name="credit-report" title="Credit report" subtitle={c.asOf ? `as of ${c.asOf}` : undefined}>
      <Section flush>
        <List>
          <ListRow icon="check" title="On time" value={`${c.onTimePct}%`} />
          {c.accounts.map((a) => (
            <ListRow key={a.id} title={a.name} subtitle={[humanize(a.class), humanize(a.status), a.opened ? `opened ${a.opened}` : null, a.late30 + a.late60 + a.late90 > 0 ? `late ${a.late30}×30 ${a.late60}×60 ${a.late90}×90` : null].filter((s) => s !== null).join(" · ")} value={a.limit !== null ? `${fmt(a.owed)} of ${fmt(a.limit)}` : fmt(a.owed)} />
          ))}
        </List>
      </Section>
      {c.inquiries.length > 0 ? (
        <Section title="Inquiries" flush>
          <List>
            {c.inquiries.map((i, n) => (
              <ListRow key={`${i.at}:${n}`} title={i.note} subtitle={i.at} />
            ))}
          </List>
        </Section>
      ) : null}
      {c.marks.length > 0 ? (
        <Section title="Marks" flush>
          <List>
            {c.marks.map((m, n) => (
              <ListRow key={`${m.at}:${n}`} icon="alert" title={humanize(m.kind)} subtitle={`${m.at} · ${m.note}`} />
            ))}
          </List>
        </Section>
      ) : null}
    </MoneyPage>
  );
}

// ---------------------------------------------------------------- household

function HouseholdSection(props: SectionProps) {
  const { view, controls, nav } = props;
  const h = view.household;
  if (!h) {
    // Where households don't run, none shows, even for someone who is in one: so the page says that, and offers no household to join.
    const runs = view.features.includes("households");
    return (
      <MoneyPage nav={nav} name="household" title="Household">
        {controls.mode === "gm" && view.partyKind === "person" && runs ? (
          <Button variant="primary" icon="user-plus" block onClick={() => nav.open(actionPage("household", "join"))}>
            Add to a household
          </Button>
        ) : null}
        <Empty icon="users">{runs ? "No household." : "Households don't run at this Money level."}</Empty>
      </MoneyPage>
    );
  }
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  // The household's own accounts are the GM's to name; the player sees how many there are.
  const shared = sharedAccounts(view, h);
  const others = controls.mode === "gm" ? shared.others.map((id) => controls.gm.entities.find((e) => e.id === id)?.name ?? id) : shared.others.length > 0 ? [`${shared.others.length} the household holds`] : [];
  return (
    <MoneyPage nav={nav} name="household" title={h.name} subtitle="Household">
      <Hero label="Shared costs a month" value={fmt(h.monthly.total)} />
      {controls.mode === "gm" ? (
        <Controls name={h.id}>
          <Button icon="user-plus" onClick={() => nav.open(actionPage("household", "add"))}>
            Add a member
          </Button>
          {h.members.some((m) => m.id !== null) ? (
            <Button variant="danger" icon="close" onClick={() => nav.open(actionPage("household", "remove"))}>
              Remove a member
            </Button>
          ) : null}
        </Controls>
      ) : null}
      <Section title="Members" flush>
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
            <ListRow icon="bank" title="Shared accounts" value={[...shared.names, ...others].join(", ")} />
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
    </MoneyPage>
  );
}

/** The GM adds a person in the world to the household (`member_of`), one edit. */
function AddMemberPage(props: SectionProps) {
  const { view, controls, nav } = props;
  const [adding, setAdding] = useState("");
  const h = view.household;
  if (controls.mode !== "gm" || !h) return null;
  const candidates = gmParties(controls.gm, ["person"]).filter((p) => !h.members.some((m) => m.id === p.id));
  return (
    <ActionPage nav={nav} controls={controls} name="household-add" title="Add a member" subtitle={h.name} go="Add" disabled={adding === ""} submit={() => controls.edit([{ op: "link", rel: "member_of", from: adding, to: h.id }])}>
      <SelectField label="Who" value={adding} empty="Choose someone" options={candidates.map((p) => ({ value: p.id, label: p.name }))} onChange={setAdding} />
    </ActionPage>
  );
}

/** The GM puts a person who lives in no household into one (`member_of`), one edit. */
function JoinHouseholdPage(props: SectionProps) {
  const { view, controls, nav } = props;
  const [joining, setJoining] = useState("");
  if (controls.mode !== "gm" || view.household !== null || view.partyKind !== "person" || !view.features.includes("households")) return null;
  const households = gmParties(controls.gm, ["household"]).map((p) => ({ value: p.id, label: p.name }));
  return (
    <ActionPage nav={nav} controls={controls} name="household-join" title="Add to a household" subtitle={view.name} go="Add" disabled={joining === ""} submit={() => controls.edit([{ op: "link", rel: "member_of", from: view.party, to: joining }])}>
      {households.length > 0 ? <SelectField label="Household" value={joining} empty="Choose a household" options={households} onChange={setJoining} /> : <Note>The world has no household yet.</Note>}
    </ActionPage>
  );
}

/** The GM takes a member out of the household (`member_of`), one edit; someone the view doesn't name can't be picked. */
function RemoveMemberPage(props: SectionProps) {
  const { view, controls, nav } = props;
  const [leaving, setLeaving] = useState("");
  const h = view.household;
  const members = (h?.members ?? []).flatMap((m) => (m.id === null ? [] : [{ id: m.id, name: m.name, role: m.role }]));
  if (controls.mode !== "gm" || !h || members.length === 0) return null;
  const who = members.find((m) => m.id === leaving);
  return (
    <ActionPage nav={nav} controls={controls} name="household-remove" title="Remove a member" subtitle={h.name} go="Remove" danger disabled={!who} submit={() => controls.edit([{ op: "unlink", rel: "member_of", from: leaving, to: h.id }])}>
      <ChoiceField label="Who" value={leaving} options={members.map((m) => ({ value: m.id, label: m.name, detail: m.role ? humanize(m.role) : undefined }))} onChange={setLeaving} />
      {who ? <Note>{`${who.name} no longer shares ${possessive(h.name, true)} costs.`}</Note> : null}
    </ActionPage>
  );
}

/** Credit's and the household's pages: each section, the report, an offer's Apply page and the GM's member changes, a person's household among them. What the view doesn't hold, or the mode may not do, draws nothing (gone). */
export const creditPages: HubPages = {
  heads: ["credit", "household"],
  render(page, props) {
    const { view, controls, nav } = props;
    const [head, id, inner] = page.path;
    if (head === "household") return id === undefined ? <HouseholdSection {...props} /> : id === "add" ? <AddMemberPage {...props} /> : id === "remove" ? <RemoveMemberPage {...props} /> : id === "join" ? <JoinHouseholdPage {...props} /> : null;
    if (head !== "credit") return null;
    if (id === undefined) return <CreditSection {...props} />;
    if (id === "report") return <ReportPage {...props} />;
    const offer = id === "apply" ? view.credit?.offers.find((o) => o.product === inner) : undefined;
    if (!offer || controls.mode !== "player") return null;
    return (
      <AmountPage nav={nav} controls={controls} name="credit-apply" title="Apply" subtitle={offer.label} label="How much" go="Apply" optional="What they offer" submit={(cents) => controls.act(applyCreditAction(offer.product, cents))}>
        <Section flush>
          <List>
            <OfferRow offer={offer} currency={controls.currency} />
          </List>
        </Section>
      </AmountPage>
    );
  },
};
