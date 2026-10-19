// The money hub (DESIGN §12, §25): one party's money, in sections. The player's Play → Money shows
// the POV's, with in-world actions as controls; the GM view shows anyone's, with edits. Both draw
// the same `FinanceView`, which the core built at the party's Money level: a band at level 1, the
// simple books below the top level, everything at the top level or where Custom turns a feature on.

import { useEffect, useId, useState } from "preact/hooks";
import type { FinanceView } from "../../../shared/finance";
import type { EditOp } from "../../../shared/protocol";
import type { GmView, PaletteView } from "../../../shared/state-view";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Card, Empty, Row, Tabs, tabPanel } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { InvestmentsSection, PropertiesSection } from "./assets";
import { AccountsSection } from "./accounts";
import { CreditSection, HouseholdSection } from "./credit";
import { FlowsSection } from "./flows";
import { hubTabs, overviewBlocks, type HubSection } from "./layout";
import { TxnRows } from "./lines";
import type { ActionBody } from "./requests";
import { BusinessesSection, JobsSection } from "./work";

/**
 * How the hub's controls reach the backend. The player's are in-world actions (`lre.action`,
 * played as a turn like any other); the GM's are edits (`lre.edit`, each one correction with its
 * own Undo). A section offers only the controls of its mode.
 */
export type HubControls =
  | { mode: "player"; busy: boolean; currency: WorldCurrency; act(body: ActionBody): Promise<boolean>; palette: PaletteView | null }
  | { mode: "gm"; busy: boolean; currency: WorldCurrency; edit(ops: EditOp[]): Promise<boolean>; gm: GmView };

export interface SectionProps {
  view: FinanceView;
  controls: HubControls;
}

/** The GM's controls, when the hub is the GM's. */
export type GmControls = Extract<HubControls, { mode: "gm" }>;
export type PlayerControls = Extract<HubControls, { mode: "player" }>;

function Overview(props: SectionProps) {
  const { view, controls } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const o = view.overview;
  const blocks = overviewBlocks(view);
  return (
    <>
      <Card title="Overview" aside={<span class="lre-badge">{view.detail ? `Money ${view.level} · full books` : `Money ${view.level}`}</span>}>
        {view.band ? <Row k="Wealth" v={view.band} /> : null}
        {!view.opened ? <div class="lre-small lre-muted">Not opened yet: these are the opening balances the accounts start from.</div> : null}
        {o && o.netWorth !== null ? <Row k="Net worth" v={fmt(o.netWorth)} tone={o.netWorth < 0 ? "neg" : undefined} /> : null}
        {blocks.assets && o && o.assets !== null ? <Row k="Assets" v={fmt(o.assets)} /> : null}
        {blocks.assets && o && o.liabilities !== null && o.liabilities !== 0 ? <Row k="Owed" v={fmt(-Math.abs(o.liabilities))} tone="neg" /> : null}
        {view.cash && "cents" in view.cash ? <Row k="Cash on hand" v={fmt(view.cash.cents)} /> : null}
      </Card>
      {blocks.breakdown && o && o.breakdown.length > 0 ? (
        <Card title="What it's made of">
          {o.breakdown.map((b) => (
            <Row key={b.label} k={b.label} v={fmt(b.cents)} tone={b.cents < 0 ? "neg" : undefined} />
          ))}
        </Card>
      ) : null}
      {o && o.alerts.length > 0 ? (
        <Card title="Needs attention">
          {o.alerts.map((a, i) => (
            <Row key={`${a.text}:${i}`} k={a.text} tone={a.tone === "info" ? "muted" : a.tone === "neg" ? "neg" : "warn"} />
          ))}
        </Card>
      ) : null}
      {o && o.cashFlow ? (
        <Card title={`Cash flow · ${o.cashFlow.period}`}>
          <Row k="Money in" v={fmt(o.cashFlow.in)} tone="pos" />
          <Row k="Money out" v={fmt(-Math.abs(o.cashFlow.out))} tone="neg" />
          {blocks.cashFlowByCategory ? o.cashFlow.byCategory.map((b) => <Row key={b.category} k={humanize(b.category)} v={fmt(b.cents)} tone={b.cents < 0 ? "neg" : "pos"} />) : null}
          {blocks.cashFlowAhead ? <Row k="The next 30 days" sub={`${fmt(o.cashFlow.nextIn)} coming in`} v={fmt(-Math.abs(o.cashFlow.nextOut))} /> : null}
        </Card>
      ) : null}
      {o && o.upcoming.length > 0 ? (
        <Card title="Coming up">
          {o.upcoming.slice(0, blocks.upcoming).map((u, i) => (
            <Row key={`${u.clock}:${i}`} k={u.label} sub={u.at} v={fmt(u.cents)} tone={u.cents < 0 ? "neg" : "pos"} />
          ))}
        </Card>
      ) : null}
      {view.level >= 2 ? (
        <Card title="Recent">
          <TxnRows lines={view.recent} max={blocks.recent} currency={controls.currency} account />
        </Card>
      ) : null}
      {controls.mode === "gm" && view.notes.length > 0 ? (
        <Card title="Notes">
          {view.notes.map((n, i) => (
            <Row key={`${n.at}:${i}`} k={n.text} sub={n.at} />
          ))}
        </Card>
      ) : null}
    </>
  );
}

/** One party's money hub: its sections as tabs, the one picked drawn below. */
export function MoneyHub(props: SectionProps & { label: string }) {
  const { view, controls } = props;
  const tabs = hubTabs(view, controls.mode);
  const [section, setSection] = useState<HubSection>("overview");
  const panelId = useId();
  // A section the party no longer has (a business sold, a level lowered) falls back to the overview.
  const shown: HubSection = tabs.some((t) => t.id === section) ? section : "overview";
  useEffect(() => {
    if (shown !== section) setSection(shown);
  }, [shown, section]);
  if (tabs.length === 0) return <Empty>Money is off for {view.name}.</Empty>;
  return (
    <div class="lre-stack" data-lre-money-hub={view.party}>
      {tabs.length > 1 ? <Tabs<HubSection> label={props.label} panelId={panelId} value={shown} tabs={tabs} onChange={setSection} /> : null}
      <div class="lre-stack" {...tabPanel(panelId, shown)} data-lre-money-section={shown}>
        {shown === "overview" ? <Overview {...props} /> : null}
        {shown === "accounts" ? <AccountsSection {...props} /> : null}
        {shown === "flows" ? <FlowsSection {...props} /> : null}
        {shown === "jobs" ? <JobsSection {...props} /> : null}
        {shown === "businesses" ? <BusinessesSection {...props} /> : null}
        {shown === "investments" ? <InvestmentsSection {...props} /> : null}
        {shown === "properties" ? <PropertiesSection {...props} /> : null}
        {shown === "credit" ? <CreditSection {...props} /> : null}
        {shown === "household" ? <HouseholdSection {...props} /> : null}
      </div>
    </div>
  );
}
