// Money → Investments and Properties (DESIGN §27): holdings with their value, cost and gain (lots
// and realised gains in the full books), options, where distributions go; real estate with its
// value, equity, mortgage, leases and running costs. Each holding and property opens its own page,
// and each control there its own page with Back and one button. The player buys and sells,
// exercises options, routes distributions, lets and sells property and buys what's for sale, each
// an in-world action offered only where the feature runs for them; the GM sets prices, routes and
// every declared field.

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { ROLE_RIGHTS, type DistributionRoute, type FinanceView, type HoldingView, type LeaseView, type PropertyView } from "../../../shared/finance";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Badge, Button, Empty, IdText, List, ListRow, Section } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { FlowListRow } from "./flows";
import { ActionPage, AmountField, AmountPage, ChoiceField, NumberField, SelectField, TextField, ToggleField, type ChoiceOption } from "./forms";
import type { HubControls, SectionProps } from "./hub";
import { endableLeases, holdingControls, investmentBlocks, knownPeople, moveSources, propertyControls, ROUTE_ELSEWHERE, routePick, transferTargets, type HoldingControl, type PropertyControl } from "./layout";
import { FieldsPage } from "./lines";
import { actionPage, Controls, detailPage, Hero, MoneyPage, Note, type HubNav, type HubPage, type HubPages } from "./nav";
import { amountOf, exerciseAction, leaseEndAction, leaseStartAction, newIdFor, propertyBuyAction, propertySellAction, propertySpawnOps, routeAction, routeOps, setPriceOps, tradeAction, type RouteTarget, type TradeForm } from "./requests";

/** A gain or a loss with its sign: "+$12.00", "-$3.50". */
function signed(cents: number, currency: WorldCurrency): string {
  return `${cents > 0 ? "+" : ""}${formatMoney(cents, currency)}`;
}

/**
 * A row naming an account (a holding's, a mortgage), which opens that account's page when it's
 * one of the party's; another owner's account is named in words and opens nothing.
 */
function AccountRow(props: { view: FinanceView; nav: HubNav; id: string; title: string; subtitle?: string; value?: ComponentChildren; valueTone?: "pos" | "neg" | "warn" | "muted" }) {
  const account = props.view.accounts.find((a) => a.id === props.id);
  const nav = props.nav;
  return <ListRow icon="bank" title={props.title} subtitle={props.subtitle === "" ? undefined : props.subtitle} value={props.value ?? account?.name ?? "Another account"} valueTone={props.valueTone} chevron={account !== undefined} onClick={account ? () => nav.open(detailPage("account", account.id)) : undefined} />;
}

// ---------------------------------------------------------------- where payouts go

/** Where distributions can go: the usual place (the account's cash, else the deposit account), reinvested (holdings only), one of the party's accounts, and another owner's account when that's the one in force (shown, never picked). */
function routeChoices(view: FinanceView, reinvest: boolean, pick: string): ChoiceOption[] {
  return [
    { value: " ", label: "The usual place", detail: "Its account's cash, else the deposit account" },
    ...(reinvest ? [{ value: "reinvest", label: "Reinvested" }] : []),
    ...view.accounts.filter((a) => a.role !== null && ROLE_RIGHTS[a.role].sees).map((a) => ({ value: a.id, label: a.name })),
    ...(pick === ROUTE_ELSEWHERE ? [{ value: ROUTE_ELSEWHERE, label: "Another owner's account", detail: "Where it goes now; you can't pick it" }] : []),
  ];
}

/**
 * Where a holding's dividends, a property's rent or a business share's profit go now (`routePick`),
 * as a row that opens its page: routing is the player's action from Money 3, and the GM's edit for
 * the party at any level.
 */
export function RouteRow(props: { view: FinanceView; controls: HubControls; nav: HubNav; route: DistributionRoute | null; reinvest: boolean; label: string; page: HubPage }) {
  const { view } = props;
  if (props.controls.mode === "player" && view.level < 3) return null;
  const pick = routePick(props.route);
  const shown = routeChoices(view, props.reinvest, pick).find((c) => c.value === pick)?.label ?? view.accounts.find((a) => a.id === pick)?.name ?? "Not set";
  return (
    <Section flush>
      <List>
        <ListRow icon="route" title={props.label} value={shown} chevron onClick={() => props.nav.open(props.page)} />
      </List>
    </Section>
  );
}

/** Where a holding's payouts, a property's rent or a share of a business's profit go: the player's action, or the GM's `economy.route` for the party. The usual place travels as "". */
export function RoutePage(props: { view: FinanceView; controls: HubControls; nav: HubNav; target: RouteTarget; route: DistributionRoute | null; reinvest: boolean; label: string; subtitle: string }) {
  const { view, controls } = props;
  const pick = routePick(props.route);
  const [picked, setPicked] = useState(pick);
  if (controls.mode === "player" && view.level < 3) return null;
  const to = picked.trim();
  return (
    <ActionPage nav={props.nav} controls={controls} name="route" title={props.label} subtitle={props.subtitle} go="Save" disabled={picked === "" || picked === ROUTE_ELSEWHERE || picked === pick} submit={() => (controls.mode === "player" ? controls.act(routeAction(props.target, to)) : controls.edit(routeOps(props.target, view.party, to)))}>
      <ChoiceField label={props.label} value={picked} options={routeChoices(view, props.reinvest, pick)} onChange={setPicked} />
    </ActionPage>
  );
}

// ---------------------------------------------------------------- investments

const HOLDING_CONTROL: Readonly<Record<HoldingControl, string>> = { buy: "Buy more", sell: "Sell", exercise: "Exercise" };

/** A holding by its asset: "Acme Corp (ACME)". */
function holdingName(h: HoldingView): string {
  return `${h.asset.label}${h.asset.symbol ? ` (${h.asset.symbol})` : ""}`;
}

/** Whether the GM may set the price of a holding's asset: an option follows its underlying, and property and stakes have their own values. */
function priced(h: HoldingView): boolean {
  return h.asset.class !== "option" && h.asset.class !== "property" && h.asset.class !== "business_stake";
}

/** Whether the player may buy something new: where investments run and the market offers something they don't hold. */
function canBuyNew(view: FinanceView, controls: HubControls): boolean {
  return controls.mode === "player" && view.features.includes("investments") && (view.investments?.market ?? []).length > 0;
}

function InvestmentsSection(props: SectionProps) {
  const { view, controls, nav } = props;
  const inv = view.investments;
  if (!inv) {
    return (
      <MoneyPage nav={nav} name="investments" title="Investments">
        <Empty icon="layers">No investments.</Empty>
      </MoneyPage>
    );
  }
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const blocks = investmentBlocks(view);
  return (
    <MoneyPage nav={nav} name="investments" title="Investments">
      <Hero label="Worth now" value={fmt(inv.value)} />
      {canBuyNew(view, controls) ? (
        <Button variant="primary" icon="plus" block onClick={() => nav.open(actionPage("investments", "buy"))}>
          Buy something new
        </Button>
      ) : null}
      <Section flush>
        <List>
          <ListRow title="Cost" value={fmt(inv.cost)} />
          <ListRow title="Gain not yet taken" value={signed(inv.unrealised, controls.currency)} valueTone={inv.unrealised < 0 ? "neg" : "pos"} />
          <ListRow title="Gain taken" subtitle={blocks.gains && inv.realisedShort !== undefined && inv.realisedLong !== undefined ? `${fmt(inv.realisedShort)} short term · ${fmt(inv.realisedLong)} long term` : undefined} value={fmt(inv.realised)} />
          {blocks.income && inv.income !== undefined ? <ListRow title="Paid out this year" value={fmt(inv.income)} valueTone="pos" /> : null}
          {blocks.gains && inv.taxDue ? <ListRow title="Tax on gains" subtitle={`due ${inv.taxDue.at}`} value={fmt(inv.taxDue.cents)} valueTone="warn" /> : null}
        </List>
      </Section>
      <Section title="Holdings" flush>
        {inv.holdings.length === 0 ? (
          <Empty icon="layers">Nothing held.</Empty>
        ) : (
          <List>
            {inv.holdings.map((h) => (
              <ListRow key={h.id} title={holdingName(h)} subtitle={`${humanize(h.asset.class)} · ${h.qty} × ${fmt(h.price)} · ${signed(h.gain, controls.currency)}`} id={h.id} value={fmt(h.value)} chevron onClick={() => nav.open(detailPage("holding", h.id))} />
            ))}
          </List>
        )}
      </Section>
    </MoneyPage>
  );
}

/** One holding: its value at the price now, cost and gain, its lots in the full books, an option's terms, where its payouts go, and the controls its mode allows. */
function HoldingPage(props: SectionProps & { holding: HoldingView }) {
  const { view, controls, nav, holding: h } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const blocks = investmentBlocks(view);
  const can = controls.mode === "player" ? holdingControls(view, h) : [];
  const money = <Badge tone={h.option?.inTheMoney ? "pos" : "neutral"}>{h.option?.inTheMoney ? "In the money" : "Out of the money"}</Badge>;
  return (
    <MoneyPage nav={nav} name="holding" title={holdingName(h)} subtitle={humanize(h.asset.class)}>
      <IdText id={h.id} />
      <Hero label="Worth now" value={fmt(h.value)} sub={`${h.qty} × ${fmt(h.price)}`} badges={h.option ? money : undefined} />
      {can.length > 0 ? (
        <Controls name={h.id}>
          {can.map((c) => (
            <Button key={c} variant={c === "exercise" ? "primary" : "secondary"} icon={c === "buy" ? "plus" : c === "sell" ? "minus" : "check"} onClick={() => nav.open(actionPage("holding", h.id, c))}>
              {HOLDING_CONTROL[c]}
            </Button>
          ))}
        </Controls>
      ) : null}
      {controls.mode === "gm" ? (
        <Controls name={h.id}>
          {priced(h) ? (
            <Button icon="edit" onClick={() => nav.open(actionPage("holding", h.id, "price"))}>
              Set its price
            </Button>
          ) : null}
          <Button icon="list" onClick={() => nav.open(actionPage("holding", h.id, "fields"))}>
            Holding fields
          </Button>
        </Controls>
      ) : null}
      <Section flush>
        <List>
          {h.account === null ? <ListRow icon="bank" title="Held in" value="Held directly" /> : <AccountRow view={view} nav={nav} id={h.account} title="Held in" />}
          <ListRow title="Cost" value={fmt(h.cost)} />
          <ListRow title="Gain" value={signed(h.gain, controls.currency)} valueTone={h.gain < 0 ? "neg" : "pos"} />
          {h.option ? <ListRow title={`${humanize(h.option.right)} on ${h.option.underlying} at ${fmt(h.option.strike)}`} subtitle={`expires ${h.option.expiry}`} /> : null}
        </List>
      </Section>
      {!h.option ? <RouteRow view={view} controls={controls} nav={nav} route={h.route} reinvest label="Distributions go to" page={actionPage("holding", h.id, "route")} /> : null}
      {blocks.lots && h.lots.length > 0 ? (
        <Section title="Lots" flush>
          <List>
            {h.lots.map((l, i) => (
              <ListRow key={`${l.at}:${i}`} title={`${l.qty} bought ${l.at}`} subtitle={`cost ${fmt(l.cost)} · ${l.term} term`} value={signed(l.gain, controls.currency)} valueTone={l.gain < 0 ? "neg" : "pos"} />
            ))}
          </List>
        </Section>
      ) : null}
    </MoneyPage>
  );
}

/** A buy or a sale: of a holding, or (a buy) of an asset on the market, as units or an amount, an option with its strike and expiry. */
function TradePage(props: SectionProps & { side: "buy" | "sell"; holding?: HoldingView }) {
  const { view, controls, nav, holding } = props;
  const inv = view.investments;
  const market = inv?.market ?? [];
  const accounts = (inv?.accounts ?? []).map((id) => ({ value: id, label: view.accounts.find((a) => a.id === id)?.name ?? "Another account" }));
  const [form, setForm] = useState<TradeForm>({ side: props.side, holding: holding?.id ?? "", asset: holding?.asset.id ?? market[0]?.asset ?? "", account: accounts[0]?.value ?? "", qty: null, amount: "", from: "", to: "", option: null });
  if (controls.mode !== "player") return null;
  const result = tradeAction(form, controls.currency);
  const price = holding?.price ?? market.find((m) => m.asset === form.asset)?.price ?? null;
  // A buy pays from the holding's account when it holds cash; a brokerage that doesn't needs another account named.
  const sources = moveSources(view).map((a) => ({ value: a.id, label: `${a.name} (${formatMoney(a.available ?? a.cents, controls.currency)})` }));
  const targets = transferTargets(view, "").map((a) => ({ value: a.id, label: a.name }));
  const buy = form.side === "buy";
  return (
    <ActionPage nav={nav} controls={controls} name={`trade-${form.side}`} title={holding ? HOLDING_CONTROL[form.side] : "Buy something new"} subtitle={holding ? holdingName(holding) : undefined} go={buy ? "Buy" : "Sell"} problem={typeof result === "string" ? result : null} submit={() => (typeof result === "string" ? Promise.resolve(false) : controls.act(result))}>
      {!holding ? (
        <>
          <SelectField label="What" value={form.asset} empty="Choose" options={market.map((m) => ({ value: m.asset, label: `${m.label}${m.symbol ? ` (${m.symbol})` : ""} · ${formatMoney(m.price, controls.currency)}` }))} onChange={(asset) => setForm({ ...form, asset })} />
          <SelectField label="Held in" value={form.account} empty="Held directly" options={accounts} onChange={(account) => setForm({ ...form, account })} />
          {view.features.includes("options") ? <ToggleField label="An option on it" checked={form.option !== null} onChange={(on) => setForm({ ...form, option: on ? { right: "call", strike: "", expiry: "" } : null })} /> : null}
          {form.option ? (
            <>
              <SelectField label="Right" value={form.option.right} options={[{ value: "call", label: "Call (the right to buy)" }, { value: "put", label: "Put (the right to sell)" }]} onChange={(right) => form.option && setForm({ ...form, option: { ...form.option, right: right === "put" ? "put" : "call" } })} />
              <AmountField label="Strike" value={form.option.strike} currency={controls.currency} onInput={(strike) => form.option && setForm({ ...form, option: { ...form.option, strike } })} />
              <TextField label="Expires" type="date" value={form.option.expiry} onInput={(expiry) => form.option && setForm({ ...form, option: { ...form.option, expiry } })} />
            </>
          ) : null}
        </>
      ) : null}
      {price !== null ? (
        <Section flush>
          <List>
            <ListRow title="Price now" value={formatMoney(price, controls.currency)} />
          </List>
        </Section>
      ) : null}
      <NumberField label={form.option || holding?.option ? "Contracts" : "Units"} value={form.qty} min={0} onChange={(qty) => setForm({ ...form, qty })} />
      <AmountField label={buy ? "Or spend" : "Or raise"} value={form.amount} currency={controls.currency} onInput={(amount) => setForm({ ...form, amount })} invalid={form.amount.trim() !== "" && amountOf(form.amount, controls.currency) === null} placeholder={buy ? undefined : "Empty: sell it all"} />
      {buy ? <SelectField label="Pay from" value={form.from} empty="Its own account, else your usual one" options={sources} onChange={(from) => setForm({ ...form, from })} /> : <SelectField label="The money goes to" value={form.to} empty="Its own account, else your usual one" options={targets} onChange={(to) => setForm({ ...form, to })} />}
    </ActionPage>
  );
}

/** Exercising contracts: how many (all of them unless said), and the account a call's strike comes from or a put's goes to. */
function ExercisePage(props: SectionProps & { holding: HoldingView }) {
  const { view, controls, nav, holding: h } = props;
  const [qty, setQty] = useState<number | null>(null);
  const [account, setAccount] = useState("");
  if (controls.mode !== "player") return null;
  const call = h.option?.right !== "put";
  const choices = (call ? moveSources(view) : transferTargets(view, "")).map((a) => ({ value: a.id, label: a.name }));
  return (
    <ActionPage nav={nav} controls={controls} name="exercise" title="Exercise" subtitle={holdingName(h)} go="Exercise" disabled={qty !== null && !(qty >= 1 && qty <= h.qty)} submit={() => controls.act(exerciseAction(h.id, qty, account === "" ? {} : call ? { from: account } : { to: account }))}>
      <NumberField label={`Contracts (of ${h.qty}; empty: all)`} value={qty} min={1} max={h.qty} onChange={setQty} />
      <SelectField label={call ? "Pay the strike from" : "The strike goes to"} value={account} empty="Its own account, else your usual one" options={choices} onChange={setAccount} />
    </ActionPage>
  );
}

// ---------------------------------------------------------------- properties

const PROPERTY_CONTROL: Readonly<Record<PropertyControl, string>> = { let: "Let it", sell: "Sell", buy: "Buy" };

/** A property's tag: the viewing party's share of it ("yours" to the player, "theirs" to the GM), or that it's for sale. */
function ShareBadge(props: { property: PropertyView; controls: HubControls }) {
  const p = props.property;
  if (p.share <= 0) return <Badge tone="accent">For sale</Badge>;
  return <Badge>{`${Math.round(p.share * 10) / 10}% ${props.controls.mode === "player" ? "yours" : "theirs"}`}</Badge>;
}

function PropertiesSection(props: SectionProps) {
  const { view, controls, nav } = props;
  return (
    <MoneyPage nav={nav} name="properties" title="Properties">
      {controls.mode === "gm" ? (
        <Button variant="primary" icon="plus" block onClick={() => nav.open(actionPage("properties", "new"))}>
          Add a property
        </Button>
      ) : null}
      {view.properties.length === 0 ? (
        <Empty icon="home">No property.</Empty>
      ) : (
        <Section flush>
          <List>
            {view.properties.map((p) => (
              <ListRow key={p.id} title={p.name} subtitle={p.place && p.place !== p.name ? p.place : undefined} id={p.id} value={formatMoney(p.value, controls.currency)} badge={<ShareBadge property={p} controls={controls} />} chevron onClick={() => nav.open(detailPage("property", p.id))} />
            ))}
          </List>
        </Section>
      )}
    </MoneyPage>
  );
}

/** The GM's new property for the party: its name and value, the party its whole owner, one edit. */
function NewPropertyPage(props: SectionProps) {
  const { view, controls, nav } = props;
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  if (controls.mode !== "gm") return null;
  const cents = amountOf(value, controls.currency);
  const ok = name.trim() !== "" && cents !== null;
  return (
    <ActionPage nav={nav} controls={controls} name="property-new" title="Add a property" subtitle={view.name} go="Add the property" disabled={!ok} submit={() => (!ok || cents === null ? Promise.resolve(false) : controls.edit(propertySpawnOps(newIdFor("prop", name, new Set(controls.gm.entities.map((e) => e.id))), name.trim(), view.party, cents)))}>
      <TextField label="Name" value={name} onInput={setName} placeholder="The lake cabin" />
      <AmountField label="Value" value={value} currency={controls.currency} onInput={setValue} invalid={value.trim() !== "" && cents === null} />
      <Note>{`${view.name} owns it whole.`}</Note>
    </ActionPage>
  );
}

/** A lease as a row: the tenant, its term, the rent and whether it's let; `onOpen` when the player may end it. */
function LeaseRow(props: { lease: LeaseView; currency: WorldCurrency; onOpen?(): void }) {
  const l = props.lease;
  return (
    <ListRow
      title={l.tenant || "No tenant"}
      subtitle={[l.start ? `from ${l.start}` : null, l.end ? `to ${l.end}` : null].filter((s) => s !== null).join(" ") || undefined}
      value={formatMoney(l.rent, props.currency)}
      badge={<Badge tone={l.state === "vacant" ? "warn" : "neutral"}>{humanize(l.state)}</Badge>}
      chevron={props.onOpen !== undefined}
      onClick={props.onOpen}
    />
  );
}

/** One property: its value, share, equity, mortgage, leases and running costs, where its rent goes, and the controls its mode allows. */
function PropertyPage(props: SectionProps & { property: PropertyView }) {
  const { view, controls, nav, property: p } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const owns = p.share > 0;
  const can = controls.mode === "player" ? propertyControls(view, p) : [];
  const endable = controls.mode === "player" ? endableLeases(view, p) : [];
  return (
    <MoneyPage nav={nav} name="property" title={p.name} subtitle={p.place && p.place !== p.name ? p.place : undefined}>
      <IdText id={p.id} />
      <Hero label="Value" value={fmt(p.value)} sub={owns ? `Equity ${fmt(p.equity)}` : undefined} badges={<ShareBadge property={p} controls={controls} />} />
      {can.length > 0 ? (
        <Controls name={p.id}>
          {can.map((c) => (
            <Button key={c} variant={c === "buy" ? "primary" : "secondary"} icon={c === "let" ? "key" : c === "sell" ? "minus" : "plus"} onClick={() => nav.open(actionPage("property", p.id, c))}>
              {PROPERTY_CONTROL[c]}
            </Button>
          ))}
        </Controls>
      ) : null}
      {controls.mode === "gm" ? (
        <Controls name={p.id}>
          <Button icon="list" onClick={() => nav.open(actionPage("property", p.id, "fields"))}>
            Property fields
          </Button>
        </Controls>
      ) : null}
      <Section flush>
        <List>
          {p.place ? <ListRow icon="pin" title="At" value={p.place} /> : null}
          {p.forSale !== null && p.forSale !== undefined ? <ListRow icon="receipt" title="Asking" value={fmt(p.forSale)} /> : null}
          {owns ? <ListRow icon="wallet" title="Equity" value={fmt(p.equity)} valueTone={p.equity < 0 ? "neg" : undefined} /> : null}
          {p.mortgage ? <AccountRow view={view} nav={nav} id={p.mortgage.id} title="Mortgage" subtitle={[p.mortgage.name, p.mortgage.payment !== null ? `${fmt(p.mortgage.payment)} a month` : null, p.mortgage.monthsLeft !== null ? `${p.mortgage.monthsLeft} months left` : null].filter((s) => s !== null).join(" · ")} value={fmt(-Math.abs(p.mortgage.owed))} valueTone="neg" /> : null}
        </List>
      </Section>
      {owns ? <RouteRow view={view} controls={controls} nav={nav} route={p.route} reinvest={false} label="Rent goes to" page={actionPage("property", p.id, "route")} /> : null}
      {p.leases.length > 0 ? (
        <Section title="Leases" flush>
          <List>
            {p.leases.map((l, i) => (
              <LeaseRow key={l.flow || `vacant:${i}`} lease={l} currency={controls.currency} onOpen={endable.includes(l.flow) ? () => nav.open(actionPage("property", p.id, "end_lease", l.flow)) : undefined} />
            ))}
          </List>
        </Section>
      ) : null}
      {p.costs.length > 0 ? (
        <Section title="Running costs" flush>
          <List>
            {p.costs.map((f) => (
              <FlowListRow key={f.id} flow={f} nav={nav} />
            ))}
          </List>
        </Section>
      ) : null}
    </MoneyPage>
  );
}

function LetPage(props: SectionProps & { property: PropertyView }) {
  const { controls, nav, property: p } = props;
  const [tenant, setTenant] = useState("");
  const [rent, setRent] = useState("");
  const [months, setMonths] = useState<number | null>(12);
  const [day, setDay] = useState<number | null>(1);
  const [unit, setUnit] = useState("");
  if (controls.mode !== "player") return null;
  const cents = amountOf(rent, controls.currency);
  const ok = tenant !== "" && cents !== null && (day === null || (day >= 1 && day <= 28));
  return (
    <ActionPage nav={nav} controls={controls} name="property-let" title="Let it" subtitle={p.name} go="Start the lease" disabled={!ok} submit={() => (!ok || cents === null ? Promise.resolve(false) : controls.act(leaseStartAction(p.id, tenant, cents, { ...(months !== null ? { months } : {}), ...(day !== null ? { day } : {}), ...(unit.trim() !== "" ? { unit: unit.trim() } : {}) })))}>
      <SelectField label="Tenant" value={tenant} empty="Choose someone" options={knownPeople(controls.palette).map((k) => ({ value: k.id, label: k.label }))} onChange={setTenant} />
      <AmountField label="Rent a month" value={rent} currency={controls.currency} onInput={setRent} invalid={rent.trim() !== "" && cents === null} />
      <NumberField label="Months" value={months} min={1} onChange={setMonths} />
      <NumberField label="Due on day (1–28)" value={day} min={1} max={28} onChange={setDay} />
      <TextField label="Unit (if it has several)" value={unit} onInput={setUnit} />
    </ActionPage>
  );
}

function SellPropertyPage(props: SectionProps & { property: PropertyView }) {
  const { controls, nav, property: p } = props;
  const [price, setPrice] = useState(String(p.value / 10 ** controls.currency.decimals));
  const [buyer, setBuyer] = useState("");
  if (controls.mode !== "player") return null;
  const cents = amountOf(price, controls.currency);
  return (
    <ActionPage nav={nav} controls={controls} name="property-sell" title="Sell" subtitle={p.name} go="Sell" disabled={cents === null} submit={() => (cents === null ? Promise.resolve(false) : controls.act(propertySellAction(p.id, cents, buyer ? { buyer } : {})))}>
      <AmountField label="Price" value={price} currency={controls.currency} onInput={setPrice} invalid={cents === null} />
      <SelectField label="Buyer" value={buyer} empty="Whoever buys" options={knownPeople(controls.palette).map((k) => ({ value: k.id, label: k.label }))} onChange={setBuyer} />
      <Note>A mortgage on it is paid off from the price first.</Note>
    </ActionPage>
  );
}

/** The terms a lender offers a mortgage over, months, the usual first: the finance table's (`loans.mortgage.term_months`), which the purchase refuses any other than. */
const MORTGAGE_TERMS: readonly ChoiceOption[] = [
  { value: "360", label: "30 years", detail: "The usual" },
  { value: "240", label: "20 years" },
  { value: "180", label: "15 years" },
];

function BuyPropertyPage(props: SectionProps & { property: PropertyView }) {
  const { view, controls, nav, property: p } = props;
  const [price, setPrice] = useState(String((p.forSale ?? p.value) / 10 ** controls.currency.decimals));
  const [down, setDown] = useState("");
  const [term, setTerm] = useState("360");
  const [from, setFrom] = useState("");
  if (controls.mode !== "player") return null;
  const cents = amountOf(price, controls.currency);
  const downCents = down.trim() === "" ? null : amountOf(down, controls.currency);
  const ok = cents !== null && (down.trim() === "" || downCents !== null);
  // Only what isn't paid down is a mortgage, and only a mortgage has a term.
  const financed = cents !== null && downCents !== null && downCents < cents;
  return (
    <ActionPage nav={nav} controls={controls} name="property-buy" title="Buy" subtitle={p.name} go="Buy" disabled={!ok} submit={() => (!ok || cents === null ? Promise.resolve(false) : controls.act(propertyBuyAction(p.id, cents, { ...(from ? { from } : {}), ...(downCents !== null ? { down: downCents } : {}), ...(financed ? { termMonths: Number(term) } : {}) })))}>
      <AmountField label="Offer" value={price} currency={controls.currency} onInput={setPrice} invalid={cents === null} />
      <AmountField label="Down payment (empty: pay it all)" value={down} currency={controls.currency} onInput={setDown} invalid={down.trim() !== "" && downCents === null} />
      {financed ? <ChoiceField label="Mortgage over" value={term} options={MORTGAGE_TERMS} onChange={setTerm} /> : null}
      <SelectField label="Paid from" value={from} empty="Your usual account" options={moveSources(view).map((a) => ({ value: a.id, label: a.name }))} onChange={setFrom} />
    </ActionPage>
  );
}

/** Notice on a lease of a property the player lets: it ends today. */
function EndLeasePage(props: SectionProps & { property: PropertyView; lease: LeaseView }) {
  const { controls, nav, property: p, lease: l } = props;
  if (controls.mode !== "player") return null;
  return (
    <ActionPage nav={nav} controls={controls} name="lease-end" title="End the lease" subtitle={p.name} go="End" danger submit={() => controls.act(leaseEndAction(l.flow))}>
      <Section flush>
        <List>
          <LeaseRow lease={l} currency={controls.currency} />
        </List>
      </Section>
      <Note>{`End ${l.tenant}'s lease?`}</Note>
    </ActionPage>
  );
}

// ---------------------------------------------------------------- pages

/** A holding's pages: the holding and each control's page, each only where the mode and the view allow it. */
function holdingPage(control: string | undefined, props: SectionProps, h: HoldingView) {
  const { view, controls, nav } = props;
  const can = controls.mode === "player" ? holdingControls(view, h) : [];
  switch (control) {
    case undefined:
      return <HoldingPage {...props} holding={h} />;
    case "fields":
      return <FieldsPage nav={nav} controls={controls} name="holding-fields" title="Holding fields" subtitle={holdingName(h)} entity={h.id} />;
    case "price":
      return controls.mode === "gm" && priced(h) ? <AmountPage nav={nav} controls={controls} name="set-price" title="Set its price" subtitle={holdingName(h)} label={`Price per unit (now ${formatMoney(h.price, controls.currency)})`} go="Set the price" submit={(cents) => (cents === null ? Promise.resolve(false) : controls.edit(setPriceOps(h.asset.id, cents)))} /> : null;
    case "route":
      return h.option ? null : <RoutePage view={view} controls={controls} nav={nav} target={{ holding: h.id }} route={h.route} reinvest label="Distributions go to" subtitle={holdingName(h)} />;
    case "buy":
    case "sell":
      return can.includes(control) ? <TradePage {...props} side={control} holding={h} /> : null;
    case "exercise":
      return can.includes(control) ? <ExercisePage {...props} holding={h} /> : null;
    default:
      return null;
  }
}

/** A property's pages: the property, each control's page and a lease's notice, each only where the mode and the view allow it. */
function propertyPage(control: string | undefined, inner: string | undefined, props: SectionProps, p: PropertyView) {
  const { view, controls, nav } = props;
  const can = controls.mode === "player" ? propertyControls(view, p) : [];
  switch (control) {
    case undefined:
      return <PropertyPage {...props} property={p} />;
    case "fields":
      return <FieldsPage nav={nav} controls={controls} name="property-fields" title="Property fields" subtitle={p.name} entity={p.id} />;
    case "route":
      return p.share > 0 ? <RoutePage view={view} controls={controls} nav={nav} target={{ property: p.id }} route={p.route} reinvest={false} label="Rent goes to" subtitle={p.name} /> : null;
    case "end_lease": {
      const lease = p.leases.find((l) => l.flow === inner);
      return lease && controls.mode === "player" && endableLeases(view, p).includes(lease.flow) ? <EndLeasePage {...props} property={p} lease={lease} /> : null;
    }
    case "let":
      return can.includes(control) ? <LetPage {...props} property={p} /> : null;
    case "sell":
      return can.includes(control) ? <SellPropertyPage {...props} property={p} /> : null;
    case "buy":
      return can.includes(control) ? <BuyPropertyPage {...props} property={p} /> : null;
    default:
      return null;
  }
}

/** Investments' and properties' pages: each section, a new buy, a holding, a property, and each control's page. What the view no longer holds, or the mode may not do, draws nothing (gone). */
export const assetPages: HubPages = {
  heads: ["investments", "holding", "properties", "property"],
  render(page, props) {
    const { view, controls } = props;
    const [head, id, control, inner] = page.path;
    if (head === "investments") return id === undefined ? <InvestmentsSection {...props} /> : id === "buy" && canBuyNew(view, controls) ? <TradePage {...props} side="buy" /> : null;
    if (head === "properties") return id === undefined ? <PropertiesSection {...props} /> : id === "new" && controls.mode === "gm" ? <NewPropertyPage {...props} /> : null;
    if (id === undefined) return null;
    if (head === "holding") {
      const holding = view.investments?.holdings.find((h) => h.id === id);
      return holding ? holdingPage(control, props, holding) : null;
    }
    const property = head === "property" ? view.properties.find((p) => p.id === id) : undefined;
    return property ? propertyPage(control, inner, props, property) : null;
  },
};
