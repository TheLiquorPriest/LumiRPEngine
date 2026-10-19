// Money → Investments and Properties (DESIGN §27): holdings with their value, cost and gain (lots
// and realised gains in the full books), options, where distributions go; real estate with its
// value, equity, mortgage, leases and running costs. The player buys and sells, exercises options,
// routes distributions, lets and sells property and buys what's for sale, each an in-world action
// offered only where the feature runs for them; the GM sets prices, routes and every declared field.

import { useState } from "preact/hooks";
import { ROLE_RIGHTS, type DistributionRoute, type FinanceView, type HoldingView, type PropertyView } from "../../../shared/finance";
import { formatMoney } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { Card, Empty, Row } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { FlowRow } from "./flows";
import { AmountField, NumberField, Reveal, SelectField, TextField, type Choice } from "./forms";
import type { HubControls, PlayerControls, SectionProps } from "./hub";
import { endableLeases, holdingControls, investmentBlocks, knownPeople, moveSources, propertyControls, ROUTE_ELSEWHERE, routePick, transferTargets } from "./layout";
import { AmountAction, EntityFields } from "./lines";
import { amountOf, exerciseAction, leaseEndAction, leaseStartAction, propertyBuyAction, propertySellAction, routeAction, routeOps, setPriceOps, tradeAction, type RouteTarget, type TradeForm } from "./requests";

/** Where distributions can go: the default (the account's cash, else the deposit account), reinvested (holdings only), or one of the party's accounts. */
function routeChoices(view: FinanceView, reinvest: boolean): Choice[] {
  return [{ value: " ", label: "The usual place (its account's cash, else the deposit account)" }, ...(reinvest ? [{ value: "reinvest", label: "Reinvested" }] : []), ...view.accounts.filter((a) => a.role !== null && ROLE_RIGHTS[a.role].sees).map((a) => ({ value: a.id, label: a.name }))];
}

/**
 * Where a holding's dividends, a property's rent or a business share's profit go: the player's
 * route action, or the GM's `economy.route` for the party. The picker opens on the route the view
 * says is in force (`routePick`); another owner's account shows as such and can't be picked. The
 * usual place travels as "".
 */
export function RouteControl(props: { view: FinanceView; controls: HubControls; target: RouteTarget; route: DistributionRoute | null; reinvest: boolean; label: string }) {
  const { view, controls } = props;
  // Routing is an action from Money 3; the GM routes at any level.
  if (controls.mode === "player" && view.level < 3) return null;
  const pick = routePick(props.route);
  const choices = routeChoices(view, props.reinvest);
  return (
    <SelectField
      label={props.label}
      value={pick}
      empty={pick === "" ? "Choose" : undefined}
      options={pick === ROUTE_ELSEWHERE ? [...choices, { value: ROUTE_ELSEWHERE, label: "Another owner's account" }] : choices}
      disabled={controls.busy}
      onChange={(picked) => {
        if (picked === "" || picked === ROUTE_ELSEWHERE) return;
        const to = picked.trim();
        if (controls.mode === "player") void controls.act(routeAction(props.target, to));
        else void controls.edit(routeOps(props.target, view.party, to));
      }}
    />
  );
}

/** A buy or a sale: of a holding, or (a buy) of an asset on the market, as units or an amount, an option with its strike and expiry. */
function TradeFormView(props: { view: FinanceView; controls: PlayerControls; side: "buy" | "sell"; holding?: HoldingView; onDone(): void }) {
  const { view, controls } = props;
  const inv = view.investments;
  const market = inv?.market ?? [];
  const options = view.features.includes("options");
  const accounts = (inv?.accounts ?? []).map((id) => ({ value: id, label: view.accounts.find((a) => a.id === id)?.name ?? id }));
  const [form, setForm] = useState<TradeForm>({ side: props.side, holding: props.holding?.id ?? "", asset: props.holding?.asset.id ?? market[0]?.asset ?? "", account: accounts[0]?.value ?? "", qty: null, amount: "", from: "", to: "", option: null });
  const result = tradeAction(form, controls.currency);
  const price = props.holding?.price ?? market.find((m) => m.asset === form.asset)?.price ?? null;
  // A buy pays from the holding's account when it holds cash; a brokerage that doesn't needs another account named.
  const sources = moveSources(view).map((a) => ({ value: a.id, label: `${a.name} (${formatMoney(a.available ?? a.cents, controls.currency)})` }));
  const targets = transferTargets(view, "").map((a) => ({ value: a.id, label: a.name }));
  return (
    <form
      class="lre-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (typeof result !== "string") void controls.act(result).then((ok) => ok && props.onDone());
      }}
    >
      {!props.holding ? (
        <>
          <SelectField label="What" value={form.asset} empty="Choose" options={market.map((m) => ({ value: m.asset, label: `${m.label}${m.symbol ? ` (${m.symbol})` : ""} · ${formatMoney(m.price, controls.currency)}` }))} onChange={(asset) => setForm({ ...form, asset })} />
          <SelectField label="Held in" value={form.account} empty="Held directly" options={accounts} onChange={(account) => setForm({ ...form, account })} />
          {options ? (
            <label class="lre-row">
              <span class="k">An option on it</span>
              <span class="lre-check">
                <input type="checkbox" checked={form.option !== null} onChange={(event) => setForm({ ...form, option: event.currentTarget.checked ? { right: "call", strike: "", expiry: "" } : null })} />
              </span>
            </label>
          ) : null}
          {form.option ? (
            <>
              <SelectField label="Right" value={form.option.right} options={[{ value: "call", label: "Call (the right to buy)" }, { value: "put", label: "Put (the right to sell)" }]} onChange={(right) => form.option && setForm({ ...form, option: { ...form.option, right: right === "put" ? "put" : "call" } })} />
              <AmountField label="Strike" value={form.option.strike} currency={controls.currency} onInput={(strike) => form.option && setForm({ ...form, option: { ...form.option, strike } })} />
              <TextField label="Expires" type="date" value={form.option.expiry} onInput={(expiry) => form.option && setForm({ ...form, option: { ...form.option, expiry } })} />
            </>
          ) : null}
        </>
      ) : null}
      {price !== null ? <Row k="Price now" v={formatMoney(price, controls.currency)} /> : null}
      <NumberField label={form.option || props.holding?.option ? "Contracts" : "Units"} value={form.qty} min={0} onChange={(qty) => setForm({ ...form, qty })} />
      <AmountField label={form.side === "buy" ? "Or spend" : "Or raise"} value={form.amount} currency={controls.currency} onInput={(amount) => setForm({ ...form, amount })} invalid={form.amount.trim() !== "" && amountOf(form.amount, controls.currency) === null} placeholder={form.side === "sell" ? "Empty: sell it all" : undefined} />
      {form.side === "buy" ? <SelectField label="Pay from" value={form.from} empty="The account it's held in, else your usual account" options={sources} onChange={(from) => setForm({ ...form, from })} /> : <SelectField label="The money goes to" value={form.to} empty="The account it's held in, else your usual account" options={targets} onChange={(to) => setForm({ ...form, to })} />}
      {typeof result === "string" ? <span class="lre-small lre-muted">{result}</span> : null}
      <button type="submit" class="lre-btn primary" disabled={controls.busy || typeof result === "string"}>
        {form.side === "buy" ? "Buy" : "Sell"}
      </button>
    </form>
  );
}

/** Exercising contracts: how many (all of them unless said), and the account a call's strike comes from or a put's goes to. */
function ExerciseForm(props: { view: FinanceView; holding: HoldingView; controls: PlayerControls; onDone(): void }) {
  const { view, holding: h, controls } = props;
  const [qty, setQty] = useState<number | null>(null);
  const [account, setAccount] = useState("");
  const call = h.option?.right !== "put";
  const choices = (call ? moveSources(view) : transferTargets(view, "")).map((a) => ({ value: a.id, label: a.name }));
  return (
    <form
      class="lre-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void controls.act(exerciseAction(h.id, qty, account === "" ? {} : call ? { from: account } : { to: account })).then((ok) => ok && props.onDone());
      }}
    >
      <NumberField label={`Contracts (of ${h.qty}; empty: all)`} value={qty} min={1} max={h.qty} onChange={setQty} />
      <SelectField label={call ? "Pay the strike from" : "The strike goes to"} value={account} empty="The account it's held in, else your usual account" options={choices} onChange={setAccount} />
      <button type="submit" class="lre-btn primary" disabled={controls.busy || (qty !== null && !(qty >= 1 && qty <= h.qty))}>
        Exercise
      </button>
    </form>
  );
}

function HoldingCard(props: { view: FinanceView; holding: HoldingView; controls: HubControls }) {
  const { view, holding: h, controls } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const blocks = investmentBlocks(view);
  const accountName = h.account ? (view.accounts.find((a) => a.id === h.account)?.name ?? h.account) : "held directly";
  const can = holdingControls(view, h);
  return (
    <Card title={`${h.asset.label}${h.asset.symbol ? ` (${h.asset.symbol})` : ""}`} aside={<span class="lre-badge">{humanize(h.asset.class)}</span>}>
      <Row k={`${h.qty} × ${fmt(h.price)}`} sub={accountName} v={fmt(h.value)} />
      <Row k="Cost" v={fmt(h.cost)} />
      <Row k="Gain" v={`${h.gain > 0 ? "+" : ""}${fmt(h.gain)}`} tone={h.gain < 0 ? "neg" : "pos"} />
      {h.option ? <Row k={`${humanize(h.option.right)} on ${h.option.underlying} at ${fmt(h.option.strike)}`} sub={`expires ${h.option.expiry}`} v={<span class={h.option.inTheMoney ? "lre-badge pos" : "lre-badge"}>{h.option.inTheMoney ? "in the money" : "out of the money"}</span>} /> : null}
      {blocks.lots && h.lots.length > 0 ? (
        <>
          <div class="lre-h">Lots</div>
          {h.lots.map((l, i) => (
            <Row key={`${l.at}:${i}`} k={`${l.qty} bought ${l.at}`} sub={`cost ${fmt(l.cost)} · ${l.term} term`} v={`${l.gain > 0 ? "+" : ""}${fmt(l.gain)}`} tone={l.gain < 0 ? "neg" : "pos"} />
          ))}
        </>
      ) : null}
      {!h.option ? <RouteControl view={view} controls={controls} target={{ holding: h.id }} route={h.route} reinvest label="Distributions go to" /> : null}
      {controls.mode === "player" ? (
        can.length > 0 ? (
          <div class="lre-inline">
            {can.includes("buy") ? <Reveal label="Buy more">{(close) => <TradeFormView view={view} controls={controls} side="buy" holding={h} onDone={close} />}</Reveal> : null}
            {can.includes("sell") ? <Reveal label="Sell">{(close) => <TradeFormView view={view} controls={controls} side="sell" holding={h} onDone={close} />}</Reveal> : null}
            {can.includes("exercise") ? <Reveal label="Exercise" primary>{(close) => <ExerciseForm view={view} holding={h} controls={controls} onDone={close} />}</Reveal> : null}
          </div>
        ) : null
      ) : (
        <div class="lre-inline">
          {h.asset.class !== "option" && h.asset.class !== "property" && h.asset.class !== "business_stake" ? (
            <Reveal label="Set its price">{(close) => <AmountAction label={`Price per unit (now ${fmt(h.price)})`} go="Set the price" currency={controls.currency} busy={controls.busy} submit={(cents) => (cents === null ? Promise.resolve(false) : controls.edit(setPriceOps(h.asset.id, cents)))} onDone={close} />}</Reveal>
          ) : null}
          <Reveal label="Holding fields">{() => <EntityFields controls={controls} entity={h.id} />}</Reveal>
        </div>
      )}
    </Card>
  );
}

export function InvestmentsSection(props: SectionProps) {
  const { view, controls } = props;
  const inv = view.investments;
  if (!inv) return <Empty>No investments.</Empty>;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const blocks = investmentBlocks(view);
  return (
    <>
      <Card title="Investments">
        <Row k="Worth now" v={fmt(inv.value)} />
        <Row k="Cost" v={fmt(inv.cost)} />
        <Row k="Gain not yet taken" v={`${inv.unrealised > 0 ? "+" : ""}${fmt(inv.unrealised)}`} tone={inv.unrealised < 0 ? "neg" : "pos"} />
        <Row k="Gain taken" sub={blocks.gains && inv.realisedShort !== undefined && inv.realisedLong !== undefined ? `${fmt(inv.realisedShort)} short term · ${fmt(inv.realisedLong)} long term` : undefined} v={fmt(inv.realised)} />
        {blocks.income && inv.income !== undefined ? <Row k="Paid out this year" v={fmt(inv.income)} tone="pos" /> : null}
        {blocks.gains && inv.taxDue ? <Row k="Tax on gains" sub={`due ${inv.taxDue.at}`} v={fmt(inv.taxDue.cents)} tone="warn" /> : null}
      </Card>
      {controls.mode === "player" && view.features.includes("investments") && (inv.market ?? []).length > 0 ? <Reveal label="Buy something new" primary>{(close) => <TradeFormView view={view} controls={controls} side="buy" onDone={close} />}</Reveal> : null}
      {inv.holdings.length === 0 ? <Empty>Nothing held.</Empty> : inv.holdings.map((h) => <HoldingCard key={h.id} view={view} holding={h} controls={controls} />)}
    </>
  );
}

function LeaseForm(props: { property: PropertyView; controls: PlayerControls; onDone(): void }) {
  const { controls } = props;
  const [tenant, setTenant] = useState("");
  const [rent, setRent] = useState("");
  const [months, setMonths] = useState<number | null>(12);
  const [day, setDay] = useState<number | null>(1);
  const [unit, setUnit] = useState("");
  const cents = amountOf(rent, controls.currency);
  const ok = tenant !== "" && cents !== null && (day === null || (day >= 1 && day <= 28));
  return (
    <form
      class="lre-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (ok && cents !== null) void controls.act(leaseStartAction(props.property.id, tenant, cents, { ...(months !== null ? { months } : {}), ...(day !== null ? { day } : {}), ...(unit.trim() !== "" ? { unit: unit.trim() } : {}) })).then((done) => done && props.onDone());
      }}
    >
      <SelectField label="Tenant" value={tenant} empty="Choose someone" options={knownPeople(controls.palette).map((p) => ({ value: p.id, label: p.label }))} onChange={setTenant} />
      <AmountField label="Rent a month" value={rent} currency={controls.currency} onInput={setRent} invalid={rent.trim() !== "" && cents === null} />
      <NumberField label="Months" value={months} min={1} onChange={setMonths} />
      <NumberField label="Due on day (1–28)" value={day} min={1} max={28} onChange={setDay} />
      <TextField label="Unit (if it has several)" value={unit} onInput={setUnit} />
      <button type="submit" class="lre-btn primary" disabled={controls.busy || !ok}>
        Start the lease
      </button>
    </form>
  );
}

function SellForm(props: { property: PropertyView; controls: PlayerControls; onDone(): void }) {
  const { controls } = props;
  const [price, setPrice] = useState(String(props.property.value / 10 ** controls.currency.decimals));
  const [buyer, setBuyer] = useState("");
  const cents = amountOf(price, controls.currency);
  return (
    <form
      class="lre-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (cents !== null) void controls.act(propertySellAction(props.property.id, cents, buyer ? { buyer } : {})).then((ok) => ok && props.onDone());
      }}
    >
      <AmountField label="Price" value={price} currency={controls.currency} onInput={setPrice} invalid={cents === null} />
      <SelectField label="Buyer" value={buyer} empty="Whoever buys" options={knownPeople(controls.palette).map((p) => ({ value: p.id, label: p.label }))} onChange={setBuyer} />
      <span class="lre-small lre-muted">A mortgage on it is paid off from the price first.</span>
      <button type="submit" class="lre-btn primary" disabled={controls.busy || cents === null}>
        Sell
      </button>
    </form>
  );
}

function BuyForm(props: { view: FinanceView; property: PropertyView; controls: PlayerControls; onDone(): void }) {
  const { view, controls } = props;
  const asking = props.property.forSale ?? props.property.value;
  const [price, setPrice] = useState(String(asking / 10 ** controls.currency.decimals));
  const [down, setDown] = useState("");
  const [term, setTerm] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const cents = amountOf(price, controls.currency);
  const downCents = down.trim() === "" ? null : amountOf(down, controls.currency);
  const ok = cents !== null && (down.trim() === "" || downCents !== null);
  return (
    <form
      class="lre-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (ok && cents !== null) void controls.act(propertyBuyAction(props.property.id, cents, { ...(from ? { from } : {}), ...(downCents !== null ? { down: downCents } : {}), ...(term !== null ? { termMonths: term } : {}) })).then((done) => done && props.onDone());
      }}
    >
      <AmountField label="Offer" value={price} currency={controls.currency} onInput={setPrice} invalid={cents === null} />
      <AmountField label="Down payment (empty: pay it all)" value={down} currency={controls.currency} onInput={setDown} invalid={down.trim() !== "" && downCents === null} />
      {downCents !== null ? <NumberField label="Mortgage term (months)" value={term} min={1} onChange={setTerm} /> : null}
      <SelectField label="Paid from" value={from} empty="Your usual account" options={moveSources(view).map((a) => ({ value: a.id, label: a.name }))} onChange={setFrom} />
      <button type="submit" class="lre-btn primary" disabled={controls.busy || !ok}>
        Buy
      </button>
    </form>
  );
}

function PropertyCard(props: { view: FinanceView; property: PropertyView; controls: HubControls }) {
  const app = useApp();
  const { view, property: p, controls } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const owns = p.share > 0;
  const can = propertyControls(view, p);
  const endable = endableLeases(view, p);
  return (
    <Card title={`🏠 ${p.name}`} aside={<span class={owns ? "lre-badge" : "lre-badge accent"}>{owns ? `${Math.round(p.share * 10) / 10}% yours` : "For sale"}</span>}>
      {p.place ? <Row k="At" v={p.place} /> : null}
      <Row k="Value" v={fmt(p.value)} />
      {p.forSale !== null && p.forSale !== undefined ? <Row k="Asking" v={fmt(p.forSale)} /> : null}
      {owns ? <Row k="Equity" v={fmt(p.equity)} tone={p.equity < 0 ? "neg" : undefined} /> : null}
      {p.mortgage ? <Row k={`Mortgage: ${p.mortgage.name}`} sub={[p.mortgage.payment !== null ? `${fmt(p.mortgage.payment)} a month` : null, p.mortgage.monthsLeft !== null ? `${p.mortgage.monthsLeft} months left` : null].filter((s) => s !== null).join(" · ")} v={fmt(-Math.abs(p.mortgage.owed))} tone="neg" /> : null}
      {p.leases.length > 0 ? <div class="lre-h">Leases</div> : null}
      {p.leases.map((l, i) => (
        <Row
          key={l.flow || `vacant:${i}`}
          k={l.tenant || "No tenant"}
          sub={[l.start ? `from ${l.start}` : null, l.end ? `to ${l.end}` : null].filter((s) => s !== null).join(" ")}
          v={
            <span class="lre-inline">
              {fmt(l.rent)}
              <span class={l.state === "vacant" ? "lre-badge warn" : "lre-badge"}>{l.state}</span>
              {controls.mode === "player" && endable.includes(l.flow) ? (
                <button type="button" class="lre-btn small" disabled={controls.busy} onClick={() => void (async () => (await app.host.confirm("End lease", `End ${l.tenant}'s lease?`, "warning", "End")) && controls.act(leaseEndAction(l.flow)))()}>
                  End
                </button>
              ) : null}
            </span>
          }
        />
      ))}
      {p.costs.length > 0 ? <div class="lre-h">Running costs</div> : null}
      {p.costs.map((f) => (
        <FlowRow key={f.id} view={view} flow={f} controls={controls} />
      ))}
      {owns ? <RouteControl view={view} controls={controls} target={{ property: p.id }} route={p.route} reinvest={false} label="Rent goes to" /> : null}
      {controls.mode === "player" ? (
        can.length > 0 ? (
          <div class="lre-inline">
            {can.includes("let") ? <Reveal label="Let it">{(close) => <LeaseForm property={p} controls={controls} onDone={close} />}</Reveal> : null}
            {can.includes("sell") ? <Reveal label="Sell">{(close) => <SellForm property={p} controls={controls} onDone={close} />}</Reveal> : null}
            {can.includes("buy") ? <Reveal label="Buy" primary>{(close) => <BuyForm view={view} property={p} controls={controls} onDone={close} />}</Reveal> : null}
          </div>
        ) : null
      ) : (
        <Reveal label="Property fields">{() => <EntityFields controls={controls} entity={p.id} />}</Reveal>
      )}
    </Card>
  );
}

export function PropertiesSection(props: SectionProps) {
  const { view, controls } = props;
  return view.properties.length === 0 ? <Empty>No property.</Empty> : <>{view.properties.map((p) => <PropertyCard key={p.id} view={view} property={p} controls={controls} />)}</>;
}
