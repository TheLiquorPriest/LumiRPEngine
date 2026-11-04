// An organization's life in Play (ORG-SPEC §3.14, §4.2, §4.4), from its page's sections: its alerts
// under the Overview's headline, each with Open to the tab that deals with it; Coming up (paydays,
// invoices due, dues and lease ends) above its History; the Needs you dot on the Orgs home's row of
// an organization with an alert that asks something of the player character; and Now's glance,
// those alerts as "Alder Automotive: payroll short", each opening its page on that tab, then the
// party's plan in a line ("Plan: 1 of 3 done · Danny away", assess-party §6.2), opening its Plan.

import { openAt, orgRoute, useApp } from "../../../frontend/app";
import { Banner, Button, List, ListRow, Section } from "../../../frontend/components";
import { formatCents } from "../../../frontend/format";
import type { IconName } from "../../../frontend/icons";
import { GLANCE_ROWS, GlanceCard } from "../../../frontend/play/glance";
import type { PanelProps } from "../../../frontend/registry";
import { isRecord } from "../../../shared/json";
import { ALERTS_SECTION, isPlanStatusLive, PLAN_SECTION, PLAN_TAB, type AlertTab, type ComingKind, type OrgAlertView, type OrgComingView } from "../../../shared/org-feed";
import { ORGS_LIST_PANEL, ORGS_ORG_PANEL, type OrgView } from "../../../shared/org-view";
import { decodeAlerts, decodeOrgList, decodeOrgPage, decodePlan } from "./decode";
import { andList, count } from "./words";

/** The tab an alert's Open goes to: the shell's own, the economy's Money, or the Plan. */
export const ALERT_TAB_IDS: Readonly<Record<AlertTab, string>> = { overview: "overview", people: "people", rules: "rules", money: "economy.money", plan: PLAN_TAB };

/**
 * The alerts under the Overview's headline: each in its tone, "Needs you" when it asks something of
 * the reader, with Open to its tab where the page shows that tab (none for one about the Overview
 * itself, nor where nothing can change the tab, as in a preview).
 */
export function OrgAlerts(props: { alerts: readonly OrgAlertView[]; tabs: readonly { id: string; label: string }[]; onTab?(id: string): void }) {
  const { onTab } = props;
  return (
    <div class="lre-stack" data-lre-org-alerts>
      {props.alerts.map((a) => {
        const tab = props.tabs.find((t) => t.id === ALERT_TAB_IDS[a.tab] && t.id !== "overview");
        return (
          <div key={a.id} data-lre-org-alert={a.id}>
            <Banner
              tone={a.tone}
              title={a.needsYou ? "Needs you" : undefined}
              actions={
                tab && onTab ? (
                  <Button variant="ghost" size="sm" iconAfter="chevron-right" label={`Open ${tab.label}`} onClick={() => onTab(tab.id)}>
                    Open
                  </Button>
                ) : undefined
              }
            >
              {a.text}
            </Banner>
          </div>
        );
      })}
    </div>
  );
}

const COMING_ICON: Readonly<Record<ComingKind, IconName>> = { payday: "wallet", invoice: "receipt", dues: "coins", lease: "key" };

/** A thing coming up's amount, signed, where the reader may see it and it is known ahead (a payroll's often isn't). */
export function comingValue(c: OrgComingView): { value?: string; tone?: "pos" | "neg" } {
  if (c.cents === null || c.cents === 0) return {};
  return { value: `${c.cents > 0 ? "+" : ""}${formatCents(c.cents)}`, tone: c.cents < 0 ? "neg" : "pos" };
}

/** Coming up: paydays and dues a line a day, invoices due and lease ends, soonest first, each with when and its money. */
export function ComingUp(props: { items: readonly OrgComingView[] }) {
  return (
    <div data-lre-org-coming>
      <Section title="Coming up" flush>
        <List>
          {props.items.map((c, i) => {
            const money = comingValue(c);
            return <ListRow key={`${c.kind}:${c.clock}:${i}`} icon={COMING_ICON[c.kind]} title={c.text} subtitle={c.at} value={money.value} valueTone={money.tone} />;
          })}
        </List>
      </Section>
    </div>
  );
}

/** One alert that needs the reader, with the organization it is on. */
export interface NeedsYou {
  org: string;
  name: string;
  alert: OrgAlertView;
}

/** Every alert that needs the reader, page by page (by name), from the pages the home opens (`orgs.org`). */
export function needsYouOf(pages: unknown): NeedsYou[] {
  if (!isRecord(pages)) return [];
  const out: NeedsYou[] = [];
  for (const [org, page] of Object.entries(pages)) {
    if (!isRecord(page) || !isRecord(page.sections)) continue;
    const name = typeof page.name === "string" ? page.name : org;
    for (const alert of decodeAlerts(page.sections[ALERTS_SECTION])) if (alert.needsYou) out.push({ org, name, alert });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.org.localeCompare(b.org));
}

/**
 * The party's plan in a line for Now (assess-party §6.2): how many of its orders are done, of those on
 * it, or how many goals it has while it gives no orders, and who is away on one ("Plan: 1 of 3 done ·
 * Danny away"); null while it has nothing on it.
 */
export function planGlanceLine(page: OrgView): string | null {
  const plan = decodePlan(page.sections[PLAN_SECTION]);
  if (!plan || (plan.goals.length === 0 && plan.orders.length === 0)) return null;
  const orders = [...plan.goals.flatMap((g) => g.orders), ...plan.orders];
  const done = orders.filter((o) => o.status === "done").length;
  const onOrders = new Set(orders.filter((o) => isPlanStatusLive(o.status)).flatMap((o) => o.to.map((t) => t.id)));
  const away = page.people.filter((p) => !p.you && !p.here && onOrders.has(p.id)).map((p) => p.name.split(/\s+/)[0] || p.name);
  const head = orders.length > 0 ? `Plan: ${done} of ${orders.length} done` : `Plan: ${count(plan.goals.length, "goal", "goals")}`;
  return away.length > 0 ? `${head} · ${andList(away.length > 2 ? [...away.slice(0, 2), count(away.length - 2, "other", "others")] : away)} away` : head;
}

/** Now's glance: the alerts that need the reader, then the party's plan in a line, at most three rows, each opening its organization's page on its tab. */
export function OrgsGlanceCard(props: { needs: readonly NeedsYou[]; plan: { org: string; line: string } | null; onOpen(org: string, tab: string): void }) {
  const { plan } = props;
  const needs = props.needs.slice(0, GLANCE_ROWS);
  return (
    <GlanceCard title="Organizations" panel={ORGS_LIST_PANEL}>
      {needs.map((n) => (
        <ListRow key={`${n.org}:${n.alert.id}`} icon="briefcase" title={`${n.name}: ${n.alert.short}`} badge={<span class="lre-dot" role="img" aria-label="Needs you" />} chevron onClick={() => props.onOpen(n.org, ALERT_TAB_IDS[n.alert.tab])} />
      ))}
      {plan && needs.length < GLANCE_ROWS ? <ListRow key="plan" icon="flag" title={plan.line} chevron onClick={() => props.onOpen(plan.org, PLAN_TAB)} /> : null}
    </GlanceCard>
  );
}

/** The `orgs.alerts` glance on Now (over the Orgs home's panel); nothing while no alert needs the player character and the party's plan is empty. */
export function OrgsGlance(props: PanelProps) {
  const app = useApp();
  const pages = props.state.panels[ORGS_ORG_PANEL];
  const needs = needsYouOf(pages);
  const party = decodeOrgList(props.view)?.party.id;
  const page = party === undefined ? null : decodeOrgPage(pages, party);
  const line = page ? planGlanceLine(page) : null;
  if (needs.length === 0 && line === null) return null;
  return <OrgsGlanceCard needs={needs} plan={line !== null && page ? { org: page.id, line } : null} onOpen={(org, tab) => app.ui.update((ui) => openAt(ui, "orgs", orgRoute(org, tab === "overview" ? undefined : tab)))} />;
}
