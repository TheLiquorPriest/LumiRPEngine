// The money hub (DESIGN §12, §25; contract D-UI9): one party's money. It opens on the overview (net
// worth as a large figure, cash on hand, alerts, what's coming up, recent lines, and at the levels
// that show them what it's made of and its cash flow), then a row for each of the party's other
// sections with a line from the view, which opens that section's page. The player's Play → Me →
// Money shows the POV's, with in-world actions as controls; the GM's Money tab shows anyone's,
// with edits. Both draw the same `FinanceView`, which the core built at the party's Money level: a
// band at level 1, the simple books below the top level, everything at the top level or where
// Custom turns a feature on.

import type { FinanceView } from "../../../shared/finance";
import type { EditOp } from "../../../shared/protocol";
import type { GmView, PaletteView } from "../../../shared/state-view";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Badge, Banner, Button, Empty, List, ListRow, Section, Stat } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import type { IconName } from "../../../frontend/icons";
import { hubTabs, overviewBlocks, SECTION_LABELS, type HubSection } from "./layout";
import { TxnRows } from "./lines";
import { detailPage, Hero, sectionPage, type HubNav, type HubPage } from "./nav";
import type { ActionBody } from "./requests";

/**
 * How the hub's controls reach the backend. The player's are in-world actions (`lre.action`,
 * played as a turn like any other); the GM's are edits (`lre.edit`, each one correction with its
 * own Undo). A section offers only the controls of its mode.
 */
export type HubControls =
  | { mode: "player"; busy: boolean; currency: WorldCurrency; act(body: ActionBody): Promise<boolean>; palette: PaletteView | null }
  | { mode: "gm"; busy: boolean; currency: WorldCurrency; edit(ops: EditOp[]): Promise<boolean>; gm: GmView };

/** What every page of the hub gets: the party's view, the controls of its mode, and the navigator. */
export interface SectionProps {
  view: FinanceView;
  controls: HubControls;
  nav: HubNav;
}

/** The GM's controls, when the hub is the GM's. */
export type GmControls = Extract<HubControls, { mode: "gm" }>;
export type PlayerControls = Extract<HubControls, { mode: "player" }>;

const SECTION_ICON: Readonly<Record<Exclude<HubSection, "overview">, IconName>> = { accounts: "bank", flows: "refresh", jobs: "briefcase", businesses: "bag", investments: "layers", properties: "home", credit: "pulse", household: "users" };

/**
 * The page a money line names (an alert, something coming up): its flow's when the view holds the
 * flow (the party's own, a property's running costs, a household's shared costs), else its
 * account's; null when it names neither, and the line opens nothing.
 */
export function lineTarget(view: FinanceView, flow: string | null | undefined, account: string | null | undefined): { page: HubPage; name: string } | null {
  const f = flow ? [...view.flows, ...view.properties.flatMap((p) => p.costs), ...(view.household?.flows ?? [])].find((x) => x.id === flow) : undefined;
  if (f) return { page: detailPage("flow", f.id), name: f.label };
  const a = account ? view.accounts.find((x) => x.id === account) : undefined;
  return a ? { page: detailPage("account", a.id), name: a.name } : null;
}

function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A section's row line, from the view: what's in it at a glance. */
function summaryOf(view: FinanceView, section: Exclude<HubSection, "overview">, fmt: (cents: number) => string): string {
  const parts = (...list: (string | null)[]): string => list.filter((p) => p !== null).join(" · ");
  switch (section) {
    case "accounts": {
      const due = view.accounts.filter((a) => a.due !== null).length;
      return parts(counted(view.accounts.length, "account", "accounts"), view.cards.length > 0 ? counted(view.cards.length, "card", "cards") : null, due > 0 ? `${due} due` : null);
    }
    case "flows": {
      if (view.flows.length === 0) return "None set up yet";
      const active = view.flows.filter((f) => f.status === "active").length;
      const paused = view.flows.filter((f) => f.status === "paused").length;
      const next = view.overview?.upcoming.find((u) => u.flow !== null);
      return parts(`${active} active`, paused > 0 ? `${paused} paused` : null, next ? `next ${next.label}, ${next.at}` : null);
    }
    case "jobs": {
      const [job] = view.jobs;
      if (view.jobs.length !== 1 || !job) return counted(view.jobs.length, "job", "jobs");
      return parts(`${job.title || humanize(job.basis)} at ${job.employer}`, job.nextPay ? `payday ${job.nextPay}` : null);
    }
    case "businesses": {
      const [b] = view.businesses;
      if (view.businesses.length !== 1 || !b) return counted(view.businesses.length, "business", "businesses");
      return parts(b.name, `${fmt(b.books.profit)} profit, ${b.books.period}`);
    }
    case "investments": {
      const inv = view.investments;
      if (!inv) return "";
      return parts(`Worth ${fmt(inv.value)}`, `${inv.unrealised > 0 ? "+" : ""}${fmt(inv.unrealised)} not yet taken`);
    }
    case "properties": {
      const owned = view.properties.filter((p) => p.share > 0);
      const forSale = view.properties.filter((p) => p.share <= 0 && p.forSale !== null && p.forSale !== undefined).length;
      const [home] = owned;
      return parts(owned.length === 1 && home ? `${home.name}, ${fmt(home.equity)} equity` : owned.length > 0 ? `${owned.length} yours` : null, forSale > 0 ? `${forSale} for sale` : null);
    }
    case "credit": {
      const c = view.credit;
      if (!c) return "";
      return parts(c.score !== null ? `Score ${c.score}${c.band ? `, ${c.band}` : ""}` : "No score yet", c.offers.length > 0 ? counted(c.offers.length, "offer", "offers") : null);
    }
    case "household": {
      const h = view.household;
      if (!h) return "";
      return parts(h.name, counted(h.members.length, "person", "people"), `${fmt(h.monthly.total)} a month shared`);
    }
  }
}

function Overview(props: SectionProps) {
  const { view, controls, nav } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const o = view.overview;
  const blocks = overviewBlocks(view);
  const level = <Badge>{view.detail ? `Money ${view.level} · full books` : `Money ${view.level}`}</Badge>;
  const cash = view.cash && "cents" in view.cash ? view.cash.cents : null;
  const netWorth = o && o.netWorth !== null ? o.netWorth : null;
  const assets = blocks.assets && o && o.assets !== null ? o.assets : null;
  const owed = blocks.assets && o && o.liabilities !== null && o.liabilities !== 0 ? o.liabilities : null;
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
      {o?.alerts.map((a, i) => {
        const target = lineTarget(view, a.flow, a.account);
        return (
          <Banner
            key={`${a.text}:${i}`}
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
      })}
      {o && o.upcoming.length > 0 ? (
        <Section title="Coming up" flush>
          <List>
            {o.upcoming.slice(0, blocks.upcoming).map((u, i) => {
              const target = lineTarget(view, u.flow, u.account);
              return <ListRow key={`${u.clock}:${i}`} icon="calendar" title={u.label} subtitle={u.at} value={`${u.cents > 0 ? "+" : ""}${fmt(u.cents)}`} valueTone={u.cents < 0 ? "neg" : "pos"} chevron={target !== null} onClick={target ? () => nav.open(target.page) : undefined} />;
            })}
          </List>
        </Section>
      ) : null}
      {view.level >= 2 ? (
        <Section title="Recent" flush>
          <TxnRows lines={view.recent} max={blocks.recent} currency={controls.currency} account />
        </Section>
      ) : null}
      {blocks.breakdown && o && o.breakdown.length > 0 ? (
        <Section title="What it's made of" flush>
          <List>
            {o.breakdown.map((b) => (
              <ListRow key={b.label} title={b.label} value={fmt(b.cents)} valueTone={b.cents < 0 ? "neg" : undefined} />
            ))}
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
    </>
  );
}

/** One party's money hub: the overview, then a row for each other section the party has, which opens its page. */
export function MoneyHub(props: SectionProps & { label: string }) {
  const { view, controls, nav } = props;
  const tabs = hubTabs(view);
  if (tabs.length === 0) return <Empty icon="coins">Money is off for {view.name}.</Empty>;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const rows = tabs.flatMap((t) => (t.id === "overview" ? [] : [{ id: t.id, dot: t.dot }]));
  return (
    <div class="lre-money-hub" data-lre-money-hub={view.party}>
      <Overview view={view} controls={controls} nav={nav} />
      {rows.length > 0 ? (
        <Section title={props.label} flush>
          <div data-lre-money-sections>
            <List>
              {rows.map((t) => {
                const summary = summaryOf(view, t.id, fmt);
                return (
                  <ListRow
                    key={t.id}
                    icon={SECTION_ICON[t.id]}
                    title={SECTION_LABELS[t.id]}
                    subtitle={summary === "" ? undefined : summary}
                    badge={t.dot ? <Badge tone="warn">Needs you</Badge> : undefined}
                    chevron
                    onClick={() => nav.open(sectionPage(t.id))}
                  />
                );
              })}
            </List>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
