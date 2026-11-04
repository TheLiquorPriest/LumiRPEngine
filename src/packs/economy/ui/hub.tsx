// A party's money (DESIGN §12, §25; ORG-SPEC §5): its segments, Summary · Accounts · In & out ·
// Books · Assets · Credit, each where the party has something there, under a row of them. Play →
// Me → Money shows the POV's own, with in-world actions as controls; an organization's Money tab
// in Orgs shows the organization's own, read only until people act as it (§3.6), though what it
// shares with the POV (an account they hold, a business they run) opens the POV's own page with
// their controls; GM → Money shows a person's, and GM → Orgs an organization's, with edits. All
// draw the same `FinanceView`, which the core built at the party's Money level: a band at level 1,
// the simple books below the top level, and everything at the top level; a feature the world
// switches on shows its own detail wherever it runs, and one it switches off shows nowhere.

import type { ComponentChildren } from "preact";
import type { FinanceView, UpcomingLine } from "../../../shared/finance";
import type { EditOp } from "../../../shared/protocol";
import type { GmView, PaletteView } from "../../../shared/state-view";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Badge, Banner, Button, Empty, List, ListRow, Section, Stat, Tabs, tabPanel } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { AccountsSegment } from "./accounts";
import { AssetsSegment } from "./assets";
import { CreditSegment } from "./credit";
import { InOutSegment } from "./inout";
import { comingUp, findFlow, moneySegments, overviewBlocks, ownBusiness, SUMMARY_ALERTS, type ActivityFilter, type MoneySegment } from "./layout";
import { detailPage, Hero, MoneyPage, sectionPage, type HubNav, type HubPage, type HubPages } from "./nav";
import type { ActionBody } from "./requests";
import { BooksSegment } from "./work";

/**
 * How a party's money pages reach the backend. The player's are in-world actions (`lre.action`): a
 * money or organization action is done at once, off screen, with its Undo (DESIGN §11), told to the
 * next reply or not as its confirm step's Tell switch says (`tell`; absent, as Settings → Narrator →
 * Out-of-play actions has it); the GM's are edits (`lre.edit`, each one correction with its own
 * Undo); an organization's own money in Play has none of its own yet (`read`). A page offers only
 * the controls of its mode.
 */
export type HubControls =
  | { mode: "player"; busy: boolean; currency: WorldCurrency; act(body: ActionBody, tell?: boolean): Promise<boolean>; palette: PaletteView | null }
  | { mode: "gm"; busy: boolean; currency: WorldCurrency; edit(ops: EditOp[]): Promise<boolean>; gm: GmView }
  | { mode: "read"; busy: false; currency: WorldCurrency };

/** The GM's controls, when the money is the GM's to edit. */
export type GmControls = Extract<HubControls, { mode: "gm" }>;
export type PlayerControls = Extract<HubControls, { mode: "player" }>;

/**
 * The POV's own money and controls, beside an organization's own money in Play: what the two share
 * opens the POV's own page, and the POV's own controls on the organization (issuing its invoices,
 * say) show on its pages.
 */
export interface Reader {
  view: FinanceView;
  controls: PlayerControls;
}

/** What every page of a party's money gets: the party's view, the controls of its mode, the navigator, and on an organization's money in Play the POV's own (`reader`). */
export interface SectionProps {
  view: FinanceView;
  controls: HubControls;
  nav: HubNav;
  reader?: Reader | null;
}

/** What the segments get besides: the one chosen, Activity's filter, the world's clock and whether the Garage shows, each kept by the frame that draws them. */
export interface HubFrame {
  segment: MoneySegment;
  onSegment(segment: MoneySegment): void;
  filter: ActivityFilter;
  onFilter(filter: ActivityFilter): void;
  /** The HUD clock's minutes, which Coming up looks a week ahead of; null without one. */
  now: number | null;
  /** Whether Play's Garage shows, which Assets' vehicles open. */
  garage: boolean;
  /** The id the segments' panel goes by, for its row of tabs. */
  panelId: string;
}

export type SegmentProps = SectionProps & HubFrame;

/**
 * The page a money line names (an alert, something coming up): its flow's when the view holds the
 * flow (the party's own, a property's running costs, a household's shared costs), else its
 * account's; null when it names neither, and the line opens nothing.
 */
export function lineTarget(view: FinanceView, flow: string | null | undefined, account: string | null | undefined): { page: HubPage; name: string } | null {
  const f = flow ? findFlow(view, flow) : null;
  if (f) return { page: detailPage("flow", f.id), name: f.label };
  const a = account ? view.accounts.find((x) => x.id === account) : undefined;
  return a ? { page: detailPage("account", a.id), name: a.name } : null;
}

/**
 * What's coming up, as its row shows the amount: signed, in the world's money. A 0 is either money
 * that stays the party's own (a transfer between its accounts), shown muted at the flow's amount,
 * or an amount the engine can't know ahead (a payroll, a day's sales), whose flow's words stand in
 * for it at a reading size; a 0 the view holds no flow for shows as it is.
 */
export function upcomingValue(view: FinanceView, u: UpcomingLine, currency: WorldCurrency): { value: ComponentChildren; tone?: "pos" | "neg" | "muted" } {
  const f = u.cents === 0 && u.flow ? findFlow(view, u.flow) : null;
  if (f && f.cents !== null) return { value: formatMoney(f.cents, currency), tone: "muted" };
  if (f) return { value: <span class="lre-money-row-words">{f.amount}</span> };
  return { value: `${u.cents > 0 ? "+" : ""}${formatMoney(u.cents, currency)}`, tone: u.cents < 0 ? "neg" : "pos" };
}

/** An alert as a banner, with Open where it names a page. */
function AlertBanner(props: { view: FinanceView; nav: HubNav; alert: NonNullable<FinanceView["overview"]>["alerts"][number] }) {
  const { alert: a, nav } = props;
  const target = lineTarget(props.view, a.flow, a.account);
  return (
    <Banner
      tone={a.tone}
      actions={
        target ? (
          <Button variant="ghost" size="sm" iconAfter="chevron-right" label={`Open ${target.name}`} onClick={() => nav.open(target.page)}>
            Open
          </Button>
        ) : undefined
      }
    >
      {a.text}
    </Banner>
  );
}

/**
 * Summary: net worth as a large figure (a band at Money 1; a household's own money, its shared
 * costs a month), cash on hand, assets and what's owed; the first alerts and All alerts; what's due
 * within the week; where a business trades; money in and out over the last 30 days, by category in
 * the full books, with the next 30 days; and for the GM, the notes and the person's organizations.
 */
function SummarySegment(props: SegmentProps) {
  const { view, controls, nav } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const o = view.overview;
  const blocks = overviewBlocks(view);
  const level = <Badge>{view.detail ? `Money ${view.level} · full books` : `Money ${view.level}`}</Badge>;
  const cash = view.cash && "cents" in view.cash ? view.cash.cents : null;
  const netWorth = o && o.netWorth !== null ? o.netWorth : null;
  const assets = blocks.assets && o && o.assets !== null ? o.assets : null;
  const owed = blocks.assets && o && o.liabilities !== null && o.liabilities !== 0 ? o.liabilities : null;
  // A household's own money with no account of its own leads with what its members share.
  const shared = view.household !== null && view.household.id === view.party && netWorth === null ? view.household : null;
  // Cash on hand leads only where there's neither a net worth nor a band to lead with.
  const cashLeads = netWorth === null && !view.band && cash !== null;
  const stats =
    (cash !== null && !cashLeads) || assets !== null || owed !== null ? (
      <div class="lre-money-stats">
        {cash !== null && !cashLeads ? <Stat label="Cash on hand" value={fmt(cash)} tone={cash < 0 ? "neg" : undefined} /> : null}
        {assets !== null ? <Stat label="Assets" value={fmt(assets)} /> : null}
        {owed !== null ? <Stat label="Owed" value={fmt(-Math.abs(owed))} tone="neg" /> : null}
      </div>
    ) : null;
  const alerts = o?.alerts ?? [];
  const soon = comingUp(view, props.now);
  const places = ownBusiness(view)?.places ?? [];
  // Their organizations: the businesses they hold a role on and their household, each in GM → Orgs.
  const theirs = controls.mode === "gm" && view.partyKind === "person" ? [...view.businesses.map((b) => ({ id: b.id, name: b.name, role: b.role ? humanize(b.role) : null })), ...(view.household ? [{ id: view.household.id, name: view.household.name, role: "Household" }] : [])] : [];
  return (
    <>
      {!view.opened ? (
        <Banner tone="info" title="Not opened yet">
          These are the opening balances the accounts start from.
        </Banner>
      ) : null}
      <div class="lre-money-top" data-lre-money-overview>
        {netWorth !== null ? (
          <Hero label="Net worth" value={fmt(netWorth)} tone={netWorth < 0 ? "neg" : undefined} sub={view.band ? `Wealth: ${view.band}` : undefined} badges={level}>
            {stats}
          </Hero>
        ) : shared ? (
          <Hero label="Shared costs a month" value={fmt(shared.monthly.total)} sub={view.band ? `Wealth: ${view.band}` : undefined} badges={level}>
            {stats}
          </Hero>
        ) : view.band ? (
          <Hero label="Wealth" value={humanize(view.band)} badges={level}>
            {stats}
          </Hero>
        ) : cash !== null ? (
          <Hero label="Cash on hand" value={fmt(cash)} tone={cash < 0 ? "neg" : undefined} badges={level}>
            {stats}
          </Hero>
        ) : (
          <span class="lre-money-hero-badges">{level}</span>
        )}
      </div>
      {alerts.slice(0, SUMMARY_ALERTS).map((a, i) => (
        <AlertBanner key={`${a.text}:${i}`} view={view} nav={nav} alert={a} />
      ))}
      {alerts.length > SUMMARY_ALERTS ? (
        <Section flush>
          <List>
            <ListRow icon="alert" title="All alerts" value={String(alerts.length)} chevron onClick={() => nav.open(sectionPage("alerts"))} />
          </List>
        </Section>
      ) : null}
      {soon.length > 0 ? (
        <Section title="Coming up" flush>
          <List>
            {soon.map((u, i) => {
              const target = lineTarget(view, u.flow, u.account);
              const amount = upcomingValue(view, u, controls.currency);
              return <ListRow key={`${u.clock}:${i}`} icon="calendar" title={u.label} subtitle={u.at} value={amount.value} valueTone={amount.tone} chevron={target !== null} onClick={target ? () => nav.open(target.page) : undefined} />;
            })}
          </List>
        </Section>
      ) : null}
      {places.length > 0 ? (
        <Section flush>
          <List>
            <ListRow icon="pin" title="Trades at" value={places.map((p) => p.name).join(", ")} />
          </List>
        </Section>
      ) : null}
      {o && o.cashFlow ? (
        <Section title={`Cash flow · ${o.cashFlow.period}`} flush>
          <List>
            <ListRow icon="download" title="Money in" value={fmt(o.cashFlow.in)} valueTone="pos" />
            <ListRow icon="upload" title="Money out" value={fmt(-Math.abs(o.cashFlow.out))} valueTone="neg" />
            {blocks.cashFlowByCategory ? o.cashFlow.byCategory.map((b) => <ListRow key={b.category} title={humanize(b.category)} value={fmt(b.cents)} valueTone={b.cents < 0 ? "neg" : "pos"} />) : null}
            {blocks.cashFlowAhead ? <ListRow icon="calendar" title="The next 30 days" subtitle={`${fmt(o.cashFlow.nextIn)} coming in`} value={fmt(-Math.abs(o.cashFlow.nextOut))} valueTone="neg" /> : null}
          </List>
        </Section>
      ) : null}
      {controls.mode === "gm" && view.notes.length > 0 ? (
        <Section title="Notes" flush>
          <List>
            {view.notes.map((n, i) => (
              <ListRow key={`${n.at}:${i}`} title={n.text} subtitle={n.at} />
            ))}
          </List>
        </Section>
      ) : null}
      {theirs.length > 0 ? (
        <Section title="Their organizations" flush>
          <div data-lre-money-orgs>
            <List>
              {theirs.map((org) => (
                <ListRow key={org.id} icon="briefcase" title={org.name} subtitle={org.role ?? undefined} id={org.id} chevron onClick={() => nav.elsewhere({ org: org.id })} />
              ))}
            </List>
          </div>
        </Section>
      ) : null}
    </>
  );
}

/** Every alert, each with Open where it names a page. */
function AlertsPage(props: SectionProps) {
  const { view, nav } = props;
  const alerts = view.overview?.alerts ?? [];
  return (
    <MoneyPage nav={nav} name="alerts" title="Alerts" subtitle={view.name}>
      {alerts.length === 0 ? <Empty icon="check">Nothing needs looking at.</Empty> : alerts.map((a, i) => <AlertBanner key={`${a.text}:${i}`} view={view} nav={nav} alert={a} />)}
    </MoneyPage>
  );
}

/** Summary's own page: every alert. */
export const summaryPages: HubPages = {
  heads: ["alerts"],
  render(page, props) {
    return page.type === "section" && page.path.length === 1 ? <AlertsPage {...props} /> : null;
  },
};

const SEGMENT: Readonly<Record<MoneySegment, (props: SegmentProps) => ComponentChildren>> = {
  summary: SummarySegment,
  accounts: AccountsSegment,
  in_out: InOutSegment,
  books: BooksSegment,
  assets: AssetsSegment,
  credit: CreditSegment,
};

/**
 * One party's money: a row of its segments (none when there's only one), then the segment chosen,
 * Summary when the one chosen isn't there. Without hooks: the frame that draws it keeps the
 * segment, Activity's filter and the panel's id.
 */
export function MoneyHub(props: SegmentProps) {
  const { view, controls } = props;
  const segments = moneySegments(view, controls.mode);
  if (segments.length === 0) return <Empty icon="coins">Money is off for {view.name}.</Empty>;
  const current = segments.find((s) => s.id === props.segment)?.id ?? "summary";
  const Body = SEGMENT[current];
  return (
    <div class="lre-money-hub" data-lre-money-hub={view.party}>
      {segments.length > 1 ? (
        <div class="lre-money-segments" data-lre-money-segments>
          <Tabs<MoneySegment> label={controls.mode === "player" ? "Your money" : `${view.name}: money`} panelId={props.panelId} value={current} tabs={segments} onChange={props.onSegment} />
        </div>
      ) : null}
      <div {...(segments.length > 1 ? tabPanel(props.panelId, current) : {})} class="lre-money-segment" data-lre-money-segment={current}>
        <Body {...props} />
      </div>
    </div>
  );
}
