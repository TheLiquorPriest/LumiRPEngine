// The economy's tabs on an organization's page in Orgs (ORG-SPEC §4.3-4.4, §5.2; `r.orgTab`), each
// drawn while the page holds the economy's section of it, which the backend builds only for a
// reader who may see it at the organization's Money level:
// - Money: the organization's own money as Money's segments (Summary, Accounts, In & out, Books),
//   read only; Pay as… above them for a reader who may spend its money (`money.spend`, §3.6), which
//   pays someone from it as the palette's Pay with Paying as does, the reader named on its line; what
//   it shares with the POV (an account they hold or run, a flow of theirs, its payroll's jobs) opens
//   the POV's own page, and the POV's own controls on it show: Issue an invoice, and Void or Pay on
//   its invoices.
// - Payroll, within People: its headcount and payroll, and each job, which opens the job's page
//   with Raise and Let go. Hiring is People's Hire someone (the orgs pack's).
// Ownership and Taxes are `ownership.tsx` and `taxes.tsx`. Every control is the POV's in-world
// action, as their own role on the business allows it, as it was from Money. In GM → Orgs each draws
// the GM's version (`gm`): Money as GM → Money draws a party, with the GM's edits, then its revenue
// streams in the economy's editor (`revenue.tsx`), and the rest as they read.

import { useEffect, useId, useState } from "preact/hooks";
import { FINANCE_ACTIONS } from "../../../shared/finance";
import { overLimit, powerCovers, type OrgLimits } from "../../../shared/org";
import type { OrgView } from "../../../shared/org-view";
import type { RevenueStreamView } from "../../../shared/revenue";
import type { PaletteEntry, PaletteView } from "../../../shared/state-view";
import { DEFAULT_CURRENCY, formatMoney, type WorldCurrency } from "../../../shared/world";
import { useApp, useChatWorld, type SheetRoute } from "../../../frontend/app";
import { Button, Empty, JsonView, List, ListRow } from "../../../frontend/components";
import type { GmSectionProps, OrgGmTabProps, OrgTabProps } from "../../../frontend/registry";
import { paletteRequest } from "../../../frontend/requests";
import { decodeFinanceView, decodePayroll, type PayrollSection } from "./decode";
import { ActionPage, AmountField, amountProblem, SelectField } from "./forms";
import { GmHub } from "./gm";
import { MoneyHub, type PlayerControls, type Reader, type SegmentProps } from "./hub";
import { ALL_ACTIVITY, businessControls, type ActivityFilter, type MoneySegment } from "./layout";
import { actionPage, Controls, detailPage, type Elsewhere, type HubNav } from "./nav";
import { observeMoney, playElsewhere, usePlayerControls } from "./panel";
import { amountOf } from "./requests";
import { gmStreamDrafts, RevenueEditor, RevenueStreams, revenueEditOps, revenueSpawnOps } from "./revenue";
import { routeFrom } from "./routes";
import { rate } from "./taxes";
import { JobListRow } from "./work";

/** The POV's own money and controls beside an organization's page in Play, its detail observed as the Money tab does. */
export function useReader(props: OrgTabProps): Reader | null {
  const app = useApp();
  const controls = usePlayerControls(props.chatId, props.state);
  useEffect(() => {
    observeMoney(app, props.chatId);
  }, [props.chatId]);
  const raw = props.state.panels["economy.money"];
  const view = raw === undefined || raw === null ? null : decodeFinanceView(raw);
  return view ? { view, controls } : null;
}

/** How an organization's tabs move in Play: what the POV's own money holds opens as theirs, the rest of the organization's money as its, each over the organization's page. */
export function orgNav(org: OrgView, reader: Reader | null, open: (route: SheetRoute) => void, elsewhere: (to: Elsewhere) => void): HubNav {
  return {
    page: null,
    open: (page) => open(routeFrom(org.id, false, reader, page)),
    back: () => undefined,
    elsewhere,
    frame: "play",
    backLabel: null,
  };
}

/** The POV's own view of the company the page is of, which decides their controls on it; null when they hold no role on it. */
export function theirBusiness(org: OrgView, reader: Reader | null) {
  return reader?.view.businesses.find((b) => b.id === org.id) ?? null;
}

// ---------------------------------------------------------------- Money

/** An organization's own money in Play, without hooks: Pay as… where the reader may spend it (`onPayAs`, opening its page), then its segments, read only, beside the POV's own (`reader`). */
export function OrgMoney(props: Omit<SegmentProps, "controls" | "garage"> & { currency: WorldCurrency; onPayAs?: () => void }) {
  return (
    <>
      {props.onPayAs ? (
        <Controls name="org-money">
          <Button variant="primary" icon="coins" onClick={props.onPayAs}>
            Pay as…
          </Button>
        </Controls>
      ) : null}
      <MoneyHub {...props} controls={{ mode: "read", busy: false, currency: props.currency }} garage={false} />
    </>
  );
}

/** What Pay as… pays with: the palette's Pay, which offers the organization as Paying as, and the limits the reader's `money.spend` there rests on (null: none). */
export interface PayAs {
  entry: PaletteEntry;
  limits: OrgLimits | null;
}

/**
 * Pay as… for the reader (ORG-SPEC §3.6, §4.4): only where they hold `money.spend` for the
 * organization and the palette's Pay offers to pay as it; its limits those of the position or the
 * delegation the power rests on, as `mayAct` reads them. Null otherwise.
 */
export function payAsOf(org: OrgView, palette: PaletteView | null): PayAs | null {
  const held = org.you.powers.find((p) => p.power === "money.spend");
  const entry = palette?.entries.find((e) => e.action === FINANCE_ACTIONS.pay && e.acting?.options.some((o) => o.id === org.id));
  if (!held || !entry) return null;
  const limits = held.basis === "position" ? org.positions.find((p) => p.id === held.id)?.limits : held.basis === "delegate" ? org.you.delegations.find((d) => d.powers.some((p) => powerCovers(p, "money.spend")))?.limits : null;
  return { entry, limits: limits ?? null };
}

/**
 * Pay as…'s page, without hooks (`to` and `amount` kept by the tab): whom, from the palette's Pay,
 * and how much. Go pays as the palette's Pay with Paying as does: the organization's money pays,
 * done at once, off screen, with its Undo and the Tell switch (DESIGN §11). A payment over the
 * reader's limit for it asks for approval instead (ORG-SPEC Phase 5: Pay with `ask`), put to whoever
 * holds the power above, and is paid once they approve.
 */
export function PayAsPage(props: { org: OrgView; payAs: PayAs; chatId: string; to: string; amount: string; onTo(id: string): void; onAmount(text: string): void; controls: PlayerControls; nav: HubNav }) {
  const { org, payAs, controls } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const payees = payAs.entry.options.filter((o) => o.disabled === undefined && o.next === undefined && typeof o.params.to === "string");
  const option = payees.find((o) => o.params.to === props.to);
  const cents = amountOf(props.amount, controls.currency);
  const problem = !option ? "Pick whom to pay." : amountProblem(props.amount, controls.currency, "the amount");
  const over = payAs.limits && cents !== null ? overLimit(payAs.limits, cents, null, org.name, controls.currency) : null;
  const limit = payAs.limits?.payment;
  const request = option && cents !== null ? paletteRequest(payAs.entry, [option], props.chatId, cents, undefined, [], org.id) : null;
  const body = request ? { action: request.action, params: over !== null ? { ...request.params, ask: true } : request.params } : null;
  return (
    <ActionPage
      nav={props.nav}
      controls={controls}
      name="pay-as"
      title={`Pay as ${org.name}`}
      subtitle={limit !== undefined ? `From its money, up to ${fmt(limit)} a payment` : "From its money"}
      go={cents === null ? `Pay as ${org.name}` : over !== null ? `Ask for approval to pay ${fmt(cents)}` : `Pay ${fmt(cents)} as ${org.name}`}
      problem={problem}
      action={body}
      submit={(tell) => (body === null ? Promise.resolve(false) : controls.act(body, tell))}
    >
      <SelectField label="Pay" value={option ? props.to : ""} empty="Choose someone" options={payees.map((o) => ({ value: String(o.params.to), label: o.label }))} onChange={props.onTo} />
      <AmountField label="Amount" value={props.amount} currency={controls.currency} onInput={props.onAmount} invalid={props.amount.trim() !== "" && cents === null} />
      {over !== null ? <span class="lre-field-help" data-lre-pay-as-over>{`${over}: it goes to whoever holds the power above you for approval, and is paid once they approve.`}</span> : null}
    </ActionPage>
  );
}

export function OrgMoneyTab(props: OrgTabProps) {
  const app = useApp();
  const reader = useReader(props);
  const [segment, setSegment] = useState<MoneySegment>("summary");
  const [filter, setFilter] = useState<ActivityFilter>(ALL_ACTIVITY);
  const [paying, setPaying] = useState<{ to: string; amount: string } | null>(null);
  const panelId = useId();
  const view = decodeFinanceView(props.section);
  if (!view) return <JsonView value={props.section} />;
  const nav = orgNav(props.org, reader, props.open, (to) => playElsewhere(app, to));
  const payAs = reader ? payAsOf(props.org, props.state.palette) : null;
  // Pay as… opens in the tab, over the segments; Back, or a payment sent, returns to them.
  if (paying && payAs && reader) {
    return (
      <div class="lre-money-root" data-lre-org-money={props.org.id}>
        <PayAsPage org={props.org} payAs={payAs} chatId={props.chatId} to={paying.to} amount={paying.amount} onTo={(to) => setPaying({ ...paying, to })} onAmount={(amount) => setPaying({ ...paying, amount })} controls={reader.controls} nav={{ ...nav, page: actionPage("pay-as"), back: () => setPaying(null), backLabel: "Money" }} />
      </div>
    );
  }
  return (
    <div class="lre-money-root" data-lre-org-money={props.org.id}>
      <OrgMoney view={view} reader={reader} nav={nav} currency={props.state.currency ?? DEFAULT_CURRENCY} segment={segment} onSegment={setSegment} filter={filter} onFilter={setFilter} now={props.state.hud?.clock.minutes ?? null} panelId={panelId} {...(payAs ? { onPayAs: () => setPaying({ to: "", amount: "" }) } : {})} />
      <RevenueStreams streams={view.streams ?? []} currency={props.state.currency ?? DEFAULT_CURRENCY} />
    </div>
  );
}

/** Money in GM → Orgs: the organization's money as GM → Money draws a party, with the GM's edits, its pages stacked in the page; then its revenue streams in the economy's editor. */
export function GmOrgMoneyTab(props: OrgGmTabProps) {
  const { gm } = props;
  const view = gm.gm.money.find((m) => m.party === props.org.id) ?? decodeFinanceView(props.section);
  if (!view) return <JsonView value={props.section} />;
  return (
    <>
      <GmHub key={view.party} view={view} controls={{ mode: "gm", busy: gm.busy, currency: gm.currency, edit: gm.edit, gm: gm.gm }} />
      <GmOrgRevenue org={props.org} streams={view.streams ?? []} gm={gm} />
    </>
  );
}

/**
 * The organization's revenue streams in GM → Orgs → Money: the economy's editor over the streams its
 * money view lists, each as the GM view holds it, previewed on the chat's world; a new one is
 * spawned, a change set, and Remove takes it out of the world, each one GM edit with its Undo. Until
 * the world is read, the streams as Play lists them.
 */
function GmOrgRevenue(props: { org: OrgView; streams: readonly RevenueStreamView[]; gm: GmSectionProps }) {
  const { gm, streams } = props;
  const world = useChatWorld(gm.send);
  if (!world) return <RevenueStreams streams={streams} currency={gm.currency} />;
  return (
    <RevenueEditor
      world={world}
      earner={{ id: props.org.id, name: props.org.name }}
      streams={gmStreamDrafts(gm.gm, streams)}
      views={streams}
      taken={new Set(gm.gm.entities.map((e) => e.id))}
      saving={gm.busy}
      save={(draft, was) => {
        const ops = was === null ? revenueSpawnOps(draft) : revenueEditOps(was, draft);
        if (ops.length > 0) void gm.edit(ops);
      }}
      remove={(id) => void gm.edit([{ op: "despawn", entity: id }])}
    />
  );
}

// ---------------------------------------------------------------- Payroll

/**
 * A company's Payroll, at the foot of its People: how many are on it and what it has cost this
 * year, its unemployment taxes this year with each one's rate and wage base (ORG-SPEC §3.11,
 * Phase 5), and each job, which opens its page (Raise, Let go) where `nav` is given, the reader's
 * own view of it first, since that's what their controls go by.
 */
export function OrgPayroll(props: { org: OrgView; section: PayrollSection; reader: Reader | null; nav: HubNav | null; currency: WorldCurrency }) {
  const { org, section, reader, nav } = props;
  const theirs = theirBusiness(org, reader);
  const jobs = theirs?.employees ?? section.employees;
  const u = section.unemployment;
  const money = (cents: number): string => formatMoney(cents, props.currency);
  return (
    <div class="lre-stack" data-lre-org-payroll={org.id}>
      <List>
        <ListRow icon="users" title="On the payroll" value={String(section.headcount)} />
        <ListRow icon="coins" title="Payroll this year" value={money(section.payroll)} />
        {u ? <ListRow icon="receipt" title="FUTA this year" subtitle={u.rates?.futa ? `Federal unemployment tax: ${rate(u.rates.futa.pct)} on the first ${money(u.rates.futa.base)} of each worker's pay` : "Federal unemployment tax: it owes none"} value={money(u.futa)} /> : null}
        {u ? <ListRow icon="receipt" title="SUTA this year" subtitle={u.rates?.suta ? `State unemployment tax: ${rate(u.rates.suta.pct)} on the first ${money(u.rates.suta.base)} of each worker's pay` : "State unemployment tax: it owes none"} value={money(u.suta)} /> : null}
      </List>
      {jobs.length === 0 ? (
        <Empty icon="users">No one on the payroll.</Empty>
      ) : (
        <List>
          {jobs.map((j) => (
            <JobListRow key={j.id} job={j} payroll onOpen={nav ? () => nav.open(detailPage("job", j.id)) : undefined} />
          ))}
        </List>
      )}
    </div>
  );
}

export function OrgPayrollPart(props: OrgTabProps) {
  const app = useApp();
  const reader = useReader(props);
  const section = decodePayroll(props.section);
  if (!section) return <JsonView value={props.section} />;
  return <OrgPayroll org={props.org} section={section} reader={reader} nav={orgNav(props.org, reader, props.open, (to) => playElsewhere(app, to))} currency={props.state.currency ?? DEFAULT_CURRENCY} />;
}

/** Payroll in GM → Orgs: its figures and jobs as they read; GM → Orgs adds, ends and edits the jobs. */
export function GmOrgPayrollPart(props: OrgGmTabProps) {
  const section = decodePayroll(props.section);
  if (!section) return <JsonView value={props.section} />;
  return <OrgPayroll org={props.org} section={section} reader={null} nav={null} currency={props.gm.currency} />;
}
