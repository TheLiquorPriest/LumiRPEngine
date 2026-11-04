// Money → Credit (DESIGN §25, ORG-SPEC §5.1): the credit score with its band (its history, its
// parts, and the report on its own page in the full books) and the credit an application can ask
// for, each offer opening its Apply page. The player applies for credit, an in-world action.

import { SCORE_MAX, SCORE_MIN, type FinanceView } from "../../../shared/finance";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Badge, Empty, List, ListRow, Meter, Section } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { AmountPage } from "./forms";
import type { SectionProps, SegmentProps } from "./hub";
import { creditBlocks } from "./layout";
import { actionPage, Hero, MoneyPage, sectionPage, type HubPages } from "./nav";
import { applyCreditAction } from "./requests";

type Offer = NonNullable<FinanceView["credit"]>["offers"][number];

/** A 0–1 score part as a percentage. */
function pct(part: number): string {
  return `${Math.round(part * 100)}%`;
}

/** An offer as a row: the credit, its kind, its rate and its most; `onOpen` opens its Apply page. */
function OfferRow(props: { offer: Offer; currency: WorldCurrency; onOpen?(): void }) {
  const o = props.offer;
  return <ListRow title={o.label} subtitle={[humanize(o.class), o.aprPct !== null ? `${o.aprPct}% APR` : null, o.limit !== null ? `up to ${formatMoney(o.limit, props.currency)}` : null].filter((s) => s !== null).join(" · ")} chevron={props.onOpen !== undefined} onClick={props.onOpen} />;
}

/** Credit: the score with its band and rates, its history and what makes it in the full books, the report's row, and the credit the player could apply for. */
export function CreditSegment(props: SegmentProps) {
  const { view, controls, nav } = props;
  const c = view.credit;
  if (!c) return <Empty icon="pulse">No credit report.</Empty>;
  const blocks = creditBlocks(view);
  const sub = [c.band, c.tier ? `${humanize(c.tier)} rates` : null].filter((s) => s !== null).join(" · ");
  return (
    <>
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
            <ListRow icon="scroll" title="Report" subtitle={`${c.onTimePct}% on time · ${c.accounts.length} ${c.accounts.length === 1 ? "account" : "accounts"}`} badge={c.marks.length > 0 ? <Badge tone="neg">{`${c.marks.length} ${c.marks.length === 1 ? "mark" : "marks"}`}</Badge> : undefined} chevron onClick={() => nav.open(sectionPage("credit", "report"))} />
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
    </>
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

/** Credit's pages: the report and an offer's Apply page. What the view doesn't hold, or the mode may not do, draws nothing (gone). */
export const creditPages: HubPages = {
  heads: ["credit"],
  render(page, props) {
    const { view, controls, nav } = props;
    const [, id, inner] = page.path;
    if (id === "report") return page.type === "section" ? <ReportPage {...props} /> : null;
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
